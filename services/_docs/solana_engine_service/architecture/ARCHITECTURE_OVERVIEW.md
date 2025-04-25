# DegenDuel Market Data Architecture Overhaul

## Implementation Status

### Completed ✅
- [x] Initial architecture design and documentation
- [x] Setup of Jupiter and Helius API configurations
- [x] Implementation of Helius client for blockchain data
- [x] Implementation of Jupiter client for market data 
- [x] Redis caching integration
- [x] WebSocket integration for real-time updates
- [x] Service registration in service management system
- [x] GitHub issue creation (#27) for tracking implementation

### In Progress 🔄
- [ ] Testing and validation of API clients
- [ ] Integration with existing services
- [ ] Implementation of enhanced token metadata retrieval
- [ ] Implementation of real-time price streaming

### To Do 📋
- [ ] Production deployment
- [ ] Migration of dependent services to SolanaEngine
- [ ] Extension of WebSocket system with new topics
- [ ] Gradual replacement of legacy services
- [ ] Full documentation of client API
- [ ] Implementation of webhooks for blockchain events
- [ ] Performance testing and optimization

## Overview
This document outlines the complete architecture for replacing our existing token price and Solana data services with a new system powered by premium Helius and Jupiter API services. This overhaul will replace the legacy `tokenSyncService` and `marketDataService` with a more robust, real-time architecture.

## Current Architecture Being Replaced

### TokenSyncService
- **Current Purpose**: Maintains an up-to-date database of token information
- **Implementation**: Located at `/services/tokenSyncService.js`
- **Key Functions**:
  - Fetches token prices and metadata at regular intervals (60s default)
  - Updates database records with the latest information
  - Processes tokens in batches of 5 to avoid rate limits
  - Tracks market cap changes between updates
  - Falls back to local database when external sources fail
- **Major Limitations**:
  - Polling-based approach creates unnecessary load
  - Complex batching logic to handle rate limits
  - Delayed data (up to 60s old)
  - No real-time price change notifications
  - Excessive log output for routine operations

### MarketDataService
- **Current Purpose**: Acts as intermediary to external data sources
- **Implementation**: Located at `/services/marketDataService.js`
- **Key Functions**:
  - Connects directly to Solana RPC nodes
  - Caches responses to reduce RPC calls
  - Provides methods for other services to fetch token data
  - Handles rate limiting and retries
- **Major Limitations**:
  - Uses free-tier RPC nodes with strict rate limits
  - Limited metadata enrichment
  - No streaming capabilities
  - Complex error handling for rate limit issues
  - Redundant caching between service and database

## Reasons for Migration
1. **Technical Debt**: Current architecture evolved organically with overlapping responsibilities
2. **Rate Limiting**: Constantly hitting limits with free tier services
3. **Data Quality**: Inconsistent token metadata from free sources
4. **Real-time Need**: Current polling approach cannot provide true real-time updates
5. **Operational Overhead**: Significant time spent managing rate limits and errors
6. **Scalability**: Current approach doesn't scale well with growing token count
7. **Developer Experience**: Complex code that's difficult to maintain and extend

## New Architecture Benefits
- Real-time data through WebSockets
- Event-driven updates through webhooks
- Higher data quality from premium APIs
- Simplified architecture
- More reliable service
- Comprehensive on-chain activity monitoring
- Automatic token discovery and validation

## Architecture Diagram

```
┌──────────────────────┐     ┌──────────────────────┐
│  Jupiter WebSockets  │     │   Helius WebSockets  │
│  (Market Data)       │     │   (Solana Data)      │
└──────────┬───────────┘     └──────────┬───────────┘
           │                            │
           ▼                            ▼
┌──────────────────────────────────────────────────┐
│                                                  │
│             Processing Layer                     │
│                                                  │
│  ┌─────────────────┐      ┌─────────────────┐   │
│  │ Data Validation │ ──►  │ Normalization   │   │
│  └─────────────────┘      └─────────────────┘   │
│            │                       │            │
│            ▼                       ▼            │
│  ┌─────────────────┐      ┌─────────────────┐   │
│  │ Transformation  │ ──►  │ Business Logic  │   │
│  └─────────────────┘      └─────────────────┘   │
│                                                  │
└─────────────┬──────────────────────┬────────────┘
              │                      │
              ▼                      ▼
┌─────────────────────┐    ┌──────────────────────┐
│                     │    │                      │
│  PostgreSQL DB      │    │  Redis Cache         │
│  (Primary Storage)  │    │  (Real-time State)   │
│                     │    │                      │
└─────────┬───────────┘    └──────────┬───────────┘
          │                           │
          └───────────┬───────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────┐
│                                                  │
│                   API Layer                      │
│                                                  │
│  ┌─────────────────┐      ┌─────────────────┐   │
│  │ Query Handling  │ ◄──► │ Permission      │   │
│  └─────────────────┘      │ Management      │   │
│            │              └─────────────────┘   │
│            ▼                                    │
│  ┌─────────────────┐      ┌─────────────────┐   │
│  │ Data Assembly   │ ──►  │ Response        │   │
│  └─────────────────┘      │ Formatting      │   │
│                           └─────────────────┘   │
└─────────────────────────────┬──────────────────┘
                              │
                              ▼
                  ┌─────────────────────┐
                  │                     │
                  │  WebSocket Server   │
                  │  (Client Delivery)  │
                  │                     │
                  └──────────┬──────────┘
                             │
       ┌────────────────────┬┴───────────────────┐
       │                    │                    │
       ▼                    ▼                    ▼
┌─────────────┐     ┌─────────────┐      ┌─────────────┐
│ Client 1    │     │ Client 2    │ ...  │ Client N    │
└─────────────┘     └─────────────┘      └─────────────┘
```

**Key Data Flows:**

1. **Ingestion Flow:** External WebSockets → Processing Layer → DB/Redis
2. **Client Request Flow:** Client → WebSocket Server → API Layer → DB/Redis → API Layer → WebSocket Server → Client
3. **State Update Flow:** Processing Layer updates Redis → API Layer notified → WebSocket Server pushes to clients

## Architecture Components

### 1. External Data Sources

#### Jupiter Premium API
- **Purpose**: Real-time market data
- **Features**:
  - WebSocket price feeds
  - Token liquidity information
  - Price impact calculations
  - Historical price data
  - High rate limits
- **Implementation Priority**: High

#### Helius Premium API
- **Purpose**: Solana blockchain data
- **Features**:
  - WebSocket transaction monitoring
  - Token metadata enrichment
  - DAS (Digital Asset Standard) compliance
  - Webhooks for specific events
  - Enhanced RPC capabilities
- **Implementation Priority**: High

### 2. Processing Layer

#### Event Processor Service
- **Purpose**: Normalize and process incoming data streams
- **Components**:
  - Jupiter WebSocket client
  - Helius WebSocket client
  - Webhook endpoint handlers
  - Data normalization logic
  - Business rule application
- **Key Functions**:
  - Validate and sanitize incoming data
  - Transform data to internal format
  - Apply business rules and filters
  - Route data to appropriate storage
  - Trigger notifications for significant events
- **Implementation Priority**: High

### 3. Storage Layer

#### PostgreSQL Database
- **Purpose**: Primary persistent storage
- **Schema Updates**:
  - Enhanced token metadata fields
  - Transaction history tables
  - Price history with improved granularity
  - Token relationship tracking
- **Key Considerations**:
  - Maintain compatibility with existing application
  - Add new capabilities without disrupting current functionality
  - Optimize schema for common query patterns
  - Set up proper indexing
- **Implementation Priority**: Medium-High

#### Redis Cache & Integration with Existing Redis Manager

##### Current Redis Implementation
- **Implementation**: Located at `/utils/redis-suite/redis-manager.js`
- **Current Usage**:
  - Session management and user state
  - WebSocket connection tracking
  - Short-term caching of frequently accessed data
  - Service discovery and health checks
  - Pub/Sub for internal service communication
  
##### Enhanced Redis Implementation
- **Purpose**: Real-time state and hot data with expanded capabilities
- **Integration Approach**:
  - Extend existing Redis manager rather than replacing it
  - Add dedicated namespaces for market and token data
  - Implement new specialized methods while maintaining existing API
  - Preserve current connection pooling and error handling

- **New Data Structures**:
  - Hash maps for current token prices (`token:prices:current`)
  - Sorted sets for price rankings (`token:rankings:market_cap`)
  - PubSub channels for real-time updates (`updates:price`, `updates:transaction`)
  - Streams for recent activity history (`stream:token:price:SYMBOL`)
  - Lists for transaction queues (`queue:transactions:pending`)

- **Key Methods to Implement**:
  - `getTokenPrice(symbol)` - Fast token price lookup
  - `subscribeToTokenUpdates(symbols, callback)` - Price change notifications
  - `getTopTokensByMarketCap(limit, offset)` - Ranked token lists
  - `cacheTokenMetadata(symbol, data, ttl)` - Smart caching with TTL
  - `publishPriceUpdate(symbol, priceData)` - Publish price changes

- **Key Considerations**:
  - Maintain backward compatibility with existing Redis usage
  - Implement TTL policies for automatic expiration
  - Add memory usage monitoring and alerts
  - Create fallback mechanisms when Redis is unavailable
  - Document new methods and data structures

- **Implementation Priority**: Medium-High

### 4. API Layer

#### Data Access Service
- **Purpose**: Unified interface for accessing processed data
- **Endpoints**:
  - Token price and metadata queries
  - Historical data access
  - Real-time updates subscription
  - Transaction status and history
- **Key Considerations**:
  - Consistent error handling
  - Caching strategies
  - Rate limiting
  - Authentication and authorization
- **Implementation Priority**: Medium

### 5. Client Delivery

#### WebSocket Server Integration

##### Current WebSocket System
- **Implementation**: Located at `/websocket/v69/uni-ws.js`
- **Current Features**:
  - Unified WebSocket connection for all data types
  - Topic-based subscription model
  - Authentication and permission management
  - Client tracking and connection management
  - Message buffering and batch delivery

##### Enhanced WebSocket Implementation
- **Purpose**: Deliver real-time market and token data updates to clients
- **Integration Approach**:
  - Extend the existing unified WebSocket system rather than creating parallel connections
  - Add new market data and Solana transaction topics
  - Implement new message types for price updates and transaction notifications
  - Preserve existing connection management and authentication

- **Enhanced Existing Topics**:
  - `market-data` - Expand with real-time token price updates from Jupiter
  - `wallet` - Enhance with real-time transaction monitoring from Helius
  - `system` - Add new metrics and health data from external services

- **New Topic Subtypes/Actions**:
  - `market-data` actions:
    - `getTokenHistory` - Get historical price data for a token
    - `getTokenMetrics` - Get detailed analytics for a token
    - `getTopTokens` - Get ranked list of tokens by specified metric
  
  - `wallet` actions:
    - `getTransactionHistory` - Get enhanced transaction history
    - `monitorAddress` - Set up real-time monitoring for an address
    - `getTokenHoldings` - Get detailed token holdings with metadata

  - `system` actions:
    - `getServiceStatus` - Get status of external services
    - `getMarketMetrics` - Get overall market metrics

- **Enhanced Data Formats** (using existing `DATA` message type):
  - Market data updates:
    ```json
    {
      "type": "DATA",
      "topic": "market-data",
      "data": {
        "symbol": "SOL",
        "price": 256.78,
        "marketCap": 124000000000,
        "volume24h": 4860000000,
        "change24h": 5.67,
        "lastUpdate": "2025-04-01T12:34:56.789Z",
        "source": "jupiter"
      },
      "timestamp": "2025-04-01T12:34:56.789Z"
    }
    ```

  - Transaction updates:
    ```json
    {
      "type": "DATA",
      "topic": "wallet",
      "data": {
        "type": "transaction",
        "signature": "5xL7LZ6...",
        "status": "confirmed",
        "blockTime": 168923477,
        "amount": 1.25,
        "token": "SOL",
        "address": "YourWalletAddress",
        "source": "helius"
      },
      "timestamp": "2025-04-01T12:34:56.789Z"
    }
    ```

- **Key Features to Add**:
  - Threshold-based subscriptions (e.g., "alert on 5% price change")
  - Custom filtering for high-volume topics
  - Optimized message delivery for high-frequency updates
  - Backpressure handling for slow clients

- **Key Considerations**:
  - Maintain backward compatibility with existing WebSocket clients
  - Optimize payload size for high-frequency price updates
  - Implement proper reconnection handling with message replay
  - Support increasing connection count as user base grows
  - Add monitoring for message queue length and delivery latency

- **Implementation Priority**: Medium

## Implementation Phases

### Phase 1: Infrastructure Setup (Week 1)
- Set up Helius and Jupiter premium accounts
- Establish API keys and access patterns
- Create development environment for new services
- Document API specifications and interfaces

### Phase 2: Core Data Processing (Weeks 2-3)
- Implement WebSocket clients for Helius and Jupiter
- Develop webhook handlers for event notifications
- Create data normalization and validation layer
- Set up basic storage in PostgreSQL and Redis

### Phase 3: Storage Layer Enhancement (Weeks 4-5)
- Update PostgreSQL schema for new data models
- Implement Redis caching strategies
- Develop data migration plan from old to new system
- Create backup and recovery procedures

### Phase 4: API Development (Weeks 6-7)
- Build unified API for data access
- Implement authentication and authorization
- Develop rate limiting and protection mechanisms
- Create documentation for internal consumers

### Phase 5: WebSocket Integration (Week 8)
- Integrate with existing WebSocket system
- Implement client subscription management
- Develop data transformation for client consumption
- Optimize for performance

### Phase 6: Testing and Parallel Operation (Weeks 9-10)
- Run new system alongside existing services
- Compare data quality and performance
- Identify and fix discrepancies
- Load testing and optimization

### Phase 7: Switchover and Legacy Retirement (Weeks 11-12)
- Gradually shift traffic to new system
- Monitor for issues and performance
- Retire old services when stability confirmed
- Document final architecture and operations

## Technical Requirements

### Hardware Requirements
- Additional memory for Redis cache (recommend at least 8GB dedicated)
- Higher network bandwidth for WebSocket connections
- Storage for increased data volume (price history, transaction logs)

### Software Requirements
- Node.js v16+ for new services
- Redis 6.0+ for advanced features
- PostgreSQL 13+ for improved performance
- Updated ORM versions as needed
- WebSocket client libraries with reconnection support

### External Dependencies
- Helius Premium API subscription
- Jupiter Premium API subscription
- Monitoring tools integration
- Alert system for service health

## Monitoring and Operations

### Key Metrics to Track
- WebSocket connection stability
- Data processing latency
- Storage growth rate
- API response times
- Cache hit/miss ratios
- Error rates by component

### Alerting Thresholds
- WebSocket disconnections > 5 minutes
- Processing lag > 30 seconds
- API response time > 500ms
- Error rate > 1% of requests
- Redis memory usage > 80%

### Backup Procedures
- Hourly Redis snapshots
- Daily PostgreSQL backups
- Configuration version control
- API key rotation schedule

## Security Considerations

### API Key Management
- Store API keys in secure environment variables
- Rotate keys on schedule (90 days)
- Restrict API key permissions to minimum needed
- Monitor for unusual API usage patterns

### Data Protection
- Encrypt sensitive data at rest
- Use HTTPS for all external communications
- Implement rate limiting to prevent abuse
- Log access to sensitive data

### Authentication
- Use token-based authentication for internal services
- Implement proper session management
- Apply principle of least privilege
- Regular security reviews

## Cost Estimation

### Subscription Costs
- Helius Premium: $500/month
- Jupiter Premium: $XXX/month (TBD based on tier needed)

### Infrastructure Costs
- Additional database storage: ~$XX/month
- Increased compute resources: ~$XX/month
- Data transfer: ~$XX/month

### Development Costs
- Estimated at XX developer weeks

## Conclusion

This architecture overhaul will significantly improve the quality, reliability, and real-time nature of market and blockchain data available to the DegenDuel platform. By leveraging premium APIs from Helius and Jupiter, we eliminate complex workarounds currently needed to deal with rate limits and data quality issues.

The investment in premium services will be offset by reduced development and maintenance time, improved user experience, and the ability to offer new features that depend on high-quality real-time data.

## Next Steps

1. Finalize Jupiter pricing and features needed
2. Set up Helius premium account
3. Create detailed technical specifications for each component
4. Establish development timeline and resource allocation
5. Begin Phase 1 implementation