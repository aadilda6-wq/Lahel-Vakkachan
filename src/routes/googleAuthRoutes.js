const express = require('express');
const { generateAuthorizationUrl, exchangeCodeForTokens } = require('../services/googleAuth');
const { getSuccessHtml, getErrorHtml } = require('../utils/oauthHtml');
const logger = require('../utils/logger');
const router = express.Router();

/**
 * GET /auth/google
 * Redirects the browser to the Google authorization URL.
 */
router.get('/google', (req, res) => {
  try {
    const url = generateAuthorizationUrl();
    res.redirect(url);
  } catch (err) {
    res.status(500).send(getErrorHtml(err.message));
  }
});

/**
 * Reusable OAuth 2.0 callback handler.
 * Validates the request, exchanges the authorization code for tokens, logs details,
 * and sends the styled success response containing the refresh token.
 */
async function handleOAuth2Callback(req, res) {
  const code = req.query.code;
  const errorQuery = req.query.error;

  // Handle callback errors from Google
  if (errorQuery) {
    logger.error(`Google OAuth Callback returned an error: ${errorQuery}`);
    return res.status(400).send(getErrorHtml(errorQuery));
  }

  // Ensure authorization code is present
  if (!code) {
    logger.error('Google OAuth Callback reached without authorization code.');
    return res.status(400).send(getErrorHtml('No authorization code provided.'));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const refreshToken = tokens.refresh_token;

    // Handle missing refresh token (occurs if already authorized, requiring access revocation)
    if (!refreshToken) {
      logger.error('Google OAuth successful, but no refresh token returned.');
      return res.status(400).send(getErrorHtml('No refresh token returned. If you have already authorized this app, please revoke its access at https://myaccount.google.com/connections first, then try again.'));
    }

    // Required logging statements
    logger.info('Authorization successful.');
    logger.info('Refresh token obtained.');
    
    // Log the refresh token once in the console/terminal immediately after authorization if not already configured
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      console.log(`[GOOGLE_REFRESH_TOKEN] = ${refreshToken}`);
    }

    res.send(getSuccessHtml(refreshToken));
  } catch (err) {
    logger.error('Failed to exchange Google OAuth code for tokens: %O', err);
    res.status(500).send(getErrorHtml(err.message));
  }
}

// GET /auth/oauth2callback
router.get('/oauth2callback', handleOAuth2Callback);

module.exports = {
  router,
  handleOAuth2Callback
};
