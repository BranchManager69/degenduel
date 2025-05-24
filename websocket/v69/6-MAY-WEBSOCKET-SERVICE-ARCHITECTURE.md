# DegenDuel WebSocket Service Architecture

This document provides a comprehensive overview of the WebSocket architecture in the DegenDuel platform, focusing on the integration between WebSocket interfaces and core backend services.

## Overview

The DegenDuel platform implements a sophisticated dual-layer architecture:

1. **Core business logic services** (in `/services/`)
   - Handle core functionality, database access, business rules
   - Independent of communication protocols

2. **WebSocket service interfaces** (in `/websocket/v69/unified/`)
   - Provide real-time WebSocket interfaces to those core services
   - Handle WebSocket-specific concerns (subscriptions, broadcasts, etc.)

This separation of concerns follows the facade pattern - WebSocket interfaces wrap around core services to provide real-time capabilities without duplicating business logic.

## Key WebSocket & Service Integration Pairs

| WebSocket Service/Handler | Core Service Integration |
|---------------------------|--------------------------|
| `Market Data WebSocket`   | → `marketDataService.js`, `tokenEnrichmentService.js` |
| `Terminal Data WebSocket` | → `aiService.js`, `terminalFunctionHandler.js` |
| `Wallet Balance WebSocket` | → `heliusBalanceTracker.js`, `solanaServiceManager.js` |
| `Contest Utils`       | → `utils/contest-utils.js`, `contestEvaluationService.js` |
| `System Settings WebSocket` | → `systemSettingsUtil.js` |
| `Vanity Dashboard WebSocket` | → `vanityWalletService.js` |
| `Admin Monitor WebSocket` | → `serviceManager.js`, `circuitBreaker.js` |
| `Solana PubSub WebSocket` | → Direct integration with Solana blockchain |
| `Token Data WebSocket`    | → `marketDataService.js`, `tokenWhitelistService.js` |
| `Portfolio WebSocket`     | → `userBalanceTrackingService.js` |

## 1. Market Data WebSocket + Market Data Service

**Core Files:**
- `websocket/v69/market-data-ws.js` (WebSocket interface)
- `services/market-data/marketDataService.js` (Core service)
- `services/market-data/marketDataBatchProcessor.js` (Data processing)
- `services/market-data/marketDataRankTracker.js` (Ranking engine)

**Integration Overview:**
This pair forms the backbone of your real-time token market data system. The Market Data Service processes raw token data from multiple sources (DexScreener, Jupiter, Helius), while the WebSocket interface delivers these updates in real-time to clients.

**Data Flow:**
1. External sources → Market Data Service → Data processing/enrichment → In-memory state
2. Market Data Service → Events triggered on state changes → WebSocket server
3. WebSocket server → Real-time broadcasts to subscribed clients

**Event Triggers:**
- Price updates (triggers on threshold changes, e.g., ±1%, ±5%, ±10%)
- Volume changes (hourly/daily aggregation updates)
- Rank position changes (when tokens move up/down rankings)
- New token detection (when a token is first discovered)
- Liquidity changes (pool depth modifications)

**Optimization Techniques:**
- Batched updates to reduce WebSocket message frequency
- Delta compression (only sending changed fields)
- Topic-based subscriptions (clients subscribe to specific token addresses)
- Priority-based update scheduling (higher market cap = higher update frequency)
- Update throttling during high-volatility periods

**Special Features:**
- Algorithmic anomaly detection for suspicious price movements
- Price correlation tracking between related tokens
- Market sector performance aggregation
- Custom client filtering (clients can set filters server-side)

## 2. Wallet Balance WebSocket + Helius Balance Tracker

**Core Files:**
- `websocket/v69/unified/modules/solana-balance-module.js` (SOL balance tracking)
- `websocket/v69/unified/modules/token-balance-module.js` (Token balance tracking)
- `services/solana-engine/helius-balance-tracker.js` (Blockchain data fetching)

