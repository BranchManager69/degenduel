# DegenDuel WebSocket System - Implementation Details

## WebSocket System Architecture Overview

The system uses a unified WebSocket implementation that consolidates all WebSocket connections through a single endpoint (`/api/v69/ws`). This design follows a topic-based subscription pattern where clients connect to this single endpoint and then subscribe to specific topics of interest.

## Key Components

1. **UnifiedWebSocketServer Class** (in `/websocket/v69/unified/UnifiedWebSocketServer.js`):
   - The core class that manages WebSocket connections
   - Maintains collections of clients, topics, and subscriptions
   - Handles message routing and broadcasting

2. **Message Handlers** (in `/websocket/v69/unified/handlers.js`):
   - `handleConnection` - Processes new client connections
   - `handleDisconnect` - Cleans up when clients disconnect
   - `handleMessage` - Routes incoming messages to appropriate handlers
   - `handleSubscription` - Manages topic subscriptions
   - `handleClientRequest` - Processes client data requests

3. **HTTP-to-WebSocket Bridge**:
   - The critical `initialize()` method registers the WebSocket server with the HTTP server
   - The HTTP 'upgrade' event handler intercepts WebSocket connection requests and routes them to the WebSocket server

## Connection Flow

1. Client makes a WebSocket connection request to `/api/v69/ws`
2. HTTP server receives the request and checks if it's a WebSocket upgrade request
3. The 'upgrade' event handler checks if the path matches `/api/v69/ws`
4. If matched, the request is passed to `handleUpgrade()` method
5. `handleUpgrade()` completes the WebSocket handshake and creates a WebSocket connection
6. The new connection is passed to `handleConnection()` which initializes client state
7. Client can now send subscription requests to receive data for specific topics

## Topic-Based Subscription System

The system implements a sophisticated topic-based subscription model:

1. **Topics**: Pre-defined channels like "terminal", "market-data", "portfolio", etc.
2. **Subscriptions**: Clients subscribe to topics they're interested in
3. **Authentication**: Some topics require authentication (portfolio, admin, etc.)
4. **Authorization**: Admin-only topics have role-based access control

## Data Storage and Management

The system uses several Maps to efficiently manage connections and subscriptions:

1. `clients` - Map of all connected WebSocket clients
2. `authenticatedClients` - Map of authenticated clients with their user info
3. `clientsByUserId` - Map of userId to Set of that user's WebSocket connections
4. `clientSubscriptions` - Map of WebSocket to Set of subscribed topics
5. `topicSubscribers` - Map of topic to Set of WebSocket subscribers

## Message Flow

1. **Connection**: Client connects and gets assigned a unique connectionId
2. **Subscription**: Client subscribes to topics (receive acknowledgment)
3. **Data Exchange**: 
   - Server pushes real-time updates to subscribed clients
   - Clients can request specific data with the REQUEST message type
4. **Disconnection**: Client disconnects, server cleans up resources

## Critical Fixes

1. **Missing HTTP Upgrade Handler**: Added the critical HTTP 'upgrade' event handler that bridges HTTP and WebSocket protocols:

```javascript
this.server.on('upgrade', (req, socket, head) => {
  const { pathname } = parseUrl(req.url);
  if (pathname === this.path) {
    this.handleUpgrade(req, socket, head);
  }
});
```

2. **Client State Initialization**: Ensured proper client state initialization to prevent errors:

```javascript
ws.clientId = generateConnectionId();
ws.isAuthenticated = false;
ws.userId = null;
ws.subscriptions = new Set();
// ...
```

3. **Client Tracking**: Fixed the client tracking mechanism with proper Maps:

```javascript
this.clientsByUserId = new Map();
this.clientSubscriptions = new Map();
this.topicSubscribers = new Map();
```

4. **Scope Issues**: Fixed variables referenced outside their scope like `normalizedTopic` which caused errors in catch blocks.

## Common Issues and Debugging

1. **404 Errors for WebSocket Endpoint**: This typically indicates the HTTP upgrade handler is missing or not properly attached to the HTTP server.

2. **Client Disconnections**: Look for errors in the client handlers, especially in `handleMessage` and `handleSubscription`.

3. **Message Not Received**: Check that clients have properly subscribed to the relevant topics and that the topic name is normalized correctly.

4. **Authentication Issues**: Verify that the token validation and user lookup in the authentication flow are working properly.

## Benefits of the Unified System

1. **Simplified Client Implementation**: Clients only need to connect to a single endpoint
2. **Reduced Connection Overhead**: One connection can receive multiple data types
3. **Centralized Authentication**: Single point for validating user credentials
4. **Efficient Resource Management**: Better tracking of connections and subscriptions
5. **Consistent Error Handling**: Standardized approach to dealing with connection issues

## Maintenance and Scaling Considerations

1. **Memory Management**: Monitor the number of connections and subscriptions to prevent memory leaks
2. **Rate Limiting**: Use the rate limiter to prevent abuse
3. **Connection Timeouts**: Implement heartbeats to detect stale connections
4. **Load Balancing**: For high-scale deployments, consider load balancing WebSocket connections
5. **Monitoring**: Track connection counts, message rates, and subscription patterns to optimize performance

---

*This document was created based on the WebSocket system implementation in DegenDuel, after resolving critical issues with the HTTP-to-WebSocket bridge.*