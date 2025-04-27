/**
 * Jupiter Data Collector
 * 
 * This module provides functionality to collect token data from Jupiter API.
 * Jupiter is used primarily for token discovery and basic price information.
 * 
 * @module services/token-enrichment/collectors/jupiterCollector
 */

import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import { getJupiterClient, jupiterClient } from '../../solana-engine/jupiter-client.js';

// Cache collector to avoid redundant API calls
const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes
const dataCache = new Map();

class JupiterCollector {
  constructor() {
    // We'll use the centralized Jupiter client from solana-engine
    this.jupiterClient = null;
  }

  /**
   * Initialize the collector
   */
  async initialize() {
    try {
      // Get Jupiter client from solana-engine
      this.jupiterClient = jupiterClient.initialized ? jupiterClient : getJupiterClient();
      
      if (!this.jupiterClient.initialized) {
        await this.jupiterClient.initialize();
      }
      
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error initializing:${fancyColors.RESET}`, error);
      return false;
    }
  }

  /**
   * Get token information from Jupiter
   * @param {string} tokenAddress - Solana token address
   * @returns {Promise<Object>} Token data from Jupiter
   */
  async getTokenInfo(tokenAddress) {
    try {
      // Check cache first
      const cacheKey = `token_${tokenAddress}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      // Ensure collector is initialized
      if (!this.jupiterClient || !this.jupiterClient.initialized) {
        await this.initialize();
      }

      // Get token information
      const tokenInfo = await this.jupiterClient.getTokenInfo(tokenAddress);
      
      if (tokenInfo) {
        // Process into standard format
        const processedData = this.processTokenInfo(tokenInfo);
        
        // Cache the results
        this.cacheData(cacheKey, processedData);
        
        return processedData;
      }
      
      return null;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token info:${fancyColors.RESET}`, error);
      return null;
    }
  }

  /**
   * Get token price from Jupiter
   * @param {string} tokenAddress - Solana token address
   * @returns {Promise<Object>} Token price data from Jupiter
   */
  async getTokenPrice(tokenAddress) {
    try {
      // Check cache first
      const cacheKey = `price_${tokenAddress}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      // Ensure collector is initialized
      if (!this.jupiterClient || !this.jupiterClient.initialized) {
        await this.initialize();
      }

      // Get token price
      const priceData = await this.jupiterClient.getTokenPrice(tokenAddress);
      
      if (priceData) {
        // Process price data
        const processedData = {
          price: priceData.price || 0,
          lastUpdated: new Date().toISOString()
        };
        
        // Cache the results
        this.cacheData(cacheKey, processedData);
        
        return processedData;
      }
      
      return null;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token price:${fancyColors.RESET}`, error);
      return null;
    }
  }

  /**
   * Check if token exists in Jupiter's token list
   * @param {string} tokenAddress - Solana token address
   * @returns {Promise<boolean>} True if token exists in Jupiter's list
   */
  async checkTokenExists(tokenAddress) {
    try {
      // Ensure collector is initialized
      if (!this.jupiterClient || !this.jupiterClient.initialized) {
        await this.initialize();
      }

      // Get the token list
      const tokenList = await this.jupiterClient.tokenList;
      
      // Check if token exists in the list
      const tokenExists = tokenList.some(token => {
        // Handle different Jupiter token list formats
        if (typeof token === 'string') {
          return token === tokenAddress;
        } else if (typeof token === 'object' && token !== null) {
          return token.address === tokenAddress;
        }
        return false;
      });
      
      return tokenExists;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error checking if token exists:${fancyColors.RESET}`, error);
      return false;
    }
  }

  /**
   * Process token information from Jupiter
   * @param {Object} tokenInfo - Raw Jupiter token information
   * @returns {Object} Processed token information
   */
  processTokenInfo(tokenInfo) {
    if (!tokenInfo) {
      return null;
    }

    // Extract relevant data
    return {
      address: tokenInfo.address || tokenInfo.mint || '',
      name: tokenInfo.name || '',
      symbol: tokenInfo.symbol || '',
      decimals: tokenInfo.decimals || 0,
      logoURI: tokenInfo.logoURI || null,
      tags: tokenInfo.tags || []
    };
  }

  /**
   * Cache data with expiration
   * @param {string} key - Cache key
   * @param {any} data - Data to cache
   */
  cacheData(key, data) {
    dataCache.set(key, {
      data,
      expiry: Date.now() + CACHE_EXPIRY
    });
  }

  /**
   * Get cached data if not expired
   * @param {string} key - Cache key
   * @returns {any|null} Cached data or null if expired/not found
   */
  getCachedData(key) {
    const cached = dataCache.get(key);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }
    
    if (cached) {
      // Remove expired cache entry
      dataCache.delete(key);
    }
    
    return null;
  }

  /**
   * Clear expired cache entries
   */
  cleanCache() {
    const now = Date.now();
    for (const [key, value] of dataCache.entries()) {
      if (value.expiry < now) {
        dataCache.delete(key);
      }
    }
  }
}

// Create and export singleton instance
const jupiterCollector = new JupiterCollector();
export default jupiterCollector;