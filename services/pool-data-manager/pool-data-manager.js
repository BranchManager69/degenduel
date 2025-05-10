// services/pool-data-manager/pool-data-manager.js

/**
 * PoolDataManager
 * 
 * A reactive, on-demand manager for token pools that ensures pool data
 * is always available when needed. This service will automatically fetch
 * missing pool data from DexScreener and update the database.
 * 
 * Key features:
 * - Just-in-time pool data fetching for tokens
 * - Queued processing to handle concurrent requests efficiently
 * - Database synchronization with external pool data
 * - Event emission for service coordination
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors, serviceSpecificColors } from '../../utils/colors.js';
import { prisma } from '../../config/prisma.js';
import { dexscreenerClient } from '../solana-engine/dexscreener-client.js';
import serviceEvents from '../../utils/service-suite/service-events.js';

// Config
import { config } from '../../config/config.js';

// Formatting helpers for consistent logging
const formatLog = {
  tag: () => `${fancyColors.BG_CYAN}${fancyColors.BLACK} POOL-MANAGER ${fancyColors.RESET}`,
  header: (text) => `${fancyColors.CYAN} ${text} ${fancyColors.RESET}`,
  success: (text) => `${fancyColors.GREEN}${text}${fancyColors.RESET}`,
  warning: (text) => `${fancyColors.YELLOW}${text}${fancyColors.RESET}`,
  error: (text) => `${fancyColors.RED}${text}${fancyColors.RESET}`,
  info: (text) => `${fancyColors.BLUE}${text}${fancyColors.RESET}`,
  token: (text) => `${fancyColors.MAGENTA}${text}${fancyColors.RESET}`,
  count: (num) => `${fancyColors.YELLOW}${num}${fancyColors.RESET}`,
  dex: (name) => `${fancyColors.CYAN}${name}${fancyColors.RESET}`,
};

/**
 * PoolDataManager class for reactive pool data management
 */
class PoolDataManager {
  constructor() {
    // Track tokens being processed to avoid duplication
    this.inProgressTokens = new Set();
    
    // Queue for tokens that need pools fetched
    this.poolFetchQueue = [];
    
    // Configuration
    this.minLiquidityUsd = 1000;  // Minimum pool liquidity to include
    this.maxPoolsPerToken = 20;   // Limit pools per token
    this.isProcessingQueue = false;
    
    // Stats for monitoring
    this.stats = {
      totalFetches: 0,
      successfulFetches: 0,
      failedFetches: 0,
      totalPoolsDiscovered: 0,
      totalPoolsStored: 0,
      lastFetchTime: null,
      queueHighWaterMark: 0
    };
    
    // Initialize DexScreener client if needed
    this.initializeDexScreener();
  }
  
  /**
   * Make sure DexScreener client is initialized
   */
  async initializeDexScreener() {
    if (!dexscreenerClient.initialized) {
      try {
        await dexscreenerClient.initialize();
        logApi.info(`${formatLog.tag()} ${formatLog.success('DexScreener client initialized')}`);
      } catch (error) {
        logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize DexScreener client:')} ${error.message}`);
      }
    }
  }

