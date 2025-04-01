// websocket/v69/wallet-ws.js

/**
 * WalletWebSocketServer (v69)
 * 
 * Real-time wallet data WebSocket implementation with:
 * - Balance updates and transaction monitoring
 * - Solana account tracking and balance fetching
 * - Transaction history and confirmation notifications
 * - Digital asset management
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { fancyColors } from '../../utils/colors.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import { solanaEngine } from '../../services/solana-engine/index.js';
import { PublicKey } from '@solana/web3.js';

// Log prefix for Wallet WebSocket
const LOG_PREFIX = `${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE} WALLET-WS ${fancyColors.RESET}`;

// Message type constants
const MESSAGE_TYPES = {
  // Client → Server
  SUBSCRIBE_WALLET: 'subscribe_wallet',
  UNSUBSCRIBE_WALLET: 'unsubscribe_wallet',
  REQUEST_BALANCE: 'request_balance',
  REQUEST_TRANSACTIONS: 'request_transactions',
  REQUEST_ASSETS: 'request_assets',
  
  // Server → Client
  WALLET_UPDATE: 'wallet_update',
  WALLET_STATE: 'wallet_state',
  BALANCE_UPDATE: 'balance_update',
  TRANSACTION_UPDATE: 'transaction_update',
  TRANSACTIONS_LIST: 'transactions_list',
  ASSETS_LIST: 'assets_list',
  ERROR: 'error'
};

// Error codes
const ERROR_CODES = {
  UNAUTHORIZED: 4001,
  INVALID_MESSAGE: 4004,
  NOT_SUBSCRIBED: 4022,
  WALLET_NOT_FOUND: 4044,
  SERVER_ERROR: 5000,
  SOLANA_ERROR: 5003
};

// Constants for channel names
const CHANNELS = {
  WALLET: 'wallet', // wallet.{walletAddress}
  BALANCE: 'balance', // balance.{walletAddress}
  TRANSACTIONS: 'transactions', // transactions.{walletAddress}
  ASSETS: 'assets' // assets.{walletAddress}
};

/**
 * WalletWebSocketServer
 * Provides real-time wallet data, transaction monitoring, and balance updates
 */
