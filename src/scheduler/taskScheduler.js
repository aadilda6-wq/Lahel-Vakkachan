const cron = require('node-cron');
const Task = require('../models/task');
const Team = require('../models/team');
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

function initTaskScheduler(client) {
  // Run daily at 09:00 AM server local time
  cron.schedule('0 9 * * *', async () => {
    logger.info('Starting daily Task Scheduler scan...');
    try {
      await checkTaskDeadlines(client);
    } catch (err) {
      logger.error('Error during daily Task Scheduler execution:', err);
    }
  });
  logger.info('Task Scheduler cron job registered.');
}

async function checkTaskDeadlines(client) {
  const tasks = await Task.find({ status: { $in: ['Pending', 'In Progress', 'Overdue'] } });
  const now = new Date();

  for (const task of tasks) {
    try {
      const timeDiff = task.deadline.getTime() - now.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
      
      const settings = await Team.findOne({ guildId: task.guildId });
      if (!settings) continue;

      const targetChannelId = settings.taskChannelId || settings.reportChannelId;
      if (!targetChannelId) continue;

      let channel;
      try {
        channel = await client.channels.fetch(targetChannelId);
      } catch (err) {
        logger.warn(`Could not fetch notification channel ${targetChannelId} for guild ${task.guildId}: ${err.message}`);
        continue;
      }

      if (!channel) continue;

      const mentions = task.assignees.map(a => a.type === 'user' ? `<@${a.id}>` : `<@&${a.id}>`).join(' ');

      // 1. Overdue Task (Deadline passed)
      if (daysDiff < 0) {
        let statusChanged = false;
        if (task.status !== 'Overdue') {
          task.status = 'Overdue';
          task.history.push({
            action: 'Status updated to Overdue by System',
            performedBy: 'System',
            performedByName: 'Scheduler'
          });
          await task.save();
          statusChanged = true;
        }

        // Gather leader/admin mentions for escalation pings
        let escalationMentions = '';
        if (settings.leaderRoles && settings.leaderRoles.length > 0) {
          escalationMentions += settings.leaderRoles.map(id => `<@&${id}>`).join(' ') + ' ';
        }
        if (settings.adminRoles && settings.adminRoles.length > 0) {
          escalationMentions += settings.adminRoles.map(id => `<@&${id}>`).join(' ');
        }

        const embed = new EmbedBuilder()
          .setTitle('🚨 Task Overdue Escalation Alert')
          .setDescription(`The task **"${task.title}"** has missed its deadline of **${task.deadline.toDateString()}** and remains incomplete.`)
          .setColor('#ff0000')
          .addFields(
            { name: 'Task ID', value: `\`${task._id}\``, inline: true },
            { name: 'Priority', value: task.priority, inline: true },
            { name: 'Assignees', value: mentions || 'Unassigned' }
          )
          .setTimestamp();

        // Ping assignees for daily warning, and escalate to leads/admins
        await channel.send({
          content: `🚨 **Overdue Task Alert** ${mentions}\n⚡ **Escalation Notification** ${escalationMentions}`,
          embeds: [embed]
        });

        logger.info(`Escalated overdue task ${task._id} to guild ${task.guildId}`);
      }

      // 2. Upcoming Task Reminder (2 days before deadline or even numbers of days, e.g., 4, 2 days remaining)
      else if (daysDiff > 0 && daysDiff % 2 === 0) {
        const embed = new EmbedBuilder()
          .setTitle('⏰ Task Deadline Approaching')
          .setDescription(`Reminder: The task **"${task.title}"** is due in **${daysDiff} days** on **${task.deadline.toDateString()}**.`)
          .setColor('#ffaa00')
          .addFields(
            { name: 'Task ID', value: `\`${task._id}\``, inline: true },
            { name: 'Priority', value: task.priority, inline: true },
            { name: 'Assignees', value: mentions || 'Unassigned' }
          )
          .setTimestamp();

        await channel.send({
          content: `⏰ **Task Reminder** ${mentions}`,
          embeds: [embed]
        });

        logger.info(`Sent upcoming reminder for task ${task._id} (${daysDiff} days left) in guild ${task.guildId}`);
      }

    } catch (err) {
      logger.error(`Error processing scheduler check for task ${task._id}:`, err);
    }
  }
}

module.exports = { initTaskScheduler };
