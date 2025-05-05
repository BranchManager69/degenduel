# Comprehensive DegenDuel Shared Types Proposal (V2)

This proposal defines a comprehensive set of shared types using the `DD` prefix naming convention to standardize interfaces between frontend and backend.

## Core WebSocket Types

```typescript
/**
 * Available WebSocket message topics
 */
export enum DDWebSocketTopic {
  MARKET_DATA = 'market-data',
  PORTFOLIO = 'portfolio',
  SYSTEM = 'system',
  CONTEST = 'contest', 
  USER = 'user',
  ADMIN = 'admin',
  WALLET = 'wallet',
  WALLET_BALANCE = 'wallet-balance',
  SKYDUEL = 'skyduel',
  TERMINAL = 'terminal',
  LOGS = 'logs'
}

/**
 * WebSocket message types for client-server communication
 */
export enum DDWebSocketMessageType {
  // Client -> Server messages
  SUBSCRIBE = 'SUBSCRIBE',
  UNSUBSCRIBE = 'UNSUBSCRIBE',
  REQUEST = 'REQUEST',
  COMMAND = 'COMMAND',
  
  // Server -> Client messages
  DATA = 'DATA',
  ERROR = 'ERROR',
  SYSTEM = 'SYSTEM',
  ACKNOWLEDGMENT = 'ACKNOWLEDGMENT'
}

/**
 * Base WebSocket message interface
 * All WebSocket messages extend this interface
 */
export interface DDWebSocketMessage {
  type: DDWebSocketMessageType;
  requestId?: string;
  timestamp?: number;
}

/**
 * Client subscription message
 */
export interface DDWebSocketSubscribeMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.SUBSCRIBE;
  topics: DDWebSocketTopic[];
  auth?: string; // Optional auth token for authenticated topics
}

/**
 * Client unsubscribe message
 */
export interface DDWebSocketUnsubscribeMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.UNSUBSCRIBE;
  topics: DDWebSocketTopic[];
}

/**
 * Client request message for specific data
 */
export interface DDWebSocketRequestMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.REQUEST;
  topic: DDWebSocketTopic;
  action: string;
  params?: Record<string, any>;
}

/**
 * Client command message to perform an action
 */
export interface DDWebSocketCommandMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.COMMAND;
  topic: DDWebSocketTopic;
  command: string;
  params?: Record<string, any>;
}

/**
 * Server data message with payload
 */
export interface DDWebSocketDataMessage<T = any> extends DDWebSocketMessage {
  type: DDWebSocketMessageType.DATA;
  topic: DDWebSocketTopic;
  data: T;
}

/**
 * Server error message
 */
export interface DDWebSocketErrorMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.ERROR;
  topic?: DDWebSocketTopic;
  error: string;
  code: number;
}

/**
 * Server system message
 */
export interface DDWebSocketSystemMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.SYSTEM;
  topic: DDWebSocketTopic.SYSTEM;
  action: string;
  data?: any;
}

/**
 * Server acknowledgment message
 */
export interface DDWebSocketAcknowledgmentMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.ACKNOWLEDGMENT;
  topic: DDWebSocketTopic;
  requestId: string;
  success: boolean;
  message?: string;
}
```

## Topic-Specific WebSocket Data Types

```typescript
/**
 * Market data message payload
 */
export interface DDMarketDataPayload {
  tokenAddress: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h?: number;
  marketCap?: number;
  lastUpdate: number;
}

/**
 * Portfolio data message payload
 */
export interface DDPortfolioPayload {
  walletAddress: string;
  totalValue: number;
  tokens: Array<{
    tokenAddress: string;
    symbol: string;
    quantity: string;
    value: number;
    weight: number;
  }>;
  lastUpdate: number;
}

/**
 * Contest data message payload
 */
export interface DDContestPayload {
  id: string;
  code: string;
  name: string;
  startTime: number;
  endTime: number;
  status: DDContestStatus;
  participants: number;
  maxParticipants: number;
  entryFee: number;
  prizePool: number;
  lastUpdate: number;
}

/**
 * Wallet balance data message payload
 */
export interface DDWalletBalancePayload {
  walletAddress: string;
  sol: number;
  tokens: Array<{
    tokenAddress: string;
    symbol: string;
    balance: string;
    valueUsd?: number;
  }>;
  lastUpdate: number;
}

/**
 * User data message payload
 */
export interface DDUserPayload {
  walletAddress: string;
  nickname: string;
  achievementPoints: number;
  level: number;
  experience: number;
  contestsEntered: number;
  contestsWon: number;
  lastUpdate: number;
}

/**
 * Terminal data message payload
 */
export interface DDTerminalPayload {
  commandId: string;
  output: string;
  status: 'running' | 'completed' | 'error';
  progress?: number;
  error?: string;
  lastUpdate: number;
}
```

