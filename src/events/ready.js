const { ActivityType } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    logger.info(`Ready! Logged in as ${client.user.tag}`);
    
    // Set modular presence activity status
    client.user.setPresence({
      activities: [{ 
        name: '/task and /meet', 
        type: ActivityType.Listening 
      }],
      status: 'online',
    });
  },
};
