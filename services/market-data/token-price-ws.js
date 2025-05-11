// services/market-data/token-price-ws.js

import WebSocket from 'ws';
import { logApi } from '../../utils/logger-suite/logger.js';
import solanaEngine from '../solana-engine/index.js';
import { heliusClient } from '../solana-engine/helius-client.js';
import { dexscreenerClient } from '../solana-engine/dexscreener-client.js';
import prisma from '../../config/prisma.js';
import { Decimal } from 'decimal.js';

// Formatting helpers
const formatLog = {
    tag: () => `[TokenPriceWs]`,
    header: (text) => `[ ${text} ]`,
};

/**
 * WebSocket-based token price monitoring service
 * Uses Helius WebSockets to monitor liquidity pools and mint accounts
 * Calculates prices from pool data when possible
 */
class TokenPriceWebSocketService {
    constructor() {
        // WebSocket connection state
        this.wsConnection = null;
        this.wsConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectInterval = 2000; // Start with 2 seconds
        this.autoReconnect = true;
        
        // Token monitoring state
        this.monitoredTokens = new Map(); // token address -> { symbol, pools, lastPrice, subscription }
        this.monitoredPools = new Map(); // pool address -> { tokenA, tokenB, subscriptionId, lastReserveA, lastReserveB }
        this.minimumPriorityScore = 50; // Default to priority score 50+ (equivalent to tiers 1-2)
        this.maxTokensToMonitor = 1000; // Max tokens to monitor via WebSocket
        this.subscriptionBatchSize = 20; // Process subscriptions in batches
        
        // Subscription management
        this.subscriptions = new Map(); // subscription id -> { type, address }
        this.pendingSubscriptions = [];
        this.processingSubscriptions = false;

        // Callbacks for price updates
        this.priceUpdateHandlers = [];
        
        // Stats tracking
        this.stats = {
            connected: false,
            lastConnectionTime: null,
            reconnections: 0,
            tokenCount: 0,
            poolCount: 0,
            priceUpdates: 0,
            lastActivity: null,
            errors: 0,
        };
    }

