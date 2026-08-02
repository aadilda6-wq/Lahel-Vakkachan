const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Meeting = require('../models/meeting');
const Team = require('../models/team');
const { createMeetingEvent, deleteMeetingEvent, updateMeetingEvent } = require('../services/googleCalendar');
const { getMemberPermissions } = require('../middleware/permissionHandler');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meet')
    .setDescription('Manage team meetings and schedules')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Schedule a team meeting and generate a Google Meet link')
        .addStringOption(opt => opt.setName('title').setDescription('Meeting title').setRequired(true))
        .addStringOption(opt => opt.setName('start-time').setDescription('Start time in YYYY-MM-DD HH:MM format (local server time)').setRequired(true))
        .addIntegerOption(opt => opt.setName('duration').setDescription('Meeting duration in minutes (e.g., 30, 45, 60)').setRequired(true))
        .addStringOption(opt => opt.setName('description').setDescription('Meeting agenda/details'))
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('Edit details of an upcoming scheduled meeting')
        .addStringOption(opt => opt.setName('meeting-id').setDescription('Select the meeting to edit').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('title').setDescription('New meeting title'))
        .addStringOption(opt => opt.setName('start-time').setDescription('New start time in YYYY-MM-DD HH:MM format'))
        .addIntegerOption(opt => opt.setName('duration').setDescription('New duration in minutes'))
        .addStringOption(opt => opt.setName('description').setDescription('New agenda/details'))
    )
    .addSubcommand(sub =>
      sub.setName('cancel')
        .setDescription('Cancel an upcoming scheduled meeting')
        .addStringOption(opt => opt.setName('meeting-id').setDescription('Select the meeting to cancel').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List scheduled server meetings')
        .addBooleanOption(opt => opt.setName('upcoming').setDescription('Only list upcoming meetings (defaults to true)'))
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const guildId = interaction.guild.id;

    try {
      const query = { guildId };

      const subcommand = interaction.options.getSubcommand();
      // For editing or cancelling, only autocomplete future scheduled meetings
      if (subcommand === 'edit' || subcommand === 'cancel') {
        query.startTime = { $gt: new Date() };
      }

      if (focusedValue) {
        query.title = { $regex: focusedValue, $options: 'i' };
      }

      const meetings = await Meeting.find(query).limit(25);
      await interaction.respond(
        meetings.map(meet => ({
          name: `${meet.title.substring(0, 50)} (${meet.startTime.toLocaleDateString()})`,
          value: meet._id.toString()
        }))
      );
    } catch (error) {
      logger.error('Error during meeting autocomplete:', error);
    }
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const permissions = await getMemberPermissions(interaction.member);

    // Verify member permissions
    if (subcommand === 'list' && !permissions.isMember && !permissions.isLeader && !permissions.isAdmin) {
      return interaction.reply({ content: '❌ You must be registered as a Member, Leader, or Admin to list meetings.', ephemeral: true });
    }

    if (subcommand !== 'list' && !permissions.isLeader && !permissions.isAdmin) {
      return interaction.reply({ content: '❌ Only Team Leaders and Admins can create, edit, or cancel meetings.', ephemeral: true });
    }

    try {
      const settings = await Team.findOne({ guildId });

      // Create Meeting subcommand
      if (subcommand === 'create') {
        const title = interaction.options.getString('title');
        const startTimeStr = interaction.options.getString('start-time');
        const durationMinutes = interaction.options.getInteger('duration');
        const description = interaction.options.getString('description') || '';

        const startTime = new Date(startTimeStr.replace(/\./g, '-'));
        if (isNaN(startTime.getTime())) {
          return interaction.reply({ 
            content: '❌ Invalid date format. Please use YYYY-MM-DD HH:MM (e.g., `2026-08-15 14:00`).', 
            ephemeral: true 
          });
        }

        if (startTime.getTime() < Date.now()) {
          return interaction.reply({ 
            content: '❌ You cannot schedule a meeting in the past.', 
            ephemeral: true 
          });
        }

        const endTime = new Date(startTime.getTime() + (durationMinutes * 60 * 1000));

        await interaction.deferReply();

        logger.info(`Scheduling meeting "${title}" for guild ${guildId}`);
        const { eventId, meetLink } = await createMeetingEvent(title, description, startTime, endTime);

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
          .setTitle('📅 Meeting Scheduled Successfully')
          .setDescription(description || '*No agenda specified*')
          .setColor('#9900ff')
          .addFields(
            { name: 'Meeting ID', value: `\`${meeting._id}\``, inline: true },
            { name: 'Topic', value: title, inline: true },
            { name: 'Start Time', value: startTime.toLocaleString(), inline: true },
            { name: 'Duration', value: `${durationMinutes} minutes`, inline: true },
            { name: 'Organizer', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Google Meet Link', value: `🌐 [Join Google Meet](${meetLink})` }
          )
          .setTimestamp();

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
      }

      // Edit Meeting subcommand
      if (subcommand === 'edit') {
        const meetingId = interaction.options.getString('meeting-id');
        const newTitle = interaction.options.getString('title');
        const newStartTimeStr = interaction.options.getString('start-time');
        const newDuration = interaction.options.getInteger('duration');
        const newDescription = interaction.options.getString('description');

        const meeting = await Meeting.findOne({ _id: meetingId, guildId });
        if (!meeting) {
          return interaction.reply({ content: '❌ Meeting not found.', ephemeral: true });
        }

        if (meeting.startTime.getTime() < Date.now()) {
          return interaction.reply({ content: '❌ Cannot edit a meeting that has already started or completed.', ephemeral: true });
        }

        await interaction.deferReply();

        let updatedStartTime = meeting.startTime;
        if (newStartTimeStr) {
          updatedStartTime = new Date(newStartTimeStr.replace(/\./g, '-'));
          if (isNaN(updatedStartTime.getTime())) {
            return interaction.editReply({ content: '❌ Invalid date format. Please use YYYY-MM-DD HH:MM (e.g., `2026-08-15 14:00`).' });
          }
          if (updatedStartTime.getTime() < Date.now()) {
            return interaction.editReply({ content: '❌ You cannot schedule a meeting in the past.' });
          }
        }

        let updatedEndTime = meeting.endTime;
        if (newDuration || newStartTimeStr) {
          const duration = newDuration || Math.round((meeting.endTime.getTime() - meeting.startTime.getTime()) / (60 * 1000));
          updatedEndTime = new Date(updatedStartTime.getTime() + (duration * 60 * 1000));
        }

        logger.info(`Editing Google Calendar event ${meeting.calendarEventId} for meeting ${meeting._id}`);
        // Apply edits to Google Calendar
        await updateMeetingEvent(
          meeting.calendarEventId,
          newTitle,
          newDescription,
          newStartTimeStr ? updatedStartTime : null,
          (newDuration || newStartTimeStr) ? updatedEndTime : null
        );

        // Apply edits to database
        if (newTitle) meeting.title = newTitle;
        if (newDescription !== null && newDescription !== undefined) meeting.description = newDescription;
        meeting.startTime = updatedStartTime;
        meeting.endTime = updatedEndTime;

        // Reset notification checks if the time was updated
        if (newStartTimeStr) {
          meeting.remindersSent = [];
        }

        await meeting.save();
        logger.info(`Successfully updated meeting ${meeting._id} in database`);

        const embed = new EmbedBuilder()
          .setTitle('🔄 Meeting Updated')
          .setDescription(meeting.description || '*No agenda specified*')
          .setColor('#00ffbb')
          .addFields(
            { name: 'Meeting ID', value: `\`${meeting._id}\``, inline: true },
            { name: 'Topic', value: meeting.title, inline: true },
            { name: 'Start Time', value: meeting.startTime.toLocaleString(), inline: true },
            { name: 'Duration', value: `${Math.round((meeting.endTime.getTime() - meeting.startTime.getTime()) / (60 * 1000))} minutes`, inline: true },
            { name: 'Google Meet Link', value: `🌐 [Join Google Meet](${meeting.meetLink})` }
          )
          .setTimestamp();

        if (settings && settings.meetingChannelId) {
          try {
            const meetingChannel = await interaction.guild.channels.fetch(settings.meetingChannelId);
            if (meetingChannel) {
              await meetingChannel.send({ embeds: [embed] });
            }
          } catch (err) {
            logger.warn(`Failed to send edit notice to configured channel: ${err.message}`);
          }
        }

        return interaction.editReply({ embeds: [embed] });
      }

      // Cancel Meeting subcommand
      if (subcommand === 'cancel') {
        const meetingId = interaction.options.getString('meeting-id');

        const meeting = await Meeting.findOne({ _id: meetingId, guildId });
        if (!meeting) {
          return interaction.reply({ content: '❌ Meeting not found.', ephemeral: true });
        }

        await interaction.deferReply();

        // Delete from Google Calendar API
        if (meeting.calendarEventId) {
          await deleteMeetingEvent(meeting.calendarEventId);
        }

        // Delete from database
        await Meeting.deleteOne({ _id: meetingId });
        logger.info(`Meeting ${meetingId} deleted and cancelled.`);

        const embed = new EmbedBuilder()
          .setTitle('🗑️ Meeting Cancelled')
          .setDescription(`The meeting **"${meeting.title}"** has been cancelled.`)
          .setColor('#ff3333')
          .addFields(
            { name: 'Cancelled By', value: `${interaction.user.username}`, inline: true },
            { name: 'Was Scheduled For', value: meeting.startTime.toLocaleString(), inline: true }
          )
          .setTimestamp();

        if (settings && settings.meetingChannelId) {
          try {
            const meetingChannel = await interaction.guild.channels.fetch(settings.meetingChannelId);
            if (meetingChannel) {
              await meetingChannel.send({ embeds: [embed] });
            }
          } catch (err) {
            logger.warn(`Failed to send cancel notice to configured channel: ${err.message}`);
          }
        }

        return interaction.editReply({ content: `✅ Meeting **${meeting.title}** has been cancelled successfully.` });
      }

      // List Meetings subcommand
      if (subcommand === 'list') {
        const upcomingOnly = interaction.options.getBoolean('upcoming') !== false;

        const query = { guildId };
        if (upcomingOnly) {
          query.startTime = { $gt: new Date() };
        }

        const meetings = await Meeting.find(query).sort({ startTime: 1 });

        if (meetings.length === 0) {
          return interaction.reply({ content: `ℹ️ No ${upcomingOnly ? 'upcoming ' : ''}meetings scheduled.` });
        }

        const embed = new EmbedBuilder()
          .setTitle(`📅 Scheduled Meetings List (${upcomingOnly ? 'Upcoming' : 'All'})`)
          .setColor('#00aaff')
          .setTimestamp();

        let desc = '';
        meetings.forEach((m, idx) => {
          desc += `**${idx + 1}. ${m.title}**\n`;
          desc += `• ID: \`${m._id}\` | [Join Meet](${m.meetLink})\n`;
          desc += `• Time: \`${m.startTime.toLocaleString()}\` to \`${m.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\`\n\n`;
        });

        if (desc.length > 4000) {
          desc = desc.substring(0, 3970) + '\n\n*...list truncated.*';
        }

        embed.setDescription(desc);
        return interaction.reply({ embeds: [embed] });
      }

    } catch (error) {
      logger.error('Error handling meeting command:', error);
      const errorMsg = '❌ Failed to process meeting request. Check your parameters or Calendar credentials.';
      if (interaction.replied || interaction.deferred) {
        return interaction.editReply({ content: errorMsg });
      } else {
        return interaction.reply({ content: errorMsg, ephemeral: true });
      }
    }
  }
};
