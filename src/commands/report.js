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
          { name: 'Team Stats', value: 'Stats' }
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

      // If we are doing Stats, we can calculate overall metrics
      if (type === 'Stats') {
        const totalTasks = await Task.countDocuments({ guildId });
        const completedTasks = await Task.countDocuments({ guildId, status: 'Completed' });
        const pendingTasks = await Task.countDocuments({ guildId, status: 'Pending' });
        const inProgressTasks = await Task.countDocuments({ guildId, status: 'In Progress' });
        const overdueTasks = await Task.countDocuments({ guildId, status: 'Overdue' });

        const completionRate = totalTasks > 0 ? ((completedCount = completedTasks / totalTasks) * 100).toFixed(1) : 0;

        // Fetch productivity per member (Completed tasks count)
        const allCompleted = await Task.find({ guildId, status: 'Completed' });
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
      // Fetch tasks completed during the duration
      const completedThisPeriod = await Task.countDocuments({
        guildId,
        status: 'Completed',
        updatedAt: { $gte: startDate }
      });

      // Fetch tasks created during the duration
      const createdThisPeriod = await Task.find({
        guildId,
        createdAt: { $gte: startDate }
      });

      // Fetch currently overdue tasks
      const overdueTasks = await Task.find({
        guildId,
        status: 'Overdue'
      });

      // Fetch meetings scheduled during this period
      const meetingsThisPeriod = await Meeting.find({
        guildId,
        startTime: { $gte: startDate }
      }).sort({ startTime: 1 });

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
