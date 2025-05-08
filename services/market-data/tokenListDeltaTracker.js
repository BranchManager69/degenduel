// services/market-data/tokenListDeltaTracker.js

/**
 * NOTE:
 * This module is responsible for tracking changes to token lists using Redis for fast set operations.
 * It efficiently detects new and removed tokens when comparing successive token lists.
 */

/**
 * Token List Delta Tracker
 * 
 * Efficiently tracks changes to token lists using Redis for fast set operations.
 * This module detects new and removed tokens when comparing successive token lists.
 * 
 * @module services/market-data/tokenListDeltaTracker
 * 
 * -----------------------------------------------------------------------------
 * TOKEN PROCESSING SYSTEM ARCHITECTURE
 * -----------------------------------------------------------------------------
 * 
 * The token processing system efficiently handles ~700,000 tokens through:
 * 
 * 1. TOKEN COLLECTION: tokenDetectionService.js fetches all Jupiter tokens
 * 
 * 2. REDIS BATCHING: tokenListDeltaTracker.js (this file) batches tokens
 *    in groups of 1000 to prevent "Maximum call stack size exceeded" errors
 *    and uses Redis SDIFF operations to find only new/removed tokens
 * 
 * 3. DELTA PROCESSING: Only newly discovered tokens continue to processing
 * 
 * 4. EVENT QUEUE: New tokens enter a processing queue where they're handled
 *    in smaller batches (50) with delays between batches
 * 
 * 5. EVENT EMISSION: Each token gets a 'token:new' event that other services
 *    can respond to for metadata enrichment, etc.
 * 
 * This design is extremely efficient because:
 * - We only process new tokens, not the entire list
 * - Redis set operations are blazingly fast
 * - Multi-level batching prevents overwhelming any system
 * - Delays prevent service disruptions
 * 
 * See TOKEN_PROCESSING_SYSTEM.md for complete documentation.
 * -----------------------------------------------------------------------------
 * 
 * @author BranchManager69
 * @version 1.9.0
 * @created 2025-04-10
 * @updated 2025-05-02
 */

// Redis
import { default as redisManager } from '../../utils/redis-suite/redis-manager.js';
// Logger
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';

// Config
//import config from '../../config/config.js'; // why is this unused?

// Token List Delta Tracker class
class TokenListDeltaTracker {
  constructor() {
    this.KEY_PREFIX = 'jupiter_tokens';
    this.LATEST_KEY = `${this.KEY_PREFIX}_latest`;
    this.PREVIOUS_KEY = `${this.KEY_PREFIX}_previous`;
    this.EXPIRY_SECONDS = 60; // Keep sets for just 1 minute
    this.MAX_STORED_SETS = 2; // Only keep the latest and previous sets
  }

