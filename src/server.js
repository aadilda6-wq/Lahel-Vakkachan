const express = require('express');
const logger = require('./utils/logger');
const { router: googleAuthRoutes } = require('./routes/googleAuthRoutes');

const app = express();
const port = process.env.PORT || 3000;

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Lahel Vakkachan Bot is running successfully.');
});

// Register Google OAuth routes under /auth prefix
app.use('/auth', googleAuthRoutes);
logger.info('Google OAuth routes registered.');

// Start the Express server
app.listen(port, () => {
  logger.info('Express server started.');
  logger.info(`Listening on port ${port}.`);
});

module.exports = app;
