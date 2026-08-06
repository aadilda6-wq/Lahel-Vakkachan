const { google } = require('googleapis');
const logger = require('../utils/logger');

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI;
const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

let calendar = null;

if (clientId && clientSecret && redirectUri && refreshToken) {
  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    logger.info('Google Calendar service initialized successfully using OAuth 2.0.');
  } catch (error) {
    logger.error('Failed to initialize Google Calendar API service:', error);
  }
} else {
  logger.warn('Google Calendar OAuth credentials are not fully configured in environment variables.');
}

/**
 * Checks if the Google Calendar service is initialized. Throws an error if not.
 */
function checkCalendarInitialized() {
  if (!calendar) {
    throw new Error('Google Calendar OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN) are missing or invalid.');
  }
}

/**
 * Helper to retry transient Google API call errors with exponential backoff.
 * Retries up to `attempts` times, starting with `delay` ms wait.
 */
async function retryWithBackoff(fn, attempts = 3, delay = 1000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      const statusCode = error.code || (error.response && error.response.status);
      
      // Check if it's a transient rate limit error (status 429, or status 403 with Google's rateLimitExceeded reason)
      let isRateLimit = statusCode === 429;
      if (statusCode === 403 && error.errors && error.errors.length > 0) {
        const reason = error.errors[0].reason;
        if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
          isRateLimit = true;
        }
      }

      // Do not retry general client-side 4xx errors as they are permanent
      if (statusCode && statusCode >= 400 && statusCode < 500 && !isRateLimit) {
        throw error;
      }

      if (i === attempts) {
        throw error;
      }

      logger.warn(`Google Calendar API call failed (attempt ${i}/${attempts}). Retrying in ${delay}ms... Error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

/**
 * Creates a Google Calendar event with a Google Meet videoconference link.
 * @param {string} title Meeting title
 * @param {string} description Meeting description
 * @param {Date} startTime Meeting start time
 * @param {Date} endTime Meeting end time
 * @returns {Promise<{eventId: string, meetLink: string}>} Event details
 */
async function createMeetingEvent(title, description, startTime, endTime) {
  checkCalendarInitialized();

  const event = {
    summary: title,
    description: description,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: 'UTC',
    },
    conferenceData: {
      createRequest: {
        requestId: `meet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        conferenceSolutionKey: {
          type: 'hangoutsMeet'
        }
      }
    }
  };

  try {
    const response = await retryWithBackoff(() => calendar.events.insert({
      calendarId: calendarId,
      resource: event,
      conferenceDataVersion: 1,
    }));

    const eventId = response.data.id;
    let meetLink = response.data.hangoutLink;

    // Check entryPoints if hangoutLink is not directly returned
    if (!meetLink && response.data.conferenceData && response.data.conferenceData.entryPoints) {
      const videoEntry = response.data.conferenceData.entryPoints.find(
        ep => ep.entryPointType === 'video'
      );
      if (videoEntry) {
        meetLink = videoEntry.uri;
      }
    }

    if (!meetLink) {
      throw new Error('Google Calendar event created successfully, but no Google Meet videoconference link was returned.');
    }

    logger.info(`Successfully created Google Calendar event. Event ID: ${eventId}, Link: ${meetLink}`);
    return {
      eventId,
      meetLink
    };
  } catch (error) {
    logger.error('Error creating Google Calendar event:', error);
    throw error;
  }
}

/**
 * Deletes a Google Calendar event.
 * Handles 404 Not Found error gracefully if the event was already deleted externally.
 * @param {string} eventId Event identifier
 * @returns {Promise<boolean>} Success status
 */
async function deleteMeetingEvent(eventId) {
  checkCalendarInitialized();

  try {
    // Verify the event actually exists before deletion
    await retryWithBackoff(() => calendar.events.get({
      calendarId: calendarId,
      eventId: eventId
    }));

    await retryWithBackoff(() => calendar.events.delete({
      calendarId: calendarId,
      eventId: eventId,
    }));
    logger.info(`Deleted Google Calendar event. Event ID: ${eventId}`);
    return true;
  } catch (error) {
    const statusCode = error.code || (error.response && error.response.status);
    if (statusCode === 404) {
      logger.warn(`Google Calendar event ${eventId} was not found (already deleted). Proceeding with database cleanup.`);
      return true;
    }

    console.error("--- Google API Deletion Error ---");
    console.error("Calendar ID:", calendarId);
    console.error("Event ID:", eventId);
    // Secure logging: only print the error response data payload to avoid exposing tokens or config secrets in headers
    console.error("Full Google API error response:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    console.error("HTTP status code:", statusCode);
    console.error("Error message:", error.message);
    console.error("Stack trace:", error.stack);
    console.error("---------------------------------");

    logger.error(`Error deleting Google Calendar event ${eventId}:`, error);
    throw error;
  }
}

/**
 * Updates an existing Google Calendar event.
 * @param {string} eventId Event identifier
 * @param {string} title New meeting title (optional)
 * @param {string} description New meeting description (optional)
 * @param {Date} startTime New start time (optional)
 * @param {Date} endTime New end time (optional)
 * @returns {Promise<boolean>} Success status
 */
async function updateMeetingEvent(eventId, title, description, startTime, endTime) {
  checkCalendarInitialized();

  const resource = {};
  if (title) resource.summary = title;
  if (description) resource.description = description;
  if (startTime) {
    resource.start = {
      dateTime: startTime.toISOString(),
      timeZone: 'UTC',
    };
  }
  if (endTime) {
    resource.end = {
      dateTime: endTime.toISOString(),
      timeZone: 'UTC',
    };
  }

  try {
    await retryWithBackoff(() => calendar.events.patch({
      calendarId: calendarId,
      eventId: eventId,
      resource: resource,
    }));
    logger.info(`Updated Google Calendar event. Event ID: ${eventId}`);
    return true;
  } catch (error) {
    logger.error(`Error updating Google Calendar event ${eventId}:`, error);
    throw error;
  }
}

/**
 * Verifies if the calendar service has working API access.
 */
async function verifyCalendarAccess() {
  checkCalendarInitialized();
  await retryWithBackoff(() => calendar.events.list({
    calendarId: calendarId,
    maxResults: 1
  }));
  return true;
}

/**
 * Checks if the calendar client has been successfully initialized.
 */
function isInitialized() {
  return calendar !== null;
}

module.exports = {
  createMeetingEvent,
  deleteMeetingEvent,
  updateMeetingEvent,
  verifyCalendarAccess,
  isInitialized
};
