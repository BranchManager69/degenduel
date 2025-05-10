// services/solana-engine/helius-balance-tracker.js

import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceSpecificColors, fancyColors } from '../../utils/colors.js';
import { heliusClient } from './helius-client.js';
import serviceEvents from '../../utils/service-suite/service-events.js';

// Formatting helpers for consistent logging
const formatLog = {
  tag: () => `${serviceSpecificColors.heliusClient.tag}[balance-tracker]${fancyColors.RESET}`,
  header: (text) => `${serviceSpecificColors.heliusClient.header} ${text} ${fancyColors.RESET}`,
  success: (text) => `${serviceSpecificColors.heliusClient.success}${text}${fancyColors.RESET}`,
  warning: (text) => `${serviceSpecificColors.heliusClient.warning}${text}${fancyColors.RESET}`,
  error: (text) => `${serviceSpecificColors.heliusClient.error}${text}${fancyColors.RESET}`,
  info: (text) => `${serviceSpecificColors.heliusClient.info}${text}${fancyColors.RESET}`,
  highlight: (text) => `${serviceSpecificColors.heliusClient.highlight}${text}${fancyColors.RESET}`,
  address: (addr) => `${serviceSpecificColors.heliusClient.address}${addr}${fancyColors.RESET}`,
  count: (num) => `${serviceSpecificColors.heliusClient.count}${num}${fancyColors.RESET}`,
};

/**
 * Helius Balance Tracker
 * 
 * A service that uses Helius WebSockets to track SOL and token balances in real-time.
 * Instead of using polling, it leverages Helius's WebSocket API to watch for balance 
 * changes on specified wallets.
 */
class HeliusBalanceTracker {
  constructor() {
    // Track wallet subscriptions for tokens: Map<walletAddress, Set<tokenAddress>>
    this.tokenSubscriptions = new Map();
    
    // Track wallet subscriptions for SOL: Set<walletAddress>
    this.solanaSubscriptions = new Set();
    
    // Cache for wallet balances: Map<walletAddress_tokenAddress, {balance, lastUpdated}>
    this.tokenBalances = new Map();
    
    // Cache for SOL balances: Map<walletAddress, {balance, lastUpdated}>
    this.solanaBalances = new Map();
    
    // Subscription IDs for Helius WebSocket: Map<walletAddress, subscriptionId>
    this.walletSubscriptionIds = new Map();
    
    // Handlers for balance updates
    this.tokenBalanceHandlers = new Map(); // tokenAddress -> Set<handlers>
    this.solanaBalanceHandlers = new Set();
    
    // Reference to the Helius client
    this.initialized = false;
  }
  
