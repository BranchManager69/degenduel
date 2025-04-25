# WebSocket Transition Guide & Examples

This comprehensive guide documents the process of transitioning from the legacy WebSocket implementations to the new Unified WebSocket System (v69).

## Overview

The DegenDuel v69 Unified WebSocket System provides a single connection point for all WebSocket communications, using a topic-based subscription model. This architecture reduces connection overhead and simplifies client code, while making the server implementation more modular and maintainable.

## Architecture

The refactored v69 Unified WebSocket system follows a modular architecture:

```
websocket/v69/unified/
├── UnifiedWebSocketServer.js  - Main class that ties everything together
├── index.js                   - Entry point and exports
├── utils.js                   - Helper functions and utilities
├── handlers.js                - Connection and message handling
├── requestHandlers.js         - Topic-specific request handlers
├── services.js                - Service event integration
└── integration-example.js     - Example implementation
```

## Files That Need Updating

### Primary Files
1. `/home/websites/degenduel/index.js` - Main server file that initializes WebSockets
2. `/home/websites/degenduel/websocket/v69/websocket-initializer.js` - V69 WebSocket initialization

### WebSocket Implementation Files to Deprecate
3. All standalone WebSocket server implementations in `/websocket/v69/`:
   - `analytics-ws.js`
   - `circuit-breaker-ws.js`
   - `contest-ws.js`
   - `market-data-ws.js`
   - `monitor-ws.js`
   - `portfolio-ws.js`
   - `skyduel-ws.js`
   - `system-settings-ws.js`
   - `terminal-data-ws.js`
   - `token-data-ws.js`
   - `user-notification-ws.js`

### Client/Service Files Using WebSockets
4. Services that interact with WebSockets:
   - `/services/ai-service/ai-service.js`
   - `/services/ai-service/utils/additional-functions.js`
   - `/services/marketDataService.js`
   - `/services/solana-engine/helius-balance-tracker.js`
   - `/services/solana-engine/solana-engine.js`
   - `/services/tokenMonitorService.js`

5. Routes that handle WebSocket status/testing:
   - `/routes/admin/websocket-monitor.js`
   - `/routes/admin/websocket-status.js`
   - `/routes/admin/websocket-test.js`
   - `/routes/websocket-api-guide.js`

## Migration Process

### 1. Deprecation & Transition Setup

Add deprecation notices to all legacy WebSocket files:

```javascript
/**
 * @deprecated This implementation is deprecated and will be removed in a future release.
 * Please use the new Unified WebSocket System instead, which provides the same functionality
 * with a more maintainable architecture. See /websocket/v69/unified/ for the new implementation.
 */
```

### 2. Server-Side Migration Steps

1. **WebSocket Initializer Update**:
   Modify `websocket/v69/websocket-initializer.js` to use the unified system.

   Before:
   ```javascript
   // Initialize separate WebSocket servers
   const terminalWs = new TerminalDataWebSocket(server);
   const marketDataWs = new MarketDataWebSocketServer(server);
   // ...etc for each WebSocket type
   ```

   After:
   ```javascript
   // Initialize just the unified WebSocket server
   const unifiedWs = createUnifiedWebSocket(server);
   ```

2. **Main Server Integration**:
   Update `index.js` to use the unified WebSocket initializer.

3. **Service Event Registration**:
   Update service event handling to work with the unified system:

   ```javascript
   // Old way (separate WebSocket servers)
   serviceEvents.on('token:update', data => tokenWs.broadcast(data));
   
   // New way (unified WebSocket server)
   serviceEvents.on('token:update', data => 
     unifiedWs.broadcast('token', {
       type: 'DATA',
       topic: 'token',
       data: data,
       timestamp: new Date().toISOString()
     })
   );
   ```

### 3. Client-Side Migration Steps

