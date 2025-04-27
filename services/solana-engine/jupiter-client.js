// services/solana-engine/jupiter-client.js

/**
 * This file contains the Jupiter API client for the solana-engine service.
 * It includes functions for fetching token lists and prices from the Jupiter API.
 * 
 * @author @BranchManager69
 * @version 1.9.0
 * @since 2025-04-26
 */

import axios from 'axios';
import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceSpecificColors, fancyColors } from '../../utils/colors.js';
import { jupiterConfig } from '../../config/external-api/jupiter-config.js';
import redisManager from '../../utils/redis-suite/redis-manager.js'; // why import if unused?

// Config
import { config } from '../../config/config.js'; // currently unused but really should be used

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
    //   IMPORTANT: Automatic polling disabled by default
    //     The TokenRefreshScheduler is the primary mechanism for token price updates
    //     This avoids conflicts between the two systems hitting rate limits
    this.pollingInterval = null;
    this.pollingFrequency = 30000; // Poll every 30 seconds by default (if enabled)
    this.priceUpdateCallbacks = [];
    this.subscriptions = new Map();
    this.automaticPollingEnabled = false; // flag to control automatic polling
    // Batch fetch gap
    const MINIMUM_FETCH_GAP = 15; // in seconds
    this.minimumFetchGap = 1000 * MINIMUM_FETCH_GAP; // minimum time between full batch fetches
    // Add a lock to prevent multiple concurrent batch processes
    this.isFetchingPrices = false;
    this.lastFetchTime = 0;
  }

  /**
   * Start polling for price updates for subscribed tokens
   * 
   * NOTE: By default, automatic polling is now disabled to prevent conflicts with
   * the TokenRefreshScheduler. Set automaticPollingEnabled to true to re-enable.
   */
  startPolling() {
    if (this.pollingInterval) {
      return; // Already polling
    }
    
    if (this.subscriptions.size === 0) {
      return; // No tokens to poll for
    }
    
    // Check if automatic polling is disabled
    if (!this.automaticPollingEnabled) {
      logApi.info(`${formatLog.tag()} ${formatLog.header('SKIPPING')} automatic price polling for ${formatLog.count(this.subscriptions.size)} tokens (automaticPollingEnabled = false)`);
      logApi.info(`${formatLog.tag()} ${formatLog.info('Using TokenRefreshScheduler for price updates instead of automatic polling')}`);
      return; // Don't start polling if disabled
    }
    
    logApi.info(`${formatLog.tag()} ${formatLog.header('STARTING')} price polling for ${formatLog.count(this.subscriptions.size)} tokens`);
    
    this.pollingInterval = setInterval(async () => {
      try {
        // Check if we're already fetching prices or if it's too soon since the last fetch
        const now = Date.now();
        const timeSinceLastFetch = now - this.lastFetchTime;
        
        if (this.isFetchingPrices) {
          logApi.info(`${formatLog.tag()} ${formatLog.info('Skipping price update as a previous batch is still processing')}`);
          return;
        }
        
        if (timeSinceLastFetch < this.minimumFetchGap) {
          logApi.info(`${formatLog.tag()} ${formatLog.info(`Skipping price update as last update was ${Math.round(timeSinceLastFetch/1000)}s ago (minimum gap: ${this.minimumFetchGap/1000}s)`)}`);
          return;
        }
        
        const tokens = Array.from(this.subscriptions.keys());
        // Set the lock before starting the fetch
        this.isFetchingPrices = true;
        this.lastFetchTime = now;
        
        const priceData = await this.getPrices(tokens);
        
        // Notify callbacks with the price data
        this.notifyPriceUpdateCallbacks(priceData);
        
        // Release the lock after the fetch completes
        this.isFetchingPrices = false;
      } catch (error) {
        // Release the lock in case of an error
        this.isFetchingPrices = false;
        logApi.error(`${formatLog.tag()} ${formatLog.error('Price polling failed:')} ${error.message}`);
      }
    }, this.pollingFrequency);
  }

  /**
   * Stop polling for price updates
   * 
   * NOTE: By default, automatic polling is now disabled to prevent conflicts with
   * the TokenRefreshScheduler. Set automaticPollingEnabled to true to re-enable.
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
      logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} to prices for ${formatLog.count(mintAddresses.length)} tokens (delegated from solana_engine_service)`);
      
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
      
      // If we have subscriptions and aren't already polling, and automatic polling is enabled, start polling
      if (this.subscriptions.size > 0 && !this.pollingInterval && this.automaticPollingEnabled) {
        this.startPolling();
      }
      
      // Check if we're already fetching prices
      if (this.isFetchingPrices) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Skipping immediate price fetch as a previous batch is still processing')}`);
        logApi.info(`${formatLog.tag()} ${formatLog.success('Subscribed to prices for')} ${formatLog.count(newTokens.length)} new tokens (prices will be fetched on next poll cycle)`);
        return true;
      }
      
      // Set the lock before starting the fetch
      this.isFetchingPrices = true;
      this.lastFetchTime = Date.now();
      
      try {
        // Immediately fetch prices for the newly subscribed tokens
        const initialPrices = await this.getPrices(newTokens);
        this.notifyPriceUpdateCallbacks(initialPrices);
      } finally {
        // Release the lock after fetch, even if it failed
        this.isFetchingPrices = false;
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Subscribed to prices for')} ${formatLog.count(newTokens.length)} new tokens`);
      return true;
    } catch (error) {
      // Make sure to release the lock if there was an error
      this.isFetchingPrices = false;
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

    // Get prices for specified tokens via Jupiter API
    try {
      // Check if mintAddresses is a valid array of mint addresses
      if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) {
        return {};
      }
      
      // NOTE: The lock (this.isFetchingPrices) should be set by the caller
      // This method assumes the lock is already in place to avoid nested locking issues
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} prices for ${formatLog.count(mintAddresses.length)} tokens (delegated from solana_engine_service)`);
      
      // Batch tokens into optimal chunks based on previous API behavior
      // The Jupiter API docs specify a maximum of 100 tokens per request
      //   But we need to be careful about URI length limits (rare but possible)
      //   Hard maximum is 100 tokens per request (enforced by Jupiter API on all paid tiers)
      const MAX_TOKENS_PER_REQUEST = this.config.rateLimit.maxTokensPerRequest || 100;
      
      // Track if we've had URI too long errors and use that to adapt
      //   Use class variables to persist across calls
      if (this.constructor.uriTooLongErrors === undefined) {
        this.constructor.uriTooLongErrors = 0;
        this.constructor.currentOptimalBatchSize = MAX_TOKENS_PER_REQUEST;
      }
      
      // If we've hit URI too long errors before, reduce batch size (seems arbitrary but ok)
      if (this.constructor.uriTooLongErrors > 0) {
        // Gradually reduce batch size based on number of previous errors
        this.constructor.currentOptimalBatchSize = Math.max(25, MAX_TOKENS_PER_REQUEST - (this.constructor.uriTooLongErrors * 10));
        logApi.info(`${formatLog.tag()} ${formatLog.info(`Using reduced batch size of ${this.constructor.currentOptimalBatchSize} tokens due to previous URI length errors`)}`);
      }
      
      // Use the optimal batch size for this request
      const effectiveBatchSize = this.constructor.currentOptimalBatchSize;
      const allFetchedPrices = {};
      let fetchErrorCount = 0;
      
      // Split into batches and process them sequentially with proper rate limiting
      const totalBatches = Math.ceil(mintAddresses.length / effectiveBatchSize);
      
      // OPTIMIZATION: Setup parallel processing with concurrency control
      //   Process multiple batches in parallel while respecting rate limits
      const MAX_CONCURRENT_REQUESTS = this.config.rateLimit.maxRequestsPerSecond;
      
      // Define a throttle function to control concurrency
      const throttleBatches = async (batches) => {
        const results = {};
        
        // Process batches in chunks of MAX_CONCURRENT_REQUESTS
        for (let i = 0; i < batches.length; i += MAX_CONCURRENT_REQUESTS) {
          const batchChunk = batches.slice(i, i + MAX_CONCURRENT_REQUESTS);
          
          // Process this chunk of batches in parallel
          const chunkPromises = batchChunk.map(({ batch, queryString, batchIndex }) => {
            const batchNum = batchIndex + 1;  // Batch numbers start from 1
            
            // Return a promise that resolves to the batch results
            return (async () => {
              try {
                logApi.info(`${formatLog.tag()} ${formatLog.info(`[${new Date().toLocaleTimeString()}] Processing batch ${batchNum}/${totalBatches} (${batch.length} tokens)`)}`);
                
                const response = await this.makeRequest('GET', this.config.endpoints.price.getPrices, null, { ids: queryString });
                
                if (response && response.data) {
                  // Merge into results
                  Object.assign(results, response.data);
                }
                
                return { success: true };
              } catch (error) {
                return { 
                  success: false, 
                  error, 
                  batchNum, 
                  batchIndex,
                  batch, 
                  queryString 
                };
              }
            })();
          });
          
          // Wait for all promises in this chunk to resolve
          const chunkResults = await Promise.all(chunkPromises);
          
          // Handle failures if needed
          const failures = chunkResults.filter(result => !result.success);
          if (failures.length > 0) {
            // Log failures but continue with next chunk
            logApi.warn(`${formatLog.tag()} ${formatLog.warning(`${failures.length} batch failures in current chunk`)}`);
            
            // If we're hitting rate limits, add a small delay before the next chunk
            const hasRateLimitErrors = failures.some(f => f.error?.response?.status === 429);
            if (hasRateLimitErrors) {
              logApi.warn(`${formatLog.tag()} ${formatLog.warning('Rate limit detected, adding delay before next chunk')}`);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          
          // Add a small delay between chunks to ensure we don't exceed rate limits
          if (i + MAX_CONCURRENT_REQUESTS < batches.length) {
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms between chunks
          }
        }
        
        // Return the results
        return results;
      };
      
      // Prepare batches for throttled processing
      const batchesForProcessing = [];
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const startIndex = batchIndex * effectiveBatchSize;
        const batch = mintAddresses.slice(startIndex, startIndex + effectiveBatchSize);
        const queryString = batch.join(',');
        
        batchesForProcessing.push({ batch, queryString, batchIndex });
      }
      
      // Process all batches with throttling and get combined results
      const allResults = await throttleBatches(batchesForProcessing);
      
      // Merge results into allFetchedPrices
      Object.assign(allFetchedPrices, allResults);

      // Return the results
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
    // Lock to prevent concurrent API calls
    if (this.isFetchingPrices) {
      logApi.info(`${formatLog.tag()} ${formatLog.info('Delaying price history fetch as a price batch is still processing')}`);
      // Wait for the current operation to complete with a maximum timeout
      const maxWaitMs = 5000; // 5 seconds
      const startWait = Date.now();
      while (this.isFetchingPrices && (Date.now() - startWait < maxWaitMs)) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait in 100ms intervals
      }
      
      // If we're still locked after maximum wait time, proceed anyway but log it
      if (this.isFetchingPrices) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Proceeding with price history fetch despite ongoing batch process (timeout exceeded)')}`);
      }
    }
    
    // Set the lock before starting the fetch
    this.isFetchingPrices = true;
    this.lastFetchTime = Date.now();
    
    // Fetch the price history
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} price history for token ${formatLog.token(mintAddress)} over ${interval}`);
      
      // Make the API request
      const response = await this.makeRequest('GET', this.config.endpoints.price.getPriceHistory(mintAddress), null, { interval });
      
      // Check if the response is valid
      if (!response.data || !response.data[mintAddress]) {
        throw new Error('Invalid response from Jupiter API');
      }
      
      // Get the price history
      const priceHistory = response.data[mintAddress];
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched price history for')} ${formatLog.token(mintAddress)}`);
      
      // Return the price history
      return priceHistory;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch price history:')} ${error.message}`);
      // Re-throw the error
      throw error;
    } finally {
      // Always release the lock when done
      this.isFetchingPrices = false;
    }
  }
}
/**
 * Swap service module
 * 
 * @extends JupiterBase
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
      
      // Make the API request
      const response = await this.makeRequest('GET', this.config.endpoints.quote.getQuote, null, params);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched swap quote')} with best price: ${formatLog.price(response.outAmount)}`);
      
      // Return the response
      return response;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch swap quote:')} ${error.message}`);
      // Re-throw the error
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
    
    // Configuration for automatic polling
    this.useAutomaticPolling = false; // Default to disabled, use TokenRefreshScheduler instead
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
      
      // Configure automatic polling based on client setting
      this.prices.automaticPollingEnabled = this.useAutomaticPolling;
      
      if (!this.useAutomaticPolling) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Automatic price polling is DISABLED. Using TokenRefreshScheduler for price updates.')}`);
      } else {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Automatic price polling is ENABLED. This may conflict with TokenRefreshScheduler.')}`);
      }
      
      this.initialized = true;
      logApi.info(`${formatLog.tag()} ${formatLog.success('Jupiter client initialized successfully')}`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize Jupiter client:')} ${error.message}`);
      return false;
    }
  }
  
  /**
   * Enable or disable automatic price polling
   * 
   * IMPORTANT: By default, automatic polling is disabled to avoid rate limit
   * conflicts with the TokenRefreshScheduler. Only enable this if you know
   * what you're doing and can coordinate with the scheduler.
   * 
   * @param {boolean} enabled - Whether to enable automatic polling
   */
  setAutomaticPolling(enabled) {
    this.useAutomaticPolling = !!enabled;
    
    // Update the price service's setting
    if (this.prices) {
      this.prices.automaticPollingEnabled = this.useAutomaticPolling;
      
      // Log the change
      if (this.useAutomaticPolling) {
        logApi.info(`${formatLog.tag()} ${formatLog.header('ENABLED')} automatic price polling`);
        
        // Start polling if we're initialized and have subscriptions
        if (this.initialized && this.prices.subscriptions.size > 0 && !this.prices.pollingInterval) {
          this.prices.startPolling();
        }
      } else {
        logApi.info(`${formatLog.tag()} ${formatLog.header('DISABLED')} automatic price polling`);
        
        // Stop polling if it's active
        if (this.prices.pollingInterval) {
          this.prices.stopPolling();
        }
      }
    }
    
    return this.useAutomaticPolling;
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
    // Check if the price service is already fetching prices
    if (this.prices.isFetchingPrices) {
      logApi.info(`${formatLog.tag()} ${formatLog.info('Delaying price fetch as a previous batch is still processing')}`);
      
      // Wait for the current operation to complete with a maximum timeout
      const maxWaitMs = 5000;
      const startWait = Date.now();
      while (this.prices.isFetchingPrices && (Date.now() - startWait < maxWaitMs)) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait in 100ms intervals
      }
      
      // If we're still locked after maximum wait time, proceed anyway but log it
      if (this.prices.isFetchingPrices) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Proceeding with new price fetch despite ongoing batch process (timeout exceeded)')}`);
      }
    }
    
    // Set the lock before starting the fetch
    this.prices.isFetchingPrices = true;
    this.prices.lastFetchTime = Date.now();
    
    try {
      return await this.prices.getPrices(mintAddresses);
    } finally {
      // Always release the lock when done
      this.prices.isFetchingPrices = false;
    }
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

// -----

// Create and export a singleton instance
let _instance = null;

// Export the getJupiterClient function
export function getJupiterClient() {
  if (!_instance) {
    _instance = new JupiterClient();
  }
  return _instance;
}
// Export the singleton instance of the Jupiter client
export const jupiterClient = getJupiterClient();
// Export the singleton instance of the Jupiter client as the default export
export default jupiterClient;