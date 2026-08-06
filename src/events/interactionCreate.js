const logger = require('../utils/logger');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // 1. Handle Slash commands
    if (interaction.isChatInputCommand()) {
      // Central DM verification guard to prevent bot crashes
      if (!interaction.inGuild()) {
        return interaction.reply({ 
          content: '❌ Commands can only be used within a Discord server (guild).', 
          ephemeral: true 
        });
      }

      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        logger.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      const startTime = Date.now();
      let status = 'Success';

      try {
        logger.info(`Running command ${interaction.commandName} for user ${interaction.user.tag} in guild ${interaction.guildId}`);
        await command.execute(interaction);
      } catch (error) {
        status = 'Failure';
        logger.error(`Error executing ${interaction.commandName}:`, error);
        
        try {
          if (interaction.deferred) {
            await interaction.editReply({
              content: "❌ There was an error while executing this command."
            });
          } else if (interaction.replied) {
            await interaction.followUp({
              content: "❌ There was an error while executing this command.",
              ephemeral: true
            });
          } else {
            await interaction.reply({
              content: "❌ There was an error while executing this command.",
              ephemeral: true
            });
          }
        } catch (err) {
          logger.error('Failed to send error response interaction:', err);
        }
      } finally {
        const executionTime = Date.now() - startTime;
        let subcommand = '';
        try {
          subcommand = interaction.options.getSubcommand(false) || '';
        } catch {
          // ignore if no subcommands option supported/configured
        }
        const actionName = subcommand ? `${interaction.commandName} ${subcommand}` : interaction.commandName;

        // Structured JSON log for operation audit
        logger.info(JSON.stringify({
          logType: 'STRUCTURED_INTERACTION',
          guildId: interaction.guildId || null,
          userId: interaction.user.id,
          channelId: interaction.channelId || null,
          action: actionName,
          executionTimeMs: executionTime,
          status: status
        }));
      }
    }
    
    // 2. Handle Autocomplete requests
    else if (interaction.isAutocomplete()) {
      if (!interaction.inGuild()) {
        return;
      }

      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        logger.error(`No command matching ${interaction.commandName} was found for autocomplete.`);
        return;
      }

      try {
        if (command.autocomplete) {
          await command.autocomplete(interaction);
        }
      } catch (error) {
        logger.error(`Error executing autocomplete for ${interaction.commandName}:`, error);
      }
    }
  },
};
