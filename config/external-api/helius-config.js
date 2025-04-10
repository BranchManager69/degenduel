// config/external-api/helius-config.js

import config from '../config.js';

/**
 * Helius API configuration for token and NFT data
 * Documentation: https://docs.helius.xyz/api-reference/
 */

const HELIUS_API_KEY = config.api_keys?.helius || '';

if (!HELIUS_API_KEY) {
  console.warn('⚠️  WARNING: Helius API key is not configured. Some token data features may not work correctly.');
}

// Base URLs for different Helius API endpoints
const HELIUS_BASE_URL = 'https://api.helius.xyz';
const HELIUS_RPC_URL = process.env.SOLANA_MAINNET_HTTP || process.env.SOLANA_RPC_ENDPOINT || `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const HELIUS_WEBHOOK_URL = `${HELIUS_BASE_URL}/v0/webhooks`;

// Specific API endpoints
const endpoints = {
  // Token API endpoints
  tokens: {
    getTokenMetadata: `${HELIUS_BASE_URL}/v0/tokens?api-key=${HELIUS_API_KEY}`,
    getCollections: `${HELIUS_BASE_URL}/v0/token-metadata/collections?api-key=${HELIUS_API_KEY}`,
    // Add additional token endpoints as needed
  },
  
  // Webhook endpoints
  webhooks: {
    create: `${HELIUS_WEBHOOK_URL}?api-key=${HELIUS_API_KEY}`,
    get: `${HELIUS_WEBHOOK_URL}?api-key=${HELIUS_API_KEY}`,
    update: `${HELIUS_WEBHOOK_URL}?api-key=${HELIUS_API_KEY}`,
    delete: `${HELIUS_WEBHOOK_URL}?api-key=${HELIUS_API_KEY}`,
    // Add additional webhook endpoints as needed
  },

  // DAS (Digital Asset Standard) API endpoints
  das: {
    getAsset: `${HELIUS_RPC_URL}`,
    searchAssets: `${HELIUS_RPC_URL}`,
    getAssetBatch: `${HELIUS_RPC_URL}`,
    // Add additional DAS endpoints as needed
  }
};

// Configuration for WebSocket connections
const websocket = {
  enabled: true,
  reconnectInterval: 5000, // Reconnect interval in ms
  maxReconnectAttempts: 10,
  url: process.env.SOLANA_MAINNET_WSS || `wss://mainnet.helius-rpc.com/v0?api-key=${HELIUS_API_KEY}`,
};

// Rate limiting configuration
const rateLimit = {
  maxRequestsPerSecond: 100, // Default rate limit (adjust based on your plan)
  delayBetweenRequests: 10, // ms between requests
};

// Export the Helius configuration
export const heliusConfig = {
  apiKey: HELIUS_API_KEY,
  baseUrl: HELIUS_BASE_URL,
  rpcUrl: HELIUS_RPC_URL,
  endpoints,
  websocket,
  rateLimit,
  isConfigured: !!HELIUS_API_KEY,
};

export default heliusConfig;