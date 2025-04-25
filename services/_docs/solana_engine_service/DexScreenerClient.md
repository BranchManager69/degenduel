# DexScreener Client

## Overview

The DexScreener Client in the SolanaEngine service provides access to DexScreener's API for comprehensive token and trading pair data. It complements the Jupiter Client by providing additional market data from a different source.

## Features

- Token profiles and boost information
- Trading pair details and pool data
- Order information for tokens
- Search functionality for pairs
- Rate-limited API access with sophisticated throttling

## Implementation Details

### Rate Limiting Strategy

The client implements a sophisticated rate limiting strategy to respect DexScreener's API limits:

```javascript
// Standard rate limit (60 req/min)
standardEndpoints: {
  maxRequestsPerMinute: 60,
  delayBetweenRequests: 1050, // Slightly over 1 second to be safe
},

// Enhanced rate limit (300 req/min)
enhancedEndpoints: {
  maxRequestsPerMinute: 300,
  delayBetweenRequests: 210, // Slightly over 200ms to be safe
}
```

Each endpoint type ('standard' or 'enhanced') has its own rate limit window tracking and enforcement.

### Concurrent Request Management

Like the Jupiter Client, the DexScreener Client implements a locking mechanism to prevent concurrent API calls:

```javascript
// Request locking to prevent concurrent calls
this.isRequestInProgress = false;
this.lastRequestTime = 0;

// In makeRequest method:
if (this.isRequestInProgress) {
  // Wait for the current request to complete
  // or proceed after timeout
}

// Set the lock before starting
this.isRequestInProgress = true;

try {
  // Make request...
} finally {
  // Always release the lock
  this.isRequestInProgress = false;
}
```

### Batch Processing

For endpoints that support multiple tokens, the client implements sequential batch processing with proper rate limiting:

```javascript
async getPoolsForMultipleTokens(chainId, tokenAddresses) {
  // Process tokens sequentially with proper rate limiting
  for (let i = 0; i < tokenAddresses.length; i++) {
    const tokenAddress = tokenAddresses[i];
    try {
      const tokenPools = await this.getPoolsByToken(chainId, tokenAddress);
      // Process result...
    } catch (error) {
      // Handle error...
    }
  }
}
```

## API Reference

### Initialization

```javascript
// Initialize the DexScreener client
const initialized = await dexscreenerClient.initialize();
```

### Token Profiles and Boosts

```javascript
// Get latest token profiles
const profiles = await dexscreenerClient.getLatestTokenProfiles();

// Get latest token boosts
const boosts = await dexscreenerClient.getLatestTokenBoosts();

// Get top tokens with most active boosts
const topBoosts = await dexscreenerClient.getTopTokenBoosts();
```

### Orders

```javascript
// Get orders paid for a token
const orders = await dexscreenerClient.getOrdersByToken('solana', 'tokenAddress');
```

### Pairs and Pools

```javascript
// Get pair details
const pair = await dexscreenerClient.getPairDetails('solana', 'pairAddress');

// Search for pairs matching a query
const searchResults = await dexscreenerClient.searchPairs('SOL/USDC');

// Get pools for a token
const pools = await dexscreenerClient.getTokenPools('solana', 'tokenAddress');

// Get pools for multiple tokens
const multiplePools = await dexscreenerClient.getMultipleTokenPools('solana', ['token1', 'token2']);
```

## Configuration

The DexScreener Client can be configured through the config system:

```javascript
// In dexscreener-config.js
export const dexscreenerConfig = {
  apiKey: DEXSCREENER_API_KEY,  // Optional API key
  baseUrl: 'https://api.dexscreener.com',
  // Additional configuration...
};
```

## Error Handling

The client implements comprehensive error handling with detailed logging:

```javascript
try {
  // API call...
} catch (error) {
  // Log detailed error
  logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch:')} ${error.message}`);
  
  // If we hit a rate limit, update the window count to max
  if (error.response?.status === 429) {
    window.callCount = window.maxCalls;
  }
  
  throw error;
}
```

## Integration with SolanaEngine

The DexScreener Client is designed to complement the Jupiter Client in the SolanaEngine service. While the Jupiter Client provides real-time price data, the DexScreener Client adds additional market data like token profiles, pools, and trading pairs.

## Integration with Token Refresh Scheduler

The DexScreener Client can be used by the Token Refresh Scheduler to add additional data sources for token information. The scheduler will respect the rate limits and locking mechanisms implemented in the client.