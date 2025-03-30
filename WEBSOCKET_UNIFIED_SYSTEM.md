# DegenDuel Unified WebSocket System (v69)

## Overview

The DegenDuel Unified WebSocket System provides a centralized WebSocket implementation that replaces multiple separate WebSocket servers. It uses a topic-based subscription model allowing clients to subscribe to specific data channels through a single connection.

- **Implementation**: `/websocket/v69/unified-ws.js`
- **Connection Path**: `/api/v69/ws`
- **Initializer**: `/websocket/v69/websocket-initializer.js`
- **Max Payload Size**: 50KB

## Key Features

- **Single Connection**: One WebSocket connection for all data types
- **Topic-Based Subscriptions**: Subscribe to specific data channels
- **Unified Authentication**: JWT-based authentication across all topics
- **Centralized Error Handling**: Consistent error management with error codes
- **Rate Limiting**: Built-in protection against excessive requests
- **No Compression**: Explicitly disables frame compression to ensure client compatibility
- **Heartbeats**: Automatic heartbeat messages to keep connections alive

## Available Topics

| Topic ID | Name | Description | Authentication Required |
|----------|------|-------------|-------------------------|
| `market-data` | Market Data | Real-time market data for tokens | No |
| `portfolio` | Portfolio | User portfolio information | Yes |
| `system` | System | System-wide notifications and events | No |
| `contest` | Contest | Contest information and updates | No (Public), Yes (User-specific) |
| `user` | User | User profile and statistics | Yes |
| `admin` | Admin | Administrative functions | Yes (Admin role) |
| `wallet` | Wallet | Wallet information and transactions | Yes |
| `skyduel` | SkyDuel | SkyDuel game data | No (Public), Yes (User-specific) |

## Message Types

### Client to Server

| Type | Description | Example Use |
|------|-------------|-------------|
| `SUBSCRIBE` | Subscribe to topics | Subscribe to market data |
| `UNSUBSCRIBE` | Unsubscribe from topics | Stop receiving portfolio updates |
| `REQUEST` | Request specific data | Get token details |
| `COMMAND` | Execute an action | Execute a trade |

### Server to Client

| Type | Description | Example Use |
|------|-------------|-------------|
| `DATA` | Data payload | Market data updates |
| `ERROR` | Error information | Authentication failure |
| `SYSTEM` | System messages | Connection status |
| `ACKNOWLEDGMENT` | Confirm client action | Subscription confirmation |

## Connection & Authentication

1. **Connect to WebSocket**:
   ```javascript
   const socket = new WebSocket('wss://degenduel.me/api/v69/ws');
   ```

2. **Authentication**:
   - Include an auth token when subscribing to restricted topics:
   ```javascript
   socket.send(JSON.stringify({
     type: 'SUBSCRIBE',
     topics: ['portfolio', 'user'],
     authToken: 'your-jwt-token'
   }));
   ```
   - Authentication is required for: `portfolio`, `user`, `wallet`, and `admin` topics

3. **Initial Connection Message**:
   - Upon connection, the server sends a welcome message with available topics:
   ```json
   {
     "type": "SYSTEM",
     "message": "Connected to DegenDuel Unified WebSocket",
     "serverTime": "2025-03-27T12:34:56.789Z",
     "topics": ["market-data", "portfolio", "system", "contest", "user", "admin", "wallet", "skyduel"]
   }
   ```

## Basic Usage

### Subscribing to Topics

```javascript
// Subscribe to public topics
socket.send(JSON.stringify({
  type: 'SUBSCRIBE',
  topics: ['market-data', 'system']
}));

// Subscribe to restricted topics (with auth)
socket.send(JSON.stringify({
  type: 'SUBSCRIBE',
  topics: ['portfolio', 'user'],
  authToken: 'your-jwt-token'
}));
```

### Unsubscribing from Topics

```javascript
socket.send(JSON.stringify({
  type: 'UNSUBSCRIBE',
  topics: ['market-data']
}));
```

### Requesting Specific Data

```javascript
// Request token information
socket.send(JSON.stringify({
  type: 'REQUEST',
  topic: 'market-data',
  action: 'getToken',
  symbol: 'SOL',
  requestId: '123' // Optional tracking ID
}));

// Request user profile
socket.send(JSON.stringify({
  type: 'REQUEST',
  topic: 'user',
  action: 'getProfile',
  requestId: '456'
}));
```

