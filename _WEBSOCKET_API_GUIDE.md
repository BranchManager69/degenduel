# DegenDuel WebSocket API Guide

## Overview

This document provides a comprehensive overview of the DegenDuel WebSocket API. The platform uses a unified WebSocket system where all data flows through a single connection with topic-based subscriptions.

## Quick Start

```javascript
// Connect to the WebSocket
const socket = new WebSocket('wss://degenduel.me/api/v69/ws');

// Handle connection open
socket.onopen = () => {
  console.log('Connected to DegenDuel WebSocket');
  
  // Subscribe to market data
  socket.send(JSON.stringify({
    type: 'SUBSCRIBE',
    topics: ['market-data']
  }));
};

// Handle incoming messages
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

## Connection Information

- **Main WebSocket endpoint**: `/api/v69/ws`
- **Authentication**: Required for private data (user, portfolio, wallet)
- **Protocol**: WebSocket (WSS)

## Authentication Flow

1. **Cookie-based authentication**: The server checks for a session cookie containing a JWT token
2. **Token verification**: The token is decoded and verified
3. **User lookup**: The user is looked up in the database
4. **Device verification**: For secure operations, device authentication may be required

Alternatively, you can authenticate by providing a token in your subscription message:

```javascript
socket.send(JSON.stringify({
  type: 'SUBSCRIBE',
  topics: ['portfolio', 'user'],
  authToken: 'your-jwt-token'
}));
```

## Available Topics

| Topic | Description | Auth Required |
|-------|-------------|---------------|
| `market-data` | Real-time market data including token prices and stats | No |
| `portfolio` | User's portfolio updates and performance | Yes |
| `system` | System status, announcements and heartbeats | No |
| `contest` | Contest updates, entries and results | No (public), Yes (personal) |
| `user` | User-specific notifications and data | Yes |
| `admin` | Administrative information | Yes (admin role) |
| `wallet` | Wallet updates and transaction information | Yes |
| `wallet-balance` | Real-time balance updates | Yes |
| `skyduel` | Game-specific information | No (public), Yes (personal) |
| `logs` | Client-side logs (special topic) | No |

## Message Types

### Client → Server

1. **SUBSCRIBE**: Subscribe to one or more topics
   ```json
   {
     "type": "SUBSCRIBE",
     "topics": ["market-data", "system"]
   }
   ```

2. **UNSUBSCRIBE**: Unsubscribe from topics
   ```json
   {
     "type": "UNSUBSCRIBE",
     "topics": ["portfolio"]
   }
   ```

3. **REQUEST**: Request specific data
   ```json
   {
     "type": "REQUEST",
     "topic": "market-data",
     "action": "getToken",
     "symbol": "btc",
     "requestId": "123"
   }
   ```

4. **COMMAND**: Execute an action (requires authentication)
   ```json
   {
     "type": "COMMAND",
     "topic": "portfolio",
     "action": "refreshBalance"
   }
   ```

5. **LOGS**: Send client logs to server
   ```json
   {
     "type": "LOGS",
     "logs": [
       { "level": "info", "message": "App initialized", "timestamp": "2025-04-07T15:30:00Z" }
     ]
   }
   ```

### Server → Client

1. **DATA**: Data response or update
   ```json
   {
     "type": "DATA",
     "topic": "market-data",
     "action": "getToken",
     "requestId": "123",
     "data": { /* token data */ },
     "timestamp": "2025-04-07T15:30:00Z"
   }
   ```

2. **ERROR**: Error message
   ```json
   {
     "type": "ERROR",
     "code": 4010,
     "message": "Authentication required for restricted topics",
     "timestamp": "2025-04-07T15:30:00Z"
   }
   ```

3. **SYSTEM**: System messages and heartbeats
   ```json
   {
     "type": "SYSTEM",
     "action": "heartbeat",
     "timestamp": "2025-04-07T15:30:00Z"
   }
   ```

4. **ACKNOWLEDGMENT**: Confirms subscription/unsubscription
   ```json
   {
     "type": "ACKNOWLEDGMENT",
     "operation": "subscribe",
     "topics": ["market-data", "system"],
     "timestamp": "2025-04-07T15:30:00Z"
   }
   ```

## Topic-Specific Data and Actions

### `market-data` Topic

**Actions**:
- `getToken`: Get data for a specific token
- `getAllTokens`: Get data for all available tokens

**Data structure**:
```json
{
  "symbol": "btc",
  "name": "Bitcoin",
  "price": 69420.12,
  "change24h": 2.5,
  "volume24h": 1234567890,
  "marketCap": 1234567890000
}
```

### `portfolio` Topic

**Actions**:
- `getProfile`: Get user's portfolio profile
- `getHoldings`: Get user's token holdings
- `getPerformance`: Get portfolio performance metrics

**Data structure**:
```json
{
  "totalValue": 12345.67,
  "change24h": 3.1,
  "holdings": [
    {
      "symbol": "btc",
      "amount": 0.5,
      "value": 34710.06
    }
  ]
}
```

### `system` Topic

**Actions**:
- `getStatus`: Get system status information
- `ping`: Heartbeat request
- `getMetrics`: Get system metrics (admin only)

**Data structure**:
```json
{
  "status": "operational",
  "version": "1.0.0",
  "serverTime": "2025-04-07T15:30:00Z",
  "uptime": 86400
}
```

### `user` Topic

**Actions**:
- `getProfile`: Get user profile information
- `getStats`: Get user statistics
- `getAuthStatus`: Get authentication status

**Data structure**:
```json
{
  "nickname": "Branch",
  "role": "superadmin",
  "wallet_address": "BPuRhk...",
  "created_at": "2025-01-01T00:00:00Z",
  "last_login": "2025-04-07T15:00:00Z"
}
```

## Authentication Methods

DegenDuel supports multiple authentication methods that all work with the WebSocket API:

### 1. Standard Session Cookie

This is the default method where the JWT token is stored in a secure HTTP-only cookie named `session`. The WebSocket connection will automatically use this cookie for authentication.

### 2. Manual Token Authentication

Include an `authToken` in your subscription message for topics that require authentication:

```json
{
  "type": "SUBSCRIBE",
  "topics": ["portfolio", "user"],
  "authToken": "your-jwt-token"
}
```

### 3. Biometric Authentication (WebAuthn)

DegenDuel supports Face ID, Touch ID, and other FIDO2 biometric authentication methods. The flow is:

1. Register a biometric credential:
   - `POST /api/auth/biometric/register-options`
   - `POST /api/auth/biometric/register-verify`

2. Authenticate using the biometric credential:
   - `POST /api/auth/biometric/auth-options`
   - `POST /api/auth/biometric/auth-verify`

After successful biometric authentication, a JWT token is stored in the session cookie, which the WebSocket connection can use.

### 4. Device Authentication

Some operations require device authentication. Include the device ID in your WebSocket connection via HTTP headers:

- `x-device-id`: Unique identifier for the client device

## Error Codes

| Code | Description |
|------|-------------|
| 4000 | Invalid message format |
| 4001 | Missing message type |
| 4003 | Subscription requires at least one topic |
| 4010 | Authentication required for restricted topics |
| 4011 | Invalid authentication token |
| 4012 | Admin role required for admin topics |
| 4040 | Resource not found |
| 4050 | Connection state invalid |
| 4401 | Token expired |
| 5000 | Internal server error |

## Security Considerations

1. WebSocket connections use secure WebSockets (WSS) protocol
2. JWT tokens have a 12-hour expiration period
3. Authentication tokens should never be exposed in client-side code
4. Biometric authentication provides an additional layer of security
5. Device authentication adds further protection for sensitive operations

## Reconnection Strategy

Implementing a robust reconnection strategy is crucial for reliable WebSocket usage:

```javascript
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]; // milliseconds
let reconnectAttempt = 0;

