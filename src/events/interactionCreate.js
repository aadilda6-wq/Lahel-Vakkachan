const logger = require('../utils/logger');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // 1. Handle Slash commands
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        logger.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        logger.info(`Running command ${interaction.commandName} for user ${interaction.user.tag} in guild ${interaction.guildId}`);
        await command.execute(interaction);
      } catch (error) {
        logger.error(`Error executing ${interaction.commandName}:`, error);
        
        const responseMsg = '❌ There was an error while executing this command!';
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: responseMsg, ephemeral: true });
        } else {
          await interaction.reply({ content: responseMsg, ephemeral: true });
        }
      }
    }
    
    // 2. Handle Autocomplete requests
    else if (interaction.isAutocomplete()) {
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
