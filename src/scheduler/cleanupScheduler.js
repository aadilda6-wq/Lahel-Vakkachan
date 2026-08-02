const cron = require('node-cron');
const { runDatabaseCleanup } = require('../services/databaseCleanup');
const logger = require('../utils/logger');

function initCleanupScheduler() {
  // Run daily at 03:00 AM server local time
  cron.schedule('0 3 * * *', async () => {
    logger.info('Starting daily Database Cleanup execution...');
    try {
      await runDatabaseCleanup();
    } catch (err) {
      logger.error('Error during daily Database Cleanup execution:', err);
    }
  });
  logger.info('Database Cleanup Scheduler cron job registered.');
}

module.exports = { initCleanupScheduler };