function connectWebSocket() {
  const socket = new WebSocket('wss://degenduel.me/api/v69/ws');
  
  socket.onopen = () => {
    console.log('Connected to DegenDuel WebSocket');
    reconnectAttempt = 0;
    // Subscribe to topics...
  };
  
  socket.onclose = (event) => {
    if (reconnectAttempt < RECONNECT_DELAYS.length) {
      const delay = RECONNECT_DELAYS[reconnectAttempt];
      console.log(`Reconnecting in ${delay}ms...`);
      setTimeout(() => {
        reconnectAttempt++;
        connectWebSocket();
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
    }
  };
  
  // Other event handlers...
  
  return socket;
}

const socket = connectWebSocket();
```

## React Integration

Here's a simple React hook for using the DegenDuel WebSocket:

```jsx
import { useState, useEffect, useCallback, useRef } from 'react';

export function useDegenDuelWebSocket(topics = [], options = {}) {
  const [data, setData] = useState({});
  const [status, setStatus] = useState('disconnected');
  const socketRef = useRef(null);
  const { autoConnect = true, authToken = null } = options;
  
  const connect = useCallback(() => {
    if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || 
                              socketRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    
    setStatus('connecting');
    const socket = new WebSocket('wss://degenduel.me/api/v69/ws');
    
    socket.onopen = () => {
      setStatus('connected');
      
      // Subscribe to topics
      if (topics.length > 0) {
        const message = {
          type: 'SUBSCRIBE',
          topics
        };
        
        if (authToken) {
          message.authToken = authToken;
        }
        
        socket.send(JSON.stringify(message));
      }
    };
    
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'DATA') {
          setData(prevData => ({
            ...prevData,
            [message.topic]: message.data
          }));
        } else if (message.type === 'ERROR') {
          console.error('WebSocket error:', message);
          if (message.code === 4401) { // Token expired
            // Handle token expiration (e.g., redirect to login)
          }
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    
    socket.onclose = () => {
      setStatus('disconnected');
    };
    
    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setStatus('error');
    };
    
    socketRef.current = socket;
  }, [topics, authToken]);
  
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);
  
  const sendRequest = useCallback((topic, action, params = {}) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return Promise.reject(new Error('WebSocket not connected'));
    }
    
    const requestId = `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    return new Promise((resolve, reject) => {
      // Set up message handler
      const handleMessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.requestId === requestId) {
            // Remove event listener
            socketRef.current.removeEventListener('message', handleMessage);
            
            if (message.type === 'ERROR') {
              reject(new Error(`${message.message} (code: ${message.code})`));
            } else {
              resolve(message);
            }
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
      
      // Add event listener
      socketRef.current.addEventListener('message', handleMessage);
      
      // Send request
      const message = {
        type: 'REQUEST',
        topic,
        action,
        requestId,
        ...params
      };
      
      socketRef.current.send(JSON.stringify(message));
      
      // Set up timeout
      setTimeout(() => {
        if (socketRef.current) {
          socketRef.current.removeEventListener('message', handleMessage);
          reject(new Error('Request timeout'));
        }
      }, 10000); // 10 second timeout
    });
  }, []);
  
  // Connect on mount if autoConnect is true
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    
    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, [connect, disconnect, autoConnect]);
  
  return {
    status,
    data,
    connect,
    disconnect,
    sendRequest,
    socket: socketRef.current
  };
}
```

Usage example:

```jsx
function MarketDataComponent() {
  const { data, status, sendRequest } = useDegenDuelWebSocket(['market-data']);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (status === 'connected' && loading) {
      sendRequest('market-data', 'getAllTokens')
        .then(() => setLoading(false))
        .catch(error => {
          console.error('Failed to load token data:', error);
          setLoading(false);
        });
    }
  }, [status, sendRequest, loading]);
  
  const marketData = data['market-data'] || [];
  
  return (
    <div>
      <h2>Token Prices</h2>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Price</th>
              <th>Change (24h)</th>
            </tr>
          </thead>
          <tbody>
            {marketData.map(token => (
              <tr key={token.symbol}>
                <td>{token.symbol}</td>
                <td>${token.price.toFixed(2)}</td>
                <td className={token.change24h >= 0 ? 'positive' : 'negative'}>
                  {token.change24h.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

## Redux Integration

For applications using Redux, here's a middleware for integrating the WebSocket:

```javascript
// websocketMiddleware.js
export const websocketMiddleware = () => {
  let socket = null;
  let reconnectTimer = null;
  let authToken = null;
  
  const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
  let reconnectAttempt = 0;
  
  return store => next => action => {
    switch (action.type) {
      case 'WS_CONNECT':
        if (socket !== null) {
          socket.close();
        }
        
        // Connect to WebSocket
        socket = new WebSocket('wss://degenduel.me/api/v69/ws');
        
        // Save auth token if provided
        if (action.authToken) {
          authToken = action.authToken;
        }
        
        socket.onopen = () => {
          store.dispatch({ type: 'WS_CONNECTED' });
          reconnectAttempt = 0;
          
          // Subscribe to initial topics if provided
          if (action.topics && action.topics.length > 0) {
            const message = {
              type: 'SUBSCRIBE',
              topics: action.topics
            };
            
            if (authToken) {
              message.authToken = authToken;
            }
            
            socket.send(JSON.stringify(message));
          }
        };
        
        socket.onclose = (event) => {
          store.dispatch({ type: 'WS_DISCONNECTED', payload: { code: event.code, reason: event.reason } });
          
          // Attempt reconnection
          if (reconnectAttempt < RECONNECT_DELAYS.length) {
            const delay = RECONNECT_DELAYS[reconnectAttempt];
            reconnectTimer = setTimeout(() => {
              reconnectAttempt++;
              store.dispatch({ type: 'WS_CONNECT', topics: action.topics, authToken });
            }, delay);
          }
        };
        
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          
          // Dispatch appropriate actions based on message type
          switch (message.type) {
            case 'DATA':
              store.dispatch({
                type: `WS_DATA_${message.topic.toUpperCase().replace(/-/g, '_')}`,
                payload: message.data,
                requestId: message.requestId
              });
              break;
              
            case 'ERROR':
              store.dispatch({
                type: 'WS_ERROR',
                payload: {
                  code: message.code,
                  message: message.message
                },
                requestId: message.requestId
              });
              break;
              
            case 'SYSTEM':
              store.dispatch({
                type: 'WS_SYSTEM',
                payload: message
              });
              break;
              
            case 'ACKNOWLEDGMENT':
              store.dispatch({
                type: `WS_ACK_${message.operation.toUpperCase()}`,
                payload: message
              });
              break;
          }
        };
        
        socket.onerror = (error) => {
          store.dispatch({ type: 'WS_ERROR', payload: error });
        };
        
        break;
        
      case 'WS_DISCONNECT':
        if (socket !== null) {
          socket.close();
          socket = null;
        }
        
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        
        break;
        
      case 'WS_SUBSCRIBE':
        if (socket !== null && socket.readyState === WebSocket.OPEN) {
          const message = {
            type: 'SUBSCRIBE',
            topics: action.topics
          };
          
          if (authToken) {
            message.authToken = authToken;
          }
          
          socket.send(JSON.stringify(message));
        }
        break;
        
      case 'WS_UNSUBSCRIBE':
        if (socket !== null && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'UNSUBSCRIBE',
            topics: action.topics
          }));
        }
        break;
        
      case 'WS_REQUEST':
        if (socket !== null && socket.readyState === WebSocket.OPEN) {
          const { topic, action: wsAction, params = {}, requestId = `req-${Date.now()}` } = action;
          
          socket.send(JSON.stringify({
            type: 'REQUEST',
            topic,
            action: wsAction,
            requestId,
            ...params
          }));
        }
        break;
    }
    
    return next(action);
  };
};
```

Example usage with Redux:

```javascript
import { createStore, applyMiddleware } from 'redux';
import { websocketMiddleware } from './websocketMiddleware';

