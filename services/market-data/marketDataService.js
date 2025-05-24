// services/marketDataService.js.slim

/*
 * This service is responsible for providing real-time market data for all tokens.
 * It connects directly to the main database for token information
 * and provides market data via WebSockets and APIs.
 * 
 * UPDATED VERSION - Uses modular architecture with separate components
 * 
 * IMPORTANT: This service uses DATABASE_URL, not the deprecated MARKET_DATABASE_URL
 */

// Core imports
import { BaseService } from '../../utils/service-suite/base-service.js';
import { ServiceError } from '../../utils/service-suite/service-error.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../../utils/service-suite/service-constants.js';
import { getCircuitBreakerConfig } from '../../utils/service-suite/circuit-breaker-config.js';
import { fancyColors } from '../../utils/colors.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import { config } from '../../config/config.js';
import solanaEngine from '../solana-engine/index.js';
import { heliusClient } from '../solana-engine/helius-client.js';
import { getJupiterClient, jupiterClient } from '../solana-engine/jupiter-client.js';
import { dexscreenerClient } from '../solana-engine/dexscreener-client.js';
import tokenHistoryFunctions from '../token-history-functions.js';
import { Decimal } from 'decimal.js';
import prisma from '../../config/prisma.js';


// Import modular components
import marketData from './index.js';
const {
    rankTracker,
    batchProcessor,
    analytics,
    enricher,
    repository
} = marketData;

// Import WebSocket-based price monitoring
import tokenPriceWs from './token-price-ws.js';

// Service configuration
const BROADCAST_INTERVAL = 60; // Broadcast every 60 seconds
const UPDATE_INTERVAL = 60; // Update market database every 1 minute (Jupiter allows 10 requests/sec)
const MAX_TOKENS_TO_PROCESS = 10; // Process top 10 tokens for regular updates (DRASTICALLY REDUCED FROM 5000 FOR NOW)
const MAX_TOKENS_PER_BATCH = 5; // Jupiter API limit per request (REDUCED FROM 100 FOR NOW, ensure it\'s less than MAX_TOKENS_TO_PROCESS)
const STORE_ALL_ADDRESSES = true; // Store all ~540k token addresses in database
const CHECK_NEW_TOKENS_EVERY_UPDATE = false; // Disabled - don't check for new tokens during regular updates
const FULL_UPDATE_INTERVAL = 3600; // Check once per hour instead of every minute, but don't auto-sync

// Startup configuration - controls how token sync behaves during initialization
const SYNC_CONFIG = {
    // Startup behavior options: 'background', 'immediate', 'manual'
    // - 'background': Schedule token sync to run after server is fully initialized
    // - 'immediate': Run token sync during initialization (blocks server startup)
    // - 'manual': Don't run token sync automatically (requires admin to trigger)
    startupBehavior: 'manual', // Changed to manual - don't auto-sync on startup
    
    // Time (in seconds) to wait after initialization before starting background sync
    // Only applies if startupBehavior is 'background'
    backgroundSyncDelay: 300, // 5 minutes
    
    // Whether to run in batches with pauses to reduce database load
    batchedProcessing: true,
    
    // Maximum number of tokens to process per batch (to control memory usage)
    maxTokensPerBatch: 500
}

// Simplified configuration
const MARKET_DATA_CONFIG = {
    name: SERVICE_NAMES.MARKET_DATA,
    description: getServiceMetadata(SERVICE_NAMES.MARKET_DATA)?.description || 'Market data service',
    // Use the centralized circuit breaker configuration from service-constants.js
    // This ensures consistency across the application
    useDefaultCircuitBreaker: true,
    // Broadcast configuration
    broadcast: {
        intervalMs: BROADCAST_INTERVAL * 1000
    },
    // Database update configuration
    update: {
        intervalMs: UPDATE_INTERVAL * 1000
    }
};

/**
 * Market Data Service - Updated Version
 * This version:
 * 1. Uses modular components for better maintainability
 * 2. Delegates to specialized modules for different functionalities
 * 3. Maintains the same public API for backward compatibility
 * 
 * @extends {BaseService}
 */
