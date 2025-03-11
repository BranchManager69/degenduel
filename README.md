<div align="center">

# ⚔️ DEGENDUEL ⚔️

### *Battle for degenerate supremacy*

<img src="https://img.shields.io/badge/Version-1.0.0-brightgreen?style=for-the-badge&logo=v&logoColor=white" alt="Version" />
<img src="https://img.shields.io/badge/Node.js-20.x-success?style=for-the-badge&logo=node.js" alt="Node.js" />
<img src="https://img.shields.io/badge/Express-4.x-lightgrey?style=for-the-badge&logo=express" alt="Express" />
<img src="https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge&logo=typescript" alt="TypeScript" />
<img src="https://img.shields.io/badge/PostgreSQL-16.x-informational?style=for-the-badge&logo=postgresql" alt="PostgreSQL" />
<img src="https://img.shields.io/badge/Solana-Web3-blueviolet?style=for-the-badge&logo=solana" alt="Solana" />
<img src="https://img.shields.io/badge/PM2-5.3-green?style=for-the-badge&logo=pm2" alt="PM2" />
<img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License" />

<br />

**Sharpen your trading skills while competing for rewards. Ape and jeet with zero risk.**

<p align="center"><i>Looking for the <a href="https://github.com/BranchManager69/degenduel-fe">Frontend</a> repo?</i></p>

<p align="center">
<img src="https://img.shields.io/badge/UPDATED-Mar%202025-orange?style=for-the-badge" alt="Updated Mar 2025" />
<img src="https://img.shields.io/badge/SERVICE-RESILIENCE-brightgreen?style=for-the-badge" alt="Service Resilience" />
<img src="https://img.shields.io/badge/REAL--TIME-WEBSOCKETS-blueviolet?style=for-the-badge" alt="Real-time" />
</p>

</div>

---

# 📚 Technical Documentation: The Definitive Guide

## Table of Contents

