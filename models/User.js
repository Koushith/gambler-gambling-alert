const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  token: String,
  threshold: Number, // for percentage alerts
  direction: String, // 'up' or 'down' for percentage alerts
  alertType: String, // 'exact', 'above', 'below', 'percentage'
  targetPrice: Number, // for price-based alerts
  lastPrice: Number,
});

const walletAlertSchema = new mongoose.Schema({
  address: {
    type: String,
    required: true,
    lowercase: true, // automatically convert to lowercase
  },
  name: {
    type: String,
    default: '',
  },
  minValue: {
    type: Number,
    default: 1, // minimum ETH value to trigger alert
  },
  network: {
    type: String,
    enum: ['ethereum', 'bsc', 'polygon'], // supported networks
    default: 'ethereum',
  },
});

const userSchema = new mongoose.Schema({
  telegramId: {
    type: String,
    required: true,
    unique: true,
  },
  username: String,
  alerts: [alertSchema],
  walletAlerts: [walletAlertSchema], // new field for wallet tracking
});

module.exports = mongoose.model('User', userSchema);
