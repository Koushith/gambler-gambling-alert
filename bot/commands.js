const axios = require('axios');
const User = require('../models/User.js'); // Assuming you have a User model
const WalletMonitor = require('./walletMonitor');
const { ethers } = require('ethers');

// Constants
const PRICE_CHECK_INTERVAL = 30000; // Check every 30 seconds (reduced from 60s)
const BATCH_SIZE = 25; // Reduced batch size for more frequent updates
const RETRY_DELAY = 3000; // Reduced to 3 seconds
const MAX_RETRIES = 3;
const PRICE_TOLERANCE = 0.005; // 0.5% tolerance for price comparisons

let supportedCoins = [];

// Utility function for API retries
async function fetchWithRetry(apiCall, retries = MAX_RETRIES) {
  try {
    return await apiCall();
  } catch (error) {
    if (retries > 0 && error.response?.status === 429) {
      // Rate limit error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return fetchWithRetry(apiCall, retries - 1);
    }
    throw error;
  }
}

// Add this helper function at the top
function formatPrice(price) {
  return typeof price === 'number' ? price.toFixed(2) : 'N/A';
}

// Price monitoring function
async function monitorPrices(bot) {
  console.log('\n🔄 Starting price check cycle...');
  try {
    // Get all active alerts
    const users = await User.find({ 'alerts.0': { $exists: true } });
    console.log(`📊 Found ${users.length} users with active alerts`);

    if (users.length === 0) {
      console.log('ℹ️ No active alerts to monitor. Skipping price check.\n');
      return;
    }

    // Group alerts by token to minimize API calls
    const tokenAlerts = new Map();
    users.forEach((user) => {
      user.alerts.forEach((alert) => {
        if (!tokenAlerts.has(alert.token)) {
          tokenAlerts.set(alert.token, []);
        }
        tokenAlerts.get(alert.token).push({
          userId: user.telegramId,
          alert: alert,
        });
      });
    });

    const uniqueTokens = Array.from(tokenAlerts.keys());
    console.log(`🔍 Monitoring prices for ${uniqueTokens.length} unique tokens: ${uniqueTokens.join(', ')}`);

    // Process each token
    for (const token of uniqueTokens) {
      const coin = supportedCoins.find((c) => c.symbol.toLowerCase() === token.toLowerCase());
      if (!coin) {
        console.log(`⚠️ No coin data found for ${token}`);
        continue;
      }

      // Fetch current price for single token
      console.log(`📡 Fetching price for ${token}...`);
      const response = await fetchWithRetry(() =>
        axios.get('https://api.coingecko.com/api/v3/simple/price', {
          params: {
            ids: coin.id,
            vs_currencies: 'usd',
          },
        })
      );

      if (!response.data[coin.id]) {
        console.log(`⚠️ No price data available for ${token}`);
        continue;
      }

      const currentPrice = response.data[coin.id].usd;
      const alerts = tokenAlerts.get(token);

      console.log(`\n💰 ${token}: Current price $${formatPrice(currentPrice)} - Checking ${alerts.length} alerts`);

      for (const { userId, alert } of alerts) {
        try {
          console.log(`\n🔍 Checking alert for user ${userId}:`);
          console.log(`Token: ${token}`);
          console.log(`Current Price: $${formatPrice(currentPrice)}`);
          console.log(`Last Price: $${formatPrice(alert.lastPrice)}`);
          console.log(`Alert Type: ${alert.alertType || 'percentage'}`);

          let shouldTrigger = false;
          let triggerMessage = '';

          // Handle percentage-based alerts
          if (alert.threshold && alert.direction) {
            const priceChange = (currentPrice - alert.lastPrice) / alert.lastPrice;
            const isUp = currentPrice > alert.lastPrice;

            console.log(`Percentage Change: ${(priceChange * 100).toFixed(2)}%`);
            console.log(`Direction: ${alert.direction}`);
            console.log(`Threshold: ${(alert.threshold * 100).toFixed(2)}%`);

            if (
              (alert.direction === 'up' && isUp && priceChange >= alert.threshold) ||
              (alert.direction === 'down' && !isUp && Math.abs(priceChange) >= alert.threshold)
            ) {
              shouldTrigger = true;
              triggerMessage = `${token} has moved ${Math.abs(priceChange * 100).toFixed(2)}% ${isUp ? 'up' : 'down'}!`;
              console.log(`🎯 Percentage threshold met!`);
            }
          }
          // Handle fixed price alerts
          else if (alert.alertType) {
            console.log(`Target Price: $${formatPrice(alert.targetPrice)}`);

            switch (alert.alertType) {
              case 'exact':
                const tolerance = currentPrice * PRICE_TOLERANCE;
                const priceDiff = Math.abs(currentPrice - alert.targetPrice);
                console.log(
                  `Exact price check - Difference: $${formatPrice(priceDiff)}, Tolerance: $${formatPrice(tolerance)}`
                );

                if (priceDiff <= tolerance) {
                  shouldTrigger = true;
                  triggerMessage = `${token} has reached $${formatPrice(currentPrice)}!`;
                  console.log(`🎯 Exact price target met!`);
                }
                break;

              case 'above':
                console.log(
                  `Above price check - Current: $${formatPrice(currentPrice)} vs Target: $${formatPrice(
                    alert.targetPrice
                  )}`
                );
                if (currentPrice >= alert.targetPrice && alert.lastPrice < alert.targetPrice) {
                  shouldTrigger = true;
                  triggerMessage = `${token} has gone above $${formatPrice(alert.targetPrice)}!`;
                  console.log(`🎯 Above price target met!`);
                }
                break;

              case 'below':
                console.log(
                  `Below price check - Current: $${formatPrice(currentPrice)} vs Target: $${formatPrice(
                    alert.targetPrice
                  )}`
                );
                if (currentPrice <= alert.targetPrice && alert.lastPrice > alert.targetPrice) {
                  shouldTrigger = true;
                  triggerMessage = `${token} has gone below $${formatPrice(alert.targetPrice)}!`;
                  console.log(`🎯 Below price target met!`);
                }
                break;
            }
          }

          if (shouldTrigger) {
            console.log(`\n🚨 ALERT TRIGGERED - Attempting to send message to user ${userId}`);

            try {
              // First try to send a test message
              console.log(`Testing bot message sending to ${userId}...`);
              await bot.sendMessage(userId, 'Testing alert system...');
              console.log('Test message sent successfully');

              // If test succeeds, send the actual alert
              console.log('Sending actual alert message...');
              await bot.sendMessage(
                userId,
                `🚨 Price Alert!\n\n${triggerMessage}\n` +
                  `💰 Current price: $${formatPrice(currentPrice)}\n` +
                  `📊 Previous price: $${formatPrice(alert.lastPrice)}\n\n` +
                  `Want to set another alert? Use /subscribe`
              );

              console.log(`✅ Alert message sent successfully to user ${userId}`);

              // Remove triggered alert
              console.log(`Removing alert from database...`);
              await User.updateOne({ telegramId: userId }, { $pull: { alerts: { _id: alert._id } } });
              console.log(`✅ Alert removed from database for user ${userId}`);
            } catch (sendError) {
              console.error(`❌ Error sending alert to user ${userId}:`, sendError);
              // Log the full error details
              console.error('Full error:', JSON.stringify(sendError, null, 2));
            }
          } else {
            // Update last price
            await User.updateOne(
              { telegramId: userId, 'alerts._id': alert._id },
              { $set: { 'alerts.$.lastPrice': currentPrice } }
            );
            console.log(`📝 Updated last price for ${token} - User ${userId}: $${formatPrice(currentPrice)}`);
          }
        } catch (error) {
          console.error(`❌ Error processing alert for user ${userId}:`, error);
          console.error('Full error:', JSON.stringify(error, null, 2));
        }
      }
    }

    console.log('\n✅ Completed price check cycle\n');
  } catch (error) {
    console.error('❌ Error in price monitoring:', error);
    console.error('Full error:', JSON.stringify(error, null, 2));
    throw error;
  }
}

