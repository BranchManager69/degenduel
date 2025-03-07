# DegenDuel WebSocket System Overhaul

## Overview

This document tracks the progress of the comprehensive WebSocket system overhaul for DegenDuel. The new implementation provides enhanced security, better connection management, and improved performance monitoring.

## Current Implementation Status

### Authentication Flow

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

### Detailed Implementation Examples

#### Token Endpoint Implementation

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

#### Client-Side Implementation Example

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

#### Client-Side Feature Flag Support

```javascript
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
```

### WebSocket Server Authentication

The server validates tokens by:

1. Extracting the token from the protocol header or URL query parameter
2. Verifying the token using JWT
3. Validating that the user exists in the database
4. Storing user information in the connection context

### Security Considerations

1. **Token Lifetime**: WebSocket tokens have a shorter lifetime (1 hour) than session tokens (24 hours)
2. **Separate Tokens**: Using dedicated WebSocket tokens rather than session tokens
3. **Token Rotation**: Clients should implement token refresh before expiration

### Troubleshooting

If WebSocket connections fail:

1. Check that the client is correctly calling `/api/auth/token` before connecting
2. Verify the token is being passed correctly in the WebSocket connection
3. Check server logs for authentication failures
4. Ensure the token hasn't expired

### Implementation Strategy

We're using a non-destructive parallel implementation approach:

1. **Create Parallel Files Structure**
   - New directory: `/websocket/v2/` for all new implementations
   - Existing WebSockets remain untouched in `/websocket/`

2. **Implement Base Class First**
   - Create `/websocket/v2/base-websocket-v2.js` with all enhancements
   - Test thoroughly in isolation

3. **Parallel Implementation of WebSockets**
   - Create `/websocket/v2/monitor-ws-v2.js` using the new base class
   - Mount at different endpoints (e.g., `/api/v2/ws/monitor`)
   - Both old and new implementations run simultaneously

4. **Gradual Client-Side Integration**
   - Feature flag system in frontend
   - Dual connection capability with fallback to old system if needed

5. **Testing Without Breaking Changes**
   - Test with specific test accounts/browsers
   - Add telemetry to compare performance and reliability

6. **Rollback Plan**
   - Disable v2 endpoints if issues arise
   - No changes to production code until fully validated

7. **Final Cutover**
   - Update main endpoints to use v2 implementations
   - Keep old implementations as fallbacks for 1-2 weeks

### Latest Development: v69 Base WebSocket Class

A comprehensive v69 base WebSocket class has been implemented with the following features:

1. **Authentication System**
   - JWT token validation from multiple sources (query params, headers, cookies)
   - Support for public/private endpoints
   - Role-based access control for channels

2. **Channel Management**
   - Subscription handling with fine-grained permissions
   - Channel-specific broadcasting
   - User-specific channels with automatic access control

3. **Connection Lifecycle**
   - Proper heartbeat mechanism to detect and clean up stale connections
   - Detailed connection tracking with metadata
   - Graceful cleanup on server shutdown

4. **Security Features**
   - Rate limiting to prevent abuse
   - Payload validation and size limits
   - Connection validation and error handling

5. **Monitoring and Statistics**
   - Detailed performance metrics and connection statistics
   - Latency tracking
   - Channel usage statistics

6. **Extensibility**
   - Clear override points for subclasses
   - Event-based architecture
   - Comprehensive documentation

This base class will be used by all v69 WebSocket implementations, providing a clear separation between core WebSocket functionality and the specific behavior of each WebSocket type.

### Successful Implementation of Parallel WebSocket Architecture

The parallel WebSocket architecture has been successfully implemented with the v69 system now running alongside the existing WebSockets. Here's what has been accomplished:

1. **Complete Base WebSocket Class**
   - Created `/websocket/v69/base-websocket.js` with:
     - Advanced authentication with JWT validation
     - Channel-based subscription management
     - Connection lifecycle management
     - Performance metrics
     - Security protections

2. **First v69 WebSocket Server Implementation**
   - Implemented `/websocket/v69/monitor-ws.js` that:
     - Handles system status updates
     - Tracks maintenance mode
     - Provides system settings (including the public background_scene)
     - Supports service monitoring
     - Follows the parallel implementation pattern

