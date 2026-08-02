const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./src/config/config');
const logger = require('./src/utils/logger');

// Load command data
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

const token = config.discord.token;
const clientId = config.discord.clientId;
const guildId = config.discord.guildId;
const commandScope = (config.discord.commandScope || 'guild').toLowerCase();
const isClean = process.argv.includes('--clean');

if (commandScope === 'guild' && !guildId) {
  logger.error('CRITICAL: COMMAND_SCOPE is set to "guild" but GUILD_ID is missing in configuration.');
  process.exit(1);
}

const rest = new REST().setToken(token);

(async () => {
  try {
    if (commandScope === 'guild') {
      const route = Routes.applicationGuildCommands(clientId, guildId);

      // Fetch existing commands to determine count for logging
      let oldCommandCount = 0;
      try {
        const existing = await rest.get(route);
        if (Array.isArray(existing)) {
          oldCommandCount = existing.length;
        }
      } catch (err) {
        logger.debug(`Could not fetch existing guild commands: ${err.message}`);
      }

      logger.info('✓ Removing stale guild commands...');
      // Clean deployment deletes the current list first
      await rest.put(route, { body: [] });
      logger.info(`✓ Removed ${oldCommandCount} old commands.`);

      logger.info(`✓ Registering ${commands.length} commands...`);
      const data = await rest.put(route, { body: commands });
      logger.info(`✓ Successfully deployed ${data.length} guild commands.`);
    } else if (commandScope === 'global') {
      const route = Routes.applicationCommands(clientId);

      logger.info('✓ Removing stale global commands...');
      // Clean deployment deletes the current list first
      await rest.put(route, { body: [] });

      const data = await rest.put(route, { body: commands });
      logger.info(`✓ Successfully deployed ${data.length} global commands.`);
    } else {
      logger.error(`CRITICAL: Invalid COMMAND_SCOPE "${commandScope}". Must be "guild" or "global".`);
      process.exit(1);
    }
  } catch (error) {
    logger.error('Error occurred while deploying commands:', error);
  }
})();
