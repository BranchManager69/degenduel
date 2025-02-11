# DegenDuel Analytics System Documentation

## Overview

The DegenDuel Analytics System provides real-time monitoring and analysis of platform activity through a secure WebSocket connection. This system is designed exclusively for superadmin users and provides comprehensive insights into user behavior, trading patterns, and platform performance.

## Architecture

### Components

1. **WebSocket Server**
   - Path: `/analytics`
   - Secure authentication using JWT
   - Superadmin-only access
   - Real-time bidirectional communication
   - Automatic reconnection support
   - Ping/pong heartbeat mechanism

2. **Analytics Dashboard API**
   - Base Path: `/api/admin/analytics-dashboard`
   - Real-time user activity endpoint
   - User journey analysis
   - Behavioral pattern recognition
   - Performance metrics aggregation

3. **Data Collection Services**
   - Session tracking
   - User interaction logging
   - Performance monitoring
   - Error tracking
   - Geographic distribution analysis

## Security

### Authentication

1. **JWT Token Requirements**
   ```javascript
   {
     wallet_address: string;
     role: "superadmin";  // Must be superadmin
     session_id: string;  // For session tracking
   }
   ```

2. **Connection Verification**
   - Token validation on connection
   - Role verification (superadmin only)
   - Session tracking and timeout handling
   - Secure WebSocket (WSS) in production

### Data Protection

- All sensitive data is sanitized before transmission
- No private keys or sensitive user data is exposed
- Geographic data is aggregated for privacy
- Rate limiting on API endpoints
- Automatic connection termination after inactivity

## WebSocket Protocol

### Connection