3. **WebSocket Initializer**
   - Created `/websocket/v69/websocket-initializer.js` that:
     - Sets up all v69 WebSockets
     - Runs independently from the original system
     - Has proper error handling and logging

4. **Integration with Existing Infrastructure**
   - Modified the original WebSocket initializer to start v69 WebSockets in parallel
   - Added proper cleanup for v69 WebSockets
   - Ensured both systems can run side-by-side without conflicts

The server has been restarted, and the v69 WebSocket system is now online at `/api/v69/ws/monitor`. This endpoint provides real-time system status updates, maintenance mode changes, and system settings (including background_scene).

### Documentation and Testing Tools

A comprehensive README.md file has been created at `/websocket/v69/README.md` that documents the new WebSocket system:

1. **Architecture Overview**
   - Describes the parallel implementation approach
   - Outlines key features of the v69 system
   - Provides a table of available WebSockets

2. **Test Client**
   - A dedicated test client is available at `/websocket/v69/test-client.js`
   - Supports testing all v69 WebSocket implementations
   - Provides a consistent interface for testing
   - Includes command-line options for authentication, channel subscription, and automated testing

3. **Available Commands**
   - The test client supports various commands:
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

4. **Channel Documentation**
   - The Monitor WebSocket provides these channels:
     - `system.status` - Real-time system status updates
     - `system.maintenance` - Maintenance mode changes
     - `system.settings` - System settings changes (admin only)
     - `public.background_scene` - Public background scene setting (no auth required)
     - `services` - Service status changes (admin only)

5. **Authentication Methods**
   - Detailed explanation of authentication options:
     - Query Parameter: `?token=YOUR_TOKEN`
     - WebSocket Protocol: In the Sec-WebSocket-Protocol header
     - Authorization Header: For HTTP/2 connections

### Successful Testing of Monitor WebSocket

The v69 Monitor WebSocket has been successfully tested using the test client:

```bash
node websocket/v69/test-client.js monitor --test
```

The test confirmed that the WebSocket is functioning correctly, with proper authentication handling and channel subscription capabilities. The test client provides detailed information about obtaining authentication tokens:

```
Connecting to ws://localhost:3004/api/v69/ws/monitor...
2025-03-06 23:24:45 [INFO] To get an authentication token, login to DegenDuel and then run:
2025-03-06 23:24:45 [INFO] curl -v --cookie "session=YOUR_SESSION_COOKIE" http://localhost:3004/api/auth/token
```

### Implementation of Contest WebSocket

The Contest WebSocket has been successfully implemented and is now available at `/api/v69/ws/contest`. This implementation showcases the power of the v69 architecture with advanced real-time features:

1. **Complete Contest Data Management**
   - Real-time contest state updates
   - Participant status and leaderboard updates
   - Efficient caching for performance

2. **Interactive Chat Rooms**
   - Per-contest chat functionality
   - Admin visibility controls
   - Rate limiting and message length restrictions
   - Message history management

3. **Admin Capabilities**
   - "Drop-in" functionality for admins to observe contests
   - Visibility toggle (visible/invisible to participants)
   - Admin presence notification to participants
   - Special admin channels for monitoring

4. **Spectator Support**
   - Public contest data for unauthenticated users
   - Spectator count tracking and broadcasting
   - Limited data access model for non-participants

5. **User Presence System**
   - Real-time notifications when users join/leave
   - Built-in "room" concept for contests
   - Channel-based subscription model

The Contest WebSocket can be tested using the test client:

```bash
node websocket/v69/test-client.js contest
```

### Enhanced WebSocket Logging and Security

The WebSocket system has been further improved with comprehensive logging and security enhancements:

1. **Colorized Console Logging**
   - Consistent visual formatting with background colors for event types
   - Role-based color coding (admins in red, regular users in purple, unauthenticated in light gray)
   - Detailed connection lifecycle logs with user wallet addresses and roles
   - Standardized log prefixes for easier log filtering and analysis

2. **Authentication Security Improvements**
   - Enhanced token extraction with prioritized security methods:
     - Authorization header (most secure, preferred method)
     - WebSocket protocol header
     - Cookie-based authentication
     - Query parameter (least secure, now generates warnings)
   - Clear warnings in logs when less secure authentication methods are used
   - Detailed logging of authentication successes and failures

