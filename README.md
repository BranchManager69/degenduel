<div align="center">
  <img src="https://degenduel.me/assets/media/logos/transparent_WHITE.png" alt="DegenDuel Logo (White)" width="300">
  
  [![Node.js](https://img.shields.io/badge/Node.js-20.x-green)](https://nodejs.org/)
  [![Express](https://img.shields.io/badge/Express-4.x-lightgrey)](https://expressjs.com/)
  [![Prisma](https://img.shields.io/badge/Prisma-16.x-blue)](https://prisma.io/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![Solana](https://img.shields.io/badge/Solana-SDK-green)](https://solana.com/)
  [![WebSocket](https://img.shields.io/badge/WebSocket-Unified-orange)](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
  [![Circuit Breaker](https://img.shields.io/badge/Circuit%20Breaker-Enabled-red)](https://martinfowler.com/bliki/CircuitBreaker.html)
</div>

> **Trade. Compete. Conquer.**

# ⚔️ DEGENDUEL ⚔️

## 📑 Solana Web3.js v2 Migration Documents

- [Web3.js v2 Migration Guide](./SOLANA_WEB3_V2_MIGRATION_GUIDE.md) - Step-by-step guide for migrating Admin Wallet Service
- [Admin Wallet Migration Plan](./ADMIN_WALLET_MIGRATION_PLAN.md) - Detailed migration plan for Admin Wallet Service
- [SolanaEngine v2 Migration Plan](./SOLANA_ENGINE_V2_MIGRATION_PLAN.md) - Comprehensive plan for rewriting SolanaEngine service
- [Contest Wallet v2 Migration Plan](./CONTEST_WALLET_V2_MIGRATION_PLAN.md) - Migration strategy for Contest Wallet Service
- [Market Data v2 Migration Plan](./MARKET_DATA_V2_MIGRATION_PLAN.md) - Integration plan for Market Data Service
- [Vanity Wallet v2 Migration Plan](./VANITY_WALLET_V2_MIGRATION_PLAN.md) - Migration approach for Vanity Wallet Service
- [Pool Data Manager v2 Migration Plan](./POOL_DATA_MANAGER_V2_MIGRATION_PLAN.md) - Migration approach for Pool Data Manager Service

## 🚀 Quick Start

- Use the universal tool runner to access all project tools: `dd`
- The tool provides easy access to scripts, tests, and utilities with a simple menu interface
- Type `dd` in your terminal and select the tool you want to run

## 📋 Overview

DegenDuel is a competitive crypto trading simulation platform built on a service-oriented architecture with real-time data capabilities. The platform enables users to:

- Authenticate with Solana wallets
- Participate in trading competitions
- Track portfolios and performance
- Earn achievements and level up
- Compete on leaderboards
- Refer friends for rewards

The system is designed with resilience as a primary concern, implementing circuit breakers, service monitoring, and graceful degradation patterns throughout.

**Core Technologies:**
- Node.js/Express backend
- PostgreSQL database with Prisma ORM
- Solana Web3 integration
- WebSocket-based real-time data
- PM2 process management
- JWT-based authentication

## 🏗️ Architecture

The DegenDuel platform follows a service-oriented architecture with specialized components for different business domains.

### Service Architecture

The system is built around a robust service framework with:

**Service Layers:**
1. **Infrastructure Layer**: Core services like SolanaEngine, WalletGenerationService
2. **Data Layer**: MarketDataService with premium API integration
3. **Contest Layer**: ContestEvaluationService, AchievementService
4. **Wallet Layer**: ContestWalletService, AdminWalletService

**Key Services:**
- **SolanaEngine**: Enhanced blockchain connectivity with premium APIs
- **MarketDataService**: Real-time market data and token management
- **AchievementService**: User achievement tracking and rewards
- **ContestEvaluationService**: Contest lifecycle management
- **LevelingService**: User progression system
- **ReferralService**: Referral program management
- **TokenMonitorService**: Monitors specific token transactions (buys/sells)
- **DiscordNotificationService**: Sends real-time notifications to Discord

**Service Pattern:**
- All services extend `BaseService`
- Consistent lifecycle methods (initialize, performOperation, stop)
- Self-contained state and metrics
- Circuit breaker integration
- Standard error handling

**Service Management:**
- `ServiceManager` singleton for centralized management
- Dependency-aware initialization
- Health monitoring
- State persistence
- WebSocket status broadcasting

### Database Architecture

The application uses PostgreSQL as its primary database with a well-structured schema:

**Core Data Models:**
1. **User System**: users, user_levels, user_achievements
2. **Contest System**: contests, contest_participants, contest_portfolios
3. **Token System**: tokens, token_prices, token_buckets
4. **Transaction System**: transactions, blockchain_transactions, wallet_balance_history
5. **Referral System**: referrals, referral_clicks, referral_rewards
6. **Service Management**: circuit_breaker_states, system_settings

### WebSocket Infrastructure

DegenDuel uses a unified WebSocket system for all real-time communications through a single connection point.

**Unified WebSocket System (v69):**
- **Single Connection**: All data flows through one WebSocket connection
- **Topic-Based Subscriptions**: Subscribe to specific data channels
- **JWT Authentication**: Secure access to restricted topics
- **Path**: `/api/v69/ws`

## 🛠️ Developer Setup

### Prerequisites

- Node.js 20.x or higher
- npm 8.x or higher
- PostgreSQL 16.x
- Git

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/degenduel.git
   cd degenduel
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup environment variables**
   - Copy `.env.example` to `.env`
   - Update database credentials
   - Configure Solana RPC endpoints

4. **Initialize the database**
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

5. **Start the development server**
   ```bash
   # Development mode with hot reload
   npm run dev
   
   # Or using PM2
   npm run pm2:start
   ```

### Database Setup

**Prisma Commands:**
```bash
# Generate Prisma client
npx prisma generate

# Create migration (development)
npx prisma migrate dev --name your_migration_name

# Apply migrations (production)
npx prisma migrate deploy
```

## 📊 System Management

### Process Management

DegenDuel uses PM2 with simplified npm scripts:

```bash
# View running processes
npm run pm2

# MASTER RESTART COMMAND (RECOMMENDED)
npm run re  # pm2 delete all && pm2 start ecosystem.config.cjs && pm2 logs

# Manage all services
npm run pm2:start-all    # Start all services
npm run pm2:stop-all     # Stop all services
npm run pm2:restart-all & # Restart all services (NON-BLOCKING)
```

### Logs and Monitoring

**Logging System:**
- Console logging with colors
- File logging to `/logs` directory
- Logtail remote logging
- Service-specific logging

**Log Access:**
```bash
# Check latest logs (non-blocking)
tail -n 50 /home/branchmanager/.pm2/logs/degenduel-api-out.log

# Check error logs
tail -n 50 /home/branchmanager/.pm2/logs/degenduel-api-error.log

# Follow logs in a second terminal
tail -f /home/branchmanager/.pm2/logs/degenduel-api-out.log &
```

### Circuit Breaker System

The application implements the circuit breaker pattern to manage service health:

**Circuit States:**
- `CLOSED`: Service operating normally
- `OPEN`: Service has failures beyond threshold, requests rejected
- `HALF_OPEN`: Testing if service has recovered

## 🔄 Additional Resources

- **Wallet Dashboard**: [ADMIN_WALLET_DASHBOARD.md](/ADMIN_WALLET_DASHBOARD.md)
- **Vanity Wallet Generation**: [VANITY_WALLET_GENERATION.md](/VANITY_WALLET_GENERATION.md) - Process flow and architecture of the vanity wallet generation system
- **Technical Reference**: [TECHNICAL_REFERENCE.md](/TECHNICAL_REFERENCE.md) - Comprehensive API, WebSocket, and integration documentation
- **Wallet Balance Tracking**: [WALLET_BALANCE_TRACKING.md](/WALLET_BALANCE_TRACKING.md) - Detailed guide on user and contest wallet balance monitoring with polling and WebSocket modes
- **DegenDuel RPC Proxy**: [DD-RPC.md](/DD-RPC.md) - Secure proxy system for Solana RPC and WebSocket PubSub connections (Team Integration Guide)
- **Frontend Repository**: [degenduel-fe](https://github.com/BranchManager69/degenduel-fe)
- **Unified WebSocket**: [WEBSOCKET_UNIFIED_SYSTEM.md](/docs/services/WEBSOCKET_UNIFIED_SYSTEM.md)

---

<div align="center">
  <h3>⚔️ DEGENDUEL ⚔️</h3>
  <p>Sharpen your trading skills while competing for real prizes. <br/>Ape and jeet with zero risk.</p>
  <p><b>© Branch Manager Productions.</b> All rights reserved.</p>
  <img src="https://img.shields.io/badge/WINTER-IS%20COMING-blue?style=for-the-badge" alt="Winter is Coming" />
</div>