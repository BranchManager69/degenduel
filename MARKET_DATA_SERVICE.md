# Market Data Service Architecture

## Overview

The Market Data Service is a critical component of the DegenDuel platform that provides real-time token market data to all other services. This document explains its architecture, data flow, caching mechanism, and integration points.

```
                                  ┌─────────────────────┐
                                  │                     │
                                  │  Market Database    │
                                  │  (PostgreSQL)       │
                                  │                     │
                                  └─────────┬───────────┘
                                            │
                                            │ Query every 5s
                                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                         Market Data Service                             │
│                                                                         │
│  ┌───────────────┐     ┌───────────────┐     ┌───────────────────────┐  │
│  │ Token Cache   │     │ General Cache │     │ Performance Metrics   │  │
│  │ (by symbol)   │     │ (by key)      │     │ * Cache hits/misses   │  │
│  │ TTL: 10s      │     │ TTL: 10s      │     │ * Response times      │  │
│  └───────┬───────┘     └───────────────┘     │ * Request counts      │  │
│          │                                    └───────────────────────┘  │
│          │                                                               │
│          │ Broadcast every 10s                                           │
│          ▼                                                               │
│  ┌───────────────┐                                                       │
│  │ Event Emitter │                                                       │
│  └───────┬───────┘                                                       │
│          │                                                               │
└──────────┼───────────────────────────────────────────────────────────────┘
           │
           │ market:broadcast events
           │
           ▼
┌─────────────────────┐            ┌─────────────────────┐
│                     │            │                     │
│  WebSocket Servers  │            │  Token Sync Service │
│                     │            │                     │
└─────────────────────┘            └─────────────────────┘
           │                                   │
           │                                   │
           ▼                                   ▼
┌─────────────────────┐            ┌─────────────────────┐
│                     │            │                     │
│  Client            │            │  DegenDuel DB       │
│  Applications       │            │  (PostgreSQL)       │
│                     │            │                     │
└─────────────────────┘            └─────────────────────┘
```

## Data Sources and Flow

### Primary Data Source

The Market Data Service connects to a dedicated PostgreSQL database called `degenduel_market_data`, which is separate from the main application database. This database is specifically designed to store token market data, including:

- Token information (symbol, name, address)
- Current prices and price changes
- Market metrics (volume, market cap, liquidity)  
- Social media links
- Website URLs
- Token ecosystem metadata

```javascript
// Connection to Market Database
const marketDb = new PrismaClient({
    datasourceUrl: process.env.MARKET_DATABASE_URL
});
```

### Database Schema

The market database includes these primary tables:
- `tokens` - Core token information
- `token_socials` - Social media links for each token
- `token_websites` - Website links for each token

## Caching Architecture

The service implements a sophisticated dual-cache system:

### 1. Tokens Cache

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                          tokensCache                            │
│                                                                 │
├─────────────┬───────────────────────────────────────────────────┤
│ Key (Symbol)│                     Value                         │
├─────────────┼───────────────────────────────────────────────────┤
│    "SOL"    │ {                                                 │
│             │   id: 1,                                          │
│             │   symbol: "SOL",                                  │
│             │   name: "Solana",                                 │
│             │   price: 145.23,                                  │
│             │   change_24h: 2.5,                                │
│             │   // other token fields                           │
│             │   socials: { twitter: "...", discord: "..." },    │
│             │   websites: [{ label: "Homepage", url: "..." }]   │
│             │ }                                                 │
├─────────────┼───────────────────────────────────────────────────┤
│    "BONK"   │ { ... token data ... }                           │
├─────────────┼───────────────────────────────────────────────────┤
│    "BERN"   │ { ... token data ... }                           │
└─────────────┴───────────────────────────────────────────────────┘
```

- **Purpose**: Stores complete token data keyed by token symbol
- **Initialization**: Preloaded during service startup
- **Refresh Frequency**: Every 5 seconds via `refreshTokensCache()`
- **Access Patterns**: Directly accessed for token lookups by symbol, searched for lookups by address

### 2. General Cache

```
┌───────────────────────────────────────────────────────────────────┐
│                                                                   │
│                              cache                                │
│                                                                   │
├─────────────┬─────────────────────────────────────────────────────┤
│     Key     │                      Value                          │
├─────────────┼─────────────────────────────────────────────────────┤
│ "query_xyz" │ {                                                   │
│             │   data: { ... cached API response data ... },       │
│             │   timestamp: 1710489634821                          │
│             │ }                                                   │
└─────────────┴─────────────────────────────────────────────────────┘
```

- **Purpose**: General-purpose cache for API responses
- **TTL**: 10 seconds before entry expiration
- **Cleanup**: Runs every 1 second to remove expired entries
- **Size Limit**: Configured to store up to 10,000 items

## Cache Lifecycle

### Initialization

```
┌────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│                │     │                  │     │                   │
│  Service       │────▶│ Connect to       │────▶│ Preload tokens    │
│  starts        │     │ market database  │     │ into token cache  │
│                │     │                  │     │                   │
└────────────────┘     └──────────────────┘     └─────────┬─────────┘
                                                          │
                                                          │
                                                          ▼
