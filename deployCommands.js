const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./src/config/config');
const logger = require('./src/utils/logger');

const commands = [];
const commandsPath = path.join(__dirname, 'src/commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  } else {
    logger.warn(`The command at ${filePath} is missing a required "data" or "execute" property.`);
  }
}

// Check configuration
if (!config.discord.token || !config.discord.clientId) {
  logger.error('CRITICAL: Missing DISCORD_TOKEN or CLIENT_ID in configuration. Exiting command deployment.');
  process.exit(1);
}

const rest = new REST().setToken(config.discord.token);

(async () => {
  try {
    logger.info(`Started refreshing ${commands.length} application (/) commands.`);

    if (config.discord.guildId) {
      logger.info(`Deploying commands locally to Guild ID: ${config.discord.guildId}`);
      const data = await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commands },
      );
      logger.info(`Successfully reloaded ${data.length} guild application (/) commands.`);
    } else {
      logger.info('Deploying commands globally to Discord (may take up to 1 hour to register globally)...');
      const data = await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commands },
      );
      logger.info(`Successfully reloaded ${data.length} global application (/) commands.`);
    }
  } catch (error) {
    logger.error('Error occurred while deploying commands:', error);
  }
})();
