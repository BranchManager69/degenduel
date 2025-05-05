# DegenDuel API Cluster Mode Implementation

This document provides comprehensive instructions for implementing cluster mode in the DegenDuel API.

## Introduction

Currently, the DegenDuel API runs in fork mode with one process per application. Moving to cluster mode will allow the API to utilize multiple CPU cores by running multiple worker processes, improving performance and throughput.

## Current Status

In `ecosystem.config.cjs`, cluster mode is commented out:

```javascript
// Reverting to fork mode as the application needs additional code changes to support cluster mode properly
// instances: 4,
// exec_mode: 'cluster',
```

The main issues preventing cluster mode are related to shared state management across worker processes.

## Implementation Strategy

To successfully implement cluster mode, we need to move shared state from in-memory storage to Redis, which will serve as the central state repository accessible by all worker processes.

## 1. WebSocket State Management

### Current Implementation

The API stores WebSocket server information in global variables:

- `global.wsServers` - Tracks all WebSocket server instances
- `global.webSocketReadyEmitter` - Event emitter for WebSocket server readiness

### Required Changes

```javascript
// In websocket/v69/unified/UnifiedWebSocketServer.js

// Replace global tracking with Redis
async function initializeWebSocketServer() {
  // Initialize as normal...
  
  // Then store status in Redis
  await redisManager.set('ws:status:unified', {
    initialized: true,
    path: '/api/v69/ws',
    clientCount: 0
  });
  
  // Notify other processes via Redis pub/sub
  await redisManager.publish('websocket:ready', JSON.stringify({
    timestamp: Date.now(),
    serverId: process.pid
  }));
}

// For broadcasting messages across processes:
async function broadcastMessage(topic, data) {
  // Send to local clients
  this._broadcastToLocalClients(topic, data);
  
  // Publish to Redis for other processes to receive
  await redisManager.publish('ws:broadcast', JSON.stringify({
    topic,
    data,
    timestamp: Date.now(),
    sourceId: process.pid
  }));
}
```

## 2. Service Manager State

### Current Implementation

The `service-manager.js` uses Maps to track service state:

- `ServiceManager.services` - Stores service instances
- `ServiceManager.state` - Tracks operational state of services
- `ServiceManager.dependencies` - Manages service dependencies

### Required Changes

```javascript
// In utils/service-suite/service-manager.js

// Update service state with Redis
async updateServiceState(serviceName, state) {
  // Still store locally for this instance
  this.state.set(serviceName, state);
  
  // Also store in Redis for other instances
  await redisManager.set(`service:${serviceName}:state`, {
    status: state.status,
    timestamp: Date.now(),
    error: state.error,
    lastOperation: state.lastOperation
  });
  
  // Notify other instances via pub/sub
  await redisManager.publish('service:state:updated', JSON.stringify({
    serviceName,
    state: { status: state.status }
  }));
}

// Get service state (check Redis first, fall back to local)
async getServiceState(serviceName) {
  try {
    // Try Redis first
    const redisState = await redisManager.get(`service:${serviceName}:state`);
    if (redisState) return redisState;
  } catch (err) {
    logApi.warn(`Failed to get service state from Redis: ${err.message}`);
  }
  
  // Fall back to local state
  return this.state.get(serviceName);
}
```

## 3. Client Tracking in WebSockets

### Current Implementation

The unified WebSocket server tracks:

- Connected clients in a Map
- Subscriptions by topic
- Authenticated clients

### Required Changes

```javascript
// In websocket/v69/unified/UnifiedWebSocketServer.js

// Track client connections in Redis
async addClient(clientId, ws, req) {
  // Store locally first
  this.clients.set(clientId, ws);
  
  // Track in Redis (metadata only, not the actual WS connection)
  await redisManager.set(`ws:client:${clientId}`, {
    connectedAt: Date.now(),
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    serverId: process.pid
  });
  
  // Add to connected clients set
  await redisManager.sadd('ws:connected_clients', clientId);
}

// Track subscriptions in Redis
async subscribeClientToTopic(clientId, topic) {
  // Local tracking for this process
  if (!this.subscriptions[topic]) {
    this.subscriptions[topic] = new Set();
  }
  this.subscriptions[topic].add(clientId);
  
  // Redis tracking for cluster-wide visibility
  await redisManager.sadd(`ws:topic:${topic}:subscribers`, clientId);
  await redisManager.sadd(`ws:client:${clientId}:subscriptions`, topic);
}

// Implement Redis-based broadcasting
async broadcastToTopic(topic, data) {
  // Local broadcast
  if (this.subscriptions[topic]) {
    // Broadcast to local subscribers...
  }
  
  // Publish to Redis for other instances
  await redisManager.publish('ws:broadcast', JSON.stringify({
    topic,
    data,
    timestamp: Date.now()
  }));
}
```

## 4. In-Memory Cache

### Current Implementation

The project uses a simple in-memory cache which isn't shared across processes.

### Required Changes

