// Implementation for ../degenduel-shared/src/websocket-types.ts

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

/**
 * Contest status enum
 * Used in the contest payloads
 */
export enum DDContestStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}