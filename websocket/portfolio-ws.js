// websocket/portfolio-ws.js

/*
 * This is the WebSocket server for the portfolio service.
 * It handles real-time portfolio updates, trade notifications, and performance tracking.
 * 
 * Features:
 * - Portfolio state subscription/unsubscription
 * - Real-time portfolio value updates
 * - Trade execution notifications
 * - Performance metrics streaming
 * - Service state broadcasting
 * - Periodic portfolio updates
 * 
 * Message Types:
 * - PORTFOLIO_UPDATE_REQUEST: Request latest portfolio state
 * - PORTFOLIO_UPDATED: Portfolio state update
 * - TRADE_EXECUTED: Trade execution notification
 * - PRICE_UPDATED: Token price updates
 * - SERVICE_STATE: Service state updates
 * - SERVICE_METRICS: Service performance metrics
 * - SERVICE_ALERT: Service alerts and notifications
 * - ERROR: Error messages
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
//import jwt from 'jsonwebtoken';
//import { config } from '../config/config.js';
//import ReferralService from '../services/referralService.js';

const VERBOSE_PORTFOLIO_WS_INIT = false;

// Message type constants
const MESSAGE_TYPES = {
    // Client -> Server
    PORTFOLIO_UPDATE_REQUEST: 'PORTFOLIO_UPDATE_REQUEST',
    
    // Server -> Client
    PORTFOLIO_UPDATED: 'PORTFOLIO_UPDATED',
    TRADE_EXECUTED: 'TRADE_EXECUTED',
    PRICE_UPDATED: 'PRICE_UPDATED',
    SERVICE_STATE: 'service:state',
    SERVICE_METRICS: 'service:metrics',
    SERVICE_ALERT: 'service:alert',
    ERROR: 'ERROR'
};

// Error codes
const ERROR_CODES = {
    PORTFOLIO_NOT_FOUND: 4044,
    INVALID_MESSAGE: 4004,
    UPDATE_FAILED: 5001,
    SERVER_ERROR: 5000,
    UNAUTHORIZED: 4003
};

/**
 * Portfolio Cache Service
 * Handles caching and batch updates for portfolio data
 */
class PortfolioCacheService {
    constructor() {
        this.portfolioCache = new Map();
        this.updateInterval = 15000; // 15 seconds
        this.startPeriodicUpdates();
    }

    /**
     * Get portfolio data from cache or database
     * @param {string} wallet - Wallet address
     * @returns {Promise<Object>} Portfolio data
     */
    async getPortfolioData(wallet) {
        try {
            if (this.portfolioCache.has(wallet)) {
                return this.portfolioCache.get(wallet);
            }

            const portfolios = await prisma.contest_portfolios.findMany({
                where: { wallet_address: wallet },
                include: {
                    tokens: {
                        select: {
                            symbol: true,
                            name: true,
                            decimals: true,
                            market_cap: true,
                            change_24h: true,
                            volume_24h: true
                        }
                    }
                }
            });

            if (portfolios.length > 0) {
                this.portfolioCache.set(wallet, portfolios);
            }

            return portfolios;
        } catch (error) {
            logApi.error('Error fetching portfolio data:', error);
            return null;
        }
    }

    /**
     * Start periodic cache updates
     */
    startPeriodicUpdates() {
        setInterval(async () => {
            try {
                const wallets = Array.from(this.portfolioCache.keys());
                
                for (const wallet of wallets) {
                    const portfolios = await prisma.contest_portfolios.findMany({
                        where: { wallet_address: wallet },
                        include: {
                            tokens: {
                                select: {
                                    symbol: true,
                                    name: true,
                                    decimals: true,
                                    market_cap: true,
                                    change_24h: true,
                                    volume_24h: true
                                }
                            }
                        }
                    });

                    if (portfolios.length > 0) {
                        this.portfolioCache.set(wallet, portfolios);
                    } else {
                        this.portfolioCache.delete(wallet);
                    }
                }
            } catch (error) {
                logApi.error('Error in portfolio cache update:', error);
            }
        }, this.updateInterval);
    }

    /**
     * Update cache for a specific wallet
     * @param {string} wallet - Wallet address
     */
    async updateWalletCache(wallet) {
        try {
            const portfolios = await prisma.contest_portfolios.findMany({
                where: { wallet_address: wallet },
                include: {
                    tokens: {
                        select: {
                            symbol: true,
                            name: true,
                            decimals: true,
                            market_cap: true,
                            change_24h: true,
                            volume_24h: true
                        }
                    }
                }
            });

            if (portfolios.length > 0) {
                this.portfolioCache.set(wallet, portfolios);
            } else {
                this.portfolioCache.delete(wallet);
            }
        } catch (error) {
            logApi.error('Error updating wallet cache:', error);
        }
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.portfolioCache.clear();
    }
}

