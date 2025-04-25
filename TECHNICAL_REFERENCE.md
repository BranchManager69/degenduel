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

> **Technical Reference: The Definitive Guide**

# 📚 TECHNICAL REFERENCE

## Table of Contents

- [🔐 Environment Configuration](#-environment-configuration)
  - [Environment Variables](#environment-variables)
  - [PM2 Configuration](#pm2-configuration)
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
- [🔒 Authentication System](#-authentication-system)
  - [Authentication Methods](#authentication-methods)
  - [Authentication Flow](#authentication-flow)
  - [Security Features](#security-features)
- [🔔 Token Monitoring](#-token-monitoring)
  - [Features](#features)
  - [Configuration](#configuration)
  - [Discord Integration](#discord-integration)

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

**Unified WebSocket Connection:**
```javascript
async function connectToUnifiedWebSocket() {
  // Get authentication token
  const { token } = await getWebSocketToken();
  
  // Connect to unified WebSocket
  const ws = new WebSocket(`${WS_BASE_URL}/api/v69/ws`);
  
  // Set up event handlers
  ws.onopen = () => {
    console.log('Connected to unified WebSocket');
    
    // Subscribe to public topics
    ws.send(JSON.stringify({
      type: 'SUBSCRIBE',
      topics: ['market-data', 'system']
    }));
    
    // Subscribe to authenticated topics
    ws.send(JSON.stringify({
      type: 'SUBSCRIBE',
      topics: ['portfolio', 'user'],
      authToken: token
    }));
  };
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleMessage(message);
  };
  
  ws.onclose = (event) => {
    console.log('Disconnected from unified WebSocket');
    // Implement reconnection logic
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
  
  return ws;
}

// Handle different message types
function handleMessage(message) {
  switch (message.type) {
    case 'DATA':
      handleDataMessage(message);
      break;
    case 'SYSTEM':
      handleSystemMessage(message);
      break;
    case 'ERROR':
      handleErrorMessage(message);
      break;
    case 'ACKNOWLEDGMENT':
      console.log(`${message.operation} acknowledged for topics:`, message.topics);
      break;
  }
}
```

**React Hook Example:**
```javascript
function useMarketDataWebSocket() {
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
        ws = new WebSocket(`${WS_BASE_URL}/api/v69/ws`);
        
        ws.onopen = () => {
          setIsConnected(true);
          reconnectAttempts = 0;
          
          // Subscribe to market data
          ws.send(JSON.stringify({
            type: 'SUBSCRIBE',
            topics: ['market-data']
          }));
        };
        
        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          
          if (message.type === 'DATA' && message.topic === 'market-data') {
            setTokens(message.data);
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

DegenDuel has migrated to a unified WebSocket system that handles all real-time communications through a single WebSocket connection.

### Unified WebSocket System (v69)

**Connection:**
```
wss://degenduel.me/api/v69/ws
```

**Authentication:**
- Include auth token when subscribing to restricted topics

**Available Topics:**
- `market-data`: Real-time token price and market updates
- `portfolio`: User portfolio information and updates
- `system`: System-wide notifications and events
- `contest`: Contest information and leaderboard updates
- `user`: User profile and statistics
- `admin`: Administrative functions (requires admin role)
- `wallet`: Wallet information and transactions
- `skyduel`: SkyDuel game data

**Message Types:**
- Client to Server: `SUBSCRIBE`, `UNSUBSCRIBE`, `REQUEST`, `COMMAND`
- Server to Client: `DATA`, `ERROR`, `SYSTEM`, `ACKNOWLEDGMENT`

**Basic Usage Example:**

```javascript
// Connect to WebSocket
const socket = new WebSocket('wss://degenduel.me/api/v69/ws');

// Subscribe to public topics
socket.send(JSON.stringify({
  type: 'SUBSCRIBE',
  topics: ['market-data', 'system']
}));

// Subscribe to restricted topics (with auth)
socket.send(JSON.stringify({
  type: 'SUBSCRIBE',
  topics: ['portfolio', 'user'],
  authToken: 'your-jwt-token'
}));

// Request specific data
socket.send(JSON.stringify({
  type: 'REQUEST',
  topic: 'market-data',
  action: 'getToken',
  symbol: 'SOL',
  requestId: '123'
}));
```

**WebSocket Message Structure (Client to Server):**

Subscription:
```json
{
  "type": "SUBSCRIBE",
  "topics": ["market-data", "system"],
  "authToken": "optional-jwt-token"
}
```

Unsubscription:
```json
{
  "type": "UNSUBSCRIBE",
  "topics": ["portfolio"]
}
```

Data Request:
```json
{
  "type": "REQUEST",
  "topic": "market-data",
  "action": "getToken",
  "symbol": "SOL",
  "requestId": "abc123"
}
```

Command:
```json
{
  "type": "COMMAND",
  "topic": "admin",
  "action": "restartService",
  "service": "SolanaService",
  "authToken": "admin-jwt-token",
  "requestId": "cmd123"
}
```

**WebSocket Message Structure (Server to Client):**

Data:
```json
{
  "type": "DATA",
  "topic": "market-data",
  "data": {
    "tokens": [
      {
        "symbol": "SOL",
        "price": 101.32
      }
    ]
  },
  "timestamp": 1672531200000
}
```

Error:
```json
{
  "type": "ERROR",
  "code": "AUTH_REQUIRED",
  "message": "Authentication required for this topic",
  "requestId": "abc123"
}
```

System:
```json
{
  "type": "SYSTEM",
  "event": "maintenance",
  "message": "System maintenance in 5 minutes",
  "data": {
    "maintenanceStart": 1672531200000,
    "estimatedDuration": 300000
  }
}
```

Acknowledgment:
```json
{
  "type": "ACKNOWLEDGMENT",
  "operation": "SUBSCRIBE",
  "topics": ["market-data"],
  "requestId": "abc123"
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
- **monitored_tokens**: Tracks tokens being monitored for buys/sells

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

The Unified WebSocket system can be tested directly from your browser's DevTools console:

```javascript
// Connect to the Unified WebSocket
const socket = new WebSocket('wss://degenduel.me/api/v69/ws');

// Log all messages
socket.onmessage = (event) => {
  console.log('Received:', JSON.parse(event.data));
};

// Log connection events
socket.onopen = () => console.log('Connected');
socket.onclose = () => console.log('Disconnected');
socket.onerror = (error) => console.error('Error:', error);

// Helper function to send messages
function sendWS(data) {
  socket.send(JSON.stringify(data));
}

// Example: Subscribe to market data
sendWS({
  type: 'SUBSCRIBE',
  topics: ['market-data']
});
```

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

## 🔒 Authentication System

### Authentication Methods

DegenDuel supports multiple authentication methods in a unified system:

#### Authentication Methods

DegenDuel supports multiple authentication methods:

1. **Web3 Wallet Authentication** (Primary Method)
   - Direct wallet connection and signature
   - Used for account creation and login
   - Endpoint: `/api/auth/verify-wallet`

2. **Privy Authentication** (Primary/Secondary Method)
   - Email, social login, or passkeys through Privy
   - Can create accounts (if `auto_create_accounts=true`) or link to existing ones
   - Endpoints: 
     - `/api/auth/verify-privy` - Login/registration
     - `/api/auth/link-privy` - Account linking

3. **Twitter Authentication** (Secondary Method)
   - Social authentication via Twitter
   - Only for linking to existing accounts (no direct registration)
   - Endpoints:
     - `/api/auth/twitter/login` - Start Twitter OAuth
     - `/api/auth/twitter/callback` - OAuth callback
     - `/api/auth/twitter/link` - Link Twitter to existing account
     
4. **Biometric Authentication** (Upcoming - In Development)
   - Fingerprint/Face ID authentication using WebAuthn
   - Includes custodial wallet generation for users
   - Creates server-managed wallets for users without existing wallets
   - Endpoints (planned):
     - `/api/auth/register-biometric` - Register new device
     - `/api/auth/biometric-challenge` - Generate challenge
     - `/api/auth/verify-biometric` - Verify biometric auth

#### Authentication Status

All authentication methods are tracked through the unified status endpoint:
- `/api/auth/status` - Returns comprehensive auth status

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     DegenDuel Platform                      │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Authentication Methods                    │
└───────┬─────────────────────┬─────────────────────┬─────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│  Web3 Wallet  │     │     Privy     │     │    Twitter    │
│ Authentication│     │ Authentication│     │ Authentication│
└───────┬───────┘     └───────┬───────┘     └───────┬───────┘
        │                     │                     │
        │ /verify-wallet      │ /verify-privy       │ /twitter/login
        │                     │                     │ /twitter/callback
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   Authentication Verification                │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ JWT Token + Cookie
                            │ Session Creation
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Account Check                           │
└───────┬─────────────────────────────────────┬───────────────┘
        │                                     │
        │ Account Exists                      │ No Account
        │                                     │
        ▼                                     ▼
┌───────────────────┐                 ┌───────────────────┐
│                   │                 │   Create Account?  │
│     Log In        │                 │                   │
│                   │                 │  Web3 ✓  Privy ✓  │
│                   │                 │  Twitter ✗        │
└───────┬───────────┘                 └─────────┬─────────┘
        │                                       │
        │                                       │ If allowed
        │                                       │ (auto_create=true for Privy)
        │                                       │
        │                                       ▼
        │                             ┌───────────────────┐
        │                             │                   │
        │                             │  Create Account   │
        │                             │                   │
        │                             └─────────┬─────────┘
        │                                       │
        └───────────────────┬───────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Authenticated User                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ Optional: Link Additional
                            │ Authentication Methods
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Account Linking Options                     │
├───────────────────────────┬─────────────────────────────────┤
│                           │                                 │
│  /link-privy              │  /twitter/link                 │
│  Link Privy Account       │  Link Twitter Account          │
│                           │                                 │
└───────────────────────────┴─────────────────────────────────┘
```

#### Authentication Method Comparison

| Feature              | Web3 Wallet | Privy         | Twitter      | Biometric (Planned) |
|----------------------|-------------|---------------|--------------|---------------------|
| Account Creation     | ✓ Yes       | ✓ Yes*        | ✗ No         | ✓ Yes‡              |
| Login to Account     | ✓ Yes       | ✓ Yes         | ✓ Yes        | ✓ Yes               |
| Link to Account      | N/A         | ✓ Yes         | ✓ Yes        | ✓ Yes               |
| Required for Account | ✓ Yes**     | ✓ Optional**  | ✗ No         | ✓ Optional**        |
| Custodial Wallet     | ✗ No        | ✗ No          | ✗ No         | ✓ Yes               |
| Device-Specific      | ✗ No        | Varies†       | ✗ No         | ✓ Yes               |

\* *Privy can create accounts if `auto_create_accounts=true` in config*  
\** *One of: Web3 Wallet, Privy, or Biometric is required for account creation*  
\† *Privy can use passkeys which are device-specific, but also supports email which is not*  
\‡ *Creates a custodial wallet managed by DegenDuel*

### Security Features

- HTTP-only cookies
- Secure flag in production
- SameSite cookie policy
- Wallet address validation
- Signature verification
- Input validation
- JWT tokens with expiration

---

## 🔔 Token Monitoring

The platform includes a powerful token monitoring system that tracks purchases and sales of specified tokens in real-time.

### Features

- **Real-time Transaction Monitoring**: Watch for token buys and sells as they happen using Helius WebSockets
- **Customizable Thresholds**: Set minimum transaction values to filter out noise
- **Token Selection**: Monitor any Solana token by adding it to the database
- **Event System**: Standardized events for token purchases and sales
- **Discord Integration**: Instant notifications in Discord channels

### Configuration

To monitor specific tokens:

1. **Add a token to the monitored_tokens table**
   ```sql
   INSERT INTO monitored_tokens (
     token_address, token_name, token_symbol, decimals,
     monitor_buys, monitor_sells, min_transaction_value
   ) VALUES (
     'TOKEN_ADDRESS_HERE',
     'Token Name',
     'SYMBOL',
     9,
     TRUE,
     TRUE,
     0
   );
   ```

2. **Configure Discord webhook URL in environment variables**
   ```
   DISCORD_WEBHOOK_TOKENS=https://discord.com/api/webhooks/your_webhook_url
   ```

3. **Enable tokenMonitorService in config.js**
   ```javascript
   get token_monitor() {
     return true;
   }
   ```

### Discord Integration

Token monitor integrates with Discord to send real-time alerts:

**Buy Alert Example:**
```
⬆️ BUY: 250,000 SOL ($25,330.00)
📈 Token: Solana (SOL)
💰 Value: $25,330.00 USD
🔄 Transaction: https://solscan.io/tx/2ZEUyGkMHG5...
⏰ Time: 2023-01-01 12:34:56 UTC
```

**Sell Alert Example:**
```
⬇️ SELL: 120,000 SOL ($12,158.40)
📉 Token: Solana (SOL)
💰 Value: $12,158.40 USD
🔄 Transaction: https://solscan.io/tx/7HJKLyGkMHG5...
⏰ Time: 2023-01-01 13:45:01 UTC
```