class MarketDataService extends BaseService {
    constructor() {
        // IMPORTANT: Define service name constant to prevent issues
        const SERVICE_NAME = SERVICE_NAMES.MARKET_DATA; // market_data_service
        
        // Create proper config object for BaseService
        super({
            name: SERVICE_NAME,
            description: 'Market price data aggregation',
            layer: SERVICE_NAMES.MARKET_DATA ? getServiceMetadata(SERVICE_NAMES.MARKET_DATA).layer : 'DATA', // Example layer lookup
            criticalLevel: SERVICE_NAMES.MARKET_DATA ? getServiceMetadata(SERVICE_NAMES.MARKET_DATA).criticalLevel : 'high', // Example critical level lookup
            checkIntervalMs: 5 * 60 * 1000, // TEST: Set to 5 minutes (300000ms)
            circuitBreaker: getCircuitBreakerConfig(SERVICE_NAMES.MARKET_DATA) // Ensure circuit breaker config is passed
        });
        
        // FIX: Ensure config consistently uses the proper service name
        this.config = {
            ...MARKET_DATA_CONFIG,
            name: SERVICE_NAME, // Explicitly ensure name is correct
            checkIntervalMs: 5 * 60 * 1000, // Also update this internal config for consistency if used elsewhere
            circuitBreaker: getCircuitBreakerConfig(SERVICE_NAME)
        };
        
        // FIX: Explicitly set name property for serviceManager calls
        this.name = SERVICE_NAME;
        
        // State management
        this.broadcastInterval = null;
        this.updateInterval = null;
        this.lastBroadcastTime = null;
        this.lastUpdateTime = null;
        this.lastTokenCount = 0;
        
        // Background sync tracking
        this.syncInProgress = false;
        this.lastSyncStartTime = null;
        this.lastSyncCompleteTime = null;
        this.lastSyncStats = null;
        this.lastSyncError = null;
        this.syncBackoffCount = 0;
        this.syncScheduled = false;
        
        // Simplified stats tracking
        this.marketStats = {
            tokens: {
                total: 0,
                withMarketCap: 0,
                withImages: 0
            },
            broadcasts: {
                total: 0,
                lastBroadcast: null
            },
            updates: {
                total: 0,
                successful: 0,
                failed: 0,
                lastUpdate: null
            },
            performance: {
                lastQueryTimeMs: 0,
                lastUpdateTimeMs: 0
            },
            sync: {
                inProgress: false,
                lastStartTime: null,
                lastCompleteTime: null
            },
            insights: {
                lastUpdate: null,
                priceChangesCount: 0,
                volumeSpikesCount: 0
            }
        };
    }

