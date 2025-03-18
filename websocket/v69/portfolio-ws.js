// websocket/v69/portfolio-ws.js

/**
 * PortfolioWebSocketServer (v69)
 * 
 * Real-time portfolio data WebSocket implementation with:
 * - User-specific portfolio state tracking
 * - Portfolio value updates and performance metrics
 * - Trade execution notifications
 * - Performance history and analytics
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { fancyColors } from '../../utils/colors.js';
import serviceEvents from '../../utils/service-suite/service-events.js';

// Log prefix for Portfolio WebSocket
const LOG_PREFIX = `${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE} PORTFOLIO-WS ${fancyColors.RESET}`;

// Message type constants
const MESSAGE_TYPES = {
  // Client → Server
  PORTFOLIO_UPDATE_REQUEST: 'portfolio_update_request',
  SUBSCRIBE_PORTFOLIO: 'subscribe_portfolio',
  UNSUBSCRIBE_PORTFOLIO: 'unsubscribe_portfolio',
  GET_PORTFOLIO_HISTORY: 'get_portfolio_history',
  GET_PORTFOLIO_PERFORMANCE: 'get_portfolio_performance',
  
  // Server → Client
  PORTFOLIO_UPDATE: 'portfolio_update',
  PORTFOLIO_STATE: 'portfolio_state',
  TRADE_EXECUTED: 'trade_executed',
  PORTFOLIO_PERFORMANCE: 'portfolio_performance',
  PORTFOLIO_HISTORY: 'portfolio_history',
  ERROR: 'error'
};

// Error codes
const ERROR_CODES = {
  PORTFOLIO_NOT_FOUND: 4044,
  INVALID_MESSAGE: 4004,
  UNAUTHORIZED: 4001,
  SERVER_ERROR: 5000,
  SUBSCRIPTION_FAILED: 4022
};

// Constants for channel names
const CHANNELS = {
  PORTFOLIO: 'portfolio', // portfolio.{walletAddress}
  TRADES: 'trades', // trades.{walletAddress}
  PERFORMANCE: 'performance' // performance.{walletAddress}
};

/**
 * PortfolioWebSocketServer
 * Provides real-time portfolio data, trade execution notifications, and performance metrics
 */
