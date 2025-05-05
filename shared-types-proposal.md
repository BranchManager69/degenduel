# Proposed Types for Shared Package

After analyzing the codebase, here are the key types that would be valuable to add to the shared package:

## User Role Type

```typescript
/**
 * User role types that match the Prisma schema
 */
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  SUPERADMIN = 'superadmin'
}
```

## Config Types

```typescript
/**
 * RPC URL configuration structure
 */
export interface RpcUrls {
  primary: string;
  mainnet_http: string;
  mainnet_wss: string;
  devnet_http: string;
  devnet_wss: string;
}

/**
 * Transaction type constants
 */
export enum TransactionType {
  PRIZE_PAYOUT = 'prize_payout',
  CONTEST_WALLET_RAKE = 'contest_wallet_rake',
  CONTEST_ENTRY = 'contest_entry',
  TOKEN_PURCHASE = 'token_purchase',
  TOKEN_SALE = 'token_sale',
  WITHDRAWAL = 'withdrawal',
  DEPOSIT = 'deposit'
}

/**
 * Transaction status constants
 */
export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed'
}
```

## Enhanced Token Type

The existing Token interface could be expanded to better match our backend data:

```typescript
/**
 * Enhanced token interface with more details from backend
 */
export interface TokenDetails extends Token {
  address: string;
  mintAddress: string;
  decimals: number;
  marketCap?: number;
  volume24h?: number;
  totalSupply?: string;
  circulatingSupply?: string;
  socialLinks?: {
    website?: string;
    twitter?: string;
    telegram?: string;
    discord?: string;
  };
  pools?: TokenPool[];
  priceHistory?: PricePoint[];
  lastUpdated: Date;
  tags?: string[];
}

export interface TokenPool {
  id: string;
  dex: string;
  address: string;
  liquidity: number;
  pairWith: string;
}

export interface PricePoint {
  timestamp: Date;
  price: number;
}
```

## Contest Types

Enhancing the existing Contest type to better match our backend:

```typescript
/**
 * Enhanced contest interface with more backend details
 */
export interface ContestDetails extends Contest {
  contestCode: string;
  description?: string;
  imageUrl?: string;
  entryFee: number;
  prizePool: number;
  currentPrizePool: number;
  minParticipants: number;
  maxParticipants?: number;
  visibility: 'public' | 'private';
  createdBy?: string;
  allowedBuckets: number[];
}

/**
 * Contest participant information
 */
export interface ContestParticipant {
  contestId: string;
  walletAddress: string;
  joinedAt: Date;
  initialDxdPoints: number;
  currentDxdPoints: number;
  rank?: number;
  finalRank?: number;
  portfolioValue: number;
  initialBalance: number;
  status: string;
}

/**
 * Portfolio trade information
 */
export interface PortfolioTrade {
  contestId: string;
  walletAddress: string;
  tokenId: string;
  type: 'buy' | 'sell';
  oldWeight: number;
  newWeight: number;
  priceAtTrade: number;
  virtualAmount: number;
  executedAt: Date;
}
```

## WebSocket Message Types

Enhancing the existing WsMessage type with more specific message types:

```typescript
/**
 * WebSocket subscription message
 */
export interface WsSubscribeMessage {
  type: 'SUBSCRIBE';
  topics: string[];
  auth?: string;
}

/**
 * WebSocket data request message
 */
export interface WsRequestMessage {
  type: 'REQUEST';
  topic: string;
  action: string;
  params?: Record<string, any>;
  requestId?: string;
}

/**
 * WebSocket token data update
 */
export interface WsTokenUpdateMessage {
  type: 'TOKEN_UPDATE';
  data: TokenDetails;
}

/**
 * WebSocket contest update
 */
export interface WsContestUpdateMessage {
  type: 'CONTEST_UPDATE';
  data: ContestDetails;
}
```

## Base Service Response Type

```typescript
/**
 * Standard API response format
 */
export interface ServiceResponse<T = any> {
  success: boolean;
  status: 'success' | 'error' | 'warning';
  message?: string;
  data?: T;
  error?: any;
  code?: number;
  timestamp: number;
}
```

These types would provide a strong foundation for consistent data structures between backend and frontend.