/**
 * MarketDataWebSocketServer (v69)
 * 
 * Consolidated WebSocket server that merges functionality from:
 * - market-ws.js: Market data for prices, volumes, and sentiment
 * - token-data-ws.js: Token metadata and listings
 * 
 * Features:
 * - Symbol subscription/unsubscription
 * - Real-time price, volume and metadata updates
 * - Market sentiment indicators
 * - Efficient multi-user data broadcasting
 * - Event-based subscriptions
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import prisma from '../../config/prisma.js';
import marketDataService from '../../services/marketDataService.js';
import serviceEvents from '../../utils/service-suite/service-events.js';

// Message type constants
const MESSAGE_TYPES = {
  // Client -> Server
  SUBSCRIBE_SYMBOLS: 'SUBSCRIBE_SYMBOLS',
  UNSUBSCRIBE_SYMBOLS: 'UNSUBSCRIBE_SYMBOLS',
  
  // Server -> Client
  MARKET_PRICE: 'MARKET_PRICE',
  MARKET_VOLUME: 'MARKET_VOLUME',
  MARKET_SENTIMENT: 'MARKET_SENTIMENT',
  TOKEN_UPDATE: 'token_update', // Legacy name (from token-data-ws)
  ERROR: 'ERROR'
};

// Error codes
const ERROR_CODES = {
  INVALID_SYMBOLS: 4041,
  INVALID_MESSAGE: 4004,
  SUBSCRIPTION_FAILED: 5002,
  SERVER_ERROR: 5001,
  RATE_LIMIT_EXCEEDED: 4029
};

/**
 * Market Data Service manager
 * Handles market data operations and caching
 */
class MarketDataManager {
  constructor() {
    this.priceCache = new Map();
    this.volumeCache = new Map();
    this.sentimentCache = new Map();
    this.tokenCache = new Map(); // For token metadata
    
    this.updateInterval = 2000; // Reduced from 100ms to 2s to avoid hammering the database
    this.lastDatabaseError = null;
    this.databaseFailedAttempts = 0;
    
    // Keep track of all symbols that have active subscriptions
    this.activeSymbols = new Set();
    
    // Initialize
    this.setupEventListeners();
    this.startDataUpdates();
  }

  /**
   * Set up event listeners for market data broadcasts
   */
  setupEventListeners() {
    // Listen for market data broadcasts from other services
    this.marketDataListener = this.handleMarketDataBroadcast.bind(this);
    serviceEvents.on('market:broadcast', this.marketDataListener);
  }