┌────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│                │     │                  │     │                   │
│  Start         │◀────│ Start cache      │◀────│ Setup broadcast   │
│  operation     │     │ cleanup interval │     │ interval          │
│  cycle         │     │                  │     │                   │
└────────────────┘     └──────────────────┘     └───────────────────┘
```

### Refresh Cycle

The service operates on two primary timing cycles:

1. **Operation Cycle (5 seconds)**
   - Refreshes the tokens cache with latest data
   - Updates performance metrics
   - Sends service heartbeat

2. **Broadcast Cycle (10 seconds)**
   - Generates broadcast data package
   - Checks if data has changed since last broadcast
   - Emits market data via event system if changed or on schedule

### Cache Expiration and Cleanup

```
┌───────────────────────┐
│                       │
│  Cleanup Interval     │──┐
│  (every 1 second)     │  │
│                       │  │
└───────────────────────┘  │
                           │
                           ▼
┌───────────────────────────────────────────────────────┐
│                                                       │
│ For each cache entry:                                 │
│ - Check if (current time - entry timestamp) > TTL     │
│ - If expired, remove from cache                       │
│ - Update cache size metric                            │
│                                                       │
└───────────────────────────────────────────────────────┘
```

## Token Data Access Patterns

### Get Token by Symbol

```
┌──────────────┐     ┌────────────────┐     ┌────────────────┐
│              │     │                │     │                │
│  Request     │────▶│  Check token   │────▶│  Return cached │─────┐
│  token by    │     │  cache         │ Yes │  token data    │     │
│  symbol      │     │  Has symbol?   │     │                │     │
│              │     │                │     │                │     │
└──────────────┘     └────────┬───────┘     └────────────────┘     │
                              │ No                                  │
                              ▼                                     │
                     ┌────────────────┐                            │
                     │                │                            │
                     │  Query market  │                            │
                     │  database for  │                            │
                     │  token         │                            │
                     │                │                            │
                     └────────┬───────┘                            │
                              │                                    │
                              ▼                                    │
                     ┌────────────────┐     ┌────────────────┐    │
                     │                │ Yes │                │    │
                     │  Token found?  │────▶│  Format and    │    │
                     │                │     │  cache token   │────┘
                     │                │     │                │
                     └────────┬───────┘     └────────────────┘
                              │ No
                              ▼
                     ┌────────────────┐
                     │                │
                     │  Return null   │
                     │                │
                     │                │
                     └────────────────┘
```

### Get All Tokens

```
┌──────────────┐     ┌────────────────┐     ┌────────────────┐
│              │     │                │     │                │
│  Request     │────▶│  Is token      │ No  │  Refresh       │
│  all tokens  │     │  cache empty?  │────▶│  tokens cache  │
│              │     │                │     │                │
└──────────────┘     └────────┬───────┘     └────────┬───────┘
                              │ Yes                   │
                              │                       │
                              ▼                       │
                     ┌────────────────┐              │
                     │                │              │
                     │  Convert cache │◀─────────────┘
                     │  to array and  │
                     │  return        │
                     │                │
                     └────────────────┘
```

## Broadcast Mechanism

The Market Data Service implements a real-time broadcast system that sends token updates to other services and WebSocket servers:

```
┌──────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│                  │     │                    │     │                    │
│  Broadcast       │────▶│  Generate          │────▶│  Compare with      │
│  interval        │     │  broadcast data    │     │  previous data     │
│  (every 10s)     │     │  from token cache  │     │                    │
│                  │     │                    │     │                    │
└──────────────────┘     └────────────────────┘     └──────────┬─────────┘
                                                                │
                                  ┌───────────────┐             │
                                  │               │ Yes         │
                                  │ Emit market:  │◀─────Has data changed?
                                  │ broadcast     │             │
                                  │ event         │             │ No change & changesOnly=true
                                  │               │             │
                                  └─────────┬─────┘             ▼
                                            │           ┌────────────────────┐
                                            │           │                    │
                                            │           │  Skip broadcast    │
                                            │           │                    │
                                            │           │                    │
                                            │           └────────────────────┘
                                            ▼
