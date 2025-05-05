// services/token-enrichment/collectors/dexScreenerCollector.js

/**
 * DexScreener Data Collector
 * @module services/token-enrichment/collectors/dexScreenerCollector
 * 
 * This module provides functionality to collect token data from DexScreener API.
 * DexScreener provides rich market data including price, volume, liquidity, and
 * token social information.
 * 
 * @author BranchManager69
 * @version 2.0.0
 * @created 2025-04-28
 * @updated 2025-05-02
 */

import axios from 'axios'; // need for DexScreener API
// Service Suite
import { BaseService } from '../../../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../../../utils/service-suite/service-constants.js';
import serviceManager from '../../../utils/service-suite/service-manager.js';
import serviceEvents from '../../../utils/service-suite/service-events.js';
import { ServiceError } from '../../../utils/service-suite/service-error.js'; // why is this unused?
// Prisma
import prisma from '../../../config/prisma.js'; // why is this unused?
// Redis
import redisManager from '../../../utils/redis-suite/redis-manager.js'; // why is this unused?
// Logger
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';

// Config
//import { config } from '../../../config/config.js';
//const isDev = config.getEnvironment() === 'development';

// Cache collector to avoid redundant API calls
const CACHE_EXPIRY = 10 * 60 * 1000; // 10 minutes
const dataCache = new Map();

