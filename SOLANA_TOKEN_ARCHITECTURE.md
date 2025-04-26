# DegenDuel Solana Token Architecture

This document provides a comprehensive overview of the DegenDuel Solana token architecture, explaining how the various components interact to provide token metadata, price data, market information, and wallet operations.

## Architecture Overview

```
+---------------------------------------------------------------------------------+
|                       DegenDuel Token & Wallet Architecture                      |
+---------------------------------------------------------------------------------+

                        +-----------------------------+
                        |       SolanaEngine Service  |
                        |       (Central Orchestrator)|
                        +-----------------------------+
                                       |
                                       | (Integrated Services)
                 +--------------+------+------+-------------+
                 |              |             |             |
     +-----------v--+     +----v------+  +---v--------+  +-v---------------+
     |              |     |           |  |            |  |                 |
     | Connection   |     | Helius    |  | Jupiter    |  | DexScreener     |
     | Manager      |     | Client    |  | Client     |  | Client          |
     | (RPC Access) |     | (Metadata)|  | (Prices)   |  | (Market Data)   |
     +-----------+--+     +----+------+  +---+--------+  +-----------------+
                 |             |              |               |
                 |             |              |               |
    +------------v-------------v--------------v---------------v-----------+
    |                                                                     |
    |  +-------------------+    +----------------------+  +------------+  |
    |  | Helius Balance    |    | Helius Pool Tracker  |  | Token DEX  |  |
    |  | Tracker           |    | (Real-time Pool Data)|  | Data Svc   |  |
    |  | (Wallet Balances) |    +----------------------+  +------------+  |
    |  +-------------------+                                              |
    |                |              +-------------------------+           |
    |                |              | Token Monitor Service   |           |
    |                |              | (Transaction Monitoring)|           |
    |                |              +-------------------------+           |
    +--------------+-+----------------+-------------+--------------------+
                   |                  |             |
                   v                  v             v
    +-----------------------+  +-------------+  +---------------------+
    |                       |  |             |  |                     |
    | Token Refresh         |  | Token       |  | Admin Wallet        |
    | Integration           |  | History     |  | Service             |
    |                       |  | Functions   |  |                     |
    | +-------------------+ |  |             |  | +----------------+  |
    | | Token Refresh     | |  | (Historical |  | | Wallet Crypto  |  |
    | | Scheduler         | |  |  Data Store)|  | | Wallet Balance |  |
    | |                   | |  |             |  | | Wallet TX      |  |
    | | +---------------+ | |  |             |  | | Batch Ops      |  |
    | | |Priority Queue | | |  |             |  | +----------------+  |
    | | |Rank Analyzer  | | |  |             |  |                     |
    | | |Batch Optimizer| | |  |             |  |                     |
    | | |Metrics        | | |  |             |  |                     |
    | | +---------------+ | |  |             |  |                     |
    | +-------------------+ |  |             |  |                     |
    +-----------------------+  +-------------+  +---------------------+
                |                      |                |
                |                      |                |
                v                      v                v
    +-------------------------+  +-------------------------+
    |                         |  |                         |
    | Database                |  | WebSocket API           |
    | (Token Data & History)  |  | (Real-time Updates)     |
    |                         |  |                         |
    +-------------------------+  +-------------------------+
```

## Core Components

### SolanaEngine Service

The SolanaEngine service acts as the central orchestration point for all Solana-related operations. It integrates multiple specialized clients and provides a unified interface for the rest of the application.

**Key Features:**
- Coordinates token metadata, price data, and market information
- Manages subscriptions to token price updates
- Dispatches data to WebSocket clients
- Handles token search and discovery

**File Path:** `/services/solana-engine/solana-engine.js`

### Connection Manager

The ConnectionManager provides the foundation for all Solana RPC interactions. It serves as a single point of access to the Solana blockchain.

**Key Features:**
- Manages connections to RPC endpoints
- Handles connection errors and retries
- Provides standardized access to Solana blockchain data
- Creates and maintains the core `Connection` object from Solana web3.js

**File Path:** `/services/solana-engine/connection-manager.js`

## Token Data Services

### Helius Client

The Helius Client is primarily responsible for fetching token metadata using Helius's Digital Asset Standard (DAS) API.

**Key Features:**
- Fetches token metadata (name, symbol, decimals, logo)
- Maps Helius asset format to application's token metadata format
- Implements batch processing for efficient API usage
- Handles webhooks for real-time notifications

**File Path:** `/services/solana-engine/helius-client.js`

