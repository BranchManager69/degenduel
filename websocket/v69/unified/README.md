# Unified WebSocket System (v69)

This is a comprehensive, modular WebSocket system that provides a single connection point for all WebSocket communications in the DegenDuel platform.

## Architecture

The v69 Unified WebSocket System is designed with a modular architecture split across several files:

1. **UnifiedWebSocketServer.js** - Main class that ties together all components
2. **index.js** - Entry point exporting the factory function and utilities
3. **utils.js** - Authentication, message parsing, and client info utilities
4. **services.js** - Service integration and event handling
5. **requestHandlers.js** - Topic-specific request handlers
6. **handlers.js** - Connection and message handling logic

## Features

- **Single WebSocket Connection** - All data flows through a single WebSocket connection
- **Topic-Based Subscriptions** - Clients subscribe to specific topics (market, wallet, etc.)
- **Authentication** - Secure JWT-based authentication for protected topics
- **Request-Response Pattern** - Support for request-response pattern alongside subscriptions
- **Command Support** - Support for command messages to trigger actions
- **Unified Error Handling** - Standardized error responses and logging
- **Combined Wallet Balances** - Returns both SOL and token balances in a single response
- **Support for Subtypes** - Transaction and settings subtypes for organization

## Topics

The system supports the following topics:

- **market-data** - Real-time market data (public)
- **system** - System status and announcements (public)
- **contest** - Contest information and updates (public)
- **portfolio** - User portfolio data (authenticated)
- **user** - User-specific data (authenticated)
- **wallet** - Wallet actions and data (authenticated)
- **wallet-balance** - Combined SOL and token balances (authenticated)
- **skyduel** - SkyDuel game data (authenticated)
- **admin** - Admin-only controls and data (admin only)
- **terminal** - Terminal data and commands (admin only)
- **logs** - System and service logs (admin only)

## Message Types

The system defines these standard message types:

- **SUBSCRIBE** - Subscribe to a topic
- **UNSUBSCRIBE** - Unsubscribe from a topic
- **REQUEST** - Request data for a specific topic and action
- **COMMAND** - Send a command to trigger an action
- **DATA** - Data response from the server
- **ERROR** - Error response
- **SYSTEM** - System messages
- **ACKNOWLEDGMENT** - Message receipt acknowledgment

## Integration

To integrate the Unified WebSocket System into your application:

```javascript
// Import the factory function
const { createUnifiedWebSocket } = require('./websocket/v69');

// Create HTTP server
const server = http.createServer(app);

// Create unified WebSocket server
const unifiedWs = createUnifiedWebSocket(server, {
  maxPayload: 50 * 1024 * 1024 // 50MB max payload
});

// Handle WebSocket upgrade requests
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  
  if (pathname === '/api/v69/ws') {
    unifiedWs.handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});
```

For a complete example, see `integration-example.js`.

## Client Example

```javascript
// Connect to the WebSocket server
const ws = new WebSocket('wss://api.example.com/api/v69/ws');

// Subscribe to market data
ws.send(JSON.stringify({
  type: 'SUBSCRIBE',
  topic: 'market-data'
}));

// Request specific market data
ws.send(JSON.stringify({
  type: 'REQUEST',
  topic: 'market-data',
  action: 'get_token_price',
  data: { symbol: 'SOL' }
}));

// Handle incoming messages
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'DATA' && message.topic === 'market-data') {
    // Handle market data
    console.log('Market data received:', message.data);
  }
};
```

## Authentication

Authentication is required for protected topics:

```javascript
// Authenticate with JWT token
ws.send(JSON.stringify({
  type: 'COMMAND',
  topic: 'system',
  action: 'authenticate',
  data: { token: 'your-jwt-token' }
}));

// After authentication, you can subscribe to protected topics
ws.send(JSON.stringify({
  type: 'SUBSCRIBE',
  topic: 'wallet-balance'
}));
```

## Error Handling

The server will send error messages with an error code and message:

```javascript
// Example error message
{
  "type": "ERROR",
  "topic": "wallet",
  "error": "Unauthorized access",
  "code": 401
}
```

## Broadcasting Data

You can broadcast data to subscribed clients using the UnifiedWebSocketServer instance:

```javascript
// Broadcast to all clients subscribed to a topic
unifiedWs.broadcast('market-data', {
  type: 'DATA',
  topic: 'market-data',
  action: 'price_update',
  data: { symbol: 'SOL', price: 100.50 }
});
```

## Graceful Shutdown

The UnifiedWebSocketServer includes a shutdown method for graceful termination:

```javascript
// Gracefully shut down the WebSocket server
unifiedWs.shutdown();
```