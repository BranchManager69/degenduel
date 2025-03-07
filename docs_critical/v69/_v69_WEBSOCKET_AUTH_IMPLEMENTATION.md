# WebSocket Authentication and Frontend Integration

This document provides examples and guidance for implementing WebSocket authentication and frontend integration with the DegenDuel v69 WebSocket system.

## Authentication Flow

The WebSocket authentication flow follows these steps:

1. User authenticates with their wallet and receives a session cookie
2. Before establishing a WebSocket connection, the frontend requests a WebSocket token
3. The token is used when connecting to WebSocket endpoints
4. The WebSocket server validates the token and grants appropriate access

### Token Generation Endpoint

```javascript
// Example API call to get WebSocket token
async function getWebSocketToken() {
  try {
    const response = await fetch('/api/auth/token');
    if (!response.ok) throw new Error('Failed to get token');
    
    const data = await response.json();
    return {
      token: data.token,
      expiresAt: Date.now() + (data.expiresIn * 1000)
    };
  } catch (error) {
    console.error('Error getting WebSocket token:', error);
    throw error;
  }
}
```

## Token Data WebSocket Hook

Here's a complete React hook for integrating with the Token Data WebSocket:

```typescript
// src/hooks/useTokenDataWebSocket.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';

export interface TokenData {
  id: number;
  symbol: string;
  name: string;
  price: number;
  change_24h: number;
  color: string;
  address: string;
  decimals: number;
  market_cap?: string;
  fdv?: string;
  liquidity?: string;
  volume_24h?: string;
  image_url?: string;
  buy_pressure?: string;
  socials?: Record<string, string>;
  websites?: Array<{ label: string, url: string }>;
}

interface UseTokenDataOptions {
  initialTokens?: string[];   // Initial tokens to subscribe to
  autoConnect?: boolean;      // Auto-connect on mount
  reconnect?: boolean;        // Auto-reconnect on disconnect
  maxReconnectAttempts?: number; // Max reconnect attempts
}

export function useTokenDataWebSocket(options: UseTokenDataOptions = {}) {
  const {
    initialTokens = [],
    autoConnect = true,
    reconnect = true,
    maxReconnectAttempts = 5
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [subscribedTokens, setSubscribedTokens] = useState<string[]>(initialTokens);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const { getAccessToken } = useAuth();

  // Connect to the WebSocket
  const connect = useCallback(async () => {
    try {
      // Clean up existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      // For v69 WebSockets, token is optional for public endpoints
      let token = null;
      try {
        token = await getAccessToken();
      } catch (e) {
        console.log('No auth token available, continuing without authentication');
      }

      // Determine WebSocket URL based on environment
      const baseWsUrl = window.location.hostname === 'degenduel.me'
        ? `wss://${window.location.hostname}`
        : `wss://${window.location.host}`;

      // Connect to the v69 token data WebSocket
      const wsUrl = `${baseWsUrl}/api/v69/ws/token-data`;
      console.log(`Connecting to token data WebSocket: ${wsUrl}`);
      
      // Create WebSocket connection
      const ws = token 
        ? new WebSocket(wsUrl, token) // Use token as subprotocol if available
        : new WebSocket(wsUrl);       // Connect without auth for public data
      
      // Connection opened handler
      ws.onopen = () => {
        console.log('Token Data WebSocket connected');
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;

        // Subscribe to tokens if any were requested
        if (subscribedTokens.length > 0) {
          ws.send(JSON.stringify({
            type: 'subscribe_tokens',
            symbols: subscribedTokens
          }));
        }
      };

      // Message handler
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'token_update':
              if (message.data && Array.isArray(message.data)) {
                setTokens(message.data);
                setLastUpdate(new Date());
              }
              break;

            case 'token_data':
              if (message.data && message.symbol) {
                // Update a single token in the array
                setTokens(prev => prev.map(token => 
                  token.symbol === message.symbol ? message.data : token
                ));
                setLastUpdate(new Date());
              }
              break;

            case 'tokens_subscribed':
              console.log(`Subscribed to ${message.count} tokens:`, message.symbols);
              break;

            case 'tokens_unsubscribed':
              console.log(`Unsubscribed from ${message.count} tokens:`, message.symbols);
              break;

            case 'error':
              console.error('WebSocket error:', message.message);
              setError(message.message);
              break;

            default:
              console.log('Received message:', message);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      // Connection closed handler
      ws.onclose = (event) => {
        setIsConnected(false);
        console.log(`Token Data WebSocket closed: ${event.code}`);

        // Attempt to reconnect if not explicitly closed and reconnect is enabled
        if (event.code !== 1000 && reconnect) {
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            const delay = Math.min(
              30000,
              Math.pow(1.5, reconnectAttemptsRef.current) * 1000
            );
            console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);

            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectAttemptsRef.current++;
              connect();
            }, delay);
          } else {
            setError('Maximum reconnection attempts reached');
          }
        }
      };

      // Error handler
      ws.onerror = (error) => {
        console.error('Token Data WebSocket error:', error);
        setError('WebSocket connection error');
      };

      // Store the WebSocket reference
      wsRef.current = ws;

    } catch (error) {
      console.error('Error connecting to Token Data WebSocket:', error);
      setError(error instanceof Error ? error.message : 'Failed to connect');
    }
  }, [getAccessToken, reconnect, maxReconnectAttempts, subscribedTokens]);

  // Subscribe to specific tokens
  const subscribeToTokens = useCallback((symbols: string[]) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      // Save tokens for when connection is established
      setSubscribedTokens(prev => [...new Set([...prev, ...symbols])]);
      return;
    }

    wsRef.current.send(JSON.stringify({
      type: 'subscribe_tokens',
      symbols
    }));

    // Update subscribed tokens state
    setSubscribedTokens(prev => [...new Set([...prev, ...symbols])]);
  }, []);

  // Unsubscribe from specific tokens
  const unsubscribeFromTokens = useCallback((symbols: string[]) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      // Update subscribed tokens state even if not connected
      setSubscribedTokens(prev => prev.filter(symbol => !symbols.includes(symbol)));
      return;
    }

    wsRef.current.send(JSON.stringify({
      type: 'unsubscribe_tokens',
      symbols
    }));

    // Update subscribed tokens state
    setSubscribedTokens(prev => prev.filter(symbol => !symbols.includes(symbol)));
  }, []);

  // Request data for a specific token
  const getToken = useCallback((symbol: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    wsRef.current.send(JSON.stringify({
      type: 'get_token',
      symbol
    }));
  }, []);

  // Request data for all tokens
  const getAllTokens = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    wsRef.current.send(JSON.stringify({
      type: 'get_all_tokens'
    }));
  }, []);

  // Connect on mount if autoConnect is true
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [autoConnect, connect]);

  // Public interface
  return {
    tokens,
    isConnected,
    error,
    lastUpdate,
    subscribedTokens,
    connect,
    subscribeToTokens,
    unsubscribeFromTokens,
    getToken,
    getAllTokens
  };
}
```

## Usage Example

```tsx
// Example component using the Token Data WebSocket
import React, { useState } from 'react';
import { useTokenDataWebSocket, TokenData } from '../hooks/useTokenDataWebSocket';

