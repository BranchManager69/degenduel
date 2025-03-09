# WebSocket Authentication Implementation

## Overview

This document outlines the implementation of the WebSocket authentication system in DegenDuel, which uses a dedicated token endpoint to provide secure access to WebSocket connections.

## Authentication Flow

The WebSocket authentication system follows a two-stage process:

1. **Session Authentication (Existing)**
   - User authenticates with their wallet via `/api/auth/verify-wallet`
   - Server sets an HTTP-only cookie with the main JWT session token
   - Session lasts for 24 hours

2. **WebSocket Token Generation (New)**
   - Frontend calls `/api/auth/token` before establishing WebSocket connections
   - This endpoint verifies the session cookie is valid
   - Generates a WebSocket-specific JWT token with a 1-hour expiration
   - Returns the token to the client

3. **WebSocket Connection**
   - Client uses the WebSocket-specific token when connecting
   - Token is sent either in the protocol header or URL parameter
   - WebSocket server validates this token before allowing connections

## Implementation Details

### Token Endpoint

```javascript
/**
 * @swagger
 * /api/auth/token:
 *   get:
 *     summary: Get current access token for WebSocket connections
 *     tags: [Authentication]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token provided successfully
 *       401:
 *         description: No valid session
 */
router.get('/token', async (req, res) => {
  try {
    const sessionToken = req.cookies.session;
    if (!sessionToken) {
      authLogger.debug('No session token provided for token request');
      return res.status(401).json({ error: 'No session token provided' });
    }

    const decoded = jwt.verify(sessionToken, config.jwt.secret);
    
    const user = await prisma.users.findUnique({
      where: { wallet_address: decoded.wallet_address }
    });

    if (!user) {
      authLogger.debug('User not found for token request', { wallet: decoded.wallet_address });
      return res.status(401).json({ error: 'User not found' });
    }

    // Create a WebSocket-specific token with shorter expiration
    const wsToken = sign(
      {
        wallet_address: user.wallet_address,
        role: user.role,
        session_id: decoded.session_id // Preserve the same session ID
      },
      config.jwt.secret,
      { expiresIn: '1h' } // Shorter expiration for WebSocket tokens
    );

    // Track token generation with analytics
    authLogger.analytics.trackInteraction(user, 'token_request', {
      success: true,
      session_id: decoded.session_id
    }, req.headers);

    authLogger.info('WebSocket token generated', { 
      wallet: user.wallet_address,
      session_id: decoded.session_id
    });

    return res.json({
      token: wsToken,
      expiresIn: 3600 // 1 hour in seconds
    });

  } catch (error) {
    // Track failed token requests
    authLogger.analytics.trackInteraction(null, 'token_request', {
      success: false,
      error: error.message
    }, req.headers);

    authLogger.error('Token generation failed', { error: error.message });
    res.status(401).json({ error: 'Invalid session' });
  }
});
```

### Client-Side Implementation

The client should:

1. Call `/api/auth/token` before opening WebSocket connections
2. Store the token and its expiration time
3. Include the token when establishing WebSocket connections
4. Refresh the token before it expires

```javascript
// Example client implementation
async function getWebSocketToken() {
  try {
    const response = await fetch('/api/auth/token');
    if (!response.ok) throw new Error('Failed to get token');
    
    const data = await response.json();
    return {
      token: data.token,
      expiresAt: Date.now() + (data.expiresIn * 1000)
    };
  } catch (error) {
    console.error('Error getting WebSocket token:', error);
    throw error;
  }
}

async function connectToWebSocket(url) {
  // Get token first
  const { token } = await getWebSocketToken();
  
  // Connect with token
  const socket = new WebSocket(`${url}?token=${token}`);
  
  // Handle connection events
  socket.onopen = () => console.log('WebSocket connected');
  socket.onerror = (error) => console.error('WebSocket error:', error);
  
  return socket;
}
```

### WebSocket Server Authentication

The server validates tokens by:

1. Extracting the token from the protocol header or URL query parameter
2. Verifying the token using JWT
3. Validating that the user exists in the database
4. Storing user information in the connection context

## Security Considerations

1. **Token Lifetime**: WebSocket tokens have a shorter lifetime (1 hour) than session tokens (24 hours)
2. **Separate Tokens**: Using dedicated WebSocket tokens rather than session tokens
3. **Token Rotation**: Clients should implement token refresh before expiration

## Troubleshooting

If WebSocket connections fail:

1. Check that the client is correctly calling `/api/auth/token` before connecting
2. Verify the token is being passed correctly in the WebSocket connection
3. Check server logs for authentication failures
4. Ensure the token hasn't expired

## Future Improvements

1. Implement WebSocket token refresh mechanism without disconnecting
2. Add rate limiting for token requests
3. Enhance monitoring and metrics for WebSocket authentication
4. Add support for connection pooling and authentication caching

