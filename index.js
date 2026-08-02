const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./src/config/config');
const { connectDatabase } = require('./src/database/database');
const { initTaskScheduler } = require('./src/scheduler/taskScheduler');
const { initMeetingScheduler } = require('./src/scheduler/meetingScheduler');
const { initReportScheduler } = require('./src/scheduler/reportScheduler');
const logger = require('./src/utils/logger');

// Initialize Discord client with correct intents (Guilds only to avoid disallowed intents error)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

client.commands = new Collection();

// Load Slash Commands
const commandsPath = path.join(__dirname, 'src/commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    logger.warn(`The command at ${filePath} is missing a required "data" or "execute" property.`);
  }
}

// Load Event Listeners
const eventsPath = path.join(__dirname, 'src/events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
}

// Initialize database, schedulers, and login
(async () => {
  try {
    // 1. Connect MongoDB
    await connectDatabase();

    // 2. Start Schedulers
    initTaskScheduler(client);
    initMeetingScheduler(client);
    initReportScheduler(client);

    // 3. Start a dummy HTTP server for health checks on Render/Railway if PORT is provided
    const port = config.app.port || process.env.PORT;
    if (port) {
      const http = require('http');
      http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Lahel Vakkachan Bot is running successfully.\n');
      }).listen(port, () => {
        logger.info(`Health check HTTP server is listening on port ${port}`);
      });
    }

    // 4. Login Bot to Discord Gateway
    if (!config.discord.token) {
      logger.error('CRITICAL: DISCORD_TOKEN is missing in the configuration. Bot cannot start.');
      process.exit(1);
    }
    
    await client.login(config.discord.token);
  } catch (error) {
    logger.error('Fatal initialization error:', error);
    process.exit(1);
  }
})();
