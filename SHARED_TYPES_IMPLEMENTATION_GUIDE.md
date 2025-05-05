# DegenDuel Shared Types Implementation Guide

This document provides a step-by-step guide for implementing the new shared types with the `DD` prefix into the `degenduel-shared` package.

## Overview

We've created three implementation files that define all the shared types using the `DD` prefix naming convention:

1. `websocket-types-implementation.ts` - WebSocket message types and payloads
2. `entity-types-implementation.ts` - Core entity types (User, Token, Contest, etc.)
3. `api-transaction-types-implementation.ts` - API response and transaction types

These types should be organized in separate files in the shared package for better maintainability.

## Implementation Steps

### Step 1: Update the Shared Package Structure

```bash
# Navigate to the shared package
cd ../degenduel-shared

# Create directories for organizing the types
mkdir -p src/types
```

### Step 2: Create the Type Files

Create the following type files:

#### File: `src/types/websocket.ts`
Copy the contents from `websocket-types-implementation.ts`

#### File: `src/types/entities.ts`
Copy the contents from `entity-types-implementation.ts`

#### File: `src/types/api.ts`
Copy the contents from `api-transaction-types-implementation.ts`

### Step 3: Update the Main Index File

Update `src/index.ts` to export all the types:

```typescript
// Export all shared types and utilities

// Re-export all types from their respective files
export * from './types/websocket';
export * from './types/entities';
export * from './types/api';

// Keep the existing interfaces for backward compatibility
// but mark them as deprecated for future removal

/** @deprecated Use DDUser instead */
export interface User {
  id: string;
  username: string;
  wallet?: string;
  createdAt: Date;
}

/** @deprecated Use DDToken instead */
export interface Token {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
}

/** @deprecated Use DDContest instead */
export interface Contest {
  id: string;
  name: string;
  startTime: Date;
  endTime: Date;
  status: ContestStatus;
  participants: number;
  prize: number;
}

/** @deprecated Use DDContestStatus instead */
export enum ContestStatus {
  UPCOMING = 'upcoming',
  ACTIVE = 'active',
  ENDED = 'ended',
  CANCELED = 'canceled'
}

// Shared utilities
export function formatTokenPrice(price: number): string {
  return price < 0.01 
    ? price.toExponential(2) 
    : price.toLocaleString('en-US', { 
        style: 'currency', 
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 
      });
}

/** @deprecated Use DDApiResponse instead */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

/** @deprecated Use DDWebSocketMessage instead */
export interface WsMessage<T = any> {
  type: string;
  topic: string;
  data: T;
  timestamp: number;
}
```

### Step 4: Build the Package

```bash
# Build the package
npm run build
```

### Step 5: Update Consumers

After implementing the shared types, both backend and frontend projects will need to update their imports to use the new types.

#### Backend Example:

```typescript
// Before
import { WsMessage } from 'degenduel-shared';

// After
import { DDWebSocketMessage, DDWebSocketTopic, DDWebSocketMessageType } from 'degenduel-shared';
```

#### Frontend Example:

```typescript
// Before
import { Token, Contest } from 'degenduel-shared';

// After
import { DDToken, DDTokenDetailed, DDContest } from 'degenduel-shared';
```

## Implementation Strategy

To minimize disruption, consider the following approach:

1. **Add but don't remove**: Keep the old types temporarily but mark them as deprecated
2. **Incremental adoption**: Start by using the WebSocket types first, as those provide the most immediate value
3. **Coordinate with frontend**: Ensure frontend team is aware of the changes and ready to adopt the new types
4. **Migration timeline**: Set a timeline for complete migration to the new types, after which the old ones can be removed

## Benefits

This implementation provides:

1. **Type safety**: Clear interfaces between frontend and backend
2. **Documentation**: Types serve as living documentation of data structures
3. **Consistency**: Unified naming with `DD` prefix for easy recognition
4. **Developer Experience**: Improved autocomplete and error checking
5. **Maintainability**: Centralized type definitions reduce duplication

## Usage Examples

### WebSocket Message Handling

```typescript
import { 
  DDWebSocketMessage, 
  DDWebSocketTopic, 
  DDWebSocketMessageType,
  DDWebSocketDataMessage, 
  DDMarketDataPayload 
} from 'degenduel-shared';

// Create a market data message
const message: DDWebSocketDataMessage<DDMarketDataPayload> = {
  type: DDWebSocketMessageType.DATA,
  topic: DDWebSocketTopic.MARKET_DATA,
  data: {
    tokenAddress: '123abc...',
    symbol: 'BTC',
    name: 'Bitcoin',
    price: 65000,
    change24h: 2.5,
    volume24h: 1000000000,
    marketCap: 1200000000000,
    lastUpdate: Date.now()
  },
  timestamp: Date.now()
};
```

### API Response Handling

```typescript
import { DDApiResponse, DDToken } from 'degenduel-shared';

// Function that returns tokens with proper typing
async function getTokens(): Promise<DDApiResponse<DDToken[]>> {
  // API call logic
  return {
    status: 'success',
    data: tokens,
    timestamp: Date.now()
  };
}
```

### Entity Usage

```typescript
import { DDUser, DDUserRole } from 'degenduel-shared';

// Create a user object
const user: DDUser = {
  id: '12345',
  walletAddress: '123abc...',
  nickname: 'CryptoDegen',
  role: DDUserRole.USER,
  createdAt: Date.now(),
  level: 5,
  xp: 1000,
  achievementPoints: 250
};
```