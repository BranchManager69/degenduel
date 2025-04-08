// config/external-api/jupiter-config.js

import config from '../config.js';

/**
 * Jupiter API configuration for market data and swap functionality
 * Documentation: https://docs.jup.ag/
 */

const JUPITER_API_KEY = config.api_keys?.jupiter || '';

if (!JUPITER_API_KEY) {
  console.warn('⚠️  WARNING: Jupiter API key is not configured. Some market data features may not work correctly.');
}

// Base URLs for different Jupiter API endpoints
// Updated per March 2025 API Gateway changes
const API_KEY = JUPITER_API_KEY ? 'api' : 'lite-api'; // Use api.jup.ag for pro/paid users, lite-api.jup.ag for free users
const JUPITER_BASE_URL = `https://${API_KEY}.jup.ag`;
const JUPITER_SWAP_API_URL = `${JUPITER_BASE_URL}/swap/v1`;
const JUPITER_PRICE_API_URL = `${JUPITER_BASE_URL}/price/v2`;
const JUPITER_TOKEN_API_URL = `${JUPITER_BASE_URL}/tokens/v1`;

// Specific API endpoints
const endpoints = {
  // Price API endpoints
  price: {
    getPrices: `${JUPITER_PRICE_API_URL}`,
    getPrice: (mintAddress) => `${JUPITER_PRICE_API_URL}?ids=${mintAddress}`,
    getPriceHistory: (mintAddress) => `${JUPITER_PRICE_API_URL}/history?ids=${mintAddress}`,
  },
  
  // Swap API endpoints (updated from old Quote API)
  quote: {
    getQuote: `${JUPITER_SWAP_API_URL}/quote`,
    getSwap: `${JUPITER_SWAP_API_URL}/swap`,
  },
  
  // Token API endpoints
  tokens: {
    getTokens: `${JUPITER_TOKEN_API_URL}/mints/tradable`, // Updated from tokens to mints/tradable
    getToken: (mintAddress) => `${JUPITER_TOKEN_API_URL}/token/${mintAddress}`,
    getTaggedTokens: (tag) => `${JUPITER_TOKEN_API_URL}/tagged/${tag}`,
  },
};

// Configuration for WebSocket connections
// Note: Jupiter no longer provides a WebSocket API for price data
const websocket = {
  enabled: false,
  reconnectInterval: 5000, // Reconnect interval in ms
  maxReconnectAttempts: 10,
  priceUrl: null,
};

// Headers for API requests
const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': JUPITER_API_KEY ? `Bearer ${JUPITER_API_KEY}` : undefined,
});

// Rate limiting configuration
const rateLimit = {
  maxRequestsPerSecond: 50, // Default rate limit (adjust based on your plan)
  delayBetweenRequests: 20, // ms between requests
};

// Export the Jupiter configuration
export const jupiterConfig = {
  apiKey: JUPITER_API_KEY,
  baseUrl: JUPITER_BASE_URL,
  swapApiUrl: JUPITER_SWAP_API_URL,
  priceApiUrl: JUPITER_PRICE_API_URL,
  tokenApiUrl: JUPITER_TOKEN_API_URL,
  endpoints,
  websocket,
  getHeaders,
  rateLimit,
  isConfigured: !!JUPITER_API_KEY,
  usingFreeEndpoint: !JUPITER_API_KEY, // Track whether we're using the free endpoint
};

export default jupiterConfig;