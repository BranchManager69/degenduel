# DegenDuel WebSocket System Specification

## Overview

This document outlines the complete WebSocket system implementation for DegenDuel, including all endpoints, message formats, authentication mechanisms, and testing capabilities.

## Core WebSocket Servers

### 1. Portfolio WebSocket

- **Endpoint**: `/api/v2/ws/portfolio`
- **Authentication**: Session token as WebSocket protocol
- **Purpose**: Real-time portfolio updates and trade execution notifications
- **Message Types**:

  ```typescript
  // Portfolio Update
  {
    type: "PORTFOLIO_UPDATED",
    data: {
      tokens: Array<{
        symbol: string;
        name: string;
        amount: number;
        value: number;
      }>;
      total_value: number;
      performance_24h: number;
    },
    timestamp: string;
  }

  // Trade Execution
  {
    type: "TRADE_EXECUTED",
    data: {
      trade_id: string;
      wallet_address: string;
      symbol: string;
      amount: number;
      price: number;
      timestamp: string;
      contest_id?: string;
    }
  }
  ```

### 2. Analytics WebSocket

- **Endpoint**: `/analytics`
- **Authentication**: Session token as WebSocket protocol
- **Purpose**: User activity tracking and analytics data
- **Message Types**:
  ```typescript
  // User Activity Update
  {
    type: "user_activity_update",
    users: Array<{
      wallet: string;
      nickname: string;
      current_zone: string;
      last_action: string;
      last_active: string;
      session_duration: number;
    }>;
    timestamp: string;
  }
  ```

### 3. Wallet WebSocket

- **Endpoint**: `/api/v2/ws/wallet`
- **Authentication**: Session token as WebSocket protocol
- **Purpose**: Real-time wallet updates and transfer tracking
- **Message Types**:

  ```typescript
  // Wallet Update
  {
    type: "WALLET_UPDATED",
    data: {
      type: "created" | "statusChanged" | "balanceChanged";
      publicKey: string;
      balance?: number;
      status?: "active" | "inactive" | "locked";
    }
  }

  // Transfer Status
  {
    type: "TRANSFER_COMPLETE",
    data: {
      transfer_id: string;
      status: "success" | "failed";
      error?: string;
      timestamp: string;
    }
  }
  ```

### 4. Contest WebSocket

- **Endpoint**: `/api/v2/ws/contest/:contestId`
- **Authentication**: Session token as WebSocket protocol
- **Purpose**: Real-time contest updates and leaderboard changes
- **Message Types**:

  ```typescript
  // Contest Update
  {
    type: "CONTEST_UPDATED",
    data: {
      contest_id: string;
      status: "active" | "completed" | "cancelled";
      current_round?: number;
      time_remaining?: number;
      total_participants: number;
      total_prize_pool: number;
    }
  }

  // Leaderboard Update
  {
    type: "LEADERBOARD_UPDATED",
    data: {
      contest_id: string;
      leaderboard: Array<{
        rank: number;
        wallet_address: string;
        username: string;
        portfolio_value: number;
        performance: number;
        last_trade_time?: string;
      }>;
      timestamp: string;
    }
  }
  ```

### 5. Market Data WebSocket

- **Endpoint**: `/api/v2/ws/market`
- **Authentication**: Session token as WebSocket protocol
- **Purpose**: Real-time market data including prices, volumes, and sentiment
- **Message Types**:

  ```typescript
  // Market Price
  {
    type: "MARKET_PRICE",
    data: {
      symbol: string;
      price: number;
      change_24h: number;
      volume_24h: number;
      high_24h: number;
      low_24h: number;
      timestamp: string;
    }
  }

  // Market Volume
  {
    type: "MARKET_VOLUME",
    data: {
      symbol: string;
      volume: number;
      trades_count: number;
      buy_volume: number;
      sell_volume: number;
      interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
      timestamp: string;
    }
  }

  // Market Sentiment
  {
    type: "MARKET_SENTIMENT",
    data: {
      symbol: string;
      sentiment_score: number; // -1 to 1
      buy_pressure: number; // 0 to 1
      sell_pressure: number; // 0 to 1
      volume_trend: "increasing" | "decreasing" | "stable";
      timestamp: string;
    }
  }
  ```

## WebSocket Testing System

### Test Endpoints

1. **Send Test Message**

   - **Endpoint**: POST `/api/admin/websocket/test`
   - **Authentication**: Requires superadmin privileges
   - **Rate Limits**:
     - 10 messages per minute
     - 100 messages per hour
   - **Request Format**:
     ```typescript
     {
       socketType: string; // The type of socket to test
       messageType: string; // The type of message to simulate
       payload: any; // The message payload to send
     }
     ```
   - **Response Format**:
     ```typescript
     {
       success: boolean;
       message?: string;
       error?: string;
     }
     ```

2. **Get WebSocket Status**

   - **Endpoint**: GET `/api/admin/websocket/status`
   - **Authentication**: Requires superadmin privileges
   - **Response Format**:
     ```typescript
     {
       success: boolean;
       status: {
         [socketType: string]: {
           connections: number;
           uptime: number;
           memory: {
             heapUsed: number;
             heapTotal: number;
             external: number;
           };
           errors: number;
           messagesSent: number;
           messagesReceived: number;
         }
       }
     }
     ```

3. **Get Test Logs**
   - **Endpoint**: GET `/api/admin/websocket/logs`
   - **Authentication**: Requires superadmin privileges
   - **Response Format**:
     ```typescript
     {
       success: boolean;
       logs: Array<{
         socket_type: string;
         message_type: string;
         payload: any;
         admin: string;
         timestamp: string;
       }>;
     }
     ```

