// services/solana-engine/jupiter-client.js

import axios from 'axios';
import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceSpecificColors, fancyColors } from '../../utils/colors.js';
import { jupiterConfig } from '../../config/external-api/jupiter-config.js';
import redisManager from '../../utils/redis-suite/redis-manager.js';

// Formatting helpers for consistent logging
const formatLog = {
  tag: () => `${serviceSpecificColors.jupiterClient.tag}[jupiterClient]${fancyColors.RESET}`,
  header: (text) => `${serviceSpecificColors.jupiterClient.header} ${text} ${fancyColors.RESET}`,
  success: (text) => `${serviceSpecificColors.jupiterClient.success}${text}${fancyColors.RESET}`,
  warning: (text) => `${serviceSpecificColors.jupiterClient.warning}${text}${fancyColors.RESET}`,
  error: (text) => `${serviceSpecificColors.jupiterClient.error}${text}${fancyColors.RESET}`,
  info: (text) => `${serviceSpecificColors.jupiterClient.info}${text}${fancyColors.RESET}`,
  highlight: (text) => `${serviceSpecificColors.jupiterClient.highlight}${text}${fancyColors.RESET}`,
  token: (symbol) => `${serviceSpecificColors.jupiterClient.token}${symbol || ''}${fancyColors.RESET}`,
  price: (price) => `${serviceSpecificColors.jupiterClient.price}${price || 0}${fancyColors.RESET}`,
  count: (num) => `${serviceSpecificColors.jupiterClient.count}${Number(num) || 0}${fancyColors.RESET}`,
};

/**
 * Base class for Jupiter API modules
 */
class JupiterBase {
  constructor(config, redisKeyPrefix) {
    this.config = config;
    this.redisKeyPrefix = redisKeyPrefix || 'jupiter:';
  }

  /**
   * Make a request to Jupiter API
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data (for POST)
   * @param {Object} params - Query parameters (for GET)
   * @returns {Promise<any>} - Response data
   */
  async makeRequest(method, endpoint, data = null, params = null) {
    try {
      const options = {
        method,
        url: endpoint,
        headers: this.config.getHeaders(),
        timeout: 15000 // 15 second timeout
      };

      if (data) options.data = data;
      if (params) options.params = params;

      const response = await axios(options);
      
      if (!response.data) {
        throw new Error('Invalid response from Jupiter API');
      }
      
      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to fetch from Jupiter API (${endpoint}):`)} ${errorMessage}`);
      throw error;
    }
  }
}

/**
 * Token List service module
 */
class TokenListService extends JupiterBase {
  constructor(config) {
    super(config, 'jupiter:token:');
  }

  /**
   * Fetch token list
   */
  async fetchTokenList() {
    try {
      // Fetch token list from Jupiter API
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} token list from Jupiter API`);
      
      const response = await this.makeRequest('GET', this.config.endpoints.tokens.getTokens);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Fetched token list with')} ${formatLog.count(response?.length || 0)} tokens`);
      return response;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch token list:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a map of mint address to token info for quick lookups
   * @param {Array} tokenList - List of tokens
   * @returns {Object} - Map of mint address to token info
   */
  createTokenMap(tokenList) {
    return tokenList.reduce((map, token) => {
      map[token.address] = token;
      return map;
    }, {});
  }
}

/**
 * Price service module
 */
class PriceService extends JupiterBase {
  constructor(config) {
    super(config, 'jupiter:token:prices:');
    
    // Polling configuration
    this.pollingInterval = null;
    this.pollingFrequency = 30000; // Poll every 30 seconds by default
    this.priceUpdateCallbacks = [];
    this.subscriptions = new Map();
  }

  /**
   * Start polling for price updates for subscribed tokens
   */
  startPolling() {
    if (this.pollingInterval) {
      return; // Already polling
    }
    
    if (this.subscriptions.size === 0) {
      return; // No tokens to poll for
    }
    
    logApi.info(`${formatLog.tag()} ${formatLog.header('STARTING')} price polling for ${formatLog.count(this.subscriptions.size)} tokens`);
    
    this.pollingInterval = setInterval(async () => {
      try {
        const tokens = Array.from(this.subscriptions.keys());
        const priceData = await this.getPrices(tokens);
        
        // Notify callbacks with the price data
        this.notifyPriceUpdateCallbacks(priceData);
      } catch (error) {
        logApi.error(`${formatLog.tag()} ${formatLog.error('Price polling failed:')} ${error.message}`);
      }
    }, this.pollingFrequency);
  }