### Jupiter Client

The Jupiter Client handles token pricing data and provides real-time price updates.

**Key Features:**
- Fetches current token prices from Jupiter API
- Implements sophisticated batch processing and rate limiting
- Manages price subscriptions for real-time updates
- Handles API errors with exponential backoff

**File Path:** `/services/solana-engine/jupiter-client.js`

### DexScreener Client

The DexScreener Client provides comprehensive market data for tokens, including liquidity pools and trading information.

**Key Features:**
- Fetches token pool data including liquidity information
- Retrieves token profiles with social and security metrics
- Tracks trading volume and market activity
- Implements careful rate limiting to respect API constraints

**File Path:** `/services/solana-engine/dexscreener-client.js`

## Real-Time Tracking

### Helius Pool Tracker

The Helius Pool Tracker monitors liquidity pools in real-time to detect swaps, price changes, and liquidity events.

**Key Features:**
- Monitors liquidity pools via Helius WebSockets
- Detects swaps and price impact events
- Calculates token prices directly from on-chain data
- Tracks significant price changes

**File Path:** `/services/solana-engine/helius-pool-tracker.js`

### Helius Balance Tracker

The Helius Balance Tracker monitors wallet balances in real-time using Helius WebSockets, eliminating the need for constant polling.

**Key Features:**
- Tracks SOL and token balances for specified wallets
- Provides real-time notifications of balance changes
- Maintains a cache of current balances
- Works with the websocket API to broadcast changes

**File Path:** `/services/solana-engine/helius-balance-tracker.js`

### User Balance Tracking Service

The User Balance Tracking Service monitors user wallet balances on Solana, with support for both WebSocket and polling modes.

**Key Features:**
- Dynamically schedules balance checks based on user count and rate limits
- Supports both polling and WebSocket tracking modes via Helius
- Calculates optimal check intervals to manage RPC usage
- Maintains detailed statistics and visualizations for monitoring

**Key Components:**
- WebSocket Mode: Uses Helius Balance Tracker for real-time updates
- Polling Mode: Uses intelligent scheduling to minimize RPC calls
- Dynamic Rate Limiting: Adjusts check frequency based on user count

**File Path:** `/services/userBalanceTrackingService.js`

## Token Specialized Services

### Token DEX Data Service

The Token DEX Data Service is responsible for fetching and managing detailed DEX (decentralized exchange) data for tokens, focusing on pools and market metrics from DexScreener.

**Key Features:**
- Fetches and stores token pool data from DexScreener
- Manages refresh intervals based on token importance
- Tracks pool statistics like liquidity and volume
- Integrates with the token refresh system for updates

**File Path:** `/services/token-dex-data-service.js`

### Token Monitor Service

The Token Monitor Service actively tracks specific token transactions and market events, providing real-time notifications and analytics.

**Key Features:**
- Monitors token transactions using Helius WebSockets
- Tracks price movements and significant changes
- Emits events for other services to respond to
- Maintains a prioritized list of tokens to monitor

**File Path:** `/services/tokenMonitorService.js`

### Token History Functions

This module manages the historical record of token metrics, providing functions for storing and retrieving time-series data about token performance.

**Key Features:**
- Records historical price, volume, and liquidity data
- Supports multiple timeframes (24h, 7d, 30d)
- Provides batch operations for efficient database storage
- Enables trend analysis and historical performance tracking

**File Path:** `/services/token-history-functions.js`

## Integration Components

### Token Refresh Integration

The Token Refresh Integration module connects the advanced token refresh scheduler with other services in the system, providing a controlled interface for managing token data updates.

**Key Features:**
- Initializes and manages the token refresh scheduler
- Sets up event listeners to synchronize with other services
- Handles circuit breaker events to pause updates during issues
- Provides an interface for manual trigger of refreshes

**File Path:** `/services/token-refresh-integration.js`

### Token Refresh Scheduler

The Token Refresh Scheduler intelligently manages token price updates with smart prioritization to maximize API efficiency.

**Key Features:**
- Prioritizes tokens based on importance, volatility, and user interest
- Optimizes batch operations to maximize throughput
- Adapts to API rate limits and failures
- Collects metrics on refresh performance

**Key Components:**
- Priority Queue - Manages token update schedules
- Rank Analyzer - Determines token importance
- Batch Optimizer - Maximizes API efficiency
- Metrics Collector - Tracks performance

**File Path:** `/services/token-refresh-scheduler.js`

### Admin Wallet Service