  /**
   * Store a new token list and calculate what changed since the last update
   * @param {Array<string>} tokenAddresses - Array of token addresses
   * @returns {Promise<Object>} - Delta information (added, removed, unchanged tokens)
   */
  async trackChanges(tokenAddresses) {
    try {
      if (!Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
        logApi.warn(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.YELLOW}Invalid token address list provided${fancyColors.RESET}`);
        return {
          added: [],
          removed: [],
          unchanged: 0,
          error: 'Invalid token list'
        };
      }

      // Get Redis client
      const client = redisManager.client;
      const timestamp = Date.now();
      const currentKey = `${this.KEY_PREFIX}_${timestamp}`;
      
      // Get the previous latest key before we do anything else
      const previousLatest = await client.get(this.LATEST_KEY);
      
      // First, clean up any old keys to avoid accumulating data
      await this.cleanupOldSets(true); // force cleanup
      
      // Store the new set
      const pipeline = client.pipeline();
      
      // Add all addresses to a new set in batches to prevent stack overflow
      const BATCH_SIZE = 1000; // Process in batches of 1000 tokens
      for (let i = 0; i < tokenAddresses.length; i += BATCH_SIZE) {
        const batch = tokenAddresses.slice(i, i + BATCH_SIZE);
        pipeline.sadd(currentKey, ...batch);
      }
      
      // Set a shorter expiry - 60 seconds instead of 5 minutes
      pipeline.expire(currentKey, this.EXPIRY_SECONDS);
      
      // Execute pipeline and get results
      const results = await pipeline.exec();
      
      // Handle any pipeline errors
      if (!results) {
        throw new Error('Redis pipeline execution failed');
      }
      
      // Update keys - save previous key before updating latest
      if (previousLatest) {
        await client.set(this.PREVIOUS_KEY, previousLatest, 'EX', this.EXPIRY_SECONDS);
      }
      
      // Set the current key as the latest with expiry
      await client.set(this.LATEST_KEY, currentKey, 'EX', this.EXPIRY_SECONDS * 2);
      
      // If there's no previous key, everything is new
      if (!previousLatest) {
        logApi.info(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.CYAN}First token list tracked: ${tokenAddresses.length} tokens${fancyColors.RESET}`);
        return {
          added: tokenAddresses,
          removed: [],
          unchanged: 0,
          totalNew: tokenAddresses.length
        };
      }
      
      // Find new tokens (in current but not previous)
      const newTokens = await client.sdiff(currentKey, previousLatest);
      
      // Find removed tokens (in previous but not current)
      const removedTokens = await client.sdiff(previousLatest, currentKey);
      
      // Calculate unchanged count
      const unchanged = tokenAddresses.length - newTokens.length;
      
      logApi.info(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.GREEN}Change detected: ${fancyColors.RESET}+${newTokens.length} new, -${removedTokens.length} removed, ${unchanged} unchanged tokens`);
      
      return {
        added: newTokens,
        removed: removedTokens,
        unchanged,
        totalTracked: tokenAddresses.length
      };
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.RED}Error tracking token changes:${fancyColors.RESET}`, error);
      return {
        added: [],
        removed: [],
        unchanged: 0,
        error: error.message
      };
    }
  }
  
  /**
   * Get all previously seen tokens (useful for recovery)
   * @returns {Promise<Array<string>>} - Array of all tracked token addresses
   */
  async getAllTrackedTokens() {
    try {
      const client = redisManager.client;
      const latestKey = await client.get(this.LATEST_KEY);
      
      if (!latestKey) {
        return [];
      }
      
      return await client.smembers(latestKey);
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.RED}Error getting tracked tokens:${fancyColors.RESET}`, error);
      return [];
    }
  }
  
  /**
   * Clean up old token sets to save memory
   * @param {boolean} [force=false] - Force cleanup regardless of timestamps
   * @returns {Promise<number>} - Number of keys removed
   */
  async cleanupOldSets(force = false) {
    try {
      const client = redisManager.client;
      
      // Get all token set keys
      const keys = await client.keys(`${this.KEY_PREFIX}_*`);
      
      // Get latest and previous key references
      const latestKey = await client.get(this.LATEST_KEY);
      const previousKey = await client.get(this.PREVIOUS_KEY);
      
      let removedCount = 0;
      
      // Skip the reference pointers themselves
      const keysToKeep = [this.LATEST_KEY, this.PREVIOUS_KEY, latestKey, previousKey].filter(Boolean);
      
      for (const key of keys) {
        // Skip if this is a key we want to keep
        if (keysToKeep.includes(key)) continue;
        
        // Delete all other keys for aggressive cleanup
        await client.del(key);
        removedCount++;
        
        logApi.debug(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} Cleaned up token set: ${key}`);
      }
      
      if (removedCount > 0) {
        logApi.info(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.CYAN}Cleaned up ${removedCount} old token sets${fancyColors.RESET}`);
      }
      
      return removedCount;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.RED}Error cleaning up old token sets:${fancyColors.RESET}`, error);
      return 0;
    }
  }
  
  /**
   * Get stats about tracked token lists
   * @returns {Promise<Object>} - Statistics about tracked tokens
   */
  async getStats() {
    try {
      const client = redisManager.client;
      const latestKey = await client.get(this.LATEST_KEY);
      const allKeys = await client.keys(`${this.KEY_PREFIX}_*`);
      
      // Skip the LATEST_KEY itself
      const setKeys = allKeys.filter(key => key !== this.LATEST_KEY);
      
      let latestCount = 0;
      if (latestKey) {
        latestCount = await client.scard(latestKey);
      }
      
      return {
        totalTokens: latestCount,
        trackedSets: setKeys.length,
        latestTimestamp: latestKey ? parseInt(latestKey.split('_').pop(), 10) : null,
        memoryUsage: 'N/A' // Redis memory usage stats could be added here
      };
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.RED}Error getting stats:${fancyColors.RESET}`, error);
      return {
        error: error.message
      };
    }
  }
}

// Create and export a singleton instance
const tokenListDeltaTracker = new TokenListDeltaTracker();
export default tokenListDeltaTracker;