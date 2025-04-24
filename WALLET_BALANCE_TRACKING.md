<div align="center">
  <img src="https://degenduel.me/assets/media/logos/transparent_WHITE.png" alt="DegenDuel Logo (White)" width="300">
  
  [![Node.js](https://img.shields.io/badge/Node.js-20.x-green)](https://nodejs.org/)
  [![Solana](https://img.shields.io/badge/Solana-SDK-green)](https://solana.com/)
  [![WebSocket](https://img.shields.io/badge/WebSocket-Unified-orange)](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
  [![Wallet Tracking](https://img.shields.io/badge/Wallet%20Tracking-Real--Time-blue)](https://solana.com/docs/rpc/websocket)
  [![RPC](https://img.shields.io/badge/Helius-Enhanced%20RPC-purple)](https://helius.xyz)
</div>

# ⚖️ DegenDuel Wallet Balance Tracking System ⚖️

## Overview

The wallet balance tracking system monitors wallet balances on the Solana blockchain. The system supports two tracking modes for both user wallets and contest wallets:

1. **Polling Mode** (Traditional, Original)
2. **WebSocket Mode** (New, Real-Time)

## Mode Comparison

| Feature | Polling Mode | WebSocket Mode |
|---------|-------------|----------------|
| **Data Freshness** | Periodic updates (typically every 5 minutes) | Real-time updates |
| **RPC Usage** | Higher (one request per wallet per interval) | Significantly lower (one-time subscription) |
| **Scalability** | Decreases with user growth (more RPC calls) | Scales better (one-time connection per wallet) |
| **Reliability** | More reliable with poor connections | Requires stable WebSocket connection |
| **Server Load** | Higher CPU/memory usage | Lower CPU/memory usage |
| **Database Writes** | Periodic batch updates | Real-time updates when balances change |

## Mode Selection

The tracking mode can be configured in three ways (in order of precedence):

1. **Code Override** (for testing): 
   - `FORCE_WEBSOCKET_MODE = true` in userBalanceTrackingService.js
   - Similar override available in contestWalletService.js
2. **Environment Variable**: 
   - `USER_BALANCE_TRACKING_MODE=websocket` in .env file
   - `CONTEST_WALLET_MONITORING_MODE=websocket` in .env file
3. **Default**: Falls back to 'polling' if neither of the above is set

## WebSocket Mode Details

### Advantages

1. **Real-time Updates**: Balance changes appear in the database immediately
2. **Reduced RPC Costs**: Dramatically lower API usage costs (potentially 90%+ reduction)
3. **Better Scalability**: Performance doesn't degrade as user count increases
4. **Lower Server Load**: Less processing overhead for periodic checks
5. **More Accurate Data**: Captures all balance changes, not just those at check intervals
6. **Critical for Contests**: Provides immediate visibility into contest wallet balances

### Potential Challenges

1. **Connection Stability**: Requires stable WebSocket connection to Helius
2. **Reconnection Logic**: Relies on proper reconnection when WebSocket disconnects
3. **Initial Setup**: One-time subscription cost for all wallets on startup
4. **Subscription Limits**: RPC providers may limit the number of concurrent subscriptions

### How It Works

1. During service initialization, it connects to Helius WebSocket API
2. For each wallet, it:
   - Subscribes to account change notifications in batches
   - Registers a callback handler for balance updates
   - Stores the subscription for management
3. When a balance change occurs:
   - Helius notifies our service in real-time
   - The system updates the database immediately
   - Logs display with cyan background (vs. orange for polling)

## Polling Mode Details

### Advantages

1. **Reliability**: Less dependent on persistent connections
2. **Predictability**: Consistent check intervals 
3. **Simplicity**: Straightforward implementation

### Disadvantages

1. **Higher RPC Usage**: One API call per wallet per interval
2. **Delayed Updates**: Balance changes only detected at check intervals
3. **Scalability Issues**: RPC usage increases linearly with user count
4. **Contest Latency**: Contest results may be delayed until next check cycle

### How It Works

1. Service calculates optimal check interval based on wallet count
2. Wallets are scheduled for balance checks in a staggered manner
3. Every few minutes, the service executes balance checks for due wallets
4. Database is updated in batches after each check cycle
5. Logs display with orange background

## Monitoring and Management

### Log Identification

- **WebSocket Mode**: 
  - User wallets: Logs prefixed with `BALANCE WS`
  - Contest wallets: Logs prefixed with `CONTEST WS`
- **Polling Mode**: 
  - User wallets: Logs prefixed with `BALANCE CYCLE`
  - Contest wallets: Logs prefixed with `CONTEST CYCLE`

### Switching Between Modes

To switch between modes:

1. **For WebSocket Mode**:
   - For user wallets:
     - Set `USER_BALANCE_TRACKING_MODE=websocket` in .env file, or
     - Set `FORCE_WEBSOCKET_MODE = true` in userBalanceTrackingService.js
   - For contest wallets:
     - Set `CONTEST_WALLET_MONITORING_MODE=websocket` in .env file

2. **For Polling Mode**:
   - For user wallets:
     - Set `USER_BALANCE_TRACKING_MODE=polling` in .env file, or
     - Set `FORCE_WEBSOCKET_MODE = false` in userBalanceTrackingService.js
   - For contest wallets:
     - Set `CONTEST_WALLET_MONITORING_MODE=polling` in .env file

3. **Restart the service**:
   ```bash
   npm run re &
   ```

### Health Monitoring

Both modes report status metrics that can be accessed via the service status API:

```javascript
// For user balance tracking
const userStatus = await serviceManager.getServiceStatus(SERVICE_NAMES.USER_BALANCE_TRACKING);

// For contest wallet tracking
const contestStatus = await serviceManager.getServiceStatus(SERVICE_NAMES.CONTEST_WALLET_SERVICE);
```

- **WebSocket Mode**: Check `.metrics.websocket` or `.walletStats.websocket_monitoring` for connection health
- **Polling Mode**: Check `.metrics.polling` or `.walletStats` for interval and schedule info

## Fallback Mechanism

If WebSocket mode fails during initialization (e.g., unable to connect to Helius WebSocket), both services will automatically fall back to polling mode for reliability.

The fallback mechanism includes:
1. Attempt to initialize WebSocket monitoring
2. If WebSocket initialization fails, log warning and switch to polling mode
3. If subscriptions fail for more than 50% of wallets, trigger recovery mechanism
4. After multiple recovery failures, fall back to polling mode
5. Periodic subscription recovery attempts for failed subscriptions

## Performance Expectations

For a system with 10,000 users and 100 contest wallets:

| Metric | Polling Mode | WebSocket Mode |
|--------|-------------|----------------|
| Daily RPC calls | ~50,000 | ~500 (99% reduction) |
| Update latency | 5-30 minutes | Real-time (seconds) |
| Server load | Medium-High | Low |
| Database writes | Batched (every few minutes) | Real-time (as changes occur) |
| Contest results | Potentially delayed | Immediate |

## Contest Wallet Implementation

The contest wallet service has been enhanced with WebSocket-based real-time monitoring:

### Key Features

1. **Batch Subscription Management**: 
   - Subscribes to contest wallets in configurable batch sizes
   - Default batch size is calculated based on RPC throttle setting
   - With `MASTER_RPC_THROTTLE=0.5`, batch size defaults to 15 wallets
   - With `MASTER_RPC_THROTTLE=1.0`, batch size defaults to 10 wallets
   - Configurable via `SOLANA_RPC_WALLET_BATCH_SIZE` environment variable

2. **Subscription Tracking**:
   - Maintains sets and maps to track subscription status
   - `subscribedAccounts`: Set of wallet addresses being monitored
   - `subscriptionAttempts`: Map tracking when subscriptions were attempted
   - `activeSubscriptions`: Map storing active subscription metadata

3. **Recovery Mechanism**:
   - Automatically attempts to recover failed subscriptions
   - Implements exponential backoff for retry attempts
   - Falls back to polling if recovery consistently fails

4. **Integration with Unified WebSocket**:
   - Connects to the internal unified WebSocket system
   - Uses the same WebSocket connection for all contest wallets
   - Leverages existing authentication and authorization mechanisms

5. **Status Reporting**:
   - Detailed status reporting in service metrics
   - Real-time subscription status available in logs and metrics
   - Subscription health statistics in wallet stats

### Implementation Methods

The ContestWalletService implements several new methods for WebSocket support:

1. `initializeWebSocketMonitoring()`: Sets up WebSocket monitoring for all contest wallets
2. `createServiceWebSocketClient()`: Creates internal WebSocket connection to the unified system
3. `handleWebSocketMessage()`: Processes messages from the WebSocket server
4. `handleAccountUpdate()`: Updates wallet balances based on real-time updates
5. `subscribeToWalletBatch()`: Manages batch subscriptions to wallet accounts
6. `recoverFailedSubscriptions()`: Recovers from subscription failures

## Recommended Usage

- **Development/Testing**: Either mode works well
- **Production with <1,000 users**: Either mode works well
- **Production with >1,000 users**: WebSocket mode recommended for cost savings
- **Contest Systems**: WebSocket mode strongly recommended for real-time updates
- **Production with >10,000 users**: WebSocket mode strongly recommended

## Implementation Details

The unified balance tracking systems have been implemented in their respective services:
- `userBalanceTrackingService.js` for user wallets
- `contestWalletService.js` for contest wallets

Both can operate in either mode, selected at runtime. This provides flexibility while maintaining consistent database schemas and APIs.

The implementations leverage the existing unified WebSocket system and Helius integration, ensuring we're building on proven components.

---

<div align="center">
  <h3>⚔️ DEGENDUEL ⚔️</h3>
  <p>Sharpen your trading skills while competing for real prizes.</p>
  <p><b>© Branch Manager Productions.</b> All rights reserved.</p>
  <img src="https://img.shields.io/badge/OPTIMIZED-FOR%20PERFORMANCE-blue?style=for-the-badge" alt="Optimized for Performance" />
</div>