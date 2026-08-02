const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Team = require('../models/team');
const { getMemberPermissions } = require('../middleware/permissionHandler');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Configure and manage teams and roles')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Set up global bot roles and announcement channels')
        .addRoleOption(opt => opt.setName('admin-role').setDescription('Role for bot administrators').setRequired(true))
        .addRoleOption(opt => opt.setName('leader-role').setDescription('Role for team leaders').setRequired(true))
        .addRoleOption(opt => opt.setName('member-role').setDescription('Role for members').setRequired(true))
        .addChannelOption(opt => opt.setName('task-channel').setDescription('Channel for task notifications'))
        .addChannelOption(opt => opt.setName('meeting-channel').setDescription('Channel for meeting scheduling updates'))
        .addChannelOption(opt => opt.setName('report-channel').setDescription('Channel for scheduled reports'))
    )
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a sub-team unit')
        .addStringOption(opt => opt.setName('name').setDescription('Name of the team').setRequired(true))
        .addUserOption(opt => opt.setName('leader').setDescription('Leader of this team').setRequired(true))
        .addRoleOption(opt => opt.setName('role').setDescription('Discord Role matching this team'))
    )
    .addSubcommand(sub =>
      sub.setName('add-member')
        .setDescription('Add a member to a sub-team')
        .addStringOption(opt => opt.setName('team-name').setDescription('Name of the team').setRequired(true))
        .addUserOption(opt => opt.setName('user').setDescription('User to add').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('remove-member')
        .setDescription('Remove a member from a sub-team')
        .addStringOption(opt => opt.setName('team-name').setDescription('Name of the team').setRequired(true))
        .addUserOption(opt => opt.setName('user').setDescription('User to remove').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('Show configuration and sub-teams info')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const permissions = await getMemberPermissions(interaction.member);

    // Only Admins can run setup and create
    if ((subcommand === 'setup' || subcommand === 'create') && !permissions.isAdmin) {
      return interaction.reply({ content: '❌ You must have administrator permissions to run this command.', ephemeral: true });
    }

    // Leaders or Admins can modify members
    if ((subcommand === 'add-member' || subcommand === 'remove-member') && !permissions.isLeader) {
      return interaction.reply({ content: '❌ You must be a Team Leader or Admin to modify team members.', ephemeral: true });
    }

    try {
      let settings = await Team.findOne({ guildId });

      if (subcommand === 'setup') {
        const adminRole = interaction.options.getRole('admin-role');
        const leaderRole = interaction.options.getRole('leader-role');
        const memberRole = interaction.options.getRole('member-role');
        const taskChannel = interaction.options.getChannel('task-channel');
        const meetingChannel = interaction.options.getChannel('meeting-channel');
        const reportChannel = interaction.options.getChannel('report-channel');

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

        const embed = new EmbedBuilder()
          .setTitle('⚙️ Server Configuration Completed')
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
      }

      // Check if setup was already run before executing other subcommands
      if (!settings && subcommand !== 'info') {
        return interaction.reply({ content: '❌ The server settings have not been configured yet. Please run `/team setup` first.', ephemeral: true });
      }

      if (subcommand === 'create') {
        const teamName = interaction.options.getString('name');
        const leader = interaction.options.getUser('leader');
        const role = interaction.options.getRole('role');

        // Check if team already exists
        const exists = settings.teams.some(t => t.name.toLowerCase() === teamName.toLowerCase());
        if (exists) {
          return interaction.reply({ content: `❌ A sub-team named "${teamName}" already exists.`, ephemeral: true });
        }

        settings.teams.push({
          name: teamName,
          leaderId: leader.id,
          members: [leader.id], // Leader is added as initial member
          roleId: role ? role.id : null
        });

        await settings.save();
        logger.info(`Sub-team created in guild ${guildId}: ${teamName}`);

        return interaction.reply({ content: `✅ Sub-team **${teamName}** created successfully! Leader: ${leader}. ${role ? `Role mapping: ${role}` : ''}` });
      }

      if (subcommand === 'add-member') {
        const teamName = interaction.options.getString('team-name');
        const user = interaction.options.getUser('user');

        const team = settings.teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());
        if (!team) {
          return interaction.reply({ content: `❌ Sub-team "${teamName}" not found.`, ephemeral: true });
        }

        // Check permissions: if leader, must be leader of this specific team or admin
        if (!permissions.isAdmin && team.leaderId !== interaction.user.id) {
          return interaction.reply({ content: `❌ You can only add members to your own team (${team.name}).`, ephemeral: true });
        }

        if (team.members.includes(user.id)) {
          return interaction.reply({ content: `❌ ${user} is already a member of **${team.name}**.`, ephemeral: true });
        }

        team.members.push(user.id);
        await settings.save();

        // Optionally, assign Discord role if mapped
        if (team.roleId) {
          try {
            const member = await interaction.guild.members.fetch(user.id);
            await member.roles.add(team.roleId);
          } catch (err) {
            logger.warn(`Failed to add role ${team.roleId} to user ${user.id}: ${err.message}`);
          }
        }

        return interaction.reply({ content: `✅ Added ${user} to sub-team **${team.name}**.` });
      }

      if (subcommand === 'remove-member') {
        const teamName = interaction.options.getString('team-name');
        const user = interaction.options.getUser('user');

        const team = settings.teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());
        if (!team) {
          return interaction.reply({ content: `❌ Sub-team "${teamName}" not found.`, ephemeral: true });
        }

        // Check permissions: if leader, must be leader of this specific team or admin
        if (!permissions.isAdmin && team.leaderId !== interaction.user.id) {
          return interaction.reply({ content: `❌ You can only remove members from your own team (${team.name}).`, ephemeral: true });
        }

        if (!team.members.includes(user.id)) {
          return interaction.reply({ content: `❌ ${user} is not a member of **${team.name}**.`, ephemeral: true });
        }

        // Prevent removing the leader from membership this way
        if (user.id === team.leaderId) {
          return interaction.reply({ content: `❌ Cannot remove the Team Leader (${user}) from the team. Change the leader instead.`, ephemeral: true });
        }

        team.members = team.members.filter(id => id !== user.id);
        await settings.save();

        // Optionally, remove Discord role if mapped
        if (team.roleId) {
          try {
            const member = await interaction.guild.members.fetch(user.id);
            await member.roles.remove(team.roleId);
          } catch (err) {
            logger.warn(`Failed to remove role ${team.roleId} from user ${user.id}: ${err.message}`);
          }
        }

        return interaction.reply({ content: `✅ Removed ${user} from sub-team **${team.name}**.` });
      }

      if (subcommand === 'info') {
        if (!settings) {
          return interaction.reply({ content: '⚙️ No team settings configured yet. Run `/team setup` to configure.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setTitle('📋 Server Teams & Configuration')
          .setColor('#0099ff')
          .setTimestamp();

        let desc = `**Role Mappings:**\n`;
        desc += `• Admin Roles: ${settings.adminRoles.map(id => `<@&${id}>`).join(', ') || 'None'}\n`;
        desc += `• Leader Roles: ${settings.leaderRoles.map(id => `<@&${id}>`).join(', ') || 'None'}\n`;
        desc += `• Member Roles: ${settings.memberRoles.map(id => `<@&${id}>`).join(', ') || 'None'}\n\n`;

        desc += `**Announcement Channels:**\n`;
        desc += `• Tasks: ${settings.taskChannelId ? `<#${settings.taskChannelId}>` : 'None'}\n`;
        desc += `• Meetings: ${settings.meetingChannelId ? `<#${settings.meetingChannelId}>` : 'None'}\n`;
        desc += `• Reports: ${settings.reportChannelId ? `<#${settings.reportChannelId}>` : 'None'}\n\n`;

        desc += `**Sub-Teams Unit (${settings.teams.length}):**\n`;
        if (settings.teams.length === 0) {
          desc += `*No sub-teams created yet.*`;
        } else {
          settings.teams.forEach(t => {
            desc += `• **${t.name}**: Lead by <@${t.leaderId}> | Role: ${t.roleId ? `<@&${t.roleId}>` : 'None'} | Members: ${t.members.length}\n`;
          });
        }

        embed.setDescription(desc);
        return interaction.reply({ embeds: [embed] });
      }

    } catch (error) {
      logger.error('Error handling team command:', error);
      return interaction.reply({ content: '❌ There was an error executing this command.', ephemeral: true });
    }
  }
};