#---------------------------------------------------------------------------------------------------------------

  We can implement this in a non-destructive way using a parallel implementation approach. Here's how:

  Non-Destructive Implementation Strategy

  1. Create Parallel Files Structure
    - Create a new directory: /websocket/v2/ for all new implementations
    - Keep existing WebSockets untouched in /websocket/
  2. Implement Base Class First
    - Create /websocket/v2/base-websocket-v2.js with all enhancements
    - Test thoroughly in isolation
  3. Parallel Implementation of Monitor WebSocket
    - Create /websocket/v2/monitor-ws-v2.js using the new base class
    - Mount at a different endpoint: /api/v2/ws/monitor
    - This lets both old and new implementations run simultaneously
  4. Gradual Client-Side Integration
    - Create a feature flag system in frontend
    - Implement dual connection capability (connect to both old and new)
    - Allow graceful fallback to old system if new one has issues
  5. Testing Without Breaking Changes
    - We can test the new implementation with specific test accounts/browsers
    - Add telemetry to compare performance and reliability
  6. Rollback Plan
    - If anything goes wrong, disable the v2 endpoints
    - No changes to production code until fully validated
  7. Final Cutover
    - Once fully validated, update main endpoints to use v2 implementations
    - Keep old implementations available as fallbacks for 1-2 weeks

  Example Implementation Steps

  // 1. Create v2 base class
  // /websocket/v2/base-websocket-v2.js
  import WebSocket from 'ws';
  import { logApi } from '../../utils/logger-suite/logger.js';

  export class BaseWebSocketServerV2 {
    constructor(server, options = {}) {
      // Enhanced implementation
      // ...
    }
    // Enhanced methods
    // ...
  }

  // 2. Create v2 monitor WebSocket
  // /websocket/v2/monitor-ws-v2.js
  import { BaseWebSocketServerV2 } from './base-websocket-v2.js';

  class MonitorWebSocketServerV2 extends BaseWebSocketServerV2 {
    constructor(server) {
      super(server, {
        path: '/api/v2/ws/monitor', // New v2 path
        // ...
      });
      // ...
    }
    // ...
  }

  // 3. Add to the WebSocket initializer without removing original
  // /websocket/websocket-initializer.js

  // Original initialization remains untouched
  wsServers.monitor = createWebSocketMonitor(server);

  // Add v2 implementation in parallel
  import { createWebSocketMonitorV2 } from './v2/monitor-ws-v2.js';
  wsServers.monitorV2 = createWebSocketMonitorV2(server);

  Client-Side Feature Flag Support

  // In frontend code
  const useWebSocketV2 = getFeatureFlag('use_websocket_v2');

  // Connection helper that tries v2 first, falls back to v1
  function connectToMonitor() {
    if (useWebSocketV2) {
      try {
        const v2Connection = new WebSocket('wss://degenduel.me/api/v2/ws/monitor');

        // If connection fails, fall back to v1
        v2Connection.onerror = () => {
          console.log('Falling back to v1 WebSocket');
          connectToMonitorV1();
        };

        return v2Connection;
      } catch (error) {
        console.error('Error with v2 WebSocket, falling back to v1', error);
        return connectToMonitorV1();
      }
    } else {
      return connectToMonitorV1();
    }
  }

  function connectToMonitorV1() {
    return new WebSocket('wss://degenduel.me/api/ws/monitor');
  }

  This approach gives us complete protection from breaking changes:

  1. We develop entirely new code without modifying existing files
  2. Both implementations run in parallel
  3. We can test with specific users/accounts
  4. We can roll back instantly by disabling the v2 routes
  5. We can collect metrics to validate the new implementation

  It's essentially a blue/green deployment pattern but specifically for the WebSocket infrastructure. This is the safest way to implement
   a significant architectural change like this.

#---------------------------------------------------------------------------------------------------------------

● I've implemented a comprehensive v69 base WebSocket class that provides all the foundational features we discussed. This implementation
   is thorough and carefully designed with the following key features:

  1. Authentication System
    - JWT token validation from multiple sources (query params, headers, cookies)
    - Support for public/private endpoints
    - Role-based access control for channels
  2. Channel Management
    - Subscription handling with fine-grained permissions
    - Channel-specific broadcasting
    - User-specific channels with automatic access control
  3. Connection Lifecycle
    - Proper heartbeat mechanism to detect and clean up stale connections
    - Detailed connection tracking with metadata
    - Graceful cleanup on server shutdown
  4. Security Features
    - Rate limiting to prevent abuse
    - Payload validation and size limits
    - Connection validation and error handling
  5. Monitoring and Statistics
    - Detailed performance metrics and connection statistics
    - Latency tracking
    - Channel usage statistics
  6. Extensibility
    - Clear override points for subclasses
    - Event-based architecture
    - Comprehensive documentation

  This base class can be used by all of our v69 WebSocket implementations without duplicating code. The design allows for a clear
  separation between the core WebSocket functionality and the specific behavior of each WebSocket type.
