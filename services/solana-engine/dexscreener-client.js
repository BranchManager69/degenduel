// services/solana-engine/dexscreener-client.js

import axios from 'axios';
import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceSpecificColors, fancyColors } from '../../utils/colors.js';
import { dexscreenerConfig } from '../../config/external-api/dexscreener-config.js';
import redisManager from '../../utils/redis-suite/redis-manager.js';

// Formatting helpers for consistent logging
const formatLog = {
  tag: () => `${serviceSpecificColors.dexscreenerClient.tag}[dexscreenerClient]${fancyColors.RESET}`,
  header: (text) => `${serviceSpecificColors.dexscreenerClient.header} ${text} ${fancyColors.RESET}`,
  success: (text) => `${serviceSpecificColors.dexscreenerClient.success}${text}${fancyColors.RESET}`,
  warning: (text) => `${serviceSpecificColors.dexscreenerClient.warning}${text}${fancyColors.RESET}`,
  error: (text) => `${serviceSpecificColors.dexscreenerClient.error}${text}${fancyColors.RESET}`,
  info: (text) => `${serviceSpecificColors.dexscreenerClient.info}${text}${fancyColors.RESET}`,
  highlight: (text) => `${serviceSpecificColors.dexscreenerClient.highlight}${text}${fancyColors.RESET}`,
  // Enhanced token display with DexScreener link
  token: (address, chainId = 'solana', symbol = null) => {
    // If we have a symbol, show it with the address
    const displayText = symbol ? `${symbol} (${address.slice(0, 8)}...)` : address.slice(0, 12) + '...';
    // Format as a DexScreener link
    const dexScreenerUrl = `https://dexscreener.com/${chainId}/${address}`;
    return `${serviceSpecificColors.dexscreenerClient.token}${displayText} [${dexScreenerUrl}]${fancyColors.RESET}`;
  },
  count: (num) => `${serviceSpecificColors.dexscreenerClient.count}${Number(num) || 0}${fancyColors.RESET}`,
};

/**
 * Base class for DexScreener API modules
 */
class DexScreenerBase {
  constructor(config, redisKeyPrefix) {
    this.config = config;
    this.redisKeyPrefix = redisKeyPrefix || 'dexscreener:';
    
    // Track API call rate limiting
    this.standardRateLimitWindow = {
      startTime: Date.now(),
      callCount: 0,
      maxCalls: this.config.rateLimit.standardEndpoints.maxRequestsPerMinute,
      windowSize: 60000, // 1 minute in ms
    };
    
    this.enhancedRateLimitWindow = {
      startTime: Date.now(),
      callCount: 0,
      maxCalls: this.config.rateLimit.enhancedEndpoints.maxRequestsPerMinute,
      windowSize: 60000, // 1 minute in ms
    };
    
    // Request locking to prevent concurrent calls
    this.isRequestInProgress = false;
    this.lastRequestTime = 0;
  }
  
  /**
   * Check rate limit window and reset if needed
   * @param {string} endpointType - 'standard' or 'enhanced'
   */
  checkRateLimitWindow(endpointType) {
    const window = endpointType === 'standard' 
      ? this.standardRateLimitWindow 
      : this.enhancedRateLimitWindow;
    
    const now = Date.now();
    if (now - window.startTime >= window.windowSize) {
      // Reset window
      window.startTime = now;
      window.callCount = 0;
    }
  }
  
  /**
   * Check if we've hit rate limits and should delay
   * @param {string} endpointType - 'standard' or 'enhanced'
   * @returns {number} - Milliseconds to delay, or 0 if no delay needed
   */
  calculateRateLimitDelay(endpointType) {
    const window = endpointType === 'standard' 
      ? this.standardRateLimitWindow 
      : this.enhancedRateLimitWindow;
    
    const rateLimitConfig = endpointType === 'standard'
      ? this.config.rateLimit.standardEndpoints
      : this.config.rateLimit.enhancedEndpoints;
    
    // If we're under the rate limit, no delay needed
    if (window.callCount < window.maxCalls) {
      return 0;
    }
    
    // Calculate time until window resets
    const now = Date.now();
    const timeUntilReset = window.startTime + window.windowSize - now;
    
    // Add a small buffer
    return timeUntilReset + 100;
  }
  