const initialState = {
  websocket: {
    status: 'disconnected',
    marketData: [],
    userProfile: null
  }
};

function reducer(state = initialState, action) {
  switch (action.type) {
    case 'WS_CONNECTED':
      return {
        ...state,
        websocket: {
          ...state.websocket,
          status: 'connected'
        }
      };
      
    case 'WS_DISCONNECTED':
      return {
        ...state,
        websocket: {
          ...state.websocket,
          status: 'disconnected'
        }
      };
      
    case 'WS_DATA_MARKET_DATA':
      return {
        ...state,
        websocket: {
          ...state.websocket,
          marketData: action.payload
        }
      };
      
    case 'WS_DATA_USER':
      return {
        ...state,
        websocket: {
          ...state.websocket,
          userProfile: action.payload
        }
      };
      
    default:
      return state;
  }
}

const store = createStore(
  reducer,
  applyMiddleware(websocketMiddleware())
);

// Connect to WebSocket and subscribe to market data
store.dispatch({
  type: 'WS_CONNECT',
  topics: ['market-data']
});
```

## Interactive Demo

For an interactive demo of the DegenDuel WebSocket API, visit `/websocket-demo.html` in your browser.

## Summary

The DegenDuel WebSocket API provides a powerful and efficient way to get real-time data from the platform. By using the topic-based unified WebSocket approach, you can:

1. Use a single connection for all your data needs
2. Subscribe only to the topics you need
3. Get real-time updates as data changes
4. Reduce server load and network traffic

For any questions or issues with the WebSocket API, please contact the DegenDuel development team.