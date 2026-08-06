require('dotenv').config();

const requiredEnv = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'MONGODB_URI'
];

// Verify required env variables are present
const missing = requiredEnv.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`CRITICAL CONFIG ERROR: Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    commandScope: process.env.COMMAND_SCOPE || 'guild'
  },
  mongodb: {
    uri: process.env.MONGODB_URI
  },
  google: {
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary'
  },
  app: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development'
  }
};