3. **Room Management Visibility**
   - Improved room operation tracking (creation, joining, leaving)
   - Detailed participant counts with milestone logging
   - User role and visibility status in all logs

4. **Chat System Enhancements**
   - Message validation with proper error handling
   - Rate limiting with informative user feedback
   - Colorized log entries for chat messages by role

5. **Admin Presence Monitoring**
   - Detailed visibility state tracking and logging
   - Clear distinction between visible and invisible admin activity
   - Admin presence broadcast controls for privacy

6. **Spectator Tracking**
   - Enhanced spectator count tracking with milestone logging (at 1, 10, 20, etc.)
   - Real-time spectator count broadcasting to room participants
   - Accurate spectator accounting for connection drops

These enhancements provide better debugging capabilities, improved security, and greater visibility into the WebSocket system's operation. The logging improvements in particular make it easier to identify connection issues, auth problems, and monitor room activity in real-time.

## Planned WebSocket Implementations

Future WebSocket implementations planned:

1. **Token Data WebSocket** (`/api/v69/ws/token-data`)
   - Real-time token price and metadata updates
   - Token whitelist changes
   - Market data streaming
   - Efficient data compression for large messages
   - Addresses polling issues observed in logs

2. **SkyDuel WebSocket** (`/api/v69/ws/skyduel`)
   - Real-time game state synchronization
   - Player movement and action broadcasting
   - Match creation and joining functionality
   - Spectator support with efficient data streaming
   - Low-latency optimization for gameplay responsiveness

3. **Wallet WebSocket** (`/api/v69/ws/wallet`)
   - Real-time balance updates
   - Transaction notifications
   - Portfolio value changes
   - Asset movement tracking
   - Reduces polling on server

4. **Analytics WebSocket** (`/api/v69/ws/analytics`)
   - Real-time user activity metrics
   - Platform performance dashboard
   - Contest engagement statistics
   - Market trend analysis
   - Optimized for admin dashboards with high data throughput

5. **User Notification WebSocket** (`/api/v69/ws/notifications`)
   - Real-time user notification delivery
   - Personalized alerts and updates
   - Contest status announcements
   - Achievement and reward notifications
   - User-specific event streaming

6. **Portfolio WebSocket** (potential consolidation with Token Data)
   - Portfolio performance monitoring
   - Holdings updates and valuation
   - Transaction notifications
   - Potential integration with Token Data WebSocket for efficiency

## Next Steps

- **Implement Token Data WebSocket (v69)**
  - Provides real-time token price and metadata updates
  - Reduces polling load on server and network traffic
  - Delivers instant market data to users
  - Will improve platform responsiveness and user experience

### Token Data WebSocket Implementation Plan

## UPDATE (3/7/2025):
## Token Data WebSocket Implementation

The Token Data WebSocket has been successfully implemented at `/api/v69/ws/token-data` with the following features:

1. **Direct Market Database Integration**
   - Connected to dedicated `degenduel_market_data` database via `MARKET_DATABASE_URL`
   - Complete schema with tokens, socials, websites, and transaction tables
   - Efficient query patterns with proper caching

2. **Real-time Broadcasting System**
   - Event-based architecture for token data updates
   - Automatic broadcasting to all connected clients
   - Support for channel-based subscriptions (e.g., specific tokens)
   - Optimized for high message throughput

3. **Multiple Access Patterns**
   - Public endpoints accessible without authentication
   - Support for admin token data providers
   - Token-specific channels for targeted updates
   - Market-wide broadcasts for all connected clients

4. **Advanced Caching**
   - In-memory cache for high-performance responses
   - Token data caching with automatic refresh
   - Metrics tracking for cache hits/misses

5. **Testing and Documentation**
   - Full documentation in the v69 README.md
   - Support in the v69 test client
   - API documentation for frontend developers

The Token Data WebSocket can be tested using:

```bash
node websocket/v69/test-client.js token-data
```

This implementation marks a significant step in our WebSocket modernization strategy, replacing the polling-based token data system with a more efficient real-time solution.

