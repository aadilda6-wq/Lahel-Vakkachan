const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const Meeting = require('../models/meeting');
const Team = require('../models/team');
const { createMeetingEvent, deleteMeetingEvent, updateMeetingEvent } = require('../services/googleCalendar');
const { getMemberPermissions } = require('../middleware/permissionHandler');
const logger = require('../utils/logger');

/**
 * Normalizes and parses a date string, validating it for standard format and valid timezone offsets.
 * Throws a clear error if parsing fails.
 */
function parseAndValidateDate(dateStr) {
  if (!dateStr) return null;
  const normalizedStr = dateStr.replace(/\./g, '-');
  const parsedDate = new Date(normalizedStr);
  
  if (isNaN(parsedDate.getTime())) {
    throw new Error('Invalid date/time or timezone format. Please use YYYY-MM-DD HH:MM (e.g., `2026-08-15 14:00`).');
  }
  return parsedDate;
}



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
    // Acknowledge the interaction immediately to prevent the 3-second timeout (Unknown interaction 10062)
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const permissions = await getMemberPermissions(interaction.member);
    
    // Structured log metrics
    const startTimeMetric = Date.now();
    let executionStatus = 'Success';
    let loggedMeetingId = null;
    let loggedCalendarEventId = null;

    // Verify member permissions
    if (subcommand === 'list' && !permissions.isMember && !permissions.isLeader && !permissions.isAdmin) {
      executionStatus = 'Failure';
      logger.info(JSON.stringify({
        logType: 'STRUCTURED_MEETING_OPERATION',
        userId: interaction.user.id,
        guildId,
        channelId: interaction.channelId,
        meetingId: null,
        calendarEventId: null,
        requestType: subcommand,
        executionTimeMs: Date.now() - startTimeMetric,
        status: executionStatus
      }));
      return interaction.editReply({ content: '❌ You must be registered as a Member, Leader, or Admin to list meetings.' });
    }

    if (subcommand !== 'list' && !permissions.isLeader && !permissions.isAdmin) {
      executionStatus = 'Failure';
      logger.info(JSON.stringify({
        logType: 'STRUCTURED_MEETING_OPERATION',
        userId: interaction.user.id,
        guildId,
        channelId: interaction.channelId,
        meetingId: null,
        calendarEventId: null,
        requestType: subcommand,
        executionTimeMs: Date.now() - startTimeMetric,
        status: executionStatus
      }));
      return interaction.editReply({ content: '❌ Only Team Leaders and Admins can create, edit, or cancel meetings.' });
    }

    try {
      const settings = await Team.findOne({ guildId });

      // --- CREATE MEETING ---
      if (subcommand === 'create') {
        const title = interaction.options.getString('title');
        const startTimeStr = interaction.options.getString('start-time');
        const durationMinutes = interaction.options.getInteger('duration');
        const description = interaction.options.getString('description') || '';

        // Input validation
        if (!title || title.trim().length === 0) {
          executionStatus = 'Failure';
          return interaction.editReply({ content: '❌ Meeting title cannot be empty.' });
        }

        let parsedStartTime;
        try {
          parsedStartTime = parseAndValidateDate(startTimeStr);
        } catch (err) {
          executionStatus = 'Failure';
          return interaction.editReply({ content: `❌ ${err.message}` });
        }

        if (parsedStartTime.getTime() < Date.now()) {
          executionStatus = 'Failure';
          return interaction.editReply({ content: '❌ You cannot schedule a meeting in the past.' });
        }

        if (durationMinutes <= 0) {
          executionStatus = 'Failure';
          return interaction.editReply({ content: '❌ Duration must be a positive number of minutes.' });
        }

        if (durationMinutes > 1440) {
          executionStatus = 'Failure';
          return interaction.editReply({ content: '❌ Meetings cannot be longer than 24 hours (1440 minutes).' });
        }

        const endTime = new Date(parsedStartTime.getTime() + (durationMinutes * 60 * 1000));

        logger.info(`Scheduling meeting "${title}" for guild ${guildId}`);
        
        let eventId, meetLink;
        try {
          const calendarResult = await createMeetingEvent(title, description, parsedStartTime, endTime);
          eventId = calendarResult.eventId;
          meetLink = calendarResult.meetLink;
          loggedCalendarEventId = eventId;
        } catch (err) {
          executionStatus = 'Failure';
          logger.error('Failed to create event in Google Calendar:', err);
          return interaction.editReply({ content: '❌ Failed to create Google Calendar event. Check Calendar settings or console logs.' });
        }

        const meeting = new Meeting({
          title,
          description,
          startTime: parsedStartTime,
          endTime,
          calendarEventId: eventId,
          meetLink,
          organizerId: interaction.user.id,
          creatorId: interaction.user.id,
          guildId,
          channelId: interaction.channelId,
          scheduledTime: parsedStartTime,
          remindersSent: []
        });

        try {
          await meeting.save();
          loggedMeetingId = meeting._id.toString();
        } catch (dbErr) {
          executionStatus = 'Failure';
          logger.error('Failed to save meeting to MongoDB. Cleaning up Google Calendar event...', dbErr);
          
          // Revert created Google Calendar event on DB failure to avoid orphaned events
          try {
            await deleteMeetingEvent(eventId);
            logger.info(`Orphaned Google Calendar event ${eventId} successfully cleaned up.`);
          } catch (cleanupErr) {
            logger.error(`Failed to clean up orphaned Google Calendar event ${eventId}:`, cleanupErr);
          }
          
          return interaction.editReply({ content: '❌ Database failure while storing the meeting. Calendar event was rolled back.' });
        }

        logger.info(`Successfully stored meeting ${loggedMeetingId} in database`);

        const embed = new EmbedBuilder()
          .setTitle('📅 Meeting Scheduled Successfully')
          .setDescription(description || '*No agenda specified*')
          .setColor('#9900ff')
          .addFields(
            { name: 'Meeting ID', value: `\`${loggedMeetingId}\``, inline: true },
            { name: 'Topic', value: title, inline: true },
            { name: 'Start Time', value: parsedStartTime.toLocaleString(), inline: true },
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

      // --- EDIT MEETING ---
      if (subcommand === 'edit') {
        const reqMeetingId = interaction.options.getString('meeting-id');
        loggedMeetingId = reqMeetingId;
        const newTitle = interaction.options.getString('title');
        const newStartTimeStr = interaction.options.getString('start-time');
        const newDuration = interaction.options.getInteger('duration');
        const newDescription = interaction.options.getString('description');

        // Validate Meeting ID
        if (!mongoose.Types.ObjectId.isValid(reqMeetingId)) {
          executionStatus = 'Failure';
          return interaction.editReply({ content: '❌ Invalid meeting ID format.' });
        }

        const meeting = await Meeting.findOne({ _id: reqMeetingId, guildId });
        if (!meeting) {
          executionStatus = 'Failure';
          return interaction.editReply({ content: '❌ Meeting not found.' });
        }

        // Repair document self-healing on load using schema method
        await meeting.repair(interaction.channelId);

        if (meeting.startTime.getTime() < Date.now()) {
          executionStatus = 'Failure';
          return interaction.editReply({ content: '❌ Cannot edit a meeting that has already started or completed.' });
        }

        // Validate edits
        if (newTitle !== null && newTitle !== undefined) {
          if (newTitle.trim().length === 0) {
            executionStatus = 'Failure';
            return interaction.editReply({ content: '❌ Meeting title cannot be empty.' });
          }
        } if (newDuration !== null && newDuration !== undefined) {
          if (newDuration <= 0) {
            executionStatus = 'Failure';
            return interaction.editReply({ content: '❌ Duration must be a positive number of minutes.' });
          }
          if (newDuration > 1440) {
            executionStatus = 'Failure';
            return interaction.editReply({ content: '❌ Meetings cannot be longer than 24 hours (1440 minutes).' });
          }
        }

        const oldTitle = meeting.title;
        const oldDescription = meeting.description;
        const oldStartTime = meeting.startTime;
        const oldEndTime = meeting.endTime;

        let updatedStartTime = meeting.startTime;
        if (newStartTimeStr) {
          try {
            updatedStartTime = parseAndValidateDate(newStartTimeStr);
          } catch (err) {
            executionStatus = 'Failure';
            return interaction.editReply({ content: `❌ ${err.message}` });
          }
          if (updatedStartTime.getTime() < Date.now()) {
            executionStatus = 'Failure';
            return interaction.editReply({ content: '❌ You cannot schedule a meeting in the past.' });
          }
        }

        let updatedEndTime = meeting.endTime;
        if (newDuration || newStartTimeStr) {
          const duration = newDuration || Math.round((meeting.endTime.getTime() - meeting.startTime.getTime()) / (60 * 1000));
          updatedEndTime = new Date(updatedStartTime.getTime() + (duration * 60 * 1000));
        }

        loggedCalendarEventId = meeting.calendarEventId;

        logger.info(`Editing Google Calendar event ${loggedCalendarEventId} for meeting ${meeting._id}`);
        
        // Sync Calendar edits
        if (loggedCalendarEventId) {
          try {
            await updateMeetingEvent(
              loggedCalendarEventId,
              newTitle,
              newDescription,
              newStartTimeStr ? updatedStartTime : null,
              (newDuration || newStartTimeStr) ? updatedEndTime : null
            );
          } catch (calErr) {
            executionStatus = 'Failure';
            logger.error(`Failed to update Google Calendar event ${loggedCalendarEventId}:`, calErr);
            return interaction.editReply({ content: '❌ Failed to sync updates to Google Calendar. Operations aborted.' });
          }
        }

        // Apply edits to DB
        if (newTitle) meeting.title = newTitle;
        if (newDescription !== null && newDescription !== undefined) meeting.description = newDescription;
        meeting.startTime = updatedStartTime;
        meeting.endTime = updatedEndTime;
        meeting.scheduledTime = updatedStartTime; // Sync consistency field

        // Reset reminders on time edits
        if (newStartTimeStr) {
          meeting.remindersSent = [];
        }

        try {
          await meeting.save();
          logger.info(`Successfully updated meeting ${meeting._id} in database`);
        } catch (dbErr) {
          executionStatus = 'Failure';
          logger.error(`Failed to save edited meeting ${meeting._id} to MongoDB. Rolling back Google Calendar changes...`, dbErr);
          
          // Revert Google Calendar changes
          if (loggedCalendarEventId) {
            try {
              await updateMeetingEvent(
                loggedCalendarEventId,
                oldTitle,
                oldDescription,
                oldStartTime,
                oldEndTime
              );
              logger.info(`Google Calendar changes for event ${loggedCalendarEventId} successfully rolled back.`);
            } catch (cleanupErr) {
              logger.error(`Failed to roll back Google Calendar changes for event ${loggedCalendarEventId}:`, cleanupErr);
            }
          }
          
          return interaction.editReply({ content: '❌ Database failure while updating the meeting. Calendar updates were rolled back.' });
        }

        const embed = new EmbedBuilder()
          .setTitle('📅 Meeting Updated Successfully')
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

      // --- CANCEL MEETING ---
      if (subcommand === 'cancel') {
        const reqMeetingId = interaction.options.getString('meeting-id');
        loggedMeetingId = reqMeetingId;

        // Validate Meeting ID
        if (!mongoose.Types.ObjectId.isValid(reqMeetingId)) {
          executionStatus = 'Failure';
          return interaction.editReply({ content: '❌ Invalid meeting ID format.' });
        }

        const meeting = await Meeting.findOne({ _id: reqMeetingId, guildId });
        if (!meeting) {
          executionStatus = 'Failure';
          return interaction.editReply({ content: '❌ Meeting not found.' });
        }

        loggedCalendarEventId = meeting.calendarEventId;

        // Delete from database first (transact safety)
        try {
          await Meeting.deleteOne({ _id: reqMeetingId });
          logger.info(`Meeting ${reqMeetingId} deleted from database.`);
        } catch (dbErr) {
          executionStatus = 'Failure';
          logger.error('Failed to delete meeting from database:', dbErr);
          return interaction.editReply({ content: '❌ Database failure while deleting the meeting. Operation aborted.' });
        }

        // Delete from Google Calendar (service handles 404 gracefully if already deleted manually)
        let calendarDeletionNotice = '';
        if (loggedCalendarEventId) {
          try {
            await deleteMeetingEvent(loggedCalendarEventId);
          } catch (calErr) {
            logger.error(`Google Calendar deletion failed for event ${loggedCalendarEventId} during cancellation:`, calErr);
            calendarDeletionNotice = ' ⚠️ Note: We failed to remove it from Google Calendar. Please remove it manually.';
          }
        }

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

        return interaction.editReply({ content: `✅ Meeting **${meeting.title}** has been cancelled successfully.${calendarDeletionNotice}` });
      }

      // --- LIST MEETINGS ---
      if (subcommand === 'list') {
        const upcomingOnly = interaction.options.getBoolean('upcoming') !== false;

        const query = { guildId };
        if (upcomingOnly) {
          query.startTime = { $gt: new Date() };
        }

        const meetings = await Meeting.find(query).sort({ startTime: 1 });

        if (meetings.length === 0) {
          return interaction.editReply({ content: `ℹ️ No ${upcomingOnly ? 'upcoming ' : ''}meetings scheduled.` });
        }

        // Self-heal loaded meetings in list subcommand using model's repair method
        for (const meet of meetings) {
          await meet.repair(interaction.channelId);
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
        return interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      executionStatus = 'Failure';
      logger.error('Error handling meeting command:', error);
      const errorMsg = '❌ Failed to process meeting request. Check your parameters or Calendar credentials.';
      return interaction.editReply({ content: errorMsg });
    } finally {
      // Structured Log Execution
      const executionTime = Date.now() - startTimeMetric;
      logger.info(JSON.stringify({
        logType: 'STRUCTURED_MEETING_OPERATION',
        userId: interaction.user.id,
        guildId,
        channelId: interaction.channelId,
        meetingId: loggedMeetingId || null,
        calendarEventId: loggedCalendarEventId || null,
        requestType: subcommand,
        executionTimeMs: executionTime,
        status: executionStatus
      }));
    }
  }
};
