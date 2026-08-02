const mongoose = require('mongoose');

const tempCacheSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '7d' // Automatically delete documents after 7 days (TTL Index)
  }
}, {
  timestamps: true,
  collection: 'temp_cache'
});

module.exports = mongoose.model('TempCache', tempCacheSchema);
