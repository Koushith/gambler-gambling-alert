const axios = require('axios');
const User = require('../models/User.js'); // Assuming you have a User model

// Constants
const PRICE_CHECK_INTERVAL = 60000; // Check every 1 minute
const BATCH_SIZE = 50; // Number of alerts to process in each batch
const RETRY_DELAY = 5000; // 5 seconds
const MAX_RETRIES = 3;

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

// Price monitoring function
async function monitorPrices(bot) {
  try {
    // Get all active alerts
    const users = await User.find({ 'alerts.0': { $exists: true } });

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

    // Process tokens in batches
    const tokens = Array.from(tokenAlerts.keys());
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batchTokens = tokens.slice(i, i + BATCH_SIZE);
      const coinIds = batchTokens
        .map((token) => {
          const coin = supportedCoins.find((c) => c.symbol.toLowerCase() === token.toLowerCase());
          return coin ? coin.id : null;
        })
        .filter((id) => id);

      // Fetch current prices for batch
      const response = await fetchWithRetry(() =>
        axios.get('https://api.coingecko.com/api/v3/simple/price', {
          params: {
            ids: coinIds.join(','),
            vs_currencies: 'usd',
          },
        })
      );

      // Check each alert in the batch
      for (const token of batchTokens) {
        const coin = supportedCoins.find((c) => c.symbol.toLowerCase() === token.toLowerCase());
        if (!coin || !response.data[coin.id]) continue;

        const currentPrice = response.data[coin.id].usd;
        const alerts = tokenAlerts.get(token);

        for (const { userId, alert } of alerts) {
          try {
            let shouldTrigger = false;
            let triggerMessage = '';

            // Handle percentage-based alerts (new format)
            if (alert.threshold && alert.direction) {
              const priceChange = (currentPrice - alert.lastPrice) / alert.lastPrice;
              const isUp = currentPrice > alert.lastPrice;

              if (
                (alert.direction === 'up' && isUp && priceChange >= alert.threshold) ||
                (alert.direction === 'down' && !isUp && priceChange <= -alert.threshold)
              ) {
                shouldTrigger = true;
                triggerMessage = `${coin.symbol} has moved ${Math.abs(priceChange).toFixed(2)}% ${
                  isUp ? 'up' : 'down'
                }!`;
              }
            }

            // Handle fixed price alerts
            else if (alert.alertType) {
              switch (alert.alertType) {
                case 'exact':
                  const tolerance = alert.targetPrice * 0.001; // 0.1% tolerance
                  if (Math.abs(currentPrice - alert.targetPrice) <= tolerance) {
                    shouldTrigger = true;
                    triggerMessage = `${coin.symbol} has reached $${currentPrice.toFixed(2)}!`;
                  }
                  break;

                case 'above':
                  if (currentPrice >= alert.targetPrice && alert.lastPrice < alert.targetPrice) {
                    shouldTrigger = true;
                    triggerMessage = `${coin.symbol} has gone above $${alert.targetPrice.toFixed(2)}!`;
                  }
                  break;

                case 'below':
                  if (currentPrice <= alert.targetPrice && alert.lastPrice > alert.targetPrice) {
                    shouldTrigger = true;
                    triggerMessage = `${coin.symbol} has gone below $${alert.targetPrice.toFixed(2)}!`;
                  }
                  break;
              }
            }

            if (shouldTrigger) {
              // Send alert
              await bot.sendMessage(
                userId,
                `🚨 Price Alert!\n\n` +
                  `${triggerMessage}\n` +
                  `💰 Current price: $${currentPrice.toFixed(2)}\n` +
                  `📊 Previous price: $${alert.lastPrice.toFixed(2)}\n\n` +
                  `Want to set another alert? Use /subscribe`
              );

              // Remove triggered alert
              await User.updateOne({ telegramId: userId }, { $pull: { alerts: { _id: alert._id } } });
            } else {
              // Update last price
              await User.updateOne(
                { telegramId: userId, 'alerts._id': alert._id },
                { $set: { 'alerts.$.lastPrice': currentPrice } }
              );
            }
          } catch (error) {
            console.error(`Error processing alert for user ${userId}:`, error);
          }
        }
      }

      // Add delay between batches
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('Error in price monitoring:', error);
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

    const showUsageExample = () => {
      return bot.sendMessage(
        chatId,
        '❓ Here are the ways to set alerts:\n\n' +
          '1️⃣ Percentage Change:\n' +
          '📝 /subscribe <token> <percentage> <up/down>\n' +
          '📊 Example: /subscribe BTC 5 up\n\n' +
          '2️⃣ Exact Price:\n' +
          '📝 /subscribe <token> at <price>\n' +
          '📊 Example: /subscribe BTC at 45000\n\n' +
          '3️⃣ Price Level:\n' +
          '📝 /subscribe <token> <above/below/greaterthan/lessthan> <price>\n' +
          '📊 Example: /subscribe BTC above 45000\n' +
          '📊 Example: /subscribe BTC greaterthan 45000\n\n' +
          '💡 Use /tokens to see available tokens!'
      );
    };

    if (params.length < 2) {
      return showUsageExample();
    }

    const token = params[0].toUpperCase();
    const secondParam = params[1].toLowerCase();

    // Map alternative commands to standard ones
    const PRICE_LEVEL_COMMANDS = {
      above: 'above',
      greaterthan: 'above',
      below: 'below',
      lessthan: 'below',
    };

    // Validate syntax based on alert type
    if (secondParam === 'at') {
      if (params.length !== 3 || isNaN(params[2])) {
        return bot.sendMessage(
          chatId,
          '❌ Invalid exact price format.\n' +
            '📝 Correct format: /subscribe <token> at <price>\n' +
            '📊 Example: /subscribe BTC at 45000'
        );
      }
    } else if (Object.keys(PRICE_LEVEL_COMMANDS).includes(secondParam)) {
      if (params.length !== 3 || isNaN(params[2])) {
        return bot.sendMessage(
          chatId,
          '❌ Invalid price level format.\n' +
            '📝 Correct format: /subscribe <token> <above/below/greaterthan/lessthan> <price>\n' +
            '📊 Example: /subscribe BTC above 45000\n' +
            '📊 Example: /subscribe BTC greaterthan 45000'
        );
      }
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
    }

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

      // Get current price
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd`
      );

      const currentPrice = response.data[coin.id].usd;
      if (!currentPrice) {
        throw new Error('Unable to fetch price');
      }

      let alertType, targetPrice, alertMessage;

      // Handle different alert types
      if (secondParam === 'at') {
        // Exact price alert
        targetPrice = parseFloat(params[2]);
        alertType = 'exact';
        alertMessage = `when price reaches $${targetPrice.toFixed(2)}`;

        // Check if current price already matches target price
        const tolerance = targetPrice * 0.001; // 0.1% tolerance
        if (Math.abs(currentPrice - targetPrice) <= tolerance) {
          // Send immediate alert
          await bot.sendMessage(
            chatId,
            `🚨 Immediate Price Alert!\n\n` +
              `${token} is already at your target price!\n` +
              `💰 Current price: $${currentPrice.toFixed(2)}\n` +
              `🎯 Target price: $${targetPrice.toFixed(2)}\n\n` +
              `Want to set another alert? Use /subscribe`
          );
          return; // Don't save the alert since it's already triggered
        }
      } else if (Object.keys(PRICE_LEVEL_COMMANDS).includes(secondParam)) {
        // Price level alert
        targetPrice = parseFloat(params[2]);
        alertType = PRICE_LEVEL_COMMANDS[secondParam]; // Map to standard type
        const displayCommand =
          secondParam === 'greaterthan' ? 'greater than' : secondParam === 'lessthan' ? 'less than' : secondParam;
        alertMessage = `when price goes ${displayCommand} $${targetPrice.toFixed(2)}`;

        // Check if condition is already met
        const isAlreadyMet =
          (alertType === 'above' && currentPrice >= targetPrice) ||
          (alertType === 'below' && currentPrice <= targetPrice);

        if (isAlreadyMet) {
          await bot.sendMessage(
            chatId,
            `🚨 Immediate Price Alert!\n\n` +
              `${token} is already ${displayCommand} your target price!\n` +
              `💰 Current price: $${currentPrice.toFixed(2)}\n` +
              `🎯 Target price: $${targetPrice.toFixed(2)}\n\n` +
              `Want to set another alert? Use /subscribe`
          );
          return; // Don't save the alert since it's already triggered
        }
      } else {
        // Percentage change alert
        const threshold = parseFloat(secondParam);
        const direction = params[2].toLowerCase();

        // Store threshold and direction
        await User.findOneAndUpdate(
          { telegramId: chatId.toString() },
          {
            $push: {
              alerts: {
                token: token,
                threshold: threshold / 100, // Store as decimal
                direction: direction,
                lastPrice: currentPrice,
              },
            },
          },
          { upsert: true, new: true }
        );

        return bot.sendMessage(
          chatId,
          `✅ Alert set successfully!\n\n` +
            `🪙 Token: ${token}\n` +
            `💰 Current price: $${currentPrice.toFixed(2)}\n` +
            `🎯 Alert will trigger when price goes ${direction} by ${threshold}%\n\n` +
            `💡 Use /list to see all your active alerts`
        );
      }

      // Save non-percentage alerts to database
      const alertData = {
        token: token,
        alertType: alertType,
        targetPrice: targetPrice,
        lastPrice: currentPrice,
      };

      await User.findOneAndUpdate(
        { telegramId: chatId.toString() },
        {
          $push: { alerts: alertData },
        },
        { upsert: true, new: true }
      );

      // Send confirmation message
      bot.sendMessage(
        chatId,
        `✅ Alert set successfully!\n\n` +
          `🪙 Token: ${token}\n` +
          `💰 Current price: $${currentPrice.toFixed(2)}\n` +
          `🎯 Alert will trigger ${alertMessage}\n\n` +
          `💡 Use /list to see all your active alerts`
      );
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

      if (!user || !user.alerts || user.alerts.length === 0) {
        return bot.sendMessage(
          chatId,
          '📝 You have no active alerts.\n\n' + '💡 Use /subscribe to set up a new alert!'
        );
      }

      const alertsList = user.alerts
        .map((alert) => {
          try {
            // Format for percentage-based alerts (new format)
            if (alert.threshold && alert.direction) {
              const threshold = alert.threshold * 100;
              return (
                `${alert.token}: ${threshold.toFixed(2)}% ${alert.direction}\n` +
                `💰 Current: $${alert.lastPrice.toFixed(2)}`
              );
            }

            // Format for target price alerts (legacy format)
            if (alert.targetPrice && alert.alertType) {
              let alertDetails;
              switch (alert.alertType) {
                case 'percentage':
                  const change = ((alert.targetPrice - alert.lastPrice) / alert.lastPrice) * 100;
                  const direction = change > 0 ? 'up' : 'down';
                  alertDetails = `${Math.abs(change).toFixed(2)}% ${direction}`;
                  break;
                case 'exact':
                  alertDetails = `at $${alert.targetPrice.toFixed(2)}`;
                  break;
                default:
                  alertDetails = `${alert.alertType} $${alert.targetPrice.toFixed(2)}`;
              }
              return `${alert.token}: ${alertDetails}\n💰 Current: $${alert.lastPrice.toFixed(2)}`;
            }

            // Fallback for any other format
            return `${alert.token}: Alert set\n💰 Current: $${alert.lastPrice.toFixed(2)}`;
          } catch (error) {
            console.error('Error formatting alert:', error, alert);
            return `${alert.token}: Alert set (format error)`;
          }
        })
        .join('\n\n');

      bot.sendMessage(
        chatId,
        `📊 Your Active Alerts:\n\n${alertsList}\n\n` +
          `💡 Use /subscribe to add more alerts!\n` +
          `ℹ️ Note: Alerts are automatically removed once triggered.`
      );
    } catch (error) {
      console.error('Error in list command:', error);
      bot.sendMessage(chatId, '❌ Sorry, there was an error fetching your alerts.\n' + 'Please try again in a moment!');
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

  // Start price monitoring
  setInterval(() => monitorPrices(bot), PRICE_CHECK_INTERVAL);
  console.log('Price monitoring started');
}

module.exports = setupBotCommands;