  /**
   * Make a request to DexScreener API with rate limiting
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {string} endpointType - 'standard' or 'enhanced'
   * @param {Object} data - Request data (for POST)
   * @param {Object} params - Query parameters (for GET)
   * @returns {Promise<any>} - Response data
   */
  async makeRequest(method, endpoint, endpointType, data = null, params = null) {
    // Wait if a request is already in progress - but don't log every instance
    if (this.isRequestInProgress) {
      // Wait up to 5 seconds for the current request to finish
      const maxWaitTime = 5000;
      const startWait = Date.now();
      
      while (this.isRequestInProgress && Date.now() - startWait < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // If still locked after timeout, proceed anyway but log a warning
      if (this.isRequestInProgress) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Request lock timeout exceeded, proceeding anyway')}`);
      }
    }
    
    // Set the lock before starting
    this.isRequestInProgress = true;
    
    try {
      // Check and reset rate limit window if needed
      this.checkRateLimitWindow(endpointType);
      
      // Calculate delay based on rate limits
      const rateLimitDelay = this.calculateRateLimitDelay(endpointType);
      
      if (rateLimitDelay > 0) {
        // Only log rate limit delays above a threshold to reduce spam
        if (rateLimitDelay > 1000) {
          logApi.info(`${formatLog.tag()} ${formatLog.info(`Rate limit reached for ${endpointType} endpoints, waiting ${rateLimitDelay}ms`)}`);
        }
        await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
        
        // Recheck window after waiting
        this.checkRateLimitWindow(endpointType);
      }
      
      // Enforce minimum delay between requests
      const minDelay = endpointType === 'standard'
        ? this.config.rateLimit.standardEndpoints.delayBetweenRequests
        : this.config.rateLimit.enhancedEndpoints.delayBetweenRequests;
      
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      
      if (timeSinceLastRequest < minDelay) {
        const delayMs = minDelay - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      // Make the request
      const options = {
        method,
        url: endpoint,
        headers: this.config.getHeaders(),
        timeout: 15000 // 15 second timeout
      };
      
      if (data) options.data = data;
      if (params) options.params = params;
      
      // Update rate limit tracking
      const window = endpointType === 'standard' 
        ? this.standardRateLimitWindow 
        : this.enhancedRateLimitWindow;
      
      window.callCount++;
      this.lastRequestTime = Date.now();
      
      // Make the actual API call
      const response = await axios(options);
      
      if (!response.data) {
        throw new Error('Invalid response from DexScreener API');
      }
      
      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to fetch from DexScreener API (${endpoint}):`)} ${errorMessage}`);
      
      // If we hit a rate limit, update the window count to max
      if (error.response?.status === 429) {
        const window = endpointType === 'standard' 
          ? this.standardRateLimitWindow 
          : this.enhancedRateLimitWindow;
        
        window.callCount = window.maxCalls;
      }
      
      throw error;
    } finally {
      // Always release the lock
      this.isRequestInProgress = false;
    }
  }
}

/**
 * Token Profiles Service
 */
class TokenProfilesService extends DexScreenerBase {
  constructor(config) {
    super(config, 'dexscreener:token:profiles:');
  }
  
  /**
   * Get latest token profiles
   * @returns {Promise<Object>} - Latest token profiles
   */
  async getLatestProfiles() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} latest token profiles`);
      
      const response = await this.makeRequest(
        'GET', 
        this.config.endpoints.tokenProfiles.getLatest,
        'standard'
      );
      
      // Cache the response in Redis
      await redisManager.set(
        `${this.redisKeyPrefix}latest_profiles`,
        JSON.stringify(response),
        60 * 60 // 1 hour cache
      );
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched latest token profiles')}`);
      return response;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch latest token profiles:')} ${error.message}`);
      throw error;
    }
  }
}

/**
 * Token Boosts Service
 */
class TokenBoostsService extends DexScreenerBase {
  constructor(config) {
    super(config, 'dexscreener:token:boosts:');
  }
  
  /**
   * Get latest token boosts
   * @returns {Promise<Object>} - Latest token boosts
   */
  async getLatestBoosts() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} latest token boosts`);
      
      const response = await this.makeRequest(
        'GET', 
        this.config.endpoints.tokenBoosts.getLatest,
        'standard'
      );
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched latest token boosts')}`);
      return response;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch latest token boosts:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get top tokens with most active boosts
   * @returns {Promise<Object>} - Top tokens with boosts
   */
  async getTopBoosts() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} top token boosts`);
      
      const response = await this.makeRequest(
        'GET', 
        this.config.endpoints.tokenBoosts.getTop,
        'standard'
      );
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched top token boosts')}`);
      return response;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch top token boosts:')} ${error.message}`);
      throw error;
    }
  }
}

/**
 * Orders Service
 */
