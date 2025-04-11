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
    this.pollingFrequency = 30000; // Poll every 30 seconds by default (if enabled)
    this.priceUpdateCallbacks = [];
    this.subscriptions = new Map();
    
    // Add a lock to prevent multiple concurrent batch processes
    this.isFetchingPrices = false;
    this.lastFetchTime = 0;
    this.minimumFetchGap = 15000; // At least 15 seconds between full batch fetches
    
    // IMPORTANT: Automatic polling disabled by default
    // The TokenRefreshScheduler is the primary mechanism for token price updates
    // This avoids conflicts between the two systems hitting rate limits
    this.automaticPollingEnabled = false; // New flag to control automatic polling
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
    try {
      // Check if we have a valid array of mint addresses
      if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) {
        return {};
      }
      
      // Note: The lock (this.isFetchingPrices) should be set by the caller
      // This method assumes the lock is already in place to avoid nested locking issues
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} prices for ${formatLog.count(mintAddresses.length)} tokens (delegated from solana_engine_service)`);
      
      // Batch tokens into optimal chunks based on previous API behavior
      // The Jupiter API docs specify a maximum of 100 tokens per request
      // But we need to be careful about URI length limits (414 errors)
      const MAX_TOKENS_PER_REQUEST = this.config.rateLimit.maxTokensPerRequest || 100;
      
      // Track if we've had URI too long errors and use that to adapt
      // Use class variables to persist across calls
      if (this.constructor.uriTooLongErrors === undefined) {
        this.constructor.uriTooLongErrors = 0;
        this.constructor.currentOptimalBatchSize = MAX_TOKENS_PER_REQUEST;
      }
      
      // If we've hit URI too long errors before, reduce batch size
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
      
      // Setup sequential processing with proper rate limiting
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const startIndex = batchIndex * effectiveBatchSize;
        const batch = mintAddresses.slice(startIndex, startIndex + effectiveBatchSize);
        const queryString = batch.join(',');
        const batchNum = batchIndex + 1;  // Batch numbers start from 1
        
        // Always log which batch we're processing for better traceability
        logApi.info(`${formatLog.tag()} Processing batch ${batchNum}/${totalBatches} (${batch.length} tokens)`);
        
        // For large batches, also log progress percentage
        if (totalBatches > 10 && batchNum % Math.ceil(totalBatches/10) === 0) {
          const progress = Math.round((batchNum / totalBatches) * 100);
          logApi.info(`${formatLog.tag()} Progress: ${progress}% (${startIndex + batch.length}/${mintAddresses.length})`);
        }
        
        try {
          // Add an enforced delay between batches to respect rate limits
          // First batch doesn't need a delay
          if (batchIndex > 0) {
            // Calculate delay based on rate limits
            // Minimum delay of 1000ms / max requests per second
            const minDelayMs = Math.max(1000 / this.config.rateLimit.maxRequestsPerSecond, 20);
            await new Promise(resolve => setTimeout(resolve, minDelayMs));
          }
          
          // Make the API request with this batch
          const response = await this.makeRequest('GET', this.config.endpoints.price.getPrices, null, { ids: queryString });
          
          if (!response || !response.data) {
            logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Invalid response for batch ${batchNum}/${totalBatches}`)}`);
            continue; // Skip this batch and continue with next one
          }
          
          // Merge this batch's results with the overall results
          Object.assign(allFetchedPrices, response.data);
          
        } catch (batchError) {
          fetchErrorCount++;
          
          // Handle different types of errors
          if (batchError.response) {
            // Rate limit errors - add exponential backoff
            if (batchError.response.status === 429) {
              // Use the backoff configuration parameters from Jupiter config if available
              const initialBackoffMs = this.config.rateLimit.initialBackoffMs || 2000;
              const maxBackoffMs = this.config.rateLimit.maxBackoffMs || 30000;
              const backoffFactor = this.config.rateLimit.backoffFactor || 2.0;
              
              // Calculate backoff with the configured parameters
              const backoffMs = Math.min(
                initialBackoffMs * Math.pow(backoffFactor, fetchErrorCount), 
                maxBackoffMs
              );
              
              logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Rate limit hit for batch ${batchNum}/${totalBatches}, backing off for ${backoffMs}ms (attempt ${fetchErrorCount})`)}`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
            // URI too long errors - reduce batch size for future requests
            else if (batchError.response.status === 414 || 
                    (batchError.response.status === 400 && 
                     batchError.message.includes('uri') && 
                     batchError.message.toLowerCase().includes('long'))) {
              
              // Increment the URI too long error counter
              this.constructor.uriTooLongErrors++;
              
              // Calculate a new reduced batch size for future requests
              const newBatchSize = Math.max(25, Math.floor(batch.length * 0.8)); // Reduce by 20% but keep minimum
              this.constructor.currentOptimalBatchSize = newBatchSize;
              
              logApi.warn(`${formatLog.tag()} ${formatLog.warning(`URI too long error detected! Reducing batch size to ${newBatchSize} tokens for future requests`)}`);
              
              // For the current batch, split it into two parts and try again
              if (batch.length > 10) {
                const halfSize = Math.ceil(batch.length / 2);
                const firstHalf = batch.slice(0, halfSize);
                const secondHalf = batch.slice(halfSize);
                
                logApi.info(`${formatLog.tag()} ${formatLog.info(`Splitting current batch into two parts (${firstHalf.length} and ${secondHalf.length} tokens)`)}`);
                
                // Try the first half
                try {
                  const firstResponse = await this.makeRequest('GET', this.config.endpoints.price.getPrices, null, 
                    { ids: firstHalf.join(',') });
                  if (firstResponse && firstResponse.data) {
                    Object.assign(allFetchedPrices, firstResponse.data);
                  }
                } catch (splitError) {
                  logApi.error(`${formatLog.tag()} ${formatLog.error(`Error fetching first half of split batch: ${splitError.message}`)}`);
                }
                
                // Add delay before trying second half
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Try the second half
                try {
                  const secondResponse = await this.makeRequest('GET', this.config.endpoints.price.getPrices, null, 
                    { ids: secondHalf.join(',') });
                  if (secondResponse && secondResponse.data) {
                    Object.assign(allFetchedPrices, secondResponse.data);
                  }
                } catch (splitError) {
                  logApi.error(`${formatLog.tag()} ${formatLog.error(`Error fetching second half of split batch: ${splitError.message}`)}`);
                }
              }
            }
          }
          
          // Log with correct batch numbers
          if (fetchErrorCount <= 3) {
            logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error fetching batch ${batchNum}/${totalBatches}:`)} ${batchError.message}`);
          } 
          // Just log a count for subsequent errors
          else if (fetchErrorCount === 4) {
            logApi.warn(`${formatLog.tag()} ${formatLog.warning('Additional batch errors occurring, suppressing detailed logs')}`);
          }
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
    // Lock to prevent concurrent API calls
    if (this.isFetchingPrices) {
      logApi.info(`${formatLog.tag()} ${formatLog.info('Delaying price history fetch as a price batch is still processing')}`);
      // Wait for the current operation to complete with a maximum timeout
      const maxWaitMs = 5000;
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
    } finally {
      // Always release the lock when done
      this.isFetchingPrices = false;
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

// Create and export a singleton instance
let _instance = null;

export function getJupiterClient() {
  if (!_instance) {
    _instance = new JupiterClient();
  }
  return _instance;
}

export const jupiterClient = getJupiterClient();
export default jupiterClient;