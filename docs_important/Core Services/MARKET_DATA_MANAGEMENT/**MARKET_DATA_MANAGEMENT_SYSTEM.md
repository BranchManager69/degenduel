# Market Data Service Integration

## Service Relationships

The Market Data Service and Token Sync Service work together in a producer-consumer pattern to provide real-time market data to the DegenDuel platform.

### High-Level Integration
```mermaid
graph TD
    subgraph "Data Acquisition Layer"
        TS[Token Sync Service]
        EX[External APIs]
        WL[Token Whitelist]
    end
    
    subgraph "Real-Time Layer"
        MD[Market Data Service]
        WS[WebSocket Server]
        CM[Cache Manager]
    end
    
    subgraph "Client Layer"
        UI[Trading Interface]
        API[REST Clients]
    end
    
    EX -->|30s Updates| TS
    TS -->|Price Updates| DB[(Database)]
    WL -->|Token Status| DB
    DB -->|Data Source| MD
    MD -->|Real-time| WS
    MD -->|REST| API
    WS -->|10/sec| UI
```

## Service Responsibilities

### Token Sync Service
- **Primary Role**: Data Acquisition & Storage
```mermaid
sequenceDiagram
    participant EA as External API
    participant TS as Token Sync
    participant DB as Database
    
    loop Every 30 seconds
        TS->>EA: Fetch Price Updates
        EA-->>TS: New Price Data
        TS->>TS: Validate Data
        TS->>DB: Store Updates
    end
```

### Token Whitelist Service
- **Primary Role**: Token Validation & Management
```mermaid
sequenceDiagram
    participant U as User
    participant WL as Whitelist
    participant TS as Token Sync
    participant DB as Database
    
    U->>WL: Submit Token
    WL->>WL: Verify Token
    WL->>DB: Update Status
    TS->>WL: Check Status
    WL-->>TS: Token Valid
    TS->>DB: Update Token
```

### Market Data Service
- **Primary Role**: Real-Time Data Distribution
```mermaid
sequenceDiagram
    participant DB as Database
    participant MD as Market Data
    participant WS as WebSocket
    participant C as Clients
    
    loop Every 100ms
        MD->>DB: Check Updates
        MD->>MD: Process Data
        MD->>WS: Stream Updates
        WS->>C: Broadcast
    end
```

## Data Flow

### Price Update Flow
```mermaid
sequenceDiagram
    participant EA as External API
    participant TS as Token Sync
    participant DB as Database
    participant MD as Market Data
    participant C as Clients
    
    Note over EA,C: Complete Data Flow
    
    EA->>TS: Price Update
    TS->>TS: Validate
    TS->>DB: Store
    
    loop Every 100ms
        MD->>DB: Read Latest
        MD->>MD: Cache & Process
        MD->>C: Stream Update
    end
```

## Timing & Synchronization

### Update Frequencies
```javascript
{
    tokenSync: {
        priceUpdate: "30 seconds",
        metadataUpdate: "On change",
        validation: "Immediate"
    },
    marketData: {
        clientStreams: "100ms (10/sec)",
        cacheRefresh: "1 second",
        healthChecks: "1 minute"
    }
}
```

## Cache Coordination

### Cache Strategy
```mermaid
graph TD
    subgraph "Token Sync Cache"
        TSC[Validation Cache]
        MTC[Metadata Cache]
        WLC[Whitelist Cache]
    end
    
    subgraph "Market Data Cache"
        PDC[Price Data Cache]
        SDC[Sentiment Data Cache]
        VDC[Volume Data Cache]
    end
    
    TSC -->|Validates| PDC
    MTC -->|Enriches| PDC
    WLC -->|Filters| PDC
    PDC -->|Informs| SDC
    PDC -->|Affects| VDC
```

## Error Handling Coordination

### Error Propagation
```mermaid
graph TD
    TS[Token Sync Error] -->|Affects| MD[Market Data Service]
    MD -->|Triggers| F[Fallback Mechanism]
    
    subgraph "Fallback Modes"
        F --> C[Use Cache]
        F --> L[Last Known Good]
        F --> S[Stale Data Warning]
    end
```

## Performance Considerations

### Resource Sharing
```javascript
// Shared resource limits
{
    database: {
        maxConnections: 100,
        queryTimeout: 5000
    },
    cache: {
        maxSize: "1GB",
        cleanupInterval: "5 minutes"
    },
    network: {
        maxConcurrent: 200,
        timeout: 10000
    }
}
```

## Integration Points

### Database Schema Sharing
```sql
-- Shared tables
token_prices (
    id UUID PRIMARY KEY,
    token_id UUID REFERENCES tokens(id),
    price DECIMAL,
    updated_at TIMESTAMP,
    -- Used by all services
    last_sync_by VARCHAR(50),
    last_sync_at TIMESTAMP,
    is_whitelisted BOOLEAN DEFAULT false,
    whitelist_updated_at TIMESTAMP
)
```

### Cache Key Conventions
```javascript
// Shared cache key format
{
    price: `price:${symbol}:${timestamp}`,
    volume: `volume:${symbol}:${interval}`,
    sentiment: `sentiment:${symbol}:${timestamp}`
}
```

## Monitoring Integration

### Combined Health Metrics
```javascript
{
    dataHealth: {
        tokenSyncLatency: Number,
        marketDataLatency: Number,
        syncGap: Number  // Time between sync and distribution
    },
    cacheHealth: {
        tokenSyncHitRate: Number,
        marketDataHitRate: Number,
        sharedCacheSize: Number
    },
    systemLoad: {
        databaseLoad: Number,
        networkUtilization: Number,
        memoryUsage: Number
    }
}
```

## Failure Scenarios

### Cascading Failure Prevention
```mermaid
graph TD
    TS[Token Sync Failure] -->|Affects| MD[Market Data]
    
    subgraph "Market Data Response"
        MD --> A[Use Cache]
        MD --> B[Reduce Update Frequency]
        MD --> C[Notify Clients]
    end
    
    subgraph "Recovery"
        A --> R[Resume Normal]
        B --> R
        C --> R
    end
```

## Best Practices

### Service Coordination
1. **Data Consistency**
   - Token Sync is source of truth
   - Market Data provides real-time access
   - Whitelist Service manages token status
   - Coordinate cache invalidation

2. **Performance Optimization**
   - Share database connections
   - Coordinate cache cleanup
   - Balance resource usage

3. **Error Handling**
   - Coordinated circuit breakers
   - Shared fallback strategies
   - Unified error reporting

4. **Monitoring**
   - Cross-service metrics
   - End-to-end latency tracking
   - Combined health checks

### Deployment Considerations
1. **Service Order**
   - Token Sync must start first
   - Market Data depends on initial sync
   - Coordinate maintenance windows

2. **Scaling**
   - Scale services independently
   - Share resource limits
   - Maintain data consistency

3. **Updates**
   - Coordinate version compatibility
   - Plan for backward compatibility
   - Manage schema migrations

## Common Integration Issues

### Troubleshooting Guide

#### Data Synchronization Issues
**Symptoms:**
- Inconsistent prices
- Delayed updates
- Missing data

**Resolution:**
1. Check Token Sync status
2. Verify database connectivity
3. Review cache consistency
4. Monitor update frequencies

#### Performance Problems
**Symptoms:**
- High latency
- Cache misses
- Resource contention

**Resolution:**
1. Balance resource sharing
2. Optimize cache usage
3. Review update frequencies
4. Monitor system load

#### Communication Failures
**Symptoms:**
- Service disconnects
- Data gaps
- Inconsistent states

**Resolution:**
1. Check service health
2. Verify network connectivity
3. Review error logs
4. Test recovery procedures

---

*Last Updated: February 2024*
*Contact: DegenDuel Platform Team* 