**Integration Overview:**
This integration connects user wallet addresses to real-time blockchain monitoring. The Helius Balance Tracker continuously polls and subscribes to on-chain events, while the WebSocket modules deliver personalized balance updates to authenticated users.

**Data Flow:**
1. Helius API → Balance Tracker → Account monitoring → Balance state changes
2. Balance state changes → WebSocket modules → Filtered by wallet ownership → Client delivery
3. Client requests → WebSocket interface → Balance queries → On-demand data

**Authentication & Privacy Layer:**
- JWT token verification for wallet address ownership
- Per-user subscriptions with isolated data channels
- Privacy filtering (only owners receive full balance details)
- Administrative override for support functions

**Optimization Techniques:**
- Wallet address pooling (single Helius connection monitors multiple addresses)
- Smart polling (dynamic frequency based on activity patterns)
- Balance grouping by token type
- Webhook-triggered updates (reduced polling when webhooks available)
- Message compression for bandwidth optimization

**Special Features:**
- Historical balance tracking with time-series data
- Transaction categorization (trades, transfers, staking, etc.)
- Portfolio value calculation (USD equivalents)
- Change notifications (significant balance changes)
- SPL token metadata enrichment (logos, decimals, etc.)

## 3. Contest WebSocket + Contest Services

**Core Files:**
- `websocket/v69/contest-ws.js` (WebSocket interface)
- `utils/contest-utils.js` (Contest management)
- `services/contestEvaluationService.js` (Scoring and ranking)
- `services/contestSchedulerService.js` (Timing and automation)

**Integration Overview:**
This integration powers the real-time competitive aspects of your platform. Contest Services handle entry, scoring, and prize distribution, while the WebSocket interface delivers live updates on contest status, rankings, and results.

**Data Flow:**
1. Scheduled events → Contest Scheduler → Contest lifecycle events
2. User actions → Contest Service → Entry, selection, participation events
3. Market data → Contest Evaluation → Scoring and ranking calculations
4. All events → WebSocket interface → Targeted notifications and updates

**Event Categories:**
- Contest lifecycle events (registration open, contest start/end, etc.)
- Participant events (new entry, selection made, withdrawal)
- Scoring events (rank changes, performance updates)
- Results events (winners announced, prizes allocated)
- Administrative events (contest modified, canceled, etc.)

**Optimization Techniques:**
- Tiered update frequency (higher frequency near contest end)
- Rank-based notification throttling (only significant changes broadcast)
- Leaderboard windowing (only sending visible leaderboard sections)
- Partial updates (only changed fields transmitted)
- Scheduled bulk updates (non-time-critical updates batched)

**Special Features:**
- Live "spectator mode" for popular contests
- Performance analytics in real-time
- Dynamic prize pool updates
- "Photo finish" high-frequency updates in final minutes
- Automated congratulatory notifications

## 4. Token Data WebSocket + Market Data/Token Enrichment Services

**Core Files:**
- `websocket/v69/token-data-ws.js` (WebSocket interface)
- `services/token-enrichment/tokenEnrichmentService.js` (Metadata enrichment)
- `services/market-data/marketDataService.js` (Market metrics)
- `services/market-data/tokenListDeltaTracker.js` (Change tracking)

**Integration Overview:**
This integration delivers comprehensive token data beyond just price. The Token Enrichment Service aggregates social metrics, developer activity, and blockchain analytics, while the WebSocket interface provides detailed insights to clients.

**Data Flow:**
1. Multiple sources → Token Enrichment → Metadata normalization → Enriched token profiles
2. Social APIs → Social metric collection → Community metrics
3. On-chain data → Token analysis → Technical metrics
4. All metrics → WebSocket interface → Filtered client delivery

**Data Dimensions:**
- Core token metadata (name, symbol, decimals, supply)
- Market metrics (price, volume, liquidity, market cap)
- Social metrics (Twitter followers, Discord members, sentiment)
- Technical metrics (holder count, transactions, code commits)
- Ownership metrics (concentration, whale movements)

