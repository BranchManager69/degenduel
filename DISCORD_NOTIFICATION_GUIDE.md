# DegenDuel Discord Notification System

This document outlines how to set up and use the Discord notification system for DegenDuel platform events.

## Overview

The Discord notification system allows real-time updates about platform events to be sent to Discord channels using webhook integration. This creates a community experience where users can see contest activity, winners, and other important platform events directly in Discord.

## Features

- **Contest Notifications**
  - Contest creation
  - User joins (with dynamic emoji based on fill percentage)
  - Contest completion with winners and prizes
  - Contest cancellation

- **User Milestone Notifications**
  - Level-ups (with tier-appropriate emojis)
  - Achievement unlocks
  - General user milestones

- **Token Transaction Monitoring**
  - Token purchases (with amounts, prices, and transaction links)
  - Token sales (with amounts, prices, and transaction links)
  - Customizable minimum transaction values
  - Real-time price data via Jupiter

- **System Notifications**
  - Service status changes
  - System alerts
  - Maintenance notices

## Configuration

### Environment Variables

Configure the following webhook URLs in your `.env` file:

```
# Discord webhook configuration
DISCORD_WEBHOOK_SYSTEM=https://discord.com/api/webhooks/your-webhook-url
DISCORD_WEBHOOK_ALERTS=https://discord.com/api/webhooks/your-webhook-url
DISCORD_WEBHOOK_CONTESTS=https://discord.com/api/webhooks/your-webhook-url
DISCORD_WEBHOOK_TRANSACTIONS=https://discord.com/api/webhooks/your-webhook-url
DISCORD_WEBHOOK_TOKENS=https://discord.com/api/webhooks/your-webhook-url
```

You can use the same webhook URL for all channels or create separate webhooks for different notification types. The TOKENS webhook is used specifically for token purchase/sale notifications.

### Creating Discord Webhooks

1. In your Discord server, go to the channel where you want notifications
2. Click the gear icon (Edit Channel)
3. Go to "Integrations"
4. Click "Webhooks"
5. Click "New Webhook"
6. Name your webhook (e.g., "DegenDuel Contests")
7. Copy the webhook URL
8. Paste the URL in your environment configuration

## Testing

Several test scripts are provided to verify your webhook configuration:

- `tests/discord-contest-complete-test.js` - Tests contest completion notifications
- `tests/discord-user-achievements-test.js` - Tests user milestone notifications
- `tests/discord-contest-lifecycle-test.js` - Tests the full contest lifecycle
- `tests/token-monitor-test.js` - Tests token purchase/sale notifications

Run tests with:

```bash
node tests/discord-contest-lifecycle-test.js
node tests/token-monitor-test.js
```

## Customizing Notifications

To add new notification types or modify existing ones:

1. Add a new event type in `utils/service-suite/service-events.js`
2. Add a handler method in `services/discordNotificationService.js`
3. Emit the event from the appropriate service

## Troubleshooting

- **Notifications not appearing:** Verify the webhook URL is correct and the bot has permission to post in the channel
- **Error in logs:** Check for network connectivity issues or Discord rate limits
- **Missing data in notifications:** Ensure all required data is provided when emitting events

## Example: Emitting Events

To send a notification from any service:

```javascript
// Import service events
import serviceEvents from '../utils/service-suite/service-events.js';
import { SERVICE_EVENTS } from '../utils/service-suite/service-events.js';

// Emit a contest completion event
serviceEvents.emit(SERVICE_EVENTS.CONTEST_COMPLETED, {
  contest_id: 12345,
  contest_name: "Weekend Warrior",
  // ... other data
});
```

## Token Monitoring

To monitor specific token transactions:

1. **Set up the database table** (one-time setup):

```sql
CREATE TABLE monitored_tokens (
  token_address TEXT PRIMARY KEY,
  token_name TEXT,
  token_symbol TEXT,
  decimals INTEGER DEFAULT 9,
  monitor_buys BOOLEAN DEFAULT TRUE,
  monitor_sells BOOLEAN DEFAULT TRUE,
  min_transaction_value DECIMAL(20, 8) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

2. **Add a token to monitor**:

```sql
INSERT INTO monitored_tokens (
  token_address, token_name, token_symbol, decimals,
  monitor_buys, monitor_sells, min_transaction_value
) VALUES (
  'YOUR_TOKEN_ADDRESS',
  'Token Name',
  'SYMBOL',
  9,
  TRUE,
  TRUE,
  0
);
```

3. **Via API** (from your code):

```javascript
import tokenMonitorService from '../services/tokenMonitorService.js';

// Initialize the service if it's not already
await tokenMonitorService.initialize();

// Add a token to monitor
await tokenMonitorService.addTokenToMonitor('YOUR_TOKEN_ADDRESS', {
  token_name: "My Token",
  token_symbol: "TKN",
  decimals: 9,
  monitor_buys: true,
  monitor_sells: true,
  min_transaction_value: 10 // Only notify for transactions worth >$10
});
```

The system will automatically fetch token metadata if not provided, monitor for purchases and sales, and send Discord notifications when transactions occur.