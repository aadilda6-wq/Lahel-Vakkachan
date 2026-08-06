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
  creatorId: {
    type: String,
    default: null
  },
  guildId: {
    type: String,
    required: true,
    index: true
  },
  channelId: {
    type: String,
    default: null
  },
  scheduledTime: {
    type: Date,
    default: null
  },
  remindersSent: {
    type: [String], // Array of strings: '1d', '1h', '10m'
    default: []
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for meetingId mapping to _id
meetingSchema.virtual('meetingId').get(function() {
  return this._id.toString();
});

// Pre-save self-healing hooks to automatically repair missing fields
meetingSchema.pre('save', function(next) {
  if (!this.creatorId && this.organizerId) {
    this.creatorId = this.organizerId;
  }
  if (!this.organizerId && this.creatorId) {
    this.organizerId = this.creatorId;
  }
  if (!this.scheduledTime && this.startTime) {
    this.scheduledTime = this.startTime;
  }
  if (!this.startTime && this.scheduledTime) {
    this.startTime = this.scheduledTime;
  }
  if (!this.endTime && this.startTime) {
    this.endTime = new Date(this.startTime.getTime() + 60 * 60 * 1000);
  }
  if (!this.title) {
    this.title = 'Scheduled Meeting';
  }
  if (this.description === undefined || this.description === null) {
    this.description = '';
  }
  if (!this.remindersSent || !Array.isArray(this.remindersSent)) {
    this.remindersSent = [];
  }
  next();
});

// Dynamic self-healing repair method
meetingSchema.methods.repair = async function(channelId) {
  let modified = false;
  if (!this.creatorId && this.organizerId) {
    this.creatorId = this.organizerId;
    modified = true;
  }
  if (!this.organizerId && this.creatorId) {
    this.organizerId = this.creatorId;
    modified = true;
  }
  if (!this.scheduledTime && this.startTime) {
    this.scheduledTime = this.startTime;
    modified = true;
  }
  if (!this.startTime && this.scheduledTime) {
    this.startTime = this.scheduledTime;
    modified = true;
  }
  if (!this.endTime && this.startTime) {
    this.endTime = new Date(this.startTime.getTime() + 60 * 60 * 1000);
    modified = true;
  }
  if (!this.title) {
    this.title = 'Scheduled Meeting';
    modified = true;
  }
  if (this.description === undefined || this.description === null) {
    this.description = '';
    modified = true;
  }
  if (!this.remindersSent || !Array.isArray(this.remindersSent)) {
    this.remindersSent = [];
    modified = true;
  }
  if (!this.channelId && channelId) {
    this.channelId = channelId;
    modified = true;
  }
  if (modified) {
    await this.save();
  }
  return this;
};

// Indexes for optimized query execution
meetingSchema.index({ startTime: 1 });
meetingSchema.index({ guildId: 1, startTime: 1 });
meetingSchema.index({ calendarEventId: 1 });

module.exports = mongoose.model('Meeting', meetingSchema);
