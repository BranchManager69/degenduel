// websocket/market-ws.js

/*
 * This is the WebSocket server for the market data service.
 * It handles real-time market data updates, price feeds, and trading volume information.
 * 
 * Features:
 * - Symbol subscription/unsubscription
 * - Real-time price updates
 * - Volume and trading metrics
 * - Market sentiment data
 * - High-frequency updates (10/second)
 * 
 * Message Types:
 * - SUBSCRIBE_SYMBOLS: Subscribe to market data for symbols
 * - UNSUBSCRIBE_SYMBOLS: Unsubscribe from market data
 * - MARKET_PRICE: Real-time price updates
 * - MARKET_VOLUME: Trading volume updates
 * - MARKET_SENTIMENT: Market sentiment indicators
 * - ERROR: Error messages
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';

const VERBOSE_MARKET_WS_INIT = false;

// Message type constants
const MESSAGE_TYPES = {
    // Client -> Server
    SUBSCRIBE_SYMBOLS: 'SUBSCRIBE_SYMBOLS',
    UNSUBSCRIBE_SYMBOLS: 'UNSUBSCRIBE_SYMBOLS',
    
    // Server -> Client
    MARKET_PRICE: 'MARKET_PRICE',
    MARKET_VOLUME: 'MARKET_VOLUME',
    MARKET_SENTIMENT: 'MARKET_SENTIMENT',
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
 * Market Data Service class
 * Handles market data operations and caching
 */
class MarketDataService {
    constructor() {
        this.priceCache = new Map();
        this.volumeCache = new Map();
        this.sentimentCache = new Map();
        this.updateInterval = 2000; // Reduced from 100ms to 2s to avoid hammering DD-serve
        this.lastDDServError = null;
        this.ddServFailedAttempts = 0;
        
        this.startDataUpdates();
    }