  /**
   * Handle market data broadcast from other services
   * @param {Object} data - The broadcast data
   */
  handleMarketDataBroadcast(data) {
    if (!data || !data.data || !Array.isArray(data.data)) {
      logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} MARKET DATA ${fancyColors.RESET} ${fancyColors.RED}Invalid market data for broadcast${fancyColors.RESET}`);
      return;
    }
    
    // Update global reference for other services to access
    global.lastTokenData = data.data;
    
    // Update token cache with new data
    for (const token of data.data) {
      if (token.symbol) {
        this.tokenCache.set(token.symbol, token);
        
        // If this token has active price subscriptions, update price cache
        if (this.activeSymbols.has(token.symbol) && token.price) {
          this.priceCache.set(token.symbol, {
            current: token.price,
            change_24h: token.change_24h || 0,
            volume_24h: token.volume_24h || 0,
            high_24h: token.high_24h || 0,
            low_24h: token.low_24h || 0,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
    
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} MARKET DATA ${fancyColors.RESET} ${fancyColors.GREEN}Received market data broadcast: ${data.data.length} tokens${fancyColors.RESET}`);
  }

  /**
   * Register a symbol as active (has subscribers)
   * @param {string} symbol - The token symbol
   */
  registerActiveSymbol(symbol) {
    this.activeSymbols.add(symbol);
  }

  /**
   * Unregister a symbol as active (no subscribers)
   * @param {string} symbol - The token symbol
   */
  unregisterActiveSymbol(symbol) {
    this.activeSymbols.delete(symbol);
  }

  /**
   * Get latest price data for a symbol
   * @param {string} symbol - Token symbol
   * @returns {Promise<Object>} Price data
   */
  async getPrice(symbol) {
    try {
      // Always return cached data if available and database is having issues
      if (this.lastDatabaseError && this.priceCache.has(symbol)) {
        return this.priceCache.get(symbol);
      }

      // Check if we should attempt database request
      if (this.lastDatabaseError) {
        const timeSinceError = Date.now() - this.lastDatabaseError;
        if (timeSinceError < Math.min(30000, Math.pow(2, this.databaseFailedAttempts) * 1000)) {
          // Still in backoff period, use cache
          return this.priceCache.get(symbol) || null;
        }
      }

      const price = await prisma.token_prices.findFirst({
        where: { symbol },
        orderBy: { timestamp: 'desc' }
      });

      if (price) {
        this.priceCache.set(symbol, {
          current: price.price,
          change_24h: price.change_24h,
          volume_24h: price.volume_24h,
          high_24h: price.high_24h,
          low_24h: price.low_24h,
          timestamp: price.timestamp
        });
        // Reset database error state on success
        this.lastDatabaseError = null;
        this.databaseFailedAttempts = 0;
      }

      return this.priceCache.get(symbol);
    } catch (error) {
      // Track database failures for backoff
      this.lastDatabaseError = Date.now();
      this.databaseFailedAttempts++;
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} MARKET DATA ${fancyColors.RESET} ${fancyColors.RED}Error fetching price data:${fancyColors.RESET}`, {
        error: error.message,
        failedAttempts: this.databaseFailedAttempts,
        nextRetryIn: Math.pow(2, this.databaseFailedAttempts)
      });
      // Return cached data if available
      return this.priceCache.get(symbol) || null;
    }
  }

  /**
   * Get latest volume data for a symbol
   * @param {string} symbol - Token symbol
   * @returns {Promise<Object>} Volume data
   */
  async getVolume(symbol) {
    try {
      if (this.volumeCache.has(symbol)) {
        return this.volumeCache.get(symbol);
      }

      const volume = await prisma.token_volumes.findFirst({
        where: { symbol },
        orderBy: { timestamp: 'desc' }
      });

      if (volume) {
        this.volumeCache.set(symbol, {
          total: volume.total_volume,
          trades_count: volume.trades_count,
          buy_volume: volume.buy_volume,
          sell_volume: volume.sell_volume,
          interval: '1h',
          timestamp: volume.timestamp
        });
      }

      return this.volumeCache.get(symbol);
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} MARKET DATA ${fancyColors.RESET} ${fancyColors.RED}Error fetching volume data:${fancyColors.RESET}`, error);
      return null;
    }
  }

  /**
   * Get latest sentiment data for a symbol
   * @param {string} symbol - Token symbol
   * @returns {Promise<Object>} Sentiment data
   */
  async getSentiment(symbol) {
    try {
      if (this.sentimentCache.has(symbol)) {
        return this.sentimentCache.get(symbol);
      }

      const sentiment = await prisma.token_sentiment.findFirst({
        where: { symbol },
        orderBy: { timestamp: 'desc' }
      });

      if (sentiment) {
        this.sentimentCache.set(symbol, {
          score: sentiment.sentiment_score,
          buy_pressure: sentiment.buy_pressure,
          sell_pressure: sentiment.sell_pressure,
          volume_trend: sentiment.volume_trend,
          timestamp: sentiment.timestamp
        });
      }

      return this.sentimentCache.get(symbol);
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} MARKET DATA ${fancyColors.RESET} ${fancyColors.RED}Error fetching sentiment data:${fancyColors.RESET}`, error);
      return null;
    }
  }

  /**
   * Get token metadata for a symbol
   * @param {string} symbol - Token symbol
   * @returns {Promise<Object>} Token metadata
   */
  async getToken(symbol) {
    try {
      // If in cache, return immediately
      if (this.tokenCache.has(symbol)) {
        return this.tokenCache.get(symbol);
      }

      // Otherwise get from service
      const token = await marketDataService.getToken(symbol);
      if (token) {
        this.tokenCache.set(symbol, token);
      }
      return token;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} MARKET DATA ${fancyColors.RESET} ${fancyColors.RED}Error fetching token data:${fancyColors.RESET}`, error);
      return null;
    }
  }

  /**
   * Get all tokens (metadata)
   * @returns {Promise<Array>} Array of token data
   */
  async getAllTokens() {
    try {
      const tokens = await marketDataService.getAllTokens();
      
      // Update cache with fetched tokens
      if (tokens && tokens.length > 0) {
        for (const token of tokens) {
          if (token.symbol) {
            this.tokenCache.set(token.symbol, token);
          }
        }
      }
      
      return tokens;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} MARKET DATA ${fancyColors.RESET} ${fancyColors.RED}Error fetching all tokens:${fancyColors.RESET}`, error);
      
      // If we have cached tokens, return those as fallback
      if (this.tokenCache.size > 0) {
        return Array.from(this.tokenCache.values());
      }
      
      return [];
    }
  }

  /**
   * Start periodic data updates
   */
  startDataUpdates() {
    setInterval(async () => {
      try {
        // Only update data for active symbols
        const activeSymbols = Array.from(this.activeSymbols);
        
        for (const symbol of activeSymbols) {
          await Promise.all([
            this.updatePrice(symbol),
            this.updateVolume(symbol),
            this.updateSentiment(symbol)
          ]);
        }
      } catch (error) {
        logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} MARKET DATA ${fancyColors.RESET} ${fancyColors.RED}Error updating market data:${fancyColors.RESET}`, error);
      }
    }, this.updateInterval);
  }

  /**
   * Update price data for a symbol
   * @param {string} symbol - Token symbol
   */
  async updatePrice(symbol) {
    try {
      const price = await prisma.token_prices.findFirst({
        where: { symbol },
        orderBy: { timestamp: 'desc' }
      });

      if (price) {
        this.priceCache.set(symbol, {
          current: price.price,
          change_24h: price.change_24h,
          volume_24h: price.volume_24h,
          high_24h: price.high_24h,
          low_24h: price.low_24h,
          timestamp: price.timestamp
        });
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} MARKET DATA ${fancyColors.RESET} ${fancyColors.RED}Error updating price:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Update volume data for a symbol
   * @param {string} symbol - Token symbol
   */
  async updateVolume(symbol) {
    try {
      const volume = await prisma.token_volumes.findFirst({
        where: { symbol },
        orderBy: { timestamp: 'desc' }
      });

      if (volume) {
        this.volumeCache.set(symbol, {
          total: volume.total_volume,
          trades_count: volume.trades_count,
          buy_volume: volume.buy_volume,
          sell_volume: volume.sell_volume,
          interval: '1h',
          timestamp: volume.timestamp
        });
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} MARKET DATA ${fancyColors.RESET} ${fancyColors.RED}Error updating volume:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Update sentiment data for a symbol
   * @param {string} symbol - Token symbol
   */
  async updateSentiment(symbol) {
    try {
      const sentiment = await prisma.token_sentiment.findFirst({
        where: { symbol },
        orderBy: { timestamp: 'desc' }
      });

      if (sentiment) {
        this.sentimentCache.set(symbol, {
          score: sentiment.sentiment_score,
          buy_pressure: sentiment.buy_pressure,
          sell_pressure: sentiment.sell_pressure,
          volume_trend: sentiment.volume_trend,
          timestamp: sentiment.timestamp
        });
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} MARKET DATA ${fancyColors.RESET} ${fancyColors.RED}Error updating sentiment:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    // Remove event listeners
    serviceEvents.removeListener('market:broadcast', this.marketDataListener);
    
    // Clear caches
    this.priceCache.clear();
    this.volumeCache.clear();
    this.sentimentCache.clear();
    this.tokenCache.clear();
    this.activeSymbols.clear();
  }
}

/**
 * Consolidated Market Data WebSocket
 * Combines functionality from both market-ws.js and token-data-ws.js
 */
export class MarketDataWebSocketServer extends BaseWebSocketServer {
  constructor(server) {
    super(server, {
      // Support both legacy paths for backward compatibility
      path: '/api/v69/ws/market-data',
      publicEndpoints: ['/api/v2/ws/market', '/api/ws/token-data'],
      maxPayload: 5 * 1024 * 1024, // 5MB, plenty of room for token data
      requireAuth: false, // Public data endpoint
      perMessageDeflate: false, // Disable compression to match token-data-ws behavior
      rateLimit: 600 // 10 requests/second
    });

    // Initialize state
    /** @type {Map<string, Set<string>>} userId/clientId -> Set<symbol> */
    this.symbolSubscriptions = new Map();
    
    // Counter for stats
    this.messageCounter = {
      broadcast: 0,
      received: 0,
      errors: 0
    };
    
    // Create data manager
    this.marketDataManager = new MarketDataManager();
    
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.CYAN}Market Data WebSocket initialized at ${this.path}${fancyColors.RESET}`);
  }

  /**
   * Initialize the WebSocket server
   */
  async onInitialize() {
    try {
      // Load initial token data for clients that connect immediately
      const initialData = await this.marketDataManager.getAllTokens();
      if (initialData && initialData.length > 0) {
        this.initialTokenData = {
          type: MESSAGE_TYPES.TOKEN_UPDATE, // Use legacy token-data-ws message type
          timestamp: new Date().toISOString(),
          data: initialData
        };
        logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.DARK_GREEN}Loaded initial token data with ${initialData.length} tokens${fancyColors.RESET}`);
      }
      
      // Start data broadcast stream (every 1 second)
      this._tokenDataBroadcastInterval = setInterval(() => {
        this.broadcastTokenUpdates();
      }, 1000);
      
      // Start market data broadcast stream (every 100ms)
      this._marketDataBroadcastInterval = setInterval(() => {
        this.broadcastMarketData();
      }, 100);
      
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.GREEN}Market Data WebSocket server initialization complete${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.RED}Error initializing Market Data WebSocket:${fancyColors.RESET}`, error);
      return false;
    }
  }

  /**
   * Handle client connection
   */
  async onConnection(ws, req) {
    try {
      const clientInfo = this.clientInfoMap.get(ws);
      if (!clientInfo) return;
      
      // Send initial data if available
      if (this.initialTokenData) {
        this.sendToClient(ws, this.initialTokenData);
        logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.DARK_GREEN}Sent initial token data to new client${fancyColors.RESET}`);
      }
      
      // Check if this connection is using a legacy path
      const { pathname } = new URL(req.url, 'http://localhost');
      
      if (pathname.includes('/api/v2/ws/market')) {
        clientInfo.clientType = 'market';
        logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.CYAN}Legacy market WebSocket client connected${fancyColors.RESET}`);
      } else if (pathname.includes('/api/ws/token-data')) {
        clientInfo.clientType = 'token-data';
        logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.CYAN}Legacy token-data WebSocket client connected${fancyColors.RESET}`);
      } else {
        clientInfo.clientType = 'v69';
        logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.CYAN}V69 market-data WebSocket client connected${fancyColors.RESET}`);
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.RED}Error in onConnection:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle client message
   */
  async onMessage(ws, message) {
    // Increment message counter
    this.messageCounter.received++;
    
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    try {
      // Handle legacy token-data-ws message format
      if (message.type === 'subscribe' && message.symbols && Array.isArray(message.symbols)) {
        await this.handleSymbolSubscription(ws, clientInfo, message.symbols);
        return;
      }
      
      // Handle legacy market-ws message format
      if (message.type === MESSAGE_TYPES.SUBSCRIBE_SYMBOLS && message.symbols && Array.isArray(message.symbols)) {
        await this.handleSymbolSubscription(ws, clientInfo, message.symbols);
        return;
      }
      
      // Handle legacy market-ws unsubscribe format
      if (message.type === MESSAGE_TYPES.UNSUBSCRIBE_SYMBOLS && message.symbols && Array.isArray(message.symbols)) {
        await this.handleSymbolUnsubscription(ws, clientInfo, message.symbols);
        return;
      }
      
      // For token update messages from admin clients (legacy token-data-ws format)
      if (message.type === MESSAGE_TYPES.TOKEN_UPDATE && message.data && 
          Array.isArray(message.data) && clientInfo.authenticated && 
          (clientInfo.user.role === 'admin' || clientInfo.user.role === 'superadmin')) {
        
        logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.GREEN}Received token data from admin: ${message.data.length} tokens${fancyColors.RESET}`);
        
        // Store for use by other services
        global.lastTokenData = message.data;
        
        // Broadcast to other clients
        this.broadcast(message, [ws]); // Exclude the sender
        
        return;
      }
      
      // Handle unknown message types
      logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.YELLOW}Unknown message type: ${message.type}${fancyColors.RESET}`);
      this.sendError(ws, ERROR_CODES.INVALID_MESSAGE, `Unknown message type: ${message.type}`);
      
    } catch (error) {
      this.messageCounter.errors++;
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.RED}Error handling message:${fancyColors.RESET}`, error);
      this.sendError(ws, ERROR_CODES.SERVER_ERROR, 'Server error processing message');
    }
  }

  /**
   * Handle symbol subscription request
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {string[]} symbols - Array of token symbols
   */
  async handleSymbolSubscription(ws, clientInfo, symbols) {
    try {
      if (!Array.isArray(symbols) || symbols.length === 0) {
        this.sendError(ws, ERROR_CODES.INVALID_MESSAGE, 'Invalid symbols format');
        return;
      }

      // Validate symbols
      const validSymbols = await prisma.tokens.findMany({
        where: {
          symbol: {
            in: symbols
          },
          is_active: true
        },
        select: {
          symbol: true
        }
      });

      if (validSymbols.length === 0) {
        this.sendError(ws, ERROR_CODES.INVALID_SYMBOLS, 'No valid symbols provided');
        return;
      }

      // Track client ID for subscription
      const clientId = clientInfo.connectionId;
      
      // Add to subscriptions
      if (!this.symbolSubscriptions.has(clientId)) {
        this.symbolSubscriptions.set(clientId, new Set());
      }
      
      const userSubs = this.symbolSubscriptions.get(clientId);
      validSymbols.forEach(({ symbol }) => {
        userSubs.add(symbol);
        // Register symbol as active with the data manager
        this.marketDataManager.registerActiveSymbol(symbol);
      });

      // Send initial state for each symbol based on client type
      if (clientInfo.clientType === 'market' || clientInfo.clientType === 'v69') {
        // For market data clients, send price, volume, and sentiment
        await Promise.all(
          validSymbols.map(({ symbol }) => this.sendMarketData(ws, symbol))
        );
      }
      
      if (clientInfo.clientType === 'token-data' || clientInfo.clientType === 'v69') {
        // For token-data clients, send token metadata
        const tokens = [];
        for (const { symbol } of validSymbols) {
          const token = await this.marketDataManager.getToken(symbol);
          if (token) {
            tokens.push(token);
          }
        }
        
        if (tokens.length > 0) {
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.TOKEN_UPDATE,
            timestamp: new Date().toISOString(),
            data: tokens
          });
        }
      }

      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.GREEN}Client subscribed to symbols:${fancyColors.RESET}`, {
        clientId: clientId.substring(0,8),
        symbols: validSymbols.map(s => s.symbol),
        clientType: clientInfo.clientType
      });

    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.RED}Error in symbol subscription:${fancyColors.RESET}`, error);
      this.sendError(ws, ERROR_CODES.SUBSCRIPTION_FAILED, 'Failed to subscribe to market data');
    }
  }

  /**
   * Handle symbol unsubscription request
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {string[]} symbols - Array of token symbols
   */
  async handleSymbolUnsubscription(ws, clientInfo, symbols) {
    const clientId = clientInfo.connectionId;
    const userSubs = this.symbolSubscriptions.get(clientId);
    
    if (userSubs) {
      symbols.forEach(symbol => {
        userSubs.delete(symbol);
        
        // Check if this symbol still has any subscribers
        let hasSubscribers = false;
        for (const [, subs] of this.symbolSubscriptions) {
          if (subs.has(symbol)) {
            hasSubscribers = true;
            break;
          }
        }
        
        // If no more subscribers, unregister symbol as active
        if (!hasSubscribers) {
          this.marketDataManager.unregisterActiveSymbol(symbol);
        }
      });
      
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.YELLOW}Client unsubscribed from symbols:${fancyColors.RESET}`, {
        clientId: clientId.substring(0,8),
        symbols
      });
      
      // Send unsubscription confirmation
      this.sendToClient(ws, {
        type: 'unsubscription_confirmed',
        symbols,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Send market data to client
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} symbol - Token symbol
   */
  async sendMarketData(ws, symbol) {
    try {
      const [price, volume, sentiment] = await Promise.all([
        this.marketDataManager.getPrice(symbol),
        this.marketDataManager.getVolume(symbol),
        this.marketDataManager.getSentiment(symbol)
      ]);

      // Send price data
      if (price) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.MARKET_PRICE,
          data: {
            symbol,
            ...price,
            timestamp: new Date().toISOString()
          }
        });
      }

      // Send volume data
      if (volume) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.MARKET_VOLUME,
          data: {
            symbol,
            ...volume,
            timestamp: new Date().toISOString()
          }
        });
      }

      // Send sentiment data
      if (sentiment) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.MARKET_SENTIMENT,
          data: {
            symbol,
            ...sentiment,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.RED}Error sending market data:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Broadcast market data updates to clients
   */
  async broadcastMarketData() {
    try {
      // Get active symbols with subscribers
      const allSymbols = new Set();
      for (const subscriptions of this.symbolSubscriptions.values()) {
        for (const symbol of subscriptions) {
          allSymbols.add(symbol);
        }
      }

      // If no active symbols, skip broadcast
      if (allSymbols.size === 0) return;

      // Get clients for each symbol
      for (const symbol of allSymbols) {
        // Find all market data clients subscribed to this symbol
        const clients = Array.from(this.clients)
          .filter(client => {
            const clientInfo = this.clientInfoMap.get(client);
            if (!clientInfo) return false;
            
            // Only send market data to market or v69 clients
            if (clientInfo.clientType !== 'market' && clientInfo.clientType !== 'v69') {
              return false;
            }
            
            // Check if client is subscribed to this symbol
            const clientSubs = this.symbolSubscriptions.get(clientInfo.connectionId);
            return clientSubs && clientSubs.has(symbol);
          });

        // If no clients for this symbol, skip
        if (clients.length === 0) continue;

        // Send market data to all subscribing clients
        await Promise.all(
          clients.map(client => this.sendMarketData(client, symbol))
        );
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.RED}Error in market data broadcast:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Broadcast token updates to clients
   */
  async broadcastTokenUpdates() {
    try {
      // If no token data available, skip
      if (!global.lastTokenData || !Array.isArray(global.lastTokenData) || global.lastTokenData.length === 0) {
        return;
      }
      
      // Find all token data clients
      const tokenDataClients = Array.from(this.clients)
        .filter(client => {
          const clientInfo = this.clientInfoMap.get(client);
          if (!clientInfo) return false;
          
          // Only send token updates to token-data or v69 clients
          return clientInfo.clientType === 'token-data' || clientInfo.clientType === 'v69';
        });
      
      // If no token data clients, skip broadcast
      if (tokenDataClients.length === 0) return;
      
      // Create token update message
      const tokenUpdate = {
        type: MESSAGE_TYPES.TOKEN_UPDATE,
        timestamp: new Date().toISOString(),
        data: global.lastTokenData
      };
      
      // Broadcast to all token data clients
      for (const client of tokenDataClients) {
        if (client.readyState === client.OPEN) {
          this.sendToClient(client, tokenUpdate);
        }
      }
      
      // Update message counter
      this.messageCounter.broadcast++;
      
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.RED}Error broadcasting token updates:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle client disconnection
   */
  async onClose(ws) {
    try {
      const clientInfo = this.clientInfoMap.get(ws);
      if (!clientInfo) return;
      
      // Clear client subscriptions
      const clientId = clientInfo.connectionId;
      const subscriptions = this.symbolSubscriptions.get(clientId);
      
      if (subscriptions) {
        // For each symbol, check if it still has any subscribers
        for (const symbol of subscriptions) {
          let hasSubscribers = false;
          
          for (const [otherId, otherSubs] of this.symbolSubscriptions) {
            if (otherId !== clientId && otherSubs.has(symbol)) {
              hasSubscribers = true;
              break;
            }
          }
          
          // If no more subscribers, unregister symbol as active
          if (!hasSubscribers) {
            this.marketDataManager.unregisterActiveSymbol(symbol);
          }
        }
        
        // Remove client subscriptions
        this.symbolSubscriptions.delete(clientId);
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.RED}Error in onClose:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Get server metrics
   * @returns {Object} Server metrics
   */
  getMetrics() {
    // Count active subscriptions
    let activeSubscriptions = 0;
    for (const subs of this.symbolSubscriptions.values()) {
      activeSubscriptions += subs.size;
    }
    
    // Get base metrics
    const baseMetrics = super.getMetrics();
    
    // Add market data specific metrics
    return {
      ...baseMetrics,
      metrics: {
        ...baseMetrics.metrics,
        activeSubscriptions,
        uniqueSymbols: this.marketDataManager.activeSymbols.size,
        tokenCacheSize: this.marketDataManager.tokenCache.size,
        priceCacheSize: this.marketDataManager.priceCache.size,
        volumeCacheSize: this.marketDataManager.volumeCache.size,
        sentimentCacheSize: this.marketDataManager.sentimentCache.size,
        broadcastCount: this.messageCounter.broadcast,
        messageCount: this.messageCounter.received,
        errorCount: this.messageCounter.errors
      }
    };
  }

  /**
   * Clean up resources
   */
  async onCleanup() {
    try {
      // Stop broadcast intervals
      if (this._tokenDataBroadcastInterval) {
        clearInterval(this._tokenDataBroadcastInterval);
      }
      
      if (this._marketDataBroadcastInterval) {
        clearInterval(this._marketDataBroadcastInterval);
      }
      
      // Clean up data manager
      this.marketDataManager.cleanup();
      
      // Clear subscriptions
      this.symbolSubscriptions.clear();
      
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.RED}Market Data WebSocket cleaned up${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 ${fancyColors.RESET} ${fancyColors.RED}Error during cleanup:${fancyColors.RESET}`, error);
    }
  }
}

// Factory function to create the WebSocket server
export function createMarketDataWebSocket(server) {
  return new MarketDataWebSocketServer(server);
}

// Default export
export default createMarketDataWebSocket;