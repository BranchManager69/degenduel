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
   * Get token information for multiple addresses in a single batch request
   * @param {string[]} tokenAddresses - Array of Solana token addresses
   * @returns {Promise<Object>} Map of token addresses to their data
   */
  async getTokenInfoBatch(tokenAddresses) {
    try {
      if (!Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
        return {};
      }
      
      logApi.info(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} Fetching batch token info for ${tokenAddresses.length} tokens`);
      
      // Group addresses into chunks of 100 (Jupiter's limit)
      const BATCH_SIZE = 100; // Jupiter's API limit
      const results = {};
      
      // Check cache first for all tokens
      const uncachedAddresses = [];
      
      // First check which tokens we already have in cache
      for (const address of tokenAddresses) {
        const cacheKey = `token_${address}`;
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
      
      // Ensure collector is initialized
      if (!this.jupiterClient || !this.jupiterClient.initialized) {
        await this.initialize();
      }
      
      // For uncached tokens, process in batches
      // Process in chunks to comply with API limits
      const chunks = [];
      for (let i = 0; i < uncachedAddresses.length; i += BATCH_SIZE) {
        chunks.push(uncachedAddresses.slice(i, i + BATCH_SIZE));
      }
      
      // Process each batch using Jupiter's batch API
      for (const chunk of chunks) {
        try {
          // Get the prices/data for this batch from Jupiter
          const batchPrices = await this.jupiterClient.getPrices(chunk);
          
          // Loop through token addresses in this chunk
          for (const address of chunk) {
            // Look up individual token info from Jupiter's token map
            const tokenInfo = this.jupiterClient.getTokenInfo(address);
            
            if (tokenInfo) {
              // Process and merge with price data (if available)
              const processedData = this.processTokenInfo(tokenInfo);
              
              // Add price data if available
              if (batchPrices && batchPrices[address]) {
                processedData.price = batchPrices[address].price || 0;
                processedData.priceTimestamp = Date.now();
              }
              
              // Cache and store the result
              results[address] = processedData;
              this.cacheData(`token_${address}`, processedData);
            } else {
              logApi.debug(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} No token info found for ${address} in batch`);
            }
          }
        } catch (batchError) {
          logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ⚠️ BATCH FAILURE ⚠️ ${fancyColors.RESET} Error with Jupiter batch processing for ${chunk.length} tokens:`, batchError);
          
          // Fall back to individual processing if batch fails
          logApi.warn(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.YELLOW}Falling back to individual API calls for ${chunk.length} tokens${fancyColors.RESET}`);
          
          let fallbackSuccess = 0;
          let fallbackFailed = 0;
          
          for (const address of chunk) {
            try {
              const tokenData = await this.getTokenInfo(address);
              if (tokenData) {
                results[address] = tokenData;
                fallbackSuccess++;
              } else {
                fallbackFailed++;
              }
            } catch (individualError) {
              logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error in fallback for token ${address}:${fancyColors.RESET}`, individualError);
              fallbackFailed++;
            }
          }
          
          logApi.warn(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} FALLBACK SUMMARY ${fancyColors.RESET} Jupiter individual fallbacks: ${fallbackSuccess} success, ${fallbackFailed} failed`)
        }
        
        // Add a small delay between chunks to avoid rate limits
        if (chunks.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      return results;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching batch token info:${fancyColors.RESET}`, error);
      return {};
    }
  }

  /**
   * Get token information for multiple tokens in a batch
   * @param {string[]} tokenAddresses - Array of Solana token addresses
   * @returns {Promise<Object>} Map of token addresses to token data
   */
  async getTokenInfoBatch(tokenAddresses) {
    try {
      if (!tokenAddresses || !Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
        return {};
      }

      logApi.info(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} Fetching batch token info for ${tokenAddresses.length} tokens`);
      
      // Check cache first and collect missing tokens
      const results = {};
      const missingTokens = [];

      for (const address of tokenAddresses) {
        const cacheKey = `token_${address}`;
        const cachedData = this.getCachedData(cacheKey);
        
        if (cachedData) {
          results[address] = cachedData;
        } else {
          missingTokens.push(address);
        }
      }

      // If all tokens were in cache, return results
      if (missingTokens.length === 0) {
        logApi.info(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} All ${tokenAddresses.length} tokens found in cache`);
        return results;
      }

      // Ensure collector is initialized
      if (!this.jupiterClient || !this.jupiterClient.initialized) {
        await this.initialize();
      }

      // Process missing tokens in chunks (Jupiter's limit is 100 tokens per request)
      const CHUNK_SIZE = 100;
      const chunks = this.chunkArray(missingTokens, CHUNK_SIZE);
      
      logApi.info(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} Fetching ${missingTokens.length} tokens in ${chunks.length} batch(es)`);
      
      // Get token information for each chunk
      for (const [index, chunk] of chunks.entries()) {
        try {
          // Get tokenList from Jupiter client and filter to the chunk tokens
          const tokenMap = this.jupiterClient.tokenMap || {};
          
          // Extract information for each token in the chunk
          for (const address of chunk) {
            const tokenInfo = tokenMap[address];
            if (tokenInfo) {
              // Process into standard format
              const processedData = this.processTokenInfo(tokenInfo);
              
              // Cache the results
              this.cacheData(`token_${address}`, processedData);
              
              // Add to results
              results[address] = processedData;
            } else {
              // Individual fallback if token not in map
              try {
                const individualTokenInfo = await this.jupiterClient.getTokenInfo(address);
                if (individualTokenInfo) {
                  const processedData = this.processTokenInfo(individualTokenInfo);
                  this.cacheData(`token_${address}`, processedData);
                  results[address] = processedData;
                }
              } catch (individualError) {
                logApi.debug(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching individual token ${address}:${fancyColors.RESET}`, individualError);
              }
            }
          }
          
          logApi.debug(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} Processed batch ${index + 1}/${chunks.length} (${chunk.length} tokens)`);
        } catch (chunkError) {
          logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token batch ${index + 1}:${fancyColors.RESET}`, chunkError);
          
          // Individual fallback for each token in the failed chunk
          for (const address of chunk) {
            try {
              const individualResult = await this.getTokenInfo(address);
              if (individualResult) {
                results[address] = individualResult;
              }
            } catch (individualError) {
              logApi.debug(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching individual token ${address}:${fancyColors.RESET}`, individualError);
            }
          }
        }
      }

      // Log summary
      const successCount = Object.keys(results).length;
      logApi.info(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} Successfully fetched ${successCount}/${tokenAddresses.length} tokens in batch`);
      
      return results;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error in batch token info:${fancyColors.RESET}`, error);
      return {};
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
const jupiterCollector = new JupiterCollector();
export default jupiterCollector;