/**
 * Portfolio WebSocket Server
 * Handles real-time portfolio updates and notifications
 */
class PortfolioWebSocketServer extends BaseWebSocketServer {
    constructor(server) {
        super(server, {
            path: '/api/v2/ws/portfolio',
            maxMessageSize: 100 * 1024, // 100KB
            rateLimit: 100, // 100 messages per minute
            requireAuth: true
        });

        this.portfolioCache = new PortfolioCacheService();
        
        // Monitoring metrics
        this.metrics = {
            totalConnections: 0,
            activeSubscriptions: 0,
            messageCount: 0,
            errorCount: 0,
            lastUpdate: new Date(),
            cacheHitRate: 0,
            averageLatency: 0
        };

        this.startPeriodicUpdates();
        this.startMetricsCollection();
        
        if (VERBOSE_PORTFOLIO_WS_INIT) {
            logApi.info('Portfolio WebSocket server initialized');
        }
    }

    /**
     * Handle client messages
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} message - Message object
     * @param {Object} clientInfo - Client information
     */
    async handleClientMessage(ws, message, clientInfo) {
        const startTime = Date.now();
        
        try {
            switch (message.type) {
                case MESSAGE_TYPES.PORTFOLIO_UPDATE_REQUEST:
                    await this.handlePortfolioUpdateRequest(ws, clientInfo);
                    break;
                default:
                    this.sendError(ws, 'Unknown message type', ERROR_CODES.INVALID_MESSAGE);
            }

            // Update metrics
            this.metrics.messageCount++;
            this.metrics.averageLatency = 
                (this.metrics.averageLatency * (this.metrics.messageCount - 1) + (Date.now() - startTime)) 
                / this.metrics.messageCount;

        } catch (error) {
            this.metrics.errorCount++;
            logApi.error('Error handling portfolio message:', error);
            this.sendError(ws, 'Failed to fetch portfolio data', ERROR_CODES.UPDATE_FAILED);
        }
    }

