# DegenDuel Pool Monitoring Guide

This guide explains how to integrate with the DegenDuel WebSocket-based liquidity pool monitoring system. The system provides real-time updates for liquidity pools across different DEXes (Raydium, Orca, PumpSwap, etc.).

## Overview

The pool monitoring system uses WebSockets to provide real-time updates when pool events occur. Instead of polling for pool changes, clients subscribe to pool activity through the WebSocket connection and receive push notifications for events like swaps, liquidity additions/removals, and general pool state changes.

### Key Features

- **Real-time Updates**: Pool changes are pushed to clients immediately when detected on the blockchain
- **WebSocket-based**: No need for polling, reducing server load and bandwidth
- **Multiple Event Types**: Subscribe to specific event types (swaps, liquidity changes, etc.)
- **Token-centric View**: Find and monitor all pools for a given token
- **DEX Support**: Works with multiple DEXes (Raydium, Orca, PumpSwap)

## Integration

### WebSocket Connection

First, establish a WebSocket connection to the DegenDuel WebSocket server (same as for wallet balance tracking):

```javascript
const wsUrl = 'wss://api.degenduel.com/ws';
const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  console.log('Connected to DegenDuel WebSocket');
  // Authenticate after connection (required)
  authenticate();
};

ws.onclose = () => {
  console.log('Disconnected from DegenDuel WebSocket');
  // Implement reconnection logic here
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  handleMessage(message);
};

// Authentication function
function authenticate() {
  const authMessage = {
    type: 'AUTHENTICATE',
    token: 'your-auth-token' // Get this from your authentication process
  };
  ws.send(JSON.stringify(authMessage));
}

// Message handler
function handleMessage(message) {
  switch (message.type) {
    case 'AUTHENTICATED':
      console.log('Authentication successful');
      // Now you can subscribe to pool events
      subscribeToPoolEvents();
      break;
    case 'POOL_UPDATE':
      console.log('Pool update event:', message);
      // Update UI with new pool data
      updatePoolDataUI(message);
      break;
    case 'SWAP':
      console.log('Swap event in pool:', message);
      // Handle swap event
      handleSwapEvent(message);
      break;
    case 'LIQUIDITY_ADD':
      console.log('Liquidity add event:', message);
      // Handle liquidity addition
      handleLiquidityAddEvent(message);
      break;
    case 'LIQUIDITY_REMOVE':
      console.log('Liquidity remove event:', message);
      // Handle liquidity removal
      handleLiquidityRemoveEvent(message);
      break;
    case 'TOKEN_POOLS':
      console.log('Pools for token:', message);
      // Display pools for the requested token
      displayTokenPools(message.pools);
      break;
    // Handle other message types
  }
}
```

### Finding Pools for a Token

Before subscribing to pool events, you may want to find which pools exist for a specific token:

```javascript
function getPoolsForToken(tokenAddress) {
  const message = {
    type: 'GET_POOLS_FOR_TOKEN',
    tokenAddress
  };
  ws.send(JSON.stringify(message));
}
```

The server will respond with a message of type `TOKEN_POOLS`:

```javascript
{
  type: 'TOKEN_POOLS',
  tokenAddress: 'the-token-address',
  pools: [
    {
      poolAddress: 'pool-address-1',
      tokenAddress: 'the-token-address',
      dex: 'RAYDIUM_AMM_V4',
      programId: 'program-id',
      tokenSymbol: 'DD'
    },
    {
      poolAddress: 'pool-address-2',
      tokenAddress: 'the-token-address',
      dex: 'PUMP_SWAP',
      programId: 'program-id',
      tokenSymbol: 'DD'
    }
  ],
  count: 2,
  timestamp: '2023-04-06T12:34:56.789Z'
}
```

### Subscribing to Pool Events

After authenticating and finding the pools you're interested in, you can subscribe to pool events:

```javascript
function subscribeToPoolEvents(poolAddress, tokenAddress, eventType = 'all') {
  const subscription = {
    type: 'SUBSCRIBE',
    resource: 'pool_events',
    poolAddress,
    tokenAddress,
    eventType // 'all', 'pool_update', 'swap', 'liquidity_add', 'liquidity_remove'
  };
  ws.send(JSON.stringify(subscription));
}
```

The `eventType` parameter can be one of:
- `'all'`: Subscribe to all event types
- `'pool_update'`: General pool state changes
- `'swap'`: Swap events (tokens entering or leaving the pool)
- `'liquidity_add'`: Liquidity addition events
- `'liquidity_remove'`: Liquidity removal events