  /**
   * Stop polling for price updates
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      logApi.info(`${formatLog.tag()} ${formatLog.header('STOPPED')} price polling`);
    }
  }

  /**
   * Notify all registered callbacks about price updates
   * @param {Object} priceData - Price data from Jupiter API
   */
  notifyPriceUpdateCallbacks(priceData) {
    if (this.priceUpdateCallbacks.length === 0) {
      return;
    }
    
    for (const callback of this.priceUpdateCallbacks) {
      try {
        callback(priceData);
      } catch (error) {
        logApi.error(`${formatLog.tag()} ${formatLog.error('Error in price update callback:')} ${error.message}`);
      }
    }
  }

  /**
   * Register a callback function for price updates
   * @param {Function} callback - Function to call when prices are updated
   * @returns {Function} - Function to unregister the callback
   */
  onPriceUpdate(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    
    this.priceUpdateCallbacks.push(callback);
    logApi.info(`${formatLog.tag()} ${formatLog.success('Registered new price update callback')}`);
    
    return () => {
      this.priceUpdateCallbacks = this.priceUpdateCallbacks.filter(cb => cb !== callback);
      logApi.info(`${formatLog.tag()} ${formatLog.success('Unregistered price update callback')}`);
    };
  }

  /**
   * Subscribe to price updates for specified tokens
   * This adds tokens to the subscription list and starts polling
   * @param {string[]} mintAddresses - Array of token mint addresses to subscribe to
   * @returns {boolean} - Success status
   */
  async subscribeToPrices(mintAddresses) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} to prices for ${formatLog.count(mintAddresses.length)} tokens`);
      
      // Filter out already subscribed tokens
      const newTokens = mintAddresses.filter(address => !this.subscriptions.has(address));
      
      if (newTokens.length === 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('All tokens already subscribed')}`);
        return true;
      }
      
      // Update subscriptions map
      for (const address of newTokens) {
        this.subscriptions.set(address, true);
      }
      
      // If we have subscriptions and aren't already polling, start polling
      if (this.subscriptions.size > 0 && !this.pollingInterval) {
        this.startPolling();
      }
      
      // Immediately fetch prices for the newly subscribed tokens
      const initialPrices = await this.getPrices(newTokens);
      this.notifyPriceUpdateCallbacks(initialPrices);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Subscribed to prices for')} ${formatLog.count(newTokens.length)} new tokens`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to subscribe to prices:')} ${error.message}`);
      return false;
    }
  }

  /**
   * Unsubscribe from price updates for specified tokens
   * This removes tokens from the subscription list and may stop polling
   * @param {string[]} mintAddresses - Array of token mint addresses to unsubscribe from
   * @returns {boolean} - Success status
   */
  async unsubscribeFromPrices(mintAddresses) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('UNSUBSCRIBING')} from prices for ${formatLog.count(mintAddresses.length)} tokens`);
      
      // Filter out tokens that aren't subscribed
      const subscribedTokens = mintAddresses.filter(address => this.subscriptions.has(address));
      
      if (subscribedTokens.length === 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('No tokens to unsubscribe from')}`);
        return true;
      }
      
      // Update subscriptions map
      for (const address of subscribedTokens) {
        this.subscriptions.delete(address);
      }
      
      // If no more subscriptions, stop polling
      if (this.subscriptions.size === 0) {
        this.stopPolling();
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Unsubscribed from prices for')} ${formatLog.count(subscribedTokens.length)} tokens`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to unsubscribe from prices:')} ${error.message}`);
      return false;
    }
  }

  /**
   * Get current prices for specified tokens
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Promise<Object>} - Map of token addresses to price data
   */
  async getPrices(mintAddresses) {
    try {
      // Check if we have a valid array of mint addresses
      if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) {
        return {};
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} prices for ${formatLog.count(mintAddresses.length)} tokens`);
      
      // Batch tokens into smaller chunks to avoid 414 URI Too Long errors
      // Reduce the batch size to avoid 414 errors we're seeing in the logs
      const MAX_TOKENS_PER_REQUEST = 50; // Reduced from 100 to 50
      const allFetchedPrices = {};
      let fetchErrorCount = 0;
      
      // Split into batches and process them
      for (let i = 0; i < mintAddresses.length; i += MAX_TOKENS_PER_REQUEST) {
        const batch = mintAddresses.slice(i, i + MAX_TOKENS_PER_REQUEST);
        const queryString = batch.join(',');
        
        // Log progress for large batches
        if (mintAddresses.length > MAX_TOKENS_PER_REQUEST) {
          const batchNum = Math.floor(i/MAX_TOKENS_PER_REQUEST) + 1;
          const totalBatches = Math.ceil(mintAddresses.length/MAX_TOKENS_PER_REQUEST);
          const progress = Math.round((batchNum / totalBatches) * 100);
          
          // Only log every 10% for very large batches to reduce log spam
          if (totalBatches > 10 && batchNum % Math.ceil(totalBatches/10) === 0) {
            logApi.info(`${formatLog.tag()} Progress: ${progress}% (${i+batch.length}/${mintAddresses.length})`);
          } 
          // Log every batch for smaller sets
          else if (totalBatches <= 10) {
            logApi.info(`${formatLog.tag()} Processing batch ${batchNum}/${totalBatches} (${batch.length} tokens)`);
          }
        }
        
        try {
          const response = await this.makeRequest('GET', this.config.endpoints.price.getPrices, null, { ids: queryString });
          
          if (!response || !response.data) {
            logApi.warn(`${formatLog.tag()} ${formatLog.warning('Invalid response for batch')} ${Math.floor(i/MAX_TOKENS_PER_REQUEST) + 1}`);
            continue; // Skip this batch and continue with next one
          }
          
          // Merge this batch's results with the overall results
          Object.assign(allFetchedPrices, response.data);
          
          // Add a small delay between batches to avoid rate limiting (if needed)
          if (i + MAX_TOKENS_PER_REQUEST < mintAddresses.length) {
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
          }
        } catch (batchError) {
          fetchErrorCount++;
          
          // Only log detailed error for the first few errors to avoid log spam
          if (fetchErrorCount <= 3) {
            logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error fetching batch ${Math.floor(i/MAX_TOKENS_PER_REQUEST) + 1}:`)} ${batchError.message}`);
          } 
          // Just log a count for subsequent errors
          else if (fetchErrorCount === 4) {
            logApi.warn(`${formatLog.tag()} ${formatLog.warning('Additional batch errors occurring, suppressing detailed logs')}`);
          }
          
          // Continue with next batch despite error
        }
      }
      
      // Final summary with error count if any
      const fetchedCount = Object.keys(allFetchedPrices).length;
      const successMsg = `${formatLog.success('Successfully fetched prices for')} ${formatLog.count(fetchedCount)} tokens (${fetchedCount}/${mintAddresses.length}, ${Math.round(fetchedCount/mintAddresses.length*100)}%)`;
      
      if (fetchErrorCount > 0) {
        logApi.info(`${formatLog.tag()} ${successMsg} - ${formatLog.warning(`${fetchErrorCount} batch errors occurred`)}`);
      } else {
        logApi.info(`${formatLog.tag()} ${successMsg}`);
      }
      
      return allFetchedPrices;
    } catch (error) {
      // Use a single detailed error log instead of multiple similar ones
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch prices:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get price history for a token
   * @param {string} mintAddress - Token mint address
   * @param {string} interval - Time interval (e.g., '1d', '7d', '30d')
   * @returns {Promise<Object>} - Price history data
   */
  async getPriceHistory(mintAddress, interval = '7d') {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} price history for token ${formatLog.token(mintAddress)} over ${interval}`);
      
      const response = await this.makeRequest('GET', this.config.endpoints.price.getPriceHistory(mintAddress), null, { interval });
      
      if (!response.data || !response.data[mintAddress]) {
        throw new Error('Invalid response from Jupiter API');
      }
      
      const priceHistory = response.data[mintAddress];
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched price history for')} ${formatLog.token(mintAddress)}`);
      
      return priceHistory;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch price history:')} ${error.message}`);
      throw error;
    }
  }
}