const TokenDataDisplay: React.FC = () => {
  const [tokenSymbol, setTokenSymbol] = useState('');
  const { 
    tokens, 
    isConnected, 
    error, 
    lastUpdate,
    subscribedTokens,
    subscribeToTokens,
    unsubscribeFromTokens
  } = useTokenDataWebSocket({
    initialTokens: ['SOL', 'BONK'],
    autoConnect: true
  });

  // Format timestamp
  const formattedTime = lastUpdate
    ? lastUpdate.toLocaleTimeString()
    : 'No data yet';

  // Handle token subscription
  const handleSubscribe = () => {
    if (tokenSymbol) {
      subscribeToTokens([tokenSymbol]);
      setTokenSymbol('');
    }
  };

  // Handle token unsubscription
  const handleUnsubscribe = (symbol: string) => {
    unsubscribeFromTokens([symbol]);
  };

  return (
    <div className="token-data-container">
      <div className="connection-status">
        <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></span>
        <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        {error && <div className="error-message">{error}</div>}
      </div>

      <div className="last-update">
        Last updated: {formattedTime}
      </div>

      <div className="subscribe-form">
        <input
          type="text"
          value={tokenSymbol}
          onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
          placeholder="Enter token symbol"
        />
        <button onClick={handleSubscribe}>Subscribe</button>
      </div>

      <div className="subscribed-tokens">
        <h3>Subscribed Tokens</h3>
        <div className="token-tags">
          {subscribedTokens.map(symbol => (
            <div key={symbol} className="token-tag">
              {symbol}
              <button onClick={() => handleUnsubscribe(symbol)}>×</button>
            </div>
          ))}
        </div>
      </div>

      <h2>Token Data</h2>
      {tokens.length === 0 ? (
        <p>No token data available</p>
      ) : (
        <div className="token-grid">
          {tokens.map(token => (
            <TokenCard key={token.symbol} token={token} />
          ))}
        </div>
      )}
    </div>
  );
};

