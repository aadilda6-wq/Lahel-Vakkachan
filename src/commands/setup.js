const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Team = require('../models/team');
const { getMemberPermissions } = require('../middleware/permissionHandler');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set up global bot roles and announcement channels for this server')
    .addRoleOption(opt => opt.setName('admin-role').setDescription('Role for bot administrators').setRequired(true))
    .addRoleOption(opt => opt.setName('leader-role').setDescription('Role for team leaders').setRequired(true))
    .addRoleOption(opt => opt.setName('member-role').setDescription('Role for members').setRequired(true))
    .addChannelOption(opt => opt.setName('task-channel').setDescription('Channel for task notifications'))
    .addChannelOption(opt => opt.setName('meeting-channel').setDescription('Channel for meeting scheduling updates'))
    .addChannelOption(opt => opt.setName('report-channel').setDescription('Channel for scheduled reports')),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const permissions = await getMemberPermissions(interaction.member);

    // Only administrators (or guild owner) can run this setup command
    if (!permissions.isAdmin) {
      return interaction.reply({ 
        content: '❌ You must have administrator permissions to run this setup command.', 
        ephemeral: true 
      });
    }

    try {
      const adminRole = interaction.options.getRole('admin-role');
      const leaderRole = interaction.options.getRole('leader-role');
      const memberRole = interaction.options.getRole('member-role');
      const taskChannel = interaction.options.getChannel('task-channel');
      const meetingChannel = interaction.options.getChannel('meeting-channel');
      const reportChannel = interaction.options.getChannel('report-channel');

      let settings = await Team.findOne({ guildId });

      if (!settings) {
        settings = new Team({ guildId });
      }

      settings.adminRoles = [adminRole.id];
      settings.leaderRoles = [leaderRole.id];
      settings.memberRoles = [memberRole.id];
      
      if (taskChannel) settings.taskChannelId = taskChannel.id;
      if (meetingChannel) settings.meetingChannelId = meetingChannel.id;
      if (reportChannel) settings.reportChannelId = reportChannel.id;

      await settings.save();
      logger.info(`Server setup completed for guild ${guildId}`);

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Server Configuration Completed')
        .setDescription('Server settings have been saved successfully to the database.')
        .setColor('#00ffcc')
        .addFields(
          { name: 'Admin Role', value: `${adminRole}`, inline: true },
          { name: 'Leader Role', value: `${leaderRole}`, inline: true },
          { name: 'Member Role', value: `${memberRole}`, inline: true },
          { name: 'Task Notifications', value: taskChannel ? `${taskChannel}` : 'None', inline: true },
          { name: 'Meeting Notifications', value: meetingChannel ? `${meetingChannel}` : 'None', inline: true },
          { name: 'Reports Channel', value: reportChannel ? `${reportChannel}` : 'None', inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });

    } catch (error) {
      logger.error('Error handling setup command:', error);
      return interaction.reply({ 
        content: '❌ There was an error saving settings to the database.', 
        ephemeral: true 
      });
    }
  }
};