- [📌 System Overview](#-system-overview)
- [🏗️ Architecture](#️-architecture)
  - [Service Architecture](#service-architecture)
  - [Database Architecture](#database-architecture)
  - [WebSocket Infrastructure](#websocket-infrastructure)
  - [Authentication System](#authentication-system)
- [🛠️ Developer Setup](#️-developer-setup)
  - [Prerequisites](#prerequisites)
  - [Local Development](#local-development)
  - [Database Setup](#database-setup)
- [🔐 Environment Configuration](#-environment-configuration)
  - [Environment Variables](#environment-variables)
  - [PM2 Configuration](#pm2-configuration)
- [📊 System Management](#-system-management)
  - [Process Management](#process-management)
  - [Logs and Monitoring](#logs-and-monitoring)
  - [Circuit Breaker System](#circuit-breaker-system)
- [🔌 Frontend Integration](#-frontend-integration)
  - [API Integration](#api-integration)
  - [WebSocket Integration](#websocket-integration)
  - [Authentication Integration](#authentication-integration)
- [📡 API Reference](#-api-reference)
  - [Authentication](#authentication)
  - [Users](#users)
  - [Contests](#contests)
  - [Tokens](#tokens)
  - [Portfolio & Trading](#portfolio--trading)
  - [Admin](#admin)
  - [System](#system)
- [🧵 WebSocket Protocol](#-websocket-protocol)
  - [Token Data WebSocket](#token-data-websocket)
  - [Portfolio WebSocket](#portfolio-websocket)
  - [Contest WebSocket](#contest-websocket)
  - [Monitor WebSocket](#monitor-websocket)
- [💾 Database Schema](#-database-schema)
  - [Core Data Models](#core-data-models)
  - [Schema Management](#schema-management)
- [🧩 Service Framework](#-service-framework)
  - [Base Service Pattern](#base-service-pattern)
  - [Service Registration](#service-registration)
  - [Service Dependencies](#service-dependencies)
- [🧪 Testing](#-testing)
  - [WebSocket Testing](#websocket-testing)
  - [API Testing](#api-testing)
- [📚 Additional Resources](#-additional-resources)

---

## 📌 System Overview

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

---

## 🏗️ Architecture

The DegenDuel platform follows a service-oriented architecture with specialized components for different business domains.

### Service Architecture

The system is built around a robust service framework with:

**Service Layers:**
1. **Infrastructure Layer**: Core services like SolanaService, WalletGenerationService
2. **Data Layer**: TokenSyncService, MarketDataService
3. **Contest Layer**: ContestEvaluationService, AchievementService
4. **Wallet Layer**: ContestWalletService, AdminWalletService

**Key Services:**
- **SolanaService**: Blockchain connectivity
- **TokenSyncService**: Token data synchronization
- **MarketDataService**: Real-time market data
- **AchievementService**: User achievement tracking and rewards
- **ContestEvaluationService**: Contest lifecycle management
- **LevelingService**: User progression system
- **ReferralService**: Referral program management

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

**Design Patterns:**
- Extensive use of foreign keys for referential integrity
- Comprehensive indexing strategy for performance
- Enums for constraining values
- Timestamps for audit trails
- JSON fields for flexible data storage

### WebSocket Infrastructure

The platform implements multiple specialized WebSocket servers for real-time communication:

**WebSocket Types:**
1. **Token Data WebSocket**: Real-time token price updates
2. **Portfolio WebSocket**: Live portfolio valuation
3. **Contest WebSocket**: Contest updates and real-time chat
4. **Market WebSocket**: Market data streaming
5. **Monitor WebSocket**: System health monitoring
6. **Analytics WebSocket**: User analytics tracking

**Architecture Features:**
- JWT-based authentication
- Channel-based subscription model
- Heartbeat mechanism (30-second interval)
- Connection tracking and analytics
- Message batching and queuing
- Rate limiting

**Message Format:**
```json
{
  "type": "string",       // Message type identifier
  "sequence": number,     // Monotonically increasing sequence
  "timestamp": number,    // Unix timestamp (ms)
  "data": object          // Message payload
}
```

### Authentication System

DegenDuel uses a Web3 wallet-based authentication system:

**Authentication Flow:**
1. **Challenge Generation**:
   - Client requests a challenge for a specific wallet address
   - Server generates a random nonce with 15-minute expiration

2. **Signature Verification**:
   - Client signs a message containing the nonce
   - Server verifies the signature against the wallet's public key
   - Nonce is consumed (one-time use)

3. **Session Establishment**:
   - JWT token generated with wallet_address, role, session_id
   - Token delivered via HTTP-only cookie
   - Default expiration: 12 hours

**Role-Based Access:**
- `user`: Standard user role
- `admin`: Administrative privileges
- `superadmin`: Highest level of access
- Middleware for role-based access control

**Security Features:**
- HTTP-only cookies
- Secure flag in production
- SameSite cookie policy
- Wallet address validation
- Rate limiting
- Input validation

---

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
   - Set Logtail tokens if needed

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

6. **Access the API**
   - API will be available at http://localhost:3004 (or configured port)
   - Swagger documentation at http://localhost:3004/api-docs

### Database Setup

**Prisma Commands:**
```bash
# Generate Prisma client
npx prisma generate

# Create migration (development)
npx prisma migrate dev --name your_migration_name

# Apply migrations (production)
npx prisma migrate deploy

# Reset database (CAUTION)
npx prisma migrate reset

# View database in Prisma Studio
npx prisma studio
```

**Database Reconciliation:**
```bash
# Compare Prisma schema with database
npm run db:reconcile-ai

# Generate migration to fix differences
npm run db:reconcile-fix
```

---

## 🔐 Environment Configuration

### Environment Variables

Key environment variables:

```bash
# Core Settings
PORT=3004                        # API server port
NODE_ENV=development             # Environment (development/production)
API_VERSION=v2                   # API version

# Database
DATABASE_URL=postgresql://...    # PostgreSQL connection string
REDIS_URL=redis://localhost:6379 # Redis connection string

# Authentication
JWT_SECRET=your_secret_here      # JWT signing secret
SESSION_EXPIRY=12h               # Session expiration time

# Solana
SOLANA_RPC_URL=https://...       # Solana RPC endpoint
SOLANA_WEBSOCKET_URL=wss://...   # Solana WebSocket endpoint

# Logging
LOGTAIL_TOKEN=your_token         # Logtail logging token
LOG_LEVEL=info                   # Logging verbosity

# WebSockets
WS_HEARTBEAT_INTERVAL=30000      # WebSocket heartbeat in ms
WS_RATE_LIMIT=100                # Message rate limit per minute

# Features
ENABLE_TWITTER_AUTH=true         # Enable Twitter authentication
ENABLE_DEVICE_AUTH=true          # Enable device authentication
```

### PM2 Configuration

The application uses PM2 for process management with configuration in `ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [
    {
      name: "degenduel-api",
      script: "./index.js",
      env: {
        PORT: 3004,
        NODE_ENV: "production",
        // Additional environment variables
      }
    },
    {
      name: "degenduel-api-test",
      script: "./index.js",
      env: {
        PORT: 3005,
        NODE_ENV: "development",
        // Test environment variables
      }
    }
    // Additional service configurations
  ]
};
```

---

## 📊 System Management

### Process Management

DegenDuel uses PM2 with simplified npm scripts:

```bash
# View running processes
npm run pm2

# Start API service
npm run pm2:start

# Stop API service
npm run pm2:stop

# Restart API service (NON-BLOCKING)
npm run pm2:restart & 

# Restart API and view logs (NON-BLOCKING)
npm run pm2:restart-logs & 

# Manage all services
npm run pm2:start-all    # Start all services
npm run pm2:stop-all     # Stop all services
npm run pm2:restart-all & # Restart all services
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

# Via npm scripts
npm run logs &         # All logs (non-blocking)
npm run logs:api &     # API logs (non-blocking)
npm run logs:error &   # Error logs (non-blocking)
```

**WebSocket Monitoring:**
- Connect to `/api/v2/ws/monitor` for real-time system metrics
- Circuit breaker status at `/api/v2/ws/circuit-breaker`
- Service status reports via `/api/admin/system-reports`

### Circuit Breaker System

The application implements the circuit breaker pattern to manage service health:

**Circuit States:**
- `CLOSED`: Service operating normally
- `OPEN`: Service has failures beyond threshold, requests rejected
- `HALF_OPEN`: Testing if service has recovered

**Configuration:**
- `failureThreshold`: Number of failures before opening circuit
- `resetTimeout`: Time before attempting recovery (ms)
- `monitorInterval`: Health check frequency (ms)

**Management:**
- View circuit breaker status via admin panel
- Manual reset via `/api/admin/circuit-breaker/reset`
- Service health metrics via WebSocket

---

## 🔌 Frontend Integration

### API Integration

**Environment Detection:**
```javascript
const isDev = 
  window.location.hostname === "localhost" ||
  window.location.hostname.startsWith("127.0.0.1") ||
  window.location.hostname === "dev.degenduel.me";

export const API_URL = isDev
  ? `https://dev.degenduel.me/api`
  : `https://degenduel.me/api`;
```

**API Client Example:**
```javascript
// Fetch tokens with authentication
async function fetchTokens() {
  try {
    const response = await fetch(`${API_URL}/tokens`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Important for cookies
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching tokens:', error);
    throw error;
  }
}
```

### WebSocket Integration

**WebSocket Token Acquisition:**
```javascript
async function getWebSocketToken() {
  try {
    const response = await fetch(`${API_URL}/auth/token`, {
      credentials: 'include', // Important for cookies
    });
    
    if (!response.ok) {
      throw new Error('Failed to get WebSocket token');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error getting WebSocket token:', error);
    throw error;
  }
}
```

**WebSocket Connection:**
```javascript
async function connectToWebSocket(wsType) {
  // Get authentication token
  const { token } = await getWebSocketToken();
  
  // Determine WebSocket URL
  const wsUrl = `${WS_BASE_URL}/${wsType}`;
  
  // Connect with token as subprotocol
  const ws = new WebSocket(wsUrl, token);
  
  // Setup event handlers
  ws.onopen = () => {
    console.log(`Connected to ${wsType} WebSocket`);
  };
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleMessage(message);
  };
  
  ws.onclose = (event) => {
    console.log(`Disconnected from ${wsType} WebSocket`);
    // Implement reconnection logic
  };
  
  ws.onerror = (error) => {
    console.error(`WebSocket error:`, error);
  };
  
  return ws;
}
```

**React Hook Example:**
```javascript
function useTokenDataWebSocket() {
  const [tokens, setTokens] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    let ws = null;
    let reconnectTimeout = null;
    let reconnectAttempts = 0;
    
    async function connect() {
      try {
        const { token } = await getWebSocketToken();
        ws = new WebSocket(`${WS_BASE_URL}/token-data`, token);
        
        ws.onopen = () => {
          setIsConnected(true);
          reconnectAttempts = 0;
        };
        
        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === 'tokens.update') {
            setTokens(message.data.tokens);
          }
        };
        
        ws.onclose = () => {
          setIsConnected(false);
          // Implement exponential backoff
          const delay = Math.min(1000 * (2 ** reconnectAttempts), 30000);
          reconnectTimeout = setTimeout(() => {
            reconnectAttempts++;
            connect();
          }, delay);
        };
        
        ws.onerror = (err) => {
          setError(err);
        };
      } catch (err) {
        setError(err);
      }
    }
    
    connect();
    
    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);
  
  return { tokens, isConnected, error };
}
```

### Authentication Integration

**Wallet Authentication Flow:**

1. **Request Challenge:**
```javascript
async function requestChallenge(walletAddress) {
  const response = await fetch(`${API_URL}/auth/challenge?wallet=${walletAddress}`);
  if (!response.ok) throw new Error('Failed to get challenge');
  return await response.json();
}
```

2. **Sign Challenge:**
```javascript
async function signChallenge(message) {
  // Using @solana/wallet-adapter-react
  const { signMessage } = useWallet();
  const messageBytes = new TextEncoder().encode(message);
  return await signMessage(messageBytes);
}
```

3. **Verify Signature:**
```javascript
async function verifyWallet(walletAddress, signature, message) {
  const response = await fetch(`${API_URL}/auth/verify-wallet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      wallet: walletAddress,
      signature: Array.from(signature),
      message
    }),
    credentials: 'include' // Important for cookies
  });
  
  if (!response.ok) throw new Error('Verification failed');
  return await response.json();
}
```

4. **Complete Authentication Flow:**
```javascript
async function authenticateWithWallet() {
  try {
    // Get wallet address
    const wallet = useWallet();
    if (!wallet.connected) {
      await wallet.connect();
    }
    
    // Request challenge
    const { nonce } = await requestChallenge(wallet.publicKey.toString());
    
    // Create message
    const message = `DegenDuel Authentication\nNonce: ${nonce}`;
    
    // Sign message
    const signature = await signChallenge(message);
    
    // Verify signature
    const { verified, user } = await verifyWallet(
      wallet.publicKey.toString(),
      signature,
      message
    );
    
    if (verified) {
      return { success: true, user };
    } else {
      return { success: false, error: 'Verification failed' };
    }
  } catch (error) {
    console.error('Authentication error:', error);
    return { success: false, error: error.message };
  }
}
```

---

## 📡 API Reference

### Authentication

**Challenge Request:**
```
GET /api/auth/challenge?wallet={wallet_address}
```
Response:
```json
{
  "success": true,
  "nonce": "a1b2c3d4e5f6g7h8i9j0"
}
```

**Wallet Verification:**
```
POST /api/auth/verify-wallet
```
Request:
```json
{
  "wallet": "your_solana_wallet_address",
  "signature": [array_of_signature_bytes],
  "message": "DegenDuel Authentication\nNonce: a1b2c3d4e5f6g7h8i9j0"
}
```
Response:
```json
{
  "success": true,
  "verified": true,
  "user": {
    "id": "123",
    "wallet": "your_solana_wallet_address",
    "nickname": "degen_123abc",
    "role": "user",
    "level": 5,
    "xp": 2500
  }
}
```

**Session Check:**
```
GET /api/auth/session
```
Response:
```json
{
  "success": true,
  "isAuthenticated": true,
  "user": {
    "id": "123",
    "wallet": "your_solana_wallet_address",
    "nickname": "degen_123abc",
    "role": "user"
  }
}
```

**Logout:**
```
POST /api/auth/logout
```
Response:
```json
{
  "success": true,
  "message": "Successfully logged out"
}
```

**WebSocket Token:**
```
GET /api/auth/token
```
Response:
```json
{
  "success": true,
  "token": "[REDACTED_JWT_HEADER]...",
  "expiresIn": 3600
}
```

### Users

**Get User Profile:**
```
GET /api/users/profile
```
Response:
```json
{
  "success": true,
  "user": {
    "id": "123",
    "wallet": "your_solana_wallet_address",
    "nickname": "degen_123abc",
    "role": "user",
    "level": 5,
    "xp": 2500,
    "createdAt": "2023-01-01T00:00:00Z",
    "achievements": {
      "count": 12,
      "recent": [
        { "id": "1", "name": "First Trade", "awardedAt": "2023-01-02T00:00:00Z" }
      ]
    }
  }
}
```

**Update Nickname:**
```
POST /api/users/nickname
```
Request:
```json
{
  "nickname": "crypto_king"
}
```
Response:
```json
{
  "success": true,
  "message": "Nickname updated successfully",
  "user": {
    "id": "123",
    "nickname": "crypto_king"
  }
}
```

**Get User Achievements:**
```
GET /api/users/{wallet}/achievements
```
Response:
```json
{
  "success": true,
  "achievements": [
    {
      "id": "1",
      "name": "First Trade",
      "description": "Complete your first trade",
      "category": "Trading",
      "tier": "Bronze",
      "awardedAt": "2023-01-02T00:00:00Z",
      "xpAwarded": 100
    }
  ],
  "stats": {
    "total": 12,
    "byCategory": {
      "Trading": 5,
      "Social": 3,
      "Contest": 4
    }
  }
}
```

### Contests

**List Active Contests:**
```
GET /api/contests
```
Response:
```json
{
  "success": true,
  "contests": [
    {
      "id": "contest_123",
      "name": "Weekend Warriors",
      "status": "active",
      "startTime": "2023-01-01T00:00:00Z",
      "endTime": "2023-01-03T00:00:00Z",
      "participantCount": 120,
      "prizePool": "1000 USDC",
      "entryFee": "10 USDC"
    }
  ]
}
```

**Get Contest Details:**
```
GET /api/contests/{contest_id}
```
Response:
```json
{
  "success": true,
  "contest": {
    "id": "contest_123",
    "name": "Weekend Warriors",
    "description": "Trade your way to the top over the weekend!",
    "status": "active",
    "startTime": "2023-01-01T00:00:00Z",
    "endTime": "2023-01-03T00:00:00Z",
    "participantCount": 120,
    "prizePool": "1000 USDC",
    "entryFee": "10 USDC",
    "rules": {
      "startingBalance": "10000 USDC",
      "maxLeverage": 1,
      "allowedTokens": ["SOL", "ETH", "BTC"]
    }
  }
}
```

**Get Contest Leaderboard:**
```
GET /api/contests/{contest_id}/leaderboard
```
Response:
```json
{
  "success": true,
  "leaderboard": [
    {
      "rank": 1,
      "userId": "user_456",
      "nickname": "moon_boy",
      "pnl": 42.5,
      "portfolioValue": 14250
    }
  ],
  "userRank": {
    "rank": 15,
    "pnl": 12.3,
    "portfolioValue": 11230
  }
}
```

**Join Contest:**
```
POST /api/contests/{contest_id}/join
```
Response:
```json
{
  "success": true,
  "message": "Successfully joined contest",
  "contestWallet": "contest_specific_wallet_address",
  "startingBalance": 10000
}
```

### Tokens

**List Available Tokens:**
```
GET /api/tokens
```
Response:
```json
{
  "success": true,
  "tokens": [
    {
      "id": "token_123",
      "symbol": "SOL",
      "name": "Solana",
      "address": "So11111111111111111111111111111111111111111",
      "logo": "https://assets.coingecko.com/coins/images/4128/small/solana.png",
      "price": 101.32,
      "priceChange24h": 3.45,
      "marketCap": 42000000000
    }
  ]
}
```

**Get Latest Token Market Data:**
```
GET /api/v2/tokens/marketData/latest
```
Response:
```json
{
  "success": true,
  "timestamp": 1672531200000,
  "tokens": [
    {
      "symbol": "SOL",
      "price": 101.32,
      "priceChange": {
        "1h": 0.5,
        "24h": 3.45,
        "7d": -2.1
      },
      "volume24h": 1500000000,
      "marketCap": 42000000000
    }
  ]
}
```

### Portfolio & Trading

**Execute Trade:**
```
POST /api/portfolio-trades
```
Request:
```json
{
  "contestId": "contest_123",
  "tokenSymbol": "SOL",
  "side": "buy",
  "amount": 10,
  "price": 101.32
}
```
Response:
```json
{
  "success": true,
  "trade": {
    "id": "trade_789",
    "contestId": "contest_123",
    "tokenSymbol": "SOL",
    "side": "buy",
    "amount": 10,
    "price": 101.32,
    "value": 1013.2,
    "timestamp": 1672531200000
  },
  "portfolio": {
    "balance": 8986.8,
    "positions": [
      {
        "tokenSymbol": "SOL",
        "amount": 10,
        "averagePrice": 101.32,
        "currentPrice": 101.32,
        "value": 1013.2,
        "pnl": 0
      }
    ]
  }
}
```

**Get Portfolio Analytics:**
```
GET /api/portfolio-analytics?contestId=contest_123
```
Response:
```json
{
  "success": true,
  "portfolio": {
    "totalValue": 11250.75,
    "cashBalance": 5000.25,
    "pnl": {
      "absolute": 1250.75,
      "percentage": 12.5
    },
    "positions": [
      {
        "tokenSymbol": "SOL",
        "amount": 50,
        "averagePrice": 100.25,
        "currentPrice": 110.5,
        "value": 5525,
        "pnl": {
          "absolute": 512.5,
          "percentage": 10.2
        }
      },
      {
        "tokenSymbol": "ETH",
        "amount": 0.5,
        "averagePrice": 1500,
        "currentPrice": 1451,
        "value": 725.5,
        "pnl": {
          "absolute": -24.5,
          "percentage": -3.3
        }
      }
    ],
    "history": [
      {
        "timestamp": 1672444800000,
        "value": 10000
      },
      {
        "timestamp": 1672531200000,
        "value": 10125.5
      },
      {
        "timestamp": 1672617600000,
        "value": 11250.75
      }
    ]
  }
}
```

### Admin

**System Status:**
```
GET /api/admin/system-reports
```
Response:
```json
{
  "success": true,
  "services": [
    {
      "name": "SolanaService",
      "status": "healthy",
      "uptime": 86400,
      "metrics": {
        "rpcCalls": 12500,
        "errors": 12,
        "avgResponseTime": 150
      }
    }
  ],
  "system": {
    "memory": {
      "total": 16384,
      "used": 8192,
      "free": 8192
    },
    "cpu": {
      "usage": 45
    },
    "uptime": 604800
  }
}
```

**Circuit Breaker Management:**
```
GET /api/admin/circuit-breaker
```
Response:
```json
{
  "success": true,
  "circuitBreakers": [
    {
      "service": "SolanaService",
      "status": "CLOSED",
      "failureCount": 0,
      "lastFailure": null,
      "resetAttempts": 0
    },
    {
      "service": "TokenSyncService",
      "status": "OPEN",
      "failureCount": 5,
      "lastFailure": "2023-01-01T12:34:56Z",
      "resetAttempts": 2
    }
  ]
}
```

### System

**Health Check:**
```
GET /api/health
```
Response:
```json
{
  "status": "OK",
  "version": "1.0.0",
  "environment": "production",
  "uptime": 86400,
  "services": {
    "database": "healthy",
    "solana": "healthy",
    "redis": "healthy"
  }
}
```

**Platform Status:**
```
GET /api/status
```
Response:
```json
{
  "success": true,
  "status": "operational",
  "maintenance": false,
  "countdown": {
    "active": false,
    "target": null
  },
  "activeUsers": 120,
  "activeContests": 3
}
```

---

## 🧵 WebSocket Protocol

### Token Data WebSocket

**Connection:**
```
wss://degenduel.me/api/v2/ws/token-data
```

**Subprotocol:**
- The WebSocket token obtained from `/api/auth/token`

**Messages:**

1. **Subscription:**
```json
{
  "type": "subscribe",
  "channel": "token.all"
}
```

2. **Token Update:**
```json
{
  "type": "tokens.update",
  "sequence": 1234,
  "timestamp": 1672531200000,
  "data": {
    "tokens": [
      {
        "symbol": "SOL",
        "price": 101.32,
        "priceChange": {
          "1h": 0.5,
          "24h": 3.45,
          "7d": -2.1
        }
      }
    ]
  }
}
```

3. **Token Metadata Update:**
```json
{
  "type": "tokens.metadata",
  "sequence": 1235,
  "timestamp": 1672531200000,
  "data": {
    "token": {
      "symbol": "SOL",
      "name": "Solana",
      "address": "So11111111111111111111111111111111111111111",
      "logo": "https://assets.coingecko.com/coins/images/4128/small/solana.png",
      "website": "https://solana.com"
    }
  }
}
```

### Portfolio WebSocket

**Connection:**
```
wss://degenduel.me/api/v2/ws/portfolio
```

**Subprotocol:**
- The WebSocket token obtained from `/api/auth/token`

**Messages:**

1. **Subscription:**
```json
{
  "type": "subscribe",
  "contestId": "contest_123"
}
```

2. **Portfolio Update:**
```json
{
  "type": "portfolio.update",
  "sequence": 5678,
  "timestamp": 1672531200000,
  "data": {
    "contestId": "contest_123",
    "portfolio": {
      "totalValue": 11250.75,
      "cashBalance": 5000.25,
      "pnl": {
        "absolute": 1250.75,
        "percentage": 12.5
      },
      "positions": [
        {
          "tokenSymbol": "SOL",
          "amount": 50,
          "averagePrice": 100.25,
          "currentPrice": 110.5,
          "value": 5525,
          "pnl": {
            "absolute": 512.5,
            "percentage": 10.2
          }
        }
      ]
    }
  }
}
```

3. **Trade Confirmation:**
```json
{
  "type": "trade.confirmed",
  "sequence": 5679,
  "timestamp": 1672531200000,
  "data": {
    "trade": {
      "id": "trade_789",
      "contestId": "contest_123",
      "tokenSymbol": "SOL",
      "side": "buy",
      "amount": 10,
      "price": 101.32,
      "value": 1013.2,
      "timestamp": 1672531200000
    }
  }
}
```

### Contest WebSocket

**Connection:**
```
wss://degenduel.me/api/v2/ws/contest
```

**Subprotocol:**
- The WebSocket token obtained from `/api/auth/token`

**Messages:**

1. **Subscription:**
```json
{
  "type": "subscribe",
  "contestId": "contest_123"
}
```

2. **Contest Update:**
```json
{
  "type": "contest.update",
  "sequence": 9012,
  "timestamp": 1672531200000,
  "data": {
    "contestId": "contest_123",
    "status": "active",
    "participantCount": 120,
    "timeRemaining": 86400
  }
}
```

3. **Leaderboard Update:**
```json
{
  "type": "contest.leaderboard",
  "sequence": 9013,
  "timestamp": 1672531200000,
  "data": {
    "contestId": "contest_123",
    "leaderboard": [
      {
        "rank": 1,
        "userId": "user_456",
        "nickname": "moon_boy",
        "pnl": 42.5,
        "portfolioValue": 14250
      }
    ],
    "userRank": {
      "rank": 15,
      "pnl": 12.3,
      "portfolioValue": 11230
    }
  }
}
```

4. **Chat Message:**
```json
{
  "type": "chat.message",
  "sequence": 9014,
  "timestamp": 1672531200000,
  "data": {
    "contestId": "contest_123",
    "message": {
      "id": "msg_123",
      "sender": {
        "id": "user_456",
        "nickname": "moon_boy"
      },
      "content": "Just made a killing on SOL!",
      "timestamp": 1672531200000
    }
  }
}
```

### Monitor WebSocket

**Connection:**
```
wss://degenduel.me/api/v2/ws/monitor
```

**Subprotocol:**
- The WebSocket token obtained from `/api/auth/token` (admin role required)

**Messages:**

1. **Subscription:**
```json
{
  "type": "subscribe",
  "channel": "system.health"
}
```

2. **System Health Update:**
```json
{
  "type": "system.health",
  "sequence": 3456,
  "timestamp": 1672531200000,
  "data": {
    "services": [
      {
        "name": "SolanaService",
        "status": "healthy",
        "uptime": 86400,
        "metrics": {
          "rpcCalls": 12500,
          "errors": 12,
          "avgResponseTime": 150
        }
      }
    ],
    "system": {
      "memory": {
        "total": 16384,
        "used": 8192,
        "free": 8192
      },
      "cpu": {
        "usage": 45
      },
      "uptime": 604800
    }
  }
}
```

3. **Circuit Breaker Update:**
```json
{
  "type": "circuit.update",
  "sequence": 3457,
  "timestamp": 1672531200000,
  "data": {
    "service": "TokenSyncService",
    "status": "OPEN",
    "failureCount": 5,
    "lastFailure": "2023-01-01T12:34:56Z",
    "resetAttempts": 2
  }
}
```

---

## 💾 Database Schema

### Core Data Models

The DegenDuel database schema includes the following key models:

**User System:**
- **users**: Central entity that stores wallet addresses, usernames, experience points
- **user_levels**: Progression system with requirements and titles
- **user_achievements**: Tracks achievements earned by users
- **achievement_categories/tiers**: Achievement classification system with tiered rewards

**Contest System:**
- **contests**: Core contest entity with scheduling, status, and prize details
- **contest_participants**: Links users to contests with performance tracking
- **contest_portfolios**: Stores token selections for each participant's portfolio
- **contest_token_performance**: Tracks profit/loss for each token in portfolios

**Token System:**
- **tokens**: Cryptocurrency token metadata and market data
- **token_prices**: Tracks token price information
- **token_buckets**: Categorizes tokens into logical groups

**Transaction System:**
- **transactions**: Records all financial activities in the platform
- **blockchain_transactions**: Tracks on-chain transactions
- **wallet_balance_history**: Historical record of wallet balances

**Referral System:**
- **referrals**: Tracks user referrals
- **referral_clicks**: Analytics for referral link interactions
- **referral_rewards**: Tracks rewards earned through referrals

**Service Management:**
- **circuit_breaker_states**: Tracks health of microservices
- **circuit_breaker_incidents**: Records service disruptions
- **system_settings**: Key-value store for application settings

### Schema Management

**Prisma Schema:**
The application uses Prisma ORM with a schema defined in `prisma/schema.prisma`.

**Schema Reconciliation:**
When schema validation errors occur (missing fields or mismatched types):

```bash
# Compare Prisma schema with database
npm run db:reconcile-ai

# Generate migration to fix differences
npm run db:reconcile-fix
```

**Migration Commands:**
```bash
# Create migration (development)
npx prisma migrate dev --name your_migration_name

# Apply migrations (production)
npx prisma migrate deploy
```

---

## 🧩 Service Framework

### Base Service Pattern

All services in DegenDuel extend the `BaseService` class with a consistent interface:

**Lifecycle Methods:**
- `initialize()`: Set up service dependencies and state
- `performOperation()`: Execute core service functionality
- `stop()`: Clean up resources and handle termination

**Standard Properties:**
- `name`: Unique service identifier
- `config`: Service-specific configuration
- `state`: Current operational state
- `metrics`: Performance and operational metrics
- `dependencies`: Array of service dependencies

**Error Handling:**
- `ServiceError` class for consistent error reporting
- Error propagation with contextual information
- Failure counting and thresholds

### Service Registration

Services are registered with the `ServiceManager` singleton:

```javascript
class YourService extends BaseService {
  constructor() {
    super('YourService', {
      // Service configuration
    });
  }
  
  async initialize() {
    // Register with service manager with dependencies
    await ServiceManager.register(this, ['DependencyService']);
    
    // Initialize state
    this.state = {
      initialized: true,
      lastOperation: Date.now()
    };
    
    return true;
  }
  
  async performOperation() {
    // Implement service-specific functionality
  }
  
  async stop() {
    // Clean up resources
  }
}
```

### Service Dependencies

**Dependency Declaration:**
- Services declare dependencies during registration
- ServiceManager validates dependency chains
- Initialization order respects dependencies

**Dependency Validation:**
```javascript
// Check if dependency is available and healthy
const dependencyService = await ServiceManager.getService('DependencyService');
if (!dependencyService || !dependencyService.isHealthy()) {
  throw new ServiceError('Dependency service unavailable');
}
```

**Circuit Breaker Integration:**
```javascript
try {
  // Attempt operation
  await this.someOperation();
} catch (error) {
  // Record failure and potentially open circuit
  this.recordFailure(error);
  
  // Check if circuit should open
  if (this.consecutiveFailures >= this.config.failureThreshold) {
    await this.openCircuit();
  }
  
  throw error;
}
```

---

## 🧪 Testing

### WebSocket Testing

DegenDuel includes dedicated tools for WebSocket testing:

```bash
# Test SkyDuel WebSocket
npm run ws skyduel <token>

# Test Token Data WebSocket
npm run ws token-data <token>

# Test Circuit Breaker WebSocket
npm run ws circuit-breaker <token>

# Test Monitor WebSocket
npm run ws monitor <token>
```

**WebSocket Test Client:**
The repository includes a WebSocket test client in `scripts/test-websocket.js` for manual testing.

### API Testing

**Postman Collection:**
A Postman collection is available for API testing, covering:
- Authentication flow
- User management
- Contest operations
- Trading functionality
- Admin controls

**Swagger Documentation:**
API endpoints are documented with Swagger at `/api-docs`.

---

## 📚 Additional Resources

- **Frontend Repository**: [degenduel-fe](https://github.com/BranchManager69/degenduel-fe)
- **Solana Token Metadata Guide**: `/docs_critical/token_metadata/solana_token_metadata_guide.md`
- **Service Architecture**: `/docs_important/Core Services/BASE_SERVICE_ARCHITECTURE.md`
- **WebSocket Specification**: `/docs_important/WEBSOCKET_SPEC.md`
- **Admin API Overview**: `/docs_important/ADMIN_API_OVERVIEW.md`

---

<div align="center">
  <h3>⚔️ DEGENDUEL ⚔️</h3>
  <p>Sharpen your trading skills while competing for real prizes. <br/>Ape and jeet with zero risk.</p>
  <p><b>© Branch Manager Productions.</b> All rights reserved.</p>
  <img src="https://img.shields.io/badge/WINTER-IS%20COMING-blue?style=for-the-badge" alt="Winter is Coming" />
</div>