    /**
     * Get latest price data for a symbol
     * @param {string} symbol - Token symbol
     * @returns {Promise<Object>} Price data
     */
    async getPrice(symbol) {
        try {
            // Always return cached data if available and DD-serve is having issues
            if (this.lastDDServError && this.priceCache.has(symbol)) {
                return this.priceCache.get(symbol);
            }

            // Check if we should attempt DD-serve request
            if (this.lastDDServError) {
                const timeSinceError = Date.now() - this.lastDDServError;
                if (timeSinceError < Math.min(30000, Math.pow(2, this.ddServFailedAttempts) * 1000)) {
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
                // Reset DD-serve error state on success
                this.lastDDServError = null;
                this.ddServFailedAttempts = 0;
            }

            return this.priceCache.get(symbol);
        } catch (error) {
            // Track DD-serve failures for backoff
            this.lastDDServError = Date.now();
            this.ddServFailedAttempts++;
            logApi.error('Error fetching price data:', {
                error: error.message,
                failedAttempts: this.ddServFailedAttempts,
                nextRetryIn: Math.pow(2, this.ddServFailedAttempts)
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
            logApi.error('Error fetching volume data:', error);
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
            logApi.error('Error fetching sentiment data:', error);
            return null;
        }
    }

    /**
     * Start periodic data updates
     */
    startDataUpdates() {
        setInterval(async () => {
            try {
                const activeSymbols = Array.from(this.priceCache.keys());
                
                for (const symbol of activeSymbols) {
                    await Promise.all([
                        this.updatePrice(symbol),
                        this.updateVolume(symbol),
                        this.updateSentiment(symbol)
                    ]);
                }
            } catch (error) {
                logApi.error('Error updating market data:', error);
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
            logApi.error('Error updating price:', error);
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
            logApi.error('Error updating volume:', error);
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
            logApi.error('Error updating sentiment:', error);
        }
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.priceCache.clear();
        this.volumeCache.clear();
        this.sentimentCache.clear();
    }
}

/**
 * MarketDataWebSocketServer class
 * Handles real-time market data distribution
 */
class MarketDataWebSocketServer extends BaseWebSocketServer {
    constructor(httpServer) {
        super(httpServer, {
            path: '/api/v2/ws/market',
            maxPayload: 1024 * 16, // 16KB max payload
            requireAuth: true,
            rateLimit: 600 // 10 updates/second as per requirements
        });

        /** @type {Map<string, Set<string>>} userId -> Set<symbol> */
        this.symbolSubscriptions = new Map();
        
        this.marketDataService = new MarketDataService();
        this.startMarketDataStreams();
        
        if (VERBOSE_MARKET_WS_INIT) {
            logApi.info('Market Data WebSocket server initialized');
        }
    }

    /**
     * Handle incoming client messages
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} message - Parsed message object
     * @param {Object} clientInfo - Client information
     */
    async handleClientMessage(ws, message, clientInfo) {
        try {
            const { type, symbols } = message;

            switch (type) {
                case MESSAGE_TYPES.SUBSCRIBE_SYMBOLS:
                    await this.handleSymbolSubscription(ws, clientInfo, symbols);
                    break;
                    
                case MESSAGE_TYPES.UNSUBSCRIBE_SYMBOLS:
                    await this.handleSymbolUnsubscription(ws, clientInfo, symbols);
                    break;
                    
                default:
                    this.sendError(ws, 'Unknown message type', ERROR_CODES.INVALID_MESSAGE);
                    logApi.warn('Unknown market data message type received', {
                        type,
                        clientId: clientInfo.userId
                    });
            }
        } catch (error) {
            logApi.error('Error handling market data message:', error);
            this.sendError(ws, 'Failed to process market data request', ERROR_CODES.SERVER_ERROR);
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
                this.sendError(ws, 'Invalid symbols format', ERROR_CODES.INVALID_MESSAGE);
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
                this.sendError(ws, 'No valid symbols provided', ERROR_CODES.INVALID_SYMBOLS);
                return;
            }

            // Add to subscriptions
            if (!this.symbolSubscriptions.has(clientInfo.userId)) {
                this.symbolSubscriptions.set(clientInfo.userId, new Set());
            }
            const userSubs = this.symbolSubscriptions.get(clientInfo.userId);
            validSymbols.forEach(({ symbol }) => userSubs.add(symbol));

            // Send initial state for each symbol
            await Promise.all(
                validSymbols.map(({ symbol }) => this.sendMarketData(ws, symbol))
            );

            logApi.info('Client subscribed to symbols', {
                userId: clientInfo.userId,
                symbols: validSymbols.map(s => s.symbol)
            });

        } catch (error) {
            logApi.error('Error in symbol subscription:', error);
            this.sendError(ws, 'Failed to subscribe to market data', ERROR_CODES.SUBSCRIPTION_FAILED);
        }
    }

    /**
     * Handle symbol unsubscription request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     * @param {string[]} symbols - Array of token symbols
     */
    async handleSymbolUnsubscription(ws, clientInfo, symbols) {
        const userSubs = this.symbolSubscriptions.get(clientInfo.userId);
        if (userSubs) {
            symbols.forEach(symbol => userSubs.delete(symbol));
            logApi.info('Client unsubscribed from symbols', {
                userId: clientInfo.userId,
                symbols
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
                this.marketDataService.getPrice(symbol),
                this.marketDataService.getVolume(symbol),
                this.marketDataService.getSentiment(symbol)
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
            logApi.error('Error sending market data:', error);
        }
    }

    /**
     * Start market data streams
     */
    startMarketDataStreams() {
        // Update market data every 100ms (10 updates/second)
        setInterval(async () => {
            try {
                const allSymbols = new Set();
                this.symbolSubscriptions.forEach(symbols => {
                    symbols.forEach(symbol => allSymbols.add(symbol));
                });

                for (const symbol of allSymbols) {
                    const clients = this._getConnectedClients()
                        .filter(client => {
                            const clientInfo = this._getClientInfo(client);
                            return clientInfo && this.symbolSubscriptions.get(clientInfo.userId)?.has(symbol);
                        });

                    await Promise.all(
                        clients.map(client => this.sendMarketData(client, symbol))
                    );
                }
            } catch (error) {
                logApi.error('Error in market data stream:', error);
            }
        }, 100);
    }

    /**
     * Get server metrics
     * @returns {Object} Server metrics
     */
    getMetrics() {
        return {
            metrics: {
                totalConnections: this._getConnectedClients().length,
                activeSubscriptions: Array.from(this.symbolSubscriptions.values()).reduce((total, symbols) => total + symbols.size, 0),
                messageCount: 0,
                errorCount: 0,
                lastUpdate: new Date().toISOString(),
                cacheHitRate: 0,
                averageLatency: 0
            },
            performance: {
                messageRate: 0,
                errorRate: 0,
                latencyTrend: []
            },
            status: 'operational'
        };
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.symbolSubscriptions.clear();
        this.marketDataService.cleanup();
        super.cleanup();
        logApi.info('Market Data WebSocket server cleaned up');
    }
}

// Singleton instance
let instance = null;

/**
 * Create or return existing MarketDataWebSocketServer instance
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {MarketDataWebSocketServer} WebSocket server instance
 */
export function createMarketDataWebSocket(httpServer) {
    if (!instance) {
        instance = new MarketDataWebSocketServer(httpServer);
    }
    return instance;
}

// Export both the class and the instance
export { MarketDataWebSocketServer };
export default instance; 