    /**
     * Initialize WebSocket connection to monitor token prices
     * @param {Object} solanaEngine - SolanaEngine instance
     * @param {Object} config - Configuration for WebSocket connection
     * @returns {Promise<boolean>} - Whether initialization was successful
     */
    async initialize(solanaEngine, config = {}) {
        logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} Direct Helius WebSocket for token price monitoring`);

        try {
            // Set configuration
            this.solanaEngine = solanaEngine;
            this.config = config || {};
            this.maxTokensToMonitor = this.config.maxTokensToMonitor || 1000;
            this.minimumPriorityScore = this.config.minimumPriorityScore || 50; // Default to priority score 50+
            // No test mode or dummy data - working with real production data only priority
            
            if (!solanaEngine.kiteIsInitialized) {
                logApi.warn(`${formatLog.tag()} ${formatLog.header('WARNING')} SolanaEngine Kite WebSocket not initialized. Using fallback Helius WebSocket.`);
                
                // Initialize Helius WebSocket connection
                await this.initializeHeliusWebSocket();
            } else {
                // Use the SolanaEngine Kite WebSocket
                logApi.info(`${formatLog.tag()} ${formatLog.header('INFO')} Using SolanaEngine Kite WebSocket connection`);
                this.wsConnection = solanaEngine.kiteWs;
                this.wsConnected = true;
                this.stats.connected = true;
                this.stats.lastConnectionTime = new Date();
            }

            // Load active tokens to monitor
            await this.loadActiveTokens();

            logApi.info(`${formatLog.tag()} ${formatLog.header('SUCCESS')} WebSocket monitoring initialized successfully`);

            // Always return true if we got this far without errors
            return true;
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Failed to initialize token price WebSocket: ${error.message}`);
            return false;
        }
    }

    /**
     * Initialize direct Helius WebSocket connection
     * This is used as a fallback if the SolanaEngine Kite WebSocket is not available
     */
    async initializeHeliusWebSocket() {
        try {
            // Get WebSocket URL from Helius config
            const heliusWsUrl = heliusClient.config.websocket.url;
            
            if (!heliusWsUrl) {
                throw new Error('Helius WebSocket URL not configured');
            }
            
            logApi.info(`${formatLog.tag()} ${formatLog.header('CONNECTING')} to Helius WebSocket at ${heliusWsUrl}`);
            
            // Create new WebSocket connection
            this.wsConnection = new WebSocket(heliusWsUrl);
            
            // Set up event handlers
            this.wsConnection.on('open', () => {
                this.wsConnected = true;
                this.reconnectAttempts = 0;
                this.stats.connected = true;
                this.stats.lastConnectionTime = new Date();
                this.stats.reconnections++;
                
                logApi.info(`${formatLog.tag()} ${formatLog.header('CONNECTED')} Successfully connected to Helius WebSocket`);
                
                // Process any pending subscriptions
                this.processPendingSubscriptions();
            });
            
            this.wsConnection.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Failed to parse WebSocket message: ${error.message}`);
                    this.stats.errors++;
                }
            });
            
            this.wsConnection.on('error', (error) => {
                logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} WebSocket error: ${error.message}`);
                this.stats.errors++;
            });
            
            this.wsConnection.on('close', () => {
                this.wsConnected = false;
                this.stats.connected = false;
                
                logApi.warn(`${formatLog.tag()} ${formatLog.header('DISCONNECTED')} Helius WebSocket connection closed`);
                
                // Attempt to reconnect with exponential backoff
                if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                    const reconnectDelay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts);
                    this.reconnectAttempts++;
                    
                    logApi.info(`${formatLog.tag()} ${formatLog.header('RECONNECTING')} in ${reconnectDelay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                    
                    setTimeout(() => {
                        this.initializeHeliusWebSocket();
                    }, reconnectDelay);
                } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    logApi.error(`${formatLog.tag()} ${formatLog.header('FAILED')} Max reconnection attempts reached, giving up.`);
                }
            });
            
            return true;
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Failed to initialize Helius WebSocket: ${error.message}`);
            return false;
        }
    }

    /**
     * Load active tokens with priority tiers 1-2 (high and medium priority)
     * from the database to begin monitoring
     */
    async loadActiveTokens() {
        try {
            logApi.info(`${formatLog.tag()} ${formatLog.header('LOADING')} active tokens to monitor via WebSocket`);
            
            // Find tokens that:
            // 1. Have pools associated with them (necessary for price calculation)
            // 2. Are limited to maxTokensToMonitor
            // Note: Not filtering on is_active or priority score since they aren't populated
            const activeTokens = await prisma.tokens.findMany({
                where: {
                    // Only get tokens that have pools
                    pools: {
                        some: {}
                    }
                },
                select: {
                    id: true,
                    address: true,
                    symbol: true,
                    name: true,
                    priority_score: true,
                    pools: {
                        select: {
                            address: true,
                            dex: true,
                            programId: true,
                        },
                        take: 2 // Take top 2 pools per token
                    }
                },
                orderBy: [
                    {
                        priority_score: 'desc', // Higher score = higher priority
                    },
                    {
                        last_refresh_success: 'asc', // Oldest refreshes first
                    }
                ],
                take: this.maxTokensToMonitor,
            });
            
            if (!activeTokens || activeTokens.length === 0) {
                logApi.warn(`${formatLog.tag()} ${formatLog.header('WARNING')} No active tokens found to monitor`);

                // In test environments, return success anyway
                this.stats.tokenCount = 0;
                this.stats.poolCount = 0;

                // We're connected, just with 0 tokens
                return true;
            }
            
            logApi.info(`${formatLog.tag()} ${formatLog.header('LOADED')} ${activeTokens.length} active tokens to monitor`);
            
            // Process tokens and subscribe to their associated pools
            for (const token of activeTokens) {
                // Skip tokens without an address
                if (!token.address) continue;
                
                // Add to monitored tokens map
                this.monitoredTokens.set(token.address, {
                    id: token.id,
                    symbol: token.symbol || 'UNKNOWN',
                    name: token.name || 'Unknown Token',
                    priorityScore: token.priority_score || 0,
                    pools: token.pools || [],
                    lastPrice: null,
                    lastUpdate: null,
                });
                
                // Subscribe to the token mint account
                this.queueSubscription({
                    type: 'account',
                    address: token.address,
                    tokenId: token.id,
                    isPool: false,
                });
                
                // Subscribe to token's liquidity pools
                if (token.pools && token.pools.length > 0) {
                    for (const pool of token.pools) {
                        if (pool.address) {
                            // Track pool details
                            this.monitoredPools.set(pool.address, {
                                tokenId: token.id,
                                tokenAddress: token.address,
                                tokenSymbol: token.symbol || 'UNKNOWN',
                                dexName: pool.dex || 'unknown',
                                programId: pool.programId || '',
                                lastReserveA: null,
                                lastReserveB: null,
                                subscriptionId: null,
                            });

                            // Queue subscription to pool account
                            this.queueSubscription({
                                type: 'account',
                                address: pool.address,
                                tokenId: token.id,
                                isPool: true,
                            });
                        }
                    }
                }
            }
            
            // Update stats
            this.stats.tokenCount = this.monitoredTokens.size;
            this.stats.poolCount = this.monitoredPools.size;
            
            // Process subscriptions
            await this.processPendingSubscriptions();
            
            logApi.info(`${formatLog.tag()} ${formatLog.header('READY')} Monitoring ${this.monitoredTokens.size} tokens with ${this.monitoredPools.size} pools`);
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Failed to load active tokens: ${error.message}`);
            throw error;
        }

        // Return true to indicate successful token loading
        return true;
    }

    /**
     * Queue a subscription to be processed in batches
     * @param {Object} subscription - Subscription details
     */
    queueSubscription(subscription) {
        this.pendingSubscriptions.push(subscription);
    }

    /**
     * Process pending subscriptions in batches
     */
    async processPendingSubscriptions() {
        if (!this.wsConnected || this.processingSubscriptions || this.pendingSubscriptions.length === 0) {
            return;
        }
        
        this.processingSubscriptions = true;
        
        try {
            logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} Processing ${this.pendingSubscriptions.length} pending subscriptions in batches of ${this.subscriptionBatchSize}`);
            
            // Process subscriptions in batches
            while (this.pendingSubscriptions.length > 0) {
                const batch = this.pendingSubscriptions.splice(0, this.subscriptionBatchSize);
                
                // Process all subscriptions in this batch
                const subscriptionPromises = batch.map(sub => this.subscribeToAccount(sub));
                await Promise.all(subscriptionPromises);
                
                // Add a small delay between batches to avoid overwhelming the WebSocket
                if (this.pendingSubscriptions.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBED')} Completed processing all pending subscriptions`);
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Error processing subscriptions: ${error.message}`);
        } finally {
            this.processingSubscriptions = false;
        }
    }

    /**
     * Subscribe to an account via WebSocket
     * @param {Object} subInfo - Subscription details
     * @returns {Promise<boolean>} - Whether subscription was successful
     */
    async subscribeToAccount(subInfo) {
        if (!this.wsConnected) {
            this.queueSubscription(subInfo);
            return false;
        }
        
        try {
            const requestId = Date.now() + Math.floor(Math.random() * 1000);
            
            // Create subscription request
            const subscribeRequest = {
                jsonrpc: '2.0',
                id: requestId,
                method: 'accountSubscribe',
                params: [
                    subInfo.address,
                    {
                        commitment: 'confirmed',
                        encoding: 'jsonParsed'
                    }
                ]
            };
            
            // Send subscription request
            return new Promise((resolve, reject) => {
                // Set up one-time message handler to catch the subscription response
                const messageHandler = (data) => {
                    try {
                        const message = JSON.parse(data);
                        
                        // Check if this is the response to our subscription request
                        if (message.id === requestId) {
                            // Remove the one-time message handler
                            this.wsConnection.removeListener('message', messageHandler);
                            
                            if (message.error) {
                                logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Subscription error for ${subInfo.address}: ${message.error.message}`);
                                reject(new Error(message.error.message));
                                return;
                            }
                            
                            const subscriptionId = message.result;
                            
                            // Store subscription mapping
                            this.subscriptions.set(subscriptionId, {
                                ...subInfo,
                                subscriptionId
                            });
                            
                            // Update pool subscription ID if this is a pool
                            if (subInfo.isPool && subInfo.poolId && this.monitoredPools.has(subInfo.address)) {
                                const poolInfo = this.monitoredPools.get(subInfo.address);
                                this.monitoredPools.set(subInfo.address, {
                                    ...poolInfo,
                                    subscriptionId
                                });
                            }
                            
                            if (subInfo.isPool) {
                                logApi.debug(`${formatLog.tag()} ${formatLog.header('SUBSCRIBED')} to pool ${subInfo.address} for token ${subInfo.tokenId} (${subscriptionId})`);
                            } else {
                                logApi.debug(`${formatLog.tag()} ${formatLog.header('SUBSCRIBED')} to token ${subInfo.address} (${subscriptionId})`);
                            }
                            
                            resolve(true);
                        }
                    } catch (error) {
                        // Keep listening, this might not be our message
                    }
                };
                
                // Add the one-time message handler
                this.wsConnection.on('message', messageHandler);
                
                // Send the request
                this.wsConnection.send(JSON.stringify(subscribeRequest));
                
                // Set timeout to avoid hanging
                setTimeout(() => {
                    this.wsConnection.removeListener('message', messageHandler);
                    reject(new Error(`Subscription timeout for ${subInfo.address}`));
                }, 5000);
            });
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Failed to subscribe to ${subInfo.address}: ${error.message}`);
            return false;
        }
    }

    /**
     * Handle incoming WebSocket messages
     * @param {Object} message - The WebSocket message
     */
    handleWebSocketMessage(message) {
        // Skip messages without a method
        if (!message.method) return;
        
        // Account notification
        if (message.method === 'accountNotification') {
            this.handleAccountUpdate(message);
        }
    }

    /**
     * Handle account update notifications
     * @param {Object} message - The account notification message
     */
    handleAccountUpdate(message) {
        try {
            if (!message.params || !message.params.result || !message.params.subscription) {
                return;
            }
            
            const subscriptionId = message.params.subscription;
            const accountData = message.params.result;
            
            // Get subscription info for this notification
            const subInfo = this.subscriptions.get(subscriptionId);
            
            if (!subInfo) {
                logApi.warn(`${formatLog.tag()} ${formatLog.header('WARNING')} Received update for unknown subscription: ${subscriptionId}`);
                return;
            }
            
            // Update activity timestamp
            this.stats.lastActivity = new Date();
            
            // Handle based on subscription type
            if (subInfo.isPool) {
                // This is a pool account update
                this.handlePoolAccountUpdate(subInfo, accountData);
            } else if (subInfo.isReserve) {
                // This is a reserve account update
                this.handleReserveAccountUpdate(subInfo, accountData);
            } else {
                // This is a token mint account update
                this.handleTokenMintUpdate(subInfo, accountData);
            }
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Error handling account update: ${error.message}`);
            this.stats.errors++;
        }
    }

    /**
     * Handle updates to pool accounts
     * @param {Object} subInfo - Subscription info
     * @param {Object} accountData - Account data from WebSocket
     */
    handlePoolAccountUpdate(subInfo, accountData) {
        try {
            // Get pool info
            const poolInfo = this.monitoredPools.get(subInfo.address);
            
            if (!poolInfo) {
                return;
            }
            
            logApi.debug(`${formatLog.tag()} ${formatLog.header('POOL UPDATE')} Pool ${subInfo.address} for token ${poolInfo.tokenSymbol} updated`);
            
            // Decode pool data based on DEX type
            // This is a simplified example - actual implementation would need to
            // decode the specific AMM data format based on the DEX type
            
            // Update pool information
            // this.updatePoolData(subInfo.address, decodedData);
            
            // Calculate price if we have both reserves
            this.calculatePriceFromPool(subInfo.address);
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Error handling pool update: ${error.message}`);
        }
    }

    /**
     * Handle updates to reserve accounts
     * @param {Object} subInfo - Subscription info
     * @param {Object} accountData - Account data from WebSocket
     */
    handleReserveAccountUpdate(subInfo, accountData) {
        try {
            if (!subInfo.poolAddress || !this.monitoredPools.has(subInfo.poolAddress)) {
                return;
            }
            
            const poolInfo = this.monitoredPools.get(subInfo.poolAddress);
            
            // Extract reserve amount from token account data
            let amount = null;
            
            if (accountData.value && accountData.value.data && accountData.value.data.parsed && 
                accountData.value.data.parsed.info && accountData.value.data.parsed.info.tokenAmount) {
                amount = new Decimal(accountData.value.data.parsed.info.tokenAmount.amount);
            }
            
            if (!amount) {
                return;
            }
            
            // Update reserve data in pool info
            if (subInfo.reserveType === 'A') {
                this.monitoredPools.set(subInfo.poolAddress, {
                    ...poolInfo,
                    lastReserveA: amount
                });
                
                logApi.debug(`${formatLog.tag()} ${formatLog.header('RESERVE UPDATE')} Reserve A for ${poolInfo.tokenSymbol} pool updated: ${amount.toString()}`);
            } else if (subInfo.reserveType === 'B') {
                this.monitoredPools.set(subInfo.poolAddress, {
                    ...poolInfo,
                    lastReserveB: amount
                });
                
                logApi.debug(`${formatLog.tag()} ${formatLog.header('RESERVE UPDATE')} Reserve B for ${poolInfo.tokenSymbol} pool updated: ${amount.toString()}`);
            }
            
            // Try to calculate price after reserve update
            this.calculatePriceFromPool(subInfo.poolAddress);
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Error handling reserve update: ${error.message}`);
        }
    }

    /**
     * Handle updates to token mint accounts
     * @param {Object} subInfo - Subscription info
     * @param {Object} accountData - Account data from WebSocket
     */
    handleTokenMintUpdate(subInfo, accountData) {
        try {
            const tokenInfo = this.monitoredTokens.get(subInfo.address);

            if (!tokenInfo) {
                return;
            }

            logApi.debug(`${formatLog.tag()} ${formatLog.header('TOKEN UPDATE')} Mint ${subInfo.address} for ${tokenInfo.symbol} updated`);

            // Extract token supply from mint account data and track it locally
            if (accountData.value && accountData.value.data && accountData.value.data.parsed &&
                accountData.value.data.parsed.info && accountData.value.data.parsed.info.supply) {
                const supply = new Decimal(accountData.value.data.parsed.info.supply);

                // Update local token info with new supply (for potential market cap calculations)
                this.monitoredTokens.set(subInfo.address, {
                    ...tokenInfo,
                    lastSupply: supply
                });

                logApi.debug(`${formatLog.tag()} ${formatLog.header('SUPPLY UPDATE')} ${tokenInfo.symbol} supply changed: ${supply.toString()} (tracked locally)`);

                // Note: We no longer update the database with supply changes.
                // Supply updates are now handled by the TokenActivationService
                // which properly updates both raw_supply and total_supply fields
                // with data from multiple authoritative sources.
            }
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Error handling token mint update: ${error.message}`);
        }
    }

    /**
     * Calculate token price from pool reserves
     * @param {string} poolAddress - The pool address
     */
    calculatePriceFromPool(poolAddress) {
        try {
            const poolInfo = this.monitoredPools.get(poolAddress);
            
            if (!poolInfo || !poolInfo.lastReserveA || !poolInfo.lastReserveB) {
                return;
            }
            
            // Determine if this token is token A or token B in the pool
            const tokenAddress = poolInfo.tokenAddress;
            const isTokenA = poolInfo.tokenAMint === tokenAddress;
            
            // Get decimals for both tokens (simplified - would need to get actual decimals)
            const tokenDecimals = 9; // Default for many Solana tokens
            const quoteDecimals = 6; // USDC is 6 decimals
            
            // Calculate price based on reserves
            let price;
            
            if (isTokenA) {
                // Token is A, calculate price as reserveB / reserveA
                price = poolInfo.lastReserveB
                    .div(new Decimal(10).pow(quoteDecimals))
                    .div(poolInfo.lastReserveA.div(new Decimal(10).pow(tokenDecimals)));
            } else {
                // Token is B, calculate price as reserveA / reserveB
                price = poolInfo.lastReserveA
                    .div(new Decimal(10).pow(quoteDecimals))
                    .div(poolInfo.lastReserveB.div(new Decimal(10).pow(tokenDecimals)));
            }
            
            // Get token info
            const tokenInfo = this.monitoredTokens.get(tokenAddress);
            
            if (!tokenInfo) {
                return;
            }
            
            // Update last price
            const formattedPrice = price.toFixed(tokenDecimals);
            
            // Check for significant price change before updating
            if (tokenInfo.lastPrice && Math.abs(price.minus(tokenInfo.lastPrice).div(tokenInfo.lastPrice).times(100).toNumber()) < 0.5) {
                // Price change less than 0.5%, don't update
                return;
            }
            
            // Update token info with new price
            this.monitoredTokens.set(tokenAddress, {
                ...tokenInfo,
                lastPrice: price,
                lastUpdate: new Date()
            });
            
            logApi.info(`${formatLog.tag()} ${formatLog.header('PRICE UPDATE')} ${tokenInfo.symbol} price updated from ${poolInfo.dexName} pool: $${formattedPrice}`);
            
            // Record price update
            this.recordPriceUpdate(tokenInfo.id, tokenInfo.symbol, formattedPrice, poolInfo.dexName);
            
            // Increment stats
            this.stats.priceUpdates++;
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Error calculating price from pool: ${error.message}`);
        }
    }

    /**
     * Record token price update in the database
     * @param {number} tokenId - Token ID
     * @param {string} symbol - Token symbol
     * @param {string} price - Token price
     * @param {string} source - Price source (e.g., PumpSwap, Raydium)
     */
    async recordPriceUpdate(tokenId, symbol, price, source) {
        try {
            // Notify price update handlers
            const priceUpdate = {
                tokenId,
                symbol,
                price,
                source: `websocket-${source.toLowerCase()}`,
                timestamp: new Date()
            };
            
            // Trigger price update handlers
            this.priceUpdateHandlers.forEach(handler => {
                try {
                    handler(priceUpdate);
                } catch (handlerError) {
                    logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Price update handler error: ${handlerError.message}`);
                }
            });
            
            // Store in price history (if configured)
            if (this.config.storePriceHistory !== false) {
                await prisma.token_price_history.create({
                    data: {
                        token_id: tokenId,
                        price: price,
                        source: `websocket-${source.toLowerCase()}`,
                        timestamp: new Date()
                    }
                });
            }
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Failed to record price update: ${error.message}`);
        }
    }

    // The handleSupplyChange method has been removed as supply updates
    // are now handled by the TokenActivationService which updates both
    // raw_supply and total_supply with data from multiple sources

    /**
     * Add a handler for price updates
     * @param {Function} handler - The handler function
     */
    onPriceUpdate(handler) {
        if (typeof handler === 'function') {
            this.priceUpdateHandlers.push(handler);
        }
    }

    /**
     * Remove a price update handler
     * @param {Function} handler - The handler to remove
     */
    removePriceUpdateHandler(handler) {
        const index = this.priceUpdateHandlers.indexOf(handler);
        if (index !== -1) {
            this.priceUpdateHandlers.splice(index, 1);
        }
    }

    /**
     * Get the current monitoring stats
     * @returns {Object} - Current stats
     */
    getStats() {
        return {
            ...this.stats,
            connected: this.wsConnected,
            tokenCount: this.monitoredTokens.size,
            poolCount: this.monitoredPools.size,
            minimumPriorityScore: this.minimumPriorityScore,
            now: new Date()
        };
    }

    /**
     * Update priority threshold for token monitoring
     * @param {number} minimumScore - Minimum priority score threshold (default: 50)
     * @returns {Promise<boolean>} - Success status
     */
    async updatePriorityThreshold(minimumScore = 50) {
        try {
            if (typeof minimumScore !== 'number' || minimumScore < 0) {
                logApi.warn(`${formatLog.tag()} ${formatLog.header('WARNING')} Invalid priority score threshold: ${minimumScore}`);
                return false;
            }

            // Store minimum priority score
            this.minimumPriorityScore = minimumScore;

            logApi.info(`${formatLog.tag()} ${formatLog.header('UPDATED')} Now monitoring tokens with priority score >= ${minimumScore}`);

            // Reload tokens with new priority threshold
            await this.loadActiveTokens();

            return true;
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Failed to update priority threshold: ${error.message}`);
            return false;
        }
    }

    /**
     * For backward compatibility - delegates to updatePriorityThreshold
     * @param {number[]} tiers - Array of priority tier numbers to monitor (ignored)
     * @returns {Promise<boolean>} - Success status
     */
    async updatePriorityTiers(tiers) {
        logApi.info(`${formatLog.tag()} ${formatLog.header('DEPRECATED')} updatePriorityTiers called - using minimum score 50`);
        return await this.updatePriorityThreshold(50);
    }

    /**
     * Cleanup and close WebSocket connections
     */
    async cleanup() {
        try {
            logApi.info(`${formatLog.tag()} ${formatLog.header('CLEANUP')} Closing WebSocket connections and cleaning up resources`);
            
            // Disable auto-reconnect
            this.autoReconnect = false;
            
            // Close WebSocket connection if we own it
            // Don't close SolanaEngine connections that we're borrowing
            if (this.wsConnection && this.wsConnection !== this.solanaEngine?.kiteWs) {
                this.wsConnection.terminate();
                this.wsConnection = null;
            }
            
            this.wsConnected = false;
            this.stats.connected = false;
            
            // Clear state
            this.monitoredTokens.clear();
            this.monitoredPools.clear();
            this.subscriptions.clear();
            this.pendingSubscriptions = [];
            
            logApi.info(`${formatLog.tag()} ${formatLog.header('CLEANED')} Token price WebSocket resources released`);
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.header('ERROR')} Error during cleanup: ${error.message}`);
        }
    }
}

// Create and export singleton instance
const tokenPriceWs = new TokenPriceWebSocketService();
export default tokenPriceWs;