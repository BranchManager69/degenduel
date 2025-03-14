# DegenDuel WebSocket Connection Fix

This package provides a robust solution for WebSocket connectivity in the DegenDuel application, addressing current issues with:
- Inconsistent authentication methods across browsers
- Race conditions during connection setup 
- Reconnection handling

## Implementation Guide

### 1. Replace your current WebSocket hooks with these improved versions:

Use the provided files:
- `useWebSocket.js` - Enhanced WebSocket hook with query parameter authentication
- `WebSocketManager.jsx` - Central WebSocket management component (optional)

### 2. Update your WebSocket connection code

**Before:**
```javascript
// Old way - inconsistent across browsers
const ws = new WebSocket(wsUrl);
// or with subprotocol
const ws = new WebSocket(wsUrl, [`token-${token}`]);
```

**After:**
```javascript
// New way - using the custom hook
const { socket, isConnected, sendMessage } = useWebSocket('monitor', {
  token: yourAuthToken,
  reconnect: true
});

// Or using the WebSocketManager
const { monitor } = useWebSocketManager();
const { sendMessage } = monitor;
```

### 3. Authentication Method

This implementation uses query parameters for authentication which is the most reliable method across all browsers:

```
wss://dev.degenduel.me/api/v69/ws/monitor?token=your_jwt_token
```

### 4. Features

- **Reliable Authentication**: Uses query parameters consistently across all browsers
- **Automatic Reconnection**: With exponential backoff and jitter
- **Race Condition Handling**: Properly tracks connection/authentication state
- **Debugging Support**: Comprehensive logging
- **Connection Status Tracking**: Monitor all WebSocket connections

### 5. Best Practices

- Always provide a token for authenticated connections
- Use the `maxReconnectAttempts` option to prevent infinite reconnection attempts
- Enable debugging during development with `debug: true`
- Set `reconnect: false` for one-time connections

## Example Usage

```jsx
import React, { useEffect, useState } from 'react';
import { useWebSocket } from './useWebSocket';

function MyComponent() {
  const [messages, setMessages] = useState([]);
  const { isConnected, sendMessage } = useWebSocket('monitor', {
    token: 'your_jwt_token',
    onMessage: (data) => {
      setMessages(prev => [...prev, data]);
    }
  });

  return (
    <div>
      <div>Status: {isConnected ? 'Connected' : 'Disconnected'}</div>
      <button 
        onClick={() => sendMessage({ type: 'get_system_status' })}
        disabled={!isConnected}
      >
        Get Status
      </button>
      <div>
        {messages.map((msg, i) => (
          <div key={i}>{msg.type}: {JSON.stringify(msg.data)}</div>
        ))}
      </div>
    </div>
  );
}
```