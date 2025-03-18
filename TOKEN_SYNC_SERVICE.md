# Token Sync Service Architecture

## Overview

The Token Sync Service is a critical component of the DegenDuel platform responsible for synchronizing token data between the Market Data Service and the application's main database. It ensures that token prices, metadata, and other market information remain up-to-date for all platform features.

```
                                  ┌─────────────────────┐
                                  │                     │
                                  │  Market Data        │
                                  │  Service            │
                                  │                     │
                                  └─────────┬───────────┘
                                            │
                                            │ Query every 30s
                                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                          Token Sync Service                             │
│                                                                         │
│  ┌───────────────┐     ┌───────────────┐     ┌───────────────────────┐  │
│  │ Token Map     │     │ Metadata      │     │ Performance Metrics   │  │
│  │ Cache         │     │ Processing    │     │ * Sync operations     │  │
│  │               │     │               │     │ * Token statistics    │  │
│  └───────┬───────┘     └───────┬───────┘     │ * Validation results  │  │
│          │                     │             └───────────────────────┘  │
│          │                     │                                        │
│          ▼                     ▼                                        │
│  ┌───────────────┐     ┌───────────────┐                               │
│  │ Price         │     │ Metadata      │                               │
│  │ Updates       │     │ Updates       │                               │
│  └───────────────┘     └───────────────┘                               │
│                                                                         │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  │ Write to Application Database
                                  ▼
                      ┌─────────────────────────┐
                      │                         │
                      │  DegenDuel Database     │
                      │  * tokens table         │
                      │  * token_prices table   │
                      │                         │
                      └─────────────────────────┘
```

## Service Responsibilities

The Token Sync Service has two primary responsibilities:

1. **Price Synchronization**: Keeping token price data current by fetching and storing the latest prices.
2. **Metadata Synchronization**: Ensuring token metadata (names, symbols, social links, etc.) is complete and up-to-date.

## Data Flow Architecture

### Data Sources

```
┌────────────────────┐                ┌────────────────────┐
│                    │                │                    │
│ Market Data        │                │ DegenDuel          │
│ Service            │                │ Database           │
│ (Primary Source)   │                │ (Fallback Source)  │
│                    │                │                    │
└──────────┬─────────┘                └──────────┬─────────┘
           │                                     │
           │ getAllTokens()                      │ prisma.tokens.findMany()
           │ getTokenByAddress()                 │
           ▼                                     ▼
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                     Token Sync Service                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

1. **Primary Source**: The Market Data Service
   ```javascript
   // Get all token data from marketDataService
   const tokensFromMarketService = await marketDataService.getAllTokens();
   ```

2. **Fallback Source**: The application's database (used if Market Data Service is unavailable)
   ```javascript
   // Fallback to database if marketDataService returns no data
   const existingTokens = await prisma.tokens.findMany({
       where: { is_active: true },
       include: { token_prices: true }
   });
   ```

### Data Destinations

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                     Token Sync Service                       │
│                                                              │
└──────────────────────────────────┬───────────────────────────┘
                                   │
                                   │
         ┌─────────────────────────┴─────────────────────┐
         │                                               │
         ▼                                               ▼
┌─────────────────────┐                       ┌─────────────────────┐
│                     │                       │                     │
│ tokens table        │                       │ token_prices table  │
│ (Metadata updates)  │                       │ (Price updates)     │
│                     │                       │                     │
└─────────────────────┘                       └─────────────────────┘
```

The service writes to two main tables in the DegenDuel database:

1. **tokens table**: Stores fundamental token information and metadata
2. **token_prices table**: Stores the latest price information for each token

## Sync Process Details

### Overview

The Token Sync Service runs two main synchronization processes:

1. **Price Updates** - Higher frequency (runs on every operation cycle)
2. **Metadata Updates** - Lower frequency (runs when token list changes are detected)

