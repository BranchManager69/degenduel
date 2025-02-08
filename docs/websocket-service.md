# DegenDuel WebSocket Service Documentation

## Overview

The DegenDuel WebSocket Service provides real-time updates for wallet operations, including wallet creation, status changes, and balance updates. This document outlines the implementation, usage, and best practices for the WebSocket service.

## Architecture

### Core Components

1. **WalletWebSocketServer**
   - Handles WebSocket connections and authentication
   - Manages client tracking and message broadcasting
   - Implements heartbeat mechanism for connection health

2. **WalletManager**
   - Extends EventEmitter for event-driven updates
   - Integrates with WebSocket server for broadcasting
   - Manages wallet operations and state changes

3. **Authentication**
   - JWT-based authentication
   - Role-based access control
   - Secure protocol handling

## Connection Setup

### Server-Side Configuration

```javascript
const wsServer = new WalletWebSocketServer({
    server,
    path: '/api/v2/ws/wallet',
    verifyClient: async (info, callback) => {
        try {
            const token = info.req.headers['sec-websocket-protocol'] || 
                         info.req.headers.protocol?.[0] ||
                         info.req.token;
                         
            if (!token) {
                return callback(false, 401, 'Unauthorized');
            }

            const user = await verifyToken(token);
            if (!user || user.role !== 'superadmin') {
                return callback(false, 403, 'Forbidden');
            }

            info.req.user = user;
            callback(true);
        } catch (error) {
            callback(false, 401, 'Unauthorized');
        }
    },
    handleProtocols: (protocols, request) => {
        const token = protocols[0] || request.headers['sec-websocket-protocol'];
        if (!token) return false;
        request.token = token;
        return token;
    }
});
```

### Client-Side Connection

```javascript
const ws = new WebSocket('ws://your-server/api/v2/ws/wallet', sessionToken);

ws.onopen = () => {
    console.log('Connection established');
};

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleMessage(message);
};
```

## Message Types

### 1. Connection Events

```json
{
    "type": "CONNECTED",
    "timestamp": "2024-03-19T20:18:41.000Z"
}
```

### 2. Wallet Updates

```json
{
    "type": "WALLET_UPDATED",
    "data": {
        "type": "created",
        "publicKey": "4GYkSysdRAdEwJr9bqUUU56UyMW73ycpeDGTvHBtFfxN"
    }
}
```

### 3. Balance Updates

```json
{
    "type": "WALLET_UPDATED",
    "data": {
        "type": "balanceChanged",
        "publicKey": "4GYkSysdRAdEwJr9bqUUU56UyMW73ycpeDGTvHBtFfxN",
        "oldBalance": 0,
        "newBalance": 1.5
    }
}
```

## Event Handling

### Server-Side Events

```javascript
class WalletManager extends EventEmitter {
    #setupEventHandlers() {
        this.on('walletCreated', (publicKey) => {
            this.#wsServer?.broadcastWalletUpdate({
                type: 'created',
                publicKey
            });
        });

        this.on('walletStatusChanged', (data) => {
            this.#wsServer?.broadcastWalletUpdate({
                type: 'statusChanged',
                ...data
            });
        });

        this.on('balanceUpdated', (data) => {
            this.#wsServer?.broadcastWalletUpdate({
                type: 'balanceChanged',
                ...data
            });
        });
    }
}
```

### Client-Side Event Handling

```javascript
function handleMessage(message) {
    switch (message.type) {
        case 'CONNECTED':
            handleConnection(message);
            break;
        case 'WALLET_UPDATED':
            handleWalletUpdate(message.data);
            break;
        case 'ERROR':
            handleError(message.error);
            break;
    }
}
```

## Connection Management

### Heartbeat Mechanism

The server implements a heartbeat mechanism to maintain connection health:

```javascript
setInterval(() => {
    this.#wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            this.#clients.delete(ws);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);
```

### Client Tracking

