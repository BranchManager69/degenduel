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
import { PrismaClient } from '@prisma/client';
import serviceManager from '../../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../../utils/service-suite/service-constants.js';
import { fancyColors } from '../../utils/colors.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import { config } from '../../config/config.js';
import solanaEngine from '../solana-engine/index.js';
import { heliusClient } from '../solana-engine/helius-client.js';
import { getJupiterClient, jupiterClient } from '../solana-engine/jupiter-client.js';
import { dexscreenerClient } from '../solana-engine/dexscreener-client.js';
import tokenHistoryFunctions from '../token-history-functions.js';

// Import modular components
import marketData from './index.js';
const {
    rankTracker,
    batchProcessor,
    analytics,
    enricher,
    repository
} = marketData;

// Service configuration
const BROADCAST_INTERVAL = 60; // Broadcast every 60 seconds
const UPDATE_INTERVAL = 60; // Update market database every 1 minute (Jupiter allows 10 requests/sec)
const MAX_TOKENS_TO_PROCESS = 5000; // Process top 5000 tokens for regular updates (increased from 1000)
const MAX_TOKENS_PER_BATCH = 100; // Jupiter API limit per request
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

// Initialize direct connection to Database using DATABASE_URL (not the deprecated MARKET_DATABASE_URL)
const marketDb = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL
});

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
            layer: 'INFRASTRUCTURE',
            criticalLevel: 'high',
            checkIntervalMs: 60 * 1000 // Once per minute
        });
        
        // FIX: Ensure config consistently uses the proper service name
        this.config = {
            ...MARKET_DATA_CONFIG,
            name: SERVICE_NAME // Explicitly ensure name is correct
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
            }
        };
    }

    // Initialize the service
    async initialize() {
        try {
            // IMPORTANT FIX: Explicitly register with ServiceManager using the correct name
            // This ensures that events and circuit breaker operations use the correct service name
            if (!serviceManager.services.has(SERVICE_NAMES.MARKET_DATA)) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} REGISTERING ${fancyColors.RESET} Explicitly registering service with name: ${SERVICE_NAMES.MARKET_DATA}`);
                serviceManager.register(SERVICE_NAMES.MARKET_DATA, this);
            }
            
            // Check if service is enabled via service profile
            if (!config.services.market_data) {
                logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Market Data Service is disabled in the '${config.services.active_profile}' service profile`);
                return false; // Skip initialization
            }
            
            // Check market database connection
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Connecting to market database...`);
            try {
                const tokenCount = await marketDb.tokens.count();
                this.marketStats.tokens.total = tokenCount;
                this.lastTokenCount = tokenCount;
                
                if (tokenCount === 0) {
                    logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Connected to market database, but no tokens found${fancyColors.RESET}`);
                } else {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Connected to market database, found ${tokenCount} tokens`);
                }
                
                // Initialize SolanaEngine if it's not already initialized
                if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Initializing SolanaEngine...`);
                    await solanaEngine.initialize();
                }
                
                // Initialize the Helius client if it's not already initialized
                if (!heliusClient.initialized) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Initializing Helius client...`);
                    await heliusClient.initialize();
                }
                
                // Use the singleton Jupiter client that should already be initialized by SolanaEngine
                if (!jupiterClient.initialized) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Jupiter client not initialized yet, using existing singleton...`);
                    // Don't initialize here, just use the existing instance from SolanaEngine
                } else {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Using already initialized Jupiter client`);
                }
                
                // Register the token sync tasks - separating core service from token sync
                await this.registerTokenSyncTasks();
                
                // Start update interval to update token data in the database (every minute)
                // Add a delay before the first update to allow the system to fully initialize
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Scheduling database update interval (every ${UPDATE_INTERVAL} seconds) with 10-second initial delay...`);
                setTimeout(() => {
                    this.startUpdateInterval();
                }, 10000);
                
                // Start broadcast interval
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Starting broadcast interval...`);
                this.startBroadcastInterval();
                
            } catch (dbError) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Failed to connect to market database: ${dbError.message}${fancyColors.RESET}`);
                throw new Error(`Failed to connect to market database: ${dbError.message}`);
            }

            // Update stats with sync status
            this.marketStats.sync = {
                inProgress: this.syncInProgress,
                lastStartTime: this.lastSyncStartTime,
                lastCompleteTime: this.lastSyncCompleteTime
            };
            
            this.stats = {
                ...this.stats,
                marketStats: this.marketStats,
                syncStatus: {
                    inProgress: this.syncInProgress,
                    lastStartTime: this.lastSyncStartTime,
                    lastCompleteTime: this.lastSyncCompleteTime,
                    lastSyncStats: this.lastSyncStats,
                    lastSyncError: this.lastSyncError
                }
            };

            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Market Data Service ready`);

            this.isInitialized = true;
            return true;
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
            
            return await rankTracker.checkFullSyncNeeded(marketDb, jupiterClient, options);
            
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
            const result = await rankTracker.checkAndAddNewTokens(jupiterTokens, marketDb);
            
            // Update token count stats if tokens were added
            if (result.addedCount > 0) {
                this.marketStats.tokens.total = await marketDb.tokens.count();
                
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
            const syncResult = await repository.syncAllTokenAddresses(jupiterClient, marketDb, {
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
                await marketDb.$queryRaw`SELECT 1 as ping`;
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
                    const dbTokenCount = await marketDb.tokens.count();
                    
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
                        const dbTokenCount = await marketDb.tokens.count();
                        
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
            // Check service health - catches most database connectivity issues
            await this.checkServiceHealth();
            
            try {
                // Get current token count for stats
                const tokenCount = await marketDb.tokens.count();
                this.marketStats.tokens.total = tokenCount;
                
                // Calculate some basic stats
                const tokensWithMarketCap = await marketDb.tokens.count({
                    where: {
                        token_prices: {
                            market_cap: { not: null }
                        }
                    }
                });
                
                const tokensWithImages = await marketDb.tokens.count({
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
            const tokens = await repository.getAllTokens(marketDb);
            
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

    // Get token by symbol - direct query
    async getToken(symbol) {
        try {
            await this.checkServiceHealth();
            
            // Delegate to repository module
            const token = await repository.getTokenBySymbol(symbol, marketDb);

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
            const token = await repository.getTokenByAddress(address, marketDb);

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
            return await marketDb.tokens.count();
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting token count:${fancyColors.RESET}`, error);
            return 0;
        }
    }

    /**
     * FUTURE IMPLEMENTATION: Direct Helius monitoring of token liquidity pools
     * This will replace the Jupiter WebSocket which doesn't seem to be documented/available
     * 
     * The strategy:
     * 1. Use Helius to find the liquidity pools for each token
     * 2. Monitor pool transactions directly via Helius WebHooks or WebSockets
     * 3. Calculate price changes based on liquidity pool events
     */
    async setupHeliusTokenMonitoring(tokenAddresses) {
        // TODO: Implement when ready to replace Jupiter price polling
        // This will give us more direct and reliable price updates
        
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Helius token monitoring not yet implemented${fancyColors.RESET}`);
        return false;
    }
    
    // Handle price updates (updated to work with both sources)
    async handlePriceUpdate(priceData) {
        try {
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Processing manual price updates for ${Object.keys(priceData).length} tokens`);
            
            // Delegate to repository module
            await repository.handlePriceUpdate(priceData, marketDb, (tokenId, price, source) => 
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
            await marketDb.token_price_history.create({
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
        return await repository.recordPriceHistoryBatch(priceHistoryRecords, marketDb);
    }

    // Update token data in the market database
    async updateTokenData() {
        const startTime = Date.now();
        
        try {
            // Check service health
            await this.checkServiceHealth();
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_PURPLE}${fancyColors.WHITE} UPDATING ${fancyColors.RESET} Starting token data update`);
            
            // Get a list of tokens from Jupiter's API
            const tokenList = await jupiterClient.tokenList;
            
            if (!tokenList || tokenList.length === 0) {
                throw new Error('Failed to get token list from Jupiter');
            }
            
            // Delegate to modular components
            
            // 1. Process existing token map
            const existingTokens = await repository.getExistingTokens(marketDb);
            const existingTokenMap = repository.createTokenMap(existingTokens);
            
            // 2. Process and sort tokens
            const sortedTokens = analytics.sortTokensByRelevance(tokenList);
            const tokenSubset = sortedTokens.slice(0, MAX_TOKENS_TO_PROCESS);
            
            // 3. Track rank changes and log insights
            const rankingResult = await rankTracker.trackRankChanges(tokenSubset, existingTokenMap, marketDb);
            
            // 4. Process tokens in batches
            const processResult = await batchProcessor.processBatches(
                tokenSubset, 
                marketDb, 
                {
                    jupiterClient,
                    heliusClient,
                    dexscreenerClient,
                    existingTokenMap,
                    batchSize: MAX_TOKENS_PER_BATCH,
                    logPrefix: `${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET}`
                }
            );
            
            // 5. Handle token data enrichment
            await enricher.enhanceTokenData(
                processResult.tokensToEnhance, 
                dexscreenerClient, 
                marketDb, 
                `${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET}`
            );
            
            // 6. Record token data history
            await repository.recordTokenHistory(
                processResult.tokensForHistory, 
                tokenHistoryFunctions
            );
            
            // Update stats
            this.marketStats.updates.total++;
            this.marketStats.updates.successful++;
            this.marketStats.updates.lastUpdate = new Date().toISOString();
            this.marketStats.performance.lastUpdateTimeMs = Date.now() - startTime;
            
            // Summarize the update with additional stats
            const timeElapsed = Math.round((Date.now() - startTime) / 1000);
            const tokensPerSecond = Math.round(processResult.processedCount / timeElapsed);
            
            // Summary details for admins to understand the update impact
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} UPDATE COMPLETE ${fancyColors.RESET} Processed ${processResult.processedCount}/${tokenList.length} tokens (${processResult.newTokensCount} new, ${processResult.updatedTokensCount} updated) in ${timeElapsed}s (${tokensPerSecond} tokens/sec)`);
            
            // Log a more detailed summary to provide insight into token coverage
            const tokenCoverage = ((processResult.processedCount / tokenList.length) * 100).toFixed(1);
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Update Summary:${fancyColors.RESET} Coverage: ${tokenCoverage}%, New tokens: ${processResult.newTokensCount}, Updated tokens: ${processResult.updatedTokensCount}, Processed in ${processResult.totalGroups} parallel groups`);
            
            return true;
        } catch (error) {
            this.marketStats.updates.failed++;
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} UPDATE FAILED ${fancyColors.RESET} Error updating token data: ${error.message}`, error);
            return false;
        }
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
        
        // Set up regular updates without immediate execution
        // This gives time for all dependencies to be properly initialized
        this.updateInterval = setInterval(async () => {
            try {
                await this.updateTokenData();
            } catch (error) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error in update interval:${fancyColors.RESET}`, error);
            }
        }, this.config.update.intervalMs);
        
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} SETUP ${fancyColors.RESET} Started token data update interval (${this.config.update.intervalMs / 1000}s) processing ${MAX_TOKENS_TO_PROCESS} tokens with Jupiter API (10 req/sec limit)`);
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
        try {
            await super.stop();
            
            // Clear broadcast interval
            if (this.broadcastInterval) {
                clearInterval(this.broadcastInterval);
                this.broadcastInterval = null;
            }
            
            // Clear update interval
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }
            
            // Clear full sync interval if it exists
            if (this.fullSyncInterval) {
                clearInterval(this.fullSyncInterval);
                this.fullSyncInterval = null;
            }
            
            // Final stats update - FIXED to ensure we always use SERVICE_NAMES.MARKET_DATA
            try {
                await serviceManager.markServiceStopped(
                    SERVICE_NAMES.MARKET_DATA,
                    this.config,
                    {
                        ...this.stats,
                        marketStats: this.marketStats
                    }
                );
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} STOP CONFIRMED ${fancyColors.RESET} Successfully marked service as stopped`);
            } catch (stopError) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error marking service as stopped: ${stopError.message}${fancyColors.RESET}`);
            }
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Service stopped`);
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error stopping service:${fancyColors.RESET}`, error);
            throw error;
        }
    }
}

// Create and export a singleton instance
const marketDataService = new MarketDataService();

export default marketDataService;