```
┌────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│                │     │                  │     │                   │
│  Service       │────▶│ Update token     │────▶│ Check if token    │
│  operation     │     │ prices           │     │ list has changed  │
│  cycle         │     │                  │     │                   │
│  (30 seconds)  │     │                  │     │                   │
└────────────────┘     └──────────────────┘     └─────────┬─────────┘
                                                          │
                                                          │ If changed
                                                          ▼
                                                ┌───────────────────┐
                                                │                   │
                                                │ Update token      │
                                                │ metadata          │
                                                │                   │
                                                └───────────────────┘
```

### Price Synchronization Process

```
┌────────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│                    │     │                  │     │                   │
│  Start price       │────▶│ Get active       │────▶│ Map addresses to  │
│  update cycle      │     │ tokens list      │     │ token info        │
│                    │     │                  │     │                   │
└────────────────────┘     └──────────────────┘     └─────────┬─────────┘
                                                              │
                                                              │
                                                              ▼
┌────────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│                    │     │                  │     │                   │
│  Track and log     │◀────│ Update prices    │◀────│ Fetch prices via  │
│  price changes     │     │ in database      │     │ Market Data Svc   │
│                    │     │                  │     │                   │
└────────────────────┘     └──────────────────┘     └───────────────────┘
```

1. **Get Active Tokens**
   ```javascript
   const activeTokens = await prisma.tokens.findMany({
       where: { is_active: true },
       select: { address: true, id: true, symbol: true }
   });
   ```

2. **Fetch Current Prices**
   ```javascript
   const priceData = await this.fetchTokenPrices(addresses);
   ```

3. **Update Database**
   ```javascript
   // Using transactions for atomicity
   await prisma.$transaction(async (tx) => {
       for (const token of priceData) {
           // Upsert the price data
           await tx.token_prices.upsert({
               where: { token_id: tokenId },
               create: { /* price data */ },
               update: { /* price data */ }
           });
       }
   });
   ```

### Metadata Synchronization Process

```
┌────────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│                    │     │                  │     │                   │
│  Start metadata    │────▶│ Fetch token      │────▶│ Validate token    │
│  update cycle      │     │ metadata         │     │ fields            │
│                    │     │                  │     │                   │
└────────────────────┘     └──────────────────┘     └─────────┬─────────┘
                                                              │
                                                              │
                                                              ▼
┌────────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│                    │     │                  │     │                   │
│  Update metadata   │◀────│ Process each     │◀────│ Start database    │
│  completeness      │     │ token            │     │ transaction       │
│  stats             │     │                  │     │                   │
└────────────────────┘     └──────────────────┘     └───────────────────┘
```

1. **Field Validation**
   The service implements thorough validation for all token fields:
   - Address validation (Solana address format check)
   - Symbol validation (cleaned and formatted)
   - Name validation (required field with length check)
   - URL validation (protocol and format check for image, social, and website URLs)

2. **Database Update**
   ```javascript
   // Using transactions for atomicity
   await prisma.$transaction(async (tx) => {
       for (const token of fullData) {
           // Validate fields
           const validatedData = { /* validated token data */ };
           
           // Update or create token record
           if (existingToken) {
               await tx.tokens.update({ /* update data */ });
           } else {
               await tx.tokens.create({ /* create data */ });
           }
       }
   });
   ```

### Change Detection

The service maintains a cache of the last known token list to detect changes:

```javascript
// Check if the token list has changed
hasTokenListChanged(newTokens) {
    // Size check
    if (this.lastKnownTokens.size !== newTokens.length) {
        return true;
    }

    // Content check
    for (const token of newTokens) {
        const existing = this.lastKnownTokens.get(token.contractAddress);
        if (!existing || 
            existing.name !== token.name || 
            existing.symbol !== token.symbol) {
            return true;
        }
    }
    return false;
}
```

## Validation and Error Handling

### Token Validation