### Handling Pool Events

The server will send pool events in the following formats:

```javascript
// Pool update event
{
  type: 'POOL_UPDATE',
  poolAddress: 'the-pool-address',
  tokenAddress: 'the-token-address',
  data: {
    // Pool-specific data structure, varies by DEX
    poolAddress: 'the-pool-address',
    tokenAddress: 'the-token-address',
    tokenSymbol: 'DD',
    dex: 'RAYDIUM_AMM_V4',
    data: {
      // DEX-specific pool data
    }
  },
  timestamp: '2023-04-06T12:34:56.789Z'
}

// Swap event
{
  type: 'SWAP',
  poolAddress: 'the-pool-address',
  tokenAddress: 'the-token-address',
  fromAddress: 'source-address', // May be the pool address if tokens are leaving
  toAddress: 'destination-address', // May be the pool address if tokens are entering
  amount: 1000.5, // Amount of tokens involved
  data: {
    // Pool data after the swap
  },
  timestamp: '2023-04-06T12:34:56.789Z'
}

// Liquidity events follow a similar structure
```

### Unsubscribing from Pool Events

When you no longer need pool events, you can unsubscribe:

```javascript
function unsubscribeFromPoolEvents(poolAddress, tokenAddress, eventType = 'all') {
  const unsubscribeMessage = {
    type: 'UNSUBSCRIBE',
    resource: 'pool_events',
    poolAddress,
    tokenAddress,
    eventType // 'all', 'pool_update', 'swap', 'liquidity_add', 'liquidity_remove'
  };
  ws.send(JSON.stringify(unsubscribeMessage));
}
```

### Refreshing Pool Data

If you need to force a refresh of pool data:

```javascript
function refreshPoolData(poolAddress) {
  const refreshMessage = {
    type: 'REFRESH',
    resource: 'pool_data',
    poolAddress
  };
  ws.send(JSON.stringify(refreshMessage));
}
```

## React Integration Example

Here's an example of how to integrate with React:

