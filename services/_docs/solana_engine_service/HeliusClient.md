# Helius Client

## Overview

The Helius Client in the SolanaEngine service provides direct access to Solana blockchain data using Helius' premium APIs. It handles token metadata, wallet operations, and blockchain queries with high reliability and performance.

## Features

### Token Metadata

- Detailed token metadata retrieval
- Metadata caching and validation
- Support for non-standard tokens
- Bulk token resolution

### Blockchain Operations

- RPC WebSocket connections
- Transaction submission and monitoring
- Account data querying
- Program data access

### Webhook Management

- Webhook creation and registration
- Real-time blockchain event notifications
- Webhook filtering and callback handling
- Webhook security management

## Implementation Details

### WebSocket Connection

The client establishes and maintains a persistent WebSocket connection to Helius' RPC endpoint:

```javascript
initializeWebSocket() {
  this.wsClient = new WebSocket(this.config.websocket.url);
  
  this.wsClient.on('open', () => {
    this.wsConnected = true;
    this.reconnectAttempts = 0;
    logApi.info('Connected to Helius WebSocket');
  });
  
  // Additional event handlers...
}
```

### RPC Request Handling

The client implements a request/response system for WebSocket RPC calls:

```javascript
async sendWebSocketRequest(method, params = [], timeout = 30000) {
  if (!this.wsConnected) {
    throw new Error('WebSocket not connected');
  }
  
  const id = this.requestId++;
  const request = {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
  
  return new Promise((resolve, reject) => {
    // Store the promise callbacks
    this.pendingRequests.set(id, { resolve, reject });
    
    // Set a timeout for this request
    const timeoutId = setTimeout(() => {
      if (this.pendingRequests.has(id)) {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out after ${timeout}ms`));
      }
    }, timeout);
    
    this.requestTimeouts.set(id, timeoutId);
    
    // Send the request
    this.wsClient.send(JSON.stringify(request));
  });
}
```

### Token Metadata Caching

Token metadata is cached in Redis with appropriate TTLs to improve performance:

```javascript
async getTokensMetadata(mintAddresses) {
  // Check Redis cache first
  const cachedTokens = [];
  const missingTokens = [];
  
  for (const mintAddress of mintAddresses) {
    const cachedData = await redisManager.get(`${this.redisKeys.tokenMetadata}${mintAddress}`);
    if (cachedData) {
      cachedTokens.push(JSON.parse(cachedData));
    } else {
      missingTokens.push(mintAddress);
    }
  }
  
  // Fetch missing tokens from Helius
  if (missingTokens.length > 0) {
    const response = await axios.post(this.config.rpcUrl, {
      jsonrpc: '2.0',
      id: 'helius-client',
      method: 'getTokenMetadata',
      params: [missingTokens],
    });
    
    const fetchedTokens = response.data.result;
    
    // Cache the fetched tokens
    for (const token of fetchedTokens) {
      await redisManager.set(
        `${this.redisKeys.tokenMetadata}${token.mint}`, 
        JSON.stringify(token), 
        60 * 60 * 24 // 24 hours
      );
    }
  }
  
  // Combine cached and fetched tokens
  return [...cachedTokens, ...fetchedTokens];
}
```

### Webhook Management

The client provides methods for creating and managing Helius webhooks:

```javascript
async createWebhook(webhookConfig) {
  const response = await axios.post(this.config.endpoints.webhooks.create, webhookConfig);
  return response.data;
}

async getWebhooks() {
  const response = await axios.get(this.config.endpoints.webhooks.get);
  return response.data;
}

async deleteWebhook(webhookId) {
  const response = await axios.delete(`${this.config.endpoints.webhooks.delete}&webhook_id=${webhookId}`);
  return response.data;
}
```

## API Reference

### Initialization

```javascript
// Initialize the Helius client
const heliusInitialized = await heliusClient.initialize();
```

### Token Operations

```javascript
// Get token metadata for a list of mint addresses
const tokenMetadata = await heliusClient.getTokensMetadata(['mint1', 'mint2']);
```

### Asset Search

```javascript
// Search for assets using Digital Asset Standard (DAS) API
const searchParams = {
  ownerAddress: 'walletAddress',
  tokenType: 'ft', // or 'nft'
  limit: 50
};
const assets = await heliusClient.searchAssets(searchParams);
```

### Webhook Operations

```javascript
// Create a webhook for real-time notifications
const webhookConfig = {
  webhook: 'https://my-api.com/webhook',
  transactionTypes: ['TOKEN_TRANSFER'],
  accountAddresses: ['walletAddress1', 'walletAddress2']
};
const webhook = await heliusClient.createWebhook(webhookConfig);

// Get all webhooks
const webhooks = await heliusClient.getWebhooks();

// Delete a webhook
await heliusClient.deleteWebhook('webhookId');
```

### WebSocket RPC

```javascript
// Send a custom RPC request via WebSocket
const result = await heliusClient.sendWebSocketRequest('getProgramAccounts', [
  'programAddress',
  { encoding: 'jsonParsed' }
]);
```

## Configuration

The Helius Client can be configured through the config system:

```javascript
// In helius-config.js
export const heliusConfig = {
  apiKey: HELIUS_API_KEY,
  baseUrl: 'https://api.helius.xyz',
  rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
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

The Helius Client is tightly integrated with the SolanaEngine service to provide a unified API for blockchain data and operations. The SolanaEngine service orchestrates requests between the Helius Client and Jupiter Client based on the operation type.