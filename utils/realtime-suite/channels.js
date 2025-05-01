/**
 * @file Predefined channels for the realtime system
 * @description Standardized channel names to ensure consistency
 */

// Token-related channels
export const TOKEN_CHANNELS = {
  PRICE: 'token:price',
  METADATA: 'token:metadata',
  RANK: 'token:rank',
  VOLUME: 'token:volume',
  LIQUIDITY: 'token:liquidity',
  DISCOVERY: 'token:discovery',
  POOL: 'token:pool'
};

// Contest-related channels
export const CONTEST_CHANNELS = {
  STATUS: 'contest:status',
  PARTICIPANT: 'contest:participant',
  PORTFOLIO: 'contest:portfolio',
  TRADE: 'contest:trade',
  PRIZES: 'contest:prizes',
  CREATION: 'contest:creation'
};

// User-related channels
export const USER_CHANNELS = {
  BALANCE: 'user:balance',
  ACHIEVEMENT: 'user:achievement',
  LEVEL: 'user:level',
  LOGIN: 'user:login',
  PROFILE: 'user:profile'
};

// System-related channels
export const SYSTEM_CHANNELS = {
  STATUS: 'system:status',
  HEARTBEAT: 'system:heartbeat',
  SHUTDOWN: 'system:shutdown',
  ERROR: 'system:error',
  MAINTENANCE: 'system:maintenance'
};

// Service-related channels
export const SERVICE_CHANNELS = {
  STATUS: 'service:status',
  TOKEN_SYNC: 'service:token-sync',
  CONTEST_WALLET: 'service:contest-wallet',
  ADMIN_WALLET: 'service:admin-wallet',
  BALANCE_TRACKING: 'service:balance-tracking',
  TOKEN_ENRICHMENT: 'service:token-enrichment',
  AI_SERVICE: 'service:ai'
};

// WebSocket-related channels (for internal use)
export const WEBSOCKET_CHANNELS = {
  BROADCAST: 'ws:broadcast',
  CONNECTION: 'ws:connection',
  DISCONNECTION: 'ws:disconnection',
  METRICS: 'ws:metrics'
};

// Export all channels as a convenience
export const channels = {
  ...TOKEN_CHANNELS,
  ...CONTEST_CHANNELS,
  ...USER_CHANNELS,
  ...SYSTEM_CHANNELS,
  ...SERVICE_CHANNELS,
  ...WEBSOCKET_CHANNELS
};