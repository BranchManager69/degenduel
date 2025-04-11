# DegenDuel WebSocket API Documentation

## Overview

DegenDuel uses a unified WebSocket system for real-time updates. All WebSocket communication flows through a single connection point at `/api/v69/ws`, with topics used for message categorization.

## Server-Side Broadcasting Approaches

DegenDuel implements two complementary approaches for broadcasting WebSocket messages:

### 1. Service Events (Recommended for Service-to-WebSocket Communication)

Service events provide a decoupled way for services to trigger WebSocket broadcasts:

```javascript
import serviceEvents from '../utils/service-suite/service-events.js';

// Broadcasting through the service events system
serviceEvents.emit('topic:broadcast', {
  type: 'DATA',
  subtype: 'category',
  action: 'action',
  data: payload
});
```

**When to use Service Events:**
- When broadcasting from a service
- For simple topic-based broadcasting
- When you want loose coupling between services and the WebSocket layer
- For broadcasts that don't need persistence or targeted delivery

### 2. WSBroadcaster (Recommended for Advanced Broadcasting Features)

The WebSocket Broadcaster provides advanced features for direct broadcasts:

```javascript
import broadcaster from '../utils/websocket-suite/ws-broadcaster.js';

// Broadcasting with the dedicated WSBroadcaster utility
await broadcaster.broadcastToTopic(
  'topic',
  'category',
  'action',
  payload
);

// Or for targeting specific user roles
await broadcaster.broadcastToRole(
  'ADMIN',
  'category',
  'action',
  payload
);

// Or for targeting specific users by wallet address
await broadcaster.broadcastToUsers(
  ['wallet1', 'wallet2'],
  'category',
  'action',
  payload,
  { persist: true } // Store for offline delivery
);
```

**When to use WSBroadcaster:**
- When you need message persistence for offline users
- For role-based or user-targeted broadcasting
- When you need delivery tracking or read receipts
- For high-priority messages that should be stored in the database

## Connection

