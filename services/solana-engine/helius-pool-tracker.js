// services/solana-engine/helius-pool-tracker.js

/**
 * ⚠️ DEPRECATED - INCOMPLETE IMPLEMENTATION ⚠️
 * 
 * This service has significant functional gaps and incomplete DEX parsing:
 * - Pool data parsing is simplified/placeholder (lines 320-400+)
 * - Price calculations are mostly stubbed out
 * - DEX-specific logic is incomplete for Raydium, Orca, PumpSwap
 * - Real-time WebSocket monitoring never properly implemented
 * 
 * RECOMMENDATION: Use Jupiter API or DexScreener API directly for token prices.
 * This was an ambitious attempt at real-time pool monitoring that was never finished.
 * 
 * STATUS: Partially functional but unreliable for production use
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceSpecificColors, fancyColors } from '../../utils/colors.js';
import { heliusClient } from './helius-client.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import prisma from '../../config/prisma.js';

// Formatting helpers for consistent logging
const formatLog = {
  tag: () => `${serviceSpecificColors.heliusClient.tag}[pool-tracker]${fancyColors.RESET}`,
  header: (text) => `${serviceSpecificColors.heliusClient.header} ${text} ${fancyColors.RESET}`,
  success: (text) => `${serviceSpecificColors.heliusClient.success}${text}${fancyColors.RESET}`,
  warning: (text) => `${serviceSpecificColors.heliusClient.warning}${text}${fancyColors.RESET}`,
  error: (text) => `${serviceSpecificColors.heliusClient.error}${text}${fancyColors.RESET}`,
  info: (text) => `${serviceSpecificColors.heliusClient.info}${text}${fancyColors.RESET}`,
  highlight: (text) => `${serviceSpecificColors.heliusClient.highlight}${text}${fancyColors.RESET}`,
  address: (addr) => `${serviceSpecificColors.heliusClient.address}${addr}${fancyColors.RESET}`,
  count: (num) => `${serviceSpecificColors.heliusClient.count}${num}${fancyColors.RESET}`,
  dex: (dex) => `${serviceSpecificColors.heliusClient.highlight}${dex}${fancyColors.RESET}`,
  price: (price) => `${serviceSpecificColors.heliusClient.highlight}$${price.toFixed(6)}${fancyColors.RESET}`,
};

/**
 * Helius Pool Tracker
 * 
 * A service that uses Helius WebSockets to track liquidity pool activity in real-time.
 * It monitors pool accounts for changes, allowing detection of liquidity changes,
 * swaps, and other pool-related events.
 * 
 * This service also provides real-time token prices calculated directly from pool data,
 * without requiring external API calls.
 */
class HeliusPoolTracker {
  constructor() {
    // Track pool subscriptions: Map<poolAddress, Set<tokenAddress>>
    this.poolSubscriptions = new Map();
    
    // Cache for pool liquidity data: Map<poolAddress, {data, lastUpdated}>
    this.poolData = new Map();
    
    // Subscription IDs for Helius WebSocket: Map<poolAddress, subscriptionId>
    this.poolSubscriptionIds = new Map();
    
    // Event handlers: Map<eventType, Map<tokenAddress, Set<handler>>>
    this.eventHandlers = new Map([
      ['swap', new Map()],
      ['liquidity_add', new Map()],
      ['liquidity_remove', new Map()],
      ['pool_update', new Map()],
      ['price_update', new Map()]
    ]);
    
    // In-memory pool states for price tracking: Map<poolAddress, {poolData, liquidity, price}>
    this.poolStates = new Map();
    
    // Map from token address to all its pool addresses: Map<tokenAddress, Set<poolAddress>>
    this.tokenToPools = new Map();
    
    // Latest token prices: Map<tokenAddress, {price, timestamp, source, confidence}>
    this.tokenPrices = new Map();
    
    // Threshold for significant price change (0.5%)
    this.priceChangeThreshold = 0.005;
    
    // Price update handlers: Map<tokenAddress, Set<handler>>
    this.priceUpdateHandlers = new Map();
    
    // Token metadata cache
    this.tokenMetadataCache = new Map();
    
    // Reference to the Helius client
    this.initialized = false;
    
    // Statistics for monitoring
    this.stats = {
      totalPoolsTracked: 0,
      totalTokensTracked: 0,
      priceUpdates: 0,
      significantPriceChanges: 0
    };
  }
  
