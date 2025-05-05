// Implementation for ../degenduel-shared/src/api-transaction-types.ts

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