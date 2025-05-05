// services/solana-engine/jupiter-client.js

/**
 * This file contains the Jupiter API client for the solana-engine service.
 * It includes functions for fetching token lists and prices from the Jupiter API.
 * 
 * @author @BranchManager69
 * @version 1.9.0
 * @since 2025-05-02
 */

import axios from 'axios';
import { BaseService } from '../../utils/service-suite/base-service.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceSpecificColors, fancyColors } from '../../utils/colors.js';
import { jupiterConfig } from '../../config/external-api/jupiter-config.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import { 
  safe, 
  inc, 
  set, 
  logError, 
  isCircuitOpen,
  safeStats 
} from '../../utils/service-suite/safe-service.js';

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
      // Use safe error logging to prevent circular references
      logError(
        logApi,
        'JupiterBase',
        `Failed to fetch from Jupiter API (${endpoint})`,
        error
      );
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
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Fetched token list with')} ${formatLog.count(safe(response, 'length', 0))} tokens`);
      return response;
    } catch (error) {
      // Use safe error logging
      logError(logApi, 'TokenListService', 'Failed to fetch token list', error);
      throw error;
    }
  }

  /**
   * Create a map of mint address to token info for quick lookups
   * @param {Array} tokenList - List of tokens
   * @returns {Object} - Map of mint address to token info
   */
  createTokenMap(tokenList) {
    if (!tokenList || !Array.isArray(tokenList)) {
      return {};
    }
    
    return tokenList.reduce((map, token) => {
      if (token && token.address) {
        map[token.address] = token;
      }
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
    
    if (!this.subscriptions || this.subscriptions.size === 0) {
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
        // Use safe error logging
        logError(logApi, 'PriceService', 'Price polling failed', error);
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
    if (!this.priceUpdateCallbacks || this.priceUpdateCallbacks.length === 0) {
      return;
    }
    
    for (const callback of this.priceUpdateCallbacks) {
      try {
        callback(priceData);
      } catch (error) {
        // Use safe error logging
        logError(logApi, 'PriceService', 'Error in price update callback', error);
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
    
    if (!this.priceUpdateCallbacks) {
      this.priceUpdateCallbacks = [];
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
      if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) {
        return true; // Nothing to do
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} to prices for ${formatLog.count(mintAddresses.length)} tokens (delegated from solana_engine_service)`);
      
      // Initialize the subscriptions map if it doesn't exist
      if (!this.subscriptions) {
        this.subscriptions = new Map();
      }
      
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
      // Use safe error logging
      logError(logApi, 'PriceService', 'Failed to subscribe to prices', error);
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
      if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) {
        return true; // Nothing to do
      }
      
      if (!this.subscriptions) {
        return true; // No subscriptions exist
      }
      
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
      // Use safe error logging
      logError(logApi, 'PriceService', 'Failed to unsubscribe from prices', error);
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
      const MAX_TOKENS_PER_REQUEST = safe(this.config, 'rateLimit.maxTokensPerRequest', 100);
      
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
      
      // Split into batches and process them sequentially with proper rate limiting
      const totalBatches = Math.ceil(mintAddresses.length / effectiveBatchSize);
      
      // OPTIMIZATION: Setup parallel processing with concurrency control
      //   Process multiple batches in parallel while respecting rate limits
      const MAX_CONCURRENT_REQUESTS = safe(this.config, 'rateLimit.maxRequestsPerSecond', 3);
      
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
            const hasRateLimitErrors = failures.some(f => safe(f, 'error.response.status') === 429);
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

      return allFetchedPrices;
    } catch (error) {
      // Use safe error logging
      logError(logApi, 'PriceService', 'Failed to fetch prices', error);
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
      // Use safe error logging
      logError(logApi, 'PriceService', 'Failed to fetch price history', error);
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
      // Use safe error logging
      logError(logApi, 'SwapService', 'Failed to fetch swap quote', error);
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
 * 
 * @extends BaseService
 */
class JupiterClient extends BaseService {
  constructor() {
    // Initialize base service with proper configuration
    super({
      name: SERVICE_NAMES.JUPITER_CLIENT,
      description: 'Jupiter API client for market data',
      dependencies: [SERVICE_NAMES.SOLANA_ENGINE],
      layer: 'DATA',
      criticalLevel: 'MEDIUM',
      // Circuit breaker configuration
      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        healthCheckIntervalMs: 15000,
        description: 'Manages Jupiter API connectivity'
      }
    });
    
    this.jupiterConfig = jupiterConfig;
    
    // Create service modules
    this.tokens = null;
    this.prices = null;
    this.swaps = null;
    
    this.tokenList = null;
    this.tokenMap = null;
    
    // Configuration for automatic polling
    this.useAutomaticPolling = false; // Default to disabled, use TokenRefreshScheduler instead
    
    // Custom stats for this service
    this.stats.customStats = {
      tokens: {
        total: 0,
        subscribed: 0
      },
      api: {
        successful: 0,
        failed: 0,
        lastRequest: null,
        lastResponse: null,
        lastError: null
      }
    };
  }

  /**
   * Initialize the Jupiter client
   */
  async initialize() {
    try {
      // Call the base service initialization first
      await super.initialize();
      
      // Register this service with the service manager
      serviceManager.register(this.name, this.dependencies);
      
      // Check Jupiter API key configuration
      if (!this.jupiterConfig.apiKey) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Jupiter API key not configured. Market data features will be limited.')}`);
      }

      // Initialize service modules
      this.tokens = new TokenListService(this.jupiterConfig);
      this.prices = new PriceService(this.jupiterConfig);
      this.swaps = new SwapService(this.jupiterConfig);
      
      // Initialize token list and map
      this.tokenList = await this.tokens.fetchTokenList();
      
      // Track token count in stats
      set(this.stats.customStats.tokens, 'total', safe(this.tokenList, 'length', 0));
      
      this.tokenMap = this.tokens.createTokenMap(this.tokenList);
      
      // Configure automatic polling based on client setting
      this.prices.automaticPollingEnabled = this.useAutomaticPolling;
      
      if (!this.useAutomaticPolling) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Automatic price polling is DISABLED. Using TokenRefreshScheduler for price updates.')}`);
      } else {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Automatic price polling is ENABLED. This may conflict with TokenRefreshScheduler.')}`);
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Jupiter client initialized successfully')}`);
      
      // Emit service initialized event with safe data
      serviceEvents.emit('service:initialized', {
        name: this.name,
        config: this._getSafeConfig(),
        stats: this._getSafeStats()
      });
      
      return true;
    } catch (error) {
      // Use safe error logging
      logError(logApi, this.name, 'Failed to initialize Jupiter client', error);
      
      // Update stats
      set(this.stats.customStats.api, 'lastError', error.message);
      await this.handleError(error);
      
      return false;
    }
  }
  
  /**
   * Check if circuit breaker is open
   * @returns {boolean} True if the circuit breaker is open
   */
  isCircuitBreakerOpen() {
    return isCircuitOpen(this);
  }
  
  /**
   * Perform the service's main operation - heartbeat to check Jupiter API status
   */
  async performOperation() {
    try {
      // Check if circuit breaker is open
      if (this.isCircuitBreakerOpen()) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Circuit breaker is open, skipping operation')}`);
        return;
      }
      
      // For heartbeat, do a lightweight request
      if (!this.tokenList || this.tokenList.length === 0) {
        // If no token list, fetch it
        this.tokenList = await this.tokens.fetchTokenList();
        this.tokenMap = this.tokens.createTokenMap(this.tokenList);
        
        // Update stats
        set(this.stats.customStats.tokens, 'total', safe(this.tokenList, 'length', 0));
      } else {
        // Get a sample token for price check
        const sampleToken = this.tokenList[0];
        
        if (sampleToken && sampleToken.address) {
          // Get the price for the sample token
          const prices = await this.prices.getPrices([sampleToken.address]);
          
          // Update stats
          inc(this.stats.customStats.api, 'successful');
          set(this.stats.customStats.api, 'lastRequest', new Date().toISOString());
          set(this.stats.customStats.api, 'lastResponse', new Date().toISOString());
        }
      }
      
      // Record success for circuit breaker
      await this.recordSuccess();
      
      // Emit heartbeat event
      serviceEvents.emit('service:heartbeat', {
        name: this.name,
        config: this._getSafeConfig(),
        stats: safeStats(this.stats)
      });
      
      return true;
    } catch (error) {
      // Update stats for error tracking
      inc(this.stats.customStats.api, 'failed');
      set(this.stats.customStats.api, 'lastError', error.message);
      
      // Handle error through base service
      await this.handleError(error);
      return false;
    }
  }
  
  /**
   * Stop the service
   */
  async stop() {
    try {
      // Disable polling
      if (this.prices && this.prices.pollingInterval) {
        this.prices.stopPolling();
      }
      
      // Call base service stop
      await super.stop();
      
      return true;
    } catch (error) {
      logError(logApi, this.name, 'Error stopping JupiterClient', error);
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
        if (this.isInitialized && 
            this.prices.subscriptions && 
            this.prices.subscriptions.size > 0 && 
            !this.prices.pollingInterval) {
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
    try {
      if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) {
        return true;
      }
      
      // Check if circuit breaker is open
      if (this.isCircuitBreakerOpen()) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Circuit breaker is open, skipping price subscription')}`);
        return false;
      }
      
      const result = await this.prices.subscribeToPrices(mintAddresses);
      
      // Update stats
      if (result && this.prices.subscriptions) {
        set(this.stats.customStats.tokens, 'subscribed', this.prices.subscriptions.size);
      }
      
      return result;
    } catch (error) {
      // Use safe error logging
      logError(logApi, this.name, 'Error subscribing to prices', error);
      await this.handleError(error);
      return false;
    }
  }

  /**
   * Unsubscribe from price updates for specified tokens - proxy to price service
   * @param {string[]} mintAddresses - Array of token mint addresses to unsubscribe from
   * @returns {boolean} - Success status
   */
  async unsubscribeFromPrices(mintAddresses) {
    try {
      if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) {
        return true;
      }
      
      const result = await this.prices.unsubscribeFromPrices(mintAddresses);
      
      // Update stats
      if (result && this.prices.subscriptions) {
        set(this.stats.customStats.tokens, 'subscribed', this.prices.subscriptions.size);
      }
      
      return result;
    } catch (error) {
      // Use safe error logging
      logError(logApi, this.name, 'Error unsubscribing from prices', error);
      return false;
    }
  }

  /**
   * Get current prices for specified tokens - proxy to price service
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Promise<Object>} - Map of token addresses to price data
   */
  async getPrices(mintAddresses) {
    try {
      // Check if the circuit breaker is open
      if (this.isCircuitBreakerOpen()) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Circuit breaker is open, skipping price fetch')}`);
        throw new Error('Circuit breaker is open, cannot fetch prices');
      }
      
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
        const result = await this.prices.getPrices(mintAddresses);
        
        // Update stats
        inc(this.stats.customStats.api, 'successful');
        set(this.stats.customStats.api, 'lastRequest', new Date().toISOString());
        set(this.stats.customStats.api, 'lastResponse', new Date().toISOString());
        
        return result;
      } finally {
        // Always release the lock when done
        this.prices.isFetchingPrices = false;
      }
    } catch (error) {
      // Update stats for error tracking
      inc(this.stats.customStats.api, 'failed');
      set(this.stats.customStats.api, 'lastError', error.message);
      
      // Handle error through base service
      await this.handleError(error);
      
      // Re-throw to notify caller
      throw error;
    }
  }

  /**
   * Get price history for a token - proxy to price service
   * @param {string} mintAddress - Token mint address
   * @param {string} interval - Time interval (e.g., '1d', '7d', '30d')
   * @returns {Promise<Object>} - Price history data
   */
  async getPriceHistory(mintAddress, interval = '7d') {
    try {
      // Check if the circuit breaker is open
      if (this.isCircuitBreakerOpen()) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Circuit breaker is open, skipping price history fetch')}`);
        throw new Error('Circuit breaker is open, cannot fetch price history');
      }
      
      const result = await this.prices.getPriceHistory(mintAddress, interval);
      
      // Update stats
      inc(this.stats.customStats.api, 'successful');
      set(this.stats.customStats.api, 'lastRequest', new Date().toISOString());
      set(this.stats.customStats.api, 'lastResponse', new Date().toISOString());
      
      return result;
    } catch (error) {
      // Update stats for error tracking
      inc(this.stats.customStats.api, 'failed');
      set(this.stats.customStats.api, 'lastError', error.message);
      
      // Handle error through base service
      await this.handleError(error);
      
      // Re-throw to notify caller
      throw error;
    }
  }

  /**
   * Get a swap quote between two tokens - proxy to swap service
   * @param {Object} params - Quote parameters (inputMint, outputMint, amount, etc.)
   * @returns {Promise<Object>} - Swap quote details
   */
  async getSwapQuote(params) {
    try {
      // Check if the circuit breaker is open
      if (this.isCircuitBreakerOpen()) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Circuit breaker is open, skipping swap quote fetch')}`);
        throw new Error('Circuit breaker is open, cannot fetch swap quote');
      }
      
      const result = await this.swaps.getSwapQuote(params);
      
      // Update stats
      inc(this.stats.customStats.api, 'successful');
      set(this.stats.customStats.api, 'lastRequest', new Date().toISOString());
      set(this.stats.customStats.api, 'lastResponse', new Date().toISOString());
      
      return result;
    } catch (error) {
      // Update stats for error tracking
      inc(this.stats.customStats.api, 'failed');
      set(this.stats.customStats.api, 'lastError', error.message);
      
      // Handle error through base service
      await this.handleError(error);
      
      // Re-throw to notify caller
      throw error;
    }
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