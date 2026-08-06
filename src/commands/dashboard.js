const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Task = require('../models/task');
const Meeting = require('../models/meeting');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Display team dashboard metrics, upcoming deadlines, and today\'s meetings'),

  async execute(interaction) {
    const guildId = interaction.guild.id;

    try {
      // 1. Task counts
      const pendingCount = await Task.countDocuments({ guildId, status: 'Pending' });
      const inProgressCount = await Task.countDocuments({ guildId, status: 'In Progress' });
      const completedCount = await Task.countDocuments({ guildId, status: 'Completed' });
      const overdueCount = await Task.countDocuments({ guildId, status: 'Overdue' });

      // 2. Today's meetings
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);

      // 3. Upcoming deadlines in next 7 days (not completed)
      const next7Days = new Date();
      next7Days.setDate(next7Days.getDate() + 7);

      // Run read-only MongoDB queries concurrently with lean() optimization
      const [todaysMeetings, highPriorityTasks, upcomingTasks] = await Promise.all([
        Meeting.find({
          guildId,
          startTime: { $gte: startOfToday, $lte: endOfToday }
        }).sort({ startTime: 1 }).lean(),
        Task.find({
          guildId,
          priority: { $in: ['High', 'Critical'] },
          status: { $in: ['Pending', 'In Progress', 'Overdue'] }
        }).limit(5).lean(),
        Task.find({
          guildId,
          status: { $in: ['Pending', 'In Progress'] },
          deadline: { $gte: new Date(), $lte: next7Days }
        }).sort({ deadline: 1 }).limit(5).lean()
      ]);

      const embed = new EmbedBuilder()
        .setTitle('📊 Team Activity & Metrics Dashboard')
        .setColor('#00ffcc')
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }) || null)
        .setDescription(`Overview of community activities for server **${interaction.guild.name}**.`)
        .addFields(
          { 
            name: '📈 Task Summary', 
            value: `• ⌛ **Pending**: ${pendingCount}\n• ⚙️ **In Progress**: ${inProgressCount}\n• ✅ **Completed**: ${completedCount}\n• ⚠️ **Overdue**: ${overdueCount}`, 
            inline: false 
          }
        )
        .setTimestamp();

      // Today's Meetings section
      let meetingsText = '';
      if (todaysMeetings.length === 0) {
        meetingsText = '*No meetings scheduled for today.*';
      } else {
        todaysMeetings.forEach((m, idx) => {
          const timeStr = m.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          meetingsText += `**${idx + 1}. ${m.title}**\n• Time: \`${timeStr}\` | [Join Meet](${m.meetLink})\n`;
        });
      }
      embed.addFields({ name: '📅 Today\'s Schedule', value: meetingsText, inline: false });

      // Critical/High priority alerts
      let priorityText = '';
      if (highPriorityTasks.length === 0) {
        priorityText = '*No high-priority tasks pending.*';
      } else {
        highPriorityTasks.forEach(t => {
          const badge = t.priority === 'Critical' ? '🚨' : '🔥';
          let reminderInfo = '';
          if (t.status === 'Overdue') {
            reminderInfo = ' | 🔔 *Daily Reminder Active*';
          } else if (t.reminderIntervalDays) {
            reminderInfo = ` | 🔔 *Every ${t.reminderIntervalDays} days*`;
          }
          priorityText += `${badge} **${t.title}** (${t.status})${reminderInfo} | Dead: \`${t.deadline.toLocaleDateString()}\`\n`;
        });
      }
      embed.addFields({ name: '⚠️ High Priority & Critical Alerts', value: priorityText, inline: false });

      // Upcoming deadlines
      let upcomingText = '';
      if (upcomingTasks.length === 0) {
        upcomingText = '*No upcoming deadlines within next 7 days.*';
      } else {
        upcomingTasks.forEach(t => {
          const daysLeft = Math.ceil((t.deadline - new Date()) / (1000 * 60 * 60 * 24));
          let reminderInfo = '';
          if (t.status === 'Overdue') {
            reminderInfo = ' | 🔔 *Daily Reminder Active*';
          } else if (t.reminderIntervalDays) {
            reminderInfo = ` | 🔔 *Every ${t.reminderIntervalDays} days*`;
          }
          upcomingText += `• **${t.title}** - due in \`${daysLeft} days\` (${t.deadline.toLocaleDateString()})${reminderInfo}\n`;
        });
      }
      embed.addFields({ name: '⏳ Upcoming Deadlines (Next 7 Days)', value: upcomingText, inline: false });

      return interaction.reply({ embeds: [embed] });

    } catch (error) {
      logger.error('Error fetching dashboard statistics:', error);
      return interaction.reply({ content: '❌ There was an error compiling dashboard metrics.', ephemeral: true });
    }
  }
};
