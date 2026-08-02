const mongoose = require('mongoose');

const archivedTaskSchema = new mongoose.Schema({
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
    name: String
  }],
  deadline: {
    type: Date,
    required: true
  },
  progressNotes: [{
    note: { type: String, required: true },
    addedBy: { type: String, required: true },
    addedByName: String,
    date: { type: Date, default: Date.now }
  }],
  history: [{
    action: { type: String, required: true },
    performedBy: { type: String, required: true },
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
  archivedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'archived_tasks'
});

module.exports = mongoose.model('ArchivedTask', archivedTaskSchema);
