// websocket/v69/pool-monitor-module.js

/**
 * Pool Monitor Module for Unified WebSocket
 * 
 * This module provides liquidity pool monitoring functionality for the unified WebSocket.
 * It allows users to subscribe to pool activity such as swaps, liquidity additions/removals,
 * and general pool state changes.
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import { PublicKey } from '@solana/web3.js';
import { heliusPoolTracker } from '../../services/solana-engine/helius-pool-tracker.js';
import prisma from '../../config/prisma.js';

class PoolMonitorModule {
  constructor() {
    // Track pool subscriptions: Map<poolAddress, Set<WebSocket>>
    this.poolSubscriptions = new Map();
    
    // Track token subscriptions: Map<tokenAddress, Set<WebSocket>>
    this.tokenSubscriptions = new Map();
    
    // Reference to the unified WebSocket server (set during initialization)
    this.uniWs = null;
    
    // Topics for different pool events
    this.topics = {
      POOL_UPDATE: 'pool_update',
      SWAP: 'pool_swap',
      LIQUIDITY_ADD: 'pool_liquidity_add',
      LIQUIDITY_REMOVE: 'pool_liquidity_remove',
      ALL_POOLS_FOR_TOKEN: 'token_pools'
    };
    
    // Flag to indicate if we're initialized
    this.initialized = false;
  }

  /**
   * Initialize the pool monitor module
   * @param {Object} uniWs - The unified WebSocket server instance
   * @returns {Promise<boolean>} - Whether initialization was successful
   */
  async initialize(uniWs) {
    try {
      logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Initializing pool monitor module`);
      
      this.uniWs = uniWs;

      // Initialize Helius pool tracker if not already initialized
      if (!heliusPoolTracker.initialized) {
        await heliusPoolTracker.initialize();
      }

      this.initialized = true;
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} POOL-MONITOR-MODULE ${fancyColors.RESET} Pool monitor module initialized`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Failed to initialize: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Handle event updates from the Helius pool tracker
   * @param {Object} client - WebSocket client
   * @param {Object} eventData - Pool event data
   */
  handlePoolEvent(client, poolAddress, eventData) {
    try {
      // Only proceed if we have an initialized unified WebSocket
      if (!this.uniWs) return;
      
      const message = {
        type: eventData.type.toUpperCase(),
        poolAddress: eventData.poolAddress,
        tokenAddress: eventData.tokenAddress,
        data: eventData.data,
        timestamp: new Date().toISOString()
      };
      
      // Add additional fields based on event type
      if (eventData.type === 'swap') {
        message.fromAddress = eventData.fromAddress;
        message.toAddress = eventData.toAddress;
        message.amount = eventData.amount;
      }
      
      // Send to the specific client
      this.uniWs.sendToClient(client, message);
      
      logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Sent pool event to client for pool ${poolAddress}: ${eventData.type}`);
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Error handling pool event: ${error.message}`);
    }
  }

  /**
   * Handle subscribe pool events command
   * @param {Object} client - The WebSocket client
   * @param {Object} message - The message object
   * @param {Object} userData - The authenticated user data
   */
  async handleSubscribePoolEvents(client, message, userData) {
    try {
      const { poolAddress, tokenAddress, eventType } = message;
      
      // Make sure we have a pool address
      if (!poolAddress) {
        this.uniWs.sendError(client, 'No pool address provided', 'INVALID_PARAMS');
        return;
      }
      
      // Make sure we have a token address
      if (!tokenAddress) {
        this.uniWs.sendError(client, 'No token address provided', 'INVALID_PARAMS');
        return;
      }
      
      // Validate pool address format
      if (!this.isValidSolanaAddress(poolAddress)) {
        this.uniWs.sendError(client, 'Invalid pool address format', 'INVALID_POOL_ADDRESS');
        return;
      }
      
      // Validate token address format
      if (!this.isValidSolanaAddress(tokenAddress)) {
        this.uniWs.sendError(client, 'Invalid token address format', 'INVALID_TOKEN_ADDRESS');
        return;
      }
      
      // Validate event type
      const validEventTypes = ['pool_update', 'swap', 'liquidity_add', 'liquidity_remove', 'all'];
      const requestedEventType = eventType || 'all';
      
      if (!validEventTypes.includes(requestedEventType)) {
        this.uniWs.sendError(client, `Invalid event type: ${requestedEventType}. Valid types are: ${validEventTypes.join(', ')}`, 'INVALID_EVENT_TYPE');
        return;
      }
      
      // Verify the pool-token relationship exists in the database
      const poolExists = await prisma.token_pools.findFirst({
        where: {
          address: poolAddress,
          tokenAddress: tokenAddress
        }
      });
      
      if (!poolExists) {
        this.uniWs.sendError(client, 'Pool not found for the specified token', 'POOL_NOT_FOUND');
        return;
      }
      
      // Set up subscription in our tracking
      if (!this.poolSubscriptions.has(poolAddress)) {
        this.poolSubscriptions.set(poolAddress, new Set());
      }
      
      // Add this client to subscribers
      this.poolSubscriptions.get(poolAddress).add(client);
      
      // Also track by token
      if (!this.tokenSubscriptions.has(tokenAddress)) {
        this.tokenSubscriptions.set(tokenAddress, new Set());
      }
      
      this.tokenSubscriptions.get(tokenAddress).add(client);
      
      // Subscribe to the topic in the unified WebSocket
      const baseTopic = `${this.topics.POOL_UPDATE}:${poolAddress}`;
      this.uniWs.subscribeClientToTopic(client, baseTopic);
      
      // Store subscription info on the client for cleanup
      if (!client.poolSubscriptions) {
        client.poolSubscriptions = new Map();
      }
      
      if (!client.poolSubscriptions.has(poolAddress)) {
        client.poolSubscriptions.set(poolAddress, new Set());
      }
      
      // Track which event types this client is subscribed to for this pool
      // (for proper unsubscribe later)
      const eventTypes = requestedEventType === 'all' ? 
        ['pool_update', 'swap', 'liquidity_add', 'liquidity_remove'] : 
        [requestedEventType];
      
      for (const type of eventTypes) {
        client.poolSubscriptions.get(poolAddress).add(type);
        
        // Create a handler for this client/pool/event combination
        const eventHandler = (eventData) => {
          // Publish to the topic with the unified WebSocket
          const topicKey = `${this.mapEventTypeToTopic(type)}:${poolAddress}`;
          this.uniWs.publishToTopic(topicKey, {
            type: type.toUpperCase(),
            poolAddress,
            tokenAddress,
            data: eventData.data,
            timestamp: new Date().toISOString(),
            ...(eventData.fromAddress && { fromAddress: eventData.fromAddress }),
            ...(eventData.toAddress && { toAddress: eventData.toAddress }),
            ...(eventData.amount && { amount: eventData.amount })
          });
        };
        
        // Subscribe to events via Helius pool tracker
        await heliusPoolTracker.subscribeToPoolEvents(poolAddress, tokenAddress, type, eventHandler);
        
        // Store the handler keyed by event type for later cleanup
        if (!client.poolEventHandlers) {
          client.poolEventHandlers = new Map();
        }
        
        if (!client.poolEventHandlers.has(poolAddress)) {
          client.poolEventHandlers.set(poolAddress, new Map());
        }
        
        client.poolEventHandlers.get(poolAddress).set(type, eventHandler);
      }
      
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} POOL-MONITOR-MODULE ${fancyColors.RESET} Client subscribed to pool events for pool: ${poolAddress}, token: ${tokenAddress}, events: ${requestedEventType}`);
      
      // Fetch current pool data and send it immediately
      const poolData = heliusPoolTracker.getPoolData(poolAddress);
      if (poolData) {
        this.uniWs.sendToClient(client, {
          type: 'POOL_UPDATE',
          poolAddress,
          tokenAddress,
          data: poolData,
          timestamp: new Date().toISOString()
        });
      }
      
      // Confirm subscription
      this.uniWs.sendToClient(client, {
        type: 'SUBSCRIBED',
        resource: 'pool_events',
        poolAddress,
        tokenAddress,
        eventType: requestedEventType,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Error subscribing to pool events: ${error.message}`);
      this.uniWs.sendError(client, 'Error subscribing to pool events', 'SUBSCRIPTION_ERROR');
    }
  }

  /**
   * Handle unsubscribe pool events command
   * @param {Object} client - The WebSocket client
   * @param {Object} message - The message object
   * @param {Object} userData - The authenticated user data
   */
  async handleUnsubscribePoolEvents(client, message, userData) {
    try {
      const { poolAddress, tokenAddress, eventType } = message;
      
      if (!poolAddress) {
        this.uniWs.sendError(client, 'No pool address provided', 'INVALID_PARAMS');
        return;
      }
      
      if (!tokenAddress) {
        this.uniWs.sendError(client, 'No token address provided', 'INVALID_PARAMS');
        return;
      }
      
      // Make sure this client has subscriptions for this pool
      if (!client.poolSubscriptions || !client.poolSubscriptions.has(poolAddress)) {
        return;
      }
      
      // Get the event types to unsubscribe from
      let eventTypesToUnsubscribe;
      if (eventType && eventType !== 'all') {
        // Unsubscribe from a specific event type
        eventTypesToUnsubscribe = [eventType];
      } else {
        // Unsubscribe from all event types for this pool
        eventTypesToUnsubscribe = Array.from(client.poolSubscriptions.get(poolAddress));
      }
      
      // Unsubscribe from each event type
      for (const type of eventTypesToUnsubscribe) {
        // Get the handler for this event type
        if (client.poolEventHandlers && 
            client.poolEventHandlers.has(poolAddress) &&
            client.poolEventHandlers.get(poolAddress).has(type)) {
            
          const handler = client.poolEventHandlers.get(poolAddress).get(type);
          
          // Unsubscribe from the Helius pool tracker
          await heliusPoolTracker.unsubscribeFromPoolEvents(
            poolAddress,
            tokenAddress,
            type,
            handler
          );
          
          // Remove handler reference
          client.poolEventHandlers.get(poolAddress).delete(type);
          
          // Remove event type from client's subscriptions
          client.poolSubscriptions.get(poolAddress).delete(type);
          
          // Unsubscribe from the topic in the unified WebSocket
          const topicKey = `${this.mapEventTypeToTopic(type)}:${poolAddress}`;
          this.uniWs.unsubscribeClientFromTopic(client, topicKey);
        }
      }
      
      // If no more event types for this pool, clean up pool references
      if (client.poolSubscriptions.get(poolAddress).size === 0) {
        client.poolSubscriptions.delete(poolAddress);
        
        if (client.poolEventHandlers) {
          client.poolEventHandlers.delete(poolAddress);
        }
        
        // Remove client from pool subscriptions
        if (this.poolSubscriptions.has(poolAddress)) {
          this.poolSubscriptions.get(poolAddress).delete(client);
          
          // If no more clients for this pool, remove the pool entry
          if (this.poolSubscriptions.get(poolAddress).size === 0) {
            this.poolSubscriptions.delete(poolAddress);
          }
        }
        
        // Remove client from token subscriptions
        if (this.tokenSubscriptions.has(tokenAddress)) {
          this.tokenSubscriptions.get(tokenAddress).delete(client);
          
          // If no more clients for this token, remove the token entry
          if (this.tokenSubscriptions.get(tokenAddress).size === 0) {
            this.tokenSubscriptions.delete(tokenAddress);
          }
        }
      }
      
      logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Client unsubscribed from pool events for pool: ${poolAddress}, token: ${tokenAddress}, events: ${eventType || 'all'}`);
      
      // Confirm unsubscription
      this.uniWs.sendToClient(client, {
        type: 'UNSUBSCRIBED',
        resource: 'pool_events',
        poolAddress,
        tokenAddress,
        eventType: eventType || 'all',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Error unsubscribing from pool events: ${error.message}`);
    }
  }

  /**
   * Handle refresh pool data command
   * @param {Object} client - The WebSocket client
   * @param {Object} message - The message object
   * @param {Object} userData - The authenticated user data
   */
  async handleRefreshPoolData(client, message, userData) {
    try {
      const { poolAddress, tokenAddress } = message;
      
      if (!poolAddress) {
        this.uniWs.sendError(client, 'No pool address provided', 'INVALID_PARAMS');
        return;
      }
      
      // Validate pool exists
      const poolExists = await prisma.token_pools.findFirst({
        where: { address: poolAddress }
      });
      
      if (!poolExists) {
        this.uniWs.sendError(client, 'Pool not found', 'POOL_NOT_FOUND');
        return;
      }
      
      // Force refresh pool data through the Helius pool tracker
      const poolData = await heliusPoolTracker.refreshPoolData(poolAddress);
      
      // Send the refreshed data to the client
      this.uniWs.sendToClient(client, {
        type: 'POOL_DATA',
        poolAddress,
        tokenAddress: poolExists.tokenAddress,
        data: poolData,
        timestamp: new Date().toISOString()
      });
      
      // Confirm refresh
      this.uniWs.sendToClient(client, {
        type: 'POOL_REFRESHED',
        poolAddress,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Error refreshing pool data: ${error.message}`);
      this.uniWs.sendError(client, 'Error refreshing pool data', 'REFRESH_ERROR');
    }
  }

  /**
   * Handle get pools for token command
   * @param {Object} client - The WebSocket client
   * @param {Object} message - The message object
   * @param {Object} userData - The authenticated user data
   */
  async handleGetPoolsForToken(client, message, userData) {
    try {
      const { tokenAddress } = message;
      
      if (!tokenAddress) {
        this.uniWs.sendError(client, 'No token address provided', 'INVALID_PARAMS');
        return;
      }
      
      // Validate token address format
      if (!this.isValidSolanaAddress(tokenAddress)) {
        this.uniWs.sendError(client, 'Invalid token address format', 'INVALID_TOKEN_ADDRESS');
        return;
      }
      
      // Get all pools for this token
      const pools = await heliusPoolTracker.getPoolsForToken(tokenAddress);
      
      // Send pools to client
      this.uniWs.sendToClient(client, {
        type: 'TOKEN_POOLS',
        tokenAddress,
        pools: pools.map(pool => ({
          poolAddress: pool.address,
          tokenAddress: pool.tokenAddress,
          dex: pool.dex,
          programId: pool.programId,
          tokenSymbol: pool.token?.symbol || 'UNKNOWN'
        })),
        count: pools.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Error getting pools for token: ${error.message}`);
      this.uniWs.sendError(client, 'Error getting pools for token', 'FETCH_ERROR');
    }
  }

  /**
   * Map event type to topic
   * @param {string} eventType - The event type
   * @returns {string} The corresponding topic
   */
  mapEventTypeToTopic(eventType) {
    switch (eventType) {
      case 'pool_update': return this.topics.POOL_UPDATE;
      case 'swap': return this.topics.SWAP;
      case 'liquidity_add': return this.topics.LIQUIDITY_ADD;
      case 'liquidity_remove': return this.topics.LIQUIDITY_REMOVE;
      default: return this.topics.POOL_UPDATE;
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    try {
      // Clear subscriptions and cached data
      for (const [poolAddress, clients] of this.poolSubscriptions.entries()) {
        for (const client of clients) {
          if (client.poolEventHandlers && client.poolEventHandlers.has(poolAddress)) {
            const handlersMap = client.poolEventHandlers.get(poolAddress);
            
            for (const [eventType, handler] of handlersMap.entries()) {
              try {
                // We need tokenAddress to unsubscribe, look it up in the client's data
                if (client.poolSubscriptions && client.poolSubscriptions.has(poolAddress)) {
                  // Find a token address from the database for this pool
                  const poolRecord = await prisma.token_pools.findFirst({
                    where: { address: poolAddress }
                  });
                  
                  if (poolRecord) {
                    await heliusPoolTracker.unsubscribeFromPoolEvents(
                      poolAddress,
                      poolRecord.tokenAddress,
                      eventType,
                      handler
                    );
                  }
                }
              } catch (error) {
                logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Error unsubscribing during cleanup: ${error.message}`);
              }
            }
          }
          
          // Clear references on the client
          if (client.poolEventHandlers) {
            client.poolEventHandlers.delete(poolAddress);
          }
          
          if (client.poolSubscriptions) {
            client.poolSubscriptions.delete(poolAddress);
          }
        }
      }
      
      // Clear the subscriptions maps
      this.poolSubscriptions.clear();
      this.tokenSubscriptions.clear();
      
      logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Cleaned up pool monitor module`);
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} POOL-MONITOR-MODULE ${fancyColors.RESET} Error in cleanup: ${error.message}`);
    }
  }

  /**
   * Validate if a string is a valid Solana address
   * @param {string} address - The address to validate
   * @returns {boolean} - Whether the address is valid
   */
  isValidSolanaAddress(address) {
    try {
      // Basic format check
      if (!address || typeof address !== 'string') {
        return false;
      }
      
      // Length check
      if (address.length !== 43 && address.length !== 44) {
        return false;
      }
      
      // Character check
      if (!/^[A-Za-z0-9]+$/.test(address)) {
        return false;
      }
      
      // Try to create a PublicKey object
      new PublicKey(address);
      return true;
    } catch (error) {
      return false;
    }
  }
}

// Export a singleton instance
export const poolMonitorModule = new PoolMonitorModule();
export default poolMonitorModule;