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
      logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token by address:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      logApi.debug(`[DexScreenerCollector] Error details: Status ${error?.response?.status || 'unknown'}, URL: ${error?.config?.url || 'unknown'}`);
      return null;
    }
  }
  
  /**
   * Get token data for multiple addresses in a batch
   * @param {string[]} tokenAddresses - Array of token addresses to fetch
   * @returns {Promise<Object>} Map of token addresses to their data
   */
  async getTokensByAddressBatch(tokenAddresses) {
    try {
      if (!Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
        return {};
      }
      
      logApi.info(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} Fetching batch token data for ${tokenAddresses.length} tokens`);
      
      // First check cache for all tokens
      const results = {};
      const uncachedAddresses = [];
      
      for (const address of tokenAddresses) {
        const cacheKey = `address_${address}`;
        const cachedData = this.getCachedData(cacheKey);
        
        if (cachedData) {
          results[address] = cachedData;
        } else {
          uncachedAddresses.push(address);
        }
      }
      
      // If all tokens were cached, return immediately
      if (uncachedAddresses.length === 0) {
        return results;
      }
      
      // DexScreener doesn't have a true batch API, but we can optimize with smaller parallel batches
      // Using chunks of 10 tokens per batch to avoid overwhelming the API
      const BATCH_SIZE = 10;
      
      // Split into batches
      const batches = [];
      for (let i = 0; i < uncachedAddresses.length; i += BATCH_SIZE) {
        batches.push(uncachedAddresses.slice(i, i + BATCH_SIZE));
      }
      
      // Process each batch with parallel requests
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        try {
          // Process all tokens in this batch concurrently
          const batchPromises = batch.map(address => this.getTokenByAddress(address));
          const batchResults = await Promise.all(batchPromises);
          
          // Add results to the main results object
          batch.forEach((address, index) => {
            if (batchResults[index]) {
              results[address] = batchResults[index];
            }
          });
          
        } catch (batchError) {
          logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ⚠️ BATCH FAILURE ⚠️ ${fancyColors.RESET} Error with DexScreener batch ${i+1}/${batches.length} for ${batch.length} tokens: ${batchError.message || 'Unknown error'}`);
          
          // Fall back to sequential processing for failed batch
          logApi.warn(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.YELLOW}Falling back to sequential API calls for ${batch.length} tokens${fancyColors.RESET}`);
          
          let fallbackSuccess = 0;
          let fallbackFailed = 0;
          
          for (const address of batch) {
            try {
              const tokenData = await this.getTokenByAddress(address);
              if (tokenData) {
                results[address] = tokenData;
                fallbackSuccess++;
              } else {
                fallbackFailed++;
              }
            } catch (individualError) {
              logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error in fallback for token ${address}:${fancyColors.RESET} ${individualError.message || 'Unknown error'}`);
              fallbackFailed++;
            }
            
            // Add a small delay between requests to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          logApi.warn(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} FALLBACK SUMMARY ${fancyColors.RESET} DexScreener sequential fallbacks: ${fallbackSuccess} success, ${fallbackFailed} failed`)
        }
        
        // Add a pause between batches to respect DexScreener's stricter rate limits
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      return results;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error in batch token fetch:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      return {};
    }
  }

  /**
   * Get token data for multiple tokens in a batch
   * @param {string[]} tokenAddresses - Array of Solana token addresses
   * @returns {Promise<Object>} Map of token addresses to token data
   */
  async getTokensByAddressBatch(tokenAddresses) {
    try {
      if (!tokenAddresses || !Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
        return {};
      }

      logApi.info(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} Fetching batch token data for ${tokenAddresses.length} tokens`);
      
      // Check cache first and collect missing tokens
      const results = {};
      const missingTokens = [];

      for (const address of tokenAddresses) {
        const cacheKey = `address_${address}`;
        const cachedData = this.getCachedData(cacheKey);
        
        if (cachedData) {
          results[address] = cachedData;
        } else {
          missingTokens.push(address);
        }
      }

      // If all tokens were in cache, return results
      if (missingTokens.length === 0) {
        logApi.info(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} All ${tokenAddresses.length} tokens found in cache`);
        return results;
      }

      // DexScreener doesn't have a true batch endpoint, but we can optimize with parallel requests
      // Group missing tokens into chunks of 10 (reasonable for parallel processing)
      const CHUNK_SIZE = 10; // Lower to avoid rate limiting
      const chunks = this.chunkArray(missingTokens, CHUNK_SIZE);
      
      logApi.info(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} Fetching ${missingTokens.length} tokens in ${chunks.length} batch(es)`);
      
      // Process each chunk with parallel requests
      for (const [index, chunk] of chunks.entries()) {
        try {
          // Create array of promises for parallel execution
          const tokenPromises = chunk.map(address => {
            return this.getTokenByAddress(address)
              .then(data => {
                if (data) {
                  // Already cached inside getTokenByAddress
                  results[address] = data;
                }
                return { address, success: !!data };
              })
              .catch(error => {
                logApi.debug(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token ${address}:${fancyColors.RESET}`, error.message);
                return { address, success: false, error: error.message };
              });
          });
          
          // Wait for all promises in the chunk to complete
          const chunkResults = await Promise.all(tokenPromises);
          
          // Log chunk completion
          const successCount = chunkResults.filter(r => r.success).length;
          logApi.debug(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} Processed batch ${index + 1}/${chunks.length}: ${successCount}/${chunk.length} successful`);
          
          // Add delay between chunks to avoid rate limiting
          if (index < chunks.length - 1) {
            await this.sleep(1000); // DexScreener has stricter rate limits
          }
        } catch (chunkError) {
          logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error processing chunk ${index + 1}:${fancyColors.RESET} ${chunkError.message || 'Unknown error'}`);
        }
      }

      // Log summary
      const successCount = Object.keys(results).length;
      logApi.info(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} Successfully fetched ${successCount}/${tokenAddresses.length} tokens in batch`);
      
      return results;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error in batch token processing:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      return {};
    }
  }

  /**
   * Helper method to add delay
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
      logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error searching tokens:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
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
   * Helper method to split an array into chunks
   * @param {Array} array - The array to split
   * @param {number} chunkSize - Size of each chunk
   * @returns {Array[]} Array of chunks
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
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