# DegenDuel Token Price System Architecture

## System Overview

DegenDuel employs three complementary token price update systems that work together to provide accurate, timely, and resource-efficient price data. This document explains how these systems function individually and how they interact.

```mermaid
graph TD
    subgraph "External Data Sources"
        JupiterAPI[Jupiter API]
        SolanaChain[Solana Blockchain]
    end

    subgraph "Price Update Systems"
        MDS[MarketDataService]
        TRS[Token Refresh Scheduler]
        HPT[Helius Pool Tracker]
    end

    subgraph "Integration Layer"
        SE[Solana Engine]
    end

    subgraph "Storage"
        DB[(Database)]
    end

    subgraph "Consumers"
        WS[WebSocket Services]
        API[API Services]
    end

    JupiterAPI -->|Token Prices| MDS
    JupiterAPI -->|Token Prices| TRS
    SolanaChain -->|Pool Data| HPT

    MDS -->|Basic Updates| SE
    TRS -->|Prioritized Updates| SE
    HPT -->|Real-time Updates| SE

    SE -->|Unified Prices| DB
    DB -->|Token Data| WS
    DB -->|Token Data| API

    MDS -.->|Dependency| TRS
    SE -.->|Dependency| MDS
    SE -.->|Dependency| HPT
```

## 1. Basic Token Price Updates (MarketDataService)

This foundational system directly polls the Jupiter API for token prices at regular intervals.

