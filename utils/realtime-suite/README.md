# DegenDuel Realtime Data Suite

A powerful, efficient system for real-time data updates across the DegenDuel platform.

## Core Components

1. **Publisher** - Sends data change events to Redis
2. **Subscriber** - Listens for data changes and triggers handlers
3. **Channels** - Predefined topics for different data types
4. **EventHandlers** - Customizable callbacks for different events

## Architecture

```
┌─────────────┐         ┌─────────┐         ┌─────────────┐
│ Data Change │ ──────▶ │  Redis  │ ──────▶ │ Subscribers │
└─────────────┘         └─────────┘         └─────────────┘
      │                                            │
      │                                            │
      ▼                                            ▼
┌─────────────┐                           ┌─────────────┐
│  Publishers │                           │ WebSockets  │
└─────────────┘                           └─────────────┘
```

## Features

- **Minimal Overhead**: Efficient pub/sub with minimal Redis payloads
- **Type Safety**: TypeScript interfaces for all events
- **Debug Mode**: Comprehensive logging for development
- **Performance**: Optimized for high-throughput scenarios
- **Integration**: Works seamlessly with existing websocket infrastructure

## Usage Examples

### Publishing Token Price Changes

```javascript
// After updating token price in database
await realtime.publish('token:price', {
  id: token.id,
  address: token.address,
  price: newPrice,
  previousPrice: oldPrice
});
```

### Subscribing to Token Updates in WebSocket Server

```javascript
// In WebSocket initialization
realtime.subscribe('token:price', (data) => {
  // Broadcast to relevant clients
  broadcastToSubscribers('token-updates', data);
});
```

## Channel Types

- `token:price` - Token price changes
- `token:metadata` - Token metadata updates
- `contest:status` - Contest status changes
- `user:balance` - User balance updates
- `system:status` - System status changes

## Benefits Over Previous Implementation

1. **Decoupling**: Services don't need direct references to WebSocket server
2. **Scalability**: Works across multiple processes/servers
3. **Consistency**: Standardized event format across system
4. **Observability**: Easier to monitor and debug data flows