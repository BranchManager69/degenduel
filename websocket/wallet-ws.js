// websocket/wallet-ws.js

/*
 * This is the WebSocket server for the wallet service.
 * It handles real-time wallet updates, transaction monitoring, and balance tracking.
 * 
 * Features:
 * - Wallet state subscription/unsubscription
 * - Real-time balance updates
 * - Transaction monitoring
 * - Performance metrics streaming
 * - Service state monitoring
 * - Solana account tracking
 * 
 * Message Types:
 * - SUBSCRIBE_WALLET: Subscribe to wallet updates
 * - UNSUBSCRIBE_WALLET: Unsubscribe from wallet
 * - REQUEST_BALANCE: Request current balance
 * - REQUEST_TRANSACTIONS: Request transaction history
 * - WALLET_UPDATE: Wallet state update
 * - WALLET_STATE: Complete wallet state
 * - TRANSACTIONS_UPDATE: Transaction history update
 * - SERVICE_METRICS: Service performance metrics
 * - ERROR: Error messages
 */

//import { WebSocketServer } from 'ws';
import { logApi } from '../utils/logger-suite/logger.js';
import { BaseWebSocketServer } from './base-websocket.js';
import prisma from '../config/prisma.js';
import SolanaServiceManager from '../utils/solana-suite/solana-service-manager.js';

// Message type constants
const MESSAGE_TYPES = {
    // Client -> Server
    SUBSCRIBE_WALLET: 'SUBSCRIBE_WALLET',
    UNSUBSCRIBE_WALLET: 'UNSUBSCRIBE_WALLET',
    REQUEST_BALANCE: 'REQUEST_BALANCE',
    REQUEST_TRANSACTIONS: 'REQUEST_TRANSACTIONS',
    
    // Server -> Client
    WALLET_UPDATE: 'WALLET_UPDATE',
    WALLET_STATE: 'WALLET_STATE',
    TRANSACTIONS_UPDATE: 'TRANSACTIONS_UPDATE',
    SERVICE_METRICS: 'SERVICE_METRICS',
    ERROR: 'ERROR'
};

// Error codes
const ERROR_CODES = {
    UNAUTHORIZED: 4003,
    INVALID_MESSAGE: 4004,
    NOT_SUBSCRIBED: 4005,
    SUBSCRIPTION_FAILED: 5002,
    SERVER_ERROR: 5001,
    SOLANA_ERROR: 5003
};

/**
 * Wallet Cache Service
 * Handles caching and updates for wallet data
 */
class WalletCacheService {
    constructor() {
        this.balanceCache = new Map();
        this.transactionCache = new Map();
        this.updateInterval = 5000; // 5 seconds
        this.cacheTimeout = 30000; // 30 seconds
        
        this.startPeriodicUpdates();
    }

    /**
     * Get cached balance or fetch from Solana
     * @param {string} walletAddress - Wallet address
     * @returns {Promise<Object>} Balance data
     */
    async getBalance(walletAddress) {
        try {
            const cached = this.balanceCache.get(walletAddress);
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }

            const connection = SolanaServiceManager.getConnection();
            const balance = await connection.getBalance(new PublicKey(walletAddress));
            this.balanceCache.set(walletAddress, {
                data: balance,
                timestamp: Date.now()
            });

            return balance;
        } catch (error) {
            logApi.error('Error fetching wallet balance:', error);
            return null;
        }
    }

    /**
     * Get cached transactions or fetch from Solana
     * @param {string} walletAddress - Wallet address
     * @param {number} limit - Number of transactions
     * @param {string} before - Transaction signature to fetch before
     * @returns {Promise<Array>} Transaction list
     */
    async getTransactions(walletAddress, limit = 10, before = null) {
        try {
            const cacheKey = `${walletAddress}:${before || 'latest'}`;
            const cached = this.transactionCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }

            const connection = SolanaServiceManager.getConnection();
            const signatures = await connection.getSignaturesForAddress(
                new PublicKey(walletAddress),
                { limit, before }
            );
            
            const transactions = await Promise.all(
                signatures.map(async (sig) => {
                    const tx = await connection.getTransaction(sig.signature);
                    return {
                        signature: sig.signature,
                        timestamp: sig.blockTime,
                        ...tx
                    };
                })
            );
            
            this.transactionCache.set(cacheKey, {
                data: transactions,
                timestamp: Date.now()
            });

            return transactions;
        } catch (error) {
            logApi.error('Error fetching wallet transactions:', error);
            return [];
        }
    }

    /**
     * Start periodic cache updates
     */
    startPeriodicUpdates() {
        setInterval(() => {
            const now = Date.now();
            
            // Clear old balance cache entries
            for (const [key, value] of this.balanceCache.entries()) {
                if (now - value.timestamp > this.cacheTimeout) {
                    this.balanceCache.delete(key);
                }
            }
            
            // Clear old transaction cache entries
            for (const [key, value] of this.transactionCache.entries()) {
                if (now - value.timestamp > this.cacheTimeout) {
                    this.transactionCache.delete(key);
                }
            }
        }, this.updateInterval);
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.balanceCache.clear();
        this.transactionCache.clear();
    }
}

