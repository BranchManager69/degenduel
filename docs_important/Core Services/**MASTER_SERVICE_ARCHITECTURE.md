# DegenDuel Service Architecture

## Table of Contents
1. [Platform Overview](#platform-overview)
2. [Service Layers](#service-layers)
3. [Core Services](#core-services)
4. [Service Interactions](#service-interactions)
5. [Data Flow & State Management](#data-flow--state-management)
6. [Platform Operations](#platform-operations)
7. [Security & Compliance](#security--compliance)
8. [Performance & Scaling](#performance--scaling)
9. [Monitoring & Maintenance](#monitoring--maintenance)
10. [Disaster Recovery](#disaster-recovery)

## Platform Overview

DegenDuel's architecture consists of four primary service layers that work together to provide a secure, real-time trading platform:

1. **Infrastructure Layer**
   - Wallet generation and encryption
   - Test environment faucet
   - Core system utilities

2. **Data Layer**
   - Token synchronization
   - Market data management
   - Token whitelist control

3. **Contest Layer**
   - Contest evaluation and prizes
   - Achievement tracking
   - Referral management

4. **Wallet Layer**
   - Contest wallet management
   - Vanity wallet pooling
   - Fund collection and rake
   - Administrative operations

### Complete Service Architecture
```mermaid
graph TD
    subgraph "Infrastructure Layer"
        WG[Wallet Generator]
        FC[Faucet]
    end

    subgraph "Data Layer"
        TS[Token Sync]
        MD[Market Data]
        WL[Token Whitelist]
    end

    subgraph "Contest Layer"
        CE[Contest Evaluation]
        ACH[Achievement]
        RF[Referral]
    end

    subgraph "Wallet Layer"
        CW[Contest Wallet]
        VW[Vanity Wallet]
        WR[Wallet Rake]
        AW[Admin Wallet]
    end

    WG --> VW
    WG --> FC
    TS --> MD
    MD --> CE
    CE --> ACH
    CE --> RF
    CE --> CW
    VW --> CW
    CW --> WR
    CW --> AW
```

## Service Layers

### Wallet Management Layer
```mermaid
graph TD
    subgraph "Contest Operations"
        CW[Contest Wallet Service]
        VW[Vanity Wallet Service]
        WR[Wallet Rake Service]
    end
    
    subgraph "Administration"
        AW[Admin Wallet Service]
        SEC[Security Layer]
        MON[Monitoring]
    end
    
    CW -->|Uses| VW
    WR -->|Collects| CW
    AW -->|Manages All| CW
    AW -->|Oversees| VW
    AW -->|Controls| WR
    
    SEC -->|Protects| CW
    SEC -->|Secures| VW
    SEC -->|Guards| WR
    
    MON -->|Watches| CW
    MON -->|Tracks| VW
    MON -->|Monitors| WR
```

### Operations Management Layer
```mermaid
graph TD
    subgraph "Real-Time Operations"
        MD[Market Data Service]
        CE[Contest Evaluation]
        RF[Referral Service]
        WL[Token Whitelist]
    end
    
    subgraph "Support Systems"
        TS[Token Sync]
        WS[WebSocket]
        AN[Analytics]
    end
    
    MD -->|Feeds| CE
    CE -->|Triggers| RF
    WL -->|Validates| TS
    
    TS -->|Updates| MD
    MD -->|Streams| WS
    RF -->|Reports| AN
```

## Core Services

### Service Matrix
| Service | Layer | Update Frequency | Critical Level | Dependencies |
|---------|-------|-----------------|----------------|--------------|
| Wallet Generator | Infrastructure | 5m | High | None |
| Faucet | Infrastructure | 1h | Medium | Wallet Generator |
| Token Sync | Data | 30s | High | None |
| Market Data | Data | 100ms | Critical | Token Sync |
| Token Whitelist | Data | On demand | Medium | None |
| Contest Evaluation | Contest | On demand | Critical | Market Data |
| Achievement | Contest | On demand | Low | Contest Evaluation |
| Referral | Contest | 5m | Medium | Contest Evaluation |
| Contest Wallet | Wallet | On demand | Critical | Vanity Wallet, Contest Evaluation |
| Vanity Wallet | Wallet | Continuous | High | Wallet Generator |
| Wallet Rake | Wallet | 10m | High | Contest Wallet |
| Admin Wallet | Wallet | On demand | Critical | Contest Wallet |

### Service Responsibilities
```mermaid
graph TD
    subgraph "Data Layer"
        TS[Token Sync Service]
        MD[Market Data Service]
        DB[(Database)]
    end
    
    subgraph "Contest Layer"
        CE[Contest Evaluation]
        RF[Referral Service]
        ACH[Achievement Service]
    end
    
    subgraph "Wallet Layer"
        CW[Contest Wallet]
        VW[Vanity Wallet]
        WR[Wallet Rake]
        AW[Admin Wallet]
    end
    
    TS -->|Updates| DB
    DB -->|Reads| MD
    MD -->|Provides Data| CE
    CE -->|Triggers| RF
    CE -->|Updates| ACH
    CE -->|Uses| CW
    CW -->|Uses| VW
    WR -->|Monitors| CW
    AW -->|Manages| CW
```

### Data Flow
```mermaid
sequenceDiagram
    participant External as External APIs
    participant TS as Token Sync
    participant DB as Database
    participant MD as Market Data
    participant CE as Contest Eval
    
    TS->>External: Fetch Token Data
    TS->>DB: Update Prices/Metadata
    MD->>DB: Read Token Data
    CE->>MD: Request Price Data
    MD-->>CE: Provide Cached Data
```

### Service States
```mermaid
stateDiagram-v2
    [*] --> Initializing
    
    state "Service States" as ServiceStates {
        Initializing --> Active: Dependencies Ready
        Active --> Degraded: Performance Issues
        Degraded --> CircuitOpen: Threshold Exceeded
        CircuitOpen --> Recovering: Reset Period
        Recovering --> Active: Success
        Recovering --> CircuitOpen: Failure
    }
    
    state Active {
        [*] --> Running
        Running --> PerformingOperation
        PerformingOperation --> Running
    }
    
    state Degraded {
        [*] --> MonitoringHealth
        MonitoringHealth --> AttemptingRecovery
        AttemptingRecovery --> MonitoringHealth
    }
    
    state CircuitOpen {
        [*] --> WaitingReset
        WaitingReset --> CheckingDependencies
        CheckingDependencies --> AttemptingRecovery
    }
```

## Service Interactions

### Primary Workflows

1. **Contest Creation & Management**
```mermaid
sequenceDiagram
    participant CE as Contest Eval
    participant MD as Market Data
    participant CW as Contest Wallet
    participant VW as Vanity Wallet
    
    CE->>CW: Create Contest
    CW->>VW: Request Wallet
    VW-->>CW: Provide Wallet
    MD->>CE: Stream Prices
    
    loop During Contest
        MD->>CE: Update Prices
        CE->>CE: Track Performance
    end
    
    CE->>CW: Distribute Prizes
```

2. **Financial Operations**
```mermaid
sequenceDiagram
    participant CE as Contest Eval
    participant CW as Contest Wallet
    participant WR as Wallet Rake
    participant AW as Admin Wallet
    
    CE->>CW: End Contest
    CE->>CW: Distribute Prizes
    WR->>CW: Check Balance
    WR->>WR: Calculate Rake
    WR->>AW: Transfer Funds
    AW->>AW: Verify Transfer
```

3. **Referral Processing**
```mermaid
sequenceDiagram
    participant RF as Referral
    participant CE as Contest Eval
    participant CW as Contest Wallet
    participant AW as Admin Wallet
    
    RF->>RF: Track Click
    RF->>RF: Process Conversion
    CE->>RF: Contest Complete
    RF->>CW: Trigger Reward
    AW->>CW: Monitor Transfer
```

## Data Flow & State Management

### Data Ownership
```javascript
{
    wallet_layer: {
        contest_wallets: {
            owner: "Contest Wallet Service",
            readers: ["Admin", "Rake", "Evaluation"],
            writers: ["Contest Wallet", "Admin"]
        },
        vanity_pool: {
            owner: "Vanity Wallet Service",
            readers: ["Contest Wallet", "Admin"],
            writers: ["Vanity Wallet"]
        }
    },
    operations_layer: {
        market_data: {
            owner: "Market Data Service",
            readers: ["All"],
            writers: ["Market Data"]
        },
        contest_results: {
            owner: "Contest Evaluation",
            readers: ["All"],
            writers: ["Contest Evaluation"]
        },
        token_whitelist: {
            owner: "Token Whitelist Service",
            readers: ["All"],
            writers: ["Token Whitelist"]
        }
    }
}
```

### State Transitions
```mermaid
stateDiagram-v2
    [*] --> ContestCreation
    
    state ContestCreation {
        [*] --> WalletSetup
        WalletSetup --> ContestStart
    }
    
    state ContestActive {
        PriceUpdates --> Performance
        Performance --> Rankings
    }
    
    ContestCreation --> ContestActive
    ContestActive --> ContestEnd
    
    state ContestEnd {
        Evaluation --> PrizeDistribution
        PrizeDistribution --> RakeOperation
    }
    
    ContestEnd --> [*]
```

### Circuit Breaker Configuration
```javascript
{
    global_defaults: {
        enabled: true,
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000,
        monitoringWindowMs: 300000,
        healthCheckIntervalMs: 30000
    },
    service_specific: {
        market_data_service: {
            failureThreshold: 3,
            resetTimeoutMs: 30000
        },
        contest_evaluation_service: {
            failureThreshold: 10,
            resetTimeoutMs: 120000
        }
    }
}
```

## Platform Operations

### Critical Paths
```mermaid
graph TD
    subgraph "Contest Flow"
        A[Create Contest]
        B[Assign Wallet]
        C[Track Performance]
        D[Evaluate Results]
        E[Distribute Prizes]
        F[Rake Funds]
    end
    
    subgraph "Support Flow"
        G[Market Data]
        H[Referral Tracking]
        I[Admin Oversight]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    
    G -->|Feeds| C
    H -->|Tracks| A
    I -->|Monitors| B
    I -->|Verifies| E
    I -->|Controls| F
```

### Service Communication
```mermaid
graph TD
    subgraph "Direct Communication"
        A[Service-to-Service]
        B[Database Events]
        C[WebSocket Updates]
    end
    
    subgraph "Async Communication"
        D[Message Queue]
        E[Event Bus]
        F[Cache Updates]
    end
    
    A --> D
    B --> E
    C --> F
```

## Security & Compliance

### Security Architecture
```mermaid
graph TD
    subgraph "Security Layers"
        A[Authentication]
        B[Authorization]
        C[Encryption]
        D[Audit]
    end
    
    subgraph "Services"
        W[Wallet Services]
        O[Operation Services]
    end
    
    A --> W
    A --> O
    B --> W
    B --> O
    W --> C
    O --> C
    W --> D
    O --> D
```

### Compliance Requirements
1. **Financial Security**
   - Wallet encryption
   - Transaction signing
   - Balance verification
   - Audit logging

2. **Operational Security**
   - Rate limiting
   - Access control
   - Data validation
   - Error handling

## Performance & Scaling

### Resource Requirements
```javascript
{
    wallet_layer: {
        total_cores: 8,
        memory: "16GB",
        network: "1Gbps",
        storage: "100GB SSD"
    },
    operations_layer: {
        total_cores: 8,
        memory: "24GB",
        network: "10Gbps",
        storage: "200GB SSD"
    }
}
```

### Scaling Strategy
```mermaid
graph TD
    subgraph "Horizontal Scaling"
        A[Market Data Nodes]
        B[Contest Eval Nodes]
        C[Wallet Service Nodes]
    end
    
    subgraph "Vertical Scaling"
        D[Database]
        E[Cache]
        F[WebSocket]
    end
    
    A --> D
    B --> D
    C --> D
    
    A --> E
    B --> E
    C --> E
    
    A --> F
```

## Monitoring & Maintenance

### Health Monitoring
```javascript
{
    critical_metrics: {
        circuit_breaker: {
            status_check_interval: "5s",
            health_broadcast_interval: "5s",
            recovery_check_interval: "30s"
        },
        wallet_services: {
            wallet_creation_time: "< 1s",
            transaction_success: "99.99%",
            fund_security: "100%"
        },
        operations_services: {
            price_latency: "< 100ms",
            evaluation_accuracy: "100%",
            referral_tracking: "99.9%",
            whitelist_validation: "100%"
        }
    },
    health_states: {
        healthy: {
            description: "Normal operation",
            criteria: "No recent failures",
            monitoring: "Standard"
        },
        degraded: {
            description: "Performance issues detected",
            criteria: "Some failures, below threshold",
            monitoring: "Enhanced"
        },
        circuit_open: {
            description: "Service protection active",
            criteria: "Failure threshold exceeded",
            monitoring: "Critical"
        },
        recovering: {
            description: "Testing service restoration",
            criteria: "Reset period elapsed",
            monitoring: "Intensive"
        }
    }
}
```

### Real-time Monitoring
```mermaid
graph TD
    subgraph "Circuit Breaker Monitoring"
        A[Service Manager]
        B[WebSocket Server]
        C[Health Check]
        D[Metrics Collection]
    end
    
    subgraph "Client Updates"
        E[Admin Dashboard]
        F[Status Page]
        G[Alert System]
    end
    
    A -->|State Changes| B
    A -->|Health Status| C
    A -->|Performance Data| D
    
    B -->|Real-time Updates| E
    C -->|Health Reports| F
    D -->|Metrics| G
    
    E -->|Admin Actions| A
    F -->|Status Changes| G
```

## Disaster Recovery

### Recovery Procedures
1. **Wallet Layer Recovery**
   - Private key backup
   - Transaction rollback
   - Balance reconciliation
   - State restoration

2. **Operations Layer Recovery**
   - Data replication
   - Service failover
   - Cache rebuilding
   - State synchronization

### Recovery Flow
```mermaid
stateDiagram-v2
    [*] --> Detection
    
    state Detection {
        [*] --> IssueIdentified
        IssueIdentified --> Severity
    }
    
    state Recovery {
        Initiate --> Procedure
        Procedure --> Verification
    }
    
    Detection --> Recovery
    Recovery --> Restoration
    Restoration --> [*]
```

## Best Practices

1. **Service Management**
   - Maintain service independence
   - Coordinate updates
   - Monitor interactions
   - Document changes

2. **Data Handling**
   - Ensure consistency
   - Validate transactions
   - Maintain security
   - Backup regularly

3. **Performance**
   - Optimize critical paths
   - Cache effectively
   - Monitor resources
   - Scale proactively

4. **Security**
   - Encrypt sensitive data
   - Audit operations
   - Control access
   - Monitor threats

5. **Maintenance**
   - Schedule updates
   - Coordinate downtime
   - Test thoroughly
   - Document procedures

---

*Last Updated: February 2024*
*Contact: DegenDuel Platform Team* 