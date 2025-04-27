// websocket/v69/unified/modules/rate-limiter.js

/**
 * Rate Limiter for WebSocket Wallet Operations
 * 
 * Implements token bucket algorithm to limit request rates for 
 * balance refresh operations and subscription management.
 */

import { logApi } from '../../../../utils/logger-suite/logger.js';
import { fancyColors, wsColors } from '../../../../utils/colors.js';

// Rate limits for balance refresh operations (per wallet)
const REFRESH_LIMITS = {
  INTERVAL_MS: 5000,      // Allow a refresh every 5 seconds per wallet
  MAX_PER_MINUTE: 15      // Maximum 15 refreshes per minute per wallet
};

// Rate limits for balance subscriptions (per client connection)
const SUBSCRIPTION_LIMITS = {
  MAX_ACTIVE: 20,         // Maximum 20 active subscriptions per client
  MAX_NEW_PER_MINUTE: 30  // Maximum 30 new subscriptions per minute
};

// SOL price cache settings
const SOL_PRICE_CACHE = {
  TTL_MS: 60000,          // Cache SOL price for 1 minute
};

class RateLimiter {
  constructor() {
    // Token buckets for refresh operations (wallet -> {tokens, lastRefill})
    this.refreshTokens = new Map();
    
    // Counts for active subscriptions (clientId -> {count, newPerMinute, resetTime})
    this.subscriptionCounts = new Map();
    
    // Cache for SOL price
    this.solPriceCache = {
      price: null,
      lastUpdated: 0
    };
  }
  
  /**
   * Check if a wallet can refresh its balance
   * @param {string} walletAddress - Wallet address
   * @returns {boolean} Whether the operation is allowed
   */
  canRefreshBalance(walletAddress) {
    const now = Date.now();
    
    // Initialize bucket if it doesn't exist
    if (!this.refreshTokens.has(walletAddress)) {
      this.refreshTokens.set(walletAddress, { 
        tokens: REFRESH_LIMITS.MAX_PER_MINUTE - 1, 
        lastRefill: now 
      });
      return true;
    }
    
    // Get existing bucket
    const bucket = this.refreshTokens.get(walletAddress);
    const elapsed = now - bucket.lastRefill;
    
    // Refill tokens based on time elapsed
    const tokensToAdd = Math.floor(elapsed / REFRESH_LIMITS.INTERVAL_MS);
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(REFRESH_LIMITS.MAX_PER_MINUTE, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now - (elapsed % REFRESH_LIMITS.INTERVAL_MS);
    }
    
    // Check if we have tokens available
    if (bucket.tokens > 0) {
      bucket.tokens--;
      return true;
    }
    
    logApi.warn(`${wsColors.tag}[rate-limiter]${fancyColors.RESET} ${fancyColors.YELLOW}Rate limit exceeded for wallet balance refresh:${fancyColors.RESET} ${walletAddress}`);
    return false;
  }
  
  /**
   * Check if a client can create a new subscription
   * @param {string} clientId - Client identifier
   * @returns {boolean} Whether the operation is allowed
   */
  canCreateSubscription(clientId) {
    const now = Date.now();
    
    // Initialize counter if it doesn't exist
    if (!this.subscriptionCounts.has(clientId)) {
      this.subscriptionCounts.set(clientId, {
        activeCount: 1,
        newPerMinute: 1,
        resetTime: now + 60000 // Reset in 1 minute
      });
      return true;
    }
    
    // Get existing counter
    const counter = this.subscriptionCounts.get(clientId);
    
    // Reset new per minute counter if needed
    if (now > counter.resetTime) {
      counter.newPerMinute = 0;
      counter.resetTime = now + 60000;
    }
    
    // Check limits
    if (counter.activeCount >= SUBSCRIPTION_LIMITS.MAX_ACTIVE) {
      logApi.warn(`${wsColors.tag}[rate-limiter]${fancyColors.RESET} ${fancyColors.YELLOW}Max active subscriptions reached for client:${fancyColors.RESET} ${clientId}`);
      return false;
    }
    
    if (counter.newPerMinute >= SUBSCRIPTION_LIMITS.MAX_NEW_PER_MINUTE) {
      logApi.warn(`${wsColors.tag}[rate-limiter]${fancyColors.RESET} ${fancyColors.YELLOW}Max new subscriptions per minute reached for client:${fancyColors.RESET} ${clientId}`);
      return false;
    }
    
    // Increment counters
    counter.activeCount++;
    counter.newPerMinute++;
    return true;
  }
  
  /**
   * Register subscription removal
   * @param {string} clientId - Client identifier
   */
  removeSubscription(clientId) {
    if (this.subscriptionCounts.has(clientId)) {
      const counter = this.subscriptionCounts.get(clientId);
      counter.activeCount = Math.max(0, counter.activeCount - 1);
    }
  }
  
  /**
   * Clean up client on disconnect
   * @param {string} clientId - Client identifier
   */
  cleanupClient(clientId) {
    this.subscriptionCounts.delete(clientId);
  }
  
  /**
   * Cache SOL price
   * @param {number} price - SOL price in USD
   */
  cacheSolPrice(price) {
    this.solPriceCache = {
      price,
      lastUpdated: Date.now()
    };
  }
  
  /**
   * Get cached SOL price if available and not expired
   * @returns {number|null} Cached SOL price or null if expired
   */
  getCachedSolPrice() {
    const now = Date.now();
    if (this.solPriceCache.price && (now - this.solPriceCache.lastUpdated < SOL_PRICE_CACHE.TTL_MS)) {
      return this.solPriceCache.price;
    }
    return null;
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();
export default rateLimiter;