const cron = require('node-cron');
const Team = require('../models/team');
const Task = require('../models/task');
const Meeting = require('../models/meeting');
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

function initReportScheduler(client) {
  // 1. Daily Report (Monday - Friday at 18:00)
  cron.schedule('0 18 * * 1-5', async () => {
    logger.info('Scheduled Cron: Generating Daily Reports...');
    try {
      await generateAutomatedReports(client, 'Daily');
    } catch (err) {
      logger.error('Error generating scheduled Daily Reports:', err);
    }
  });

  // 2. Weekly Report (Fridays at 17:00)
  cron.schedule('0 17 * * 5', async () => {
    logger.info('Scheduled Cron: Generating Weekly Reports...');
    try {
      await generateAutomatedReports(client, 'Weekly');
    } catch (err) {
      logger.error('Error generating scheduled Weekly Reports:', err);
    }
  });

  // 3. Monthly Report (1st day of every month at 09:00)
  cron.schedule('0 9 1 * *', async () => {
    logger.info('Scheduled Cron: Generating Monthly Reports...');
    try {
      await generateAutomatedReports(client, 'Monthly');
    } catch (err) {
      logger.error('Error generating scheduled Monthly Reports:', err);
    }
  });

  logger.info('Report Scheduler cron jobs registered.');
}

async function generateAutomatedReports(client, type) {
  // Find all guilds that have configured report channels
  const settingsList = await Team.find({ reportChannelId: { $ne: null } });

  for (const settings of settingsList) {
    try {
      const guild = await client.guilds.fetch(settings.guildId);
      if (!guild) continue;

      const channel = await guild.channels.fetch(settings.reportChannelId);
      if (!channel) continue;

      const now = new Date();
      let startDate = new Date();

      if (type === 'Daily') {
        startDate.setHours(0, 0, 0, 0);
      } else if (type === 'Weekly') {
        startDate.setDate(now.getDate() - 7);
      } else if (type === 'Monthly') {
        startDate.setMonth(now.getMonth() - 1);
      }

      const guildId = settings.guildId;

      // 1. Tasks completed during this period
      const completedCount = await Task.countDocuments({
        guildId,
        status: 'Completed',
        updatedAt: { $gte: startDate }
      });

      // 2. Tasks registered during this period
      const createdTasks = await Task.find({
        guildId,
        createdAt: { $gte: startDate }
      });

      // 3. Current overdue tasks
      const overdueCount = await Task.countDocuments({
        guildId,
        status: 'Overdue'
      });

      // 4. Meetings schedule during this period
      const meetings = await Meeting.find({
        guildId,
        startTime: { $gte: startDate }
      }).sort({ startTime: 1 });

      const embed = new EmbedBuilder()
        .setTitle(`📊 Scheduled ${type} Activity Report`)
        .setColor(type === 'Daily' ? '#00bfff' : (type === 'Weekly' ? '#32cd32' : '#ff8c00'))
        .setDescription(`Automated team review for server **${guild.name}** since **${startDate.toLocaleDateString()}**.`)
        .addFields(
          { 
            name: '📋 Task Metrics', 
            value: `• Created Tasks: **${createdTasks.length}**\n• Completed Tasks: **${completedCount}**\n• Active Overdue Tasks: **${overdueCount}**` 
          }
        )
        .setTimestamp();

      // Show list of new tasks if any
      if (createdTasks.length > 0) {
        let taskListText = createdTasks.slice(0, 5).map(t => `• **${t.title}** (${t.priority}) | Status: \`${t.status}\``).join('\n');
        if (createdTasks.length > 5) {
          taskListText += `\n*...and ${createdTasks.length - 5} more tasks.*`;
        }
        embed.addFields({ name: '🆕 Newly Created Tasks', value: taskListText });
      }

      // Show list of meetings if any
      if (meetings.length > 0) {
        let meetText = meetings.slice(0, 5).map(m => `• **${m.title}** (${m.startTime.toLocaleDateString()} at ${m.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`).join('\n');
        if (meetings.length > 5) {
          meetText += `\n*...and ${meetings.length - 5} more meetings.*`;
        }
        embed.addFields({ name: '📅 Meetings Held', value: meetText });
      }

      await channel.send({
        content: `📊 **Automated ${type} Team Summary Report**`,
        embeds: [embed]
      });

      logger.info(`Scheduled ${type} report dispatched to guild ${guildId}`);

    } catch (err) {
      logger.error(`Error generating automated ${type} report for guild ${settings.guildId}:`, err);
    }
  }
}

module.exports = { initReportScheduler };