The service implements comprehensive validation for each token field:

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│                   Token Field Validation                   │
│                                                            │
├──────────────┬─────────────────────────────────────────────┤
│ Field        │ Validation                                  │
├──────────────┼─────────────────────────────────────────────┤
│ Address      │ • Solana address format check               │
│              │ • PublicKey validity check                  │
│              │                                             │
├──────────────┼─────────────────────────────────────────────┤
│ Symbol       │ • Non-empty check                           │
│              │ • Character cleaning (alphanumeric + _ - .) │
│              │ • Length limit enforcement                  │
│              │                                             │
├──────────────┼─────────────────────────────────────────────┤
│ Name         │ • Required field check                      │
│              │ • Length limit enforcement                  │
│              │                                             │
├──────────────┼─────────────────────────────────────────────┤
│ URLs         │ • Protocol whitelist check                  │
│              │ • URL syntax validation                     │
│              │ • Length limit enforcement                  │
└──────────────┴─────────────────────────────────────────────┘
```

### Error Handling Strategy

The service implements a robust error handling strategy for different scenarios:

```
┌────────────────┐     ┌───────────────────┐     ┌───────────────────┐
│                │     │                   │     │                   │
│ Token address  │────▶│ Skip token entirely │  │ Log warning and    │
│ validation     │     │ to prevent DB      │────▶│ increment address │
│ failure        │     │ corruption         │     │ validation failure│
│                │     │                    │     │ count            │
└────────────────┘     └───────────────────┘     └───────────────────┘

┌────────────────┐     ┌───────────────────┐     ┌───────────────────┐
│                │     │                   │     │                   │
│ Other field    │────▶│ Use fallback or   │────▶│ Log warning and   │
│ validation     │     │ default value     │     │ continue with     │
│ failure        │     │ when possible     │     │ best effort       │
│                │     │                   │     │                   │
└────────────────┘     └───────────────────┘     └───────────────────┘

┌────────────────┐     ┌───────────────────┐     ┌───────────────────┐
│                │     │                   │     │                   │
│ MarketData     │────▶│ Use application   │────▶│ Log error but     │
│ Service        │     │ database as       │     │ continue with     │
│ unavailable    │     │ fallback source   │     │ available data    │
│                │     │                   │     │                   │
└────────────────┘     └───────────────────┘     └───────────────────┘
```

## Performance Monitoring

### Metrics Tracked

The service tracks detailed metrics to monitor its performance:

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│                   Sync Performance Metrics                    │
│                                                               │
├───────────────────┬───────────────────────────────────────────┤
│ Category          │ Metrics                                   │
├───────────────────┼───────────────────────────────────────────┤
│ Operations        │ • Total operations                        │
│                   │ • Successful operations                   │
│                   │ • Failed operations                       │
├───────────────────┼───────────────────────────────────────────┤
│ Performance       │ • Average operation time                  │
│                   │ • Last operation time                     │
│                   │ • Last price update time                  │
│                   │ • Last metadata update time               │
├───────────────────┼───────────────────────────────────────────┤
│ Tokens            │ • Total tokens                           │
│                   │ • Active tokens                           │
│                   │ • Inactive tokens                         │
│                   │ • Last update timestamp                   │
├───────────────────┼───────────────────────────────────────────┤
│ Prices            │ • Updated count                           │
│                   │ • Failed count                           │
│                   │ • Last update timestamp                   │
│                   │ • Average update time                     │
├───────────────────┼───────────────────────────────────────────┤
│ Metadata          │ • Created count                           │
│                   │ • Updated count                           │
│                   │ • Unchanged count                         │
│                   │ • Failed count                           │
│                   │ • Last update timestamp                   │
│                   │ • Average update time                     │
├───────────────────┼───────────────────────────────────────────┤
│ Validation        │ • URL failures                            │
│                   │ • Description failures                    │
│                   │ • Symbol failures                         │
│                   │ • Name failures                           │
│                   │ • Address failures                        │
│                   │ • Metadata completeness statistics        │
├───────────────────┼───────────────────────────────────────────┤
│ API               │ • Total calls                            │
│                   │ • Successful calls                        │
│                   │ • Failed calls                           │
│                   │ • Average latency                         │
└───────────────────┴───────────────────────────────────────────┘
```

