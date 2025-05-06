/**
 * WebSocket Type Definitions for DegenDuel
 * 
 * This file contains shared type definitions for WebSocket communication
 * between the frontend and backend systems.
 */

/**
 * WebSocket Topics
 * Used to organize messages by functional area
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
 * WebSocket Message Types
 * Used to categorize the purpose of each message
 */
export enum DDWebSocketMessageType {
  // Client -> Server messages
  SUBSCRIBE = 'SUBSCRIBE',
  UNSUBSCRIBE = 'UNSUBSCRIBE',
  REQUEST = 'REQUEST',
  COMMAND = 'COMMAND',
  
  // Server -> Client messages
  DATA = 'DATA',
  RESPONSE = 'RESPONSE',
  ERROR = 'ERROR',
  SYSTEM = 'SYSTEM',
  ACKNOWLEDGMENT = 'ACKNOWLEDGMENT'
}

/**
 * WebSocket Action Names
 * Standard action names for client requests and server responses
 */
export enum DDWebSocketActions {
  // MARKET_DATA topic actions
  GET_TOKENS = 'getTokens',
  GET_TOKEN = 'getToken',
  
  // USER topic actions
  GET_PROFILE = 'getProfile',
  
  // LOGS topic actions
  SEND_CLIENT_LOG = 'sendClientLog',
  
  // SYSTEM topic actions
  GET_STATUS = 'getStatus',
  GET_SETTINGS = 'getSettings',
  STATUS_UPDATE = 'status_update',
  
  // WALLET topic actions with transaction subtype
  GET_TRANSACTIONS = 'getTransactions',
  GET_TRANSACTION = 'getTransaction',
  
  // WALLET topic actions with settings subtype
  UPDATE_SETTINGS = 'updateSettings',
  
  // WALLET_BALANCE topic actions
  GET_SOLANA_BALANCE = 'getSolanaBalance',
  GET_TOKEN_BALANCE = 'getTokenBalance',
  GET_WALLET_BALANCE = 'getWalletBalance',
  GET_BALANCE = 'getBalance',
  REFRESH_TOKEN_BALANCE = 'refreshTokenBalance',
  TOKEN_BALANCE_UPDATE = 'tokenBalanceUpdate',
  
  // TERMINAL topic actions
  GET_DATA = 'getData',
  UPDATE = 'update',
  
  // CONTEST topic actions
  GET_CONTESTS = 'getContests',
  GET_CONTEST = 'getContest',
  CREATE_CONTEST = 'createContest',
  JOIN_CONTEST = 'joinContest',
  GET_CONTEST_SCHEDULES = 'getContestSchedules',
  GET_USER_CONTESTS = 'getUserContests',
  UPDATE_CONTEST = 'updateContest',
  CANCEL_CONTEST = 'cancelContest',
  START_CONTEST = 'startContest',
  END_CONTEST = 'endContest',
  
  // ADMIN topic actions
  GET_SYSTEM_STATUS = 'getSystemStatus',
  
  // Subscription actions for all topics
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe'
}

/**
 * Base WebSocket Message Interface
 */
export interface DDWebSocketMessage {
  type: DDWebSocketMessageType;
  topic: DDWebSocketTopic;
  timestamp?: string;
  subtype?: string;
}

/**
 * WebSocket Request Message Interface
 * Used for messages from client to server
 */
export interface DDWebSocketRequestMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.REQUEST | DDWebSocketMessageType.COMMAND;
  action: DDWebSocketActions;
  data?: any;
  requestId?: string;
}

/**
 * WebSocket Response Message Interface
 * Used for server responses to client requests
 */
export interface DDWebSocketResponseMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.RESPONSE;
  action: DDWebSocketActions;
  data: any;
  requestId?: string;
}

/**
 * WebSocket Data Message Interface
 * Used for pushed data from server to client
 */
export interface DDWebSocketDataMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.DATA;
  action?: DDWebSocketActions;
  data: any;
}

/**
 * WebSocket Subscription Message Interface
 * Used for subscribing to topics
 */
export interface DDWebSocketSubscriptionMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.SUBSCRIBE | DDWebSocketMessageType.UNSUBSCRIBE;
  data?: {
    parameters?: any;
  }
}

/**
 * WebSocket Error Message Interface
 * Used for error responses
 */
export interface DDWebSocketErrorMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.ERROR;
  error: string;
  code: number;
  requestId?: string;
}

/**
 * WebSocket Acknowledgment Message Interface
 * Used for acknowledging subscription requests
 */
export interface DDWebSocketAcknowledgmentMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.ACKNOWLEDGMENT;
  action: DDWebSocketActions;
  data: any;
  requestId?: string;
}

/**
 * WebSocket System Message Interface
 * Used for system-level notifications
 */
export interface DDWebSocketSystemMessage extends DDWebSocketMessage {
  type: DDWebSocketMessageType.SYSTEM;
  data: any;
}