```jsx
import React, { useEffect, useState, useRef } from 'react';

function PoolMonitor({ authToken, tokenAddress }) {
  const [pools, setPools] = useState([]);
  const [selectedPool, setSelectedPool] = useState(null);
  const [poolData, setPoolData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const wsRef = useRef(null);

  useEffect(() => {
    // Initialize WebSocket connection
    const wsUrl = 'wss://api.degenduel.com/ws';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to WebSocket');
      setConnected(true);
      
      // Authenticate
      ws.send(JSON.stringify({
        type: 'AUTHENTICATE',
        token: authToken
      }));
    };

    ws.onclose = () => {
      console.log('WebSocket connection closed');
      setConnected(false);
      
      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        if (wsRef.current === ws) { // Only reconnect if this is still the current ws
          console.log('Attempting to reconnect...');
          // The useEffect cleanup will handle the old connection
          // and the useEffect will run again to create a new one
          setConnected(false);
        }
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'AUTHENTICATED':
          // Get pools for the token
          ws.send(JSON.stringify({
            type: 'GET_POOLS_FOR_TOKEN',
            tokenAddress
          }));
          break;
          
        case 'TOKEN_POOLS':
          setPools(message.pools);
          break;
          
        case 'POOL_UPDATE':
        case 'SWAP':
        case 'LIQUIDITY_ADD':
        case 'LIQUIDITY_REMOVE':
          if (message.poolAddress === selectedPool?.poolAddress) {
            setPoolData(message.data);
            
            // Add event to history
            setEvents(prev => [
              {
                type: message.type,
                timestamp: message.timestamp,
                ...message
              },
              ...prev.slice(0, 9) // Keep last 10 events
            ]);
          }
          break;
          
        default:
          // Handle other message types
          break;
      }
    };

    // Cleanup function
    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        // Unsubscribe from any active subscriptions
        if (selectedPool) {
          ws.send(JSON.stringify({
            type: 'UNSUBSCRIBE',
            resource: 'pool_events',
            poolAddress: selectedPool.poolAddress,
            tokenAddress
          }));
        }
        ws.close();
      }
    };
  }, [authToken, tokenAddress]);

  // Effect to subscribe/unsubscribe when selected pool changes
  useEffect(() => {
    if (!connected || !wsRef.current || !selectedPool) return;
    
    // Subscribe to the new pool
    wsRef.current.send(JSON.stringify({
      type: 'SUBSCRIBE',
      resource: 'pool_events',
      poolAddress: selectedPool.poolAddress,
      tokenAddress,
      eventType: 'all'
    }));
    
    // Unsubscribe when selection changes
    return () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'UNSUBSCRIBE',
          resource: 'pool_events',
          poolAddress: selectedPool.poolAddress,
          tokenAddress,
          eventType: 'all'
        }));
      }
    };
  }, [connected, selectedPool, tokenAddress]);

  const handlePoolSelect = (pool) => {
    setSelectedPool(pool);
    setPoolData(null);
    setEvents([]);
  };

  const refreshPool = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && selectedPool) {
      wsRef.current.send(JSON.stringify({
        type: 'REFRESH',
        resource: 'pool_data',
        poolAddress: selectedPool.poolAddress
      }));
    }
  };

  return (
    <div className="pool-monitor">
      <h2>Pool Monitor for {tokenAddress}</h2>
      <div className="connection-status">
        Status: {connected ? 'Connected' : 'Disconnected'}
      </div>
      
      <div className="pools-list">
        <h3>Available Pools</h3>
        {pools.length > 0 ? (
          <ul>
            {pools.map(pool => (
              <li 
                key={pool.poolAddress}
                onClick={() => handlePoolSelect(pool)}
                className={selectedPool?.poolAddress === pool.poolAddress ? 'selected' : ''}
              >
                {pool.dex} - {pool.tokenSymbol}
              </li>
            ))}
          </ul>
        ) : (
          <p>No pools found for this token</p>
        )}
      </div>
      
      {selectedPool && (
        <div className="pool-details">
          <h3>Pool Details</h3>
          <p>DEX: {selectedPool.dex}</p>
          <p>Pool Address: {selectedPool.poolAddress}</p>
          <button onClick={refreshPool} disabled={!connected}>
            Refresh Pool Data
          </button>
          
          {poolData && (
            <div className="pool-data">
              <h4>Current Pool Data</h4>
              <pre>{JSON.stringify(poolData, null, 2)}</pre>
            </div>
          )}
          
          <div className="event-history">
            <h4>Recent Events</h4>
            {events.length > 0 ? (
              <ul>
                {events.map((event, index) => (
                  <li key={index}>
                    {new Date(event.timestamp).toLocaleTimeString()} - {event.type}
                    {event.type === 'SWAP' && (
                      <span> ({event.amount} tokens)</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No events yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PoolMonitor;
```

## Error Handling

The server may return error messages in the following format:

```javascript
{
  type: 'ERROR',
  code: 'ERROR_CODE', // One of the error codes listed below
  message: 'Human-readable error message',
  timestamp: '2023-04-06T12:34:56.789Z'
}
```

Common error codes:

- `INVALID_PARAMS`: Missing or invalid parameters in the request
- `INVALID_POOL_ADDRESS`: The pool address provided is not valid
- `INVALID_TOKEN_ADDRESS`: The token address provided is not valid
- `INVALID_EVENT_TYPE`: The event type is not recognized
- `POOL_NOT_FOUND`: The requested pool does not exist
- `SUBSCRIPTION_ERROR`: Error subscribing to the requested resource
- `REFRESH_ERROR`: Error refreshing the requested resource
- `FETCH_ERROR`: Error fetching the requested data

## Combining with Balance Tracking

The pool monitoring system can be used alongside the wallet balance tracking system. Both use the same WebSocket connection, so you can subscribe to both pool events and balance updates simultaneously:

```javascript
// After authentication, subscribe to both
function setupSubscriptions() {
  // Subscribe to balance updates
  ws.send(JSON.stringify({
    type: 'SUBSCRIBE',
    resource: 'token_balance',
    walletAddress: 'your-wallet-address'
  }));
  
  // Subscribe to pool events
  ws.send(JSON.stringify({
    type: 'SUBSCRIBE',
    resource: 'pool_events',
    poolAddress: 'pool-address',
    tokenAddress: 'token-address',
    eventType: 'all'
  }));
}
```

## Security Considerations

1. **Authentication**: All WebSocket connections require authentication.
2. **Address Validation**: All addresses are validated on the server.
3. **Rate Limiting**: Don't send too many requests in a short period.
4. **Error Handling**: Properly handle errors from the server.

## Next Steps

For more information or support, please contact the DegenDuel development team.