**Optimization Techniques:**
- Multi-tier caching (in-memory, Redis, database)
- Field-selective subscriptions (clients specify needed fields)
- Update bucketing (frequent/infrequent update categories)
- Compression for large metadata fields
- Background refresh with notification triggers

**Special Features:**
- Automatic logo and branding detection
- Social sentiment analysis integration
- Whale movement alerts
- Token correlation analysis
- Scam/security risk assessment

## 5. Solana PubSub WebSocket + Direct Solana Node Connection

**Core Files:**
- `websocket/v69/unified/services.js` (WebSocket proxy implementation)
- `utils/solana-suite/solana-service-manager.js` (Connection management)
- `utils/solana-suite/web3-v2/solana-connection-v2.js` (Blockchain interface)

**Integration Overview:**
This is your most sophisticated WebSocket integration - a custom multiplexing proxy that connects your clients directly to Solana blockchain events. It transforms your WebSocket server into a specialized Solana account monitoring system with access controls.

**Architecture:**
1. Client WebSocket → Your WebSocket server → Role-based subscription validation
2. Approved subscriptions → Account tracking → Solana WebSocket connections
3. Solana account notifications → Filtered and routed → Specific client connections
4. Connection pool management → Shared subscriptions → Resource optimization

**Security & Rate Limiting:**
- Tiered subscription limits:
  - Public users: 5 accounts maximum
  - Authenticated users: 10 accounts maximum
  - Admin users: 1,000 accounts maximum
- IP-based rate limiting on subscription requests
- JWT validation for authenticated requests
- Subscription validation against business rules

**Technical Implementation:**
- Dynamic WebSocket connection pool to Solana nodes
- Subscription ID mapping system
- Client-to-account many-to-many relationship tracking
- Automatic reconnection with exponential backoff
- Error propagation and translated error messages

**Advanced Features:**
- Connection load balancing across multiple Solana RPC endpoints
- Commitment level selection (finalized, confirmed, processed)
- Account data parsing and transformation
- Bandwidth optimization via selective field filtering
- Heartbeat monitoring and zombie connection cleanup

This system effectively converts your WebSocket server into a specialized Solana account monitoring proxy with enterprise-grade features like access control, resource management, and connection pooling - capabilities typically found in dedicated blockchain infrastructure products.

## Terminal Data WebSocket Guide

The terminal data is served through the WebSocket interface on topic `TERMINAL`. Instead of polling with REST API calls, clients should use the WebSocket connection to get both initial data and real-time updates.

### Connection Details
- **WebSocket URL**: `/api/v69/ws` 
- **Topic**: `TERMINAL`
- **Authentication**: Not required (public data)

### Connection Flow

1. **Connect to the unified WebSocket**:
   ```javascript
   const socket = new WebSocket('wss://your-domain.com/api/v69/ws');
   ```

2. **Wait for socket to open**:
   ```javascript
   socket.onopen = () => {
     // Connection established, subscribe to TERMINAL topic
     subscribeToTerminalData();
   };
   ```

3. **Subscribe to Terminal data**:
   ```javascript
   function subscribeToTerminalData() {
     socket.send(JSON.stringify({
       type: 'SUBSCRIBE',
       topic: 'TERMINAL',
       requestId: generateUniqueId() // Helper function to generate unique IDs
     }));
   }
   ```

4. **Request initial data** (immediately after subscribing):
   ```javascript
   function requestTerminalData() {
     socket.send(JSON.stringify({
       type: 'REQUEST',
       topic: 'TERMINAL',
       action: 'getData',
       requestId: generateUniqueId()
     }));
   }
   ```

