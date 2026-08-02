const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  adminRoles: {
    type: [String],
    default: []
  },
  leaderRoles: {
    type: [String],
    default: []
  },
  memberRoles: {
    type: [String],
    default: []
  },
  taskChannelId: {
    type: String,
    default: null
  },
  meetingChannelId: {
    type: String,
    default: null
  },
  reportChannelId: {
    type: String,
    default: null
  },
  teams: [{
    name: { type: String, required: true, trim: true },
    leaderId: { type: String, required: true }, // Discord User ID of team lead
    members: { type: [String], default: [] },    // Discord User IDs of members
    roleId: { type: String, default: null }       // Optional Discord Role ID mapping for the team
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Team', teamSchema);
