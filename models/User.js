const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  token: String,
  threshold: Number, // percentage change to trigger alert
  direction: String, // 'up' or 'down'
  lastPrice: Number,
});

const userSchema = new mongoose.Schema({
  telegramId: {
    type: String,
    required: true,
    unique: true,
  },
  username: String,
  alerts: [alertSchema],
});

module.exports = mongoose.model('User', userSchema);