/**
 * Swap service module
 */
class SwapService extends JupiterBase {
  constructor(config) {
    super(config, 'jupiter:swap:');
  }

  /**
   * Get a swap quote between two tokens
   * @param {Object} params - Quote parameters (inputMint, outputMint, amount, etc.)
   * @returns {Promise<Object>} - Swap quote details
   */
  async getSwapQuote(params) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} swap quote from ${formatLog.token(params.inputMint)} to ${formatLog.token(params.outputMint)}`);
      
      const response = await this.makeRequest('GET', this.config.endpoints.quote.getQuote, null, params);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched swap quote')} with best price: ${formatLog.price(response.outAmount)}`);
      
      return response;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch swap quote:')} ${error.message}`);
      throw error;
    }
  }
}

/**
 * Jupiter Client for fetching market data and swap quotes
 * 
 * Updated in April 2025 to use Jupiter's new API Gateway:
 * - For paid access with API key: https://api.jup.ag/
 * - For free access (no API key): https://lite-api.jup.ag/
 * 
 * Note: As of May 1, 2025, api.jup.ag will return 401 errors without an API key
 */
class JupiterClient {
  constructor() {
    this.config = jupiterConfig;
    this.initialized = false;
    
    // Create service modules
    this.tokens = new TokenListService(this.config);
    this.prices = new PriceService(this.config);
    this.swaps = new SwapService(this.config);
    
    this.tokenList = null;
    this.tokenMap = null;
  }