  /**
   * Initialize the pool tracker
   * @returns {Promise<boolean>} Whether initialization was successful
   */
  async initialize() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} Helius pool tracker`);
      
      // Make sure Helius client is initialized
      if (!heliusClient.initialized) {
        await heliusClient.initialize();
      }
      
      // Set up handler for account updates from Helius WebSocket
      heliusClient.onTokenTransfer(this.handleTokenTransfer.bind(this));
      
      // Listen for custom pool events that may come from other parts of the system
      serviceEvents.on('pool:update', this.handlePoolEvent.bind(this));
      
      this.initialized = true;
      logApi.info(`${formatLog.tag()} ${formatLog.success('Helius pool tracker initialized')}`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize Helius pool tracker:')} ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }
  
  /**
   * Subscribe to pool activity for a specific token
   * @param {string} poolAddress - The liquidity pool address
   * @param {string} tokenAddress - The token address
   * @param {string} eventType - Event type to subscribe to: 'swap', 'liquidity_add', 'liquidity_remove', 'pool_update'
   * @param {Function} handler - Event handler function
   * @returns {Promise<boolean>} Success status
   */
  async subscribeToPoolEvents(poolAddress, tokenAddress, eventType, handler) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Validate event type
      if (!this.eventHandlers.has(eventType)) {
        throw new Error(`Invalid event type: ${eventType}`);
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} to ${formatLog.highlight(eventType)} events for pool ${formatLog.address(poolAddress)}, token ${formatLog.address(tokenAddress)}`);
      
      // Add to pool subscriptions
      if (!this.poolSubscriptions.has(poolAddress)) {
        this.poolSubscriptions.set(poolAddress, new Set());
      }
      this.poolSubscriptions.get(poolAddress).add(tokenAddress);
      
      // Add handler for event type
      const handlersByToken = this.eventHandlers.get(eventType);
      if (!handlersByToken.has(tokenAddress)) {
        handlersByToken.set(tokenAddress, new Set());
      }
      handlersByToken.get(tokenAddress).add(handler);
      
      // Subscribe to pool address via Helius WebSocket if not already subscribed
      await this.subscribeToPoolAccount(poolAddress);
      
      // Fetch initial pool data
      const poolInfo = await this.fetchPoolData(poolAddress);
      
      // Store in cache
      this.poolData.set(poolAddress, {
        ...poolInfo,
        lastUpdated: Date.now()
      });
      
      // Notify handler of initial pool state
      handler({
        type: 'pool_update',
        poolAddress,
        tokenAddress,
        data: poolInfo,
        timestamp: Date.now(),
        source: 'initial'
      });
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to subscribe to pool events:')} ${error.message}`, {
        poolAddress,
        tokenAddress,
        eventType,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Unsubscribe from pool events
   * @param {string} poolAddress - The pool address 
   * @param {string} tokenAddress - The token address
   * @param {string} eventType - Event type to unsubscribe from
   * @param {Function} handler - The handler to remove
   * @returns {Promise<boolean>} Success status
   */
  async unsubscribeFromPoolEvents(poolAddress, tokenAddress, eventType, handler) {
    try {
      // Validate event type
      if (!this.eventHandlers.has(eventType)) {
        throw new Error(`Invalid event type: ${eventType}`);
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('UNSUBSCRIBING')} from ${formatLog.highlight(eventType)} events for pool ${formatLog.address(poolAddress)}, token ${formatLog.address(tokenAddress)}`);
      
      // Remove handler for event type
      const handlersByToken = this.eventHandlers.get(eventType);
      if (handlersByToken.has(tokenAddress)) {
        handlersByToken.get(tokenAddress).delete(handler);
        
        // If no more handlers for this token, delete the token entry
        if (handlersByToken.get(tokenAddress).size === 0) {
          handlersByToken.delete(tokenAddress);
        }
      }
      
      // Check if we need to remove this token from pool subscriptions
      let removeTokenFromPool = true;
      
      // Check if there are any handlers left for this token across all event types
      for (const [eventType, handlersMap] of this.eventHandlers.entries()) {
        if (handlersMap.has(tokenAddress) && handlersMap.get(tokenAddress).size > 0) {
          removeTokenFromPool = false;
          break;
        }
      }
      
      // Remove token from pool subscriptions if no more handlers left
      if (removeTokenFromPool && this.poolSubscriptions.has(poolAddress)) {
        this.poolSubscriptions.get(poolAddress).delete(tokenAddress);
        
        // If no more tokens for this pool, delete the pool entry and unsubscribe from WebSocket
        if (this.poolSubscriptions.get(poolAddress).size === 0) {
          this.poolSubscriptions.delete(poolAddress);
          await this.unsubscribeFromPoolAccount(poolAddress);
        }
      }
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to unsubscribe from pool events:')} ${error.message}`, {
        poolAddress,
        tokenAddress,
        eventType,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Subscribe to a pool account via Helius WebSocket
   * @param {string} poolAddress - The pool address to monitor
   * @returns {Promise<string>} Subscription ID
   */
  async subscribeToPoolAccount(poolAddress) {
    try {
      // Check if we're already subscribed
      if (this.poolSubscriptionIds.has(poolAddress)) {
        return this.poolSubscriptionIds.get(poolAddress);
      }
      
      // Make sure WebSocket is connected
      if (!heliusClient.websocket.wsConnected) {
        throw new Error('WebSocket not connected');
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} to pool account ${formatLog.address(poolAddress)}`);
      
      // Use Helius SDK "accountSubscribe" method to watch for account updates
      const subscriptionId = await heliusClient.websocket.sendWebSocketRequest('accountSubscribe', [
        poolAddress,
        {
          commitment: 'confirmed',
          encoding: 'jsonParsed'
        }
      ]);
      
      // Store subscription ID for later unsubscribe
      this.poolSubscriptionIds.set(poolAddress, subscriptionId);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Subscribed to pool account:')} ${formatLog.address(poolAddress)} (${subscriptionId})`);
      
      return subscriptionId;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to subscribe to pool account:')} ${error.message}`, {
        poolAddress,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Unsubscribe from a pool account
   * @param {string} poolAddress - The pool address to unsubscribe from
   * @returns {Promise<boolean>} Success status
   */
  async unsubscribeFromPoolAccount(poolAddress) {
    try {
      const subscriptionId = this.poolSubscriptionIds.get(poolAddress);
      if (!subscriptionId) {
        return true; // Already unsubscribed
      }
      
      // Make sure WebSocket is connected
      if (!heliusClient.websocket.wsConnected) {
        throw new Error('WebSocket not connected');
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('UNSUBSCRIBING')} from pool account ${formatLog.address(poolAddress)}`);
      
      // Unsubscribe from WebSocket
      await heliusClient.websocket.sendWebSocketRequest('accountUnsubscribe', [subscriptionId]);
      
      // Remove from subscription tracking
      this.poolSubscriptionIds.delete(poolAddress);
      
      // Remove from pool data cache
      this.poolData.delete(poolAddress);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Unsubscribed from pool account:')} ${formatLog.address(poolAddress)}`);
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to unsubscribe from pool account:')} ${error.message}`, {
        poolAddress,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Fetch pool data for a specific pool address
   * @param {string} poolAddress - The pool address
   * @returns {Promise<Object>} Pool data
   */
  async fetchPoolData(poolAddress) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} data for pool ${formatLog.address(poolAddress)}`);
      
      // Get pool info from the database first
      const poolRecord = await prisma.token_pools.findFirst({
        where: { address: poolAddress },
        include: { token: true }
      });
      
      if (!poolRecord) {
        throw new Error(`Pool not found in database: ${poolAddress}`);
      }
      
      // Get account data from Helius - use the tokens service which has fetchFromHeliusRPC through HeliusBase
      const accountInfo = await heliusClient.tokens.fetchFromHeliusRPC('getAccountInfo', [
        poolAddress,
        { encoding: 'jsonParsed' }
      ]);
      
      if (!accountInfo) {
        throw new Error(`Account not found on-chain: ${poolAddress}`);
      }
      
      // Parse account data based on DEX type
      const parsedData = this.parsePoolData(accountInfo, poolRecord);
      
      return {
        poolAddress,
        tokenAddress: poolRecord.tokenAddress,
        tokenSymbol: poolRecord.token.symbol || 'UNKNOWN',
        dex: poolRecord.dex,
        data: parsedData,
        rawAccountInfo: accountInfo
      };
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch pool data:')} ${error.message}`, {
        poolAddress,
        error: error.message
      });
      
      // Return minimal data to prevent errors
      return {
        poolAddress,
        error: error.message,
        data: {},
        timestamp: Date.now()
      };
    }
  }
  
  /**
   * Parse pool data based on DEX type
   * @param {Object} accountInfo - Raw account data from Helius
   * @param {Object} poolRecord - Pool record from database
   * @returns {Object} Parsed pool data
   */
  parsePoolData(accountInfo, poolRecord) {
    try {
      // Get data buffer
      const data = accountInfo.data || [];
      
      // Parse based on DEX type
      switch (poolRecord.dex) {
        case 'RAYDIUM_AMM_V4':
          return this.parseRaydiumPoolData(data, poolRecord);
        case 'ORCA_WHIRLPOOL':
          return this.parseOrcaPoolData(data, poolRecord);
        case 'PUMP_SWAP':
          return this.parsePumpSwapPoolData(data, poolRecord);
        default:
          return {
            dexType: poolRecord.dex,
            tokenAddress: poolRecord.tokenAddress,
            raw: data
          };
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to parse pool data:')} ${error.message}`, {
        dex: poolRecord.dex,
        error: error.message
      });
      
      return {
        error: error.message,
        dexType: poolRecord.dex
      };
    }
  }
  
  /**
   * Parse Raydium pool data
   * @param {Array} data - Account data buffer
   * @param {Object} poolRecord - Pool record from database
   * @returns {Object} Parsed Raydium pool data
   */
  parseRaydiumPoolData(data, poolRecord) {
    // Simplified parsing - in real implementation, you'd have proper Raydium-specific parsing
    return {
      dexType: 'RAYDIUM_AMM_V4',
      tokenAddress: poolRecord.tokenAddress,
      // In a real implementation, you'd extract liquidity values, token amounts, etc.
      dataSize: poolRecord.dataSize
    };
  }
  
  /**
   * Parse Orca pool data
   * @param {Array} data - Account data buffer
   * @param {Object} poolRecord - Pool record from database
   * @returns {Object} Parsed Orca pool data
   */
  parseOrcaPoolData(data, poolRecord) {
    // Simplified parsing - in real implementation, you'd have proper Orca-specific parsing
    return {
      dexType: 'ORCA_WHIRLPOOL',
      tokenAddress: poolRecord.tokenAddress,
      // In a real implementation, you'd extract liquidity values, token amounts, etc.
      dataSize: poolRecord.dataSize
    };
  }
  
  /**
   * Parse PumpSwap pool data
   * @param {Array} data - Account data buffer
   * @param {Object} poolRecord - Pool record from database
   * @returns {Object} Parsed PumpSwap pool data
   */
  parsePumpSwapPoolData(data, poolRecord) {
    // Simplified parsing - in real implementation, you'd have proper PumpSwap-specific parsing
    return {
      dexType: 'PUMP_SWAP',
      tokenAddress: poolRecord.tokenAddress,
      // In a real implementation, you'd extract liquidity values, token amounts, etc.
      dataSize: poolRecord.dataSize
    };
  }
  
  /**
   * Register a token's pool in our lookup map
   * @param {string} tokenAddress - The token address
   * @param {string} poolAddress - The pool address
   */
  registerTokenPool(tokenAddress, poolAddress) {
    if (!this.tokenToPools.has(tokenAddress)) {
      this.tokenToPools.set(tokenAddress, new Set());
      this.stats.totalTokensTracked++;
    }
    
    if (!this.tokenToPools.get(tokenAddress).has(poolAddress)) {
      this.tokenToPools.get(tokenAddress).add(poolAddress);
    }
  }
  
  /**
   * Calculate token price from pool data
   * @param {Object} poolData - Pool data from fetchPoolData
   * @returns {Object|null} Price data with price and liquidity or null if can't calculate
   */
  calculateTokenPrice(poolData) {
    try {
      // Simplified version - real implementation would need DEX-specific calculation logic
      if (!poolData || !poolData.data) {
        return null;
      }
      
      const { dex } = poolData;
      let price = null;
      let liquidity = 0;
      let confidence = 0.5; // Default medium confidence
      
      // Calculate based on DEX type
      switch (dex) {
        case 'RAYDIUM_AMM_V4':
          // Example calculation for Raydium
          // This needs to be adjusted based on actual pool data structure
          if (poolData.data.baseReserve && poolData.data.quoteReserve) {
            const baseReserve = Number(poolData.data.baseReserve);
            const quoteReserve = Number(poolData.data.quoteReserve);
            
            // Assume our token is the base token
            // In real implementation, we'd need to check which one is our token
            price = quoteReserve / baseReserve;
            
            // Calculate liquidity (simplified)
            liquidity = 2 * Math.sqrt(baseReserve * quoteReserve);
            
            // Higher confidence for larger pools
            confidence = Math.min(0.95, 0.5 + (liquidity / 1000000) * 0.45);
          }
          break;
          
        case 'ORCA_WHIRLPOOL':
          // Similar calculations for Orca
          // Would need to understand Orca pool structure
          break;
          
        case 'PUMP_SWAP':
          // Similar calculations for PumpSwap
          // Would need to understand PumpSwap pool structure
          break;
          
        default:
          // Generic fallback if we don't have specific logic
          // This is a simplification and should be replaced with proper calculations
          if (poolData.data.reserves && poolData.data.reserves.length >= 2) {
            const reserve0 = Number(poolData.data.reserves[0]);
            const reserve1 = Number(poolData.data.reserves[1]);
            price = reserve1 / reserve0;
            liquidity = 2 * Math.sqrt(reserve0 * reserve1);
            confidence = Math.min(0.95, 0.5 + (liquidity / 1000000) * 0.45);
          }
      }
      
      if (price === null || isNaN(price) || !isFinite(price)) {
        return null;
      }
      
      return {
        price,
        liquidity: liquidity || 0,
        confidence: confidence
      };
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error calculating price:')} ${error.message}`, {
        poolData: poolData?.address,
        dex: poolData?.dex,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Update pool state and check for price changes
   * @param {string} poolAddress - The pool address
   * @param {string} tokenAddress - The token address
   * @param {Object} poolData - Pool data
   * @returns {Promise<boolean>} Whether a significant price change occurred
   */
  async updatePoolState(poolAddress, tokenAddress, poolData) {
    try {
      // Calculate price from pool data
      const priceData = this.calculateTokenPrice(poolData);
      if (!priceData) {
        return false;
      }
      
      const { price, liquidity, confidence } = priceData;
      
      // Register the pool for this token for future lookup
      this.registerTokenPool(tokenAddress, poolAddress);
      
      // Get previous state
      const previousState = this.poolStates.get(poolAddress);
      const previousPrice = previousState?.price;
      
      // Update in-memory state
      this.poolStates.set(poolAddress, {
        tokenAddress,
        price,
        liquidity,
        confidence,
        lastUpdated: Date.now()
      });
      
      // Update stats if this is a new pool
      if (!previousState) {
        this.stats.totalPoolsTracked++;
      }
      
      this.stats.priceUpdates++;
      
      // Check if the price changed significantly
      let significantChange = false;
      if (previousPrice && price) {
        const priceChange = Math.abs((price - previousPrice) / previousPrice);
        
        // Update best price for this token
        this.updateTokenPrice(tokenAddress, price, poolAddress, liquidity, confidence);
        
        if (priceChange > this.priceChangeThreshold) {
          significantChange = true;
          this.stats.significantPriceChanges++;
          
          // Log significant price changes
          logApi.info(`${formatLog.tag()} ${formatLog.header('PRICE CHANGE')} for token ${formatLog.address(tokenAddress)}: ${formatLog.price(previousPrice)} -> ${formatLog.price(price)} (${(priceChange * 100).toFixed(2)}%)`);
          
          // Store significant price change in database
          try {
            await prisma.pool_price_changes.create({
              data: {
                tokenAddress,
                poolAddress, 
                price: price,
                previousPrice: previousPrice,
                changePercent: priceChange * 100,
                liquidity: liquidity || 0,
                timestamp: new Date()
              }
            });
          } catch (dbError) {
            // If the table doesn't exist yet, just log it - this is non-critical
            logApi.warn(`${formatLog.tag()} ${formatLog.warning('Could not store price update in database:')} ${dbError.message}`);
          }
          
          // Emit price change event for other services
          serviceEvents.emit('token:price_update', {
            tokenAddress,
            poolAddress,
            price: price,
            previousPrice,
            changePercent: priceChange * 100,
            liquidity: liquidity || 0,
            confidence,
            source: 'pool_tracker'
          });
          
          // Notify price update handlers
          this.notifyPriceHandlers(tokenAddress, {
            tokenAddress,
            poolAddress,
            price,
            previousPrice,
            changePercent: priceChange * 100,
            liquidity,
            confidence,
            timestamp: Date.now()
          });
        }
      } else if (price) {
        // First price for this pool, just update token price
        this.updateTokenPrice(tokenAddress, price, poolAddress, liquidity, confidence);
      }
      
      return significantChange;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error updating pool state:')} ${error.message}`, {
        poolAddress,
        tokenAddress,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Update the best price for a token
   * @param {string} tokenAddress - The token address
   * @param {number} price - The new price
   * @param {string} poolAddress - The source pool address
   * @param {number} liquidity - The pool liquidity
   * @param {number} confidence - Confidence score (0-1)
   */
  updateTokenPrice(tokenAddress, price, poolAddress, liquidity, confidence) {
    // Get current best price
    const currentBest = this.tokenPrices.get(tokenAddress);
    
    // If no current price, or new price is from a higher liquidity pool
    if (!currentBest || 
        (liquidity > (currentBest.liquidity || 0)) || 
        (liquidity === currentBest.liquidity && confidence > currentBest.confidence)) {
      
      // Update with new best price
      this.tokenPrices.set(tokenAddress, {
        price,
        liquidity,
        confidence,
        poolAddress,
        lastUpdated: Date.now()
      });
    }
  }
  
  /**
   * Get the current best price for a token
   * @param {string} tokenAddress - The token address
   * @returns {Object|null} - The price data or null if not available
   */
  getTokenPrice(tokenAddress) {
    return this.tokenPrices.get(tokenAddress) || null;
  }
  
  /**
   * Subscribe to price updates for a token
   * @param {string} tokenAddress - The token address to track prices for
   * @param {Function} handler - Callback for price updates
   * @returns {boolean} - Whether subscription was successful
   */
  subscribeToTokenPrice(tokenAddress, handler) {
    try {
      if (!this.priceUpdateHandlers.has(tokenAddress)) {
        this.priceUpdateHandlers.set(tokenAddress, new Set());
      }
      
      this.priceUpdateHandlers.get(tokenAddress).add(handler);
      
      // Send initial price if available
      const currentPrice = this.tokenPrices.get(tokenAddress);
      if (currentPrice) {
        handler({
          tokenAddress,
          price: currentPrice.price,
          liquidity: currentPrice.liquidity,
          confidence: currentPrice.confidence,
          poolAddress: currentPrice.poolAddress,
          lastUpdated: currentPrice.lastUpdated,
          source: 'initial'
        });
      }
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error subscribing to token price:')} ${error.message}`, {
        tokenAddress,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Unsubscribe from price updates for a token
   * @param {string} tokenAddress - The token address
   * @param {Function} handler - The handler to remove
   * @returns {boolean} - Whether unsubscription was successful
   */
  unsubscribeFromTokenPrice(tokenAddress, handler) {
    try {
      if (this.priceUpdateHandlers.has(tokenAddress)) {
        this.priceUpdateHandlers.get(tokenAddress).delete(handler);
        
        if (this.priceUpdateHandlers.get(tokenAddress).size === 0) {
          this.priceUpdateHandlers.delete(tokenAddress);
        }
      }
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error unsubscribing from token price:')} ${error.message}`, {
        tokenAddress,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Notify price update handlers about a price change
   * @param {string} tokenAddress - The token address
   * @param {Object} priceData - The price update data
   */
  notifyPriceHandlers(tokenAddress, priceData) {
    if (this.priceUpdateHandlers.has(tokenAddress)) {
      const handlers = this.priceUpdateHandlers.get(tokenAddress);
      
      for (const handler of handlers) {
        try {
          handler(priceData);
        } catch (error) {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Error in price update handler:')} ${error.message}`, {
            tokenAddress,
            error: error.message
          });
        }
      }
    }
  }
  
  /**
   * Handle token transfer events from Helius client
   * This can be used to detect swaps
   * @param {Object} transferInfo - Token transfer information
   */
  async handleTokenTransfer(transferInfo) {
    try {
      const { tokenAddress, fromAddress, toAddress, amount, type, signature } = transferInfo;
      
      // Check if this transfer is related to a pool we're monitoring
      const matchingPools = [];
      
      // Check if the from or to address is a pool we're monitoring
      if (fromAddress && this.poolSubscriptions.has(fromAddress)) {
        const tokens = this.poolSubscriptions.get(fromAddress);
        if (tokens.has(tokenAddress)) {
          matchingPools.push({ poolAddress: fromAddress, isSource: true });
        }
      }
      
      if (toAddress && this.poolSubscriptions.has(toAddress)) {
        const tokens = this.poolSubscriptions.get(toAddress);
        if (tokens.has(tokenAddress)) {
          matchingPools.push({ poolAddress: toAddress, isSource: false });
        }
      }
      
      // If we have matching pools, this might be a swap or liquidity event
      for (const { poolAddress, isSource } of matchingPools) {
        // Determine the event type based on direction and context
        // This is a simplified approach - real implementation would analyze transaction logs
        let eventType = 'pool_update';
        
        if (isSource) {
          // If tokens are leaving the pool, it could be a swap or liquidity removal
          eventType = 'swap'; // Simplified - ideally you'd analyze the full tx to determine
        } else {
          // If tokens are entering the pool, it could be a swap or liquidity addition
          eventType = 'swap'; // Simplified - ideally you'd analyze the full tx to determine
        }
        
        // Update pool data in cache
        const updatedPoolData = await this.fetchPoolData(poolAddress);
        
        // Update pool state and check for price changes
        const priceChanged = await this.updatePoolState(poolAddress, tokenAddress, updatedPoolData);
        
        // Update regular cache
        this.poolData.set(poolAddress, {
          ...updatedPoolData,
          lastUpdated: Date.now()
        });
        
        // Get current price
        const priceData = this.tokenPrices.get(tokenAddress);
        
        // Create event to notify handlers
        const eventData = {
          type: eventType,
          poolAddress,
          tokenAddress,
          fromAddress,
          toAddress,
          amount,
          transactionType: type,
          signature,
          data: updatedPoolData,
          timestamp: Date.now(),
          source: 'transfer'
        };
        
        // Add price information if available
        if (priceData) {
          eventData.price = priceData.price;
          eventData.priceUpdated = priceChanged;
        }
        
        // Notify all relevant handlers
        this.notifyEventHandlers(eventType, tokenAddress, eventData);
        
        // Also notify pool_update handlers since any swap or liquidity event is also a pool update
        if (eventType !== 'pool_update') {
          this.notifyEventHandlers('pool_update', tokenAddress, {
            ...eventData,
            type: 'pool_update'
          });
        }
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error handling token transfer:')} ${error.message}`, {
        error: error.message,
        transferInfo
      });
    }
  }
  
  /**
   * Handle pool events from other services
   * @param {Object} eventData - Event data
   */
  async handlePoolEvent(eventData) {
    try {
      const { poolAddress, tokenAddress, eventType } = eventData;
      
      if (!poolAddress || !tokenAddress || !eventType) return;
      
      // Check if we're monitoring this pool and token
      if (this.poolSubscriptions.has(poolAddress) && 
          this.poolSubscriptions.get(poolAddress).has(tokenAddress)) {
        
        // Validate event type
        if (!this.eventHandlers.has(eventType)) {
          return;
        }
        
        // Update pool data in cache
        const updatedPoolData = await this.fetchPoolData(poolAddress);
        this.poolData.set(poolAddress, {
          ...updatedPoolData,
          lastUpdated: Date.now()
        });
        
        // Create event to notify handlers
        const fullEventData = {
          ...eventData,
          data: updatedPoolData,
          timestamp: Date.now(),
          source: 'event'
        };
        
        // Notify relevant handlers
        this.notifyEventHandlers(eventType, tokenAddress, fullEventData);
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error handling pool event:')} ${error.message}`, {
        error: error.message,
        eventData
      });
    }
  }
  
  /**
   * Notify event handlers about a pool event
   * @param {string} eventType - The event type
   * @param {string} tokenAddress - The token address
   * @param {Object} eventData - Event data
   */
  notifyEventHandlers(eventType, tokenAddress, eventData) {
    const handlersByToken = this.eventHandlers.get(eventType);
    if (!handlersByToken || !handlersByToken.has(tokenAddress)) {
      return;
    }
    
    const handlers = handlersByToken.get(tokenAddress);
    
    for (const handler of handlers) {
      try {
        handler(eventData);
      } catch (error) {
        logApi.error(`${formatLog.tag()} ${formatLog.error('Error in pool event handler:')} ${error.message}`, {
          eventType,
          tokenAddress,
          error: error.message
        });
      }
    }
  }
  
  /**
   * Get the current pool data
   * @param {string} poolAddress - The pool address
   * @returns {Object|null} Pool data or null if not found
   */
  getPoolData(poolAddress) {
    return this.poolData.get(poolAddress) || null;
  }
  
  /**
   * Force refresh pool data
   * @param {string} poolAddress - The pool address
   * @returns {Promise<Object>} Updated pool data
   */
  async refreshPoolData(poolAddress) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('REFRESHING')} data for pool ${formatLog.address(poolAddress)}`);
      
      const updatedPoolData = await this.fetchPoolData(poolAddress);
      
      // Update cache
      this.poolData.set(poolAddress, {
        ...updatedPoolData,
        lastUpdated: Date.now()
      });
      
      // Notify pool_update handlers
      if (this.poolSubscriptions.has(poolAddress)) {
        const tokens = this.poolSubscriptions.get(poolAddress);
        
        for (const tokenAddress of tokens) {
          const eventData = {
            type: 'pool_update',
            poolAddress,
            tokenAddress,
            data: updatedPoolData,
            timestamp: Date.now(),
            source: 'refresh'
          };
          
          this.notifyEventHandlers('pool_update', tokenAddress, eventData);
        }
      }
      
      return updatedPoolData;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error refreshing pool data:')} ${error.message}`, {
        poolAddress,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Get all pools for a specific token
   * @param {string} tokenAddress - The token address to look for
   * @returns {Promise<Object[]>} Array of pool data objects
   */
  async getPoolsForToken(tokenAddress) {
    try {
      // Query the database for pools with this token
      const pools = await prisma.token_pools.findMany({
        where: { tokenAddress },
        include: { token: true }
      });
      
      return pools;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error fetching pools for token:')} ${error.message}`, {
        tokenAddress,
        error: error.message
      });
      return [];
    }
  }
  
  /**
   * Start monitoring all pools for a specific token
   * @param {string} tokenAddress - The token address
   * @param {Function} handler - Event handler function
   * @returns {Promise<Object>} Results of subscription attempts
   */
  async monitorAllPoolsForToken(tokenAddress, handler) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('MONITORING')} all pools for token ${formatLog.address(tokenAddress)}`);
      
      // Get all pools for this token
      const pools = await this.getPoolsForToken(tokenAddress);
      
      logApi.info(`${formatLog.tag()} ${formatLog.info('Found')} ${formatLog.count(pools.length)} pools for token ${formatLog.address(tokenAddress)}`);
      
      const results = {
        success: [],
        failed: []
      };
      
      // Subscribe to all pools
      for (const pool of pools) {
        try {
          // Subscribe to all event types
          await this.subscribeToPoolEvents(pool.address, tokenAddress, 'swap', handler);
          await this.subscribeToPoolEvents(pool.address, tokenAddress, 'liquidity_add', handler);
          await this.subscribeToPoolEvents(pool.address, tokenAddress, 'liquidity_remove', handler);
          await this.subscribeToPoolEvents(pool.address, tokenAddress, 'pool_update', handler);
          
          results.success.push({
            poolAddress: pool.address,
            dex: pool.dex
          });
        } catch (error) {
          results.failed.push({
            poolAddress: pool.address,
            dex: pool.dex,
            error: error.message
          });
        }
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully subscribed to')} ${formatLog.count(results.success.length)} pools for token ${formatLog.address(tokenAddress)}`);
      
      if (results.failed.length > 0) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Failed to subscribe to')} ${formatLog.count(results.failed.length)} pools for token ${formatLog.address(tokenAddress)}`);
      }
      
      return results;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error monitoring pools for token:')} ${error.message}`, {
        tokenAddress,
        error: error.message
      });
      return {
        success: [],
        failed: [{
          error: error.message
        }]
      };
    }
  }
  
  /**
   * Start monitoring price for a token
   * This is the primary method to use when you want to track a token's price
   * It will automatically find and monitor all pools for the token
   * 
   * @param {string} tokenAddress - The token address to monitor price for
   * @param {Function} [priceHandler] - Optional callback for price updates
   * @returns {Promise<boolean>} Whether monitoring was set up successfully
   */
  async monitorTokenPrice(tokenAddress, priceHandler = null) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('MONITORING PRICE')} for token ${formatLog.address(tokenAddress)}`);
      
      // First, get all pools for this token
      const pools = await this.getPoolsForToken(tokenAddress);
      
      if (pools.length === 0) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('No pools found for token')} ${formatLog.address(tokenAddress)}`);
        return false;
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.info('Found')} ${formatLog.count(pools.length)} pools for price monitoring of ${formatLog.address(tokenAddress)}`);
      
      let success = false;
      
      // Subscribe to pool_update event for each pool
      for (const pool of pools) {
        try {
          // Create a handler that updates price on pool changes
          const poolHandler = async (eventData) => {
            // This will be called whenever the pool updates
            // updatePoolState already handles price calculation and tracking
            await this.updatePoolState(pool.address, tokenAddress, eventData.data);
          };
          
          // Subscribe to pool updates
          await this.subscribeToPoolEvents(pool.address, tokenAddress, 'pool_update', poolHandler);
          
          // Make sure we fetch initial data
          const initialData = await this.fetchPoolData(pool.address);
          await this.updatePoolState(pool.address, tokenAddress, initialData);
          
          success = true;
        } catch (error) {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to monitor pool for price:')} ${error.message}`, {
            poolAddress: pool.address,
            tokenAddress,
            error: error.message
          });
        }
      }
      
      // If there's a price handler, register it
      if (priceHandler && typeof priceHandler === 'function') {
        this.subscribeToTokenPrice(tokenAddress, priceHandler);
      }
      
      return success;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error setting up price monitoring:')} ${error.message}`, {
        tokenAddress,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Get token price with best effort from all available pools
   * @param {string} tokenAddress - The token address
   * @param {boolean} [autoMonitor=true] - Whether to automatically start monitoring if not already
   * @returns {Promise<Object|null>} Price data or null if not available
   */
  async getTokenPriceWithConfidence(tokenAddress, autoMonitor = true) {
    try {
      // Check if we already have the price
      const cachedPrice = this.tokenPrices.get(tokenAddress);
      if (cachedPrice) {
        return {
          price: cachedPrice.price,
          confidence: cachedPrice.confidence,
          liquidity: cachedPrice.liquidity,
          source: `pool:${cachedPrice.poolAddress}`,
          lastUpdated: cachedPrice.lastUpdated
        };
      }
      
      // If autoMonitor is true and we don't have a price, start monitoring
      if (autoMonitor) {
        // Check if we're already monitoring pools for this token
        if (!this.tokenToPools.has(tokenAddress) || this.tokenToPools.get(tokenAddress).size === 0) {
          // Start monitoring
          await this.monitorTokenPrice(tokenAddress);
          
          // Check if we now have a price
          const newPrice = this.tokenPrices.get(tokenAddress);
          if (newPrice) {
            return {
              price: newPrice.price,
              confidence: newPrice.confidence,
              liquidity: newPrice.liquidity,
              source: `pool:${newPrice.poolAddress}`,
              lastUpdated: newPrice.lastUpdated
            };
          }
        }
      }
      
      return null;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error getting token price:')} ${error.message}`, {
        tokenAddress,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Get token price (simpler version that just returns the price number)
   * @param {string} tokenAddress - The token address
   * @param {boolean} [autoMonitor=true] - Whether to automatically start monitoring if not already
   * @returns {Promise<number|null>} Price or null if not available
   */
  async getTokenPrice(tokenAddress, autoMonitor = true) {
    const priceData = await this.getTokenPriceWithConfidence(tokenAddress, autoMonitor);
    return priceData ? priceData.price : null;
  }
  
  /**
   * Get memory usage and statistics
   * @returns {Object} Memory stats
   */
  getMemoryStats() {
    return {
      poolsTracked: this.poolStates.size,
      tokensTracked: this.tokenPrices.size,
      poolSubscriptions: this.poolSubscriptionIds.size,
      tokenToPoolsMappings: this.tokenToPools.size,
      priceUpdateHandlers: Array.from(this.priceUpdateHandlers.keys()).length,
      stats: this.stats
    };
  }
  
  /**
   * Clean up resources
   */
  async cleanup() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('CLEANUP')} Helius pool tracker`);
      
      // Get all subscription IDs
      const poolAddresses = Array.from(this.poolSubscriptionIds.keys());
      
      // Unsubscribe from all WebSocket subscriptions
      for (const poolAddress of poolAddresses) {
        try {
          await this.unsubscribeFromPoolAccount(poolAddress);
        } catch (error) {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to unsubscribe from pool:')} ${error.message}`, {
            poolAddress,
            error: error.message
          });
        }
      }
      
      // Remove event handlers
      heliusClient.removeTokenTransferHandler(this.handleTokenTransfer);
      serviceEvents.removeListener('pool:update', this.handlePoolEvent);
      
      // Clear all data structures
      this.poolSubscriptions.clear();
      this.poolData.clear();
      this.poolSubscriptionIds.clear();
      
      // Clear event handlers
      for (const [eventType, handlersMap] of this.eventHandlers.entries()) {
        handlersMap.clear();
      }
      
      this.initialized = false;
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Helius pool tracker cleaned up')}`);
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to clean up Helius pool tracker:')} ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
    }
  }
}

// Export a singleton instance
export const heliusPoolTracker = new HeliusPoolTracker();
export default heliusPoolTracker;