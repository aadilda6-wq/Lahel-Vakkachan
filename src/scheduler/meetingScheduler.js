const cron = require('node-cron');
const Meeting = require('../models/meeting');
const Team = require('../models/team');
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');



let isMeetingSchedulerRunning = false;

function initMeetingScheduler(client) {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    if (isMeetingSchedulerRunning) {
      logger.warn('Meeting Scheduler run skipped: previous run still in progress.');
      return;
    }
    isMeetingSchedulerRunning = true;
    try {
      await checkMeetingReminders(client);
    } catch (err) {
      logger.error('Error during meeting scheduler execution:', err);
    } finally {
      isMeetingSchedulerRunning = false;
    }
  });
  logger.info('Meeting Scheduler cron job registered.');
}

async function checkMeetingReminders(client) {
  const now = new Date();
  const startExecTime = Date.now();
  
  // Find meetings starting in the future, up to 24 hours from now (leveraging startTime index)
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  let meetings;
  try {
    meetings = await Meeting.find({ 
      startTime: { $gt: now, $lte: tomorrow } 
    });
  } catch (dbErr) {
    logger.error('Error fetching meetings for reminders from MongoDB:', dbErr);
    return;
  }

  for (const meeting of meetings) {
    let operationStatus = 'Success';
    let alertSentType = 'none';
    
    try {
      const settings = await Team.findOne({ guildId: meeting.guildId });
      const targetChannelId = settings ? (settings.meetingChannelId || settings.reportChannelId) : null;
      
      // Auto-repair missing consistency fields dynamically
      await meeting.repair(targetChannelId);

      const diffMs = meeting.startTime.getTime() - now.getTime();
      const diffMins = diffMs / (1000 * 60); // Difference in minutes

      let sendAlert = false;
      let alertLabel = '';
      let reminderCode = '';

      // Check hierarchy boundaries cleanly to prevent overlapping alerts
      if (diffMins <= 10) {
        if (!meeting.remindersSent.includes('10m')) {
          sendAlert = true;
          alertLabel = '10 minutes';
          reminderCode = '10m';
          alertSentType = '10m';
        }
      } else if (diffMins <= 60) {
        if (!meeting.remindersSent.includes('1h')) {
          sendAlert = true;
          alertLabel = '1 hour';
          reminderCode = '1h';
          alertSentType = '1h';
        }
      } else if (diffMins <= 1440) {
        if (!meeting.remindersSent.includes('1d')) {
          sendAlert = true;
          alertLabel = '1 day';
          reminderCode = '1d';
          alertSentType = '1d';
        }
      }

      if (sendAlert) {
        if (!settings) {
          logger.warn(`No team settings found for guild ${meeting.guildId} when processing reminder.`);
          continue;
        }
        if (!targetChannelId) {
          logger.warn(`No target channel configured for reminders in guild ${meeting.guildId}`);
          continue;
        }

        let channel;
        try {
          channel = await client.channels.fetch(targetChannelId);
        } catch (err) {
          logger.warn(`Could not fetch notification channel ${targetChannelId} for guild ${meeting.guildId}: ${err.message}`);
          continue;
        }

        if (!channel) {
          logger.warn(`Channel ${targetChannelId} was fetched but resolves to null/undefined`);
          continue;
        }

        const embed = new EmbedBuilder()
          .setTitle(`📅 Meeting starting in ${alertLabel}!`)
          .setDescription(`**${meeting.title}**\n${meeting.description || '*No agenda specified*'}`)
          .setColor('#9900ff')
          .addFields(
            { name: 'Time', value: meeting.startTime.toLocaleString(), inline: true },
            { name: 'Organizer', value: `<@${meeting.organizerId}>`, inline: true },
            { name: 'Meeting Link', value: `🌐 [Join Google Meet](${meeting.meetLink})` }
          )
          .setTimestamp();

        // Broadcast alert
        await channel.send({
          content: `🔔 **Upcoming Meeting Reminder (${alertLabel} before start)**`,
          embeds: [embed]
        });

        // Prevent reminder from repeating
        meeting.remindersSent.push(reminderCode);
        await meeting.save();

        logger.info(`Sent ${alertLabel} reminder for meeting "${meeting.title}" (${meeting._id})`);
      }
    } catch (err) {
      operationStatus = 'Failure';
      logger.error(`Error processing meeting reminder for ${meeting._id}:`, err);
    } finally {
      // Send structured logs if a reminder alert attempt was processed
      if (alertSentType !== 'none') {
        logger.info(JSON.stringify({
          logType: 'STRUCTURED_MEETING_REMINDER',
          guildId: meeting.guildId,
          channelId: meeting.channelId || null,
          meetingId: meeting._id.toString(),
          calendarEventId: meeting.calendarEventId || null,
          reminderType: alertSentType,
          executionTimeMs: Date.now() - startExecTime,
          status: operationStatus
        }));
      }
    }
  }
}

module.exports = { initMeetingScheduler };
