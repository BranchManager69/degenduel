# DegenDuel System Architecture: Current State & Evolution Path

## Current System Overview

DegenDuel's architecture has undergone significant evolution, with the most recent change being the implementation of a unified WebSocket system. This document provides a comprehensive understanding of the current architecture, its historical context, and the path forward.

## Database Architecture

The system currently operates with **two separate PostgreSQL databases**:

1. **Primary Database** (degenduel)
   - User accounts, portfolios, contests, trades
   - System settings and configuration
   - Token metadata references

2. **Market Data Database** (degenduel_market_data)
   - Token prices, market caps, volumes
   - Trading history and market statistics
   - Token price change metrics

Despite running on a single server, these databases continue to operate as if they were on separate systems, creating inefficiencies.

## Service Architecture

### Core Services

#### TokenWhitelistService
- **Purpose**: Manages which tokens are allowed in the system
- **Database**: Primary database
- **Key Functions**:
  - Token verification and validation
  - Token addition/removal approval
  - Acts as gatekeeper for token inclusion

#### MarketDataService
- **Purpose**: Collects and distributes market data
- **Database**: Market data database
- **Key Functions**: 
  - Fetches token pricing data (every 10 seconds)
  - Broadcasts updates via `market:broadcast` event
  - Maintains market data cache

#### TokenSyncService
- **Purpose**: Synchronizes token information between databases
- **Databases**: Both primary and market data
- **Key Functions**:
  - Ensures consistent token records across databases
  - Propagates token metadata changes
  - **Current Status**: Functionally redundant in single-server environment

## Communication Architecture

### Event System

The system uses an internal event bus (serviceEvents) for inter-service communication:

- **Key Events**:
  - `market:broadcast`: Emitted by MarketDataService with token price updates
  - Various service-specific events for internal communication

### WebSocket Architecture (Updated)

The system now uses a **single unified WebSocket server** with topic-based subscriptions:

- **Implementation**: `/websocket/v69/uni-ws.js`
- **Connection Point**: `/api/v69/ws`
- **Key Features**:
  - Topic-based subscription model
  - Authentication for restricted topics
  - Proper connection tracking and error handling
  - Compression explicitly disabled for client compatibility

#### Available Topics

1. **MARKET_DATA** (`market-data`)
   - Public access (no authentication required)
   - Real-time token prices and market data
   - Implemented actions: `getToken`, `getAllTokens`

2. **USER** (`user`)
   - Authenticated access only
   - User profile and statistics
   - Implemented actions: `getProfile`, `getStats`

3. **PORTFOLIO** (`portfolio`)
   - Authenticated access only
   - User portfolio information
   - Status: Defined but not fully implemented

4. **SYSTEM** (`system`)
   - System-wide notifications
   - Connection status and heartbeats
   - Partially implemented

5. **CONTEST** (`contest`)
   - Contest information and status
   - Status: Defined but not implemented

6. **ADMIN** (`admin`)
   - Admin-only access
   - System management functions
   - Status: Defined but not implemented

7. **WALLET** (`wallet`)
   - Authenticated access only
   - Wallet balances and transactions
   - Status: Defined but not implemented

8. **SKYDUEL** (`skyduel`)
   - Game-specific information
   - Status: Defined but not implemented

## Current Data Flow

```
TokenWhitelistService          
  │                       
  │─→ Manages token whitelist in primary DB
     │                                      
MarketDataService (10s cycle)               
  │                                         
  │─→ Query market_data DB for token prices  
  │  │                                      
  │  └─→ Emit 'market:broadcast' event ────────→ Unified WebSocket Server
  │                                                │
  │                                                │─→ MARKET_DATA topic subscribers
  │                                                │─→ Other topic subscribers (as needed)
TokenSyncService (periodic)
  │
  │─→ Pull token data from MarketDataService
  │
  └─→ Update primary database with token metadata
```

## Architectural Challenges

1. **Database Redundancy**: Two databases on the same server containing overlapping token data
2. **Synchronization Overhead**: TokenSyncService performing unnecessary synchronization between local databases
3. **Architectural Mismatch**: Code still structured for a two-server model despite running on a single server

## Key Recent Improvements

1. **Unified WebSocket System**: 
   - Replaced 12+ separate WebSocket servers with a single unified implementation
   - Implemented topic-based subscription model
   - Simplified client connections and reduced overhead
   - Improved error handling and logging

2. **Configuration-Based State Management**:
   - Moved from global state (`global.wsServersV69`) to configuration object (`config.websocket.unifiedWebSocket`)
   - Improved tracking and lifecycle management
   - Enhanced shutdown and cleanup processes

## Recommended Next Steps

1. **Database Consolidation**:
   - Migrate to a single database architecture
   - Eliminate the need for TokenSyncService
   - Establish primary database as single source of truth

2. **Market Data Collection Refinement**:
   - Update MarketDataService to read from primary database for token list
   - Retain market data collection functionality
   - Emit events directly to unified WebSocket

3. **Complete Topic Implementation**:
   - Implement remaining WebSocket topics (PORTFOLIO, CONTEST, etc.)
   - Create proper handlers for each topic
   - Ensure consistent authentication and authorization

4. **Service Restructuring**:
   - Clarify TokenWhitelistService's role as the authoritative source for token inclusion
   - Phase out TokenSyncService as database consolidation progresses
   - Update MarketDataService to focus solely on data collection and distribution

## Message Flow Protocols

### WebSocket Message Types

#### Client to Server
- `SUBSCRIBE`: Request to receive updates for specific topics
- `UNSUBSCRIBE`: Request to stop receiving updates for topics
- `REQUEST`: Ask for specific data without subscribing
- `COMMAND`: Perform an action that changes state (requires authentication)

#### Server to Client
- `DATA`: Delivery of requested data or broadcast updates
- `ERROR`: Notification of errors in client requests
- `SYSTEM`: System-level messages and heartbeats
- `ACKNOWLEDGMENT`: Confirmation of successful operations

## Conclusion

The DegenDuel system is transitioning from a legacy two-server architecture to a streamlined single-server model. The recent WebSocket unification represents a significant step forward, simplifying the communication layer and reducing overhead.

The next major evolution should focus on database consolidation and service restructuring to eliminate the remaining architectural inefficiencies inherited from the two-server design.

This transition will result in a more maintainable, efficient system with clearer responsibility boundaries and simpler data flows.