// DexScreener Collector class
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

      // Make API request - NOTE: The correct format is '/tokens/{tokenAddress}' without 'solana/'
      const response = await this.axiosInstance.get(`/tokens/${tokenAddress}`);
      
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

      // DexScreener supports up to 30 token addresses in a single comma-separated request
      // Split missing tokens into chunks of 30 to optimize API usage
      const MAX_TOKENS_PER_REQUEST = 30; // DexScreener supports up to 30 tokens per request
      const chunks = this.chunkArray(missingTokens, MAX_TOKENS_PER_REQUEST);
      
      logApi.info(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} Fetching ${missingTokens.length} tokens in ${chunks.length} batch request(s)`);
      
      // Process each chunk with a single batch request per 30 tokens
      for (const [index, chunk] of chunks.entries()) {
        try {
          // Calculate URL length to prevent issues with extremely long URLs
          const batchUrl = `/tokens/${chunk.join(',')}`;
          const fullUrl = `${this.apiBaseUrl}${batchUrl}`;
          
          // Check URL length to prevent HTTP 414 errors (URL too long)
          // Most servers can handle ~2000 chars, but we'll be conservative
          if (fullUrl.length > 1800) {
            logApi.warn(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} URL too long (${fullUrl.length} chars), splitting batch`);
            
            // Split this batch in half and process recursively
            const halfSize = Math.ceil(chunk.length / 2);
            const firstHalf = chunk.slice(0, halfSize);
            const secondHalf = chunk.slice(halfSize);
            
            // Process each half with individual requests
            for (const address of [...firstHalf, ...secondHalf]) {
              try {
                const data = await this.getTokenByAddress(address);
                if (data) {
                  results[address] = data;
                }
              } catch (error) {
                logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token ${address}:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
              }
            }
            continue;
          }
          
          // Make the batch request using comma-separated addresses
          logApi.debug(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} Making batch request for ${chunk.length} tokens`);
          const response = await this.axiosInstance.get(batchUrl);
          
          // Process response
          if (response.data && response.data.pairs && response.data.pairs.length > 0) {
            // Group pairs by token address for easier processing
            const pairsByToken = {};
            
            // Sort pairs by token address
            for (const pair of response.data.pairs) {
              const tokenAddress = pair.baseToken?.address;
              if (!tokenAddress) continue;
              
              if (!pairsByToken[tokenAddress]) {
                pairsByToken[tokenAddress] = [];
              }
              pairsByToken[tokenAddress].push(pair);
            }
            
            // Process each token's pairs
            for (const [tokenAddress, tokenPairs] of Object.entries(pairsByToken)) {
              // Create a response-like object for each token
              const tokenData = {
                pairs: tokenPairs
              };
              
              // Process token data
              const data = this.processTokenData(tokenData);
              if (data) {
                // Cache and add to results
                this.cacheData(`address_${tokenAddress}`, data);
                results[tokenAddress] = data;
              }
            }
          }
          
          // Log batch completion
          const batchSuccessCount = chunk.filter(address => results[address]).length;
          logApi.debug(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} Processed batch ${index + 1}/${chunks.length}: ${batchSuccessCount}/${chunk.length} successful`);
          
          // Add delay between batches to avoid rate limiting
          if (index < chunks.length - 1) {
            await this.sleep(500); // Reduced delay since we're sending fewer requests
          }
        } catch (batchError) {
          logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error processing batch ${index + 1}:${fancyColors.RESET} ${batchError.message || 'Unknown error'}`);
          
          // Fallback to individual requests for this batch if the batch request failed
          logApi.info(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} Falling back to individual requests for batch ${index + 1}`);
          
          for (const address of chunk) {
            try {
              const data = await this.getTokenByAddress(address);
              if (data) {
                results[address] = data;
              }
            } catch (error) {
              logApi.error(`${fancyColors.GOLD}[DexScreenerCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token ${address}:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
            }
          }
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
      labels: pair.labels || [],
      liquidity: parseFloat(pair.liquidity?.usd || 0),
      volume24h: parseFloat(pair.volume?.h24 || 0),
      price: parseFloat(pair.priceUsd || 0),
      pairCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : null
    }));
    
    return tokenData;
  }

  /**
   * Process pair data from DexScreener - COMPLETE VERSION
   * This extracts ALL fields from the DexScreener API
   * @param {Object} pair - DexScreener pair data
   * @returns {Object} Processed token data
   */
  processPairData(pair) {
    // Basic token data
    const tokenData = {
      // Basic token identification
      address: pair.baseToken?.address || '',
      name: pair.baseToken?.name || '',
      symbol: pair.baseToken?.symbol || '',
      
      // Pair information
      pairAddress: pair.pairAddress || '',
      dex: pair.dexId || '',
      chainId: pair.chainId || 'solana',
      url: pair.url || `https://dexscreener.com/solana/${pair.pairAddress}`,
      labels: pair.labels || [],
      pairCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : null,
      
      // Quote token information
      quoteToken: {
        address: pair.quoteToken?.address || '',
        name: pair.quoteToken?.name || '',
        symbol: pair.quoteToken?.symbol || ''
      },
      
      // Price information
      price: parseFloat(pair.priceUsd || 0),
      priceNative: parseFloat(pair.priceNative || 0),
      
      // Price changes - all timeframes
      priceChange: {
        m5: parseFloat(pair.priceChange?.m5 || 0),
        h1: parseFloat(pair.priceChange?.h1 || 0),
        h6: parseFloat(pair.priceChange?.h6 || 0),
        h24: parseFloat(pair.priceChange?.h24 || 0)
      },
      
      // Market metrics
      fdv: parseFloat(pair.fdv || 0),
      marketCap: parseFloat(pair.marketCap || 0),
      
      // Detailed liquidity
      liquidity: {
        usd: parseFloat(pair.liquidity?.usd || 0),
        base: parseFloat(pair.liquidity?.base || 0),
        quote: parseFloat(pair.liquidity?.quote || 0)
      },
      
      // Detailed volume - all timeframes
      volume: {
        m5: parseFloat(pair.volume?.m5 || 0),
        h1: parseFloat(pair.volume?.h1 || 0),
        h6: parseFloat(pair.volume?.h6 || 0),
        h24: parseFloat(pair.volume?.h24 || 0)
      },
      
      // Detailed transactions - all timeframes
      txns: {
        m5: {
          buys: parseInt(pair.txns?.m5?.buys || 0, 10),
          sells: parseInt(pair.txns?.m5?.sells || 0, 10)
        },
        h1: {
          buys: parseInt(pair.txns?.h1?.buys || 0, 10),
          sells: parseInt(pair.txns?.h1?.sells || 0, 10)
        },
        h6: {
          buys: parseInt(pair.txns?.h6?.buys || 0, 10),
          sells: parseInt(pair.txns?.h6?.sells || 0, 10)
        },
        h24: {
          buys: parseInt(pair.txns?.h24?.buys || 0, 10),
          sells: parseInt(pair.txns?.h24?.sells || 0, 10)
        }
      },
      
      // For compatibility with existing code
      priceChange24h: parseFloat(pair.priceChange?.h24 || 0),
      volume24h: parseFloat(pair.volume?.h24 || 0),
      
      // Social links placeholder (to be filled below)
      socials: {},
      websites: [],
      
      // Metadata fields
      metadata: {
        imageUrl: null,
        headerUrl: null,
        openGraphUrl: null,
        description: null
      },
      
      // Boost data
      boosts: pair.boosts || null
    };

    // Extract media, social links and websites from info field
    if (pair.info) {
      // Media: Image URL
      if (pair.info.imageUrl) {
        tokenData.metadata.imageUrl = pair.info.imageUrl;
      }
      
      // Media: Header image
      if (pair.info.header) {
        tokenData.metadata.headerUrl = pair.info.header;
      }
      
      // Media: OpenGraph image
      if (pair.info.openGraph) {
        tokenData.metadata.openGraphUrl = pair.info.openGraph;
      }
      
      // Description
      if (pair.info.description) {
        tokenData.metadata.description = pair.info.description;
      }
      
      // Social links from info.socials array
      if (pair.info.socials && Array.isArray(pair.info.socials)) {
        pair.info.socials.forEach(social => {
          if (social.type && social.url) {
            tokenData.socials[social.type] = social.url;
          }
        });
      }
      
      // All websites from info.websites array
      if (pair.info.websites && Array.isArray(pair.info.websites)) {
        pair.info.websites.forEach(website => {
          if (website.url) {
            tokenData.websites.push({
              label: website.label || 'Official',
              url: website.url
            });
            
            // Set first website as 'website' in socials for simplicity
            if (tokenData.websites.length === 1) {
              tokenData.socials.website = website.url;
              tokenData.websiteLabel = website.label || 'Official';
            }
          }
        });
      }
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