1. Update all client code to connect to the unified endpoint:

   Before:
   ```javascript
   // Separate connections for different data types
   const terminalWs = new WebSocket('/api/v69/ws/terminal-data');
   const marketWs = new WebSocket('/api/v69/ws/market-data');
   ```

   After:
   ```javascript
   // Single connection for all data types
   const ws = new WebSocket('/api/v69/ws');
   
   // Subscribe to topics you need
   ws.send(JSON.stringify({
     type: 'SUBSCRIBE',
     topic: 'terminal'
   }));
   
   ws.send(JSON.stringify({
     type: 'SUBSCRIBE',
     topic: 'market-data'
   }));
   ```

2. Update request patterns:

   Before:
   ```javascript
   // Old pattern varied by WebSocket type
   marketWs.send(JSON.stringify({
     action: 'getTokenPrice',
     symbol: 'SOL'
   }));
   ```

   After:
   ```javascript
   // New standardized pattern
   ws.send(JSON.stringify({
     type: 'REQUEST',
     topic: 'market-data',
     action: 'getTokenPrice',
     data: { symbol: 'SOL' }
   }));
   ```

3. Update message handling:

   Before:
   ```javascript
   // Separate handlers for each connection
   terminalWs.onmessage = (event) => {
     // Handle terminal data
   };
   
   marketWs.onmessage = (event) => {
     // Handle market data
   };
   ```

   After:
   ```javascript
   // Single handler with topic-based routing
   ws.onmessage = (event) => {
     const message = JSON.parse(event.data);
     
     switch (message.topic) {
       case 'terminal':
         // Handle terminal data
         break;
       case 'market-data':
         // Handle market data
         break;
     }
   };
   ```

## Example Transitions

### Terminal WebSocket

See `terminal-transition.js` for a complete example of transitioning the Terminal WebSocket to the unified system.

Key points:
- Uses the unified WebSocket server instead of dedicated server
- Routes terminal data requests to the appropriate handler
- Maintains the same data structure and event patterns

### Terminal Data Capabilities

The terminal data system provides:

1. **Basic Platform Information**:
   - Platform name, description, and status
   - Token configuration and roadmap data
   - Platform statistics

2. **AI Terminal Functionality**:
   - AI assistant (Didi) with multiple personality loadouts
   - Functions to access token data, contests, user profiles
   - Admin-only diagnostic functions

3. **Available Functions**:
   - Token data functions: `getTokenPrice`, `getTokenPriceHistory`, etc.
   - Contest functions: `getActiveContests`
   - User profile functions: `getUserProfile`, `getTopUsers`, etc.
   - Admin functions: `getServiceStatus`, `getSystemSettings`, etc.

## Complete File List Command

To find all JavaScript files (excluding node_modules and archives) that reference any WebSocket implementation and might need updating:

```bash
find /home/websites/degenduel -type f -name "*.js" | grep -v node_modules | grep -v archive | xargs grep -l "WebSocketServer\|BaseWebSocketServer\|createWebSocket\|initializeWebSockets\|TerminalDataWebSocket\|MarketDataWebSocketServer\|AnalyticsWebSocketServer\|PortfolioWebSocketServer" | sort
```

## Migration Benefits

1. **Reduced Connection Overhead**: A single WebSocket connection handles all data types
2. **Simplified Client Code**: Consistent message format and error handling
3. **Better Authentication**: Unified authentication flow for all WebSocket operations
4. **More Maintainable Server Code**: Modular architecture separates concerns
5. **Consistent Error Handling**: Standardized error responses
6. **Improved Performance**: Fewer connections means less overhead

## Migration Timeline

- **Phase 1**: Add deprecation notices to old WebSocket implementations
- **Phase 2**: Create transition examples for each WebSocket type
- **Phase 3**: Update client code to use the unified system
- **Phase 4**: Remove deprecated implementations

## Testing the Migration

1. First test with a single topic (like terminal data)
2. Update client code to use the new endpoint
3. Verify data flows correctly in both directions
4. Monitor for any errors or performance issues
5. Gradually migrate other topics

## Backward Compatibility

During the transition, maintain both systems:
1. Legacy WebSocket endpoints will continue to work
2. The new unified endpoint will handle all data types
3. This allows for gradual migration of client code

## Contact

If you have questions about the migration process, contact the platform team.