    /**
     * Handle portfolio update request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     */
    async handlePortfolioUpdateRequest(ws, clientInfo) {
        try {
            const portfolioData = await this.portfolioCache.getPortfolioData(clientInfo.wallet);
            if (portfolioData) {
                this.sendToClient(ws, {
                    type: MESSAGE_TYPES.PORTFOLIO_UPDATED,
                    data: portfolioData,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            logApi.error('Error handling portfolio update request:', error);
            this.sendError(ws, 'Failed to fetch portfolio data', ERROR_CODES.UPDATE_FAILED);
        }
    }

    /**
     * Start periodic updates
     */
    startPeriodicUpdates() {
        // Update portfolio values every 15 seconds
        setInterval(async () => {
            try {
                const portfolios = await prisma.contest_portfolios.findMany({
                    include: {
                        tokens: {
                            select: {
                                symbol: true,
                                name: true,
                                decimals: true,
                                market_cap: true,
                                change_24h: true,
                                volume_24h: true
                            }
                        }
                    }
                });

                // Group portfolios by wallet
                const portfoliosByWallet = portfolios.reduce((acc, portfolio) => {
                    if (!acc[portfolio.wallet_address]) {
                        acc[portfolio.wallet_address] = [];
                    }
                    acc[portfolio.wallet_address].push(portfolio);
                    return acc;
                }, {});

                // Broadcast updates to respective clients
                for (const [wallet, data] of Object.entries(portfoliosByWallet)) {
                    this.broadcast(
                        {
                            type: MESSAGE_TYPES.PORTFOLIO_UPDATED,
                            data,
                            timestamp: new Date().toISOString(),
                            store: true // Queue if client is offline
                        },
                        (client) => client.wallet === wallet
                    );
                }
            } catch (error) {
                logApi.error('Error in periodic portfolio update:', error);
            }
        }, 15000);

        // Cleanup old messages every 2 days
        setInterval(async () => {
            try {
                await prisma.websocket_messages.deleteMany({
                    where: {
                        timestamp: {
                            lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days old
                        }
                    }
                });
            } catch (error) {
                logApi.error('Failed to cleanup old messages:', error);
            }
        }, 2 * 24 * 60 * 60 * 1000);
    }

    /**
     * Start metrics collection
     */
    startMetricsCollection() {
        setInterval(() => {
            const connectedClients = this._getConnectedClients();
            this.metrics.totalConnections = connectedClients.length;
            this.metrics.activeSubscriptions = this._getClients().size;
            this.metrics.lastUpdate = new Date();

            // Broadcast metrics to admin clients
            this.broadcast(
                {
                    type: MESSAGE_TYPES.SERVICE_METRICS,
                    data: this.metrics,
                    timestamp: new Date().toISOString()
                },
                (client) => client.role === 'admin' || client.role === 'superadmin'
            );
        }, 5000);
    }

    /**
     * Broadcast trade execution
     * @param {Object} tradeData - Trade execution data
     */
    broadcastTradeExecution(tradeData) {
        this.broadcast(
            {
                type: MESSAGE_TYPES.TRADE_EXECUTED,
                data: tradeData,
                timestamp: new Date().toISOString(),
                store: true
            },
            (client) => 
                client.wallet === tradeData.wallet_address || 
                client.role === 'superadmin'
        );
    }

    /**
     * Broadcast price update
     * @param {Object} priceData - Price update data
     */
    broadcastPriceUpdate(priceData) {
        this.broadcast({
            type: MESSAGE_TYPES.PRICE_UPDATED,
            data: priceData,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Broadcast service state
     * @param {string} service - Service name
     * @param {Object} state - Service state
     */
    async broadcastServiceState(service, state) {
        try {
            const message = {
                type: MESSAGE_TYPES.SERVICE_STATE,
                service,
                data: state,
                timestamp: new Date().toISOString()
            };

            this.broadcast(message);
            
            // Store message for offline clients
            await prisma.websocket_messages.create({
                data: {
                    type: MESSAGE_TYPES.SERVICE_STATE,
                    data: message,
                    delivered: false,
                    wallet_address: 'SYSTEM',
                    timestamp: new Date()
                }
            });

            logApi.info(`Service state broadcast successful`, {
                service,
                state: state.status,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error(`Failed to broadcast service state`, {
                service,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Broadcast service metrics
     * @param {string} service - Service name
     * @param {Object} metrics - Service metrics
     */
    async broadcastServiceMetrics(service, metrics) {
        try {
            const message = {
                type: MESSAGE_TYPES.SERVICE_METRICS,
                service,
                data: {
                    status: metrics.status || 'unknown',
                    uptime: metrics.uptime || 0,
                    latency: metrics.performance?.averageOperationTimeMs || 0,
                    activeUsers: metrics.operations?.total || 0,
                    ...this.metrics // Include WebSocket server metrics
                },
                timestamp: new Date().toISOString()
            };

            this.broadcast(message);
            logApi.info(`Service metrics broadcast`, { service, metrics: message.data });
        } catch (error) {
            logApi.error(`Failed to broadcast service metrics`, {
                service,
                error: error.message
            });
        }
    }

    /**
     * Broadcast service alert
     * @param {string} service - Service name
     * @param {Object} alert - Alert data
     */
    async broadcastServiceAlert(service, alert) {
        try {
            const message = {
                type: MESSAGE_TYPES.SERVICE_ALERT,
                service,
                data: {
                    severity: alert.severity || 'info',
                    message: alert.message,
                    timestamp: new Date().toISOString()
                }
            };

            this.broadcast(message);
            
            // Store critical alerts
            if (alert.severity === 'critical') {
                await prisma.websocket_messages.create({
                    data: {
                        type: MESSAGE_TYPES.SERVICE_ALERT,
                        data: message,
                        delivered: false,
                        wallet_address: 'SYSTEM',
                        timestamp: new Date()
                    }
                });
            }

            logApi.info(`Service alert broadcast`, {
                service,
                severity: alert.severity,
                message: alert.message
            });
        } catch (error) {
            logApi.error(`Failed to broadcast service alert`, {
                service,
                error: error.message
            });
        }
    }

    /**
     * Get server metrics
     * @returns {Object} Server metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.portfolioCache.cleanup();
        super.cleanup();
        logApi.info('Portfolio WebSocket server cleaned up');
    }
}

// Singleton instance
let instance = null;

/**
 * Create or return existing PortfolioWebSocketServer instance
 * @param {http.Server} server - HTTP server instance
 * @returns {PortfolioWebSocketServer} WebSocket server instance
 */
export function createPortfolioWebSocket(server) {
    if (!instance) {
        instance = new PortfolioWebSocketServer(server);
    }
    return instance;
}

/**
 * Broadcast a trade execution to relevant clients
 * @param {Object} tradeData - Trade execution data
 */
export function broadcastTradeExecution(tradeData) {
    if (!instance) {
        logApi.warn('Attempted to broadcast trade before WebSocket server initialization');
        return;
    }
    instance.broadcastTradeExecution(tradeData);
}

// Export both the class and the singleton instance
export { PortfolioWebSocketServer };
export default instance; 