### Original Plan:

The Token Data WebSocket (v69) will build on our enhanced base WebSocket class with these features:

1. **Efficient Data Compression**
   - Optimized for large token data payloads
   - Binary message support for price data arrays
   - Compression for metadata transfers
   - Bandwidth reduction techniques for high-frequency updates

2. **Tiered Data Access Model**
   - Public channel for basic token data (prices, market caps)
   - Authenticated channels for portfolio-relevant tokens
   - Admin channels for whitelist management
   - Custom subscriptions for specific token sets

3. **Real-Time Market Data Streaming**
   - Sub-second price updates for volatile markets
   - Token metadata change notifications
   - Market trend indicators and alerts
   - Whitelist status change broadcasting

4. **Performance Optimizations**
   - Delta updates to minimize payload size
   - Batched updates for multiple tokens
   - Priority queuing for important market events
   - Cache alignment with TokenSyncService

5. **Token Analytics Integration**
   - Price change percentage broadcasting
   - Volume spike detection and notification
   - Market trend analysis data
   - Historical price point references

6. **Frontend Visualization Support**
   - Consistent data format for chart components
   - Real-time price ticker support
   - Portfolio value calculation helpers
   - Standardized status indicators for tokens

The implementation will address critical polling issues observed in logs while providing a more responsive user experience with real-time market data. It will follow our established v69 pattern for consistent behavior, enhanced security, and improved performance.

### Analytics WebSocket Implementation Plan

The Analytics WebSocket (v69) will provide real-time platform activity metrics with a focus on admin dashboards:

1. **Admin-Focused Real-Time Dashboards**
   - User acquisition and retention metrics
   - Contest engagement and performance data
   - Transaction volume and platform activity tracking
   - Service performance monitoring with visualizations

2. **Customizable Metrics Subscriptions**
   - Channel-based metric category subscriptions
   - Flexible time-window selection for data aggregation
   - Filtering by platform area and user segments
   - Dynamic threshold alerts and anomaly detection

3. **High-Performance Data Aggregation**
   - Pre-computed metrics with intelligent caching
   - Push-based updates for threshold crossings
   - Periodic summaries with delta encoding
   - Segmented metric streaming to reduce payload size

4. **User Behavior Insights**
   - Anonymous journey tracking data
   - Funnel stage completion metrics
   - Feature usage and adoption statistics
   - Real-time conversion rates and engagement scores

5. **Security and Compliance Features**
   - Role-based access control with detailed permissions
   - Anonymized data access for lower privilege levels
   - Audit logging of all metric access
   - Configurable data retention and privacy controls

6. **Integration with Existing Analytics Systems**
   - Compatibility with frontend charting libraries
   - Consistent data format with admin dashboards
   - Export capabilities for external analysis
   - Seamless connection with admin reporting tools

The Analytics WebSocket will provide critical real-time visibility for administrators while maintaining security and privacy standards. It will help identify platform issues early, optimize user experience, and inform data-driven decisions.

### User Notification WebSocket Implementation Plan

The User Notification WebSocket (v69) will handle personalized user alerts and communications:

1. **Personalized Notification Delivery**
   - User-specific notification channel
   - Priority-based notification queuing
   - Delivery confirmation and read receipts
   - Custom notification preferences support

2. **Multi-Category Notification System**
   - Contest status updates and alerts
   - Achievement and reward notifications
   - System announcements and important alerts
   - Transaction and balance change notices
   - Social and community interaction notifications

3. **Rich Notification Format Support**
   - Text with formatting options
   - Interactive elements (buttons, links)
   - Image and icon embedding
   - Action triggers and deep links
   - Grouping and thread capabilities

4. **Intelligent Delivery Management**
   - Notification batching to prevent flooding
   - User presence awareness to optimize timing
   - Cross-device synchronization
   - Delivery retry and persistence mechanisms

5. **Analytics and Engagement Tracking**
   - Notification open and interaction rates
   - Action completion tracking
   - Notification effectiveness metrics
   - A/B testing support for notification content

6. **Administration and Campaign Tools**
   - Admin broadcast capabilities
   - Scheduled notification delivery
   - Targeted user segment notifications
   - Template-based notification generation

