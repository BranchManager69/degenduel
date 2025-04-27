/**
 * Helius Data Collector
 * 
 * This module provides functionality to collect token data directly from Helius API.
 * Helius provides on-chain data including token supply, metadata, and creator information.
 * 
 * @module services/token-enrichment/collectors/heliusCollector
 */

import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import { heliusClient } from '../../solana-engine/helius-client.js';

// Cache collector to avoid redundant API calls
const CACHE_EXPIRY = 15 * 60 * 1000; // 15 minutes
const dataCache = new Map();

class HeliusCollector {
  constructor() {
    // We'll use the centralized Helius client from solana-engine
    this.heliusClient = heliusClient;
  }

  /**
   * Get token metadata from Helius
   * @param {string} tokenAddress - Solana token address
   * @returns {Promise<Object>} Token metadata from Helius
   */
  async getTokenMetadata(tokenAddress) {
    try {
      // Check cache first
      const cacheKey = `metadata_${tokenAddress}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      // Ensure Helius client is initialized
      if (!this.heliusClient.initialized) {
        await this.heliusClient.initialize();
      }

      // Get token metadata
      const metadata = await this.heliusClient.getTokenMetadata(tokenAddress);
      
      if (metadata) {
        // Process into standard format
        const processedData = this.processTokenMetadata(metadata);
        
        // Cache the results
        this.cacheData(cacheKey, processedData);
        
        return processedData;
      }
      
      return null;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token metadata:${fancyColors.RESET}`, error);
      return null;
    }
  }

  /**
   * Get token balance and supply information
   * @param {string} tokenAddress - Solana token address
   * @returns {Promise<Object>} Token supply data
   */
  async getTokenSupply(tokenAddress) {
    try {
      // Check cache first
      const cacheKey = `supply_${tokenAddress}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      // Ensure Helius client is initialized
      if (!this.heliusClient.initialized) {
        await this.heliusClient.initialize();
      }

      // Get token supply information
      const supplyData = await this.heliusClient.getTokenSupply(tokenAddress);
      
      if (supplyData) {
        // Process data
        const processedData = {
          decimals: supplyData.decimals || 0,
          totalSupply: supplyData.amount ? parseInt(supplyData.amount, 10) : 0,
          circulatingSupply: null, // Helius doesn't provide this directly
          maxSupply: null // Helius doesn't provide this directly
        };
        
        // Cache the results
        this.cacheData(cacheKey, processedData);
        
        return processedData;
      }
      
      return null;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token supply:${fancyColors.RESET}`, error);
      return null;
    }
  }

  /**
   * Process token metadata from Helius response
   * @param {Object} metadata - Raw Helius metadata
   * @returns {Object} Processed token metadata
   */
  processTokenMetadata(metadata) {
    if (!metadata) {
      return null;
    }

    // Extract relevant data
    return {
      address: metadata.mint || '',
      name: metadata.name || '',
      symbol: metadata.symbol || '',
      decimals: metadata.decimals || 0,
      imageUrl: metadata.image || null,
      description: metadata.description || null,
      tokenStandard: metadata.tokenStandard || null,
      metadataUri: metadata.metadataUri || null,
      socials: this.extractSocialsFromMetadata(metadata)
    };
  }

  /**
   * Extract social links from metadata
   * @param {Object} metadata - Token metadata
   * @returns {Object} Social links
   */
  extractSocialsFromMetadata(metadata) {
    const socials = {};
    
    // Check for social links in the metadata externalUrl field
    if (metadata.externalUrl) {
      socials.website = metadata.externalUrl;
    }
    
    // Check for social links in the metadata extensions
    if (metadata.extensions) {
      if (metadata.extensions.twitter) socials.twitter = metadata.extensions.twitter;
      if (metadata.extensions.discord) socials.discord = metadata.extensions.discord;
      if (metadata.extensions.telegram) socials.telegram = metadata.extensions.telegram;
      if (metadata.extensions.medium) socials.medium = metadata.extensions.medium;
    }
    
    return socials;
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
const heliusCollector = new HeliusCollector();
export default heliusCollector;