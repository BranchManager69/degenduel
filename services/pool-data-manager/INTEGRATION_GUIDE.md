# Pool Data Manager - Integration Guide

## Overview

The Pool Data Manager is a reactive solution for managing token pool data in the DegenDuel platform. It automatically fetches and stores pool data from DexScreener when requested, ensuring that Helius pool tracking and price monitoring work seamlessly even for tokens not previously indexed.

## Key Components

1. **PoolDataManager (`pool-data-manager.js`)**
   - Core reactive data manager that fetches pools on demand
   - Queue-based processing for concurrent requests
   - Database integration for persistence

2. **Helius Integration (`helius-integration.js`)**
   - Extends Helius pool tracker with Pool Data Manager capabilities
   - Automatically fetches pool data for tokens without existing data
   - Provides seamless connection between components

3. **Testing Script (`tests/direct-token-monitor.js`)**
   - Demonstrates using Pool Data Manager with real-time price monitoring
   - Shows how to monitor a specific token using multiple methods
   - Example of reactive pool fetching in action

## Using the Pool Data Manager

### Basic Usage

```javascript
import poolDataManager from '../services/pool-data-manager/index.js';

// Get pools for a token (will fetch from DexScreener if not in database)
const pools = await poolDataManager.getPoolsForToken('DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump', {
  forceRefresh: false,  // Set to true to force refresh from DexScreener
  waitForFetch: true    // Set to false for non-blocking operation
});

console.log(`Found ${pools.length} pools for token`);
```

### Non-Blocking Usage

```javascript
// Get pools without waiting (will return existing pools or empty array immediately)
const existingPools = await poolDataManager.getPoolsForToken(tokenAddress, {
  waitForFetch: false  // Return immediately and fetch in background
});

console.log(`Found ${existingPools.length} existing pools, fetching more in background`);

// The background fetch will update the database automatically
```

### Integration with Helius Pool Tracker

```javascript
// Import the extended Helius pool tracker
import heliusPoolTracker from '../services/pool-data-manager/helius-integration.js';

// This will automatically fetch pools if needed
await heliusPoolTracker.monitorTokenPrice(tokenAddress, priceHandler);

// Explicit fetch and integration
await heliusPoolTracker.fetchPoolsWithManager(tokenAddress, {
  forceRefresh: true,
  waitForFetch: true
});
```

## Implementation Notes

1. **Queue Processing**
   - Multiple requests for the same token are batched
   - Prevents redundant API calls and database operations
   - Background processing for non-blocking operations

2. **Token Creation**
   - Automatically creates token records if not in database
   - Extracts basic token metadata from pool data

3. **Data Freshness**
   - By default, uses existing pool data if available
   - `forceRefresh` option to always get fresh data
   - Updates token metadata with refresh timestamps

## Example Complete Test Script

See `tests/direct-token-monitor.js` for a complete example of monitoring a token with:
1. Ultra-fast Jupiter polling for price updates (500ms intervals)
2. Jupiter callback system using onPriceUpdate 
3. Helius pool tracker with PoolDataManager integration
4. Helius token transfer WebSocket for activity monitoring

Run the test with:
```bash
node tests/direct-token-monitor.js DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump
```

## Best Practices

1. For services that need guaranteed pool data, use `waitForFetch: true` to ensure data is available before continuing.

2. For user-facing features, use `waitForFetch: false` to provide immediate response with existing data while updating in the background.

3. When refreshing data in the background, listen for the `pool:data_updated` event:
   ```javascript
   import serviceEvents from '../utils/service-suite/service-events.js';
   
   serviceEvents.on('pool:data_updated', (data) => {
     // Handle updated pool data
     console.log(`Pools updated for token: ${data.tokenAddress}`);
   });
   ```

4. Use the Helius integration for seamless price monitoring that automatically handles pool data:
   ```javascript
   await heliusPoolTracker.monitorTokenPrice(tokenAddress, priceHandler);
   ```

## Integration Plan

To fully integrate the Pool Data Manager with existing systems, several components need to be updated:

### 1. Helius Pool Tracker Integration

The `helius-pool-tracker.js` file has been extended to work with the Pool Data Manager through the `helius-integration.js` module. This integration provides:

- `fetchPoolsWithManager()` - Explicitly fetch pools using the Pool Data Manager
- `addPoolsToCache()` - Add pools to the Helius tracker's cache
- `setPools()` - Set all pools for a token
- Enhanced `monitorTokenPrice()` - Automatically fetches pool data if needed

#### Implementation Status:
- ✅ Created `services/pool-data-manager/helius-integration.js`
- ✅ Added methods to extend Helius pool tracker
- ✅ Modified `direct-token-monitor.js` to use integration

### 2. SolanaEngine Coordination 

To avoid rate limiting issues with multiple components querying DexScreener, the Pool Data Manager has been updated to:

1. Check the database first before making API calls
2. Handle rate limiting gracefully by retrying after a delay
3. Coordinate with SolanaEngine's existing pool data

#### Implementation Status:
- ✅ Updated Pool Data Manager to check database first
- ✅ Added rate limit handling with database fallback
- ✅ Added error handling for 429 responses

### 3. Trigger Points for Pool Data Manager

Key places to implement the Pool Data Manager:

1. **Token Data WebSocket Server**: When clients subscribe to token data
   - Update `websocket/token-data-ws.js` to use Pool Data Manager for on-demand data

2. **Token Monitoring Service**: When a new token is being monitored
   - Update `services/tokenMonitorService.js` to use Pool Data Manager

3. **Helius Pool Tracker**: When monitoring token prices
   - Already implemented in `helius-integration.js`

#### Implementation Status:
- ✅ Created integration with Helius pool tracker
- ⏳ Token Data WebSocket server integration pending
- ⏳ Token Monitoring Service integration pending

### 4. Database and Service Integration

To ensure data consistency:

1. The Pool Data Manager automatically creates token records if they don't exist
2. It's designed to work alongside the existing token sync service
3. It emits events that other services can listen for

#### Implementation Status:
- ✅ Added token record creation
- ✅ Added service event emission
- ✅ Implemented database transaction handling

### 5. Next Steps

To complete the integration:

1. Update the Token Data WebSocket server to use the Pool Data Manager
2. Update the Token Monitoring Service
3. Create a service initialization hook in `index.js`
4. Add to ServiceManager registry

### 6. Test Strategy

To validate the integration:

1. ✅ Direct tests with known tokens via `tests/direct-token-monitor.js`
2. ⏳ WebSocket connection tests
3. ⏳ Performance tests with multiple concurrent requests
4. ⏳ Integration tests with the full system