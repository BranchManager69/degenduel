/**
 * Token Config Utility 
 * 
 * This utility provides easy access to token configuration throughout the application.
 * It handles BigInt conversions and provides a caching layer for performance.
 */

import prisma from '../config/prisma.js';
import { logApi } from './logger-suite/logger.js';

// Cache timing (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

// Cache object
let tokenConfigCache = {
  data: null,
  lastUpdated: null
};

/**
 * Get the token configuration from the database with caching
 * 
 * @param {boolean} [forceRefresh=false] - Force a refresh of the cache
 * @returns {Promise<Object|null>} - The token configuration or null if not found
 */
async function getTokenConfig(forceRefresh = false) {
  const now = Date.now();
  
  // Use cache if available and not expired or forced refresh
  if (!forceRefresh && 
      tokenConfigCache.data && 
      tokenConfigCache.lastUpdated && 
      (now - tokenConfigCache.lastUpdated) < CACHE_TTL) {
    return tokenConfigCache.data;
  }
  
  try {
    // Fetch fresh data
    const tokenConfig = await prisma.token_config.findFirst();
    
    if (tokenConfig) {
      // Convert BigInt fields to regular numbers for easier usage
      const processedConfig = {
        ...tokenConfig,
        total_supply: Number(tokenConfig.total_supply),
        initial_circulating: Number(tokenConfig.initial_circulating),
        // Keep original values available if needed
        _original_total_supply: tokenConfig.total_supply,
        _original_initial_circulating: tokenConfig.initial_circulating
      };
      
      // Update cache
      tokenConfigCache.data = processedConfig;
      tokenConfigCache.lastUpdated = now;
      
      return processedConfig;
    }
    
    // Clear cache if no data found
    tokenConfigCache.data = null;
    tokenConfigCache.lastUpdated = now;
    
    return null;
  } catch (error) {
    logApi.error(`Error fetching token config: ${error.message}`, {
      error: error.message,
      stack: error.stack
    });
    
    // Return cache if available, even if expired
    if (tokenConfigCache.data) {
      return tokenConfigCache.data;
    }
    
    return null;
  }
}

/**
 * Get just the token contract address
 * 
 * @param {boolean} [forceRefresh=false] - Force a refresh of the cache
 * @returns {Promise<string|null>} - The token contract address or null if not found
 */
async function getTokenAddress(forceRefresh = false) {
  const config = await getTokenConfig(forceRefresh);
  return config?.address || null;
}

/**
 * Invalidate the token config cache
 */
function invalidateCache() {
  tokenConfigCache.data = null;
  tokenConfigCache.lastUpdated = null;
}

export {
  getTokenConfig,
  getTokenAddress,
  invalidateCache
};

export default {
  getTokenConfig,
  getTokenAddress,
  invalidateCache
};