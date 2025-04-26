# Pool Data Manager

A reactive, on-demand manager for token pool data that ensures pool data is always available when needed. This service automatically fetches missing pool data from DexScreener and updates the database.

## Features

- Just-in-time pool data fetching for tokens
- Queued processing to handle concurrent requests efficiently
- Database synchronization with external pool data
- Event emission for service coordination
- Seamless integration with Helius pool tracker

## Quick Start

```javascript
import poolDataManager from '../services/pool-data-manager/index.js';

// Get pools for a token (will fetch from DexScreener if not in database)
const pools = await poolDataManager.getPoolsForToken(tokenAddress, {
  forceRefresh: false,  // Optional: force refresh from DexScreener
  waitForFetch: true    // Optional: wait for fetch to complete
});

console.log(`Found ${pools.length} pools for token`);
```

For integration with Helius Pool Tracker:

```javascript
import heliusPoolTracker from '../services/pool-data-manager/helius-integration.js';

// This will automatically fetch pools if needed
await heliusPoolTracker.monitorTokenPrice(tokenAddress, priceHandler);
```

## Documentation

For detailed usage and integration instructions, see:
- [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) - Detailed guide on integration with other systems
- [Example Test Script](../../tests/direct-token-monitor.js) - Complete example of token monitoring with pool data manager

## API Reference

### Pool Data Manager

- `getPoolsForToken(tokenAddress, options)` - Get pools for a token, fetching from DexScreener if not found
  - `options.forceRefresh` - Force refresh from API even if pools exist
  - `options.waitForFetch` - Wait for fetch to complete if data is missing

- `queuePoolFetch(tokenAddress)` - Queue a background pool fetch for a token

- `getStats()` - Get service statistics and monitoring information

### Helius Integration

Extended methods for Helius pool tracker:

- `addPoolsToCache(tokenAddress, pools)` - Add pools to Helius tracker cache
- `setPools(tokenAddress, pools)` - Set all pools for a token
- `fetchPoolsWithManager(tokenAddress, options)` - Fetch pools using pool data manager
- Enhanced `monitorTokenPrice(tokenAddress, priceHandler)` - Monitor price with automatic pool fetching

## Events

The Pool Data Manager emits events via the ServiceEvents system:

- `pool:data_updated` - Emitted when pool data is updated
  ```javascript
  serviceEvents.on('pool:data_updated', (data) => {
    // data = { tokenAddress, poolCount, source }
  });
  ```