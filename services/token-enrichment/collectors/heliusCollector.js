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
   * Get token metadata for multiple tokens in a batch
   * @param {string[]} tokenAddresses - Array of token addresses to fetch metadata for
   * @returns {Promise<Object>} - Map of token addresses to their metadata
   */
  async getTokenMetadataBatch(tokenAddresses) {
    try {
      if (!Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
        return {};
      }
      
      logApi.info(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} Fetching batch token metadata for ${tokenAddresses.length} tokens`);
      
      // Check cache first for all tokens
      const results = {};
      const uncachedAddresses = [];
      
      // First check which tokens we already have in cache
      for (const address of tokenAddresses) {
        const cacheKey = `metadata_${address}`;
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
      
      // Ensure Helius client is initialized
      if (!this.heliusClient.initialized) {
        await this.heliusClient.initialize();
      }
      
      // Helius supports up to 100 tokens in a single batch request
      const BATCH_SIZE = 100;
      
      // Split into batches for processing
      const batches = [];
      for (let i = 0; i < uncachedAddresses.length; i += BATCH_SIZE) {
        batches.push(uncachedAddresses.slice(i, i + BATCH_SIZE));
      }
      
      // Process each batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        try {
          // Use Helius's batch tokens endpoint
          const metadataArray = await this.heliusClient.getTokensMetadata(batch);
          
          // Process each token in the batch
          if (metadataArray && Array.isArray(metadataArray)) {
            for (const metadata of metadataArray) {
              if (metadata && metadata.mint) {
                const address = metadata.mint;
                const processedData = this.processTokenMetadata(metadata);
                
                // Cache and add to results
                if (processedData) {
                  results[address] = processedData;
                  this.cacheData(`metadata_${address}`, processedData);
                }
              }
            }
          }
        } catch (batchError) {
          logApi.error(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ⚠️ BATCH FAILURE ⚠️ ${fancyColors.RESET} Error with Helius batch ${i+1}/${batches.length} for ${batch.length} tokens:`, batchError);
          
          // Fall back to individual processing if batch fails
          logApi.warn(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.YELLOW}Falling back to individual API calls for ${batch.length} tokens${fancyColors.RESET}`);
          
          let fallbackSuccess = 0;
          let fallbackFailed = 0;
          
          for (const address of batch) {
            try {
              const tokenMetadata = await this.getTokenMetadata(address);
              if (tokenMetadata) {
                results[address] = tokenMetadata;
                fallbackSuccess++;
              } else {
                fallbackFailed++;
              }
            } catch (individualError) {
              logApi.error(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.RED}Error in fallback for token ${address}:${fancyColors.RESET}`, individualError);
              fallbackFailed++;
            }
          }
          
          logApi.warn(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} FALLBACK SUMMARY ${fancyColors.RESET} Helius individual fallbacks: ${fallbackSuccess} success, ${fallbackFailed} failed`)
        }
        
        // Add a small delay between batches to avoid rate limits
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      return results;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching batch token metadata:${fancyColors.RESET}`, error);
      return {};
    }
  }

  /**
   * Get token metadata for multiple tokens in a batch
   * @param {string[]} tokenAddresses - Array of Solana token addresses
   * @returns {Promise<Object>} Map of token addresses to token metadata
   */
  async getTokenMetadataBatch(tokenAddresses) {
    try {
      if (!tokenAddresses || !Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
        return {};
      }

      logApi.info(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} Fetching batch token metadata for ${tokenAddresses.length} tokens`);
      
      // Check cache first and collect missing tokens
      const results = {};
      const missingTokens = [];

      for (const address of tokenAddresses) {
        const cacheKey = `metadata_${address}`;
        const cachedData = this.getCachedData(cacheKey);
        
        if (cachedData) {
          results[address] = cachedData;
        } else {
          missingTokens.push(address);
        }
      }

      // If all tokens were in cache, return results
      if (missingTokens.length === 0) {
        logApi.info(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} All ${tokenAddresses.length} tokens found in cache`);
        return results;
      }

      // Ensure Helius client is initialized
      if (!this.heliusClient.initialized) {
        await this.heliusClient.initialize();
      }

      // Process missing tokens in chunks (Helius limit is 100 tokens per request)
      const CHUNK_SIZE = 100;
      const chunks = this.chunkArray(missingTokens, CHUNK_SIZE);
      
      logApi.info(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} Fetching ${missingTokens.length} tokens in ${chunks.length} batch(es)`);
      
      // Get token metadata for each chunk
      for (const [index, chunk] of chunks.entries()) {
        try {
          // Use the batch method from Helius client
          const batchMetadata = await this.heliusClient.getTokensMetadata(chunk);
          
          if (batchMetadata && Array.isArray(batchMetadata)) {
            // Process and cache each token's metadata
            for (const metadata of batchMetadata) {
              if (metadata && metadata.mint) {
                const address = metadata.mint;
                const processedData = this.processTokenMetadata(metadata);
                
                if (processedData) {
                  // Cache the results
                  this.cacheData(`metadata_${address}`, processedData);
                  
                  // Add to results
                  results[address] = processedData;
                }
              }
            }
          }
          
          logApi.debug(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} Processed batch ${index + 1}/${chunks.length} (${chunk.length} tokens)`);
        } catch (chunkError) {
          logApi.error(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching metadata batch ${index + 1}:${fancyColors.RESET}`, chunkError);
          
          // Individual fallback for each token in the failed chunk
          for (const address of chunk) {
            try {
              const individualResult = await this.getTokenMetadata(address);
              if (individualResult) {
                results[address] = individualResult;
              }
            } catch (individualError) {
              logApi.debug(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching individual token ${address}:${fancyColors.RESET}`, individualError);
            }
          }
        }
        
        // Add a small delay between chunks to avoid rate limiting
        if (index < chunks.length - 1) {
          await this.sleep(200);
        }
      }

      // Log summary
      const successCount = Object.keys(results).length;
      logApi.info(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} Successfully fetched ${successCount}/${tokenAddresses.length} tokens in batch`);
      
      return results;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.RED}Error in batch token metadata:${fancyColors.RESET}`, error);
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
const heliusCollector = new HeliusCollector();
export default heliusCollector;