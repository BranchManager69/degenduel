<div align="center">
  <img src="https://degenduel.me/assets/media/logos/transparent_WHITE.png" alt="DegenDuel Logo (White)" width="300">
  
  [![Node.js](https://img.shields.io/badge/Node.js-20.x-green)](https://nodejs.org/)
  [![Express](https://img.shields.io/badge/Express-4.x-lightgrey)](https://expressjs.com/)
  [![Solana](https://img.shields.io/badge/Solana-RPC-green)](https://solana.com/)
  [![WebSocket](https://img.shields.io/badge/PubSub-Proxy-orange)](https://solana.com/docs/rpc/websocket)
  [![Security](https://img.shields.io/badge/Security-Tiered%20Access-red)](https://jwt.io/)
</div>

# 🔒 Solana RPC Proxy System 🔒

## Overview

The DegenDuel platform includes a secure proxy system for Solana RPC and WebSocket (PubSub) connections. This system allows frontend applications to interact with the Solana blockchain without exposing API keys or RPC endpoints.

The proxy system consists of two main components:

1. **HTTP RPC Proxy**: For standard JSON-RPC requests
2. **WebSocket PubSub Proxy**: For real-time account subscriptions

## HTTP RPC Proxy

### Endpoint

```
/api/solana-rpc
```

### Authentication and Access Tiers

The proxy implements three access tiers with different rate limits and capabilities:

| Tier | Access Level | Rate Limit | Requirements |
|------|-------------|------------|--------------|
| Public | Basic | 10 req/min | No authentication |
| User | Standard | 120 req/min | Valid JWT token |
| Admin | Enhanced | 1000 req/min | Admin/Superadmin role |

### Method Restrictions

For security reasons, certain methods are restricted based on access tier:

| Method Category | Public Tier | User Tier | Admin Tier |
|----------------|------------|-----------|------------|
| Read-only (getBalance, getAccountInfo) | ✓ | ✓ | ✓ |
| Program queries (getProgramAccounts) | Partial | ✓ | ✓ |
| Transaction methods | ✓ | ✓ | ✓ |
| Simulation methods | ✗ | ✓ | ✓ |
| Advanced methods | ✗ | Partial | ✓ |
| Admin methods | ✗ | ✗ | ✓ |

### Implementation

The HTTP RPC proxy is implemented in `/routes/solana-rpc-proxy.js` with the following components:

1. **Rate Limiting**: Using Express rate-limit middleware
2. **Authentication**: JWT verification for user/admin tiers
3. **Method Validation**: Ensures requested methods are allowed for the tier
4. **Proxy Logic**: Forwards valid requests to the appropriate Solana RPC endpoint

```javascript
// Rate limits by tier
const SOLANA_RPC_RATE_LIMITS = {
  PUBLIC: 10,     // Public tier (anonymous users): 10 requests per minute
  USER: 120,      // User tier (authenticated users): 120 requests per minute
  ADMIN: 1000,    // Admin/superadmin tier: 1000 requests per minute
};
```

## WebSocket PubSub Proxy

### Endpoint

```
/api/v69/ws
```

### Authentication and Subscription Limits

The WebSocket proxy implements similar tiered access with subscription limits:

| Tier | Subscription Limit | Requirements |
|------|-------------------|--------------|
| Public | 5 accounts | No authentication |
| User | 10 accounts | Valid authentication |
| Admin | 1000 accounts | Admin/Superadmin role |

### Implementation

The WebSocket PubSub proxy is implemented within the unified WebSocket system in `/websocket/v69/unified/services.js`:

```javascript
// Subscription limits by tier
const SOLANA_SUBSCRIPTION_LIMITS = {
  PUBLIC: 5,      // Public tier (anonymous users): 5 accounts max
  USER: 10,       // User tier (authenticated users): 10 accounts max
  ADMIN: 1000,    // Admin/superadmin tier: 1000 accounts max
};
```

The implementation features:

1. **Unified WebSocket Protocol**: Uses existing WebSocket infrastructure
2. **Topic Subscription**: `solana:pubsub` topic for PubSub operations
3. **Account Subscription Management**: Tracks and limits subscriptions by client
4. **Message Forwarding**: Relays Solana account updates to subscribed clients
5. **Role Normalization**: Properly handles role comparisons by normalizing to lowercase

## Usage Examples

### HTTP RPC Example

```javascript
// Frontend code
async function getSolanaBalance(publicKey) {
  const response = await fetch('/api/solana-rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userJwtToken}` // Optional for user/admin tier
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBalance',
      params: [publicKey]
    })
  });
  
  return await response.json();
}
```

### WebSocket PubSub Example

```javascript
// Frontend code
const ws = new WebSocket('wss://yourserver.com/api/v69/ws');

// Setup connection
ws.onopen = () => {
  // Authenticate (for user/admin tier)
  ws.send(JSON.stringify({
    type: 'AUTH',
    token: userJwtToken // Optional for user/admin tier
  }));
  
  // Subscribe to Solana PubSub
  ws.send(JSON.stringify({
    type: 'SUBSCRIBE',
    topic: 'solana:pubsub',
    params: {
      action: 'accountSubscribe',
      accounts: ['Your_Wallet_Address_Here']
    }
  }));
};

// Handle incoming messages
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.topic === 'solana:pubsub' && data.type === 'UPDATE') {
    console.log('Account update received:', data.data);
  }
};
```

## Security Considerations

1. **API Key Protection**: RPC endpoint URLs and API keys never leave the server
2. **Rate Limiting**: Prevents abuse of RPC quotas
3. **Method Restriction**: Limits access to sensitive operations
4. **Subscription Limits**: Prevents excessive WebSocket subscriptions
5. **Role Verification**: Ensures proper access control

## Performance Optimizations

1. **Connection Pooling**: Reuses connections to Solana RPC endpoints
2. **Response Caching**: Implements cache for frequently requested data
3. **Batch Processing**: Optimizes subscription requests in batches
4. **Error Handling**: Graceful handling of connection issues

## Monitoring and Maintenance

The proxy system includes monitoring capabilities:

1. **Usage Metrics**: Tracks request volumes by tier
2. **Error Logging**: Records failed requests and reasons
3. **Health Checks**: Monitors RPC endpoint availability
4. **Subscription Stats**: Tracks active WebSocket subscriptions

## Configuration

Configuration is managed through environment variables:

```
# RPC endpoint selection
SOLANA_RPC_PRIMARY=https://helius-endpoint.example.com
SOLANA_RPC_BACKUP=https://backup-endpoint.example.com

# Rate limiting configuration
SOLANA_RPC_PUBLIC_RATE_LIMIT=10
SOLANA_RPC_USER_RATE_LIMIT=120
SOLANA_RPC_ADMIN_RATE_LIMIT=1000

# WebSocket subscription limits
SOLANA_PUBSUB_PUBLIC_LIMIT=5
SOLANA_PUBSUB_USER_LIMIT=10
SOLANA_PUBSUB_ADMIN_LIMIT=1000
```

---

<div align="center">
  <h3>⚔️ DEGENDUEL ⚔️</h3>
  <p>Secure blockchain interactions with tiered access control.</p>
  <p><b>© Branch Manager Productions.</b> All rights reserved.</p>
  <img src="https://img.shields.io/badge/SECURE-BY%20DESIGN-red?style=for-the-badge" alt="Secure by Design" />
</div>