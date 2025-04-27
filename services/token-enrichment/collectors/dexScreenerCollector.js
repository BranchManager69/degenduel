/**
 * DexScreener Data Collector
 * 
 * This module provides functionality to collect token data from DexScreener API.
 * DexScreener provides rich market data including price, volume, liquidity, and
 * token social information.
 * 
 * @module services/token-enrichment/collectors/dexScreenerCollector
 */

import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import axios from 'axios';
import { config } from '../../../config/config.js';

// Cache collector to avoid redundant API calls
const CACHE_EXPIRY = 10 * 60 * 1000; // 10 minutes
const dataCache = new Map();

class DexScreenerCollector {
  constructor() {
    this.apiBaseUrl = 'https://api.dexscreener.com/latest/dex';
    this.axiosInstance = axios.create({
      baseURL: this.apiBaseUrl,
      timeout: 20000, // 20 seconds
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DegenDuel Token Enrichment Service'
      }
    });
  }

  /**
   * Get token data from DexScreener by address
   * @param {string} tokenAddress - Solana token address
   * @returns {Promise<Object>} Token data from DexScreener
   */
  async getTokenByAddress(tokenAddress) {
    try {
      // Check cache first
      const cacheKey = `address_${tokenAddress}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      // Make API request
      const response = await this.axiosInstance.get(`/tokens/solana/${tokenAddress}`);
      
      // Process response
      if (response.data && response.data.pairs && response.data.pairs.length > 0) {
        const data = this.processTokenData(response.data);
        
        // Cache the results
        this.cacheData(cacheKey, data);
        
        return data;
      }
      
      return null;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token by address:${fancyColors.RESET}`, error);
      return null;
    }
  }

  /**
   * Search for tokens on DexScreener by name or symbol
   * @param {string} query - Search query (name or symbol)
   * @returns {Promise<Array>} Array of matching tokens
   */
  async searchTokens(query) {
    try {
      // Check cache first
      const cacheKey = `search_${query}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      // Make API request
      const response = await this.axiosInstance.get(`/search?q=${encodeURIComponent(query)}&chain=solana`);
      
      // Process response
      if (response.data && response.data.pairs) {
        const tokens = response.data.pairs.map(pair => this.processPairData(pair));
        
        // Cache the results
        this.cacheData(cacheKey, tokens);
        
        return tokens;
      }
      
      return [];
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error searching tokens:${fancyColors.RESET}`, error);
      return [];
    }
  }

  /**
   * Process token data from DexScreener response
   * @param {Object} responseData - Raw DexScreener response
   * @returns {Object} Processed token data
   */
  processTokenData(responseData) {
    // If no pairs found, return null
    if (!responseData.pairs || responseData.pairs.length === 0) {
      return null;
    }

    // Find the best pair (highest liquidity)
    const pairs = responseData.pairs;
    pairs.sort((a, b) => {
      const liquidityA = parseFloat(a.liquidity?.usd || 0);
      const liquidityB = parseFloat(b.liquidity?.usd || 0);
      return liquidityB - liquidityA;
    });

    // Get the best pair
    const bestPair = pairs[0];
    
    // Extract token data
    const tokenData = this.processPairData(bestPair);
    
    // Add all available pools
    tokenData.pools = pairs.map(pair => ({
      name: pair.dexId,
      address: pair.pairAddress,
      liquidity: parseFloat(pair.liquidity?.usd || 0),
      volume24h: parseFloat(pair.volume?.h24 || 0),
      price: parseFloat(pair.priceUsd || 0)
    }));
    
    return tokenData;
  }

  /**
   * Process pair data from DexScreener
   * @param {Object} pair - DexScreener pair data
   * @returns {Object} Processed token data
   */
  processPairData(pair) {
    const tokenData = {
      address: pair.baseToken?.address || '',
      name: pair.baseToken?.name || '',
      symbol: pair.baseToken?.symbol || '',
      price: parseFloat(pair.priceUsd || 0),
      priceChange24h: parseFloat(pair.priceChange?.h24 || 0),
      volume24h: parseFloat(pair.volume?.h24 || 0),
      liquidity: parseFloat(pair.liquidity?.usd || 0),
      fdv: parseFloat(pair.fdv || 0),
      marketCap: parseFloat(pair.marketCap || 0),
      pairAddress: pair.pairAddress,
      dex: pair.dexId,
      url: `https://dexscreener.com/solana/${pair.pairAddress}`,
      socials: {}
    };

    // Extract social links
    if (pair.links) {
      if (pair.links.website) tokenData.socials.website = pair.links.website;
      if (pair.links.twitter) tokenData.socials.twitter = pair.links.twitter;
      if (pair.links.telegram) tokenData.socials.telegram = pair.links.telegram;
      if (pair.links.discord) tokenData.socials.discord = pair.links.discord;
      if (pair.links.medium) tokenData.socials.medium = pair.links.medium;
    }

    return tokenData;
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
const dexScreenerCollector = new DexScreenerCollector();
export default dexScreenerCollector;