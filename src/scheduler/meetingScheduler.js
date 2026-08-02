const cron = require('node-cron');
const Meeting = require('../models/meeting');
const Team = require('../models/team');
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

function initMeetingScheduler(client) {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      await checkMeetingReminders(client);
    } catch (err) {
      logger.error('Error during meeting scheduler execution:', err);
    }
  });
  logger.info('Meeting Scheduler cron job registered.');
}

async function checkMeetingReminders(client) {
  const now = new Date();
  
  // Find meetings starting in the future
  // Find meetings starting in the future, up to 24 hours from now (leveraging startTime index)
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const meetings = await Meeting.find({ 
    startTime: { $gt: now, $lte: tomorrow } 
  });

  for (const meeting of meetings) {
    try {
      const diffMs = meeting.startTime.getTime() - now.getTime();
      const diffMins = diffMs / (1000 * 60); // Difference in minutes

      let sendAlert = false;
      let alertLabel = '';
      let reminderCode = '';

      // Check hierarchy: 10m -> 1h -> 1d
      if (diffMins <= 10 && !meeting.remindersSent.includes('10m')) {
        sendAlert = true;
        alertLabel = '10 minutes';
        reminderCode = '10m';
      } else if (diffMins <= 60 && !meeting.remindersSent.includes('1h')) {
        sendAlert = true;
        alertLabel = '1 hour';
        reminderCode = '1h';
      } else if (diffMins <= 1440 && !meeting.remindersSent.includes('1d')) {
        sendAlert = true;
        alertLabel = '1 day';
        reminderCode = '1d';
      }

      if (sendAlert) {
        const settings = await Team.findOne({ guildId: meeting.guildId });
        if (!settings) continue;

        const targetChannelId = settings.meetingChannelId || settings.reportChannelId;
        if (!targetChannelId) continue;

        let channel;
        try {
          channel = await client.channels.fetch(targetChannelId);
        } catch (err) {
          logger.warn(`Could not fetch notification channel ${targetChannelId} for guild ${meeting.guildId}: ${err.message}`);
          continue;
        }

        if (!channel) continue;

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

        // Broadcast to channel
        await channel.send({
          content: `🔔 **Upcoming Meeting Reminder (${alertLabel} before start)**`,
          embeds: [embed]
        });

        // Track that this reminder was sent to prevent repetition
        meeting.remindersSent.push(reminderCode);
        await meeting.save();

        logger.info(`Sent ${alertLabel} reminder for meeting "${meeting.title}" (${meeting._id})`);
      }
    } catch (err) {
      logger.error(`Error processing meeting reminder for ${meeting._id}:`, err);
    }
  }
}

module.exports = { initMeetingScheduler };