    // Initialize the service
    async initialize() {
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} INITIALIZING (Transitional State) ${fancyColors.RESET} MarketDataService - Most operations are temporarily bypassed.`);
        
        try {
            if (!serviceManager.services.has(SERVICE_NAMES.MARKET_DATA)) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} REGISTERING ${fancyColors.RESET} Explicitly registering service with name: ${SERVICE_NAMES.MARKET_DATA}`);
                serviceManager.register(SERVICE_NAMES.MARKET_DATA, this);
            }
            
            if (!config.services.market_data) {
                logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Market Data Service is disabled in the '${config.services.active_profile}' service profile`);
                this.isInitialized = false;
                return false;
            }
            
            await super.initialize();
            
            try {
                const tokenCount = await prisma.tokens.count();
                this.marketStats.tokens.total = tokenCount;
                this.lastTokenCount = tokenCount;
                
                if (tokenCount === 0) {
                    logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Connected to market database, but no tokens found${fancyColors.RESET}`);
                } else {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Connected to market database, found ${tokenCount} tokens`);
                }
                
                if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Initializing SolanaEngine...`);
                    await solanaEngine.initialize();
                }
                
                if (!heliusClient.initialized) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Initializing Helius client...`);
                    await heliusClient.initialize();
                }
                
                if (!jupiterClient.initialized) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Jupiter client not initialized yet, using existing singleton...`);
                } else {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Using already initialized Jupiter client`);
                }

                await this.registerTokenSyncTasks();

                // Initialize WebSocket-based token price monitoring
                try {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Initializing WebSocket-based token price monitoring...`);

                    // Configure WebSocket price monitoring
                    const wsConfig = {
                        maxTokensToMonitor: 1000,         // Monitor up to 1000 tokens via WebSocket
                        minimumPriorityScore: 50,         // Monitor tokens with priority score >= 50
                        storePriceHistory: true,          // Store price updates in history table
                        batchSize: 20                     // Process subscriptions in batches of 20
                    };

                    // Register price update handler
                    tokenPriceWs.onPriceUpdate((priceUpdate) => {
                        this.handlePriceUpdate({
                            [priceUpdate.tokenId]: {
                                price: priceUpdate.price,
                                source: priceUpdate.source
                            }
                        });
                    });

                    // Initialize the WebSocket service
                    const wsInitialized = await tokenPriceWs.initialize(solanaEngine, wsConfig);

                    if (wsInitialized) {
                        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} WS ENABLED ${fancyColors.RESET} WebSocket-based token price monitoring initialized successfully`);
                        this.webSocketEnabled = true;
                    } else {
                        logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS DISABLED ${fancyColors.RESET} WebSocket-based token price monitoring failed to initialize, using fallback methods`);
                        this.webSocketEnabled = false;
                    }
                } catch (wsError) {
                    logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error initializing WebSocket-based price monitoring: ${wsError.message}${fancyColors.RESET}`);
                    this.webSocketEnabled = false;
                }

                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} MINIMALLY INITIALIZED ${fancyColors.RESET} MarketDataService initialization (transitional) complete.`);
                return true;
            } catch (dbError) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Failed to connect to market database: ${dbError.message}${fancyColors.RESET}`);
                throw new Error(`Failed to connect to market database: ${dbError.message}`);
            }
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET}`, error);
            await this.handleError(error);
            throw error;
        }
    }
    
    /**
     * Check if additional token sync is needed
     * Delegates to rankTracker module
     */
    async checkFullSyncNeeded(options = {}) {
        try {
            // Skip check if sync is already in progress
            if (this.syncInProgress) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Sync already in progress, skipping full sync check${fancyColors.RESET}`);
                return false;
            }
            
            return await rankTracker.checkFullSyncNeeded(prisma, jupiterClient, options);
            
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error checking token sync status:${fancyColors.RESET}`, error);
            return false; // Default to no sync needed if there's an error
        }
    }
    
    /**
     * Faster check for any new tokens that should be added
     * Used during regular updates to catch new tokens quickly
     * Delegated to rankTracker module
     */
    async checkAndAddNewTokens(jupiterTokens) {
        const startTime = Date.now();
        
        try {
            const result = await rankTracker.checkAndAddNewTokens(jupiterTokens, prisma);
            
            // Update token count stats if tokens were added
            if (result.addedCount > 0) {
                this.marketStats.tokens.total = await prisma.tokens.count();
                
                const elapsedMs = Date.now() - startTime;
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} TOKEN ADD ${fancyColors.RESET} Added ${result.addedCount} new tokens in ${elapsedMs}ms (${result.skippedCount} skipped, ${result.errorCount} errors)`);
            }
            
            return result.addedCount > 0;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error checking for new tokens:${fancyColors.RESET}`, error);
            return false;
        }
    }
    
    /**
     * Sync all token addresses from Jupiter to our database
     * Delegates to repository module for efficient database operations
     */
    async syncAllTokenAddresses() {
        const startTime = Date.now();
        
        try {
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} FULL SYNC ${fancyColors.RESET} Starting token sync (BACKGROUND PROCESS)`);
            
            // Flag to track that sync is in progress
            this.syncInProgress = true;
            this.syncScheduled = false;
            this.lastSyncStartTime = new Date();
            
            // Update the service stats for admin panel
            this.marketStats.sync = {
                inProgress: true,
                lastStartTime: this.lastSyncStartTime,
                lastCompleteTime: this.lastSyncCompleteTime
            };
            
            // Delegate to repository module
            const syncResult = await repository.syncAllTokenAddresses(jupiterClient, prisma, {
                logPrefix: `${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET}`,
                maxBatchesPerRun: 200,
                batchSize: 100,
                batchDelayMs: 10
            });
            
            // Update completion status
            this.syncInProgress = false;
            this.lastSyncCompleteTime = new Date();
            this.marketStats.tokens.total = syncResult.dbTokenCountAfter;
            
            // Record sync statistics
            this.lastSyncStats = {
                addedCount: syncResult.addedCount,
                skippedCount: syncResult.skippedCount,
                errorCount: syncResult.errorCount,
                elapsedSeconds: syncResult.elapsedSeconds,
                tokensPerSecond: syncResult.tokensPerSecond,
                dbTokenCountBefore: syncResult.dbTokenCountBefore,
                dbTokenCountAfter: syncResult.dbTokenCountAfter,
                completedAt: this.lastSyncCompleteTime,
                batchesProcessed: syncResult.batchesProcessed,
                totalBatches: syncResult.totalBatches
            };
            
            // Are there more batches to process?
            const remainingBatches = syncResult.totalBatches - syncResult.batchesProcessed;
            
            if (remainingBatches > 0) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SYNC PARTIAL ${fancyColors.RESET} Processed ${syncResult.batchesProcessed} of ${syncResult.totalBatches} batches. ${remainingBatches} batches (${remainingBatches * syncResult.batchSize} tokens) remaining for next run.`);
            }
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SYNC COMPLETE ${fancyColors.RESET} Added ${syncResult.addedCount} tokens (${syncResult.tokensPerSecond}/sec) in ${syncResult.elapsedSeconds}s. Database now has ${syncResult.dbTokenCountAfter.toLocaleString()} tokens (+${syncResult.dbTokenCountAfter - syncResult.dbTokenCountBefore})`);
            
            return true;
        } catch (error) {
            const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} SYNC FAILED ${fancyColors.RESET} Error during token sync (${elapsedSeconds}s): ${error.message}`, error);
            
            this.syncInProgress = false;
            this.lastSyncError = {
                message: error.message,
                timestamp: new Date(),
                elapsedSeconds
            };
            
            return false;
        }
    }

    // Format token data for consistent API responses
    formatTokenData(token) {
        // This function is not refactored into a module since it's simple
        // and closely tied to API responses expected from this service
        
        // Get social URLs by type from token_socials
        const socials = {};
        if (token.token_socials) {
            token.token_socials.forEach(social => {
                socials[social.type] = social.url;
            });
        }
        
        // Get websites from token_websites
        const websites = [];
        if (token.token_websites) {
            token.token_websites.forEach(website => {
                websites.push({
                    label: website.label,
                    url: website.url
                });
            });
        }
        
        // Get price data from token_prices relation
        const priceData = token.token_prices || {};
        
        return {
            id: token.id,
            symbol: token.symbol || "",
            name: token.name || "",
            price: parseFloat(priceData.price) || 0,
            change_24h: parseFloat(priceData.change_24h) || 0,
            color: token.color || '#888888',
            address: token.address,
            decimals: token.decimals || 9,
            market_cap: priceData.market_cap,
            fdv: priceData.fdv,
            liquidity: priceData.liquidity,
            volume_24h: priceData.volume_24h,
            image_url: token.image_url,
            buy_pressure: token.buy_pressure,
            socials: socials,
            websites: websites
        };
    }

    // Basic service health check
    async checkServiceHealth() {
        // If circuit breaker is open, check if cooling period has elapsed
        if (this.stats?.circuitBreaker?.isOpen) {
            // Add auto-recovery after a cooling period (5 minutes)
            const lastFailure = new Date(this.stats.circuitBreaker.lastFailure || 0);
            const now = new Date();
            const coolingPeriodMs = 5 * 60 * 1000; // 5 minutes
            
            if (now - lastFailure > coolingPeriodMs) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} AUTO-RECOVERY ${fancyColors.RESET} Circuit breaker cooling period elapsed, auto-resetting`);
                
                // Reset circuit breaker
                this.stats.circuitBreaker.isOpen = false;
                this.stats.circuitBreaker.failures = 0;
                this.stats.circuitBreaker.lastReset = new Date().toISOString();
                this.stats.history.consecutiveFailures = 0;
                
                return true;
            }
            
            // Still in cooling period
            throw ServiceError.circuitBreaker('Circuit breaker is open');
        }

        // Only perform a database check occasionally to avoid overloading the DB
        // Use a time-based throttle to prevent too many checks
        const now = Date.now();
        if (!this._lastDbCheck || now - this._lastDbCheck > 60000) { // Check at most once per minute
            try {
                // Perform a simple ping test to the database
                await prisma.$queryRaw`SELECT 1 as ping`;
                this._lastDbCheck = now;
                this._dbConnected = true;
            } catch (dbError) {
                this._lastDbCheck = now;
                this._dbConnected = false;
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Database connectivity check failed: ${dbError.message}${fancyColors.RESET}`);
                throw ServiceError.database(`Database connectivity check failed: ${dbError.message}`);
            }
        } else if (this._dbConnected === false) {
            // If we recently checked and know the DB is down, fail fast
            throw ServiceError.database('Database is currently unavailable');
        }
        
        return true;
    }
    
    /**
     * Check if the server is under high load
     * Delegates to utility function for system performance metrics
     */
    async checkServerLoad() {
        return await batchProcessor.checkServerLoad(this.syncInProgress, serviceManager);
    }
    
    /**
     * Register token sync tasks with the service manager
     * This separates the token sync functionality from the core market data service
     */
    async registerTokenSyncTasks() {
        try {
            // If enabled, log token sync status but don't automatically sync
            if (STORE_ALL_ADDRESSES) {
                // Log token counts but don't perform automatic sync
                try {
                    // Get the token list from Jupiter
                    const jupiterTokens = jupiterClient.tokenList || [];
                    
                    // Get database token count for comparison
                    const dbTokenCount = await prisma.tokens.count();
                    
                    if (jupiterTokens.length > 0) {
                        const coverage = ((dbTokenCount / jupiterTokens.length) * 100).toFixed(1);
                        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Token status: ${dbTokenCount.toLocaleString()} tokens in DB (${coverage}% of ${jupiterTokens.length.toLocaleString()} from Jupiter)`);
                        
                        // Just log that tokens can be synced via admin panel
                        if (dbTokenCount < jupiterTokens.length) {
                            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Token sync available via admin panel - ${(jupiterTokens.length - dbTokenCount).toLocaleString()} tokens can be added${fancyColors.RESET}`);
                        }
                    }
                } catch (error) {
                    logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Error checking token counts: ${error.message}${fancyColors.RESET}`);
                }
                
                // Set up a simple interval for periodic token status checks (no auto-sync)
                this.fullSyncInterval = setInterval(async () => {
                    try {
                        // Don't run check if sync is already in progress
                        if (this.syncInProgress || this.syncScheduled) {
                            return;
                        }
                        
                        // Get the token list from Jupiter
                        const jupiterTokens = jupiterClient.tokenList || [];
                        
                        // Get database token count for comparison
                        const dbTokenCount = await prisma.tokens.count();
                        
                        if (jupiterTokens.length > 0 && dbTokenCount < jupiterTokens.length) {
                            const coverage = ((dbTokenCount / jupiterTokens.length) * 100).toFixed(1);
                            const missingTokens = jupiterTokens.length - dbTokenCount;
                            
                            // Just log status without auto-syncing
                            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Hourly status: ${missingTokens.toLocaleString()} tokens need syncing (${coverage}% coverage - ${dbTokenCount.toLocaleString()}/${jupiterTokens.length.toLocaleString()})${fancyColors.RESET}`);
                        }
                    } catch (error) {
                        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error in token status check:${fancyColors.RESET}`, error);
                    }
                }, FULL_UPDATE_INTERVAL * 1000);
                
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Set up token status reporting (every ${FULL_UPDATE_INTERVAL / 60} hours)`);
            }
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error registering token sync tasks: ${error.message}${fancyColors.RESET}`);
        }
    }

    /**
     * Start the background sync process with proper error handling
     */
    startBackgroundSync() {
        if (this.syncInProgress || this.syncScheduled) {
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Sync already in progress or scheduled, skipping${fancyColors.RESET}`);
            return;
        }
        
        this.syncScheduled = true;
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} STARTING BACKGROUND SYNC ${fancyColors.RESET} Running token sync now that server is initialized`);
        
        this.syncAllTokenAddresses()
            .then(success => {
                this.syncScheduled = false;
                this.syncBackoffCount = 0; // Reset backoff on successful sync
                if (success) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SYNC COMPLETED ${fancyColors.RESET} Background token sync completed successfully`);
                } else {
                    logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SYNC INCOMPLETE ${fancyColors.RESET} Background token sync did not complete successfully`);
                }
                
                // Update service stats
                this.stats = {
                    ...this.stats,
                    syncStatus: {
                        inProgress: this.syncInProgress,
                        lastStartTime: this.lastSyncStartTime,
                        lastCompleteTime: this.lastSyncCompleteTime,
                        lastSyncStats: this.lastSyncStats,
                        lastSyncError: this.lastSyncError
                    }
                };
                
                // Update service heartbeat with updated stats - FIXED to use constant SERVICE_NAMES.MARKET_DATA
                try {
                    serviceManager.updateServiceHeartbeat(
                        SERVICE_NAMES.MARKET_DATA,
                        this.config,
                        this.stats
                    );
                } catch (updateError) {
                    logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to update service heartbeat: ${updateError.message}${fancyColors.RESET}`);
                }
            })
            .catch(err => {
                this.syncScheduled = false;
                this.syncBackoffCount++; // Increment backoff count on failure
                
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} SYNC ERROR ${fancyColors.RESET} Background token sync failed: ${err.message}`);
                
                // Calculate exponential backoff for retries
                const backoffMinutes = Math.min(Math.pow(2, this.syncBackoffCount), 60); // Max 60 minute backoff
                
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Will retry sync in ${backoffMinutes} minutes (attempt ${this.syncBackoffCount})${fancyColors.RESET}`);
                
                // Update error status
                this.lastSyncError = {
                    message: err.message,
                    timestamp: new Date(),
                    retryScheduled: true,
                    retryInMinutes: backoffMinutes
                };
                
                // Update service stats
                this.stats = {
                    ...this.stats,
                    syncStatus: {
                        inProgress: false,
                        lastStartTime: this.lastSyncStartTime,
                        lastCompleteTime: null,
                        lastSyncStats: null,
                        lastSyncError: this.lastSyncError
                    }
                };
                
                // Update service heartbeat with error status - FIXED to use constant SERVICE_NAMES.MARKET_DATA
                try {
                    serviceManager.updateServiceHeartbeat(
                        SERVICE_NAMES.MARKET_DATA,
                        this.config,
                        this.stats
                    );
                } catch (updateError) {
                    logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to update service heartbeat during error handling: ${updateError.message}${fancyColors.RESET}`);
                }
                
                // Retry with exponential backoff
                setTimeout(() => {
                    if (!this.syncInProgress && !this.syncScheduled) {
                        this.startBackgroundSync();
                    }
                }, backoffMinutes * 60 * 1000);
            });
    }

    // Perform service operation - simplified to just fetch latest stats
    async performOperation() {
        const startTime = Date.now();
        
        try {
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} TEMP NO-OP ${fancyColors.RESET} MarketDataService.performOperation() - Temporarily skipping DB operations to reduce connection load.`);
            this.marketStats.updates.total++; // Still increment total to show it was called
            this.marketStats.updates.successful++; // Assume no-op is "successful" in not crashing
            this.marketStats.updates.lastUpdate = new Date().toISOString();
            return true; // <-- CRITICAL: Exit early before any DB calls

            // ========================================================================
            // Original logic below is now bypassed by the return true; above
            // ========================================================================
            
            // Check service health - catches most database connectivity issues
            await this.checkServiceHealth();
            
            try {
                // Get current token count for stats
                const tokenCount = await prisma.tokens.count();
                this.marketStats.tokens.total = tokenCount;
                
                // Calculate some basic stats
                const tokensWithMarketCap = await prisma.tokens.count({
                    where: {
                        token_prices: {
                            market_cap: { not: null }
                        }
                    }
                });
                
                const tokensWithImages = await prisma.tokens.count({
                    where: {
                        image_url: { not: null }
                    }
                });
                
                this.marketStats.tokens.withMarketCap = tokensWithMarketCap;
                this.marketStats.tokens.withImages = tokensWithImages;
                this.marketStats.performance.lastQueryTimeMs = Date.now() - startTime;
            } catch (dbError) {
                // Log database error but don't throw - just skip updating stats
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Database error during stats update: ${dbError.message}${fancyColors.RESET}`);
                
                // If we can't reach the database, add a pause before next attempt
                // This prevents rapid-fire failures during a database outage
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            
            // Update sync status
            this.marketStats.sync = {
                inProgress: this.syncInProgress,
                lastStartTime: this.lastSyncStartTime,
                lastCompleteTime: this.lastSyncCompleteTime
            };
            
            // Try to update ServiceManager state, but don't fail if it doesn't work
            try {
                // FIXED: Always use the explicit constant name SERVICE_NAMES.MARKET_DATA
                await serviceManager.updateServiceHeartbeat(
                    SERVICE_NAMES.MARKET_DATA,
                    this.config,
                    {
                        ...this.stats,
                        marketStats: this.marketStats,
                        syncStatus: {
                            inProgress: this.syncInProgress,
                            lastStartTime: this.lastSyncStartTime,
                            lastCompleteTime: this.lastSyncCompleteTime,
                            lastSyncStats: this.lastSyncStats,
                            lastSyncError: this.lastSyncError
                        }
                    }
                );
            } catch (updateError) {
                logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to update service heartbeat: ${updateError.message}${fancyColors.RESET}`);
            }

            return {
                duration: Date.now() - startTime,
                stats: this.marketStats
            };
        } catch (error) {
            // For database connectivity errors, don't increment circuit breaker too aggressively
            if (error.code === 'DATABASE_ERROR') {
                logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Database connectivity issue detected, pausing before retry${fancyColors.RESET}`);
                
                // Add a delay to prevent rapid failures
                await new Promise(resolve => setTimeout(resolve, 10000));
                
                // Only record an error every 5th attempt to prevent overwhelming the circuit breaker
                if ((this.stats.circuitBreaker.failures % 5) === 0) {
                    await this.handleError(error);
                }
            } else {
                await this.handleError(error);
            }
            
            return false;
        }
    }

    // Get all tokens directly from database
    async getAllTokens() {
        try {
            const startTime = Date.now();
            await this.checkServiceHealth();
            
            // Delegate to repository module
            const tokens = await repository.getAllTokens(prisma);
            
            // Format tokens for API response
            const formattedTokens = tokens.map(token => this.formatTokenData(token));
            this.marketStats.performance.lastQueryTimeMs = Date.now() - startTime;
            
            return formattedTokens;
        } catch (error) {
            // Handle errors
            await this.handleError(error);
            return [];
        }
    }

    // Get tokens with optional filters, pagination, and ordering
    async getTokens(filters = {}, options = {}) {
        try {
            const startTime = Date.now();
            await this.checkServiceHealth();
            
            // Set defaults for options
            const {
                limit = 100,
                offset = 0,
                orderBy = { updated_at: 'desc' }
            } = options;
            
            // Build where clause from filters
            const where = {};
            
            if (filters.symbol) {
                where.symbol = {
                    contains: filters.symbol,
                    mode: 'insensitive'
                };
            }
            
            if (filters.name) {
                where.name = {
                    contains: filters.name,
                    mode: 'insensitive'
                };
            }
            
            if (filters.hasPrice) {
                where.token_prices = {
                    price: { not: null }
                };
            }
            
            if (filters.hasMarketCap) {
                where.token_prices = {
                    ...where.token_prices,
                    market_cap: { not: null }
                };
            }
            
            if (filters.minMarketCap) {
                where.token_prices = {
                    ...where.token_prices,
                    market_cap: { gte: filters.minMarketCap }
                };
            }
            
            if (filters.maxMarketCap) {
                where.token_prices = {
                    ...where.token_prices,
                    market_cap: { lte: filters.maxMarketCap }
                };
            }
            
            // Query tokens with filters and pagination
            const tokens = await prisma.tokens.findMany({
                where,
                include: {
                    token_prices: true,
                    token_socials: true,
                    token_websites: true
                },
                orderBy,
                take: limit,
                skip: offset
            });
            
            // Format tokens for API response
            const formattedTokens = tokens.map(token => this.formatTokenData(token));
            this.marketStats.performance.lastQueryTimeMs = Date.now() - startTime;
            
            return formattedTokens;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting tokens with filters:${fancyColors.RESET}`, error);
            await this.handleError(error);
            return [];
        }
    }

    // Get token by symbol - direct query
    async getToken(symbol) {
        try {
            await this.checkServiceHealth();
            
            // Delegate to repository module
            const token = await repository.getTokenBySymbol(symbol, prisma);

            if (!token) {
                return null;
            }

            return this.formatTokenData(token);
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting token:${fancyColors.RESET}`, error);
            throw error;
        }
    }

    // Get token by address - direct query
    async getTokenByAddress(address) {
        try {
            await this.checkServiceHealth();
            
            // Delegate to repository module
            const token = await repository.getTokenByAddress(address, prisma);

            if (!token) {
                return null;
            }

            return this.formatTokenData(token);
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting token by address:${fancyColors.RESET}`, error);
            throw error;
        }
    }
    
    /**
     * Helper method to get the token count from database
     * Used by admin routes to get sync status
     */
    async getTokenCount() {
        try {
            return await prisma.tokens.count();
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting token count:${fancyColors.RESET}`, error);
            return 0;
        }
    }

    /**
     * Get token price WebSocket monitoring stats
     * @returns {Object} - WebSocket monitoring stats
     */
    getTokenPriceWebSocketStats() {
        if (!this.webSocketEnabled) {
            return {
                enabled: false,
                message: 'WebSocket token price monitoring is not enabled'
            };
        }

        try {
            const stats = tokenPriceWs.getStats();
            return {
                enabled: true,
                stats,
                message: `WebSocket token price monitoring is ${stats.connected ? 'active' : 'inactive'}`
            };
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting WebSocket stats:${fancyColors.RESET}`, error);
            return {
                enabled: true,
                error: error.message,
                message: 'Error getting WebSocket monitoring stats'
            };
        }
    }

    /**
     * Update token price WebSocket priority threshold
     * @param {number} minimumScore - Minimum priority score for tokens to monitor
     * @returns {Promise<Object>} - Result of the update
     */
    async updateTokenPriceWebSocketThreshold(minimumScore) {
        if (!this.webSocketEnabled) {
            return {
                success: false,
                message: 'WebSocket token price monitoring is not enabled'
            };
        }

        try {
            const success = await tokenPriceWs.updatePriorityThreshold(minimumScore);
            return {
                success,
                message: success ?
                    `Priority threshold updated to: ${minimumScore}` :
                    'Failed to update priority threshold'
            };
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error updating WebSocket threshold:${fancyColors.RESET}`, error);
            return {
                success: false,
                error: error.message,
                message: 'Error updating WebSocket priority threshold'
            };
        }
    }

    /**
     * Update token price WebSocket priority tiers (legacy method)
     * @param {number[]} tiers - Array of priority tier numbers to monitor
     * @returns {Promise<Object>} - Result of the update
     */
    async updateTokenPriceWebSocketTiers(tiers) {
        logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}updateTokenPriceWebSocketTiers is deprecated, use updateTokenPriceWebSocketThreshold instead${fancyColors.RESET}`);

        // Default to 50 (equivalent to tiers 1-2)
        return await this.updateTokenPriceWebSocketThreshold(50);
    }

    /**
     * Direct WebSocket-based token price monitoring
     * Uses the token-price-ws.js module to monitor token mint accounts and liquidity pools
     *
     * The strategy:
     * 1. Use existing token and pool data from the database
     * 2. Monitor pool accounts directly via WebSocket
     * 3. Calculate price changes based on liquidity pool events
     * 4. Broadcast price updates to clients
     *
     * @param {string[]} tokenAddresses - Optional array of specific token addresses to monitor
     * @returns {Promise<Object>} - Monitoring status
     */
    async setupDirectTokenPriceMonitoring(tokenAddresses = []) {
        try {
            if (!this.webSocketEnabled) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}WebSocket token price monitoring is not enabled${fancyColors.RESET}`);
                return {
                    success: false,
                    message: 'WebSocket token price monitoring is not enabled'
                };
            }

            const stats = tokenPriceWs.getStats();

            // Return current status
            return {
                success: true,
                message: `WebSocket token price monitoring active with ${stats.tokenCount} tokens and ${stats.poolCount} pools`,
                stats
            };
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting token price monitoring status: ${error.message}${fancyColors.RESET}`);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Handle price updates (updated to work with both sources)
    async handlePriceUpdate(priceData) {
        try {
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Processing manual price updates for ${Object.keys(priceData).length} tokens`);
            
            // Delegate to repository module
            await repository.handlePriceUpdate(priceData, prisma, (tokenId, price, source) => 
                this.recordPriceHistory(tokenId, price, source));
            
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error handling price update:${fancyColors.RESET}`, error);
        }
    }
    
    /**
     * Record a new entry in the token price history
     * @param {number} tokenId - The token ID
     * @param {string} price - The price as a string
     * @param {string} source - Source of the price update (e.g., 'jupiter', 'helius', 'manual')
     * @returns {Promise<boolean>} - Whether the operation was successful
     */
    async recordPriceHistory(tokenId, price, source = 'system') {
        try {
            // Make sure token ID and price are valid
            if (!tokenId || !price) {
                logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Invalid token ID or price for price history:${fancyColors.RESET} ${tokenId}, ${price}`);
                return false;
            }
            
            // Create a new price history entry
            // Use a connection from the pool only briefly
            await prisma.token_price_history.create({
                data: {
                    token_id: tokenId,
                    price: price,
                    source: source,
                    timestamp: new Date()
                }
            });
            
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded price history for token ID ${tokenId}: ${price} (source: ${source})`);
            return true;
        } catch (error) {
            // Log the error and continue - we don't want a price history failure to block token updates
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error recording price history for token ID ${tokenId}:${fancyColors.RESET}`, error);
            return false;
        }
    }
    
    /**
     * Batch record price history for multiple tokens
     * More efficient than individual calls to recordPriceHistory
     * @param {Array} priceHistoryRecords - Array of {tokenId, price, source} objects
     * @returns {Promise<boolean>} - Whether the operation was successful
     */
    async recordPriceHistoryBatch(priceHistoryRecords) {
        return await repository.recordPriceHistoryBatch(priceHistoryRecords, prisma);
    }

    // Update token data in the market database
    async updateTokenData() {
        logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} TEMP NO-OP ${fancyColors.RESET} MarketDataService.updateTokenData() called but is TEMPORARILY a no-op.`);
        // This method is called by an interval started in startUpdateInterval.
        // Since startUpdateInterval is not called from initialize(), this method should not be called either,
        // unless start() from BaseService is invoked and it calls performOperation which then calls this.
        // For safety, make it a clear no-op.
        this.marketStats.updates.total++; // Still increment total to show it was called
        this.marketStats.updates.successful++; // Assume no-op is "successful" in not crashing
        this.marketStats.updates.lastUpdate = new Date().toISOString();
        return true; // Prevent any old logic from running
    }
    
    // Helper function to clean token addresses
    cleanTokenAddress(address) {
        if (!address) return null;
        
        // Remove quotes and backslashes if present (sometimes comes from Jupiter API)
        return address.replace(/^["']+|["']+$/g, '').replace(/\\"/g, '');
    }

    /** Start the interval to update token data in the database */
    startUpdateInterval() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} SETUP ${fancyColors.RESET} Started token data update interval (${this.config.update.intervalMs / 1000}s) processing ${MAX_TOKENS_TO_PROCESS} tokens with Jupiter API (10 req/sec limit)`);
        this.updateInterval = setInterval(async () => {
            try {
                await this.updateTokenData();
            } catch (error) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error in (disabled) update interval:`, error);
            }
        }, this.config.update.intervalMs);
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} SETUP ${fancyColors.RESET} Started token data update interval (${this.config.update.intervalMs / 1000}s)`);
    }

    /**
     * Start broadcast interval for token data updates
     * @returns {void}
     */
    startBroadcastInterval() {
        if (this.broadcastInterval) {
            clearInterval(this.broadcastInterval);
        }
        
        this.broadcastInterval = setInterval(async () => {
            try {
                const broadcastStartTime = Date.now();
                
                // Direct query to get tokens for broadcast
                const tokens = await this.getAllTokens();
                
                if (tokens && tokens.length > 0) {
                    // Prepare broadcast data
                    const broadcastData = {
                        type: 'token_update',
                        timestamp: new Date().toISOString(),
                        data: tokens,
                        _broadcastId: Date.now().toString(36) + Math.random().toString(36).substring(2, 5) // Add unique ID for tracking
                    };
                    
                    // Log and track tokens with significant price changes
                    const topGainers = tokens
                        .filter(t => t.change_24h && t.change_24h > 5)
                        .sort((a, b) => b.change_24h - a.change_24h)
                        .slice(0, 3)
                        .map(t => t.symbol);
                    
                    // Emit broadcast event
                    serviceEvents.emit('market:broadcast', broadcastData);
                    
                    // Update stats
                    this.marketStats.broadcasts.total++;
                    this.marketStats.broadcasts.lastBroadcast = broadcastData.timestamp;
                    this.lastBroadcastTime = Date.now();
                    this.lastTokenCount = tokens.length;
                    
                    // Log a simplified summary
                    const formattedCount = tokens.length.toString().padStart(3);
                    const broadcastTime = Date.now() - broadcastStartTime;
                    
                    // Create a concise broadcast summary
                    const broadcastSummary = topGainers.length > 0 ? 
                        `${formattedCount} tokens (⬆️ ${topGainers.join(', ')})` : 
                        `${formattedCount} tokens`;
                    
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_PURPLE}${fancyColors.WHITE} BCAST ${fancyColors.RESET} ${broadcastSummary} in ${broadcastTime}ms`);
                } else {
                    logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}No tokens found for broadcast${fancyColors.RESET}`);
                }
            } catch (error) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} Broadcast error: ${error.message}`, error);
            }
        }, this.config.broadcast.intervalMs);
        
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} SETUP ${fancyColors.RESET} Started market data broadcast interval (${this.config.broadcast.intervalMs / 1000}s)`);
    }

    /**
     * Stop the service and clean up resources
     * @returns {Promise<void>}
     */
    async stop() {
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Stopping MarketDataService...`);
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Cleared updateInterval.`);
        }
        if (this.broadcastInterval) {
            clearInterval(this.broadcastInterval);
            this.broadcastInterval = null;
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Cleared broadcastInterval.`);
        }

        // Clean up WebSocket monitoring if enabled
        if (this.webSocketEnabled) {
            try {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Cleaning up WebSocket token price monitoring...`);
                await tokenPriceWs.cleanup();
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} WebSocket token price monitoring cleaned up successfully.`);
            } catch (wsError) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error cleaning up WebSocket monitoring: ${wsError.message}${fancyColors.RESET}`);
            }
        }

        // Call BaseService stop, which also sets isStarted to false
        await super.stop();
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} MarketDataService stopped.`);
    }
}

// Create and export a singleton instance
const marketDataService = new MarketDataService();

export default marketDataService;