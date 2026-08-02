const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  calendarEventId: {
    type: String,
    default: null
  },
  meetLink: {
    type: String,
    default: null
  },
  organizerId: {
    type: String,
    required: true
  },
  guildId: {
    type: String,
    required: true,
    index: true
  },
  remindersSent: {
    type: [String], // Array of strings: '1d', '1h', '10m'
    default: []
  }
}, {
  timestamps: true
});

// Indexes for optimized query execution
meetingSchema.index({ startTime: 1 });

module.exports = mongoose.model('Meeting', meetingSchema);