### Circuit Breaker Integration

The service includes a circuit breaker mechanism to handle failures gracefully:

```javascript
// Circuit breaker configuration
circuitBreaker: {
    failureThreshold: 4, // Lower threshold due to external API dependency
    resetTimeoutMs: 45000, // Faster reset for market data flow
    minHealthyPeriodMs: 120000
}
```

## Price Formatting

The service implements intelligent price formatting based on token value:

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                    Smart Price Formatting                    │
│                                                              │
├──────────────┬───────────────────────────────────────────────┤
│ Price Range  │ Format                                       │
├──────────────┼───────────────────────────────────────────────┤
│ ≥ $1         │ 2 decimal places                             │
│              │ Example: $145.23                             │
├──────────────┼───────────────────────────────────────────────┤
│ $0.01 - $1   │ 4 decimal places                             │
│              │ Example: $0.4267                             │
├──────────────┼───────────────────────────────────────────────┤
│ $0.0001 -    │ 6 decimal places                             │
│ $0.01        │ Example: $0.004267                           │
├──────────────┼───────────────────────────────────────────────┤
│ $0.00000001 -│ 8 decimal places                             │
│ $0.0001      │ Example: $0.00004267                         │
├──────────────┼───────────────────────────────────────────────┤
│ < $0.00000001│ Scientific notation                          │
│              │ Example: 4.27e-10                            │
└──────────────┴───────────────────────────────────────────────┘
```

## Integration with Other Services

### Market Data Service Integration

The primary integration is with the Market Data Service:

```javascript
// Fetch token prices using marketDataService
async fetchTokenPrices(addresses) {
    // For each address, get token data from marketDataService
    const pricePromises = addresses.map(async (address) => {
        const token = await marketDataService.getTokenByAddress(address);
        if (token) {
            return {
                contractAddress: address,
                price: token.price || 0,
                marketCap: token.market_cap || null,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    });
    
    // Wait for all token data fetches to complete
    const results = await Promise.all(pricePromises);
    
    // Filter out null results
    const validResults = results.filter(result => result !== null);
    
    return validResults;
}
```

### Service Manager Integration

The Token Sync Service integrates with the Service Manager for monitoring and coordination:

```javascript
// Mark the service as started
await serviceManager.markServiceStarted(
    this.name,
    JSON.parse(JSON.stringify(this.config)),
    serializableStats
);

// Update ServiceManager state
await serviceManager.updateServiceHeartbeat(
    this.name,
    this.config,
    {
        ...this.stats,
        syncStats: this.syncStats
    }
);
```

## Configuration Parameters

The service behavior is controlled through the `TOKEN_SYNC_CONFIG` object:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `checkIntervalMs` | 30 * 1000 | How often the service checks for updates (30 seconds) |
| `maxRetries` | 3 | Maximum number of retries for operations |
| `retryDelayMs` | 5000 | Delay between retries (5 seconds) |
| `circuitBreaker.failureThreshold` | 4 | Failures before circuit opens |
| `circuitBreaker.resetTimeoutMs` | 45000 | How long circuit stays open (45 seconds) |
| `validation.*` | Various | Validation rules for token fields |
| `api.timeoutMs` | 10000 | API request timeout (10 seconds) |

## Conclusion

The Token Sync Service serves as a critical bridge between the Market Data Service and the DegenDuel application database. Its primary function is to ensure that token price and metadata information is consistently synchronized, validated, and properly stored for use by other platform components.

Key strengths of the architecture:
- **Robust validation** of all token data fields
- **Fallback mechanisms** to handle service unavailability
- **Intelligent change detection** to minimize unnecessary updates
- **Comprehensive metric tracking** for performance monitoring
- **Smart error handling** that prevents data corruption while maximizing data availability
- **Advanced formatting** for optimal display of token prices and market caps

This design ensures that the DegenDuel platform always has access to accurate, validated token information while minimizing unnecessary database operations and handling external service failures gracefully.