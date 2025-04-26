/**
 * Pool Data Manager Helius Integration
 * 
 * This module extends the heliusPoolTracker with methods to directly inject
 * pool data from the PoolDataManager.
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import heliusPoolTracker from '../solana-engine/helius-pool-tracker.js';
import poolDataManager from './pool-data-manager.js';

// Format tag for consistent logging
const formatLog = {
  tag: () => `${fancyColors.BG_CYAN}${fancyColors.BLACK} POOL-MANAGER ${fancyColors.RESET}`,
  header: (text) => `${fancyColors.CYAN} ${text} ${fancyColors.RESET}`,
  success: (text) => `${fancyColors.GREEN}${text}${fancyColors.RESET}`,
  warning: (text) => `${fancyColors.YELLOW}${text}${fancyColors.RESET}`,
  error: (text) => `${fancyColors.RED}${text}${fancyColors.RESET}`,
  info: (text) => `${fancyColors.BLUE}${text}${fancyColors.RESET}`,
  token: (text) => `${fancyColors.MAGENTA}${text}${fancyColors.RESET}`,
};

/**
 * Extend the heliusPoolTracker with additional methods for integration
 * with the PoolDataManager
 */

// Add a method to add pools to the cache
heliusPoolTracker.addPoolsToCache = function(tokenAddress, pools) {
  if (!Array.isArray(pools) || pools.length === 0) {
    logApi.warn(`${formatLog.tag()} ${formatLog.warning('No pools provided to add to cache')}`);
    return false;
  }
  
  logApi.info(`${formatLog.tag()} ${formatLog.header('ADDING')} ${pools.length} pools to Helius tracker cache for ${formatLog.token(tokenAddress)}`);
  
  // Register pools in the tokenToPools mapping
  if (!this.tokenToPools.has(tokenAddress)) {
    this.tokenToPools.set(tokenAddress, new Set());
    this.stats.totalTokensTracked++;
  }
  
  // Add each pool to the cache
  let addedCount = 0;
  for (const pool of pools) {
    // Add to tokenToPools mapping
    this.tokenToPools.get(tokenAddress).add(pool.address);
    
    // Start tracking this pool
    this.stats.totalPoolsTracked++;
    addedCount++;
  }
  
  logApi.info(`${formatLog.tag()} ${formatLog.success('Added')} ${addedCount} pools to Helius tracker cache for ${formatLog.token(tokenAddress)}`);
  return true;
};

// Add a method to set all pools for a token
heliusPoolTracker.setPools = function(tokenAddress, pools) {
  if (!Array.isArray(pools) || pools.length === 0) {
    logApi.warn(`${formatLog.tag()} ${formatLog.warning('No pools provided to set')}`);
    return false;
  }
  
  // Clear existing pools for this token
  if (this.tokenToPools.has(tokenAddress)) {
    const existingPools = this.tokenToPools.get(tokenAddress);
    this.tokenToPools.delete(tokenAddress);
    logApi.info(`${formatLog.tag()} ${formatLog.warning('Cleared')} ${existingPools.size} existing pools for ${formatLog.token(tokenAddress)}`);
  }
  
  // Add the new pools
  return this.addPoolsToCache(tokenAddress, pools);
};

// Add a method to fetch pools on demand using the pool data manager
heliusPoolTracker.fetchPoolsWithManager = async function(tokenAddress, options = {}) {
  try {
    logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} pools for ${formatLog.token(tokenAddress)} via Pool Data Manager`);
    
    // Use pool data manager to get pools
    const pools = await poolDataManager.getPoolsForToken(tokenAddress, options);
    
    if (pools.length === 0) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('No pools found for token')} ${formatLog.token(tokenAddress)}`);
      return false;
    }
    
    // Add pools to cache
    this.setPools(tokenAddress, pools);
    
    return pools;
  } catch (error) {
    logApi.error(`${formatLog.tag()} ${formatLog.error('Error fetching pools with manager:')} ${error.message}`);
    return false;
  }
};

// Extend monitorTokenPrice to use the pool data manager
const originalMonitorTokenPrice = heliusPoolTracker.monitorTokenPrice;
heliusPoolTracker.monitorTokenPrice = async function(tokenAddress, priceHandler = null) {
  try {
    // Get pools from the database
    let pools = await this.getPoolsForToken(tokenAddress);
    
    // If no pools found, try using the pool data manager
    if (pools.length === 0) {
      logApi.info(`${formatLog.tag()} ${formatLog.info('No pools found in database, fetching with Pool Data Manager')}`);
      
      const managerPools = await poolDataManager.getPoolsForToken(tokenAddress, {
        forceRefresh: true,
        waitForFetch: true
      });
      
      if (managerPools.length > 0) {
        pools = managerPools;
        this.setPools(tokenAddress, pools);
      }
    }
    
    // Call original method now that we have pools
    return await originalMonitorTokenPrice.call(this, tokenAddress, priceHandler);
  } catch (error) {
    logApi.error(`${formatLog.tag()} ${formatLog.error('Error in enhanced monitorTokenPrice:')} ${error.message}`);
    // Fall back to original method
    return await originalMonitorTokenPrice.call(this, tokenAddress, priceHandler);
  }
};

export default heliusPoolTracker;