  /**
   * Initialize the Jupiter client
   */
  async initialize() {
    if (!this.config.apiKey) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Jupiter API key not configured. Market data features will be limited.')}`);
    }

    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} Jupiter client`);
      
      // Initialize token list and map
      this.tokenList = await this.tokens.fetchTokenList();
      this.tokenMap = this.tokens.createTokenMap(this.tokenList);
      
      this.initialized = true;
      logApi.info(`${formatLog.tag()} ${formatLog.success('Jupiter client initialized successfully')}`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize Jupiter client:')} ${error.message}`);
      return false;
    }
  }

  /**
   * Register a callback function for price updates - proxy to price service
   * @param {Function} callback - Function to call when prices are updated
   * @returns {Function} - Function to unregister the callback
   */
  onPriceUpdate(callback) {
    return this.prices.onPriceUpdate(callback);
  }

  /**
   * Subscribe to price updates for specified tokens - proxy to price service
   * @param {string[]} mintAddresses - Array of token mint addresses to subscribe to
   * @returns {boolean} - Success status
   */
  async subscribeToPrices(mintAddresses) {
    return this.prices.subscribeToPrices(mintAddresses);
  }

  /**
   * Unsubscribe from price updates for specified tokens - proxy to price service
   * @param {string[]} mintAddresses - Array of token mint addresses to unsubscribe from
   * @returns {boolean} - Success status
   */
  async unsubscribeFromPrices(mintAddresses) {
    return this.prices.unsubscribeFromPrices(mintAddresses);
  }

  /**
   * Get current prices for specified tokens - proxy to price service
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Promise<Object>} - Map of token addresses to price data
   */
  async getPrices(mintAddresses) {
    return this.prices.getPrices(mintAddresses);
  }

  /**
   * Get price history for a token - proxy to price service
   * @param {string} mintAddress - Token mint address
   * @param {string} interval - Time interval (e.g., '1d', '7d', '30d')
   * @returns {Promise<Object>} - Price history data
   */
  async getPriceHistory(mintAddress, interval = '7d') {
    return this.prices.getPriceHistory(mintAddress, interval);
  }

  /**
   * Get a swap quote between two tokens - proxy to swap service
   * @param {Object} params - Quote parameters (inputMint, outputMint, amount, etc.)
   * @returns {Promise<Object>} - Swap quote details
   */
  async getSwapQuote(params) {
    return this.swaps.getSwapQuote(params);
  }

  /**
   * Get details about a specific token
   * @param {string} mintAddress - Token mint address
   * @returns {Object|null} - Token details or null if not found
   */
  getTokenInfo(mintAddress) {
    if (!this.tokenMap) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Token map not initialized')}`);
      return null;
    }
    
    return this.tokenMap[mintAddress] || null;
  }
}

// Create and export a singleton instance
export const jupiterClient = new JupiterClient();
export default jupiterClient;