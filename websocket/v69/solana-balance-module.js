// websocket/v69/solana-balance-module.js

/**
 * Solana Balance Module for Unified WebSocket (v2)
 * 
 * This module provides native SOL balance tracking functionality for the unified WebSocket.
 * It allows users to subscribe to their SOL balance changes and receive real-time updates.
 * 
 * V2 CHANGES:
 * - Uses the Helius balance tracker for real-time updates without polling
 * - Leverages WebSocket subscriptions for account updates instead of polling
 * - Tracks balances through event-based updates from Helius WebSocket API
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import { PublicKey } from '@solana/web3.js';
import { heliusBalanceTracker } from '../../services/solana-engine/helius-balance-tracker.js';

class SolanaBalanceModule {
  constructor() {
    // Track wallet subscriptions: Map<walletAddress, Set<WebSocket>>
    this.walletSubscriptions = new Map();
    
    // Reference to the unified WebSocket server (set during initialization)
    this.uniWs = null;
    
    // Topic for SOL balance updates
    this.TOPIC = 'solana_balance';
    
    // Flag to indicate if we're initialized
    this.initialized = false;
  }

  /**
   * Initialize the Solana balance module
   * @param {Object} uniWs - The unified WebSocket server instance
   * @returns {Promise<boolean>} - Whether initialization was successful
   */
  async initialize(uniWs) {
    try {
      logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Initializing Solana balance module`);
      
      this.uniWs = uniWs;

      // Initialize Helius balance tracker if not already initialized
      if (!heliusBalanceTracker.initialized) {
        await heliusBalanceTracker.initialize();
      }

      // We don't need to register command handlers - the uni-ws.js file
      // already has a handleSolanaBalanceRequest method that will handle incoming 
      // Solana balance requests using the topic-based routing system

      this.initialized = true;
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Solana balance module initialized`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Failed to initialize: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Handle balance updates from the Helius balance tracker
   * @param {Object} balanceData - Balance update data
   */
  handleBalanceUpdate(client, walletAddress, balanceData) {
    try {
      // Only proceed if we have an initialized unified WebSocket
      if (!this.uniWs) return;
      
      const message = {
        type: 'SOLANA_BALANCE_UPDATE',
        walletAddress,
        balance: balanceData.balance,
        lastUpdated: balanceData.lastUpdated,
        timestamp: new Date().toISOString()
      };
      
      // Send to the specific client
      this.uniWs.sendToClient(client, message);
      
      logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Sent SOL balance update to client for ${walletAddress}: ${balanceData.balance}`);
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Error handling balance update: ${error.message}`);
    }
  }

  /**
   * Handle subscribe solana balance command
   * @param {Object} client - The WebSocket client
   * @param {Object} message - The message object
   * @param {Object} userData - The authenticated user data
   */
  async handleSubscribeSolanaBalance(client, message, userData) {
    try {
      const walletAddress = message.walletAddress || userData.wallet_address;
      
      // Make sure we have a wallet address
      if (!walletAddress) {
        this.uniWs.sendError(client, 'No wallet address provided', 'INVALID_PARAMS');
        return;
      }
      
      // Validate wallet address format
      if (!this.isValidSolanaAddress(walletAddress)) {
        this.uniWs.sendError(client, 'Invalid wallet address format', 'INVALID_WALLET_ADDRESS');
        return;
      }
      
      // Only allow subscription to own wallet (security measure)
      if (userData.wallet_address !== walletAddress) {
        logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Attempt to subscribe to another wallet's balance: ${walletAddress}`);
        this.uniWs.sendError(client, 'You can only subscribe to your own wallet balance', 'UNAUTHORIZED');
        return;
      }
      
      // Set up subscription in our tracking
      if (!this.walletSubscriptions.has(walletAddress)) {
        this.walletSubscriptions.set(walletAddress, new Set());
      }
      
      // Add this client to subscribers
      this.walletSubscriptions.get(walletAddress).add(client);
      
      // Subscribe to the topic in the unified WebSocket
      const topic = `${this.TOPIC}:${walletAddress}`;
      this.uniWs.subscribeClientToTopic(client, topic);
      
      // Create a handler for this client/wallet combination
      const balanceHandler = (data) => {
        // Publish to the topic with the unified WebSocket
        this.uniWs.publishToTopic(topic, {
          type: 'SOLANA_BALANCE_UPDATE',
          walletAddress: data.walletAddress,
          balance: data.balance,
          lastUpdated: data.lastUpdated,
          timestamp: new Date().toISOString()
        });
      };
      
      // Subscribe to SOL balance updates via Helius balance tracker
      await heliusBalanceTracker.subscribeSolanaBalance(walletAddress, balanceHandler);
      
      // Store the handler on the client for later cleanup
      client.solanaBalanceHandler = balanceHandler;
      client.solanaBalanceWallet = walletAddress;
      
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Client subscribed to SOL balance updates for wallet: ${walletAddress}`);
      
      // Fetch current balance and send it immediately
      const currentBalance = heliusBalanceTracker.getSolanaBalance(walletAddress);
      this.uniWs.sendToClient(client, {
        type: 'SOLANA_BALANCE_UPDATE',
        walletAddress,
        balance: currentBalance.balance,
        lastUpdated: currentBalance.lastUpdated,
        timestamp: new Date().toISOString()
      });
      
      // Confirm subscription
      this.uniWs.sendToClient(client, {
        type: 'SUBSCRIBED',
        resource: 'solana_balance',
        walletAddress,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Error subscribing to SOL balance: ${error.message}`);
      this.uniWs.sendError(client, 'Error subscribing to SOL balance', 'SUBSCRIPTION_ERROR');
    }
  }

  /**
   * Handle unsubscribe solana balance command
   * @param {Object} client - The WebSocket client
   * @param {Object} message - The message object
   * @param {Object} userData - The authenticated user data
   */
  async handleUnsubscribeSolanaBalance(client, message, userData) {
    try {
      const walletAddress = message.walletAddress || userData.wallet_address;
      
      if (!walletAddress) {
        this.uniWs.sendError(client, 'No wallet address provided', 'INVALID_PARAMS');
        return;
      }
      
      if (!this.walletSubscriptions.has(walletAddress)) {
        return;
      }
      
      // Remove this client from subscribers
      const subscribers = this.walletSubscriptions.get(walletAddress);
      subscribers.delete(client);
      
      // Unsubscribe from the topic in the unified WebSocket
      const topic = `${this.TOPIC}:${walletAddress}`;
      this.uniWs.unsubscribeClientFromTopic(client, topic);
      
      // If no subscribers left, remove the wallet entry
      if (subscribers.size === 0) {
        this.walletSubscriptions.delete(walletAddress);
      }
      
      // Unsubscribe from SOL balance updates via Helius balance tracker
      if (client.solanaBalanceHandler && client.solanaBalanceWallet) {
        await heliusBalanceTracker.unsubscribeSolanaBalance(
          client.solanaBalanceWallet,
          client.solanaBalanceHandler
        );
        
        // Clear the handler reference
        client.solanaBalanceHandler = null;
        client.solanaBalanceWallet = null;
      }
      
      logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Client unsubscribed from SOL balance updates for wallet: ${walletAddress}`);
      
      // Confirm unsubscription
      this.uniWs.sendToClient(client, {
        type: 'UNSUBSCRIBED',
        resource: 'solana_balance',
        walletAddress,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Error unsubscribing from SOL balance: ${error.message}`);
    }
  }

  /**
   * Handle refresh solana balance command
   * @param {Object} client - The WebSocket client
   * @param {Object} message - The message object
   * @param {Object} userData - The authenticated user data
   */
  async handleRefreshSolanaBalance(client, message, userData) {
    try {
      const walletAddress = message.walletAddress || userData.wallet_address;
      
      if (!walletAddress) {
        this.uniWs.sendError(client, 'No wallet address provided', 'INVALID_PARAMS');
        return;
      }
      
      // Only allow refresh of own wallet (security measure)
      if (userData.wallet_address !== walletAddress) {
        this.uniWs.sendError(client, 'You can only refresh your own wallet balance', 'UNAUTHORIZED');
        return;
      }
      
      // Force refresh the balance through the Helius balance tracker
      await heliusBalanceTracker.refreshSolanaBalance(walletAddress);
      
      this.uniWs.sendToClient(client, {
        type: 'BALANCE_REFRESHED',
        resource: 'solana_balance',
        walletAddress,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Error refreshing SOL balance: ${error.message}`);
      this.uniWs.sendError(client, 'Error refreshing SOL balance', 'REFRESH_ERROR');
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    try {
      // Clear subscriptions and cached data
      for (const [walletAddress, clients] of this.walletSubscriptions.entries()) {
        for (const client of clients) {
          if (client.solanaBalanceHandler && client.solanaBalanceWallet) {
            // Unsubscribe from the SOL balance updates
            await heliusBalanceTracker.unsubscribeSolanaBalance(
              client.solanaBalanceWallet,
              client.solanaBalanceHandler
            );
            
            // Clear the handler reference
            client.solanaBalanceHandler = null;
            client.solanaBalanceWallet = null;
          }
        }
      }
      
      // Clear the subscriptions map
      this.walletSubscriptions.clear();
      
      logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Cleaned up Solana balance module`);
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} SOLANA-BALANCE-MODULE ${fancyColors.RESET} Error in cleanup: ${error.message}`);
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
export const solanaBalanceModule = new SolanaBalanceModule();
export default solanaBalanceModule;