# Services Next For Upgrade

This document outlines the comprehensive plan for upgrading and potentially consolidating DegenDuel services to the modern architecture pattern with database-driven configuration.

## Complete Service Inventory

### Contest-Related Services
- **Contest Scheduler Service** (`contestSchedulerService.js`)
- **Contest Image Service** (`contestImageService.js`) 
- **Contest Evaluation Service** (`contestEvaluationService.js`)
- **Contest Wallet Service** (`contest-wallet/contestWalletService.js`) [UPGRADED]

### User Progression Services
- **Leveling Service** (`levelingService.js`)
- **Achievement Service** (`achievementService.js`)
- **Referral Service** (`referralService.js`)

### Wallet and Financial Services
- **Admin Wallet Service** (`admin-wallet/admin-wallet-service.js`) [UPGRADED]
- **Wallet Generation Service** (`walletGenerationService.js`)
- **Wallet Rake Service** (`walletRakeService.js`) 
- **User Balance Tracking Service** (`userBalanceTrackingService.js`)
- **Liquidity Service** (`liquidityService.js`)

### Blockchain and Market Services
- **Solana Engine Service** (`solana-engine/solana-engine.js`) [UPGRADED]
- **Solana Service** (`solanaService.js`) [DEPRECATED]
- **Token Sync Service** (`tokenSyncService.js`) 
- **Token Whitelist Service** (`tokenWhitelistService.js`)
- **Market Data Service** (`marketDataService.js`)

### Other Services
- **AI Service** (`ai-service/ai-service.js`) [UPGRADED]

## Proposed Service Consolidation

### 1. Unified Contest Management Service
**Combine:** Contest Scheduler Service + Contest Image Service + Contest Evaluation Service

**Rationale:** These three services all manage different aspects of the contest lifecycle but operate on the same data. A unified service would provide better coordination and eliminate redundancies.

**Implementation considerations:**
- Create a comprehensive database configuration table
- Handle both automated scheduling and on-demand contest creation
- Implement contest image generation as part of contest creation flow
- Integrate evaluation logic that runs when contests end
- Single circuit breaker pattern for all contest operations

### 2. User Progression Service
**Combine:** Leveling Service + Achievement Service

**Rationale:** These services are tightly coupled - achievements grant XP which leads to leveling up. A unified service would ensure consistent user progression tracking.

**Implementation considerations:**
- Single database configuration table
- Simplified event handling for user achievements and leveling
- Consistent XP calculation and rewards management
- Unified notification system for progression events

### 3. Blockchain Operations Service
**Replace:** Solana Service + Token Sync Service + Market Data Service → Already being replaced by Solana Engine

**Rationale:** The Solana Engine service is already designed to replace these services with a more robust implementation using premium APIs.

### 4. Wallet Management Service
**Consider combining:** Wallet Generation + Wallet Rake + User Balance Tracking

**Rationale:** These services all deal with wallet operations and could potentially benefit from consolidation.

## Priority Upgrade Queue

1. **Unified Contest Management Service** (combining scheduler, image, evaluation)
2. **User Progression Service** (combining leveling and achievements)
3. **Remaining financial services** (liquidity, wallet generation, etc.)
4. **Token Whitelist Service**

## Upgrade Process

Each service upgrade should follow these steps:

1. Create a database configuration table in Prisma schema
2. Add seed scripts for the configuration
3. Migrate the service to use the database configuration
4. Document the new configuration options
5. Update any related admin interfaces

## Already Upgraded

For reference, these services have already been upgraded:

- Solana Engine Service (replacing legacy Solana service)
- Admin Wallet Service
- Contest Wallet Service
- AI Service