```javascript
#handleConnection(ws, req) {
    ws.isAlive = true;
    this.#clients.set(ws, {
        userId: req.user.id,
        role: req.user.role
    });
}
```

## Security Considerations

1. **Authentication**
   - JWT-based session tokens
   - Token verification on connection
   - Role-based access control

2. **Connection Security**
   - Secure WebSocket protocols
   - Heartbeat monitoring
   - Automatic connection cleanup

3. **Data Protection**
   - Message validation
   - Error handling
   - Secure client tracking

## Testing

### Test Setup

```javascript
const wsConnectionPromise = new Promise((resolve, reject) => {
    const connectTimeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
    }, 5000);

    ws = new WebSocket(`ws://localhost:${PORT}/api/v2/ws/wallet`, sessionToken);

    ws.on('open', () => {
        clearTimeout(connectTimeout);
        resolve();
    });

    ws.on('error', (error) => {
        clearTimeout(connectTimeout);
        reject(error);
    });
});
```

### Message Verification

```javascript
const messages = [];
ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    messages.push(message);
});

// Verify expected events
const hasWalletUpdate = messages.some(m => m.type === 'WALLET_UPDATED');
const hasConnected = messages.some(m => m.type === 'CONNECTED');
```

### Cleanup

```javascript
if (ws?.readyState === WebSocket.OPEN) {
    ws.close();
}

if (server?.listening) {
    await new Promise(resolve => server.close(resolve));
}
```

## Best Practices

1. **Connection Management**
   - Implement connection timeouts
   - Handle reconnection logic
   - Clean up resources properly

2. **Error Handling**
   - Validate messages
   - Handle parsing errors
   - Log connection issues

3. **Testing**
   - Test connection establishment
   - Verify message flow
   - Ensure proper cleanup

4. **Performance**
   - Use message queuing for high load
   - Implement client tracking
   - Monitor connection health

## Integration Example

```javascript
// Initialize WebSocket server
const wsServer = new WalletWebSocketServer(server);

// Connect WalletManager
const walletManager = WalletManager.getInstance();
walletManager.setWebSocketServer(wsServer);

// Handle wallet operations
const wallet = await walletManager.generateWallet('test-wallet');
// WebSocket clients will automatically receive update
```

## Troubleshooting

### Common Issues

1. **Connection Failures**
   - Verify token validity
   - Check server configuration
   - Ensure proper protocol handling

2. **Missing Events**
   - Verify event emitter setup
   - Check client message handling
   - Validate connection state

3. **Resource Leaks**
   - Implement proper cleanup
   - Monitor client connections
   - Clear intervals and timeouts

### Debugging

Enable detailed logging:

```javascript
logApi.info('Raw WebSocket message received:', data.toString());
logApi.info('Parsed WebSocket message:', message);
logApi.info('Broadcasting message:', {
    type: message.type,
    data: message.data,
    timestamp: message.timestamp
});
```

## API Reference

### Server Methods

| Method | Description |
|--------|-------------|
| `broadcastWalletUpdate` | Broadcasts wallet updates to all connected clients |
| `broadcastTransferStarted` | Notifies of transfer initiation |
| `broadcastTransferComplete` | Notifies of transfer completion |
| `broadcastError` | Sends error notifications |

### Event Types

| Event | Description |
|-------|-------------|
| `CONNECTED` | Initial connection confirmation |
| `WALLET_UPDATED` | Wallet state changes |
| `TRANSFER_STARTED` | Transfer initiation |
| `TRANSFER_COMPLETE` | Transfer completion |
| `ERROR` | Error notifications |

## Version History

### Current Version: 2.0.0
- Improved connection handling
- Enhanced security measures
- Better error handling
- Comprehensive testing suite

### Previous Versions
- 1.0.0: Initial implementation
- 1.1.0: Added transfer events
- 1.2.0: Enhanced security

## Support

For technical support or feature requests, please contact:
- Branch Manager (Founder & Chairman)
- Development Team Lead

---

*Last Updated: March 19, 2024*
*Author: Branch Manager's AI Code Assistant Team* 