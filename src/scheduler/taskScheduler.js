const cron = require('node-cron');
const Task = require('../models/task');
const Team = require('../models/team');
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

function initTaskScheduler(client) {
  // Run every minute server local time to evaluate reminder intervals
  cron.schedule('* * * * *', async () => {
    try {
      await checkTaskReminders(client);
    } catch (err) {
      logger.error('Error during minutely Task Scheduler execution:', err);
    }
  });
  logger.info('Task Scheduler cron job registered.');
}

async function checkTaskReminders(client) {
  const now = new Date();
  
  // Fetch active tasks leveraging status index
  const tasks = await Task.find({ 
    status: { $in: ['Pending', 'In Progress', 'Overdue'] } 
  });

  for (const task of tasks) {
    try {
      const isOverdue = task.deadline.getTime() < now.getTime();
      let shouldSend = false;

      if (isOverdue) {
        // Overdue reminders are sent once every 24 hours
        const lastSent = task.lastReminderSent || task.deadline;
        const nextTime = new Date(lastSent.getTime() + 24 * 60 * 60 * 1000);
        if (now >= nextTime) {
          shouldSend = true;
        }
      } else {
        // Active task reminder sent at the configured interval
        if (task.reminderIntervalDays) {
          const lastSent = task.lastReminderSent || task.createdAt;
          const nextTime = new Date(lastSent.getTime() + task.reminderIntervalDays * 24 * 60 * 60 * 1000);
          if (now >= nextTime) {
            shouldSend = true;
          }
        }
      }

      if (shouldSend) {
        const sentSuccessfully = await sendTaskReminderEmbed(client, task, isOverdue);
        if (sentSuccessfully) {
          task.lastReminderSent = now;
          // Dynamically escalate status to Overdue if it passes the deadline
          if (isOverdue && task.status !== 'Overdue') {
            task.status = 'Overdue';
            task.history.push({
              action: 'Status updated to Overdue by System',
              performedBy: 'System',
              performedByName: 'Scheduler'
            });
          }
          await task.save();
        }
      }
    } catch (err) {
      logger.error(`Error processing task reminder for task ${task._id}:`, err);
    }
  }
}

async function sendTaskReminderEmbed(client, task, isOverdue) {
  const settings = await Team.findOne({ guildId: task.guildId });
  if (!settings) return false;

  const targetChannelId = settings.taskChannelId || settings.reportChannelId;
  if (!targetChannelId) return false;

  let channel;
  try {
    channel = await client.channels.fetch(targetChannelId);
  } catch (err) {
    logger.warn(`Could not fetch notification channel ${targetChannelId} for guild ${task.guildId}: ${err.message}`);
    return false;
  }
  if (!channel) return false;

  const mentions = task.assignees.map(a => a.type === 'user' ? `<@${a.id}>` : `<@&${a.id}>`).join(' ');
  const deadlineUnix = Math.floor(task.deadline.getTime() / 1000);
  const now = new Date();

  const embed = new EmbedBuilder();

  if (isOverdue) {
    const diffMs = now.getTime() - task.deadline.getTime();
    const daysOverdue = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    embed.setTitle('🔴 OVERDUE TASK')
      .setColor('#ff0000')
      .addFields(
        { name: 'Task', value: task.title },
        { name: 'Assigned To', value: mentions || 'Unassigned' },
        { name: 'Status', value: task.status, inline: true },
        { name: 'Deadline', value: `<t:${deadlineUnix}:F>`, inline: true },
        { name: 'Overdue By', value: `${daysOverdue} days`, inline: true }
      )
      .setDescription('This reminder is sent every day until the task is completed.')
      .setTimestamp();
  } else {
    embed.setTitle('🔔 Task Reminder')
      .setColor('#ffaa00')
      .addFields(
        { name: 'Task', value: task.title },
        { name: 'Assigned To', value: mentions || 'Unassigned' },
        { name: 'Status', value: task.status, inline: true },
        { name: 'Reminder Interval', value: `Every ${task.reminderIntervalDays} days`, inline: true },
        { name: 'Deadline', value: `<t:${deadlineUnix}:F>`, inline: true },
        { name: 'Remaining', value: `<t:${deadlineUnix}:R>`, inline: true }
      )
      .setTimestamp();
  }

  try {
    await channel.send({
      content: isOverdue ? `🚨 **Overdue Task Reminder** ${mentions}` : `🔔 **Task Reminder** ${mentions}`,
      embeds: [embed]
    });
    logger.info(`Sent reminder for task ${task._id} (overdue: ${isOverdue}) in guild ${task.guildId}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send reminder message for task ${task._id}: ${err.message}`);
    return false;
  }
}

module.exports = { initTaskScheduler };
