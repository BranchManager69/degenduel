# DegenDuel WebSocket System Guide

This guide explains how to use the WebSocket system in the DegenDuel application. The WebSocket system provides real-time data updates and is built around a topic-based subscription model.

## Table of Contents

1. [Overview](#overview)
2. [Importing Required Components](#importing-required-components)
3. [Message Distribution System](#message-distribution-system)
4. [Topic-Based Subscriptions](#topic-based-subscriptions)
5. [Complete Component Example](#complete-component-example)
6. [Available Topics](#available-topics)
7. [Message Types](#message-types)
8. [Troubleshooting](#troubleshooting)

## Overview

The WebSocket system uses a React Context (`WebSocketContext`) to manage a single WebSocket connection for the entire application. This context handles:

- Connection establishment and maintenance
- Authentication
- Message distribution to registered listeners
- Reconnection logic with exponential backoff
- Topic-based subscriptions

## Importing Required Components

```typescript
// Import the hook for using WebSockets in components
import { useUnifiedWebSocket } from '../contexts/WebSocketContext';

// Import message types and socket topics
import { 
  MessageType, 
  SOCKET_TYPES,
  WebSocketMessage 
} from '../hooks/websocket/types';
```

## Message Distribution System

The message distribution system allows different parts of your application to listen for specific WebSocket messages they're interested in, without needing to process all messages.

### How It Works

1. Components register as "listeners" for specific message types and topics
2. When a message arrives, the WebSocketContext distributes it only to components that have registered interest
3. Each component only processes messages relevant to its functionality

### Using the Message Distribution System

The core hook for using WebSockets is `useUnifiedWebSocket`, which takes these parameters:

```typescript
const ws = useUnifiedWebSocket(
  id,          // A unique string ID for this listener
  types,       // Array of message types to listen for (e.g., [MessageType.DATA])
  onMessage,   // Callback function that runs when matching messages are received
  topics       // Optional array of topics to filter messages by
);
```

## Topic-Based Subscriptions

Topics are channels of data that your components can subscribe to. The WebSocket system in DegenDuel uses a topic-based approach to organize different types of real-time data.

### Example: Subscribing to Token Data

```typescript
import React, { useState } from 'react';
import { useUnifiedWebSocket } from '../contexts/WebSocketContext';
import { MessageType, SOCKET_TYPES } from '../hooks/websocket/types';

function TokenPriceDisplay({ tokenSymbol }) {
  const [price, setPrice] = useState(null);
  
  // Register to receive token price updates
  useUnifiedWebSocket(
    `token-price-${tokenSymbol}`,   // Unique ID
    [MessageType.DATA],             // Only interested in DATA messages
    (message) => {
      // Process incoming token data
      if (message.topic === SOCKET_TYPES.TOKEN_DATA && 
          message.data?.tokens?.[tokenSymbol]) {
        setPrice(message.data.tokens[tokenSymbol].price);
      }
    },
    [SOCKET_TYPES.TOKEN_DATA]       // Only listen to TOKEN_DATA topic
  );
  
  return (
    <div>
      <h3>{tokenSymbol}</h3>
      <p>Current Price: {price ? `$${price}` : 'Loading...'}</p>
    </div>
  );
}
```

## Complete Component Example

Here's a more complete example showing how to create a dashboard component that subscribes to multiple topics:

```typescript
import React, { useState, useEffect } from 'react';
import { useWebSocketContext, useUnifiedWebSocket } from '../contexts/WebSocketContext';
import { MessageType, SOCKET_TYPES } from '../hooks/websocket/types';

function Dashboard() {
  const [marketData, setMarketData] = useState(null);
  const [portfolioData, setPortfolioData] = useState(null);
  const [notifications, setNotifications] = useState([]);
  
  // Use websocket context to check connection status
  const wsContext = useWebSocketContext();
  
  // Listen for market data updates
  useUnifiedWebSocket(
    'dashboard-market-data',
    [MessageType.DATA],
    (message) => {
      if (message.topic === SOCKET_TYPES.MARKET_DATA) {
        setMarketData(message.data);
      }
    },
    [SOCKET_TYPES.MARKET_DATA]
  );
  
  // Listen for portfolio updates
  useUnifiedWebSocket(
    'dashboard-portfolio',
    [MessageType.DATA],
    (message) => {
      if (message.topic === SOCKET_TYPES.PORTFOLIO) {
        setPortfolioData(message.data);
      }
    },
    [SOCKET_TYPES.PORTFOLIO]
  );
  
  // Listen for notifications
  useUnifiedWebSocket(
    'dashboard-notifications',
    [MessageType.DATA],
    (message) => {
      if (message.topic === SOCKET_TYPES.NOTIFICATION) {
        setNotifications(prev => [...prev, message.data]);
      }
    },
    [SOCKET_TYPES.NOTIFICATION]
  );
  
  // Explicitly subscribe to these topics when the component mounts
  useEffect(() => {
    if (wsContext.isConnected) {
      wsContext.subscribe([
        SOCKET_TYPES.MARKET_DATA,
        SOCKET_TYPES.PORTFOLIO,
        SOCKET_TYPES.NOTIFICATION
      ]);
    }
    
    // Unsubscribe when component unmounts
    return () => {
      wsContext.unsubscribe([
        SOCKET_TYPES.MARKET_DATA,
        SOCKET_TYPES.PORTFOLIO,
        SOCKET_TYPES.NOTIFICATION
      ]);
    };
  }, [wsContext.isConnected]);
  
  return (
    <div className="dashboard">
      <div className="connection-status">
        WebSocket: {wsContext.isConnected ? 'Connected' : 'Disconnected'}
        {wsContext.isAuthenticated && ' (Authenticated)'}
      </div>
      
      {marketData && (
        <div className="market-data-section">
          <h2>Market Overview</h2>
          {/* Render market data */}
        </div>
      )}
      
      {portfolioData && (
        <div className="portfolio-section">
          <h2>Your Portfolio</h2>
          {/* Render portfolio data */}
        </div>
      )}
      
      <div className="notifications-section">
        <h2>Notifications ({notifications.length})</h2>
        {notifications.map((notif, index) => (
          <div key={index} className="notification">
            {notif.message}
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Available Topics

The WebSocket system defines the following topics in `SOCKET_TYPES`:

```typescript
export const SOCKET_TYPES = {
  // Core system topics
  MONITOR: 'monitor',
  SERVER_STATUS: 'server-status',
  SYSTEM: 'system',
  
  // Market data topics
  TOKEN_DATA: 'token-data',
  MARKET_DATA: 'market-data',
  
  // User data topics
  PORTFOLIO: 'portfolio',
  WALLET: 'wallet',
  NOTIFICATION: 'notification',
  ACHIEVEMENT: 'achievement',
  
  // Contest topics
  CONTEST: 'contest',
  CONTEST_CHAT: 'contest-chat', // Being deprecated
  
  // Admin topics
  ADMIN: 'admin',
  ANALYTICS: 'analytics',
  CIRCUIT_BREAKER: 'circuit-breaker',
  SERVICE: 'service',
  SKYDUEL: 'skyduel',
  
  // Other specialized topics
  TEST: 'test',
  TERMINAL: 'terminal',
  LIQUIDITY_SIM: 'liquidity-sim',
};
```

## Message Types

The WebSocket system uses these message types to categorize different kinds of messages:

```typescript
export enum MessageType {
  // System & status messages
  SYSTEM = 'SYSTEM',
  ERROR = 'ERROR',
  PING = 'PING',
  PONG = 'PONG',
  AUTH = 'AUTH',
  AUTH_SUCCESS = 'AUTH_SUCCESS',
  ACKNOWLEDGMENT = 'ACKNOWLEDGMENT',
  
  // Data messages
  DATA = 'DATA',

  // Subscription messages
  SUBSCRIBE = 'SUBSCRIBE',
  UNSUBSCRIBE = 'UNSUBSCRIBE',

  // Request messages
  REQUEST = 'REQUEST',

  // Command messages
  COMMAND = 'COMMAND',
  
  // Special message types
  LOGS = 'LOGS'
}
```

## Troubleshooting

### 1. No data is being received

Check the following:

- Make sure your component is wrapped in a `WebSocketProvider` (this should be at the app root level)
- Verify that you're subscribing to the correct topics
- Check the WebSocket connection status with `useWebSocketContext()`
- Confirm that your `onMessage` callback is correctly implemented
- Check the browser console for any WebSocket errors

### 2. Messages stop coming after a while

The WebSocket system has automatic reconnection logic, but you may want to:

- Check your authentication status with `wsContext.isAuthenticated`
- Verify network connectivity
- Check for any token expiration issues (the system should handle this, but worth checking)

### 3. Component receives too many messages

If your component is processing too many messages:

- Narrow down the topics you're subscribing to
- Add more specific filtering in your message handler
- Consider debouncing your state updates

### 4. Authentication issues

If you're not receiving authenticated data:

- Ensure the user is logged in
- Check that the authentication process completed with `wsContext.isAuthenticated`
- Look for authentication errors in the browser console