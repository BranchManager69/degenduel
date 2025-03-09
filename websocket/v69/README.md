# DegenDuel WebSocket System v69

A modern, robust WebSocket implementation with enhanced authentication, channel subscriptions, and improved performance.

## Architecture

The v69 WebSocket system runs in parallel with the existing WebSocket implementation, allowing for gradual migration without disrupting the current services.

### Key Features

- **Enhanced Authentication**: JWT validation with support for multiple token sources
- **Channel Subscriptions**: WebSocket pub/sub with fine-grained access control
- **Public/Private Endpoints**: Support for both authenticated and public access
- **Performance Metrics**: Detailed monitoring of connections and message flow
- **Security Protections**: Rate limiting, payload validation, and proper error handling
- **Event-Driven Updates**: Real-time updates via central service events system
- **Common Base Implementation**: Standardized error handling and connection management

### Core Components

#### Base WebSocket Server
The `BaseWebSocketServer` class provides a foundation for all WebSocket implementations with standardized:
- Authentication and authorization
- Channel subscriptions and management
- Client session tracking
- Rate limiting and message validation
- Heartbeat monitoring
- Error handling and reporting

#### Service Events System
The central event bus `serviceEvents` enables communication between services and WebSockets:
- Decouples event producers from consumers
- Allows WebSockets to react to system events in real-time
- Eliminates the need for periodic polling
- Provides consistent event naming and payloads

## Available WebSockets

| WebSocket                | Endpoint                  | Description                 | Authentication |
|--------------------------|---------------------------|-----------------------------|----------------|
| Monitor WebSocket        | `/api/v69/ws/monitor`     | System status and monitoring| Optional       |
| Contest WebSocket        | `/api/v69/ws/contest`     | Contest data and chat rooms | Optional       |
| Token Data WebSocket     | `/api/v69/ws/token-data`  | Market data and token prices| None           |
| Circuit Breaker WebSocket| `/api/v69/ws/circuit-breaker` | Circuit breaker status  | Optional       |
| User Notification WebSocket| `/api/v69/ws/notifications`| User-specific notifications| Required     |

## Test Client

A comprehensive test client is provided at `websocket/v69/test-client.js`. This client allows you to test all v69 WebSocket implementations with a consistent interface.

### Usage

```bash
# Basic connection to Monitor WebSocket
node websocket/v69/test-client.js monitor

# With authentication
node websocket/v69/test-client.js monitor --auth YOUR_TOKEN

# Subscribe to a specific channel
node websocket/v69/test-client.js monitor --channel system.status

# Test token data WebSocket
node websocket/v69/test-client.js token-data

# Run automated test suite
node websocket/v69/test-client.js monitor --test
```

### Available Commands

Once connected, you can use these commands:

- `help` - Show available commands
- `quit` - Close connection and exit
- `subscribe <channel>` - Subscribe to a channel
- `unsubscribe <channel>` - Unsubscribe from a channel
- `status` - Show connection status
- `clear` - Clear console
- `send <json>` - Send a custom message
- `ping` - Send heartbeat message
- `verbose` - Toggle verbose output
- `json` - Toggle JSON formatting

## Channels

Each WebSocket defines its own set of channels that clients can subscribe to:

### Monitor WebSocket Channels

- `system.status` - Real-time system status updates
- `system.maintenance` - Maintenance mode changes
- `system.settings` - System settings changes (admin only)
- `public.background_scene` - Public background scene setting (no auth required)
- `services` - Service status changes (admin only)

### Contest WebSocket Channels

- `contest.{contestId}` - Updates for a specific contest
- `leaderboard.{contestId}` - Leaderboard updates for a contest
- `chat.{contestId}` - Chat messages for a contest room
- `participant.{walletAddress}.{contestId}` - User participation status
- `admin.contests` - Admin-specific contest updates
- `public.contests` - Public contest data for spectators
- `public.contest.{contestId}` - Public data for a specific contest
- `user.{walletAddress}` - User-specific contest updates

### Token Data WebSocket Channels

- `public.tokens` - All token data updates (no auth required)
- `public.market` - Market-wide updates (no auth required)
- `token.{symbol}` - Updates for a specific token
- `admin.tokens` - Admin-only token management data

## Token Data WebSocket

The Token Data WebSocket provides real-time market data from the dedicated market database. It supports:

- Automatic broadcasting of token data to all connected clients
- Individual token subscriptions for targeted updates
- Public channels that require no authentication
- Support for market data providers (admin only)

### Connecting to Token Data WebSocket

```javascript
// Browser example
const ws = new WebSocket('wss://degenduel.me/api/v69/ws/token-data');

// Listen for token updates
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'token_update') {
    // Handle token data updates
    console.log('Received token data:', message.data);
  }
};

// Subscribe to specific tokens
ws.send(JSON.stringify({
  type: 'subscribe_tokens',
  symbols: ['SOL', 'BONK', 'JUP']
}));
```

## Authentication

To authenticate, you need to obtain a token from the `/api/auth/token` endpoint. This token can be passed to the WebSocket in several ways:

1. **Query Parameter**: `?token=YOUR_TOKEN`
2. **WebSocket Protocol**: In the Sec-WebSocket-Protocol header
3. **Authorization Header**: For HTTP/2 connections

## Best Practices for Implementing v69 WebSockets

### 1. Extend BaseWebSocketServer
All WebSocket servers should extend the base class:

```javascript
import { BaseWebSocketServer } from './base-websocket.js';

class MyWebSocketServer extends BaseWebSocketServer {
  constructor(server) {
    super(server, {
      path: '/api/v69/ws/my-path',
      requireAuth: true,
      publicEndpoints: ['public.channel'],
      maxPayload: 64 * 1024
    });
    
    // Initialize state and bind event handlers
    this.dataCache = new Map();
    this._dataUpdateHandler = this._handleDataUpdate.bind(this);
  }
}
```

### 2. Register Event Handlers
Subscribe to service events rather than using intervals:

```javascript
async onInitialize() {
  try {
    // Load initial data
    await this._fetchInitialData();
    
    // Register event handlers
    serviceEvents.on('data:update', this._dataUpdateHandler);
    serviceEvents.on('service:status', this._serviceStatusHandler);
    
    return true;
  } catch (error) {
    logApi.error(`Initialization failed: ${error.message}`, error);
    return false;
  }
}
```

### 3. Handle Events
Implement event handlers that update internal state and broadcast to clients:

```javascript
_handleDataUpdate(data) {
  // Update internal cache
  this.dataCache.set(data.id, data);
  
  // Broadcast to appropriate channels
  this.broadcastToChannel('data.updates', {
    type: 'DATA_UPDATE',
    data: data
  });
}
```

### 4. Clean Up Resources
Remove event listeners when shutting down:

```javascript
async onCleanup() {
  // Remove event listeners
  serviceEvents.removeListener('data:update', this._dataUpdateHandler);
  serviceEvents.removeListener('service:status', this._serviceStatusHandler);
  
  // Clear caches
  this.dataCache.clear();
}
```

### 5. Emitting Events from Services

Services should emit events via the central `serviceEvents` bus:

```javascript
import serviceEvents from '../../utils/service-suite/service-events.js';

// In a service method:
await processData(data);
serviceEvents.emit('data:update', processedData);
```

### Event Naming Conventions

Standard event names follow this pattern:
- `service:initialized` - Service initialization complete
- `service:error` - Service encountered an error
- `service:circuit_breaker` - Circuit breaker state changed
- `system:settings:update` - System settings updated
- `maintenance:update` - Maintenance mode changed
- `data:type:action` - Data specific events (e.g., `token:price:update`)