```javascript
// In utils/cache.js

// Replace in-memory cache with Redis-based cache
class RedisCache {
  constructor(redisManager) {
    this.redis = redisManager;
    this.prefix = 'cache:';
  }
  
  async get(key) {
    return await this.redis.get(this.prefix + key);
  }
  
  async set(key, value, ttlSeconds = 300) {
    await this.redis.set(this.prefix + key, value, ttlSeconds);
  }
  
  async del(key) {
    await this.redis.del(this.prefix + key);
  }
}

// Export singleton instance
export default new RedisCache(redisManager);
```

## 5. Implementation Steps

### 1. Enhance Redis Manager

```javascript
// In utils/redis-suite/redis-manager.js

// Add pub/sub support
initializePubSub() {
  this.publisher = this.client.duplicate();
  this.subscriber = this.client.duplicate();
  
  // Setup subscriber
  this.subscriptions = new Map();
}

// Subscribe to channel
subscribe(channel, callback) {
  if (!this.subscriber) this.initializePubSub();
  
  // Store callback
  if (!this.subscriptions.has(channel)) {
    this.subscriptions.set(channel, new Set());
    
    // Subscribe only once
    this.subscriber.subscribe(channel);
  }
  
  // Add this callback
  this.subscriptions.get(channel).add(callback);
  
  // Setup handler if not done yet
  if (this.subscriptions.size === 1) {
    this.subscriber.on('message', (receivedChannel, message) => {
      const callbacks = this.subscriptions.get(receivedChannel);
      if (callbacks) {
        callbacks.forEach(cb => {
          try {
            cb(message);
          } catch (err) {
            console.error(`Error in Redis subscription callback: ${err.message}`);
          }
        });
      }
    });
  }
}

// Publish message
async publish(channel, message) {
  if (!this.publisher) this.initializePubSub();
  
  return this.publisher.publish(
    channel,
    typeof message === 'string' ? message : JSON.stringify(message)
  );
}
```

### 2. Setup Subscriber for WebSocket Broadcasts

```javascript
// In websocket-initializer.js
function setupRedisSubscriber() {
  redisManager.subscribe('ws:broadcast', (messageStr) => {
    try {
      const message = JSON.parse(messageStr);
      
      // Skip messages from self
      if (message.sourceId === process.pid) return;
      
      // Process the broadcast locally
      if (config.websocket && config.websocket.unifiedWebSocket) {
        const ws = config.websocket.unifiedWebSocket;
        ws._broadcastToLocalClients(message.topic, message.data);
      }
    } catch (err) {
      logApi.error(`Error processing Redis broadcast: ${err.message}`);
    }
  });
}
```

### 3. Initialize Redis Subscribers on Startup

```javascript
// In index.js (at the WebSocket initialization section)
async function initializeWebSockets() {
  // Normal initialization...
  
  // Setup Redis subscribers for cross-process communication
  setupRedisSubscriber();
}
```

## 6. WebSocket Connection Persistence (Sticky Sessions)

For WebSocket connections to work reliably in a cluster environment, we need to ensure that all communication from a specific client always reaches the same worker. This is done using "sticky sessions."

### Implementation

1. Install required package:
   ```bash
   npm install sticky-session
   ```

2. Modify server startup in `index.js`:
   ```javascript
   import sticky from 'sticky-session';
   
   // Instead of directly calling server.listen
   if (!sticky.listen(server, port)) {
     // Master process
     console.log('Master server started');
   } else {
     // Worker process
     console.log(`Worker ${process.pid} started`);
     
     // Initialize services and WebSockets as normal
     // All workers will have their own instances, but state will be shared via Redis
   }
   ```

## 7. Update PM2 Configuration

Once all the Redis-based state sharing is implemented, update `ecosystem.config.cjs` to enable cluster mode:

```javascript
{
  name: 'degenduel-api',
  script: 'index.js',
  node_args: '--experimental-loader=ts-node/esm --experimental-specifier-resolution=node --max-old-space-size=4096',
  instances: 'max', // Uses all available CPU cores, or specify a number like 4
  exec_mode: 'cluster',
  // Other settings remain the same...
}
```

## 8. Testing and Verification

1. **Test with Minimal Instances**:
   - Start with 2 instances to identify any issues
   - Gradually increase to the desired number

2. **Verify Redis State Synchronization**:
   - Check that service state is properly shared
   - Verify that WebSocket broadcasts work across instances
   - Ensure client connections persist and receive messages

3. **Monitor Performance**:
   - Compare performance metrics before and after
   - Check Redis CPU/memory usage
   - Verify that load is evenly distributed across workers

## Conclusion

Implementing cluster mode requires moving from in-memory state to Redis-based shared state. The critical components are:

1. WebSocket server state synchronization
2. Service manager state sharing
3. WebSocket client and subscription tracking
4. Cache shared across workers
5. Sticky sessions for WebSocket connection persistence

With these changes, the DegenDuel API can fully utilize multiple CPU cores, improving performance and throughput while maintaining correct operation.