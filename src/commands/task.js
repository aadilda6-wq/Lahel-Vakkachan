const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Task = require('../models/task');
const Team = require('../models/team');
const { getMemberPermissions } = require('../middleware/permissionHandler');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('task')
    .setDescription('Manage team tasks and deadlines')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a new task')
        .addStringOption(opt => opt.setName('title').setDescription('Task title').setRequired(true))
        .addStringOption(opt => opt.setName('deadline').setDescription('Deadline date (YYYY-MM-DD)').setRequired(true))
        .addStringOption(opt => opt.setName('description').setDescription('Task details/description'))
        .addStringOption(opt =>
          opt.setName('priority')
            .setDescription('Task priority')
            .addChoices(
              { name: 'Low', value: 'Low' },
              { name: 'Medium', value: 'Medium' },
              { name: 'High', value: 'High' },
              { name: 'Critical', value: 'Critical' }
            )
        )
        .addUserOption(opt => opt.setName('assignee-user').setDescription('Assign task to a user'))
        .addRoleOption(opt => opt.setName('assignee-role').setDescription('Assign task to a Discord role'))
        .addIntegerOption(opt =>
          opt.setName('reminder-interval')
            .setDescription('Reminder interval in days (optional)')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand(sub =>
      sub.setName('update')
        .setDescription('Update a task status, priority, or add progress note')
        .addStringOption(opt => opt.setName('task-id').setDescription('Task ID').setRequired(true).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('status')
            .setDescription('Update task status')
            .addChoices(
              { name: 'Pending', value: 'Pending' },
              { name: 'In Progress', value: 'In Progress' },
              { name: 'Completed', value: 'Completed' }
            )
        )
        .addStringOption(opt =>
          opt.setName('priority')
            .setDescription('Update task priority')
            .addChoices(
              { name: 'Low', value: 'Low' },
              { name: 'Medium', value: 'Medium' },
              { name: 'High', value: 'High' },
              { name: 'Critical', value: 'Critical' }
            )
        )
        .addStringOption(opt => opt.setName('progress-note').setDescription('Add a progress note to the task'))
        .addIntegerOption(opt =>
          opt.setName('reminder-interval')
            .setDescription('Update reminder interval in days (optional, 0 to clear)')
            .setRequired(false)
            .setMinValue(0)
        )
    )
    .addSubcommand(sub =>
      sub.setName('complete')
        .setDescription('Mark a task as completed')
        .addStringOption(opt => opt.setName('task-id').setDescription('Task ID').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View detailed information about a task')
        .addStringOption(opt => opt.setName('task-id').setDescription('Task ID').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('Delete a task')
        .addStringOption(opt => opt.setName('task-id').setDescription('Task ID').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List active server tasks')
        .addStringOption(opt =>
          opt.setName('status')
            .setDescription('Filter by status')
            .addChoices(
              { name: 'Pending', value: 'Pending' },
              { name: 'In Progress', value: 'In Progress' },
              { name: 'Completed', value: 'Completed' },
              { name: 'Overdue', value: 'Overdue' }
            )
        )
        .addStringOption(opt =>
          opt.setName('priority')
            .setDescription('Filter by priority')
            .addChoices(
              { name: 'Low', value: 'Low' },
              { name: 'Medium', value: 'Medium' },
              { name: 'High', value: 'High' },
              { name: 'Critical', value: 'Critical' }
            )
        )
        .addBooleanOption(opt => opt.setName('assigned-to-me').setDescription('Only show tasks assigned to me'))
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const guildId = interaction.guild.id;

    try {
      // Find tasks matching the autocomplete query
      const query = { guildId };
      if (focusedValue) {
        query.title = { $regex: focusedValue, $options: 'i' };
      }

      const tasks = await Task.find(query).limit(25);
      await interaction.respond(
        tasks.map(task => ({
          name: `${task.title.substring(0, 50)} [${task.priority}] (${task.status})`,
          value: task._id.toString()
        }))
      );
    } catch (error) {
      logger.error('Error during task autocomplete:', error);
    }
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const permissions = await getMemberPermissions(interaction.member);

    // Verify user is at least a member to view or list
    if (!permissions.isMember && !permissions.isLeader && !permissions.isAdmin) {
      return interaction.reply({ content: '❌ You must be registered as a Member, Leader, or Admin to access task commands.', ephemeral: true });
    }

    try {
      const settings = await Team.findOne({ guildId });

      if (subcommand === 'create') {
        // Creators must be at least Team Leaders or Admins
        if (!permissions.isLeader && !permissions.isAdmin) {
          return interaction.reply({ content: '❌ Only Team Leaders and Admins can create tasks.', ephemeral: true });
        }

        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description') || '';
        const priority = interaction.options.getString('priority') || 'Medium';
        const deadlineStr = interaction.options.getString('deadline');
        const assigneeUser = interaction.options.getUser('assignee-user');
        const assigneeRole = interaction.options.getRole('assignee-role');
        const reminderInterval = interaction.options.getInteger('reminder-interval') || null;

        const deadline = new Date(deadlineStr);
        if (isNaN(deadline.getTime())) {
          return interaction.reply({ content: '❌ Invalid deadline date format. Please use YYYY-MM-DD (e.g., 2026-08-15).', ephemeral: true });
        }

        // Set assignee
        const assignees = [];
        if (assigneeUser) {
          assignees.push({ id: assigneeUser.id, type: 'user', name: assigneeUser.username });
        }
        if (assigneeRole) {
          assignees.push({ id: assigneeRole.id, type: 'role', name: assigneeRole.name });
        }

        // If no assignee is provided, default to the task creator
        if (assignees.length === 0) {
          assignees.push({ id: interaction.user.id, type: 'user', name: interaction.user.username });
        }

        const task = new Task({
          title,
          description,
          priority,
          deadline,
          assignees,
          guildId,
          creatorId: interaction.user.id,
          reminderIntervalDays: reminderInterval,
          history: [{
            action: 'Task Created',
            performedBy: interaction.user.id,
            performedByName: interaction.user.username
          }]
        });

        await task.save();
        logger.info(`Task created in ${guildId}: ${task._id} - ${title}`);

        const embed = new EmbedBuilder()
          .setTitle('📋 New Task Assigned')
          .setDescription(description || '*No description provided*')
          .setColor('#00ff55')
          .addFields(
            { name: 'Task ID', value: `\`${task._id}\``, inline: true },
            { name: 'Priority', value: priority, inline: true },
            { name: 'Deadline', value: deadline.toDateString(), inline: true },
            { name: 'Assignee(s)', value: assignees.map(a => a.type === 'user' ? `<@${a.id}>` : `<@&${a.id}>`).join(', ') }
          )
          .setFooter({ text: `Created by ${interaction.user.username}` })
          .setTimestamp();

        // Send notification to task notification channel if configured
        if (settings && settings.taskChannelId) {
          try {
            const taskChannel = await interaction.guild.channels.fetch(settings.taskChannelId);
            if (taskChannel) {
              await taskChannel.send({ embeds: [embed] });
            }
          } catch (err) {
            logger.warn(`Failed to send task log to configured channel: ${err.message}`);
          }
        }

        return interaction.reply({ embeds: [embed] });
      }

      if (subcommand === 'update') {
        const taskId = interaction.options.getString('task-id');
        const newStatus = interaction.options.getString('status');
        const newPriority = interaction.options.getString('priority');
        const progressNote = interaction.options.getString('progress-note');
        const newReminderInterval = interaction.options.getInteger('reminder-interval');

        const task = await Task.findOne({ _id: taskId, guildId });
        if (!task) {
          return interaction.reply({ content: '❌ Task not found.', ephemeral: true });
        }

        // Check if user is allowed to update: Admin, Leader, or Assigned to this task
        const isAssigned = task.assignees.some(a => {
          if (a.type === 'user' && a.id === interaction.user.id) return true;
          if (a.type === 'role' && interaction.member.roles.cache.has(a.id)) return true;
          return false;
        });

        if (!permissions.isAdmin && !permissions.isLeader && !isAssigned) {
          return interaction.reply({ content: '❌ You do not have permissions to update this task. You must be an Admin, Team Lead, or assigned to this task.', ephemeral: true });
        }

        const changes = [];
        if (newStatus && task.status !== newStatus) {
          changes.push(`Status: ${task.status} ➔ ${newStatus}`);
          task.status = newStatus;
        }
        if (newPriority && task.priority !== newPriority) {
          changes.push(`Priority: ${task.priority} ➔ ${newPriority}`);
          task.priority = newPriority;
        }

        if (newReminderInterval !== null) {
          const oldVal = task.reminderIntervalDays;
          const newVal = newReminderInterval === 0 ? null : newReminderInterval;
          if (oldVal !== newVal) {
            changes.push(`Reminder Interval: ${oldVal ? `Every ${oldVal} days` : 'None'} ➔ ${newVal ? `Every ${newVal} days` : 'None'}`);
            task.reminderIntervalDays = newVal;
          }
        }

        if (progressNote) {
          task.progressNotes.push({
            note: progressNote,
            addedBy: interaction.user.id,
            addedByName: interaction.user.username
          });
          changes.push(`Added progress note: "${progressNote.substring(0, 30)}..."`);
        }

        if (changes.length === 0) {
          return interaction.reply({ content: '❓ No update fields were provided.', ephemeral: true });
        }

        task.history.push({
          action: `Updated: ${changes.join(', ')}`,
          performedBy: interaction.user.id,
          performedByName: interaction.user.username
        });

        await task.save();
        logger.info(`Task ${task._id} updated by ${interaction.user.username}`);

        const embed = new EmbedBuilder()
          .setTitle('🔄 Task Updated')
          .setDescription(`**${task.title}**`)
          .setColor('#ffcc00')
          .addFields(
            { name: 'Task ID', value: `\`${task._id}\``, inline: true },
            { name: 'Status', value: task.status, inline: true },
            { name: 'Priority', value: task.priority, inline: true },
            { name: 'Updates Applied', value: changes.join('\n') }
          )
          .setTimestamp();

        if (settings && settings.taskChannelId) {
          try {
            const taskChannel = await interaction.guild.channels.fetch(settings.taskChannelId);
            if (taskChannel) {
              await taskChannel.send({ embeds: [embed] });
            }
          } catch (err) {
            logger.warn(`Failed to send update notice: ${err.message}`);
          }
        }

        return interaction.reply({ embeds: [embed] });
      }

      if (subcommand === 'complete') {
        const taskId = interaction.options.getString('task-id');
        const task = await Task.findOne({ _id: taskId, guildId });
        if (!task) {
          return interaction.reply({ content: '❌ Task not found.', ephemeral: true });
        }

        const isAssigned = task.assignees.some(a => {
          if (a.type === 'user' && a.id === interaction.user.id) return true;
          if (a.type === 'role' && interaction.member.roles.cache.has(a.id)) return true;
          return false;
        });

        if (!permissions.isAdmin && !permissions.isLeader && !isAssigned) {
          return interaction.reply({ content: '❌ Only administrators, leaders, or assignees can mark this task complete.', ephemeral: true });
        }

        if (task.status === 'Completed') {
          return interaction.reply({ content: '✅ Task is already completed.', ephemeral: true });
        }

        task.status = 'Completed';
        task.history.push({
          action: 'Marked Task as Completed',
          performedBy: interaction.user.id,
          performedByName: interaction.user.username
        });

        await task.save();
        logger.info(`Task ${task._id} completed`);

        const embed = new EmbedBuilder()
          .setTitle('✅ Task Completed')
          .setDescription(`**${task.title}**`)
          .setColor('#00ff00')
          .addFields(
            { name: 'Task ID', value: `\`${task._id}\``, inline: true },
            { name: 'Completion Date', value: new Date().toDateString(), inline: true }
          )
          .setTimestamp();

        if (settings && settings.taskChannelId) {
          try {
            const taskChannel = await interaction.guild.channels.fetch(settings.taskChannelId);
            if (taskChannel) {
              await taskChannel.send({ embeds: [embed] });
            }
          } catch (err) {
            logger.warn(`Failed to send completed notice: ${err.message}`);
          }
        }

        return interaction.reply({ embeds: [embed] });
      }

      if (subcommand === 'view') {
        const taskId = interaction.options.getString('task-id');
        const task = await Task.findOne({ _id: taskId, guildId });
        if (!task) {
          return interaction.reply({ content: '❌ Task not found.', ephemeral: true });
        }

        let reminderText = 'None';
        if (task.status === 'Completed') {
          reminderText = 'No Reminders (Completed)';
        } else if (task.status === 'Overdue') {
          reminderText = 'Daily Reminder Active';
        } else if (task.reminderIntervalDays) {
          reminderText = `Every ${task.reminderIntervalDays} days`;
        }

        const embed = new EmbedBuilder()
          .setTitle(`📋 Task Details`)
          .setDescription(`**${task.title}**\n\n${task.description || '*No description*'}`)
          .setColor(task.status === 'Completed' ? '#00ff00' : (task.status === 'Overdue' ? '#ff0000' : '#0099ff'))
          .addFields(
            { name: 'Task ID', value: `\`${task._id}\``, inline: true },
            { name: 'Status', value: task.status, inline: true },
            { name: 'Priority', value: task.priority, inline: true },
            { name: 'Deadline', value: task.deadline.toDateString(), inline: true },
            { name: 'Reminder', value: reminderText, inline: true },
            { name: 'Assignee(s)', value: task.assignees.map(a => a.type === 'user' ? `<@${a.id}>` : `<@&${a.id}>`).join(', ') || 'Unassigned' }
          );

        // Add progress notes if present
        if (task.progressNotes && task.progressNotes.length > 0) {
          const notesText = task.progressNotes
            .map(n => `• **${n.addedByName}** (${n.date.toLocaleDateString()}): ${n.note}`)
            .join('\n');
          embed.addFields({ name: 'Progress Notes', value: notesText });
        }

        // Add history logs if present
        if (task.history && task.history.length > 0) {
          const historyText = task.history
            .slice(-5) // last 5 actions
            .map(h => `• ${h.date.toLocaleDateString()}: ${h.action} (by ${h.performedByName})`)
            .join('\n');
          embed.addFields({ name: 'Audit Logs (Last 5)', value: historyText });
        }

        return interaction.reply({ embeds: [embed] });
      }

      if (subcommand === 'delete') {
        // Only Admins and Leaders can delete tasks
        if (!permissions.isLeader && !permissions.isAdmin) {
          return interaction.reply({ content: '❌ Only Team Leaders and Admins can delete tasks.', ephemeral: true });
        }

        const taskId = interaction.options.getString('task-id');
        const task = await Task.findOneAndDelete({ _id: taskId, guildId });
        if (!task) {
          return interaction.reply({ content: '❌ Task not found.', ephemeral: true });
        }

        logger.info(`Task ${taskId} deleted by ${interaction.user.username}`);
        
        const embed = new EmbedBuilder()
          .setTitle('🗑️ Task Deleted')
          .setDescription(`**${task.title}**`)
          .setColor('#ff3333')
          .addFields(
            { name: 'Task ID', value: `\`${task._id}\``, inline: true },
            { name: 'Deleted By', value: `${interaction.user.username}`, inline: true }
          )
          .setTimestamp();

        if (settings && settings.taskChannelId) {
          try {
            const taskChannel = await interaction.guild.channels.fetch(settings.taskChannelId);
            if (taskChannel) {
              await taskChannel.send({ embeds: [embed] });
            }
          } catch (err) {
            logger.warn(`Failed to send delete notice: ${err.message}`);
          }
        }

        return interaction.reply({ content: `✅ Task **${task.title}** has been deleted successfully.` });
      }

      if (subcommand === 'list') {
        const filterStatus = interaction.options.getString('status');
        const filterPriority = interaction.options.getString('priority');
        const assignedToMe = interaction.options.getBoolean('assigned-to-me');

        const query = { guildId };
        if (filterStatus) query.status = filterStatus;
        if (filterPriority) query.priority = filterPriority;

        if (assignedToMe) {
          const userRoles = interaction.member.roles.cache.map(r => r.id);
          query.$or = [
            { 'assignees.id': interaction.user.id, 'assignees.type': 'user' },
            { 'assignees.id': { $in: userRoles }, 'assignees.type': 'role' }
          ];
        }

        const tasks = await Task.find(query).sort({ deadline: 1 });

        if (tasks.length === 0) {
          return interaction.reply({ content: 'ℹ️ No tasks found matching the criteria.' });
        }

        const embed = new EmbedBuilder()
          .setTitle('📋 Server Task List')
          .setColor('#00aaff')
          .setTimestamp();

        let desc = '';
        tasks.forEach((t, i) => {
          const assignText = t.assignees.map(a => a.type === 'user' ? `<@${a.id}>` : `<@&${a.id}>`).join(', ');
          const dateText = t.deadline.toLocaleDateString();
          desc += `**${i + 1}. ${t.title}** [${t.priority}] - \`${t._id}\`\n`;
          desc += `• Status: \`${t.status}\` | Deadline: \`${dateText}\`\n`;
          desc += `• Assigned to: ${assignText || 'Unassigned'}\n\n`;
        });

        // Slice to fit inside embed limits if needed
        if (desc.length > 4000) {
          desc = desc.substring(0, 3970) + '\n\n*...list truncated due to size limits.*';
        }

        embed.setDescription(desc);
        return interaction.reply({ embeds: [embed] });
      }

    } catch (error) {
      logger.error('Error executing task command:', error);
      return interaction.reply({ content: '❌ There was an error executing this command.', ephemeral: true });
    }
  }
};
