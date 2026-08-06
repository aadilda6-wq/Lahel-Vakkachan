const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Task = require('../models/task');
const Meeting = require('../models/meeting');
const Team = require('../models/team');
const { getMemberPermissions } = require('../middleware/permissionHandler');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Generate on-demand productivity and task summary reports')
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Select the type of report to generate')
        .setRequired(true)
        .addChoices(
          { name: 'Daily Summary', value: 'Daily' },
          { name: 'Weekly Productivity', value: 'Weekly' },
          { name: 'Monthly Review', value: 'Monthly' },
          { name: 'Team Stats', value: 'Stats' },
          { name: 'Task Status Report', value: 'Status' }
        )
    ),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const type = interaction.options.getString('type');
    const permissions = await getMemberPermissions(interaction.member);

    // Only leaders and admins can execute reports on-demand
    if (!permissions.isLeader && !permissions.isAdmin) {
      return interaction.reply({ content: '❌ Only Team Leaders and Admins can generate reports.', ephemeral: true });
    }

    try {
      const now = new Date();
      let startDate;

      if (type === 'Daily') {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
      } else if (type === 'Weekly') {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
      } else if (type === 'Monthly') {
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
      }

      // If we are doing Status, generate the Task Status Report
      if (type === 'Status') {
        const embed = await generateTaskStatusReportEmbed(guildId);
        
        // Send to report channel if configured
        const settings = await Team.findOne({ guildId });
        if (settings && settings.reportChannelId) {
          try {
            const reportChannel = await interaction.guild.channels.fetch(settings.reportChannelId);
            if (reportChannel) {
              await reportChannel.send({ embeds: [embed] });
            }
          } catch (err) {
            logger.warn(`Failed to send report to configured reports channel: ${err.message}`);
          }
        }

        return interaction.reply({ embeds: [embed] });
      }

      // If we are doing Stats, we can calculate overall metrics
      if (type === 'Stats') {
        const [totalTasks, completedTasks, pendingTasks, inProgressTasks, overdueTasks] = await Promise.all([
          Task.countDocuments({ guildId }),
          Task.countDocuments({ guildId, status: 'Completed' }),
          Task.countDocuments({ guildId, status: 'Pending' }),
          Task.countDocuments({ guildId, status: 'In Progress' }),
          Task.countDocuments({ guildId, status: 'Overdue' })
        ]);

        const completionRate = totalTasks > 0 ? ((completedTasks / totalTasks) * 100).toFixed(1) : 0;

        // Fetch productivity per member (Completed tasks count)
        const allCompleted = await Task.find({ guildId, status: 'Completed' }).lean();
        const contributorStats = {};
        allCompleted.forEach(t => {
          t.assignees.forEach(a => {
            contributorStats[a.name || a.id] = (contributorStats[a.name || a.id] || 0) + 1;
          });
        });

        const sortedContributors = Object.entries(contributorStats)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        let contributorsText = '';
        if (sortedContributors.length === 0) {
          contributorsText = '*No tasks completed yet.*';
        } else {
          sortedContributors.forEach(([name, count], index) => {
            contributorsText += `${index + 1}. **${name}**: ${count} tasks completed\n`;
          });
        }

        const embed = new EmbedBuilder()
          .setTitle('📈 Overall Team Productivity Statistics')
          .setColor('#00ff77')
          .setThumbnail(interaction.guild.iconURL({ dynamic: true }) || null)
          .addFields(
            { name: '📊 General Task Performance', value: `• Total Tasks: **${totalTasks}**\n• Completed: **${completedTasks}** (${completionRate}%)\n• In Progress: **${inProgressTasks}**\n• Pending: **${pendingTasks}**\n• Overdue: **${overdueTasks}**` },
            { name: '🏆 Top Contributors', value: contributorsText }
          )
          .setTimestamp();

        return interaction.reply({ embeds: [embed] });
      }

      // For Daily/Weekly/Monthly reports:
      // Fetch tasks and meetings concurrently using lean() for read-only document lists
      const [completedThisPeriod, createdThisPeriod, overdueTasks, meetingsThisPeriod] = await Promise.all([
        Task.countDocuments({
          guildId,
          status: 'Completed',
          updatedAt: { $gte: startDate }
        }),
        Task.find({
          guildId,
          createdAt: { $gte: startDate }
        }).lean(),
        Task.find({
          guildId,
          status: 'Overdue'
        }).lean(),
        Meeting.find({
          guildId,
          startTime: { $gte: startDate }
        }).sort({ startTime: 1 }).lean()
      ]);

      const embed = new EmbedBuilder()
        .setTitle(`📊 On-Demand ${type} Report Summary`)
        .setColor('#ffff00')
        .setDescription(`Activity summary since **${startDate.toLocaleDateString()}**.`)
        .addFields(
          { 
            name: '📋 Task Milestones', 
            value: `• Created Tasks: **${createdThisPeriod.length}**\n• Completed Tasks: **${completedThisPeriod}**\n• Current Overdue Tasks: **${overdueTasks.length}**` 
          }
        )
        .setTimestamp();

      // Created tasks list
      if (createdThisPeriod.length > 0) {
        let taskListText = createdThisPeriod.slice(0, 5).map(t => `• **${t.title}** (${t.priority}) | Status: \`${t.status}\``).join('\n');
        if (createdThisPeriod.length > 5) taskListText += `\n*...and ${createdThisPeriod.length - 5} more tasks.*`;
        embed.addFields({ name: '🆕 Newly Registered Tasks (Top 5)', value: taskListText });
      } else {
        embed.addFields({ name: '🆕 Newly Registered Tasks', value: '*No tasks registered during this period.*' });
      }

      // Meetings list
      if (meetingsThisPeriod.length > 0) {
        let meetText = meetingsThisPeriod.slice(0, 5).map(m => `• **${m.title}** (${m.startTime.toLocaleDateString()})`).join('\n');
        if (meetingsThisPeriod.length > 5) meetText += `\n*...and ${meetingsThisPeriod.length - 5} more meetings.*`;
        embed.addFields({ name: '📅 Meetings Held (Top 5)', value: meetText });
      } else {
        embed.addFields({ name: '📅 Meetings Held', value: '*No meetings occurred during this period.*' });
      }

      // Overdue warning
      if (overdueTasks.length > 0) {
        let overdueText = overdueTasks.slice(0, 5).map(t => {
          const assignText = t.assignees.map(a => a.name || a.id).join(', ');
          return `• **${t.title}** (Assigned: ${assignText || 'None'})`;
        }).join('\n');
        if (overdueTasks.length > 5) overdueText += `\n*...and ${overdueTasks.length - 5} more overdue tasks.*`;
        embed.addFields({ name: '🚨 Overdue Escalation Warnings (Top 5)', value: overdueText });
      }

      // Send to report channel if configured
      const settings = await Team.findOne({ guildId });
      if (settings && settings.reportChannelId) {
        try {
          const reportChannel = await interaction.guild.channels.fetch(settings.reportChannelId);
          if (reportChannel) {
            await reportChannel.send({ embeds: [embed] });
          }
        } catch (err) {
          logger.warn(`Failed to send report to configured reports channel: ${err.message}`);
        }
      }

      return interaction.reply({ embeds: [embed] });

    } catch (error) {
      logger.error('Error generating report:', error);
      return interaction.reply({ content: '❌ There was an error compiling this report.', ephemeral: true });
    }
  }
};