┌──────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│                  │     │                    │     │                    │
│  WebSocket       │     │  Token Sync        │     │  Other DegenDuel   │
│  Servers         │     │  Service           │     │  Services          │
│                  │     │                    │     │                    │
└──────────────────┘     └────────────────────┘     └────────────────────┘
```

### Broadcast Data Format

Each broadcast includes:
- Message type (`token_update`)
- Timestamp
- Complete array of token data

```javascript
{
  type: 'token_update',
  timestamp: '2025-03-15T15:30:45.123Z',
  data: [
    {
      id: 1,
      symbol: 'SOL',
      name: 'Solana',
      price: 145.23,
      // ... other token fields
    },
    // ... more tokens
  ]
}
```

## Performance Monitoring and Error Handling

### Key Metrics Tracked

The service tracks comprehensive performance metrics:

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│                    Performance Metrics                        │
│                                                               │
├───────────────────┬───────────────────────────────────────────┤
│ Category          │ Metrics                                   │
├───────────────────┼───────────────────────────────────────────┤
│ Cache             │ • Size                                    │
│                   │ • Hits                                    │
│                   │ • Misses                                  │
│                   │ • Last cleanup time                       │
├───────────────────┼───────────────────────────────────────────┤
│ Request Handling  │ • Active requests                         │
│                   │ • Rejected requests                       │
│                   │ • Timed out requests                      │
├───────────────────┼───────────────────────────────────────────┤
│ Data              │ • Total tokens                           │
│                   │ • Active tokens                           │
│                   │ • Update counts (total/success/fail)      │
│                   │ • Broadcast counts                        │
├───────────────────┼───────────────────────────────────────────┤
│ Timing            │ • Average latency                         │
│                   │ • Last operation time                     │
│                   │ • Average operation time                  │
└───────────────────┴───────────────────────────────────────────┘
```

### Circuit Breaker Pattern

The service implements a circuit breaker pattern to handle failure scenarios:

```
┌──────────────┐     ┌────────────────┐     ┌────────────────┐
│              │     │                │     │                │
│  Request     │────▶│  Is circuit    │ Yes │  Throw service │
│  received    │     │  breaker open? │────▶│  unavailable   │
│              │     │                │     │  error         │
└──────────────┘     └────────┬───────┘     └────────────────┘
                              │ No
                              ▼
                     ┌────────────────┐     ┌────────────────┐
                     │                │ Yes │                │
                     │  Too many      │────▶│  Throw service │
                     │  requests?     │     │  overloaded    │
                     │                │     │  error         │
                     └────────┬───────┘     └────────────────┘
                              │ No
                              ▼
                     ┌────────────────┐
                     │                │
                     │  Process       │
                     │  request       │
                     │                │
                     └────────────────┘
```

- **Failure Threshold**: 10 failures (see `MARKET_DATA_CONFIG.circuitBreaker.failureThreshold`)
- **Reset Timeout**: 30 seconds (see `MARKET_DATA_CONFIG.circuitBreaker.resetTimeoutMs`)
- **Health Period**: 60 seconds (see `MARKET_DATA_CONFIG.circuitBreaker.minHealthyPeriodMs`)

## Integration with Other Services

### Integration with TokenSyncService

The TokenSyncService uses MarketDataService as its primary data source:

```
┌───────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│                   │     │                  │     │                   │
│  Market Data      │────▶│  Token Sync      │────▶│  DegenDuel        │
│  Service          │     │  Service         │     │  Application DB   │
│                   │     │                  │     │                   │
└───────────────────┘     └──────────────────┘     └───────────────────┘
```

The TokenSyncService calls into MarketDataService for:
- Token price data via `marketDataService.getTokenByAddress()`
- Complete token information via `marketDataService.getAllTokens()`

### Integration with WebSocket Servers

MarketDataService broadcasts token updates to WebSocket servers through the event system:

```javascript
// In MarketDataService
serviceEvents.emit('market:broadcast', broadcastData);

// In WebSocket servers
serviceEvents.on('market:broadcast', (data) => {
  // Forward to connected clients
});
```

## Configuration Parameters

The service behavior is controlled through the `MARKET_DATA_CONFIG` object:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `checkIntervalMs` | 5000 | How often the service refreshes token data (5 seconds) |
| `cache.ttl` | 10000 | Time-to-live for cache entries (10 seconds) |
| `cache.cleanupInterval` | 1000 | How often to run cache cleanup (1 second) |
| `cache.maxSize` | 10000 | Maximum number of items in cache |
| `broadcast.intervalMs` | 10000 | How often to broadcast token data (10 seconds) |
| `broadcast.changesOnly` | true | Only broadcast when data has changed |
| `limits.maxConcurrentRequests` | 1000 | Maximum number of concurrent requests |
| `limits.requestTimeoutMs` | 2000 | Request timeout (2 seconds) |

## Conclusion

The Market Data Service serves as the central hub for token market data in the DegenDuel platform. Its caching system ensures efficient access to frequently requested data while minimizing database load, and the broadcast mechanism enables real-time updates across the system.

Key strengths of the architecture:
- **Performance optimization** through multi-level caching
- **Real-time updates** through scheduled broadcasts
- **Reliability** through circuit breaker implementation
- **Comprehensive metrics** for monitoring and troubleshooting
- **Decoupled design** through event-based communication