5. **Handle incoming messages**:
   ```javascript
   socket.onmessage = (event) => {
     const message = JSON.parse(event.data);
     
     // Check if this is terminal data
     if (message.topic === 'TERMINAL') {
       if (message.type === 'DATA') {
         // This is a data update (either initial or real-time)
         handleTerminalData(message.data);
       } else if (message.type === 'RESPONSE') {
         // This is a response to our request
         if (message.action === 'getData') {
           handleTerminalData(message.data);
         }
       }
     }
   };
   
   function handleTerminalData(data) {
     // Update your UI with the terminal data
     console.log('Terminal data received:', data);
     
     // The data structure includes:
     // - platformName
     // - platformDescription
     // - platformStatus
     // - features
     // - systemStatus
     // - stats
     // - token
     // - launch
     // - roadmap
     // - commands
   }
   ```

6. **Handle connection issues and reconnect**:
   ```javascript
   socket.onclose = (event) => {
     console.log('WebSocket connection closed:', event.code, event.reason);
     // Implement reconnection logic with exponential backoff
     setTimeout(reconnect, getReconnectDelay());
   };
   
   socket.onerror = (error) => {
     console.error('WebSocket error:', error);
     // Socket will close after an error, onclose handler will handle reconnection
   };
   ```

### React Hook Example

```javascript
import { useState, useEffect, useCallback, useRef } from 'react';

export function useTerminalData() {
  const [terminalData, setTerminalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  
  // Generate unique request IDs
  const generateRequestId = useCallback(() => {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);
  
  // Connect and set up event handlers
  const connectWebSocket = useCallback(() => {
    const wsUrl = window.location.protocol === 'https:' 
      ? `wss://${window.location.host}/api/v69/ws`
      : `ws://${window.location.host}/api/v69/ws`;
    
    socketRef.current = new WebSocket(wsUrl);
    
    socketRef.current.onopen = () => {
      console.log('WebSocket connected');
      reconnectAttemptRef.current = 0;
      
      // Subscribe to terminal topic
      socketRef.current.send(JSON.stringify({
        type: 'SUBSCRIBE',
        topic: 'TERMINAL',
        requestId: generateRequestId()
      }));
      
      // Request initial data
      socketRef.current.send(JSON.stringify({
        type: 'REQUEST',
        topic: 'TERMINAL',
        action: 'getData',
        requestId: generateRequestId()
      }));
    };
    
    socketRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.topic === 'TERMINAL') {
          if (message.type === 'DATA' || 
             (message.type === 'RESPONSE' && message.action === 'getData')) {
            setTerminalData(message.data);
            setLoading(false);
            setError(null);
          }
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };
    
    socketRef.current.onclose = () => {
      // Reconnect with exponential backoff
      const reconnectDelay = Math.min(1000 * (2 ** reconnectAttemptRef.current), 30000);
      reconnectAttemptRef.current += 1;
      
      console.log(`WebSocket closed. Reconnecting in ${reconnectDelay}ms...`);
      setTimeout(connectWebSocket, reconnectDelay);
    };
    
    socketRef.current.onerror = (err) => {
      console.error('WebSocket error:', err);
      setError('Connection error');
    };
  }, [generateRequestId]);
  
  // Connect on component mount
  useEffect(() => {
    connectWebSocket();
    
    // Clean up on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connectWebSocket]);
  
  return { terminalData, loading, error };
}
```

### Important Notes

1. **No Polling** - Don't use any polling with REST API calls. The WebSocket will:
   - Deliver initial data when you first connect
   - Automatically push updates in real-time when data changes

2. **Reconnection Logic** - Always implement robust reconnection logic with exponential backoff.

3. **Data Structure** - Terminal data contains these main sections:
   - `platformName` - Name of the platform
   - `platformDescription` - Short description of the platform
   - `platformStatus` - Current operational status
   - `features` - List of platform features
   - `systemStatus` - Status of platform subsystems
   - `stats` - Key platform metrics and statistics
   - `token` - Token configuration information
   - `launch` - Token launch information
   - `roadmap` - Platform development roadmap
   - `commands` - Available terminal commands

4. **Data Freshness** - The data is refreshed on the server periodically. You'll get the latest data when you connect and receive real-time updates when anything changes.

5. **Error Handling** - Make sure to implement proper error handling for all WebSocket events (connection errors, data parsing errors, etc.)