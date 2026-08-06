const { google } = require('googleapis');
const logger = require('../utils/logger');

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI;

let oauth2Client = null;

if (clientId && clientSecret && redirectUri) {
  oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  logger.info('Google OAuth initialized.');
} else {
  logger.warn('Google OAuth 2.0 client credentials (Client ID, Client Secret, Redirect URI) are not fully configured.');
}

/**
 * Generates the Google OAuth 2.0 authorization URL.
 * @returns {string} The authorization URL
 */
function generateAuthorizationUrl() {
  if (!oauth2Client) {
    throw new Error('Google OAuth credentials are not fully configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in your environment variables.');
  }

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
    redirect_uri: process.env.GOOGLE_REDIRECT_URI
  });

  logger.info('Authorization URL generated.');
  return url;
}

/**
 * Exchanges an authorization code for tokens.
 * @param {string} code The authorization code from the redirect callback
 * @returns {Promise<object>} The tokens object containing access and refresh tokens
 */
async function exchangeCodeForTokens(code) {
  if (!oauth2Client) {
    throw new Error('Google OAuth client is not initialized.');
  }
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

module.exports = {
  generateAuthorizationUrl,
  exchangeCodeForTokens
};
