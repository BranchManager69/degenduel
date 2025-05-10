<div align="center">
  <img src="https://degenduel.me/assets/media/logos/transparent_WHITE.png" alt="DegenDuel Logo (White)" width="300">
  
  [![Node.js](https://img.shields.io/badge/Node.js-20.x-green)](https://nodejs.org/)
  [![Solana](https://img.shields.io/badge/Solana-SDK-green)](https://solana.com/)
  [![WebSocket](https://img.shields.io/badge/WebSocket-Unified-orange)](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
  [![Circuit Breaker](https://img.shields.io/badge/Circuit%20Breaker-Enabled-red)](https://martinfowler.com/bliki/CircuitBreaker.html)
</div>

> **Trade. Compete. Conquer.**

# ⚔️ DEGENDUEL ⚔️

## 💫 Platform Highlights

DegenDuel is a sophisticated real-time crypto trading competition platform with advanced capabilities:

- **Real-time Market Data Engine** - Millisecond token price updates via WebSockets
- **Unified WebSocket Architecture** - Single-connection access to all platform data streams
- **Multi-tier Service Architecture** - 20+ specialized microservices with circuit breakers
- **Solana Blockchain Integration** - Custom RPC proxy, transaction monitoring, and token tracking
- **AI-powered Terminal** - Natural language interface to token data and platform functions
- **Contest Generation System** - Dynamic contest creation with automated treasury management
- **Token Enrichment Pipeline** - Multi-source metadata enrichment for thousands of tokens
- **Vanity Wallet Generation** - Custom-branded wallet address generation with secure storage

## 🚀 Latest Documents

- [**WebSocket Service Architecture**](./6-MAY-WEBSOCKET-SERVICE-ARCHITECTURE.md) - Comprehensive guide to the unified WebSocket system (May 6, 2025)
- [**Token Enrichment Enhancement Plan**](./TOKEN_ENRICHMENT_ENHANCEMENT_PLAN.md) - Advanced token metadata pipeline
- [**AI Service Implementation**](./AI_SERVICE_IMPLEMENTATION.md) - Natural language terminal interface
- [**Service Architecture**](./SERVICE_ARCHITECTURE.md) - Core platform architecture overview

## 🛠️ Core Technology Stack

- **Backend**: Node.js with Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Real-time**: Custom WebSocket implementation with unified topics
- **Blockchain**: Solana with custom Web3.js extensions
- **Resilience**: Service manager with circuit breakers
- **Monitoring**: Integrated metrics and logging
- **Caching**: Redis for high-performance data access

## 🏗️ Architecture Overview

DegenDuel's architecture is built on five key pillars:

### 1. Service-Oriented Design

- **20+ Specialized Services** - Each with clear responsibility and resilience patterns
- **Unified Service Manager** - Centralized lifecycle management and monitoring
- **Circuit Breaker Pattern** - Automatic failure detection and graceful degradation
- **Service Profiles** - Environment-specific service configurations

### 2. Real-time Data Architecture

- **Unified WebSocket Server** - Single connection point for all real-time data
- **Topic-Based Subscriptions** - Filtered data access by category
- **Role-Based Access Control** - Authentication-aware data delivery
- **Service-to-WebSocket Integration** - Direct event publication from services

### 3. Token Data Pipeline

- **Multi-Source Data Collection** - DEX data, on-chain data, and social metrics
- **Continuous Enrichment** - Background processing for metadata enhancement
- **Ranking Algorithm** - Sophisticated token ranking based on multiple factors
- **Real-time Price Monitoring** - Sub-second price updates for tracked tokens

### 4. Blockchain Integration

- **Enhanced RPC Connectivity** - Premium Solana RPC endpoints with load balancing
- **Account Monitoring** - Real-time tracking of on-chain activity
- **Transaction Building** - Sophisticated multi-signature transaction workflows
- **Wallet Management** - Secure key storage with encryption

### 5. Contest Engine

- **Dynamic Contest Creation** - User and admin contest generation
- **Automated Treasury Management** - Secure prize pool handling
- **Real-time Leaderboards** - Live performance tracking
- **Prize Distribution** - Automated rewards allocation

## 🔐 Security Features

- **JWT Authentication** - Secure token-based authentication
- **Role-Based Access** - Fine-grained permissions system
- **WebSocket Authentication** - Secure real-time connections
- **Encrypted Storage** - Sensitive data protection
- **Rate Limiting** - Request throttling to prevent abuse
- **IP Tracking and Banning** - Automated abuse prevention

## 🔥 Performance Optimizations

- **Connection Pooling** - Efficient database connections
- **Redis Caching** - High-speed data access
- **Batched Operations** - Bulk database transactions
- **WebSocket Message Compression** - Reduced bandwidth usage
- **Service Prioritization** - Resource allocation based on importance

---

<div align="center">
  <h3>⚔️ DEGENDUEL ⚔️</h3>
  <p>Sharpen your trading skills while competing for real prizes. <br/>Ape and jeet with zero risk.</p>
  <p><b>© Branch Manager Productions.</b> All rights reserved.</p>
  <img src="https://img.shields.io/badge/WINTER-IS%20COMING-blue?style=for-the-badge" alt="Winter is Coming" />
</div>

<details>
<summary>High-Level Service Interaction Diagram (Click to Expand)</summary>

```mermaid
graph TD
    subgraph ExternalAPIs [External APIs]
        JupiterAPI[Jupiter API]
        HeliusAPI[Helius API]
        DexScreenerAPI[DexScreener API]
        DiscordAPI[Discord API]
        SolanaRPC[Solana RPC]
    end

    subgraph DataLayer [Data Layer]
        style DataLayer fill:#D1E8FF,stroke:#87CEEB
        TDS[TokenDetectionService]
        TES[TokenEnrichmentService]
        MDS[MarketDataService]
        TDDS[TokenDEXDataService]
        PDM[PoolDataManager]
        TMS[TokenMonitorService]
        TRS[TokenRefreshScheduler]
    end

    subgraph ContestLayer [Contest Layer]
        style ContestLayer fill:#FFE8D1,stroke:#FFB347
        CSS[ContestSchedulerService]
        CES[ContestEvaluationService]
        AS[AchievementService]
        RS[ReferralService]
        LSvc[LevelingService]
    end

    subgraph WalletLayer [Wallet Layer]
        style WalletLayer fill:#E8D1FF,stroke:#C387EB
        CWS[ContestWalletService]
        VWS[VanityWalletService]
        UBTS[UserBalanceTrackingService]
        AWS[AdminWalletService]
    end

    subgraph InfraAppLayer [Infrastructure & App Layer]
        style InfraAppLayer fill:#D1FFD1,stroke:#90EE90
        SE[SolanaEngine]
        DNS[DiscordNotificationService]
        LES[LaunchEventService]
        WGS[WalletGeneratorService]
        CIS[ContestImageService]
        AIS[AIService]
        WSS[UnifiedWebSocketServer]
        LS[LiquidityService]
        LSS[LiquiditySimService]
    end

    JupiterAPI --> TDS;
    TDS -. "event: TOKEN_DETECTED" .-> TES;
    TES --> JupiterAPI;
    TES --> HeliusAPI;
    TES --> DexScreenerAPI;
    TES --> MDS;
    TES -. "event: TOKEN_ENRICHED" .-> MDS;
    MDS --> SE;
    MDS --> TES;
    MDS --> TDDS;

    TRS --> MDS;
    TRS --> SE;
    TRS -. "event: token.refresh" .-> TDDS;
    TRS -. "event: token.batch.refresh" .-> TDDS;
    TDDS --> SE;
    PDM --> SE;
    PDM -. "event: pool:data_updated" .-> OtherServices([Other Services?]);
    TMS --> SE;
    TMS -. "event: TOKEN_PURCHASE/SALE/PRICE_UPDATE" .-> OtherServices;

    CSS --> WGS;
    CSS --> CWS;
    CSS --> CIS;
    CSS -. "event: CONTEST_CREATED" .-> DNS & CES;
    CES --> MDS;
    CES --> CWS;
    CES --> AS;
    CES --> RS;
    CES --> LSvc;
    CES -. "event: CONTEST_EVALUATED" .-> DNS & CWS;

    CWS --> SE;
    CWS --> VWS;
    UBTS --> SE;
    AWS --> CWS;

    LS --> WGS;
    LS --> SolanaRPC;
    LSS -. "event: liquidity:broadcast" .-> WSS;

    DNS --> DiscordAPI;
    DNS -. "Listens to Events" .-> CES & CSS;

    LES -. "event: LAUNCH_EVENT_ADDRESS_REVEALED" .-> WSS;
    InfraAppLayer -. "event: MAINTENANCE_MODE_UPDATED" .-> WSS;

    MDS -. "event: MARKET_DATA_BROADCAST" .-> WSS;
    WSS -- "Broadcasts MARKET_DATA" --> Client([Client App]);
    WSS -- "Broadcasts LAUNCH_EVENTS" --> Client;
    WSS -- "Broadcasts SYSTEM (Maintenance)" --> Client;
    WSS -- "Broadcasts TOKEN_UPDATES (Implied)" --> Client;
    WSS -- "Broadcasts LIQUIDITY_SIM" --> Client;
    WSS -- "Listens for pool:data_updated (Maybe)" .-> PDM;

    style Client fill:#f9f,stroke:#333,stroke-width:2px;
    classDef service fill:#fff,stroke:#555,stroke-width:1px;
    class TDS,TES,MDS,TDDS,PDM,TMS,TRS service;
    class CSS,CES,AS,RS,LSvc service;
    class CWS,VWS,UBTS,AWS service;
    class SE,DNS,LES,WGS,CIS,AIS,WSS,LS,LSS service;
    class OtherServices fill:#eee,stroke:#999,stroke-width:1px,stroke-dasharray: 5 5;
```

</details>
