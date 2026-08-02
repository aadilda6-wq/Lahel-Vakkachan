const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium'
  },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Completed', 'Overdue'],
    default: 'Pending'
  },
  assignees: [{
    id: { type: String, required: true },
    type: { type: String, enum: ['user', 'role'], required: true },
    name: String // Cached name for quick lookup/fallback
  }],
  deadline: {
    type: Date,
    required: true
  },
  progressNotes: [{
    note: { type: String, required: true },
    addedBy: { type: String, required: true }, // Discord User ID
    addedByName: String,
    date: { type: Date, default: Date.now }
  }],
  history: [{
    action: { type: String, required: true }, // e.g., 'Created Task', 'Updated Status to Completed'
    performedBy: { type: String, required: true }, // Discord User ID
    performedByName: String,
    date: { type: Date, default: Date.now }
  }],
  guildId: {
    type: String,
    required: true,
    index: true
  },
  creatorId: {
    type: String,
    required: true
  },
  reminderIntervalDays: {
    type: Number,
    default: null
  },
  lastReminderSent: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Indexes for optimized query execution
taskSchema.index({ status: 1 });
taskSchema.index({ deadline: 1 });
taskSchema.index({ 'assignees.id': 1 });

// Pre-save middleware to limit history array size
taskSchema.pre('save', function(next) {
  const MAX_HISTORY = 20;
  if (this.history && this.history.length > MAX_HISTORY) {
    this.history = this.history.slice(-MAX_HISTORY);
  }
  next();
});

module.exports = mongoose.model('Task', taskSchema);