## Core Entity Types

```typescript
/**
 * User role enum
 */
export enum DDUserRole {
  USER = 'user',
  ADMIN = 'admin',
  SUPERADMIN = 'superadmin'
}

/**
 * Basic user interface
 */
export interface DDUser {
  id: string;
  walletAddress: string;
  nickname: string;
  role: DDUserRole;
  email?: string;
  createdAt: number;
  profileImage?: string;
  level: number;
  xp: number;
  achievementPoints: number;
}

/**
 * Contest status enum
 */
export enum DDContestStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

/**
 * Trade type enum
 */
export enum DDTradeType {
  BUY = 'buy',
  SELL = 'sell'
}

/**
 * Basic token interface
 */
export interface DDToken {
  id: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price: number;
  change24h: number;
  volume24h?: number;
  marketCap?: number;
  totalSupply?: string;
  circulatingSupply?: string;
  rank?: number;
  tags?: string[];
  lastUpdated: number;
}

/**
 * Enhanced token with additional fields
 */
export interface DDTokenDetailed extends DDToken {
  logoUrl?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
  discordUrl?: string;
  description?: string;
  holders?: number;
  createdAt?: number;
  isVerified?: boolean;
  priceHistory?: DDPricePoint[];
  pools?: DDTokenPool[];
}

/**
 * Price history point
 */
export interface DDPricePoint {
  timestamp: number;
  price: number;
}

/**
 * Token pool information
 */
export interface DDTokenPool {
  id: string;
  address: string;
  dex: string;
  pairWith: string;
  liquidity: number;
  volume24h?: number;
  priceImpact?: number;
}

/**
 * Basic contest interface
 */
export interface DDContest {
  id: string;
  contestCode: string;
  name: string;
  description?: string;
  imageUrl?: string;
  startTime: number;
  endTime: number;
  entryFee: number;
  prizePool: number;
  currentPrizePool: number;
  status: DDContestStatus;
  minParticipants: number;
  maxParticipants?: number;
  participantCount: number;
  allowedBuckets: number[];
  visibility: 'public' | 'private';
  createdAt: number;
  createdBy?: string;
}

/**
 * Contest participant interface
 */
export interface DDContestParticipant {
  contestId: string;
  walletAddress: string;
  joinedAt: number;
  initialDxdPoints: number;
  currentDxdPoints: number;
  initialBalance: number;
  portfolioValue: number;
  rank?: number;
  finalRank?: number;
  prizeAmount?: number;
  prizePaidAt?: number;
  status: string;
}

/**
 * Portfolio trade interface
 */
export interface DDPortfolioTrade {
  id: string;
  contestId: string;
  walletAddress: string;
  tokenId: string;
  tokenSymbol: string;
  tokenName: string;
  type: DDTradeType;
  oldWeight: number;
  newWeight: number;
  priceAtTrade: number;
  virtualAmount: string;
  executedAt: number;
}
```

## Transaction and Wallet Types

