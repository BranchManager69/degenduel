# Jupiter Client

## Overview

The Jupiter Client in the SolanaEngine service is responsible for all market-related data and operations. It integrates with Jupiter's advanced API for price data, swap quotes, and trading operations.

## Features

### Price Data

- Real-time price streaming via WebSocket
- Historical price data retrieval
- Price subscription management
- Automated price caching

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

### WebSocket Connection

The client establishes and maintains a persistent WebSocket connection to Jupiter's API for real-time price updates:

```javascript
initializeWebSocket() {
  this.wsClient = new WebSocket(this.config.websocket.priceUrl);
  
  this.wsClient.on('open', () => {
    this.wsConnected = true;
    this.reconnectAttempts = 0;
    this.resubscribeToTokens();
  });
  
  // Additional event handlers...
}
```

### Token Subscription Management

The client provides methods to subscribe to and unsubscribe from token price updates:

```javascript
async subscribeToPrices(mintAddresses) {
  // Filter new tokens
  const newTokens = mintAddresses.filter(address => !this.subscriptions.has(address));
  
  // Create subscription message
  const subscriptionMessage = {
    type: 'subscribe',
    tokens: newTokens,
  };
  
  // Send subscription request
  this.wsClient.send(JSON.stringify(subscriptionMessage));
  
  // Update subscriptions map
  for (const address of newTokens) {
    this.subscriptions.set(address, true);
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

## API Reference

### Initialization

```javascript
// Initialize the Jupiter client
const jupiterInitialized = await jupiterClient.initialize();
```

### Price Operations

```javascript
// Get current prices for specified tokens
const prices = await jupiterClient.getPrices(['tokenMint1', 'tokenMint2']);

// Get price history for a token
const priceHistory = await jupiterClient.getPriceHistory('tokenMint', '7d');

// Subscribe to price updates
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
  baseUrl: 'https://quote-api.jup.ag',
  v6BaseUrl: 'https://quote-api.jup.ag/v6',
  priceApiUrl: 'https://price.jup.ag/v6',
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