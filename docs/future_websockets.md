# DegenDuel WebSocket Architecture

## Current Implementation: Portfolio WebSocket

The current WebSocket implementation (`portfolio-ws.js`) provides real-time monitoring capabilities for superadmins:

### Features
- **Portfolio Monitoring**
  - Real-time monitoring of all platform portfolios
  - Organized by contest and user
  - 15-second automatic updates
  - Comprehensive data including tokens, contests, and user info

- **Trade Monitoring**
  - Real-time trade execution broadcasts
  - Platform-wide trade monitoring
  - Contest-specific or user-specific filtering

### Admin Subscription Types
```javascript
const ADMIN_SUBSCRIPTIONS = {
  ALL_PORTFOLIOS: 'all_portfolios',  // Monitor all portfolio updates
  ALL_TRADES: 'all_trades',          // Monitor all trading activity
  CONTEST: 'contest',                // Monitor specific contest
  USER: 'user'                       // Monitor specific user
}
```

## Proposed Future WebSocket Implementations

### 1. Contest WebSocket
- Real-time contest state changes
- Participant activity monitoring
- Live performance metrics
- Prize pool updates
- Contest evaluation events

### 2. User Activity WebSocket
- Authentication events (login/logout)
- Account modifications
- Wallet connections
- User settings changes
- Security events

### 3. Token/Price WebSocket
- Real-time price updates
- Token listing events
- Price anomaly detection
- Token sync status
- Market data streaming

### 4. System Health WebSocket
- Server performance metrics
- Database connection status
- Service health monitoring
  - Token sync service
  - Wallet rake service
  - Contest evaluation service
- Error rate tracking
- API performance metrics

### 5. Transaction WebSocket
- Solana transaction monitoring
- Wallet rake events
- Token transfers
- Failed transaction alerts
- Gas/fee monitoring

### 6. Analytics WebSocket
- Platform statistics
- User engagement metrics
- Contest participation rates
- Trading volume analytics
- Performance metrics

## Connection Example

To connect as a superadmin to the current portfolio WebSocket:

1. Connect to the WebSocket endpoint:
```javascript
const ws = new WebSocket('wss://your-domain/portfolio?token=your-auth-token');
```

2. Subscribe to desired monitoring channels:
```javascript
// Monitor all portfolios
ws.send(JSON.stringify({ type: 'all_portfolios' }));

// Monitor all trades
ws.send(JSON.stringify({ type: 'all_trades' }));

// Monitor specific contest
ws.send(JSON.stringify({ 
    type: 'contest',
    contestId: 'specific-contest-id' 
}));

// Monitor specific user
ws.send(JSON.stringify({ 
    type: 'user',
    userWallet: 'user-wallet-address' 
}));
```

## Implementation Priority

When implementing additional WebSockets, consider the following priority order based on monitoring importance:

1. System Health WebSocket (critical for platform stability)
2. Token/Price WebSocket (essential for trading functionality)
3. Transaction WebSocket (important for financial monitoring)
4. Contest WebSocket (game mechanics monitoring)
5. User Activity WebSocket (security and user behavior)
6. Analytics WebSocket (business metrics)

Each WebSocket implementation should follow the current architecture pattern while maintaining its specific focus area. 