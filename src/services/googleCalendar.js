const { google } = require('googleapis');
const config = require('../config/config');
const logger = require('../utils/logger');

let calendar = null;

if (config.google.email && config.google.privateKey) {
  try {
    const auth = new google.auth.JWT(
      config.google.email,
      null,
      config.google.privateKey,
      ['https://www.googleapis.com/auth/calendar']
    );
    calendar = google.calendar({ version: 'v3', auth });
    logger.info('Google Calendar service initialized successfully.');
  } catch (error) {
    logger.error('Failed to initialize Google Calendar API service:', error);
  }
} else {
  logger.warn('Google Calendar credentials not fully configured. Calendar features will operate in mock mode.');
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
  if (!calendar) {
    logger.warn('Google Calendar API not configured. Returning mock meeting links.');
    const mockId = 'mock-' + Math.random().toString(36).substring(2, 11);
    const mockLink = `https://meet.google.com/abc-${mockId.substring(0, 4)}-xyz`;
    return {
      eventId: mockId,
      meetLink: mockLink
    };
  }

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
    const response = await calendar.events.insert({
      calendarId: config.google.calendarId,
      resource: event,
      conferenceDataVersion: 1,
    });

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

    // Default fallback link if no Meet link was generated
    if (!meetLink) {
      meetLink = `https://calendar.google.com/calendar/r/eventedit?eid=${Buffer.from(eventId).toString('base64')}`;
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
 * @param {string} eventId Event identifier
 * @returns {Promise<boolean>} Success status
 */
async function deleteMeetingEvent(eventId) {
  if (!calendar) {
    logger.warn('Google Calendar API not configured. Mock delete operation succeeded.');
    return true;
  }

  if (eventId.startsWith('mock-')) {
    logger.info(`Mock meeting deletion handled for ${eventId}`);
    return true;
  }

  try {
    await calendar.events.delete({
      calendarId: config.google.calendarId,
      eventId: eventId,
    });
    logger.info(`Deleted Google Calendar event. Event ID: ${eventId}`);
    return true;
  } catch (error) {
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
  if (!calendar) {
    logger.warn('Google Calendar API not configured. Mock update operation succeeded.');
    return true;
  }

  if (eventId.startsWith('mock-')) {
    logger.info(`Mock meeting update handled for ${eventId}`);
    return true;
  }

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
    await calendar.events.patch({
      calendarId: config.google.calendarId,
      eventId: eventId,
      resource: resource,
    });
    logger.info(`Updated Google Calendar event. Event ID: ${eventId}`);
    return true;
  } catch (error) {
    logger.error(`Error updating Google Calendar event ${eventId}:`, error);
    throw error;
  }
}

module.exports = {
  createMeetingEvent,
  deleteMeetingEvent,
  updateMeetingEvent
};