// Token card component
const TokenCard: React.FC<{ token: TokenData }> = ({ token }) => {
  const priceChange = parseFloat(token.change_24h.toString());
  const changeColorClass = priceChange > 0 ? 'positive' : priceChange < 0 ? 'negative' : 'neutral';

  return (
    <div className="token-card" style={{ borderColor: token.color || '#888' }}>
      <div className="token-header">
        {token.image_url && <img src={token.image_url} alt={token.symbol} className="token-icon" />}
        <h3>{token.symbol}</h3>
      </div>
      <div className="token-name">{token.name}</div>
      <div className="token-price">${parseFloat(token.price.toString()).toFixed(6)}</div>
      <div className={`token-change ${changeColorClass}`}>
        {priceChange > 0 ? '+' : ''}{priceChange.toFixed(2)}%
      </div>
      {token.volume_24h && (
        <div className="token-volume">
          Volume: ${token.volume_24h}
        </div>
      )}
    </div>
  );
};

export default TokenDataDisplay;
```

## Integration With Next.js

For Next.js applications, you might need to add a check for the window object:

```typescript
// Initialize WebSocket only on the client side
const connect = useCallback(async () => {
  if (typeof window === 'undefined') return;
  
  // Rest of the connection code...
}, []);
```

## Gradual Migration Strategy

To facilitate a smooth transition from the existing WebSocket system to v69, implement a feature flag approach:

```typescript
// Feature flag to control which WebSocket implementation to use
const useV69WebSockets = process.env.NEXT_PUBLIC_USE_V69_WEBSOCKETS === 'true';

// In your component
const tokenData = useV69WebSockets 
  ? useTokenDataWebSocketV69() 
  : useTokenDataWebSocket();
```

## Error Handling and Fallbacks

Add robust error handling and fallbacks for reliability:

```typescript
// Example of a provider with fallback
export function TokenDataProvider({ children }) {
  const v69Data = useTokenDataWebSocketV69();
  const legacyData = useTokenDataWebSocket();
  
  // If v69 fails, fall back to legacy
  const tokenData = v69Data.error ? legacyData : v69Data;
  
  return (
    <TokenDataContext.Provider value={tokenData}>
      {children}
    </TokenDataContext.Provider>
  );
}
```

## Best Practices

1. **Connection Management**
   - Always close WebSocket connections on component unmount
   - Implement exponential backoff for reconnection attempts
   - Set maximum reconnection attempts to avoid infinite loops

2. **Error Handling**
   - Provide meaningful error messages to users
   - Implement fallback mechanisms for critical data
   - Log WebSocket errors for debugging

3. **Performance Optimization**
   - Use memoization for WebSocket event handlers
   - Implement throttling for high-frequency updates
   - Only subscribe to necessary data channels

4. **Security**
   - Never expose sensitive data over WebSockets
   - Validate messages on both client and server
   - Use HTTPS/WSS protocols in production

5. **Testing**
   - Create mock WebSocket services for unit tests
   - Test reconnection logic with network disruptions
   - Validate handling of malformed messages