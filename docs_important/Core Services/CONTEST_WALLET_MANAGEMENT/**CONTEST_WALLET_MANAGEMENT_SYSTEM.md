# Contest Wallet Management System Overview

## Table of Contents
1. [System Overview](#system-overview)
2. [Service Architecture](#service-architecture)
3. [Service Relationships](#service-relationships)
4. [Wallet Lifecycle](#wallet-lifecycle)
5. [Key Processes](#key-processes)
6. [Security & Compliance](#security--compliance)
7. [System Integration](#system-integration)
8. [Operational Considerations](#operational-considerations)

## System Overview

The Contest Wallet Management System consists of four interconnected services that together manage the complete lifecycle of contest wallets in the DegenDuel platform:

1. **Contest Wallet Service**
   - Primary wallet creation and management
   - Contest wallet lifecycle handling
   - Integration with vanity system

2. **Vanity Wallet Service**
   - Pre-generated wallet pool management
   - Custom address pattern generation
   - Resource-optimized wallet creation

3. **Wallet Rake Service**
   - Post-contest fund collection
   - Balance management
   - Financial cleanup operations

4. **Admin Wallet Service**
   - Administrative oversight
   - Manual intervention capabilities
   - System-wide wallet management

### Service Hierarchy
```mermaid
graph TD
    subgraph "Administrative Layer"
        A[Admin Wallet Service]
    end
    
    subgraph "Operational Layer"
        B[Contest Wallet Service]
        C[Vanity Wallet Service]
        D[Wallet Rake Service]
    end
    
    A --> B
    A --> C
    A --> D
    B <--> C
    B <--> D
    C -.-> D
```

## Service Architecture

### Complete System Architecture
```mermaid
graph TD
    subgraph "Admin Layer"
        AW[Admin Wallet Service]
        AI[Admin Interface]
    end
    
    subgraph "Wallet Management"
        CW[Contest Wallet Service]
        VW[Vanity Wallet Service]
        WR[Wallet Rake Service]
    end
    
    subgraph "Infrastructure"
        DB[(Database)]
        SOL[Solana Network]
        SEC[Security System]
    end
    
    subgraph "Contest System"
        CS[Contest Service]
        CE[Contest Evaluation]
    end
    
    AW --> CW
    AW --> VW
    AW --> WR
    AI --> AW
    
    CW <--> VW
    CW <--> WR
    
    CW --> DB
    VW --> DB
    WR --> DB
    AW --> DB
    
    CW --> SOL
    VW --> SOL
    WR --> SOL
    AW --> SOL
    
    CS --> CW
    CE --> WR
    
    CW --> SEC
    VW --> SEC
    WR --> SEC
    AW --> SEC
```

## Service Relationships

### Primary Interactions

1. **Contest Creation Flow**
```mermaid
sequenceDiagram
    participant CS as Contest System
    participant CW as Contest Wallet Service
    participant VW as Vanity Service
    participant AW as Admin Service
    
    CS->>CW: Create Contest Wallet
    CW->>VW: Request Vanity Wallet
    alt Vanity Available
        VW-->>CW: Return Vanity Wallet
    else No Vanity
        CW->>CW: Generate Standard Wallet
    end
    CW-->>CS: Return Wallet
    AW->>CW: Monitor Creation
```

2. **Contest Completion Flow**
```mermaid
sequenceDiagram
    participant CE as Contest Evaluation
    participant CW as Contest Wallet
    participant WR as Wallet Rake
    participant AW as Admin Service
    participant MW as Master Wallet
    
    CE->>CW: Mark Contest Complete
    WR->>CW: Check for Raking
    alt Has Balance
        WR->>MW: Transfer Funds
        WR->>CW: Update Balance
    end
    AW->>WR: Monitor Rake
    AW->>CW: Update Status
```

### Service Dependencies

```mermaid
graph TD
    subgraph "Dependencies"
        direction TB
        CW[Contest Wallet Service] --> VW[Vanity Wallet Service]
        CW --> WR[Wallet Rake Service]
        VW -.-> WR
        AW[Admin Wallet Service] --> CW
        AW --> VW
        AW --> WR
    end
    
    subgraph "Shared Resources"
        DB[(Database)]
        SEC[Security]
        NET[Network]
    end
    
    CW --> DB
    VW --> DB
    WR --> DB
    AW --> DB
    
    CW --> SEC
    VW --> SEC
    WR --> SEC
    AW --> SEC
    
    CW --> NET
    VW --> NET
    WR --> NET
    AW --> NET
```

## Wallet Lifecycle

### Complete Lifecycle Flow
```mermaid
stateDiagram-v2
    [*] --> Requested
    Requested --> VanityCheck
    
    state VanityCheck {
        [*] --> CheckPool
        CheckPool --> Available
        CheckPool --> Unavailable
        Available --> VanityAssigned
        Unavailable --> StandardGeneration
    }
    
    VanityCheck --> WalletCreation
    
    state WalletCreation {
        [*] --> Generation
        Generation --> Encryption
        Encryption --> Assignment
    }
    
    WalletCreation --> Active
    Active --> Completed
    
    state Completed {
        [*] --> RakeCheck
        RakeCheck --> RakeNeeded
        RakeCheck --> NoRake
        RakeNeeded --> RakeProcessed
    }
    
    Completed --> [*]
```

## Key Processes

### 1. Wallet Creation Process
- Contest Wallet Service initiates creation
- Checks Vanity Wallet Service for available wallets
- Falls back to standard generation if needed
- Admin Service monitors and can intervene
- Encryption and security measures applied

### 2. Wallet Management Process
- Active wallet monitoring
- Balance tracking
- Status updates
- Health checks
- Administrative oversight

### 3. Financial Operations
```mermaid
graph TD
    subgraph "Financial Flow"
        A[Contest Start] --> B[Wallet Funded]
        B --> C[Contest Active]
        C --> D[Contest Complete]
        D --> E[Rake Evaluation]
        E --> F[Fund Collection]
        F --> G[Master Wallet]
    end
    
    subgraph "Monitoring"
        H[Admin Oversight]
        I[Balance Tracking]
        J[Audit Logging]
    end
    
    E --> H
    E --> I
    F --> J
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
        CW[Contest Wallet]
        VW[Vanity Wallet]
        WR[Wallet Rake]
        AW[Admin Wallet]
    end
    
    A --> CW
    A --> VW
    A --> WR
    A --> AW
    
    B --> CW
    B --> VW
    B --> WR
    B --> AW
    
    CW --> C
    VW --> C
    WR --> C
    AW --> C
    
    CW --> D
    VW --> D
    WR --> D
    AW --> D
```

### Key Security Features
1. **Encryption**
   - AES-256-GCM for key storage
   - Secure key transmission
   - Protected memory handling

2. **Access Control**
   - Role-based permissions
   - Admin context management
   - Operation authorization

3. **Audit System**
   - Comprehensive logging
   - Transaction tracking
   - Administrative actions

## System Integration

### Integration Points
```mermaid
graph TD
    subgraph "External Systems"
        CS[Contest System]
        TS[Token System]
        BS[Blockchain System]
    end
    
    subgraph "Wallet Services"
        CW[Contest Wallet]
        VW[Vanity Wallet]
        WR[Wallet Rake]
        AW[Admin Wallet]
    end
    
    CS --> CW
    CS --> AW
    TS --> CW
    TS --> AW
    BS --> CW
    BS --> VW
    BS --> WR
    BS --> AW
```

## Operational Considerations

### Service Configuration Matrix
| Service | Check Interval | Min Balance | Retry Policy | Circuit Breaker |
|---------|---------------|-------------|--------------|-----------------|
| Contest | 5 minutes | 0.01 SOL | 3 retries | 5 failures |
| Vanity | 60 minutes | N/A | 3 retries | 5 failures |
| Rake | 10 minutes | 0.01 SOL | 3 retries | 5 failures |
| Admin | 1 minute | 0.05 SOL | 3 retries | 5 failures |

### Performance Optimization
1. **Resource Sharing**
   - Database connection pooling
   - Network request batching
   - Shared encryption services

2. **Load Management**
   - Dynamic worker scaling
   - Request queuing
   - Rate limiting

3. **Error Handling**
   - Coordinated circuit breakers
   - Shared retry policies
   - Cascading failure prevention

### Best Practices
1. Regular health monitoring across all services
2. Coordinated maintenance windows
3. Synchronized configuration updates
4. Regular security audits
5. Performance optimization reviews
6. Disaster recovery testing
7. Documentation maintenance

---

*Last Updated: February 2024*
*Contact: DegenDuel Platform Team* 