```javascript
const ws = new WebSocket(`wss://your-domain.com/api/v69/ws`);
```

## Message Structure

All messages follow this general format:

```typescript
interface WebSocketMessage {
  type: 'SUBSCRIBE' | 'UNSUBSCRIBE' | 'DATA' | 'ERROR' | 'SYSTEM' | 'ACKNOWLEDGMENT' | 'COMMAND' | 'REQUEST';
  topic?: string;
  subtype?: string;
  action?: string;
  data?: any;
  requestId?: string;
  timestamp: string;
}
```

## Authentication

Most topics require authentication. Authentication is handled automatically using your session cookie. If you're not authenticated, you'll receive an error message for restricted topics.

## Subscribing to Topics

To subscribe to topics:

```javascript
ws.send(JSON.stringify({
  type: 'SUBSCRIBE',
  topics: ['market-data', 'portfolio'],
  timestamp: new Date().toISOString()
}));
```

## Available Topics

### 1. market-data

Real-time market data for tokens.

**When it fires:**
- Initial connection
- Token price changes
- Volume updates
- Rank changes

**Message format:**
```typescript
{
  type: 'DATA',
  topic: 'market-data',
  data: {
    tokens: [
      {
        symbol: string;
        name: string;
        address: string;
        price: number;
        price_change_24h: number;
        volume_24h: number;
        market_cap: number;
        rank: number;
        last_updated: string;
      }
    ]
  },
  timestamp: string;
}
```

### 2. portfolio

Updates to a user's portfolio.

**When it fires:**
- Initial connection after subscribing
- User buys/sells tokens
- Portfolio value changes
- New tokens added to portfolio

**Message format:**
```typescript
{
  type: 'DATA',
  topic: 'portfolio',
  data: {
    total_value: number;
    total_profit_loss: number;
    profit_loss_percentage: number;
    holdings: [
      {
        token_address: string;
        symbol: string;
        amount: number;
        value_usd: number;
        profit_loss: number;
        profit_loss_percentage: number;
        last_updated: string;
      }
    ]
  },
  timestamp: string;
}
```

### 3. system

System-wide notifications and status updates.

**When it fires:**
- Service status changes
- Maintenance notifications
- Feature toggles
- System-wide announcements

**Message format:**
```typescript
{
  type: 'DATA',
  topic: 'system',
  subtype: 'status' | 'announcement' | 'maintenance' | 'feature',
  data: {
    status?: 'operational' | 'degraded' | 'maintenance' | 'outage';
    message?: string;
    affected_services?: string[];
    estimated_resolution?: string;
    features?: Record<string, boolean>;
  },
  timestamp: string;
}
```

### 4. contest

Updates about trading contests.

**When it fires:**
- Contest creation
- Contest status changes (registration, active, ended)
- Entry confirmation
- Leaderboard updates
- Results announcement

**Message format:**
```typescript
{
  type: 'DATA',
  topic: 'contest',
  subtype: 'update' | 'leaderboard' | 'entry' | 'result',
  data: {
    contest_id: string;
    status?: 'registration' | 'active' | 'ended';
    name?: string;
    start_time?: string;
    end_time?: string;
    prize_pool?: number;
    entry_count?: number;
    leaderboard?: {
      rankings: [
        {
          rank: number;
          user_id: string;
          nickname: string;
          profit_loss: number;
          profit_loss_percentage: number;
        }
      ]
    };
    entry_status?: 'confirmed' | 'rejected';
  },
  timestamp: string;
}
```

### 5. user

User-specific notifications and data.

**When it fires:**
- Achievement unlocked
- Level up
- Personal notifications
- Settings changes

**Message format:**
```typescript
{
  type: 'DATA',
  topic: 'user',
  subtype: 'achievement' | 'level' | 'notification' | 'settings',
  action?: 'update' | 'new' | 'delete',
  data: {
    user_id?: string;
    achievement?: {
      id: string;
      name: string;
      description: string;
      reward: any;
    };
    level?: {
      current: number;
      previous: number;
      xp: number;
      xp_required: number;
      rewards: any[];
    };
    notification?: {
      id: string;
      title: string;
      message: string;
      read: boolean;
      category: string;
    };
    settings?: Record<string, any>;
  },
  timestamp: string;
}
```

### 6. admin

Admin-only notifications and commands.

**When it fires:**
- Admin actions are performed
- System alerts needing admin attention
- Error reports and summaries

**Message format:**
```typescript
{
  type: 'DATA',
  topic: 'admin',
  subtype: 'alert' | 'error' | 'system',
  action?: string,
  data: {
    severity?: 'info' | 'warning' | 'error' | 'critical';
    message?: string;
    source?: string;
    details?: any;
    error?: {
      message: string;
      stack?: string;
      source?: string;
    };
  },
  timestamp: string;
}
```

### 7. wallet

Wallet transaction updates.

**When it fires:**
- Transaction initiated
- Transaction status changes
- New transaction detected
- Wallet settings changes

**Message format:**
```typescript
{
  type: 'DATA',
  topic: 'wallet',
  subtype: 'transaction' | 'settings',
  action?: 'initiated' | 'confirmed' | 'failed',
  data: {
    wallet_address?: string;
    transaction?: {
      id: string;
      type: 'send' | 'receive' | 'swap' | 'stake' | 'unstake';
      status: 'pending' | 'confirmed' | 'failed';
      amount: number;
      token: string;
      timestamp: string;
      signature?: string;
      from?: string;
      to?: string;
    };
    settings?: {
      auto_approve?: boolean;
      spending_limit?: number;
    };
  },
  timestamp: string;
}
```

### 8. wallet-balance

Updates to wallet balances.

**When it fires:**
- Balance changes detected
- Initial connection after subscribing
- Regular balance sync

**Message format:**
```typescript
{
  type: 'DATA',
  topic: 'wallet-balance',
  data: {
    wallet_address: string;
    sol_balance: number;
    tokens: [
      {
        address: string;
        symbol: string;
        balance: number;
        value_usd?: number;
      }
    ]
  },
  timestamp: string;
}
```

### 9. skyduel

Game state and events for SkyDuel.

**When it fires:**
- Game state changes
- Player moves
- Scoring events
- Game results

**Message format:**
```typescript
{
  type: 'DATA',
  topic: 'skyduel',
  subtype: 'state' | 'move' | 'score' | 'result',
  data: {
    game_id: string;
    state?: 'waiting' | 'active' | 'ended';
    players?: {
      id: string;
      nickname: string;
      position: [number, number];
      score: number;
      status: 'alive' | 'eliminated';
    }[];
    move?: {
      player_id: string;
      direction: 'up' | 'down' | 'left' | 'right';
      position: [number, number];
    };
    score_event?: {
      player_id: string;
      points: number;
      reason: string;
    };
    result?: {
      winner_id: string;
      final_scores: Record<string, number>;
      rewards: Record<string, any>;
    };
  },
  timestamp: string;
}
```

### 10. terminal

Terminal data for command-line interface.

**When it fires:**
- Initial connection after subscribing
- Terminal data updates from admin
- New commands available

**Message format:**
```typescript
{
  type: 'DATA',
  topic: 'terminal',
  subtype: 'terminal',
  action: 'update' | 'initial',
  data: {
    platformName: string;
    platformDescription: string;
    platformStatus: string;
    stats: {
      currentUsers: number;
      upcomingContests: number;
      totalPrizePool: string;
      platformTraffic: string;
      socialGrowth: string;
      waitlistUsers: number;
    };
    token: {
      symbol: string;
      address: string;
      totalSupply: string;
      initialCirculating: string;
      communityAllocation: string;
      teamAllocation: string;
      treasuryAllocation: string;
      initialPrice: string;
      marketCap: string;
      networkType: string;
      tokenType: string;
      decimals: number;
    };
    launch: {
      method: string;
      platforms: string[];
      privateSaleStatus: string;
      publicSaleStatus: string;
    };
    roadmap: Array<{
      quarter: string;
      year: string;
      title: string;
      details: string[];
    }>;
    commands: Record<string, string>;
  },
  timestamp: string;
}
```

## Sending Commands and Requests

### Commands

Commands change system state:

```javascript
ws.send(JSON.stringify({
  type: 'COMMAND',
  topic: 'wallet',
  action: 'send',
  data: {
    to: 'wallet-address',
    amount: 0.1,
    token: 'SOL'
  },
  timestamp: new Date().toISOString()
}));
```

### Requests

Requests fetch data without changing state:

```javascript
ws.send(JSON.stringify({
  type: 'REQUEST',
  topic: 'user',
  action: 'getProfile',
  requestId: 'req-123',  // Use to correlate responses
  timestamp: new Date().toISOString()
}));
```

## Error Handling

Error messages follow this format:

```typescript
{
  type: 'ERROR',
  code: number,  // e.g., 4001, 4010, 5000
  message: string,
  timestamp: string
}
```

Common error codes:
- 4000-4099: General client errors
- 4100-4199: Authentication errors
- 4200-4299: Subscription errors
- 4300-4399: Command errors
- 5000-5099: Server errors

## Heartbeats

The server sends periodic heartbeats to keep connections alive:

```typescript
{
  type: 'SYSTEM',
  action: 'heartbeat',
  timestamp: string
}
```

Clients should respond with a heartbeat response or risk disconnection.

## Best Practices

1. Always handle reconnection scenarios
2. Subscribe to only the topics you need
3. Implement exponential backoff for reconnection attempts
4. Add error handling for all message types
5. Correlate request/response using requestId
6. Handle connection closure gracefully