## Implementation Details

### Authentication

- All WebSocket connections require a valid session token
- Token must be passed as the WebSocket protocol
- Invalid tokens result in immediate connection closure
- Tokens are verified on connection and periodically

### Connection Management

- Automatic reconnection with exponential backoff
- Maximum 5 reconnection attempts
- Heartbeat every 30 seconds
- Connection timeout after 3 missed heartbeats

### Error Handling

- All errors include proper error codes and descriptions
- Circuit breaker pattern for external data sources
- Rate limiting per connection
- Automatic connection cleanup

### Performance

- Maximum message size: 32KB
- Maximum concurrent connections: 10,000
- Message rate limits vary by socket type
- Message queuing for offline clients

### Security

- All connections require HTTPS/WSS
- Rate limiting per IP and user
- Payload validation and sanitization
- Access control based on user roles

## Base WebSocket Implementation

All WebSocket servers extend the `BaseWebSocketServer` class which provides:

- Connection management
- Authentication
- Message validation
- Rate limiting
- Error handling
- Client tracking
- Message broadcasting
- Connection statistics

## Service Integration

WebSocket servers are integrated with core services:

- Market Data Service for price updates
- Contest Service for game state
- Wallet Service for balance updates
- Analytics Service for user tracking

## Monitoring and Logging

- Real-time connection monitoring
- Message throughput tracking
- Error rate monitoring
- Client connection statistics
- Test message logging
- Performance metrics

## Development Guidelines

1. All new WebSocket servers must extend BaseWebSocketServer
2. Implement proper cleanup in all servers
3. Add appropriate error handling
4. Include message validation
5. Document all message types
6. Add monitoring capabilities
7. Follow rate limiting guidelines
8. Implement reconnection logic

## Testing Requirements

1. Test all message types
2. Verify reconnection behavior
3. Test rate limiting
4. Verify authentication
5. Test error handling
6. Monitor memory usage
7. Test concurrent connections
8. Verify message delivery

## Frontend Implementation

### Base WebSocket Hook

```typescript
// src/hooks/useBaseWebSocket.ts
interface WebSocketConfig {
  url: string;
  endpoint: string;
  socketType: string;
  heartbeatInterval?: number;
  maxReconnectAttempts?: number;
  onMessage?: (message: any) => void;
}

// Provides core functionality:
// - Connection management
// - Reconnection with exponential backoff
// - Session token authentication
// - Debug event dispatching
// - Heartbeat mechanism
```

### WebSocket Testing Interface

```typescript
// src/pages/admin/WebSocketTesting.tsx
// Superadmin-only testing interface providing:
// - Test message sending for all socket types
// - Example payloads for each message type
// - Connection status monitoring
// - Real-time message debugging
```

### WebSocket Monitor Component

```typescript
// src/components/debug/WebSocketMonitor.tsx
// Real-time WebSocket monitoring providing:
// - Connection status for all sockets
// - Message logging
// - Error tracking
// - Event filtering
// - Timestamp tracking
```

### Implemented WebSocket Hooks

1. **Service WebSocket**

   ```typescript
   // src/hooks/useServiceWebSocket.ts
   // Handles service health and metrics:
   // - Status mapping (active/stopped/error → online/offline/degraded)
   // - Alert handling with severity mapping
   // - Debug event dispatching
   // - Metrics tracking
   ```

2. **Circuit Breaker WebSocket**

   ```typescript
   // src/hooks/useCircuitBreakerSocket.ts
   // Manages trading circuit breaker:
   // - Circuit state monitoring
   // - Health updates
   // - Failure tracking
   // - Recovery management
   ```

3. **Portfolio WebSocket**

   ```typescript
   // src/hooks/usePortfolioWebSocket.ts
   // Real-time portfolio updates:
   // - Token balance updates
   // - Trade execution notifications
   // - Price updates
   ```

4. **Contest WebSocket**

   ```typescript
   // src/hooks/useContestWebSocket.ts
   // Contest state management:
   // - Real-time updates
   // - Leaderboard changes
   // - Participant activity
   ```

5. **Market Data WebSocket**
   ```typescript
   // src/hooks/useMarketDataWebSocket.ts
   // Market data streaming:
   // - Price updates
   // - Volume tracking
   // - Market sentiment analysis
   ```

### WebSocket Manager

```typescript
// src/components/WebSocketManager.tsx
// Central WebSocket connection manager:
// - Initializes required connections based on user role
// - Manages connection lifecycle
// - Integrates with store for state management
```

### Debug Events

All WebSocket events can be monitored through the debug event system:

```typescript
window.addEventListener("ws-debug", (event: CustomEvent) => {
  const { type, socketType, message, data, timestamp } = event.detail;
  // type: "connection" | "state" | "alert" | "error" | "metrics"
});
```

### Store Integration

WebSocket updates are integrated with the application store:

```typescript
// src/store/useStore.ts
interface StoreState {
  // ... existing store state ...
  serviceState: ServiceState | null;
  serviceAlerts: ServiceAlert[];
  circuitBreaker: CircuitBreakerState;
  // ... other WebSocket-related state
}
```

## Testing Guidelines

1. Use the WebSocket Testing Panel for manual testing
2. Monitor connections through WebSocket Monitor
3. Verify proper error handling
4. Test reconnection scenarios
5. Validate message formats
6. Check store updates
7. Monitor debug events

## Ready for Production

- ✅ All WebSocket hooks implemented and tested
- ✅ Testing interface complete
- ✅ Monitoring system in place
- ✅ Store integration verified
- ✅ Error handling implemented
- ✅ Type safety ensured
- ✅ Linter errors resolved