### Handling Messages

```javascript
socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'DATA':
      // Handle data updates
      console.log(`Received ${data.topic} data:`, data.data);
      
      // Handle initial data (sent immediately after subscription)
      if (data.initialData) {
        console.log('Received initial data for topic:', data.topic);
      }
      break;
      
    case 'ERROR':
      // Handle error
      console.error(`Error ${data.code}: ${data.message}`);
      break;
      
    case 'ACKNOWLEDGMENT':
      // Handle acknowledgments
      console.log(`${data.operation} acknowledged for topics:`, data.topics);
      break;
      
    case 'SYSTEM':
      // Handle system messages
      console.log(`System message: ${data.message}`);
      
      // Handle heartbeat messages
      if (data.action === 'heartbeat') {
        console.log('Received heartbeat at:', data.timestamp);
      }
      break;
  }
};
```

## Topic-Specific Functionality

### Market Data Topic (`market-data`)

- **Subscribe**: Receive real-time market data updates
- **Actions**:
  - `getToken`: Get data for a specific token
    ```javascript
    {
      type: 'REQUEST',
      topic: 'market-data',
      action: 'getToken',
      symbol: 'SOL',
      requestId: '123'
    }
    ```
  - `getAllTokens`: Get data for all tokens
    ```javascript
    {
      type: 'REQUEST',
      topic: 'market-data',
      action: 'getAllTokens',
      requestId: '124'
    }
    ```
- **Initial Data**: Receives all token data immediately upon subscription

### User Topic (`user`)

- **Auth Required**: Yes
- **Subscribe**: Receive real-time user updates
- **Actions**:
  - `getProfile`: Get user profile information
    ```javascript
    {
      type: 'REQUEST',
      topic: 'user',
      action: 'getProfile',
      requestId: '125'
    }
    ```
    - Returns: `id`, `wallet_address`, `nickname`, `role`, `created_at`, `last_login`, `profile_image_url`
  - `getStats`: Get user statistics
    ```javascript
    {
      type: 'REQUEST',
      topic: 'user',
      action: 'getStats',
      requestId: '126'
    }
    ```
    - Returns: `total_trades`, `win_count`, `loss_count`, `xp`, `level`, `rank`, `last_updated`
- **Initial Data**: Receives user profile data immediately upon subscription

### Portfolio Topic (`portfolio`)

- **Auth Required**: Yes
- **Subscribe**: Receive real-time portfolio updates
- **Initial Data**: Will receive portfolio data upon subscription when implemented
- **Actions**: *(Implementation in progress)*

### Contest Topic (`contest`)

- **Auth Required**: No for public data, Yes for user-specific data
- **Subscribe**: Receive contest updates
- **Actions**: *(Implementation in progress)*

### Wallet Topic (`wallet`)

- **Auth Required**: Yes
- **Subscribe**: Receive wallet transaction updates
- **Actions**: *(Implementation in progress)*

### Admin Topic (`admin`)

- **Auth Required**: Yes (ADMIN or SUPER_ADMIN role)
- **Subscribe**: Receive admin-specific notifications
- **Actions**: *(Implementation in progress)*

### System Topic (`system`)

- **Auth Required**: No (getStatus/ping), Yes (getMetrics - Admin only)
- **Subscribe**: Receive system-wide notifications
- **System Messages**:
  - Connection welcome message
  - Heartbeat messages (every 30 seconds)
  - Server status updates
  - Server shutdown notifications
- **Actions**:
  - `getStatus`: Get system status information
    ```javascript
    {
      type: 'REQUEST',
      topic: 'system',
      action: 'getStatus',
      requestId: '127'
    }
    ```
    - Returns: `status`, `version`, `serverTime`, `uptime`, `connections`
  - `ping`: Get server time for latency calculation
    ```javascript
    {
      type: 'REQUEST',
      topic: 'system',
      action: 'ping',
      clientTime: new Date().toISOString(), // Optional
      requestId: '128'
    }
    ```
    - Returns: `serverTime`, `clientTime` (if provided), `roundTrip` (boolean)
  - `getMetrics`: Get detailed WebSocket metrics (Admin only)
    ```javascript
    {
      type: 'REQUEST',
      topic: 'system',
      action: 'getMetrics',
      requestId: '129'
    }
    ```
    - Returns detailed metrics about connections, subscriptions, and message counts

