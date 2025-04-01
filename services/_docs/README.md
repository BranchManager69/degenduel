# DegenDuel Services Documentation

Welcome to the DegenDuel services documentation. This directory contains comprehensive documentation for all the services that power the DegenDuel platform.

## Service Documentation

### Core Services

| Service | Description |
|---------|-------------|
| [AI Service](./ai_service/) | AI capabilities including chat, analysis, and SQL generation |
| [SolanaEngine](./solana_engine_service/) | Premium Solana integration using Helius and Jupiter APIs (replacing Token Sync and Market Data services) |
| [Token Sync Service](./token_sync_service/) | Token discovery, metadata, and synchronization (being replaced by SolanaEngine) |
| [Market Data Service](./market_data_service/) | Token price data collection and distribution (being replaced by SolanaEngine) |

### Contest-Related Services

| Service | Description |
|---------|-------------|
| [Contest Scheduler Service](./contest_scheduler_service/) | Contest creation and scheduling |
| [Contest Evaluation Service](./contest_evaluation_service/) | Contest outcome evaluation and winner determination |
| [Contest Wallet Service](./contest_wallet_service/) | Wallet management for contests |

### User-Related Services

| Service | Description |
|---------|-------------|
| [User Balance Tracking Service](./user_balance_tracking_service/) | Monitoring user wallet balances |

## Architecture Overview

DegenDuel follows a service-oriented architecture pattern where:

1. Each service extends a `BaseService` class
2. Services implement a circuit breaker pattern for resilience
3. Services register with the `ServiceManager` for lifecycle management
4. Services communicate through events and API interfaces

## Service Structure

Each service typically consists of:

1. Main service implementation file (`services/[serviceName].js`)
2. API interface for other code to access the service (`api/[serviceName]Api.js`)
3. Documentation in the corresponding folder (`services/docs/[service_name]/`)

## Common Patterns

All services follow these common patterns:

1. **Initialization**: `initialize()` method sets up resources
2. **Main Operation**: `onPerformOperation()` method handles primary service functions
3. **Cleanup**: `cleanup()` method releases resources when shutting down
4. **Circuit Breaking**: Auto-disables when excessive errors occur
5. **Monitoring**: Reports health metrics for monitoring

## Related Documentation

- [System Architecture](../../SYSTEM_ARCHITECTURE.md)
- [WebSocket System](../../WEBSOCKET_UNIFIED_SYSTEM.md)
- [Service Configuration](../../SERVICE_CONFIGURATION.md)
- [SolanaEngine Architecture](./solana_engine_service/architecture/ARCHITECTURE_OVERVIEW.md)