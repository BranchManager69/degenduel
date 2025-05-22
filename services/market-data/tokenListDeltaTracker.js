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
    this.LATEST_KEY = `${this.KEY_PREFIX}_latest`; // Pointer to the name of the latest set
    this.PREVIOUS_KEY = `${this.KEY_PREFIX}_previous`; // Pointer to the name of the previous set
    this.SET_EXPIRY_SECONDS = 3 * 24 * 60 * 60; // Keep actual token sets for 3 days
    this.POINTER_EXPIRY_SECONDS = 3 * 24 * 60 * 60 + 3600; // Keep pointers slightly longer (3 days + 1 hour)
    // this.MAX_STORED_SETS = 2; // This isn't strictly used by cleanupOldSets as it deletes non-latest/previous named sets
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
      const currentKeyName = `${this.KEY_PREFIX}_set_${timestamp}`;
      
      const previousLatestKeyName = await client.get(this.LATEST_KEY);
      
      await this.cleanupOldSets(); // Call cleanup
      
      const pipeline = client.pipeline();
      const BATCH_SIZE = 1000;
      for (let i = 0; i < tokenAddresses.length; i += BATCH_SIZE) {
        const batch = tokenAddresses.slice(i, i + BATCH_SIZE);
        pipeline.sadd(currentKeyName, ...batch);
      }
      pipeline.expire(currentKeyName, this.SET_EXPIRY_SECONDS); // Use new expiry for the token set
      await pipeline.exec();
      
      if (previousLatestKeyName) {
        // Set PREVIOUS_KEY to point to the name of the set that was previously latest
        await client.set(this.PREVIOUS_KEY, previousLatestKeyName, 'EX', this.POINTER_EXPIRY_SECONDS);
      }
      // Set LATEST_KEY to point to the name of the current set
      await client.set(this.LATEST_KEY, currentKeyName, 'EX', this.POINTER_EXPIRY_SECONDS);
      
      if (!previousLatestKeyName) {
        logApi.info(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} First token list tracked: ${tokenAddresses.length} tokens`);
        return { added: tokenAddresses, removed: [], unchanged: 0, totalNew: tokenAddresses.length };
      }
      
      const newTokens = await client.sdiff(currentKeyName, previousLatestKeyName);
      const removedTokens = await client.sdiff(previousLatestKeyName, currentKeyName);
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
   * @returns {Promise<number>} - Number of keys removed
   */
  async cleanupOldSets() { // Removed force parameter, cleanup is now more about dangling sets
    try {
      const client = redisManager.client;
      const keys = await client.keys(`${this.KEY_PREFIX}_set_*`); // Only get actual set keys
      
      const latestKeyName = await client.get(this.LATEST_KEY);
      const previousKeyName = await client.get(this.PREVIOUS_KEY);
      
      let removedCount = 0;
      const keysToKeep = [latestKeyName, previousKeyName].filter(Boolean);
      
      for (const key of keys) {
        if (!keysToKeep.includes(key)) {
          // This key is a set but not pointed to by LATEST or PREVIOUS, so it's old/dangling
          await client.del(key);
          removedCount++;
          logApi.debug(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} Cleaned up old/dangling token set: ${key}`);
        }
      }
      // LATEST_KEY and PREVIOUS_KEY (pointers) will expire on their own via POINTER_EXPIRY_SECONDS
      // Actual sets pointed to by them will expire via SET_EXPIRY_SECONDS
      // This cleanup catches sets that are no longer pointed to for any reason before their own expiry.

      if (removedCount > 0) {
        logApi.info(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.CYAN}Cleaned up ${removedCount} old/dangling token sets${fancyColors.RESET}`);
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