  /**
   * Get pools for a token - fetches from DexScreener if not in database
   * @param {string} tokenAddress - The token address to get pools for
   * @param {Object} options - Options for retrieval
   * @param {boolean} options.forceRefresh - Whether to force refresh from API even if pools exist
   * @param {boolean} options.waitForFetch - Whether to wait for fetch to complete if data is missing
   * @returns {Promise<Array>} - Array of token pools
   */
  async getPoolsForToken(tokenAddress, options = {}) {
    const { forceRefresh = false, waitForFetch = true } = options;
    
    // Validate input
    if (!tokenAddress || typeof tokenAddress !== 'string') {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Invalid token address provided')}`);
      return [];
    }
    
    try {
      // First check database
      const existingPools = await prisma.token_pools.findMany({
        where: { tokenAddress },
        include: { token: true } // Include token info
      });

      // If we have pools and don't need to refresh, return them
      if (existingPools.length > 0 && !forceRefresh) {
        return existingPools;
      }

      // If not waiting for fetch, return existing pools or empty array
      if (!waitForFetch) {
        if (existingPools.length > 0) {
          // Queue a background refresh and return existing data
          this.queuePoolFetch(tokenAddress);
          return existingPools;
        } else {
          // No data available, trigger a background fetch
          this.queuePoolFetch(tokenAddress);
          return [];
        }
      }

      // If already fetching for this token, add to queue and wait
      if (this.inProgressTokens.has(tokenAddress)) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Token')} ${formatLog.token(tokenAddress)} ${formatLog.info('already being fetched, waiting for completion')}`);
        
        return new Promise((resolve) => {
          this.poolFetchQueue.push({
            tokenAddress,
            resolve,
            timestamp: Date.now()
          });
          
          // Update queue high water mark
          if (this.poolFetchQueue.length > this.stats.queueHighWaterMark) {
            this.stats.queueHighWaterMark = this.poolFetchQueue.length;
          }
        });
      }

      // Otherwise, fetch pools directly
      return await this.fetchAndStorePoolsForToken(tokenAddress);
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Error getting pools for token ${tokenAddress}:`)} ${error.message}`);
      return [];
    }
  }
  
  /**
   * Queue a background pool fetch for a token
   * @param {string} tokenAddress - The token address to queue
   */
  queuePoolFetch(tokenAddress) {
    // Only queue if not already in progress
    if (!this.inProgressTokens.has(tokenAddress)) {
      // Add to queue with a dummy resolve function
      this.poolFetchQueue.push({
        tokenAddress,
        resolve: () => {}, // No-op function
        timestamp: Date.now(),
        background: true
      });
      
      // Update queue high water mark
      if (this.poolFetchQueue.length > this.stats.queueHighWaterMark) {
        this.stats.queueHighWaterMark = this.poolFetchQueue.length;
      }
      
      // Process queue immediately
      this.processQueue();
    }
  }

  /**
   * Fetch and store pools for a token
   * @param {string} tokenAddress - The token address
   * @returns {Promise<Array>} - Array of pool records
   */
  async fetchAndStorePoolsForToken(tokenAddress) {
    // Mark as in progress
    this.inProgressTokens.add(tokenAddress);
    
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} pools for token ${formatLog.token(tokenAddress)}`);
      this.stats.totalFetches++;
      this.stats.lastFetchTime = new Date();
      
      // Make sure DexScreener is initialized
      await this.initializeDexScreener();
      
      // Check if pools for this token are already in the database
      // This helps avoid unnecessary API calls when SolanaEngine might have
      // already cached the data
      const existingPools = await prisma.token_pools.findMany({
        where: { tokenAddress }
      });
      
      if (existingPools.length > 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.success('Found')} ${formatLog.count(existingPools.length)} ${formatLog.success('existing pools in database for token')} ${formatLog.token(tokenAddress)}`);
        
        // Update tracking
        this.stats.successfulFetches++;
        this.inProgressTokens.delete(tokenAddress);
        
        // Process any queued tokens
        this.processQueue();
        
        // Return existing pools
        const fullPools = await prisma.token_pools.findMany({
          where: { tokenAddress },
          include: { token: true }
        });
        
        return fullPools;
      }
      
      // Not in database, try to fetch from DexScreener
      try {
        // Fetch from DexScreener
        const poolsData = await dexscreenerClient.getTokenPools('solana', tokenAddress);
        
        // DexScreener returns array directly for token pairs endpoint
        // Convert to expected structure if needed
        const pairs = Array.isArray(poolsData) ? poolsData : 
                    (poolsData && poolsData.pairs && Array.isArray(poolsData.pairs)) ? 
                      poolsData.pairs : [];
        
        if (pairs.length === 0) {
          logApi.warn(`${formatLog.tag()} ${formatLog.warning(`No pools found for token ${formatLog.token(tokenAddress)}`)}`);
          this.stats.failedFetches++;
          this.inProgressTokens.delete(tokenAddress);
          
          // Process any queued tokens
          this.processQueue();
          return [];
        }
      } catch (error) {
        // If we hit rate limits, wait and check the database again
        if (error.message.includes('429')) {
          logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Rate limited when fetching pools for ${formatLog.token(tokenAddress)}. Checking database again after a brief delay...`)}`);
          
          // Wait a moment and check database again
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const retryPools = await prisma.token_pools.findMany({
            where: { tokenAddress },
            include: { token: true }
          });
          
          if (retryPools.length > 0) {
            logApi.info(`${formatLog.tag()} ${formatLog.success('Found')} ${formatLog.count(retryPools.length)} ${formatLog.success('pools in database after retry for token')} ${formatLog.token(tokenAddress)}`);
            
            // Update tracking
            this.stats.successfulFetches++;
            this.inProgressTokens.delete(tokenAddress);
            
            // Process queued tokens
            this.processQueue();
            
            return retryPools;
          }
          
          // Still no pools, give up
          logApi.error(`${formatLog.tag()} ${formatLog.error(`Rate limited and no pools in database for token ${formatLog.token(tokenAddress)}`)}`);
          this.stats.failedFetches++;
          this.inProgressTokens.delete(tokenAddress);
          
          // Process queued tokens
          this.processQueue();
          return [];
        }
        
        // Re-throw other errors
        throw error;
      }

      // Filter and sort pools by liquidity - using the pairs variable which should be properly defined
      const solanaPoolsRaw = Array.isArray(pairs) ? pairs.filter(pair => 
        pair && pair.chainId === 'solana' && pair.dexId && pair.pairAddress
      ) : [];

      const solanaPoolsFiltered = solanaPoolsRaw
        .filter(pair => {
          const liquidity = parseFloat(pair.liquidity?.usd || '0');
          return liquidity >= this.minLiquidityUsd;
        })
        .sort((a, b) => {
          const liquidityA = parseFloat(a.liquidity?.usd || '0');
          const liquidityB = parseFloat(b.liquidity?.usd || '0');
          return liquidityB - liquidityA;
        });

      // Limit pools
      const solanaPoolsLimited = solanaPoolsFiltered.slice(0, this.maxPoolsPerToken);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Found')} ${formatLog.count(solanaPoolsRaw.length)} ${formatLog.success('pools')} (${formatLog.count(solanaPoolsLimited.length)} after filtering) for token ${formatLog.token(tokenAddress)}`);
      
      // Store in database
      const poolRecords = await this.storePoolsInDatabase(tokenAddress, solanaPoolsLimited);
      
      // Update stats
      this.stats.successfulFetches++;
      this.stats.totalPoolsDiscovered += solanaPoolsRaw.length;
      this.stats.totalPoolsStored += poolRecords.length;
      
      // Notify listeners that pool data was updated
      serviceEvents.emit('pool:data_updated', {
        tokenAddress,
        poolCount: poolRecords.length,
        source: 'pool-data-manager'
      });
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully stored')} ${formatLog.count(poolRecords.length)} ${formatLog.success('pools for token')} ${formatLog.token(tokenAddress)}`);
      
      // Complete this token
      this.inProgressTokens.delete(tokenAddress);
      
      // Process any queued tokens for this address
      this.processQueue();
      
      return poolRecords;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Error fetching pools for ${tokenAddress}: ${error.message}`)}`);
      this.stats.failedFetches++;
      this.inProgressTokens.delete(tokenAddress);
      
      // Process any queued tokens
      this.processQueue();
      return [];
    }
  }
  
  /**
   * Store pools in database
   * @param {string} tokenAddress - The token address
   * @param {Array} pools - Array of pool data from DexScreener
   * @returns {Promise<Array>} - Array of stored pool records
   */
  async storePoolsInDatabase(tokenAddress, pools) {
    try {
      // Start transaction
      return await prisma.$transaction(async (tx) => {
        // Get existing pools
        const existingPools = await tx.token_pools.findMany({
          where: { tokenAddress }
        });
        
        const existingPoolAddresses = new Set(existingPools.map(p => p.address));
        const newPoolAddresses = new Set(pools.map(p => p.pairAddress));
        
        // Pools to add
        const poolsToAdd = pools.filter(p => !existingPoolAddresses.has(p.pairAddress));
        
        // Pools to remove
        const poolsToRemove = existingPools.filter(p => !newPoolAddresses.has(p.address));
        
        // Delete removed pools
        if (poolsToRemove.length > 0) {
          await tx.token_pools.deleteMany({
            where: {
              tokenAddress,
              address: {
                in: poolsToRemove.map(p => p.address)
              }
            }
          });
          
          logApi.info(`${formatLog.tag()} ${formatLog.warning('Removed')} ${formatLog.count(poolsToRemove.length)} ${formatLog.warning('outdated pools for token')} ${formatLog.token(tokenAddress)}`);
        }
        
        // Add new pools
        let addedCount = 0;
        for (const pool of poolsToAdd) {
          try {
            await tx.token_pools.create({
              data: {
                address: pool.pairAddress,
                tokenAddress,
                dex: pool.dexId.toUpperCase(),
                programId: pool.programAddress || pool.pairAddress,
                dataSize: 0, // Default values
                tokenOffset: 0, // Default values
                createdAt: new Date(),
                lastUpdated: new Date()
              }
            });
            addedCount++;
          } catch (error) {
            logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error creating pool ${pool.pairAddress}:`)} ${error.message}`);
          }
        }
        
        if (addedCount > 0) {
          logApi.info(`${formatLog.tag()} ${formatLog.success('Added')} ${formatLog.count(addedCount)} ${formatLog.success('new pools for token')} ${formatLog.token(tokenAddress)}`);
        }
        
        // Check if token exists and create if not
        const token = await tx.tokens.findUnique({
          where: { address: tokenAddress }
        });
        
        if (token) {
          // Update existing token record
          await tx.tokens.update({
            where: { address: tokenAddress },
            data: {
              last_refresh_success: new Date(),
              refresh_metadata: {
                lastPoolRefresh: new Date().toISOString(),
                poolsFound: pools.length,
                poolsStored: existingPools.length - poolsToRemove.length + addedCount,
                autoDiscovered: true,
                source: 'pool-data-manager'
              }
            }
          });
        } else {
          // Token doesn't exist in database, try to extract info from pool data
          let tokenName = null;
          let tokenSymbol = null;
          
          // Find token info in pool data
          for (const pool of pools) {
            // Check if this token is base or quote token
            if (pool.baseToken && pool.baseToken.address === tokenAddress) {
              tokenName = pool.baseToken.name;
              tokenSymbol = pool.baseToken.symbol;
              break;
            } else if (pool.quoteToken && pool.quoteToken.address === tokenAddress) {
              tokenName = pool.quoteToken.name;
              tokenSymbol = pool.quoteToken.symbol;
              break;
            }
          }
          
          // Create basic token record
          await tx.tokens.create({
            data: {
              address: tokenAddress,
              name: tokenName || 'Unknown Token',
              symbol: tokenSymbol || 'UNKNOWN',
              is_active: true,
              is_whitelisted: false,
              priority_score: 10, // Default low priority
              created_at: new Date(),
              last_refresh_attempt: new Date(),
              last_refresh_success: new Date(),
              refresh_metadata: {
                lastPoolRefresh: new Date().toISOString(),
                poolsFound: pools.length,
                poolsStored: addedCount,
                autoDiscovered: true,
                source: 'pool-data-manager'
              }
            }
          });
          
          logApi.info(`${formatLog.tag()} ${formatLog.success('Created new token record for')} ${formatLog.token(tokenAddress)}`);
        }
        
        // Return all pools for this token
        return await tx.token_pools.findMany({
          where: { tokenAddress },
          include: { token: true }
        });
      });
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Error storing pools in database: ${error.message}`)}`);
      return [];
    }
  }
  
  /**
   * Process any queued tokens
   */
  async processQueue() {
    if (this.isProcessingQueue || this.poolFetchQueue.length === 0) return;
    
    this.isProcessingQueue = true;
    
    try {
      // Group by token address to avoid duplicate processing
      const tokenGroups = new Map();
      
      for (const item of this.poolFetchQueue) {
        if (!tokenGroups.has(item.tokenAddress)) {
          tokenGroups.set(item.tokenAddress, []);
        }
        tokenGroups.get(item.tokenAddress).push(item);
      }
      
      // Clear the queue
      this.poolFetchQueue = [];
      
      // Process each token group
      for (const [tokenAddress, items] of tokenGroups.entries()) {
        // Skip tokens already being processed
        if (this.inProgressTokens.has(tokenAddress)) {
          // Put items back in queue
          for (const item of items) {
            this.poolFetchQueue.push(item);
          }
          continue;
        }
        
        // Get pools for this token
        const pools = await this.fetchAndStorePoolsForToken(tokenAddress);
        
        // Resolve all waiting promises
        for (const item of items) {
          // Only call resolve if it's not a background task
          if (!item.background) {
            item.resolve(pools);
          }
        }
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Error processing queue: ${error.message}`)}`);
    } finally {
      this.isProcessingQueue = false;
      
      // If new items were added while processing, process them too
      if (this.poolFetchQueue.length > 0) {
        setTimeout(() => this.processQueue(), 0);
      }
    }
  }
  
  /**
   * Get service statistics
   * @returns {Object} - Service statistics
   */
  getStats() {
    return {
      ...this.stats,
      currentQueueSize: this.poolFetchQueue.length,
      inProgressTokens: Array.from(this.inProgressTokens),
      isProcessingQueue: this.isProcessingQueue,
      minLiquidityUsd: this.minLiquidityUsd,
      maxPoolsPerToken: this.maxPoolsPerToken
    };
  }
  
  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalFetches: 0,
      successfulFetches: 0,
      failedFetches: 0,
      totalPoolsDiscovered: 0,
      totalPoolsStored: 0,
      lastFetchTime: null,
      queueHighWaterMark: 0
    };
  }
}

// Create and export singleton
const poolDataManager = new PoolDataManager();
export default poolDataManager;