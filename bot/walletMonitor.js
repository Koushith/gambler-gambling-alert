const { ethers } = require('ethers');
const User = require('../models/User.js');
require('dotenv').config();

// RPC URLs - replace with your own from Alchemy/Infura
const RPC_URLS = {
  ethereum: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  bsc: 'https://bsc-dataseed.binance.org',
  polygon: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
};

const EXPLORER_URLS = {
  ethereum: 'https://etherscan.io',
  bsc: 'https://bscscan.com',
  polygon: 'https://polygonscan.com',
};

class WalletMonitor {
  constructor(bot) {
    this.bot = bot;
    this.providers = {};
    this.setupProviders();
  }

  setupProviders() {
    for (const [network, url] of Object.entries(RPC_URLS)) {
      this.providers[network] = new ethers.JsonRpcProvider(url);
    }
  }

  async start() {
    console.log('🔄 Starting wallet monitoring...');

    for (const [network, provider] of Object.entries(this.providers)) {
      provider.on('block', async (blockNumber) => {
        try {
          await this.processBlock(network, blockNumber);
        } catch (error) {
          console.error(`Error processing ${network} block ${blockNumber}:`, error);
        }
      });
    }
  }

  async processBlock(network, blockNumber) {
    try {
      const provider = this.providers[network];
      const block = await provider.getBlock(blockNumber, true);

      if (!block || !block.transactions || block.transactions.length === 0) return;

      // Get all users with wallet alerts
      const users = await User.find({ 'walletAlerts.0': { $exists: true } });
      if (users.length === 0) return;

      // Create address map for efficient lookup
      const addressMap = new Map();
      users.forEach((user) => {
        user.walletAlerts
          .filter((wallet) => wallet.network === network)
          .forEach((wallet) => {
            if (!addressMap.has(wallet.address)) {
              addressMap.set(wallet.address, []);
            }
            addressMap.get(wallet.address).push({
              userId: user.telegramId,
              name: wallet.name,
              minValue: wallet.minValue,
            });
          });
      });

      // Process transactions
      for (const tx of block.transactions) {
        try {
          // Skip if no value or invalid transaction
          if (!tx.value || !tx.from || !tx.to) continue;

          // Format the value
          let value;
          try {
            value = parseFloat(ethers.formatEther(tx.value));
          } catch (error) {
            console.log(`Error formatting value for tx ${tx.hash}:`, error);
            continue;
          }

          // Skip invalid values
          if (isNaN(value) || value <= 0) continue;

          // Check addresses
          [tx.from, tx.to].forEach((address) => {
            const trackingUsers = addressMap.get(address.toLowerCase());
            if (!trackingUsers) return;

            trackingUsers.forEach(async ({ userId, minValue }) => {
              if (value >= minValue) {
                try {
                  const direction = address.toLowerCase() === tx.from.toLowerCase() ? 'sent' : 'received';
                  const message =
                    `🚨 Transaction Alert!\n\n` +
                    `💰 Value: ${value.toFixed(4)} ${
                      network === 'bsc' ? 'BNB' : network === 'polygon' ? 'MATIC' : 'ETH'
                    }` +
                    `\n💸 Direction: ${direction}` +
                    `\n🏷️ Address: ${address}` +
                    `\n🕒 Block: ${blockNumber}` +
                    `\n🔗 Transaction: [${EXPLORER_URLS[network]}/tx/${tx.hash}](${EXPLORER_URLS[network]}/tx/${tx.hash})`;

                  await this.bot.telegram.sendMessage(userId, message, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                  });
                } catch (alertError) {
                  console.error(`Error sending alert to user ${userId}:`, alertError);
                }
              }
            });
          });
        } catch (error) {
          console.error(`Error processing transaction ${tx.hash}:`, error);
        }
      }
    } catch (error) {
      console.error(`Error processing ${network} block ${blockNumber}:`, error);
    }
  }
}

module.exports = WalletMonitor;
