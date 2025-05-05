// Implementation for ../degenduel-shared/src/entity-types.ts

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
 * Contest status enum
 */
export enum DDContestStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
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