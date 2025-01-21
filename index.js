require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');
const setupBotCommands = require('./bot/commands'); // Make sure this path is correct

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Setup bot commands
setupBotCommands(bot);

// Basic error handling for bot
bot.on('error', (error) => {
  console.error('Telegram Bot Error:', error);
});

bot.on('polling_error', (error) => {
  console.error('Polling Error:', error);
});

// Test that bot is working
bot.on('message', (msg) => {
  console.log('Received message:', msg.text);
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Add routes before the app.listen call
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Add Telegram WebApp webhook endpoint
app.post('/webhook', (req, res) => {
  const { queryId, data } = req.body;
  try {
    bot.answerWebAppQuery(queryId, {
      type: 'article',
      id: queryId,
      title: 'Data received',
      input_message_content: {
        message_text: `Received data: ${JSON.stringify(data)}`,
      },
    });
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
