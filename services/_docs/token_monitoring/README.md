# Token Monitoring System

The Token Monitoring System provides real-time tracking of token buy and sell transactions on the Solana blockchain, with integrated Discord notifications.

## Overview

This system monitors specific tokens for purchase and sale events, filtering by transaction value and automatically dispatching notifications when significant transactions are detected. It integrates with Discord to provide instant alerts about token activity.

## Architecture

The Token Monitoring System is built on these key components:

1. **tokenMonitorService.js**: Core service that manages token monitoring
2. **discordNotificationService.js**: Handles notification delivery to Discord
3. **helius-client.js**: Connects to Solana blockchain via Helius WebSockets
4. **monitored_tokens database table**: Stores configuration for monitored tokens

## Key Features

- **Real-time Transaction Monitoring**: Detects token transactions as they happen
- **Configurable Transaction Filtering**: Set minimum USD values to track
- **Discord Integration**: Sends formatted alerts with transaction details
- **Database Persistence**: Monitoring configuration stored in database
- **Token Price Data**: Includes current price information with notifications
- **Selective Monitoring**: Configure which transaction types to monitor (buys, sells, or both)

## How It Works

1. **Initialization**:
   - The TokenMonitorService loads monitored tokens from the database
   - Connects to Helius WebSocket for real-time blockchain data
   - Registers for token transfer events

2. **Token Registration**:
   - Tokens are registered for monitoring in the monitored_tokens table
   - Each token can have custom monitoring settings

3. **Real-time Monitoring**:
   - Helius WebSocket sends transaction logs in real-time
   - Token transfers are parsed and analyzed
   - Transfers matching monitored tokens trigger events

4. **Event Processing**:
   - TOKEN_PURCHASE and TOKEN_SALE events are emitted
   - DiscordNotificationService receives events and formats notifications
   - Notifications are sent to configured Discord webhook

## Setting Up Token Monitoring

### 1. Database Configuration

Create a record in the `monitored_tokens` table:

```sql
INSERT INTO monitored_tokens (
  token_address, 
  token_name, 
  token_symbol, 
  decimals,
  monitor_buys, 
  monitor_sells, 
  min_transaction_value,
  created_at,
  updated_at
) VALUES (
  'LEBBYGDHzJPcG1pfWvqfXdLDVxpC5oLbYbKMynrnTRd',  -- Token address
  'LeBarbie',                                       -- Token name
  'LEBBY',                                          -- Token symbol
  9,                                                -- Decimals
  TRUE,                                             -- Monitor buys
  TRUE,                                             -- Monitor sells
  10,                                               -- Min transaction value (USD)
  CURRENT_TIMESTAMP,                                -- Created at
  CURRENT_TIMESTAMP                                 -- Updated at
);
```

Make sure the token also exists in the `tokens` table:

```sql
INSERT INTO tokens (
  address,
  name, 
  symbol, 
  decimals,
  is_solana_token
) VALUES (
  'LEBBYGDHzJPcG1pfWvqfXdLDVxpC5oLbYbKMynrnTRd',  -- Token address
  'LeBarbie',                                       -- Token name
  'LEBBY',                                          -- Token symbol
  9,                                                -- Decimals
  TRUE                                              -- Is Solana token
);
```

### 2. Environment Configuration

Add Discord webhook URL to your .env file:

```
DISCORD_WEBHOOK_TOKENS=https://discord.com/api/webhooks/your-webhook-url
```

### 3. Enable the Service

Ensure the token monitor service is enabled in config.js:

```javascript
get token_monitor() {
  return true;
}
```

### 4. Testing

Run the simulation test to verify notifications are working:

```bash
node tests/token-monitor-simulate.js
```

Run the full monitoring test to monitor actual blockchain transactions:

```bash
node tests/token-monitor-test.js
```

## Discord Notification Format

Token purchase notifications show:

- Token symbol and name
- Transaction amount and USD value
- Buyer wallet address (shortened)
- Transaction signature (with link)
- Timestamp

Token sale notifications show similar information for sellers.

## Programmatic Usage

### Adding a Token to Monitor

```javascript
import tokenMonitorService from '../services/tokenMonitorService.js';

// Initialize the service
await tokenMonitorService.initialize();

// Add a token to monitor
await tokenMonitorService.addTokenToMonitor('TOKEN_ADDRESS', {
  token_name: 'Token Name',
  token_symbol: 'SYMBOL',
  decimals: 9,
  monitor_buys: true,
  monitor_sells: true,
  min_transaction_value: 100 // Minimum USD value
});
```

### Subscribing to Events

```javascript
import serviceEvents from '../utils/service-suite/service-events.js';
import { SERVICE_EVENTS } from '../utils/service-suite/service-events.js';

// Listen for token purchase events
serviceEvents.on(SERVICE_EVENTS.TOKEN_PURCHASE, (eventData) => {
  console.log('Token purchase detected:', eventData);
  // Handle token purchase event
});

// Listen for token sale events
serviceEvents.on(SERVICE_EVENTS.TOKEN_SALE, (eventData) => {
  console.log('Token sale detected:', eventData);
  // Handle token sale event
});
```

## Troubleshooting

- **No notifications received**: Check Helius WebSocket connection status and API key
- **Missing token information**: Ensure token exists in both monitored_tokens and tokens tables
- **Discord errors**: Verify webhook URL is correct and has proper permissions
- **Transaction filtering issues**: Review min_transaction_value setting for the token

## Further Development

- Add support for liquidity pool monitoring
- Implement transaction pattern recognition for advanced filtering
- Create admin UI for token monitoring configuration
- Add support for additional notification channels (Telegram, Slack)