async function setupBotCommands(bot) {
  // Fetch supported coins when bot starts
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: 250,
        sparkline: false,
      },
    });
    supportedCoins = response.data;
    console.log(`Loaded ${supportedCoins.length} supported coins from CoinGecko`);
  } catch (error) {
    console.error('Error fetching supported coins:', error);
  }

  // Start command
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    console.log('Start command received from:', chatId);

    bot
      .sendMessage(
        chatId,
        'Welcome to CryptoAlertBot! 🚀\n\n' +
          '📈 Available Alert Types:\n\n' +
          '1️⃣ Percentage Change Alert:\n' +
          '📝 /subscribe <token> <percentage> <up/down>\n' +
          '📊 Example: /subscribe BTC 5 up\n\n' +
          '2️⃣ Exact Price Alert:\n' +
          '📝 /subscribe <token> at <price>\n' +
          '📊 Example: /subscribe BTC at 45000\n\n' +
          '3️⃣ Price Level Alert:\n' +
          '📝 /subscribe <token> <above/below> <price>\n' +
          '📊 Example: /subscribe BTC above 45000\n\n' +
          '📌 Other Commands:\n' +
          '• /tokens - List available tokens\n' +
          '• /tokens <search> - Search for specific tokens\n' +
          '• /list - View your active alerts\n' +
          '• /price <token> - Check current price\n' +
          '• /help - Show detailed usage guide\n\n' +
          '💡 Tip: Use /tokens to see the list of supported tokens!'
      )
      .catch((error) => {
        console.error('Error sending message:', error);
      });
  });

  // Tokens command
  bot.onText(/\/tokens(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const searchQuery = match[1].trim().toLowerCase();

    try {
      let filteredCoins = supportedCoins;

      if (searchQuery) {
        // Strict symbol matching first
        const exactSymbolMatch = supportedCoins.filter((coin) => coin.symbol.toLowerCase() === searchQuery);

        // If no exact matches, try partial name/symbol matching
        if (exactSymbolMatch.length === 0) {
          filteredCoins = supportedCoins.filter(
            (coin) => coin.symbol.toLowerCase().includes(searchQuery) || coin.name.toLowerCase().includes(searchQuery)
          );
        } else {
          filteredCoins = exactSymbolMatch;
        }
      }

      if (filteredCoins.length === 0) {
        return bot.sendMessage(
          chatId,
          'No tokens found. Try searching by full name or check the symbol case.\n' +
            'Example: "/tokens btc" for Bitcoin or "/tokens bitcoin"'
        );
      }

      // Format each token with symbol and name
      const formatToken = (coin) => {
        const symbol = coin.symbol.toUpperCase();
        return `${symbol} - ${coin.name}`;
      };

      // Split tokens into chunks of 25 for better readability
      const chunkSize = 25;
      const chunks = [];

      for (let i = 0; i < filteredCoins.length; i += chunkSize) {
        const chunk = filteredCoins.slice(i, i + chunkSize);
        const tokensList = chunk.map(formatToken).join('\n');
        chunks.push(tokensList);
      }

      // Create appropriate intro message
      let intro;
      if (searchQuery) {
        if (filteredCoins.length === 1) {
          intro = `Found exact match for "${searchQuery.toUpperCase()}":\n\n`;
        } else {
          intro =
            `Found ${filteredCoins.length} tokens matching "${searchQuery}":\n` +
            `(💡 Tip: Use exact symbol for strict matching, e.g., "/tokens sol" for Solana)\n\n`;
        }
      } else {
        intro =
          `List of ${filteredCoins.length} verified tokens:\n` +
          `💡 Tip: Search by exact symbol (e.g., "/tokens btc") or name (e.g., "/tokens bitcoin")\n\n`;
      }

      await bot.sendMessage(chatId, intro + chunks[0]);

      // Send remaining chunks
      for (let i = 1; i < chunks.length; i++) {
        await bot.sendMessage(chatId, chunks[i]);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error('Error in tokens command:', error);
      bot.sendMessage(chatId, 'Sorry, there was an error fetching the tokens list.');
    }
  });

  // Subscribe command
  bot.onText(/\/subscribe (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const params = match[1].trim().split(' ');

    try {
      if (params.length < 2) {
        return bot.sendMessage(
          chatId,
          '❌ Invalid format.\n\n' +
            '📝 Use one of these formats:\n' +
            '1️⃣ Percentage Alert:\n' +
            '/subscribe <token> <percentage> <up/down>\n' +
            'Example: /subscribe BTC 5 up\n\n' +
            '2️⃣ Price Target Alert:\n' +
            '/subscribe <token> <above/below> <price>\n' +
            'Example: /subscribe BTC above 45000'
        );
      }

      const token = params[0].toUpperCase();
      const secondParam = params[1].toLowerCase();
      let alertData;

      // Get current price
      const coin = supportedCoins.find((c) => c.symbol.toLowerCase() === token.toLowerCase());
      if (!coin) {
        return bot.sendMessage(chatId, '❌ Token not found! Use /tokens to see supported tokens.');
      }

      const response = await fetchWithRetry(() =>
        axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd`)
      );
      const currentPrice = response.data[coin.id].usd;

      // Determine alert type and create alert data
      if (secondParam === 'above' || secondParam === 'below') {
        // Price level alert
        const targetPrice = parseFloat(params[2]);
        if (isNaN(targetPrice)) {
          return bot.sendMessage(chatId, '❌ Invalid price value');
        }

        alertData = {
          token,
          alertType: secondParam,
          targetPrice,
          lastPrice: currentPrice,
        };

        // Confirmation message for price level alert
        const confirmationMessage =
          `✅ Alert set successfully!\n\n` +
          `🪙 Token: ${token}\n` +
          `💰 Current price: $${currentPrice.toFixed(2)}\n` +
          `🎯 Alert will trigger when price goes ${secondParam} $${targetPrice.toFixed(2)}\n` +
          `\n💡 Use /list to see all your active alerts`;

        await User.findOneAndUpdate(
          { telegramId: chatId.toString() },
          { $push: { alerts: alertData } },
          { upsert: true }
        );

        await bot.sendMessage(chatId, confirmationMessage);
      } else {
        // Percentage change alert
        if (params.length !== 3 || isNaN(secondParam) || !['up', 'down'].includes(params[2].toLowerCase())) {
          return bot.sendMessage(
            chatId,
            '❌ Invalid percentage format.\n' +
              '📝 Correct format: /subscribe <token> <percentage> <up/down>\n' +
              '📊 Example: /subscribe BTC 5 up'
          );
        }

        // Percentage change alert
        alertData = {
          token,
          alertType: 'percentage',
          threshold: parseFloat(secondParam) / 100,
          direction: params[2].toLowerCase(),
          lastPrice: currentPrice,
        };

        // Save alert
        await User.findOneAndUpdate(
          { telegramId: chatId.toString() },
          { $push: { alerts: alertData } },
          { upsert: true }
        );

        // Send confirmation message based on alert type
        let confirmationMessage =
          `✅ Alert set successfully!\n\n` + `🪙 Token: ${token}\n` + `💰 Current price: $${currentPrice.toFixed(2)}\n`;

        if (alertData.alertType === 'percentage') {
          confirmationMessage += `📈 Alert will trigger when price ${
            alertData.direction === 'up' ? 'increases' : 'decreases'
          } by ${(alertData.threshold * 100).toFixed(2)}%\n`;
        } else if (alertData.alertType === 'exact') {
          confirmationMessage += `�� Alert will trigger when price reaches $${alertData.targetPrice.toFixed(2)}\n`;
        } else if (alertData.alertType === 'above' || alertData.alertType === 'below') {
          confirmationMessage += `🎯 Alert will trigger when price goes ${
            alertData.alertType
          } $${alertData.targetPrice.toFixed(2)}\n`;
        }

        confirmationMessage += `\n💡 Use /list to see all your active alerts`;

        await bot.sendMessage(chatId, confirmationMessage);
      }
    } catch (error) {
      console.error('Error in subscribe command:', error);
      bot.sendMessage(
        chatId,
        '❌ Sorry, there was an error setting up your alert.\n' + 'Please try again in a moment!'
      );
    }
  });

  // List command
  bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;

    try {
      const user = await User.findOne({ telegramId: chatId.toString() });

      if (!user) {
        return bot.sendMessage(
          chatId,
          '❌ No alerts found. Use /subscribe to set up price alerts or /trackwallet to track wallet transactions.'
        );
      }

      let message = '📊 *Your Active Alerts*\n\n';

      // Price Alerts Section
      if (user.alerts && user.alerts.length > 0) {
        message += '💰 *Price Alerts:*\n';
        user.alerts.forEach((alert, index) => {
          message += `${index + 1}. *${alert.token.toUpperCase()}*\n`;

          // Determine alert type and format accordingly
          if (alert.alertType === 'percentage') {
            // Percentage based alert
            message += `📊 Type: Percentage ${alert.direction === 'up' ? 'Increase' : 'Decrease'}\n`;
            message += `📈 Threshold: ${(alert.threshold * 100).toFixed(2)}%\n`;
          } else if (alert.alertType === 'exact') {
            // Exact price alert
            message += `📊 Type: Exact Price\n`;
            message += `🎯 Target: $${alert.targetPrice.toFixed(2)}\n`;
          } else if (alert.alertType === 'above' || alert.alertType === 'below') {
            // Price range alert
            message += `📊 Type: Price ${alert.alertType === 'above' ? 'Above' : 'Below'}\n`;
            message += `🎯 Target: $${alert.targetPrice.toFixed(2)}\n`;
          }

          if (alert.lastPrice) {
            message += `💵 Last Price: $${alert.lastPrice.toFixed(2)}\n`;
          }
          message += '\n';
        });
      }

      // Wallet Alerts Section
      if (user.walletAlerts && user.walletAlerts.length > 0) {
        message += '👛 *Wallet Tracking:*\n';

        // Remove duplicate wallet alerts
        const uniqueWallets = user.walletAlerts.reduce((acc, current) => {
          const key = `${current.address}-${current.network}`;
          if (!acc.has(key)) {
            acc.set(key, current);
          }
          return acc;
        }, new Map());

        Array.from(uniqueWallets.values()).forEach((wallet, index) => {
          message += `${index + 1}. ${wallet.name ? `*${wallet.name}*\n` : ''}`;
          message += `📍 Address: \`${wallet.address}\`\n`;
          message += `🌐 Network: ${wallet.network.toUpperCase()}\n`;
          message += `💰 Min Value: ${wallet.minValue} ${
            wallet.network === 'bsc' ? 'BNB' : wallet.network === 'polygon' ? 'MATIC' : 'ETH'
          }\n\n`;
        });
      }

      // Add help footer
      message +=
        '\n📚 *Available Commands:*\n' +
        '• /subscribe - Set price alerts\n' +
        '• /trackwallet - Track wallet transactions\n' +
        '• /remove - Remove specific alerts\n' +
        '• /help - Show all commands';

      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error('Error in list command:', error);
      bot.sendMessage(chatId, '❌ Error fetching your alerts. Please try again.');
    }
  });

  // Price command
  bot.onText(/\/price (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = match[1].trim().toUpperCase();

    try {
      const coin = supportedCoins.find((c) => c.symbol.toLowerCase() === token.toLowerCase());
      if (!coin) {
        return bot.sendMessage(
          chatId,
          '❌ Token not found!\n\n' +
            '💡 Use /tokens to see the list of supported tokens\n' +
            '📝 Make sure to use the exact token symbol (e.g., BTC, ETH, SOL)'
        );
      }

      const response = await fetchWithRetry(() =>
        axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd`)
      );

      const currentPrice = response.data[coin.id].usd;
      if (!currentPrice) {
        throw new Error('Unable to fetch price');
      }

      await bot.sendMessage(
        chatId,
        `💰 Current Price:\n\n` +
          `${token} (${coin.name})\n` +
          `$${currentPrice.toFixed(2)} USD\n\n` +
          `Want to set a price alert? Use /subscribe`
      );
    } catch (error) {
      console.error('Error in price command:', error);
      bot.sendMessage(chatId, '❌ Sorry, there was an error fetching the price.\n' + 'Please try again in a moment!');
    }
  });

  // Help command
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(
      chatId,
      '📚 CryptoAlertBot Help Guide\n\n' +
        '🎯 Setting Alerts:\n\n' +
        '1️⃣ Percentage Change Alert:\n' +
        '• Triggers when price moves up/down by specified percentage\n' +
        '📝 /subscribe <token> <percentage> <up/down>\n' +
        '📊 Example: /subscribe BTC 5 up\n\n' +
        '2️⃣ Exact Price Alert:\n' +
        '• Triggers when price reaches specific value\n' +
        '📝 /subscribe <token> at <price>\n' +
        '📊 Example: /subscribe BTC at 45000\n\n' +
        '3️⃣ Price Level Alert:\n' +
        '• Triggers when price goes above/below specified value\n' +
        '📝 /subscribe <token> <above/below> <price>\n' +
        '📊 Example: /subscribe BTC above 45000\n\n' +
        '📌 Other Commands:\n' +
        '• /tokens - List all supported tokens\n' +
        '• /tokens <search> - Search for specific tokens\n' +
        '• /price <token> - Check current price\n' +
        '• /list - View your active alerts\n' +
        '• /start - Show welcome message\n\n' +
        '💡 Tips:\n' +
        '• Use exact token symbols (BTC, ETH, etc.)\n' +
        '• Alerts trigger only once\n' +
        '• You can have multiple alerts per token\n\n' +
        '❓ Need more help? Contact: @koushith.eth'
    );
  });

  // Test function to simulate price changes and alerts with delays
  async function simulatePrice(bot, msg, token, newPrice) {
    try {
      const coin = supportedCoins.find((c) => c.symbol.toLowerCase() === token.toLowerCase());
      if (!coin) {
        throw new Error('Token not found');
      }

      // Send initial status
      await bot.sendMessage(
        msg.chat.id,
        `🔄 Starting price simulation for ${token.toUpperCase()}\n` +
          `Target price: $${newPrice}\n` +
          `Checking price every 5 seconds...`
      );

      // Simulate API calls with increasing prices
      let currentPrice = coin.current_price || 40000; // fallback price
      const priceSteps = 3; // Number of price updates before reaching target
      const priceIncrement = (newPrice - currentPrice) / priceSteps;

      for (let i = 0; i < priceSteps; i++) {
        // Wait 5 seconds between price updates
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Update current price
        currentPrice += priceIncrement;

        // Mock the axios response
        const mockResponse = {
          data: {
            [coin.id]: {
              usd: currentPrice,
            },
          },
        };

        // Log price update
        await bot.sendMessage(
          msg.chat.id,
          `📊 Price Update (${i + 1}/${priceSteps}):\n` + `${token.toUpperCase()}: $${currentPrice.toFixed(2)}`
        );

        // Get all active alerts for this token
        const users = await User.find({ 'alerts.token': token.toUpperCase() });

        for (const user of users) {
          const tokenAlerts = user.alerts.filter((alert) => alert.token.toUpperCase() === token.toUpperCase());

          for (const alert of tokenAlerts) {
            let shouldTrigger = false;
            let triggerMessage = '';

            // Check alert conditions
            if (alert.threshold && alert.direction) {
              const priceChange = (currentPrice - alert.lastPrice) / alert.lastPrice;
              const isUp = currentPrice > alert.lastPrice;

              if (
                (alert.direction === 'up' && isUp && priceChange >= alert.threshold) ||
                (alert.direction === 'down' && !isUp && priceChange <= -alert.threshold)
              ) {
                shouldTrigger = true;
                triggerMessage = `${token.toUpperCase()} has moved ${Math.abs(priceChange * 100).toFixed(2)}% ${
                  isUp ? 'up' : 'down'
                }!`;
              }
            } else if (alert.alertType) {
              switch (alert.alertType) {
                case 'exact':
                  const tolerance = alert.targetPrice * 0.001;
                  if (Math.abs(currentPrice - alert.targetPrice) <= tolerance) {
                    shouldTrigger = true;
                    triggerMessage = `${token.toUpperCase()} has reached $${currentPrice.toFixed(2)}!`;
                  }
                  break;

                case 'above':
                  if (currentPrice >= alert.targetPrice && alert.lastPrice < alert.targetPrice) {
                    shouldTrigger = true;
                    triggerMessage = `${token.toUpperCase()} has gone above $${alert.targetPrice.toFixed(2)}!`;
                  }
                  break;

                case 'below':
                  if (currentPrice <= alert.targetPrice && alert.lastPrice > alert.targetPrice) {
                    shouldTrigger = true;
                    triggerMessage = `${token.toUpperCase()} has gone below $${alert.targetPrice.toFixed(2)}!`;
                  }
                  break;
              }
            }

            if (shouldTrigger) {
              // Wait 2 seconds before sending alert
              await new Promise((resolve) => setTimeout(resolve, 2000));

              // Send alert
              await bot.sendMessage(
                user.telegramId,
                `🚨 Price Alert! (SIMULATION)\n\n` +
                  `${triggerMessage}\n` +
                  `💰 Current price: $${currentPrice.toFixed(2)}\n` +
                  `📊 Previous price: $${alert.lastPrice.toFixed(2)}\n\n` +
                  `Want to set another alert? Use /subscribe`
              );

              // Remove triggered alert
              await User.updateOne({ telegramId: user.telegramId }, { $pull: { alerts: { _id: alert._id } } });
            } else {
              // Update last price
              await User.updateOne(
                { telegramId: user.telegramId, 'alerts._id': alert._id },
                { $set: { 'alerts.$.lastPrice': currentPrice } }
              );
            }
          }
        }
      }

      return {
        success: true,
        message: `Simulated price change for ${token.toUpperCase()} to $${newPrice}`,
      };
    } catch (error) {
      console.error('Error in price simulation:', error);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  // Add test command
  bot.onText(/\/simulate (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const params = match[1].trim().split(' ');

    if (params.length !== 2) {
      return bot.sendMessage(
        chatId,
        '❌ Invalid simulation format.\n' +
          '📝 Correct format: /simulate <token> <price>\n' +
          '📊 Example: /simulate BTC 45000'
      );
    }

    const [token, price] = params;
    const newPrice = parseFloat(price);

    if (isNaN(newPrice)) {
      return bot.sendMessage(chatId, '❌ Invalid price value');
    }

    const result = await simulatePrice(bot, msg, token, newPrice);
    if (!result.success) {
      bot.sendMessage(chatId, '❌ ' + result.message);
    }
  });

  // Track wallet command
  bot.onText(/\/trackwallet (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const params = match[1].trim().split(' ');

    if (params.length < 1) {
      return bot.sendMessage(
        chatId,
        '❌ Invalid format.\n' +
          '📝 Usage:\n' +
          '/trackwallet <address> [name] [min_value] [network]\n' +
          '📊 Example:\n' +
          '/trackwallet 0x123... Vitalik 10 ethereum'
      );
    }

    const [address, name = '', minValueStr = '1', network = 'ethereum'] = params;

    try {
      // Use ethers.getAddress to validate the address (new method in v6)
      try {
        ethers.getAddress(address); // This will throw if invalid
      } catch (e) {
        return bot.sendMessage(chatId, '❌ Invalid address format');
      }

      // Validate network
      if (!['ethereum', 'bsc', 'polygon'].includes(network.toLowerCase())) {
        return bot.sendMessage(chatId, '❌ Invalid network. Supported networks: ethereum, bsc, polygon');
      }

      // Validate and parse minimum value
      const minValue = parseFloat(minValueStr);
      if (isNaN(minValue) || minValue <= 0) {
        return bot.sendMessage(chatId, '❌ Invalid minimum value');
      }

      // Add wallet to tracking list
      await User.findOneAndUpdate(
        { telegramId: chatId.toString() },
        {
          $push: {
            walletAlerts: {
              address: address.toLowerCase(),
              name,
              minValue,
              network: network.toLowerCase(),
            },
          },
        },
        { upsert: true }
      );

      bot.sendMessage(
        chatId,
        `✅ Now tracking wallet:\n` +
          `🌐 Network: ${network.toUpperCase()}\n` +
          `📍 Address: ${address}\n` +
          `${name ? `👤 Name: ${name}\n` : ''}` +
          `💰 Minimum Value: ${minValue} ${network === 'bsc' ? 'BNB' : network === 'polygon' ? 'MATIC' : 'ETH'}`
      );
    } catch (error) {
      console.error('Error setting up wallet tracking:', error);
      bot.sendMessage(chatId, '❌ Error setting up wallet tracking. Please try again.');
    }
  });

  // Start price monitoring with proper error handling and logging
  console.log('Starting price monitoring service...');

  // Initial price check
  await monitorPrices(bot).catch((error) => {
    console.error('Error in initial price check:', error);
  });

  // Set up recurring price checks
  setInterval(async () => {
    try {
      await monitorPrices(bot);
    } catch (error) {
      console.error('Error in price monitoring interval:', error);
    }
  }, PRICE_CHECK_INTERVAL);

  console.log(`Price monitoring started - checking every ${PRICE_CHECK_INTERVAL / 1000} seconds`);

  // Initialize wallet monitoring
  const walletMonitor = new WalletMonitor(bot);
  await walletMonitor.start();
}

module.exports = setupBotCommands;
