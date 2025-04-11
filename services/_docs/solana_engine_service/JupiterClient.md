# Jupiter Client

## Overview

The Jupiter Client in the SolanaEngine service is responsible for all market-related data and operations. It integrates with Jupiter's advanced API for price data, swap quotes, and trading operations.

**IMPORTANT NOTE**: As of April 2025, automatic price polling is disabled by default to avoid conflicts with the TokenRefreshScheduler. The TokenRefreshScheduler is now the primary mechanism for token price updates.

## Features

### Price Data

- Historical price data retrieval
- Price subscription management
- Automated price caching
- Optional automatic polling (disabled by default)

### Trading Operations

- Swap quotes generation
- Best route discovery
- Slippage calculation
- Fee estimation

### Market Data

- Token liquidity information
- Volume tracking
- Market depth analysis
- Token list management

## Implementation Details

### Price Polling and Rate Limiting

The client implements a polling mechanism to fetch price updates, but this is disabled by default to avoid conflicts with the TokenRefreshScheduler:

```javascript
class PriceService extends JupiterBase {
  constructor(config) {
    // Polling configuration
    this.pollingInterval = null;
    this.pollingFrequency = 30000; // 30 seconds (if enabled)
    this.automaticPollingEnabled = false; // Disabled by default
    
    // Lock to prevent concurrent API calls
    this.isFetchingPrices = false;
    this.lastFetchTime = 0;
    this.minimumFetchGap = 15000; // 15 second minimum between fetches
  }
}
```

### Token Subscription Management

The client provides methods to subscribe to and unsubscribe from token price updates:

```javascript
async subscribeToPrices(mintAddresses) {
  // Filter new tokens
  const newTokens = mintAddresses.filter(address => !this.subscriptions.has(address));
  
  // Update subscriptions map
  for (const address of newTokens) {
    this.subscriptions.set(address, true);
  }
  
  // Note: Automatic polling is disabled by default
  // The TokenRefreshScheduler will handle price updates
  
  // If automatic polling is enabled and not already started, start it
  if (this.automaticPollingEnabled && this.subscriptions.size > 0 && !this.pollingInterval) {
    this.startPolling();
  }
}
```

### Price Caching Strategy

Prices are cached in Redis with appropriate TTLs to balance freshness with performance:

```javascript
async updateTokenPrices(priceData) {
  for (const [mintAddress, priceInfo] of Object.entries(priceData)) {
    // Store price data in Redis
    await redisManager.set(
      `${this.redisKeys.tokenPrices}${mintAddress}`,
      JSON.stringify(priceInfo),
      60 * 60 // 1 hour
    );
  }
  
  // Update the last update timestamp
  await redisManager.set(this.redisKeys.lastUpdate, Date.now().toString());
}
```

### Price Update Callbacks

The client implements a callback system for real-time price updates:

```javascript
onPriceUpdate(callback) {
  this.priceUpdateCallbacks.push(callback);
  return () => {
    this.priceUpdateCallbacks = this.priceUpdateCallbacks.filter(cb => cb !== callback);
  };
}

notifyPriceUpdateCallbacks(priceData) {
  for (const callback of this.priceUpdateCallbacks) {
    try {
      callback(priceData);
    } catch (error) {
      logApi.error(`Error in price update callback: ${error.message}`);
    }
  }
}
```

## Concurrent Request Handling

The client implements a locking mechanism to prevent concurrent API calls and rate limit issues:

```javascript
async getPrices(mintAddresses) {
  // Check if a price fetch is already in progress
  if (this.isFetchingPrices) {
    logApi.info('Delaying price fetch as a previous batch is still processing');
    
    // Wait with timeout for the current operation to complete
    const maxWaitMs = 5000;
    const startWait = Date.now();
    while (this.isFetchingPrices && (Date.now() - startWait < maxWaitMs)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Set the lock before starting the fetch
  this.isFetchingPrices = true;
  this.lastFetchTime = Date.now();
  
  try {
    // API call logic here...
    return priceData;
  } finally {
    // Always release the lock when done
    this.isFetchingPrices = false;
  }
}
```

## API Reference

### Initialization

```javascript
// Initialize the Jupiter client
const jupiterInitialized = await jupiterClient.initialize();
```

### Controlling Automatic Polling

```javascript
// Enable automatic polling (use with caution)
jupiterClient.setAutomaticPolling(true);

// Disable automatic polling (default)
jupiterClient.setAutomaticPolling(false);
```

### Price Operations

```javascript
// Get current prices for specified tokens
const prices = await jupiterClient.getPrices(['tokenMint1', 'tokenMint2']);

// Get price history for a token
const priceHistory = await jupiterClient.getPriceHistory('tokenMint', '7d');

// Subscribe to price updates (note: doesn't start polling by default)
await jupiterClient.subscribeToPrices(['tokenMint1', 'tokenMint2']);

// Unsubscribe from price updates
await jupiterClient.unsubscribeFromPrices(['tokenMint1', 'tokenMint2']);

// Register callback for price updates
const unsubscribe = jupiterClient.onPriceUpdate((priceData) => {
  console.log('Received price updates:', priceData);
});
```

### Trading Operations

```javascript
// Get a swap quote
const quote = await jupiterClient.getSwapQuote({
  inputMint: 'inputTokenMint',
  outputMint: 'outputTokenMint',
  amount: '1000000000' // Amount in lamports
});
```

### Token Information

```javascript
// Get details about a specific token
const tokenInfo = jupiterClient.getTokenInfo('tokenMint');
```

## Configuration

The Jupiter Client can be configured through the config system:

```javascript
// In jupiter-config.js
export const jupiterConfig = {
  apiKey: JUPITER_API_KEY,
  baseUrl: 'https://api.jup.ag', // or https://lite-api.jup.ag for free tier
  swapApiUrl: 'https://api.jup.ag/swap/v1',
  priceApiUrl: 'https://api.jup.ag/price/v2',
  tokenApiUrl: 'https://api.jup.ag/tokens/v1',
  // Additional configuration...
};
```

## Error Handling

The client implements robust error handling with retry logic, reconnection strategies, and detailed logging:

```javascript
// WebSocket reconnection with exponential backoff
this.wsClient.on('close', () => {
  this.wsConnected = false;
  
  if (this.reconnectAttempts < this.config.websocket.maxReconnectAttempts) {
    const reconnectDelay = this.config.websocket.reconnectInterval * 
      Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    
    setTimeout(() => {
      this.initializeWebSocket();
    }, reconnectDelay);
  }
});
```

## Integration with SolanaEngine

The Jupiter Client is tightly integrated with the SolanaEngine service to provide a unified API for market data and trading operations. The SolanaEngine service orchestrates requests between the Jupiter Client and Helius Client based on the operation type.