The User Notification WebSocket will provide immediate, reliable user communications while reducing notification fatigue through intelligent delivery management. It will enhance user engagement and provide timely information about platform activities.

- Continue testing with selected users
- Implement client-side feature flag system
- Collect metrics and performance data
- Prepare for gradual rollout

## Issues and Challenges

### Portfolio and Token Data WebSocket Overlap

There is significant functional overlap between the planned Portfolio WebSocket and Token Data WebSocket:

- **Token Data** provides real-time market data (prices, metadata, etc.)
- **Portfolio** applies this data to user holdings for valuation

This creates potential inefficiencies:
1. Duplicate data streams if implemented separately
2. Synchronization challenges between services
3. Additional overhead for clients connecting to both

**Potential solutions:**
- Consolidate into a single WebSocket with distinct channels
- Create a tiered system where Portfolio subscribes to Token Data internally
- Implement as separate services but with shared underlying data provider

The final architecture will depend on performance testing and server readiness for token data streaming. This evaluation is scheduled after the core WebSockets are implemented.

### Server Infrastructure Readiness

Some WebSocket implementations (particularly Token Data) require:

1. Optimized background data aggregation systems
2. Efficient caching layers
3. Market data provider stability

These infrastructure components are still being prepared, which may affect implementation order and timeline.

### Migration Strategy from Legacy WebSockets

A comprehensive strategy is needed to migrate clients from the existing WebSocket system to v69:

1. Feature flags to control rollout to user segments
2. Backward compatibility support during transition
3. Fallback mechanisms if issues arise
4. Monitoring and observability during cutover

## Timeline

### Completed
- ✅ Design of authentication flow
- ✅ Implementation of base WebSocket class (v69)
- ✅ Implementation of Monitor WebSocket (v69)
- ✅ Integration with existing WebSocket infrastructure
- ✅ Creation of documentation and test client
- ✅ Testing of v69 Monitor WebSocket
- ✅ Implementation of Contest WebSocket (v69)
- ✅ Enhanced WebSocket logging and security
- ✅ Implementation of Circuit Breaker WebSocket (v69)

### Implementation of Circuit Breaker WebSocket

The Circuit Breaker WebSocket has been implemented and is now available at `/api/v69/ws/circuit-breaker`. This implementation provides real-time monitoring and management of circuit breakers across the DegenDuel service architecture:

1. **Service State Monitoring**
   - Real-time circuit breaker status updates
   - Detailed service performance metrics
   - Failure tracking and recovery monitoring
   - Grouped by logical service layers (data, wallet, contest, infrastructure)

2. **Enhanced Security**
   - Multiple authentication methods with secure prioritization
   - Role-based access control for administrative actions
   - Detailed audit logging of all circuit breaker operations
   - Permission-based channel subscriptions

3. **Layer-Based Visualization**
   - Service grouping by functional layer
   - Aggregated health status by layer
   - Color-coded status indicators (green=closed, yellow=degraded, red=open)
   - Hierarchical subscription system

4. **Administrative Controls**
   - Manual circuit breaker reset for administrators
   - Service health check triggering
   - Detailed service configuration inspection
   - Recovery monitoring and management

5. **Comprehensive Logging**
   - Colorized event logging with consistent formatting
   - Detailed connection and authentication tracking
   - Admin action auditing with timestamp and user info
   - Tiered log verbosity for different event types

The Circuit Breaker WebSocket can be tested using the test client:

```bash
node websocket/v69/test-client.js circuit-breaker
# or with the shorter alias
node websocket/v69/test-client.js circuit
```

### In Progress
- 🔄 Implementation of Token Data WebSocket (v69)

### Upcoming
- ⏳ Implementation of SkyDuel WebSocket (v69)
- ⏳ Implementation of Wallet WebSocket (v69)
- ⏳ Implementation of Analytics WebSocket (v69)
- ⏳ Implementation of User Notification WebSocket (v69)
- ⏳ Evaluation of Token Data/Portfolio WebSocket consolidation
- ⏳ Client-side feature flag system
- ⏳ Testing with selected users
- ⏳ Metrics collection and analysis
- ⏳ Gradual rollout to production 