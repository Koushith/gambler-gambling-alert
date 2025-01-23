# gambler-gambling-alert


🤖 CryptoAlertBot Documentation
===============================

Your personal cryptocurrency price alert assistant

📚 Getting Started
------------------

### 🤖 Find the Bot

Follow these steps to start using CryptoAlertBot:

1.  Open Telegram and search for `@Sigma_degens_bot`
2.  Click "Start" or send the `/start` command
3.  The bot will respond with a welcome message and available commands

**💡 Quick Start:**

Click this link to open the bot directly: [@Sigma\_degens\_bot](https://t.me/Sigma_degens_bot)

### 🎯 Setting Alerts

There are three types of alerts you can set:

*   Percentage Change
*   Exact Price
*   Price Level (Above/Below)

### 📊 Managing Alerts

Use these commands to manage your alerts:

*   /list - View active alerts
*   /tokens - Browse available tokens
*   /help - Get detailed help

📈 Alert Examples
-----------------

### Percentage Change Alerts

/subscribe BTC 5 up

Alert when Bitcoin increases by 5%

/subscribe ETH 10 down

Alert when Ethereum drops by 10%

/subscribe SOL 15 up

Alert when Solana pumps by 15%

### Price Level Alerts

/subscribe BTC above 50000

Alert when Bitcoin crosses above $50,000

/subscribe ETH below 2000

Alert when Ethereum falls below $2,000

/subscribe BNB above 300

Alert when BNB goes above $300

### Exact Price Alerts

/subscribe BTC at 45000

Alert when Bitcoin hits exactly $45,000

/subscribe ETH at 2500

Alert when Ethereum reaches $2,500

/subscribe XRP at 1

Alert when XRP hits $1.00

**🔥 Pro Tips:**

*   You can set multiple alerts for the same token
*   Combine different alert types to create a comprehensive monitoring strategy
*   Use percentage alerts for short-term moves
*   Use price level alerts for long-term targets

🔍 Finding Tokens
-----------------

Use the /tokens command to browse or search for available tokens:

*   `/tokens` - List all supported tokens
*   `/tokens btc` - Search for Bitcoin
*   `/tokens ethereum` - Search by name

**💡 Pro Tip:** Use exact symbol matching for precise results. For example, use "/tokens btc" instead of "/tokens bitcoin" to find Bitcoin quickly.

⚙️ Technical Details
--------------------

*   Prices are checked every minute
*   Alerts trigger only once and are then automatically removed
*   Price data is sourced from CoinGecko API
*   Supports top 250 cryptocurrencies by market cap

Available Commands
------------------

*   **Percentage Change Alert:**  
    `/subscribe <token> <percentage> <up/down>`  
    Example: `/subscribe BTC 5 up`  
    Triggers when price moves up/down by specified percentage
*   **Exact Price Alert:**  
    `/subscribe <token> at <price>`  
    Example: `/subscribe BTC at 45000`  
    Triggers when price reaches the exact value (within 0.1% tolerance)
*   **Price Level Alert:**  
    `/subscribe <token> <above/below/greaterthan/lessthan> <price>`  
    Examples:  
    `/subscribe BTC above 45000`  
    `/subscribe BTC greaterthan 45000`  
    `/subscribe BTC below 45000`  
    `/subscribe BTC lessthan 45000`  
    Triggers when price crosses above or below the specified level
*   **List Alerts:**  
    `/list`  
    Shows all your active alerts
*   **View Tokens:**  
    `/tokens` - List all supported tokens  
    `/tokens <search>` - Search for specific tokens
*   **Help:**  
    `/help` - Show detailed usage guide

Notes
-----

*   Alerts are automatically removed once triggered
*   You can have multiple alerts for the same token
*   Price checks occur every minute
*   For exact price alerts, there's a 0.1% tolerance to account for price fluctuations
*   "greaterthan" and "above" are equivalent commands
*   "lessthan" and "below" are equivalent commands

🤝 Need Help?
-------------

Having issues or want to suggest new features? Reach out!

[📱 Telegram: @koushithamin](https://t.me/koushith.eth) [📧 Email: koushith97@gmail.com](mailto:koushith97@gmail.com)

I typically respond within 24 hours

CryptoAlertBot © 2024 - All rights reserved

Project by [Koushith B R](https://github.com/koushith)
