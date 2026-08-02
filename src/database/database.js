const mongoose = require('mongoose');
const config = require('../config/config');
const logger = require('../utils/logger');

async function connectDatabase() {
  try {
    await mongoose.connect(config.mongodb.uri);
    logger.info('Connected successfully to MongoDB database.');
  } catch (error) {
    logger.error('Failed to connect to MongoDB database:', error);
    process.exit(1);
  }
}

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB connection disconnected.');
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB connection error: ${err}`);
});

module.exports = { connectDatabase };