class WalletWebSocketServer extends BaseWebSocketServer {
  /**
   * Create a new WalletWebSocketServer
   * @param {http.Server} server - The HTTP server to attach to
   */
  constructor(server) {
    super(server, {
      path: '/api/v69/ws/wallet',
      requireAuth: false, // TEMPORARILY disabled auth for testing
      publicEndpoints: ['*'], // ALL endpoints are public for testing
      maxPayload: 1024 * 1024, // 1MB
      perMessageDeflate: false, // Disable compression for better reliability
      heartbeatInterval: 30000, // 30 seconds
      rateLimit: 100, // 100 messages per minute
      authMode: 'query' // Use query auth mode for most reliable browser connections
    });
    
    // Initialize wallet cache
    this.balanceCache = new Map();
    this.transactionCache = new Map();
    this.assetsCache = new Map();
    
    // Wallet update interval
    this.updateInterval = null;
    this.updateFrequency = 15000; // 15 seconds
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.CYAN}${fancyColors.BOLD}Wallet WebSocket initialized${fancyColors.RESET}`);
  }
  
  /**
   * Initialize the wallet WebSocket
   */
  async onInitialize() {
    try {
      // Start periodic updates
      this.startPeriodicUpdates();
      
      // Subscribe to service events
      serviceEvents.on('transaction:confirmed', this.handleTransactionConfirmed.bind(this));
      serviceEvents.on('balance:updated', this.handleBalanceUpdated.bind(this));
      
      logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}Wallet WebSocket initialized${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Failed to initialize Wallet WebSocket:${fancyColors.RESET} ${error.message}`);
      return false;
    }
  }
  
  /**
   * Start periodic wallet updates
   */
  startPeriodicUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.updateInterval = setInterval(async () => {
      try {
        await this.updateAllWallets();
      } catch (error) {
        logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error updating wallets:${fancyColors.RESET} ${error.message}`);
      }
    }, this.updateFrequency);
    
    logApi.debug(`${LOG_PREFIX} Started periodic wallet updates every ${this.updateFrequency}ms`);
  }
  
  /**
   * Update all cached wallets
   */
  async updateAllWallets() {
    // Get all wallets with active subscriptions
    const wallets = Array.from(this.channelSubscriptions.keys())
      .filter(channel => channel.startsWith(CHANNELS.WALLET))
      .map(channel => channel.split('.')[1]);
    
    // Update each wallet
    for (const wallet of new Set(wallets)) {
      try {
        const balanceData = await this.getWalletBalance(wallet);
        if (balanceData) {
          // Broadcast update to subscribers
          this.broadcastToChannel(`${CHANNELS.WALLET}.${wallet}`, {
            type: MESSAGE_TYPES.BALANCE_UPDATE,
            balance: balanceData,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error updating wallet for ${wallet}:${fancyColors.RESET} ${error.message}`);
      }
    }
  }
  
  /**
   * Get wallet balance
   * @param {string} wallet - Wallet address
   * @returns {Promise<Object>} Balance data
   */
  async getWalletBalance(wallet) {
    try {
      // Check cache first
      if (this.balanceCache.has(wallet)) {
        const cached = this.balanceCache.get(wallet);
        if (Date.now() - cached.timestamp < 10000) { // 10 seconds cache
          return cached.data;
        }
      }
      
      // Get data from database first for speed
      const dbBalance = await prisma.user_balances.findFirst({
        where: { wallet_address: wallet },
        orderBy: { created_at: 'desc' }
      });
      
      // Get on-chain balance (this can be slow, so use DB value as fallback)
      let solanaBalance = null;
      try {
        // Get wallet balance using SolanaEngine
        if (solanaEngine.isInitialized()) {
          // Use executeConnectionMethod to call getBalance
          const publicKey = new PublicKey(wallet);
          solanaBalance = await solanaEngine.executeConnectionMethod('getBalance', publicKey);
        }
      } catch (error) {
        logApi.warn(`${LOG_PREFIX} ${fancyColors.YELLOW}Failed to get on-chain balance for ${wallet}:${fancyColors.RESET} ${error.message}`);
      }
      
      // Format balance data
      const balanceData = {
        wallet_address: wallet,
        balance: dbBalance?.balance.toString() || "0",
        on_chain_balance: solanaBalance ? solanaBalance.toString() : null,
        updated_at: new Date().toISOString()
      };
      
      // Update cache
      this.balanceCache.set(wallet, {
        data: balanceData,
        timestamp: Date.now()
      });
      
      return balanceData;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error fetching wallet balance for ${wallet}:${fancyColors.RESET} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get wallet transactions
   * @param {string} wallet - Wallet address
   * @param {number} limit - Number of transactions to return
   * @returns {Promise<Object>} Transactions data
   */
  async getWalletTransactions(wallet, limit = 50) {
    try {
      const cacheKey = `${wallet}:${limit}`;
      
      // Check cache first
      if (this.transactionCache.has(cacheKey)) {
        const cached = this.transactionCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 30000) { // 30 seconds cache
          return cached.data;
        }
      }
      
      // Get transactions from database
      const transactions = await prisma.user_transactions.findMany({
        where: { wallet_address: wallet },
        orderBy: { timestamp: 'desc' },
        take: limit
      });
      
      // Format transactions
      const formattedTransactions = transactions.map(tx => ({
        id: tx.id,
        transaction_hash: tx.transaction_hash,
        type: tx.transaction_type,
        status: tx.status,
        amount: tx.amount.toString(),
        fee: tx.fee?.toString() || "0",
        timestamp: tx.timestamp.toISOString(),
        confirmations: tx.confirmations,
        metadata: tx.metadata ? JSON.parse(tx.metadata) : {}
      }));
      
      // Format transactions data
      const transactionsData = {
        wallet_address: wallet,
        transactions: formattedTransactions,
        updated_at: new Date().toISOString()
      };
      
      // Update cache
      this.transactionCache.set(cacheKey, {
        data: transactionsData,
        timestamp: Date.now()
      });
      
      return transactionsData;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error fetching wallet transactions for ${wallet}:${fancyColors.RESET} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get wallet digital assets
   * @param {string} wallet - Wallet address
   * @returns {Promise<Object>} Assets data
   */
  async getWalletAssets(wallet) {
    try {
      // Check cache first
      if (this.assetsCache.has(wallet)) {
        const cached = this.assetsCache.get(wallet);
        if (Date.now() - cached.timestamp < 60000) { // 1 minute cache
          return cached.data;
        }
      }
      
      // Get token holdings from database
      const holdings = await prisma.user_token_holdings.findMany({
        where: { wallet_address: wallet },
        include: {
          token: true
        }
      });
      
      // Format assets
      const formattedAssets = holdings.map(holding => ({
        token_address: holding.token.token_address,
        symbol: holding.token.symbol,
        name: holding.token.name,
        amount: holding.amount.toString(),
        decimals: holding.token.decimals,
        logo: holding.token.logo_url
      }));
      
      // Format assets data
      const assetsData = {
        wallet_address: wallet,
        assets: formattedAssets,
        updated_at: new Date().toISOString()
      };
      
      // Update cache
      this.assetsCache.set(wallet, {
        data: assetsData,
        timestamp: Date.now()
      });
      
      return assetsData;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error fetching wallet assets for ${wallet}:${fancyColors.RESET} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Handle transaction confirmed event
   * @param {Object} data - Transaction data
   */
  handleTransactionConfirmed(data) {
    try {
      const { wallet_address, transaction } = data;
      
      // Broadcast transaction update to subscribers
      this.broadcastToChannel(`${CHANNELS.TRANSACTIONS}.${wallet_address}`, {
        type: MESSAGE_TYPES.TRANSACTION_UPDATE,
        transaction: {
          id: transaction.id,
          transaction_hash: transaction.transaction_hash,
          type: transaction.transaction_type,
          status: transaction.status,
          amount: transaction.amount.toString(),
          fee: transaction.fee?.toString() || "0",
          timestamp: transaction.timestamp.toISOString(),
          confirmations: transaction.confirmations,
          metadata: transaction.metadata ? JSON.parse(transaction.metadata) : {}
        },
        timestamp: new Date().toISOString()
      });
      
      // Invalidate transaction cache
      this.transactionCache.delete(`${wallet_address}:50`);
      
      // Update wallet balance since a transaction was confirmed
      this.getWalletBalance(wallet_address)
        .then(balanceData => {
          this.broadcastToChannel(`${CHANNELS.WALLET}.${wallet_address}`, {
            type: MESSAGE_TYPES.BALANCE_UPDATE,
            balance: balanceData,
            timestamp: new Date().toISOString()
          });
        })
        .catch(error => {
          logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error updating balance after transaction for ${wallet_address}:${fancyColors.RESET} ${error.message}`);
        });
      
      // Also invalidate assets cache since holdings might have changed
      this.assetsCache.delete(wallet_address);
      
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error handling transaction confirmation:${fancyColors.RESET} ${error.message}`);
    }
  }
  
  /**
   * Handle balance updated event
   * @param {Object} data - Balance update data
   */
  handleBalanceUpdated(data) {
    try {
      const { wallet_address, balance } = data;
      
      // Invalidate balance cache
      this.balanceCache.delete(wallet_address);
      
      // Update wallet balance
      this.getWalletBalance(wallet_address)
        .then(balanceData => {
          this.broadcastToChannel(`${CHANNELS.WALLET}.${wallet_address}`, {
            type: MESSAGE_TYPES.BALANCE_UPDATE,
            balance: balanceData,
            timestamp: new Date().toISOString()
          });
        })
        .catch(error => {
          logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error updating balance for ${wallet_address}:${fancyColors.RESET} ${error.message}`);
        });
      
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error handling balance update:${fancyColors.RESET} ${error.message}`);
    }
  }
  
  /**
   * Handle new client connection
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   */
  async onConnection(ws, req) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Send welcome message
    this.sendToClient(ws, {
      type: 'welcome',
      message: 'Connected to Wallet WebSocket',
      timestamp: new Date().toISOString()
    });
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}New client connected:${fancyColors.RESET} ${clientInfo.connectionId.substring(0,8)}`);
  }
  
  /**
   * Handle incoming message from client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The parsed message object
   */
  async onMessage(ws, message) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Ensure user is authenticated
    if (!clientInfo.authenticated) {
      this.sendError(ws, 'UNAUTHORIZED', 'Authentication required', ERROR_CODES.UNAUTHORIZED);
      return;
    }
    
    try {
      switch (message.type) {
        case MESSAGE_TYPES.SUBSCRIBE_WALLET:
          // Subscribe to own wallet updates
          await this.subscribeToChannel(ws, `${CHANNELS.WALLET}.${clientInfo.user.wallet_address}`);
          
          // Get initial wallet state
          const balance = await this.getWalletBalance(clientInfo.user.wallet_address);
          
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.WALLET_STATE,
            balance: balance,
            timestamp: new Date().toISOString()
          });
          break;
          
        case MESSAGE_TYPES.UNSUBSCRIBE_WALLET:
          // Unsubscribe from wallet updates
          await this.unsubscribeFromChannel(ws, `${CHANNELS.WALLET}.${clientInfo.user.wallet_address}`);
          
          this.sendToClient(ws, {
            type: 'unsubscribed',
            channel: CHANNELS.WALLET,
            timestamp: new Date().toISOString()
          });
          break;
          
        case MESSAGE_TYPES.REQUEST_BALANCE:
          // Request current balance
          const balanceData = await this.getWalletBalance(clientInfo.user.wallet_address);
          
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.BALANCE_UPDATE,
            balance: balanceData,
            timestamp: new Date().toISOString()
          });
          break;
          
        case MESSAGE_TYPES.REQUEST_TRANSACTIONS:
          // Subscribe to transactions channel
          await this.subscribeToChannel(ws, `${CHANNELS.TRANSACTIONS}.${clientInfo.user.wallet_address}`);
          
          // Get transactions with optional limit
          const limit = message.limit || 50;
          const transactionsData = await this.getWalletTransactions(clientInfo.user.wallet_address, limit);
          
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.TRANSACTIONS_LIST,
            transactions: transactionsData,
            timestamp: new Date().toISOString()
          });
          break;
          
        case MESSAGE_TYPES.REQUEST_ASSETS:
          // Get digital assets
          const assetsData = await this.getWalletAssets(clientInfo.user.wallet_address);
          
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.ASSETS_LIST,
            assets: assetsData,
            timestamp: new Date().toISOString()
          });
          break;
          
        default:
          this.sendError(ws, 'INVALID_MESSAGE', `Unknown message type: ${message.type}`, ERROR_CODES.INVALID_MESSAGE);
      }
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error handling message:${fancyColors.RESET} ${error.message}`, {
        error: error.message,
        stack: error.stack,
        connectionId: clientInfo.connectionId,
        messageType: message.type
      });
      
      this.sendError(ws, 'SERVER_ERROR', 'An error occurred processing your request', ERROR_CODES.SERVER_ERROR);
    }
  }
  
  /**
   * Handle client disconnection
   * @param {WebSocket} ws - The WebSocket connection
   */
  onDisconnection(ws) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.YELLOW}Client disconnected:${fancyColors.RESET} ${clientInfo.connectionId.substring(0,8)}`);
  }
  
  /**
   * Clean up resources
   */
  async onCleanup() {
    // Clear update interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // Clear caches
    this.balanceCache.clear();
    this.transactionCache.clear();
    this.assetsCache.clear();
    
    // Unsubscribe from service events
    serviceEvents.off('transaction:confirmed', this.handleTransactionConfirmed);
    serviceEvents.off('balance:updated', this.handleBalanceUpdated);
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.YELLOW}Wallet WebSocket cleaned up${fancyColors.RESET}`);
  }
  
  /**
   * Get custom metrics for monitoring
   * @returns {Object} Custom metrics
   */
  getCustomMetrics() {
    return {
      cacheSize: {
        balance: this.balanceCache.size,
        transactions: this.transactionCache.size,
        assets: this.assetsCache.size
      },
      subscriptions: {
        wallet: Array.from(this.channelSubscriptions.entries())
          .filter(([channel]) => channel.startsWith(CHANNELS.WALLET))
          .length,
        transactions: Array.from(this.channelSubscriptions.entries())
          .filter(([channel]) => channel.startsWith(CHANNELS.TRANSACTIONS))
          .length
      }
    };
  }
}

/**
 * Create a new WalletWebSocketServer
 * @param {http.Server} server - The HTTP server to attach to
 * @returns {WalletWebSocketServer} The created WebSocket server
 */
export function createWalletWebSocket(server) {
  return new WalletWebSocketServer(server);
}