class OrdersService extends DexScreenerBase {
  constructor(config) {
    super(config, 'dexscreener:orders:');
  }
  
  /**
   * Get orders paid for a token
   * @param {string} chainId - Blockchain ID (e.g., 'solana')
   * @param {string} tokenAddress - Token address
   * @returns {Promise<Object>} - Orders data
   */
  async getOrdersByToken(chainId, tokenAddress) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} orders for token ${formatLog.token(tokenAddress)}`);
      
      const endpoint = this.config.endpoints.orders.getByToken(chainId, tokenAddress);
      const response = await this.makeRequest('GET', endpoint, 'standard');
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched orders for token')} ${formatLog.token(tokenAddress)}`);
      return response;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch orders for token:')} ${error.message}`);
      throw error;
    }
  }
}

/**
 * Pairs Service
 */
class PairsService extends DexScreenerBase {
  constructor(config) {
    super(config, 'dexscreener:pairs:');
  }
  
  /**
   * Get pair details by chain ID and pair address
   * @param {string} chainId - Blockchain ID (e.g., 'solana')
   * @param {string} pairId - Pair ID/address
   * @returns {Promise<Object>} - Pair data
   */
  async getPairByAddress(chainId, pairId) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} pair ${formatLog.token(pairId)}`);
      
      const endpoint = this.config.endpoints.pairs.getByPair(chainId, pairId);
      const response = await this.makeRequest('GET', endpoint, 'enhanced');
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched pair')} ${formatLog.token(pairId)}`);
      return response;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch pair:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Search for pairs matching a query
   * @param {string} query - Search query (e.g., 'SOL/USDC')
   * @returns {Promise<Object>} - Search results
   */
  async searchPairs(query) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('SEARCHING')} for pairs matching "${query}"`);
      
      const response = await this.makeRequest(
        'GET', 
        this.config.endpoints.pairs.search,
        'enhanced',
        null,
        { q: query }
      );
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully searched for pairs')}`);
      return response;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to search for pairs:')} ${error.message}`);
      throw error;
    }
  }
}

/**
 * Token Pairs Service
 */
class TokenPairsService extends DexScreenerBase {
  constructor(config) {
    super(config, 'dexscreener:token:pairs:');
  }
  
  /**
   * Get pools/pairs for a token
   * @param {string} chainId - Blockchain ID (e.g., 'solana')
   * @param {string} tokenAddress - Token address
   * @returns {Promise<Object>} - Token pools data
   */
  async getPoolsByToken(chainId, tokenAddress) {
    try {
      // No longer log individual token fetch operations to reduce log spam
      const endpoint = this.config.endpoints.tokenPairs.getPoolsByToken(chainId, tokenAddress);
      const response = await this.makeRequest('GET', endpoint, 'enhanced');
      return response;
    } catch (error) {
      // Still log errors, but don't log successful operations
      // Use enhanced token formatting with chainId parameter for better error logs
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch pools for token:')} ${formatLog.token(tokenAddress, chainId)} - ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get pools for multiple tokens with rate limiting
   * @param {string} chainId - Blockchain ID (e.g., 'solana')
   * @param {string[]} tokenAddresses - Array of token addresses
   * @returns {Promise<Object>} - Pool data by token address
   */
  async getPoolsForMultipleTokens(chainId, tokenAddresses) {
    try {
      // Initial log with token count
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} pools for ${formatLog.count(tokenAddresses.length)} tokens (all timeframes)`);
      
      const results = {};
      let successCount = 0;
      let failureCount = 0;
      let startTime = Date.now();
      
      // Create a buffer of tokens being processed to reduce logging
      const batchSize = 50;
      const tokenBatches = [];
      
      // Split tokens into batches for consolidated logging
      for (let i = 0; i < tokenAddresses.length; i += batchSize) {
        tokenBatches.push(tokenAddresses.slice(i, i + batchSize));
      }
      
      // Process token batches
      for (let batchIndex = 0; batchIndex < tokenBatches.length; batchIndex++) {
        const batch = tokenBatches[batchIndex];
        const batchStart = Date.now();
        const batchStartCount = successCount;
        let batchFailures = 0;
        
        // Process tokens in this batch
        for (const tokenAddress of batch) {
          try {
            // Get pools without logging each individual request
            const tokenPools = await this.getPoolsByToken(chainId, tokenAddress);
            results[tokenAddress] = tokenPools;
            successCount++;
          } catch (error) {
            failureCount++;
            batchFailures++;
            results[tokenAddress] = { error: error.message };
            
            // Only log first few errors in detail
            if (failureCount <= 3) {
              logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error fetching pools for token ${tokenAddress}:`)} ${error.message}`);
            } else if (failureCount === 4) {
              logApi.warn(`${formatLog.tag()} ${formatLog.warning('Additional errors occurring, suppressing detailed logs')}`);
            }
          }
        }
        
        // Log once per batch with meaningful stats
        const processed = (batchIndex + 1) * batchSize > tokenAddresses.length ? 
            tokenAddresses.length : (batchIndex + 1) * batchSize;
        const progress = Math.round((processed / tokenAddresses.length) * 100);
        const batchTime = ((Date.now() - batchStart) / 1000).toFixed(1);
        const tokensPerSec = ((successCount - batchStartCount) / (batchTime || 1)).toFixed(1);
        
        logApi.info(`${formatLog.tag()} Progress: ${progress}% (${processed}/${tokenAddresses.length}) - ${tokensPerSec} tokens/sec${batchFailures > 0 ? ` - ${batchFailures} failures in batch` : ''}`);
      }
      
      // Final summary with performance stats
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const avgRate = (successCount / (totalTime || 1)).toFixed(1);
      
      if (failureCount > 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.success(`Completed in ${totalTime}s at ${avgRate} tokens/sec. Successfully fetched ${successCount} tokens`)} - ${formatLog.warning(`${failureCount} failures`)}`);
      } else {
        logApi.info(`${formatLog.tag()} ${formatLog.success(`Completed in ${totalTime}s at ${avgRate} tokens/sec. Successfully fetched all ${successCount} tokens`)}`);
      }
      
      return results;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch pools for multiple tokens:')} ${error.message}`);
      throw error;
    }
  }
}

