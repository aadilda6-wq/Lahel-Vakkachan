const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Meeting = require('../models/meeting');
const Team = require('../models/team');
const { createMeetingEvent } = require('../services/googleCalendar');
const { getMemberPermissions } = require('../middleware/permissionHandler');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meet')
    .setDescription('Schedule a team meeting and generate a Google Meet link')
    .addStringOption(opt => 
      opt.setName('title')
        .setDescription('Meeting title')
        .setRequired(true)
    )
    .addStringOption(opt => 
      opt.setName('start-time')
        .setDescription('Start time in YYYY-MM-DD HH:MM format (local server time)')
        .setRequired(true)
    )
    .addIntegerOption(opt => 
      opt.setName('duration')
        .setDescription('Meeting duration in minutes (e.g., 30, 45, 60)')
        .setRequired(true)
    )
    .addStringOption(opt => 
      opt.setName('description')
        .setDescription('Meeting agenda/details')
    ),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const permissions = await getMemberPermissions(interaction.member);

    // Only leaders or admins can schedule meetings
    if (!permissions.isLeader && !permissions.isAdmin) {
      return interaction.reply({ content: '❌ Only Team Leaders and Admins can schedule meetings.', ephemeral: true });
    }

    const title = interaction.options.getString('title');
    const startTimeStr = interaction.options.getString('start-time');
    const durationMinutes = interaction.options.getInteger('duration');
    const description = interaction.options.getString('description') || '';

    // Parse start time (in local server time context)
    // Replace '/' with '-' and other cleanup if needed
    const startTime = new Date(startTimeStr.replace(/\./g, '-'));
    if (isNaN(startTime.getTime())) {
      return interaction.reply({ 
        content: '❌ Invalid date format. Please use YYYY-MM-DD HH:MM (e.g., `2026-08-15 14:00`).', 
        ephemeral: true 
      });
    }

    // Verify date is in the future
    if (startTime.getTime() < Date.now()) {
      return interaction.reply({ 
        content: '❌ You cannot schedule a meeting in the past.', 
        ephemeral: true 
      });
    }

    // Calculate end time
    const endTime = new Date(startTime.getTime() + (durationMinutes * 60 * 1000));

    // Defer reply since Google Calendar insert might take slightly over 3 seconds
    await interaction.deferReply();

    try {
      logger.info(`Scheduling meeting "${title}" for guild ${guildId} starting at ${startTime.toISOString()}`);
      
      // Call Google service
      const { eventId, meetLink } = await createMeetingEvent(title, description, startTime, endTime);

      // Save meeting to MongoDB
      const meeting = new Meeting({
        title,
        description,
        startTime,
        endTime,
        calendarEventId: eventId,
        meetLink,
        organizerId: interaction.user.id,
        guildId
      });

      await meeting.save();
      logger.info(`Successfully stored meeting ${meeting._id} in database`);

      const embed = new EmbedBuilder()
        .setTitle('📅 Meeting Scheduled successfully')
        .setDescription(description || '*No agenda specified*')
        .setColor('#9900ff')
        .addFields(
          { name: 'Topic', value: title },
          { name: 'Start Time', value: startTime.toLocaleString(), inline: true },
          { name: 'Duration', value: `${durationMinutes} minutes`, inline: true },
          { name: 'Organizer', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Google Meet Link', value: `🌐 [Join Google Meet](${meetLink})` }
        )
        .setFooter({ text: `Meeting ID: ${meeting._id}` })
        .setTimestamp();

      // Check for config settings channel mapping
      const settings = await Team.findOne({ guildId });
      if (settings && settings.meetingChannelId) {
        try {
          const meetingChannel = await interaction.guild.channels.fetch(settings.meetingChannelId);
          if (meetingChannel) {
            await meetingChannel.send({ embeds: [embed] });
          }
        } catch (err) {
          logger.warn(`Failed to send meeting notification to configured channel: ${err.message}`);
        }
      }

      return interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error('Error scheduling meeting:', error);
      return interaction.editReply({ content: '❌ Failed to schedule the meeting or sync with Google Calendar. Please check your credentials.' });
    }
  }
};
