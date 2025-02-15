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

DegenDuel's architecture consists of two primary service layers that work together to provide a secure, real-time trading platform:

1. **Wallet Management Layer**
   - Contest wallet creation and management
   - Vanity wallet generation and pooling
   - Post-contest fund collection
   - Administrative wallet oversight

2. **Operations Management Layer**
   - Contest evaluation and prize distribution
   - Real-time market data streaming
   - Referral program management
   - Analytics and reporting

### Complete Service Architecture
```mermaid
graph TD
    subgraph "Operations Layer"
        CE[Contest Evaluation]
        MD[Market Data]
        RF[Referral Service]
    end
    
    subgraph "Wallet Layer"
        CW[Contest Wallet]
        VW[Vanity Wallet]
        WR[Wallet Rake]
        AW[Admin Wallet]
    end
    
    subgraph "Infrastructure"
        DB[(Database)]
        WS[WebSocket]
        BC[Blockchain]
    end
    
    CE -->|Triggers| CW
    MD -->|Informs| CE
    RF -->|Rewards| CW
    
    CW -->|Uses| VW
    WR -->|Collects| CW
    AW -->|Manages| CW
    AW -->|Oversees| VW
    AW -->|Controls| WR
    
    MD -->|Updates| WS
    CW -->|Transactions| BC
    DB -->|Stores| CE
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
    end
    
    subgraph "Support Systems"
        TS[Token Sync]
        WS[WebSocket]
        AN[Analytics]
    end
    
    MD -->|Feeds| CE
    CE -->|Triggers| RF
    
    TS -->|Updates| MD
    MD -->|Streams| WS
    RF -->|Reports| AN
```

## Core Services

### Service Matrix
| Service | Layer | Update Frequency | Criticality | Dependencies |
|---------|-------|-----------------|-------------|--------------|
| Contest Wallet | Wallet | On demand | Critical | Vanity, Admin |
| Vanity Wallet | Wallet | Continuous | High | Admin |
| Wallet Rake | Wallet | 10 minutes | High | Contest, Admin |
| Admin Wallet | Wallet | On demand | Critical | All |
| Contest Eval | Operations | On demand | Critical | Market Data |
| Market Data | Operations | 100ms | Critical | Token Sync |
| Referral | Operations | 5 minutes | High | Contest Eval |

### Service States
```mermaid
stateDiagram-v2
    [*] --> Initialization
    
    state Initialization {
        [*] --> WalletLayer
        [*] --> OperationsLayer
    }
    
    state WalletLayer {
        CW: Contest Wallet
        VW: Vanity Wallet
        WR: Wallet Rake
        AW: Admin Wallet
    }
    
    state OperationsLayer {
        CE: Contest Evaluation
        MD: Market Data
        RF: Referral Service
    }
    
    Initialization --> Running
    Running --> Maintenance
    Maintenance --> Running
    Running --> [*]
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
        wallet_services: {
            wallet_creation_time: "< 1s",
            transaction_success: "99.99%",
            fund_security: "100%"
        },
        operations_services: {
            price_latency: "< 100ms",
            evaluation_accuracy: "100%",
            referral_tracking: "99.9%"
        }
    }
}
```

### Alert Hierarchy
```mermaid
graph TD
    subgraph "Critical Alerts"
        A[Wallet Security]
        B[Fund Movement]
        C[Price Data]
    end
    
    subgraph "Warning Alerts"
        D[Performance]
        E[Resource Usage]
        F[Error Rates]
    end
    
    subgraph "Info Alerts"
        G[Statistics]
        H[Analytics]
        I[Updates]
    end
    
    A --> D
    B --> E
    C --> F
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