/**
 * Wallet WebSocket Server
 * Handles real-time wallet updates and monitoring
 */
class WalletWebSocketServer extends BaseWebSocketServer {
    constructor(httpServer) {
        super(httpServer, {
            path: '/ws/wallet',
            maxPayload: 1024 * 32, // 32KB max payload
            requireAuth: true,
            rateLimit: 120 // 2 updates/second
        });

        this.walletSubscriptions = new Map(); // userId -> subscription
        this.walletCache = new WalletCacheService();
        this.solanaManager = SolanaServiceManager;  // Use the class directly for static methods

        // Monitoring metrics
        this.metrics = {
            totalConnections: 0,
            activeSubscriptions: 0,
            messageCount: 0,
            errorCount: 0,
            lastUpdate: new Date(),
            cacheHitRate: 0,
            averageLatency: 0,
            solanaRequests: 0,
            solanaErrors: 0
        };

        this.startMetricsCollection();
        
        logApi.info('Wallet WebSocket server initialized');
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
            const { type, data } = message;

            switch (type) {
                case MESSAGE_TYPES.SUBSCRIBE_WALLET:
                    await this.handleWalletSubscription(ws, clientInfo, data);
                    break;
                    
                case MESSAGE_TYPES.UNSUBSCRIBE_WALLET:
                    await this.handleWalletUnsubscription(ws, clientInfo);
                    break;
                    
                case MESSAGE_TYPES.REQUEST_BALANCE:
                    await this.handleBalanceRequest(ws, clientInfo);
                    break;
                    
                case MESSAGE_TYPES.REQUEST_TRANSACTIONS:
                    await this.handleTransactionsRequest(ws, clientInfo, data);
                    break;
                    
                default:
                    this.sendError(ws, 'Unknown message type', ERROR_CODES.INVALID_MESSAGE);
                    logApi.warn('Unknown wallet message type received', {
                        type,
                        clientId: clientInfo.userId
                    });
            }

            // Update metrics
            this.metrics.messageCount++;
            this.metrics.averageLatency = 
                (this.metrics.averageLatency * (this.metrics.messageCount - 1) + (Date.now() - startTime)) 
                / this.metrics.messageCount;

        } catch (error) {
            this.metrics.errorCount++;
            logApi.error('Error handling wallet message:', error);
            this.sendError(ws, 'Failed to process wallet request', ERROR_CODES.SERVER_ERROR);
        }
    }

    /**
     * Handle wallet subscription request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     * @param {Object} data - Subscription data
     */
    async handleWalletSubscription(ws, clientInfo, { walletAddress }) {
        try {
            // Validate wallet ownership
            const user = await prisma.users.findUnique({
                where: { id: clientInfo.userId },
                select: { wallet_address: true }
            });

            if (!user || user.wallet_address !== walletAddress) {
                this.sendError(ws, 'Not authorized to subscribe to this wallet', ERROR_CODES.UNAUTHORIZED);
                return;
            }

            // Create subscription
            const connection = SolanaServiceManager.getConnection();
            const subscription = connection.onAccountChange(
                new PublicKey(walletAddress),
                async (accountInfo, context) => {
                    await this.handleWalletUpdate(ws, {
                        walletAddress,
                        balance: accountInfo.lamports,
                        slot: context.slot,
                        timestamp: new Date().toISOString()
                    });
                }
            );

            // Store subscription
            this.walletSubscriptions.set(clientInfo.userId, {
                walletAddress,
                subscription
            });

            // Send initial state
            await this.sendWalletState(ws, walletAddress);
            
            logApi.info('Client subscribed to wallet', {
                userId: clientInfo.userId,
                wallet: walletAddress
            });

        } catch (error) {
            logApi.error('Error in wallet subscription:', error);
            this.sendError(ws, 'Failed to subscribe to wallet updates', ERROR_CODES.SUBSCRIPTION_FAILED);
        }
    }

    /**
     * Handle wallet unsubscription request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     */
    async handleWalletUnsubscription(ws, clientInfo) {
        const subscription = this.walletSubscriptions.get(clientInfo.userId);
        if (subscription) {
            const connection = SolanaServiceManager.getConnection();
            connection.removeAccountChangeListener(subscription.subscription);
            this.walletSubscriptions.delete(clientInfo.userId);
            
            logApi.info('Client unsubscribed from wallet', {
                userId: clientInfo.userId,
                wallet: subscription.walletAddress
            });
        }
    }

    /**
     * Handle balance request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     */
    async handleBalanceRequest(ws, clientInfo) {
        const subscription = this.walletSubscriptions.get(clientInfo.userId);
        if (!subscription) {
            this.sendError(ws, 'Must subscribe to wallet first', ERROR_CODES.NOT_SUBSCRIBED);
            return;
        }

        await this.sendWalletState(ws, subscription.walletAddress);
    }

    /**
     * Handle transactions request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     * @param {Object} data - Request data
     */
    async handleTransactionsRequest(ws, clientInfo, { limit = 10, before = null }) {
        const subscription = this.walletSubscriptions.get(clientInfo.userId);
        if (!subscription) {
            this.sendError(ws, 'Must subscribe to wallet first', ERROR_CODES.NOT_SUBSCRIBED);
            return;
        }

        try {
            const transactions = await this.walletCache.getTransactions(
                subscription.walletAddress,
                limit,
                before
            );

            this.sendToClient(ws, {
                type: MESSAGE_TYPES.TRANSACTIONS_UPDATE,
                data: {
                    transactions,
                    hasMore: transactions.length === limit
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error('Error fetching transactions:', error);
            this.sendError(ws, 'Failed to fetch transactions', ERROR_CODES.SOLANA_ERROR);
        }
    }

    /**
     * Handle wallet update
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} update - Wallet update data
     */
    async handleWalletUpdate(ws, update) {
        this.sendToClient(ws, {
            type: MESSAGE_TYPES.WALLET_UPDATE,
            data: update,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Send wallet state to client
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} walletAddress - Wallet address
     */
    async sendWalletState(ws, walletAddress) {
        try {
            const [balance, recentTransactions] = await Promise.all([
                this.walletCache.getBalance(walletAddress),
                this.walletCache.getTransactions(walletAddress, 5)
            ]);

            this.sendToClient(ws, {
                type: MESSAGE_TYPES.WALLET_STATE,
                data: {
                    balance,
                    recentTransactions
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error('Error fetching wallet state:', error);
            this.sendError(ws, 'Failed to fetch wallet state', ERROR_CODES.SOLANA_ERROR);
        }
    }

    /**
     * Start metrics collection
     */
    startMetricsCollection() {
        setInterval(() => {
            const connectedClients = this._getConnectedClients();
            this.metrics.totalConnections = connectedClients.length;
            this.metrics.activeSubscriptions = this.walletSubscriptions.size;
            this.metrics.lastUpdate = new Date();
            
            // Calculate cache hit rates
            const cacheStats = {
                hits: this.walletCache.balanceCache.size + this.walletCache.transactionCache.size,
                total: this.metrics.messageCount
            };
            this.metrics.cacheHitRate = cacheStats.total > 0 
                ? (cacheStats.hits / cacheStats.total) * 100 
                : 0;

            // Broadcast metrics to admin clients
            this.broadcast(
                {
                    type: MESSAGE_TYPES.SERVICE_METRICS,
                    data: {
                        ...this.metrics,
                        timestamp: new Date().toISOString()
                    }
                },
                (client) => client.role === 'admin' || client.role === 'superadmin'
            );
        }, 5000);
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
        // Cleanup all subscriptions
        const connection = SolanaServiceManager.getConnection();
        for (const [userId, subscription] of this.walletSubscriptions) {
            try {
                connection.removeAccountChangeListener(subscription.subscription);
            } catch (error) {
                logApi.error('Error cleaning up wallet subscription:', error);
            }
        }
        
        this.walletSubscriptions.clear();
        this.walletCache.cleanup();
        super.cleanup();
        
        logApi.info('Wallet WebSocket server cleaned up');
    }
}

// Singleton instance
let instance = null;

/**
 * Create or return existing WalletWebSocketServer instance
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {WalletWebSocketServer} WebSocket server instance
 */
export function createWalletWebSocket(httpServer) {
    if (!instance) {
        instance = new WalletWebSocketServer(httpServer);
    }
    return instance;
}

export default WalletWebSocketServer; 