The Admin Wallet Service handles secure administration of platform-owned wallets and manages cryptocurrency operations for the platform.

**Key Features:**
- Securely manages platform-owned wallets
- Handles SOL and token transfers
- Provides batch operations for mass processing
- Encrypts sensitive wallet information

**Key Modules:**
- Wallet Crypto - Handles encryption/decryption
- Wallet Balance - Tracks funds
- Wallet Transactions - Manages transfers
- Batch Operations - Processes mass operations

**File Path:** `/services/admin-wallet/admin-wallet-service.js`

## Data Flow

1. **Token Metadata Flow**:
   - SolanaEngine requests token metadata from Helius Client
   - Helius Client makes batched API calls to Helius DAS API
   - Metadata is transformed into application format
   - Results are cached and returned to requesting services

2. **Price Data Flow**:
   - Jupiter Client fetches price data through Jupiter API
   - Token Refresh Scheduler optimizes when and how prices are fetched
   - Token Refresh Integration coordinates when updates happen
   - Real-time price updates are distributed through WebSockets
   - Token History Functions store historical price data

3. **Market Data Flow**:
   - DexScreener Client fetches pool and market data
   - Token DEX Data Service manages the storage and refresh of DEX data
   - Helius Pool Tracker provides real-time updates from on-chain activity
   - Token Monitor Service watches for significant events
   - Data is combined to provide comprehensive market information
   - Updates are broadcast to clients via WebSocket API

4. **Balance Tracking Flow**:
   - User Balance Tracking Service monitors user wallet balances
   - In WebSocket mode, it uses Helius Balance Tracker for real-time updates
   - In polling mode, it schedules checks based on user count and rate limits
   - Balance changes trigger updates to the database and WebSocket notifications
   - Dynamic optimization balances freshness of data with RPC usage

5. **Wallet Operations Flow**:
   - Admin Wallet Service manages platform wallets
   - Connection Manager provides RPC access for transactions
   - Helius Balance Tracker monitors balance changes
   - Transaction results are logged and verified

## Integration Between Components

### Token Refresh Ecosystem

The token refresh system consists of multiple collaborating components:

1. **Token Refresh Scheduler** - The core scheduler that optimizes when tokens are refreshed
2. **Token Refresh Integration** - Connects the scheduler to other services
3. **Token Monitor Service** - Focuses on specific high-priority tokens
4. **Token DEX Data Service** - Manages detailed DEX data with its own refresh cycles
5. **Token History Functions** - Stores the historical data from refreshes

These components work together through service events and shared data flows:

- When the Token Refresh Scheduler updates token prices, it emits events that other services listen for
- The Token Monitor Service can trigger high-priority refreshes for specific tokens
- Token DEX Data Service maintains its own refresh cycle but coordinates with the scheduler
- Token History Functions record the outcomes of refreshes for historical tracking

### Balance Tracking System

The balance tracking system consists of several integrated components:

1. **User Balance Tracking Service** - Coordinates user wallet balance monitoring
2. **Helius Balance Tracker** - Provides real-time WebSocket updates for wallets
3. **SolanaEngine** - Supplies the RPC connection for polling mode
4. **WebSocket API** - Broadcasts balance changes to frontend clients

These components work together to:
- Minimize RPC usage while maintaining balance accuracy
- Provide real-time updates when possible via WebSockets
- Intelligently handle large numbers of users with dynamic scheduling
- Record balance changes for user portfolios and analytics

### Data Storage and Retrieval

The system stores token data through several mechanisms:

1. **In-memory caches** for frequently accessed data
2. **Redis** for distributed caching and pub/sub
3. **PostgreSQL database** for persistent storage
4. **Prisma ORM** for database access

## Integration Points

- **WebSocket API**: Real-time updates for token prices, pool data, and wallet balances
- **Database**: Persistent storage of token data, price history, and market information
- **External APIs**: Helius, Jupiter, and DexScreener provide data sources
- **Frontend Clients**: Consume data through REST API and WebSocket connections

## Conclusion

The DegenDuel Solana token architecture provides a comprehensive solution for token data by separating concerns into specialized components while maintaining a central orchestration point. This modular design allows for:

1. **Scalability**: Each component can be scaled independently
2. **Reliability**: Failure in one component doesn't affect others
3. **Maintainability**: Components can be updated or replaced individually
4. **Performance**: Specialized optimization for different data types

By combining multiple data sources and specialized services, the architecture provides a robust system for managing token data, from basic metadata to real-time market information and historical trends, while also efficiently tracking user wallet balances across the platform.