# The Three Token Price Update Systems in DegenDuel

## 1. Basic Token Price Updates (MarketDataService)

This is the original and most fundamental price update system in DegenDuel. It directly calls the Jupiter API to fetch token prices at regular intervals.

**Key Characteristics:**
- Implemented in `marketDataService.js`
- Updates all active tokens on a fixed interval (60 seconds)
- Calls Jupiter API in batches of up to 100 tokens (Jupiter's API limit)
- Managed by a simple interval timer that calls `updateTokenData()` regularly
- Operates independently of the other price update systems
- Has been running in production all along, even when the token refresh scheduler was disabled

**Internal workings:**
- Sets up an update interval in the constructor:
```javascript
this.updateInterval = setInterval(async () => {
  try {
    await this.updateTokenData();
  } catch (error) {
    logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error in update interval:${fancyColors.RESET}`, error);
  }
}, this.config.update.intervalMs);
```
- Makes direct Jupiter API calls to get prices:
```javascript
let tokenPrices = {};
try {
  tokenPrices = await jupiterClient.getPrices(tokenAddresses);
} catch (error) {
  logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error fetching token prices from Jupiter:${fancyColors.RESET}`, error);
}
```

## 2. Advanced Token Refresh Scheduler

This is a more sophisticated system built on top of the basic MarketDataService price updates. It optimizes when and how often different tokens should be refreshed based on their importance, trading activity, and volatility.

**Key Characteristics:**
- Implemented in `token-refresh-scheduler.js` and integrated via `token-refresh-integration.js`
- Assigns priority scores and dynamic refresh intervals to tokens
- Uses a priority queue to schedule tokens for refresh
- Handles rate limiting and API efficiency
- Optimizes batch creation and execution
- Depends on both MarketDataService and SolanaEngine
- Was disabled due to a name mismatch in the service configuration, which we fixed

**Internal workings:**
- Uses sophisticated priority tiers to determine refresh frequency:
```javascript
const PRIORITY_TIERS = {
  CRITICAL: { 
    score: 1000,
    interval: 15,    // 15 seconds
    volatility_factor: 2.0
  },
  HIGH: { 
    score: 500,
    interval: 30,    // 30 seconds 
    volatility_factor: 1.5
  },
  // ... more tiers ...
};
```
- Calculates token priority based on multiple factors in `calculateTokenPriority()`:
  - Token rank
  - Contest usage
  - Trading volume
  - Price volatility
- Organizes tokens into optimal batches for API calls
- Implements backoff for failed tokens
- Adjusts refresh frequency dynamically based on price change patterns

## 3. Pool-Based Real-Time Price Tracking (Helius Pool Tracker)

This is the newest and most innovative price update system. It uses Helius WebSockets to monitor liquidity pools directly on-chain, calculating token prices in real-time from pool reserves without requiring API calls.

**Key Characteristics:**
- Implemented in `helius-pool-tracker.js` and used via SolanaEngine
- Monitors liquidity pools via WebSocket connections
- Calculates prices directly from pool reserves using constant product formula
- Provides immediate price updates triggered by on-chain activity
- Assigns confidence scores based on pool liquidity and DEX type
- Records significant price changes in a dedicated database table
- Operates independently from the other two systems

**Internal workings:**
- Subscribes to pool accounts via Helius WebSockets:
```javascript
const subscriptionId = await heliusClient.websocket.sendWebSocketRequest('accountSubscribe', [
  poolAddress,
  {
    commitment: 'confirmed',
    encoding: 'jsonParsed'
  }
]);
```
- Calculates token prices directly from pool data:
```javascript
calculateTokenPrice(poolData) {
  // ... calculation based on DEX type
  switch (dex) {
    case 'RAYDIUM_AMM_V4':
      // Example calculation for Raydium
      if (poolData.data.baseReserve && poolData.data.quoteReserve) {
        const baseReserve = Number(poolData.data.baseReserve);
        const quoteReserve = Number(poolData.data.quoteReserve);
        
        // Assume our token is the base token
        price = quoteReserve / baseReserve;
        
        // Calculate liquidity
        liquidity = 2 * Math.sqrt(baseReserve * quoteReserve);
        
        // Higher confidence for larger pools
        confidence = Math.min(0.95, 0.5 + (liquidity / 1000000) * 0.45);
      }
      break;
    // ... other DEX cases ...
  }
}
```
- Detects significant price changes and records them in the database:
```javascript
if (priceChange > this.priceChangeThreshold) {
  significantChange = true;
  this.stats.significantPriceChanges++;
  
  // Log significant price changes
  logApi.info(`${formatLog.tag()} ${formatLog.header('PRICE CHANGE')} for token ${formatLog.address(tokenAddress)}: ${formatLog.price(previousPrice)} -> ${formatLog.price(price)} (${(priceChange * 100).toFixed(2)}%)`);
  
  // Store significant price change in database
  await prisma.pool_price_changes.create({
    data: {
      tokenAddress,
      poolAddress, 
      price: price,
      previousPrice: previousPrice,
      changePercent: priceChange * 100,
      liquidity: liquidity || 0,
      timestamp: new Date()
    }
  });
}
```

## Integration Between the Three Systems

The three systems are integrated through the SolanaEngine, which acts as the central coordinator for token price data:

1. **Within SolanaEngine.getTokenPrice()**:
   - Accepts a `source` parameter that can be 'auto', 'pools', or 'jupiter'
   - With 'auto' (the default), it tries pool data first, then falls back to Jupiter API
   - Assigns confidence scores to each price source (up to 0.95 for high-liquidity pools, 0.8 for Jupiter)
   - Can disable fallback behavior with an option to exclusively use one source

2. **Service Dependencies**:
   - MarketDataService depends on SolanaEngine
   - TokenRefreshScheduler depends on both MarketDataService and SolanaEngine
   - HeliusPoolTracker depends on HeliusClient which is initialized by SolanaEngine

3. **Circuit Breaker Integration**:
   - If MarketDataService circuit breaker trips, the token refresh scheduler is automatically paused
   - When the circuit breaker resets, the scheduler automatically resumes
   - This prevents cascading failures when API issues occur

4. **Data Flow and Storage**:
   - All three systems write price data to the database but in different ways:
     - MarketDataService and TokenRefreshScheduler update `token_prices` table
     - HeliusPoolTracker updates a separate `pool_price_changes` table for significant changes
   - SolanaEngine can retrieve prices from either source based on configuration

## Advantages of the Multi-System Approach

1. **Resilience through Diversity**: The three systems provide redundancy in case one fails
2. **Optimized Resource Usage**: TokenRefreshScheduler ensures API calls are made efficiently
3. **Real-time Price Data**: HeliusPoolTracker provides immediate updates without API polling
4. **Confidence-Based Selection**: The system can select the most reliable price source
5. **Customizable Strategy**: Different tokens can use different price sources based on need

## Summary of Relationships

- **MarketDataService** provides the foundation with regular Jupiter API calls
- **TokenRefreshScheduler** optimizes when and how those calls are made
- **HeliusPoolTracker** offers a parallel, real-time price source directly from on-chain data
- **SolanaEngine** coordinates between these systems and provides a unified interface

Together, these three systems create a comprehensive token price infrastructure that balances accuracy, timeliness, and resource efficiency.