**Key Characteristics:**
- Updates all active tokens every 60 seconds
- Processes tokens in batches of up to 100 (Jupiter's API limit)
- Operates independently with minimal complexity

```mermaid
sequenceDiagram
    participant MDS as MarketDataService
    participant Jupiter as Jupiter API
    participant DB as Database
    
    Note over MDS: Interval timer triggers (60s)
    MDS->>MDS: Get list of active tokens
    loop For each batch of 100 tokens
        MDS->>Jupiter: Request prices
        Jupiter-->>MDS: Return price data
        MDS->>DB: Update token_prices table
        MDS->>DB: Add to token_price_history
    end
    Note over MDS: Wait for next interval
```

## 2. Advanced Token Refresh Scheduler

This system optimizes when and how often different tokens are updated based on their importance, trading activity, and volatility.

**Key Characteristics:**
- Assigns dynamic priority scores and refresh intervals to tokens
- Uses a priority queue to schedule tokens for refresh
- Implements adaptive rate limiting and batch optimization

```mermaid
graph TD
    subgraph "Token Refresh Scheduler"
        Config[Configuration]
        PQ[Priority Queue]
        RA[Rank Analyzer]
        BO[Batch Optimizer]
        MC[Metrics Collector]
        
        Config --> PQ
        Config --> RA
        Config --> BO
        
        RA -->|Priority Data| PQ
        PQ -->|Due Tokens| BO
        BO -->|Optimized Batches| Process
        Process -->|Metrics| MC
        MC -->|Adaptive Config| Config
    end
    
    Database[(Database)] -->|Token Data| RA
    Jupiter[Jupiter API] <-->|Price Data| Process
    Process -->|Updates| Database
```

**Priority Calculation Factors:**

```mermaid
graph LR
    subgraph "Token Priority Calculation"
        Rank[Token Rank]
        Contest[Contest Usage]
        Volume[Trading Volume]
        Volatility[Price Volatility]
        
        Rank --> Priority
        Contest --> Priority
        Volume --> Priority
        Volatility --> Priority
        
        Priority -->|Determines| RefreshInterval
    end
```

## 3. Pool-Based Real-Time Price Tracking (Helius Pool Tracker)

This innovative system monitors liquidity pools directly via WebSockets, calculating token prices in real-time from on-chain data.

**Key Characteristics:**
- Monitors liquidity pools via Helius WebSockets
- Calculates prices directly from pool reserves
- Assigns confidence scores based on pool liquidity
- Records significant price changes

```mermaid
sequenceDiagram
    participant HPT as Helius Pool Tracker
    participant HC as Helius Client
    participant Chain as Solana Blockchain
    participant DB as Database
    
    HPT->>HC: Subscribe to pool account
    HC->>Chain: WebSocket subscription
    
    loop For each pool update
        Chain-->>HC: Pool account data changed
        HC-->>HPT: Account update notification
        HPT->>HPT: Parse pool data
        HPT->>HPT: Calculate token price
        
        alt Significant price change
            HPT->>DB: Record in pool_price_changes
            HPT->>HPT: Notify price update handlers
        end
        
        HPT->>HPT: Update in-memory token price
    end
```

**Price Confidence Scoring:**

```mermaid
graph LR
    subgraph "Confidence Calculation"
        Liquidity[Pool Liquidity]
        DEX[DEX Type]
        
        Liquidity -->|Higher liquidity = Higher confidence| Score
        DEX -->|Different DEX weights| Score
        
        Score -->|Range 0.5-0.95| Confidence
    end
```

## Integration Between the Three Systems

The SolanaEngine acts as the central coordinator for token price data, intelligently selecting between different price sources.

```mermaid
sequenceDiagram
    participant Client as API Client
    participant SE as SolanaEngine
    participant HPT as Helius Pool Tracker
    participant Jupiter as Jupiter API
    
    Client->>SE: getTokenPrice(address, {source: 'auto'})
    
    alt Try pool data first
        SE->>HPT: getTokenPriceWithConfidence()
        HPT-->>SE: {price, confidence, liquidity}
        
        alt Pool data successful
            SE-->>Client: Return pool-based price
        else Pool data failed or unavailable
            SE->>Jupiter: Get price
            Jupiter-->>SE: Price data
            SE-->>Client: Return Jupiter price
        end
    else Source = 'pools'
        SE->>HPT: getTokenPrice()
        HPT-->>SE: Pool-based price
        SE-->>Client: Return pool-based price
    else Source = 'jupiter'
        SE->>Jupiter: Get price
        Jupiter-->>SE: Price data
        SE-->>Client: Return Jupiter price
    end
```

## Event-Based Communication

The services communicate with each other using an event-driven architecture via the `serviceEvents` system, allowing for loose coupling and reactive behavior.

```mermaid
graph TD
    subgraph "Event Producer Services"
        MDS[MarketDataService]
        TRS[Token Refresh Scheduler]
        HPT[Helius Pool Tracker]
        CB[Circuit Breaker]
    end
    
    subgraph "Event Bus"
        Events[Service Events System]
    end
    
    subgraph "Event Consumer Services"
        TRI[Token Refresh Integration]
        SE[Solana Engine]
        WS[WebSocket Services]
    end
    
    %% Market Data Service Events
    MDS -->|market:tokens-updated| Events
    MDS -->|market:price-change| Events
    
    %% Pool Tracker Events
    HPT -->|token:price_update| Events
    HPT -->|pool:update| Events
    
    %% Circuit Breaker Events
    CB -->|circuitBreaker:tripped| Events
    CB -->|circuitBreaker:reset| Events
    
    %% Event Consumers
    Events -->|market:tokens-updated| TRI
    Events -->|token:price_update| SE
    Events -->|token:price_update| WS
    Events -->|circuitBreaker:tripped| TRI
    Events -->|circuitBreaker:reset| TRI
    
    %% Event Handling Logic
    subgraph "Event Handling Example"
        direction TB
        Event[market:tokens-updated]
        Handler[Token Refresh Scheduler Event Handler]
        Action[Reload Active Tokens]
        
        Event --> Handler
        Handler --> Action
    end
```

Key Event Types:
- `market:tokens-updated`: Emitted when token list is updated in MarketDataService
- `token:price_update`: Emitted by HeliusPoolTracker when significant price changes occur
- `circuitBreaker:tripped`: Emitted when an API fails repeatedly
- `circuitBreaker:reset`: Emitted when a service recovers from failure

Example Event Handler (from token-refresh-integration.js):
```javascript
// Listen for token sync events from MarketDataService
serviceEvents.on('market:tokens-updated', async (data) => {
  try {
    if (data && Array.isArray(data.updatedTokens) && data.updatedTokens.length > 0) {
      logApi.info(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Received token update event for ${data.updatedTokens.length} tokens`);
      
      // Reload active tokens
      await tokenRefreshScheduler.loadActiveTokens();
    }
  } catch (error) {
    logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Error handling token update event:`, error);
  }
});
```

Benefits of the Event-Based Approach:
1. **Loose Coupling**: Services don't need direct references to each other
2. **Scalability**: New listeners can be added without modifying event producers
3. **Fault Isolation**: Service failures don't cascade across the entire system
4. **Reactive Architecture**: System components react to changes rather than constantly polling

## Data Flow and Storage

```mermaid
graph TD
    subgraph "Price Data Flow"
        MDS[MarketDataService]
        TRS[Token Refresh Scheduler]
        HPT[Helius Pool Tracker]
        
        MDS -->|Regular Updates| TokenPrices
        TRS -->|Prioritized Updates| TokenPrices
        HPT -->|Significant Changes| PoolPriceChanges
        
        subgraph "Database"
            TokenPrices[(token_prices)]
            TokenHistory[(token_price_history)]
            PoolPriceChanges[(pool_price_changes)]
        end
        
        MDS -->|Historical Record| TokenHistory
        TRS -->|Historical Record| TokenHistory
    end
    
    WebSocket[WebSocket Services] -->|Subscribe| TokenPrices
    API[API Services] -->|Query| TokenPrices
    Analytics[Analytics] -->|Analyze| TokenHistory
    Analytics -->|Analyze| PoolPriceChanges
```

## Circuit Breaker Integration

```mermaid
sequenceDiagram
    participant MDS as MarketDataService
    participant CB as Circuit Breaker
    participant TRS as Token Refresh Scheduler
    
    Note over MDS: Multiple API failures
    MDS->>CB: Report failures
    CB->>CB: Trip circuit
    CB->>TRS: Pause scheduler
    
    Note over MDS: API recovers
    CB->>CB: Reset circuit
    CB->>TRS: Resume scheduler
```

## Advantages of the Multi-System Approach

1. **Resilience through Diversity**: Multiple independent price sources provide redundancy
2. **Optimized Resource Usage**: Prioritized scheduling ensures efficient API usage
3. **Real-time Price Data**: Direct pool monitoring provides immediate updates
4. **Confidence-Based Selection**: The system selects the most reliable price source
5. **Customizable Strategy**: Different tokens can use different price sources based on need

## System Comparison

| Feature | MarketDataService | Token Refresh Scheduler | Helius Pool Tracker |
|---------|-------------------|-------------------------|---------------------|
| **Update Frequency** | Fixed (60s) | Dynamic (15s-10min) | Real-time |
| **Price Source** | Jupiter API | Jupiter API | On-chain pools |
| **Batch Size** | Up to 100 | Optimized batches | Individual pools |
| **Prioritization** | None | Sophisticated scoring | Liquidity-based |
| **Confidence Scoring** | None | None | 0.5-0.95 based on liquidity |
| **Rate Limiting** | Basic | Adaptive | N/A (WebSocket) |
| **Fault Tolerance** | Low | Medium | High |
| **Resource Efficiency** | Low | High | Medium |
| **Real-time Capability** | None | None | High |
| **Implementation Complexity** | Low | High | Medium |

## Implementation Details

### MarketDataService Update Interval:

```javascript
this.updateInterval = setInterval(async () => {
  try {
    await this.updateTokenData();
  } catch (error) {
    logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error in update interval:${fancyColors.RESET}`, error);
  }
}, this.config.update.intervalMs);
```

### Token Refresh Scheduler Priority Tiers:

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

### Helius Pool Tracker WebSocket Subscription:

```javascript
const subscriptionId = await heliusClient.websocket.sendWebSocketRequest('accountSubscribe', [
  poolAddress,
  {
    commitment: 'confirmed',
    encoding: 'jsonParsed'
  }
]);
```

### SolanaEngine Price Source Selection:

```javascript
// In getTokenPrice method
if (source === 'auto') {
  // Try pool data first
  const poolPrice = await heliusPoolTracker.getTokenPriceWithConfidence(tokenAddress);
  
  if (poolPrice && poolPrice.price) {
    return {
      price: poolPrice.price,
      confidence: poolPrice.confidence || 0.5,
      source: `pool:${poolPrice.source || 'unknown'}`
    };
  } else if (fallback) {
    // Fall back to Jupiter
    const jupiterPrice = await jupiterClient.getPrice(tokenAddress);
    return {
      price: jupiterPrice,
      confidence: 0.8, // Standard confidence for Jupiter
      source: 'jupiter'
    };
  }
}
```

## Future Enhancements

1. **Unified Storage Model**: Create a unified view of prices from all three systems
2. **Enhanced DEX Support**: Add support for more DEX-specific pool parsing
3. **Machine Learning Price Validation**: Use ML to detect anomalies in price data
4. **Cross-chain Price Aggregation**: Extend to multiple blockchains
5. **Confidence-Based WebSocket Updates**: Only push updates to clients when confidence exceeds threshold

This architecture showcases a mature understanding of both the technical challenges in crypto price tracking and the business needs of a trading platform. It balances cutting-edge technology with pragmatic reliability in a way that few systems manage to achieve.