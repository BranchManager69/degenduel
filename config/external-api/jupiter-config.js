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
const JUPITER_BASE_URL = 'https://quote-api.jup.ag';
const JUPITER_V6_BASE_URL = 'https://quote-api.jup.ag/v6';
const JUPITER_PRICE_API_URL = 'https://price.jup.ag/v6';

// Specific API endpoints
const endpoints = {
  // Price API endpoints
  price: {
    getPrices: `${JUPITER_PRICE_API_URL}/price`,
    getPrice: (mintAddress) => `${JUPITER_PRICE_API_URL}/price?ids=${mintAddress}`,
    getPriceHistory: (mintAddress) => `${JUPITER_PRICE_API_URL}/price-history?ids=${mintAddress}`,
  },
  
  // Quote API endpoints
  quote: {
    getQuote: `${JUPITER_V6_BASE_URL}/quote`,
    getSwap: `${JUPITER_V6_BASE_URL}/swap`,
  },
  
  // Token API endpoints
  tokens: {
    getTokens: `${JUPITER_V6_BASE_URL}/tokens`,
    getTokenMap: `${JUPITER_V6_BASE_URL}/tokens-map`,
  },
  
  // Indexed routes API endpoints
  indexedRoutes: {
    getIndexedRouteMap: `${JUPITER_V6_BASE_URL}/indexed-route-map`,
  },
};

// Configuration for WebSocket connections
const websocket = {
  enabled: true,
  reconnectInterval: 5000, // Reconnect interval in ms
  maxReconnectAttempts: 10,
  priceUrl: 'wss://price.jup.ag/v6/ws',
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
  v6BaseUrl: JUPITER_V6_BASE_URL,
  priceApiUrl: JUPITER_PRICE_API_URL,
  endpoints,
  websocket,
  getHeaders,
  rateLimit,
  isConfigured: !!JUPITER_API_KEY,
};

export default jupiterConfig;