```typescript
/**
 * Transaction type enum
 */
export enum DDTransactionType {
  PRIZE_PAYOUT = 'PRIZE_PAYOUT',
  CONTEST_WALLET_RAKE = 'CONTEST_WALLET_RAKE',
  CONTEST_ENTRY = 'CONTEST_ENTRY',
  TOKEN_PURCHASE = 'TOKEN_PURCHASE',
  TOKEN_SALE = 'TOKEN_SALE',
  WITHDRAWAL = 'WITHDRAWAL',
  DEPOSIT = 'DEPOSIT'
}

/**
 * Transaction status enum
 */
export enum DDTransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

/**
 * Transaction interface
 */
export interface DDTransaction {
  id: string;
  transactionType: DDTransactionType;
  status: DDTransactionStatus;
  amount: number;
  walletAddress: string;
  signature?: string;
  createdAt: number;
  completedAt?: number;
  failedAt?: number;
  failureReason?: string;
  relatedEntityId?: string; // Contest ID, etc.
  relatedEntityType?: string; // 'contest', etc.
}

/**
 * Wallet balance interface
 */
export interface DDWalletBalance {
  walletAddress: string;
  sol: number;
  tokens: DDTokenBalance[];
  totalValueUsd?: number;
  lastUpdated: number;
}

/**
 * Token balance in a wallet
 */
export interface DDTokenBalance {
  tokenAddress: string;
  symbol: string;
  balance: string;
  decimals: number;
  valueUsd?: number;
}

/**
 * RPC URLs configuration
 */
export interface DDRpcUrls {
  primary: string;
  mainnet_http: string;
  mainnet_wss: string;
  devnet_http: string;
  devnet_wss: string;
}
```

## API Response Types

```typescript
/**
 * Standard API response format
 */
export interface DDApiResponse<T = any> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
  error?: any;
  code?: number;
  timestamp: number;
}

/**
 * Paginated API response format
 */
export interface DDPaginatedResponse<T = any> extends DDApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * API error response
 */
export interface DDApiError {
  status: 'error';
  message: string;
  code: number;
  details?: any;
  timestamp: number;
}
```

## Service Event Types

```typescript
/**
 * Service event types for internal pub/sub
 */
export enum DDServiceEventType {
  TOKEN_UPDATED = 'token:updated',
  TOKEN_CREATED = 'token:created',
  TOKEN_PRICE_CHANGED = 'token:price:changed',
  CONTEST_CREATED = 'contest:created',
  CONTEST_UPDATED = 'contest:updated',
  CONTEST_STARTED = 'contest:started',
  CONTEST_ENDED = 'contest:ended',
  CONTEST_CANCELLED = 'contest:cancelled',
  USER_JOINED_CONTEST = 'user:joined:contest',
  TRADE_EXECUTED = 'trade:executed',
  WALLET_BALANCE_UPDATED = 'wallet:balance:updated',
  SYSTEM_ALERT = 'system:alert'
}

/**
 * Basic service event payload
 */
export interface DDServiceEvent<T = any> {
  type: DDServiceEventType;
  data: T;
  timestamp: number;
}
```

## System and Configuration Types

```typescript
/**
 * System service status
 */
export interface DDServiceStatus {
  serviceName: string;
  status: 'active' | 'inactive' | 'error' | 'circuit_broken';
  lastHeartbeat: number;
  uptime: number;
  errorCount: number;
  circuitBreakerStatus?: {
    isOpen: boolean;
    failureCount: number;
    lastFailure: number;
    resetTimeout: number;
  };
  metrics?: Record<string, any>;
}

/**
 * System settings interface
 */
export interface DDSystemSettings {
  maintenance: {
    enabled: boolean;
    message: string;
    allowedRoles: DDUserRole[];
    startTime?: number;
    endTime?: number;
  };
  websocketConfig: {
    maxPayload: number;
    perMessageDeflate: boolean;
  };
  contestCreation: {
    enabled: boolean;
    minEntryFee: number;
    maxEntryFee: number;
    minPrizePool: number;
    maxPrizePool: number;
  };
  tokenRefresh: {
    interval: number;
    priorities: {
      high: number;
      medium: number;
      low: number;
    };
  };
}
```

This comprehensive type system covers all major aspects of the DegenDuel application with a consistent `DD` prefix naming convention, with particular emphasis on the WebSocket system, which is now fully defined with proper type safety.

## Benefits

1. **Type Safety**: Clear interfaces between frontend and backend
2. **Documentation**: Types serve as living documentation of data structures
3. **Consistency**: Unified naming with DD prefix for easy recognition
4. **Developer Experience**: Improved autocomplete and error checking
5. **Maintainability**: Centralized type definitions reduce duplication

## Implementation Plan

1. Add these types to the `degenduel-shared` package incrementally
2. Start with the WebSocket types which provide immediate value
3. Gradually adopt these types in both frontend and backend code
4. Create wrapper functions to convert between internal and shared types