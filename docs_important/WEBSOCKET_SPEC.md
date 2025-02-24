# Token Data WebSocket API

## Connection
```javascript
const ws = new WebSocket('ws://your-api/web/v1/ws/tokenData');
```

## Message Types

### Client → Server

1. **Subscribe to Tokens**
```javascript
{
    "action": "subscribe",
    "tokens": ["token_address1", "token_address2"],
    "options": {
        // Optional configuration
    }
}
```

2. **Unsubscribe from Tokens**
```javascript
{
    "action": "unsubscribe",
    "tokens": ["token_address1", "token_address2"]
}
```

3. **Request Data Snapshot**
```javascript
{
    "action": "get_snapshot",
    "tokens": ["token_address1", "token_address2"]
}
```

### Server → Client

1. **Connection Confirmation**
```javascript
{
    "type": "connection",
    "status": "connected",
    "clientId": "unique_client_id"
}
```

2. **Subscription Confirmation**
```javascript
{
    "type": "subscription",
    "status": "subscribed",
    "tokens": ["token_address1", "token_address2"]
}
```

3. **Data Update**
```javascript
{
    "type": "update",
    "timestamp": 1234567890123,
    "data": {
        "address": "token_address",
        "symbol": "TOKEN",
        "name": "Token Name",
        "price": "1.23",
        "market_cap": "1000000",
        "volume": {
            "h24": "50000",
            "h6": "12000",
            "h1": "5000",
            "m5": "1000"
        },
        "price_change": {
            "h24": "5.2",
            "h6": "1.3",
            "h1": "0.5",
            "m5": "0.1"
        },
        "metadata": {
            "lastUpdate": 1234567890123
        }
    }
}
```

4. **Data Snapshot**
```javascript
{
    "type": "snapshot",
    "timestamp": 1234567890123,
    "data": [/* Array of token data objects */]
}
```

5. **Error Message**
```javascript
{
    "type": "error",
    "message": "Error description"
}
```

## Features

- **Real-time Updates**: Data refreshed every 30 seconds
- **Efficient Delivery**: Updates only sent for subscribed tokens
- **Connection Health**: Automatic heartbeat checks
- **Initial Snapshot**: Full data provided on subscription
- **Selective Updates**: Subscribe to specific tokens only

## Best Practices

1. **Connection Management**
   - Implement reconnection logic
   - Handle connection errors gracefully
   - Monitor heartbeat responses

2. **Data Handling**
   - Cache initial snapshot
   - Apply updates incrementally
   - Validate data integrity

3. **Performance**
   - Limit subscriptions to needed tokens
   - Batch subscription requests
   - Unsubscribe from unused tokens

## Example Usage

```javascript
const ws = new WebSocket('ws://your-api/web/v1/ws/tokenData');

ws.onopen = () => {
    // Subscribe to tokens
    ws.send(JSON.stringify({
        action: 'subscribe',
        tokens: ['token1', 'token2']
    }));
};

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    switch (message.type) {
        case 'update':
            updateTokenData(message.data);
            break;
        case 'snapshot':
            initializeTokenData(message.data);
            break;
        case 'error':
            handleError(message);
            break;
    }
};

// Implement reconnection logic
ws.onclose = () => {
    setTimeout(connectWebSocket, 5000);
};
``` 