class PortfolioWebSocketServer extends BaseWebSocketServer {
  /**
   * Create a new PortfolioWebSocketServer
   * @param {http.Server} server - The HTTP server to attach to
   */
  constructor(server) {
    super(server, {
      path: '/api/v69/ws/portfolio',
      requireAuth: true, // Portfolio data requires authentication
      maxPayload: 1024 * 1024, // 1MB
      perMessageDeflate: false, // Disable compression for better reliability
      heartbeatInterval: 30000, // 30 seconds
      rateLimit: 100, // 100 messages per minute
      authMode: 'query' // Use query auth mode for most reliable browser connections
    });
    
    // Initialize portfolio cache
    this.portfolioCache = new Map();
    this.performanceCache = new Map();
    this.historyCache = new Map();
    
    // Portfolio update interval
    this.updateInterval = null;
    this.updateFrequency = 15000; // 15 seconds
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.CYAN}${fancyColors.BOLD}Portfolio WebSocket initialized${fancyColors.RESET}`);
  }
  
  /**
   * Initialize the portfolio WebSocket
   */
  async onInitialize() {
    try {
      // Start periodic updates
      this.startPeriodicUpdates();
      
      // Subscribe to service events
      serviceEvents.on('trade:executed', this.handleTradeExecuted.bind(this));
      serviceEvents.on('portfolio:updated', this.handlePortfolioUpdated.bind(this));
      
      logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}Portfolio WebSocket initialized${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Failed to initialize Portfolio WebSocket:${fancyColors.RESET} ${error.message}`);
      return false;
    }
  }
  
  /**
   * Start periodic portfolio updates
   */
  startPeriodicUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.updateInterval = setInterval(async () => {
      try {
        await this.updateAllPortfolios();
      } catch (error) {
        logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error updating portfolios:${fancyColors.RESET} ${error.message}`);
      }
    }, this.updateFrequency);
    
    logApi.debug(`${LOG_PREFIX} Started periodic portfolio updates every ${this.updateFrequency}ms`);
  }
  
  /**
   * Update all cached portfolios
   */
  async updateAllPortfolios() {
    // Get all wallets with active subscriptions
    const wallets = Array.from(this.channelSubscriptions.keys())
      .filter(channel => channel.startsWith(CHANNELS.PORTFOLIO))
      .map(channel => channel.split('.')[1]);
    
    // Update each portfolio
    for (const wallet of new Set(wallets)) {
      try {
        const portfolioData = await this.getPortfolioData(wallet);
        if (portfolioData) {
          // Broadcast update to subscribers
          this.broadcastToChannel(`${CHANNELS.PORTFOLIO}.${wallet}`, {
            type: MESSAGE_TYPES.PORTFOLIO_UPDATE,
            portfolio: portfolioData,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error updating portfolio for ${wallet}:${fancyColors.RESET} ${error.message}`);
      }
    }
  }
  
  /**
   * Get portfolio data for a wallet
   * @param {string} wallet - Wallet address
   * @returns {Promise<Object>} Portfolio data
   */
  async getPortfolioData(wallet) {
    try {
      // Check cache first
      if (this.portfolioCache.has(wallet)) {
        const cached = this.portfolioCache.get(wallet);
        if (Date.now() - cached.timestamp < 10000) { // 10 seconds cache
          return cached.data;
        }
      }
      
      // Get portfolio data from database
      const holdings = await prisma.user_token_holdings.findMany({
        where: { wallet_address: wallet },
        include: {
          token: true,
          token_price: true
        }
      });
      
      // Get user balance
      const userBalance = await prisma.user_balances.findFirst({
        where: { wallet_address: wallet },
        orderBy: { created_at: 'desc' }
      });
      
      // Calculate portfolio value
      let totalValue = 0;
      const tokens = holdings.map(holding => {
        const price = holding.token_price?.price || 0;
        const value = holding.amount * price;
        totalValue += value;
        
        return {
          symbol: holding.token.symbol,
          name: holding.token.name,
          amount: holding.amount.toString(),
          price: price.toString(),
          value: value.toString(),
          logo: holding.token.logo_url
        };
      });
      
      // Format portfolio data
      const portfolioData = {
        wallet_address: wallet,
        total_value: totalValue.toString(),
        balance: userBalance?.balance.toString() || "0",
        holdings: tokens,
        updated_at: new Date().toISOString()
      };
      
      // Update cache
      this.portfolioCache.set(wallet, {
        data: portfolioData,
        timestamp: Date.now()
      });
      
      return portfolioData;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error fetching portfolio data for ${wallet}:${fancyColors.RESET} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get portfolio performance data
   * @param {string} wallet - Wallet address
   * @param {string} timeframe - Timeframe (1d, 7d, 30d, etc.)
   * @returns {Promise<Object>} Performance data
   */
  async getPortfolioPerformance(wallet, timeframe = '24h') {
    try {
      const cacheKey = `${wallet}:${timeframe}`;
      
      // Check cache first
      if (this.performanceCache.has(cacheKey)) {
        const cached = this.performanceCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 60000) { // 1 minute cache
          return cached.data;
        }
      }
      
      // Determine time range based on timeframe
      const now = new Date();
      let startDate;
      
      switch (timeframe) {
        case '1h':
          startDate = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '24h':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Default to 24h
      }
      
      // Get historical portfolio values
      const history = await prisma.portfolio_snapshots.findMany({
        where: {
          wallet_address: wallet,
          timestamp: {
            gte: startDate
          }
        },
        orderBy: {
          timestamp: 'asc'
        }
      });
      
      // Calculate performance metrics
      const startValue = history.length > 0 ? Number(history[0].total_value) : 0;
      const endValue = history.length > 0 ? Number(history[history.length - 1].total_value) : 0;
      const absoluteChange = endValue - startValue;
      const percentChange = startValue > 0 ? (absoluteChange / startValue) * 100 : 0;
      
      // Format data points for chart
      const dataPoints = history.map(snapshot => ({
        timestamp: snapshot.timestamp.toISOString(),
        value: snapshot.total_value.toString()
      }));
      
      // Format performance data
      const performanceData = {
        wallet_address: wallet,
        timeframe,
        start_value: startValue.toString(),
        end_value: endValue.toString(),
        absolute_change: absoluteChange.toString(),
        percent_change: percentChange.toFixed(2),
        data_points: dataPoints,
        updated_at: new Date().toISOString()
      };
      
      // Update cache
      this.performanceCache.set(cacheKey, {
        data: performanceData,
        timestamp: Date.now()
      });
      
      return performanceData;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error fetching portfolio performance for ${wallet}:${fancyColors.RESET} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get portfolio history data
   * @param {string} wallet - Wallet address
   * @param {number} limit - Number of entries to return
   * @returns {Promise<Object>} History data
   */
  async getPortfolioHistory(wallet, limit = 30) {
    try {
      const cacheKey = `${wallet}:${limit}`;
      
      // Check cache first
      if (this.historyCache.has(cacheKey)) {
        const cached = this.historyCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 60000) { // 1 minute cache
          return cached.data;
        }
      }
      
      // Get trades history
      const trades = await prisma.user_trades.findMany({
        where: { wallet_address: wallet },
        orderBy: { executed_at: 'desc' },
        take: limit,
        include: {
          token: true
        }
      });
      
      // Format trade history
      const tradeHistory = trades.map(trade => ({
        id: trade.id,
        token_symbol: trade.token.symbol,
        token_name: trade.token.name,
        amount: trade.amount.toString(),
        price: trade.price.toString(),
        value: (trade.amount * trade.price).toString(),
        type: trade.trade_type,
        executed_at: trade.executed_at.toISOString()
      }));
      
      // Format history data
      const historyData = {
        wallet_address: wallet,
        trades: tradeHistory,
        updated_at: new Date().toISOString()
      };
      
      // Update cache
      this.historyCache.set(cacheKey, {
        data: historyData,
        timestamp: Date.now()
      });
      
      return historyData;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error fetching portfolio history for ${wallet}:${fancyColors.RESET} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Handle trade execution event
   * @param {Object} data - Trade data
   */
  handleTradeExecuted(data) {
    try {
      const { wallet_address, token_symbol, amount, price, trade_type } = data;
      
      // Broadcast trade execution to subscribers
      this.broadcastToChannel(`${CHANNELS.TRADES}.${wallet_address}`, {
        type: MESSAGE_TYPES.TRADE_EXECUTED,
        trade: {
          token_symbol,
          amount: amount.toString(),
          price: price.toString(),
          value: (amount * price).toString(),
          type: trade_type,
          executed_at: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });
      
      // Invalidate cache to force update
      this.portfolioCache.delete(wallet_address);
      
      // Update portfolio for this wallet
      this.getPortfolioData(wallet_address)
        .then(portfolioData => {
          this.broadcastToChannel(`${CHANNELS.PORTFOLIO}.${wallet_address}`, {
            type: MESSAGE_TYPES.PORTFOLIO_UPDATE,
            portfolio: portfolioData,
            timestamp: new Date().toISOString()
          });
        })
        .catch(error => {
          logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error updating portfolio after trade for ${wallet_address}:${fancyColors.RESET} ${error.message}`);
        });
      
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error handling trade execution:${fancyColors.RESET} ${error.message}`);
    }
  }
  
  /**
   * Handle portfolio updated event
   * @param {Object} data - Portfolio update data
   */
  handlePortfolioUpdated(data) {
    try {
      const { wallet_address } = data;
      
      // Invalidate cache
      this.portfolioCache.delete(wallet_address);
      
      // Update portfolio for this wallet
      this.getPortfolioData(wallet_address)
        .then(portfolioData => {
          this.broadcastToChannel(`${CHANNELS.PORTFOLIO}.${wallet_address}`, {
            type: MESSAGE_TYPES.PORTFOLIO_UPDATE,
            portfolio: portfolioData,
            timestamp: new Date().toISOString()
          });
        })
        .catch(error => {
          logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error updating portfolio for ${wallet_address}:${fancyColors.RESET} ${error.message}`);
        });
      
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error handling portfolio update:${fancyColors.RESET} ${error.message}`);
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
      message: 'Connected to Portfolio WebSocket',
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
        case MESSAGE_TYPES.PORTFOLIO_UPDATE_REQUEST:
          // Get portfolio data for the authenticated user
          const portfolioData = await this.getPortfolioData(clientInfo.user.wallet_address);
          
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.PORTFOLIO_STATE,
            portfolio: portfolioData,
            timestamp: new Date().toISOString()
          });
          break;
          
        case MESSAGE_TYPES.SUBSCRIBE_PORTFOLIO:
          // Subscribe to own portfolio updates
          await this.subscribeToChannel(ws, `${CHANNELS.PORTFOLIO}.${clientInfo.user.wallet_address}`);
          await this.subscribeToChannel(ws, `${CHANNELS.TRADES}.${clientInfo.user.wallet_address}`);
          
          // Send initial portfolio state
          const portfolio = await this.getPortfolioData(clientInfo.user.wallet_address);
          
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.PORTFOLIO_STATE,
            portfolio: portfolio,
            timestamp: new Date().toISOString()
          });
          break;
          
        case MESSAGE_TYPES.UNSUBSCRIBE_PORTFOLIO:
          // Unsubscribe from portfolio updates
          await this.unsubscribeFromChannel(ws, `${CHANNELS.PORTFOLIO}.${clientInfo.user.wallet_address}`);
          await this.unsubscribeFromChannel(ws, `${CHANNELS.TRADES}.${clientInfo.user.wallet_address}`);
          
          this.sendToClient(ws, {
            type: 'unsubscribed',
            channel: CHANNELS.PORTFOLIO,
            timestamp: new Date().toISOString()
          });
          break;
          
        case MESSAGE_TYPES.GET_PORTFOLIO_PERFORMANCE:
          // Get portfolio performance data
          const timeframe = message.timeframe || '24h';
          const performanceData = await this.getPortfolioPerformance(clientInfo.user.wallet_address, timeframe);
          
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.PORTFOLIO_PERFORMANCE,
            performance: performanceData,
            timestamp: new Date().toISOString()
          });
          break;
          
        case MESSAGE_TYPES.GET_PORTFOLIO_HISTORY:
          // Get portfolio history data
          const limit = message.limit || 30;
          const historyData = await this.getPortfolioHistory(clientInfo.user.wallet_address, limit);
          
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.PORTFOLIO_HISTORY,
            history: historyData,
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
    this.portfolioCache.clear();
    this.performanceCache.clear();
    this.historyCache.clear();
    
    // Unsubscribe from service events
    serviceEvents.off('trade:executed', this.handleTradeExecuted);
    serviceEvents.off('portfolio:updated', this.handlePortfolioUpdated);
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.YELLOW}Portfolio WebSocket cleaned up${fancyColors.RESET}`);
  }
  
  /**
   * Get custom metrics for monitoring
   * @returns {Object} Custom metrics
   */
  getCustomMetrics() {
    return {
      cacheSize: {
        portfolio: this.portfolioCache.size,
        performance: this.performanceCache.size,
        history: this.historyCache.size
      },
      subscriptions: {
        portfolio: Array.from(this.channelSubscriptions.entries())
          .filter(([channel]) => channel.startsWith(CHANNELS.PORTFOLIO))
          .length,
        trades: Array.from(this.channelSubscriptions.entries())
          .filter(([channel]) => channel.startsWith(CHANNELS.TRADES))
          .length,
        performance: Array.from(this.channelSubscriptions.entries())
          .filter(([channel]) => channel.startsWith(CHANNELS.PERFORMANCE))
          .length
      }
    };
  }
}

/**
 * Create a new PortfolioWebSocketServer
 * @param {http.Server} server - The HTTP server to attach to
 * @returns {PortfolioWebSocketServer} The created WebSocket server
 */
export function createPortfolioWebSocket(server) {
  return new PortfolioWebSocketServer(server);
}