/**
 * DexScreener Client for fetching token data from DexScreener
 */
class DexScreenerClient {
  constructor() {
    this.config = dexscreenerConfig;
    this.initialized = false;
    
    // Create service modules
    this.tokenProfiles = new TokenProfilesService(this.config);
    this.tokenBoosts = new TokenBoostsService(this.config);
    this.orders = new OrdersService(this.config);
    this.pairs = new PairsService(this.config);
    this.tokenPairs = new TokenPairsService(this.config);
  }
  
  /**
   * Initialize the DexScreener client
   */
  async initialize() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} DexScreener client`);
      
      // Nothing special needed for initialization, just mark as initialized
      this.initialized = true;
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('DexScreener client initialized successfully')}`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize DexScreener client:')} ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get latest token profiles
   */
  async getLatestTokenProfiles() {
    return this.tokenProfiles.getLatestProfiles();
  }
  
  /**
   * Get latest token boosts
   */
  async getLatestTokenBoosts() {
    return this.tokenBoosts.getLatestBoosts();
  }
  
  /**
   * Get top tokens with boosts
   */
  async getTopTokenBoosts() {
    return this.tokenBoosts.getTopBoosts();
  }
  
  /**
   * Get orders for a token
   * @param {string} chainId - Blockchain ID (e.g., 'solana')
   * @param {string} tokenAddress - Token address
   */
  async getOrdersByToken(chainId, tokenAddress) {
    return this.orders.getOrdersByToken(chainId, tokenAddress);
  }
  
  /**
   * Get details for a trading pair
   * @param {string} chainId - Blockchain ID (e.g., 'solana')
   * @param {string} pairId - Pair ID/address
   */
  async getPairDetails(chainId, pairId) {
    return this.pairs.getPairByAddress(chainId, pairId);
  }
  
  /**
   * Search for pairs matching a query
   * @param {string} query - Search query (e.g., 'SOL/USDC')
   */
  async searchPairs(query) {
    return this.pairs.searchPairs(query);
  }
  
  /**
   * Get pools for a token
   * @param {string} chainId - Blockchain ID (e.g., 'solana')
   * @param {string} tokenAddress - Token address
   */
  async getTokenPools(chainId, tokenAddress) {
    return this.tokenPairs.getPoolsByToken(chainId, tokenAddress);
  }
  
  /**
   * Get pools for multiple tokens
   * @param {string} chainId - Blockchain ID (e.g., 'solana')
   * @param {string[]} tokenAddresses - Array of token addresses
   */
  async getMultipleTokenPools(chainId, tokenAddresses) {
    return this.tokenPairs.getPoolsForMultipleTokens(chainId, tokenAddresses);
  }
}

// Create and export a singleton instance
export const dexscreenerClient = new DexScreenerClient();
export default dexscreenerClient;