### Server Shutdown Process

During server restarts or shutdowns, the WebSocket server will:

1. Send a shutdown notification to all connected clients:
   ```json
   {
     "type": "SYSTEM",
     "action": "shutdown",
     "message": "Server is restarting, please reconnect in 30 seconds",
     "expectedDowntime": 30000,
     "timestamp": "2025-03-29T12:34:56.789Z"
   }
   ```

2. Give clients a brief window (300ms) to receive and process the notification

3. Close all WebSocket connections with status code 1000 ("Normal Closure") and a reason message

Clients should handle this notification by:
- Displaying appropriate UI feedback to users
- Waiting for the expected downtime duration
- Attempting to reconnect after the expected downtime period

### SkyDuel Topic (`skyduel`)

- **Auth Required**: No for public data, Yes for user-specific data
- **Subscribe**: Receive SkyDuel game updates
- **Actions**: *(Implementation in progress)*

## Error Codes

| Code Range | Type | Description |
|------------|------|-------------|
| 4000-4099 | Client Error | Issues with client requests |
| 5000-5099 | Server Error | Server-side issues |

### Client Error Codes

| Code | Description |
|------|-------------|
| 4000 | Invalid message format (not JSON) |
| 4001 | Missing message type |
| 4002 | Unknown message type |
| 4003 | Subscription requires at least one topic |
| 4004 | No valid topics provided |
| 4005 | Unsubscription requires at least one topic |
| 4006 | Request requires topic and action |
| 4007 | Unknown topic |
| 4008 | Symbol is required for getToken action |
| 4009 | Unknown action for topic |
| 4010 | Authentication required for restricted topics |
| 4011 | Invalid authentication token |
| 4012 | Admin role required for admin topics |
| 4013 | Authentication required for user requests/commands |
| 4014 | Command requires topic and action |
| 4040 | Token not found |
| 4041 | User profile not found |

### Server Error Codes

| Code | Description |
|------|-------------|
| 5000 | Internal server error |
| 5001 | Request handling not implemented for topic |
| 5002 | Error processing request |
| 5003 | Commands not implemented for topic |
| 5004 | Error processing command |

## Testing

You can use the browser DevTools console to test the WebSocket connection:

```javascript
// Connect to WebSocket
const socket = new WebSocket('wss://degenduel.me/api/v69/ws');

// Log all messages
socket.onmessage = (event) => {
  console.log('Received:', JSON.parse(event.data));
};

// Log connection events
socket.onopen = () => console.log('Connected');
socket.onclose = () => console.log('Disconnected');
socket.onerror = (error) => console.error('Error:', error);

// Helper function to send messages
function sendWS(data) {
  socket.send(JSON.stringify(data));
}

// Example: Subscribe to market data
sendWS({
  type: 'SUBSCRIBE',
  topics: ['market-data']
});
```

## Implementation Details

- The WebSocket server explicitly disables compression (`perMessageDeflate: false`) to avoid client compatibility issues
- Connections are automatically maintained with 30-second heartbeat messages
- Each message includes a timestamp in ISO 8601 format
- Initial data is sent automatically after subscribing to a topic (with `initialData: true` flag)
- The server maintains comprehensive metrics on connections, messages, and errors
- WebSocket server raises event listener limit to 30 (from default 10) to support multiple handlers
- The implementation includes multiple optimization techniques to prevent memory leaks

## Architecture Considerations

- The WebSocket server is designed to be a singleton instance (stored in `config.websocket.unifiedWebSocket`)
- The implementation follows a modular approach for adding new topics and handlers
- Authentication is handled uniformly across all topics
- Error handling is consistent with standardized error codes
- The server maintains several data structures for efficient message routing:
  - `clientsByUserId`: Maps user IDs to their active connections
  - `clientSubscriptions`: Maps client connections to their subscribed topics
  - `topicSubscribers`: Maps topics to their subscribers
  - `authenticatedClients`: Maps clients to their authentication data
- Event handlers are registered with `serviceEvents` for broadcasting service events to WebSocket clients
- The server includes comprehensive metrics tracking and logging for debugging and monitoring
- All operations include proper cleanup to prevent memory leaks
- The design supports graceful startup and shutdown

---

*Last Updated: March 28, 2025*