  /**
   * Initialize the balance tracker
   * @returns {Promise<boolean>} Whether initialization was successful
   */
  async initialize() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} Helius balance tracker`);
      
      // Make sure Helius client is initialized
      if (!heliusClient.initialized) {
        await heliusClient.initialize();
      }
      
      // Set up handler for account updates from Helius WebSocket
      heliusClient.onTokenTransfer(this.handleTokenTransfer.bind(this));
      
      // Listen for custom wallet events that may come from other parts of the system
      serviceEvents.on('wallet:balance:change', this.handleWalletBalanceEvent.bind(this));
      
      this.initialized = true;
      logApi.info(`${formatLog.tag()} ${formatLog.success('Helius balance tracker initialized')}`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize Helius balance tracker:')} ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }
  
  /**
   * Subscribe to token balance updates for a wallet
   * @param {string} walletAddress - The wallet address to track
   * @param {string} tokenAddress - The token address to track
   * @param {Function} handler - Callback function for balance updates
   * @returns {Promise<boolean>} Whether subscription was successful
   */
  async subscribeTokenBalance(walletAddress, tokenAddress, handler) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} wallet ${formatLog.address(walletAddress)} to token ${formatLog.address(tokenAddress)}`);
      
      // Add to token subscriptions
      if (!this.tokenSubscriptions.has(walletAddress)) {
        this.tokenSubscriptions.set(walletAddress, new Set());
      }
      this.tokenSubscriptions.get(walletAddress).add(tokenAddress);
      
      // Add handler
      const handlerKey = `${tokenAddress}`;
      if (!this.tokenBalanceHandlers.has(handlerKey)) {
        this.tokenBalanceHandlers.set(handlerKey, new Set());
      }
      this.tokenBalanceHandlers.get(handlerKey).add(handler);
      
      // Subscribe to wallet address via Helius WebSocket if not already subscribed
      await this.subscribeToWalletChanges(walletAddress);
      
      // Fetch initial balance
      const initialBalance = await this.fetchTokenBalance(walletAddress, tokenAddress);
      
      // Store in cache
      const cacheKey = `${walletAddress}_${tokenAddress}`;
      this.tokenBalances.set(cacheKey, {
        balance: initialBalance,
        lastUpdated: Date.now()
      });
      
      // Notify handler of initial balance
      handler({
        walletAddress,
        tokenAddress,
        balance: initialBalance,
        lastUpdated: Date.now(),
        source: 'initial'
      });
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to subscribe to token balance:')} ${error.message}`, {
        walletAddress,
        tokenAddress,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Subscribe to SOL balance updates for a wallet
   * @param {string} walletAddress - The wallet address to track
   * @param {Function} handler - Callback function for balance updates
   * @returns {Promise<boolean>} Whether subscription was successful
   */
  async subscribeSolanaBalance(walletAddress, handler) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} wallet ${formatLog.address(walletAddress)} to SOL balance`);
      
      // Add to SOL subscriptions
      this.solanaSubscriptions.add(walletAddress);
      
      // Add handler
      this.solanaBalanceHandlers.add(handler);
      
      // Subscribe to wallet address via Helius WebSocket if not already subscribed
      await this.subscribeToWalletChanges(walletAddress);
      
      // Fetch initial balance
      const initialBalance = await this.fetchSolanaBalance(walletAddress);
      
      // Store in cache
      this.solanaBalances.set(walletAddress, {
        balance: initialBalance,
        lastUpdated: Date.now()
      });
      
      // Notify handler of initial balance
      handler({
        walletAddress,
        balance: initialBalance,
        lastUpdated: Date.now(),
        source: 'initial'
      });
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to subscribe to SOL balance:')} ${error.message}`, {
        walletAddress,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Unsubscribe from token balance updates for a wallet
   * @param {string} walletAddress - The wallet address to untrack
   * @param {string} tokenAddress - The token address to untrack
   * @param {Function} handler - The handler function to remove
   * @returns {Promise<boolean>} Whether unsubscription was successful
   */
  async unsubscribeTokenBalance(walletAddress, tokenAddress, handler) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('UNSUBSCRIBING')} wallet ${formatLog.address(walletAddress)} from token ${formatLog.address(tokenAddress)}`);
      
      // Remove from token subscriptions
      if (this.tokenSubscriptions.has(walletAddress)) {
        const tokens = this.tokenSubscriptions.get(walletAddress);
        tokens.delete(tokenAddress);
        
        // If no more tokens for this wallet, delete the wallet entry
        if (tokens.size === 0) {
          this.tokenSubscriptions.delete(walletAddress);
        }
      }
      
      // Remove handler
      const handlerKey = `${tokenAddress}`;
      if (this.tokenBalanceHandlers.has(handlerKey)) {
        this.tokenBalanceHandlers.get(handlerKey).delete(handler);
        
        // If no more handlers for this token, delete the token entry
        if (this.tokenBalanceHandlers.get(handlerKey).size === 0) {
          this.tokenBalanceHandlers.delete(handlerKey);
        }
      }
      
      // If no more subscriptions for this wallet, unsubscribe from Helius WebSocket
      await this.checkAndCleanupWalletSubscription(walletAddress);
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to unsubscribe from token balance:')} ${error.message}`, {
        walletAddress,
        tokenAddress,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Unsubscribe from SOL balance updates for a wallet
   * @param {string} walletAddress - The wallet address to untrack
   * @param {Function} handler - The handler function to remove
   * @returns {Promise<boolean>} Whether unsubscription was successful
   */
  async unsubscribeSolanaBalance(walletAddress, handler) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('UNSUBSCRIBING')} wallet ${formatLog.address(walletAddress)} from SOL balance`);
      
      // Remove from SOL subscriptions
      this.solanaSubscriptions.delete(walletAddress);
      
      // Remove handler
      this.solanaBalanceHandlers.delete(handler);
      
      // If no more subscriptions for this wallet, unsubscribe from Helius WebSocket
      await this.checkAndCleanupWalletSubscription(walletAddress);
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to unsubscribe from SOL balance:')} ${error.message}`, {
        walletAddress,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Check if a wallet still has any subscriptions, if not, unsubscribe from WebSocket
   * @param {string} walletAddress - The wallet address to check
   * @returns {Promise<void>}
   */
  async checkAndCleanupWalletSubscription(walletAddress) {
    // Check if this wallet still has any token subscriptions
    const hasTokenSubs = this.tokenSubscriptions.has(walletAddress) && 
                        this.tokenSubscriptions.get(walletAddress).size > 0;
                        
    // Check if this wallet still has SOL subscription
    const hasSolanaSub = this.solanaSubscriptions.has(walletAddress);
    
    // If no subscriptions left, unsubscribe from WebSocket
    if (!hasTokenSubs && !hasSolanaSub) {
      const subscriptionId = this.walletSubscriptionIds.get(walletAddress);
      
      if (subscriptionId) {
        // Unsubscribe from WebSocket
        try {
          await heliusClient.websocket.sendWebSocketRequest('accountUnsubscribe', [subscriptionId]);
          this.walletSubscriptionIds.delete(walletAddress);
          
          logApi.info(`${formatLog.tag()} ${formatLog.success('Unsubscribed from WebSocket for wallet:')} ${formatLog.address(walletAddress)}`);
        } catch (error) {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to unsubscribe from WebSocket:')} ${error.message}`, {
            walletAddress,
            subscriptionId,
            error: error.message
          });
        }
      }
      
      // Clean up cached balances
      const tokenCacheKeys = Array.from(this.tokenBalances.keys())
        .filter(key => key.startsWith(`${walletAddress}_`));
        
      for (const key of tokenCacheKeys) {
        this.tokenBalances.delete(key);
      }
      
      this.solanaBalances.delete(walletAddress);
    }
  }
  
  /**
   * Subscribe to wallet balance changes via Helius WebSocket
   * @param {string} walletAddress - The wallet address to subscribe to
   * @returns {Promise<string>} The subscription ID
   */
  async subscribeToWalletChanges(walletAddress) {
    try {
      // Check if we're already subscribed to this wallet
      if (this.walletSubscriptionIds.has(walletAddress)) {
        return this.walletSubscriptionIds.get(walletAddress);
      }
      
      // Make sure WebSocket is connected
      if (!heliusClient.websocket.wsConnected) {
        throw new Error('WebSocket not connected');
      }
      
      // Use Helius SDK "accountSubscribe" method to watch for account updates
      // This will notify us of any account data changes for this wallet
      const subscriptionId = await heliusClient.websocket.sendWebSocketRequest('accountSubscribe', [
        walletAddress,
        {
          commitment: 'confirmed',
          encoding: 'jsonParsed'
        }
      ]);
      
      // Store subscription ID for later unsubscribe
      this.walletSubscriptionIds.set(walletAddress, subscriptionId);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Subscribed to wallet changes:')} ${formatLog.address(walletAddress)} (${subscriptionId})`);
      
      return subscriptionId;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to subscribe to wallet changes:')} ${error.message}`, {
        walletAddress,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Handle token transfer events from Helius client
   * @param {Object} transferInfo - Token transfer information
   * @returns {Promise<void>}
   */
  async handleTokenTransfer(transferInfo) {
    try {
      const { tokenAddress, fromAddress, toAddress } = transferInfo;
      
      // Check if we're tracking either the from or to address for this token
      const affectedWallets = [];
      
      if (fromAddress && this.tokenSubscriptions.has(fromAddress)) {
        const tokens = this.tokenSubscriptions.get(fromAddress);
        if (tokens.has(tokenAddress)) {
          affectedWallets.push(fromAddress);
        }
      }
      
      if (toAddress && this.tokenSubscriptions.has(toAddress)) {
        const tokens = this.tokenSubscriptions.get(toAddress);
        if (tokens.has(tokenAddress)) {
          affectedWallets.push(toAddress);
        }
      }
      
      // No affected wallets we're tracking
      if (affectedWallets.length === 0) {
        return;
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('TOKEN TRANSFER')} detected for token ${formatLog.address(tokenAddress)}, affecting ${affectedWallets.length} tracked wallets`);
      
      // Update balances for affected wallets
      for (const walletAddress of affectedWallets) {
        // Fetch new balance
        const newBalance = await this.fetchTokenBalance(walletAddress, tokenAddress);
        
        // Update cache
        const cacheKey = `${walletAddress}_${tokenAddress}`;
        const oldData = this.tokenBalances.get(cacheKey) || { balance: 0, lastUpdated: 0 };
        
        // Only update if balance changed
        if (oldData.balance !== newBalance) {
          const balanceData = {
            balance: newBalance,
            lastUpdated: Date.now()
          };
          
          this.tokenBalances.set(cacheKey, balanceData);
          
          // Notify handlers
          this.notifyTokenBalanceHandlers(walletAddress, tokenAddress, {
            walletAddress,
            tokenAddress,
            balance: newBalance,
            oldBalance: oldData.balance,
            lastUpdated: Date.now(),
            source: 'transfer'
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
   * Handle wallet balance events from other services
   * @param {Object} eventData - Event data
   * @returns {Promise<void>}
   */
  async handleWalletBalanceEvent(eventData) {
    try {
      const { walletAddress, tokenAddress, balance, source } = eventData;
      
      if (!walletAddress) return;
      
      // Handle token balance update
      if (tokenAddress) {
        // Check if we're tracking this wallet and token
        if (this.tokenSubscriptions.has(walletAddress) && 
            this.tokenSubscriptions.get(walletAddress).has(tokenAddress)) {
          
          // Update cache
          const cacheKey = `${walletAddress}_${tokenAddress}`;
          const oldData = this.tokenBalances.get(cacheKey) || { balance: 0, lastUpdated: 0 };
          
          // Only update if balance changed
          if (oldData.balance !== balance) {
            const balanceData = {
              balance,
              lastUpdated: Date.now()
            };
            
            this.tokenBalances.set(cacheKey, balanceData);
            
            // Notify handlers
            this.notifyTokenBalanceHandlers(walletAddress, tokenAddress, {
              walletAddress,
              tokenAddress,
              balance,
              oldBalance: oldData.balance,
              lastUpdated: Date.now(),
              source: source || 'event'
            });
          }
        }
      } 
      // Handle SOL balance update
      else {
        // Check if we're tracking this wallet for SOL
        if (this.solanaSubscriptions.has(walletAddress)) {
          // Update cache
          const oldData = this.solanaBalances.get(walletAddress) || { balance: 0, lastUpdated: 0 };
          
          // Only update if balance changed
          if (oldData.balance !== balance) {
            const balanceData = {
              balance,
              lastUpdated: Date.now()
            };
            
            this.solanaBalances.set(walletAddress, balanceData);
            
            // Notify handlers
            this.notifySolanaBalanceHandlers(walletAddress, {
              walletAddress,
              balance,
              oldBalance: oldData.balance,
              lastUpdated: Date.now(),
              source: source || 'event'
            });
          }
        }
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error handling wallet balance event:')} ${error.message}`, {
        error: error.message,
        eventData
      });
    }
  }
  
  /**
   * Fetch token balance for a wallet
   * @param {string} walletAddress - The wallet address
   * @param {string} tokenAddress - The token mint address
   * @returns {Promise<number>} - Token balance
   */
  async fetchTokenBalance(walletAddress, tokenAddress) {
    try {
      const tokenAccounts = await heliusClient.tokens.getTokenAccounts({
        owner: walletAddress
      });
      
      if (!tokenAccounts || !tokenAccounts.tokens) {
        return 0;
      }
      
      // Find account for the specified token
      let balance = 0;
      for (const account of tokenAccounts.tokens) {
        if (account.mint === tokenAddress) {
          balance += account.amount / Math.pow(10, account.decimals);
        }
      }
      
      return balance;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error fetching token balance:')} ${error.message}`, {
        walletAddress,
        tokenAddress,
        error: error.message
      });
      return 0;
    }
  }
  
  /**
   * Fetch SOL balance for a wallet
   * @param {string} walletAddress - The wallet address
   * @returns {Promise<number>} - SOL balance
   */
  async fetchSolanaBalance(walletAddress) {
    try {
      const accounts = await heliusClient.tokens.fetchFromHeliusRPC('getBalance', [walletAddress]);
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('SOL BALANCE RAW')} for wallet ${formatLog.address(walletAddress)}: ${JSON.stringify({accounts, type: typeof accounts})}`);
      
      // Convert lamports to SOL (1 SOL = 1,000,000,000 lamports)
      // Check if accounts has valid value or result structure
      let lamports = 0;
      
      if (typeof accounts === 'number') {
        lamports = accounts;
      } else if (accounts && typeof accounts === 'object' && 'value' in accounts) {
        lamports = accounts.value;
      } else if (accounts && typeof accounts === 'object' && 'result' in accounts) {
        lamports = accounts.result;
      }
      
      // Verify value is a valid number
      if (typeof lamports !== 'number' || isNaN(lamports)) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Invalid SOL balance data:')} ${JSON.stringify({accounts, lamports})}`);
        return 0;
      }
      
      const solBalance = lamports / 1_000_000_000;
      
      return solBalance;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error fetching SOL balance:')} ${error.message}`, {
        walletAddress,
        error: error.message
      });
      return 0;
    }
  }
  
  /**
   * Notify token balance handlers about a balance update
   * @param {string} walletAddress - The wallet address
   * @param {string} tokenAddress - The token address
   * @param {Object} balanceData - Balance update data
   */
  notifyTokenBalanceHandlers(walletAddress, tokenAddress, balanceData) {
    const handlerKey = `${tokenAddress}`;
    
    if (this.tokenBalanceHandlers.has(handlerKey)) {
      const handlers = this.tokenBalanceHandlers.get(handlerKey);
      
      for (const handler of handlers) {
        try {
          handler(balanceData);
        } catch (error) {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Error in token balance handler:')} ${error.message}`, {
            walletAddress,
            tokenAddress,
            error: error.message
          });
        }
      }
    }
  }
  
  /**
   * Notify SOL balance handlers about a balance update
   * @param {string} walletAddress - The wallet address
   * @param {Object} balanceData - Balance update data
   */
  notifySolanaBalanceHandlers(walletAddress, balanceData) {
    for (const handler of this.solanaBalanceHandlers) {
      try {
        handler(balanceData);
      } catch (error) {
        logApi.error(`${formatLog.tag()} ${formatLog.error('Error in SOL balance handler:')} ${error.message}`, {
          walletAddress,
          error: error.message
        });
      }
    }
  }
  
  /**
   * Get the current token balance for a wallet
   * @param {string} walletAddress - The wallet address
   * @param {string} tokenAddress - The token address
   * @returns {Object} - Balance data {balance, lastUpdated}
   */
  getTokenBalance(walletAddress, tokenAddress) {
    const cacheKey = `${walletAddress}_${tokenAddress}`;
    return this.tokenBalances.get(cacheKey) || { balance: 0, lastUpdated: 0 };
  }
  
  /**
   * Get the current SOL balance for a wallet
   * @param {string} walletAddress - The wallet address
   * @returns {Object} - Balance data {balance, lastUpdated}
   */
  getSolanaBalance(walletAddress) {
    return this.solanaBalances.get(walletAddress) || { balance: 0, lastUpdated: 0 };
  }
  
  /**
   * Force refresh a token balance
   * @param {string} walletAddress - The wallet address
   * @param {string} tokenAddress - The token address
   * @returns {Promise<number>} - Updated balance
   */
  async refreshTokenBalance(walletAddress, tokenAddress) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('REFRESHING')} token balance for wallet ${formatLog.address(walletAddress)}, token ${formatLog.address(tokenAddress)}`);
      
      const newBalance = await this.fetchTokenBalance(walletAddress, tokenAddress);
      
      // Update cache
      const cacheKey = `${walletAddress}_${tokenAddress}`;
      const oldData = this.tokenBalances.get(cacheKey) || { balance: 0, lastUpdated: 0 };
      
      const balanceData = {
        balance: newBalance,
        lastUpdated: Date.now()
      };
      
      this.tokenBalances.set(cacheKey, balanceData);
      
      // Notify handlers if balance changed
      if (oldData.balance !== newBalance) {
        this.notifyTokenBalanceHandlers(walletAddress, tokenAddress, {
          walletAddress,
          tokenAddress,
          balance: newBalance,
          oldBalance: oldData.balance,
          lastUpdated: Date.now(),
          source: 'refresh'
        });
      }
      
      return newBalance;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error refreshing token balance:')} ${error.message}`, {
        walletAddress,
        tokenAddress,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Force refresh a SOL balance
   * @param {string} walletAddress - The wallet address
   * @returns {Promise<number>} - Updated balance
   */
  async refreshSolanaBalance(walletAddress) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('REFRESHING')} SOL balance for wallet ${formatLog.address(walletAddress)}`);
      
      const newBalance = await this.fetchSolanaBalance(walletAddress);
      
      // Update cache
      const oldData = this.solanaBalances.get(walletAddress) || { balance: 0, lastUpdated: 0 };
      
      const balanceData = {
        balance: newBalance,
        lastUpdated: Date.now()
      };
      
      this.solanaBalances.set(walletAddress, balanceData);
      
      // Notify handlers if balance changed
      if (oldData.balance !== newBalance) {
        this.notifySolanaBalanceHandlers(walletAddress, {
          walletAddress,
          balance: newBalance,
          oldBalance: oldData.balance,
          lastUpdated: Date.now(),
          source: 'refresh'
        });
      }
      
      return newBalance;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error refreshing SOL balance:')} ${error.message}`, {
        walletAddress,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('CLEANUP')} Helius balance tracker`);
      
      // Clean up all Helius WebSocket subscriptions
      const subscriptionIds = Array.from(this.walletSubscriptionIds.values());
      
      if (subscriptionIds.length > 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Unsubscribing from')} ${formatLog.count(subscriptionIds.length)} WebSocket subscriptions`);
        
        // Unsubscribe from all subscriptions
        for (const [walletAddress, subscriptionId] of this.walletSubscriptionIds.entries()) {
          try {
            heliusClient.websocket.sendWebSocketRequest('accountUnsubscribe', [subscriptionId]);
            logApi.info(`${formatLog.tag()} ${formatLog.success('Unsubscribed from WebSocket for wallet:')} ${formatLog.address(walletAddress)}`);
          } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to unsubscribe from WebSocket:')} ${error.message}`, {
              walletAddress,
              subscriptionId,
              error: error.message
            });
          }
        }
      }
      
      // Clean up event handlers
      heliusClient.removeTokenTransferHandler(this.handleTokenTransfer);
      serviceEvents.removeListener('wallet:balance:change', this.handleWalletBalanceEvent);
      
      // Clear all data structures
      this.tokenSubscriptions.clear();
      this.solanaSubscriptions.clear();
      this.tokenBalances.clear();
      this.solanaBalances.clear();
      this.walletSubscriptionIds.clear();
      this.tokenBalanceHandlers.clear();
      this.solanaBalanceHandlers.clear();
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Helius balance tracker cleaned up')}`);
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to clean up Helius balance tracker:')} ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
    }
  }
}

// Export a singleton instance
export const heliusBalanceTracker = new HeliusBalanceTracker();
export default heliusBalanceTracker;