1. **Establishing Connection**
   ```javascript
   const ws = new WebSocket(`wss://api.degenduel.me/analytics?token=${jwt}`);
   ```

2. **Connection Lifecycle**
   - Initial connection with JWT authentication
   - Server sends confirmation message
   - Client must send periodic pings
   - Automatic disconnection after 30 seconds of inactivity

### Message Types

1. **Server to Client**
   ```typescript
   interface AnalyticsMessage {
       type: 
           | "connection_established"
           | "analytics_update"
           | "pong";
       timestamp: string;
       data?: {
           active_users: number;
           sessions: Array<{
               wallet: string;
               current_page: string;
               last_action: string;
           }>;
       };
   }
   ```

2. **Client to Server**
   ```typescript
   interface ClientMessage {
       type: "ping";
       timestamp: string;
   }
   ```

### Keep-Alive Protocol

1. **Ping Interval**
   - Client must send ping every 15 seconds
   - Server responds with pong message
   - Connection terminated after 30 seconds without ping

2. **Reconnection**
   - Automatic reconnection on connection loss
   - Exponential backoff strategy
   - Maximum of 5 retry attempts

## Analytics Dashboard API

### Real-time Analytics Endpoint

```http
GET /api/admin/analytics-dashboard/realtime
```

**Response:**
```typescript
interface AnalyticsData {
    active_users: Array<{
        wallet: string;
        nickname: string;
        current_page: string;
        last_action: string;
        last_active: string;
        session_duration: number;
        device: string;
        location: string;
        interests: string[];
        portfolio_value: number;
        favorite_tokens: string[];
        risk_score: number;
        trading_style: string;
    }>;
    total_active: number;
    user_segments: {
        by_activity: {
            power_users: any[];
            regular: any[];
            casual: any[];
        };
        by_portfolio: {
            whale: any[];
            dolphin: any[];
            fish: any[];
        };
        by_style: {
            aggressive: any[];
            moderate: any[];
            conservative: any[];
        };
    };
    behavioral_patterns: any;
    geographic_distribution: any;
    device_breakdown: any;
    trading_insights: {
        popular_pairs: any;
        volume_trends: any;
        risk_distribution: any;
    };
    user_interests: any;
    engagement_metrics: any;
    retention_data: any;
}
```

### User Journey Analysis

```http
GET /api/admin/analytics-dashboard/user/:wallet/journey
```

**Response:**
```typescript
interface UserJourney {
    interaction_timeline: Array<{
        timestamp: string;
        action: string;
        details: string;
    }>;
    common_patterns: any;
    interests: any;
    trading_preferences: any;
    risk_profile: any;
    social_connections: {
        influence_score: number;
        network_size: number;
        community_role: string;
    };
    feature_usage: {
        favorites: string[];
    };
    session_analytics: any;
}
```

## Implementation Guide

### Setting Up the WebSocket Client

1. **Basic Connection**
   ```javascript
   const ws = new WebSocket(`wss://api.degenduel.me/analytics?token=${jwt}`);
   
   ws.onopen = () => {
       console.log('Connected to analytics server');
       startPingInterval();
   };
   
   ws.onmessage = (event) => {
       const message = JSON.parse(event.data);
       handleAnalyticsMessage(message);
   };
   
   ws.onerror = (error) => {
       console.error('WebSocket error:', error);
   };
   
   ws.onclose = () => {
       console.log('Connection closed');
       stopPingInterval();
   };
   ```

2. **Keep-Alive Implementation**
   ```javascript
   let pingInterval;
   
   function startPingInterval() {
       pingInterval = setInterval(() => {
           if (ws.readyState === WebSocket.OPEN) {
               ws.send(JSON.stringify({
                   type: 'ping',
                   timestamp: new Date().toISOString()
               }));
           }
       }, 15000);
   }
   
   function stopPingInterval() {
       if (pingInterval) {
           clearInterval(pingInterval);
       }
   }
   ```

3. **Message Handling**
   ```javascript
   function handleAnalyticsMessage(message) {
       switch (message.type) {
           case 'connection_established':
               console.log('Connected to analytics server');
               break;
           case 'analytics_update':
               updateDashboard(message.data);
               break;
           case 'pong':
               // Connection is healthy
               break;
       }
   }
   ```

### Error Handling

1. **Connection Errors**
   ```javascript
   class AnalyticsConnectionError extends Error {
       constructor(message, code) {
           super(message);
           this.name = 'AnalyticsConnectionError';
           this.code = code;
       }
   }
   
   // Implementation
   ws.onerror = (error) => {
       if (error.code === 1006) {
           throw new AnalyticsConnectionError('Connection closed abnormally', error.code);
       }
       // Handle other error types
   };
   ```

2. **Message Validation**
   ```javascript
   function validateMessage(message) {
       if (!message.type || !message.timestamp) {
           throw new Error('Invalid message format');
       }
       // Additional validation logic
   }
   ```

## Testing

### Test Script Usage

1. **Running the Test Script**
   ```bash
   npm run test:websocket
   ```

2. **Expected Output**
   ```
   ✅ Connected to WebSocket server
   📥 Received message: {
       "type": "connection_established",
       "timestamp": "2024-02-07T11:41:43.762Z"
   }
   ✅ Server confirmed connection
   ```

### Manual Testing

1. **Using Browser Console**
   ```javascript
   // Open browser console in analytics dashboard
   // Look for these messages:
   "WebSocket connection established"
   "Received analytics update with X active sessions"
   ```

2. **Monitoring Connection Health**
   - Check for ping/pong messages every 15 seconds
   - Verify data updates are being received
   - Monitor for any error messages

## Troubleshooting

### Common Issues

1. **Connection Failures**
   - Verify JWT token is valid and not expired
   - Confirm superadmin role is present in token
   - Check network connectivity
   - Verify WebSocket server is running

2. **Data Not Updating**
   - Check ping/pong messages are being exchanged
   - Verify subscription to correct data channels
   - Check for any console errors
   - Verify server is broadcasting updates

3. **Performance Issues**
   - Monitor message frequency
   - Check client-side memory usage
   - Verify network latency
   - Monitor server resource usage

### Debugging Tools

1. **Browser DevTools**
   - Network tab for WebSocket frames
   - Console for connection logs
   - Performance monitoring

2. **Server Logs**
   - Check analytics service logs
   - Monitor WebSocket server logs
   - Review error logs

## Best Practices

1. **Connection Management**
   - Implement exponential backoff for reconnection
   - Handle connection timeouts gracefully
   - Clean up resources on disconnection
   - Monitor connection health

2. **Data Handling**
   - Cache frequently accessed data
   - Implement data validation
   - Handle missing or malformed data
   - Use appropriate data structures

3. **Security**
   - Validate all incoming messages
   - Sanitize data before display
   - Monitor for suspicious activity
   - Regular security audits

4. **Performance**
   - Optimize message size
   - Batch updates when possible
   - Implement client-side caching
   - Monitor resource usage

## API Reference

### WebSocket Events

| Event Type | Direction | Description |
|------------|-----------|-------------|
| connection_established | Server → Client | Initial connection confirmation |
| analytics_update | Server → Client | Real-time analytics data update |
| ping | Client → Server | Connection keep-alive message |
| pong | Server → Client | Server keep-alive response |

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/admin/analytics-dashboard/realtime | GET | Real-time platform analytics |
| /api/admin/analytics-dashboard/user/:wallet/journey | GET | User journey analysis |

## Support

For technical support or questions about the analytics system:

1. **Contact**
   - Technical Support: support@degenduel.me
   - Developer Discord: https://discord.gg/degenduel-dev

2. **Resources**
   - GitHub Repository: https://github.com/degenduel/analytics
   - Documentation: https://docs.degenduel.me/analytics
   - API Reference: https://api.degenduel.me/docs 