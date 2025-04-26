// config/external-api/dexscreener-config.js

import config from '../config.js';

/**
 * DexScreener API configuration
 * Documentation: https://docs.dexscreener.com/api/reference
 */

const DEXSCREENER_API_KEY = config.api_keys?.dexscreener || '';

// Base URLs for different DexScreener API endpoints
const DEXSCREENER_BASE_URL = 'https://api.dexscreener.com';
const LATEST_API_URL = `${DEXSCREENER_BASE_URL}/latest`;
const TOKEN_PROFILES_URL = `${DEXSCREENER_BASE_URL}/token-profiles/latest/v1`;
const TOKEN_BOOSTS_URL = `${DEXSCREENER_BASE_URL}/token-boosts`;
const ORDERS_URL = `${DEXSCREENER_BASE_URL}/orders/v1`;
const TOKEN_PAIRS_URL = `${DEXSCREENER_BASE_URL}/token-pairs/v1`;

// Specific API endpoints
const endpoints = {
  // Token profiles endpoints
  tokenProfiles: {
    getLatest: TOKEN_PROFILES_URL,
  },
  
  // Token boosts endpoints
  tokenBoosts: {
    getLatest: `${TOKEN_BOOSTS_URL}/latest/v1`,
    getTop: `${TOKEN_BOOSTS_URL}/top/v1`,
  },
  
  // Orders endpoints
  orders: {
    getByToken: (chainId, tokenAddress) => `${ORDERS_URL}/${chainId}/${tokenAddress}`,
  },
  
  // Pairs endpoints
  pairs: {
    getByPair: (chainId, pairId) => `${LATEST_API_URL}/dex/pairs/${chainId}/${pairId}`,
    search: `${LATEST_API_URL}/dex/search`,
  },
  
  // Token pairs endpoints
  tokenPairs: {
    getPoolsByToken: (chainId, tokenAddress) => `${TOKEN_PAIRS_URL}/${chainId}/${tokenAddress}`,
  },
};

// Headers for API requests
const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  ...(DEXSCREENER_API_KEY ? { 'Authorization': `Bearer ${DEXSCREENER_API_KEY}` } : {})
});

// Rate limiting configuration based on documentation
const rateLimit = {
  // Standard rate limit (60 req/min) - 1 req per second
  standardEndpoints: {
    maxRequestsPerMinute: 58, // Keep slightly under the limit to be safe (58 instead of 60)
    delayBetweenRequests: 50, // Much more aggressive - only 50ms between requests
    endpoints: [
      'tokenProfiles.getLatest',
      'tokenBoosts.getLatest',
      'tokenBoosts.getTop',
      'orders.getByToken'
    ]
  },
  
  // Enhanced rate limit (300 req/min) - 5 req per second
  enhancedEndpoints: {
    maxRequestsPerMinute: 290, // Keep slightly under the limit to be safe (290 instead of 300)
    delayBetweenRequests: 20, // Extremely aggressive - only 20ms between requests
    endpoints: [
      'pairs.getByPair',
      'pairs.search',
      'tokenPairs.getPoolsByToken'
    ]
  },
  
  // Common configuration
  batchingEnabled: true,
  batchFailureBackoffMs: 1000, // Reduce from 2000ms to 1000ms
  maxBackoffMs: 10000, // Reduce from 60000ms to 10000ms - more aggressive retry
  backoffFactor: 1.5, // Less aggressive backoff factor
};

// Export the DexScreener configuration
export const dexscreenerConfig = {
  apiKey: DEXSCREENER_API_KEY,
  baseUrl: DEXSCREENER_BASE_URL,
  latestApiUrl: LATEST_API_URL,
  tokenProfilesUrl: TOKEN_PROFILES_URL,
  tokenBoostsUrl: TOKEN_BOOSTS_URL,
  ordersUrl: ORDERS_URL,
  tokenPairsUrl: TOKEN_PAIRS_URL,
  endpoints,
  getHeaders,
  rateLimit,
  isConfigured: !!DEXSCREENER_API_KEY,
};

export default dexscreenerConfig;