async function getCompletedTasks(guildId) {
  return await Task.find({
    guildId,
    status: 'Completed'
  }).sort({ updatedAt: -1 }).lean();
}

async function getPendingTasks(guildId, now = new Date()) {
  return await Task.find({
    guildId,
    status: 'Pending',
    deadline: { $gte: now }
  }).sort({ deadline: 1 }).lean();
}

async function getInProgressTasks(guildId, now = new Date()) {
  return await Task.find({
    guildId,
    status: 'In Progress',
    deadline: { $gte: now }
  }).sort({ deadline: 1 }).lean();
}

async function getOverdueTasks(guildId, now = new Date()) {
  return await Task.find({
    guildId,
    status: { $ne: 'Completed' },
    deadline: { $lt: now }
  }).sort({ deadline: 1 }).lean();
}

async function generateTaskStatusReportEmbed(guildId) {
  const now = new Date();
  const completed = await getCompletedTasks(guildId);
  const pending = await getPendingTasks(guildId, now);
  const inProgress = await getInProgressTasks(guildId, now);
  const overdue = await getOverdueTasks(guildId, now);

  const total = completed.length + pending.length + inProgress.length + overdue.length;
  
  let completedPct = 0;
  let pendingPct = 0;
  let inProgressPct = 0;
  let overduePct = 0;
  let completionRate = 0;

  if (total > 0) {
    completedPct = Math.round((completed.length / total) * 100);
    pendingPct = Math.round((pending.length / total) * 100);
    inProgressPct = Math.round((inProgress.length / total) * 100);
    overduePct = Math.round((overdue.length / total) * 100);
    completionRate = completedPct;
  }

  const embed = new EmbedBuilder()
    .setTitle('📋 Task Status Report')
    .setColor('#00ff77')
    .setDescription('━━━━━━━━━━━━━━━━━━━━')
    .addFields(
      {
        name: '📊 Summary',
        value: `Total Tasks: **${total}**\n` +
          `✅ Completed: **${completed.length}** (${completedPct}%)\n` +
          `🟡 Pending: **${pending.length}** (${pendingPct}%)\n` +
          `🔵 In Progress: **${inProgress.length}** (${inProgressPct}%)\n` +
          `🔴 Overdue: **${overdue.length}** (${overduePct}%)\n\n` +
          `Completion Rate: **${completionRate}%**`
      },
      {
        name: '\u200B',
        value: '━━━━━━━━━━━━━━━━━━━━'
      }
    )
    .setTimestamp();

  const getAssigneesText = (task) => {
    if (!task.assignees || task.assignees.length === 0) return 'Unassigned';
    return task.assignees.map(a => a.type === 'user' ? `<@${a.id}>` : `<@&${a.id}>`).join(', ');
  };

  // 1. Completed Tasks Section
  let completedText = '';
  if (completed.length === 0) {
    completedText = 'No completed tasks.';
  } else {
    const list = completed.slice(0, 10);
    completedText = list.map(t => {
      const compAction = t.history
        .filter(h => h.action.includes('Completed'))
        .sort((a, b) => b.date - a.date)[0];
      const completedBy = compAction ? (compAction.performedByName || `<@${compAction.performedBy}>`) : 'Unknown';
      const compDate = compAction ? compAction.date : t.updatedAt;
      const dateStr = compDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      return `• **${t.title}**\n👤 ${completedBy}\n✔ Completed on: ${dateStr}\nReason: Task marked as Completed.`;
    }).join('\n\n');

    if (completed.length > 10) {
      completedText += `\n\n*...and ${completed.length - 10} more*`;
    }
  }
  embed.addFields(
    { name: `✅ Completed (${completed.length})`, value: completedText },
    { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━' }
  );

  // 2. Pending Tasks Section
  let pendingText = '';
  if (pending.length === 0) {
    pendingText = 'No pending tasks.';
  } else {
    const list = pending.slice(0, 10);
    pendingText = list.map(t => {
      const unix = Math.floor(t.deadline.getTime() / 1000);
      const intervalText = t.reminderIntervalDays ? `Every ${t.reminderIntervalDays} days` : 'None';
      const lastSentText = t.lastReminderSent ? `<t:${Math.floor(t.lastReminderSent.getTime() / 1000)}:R>` : 'Never';
      return `• **${t.title}**\n👤 ${getAssigneesText(t)}\n📅 Due: <t:${unix}:d> (<t:${unix}:R>)\n🔔 Reminder Interval: ${intervalText}\n⏮ Last Sent: ${lastSentText}\nReason: Task has not been started yet.`;
    }).join('\n\n');

    if (pending.length > 10) {
      pendingText += `\n\n*...and ${pending.length - 10} more*`;
    }
  }
  embed.addFields(
    { name: `🟡 Pending (${pending.length})`, value: pendingText },
    { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━' }
  );

  // 3. In Progress Tasks Section
  let inProgressText = '';
  if (inProgress.length === 0) {
    inProgressText = 'No tasks in progress.';
  } else {
    const list = inProgress.slice(0, 10);
    inProgressText = list.map(t => {
      const unix = Math.floor(t.deadline.getTime() / 1000);
      const intervalText = t.reminderIntervalDays ? `Every ${t.reminderIntervalDays} days` : 'None';
      const lastSentText = t.lastReminderSent ? `<t:${Math.floor(t.lastReminderSent.getTime() / 1000)}:R>` : 'Never';
      return `• **${t.title}**\n👤 ${getAssigneesText(t)}\n📅 Due: <t:${unix}:d> (<t:${unix}:R>)\n🔔 Reminder Interval: ${intervalText}\n⏮ Last Sent: ${lastSentText}\nReason: Work has started but is not yet finished.`;
    }).join('\n\n');

    if (inProgress.length > 10) {
      inProgressText += `\n\n*...and ${inProgress.length - 10} more*`;
    }
  }
  embed.addFields(
    { name: `🔵 In Progress (${inProgress.length})`, value: inProgressText },
    { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━' }
  );

  // 4. Overdue Tasks Section
  let overdueText = '';
  if (overdue.length === 0) {
    overdueText = 'No overdue tasks.';
  } else {
    const list = overdue.slice(0, 10);
    overdueText = list.map(t => {
      const unix = Math.floor(t.deadline.getTime() / 1000);
      const diffMs = now.getTime() - t.deadline.getTime();
      const overdueDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      const lastSentText = t.lastReminderSent ? `<t:${Math.floor(t.lastReminderSent.getTime() / 1000)}:R>` : 'Never';
      return `• **${t.title}**\n👤 ${getAssigneesText(t)}\n❗ Due: <t:${unix}:d> (<t:${unix}:R>)\n📅 Overdue: ${overdueDays} days\n⏮ Last Sent: ${lastSentText}\nReason: Deadline has passed and the task is still incomplete.`;
    }).join('\n\n');

    if (overdue.length > 10) {
      overdueText += `\n\n*...and ${overdue.length - 10} more*`;
    }
  }
  embed.addFields(
    { name: `🔴 Overdue (${overdue.length})`, value: overdueText },
    { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━' }
  );

  return embed;
}

module.exports = {
  data: module.exports.data,
  execute: module.exports.execute,
  getCompletedTasks,
  getPendingTasks,
  getInProgressTasks,
  getOverdueTasks,
  generateTaskStatusReportEmbed
};
