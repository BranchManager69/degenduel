// services/marketDataService.js

/*
 * This service is responsible for providing real-time market data for all tokens.
 * It connects directly to the main database for token information
 * and provides market data via WebSockets and APIs.
 * 
 * UPDATED VERSION - Uses SolanaEngine to update database and tracks price history
 * 
 * IMPORTANT: This service now uses DATABASE_URL, not the deprecated MARKET_DATABASE_URL
 */

// Imports
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { PrismaClient } from '@prisma/client';
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import { fancyColors } from '../utils/colors.js';
import serviceEvents from '../utils/service-suite/service-events.js';
import { config } from '../config/config.js';
import solanaEngine from './solana-engine/index.js';
import { heliusClient } from './solana-engine/helius-client.js';
import { getJupiterClient, jupiterClient } from './solana-engine/jupiter-client.js';
import tokenHistoryFunctions from './token-history-functions.js';

// Service configuration
const BROADCAST_INTERVAL = 60; // Broadcast every 60 seconds
const UPDATE_INTERVAL = 60; // Update market database every 1 minute (Jupiter allows 10 requests/sec)
const MAX_TOKENS_TO_PROCESS = 1000; // Process top 1000 tokens for regular updates
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
    // Simple circuit breaker configuration
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        minHealthyPeriodMs: 60000
    },
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
 * 1. Uses SolanaEngine to fetch token data from premium APIs
 * 2. Updates the market database with fresh data regularly
 * 3. Provides direct database queries for clients
 * 
 * @extends {BaseService}
 */
class MarketDataService extends BaseService {
    constructor() {
        // Create proper config object for BaseService
        super({
            name: SERVICE_NAMES.MARKET_DATA,
            description: 'Market price data aggregation',
            layer: 'INFRASTRUCTURE',
            criticalLevel: 'high',
            checkIntervalMs: 60 * 1000 // Once per minute
        });
        
        // Initialize config with MARKET_DATA_CONFIG to fix intervalMs error
        this.config = MARKET_DATA_CONFIG;
        
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
                
                // Note: Direct WebSocket price updates removed as the Jupiter WebSocket endpoint is unconfirmed
                // In future, we'll implement Helius-based monitoring of liquidity pools
                
                // Register the token sync tasks - separating core service from token sync
                await this.registerTokenSyncTasks();
                
                // Start update interval to update token data in the database (every minute)
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Starting database update interval (every ${UPDATE_INTERVAL} seconds)...`);
                this.startUpdateInterval();
                
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
     * Rather than using a percentage threshold, we now check for a small absolute number
     * of new tokens to ensure we capture even small batches of new tokens
     * 
     * @param {Object} options - Configuration options
     * @param {boolean} options.adminTriggered - Whether this check was triggered manually by an admin
     * @returns {Promise<boolean>} True if sync is needed, false otherwise
     */
    async checkFullSyncNeeded(options = {}) {
        try {
            // Skip check if sync is already in progress
            if (this.syncInProgress) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Sync already in progress, skipping full sync check${fancyColors.RESET}`);
                return false;
            }
            
            // Get the current token count from database
            const dbTokenCount = await marketDb.tokens.count();
            
            // Get the token list from Jupiter 
            await jupiterClient.initialize(); // Ensure Jupiter client is initialized
            const jupiterTokens = await jupiterClient.tokenList;
            const jupiterTokenCount = jupiterTokens?.length || 0;
            
            // Calculate the difference in tokens
            const tokenDifference = jupiterTokenCount - dbTokenCount;
            
            // Different thresholds based on context
            let NEW_TOKEN_THRESHOLD = 10; // Default: 10 new tokens
            
            // For admin-triggered checks, use a smaller threshold
            if (options.adminTriggered) {
                NEW_TOKEN_THRESHOLD = 1; // Admin check: Any new token is enough
            } 
            // For automatic background checks:
            else {
                // If we have less than 25% of the tokens, always need a sync
                if (dbTokenCount < (jupiterTokenCount * 0.25)) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} MAJOR SYNC NEEDED ${fancyColors.RESET} Database has less than 25% of available tokens`);
                    return true;
                }
            }
            
            const syncNeeded = tokenDifference > NEW_TOKEN_THRESHOLD;
            
            // Improved logging that highlights new tokens more clearly
            const coveragePercent = Math.round((dbTokenCount / jupiterTokenCount) * 100);
            
            if (tokenDifference > 0) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} NEW TOKENS DETECTED ${fancyColors.RESET} Found ${tokenDifference} new tokens since last check (${dbTokenCount}/${jupiterTokenCount}, ${coveragePercent}%)`);
                
                // If there are new tokens but below threshold, still log them but don't trigger full sync
                if (!syncNeeded) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} New token count (${tokenDifference}) is below threshold (${NEW_TOKEN_THRESHOLD}), using regular update cycle instead of full sync`);
                } else {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SYNC TRIGGERED ${fancyColors.RESET} New token count (${tokenDifference}) exceeds threshold (${NEW_TOKEN_THRESHOLD})`);
                }
            } else {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Token coverage: ${coveragePercent}% (${dbTokenCount}/${jupiterTokenCount}) - All tokens tracked`);
            }
            
            return syncNeeded;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error checking token sync status:${fancyColors.RESET}`, error);
            return false; // Default to no sync needed if there's an error
        }
    }
    
    /**
     * Faster check for any new tokens that should be added
     * Used during regular updates to catch new tokens quickly
     */
    async checkAndAddNewTokens(jupiterTokens) {
        const startTime = Date.now();
        
        try {
            if (!jupiterTokens || jupiterTokens.length === 0) {
                logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}No tokens provided for new token check${fancyColors.RESET}`);
                return false;
            }
            
            // Get a count of tokens we have in the database
            const dbTokenCount = await marketDb.tokens.count();
            
            // Log current token counts for monitoring
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Token counts - DB: ${dbTokenCount}, Jupiter: ${jupiterTokens.length}`);
            
            // Quick check - if we already have more tokens than Jupiter is reporting, skip check
            if (dbTokenCount >= jupiterTokens.length) {
                logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} DB token count (${dbTokenCount}) ≥ Jupiter count (${jupiterTokens.length}), skipping new token check`);
                return false;
            }
            
            // Log that we need to do a more thorough check
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Token count discrepancy detected - DB: ${dbTokenCount}, Jupiter: ${jupiterTokens.length}${fancyColors.RESET}`);
            
            // Get existing token addresses for comparison (only if we potentially have new tokens)
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Fetching existing token addresses from database`);
            const existingTokens = await marketDb.tokens.findMany({
                select: {
                    address: true
                }
            });
            
            // Create a map of existing tokens by address for faster lookup
            const existingAddressMap = new Set(existingTokens.map(token => token.address));
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Created address map with ${existingAddressMap.size} tokens`);
            
            // Determine which tokens need to be added
            const tokensToAdd = jupiterTokens.filter(token => 
                !existingAddressMap.has(token) && // Not already in our database
                token && token.length > 20 // Basic validation to ensure valid addresses
            );
            
            if (tokensToAdd.length === 0) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GREEN}No new token addresses to add despite count discrepancy${fancyColors.RESET}`);
                return false;
            }
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} NEW TOKENS ${fancyColors.RESET} Found ${tokensToAdd.length} new tokens during regular update`);
            
            // Log new tokens more prominently as requested
            if (tokensToAdd.length > 0) {
                // Split display by chunks to avoid too long log lines
                const DISPLAY_CHUNK_SIZE = 5;
                for (let i = 0; i < tokensToAdd.length; i += DISPLAY_CHUNK_SIZE) {
                    const chunkTokens = tokensToAdd.slice(i, i + DISPLAY_CHUNK_SIZE);
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GREEN}NEW TOKEN BATCH ${Math.floor(i/DISPLAY_CHUNK_SIZE) + 1}:${fancyColors.RESET} ${chunkTokens.join(', ')}`);
                }
                
                // Also provide a distinct log of just the count for easy monitoring
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} TOKEN COUNT ${fancyColors.RESET} Adding ${tokensToAdd.length} new tokens to database`);
            }
            
            // Process the new tokens in a single batch for speed
            let addedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;
            
            // Process each token
            for (const tokenAddress of tokensToAdd) {
                try {
                    // Create basic token record with address and set price via relation
                    // Use Prisma's native create method now that our schema is updated
                    const newToken = await marketDb.tokens.create({
                        data: {
                            address: tokenAddress,
                            symbol: `UNKNOWN_${tokenAddress.substring(0, 6)}`, // Temporary symbol
                            name: `Unknown Token ${tokenAddress.substring(0, 6)}`, // Temporary name
                            created_at: new Date(),
                            price: "0.00000000", // Default price
                            change_24h: "0.00", // Default 24h change
                            color: "#888888", // Default color
                            is_active: true
                        }
                    });
                    
                    // Try to create token price record with better error handling
                    try {
                        // First check if a token_prices record exists for this token
                        const existingPrice = await marketDb.token_prices.findUnique({
                            where: { token_id: newToken.id }
                        });
                        
                        if (existingPrice) {
                            // Update existing price
                            await marketDb.token_prices.update({
                                where: { token_id: newToken.id },
                                data: { 
                                    price: "0.00000000",
                                    updated_at: new Date() 
                                }
                            });
                        } else {
                            // Create new price record
                            await marketDb.token_prices.create({
                                data: {
                                    token_id: newToken.id,
                                    price: "0.00000000"
                                }
                            });
                        }
                    } catch (priceError) {
                        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error updating token_prices for ${newToken.address}:${fancyColors.RESET}`, priceError);
                    }
                    
                    // Record in price history too
                    await this.recordPriceHistory(
                        newToken.id,
                        "0.00000000",
                        "token_check"
                    );
                    addedCount++;
                } catch (error) {
                    // Skip duplicate key errors (in case tokens were added by another process)
                    if (error.message.includes('duplicate key') || error.message.includes('unique constraint')) {
                        skippedCount++;
                    } else {
                        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error adding token ${tokenAddress}:${fancyColors.RESET}`, error);
                        errorCount++;
                    }
                }
            }
            
            // Update stats
            const elapsedMs = Date.now() - startTime;
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} TOKEN ADD ${fancyColors.RESET} Added ${addedCount} new tokens in ${elapsedMs}ms (${skippedCount} skipped, ${errorCount} errors)`);
            
            // Update token count stats 
            this.marketStats.tokens.total = await marketDb.tokens.count();
            
            return addedCount > 0;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error checking for new tokens:${fancyColors.RESET}`, error);
            return false;
        }
    }
    
    /**
     * Sync all token addresses from Jupiter to our database
     * Simplified implementation focused on efficiently syncing tokens
     * without complex chunking - just basic batched processing
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
            
            // Get the token list from Jupiter
            await jupiterClient.initialize();
            const jupiterTokens = jupiterClient.tokenList;
            
            if (!jupiterTokens || jupiterTokens.length === 0) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}No tokens returned from Jupiter API${fancyColors.RESET}`);
                this.syncInProgress = false;
                return false;
            }
            
            // Log token count
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Received ${jupiterTokens.length.toLocaleString()} tokens from Jupiter`);
            
            // Get database token count for comparison
            const dbTokenCountBefore = await marketDb.tokens.count();
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Current database has ${dbTokenCountBefore.toLocaleString()} tokens`);
            
            // Use an efficient bulk operation instead of one-by-one processing
            // First, get all existing tokens
            const existingTokens = await marketDb.tokens.findMany({
                select: { address: true }
            });
            
            // Create a Set for fast lookups
            const existingAddressSet = new Set(existingTokens.map(token => token.address));
            
            // Find all tokens that need to be added
            const tokensToAdd = jupiterTokens.filter(token => 
                !existingAddressSet.has(token) && 
                token && token.length > 20
            );
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} NEW TOKENS ${fancyColors.RESET} Found ${tokensToAdd.length.toLocaleString()} new tokens to add`);
            
            // If no new tokens, we're done
            if (tokensToAdd.length === 0) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GREEN}Database is already up-to-date${fancyColors.RESET}`);
                this.syncInProgress = false;
                this.lastSyncCompleteTime = new Date();
                return true;
            }
            
            // Process tokens in batches according to Jupiter API limits
            // Jupiter allows 100 requests/sec with up to 100 tokens per request
            const BATCH_SIZE = 100; // Jupiter's max tokens per request
            const BATCH_DELAY_MS = 10; // 10ms delay = 100 requests/sec max
            const TOTAL_BATCHES = Math.ceil(tokensToAdd.length / BATCH_SIZE);
            
            // Define max batches to process per run to avoid server overload
            // With Jupiter's limit, we could process 10,000 tokens per second
            // but we'll be more conservative to limit server load
            const MAX_BATCHES_PER_RUN = 200; // Process up to 20,000 tokens per run
            const batchesToProcess = Math.min(TOTAL_BATCHES, MAX_BATCHES_PER_RUN);
            
            if (TOTAL_BATCHES > MAX_BATCHES_PER_RUN) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Processing ${batchesToProcess} batches out of ${TOTAL_BATCHES} total (limiting to prevent server overload)${fancyColors.RESET}`);
            }
            
            let addedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;
            
            // Process tokens in batches
            for (let batchIndex = 0; batchIndex < batchesToProcess; batchIndex++) {
                const batchStart = batchIndex * BATCH_SIZE;
                const batchEnd = Math.min((batchIndex + 1) * BATCH_SIZE, tokensToAdd.length);
                const batchTokens = tokensToAdd.slice(batchStart, batchEnd);
                
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Processing batch ${batchIndex + 1}/${batchesToProcess} (${batchTokens.length} tokens)`);
                
                // Prepare batch data for bulk insert
                const tokenInsertData = batchTokens.map(address => ({
                    address,
                    symbol: `UNKNOWN_${address.substring(0, 6)}`,
                    name: `Unknown Token ${address.substring(0, 6)}`,
                    created_at: new Date(),
                    color: "#888888",
                    is_active: true
                }));
                
                try {
                    // Bulk insert tokens using Prisma's createMany
                    // This is MUCH faster than individual inserts
                    // Note: Prisma will skip duplicates if using skipDuplicates option
                    const result = await marketDb.tokens.createMany({
                        data: tokenInsertData,
                        skipDuplicates: true // Skip records that would cause unique constraint violations
                    });
                    
                    addedCount += result.count;
                    
                    // Get the newly inserted tokens to create price records
                    if (result.count > 0) {
                        // Get all tokens from this batch that were successfully inserted
                        const insertedTokens = await marketDb.tokens.findMany({
                            where: {
                                address: { in: batchTokens }
                            },
                            select: {
                                id: true,
                                address: true
                            }
                        });
                        
                        // Prepare price record data for bulk insert
                        const priceRecords = insertedTokens.map(token => ({
                            token_id: token.id,
                            price: "0.00000000",
                            change_24h: "0.00"
                        }));
                        
                        // Bulk insert price records
                        if (priceRecords.length > 0) {
                            await marketDb.token_prices.createMany({
                                data: priceRecords,
                                skipDuplicates: true
                            });
                        }
                        
                        // Add price history records in bulk too
                        // Note: This is optional and could be skipped for better performance
                        const historyRecords = insertedTokens.map(token => ({
                            token_id: token.id,
                            price: "0.00000000",
                            source: "bulk_sync",
                            timestamp: new Date()
                        }));
                        
                        if (historyRecords.length > 0) {
                            await marketDb.token_price_history.createMany({
                                data: historyRecords
                            });
                        }
                    }
                    
                    // Log progress for monitoring
                    if (batchIndex % 5 === 0 || batchIndex === batchesToProcess - 1) {
                        const percentComplete = Math.floor((batchIndex + 1) / batchesToProcess * 100);
                        const elapsedSoFar = (Date.now() - startTime) / 1000;
                        const tokensPerSecond = addedCount / Math.max(1, elapsedSoFar);
                        
                        // Calculate remaining time based on current batch progress
                        const processedTokens = (batchIndex + 1) * BATCH_SIZE;
                        const remainingTokens = Math.min(tokensToAdd.length, batchesToProcess * BATCH_SIZE) - processedTokens;
                        const estimatedRemaining = remainingTokens / Math.max(1, tokensPerSecond);
                        
                        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Progress: ${percentComplete}% - Added ${addedCount} tokens (${tokensPerSecond.toFixed(1)}/sec, ~${Math.floor(estimatedRemaining)}s remaining)${fancyColors.RESET}`);
                    }
                } catch (error) {
                    logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error in batch ${batchIndex + 1}:${fancyColors.RESET}`, error);
                    errorCount++;
                }
                
                // Brief delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
            
            // Get final token count
            const dbTokenCountAfter = await marketDb.tokens.count();
            const actualDifference = dbTokenCountAfter - dbTokenCountBefore;
            
            // Calculate performance stats
            const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
            const tokensPerSecond = (addedCount / Math.max(1, elapsedSeconds)).toFixed(1);
            
            // Update completion status
            this.syncInProgress = false;
            this.lastSyncCompleteTime = new Date();
            this.marketStats.tokens.total = dbTokenCountAfter;
            
            // Record sync statistics
            this.lastSyncStats = {
                addedCount,
                skippedCount,
                errorCount,
                elapsedSeconds,
                tokensPerSecond,
                dbTokenCountBefore,
                dbTokenCountAfter,
                completedAt: this.lastSyncCompleteTime,
                batchesProcessed: batchesToProcess,
                totalBatches: TOTAL_BATCHES
            };
            
            // Are there more batches to process?
            const remainingBatches = TOTAL_BATCHES - batchesToProcess;
            
            if (remainingBatches > 0) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SYNC PARTIAL ${fancyColors.RESET} Processed ${batchesToProcess} of ${TOTAL_BATCHES} batches. ${remainingBatches} batches (${remainingBatches * BATCH_SIZE} tokens) remaining for next run.`);
            }
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SYNC COMPLETE ${fancyColors.RESET} Added ${addedCount} tokens (${tokensPerSecond}/sec) in ${elapsedSeconds}s. Database now has ${dbTokenCountAfter.toLocaleString()} tokens (+${actualDifference})`);
            
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
     * @returns {Promise<boolean>} True if server is under high load
     */
    async checkServerLoad() {
        try {
            // Get current system metrics
            const memoryUsage = process.memoryUsage();
            const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
            
            // Check if memory usage is high (>85%)
            const isMemoryHigh = memoryUsagePercent > 85;
            
            // Check if we have a lot of active tasks
            const hasManyTasks = this.syncInProgress || 
                (serviceManager && serviceManager.activeTasks > 5);
            
            // Server is busy if memory is high or we have many tasks
            return isMemoryHigh || hasManyTasks;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error checking server load: ${error.message}${fancyColors.RESET}`);
            return false; // Default to not busy if check fails
        }
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
                
                // Update service heartbeat with updated stats
                serviceManager.updateServiceHeartbeat(
                    this.name,
                    this.config,
                    this.stats
                );
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
                
                // Update service heartbeat with error status
                serviceManager.updateServiceHeartbeat(
                    this.name,
                    this.config,
                    this.stats
                );
                
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
                await serviceManager.updateServiceHeartbeat(
                    this.name,
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
            
            // Direct database query
            const tokens = await marketDb.tokens.findMany({
                include: {
                    token_socials: true,
                    token_websites: true,
                    token_prices: true
                }
            });
            
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
            
            // Direct database query
            const token = await marketDb.tokens.findFirst({
                where: { symbol },
                include: {
                    token_socials: true,
                    token_websites: true
                }
            });

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
            
            // Direct database query
            const token = await marketDb.tokens.findFirst({
                where: { address },
                include: {
                    token_socials: true,
                    token_websites: true
                }
            });

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
            
            // Update token prices in the market database
            for (const [mintAddress, priceInfo] of Object.entries(priceData)) {
                try {
                    // Find the token in the database
                    const token = await marketDb.tokens.findFirst({
                        where: { address: mintAddress }
                    });
                    
                    if (token) {
                        // Get the new price
                        const newPrice = priceInfo.price?.toString();
                        
                        // Update the token price
                        await marketDb.tokens.update({
                            where: { id: token.id },
                            data: {
                                price: newPrice || token.price,
                                change_24h: priceInfo.priceChange24h ? priceInfo.priceChange24h.toString() : token.change_24h,
                                updated_at: new Date()
                            }
                        });
                        
                        // Always record price history regardless of whether it changed
                        // This gives us valuable data about price stability over time
                        if (newPrice) {
                            await this.recordPriceHistory(
                                token.id, 
                                newPrice, 
                                'manual_update'
                            );
                        }
                    }
                } catch (updateError) {
                    logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error updating token price for ${mintAddress}:${fancyColors.RESET}`, updateError);
                }
            }
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
        try {
            if (!priceHistoryRecords || !Array.isArray(priceHistoryRecords) || priceHistoryRecords.length === 0) {
                return false;
            }
            
            // Prepare data for bulk insert
            const dataToInsert = priceHistoryRecords.map(record => ({
                token_id: record.tokenId,
                price: record.price,
                source: record.source || 'system',
                timestamp: new Date()
            }));
            
            // Use createMany to insert all records in a single database operation
            await marketDb.token_price_history.createMany({
                data: dataToInsert
            });
            
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded ${dataToInsert.length} price history records in batch`);
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error batch recording price history:${fancyColors.RESET}`, error);
            return false;
        }
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
            
            // Check for new tokens is disabled by configuration
            // CHECK_NEW_TOKENS_EVERY_UPDATE = false
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Processing ${tokenList.length} tokens from Jupiter API`);
            
            // Get current tokens from the market database for comparison
            const existingTokens = await marketDb.tokens.findMany({
                select: {
                    id: true,
                    address: true,
                    symbol: true
                }
            });
            
            // Create a map of existing tokens by address for faster lookup
            const existingTokenMap = existingTokens.reduce((map, token) => {
                map[token.address] = token;
                return map;
            }, {});
            
            // Process the tokens from Jupiter
            let newTokensCount = 0;
            let updatedTokensCount = 0;
            let processedCount = 0;
            
            // Process tokens in batches - Jupiter has over 540,000 tokens!
            // Sort tokens by various relevance metrics
            const sortedTokens = [...tokenList].sort((a, b) => {
                // First priority: Daily volume (if available)
                const aVolume = a.daily_volume ? parseFloat(a.daily_volume) : 0;
                const bVolume = b.daily_volume ? parseFloat(b.daily_volume) : 0;
                
                if (aVolume && bVolume && aVolume !== bVolume) {
                    return bVolume - aVolume; // Higher volume first
                }
                
                // Second priority: Market cap (from price API data, if available)
                const aMarketCap = a.marketCap ? parseFloat(a.marketCap) : 0;
                const bMarketCap = b.marketCap ? parseFloat(b.marketCap) : 0;
                
                if (aMarketCap && bMarketCap && aMarketCap !== bMarketCap) {
                    return bMarketCap - aMarketCap; // Higher market cap first
                }
                
                // Third priority: Price (from price API data, if available)
                const aPrice = a.price ? parseFloat(a.price) : 0;
                const bPrice = b.price ? parseFloat(b.price) : 0;
                
                if (aPrice && bPrice && aPrice !== bPrice) {
                    return bPrice - aPrice; // Higher price first
                }
                
                // Fourth priority: Having a logo/image
                const aHasImage = a.logoURI ? 1 : 0;
                const bHasImage = b.logoURI ? 1 : 0;
                if (aHasImage !== bHasImage) {
                    return bHasImage - aHasImage; // Tokens with images first
                }
                
                // Fifth priority: Token tags (prefer tokens with tags)
                const aHasTags = a.tags && a.tags.length > 0 ? 1 : 0;
                const bHasTags = b.tags && b.tags.length > 0 ? 1 : 0;
                if (aHasTags !== bHasTags) {
                    return bHasTags - aHasTags; // Tokens with tags first
                }
                
                // Last resort: Sort by symbol
                return a.symbol?.localeCompare(b.symbol || '') || 0;
            });
            
            // Take only the top tokens after sorting
            const tokenSubset = sortedTokens.slice(0, MAX_TOKENS_TO_PROCESS);
            
            // Track entrances, exits, and rank changes from the top token list
            if (!this.previousTokenRanks) {
                // First run - initialize the tracking with position information
                this.previousTokenRanks = new Map();
                
                // Initialize with current addresses and their positions
                tokenSubset.forEach((token, index) => {
                    const address = typeof token === 'string' ? 
                        token.replace(/^["']+|["']+$/g, '').replace(/\\"/g, '') : 
                        token.address;
                    
                    // Store the token's position and symbol for comparison
                    const symbol = typeof token === 'string' ? 
                        address.substring(0, 8) : 
                        token.symbol || address.substring(0, 8);
                        
                    this.previousTokenRanks.set(address, {
                        position: index + 1, // 1-based position
                        symbol: symbol
                    });
                });
                
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Initialized token rank tracking with ${this.previousTokenRanks.size} tokens${fancyColors.RESET}`);
            } else {
                // Build the current token ranking map
                const currentTokenRanks = new Map();
                tokenSubset.forEach((token, index) => {
                    const address = typeof token === 'string' ? 
                        token.replace(/^["']+|["']+$/g, '').replace(/\\"/g, '') : 
                        token.address;
                    
                    const symbol = typeof token === 'string' ? 
                        address.substring(0, 8) : 
                        token.symbol || address.substring(0, 8);
                        
                    currentTokenRanks.set(address, {
                        position: index + 1, // 1-based position
                        symbol: symbol
                    });
                });
                
                // Create sets for easier entrance/exit detection
                const currentTopAddresses = new Set(currentTokenRanks.keys());
                const previousTopAddresses = new Set(this.previousTokenRanks.keys());
                
                // Find new tokens that weren't in the previous list (entrances)
                const entrances = [];
                currentTopAddresses.forEach(address => {
                    if (!previousTopAddresses.has(address)) {
                        // Find the token in the current list for additional info
                        const token = tokenSubset.find(t => 
                            (typeof t === 'string' ? 
                                t.replace(/^["']+|["']+$/g, '').replace(/\\"/g, '') : 
                                t.address) === address
                        );
                        
                        const symbol = typeof token === 'string' ? 
                            address.substring(0, 8) : 
                            token.symbol || address.substring(0, 8);
                            
                        entrances.push({ address, symbol });
                    }
                });
                
                // Find tokens that were in the previous list but aren't anymore (exits)
                const exits = [];
                previousTopAddresses.forEach(address => {
                    if (!currentTopAddresses.has(address)) {
                        // Get previous information for this token
                        const tokenInfo = this.previousTokenRanks.get(address);
                        const prevRank = tokenInfo?.position || 0;
                        const symbol = tokenInfo?.symbol || address.substring(0, 8);
                        
                        exits.push({ 
                            address, 
                            symbol,
                            prevRank
                        });
                    }
                });
                
                // Log entrances and exits
                if (entrances.length > 0) {
                    const entranceSymbols = entrances.map(e => e.symbol).slice(0, 5);
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} NEW ARRIVALS ${fancyColors.RESET} ${entrances.length} tokens entered top ${MAX_TOKENS_TO_PROCESS}: ${entranceSymbols.join(', ')}${entrances.length > 5 ? '...' : ''}`);
                    
                    // Log each entrance individually with more details if we have few of them
                    if (entrances.length <= 5) {
                        entrances.forEach(entrance => {
                            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GREEN}NEW LIST ENTRY:${fancyColors.RESET} ${entrance.symbol} (${entrance.address.substring(0, 8)}...)`);
                        });
                    }
                }
                
                if (exits.length > 0) {
                    const exitSymbols = exits.map(e => e.symbol).slice(0, 5);
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} DROPPED OUT ${fancyColors.RESET} ${exits.length} tokens exited top ${MAX_TOKENS_TO_PROCESS}: ${exitSymbols.join(', ')}${exits.length > 5 ? '...' : ''}`);
                    
                    // Log each exit individually with more details if we have few of them
                    if (exits.length <= 5) {
                        exits.forEach(exit => {
                            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}DROPPED FROM LIST:${fancyColors.RESET} ${exit.symbol} (${exit.address.substring(0, 8)}...)`);
                        });
                    }
                }
                
                // Calculate position changes for tokens that stayed in the list
                const rankChanges = [];
                
                // Record the current token ranks for historical tracking
                this.recordTokenRanks(tokenSubset, currentTokenRanks);
                
                currentTopAddresses.forEach(address => {
                    if (previousTopAddresses.has(address)) {
                        // Get previous and current positions
                        const prevInfo = this.previousTokenRanks.get(address);
                        const currInfo = currentTokenRanks.get(address);
                        
                        if (prevInfo && currInfo) {
                            // -------------------------------------------------------------------------
                            // TOKEN HOTNESS GRADING METHODOLOGY
                            // -------------------------------------------------------------------------
                            // This comprehensive approach combines several factors to identify truly
                            // significant token movements, with special emphasis on the top 50 ranks.
                            // The system uses both rank changes and volume data for a complete picture.
                            // -------------------------------------------------------------------------
                            
                            // 1. Basic rank change (raw positions moved)
                            const change = prevInfo.position - currInfo.position; // Positive = improved
                            
                            // 2. Calculate percentage change relative to previous position
                            // (Moving from 50→25 is 50% improvement, from 900→800 is only 11%)
                            const percentChange = Math.abs(change / prevInfo.position) * 100;
                            
                            // 3. Logarithmic rank importance 
                            // This makes movements in top ranks dramatically more important
                            // We use log10(max_rank/current_rank + 1) which creates a curve where:
                            // - Rank 1 is ~3x more important than rank 50
                            // - Rank 1 is ~6x more important than rank 1000
                            const logRankWeight = Math.log10(MAX_TOKENS_TO_PROCESS / currInfo.position + 1) * 3;
                            
                            // 4. Calculate weighted significance score 
                            const weightedScore = percentChange * logRankWeight;
                            
                            // 5. Volume component - if available
                            // Get volume data for this token from current and previous data
                            // Current volume comes from the collected data
                            let volumeGrowth = null;
                            let volumeGrowthCategory = 'unknown'; // 'rising', 'falling', 'stable', 'unknown'
                            
                            // Calculate volume growth if we have the data
                            if (this._batchVolumeChanges) {
                                // Find current volume data
                                const volumeData = this._batchVolumeChanges.find(v => v.address === address);
                                if (volumeData && volumeData.volume) {
                                    // We have current volume, compare with previous if available
                                    const currentVolume = parseFloat(volumeData.volume);
                                    
                                    // Store with the entry for future comparison
                                    currInfo.volume = currentVolume;
                                    
                                    // Check if we had previous volume data
                                    if (prevInfo.volume) {
                                        // Calculate volume growth percentage
                                        volumeGrowth = ((currentVolume / prevInfo.volume) - 1) * 100;
                                        
                                        // Categorize volume change with some tolerance for minor fluctuations
                                        if (volumeGrowth > 10) {
                                            volumeGrowthCategory = 'rising';
                                        } else if (volumeGrowth < -10) {
                                            volumeGrowthCategory = 'falling';
                                        } else {
                                            volumeGrowthCategory = 'stable';
                                        }
                                    }
                                }
                            }
                            
                            // 6. Calculate final hotness score
                            // Base: Weighted rank change
                            // Bonus: Volume growth (if applicable)
                            let hotnessScore = weightedScore;
                            
                            // Add volume growth bonus if available
                            if (volumeGrowth !== null && volumeGrowth > 0) {
                                // Volume growth can boost the score
                                // We apply a modest multiplier for normal cases
                                // And a stronger multiplier for dramatic volume growth
                                const volumeBoost = volumeGrowth > 100 ? 1.5 : // >100% growth = 1.5x boost
                                                  volumeGrowth > 50 ? 1.3 :   // >50% growth = 1.3x boost
                                                  volumeGrowth > 20 ? 1.2 :   // >20% growth = 1.2x boost
                                                  1.1;                        // All other positive growth
                                
                                hotnessScore *= volumeBoost;
                            }
                            
                            // 7. Determine if this change is significant enough to track
                            // Multiple factors make a significant change:
                            // - Raw movement (10+ positions)
                            // - Weighted score (15+ for normal tokens)
                            // - Any movement in top 50 ranks (even small changes matter)
                            // - Volume growth combined with positive rank change
                            const isRawSignificant = Math.abs(change) >= 10;
                            const isWeightedSignificant = weightedScore >= 15;
                            const isTopRank = currInfo.position <= 50; // Special emphasis on top 50
                            const isVolumeIncreasing = volumeGrowthCategory === 'rising';
                            
                            // For top ranks, we apply lower thresholds
                            const isSignificantForTopRank = isTopRank && (Math.abs(change) >= 3 || weightedScore >= 5);
                            
                            // Track if token is "hot" (positive rank change + volume growth)
                            const isHot = change > 0 && isVolumeIncreasing;
                            
                            // Determine if this token movement should be tracked
                            if (isRawSignificant || isWeightedSignificant || isSignificantForTopRank || isHot) {
                                rankChanges.push({
                                    address,
                                    symbol: currInfo.symbol,
                                    prevRank: prevInfo.position,
                                    currentRank: currInfo.position,
                                    change,
                                    percentChange: percentChange.toFixed(1),
                                    weightedScore: weightedScore.toFixed(1),
                                    volumeGrowth: volumeGrowth !== null ? volumeGrowth.toFixed(1) : null,
                                    volumeGrowthCategory,
                                    hotnessScore: hotnessScore.toFixed(1),
                                    isTopRank,
                                    isHot
                                });
                            }
                        }
                    }
                });
                
                // Sort by hotness score (most significant first)
                rankChanges.sort((a, b) => parseFloat(b.hotnessScore) - parseFloat(a.hotnessScore));
                
                // Extract hot tokens (those with positive rank change + volume growth)
                const hotTokens = rankChanges.filter(item => item.isHot).slice(0, 5);
                
                // For remaining tokens, split into risers and droppers by raw change
                const otherTokens = rankChanges.filter(item => !item.isHot);
                const risers = otherTokens.filter(item => item.change > 0)
                    .sort((a, b) => parseFloat(b.hotnessScore) - parseFloat(a.hotnessScore))
                    .slice(0, 5);
                const droppers = otherTokens.filter(item => item.change < 0)
                    .sort((a, b) => parseFloat(a.hotnessScore) - parseFloat(b.hotnessScore))
                    .slice(0, 5);
                
                // Log HOT tokens (highest priority - both rising in rank and volume)
                if (hotTokens && hotTokens.length > 0) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_MAGENTA}${fancyColors.WHITE} HOT TOKENS ${fancyColors.RESET} Rising in both rank and volume:`);
                    
                    try {
                        hotTokens.forEach(token => {
                            if (!token) return; // Skip invalid tokens
                            
                            // Format nicely with hotness score info
                            const volInfo = token.volumeGrowth ? ` | Vol +${token.volumeGrowth}%` : '';
                            const scoreInfo = ` | Score: ${token.hotnessScore || 'N/A'}`;
                            const rankInfo = token.isTopRank ? ` [TOP ${token.currentRank}]` : '';
                            const symbol = token.symbol || 'UNKNOWN';
                            const prevRank = token.prevRank || 0;
                            const currentRank = token.currentRank || 0;
                            const change = token.change || 0;
                            
                            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.MAGENTA}HOT TOKEN:${fancyColors.RESET} ${symbol}${rankInfo} | Rank ${prevRank} → ${currentRank} (+${change})${volInfo}${scoreInfo}`);
                        });
                    } catch (error) {
                        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing hot tokens:${fancyColors.RESET}`, error);
                    }
                }
                
                // Log top risers (tokens rising in rank but not marked as HOT)
                if (risers && risers.length > 0) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Top rank climbers:${fancyColors.RESET}`);
                    
                    try {
                        risers.forEach(riser => {
                            if (!riser) return; // Skip invalid risers
                            
                            // Add top rank flag if in top 50
                            const rankInfo = riser.isTopRank ? ` [TOP ${riser.currentRank}]` : '';
                            // Include hotness score for context
                            const scoreInfo = ` | Score: ${riser.hotnessScore || 'N/A'}`;
                            const symbol = riser.symbol || 'UNKNOWN';
                            const prevRank = riser.prevRank || 0;
                            const currentRank = riser.currentRank || 0;
                            const change = riser.change || 0;
                            
                            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GREEN}RANK UP ${change} spots:${fancyColors.RESET} ${symbol}${rankInfo} moved ${prevRank} → ${currentRank}${scoreInfo}`);
                        });
                    } catch (error) {
                        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing rank risers:${fancyColors.RESET}`, error);
                    }
                }
                
                // Log top droppers (tokens falling in rank)
                if (droppers && droppers.length > 0) {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Largest rank drops:${fancyColors.RESET}`);
                    
                    try {
                        droppers.forEach(dropper => {
                            if (!dropper) return; // Skip invalid droppers
                            
                            // Add top rank flag if in top 50
                            const rankInfo = dropper.isTopRank ? ` [TOP ${dropper.currentRank}]` : '';
                            // Include hotness score for context
                            const scoreInfo = ` | Score: ${dropper.hotnessScore || 'N/A'}`;
                            const symbol = dropper.symbol || 'UNKNOWN';
                            const prevRank = dropper.prevRank || 0;
                            const currentRank = dropper.currentRank || 0;
                            const change = dropper.change || 0;
                            
                            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}RANK DOWN ${Math.abs(change)} spots:${fancyColors.RESET} ${symbol}${rankInfo} moved ${prevRank} → ${currentRank}${scoreInfo}`);
                        });
                    } catch (error) {
                        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing rank droppers:${fancyColors.RESET}`, error);
                    }
                }
                
                // Update previous list for next comparison
                this.previousTokenRanks = currentTokenRanks;
            }
            
            // Log sorting results
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Sorted ${tokenList.length} tokens by volume/relevance, processing top ${tokenSubset.length}`);
            
            // Use Jupiter's max supported batch size
            // Jupiter API has a limit of 100 tokens per request
            const batchSize = MAX_TOKENS_PER_BATCH; // Jupiter API limit per request
            const totalBatches = Math.ceil(tokenSubset.length / batchSize);
            
            for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                const batchStart = batchIndex * batchSize;
                const batchEnd = Math.min(batchStart + batchSize, tokenSubset.length);
                const batchTokens = tokenSubset.slice(batchStart, batchEnd);
                
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Processing batch ${batchIndex + 1}/${totalBatches} (${batchTokens.length} tokens)`);
                
                // Add a small delay between batches to avoid hitting rate limits
                if (batchIndex > 0 && batchIndex % 5 === 0) {
                    // Every 5 batches = ~500 tokens, add a small pause
                    const pauseTime = 300; // 300ms pause
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Rate limit protection: Pausing for ${pauseTime}ms${fancyColors.RESET}`);
                    await new Promise(resolve => setTimeout(resolve, pauseTime));
                }
                
                // Get token addresses for the batch
                const tokenAddresses = batchTokens
                    .map(token => {
                        // Handle both object and string tokens
                        if (typeof token === 'string') {
                            return token.replace(/^["']+|["']+$/g, '').replace(/\\"/g, '');
                        }
                        return token.address;
                    })
                    .filter(address => address !== null && address !== undefined);
                
                // Get metadata from Helius for this batch
                let tokenMetadata = [];
                try {
                    tokenMetadata = await heliusClient.getTokensMetadata(tokenAddresses);
                } catch (error) {
                    logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error fetching token metadata from Helius:${fancyColors.RESET}`, error);
                }
                
                // Create a map of metadata by mint address
                const metadataMap = tokenMetadata.reduce((map, metadata) => {
                    map[metadata.mint] = metadata;
                    return map;
                }, {});
                
                // Get prices from Jupiter for this batch
                let tokenPrices = {};
                try {
                    tokenPrices = await jupiterClient.getPrices(tokenAddresses);
                } catch (error) {
                    logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error fetching token prices from Jupiter:${fancyColors.RESET}`, error);
                }
                
                // OPTIMIZED DB OPERATIONS: Prepare batch arrays to reduce database connections
                const tokenUpdates = []; // Existing tokens to update
                const tokenCreates = []; // New tokens to create
                const priceUpdates = []; // Price records to update or create
                const historyRecords = []; // Price history records to create
                const websiteUpdates = []; // Website updates for each token 
                const socialUpdates = []; // Social media updates for each token
                
                // First pass: Prepare all data without DB operations
                for (const token of batchTokens) {
                    try {
                        processedCount++;
                        
                        // If the token is a string (which happens with some pump tokens), convert to an object
                        let processedToken = token;
                        if (typeof token === 'string') {
                            // Remove surrounding quotes if present
                            const cleanedAddress = token.replace(/^["']+|["']+$/g, '').replace(/\\"/g, '');
                            processedToken = { address: cleanedAddress };
                        }
                        
                        // Clean and validate the token address
                        const cleanedAddress = this.cleanTokenAddress(processedToken.address);
                        
                        // Skip tokens with missing or invalid addresses
                        if (!cleanedAddress) {
                            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Skipping token - invalid address format${fancyColors.RESET}`, {
                                original_token: processedToken
                            });
                            continue;
                        }
                        
                        // Update token address with cleaned version
                        processedToken.address = cleanedAddress;
                        
                        // Get metadata and price info for this token
                        const metadata = metadataMap[cleanedAddress] || {};
                        const priceInfo = tokenPrices[cleanedAddress] || {};
                        
                        // Add validation function to handle string field lengths
                        const validateStringLength = (str, maxLength, defaultValue = '') => {
                            if (!str) return defaultValue;
                            return str.toString().substring(0, maxLength);
                        };
                        
                        // Prepare token data with validated length fields
                        const tokenData = {
                            address: cleanedAddress,
                            symbol: validateStringLength(processedToken.symbol || metadata.symbol || '', 20), // Limit symbol to 20 chars
                            name: validateStringLength(processedToken.name || metadata.name || '', 100),      // Limit name to 100 chars
                            decimals: processedToken.decimals || metadata.decimals || 9,
                            is_active: true,
                            image_url: validateStringLength(metadata.logoURI || metadata.uri || processedToken.logoURI || null, 255),
                            // Include tags from Jupiter API (important for token categorization)
                            tags: processedToken.tags || null,
                            updated_at: new Date()
                        };
                        
                        // Prepare price data
                        const priceData = {
                            price: priceInfo.price ? priceInfo.price.toString() : null,
                            change_24h: priceInfo.priceChange24h ? priceInfo.priceChange24h.toString() : null,
                            market_cap: priceInfo.marketCap ? priceInfo.marketCap.toString() : null,
                            volume_24h: priceInfo.volume24h ? priceInfo.volume24h.toString() : null,
                            liquidity: priceInfo.liquidity ? priceInfo.liquidity.toString() : null,
                            fdv: priceInfo.fdv ? priceInfo.fdv.toString() : null,
                            updated_at: new Date()
                        };
                        
                        // Add process information to the appropriate batch arrays
                        if (existingTokenMap[cleanedAddress]) {
                            // Existing token - update token and price data
                            const tokenId = existingTokenMap[cleanedAddress].id;
                            
                            // Add to token updates array
                            tokenUpdates.push({
                                id: tokenId,
                                data: tokenData
                            });
                            
                            // Add to price updates array if we have price data
                            if (priceInfo.price) {
                                priceUpdates.push({
                                    tokenId,
                                    priceData
                                });
                                
                                // Add to history records array
                                historyRecords.push({
                                    token_id: tokenId,
                                    price: priceInfo.price.toString(),
                                    source: 'jupiter_api',
                                    timestamp: new Date()
                                });
                            }
                            
                            // Process websites and socials
                            if (metadata.extensions) {
                                // Add websites
                                if (metadata.extensions.website) {
                                    websiteUpdates.push({
                                        tokenId,
                                        label: 'Website',
                                        url: validateStringLength(metadata.extensions.website, 255)
                                    });
                                }
                                
                                // Add socials
                                const socialMap = {
                                    twitter: metadata.extensions.twitter,
                                    discord: metadata.extensions.discord,
                                    telegram: metadata.extensions.telegram
                                };
                                
                                for (const [type, url] of Object.entries(socialMap)) {
                                    if (url) {
                                        socialUpdates.push({
                                            tokenId,
                                            type,
                                            url: validateStringLength(url, 255)
                                        });
                                    }
                                }
                            }
                            
                            updatedTokensCount++;
                        } else {
                            // New token - check if address is present
                            if (!tokenData.address) {
                                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Skipping token creation - address missing${fancyColors.RESET}`, {
                                    token_data: tokenData,
                                    original_token: processedToken
                                });
                                continue;
                            }
                            
                            // Add to tokens create array with price and social media data
                            tokenCreates.push({
                                tokenData: {
                                    ...tokenData,
                                    created_at: new Date()
                                },
                                priceData: priceInfo.price ? priceData : null,
                                websiteData: metadata.extensions?.website ? {
                                    label: 'Website',
                                    url: validateStringLength(metadata.extensions.website, 255)
                                } : null,
                                socialData: metadata.extensions ? {
                                    twitter: metadata.extensions.twitter,
                                    discord: metadata.extensions.discord,
                                    telegram: metadata.extensions.telegram
                                } : null
                            });
                            
                            newTokensCount++;
                        }
                        // Track significant price changes for logging while we have priceInfo in scope
                        if (priceInfo && priceInfo.price && priceInfo.priceChange24h) {
                            // Store all price changes for dynamic significance calculation
                            const priceChange = parseFloat(priceInfo.priceChange24h);
                            
                            // Only track valid price changes
                            if (!isNaN(priceChange)) {
                                // Add to batch collection for dynamic significance calculation
                                if (!this._batchPriceChanges) {
                                    this._batchPriceChanges = [];
                                }
                                
                                // Track both price and volume changes
                                this._batchPriceChanges.push({
                                    symbol: processedToken.symbol || metadata.symbol || cleanedAddress.substring(0, 8),
                                    price: priceInfo.price,
                                    change: priceChange,
                                    volume: priceInfo.volume24h || 0,
                                    address: cleanedAddress
                                });
                                
                                // Also track volume changes separately if available
                                if (priceInfo.volume24h) {
                                    // Create volume change tracking if not exists
                                    if (!this._batchVolumeChanges) {
                                        this._batchVolumeChanges = [];
                                    }
                                    
                                    // Calculate volume change if previous data exists in the token map
                                    const tokenId = existingTokenMap[cleanedAddress]?.id;
                                    if (tokenId) {
                                        this._batchVolumeChanges.push({
                                            symbol: processedToken.symbol || metadata.symbol || cleanedAddress.substring(0, 8),
                                            volume: priceInfo.volume24h,
                                            price: priceInfo.price,
                                            address: cleanedAddress
                                        });
                                    }
                                }
                            }
                        }
                    } catch (tokenError) {
                        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing token data:${fancyColors.RESET}`, tokenError);
                    }
                    
                    // Log progress every 10 tokens processed (for data preparation)
                    if (processedCount % 10 === 0) {
                        const progressPercent = Math.round((processedCount / tokenSubset.length) * 100);
                        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Data preparation progress: ${progressPercent}% (${processedCount}/${tokenSubset.length})`);
                    }
                }

                // Log prepared batch operations
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Prepared batch operations: ${tokenUpdates.length} updates, ${tokenCreates.length} new tokens, ${priceUpdates.length} price updates, ${historyRecords.length} history records${fancyColors.RESET}`);
                
                // Process the collected price changes to find statistically significant ones
                if (this._batchPriceChanges && this._batchPriceChanges.length > 0) {
                    try {
                        // Calculate statistics for dynamic significance threshold
                        const changes = this._batchPriceChanges.map(item => Math.abs(item.change)).filter(val => !isNaN(val));
                        
                        if (changes.length > 10) {  // Only calculate if we have enough data points
                            // Calculate mean and standard deviation
                            const sum = changes.reduce((a, b) => a + b, 0);
                            const mean = sum / changes.length;
                            
                            // Standard deviation calculation
                            const squareDiffs = changes.map(value => {
                                const diff = value - mean;
                                return diff * diff;
                            });
                            const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
                            const stdDev = Math.sqrt(avgSquareDiff);
                            
                            // Dynamic threshold: mean + 2 standard deviations (covers ~95% of normal distribution)
                            const significanceThreshold = mean + (2 * stdDev);
                            
                            // Find and log significant changes based on this batch's statistics
                            const significantChanges = this._batchPriceChanges
                                .filter(item => Math.abs(item.change) > significanceThreshold)
                                .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
                                .slice(0, 5);  // Top 5 most significant
                                
                            if (significantChanges.length > 0) {
                                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Found ${significantChanges.length} statistically significant price changes (threshold: ${significanceThreshold.toFixed(2)}%)${fancyColors.RESET}`);
                                
                                // Log each significant change
                                significantChanges.forEach(item => {
                                    const color = item.change > 0 ? fancyColors.GREEN : fancyColors.RED;
                                    const direction = item.change > 0 ? 'UP' : 'DOWN';
                                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${color}PRICE ${direction} ${Math.abs(item.change).toFixed(2)}%:${fancyColors.RESET} ${item.symbol} at ${item.price}`);
                                });
                            }
                        }
                    } catch (statsError) {
                        // Silently handle statistical calculation errors
                        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Error calculating price significance: ${statsError.message}`);
                    }
                    
                    // Reset for next batch
                    this._batchPriceChanges = [];
                }
                
                // Process volume statistics separately
                if (this._batchVolumeChanges && this._batchVolumeChanges.length > 0) {
                    try {
                        // Filter out undefined or zero volumes
                        const validVolumes = this._batchVolumeChanges
                            .filter(item => item.volume && parseFloat(item.volume) > 0)
                            .map(item => ({
                                ...item,
                                volumeValue: parseFloat(item.volume)
                            }));
                            
                        if (validVolumes.length > 10) {  // Only calculate if we have enough data points
                            // Sort by volume to find highest volume tokens
                            const highVolumeTokens = [...validVolumes]
                                .sort((a, b) => b.volumeValue - a.volumeValue)
                                .slice(0, 3);  // Top 3 highest volume
                            
                            // Log highest volume tokens
                            if (highVolumeTokens.length > 0) {
                                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Top trading volume tokens:${fancyColors.RESET}`);
                                
                                highVolumeTokens.forEach((item, index) => {
                                    const formattedVolume = item.volumeValue > 1000000 
                                        ? `$${(item.volumeValue/1000000).toFixed(2)}M`
                                        : item.volumeValue > 1000
                                            ? `$${(item.volumeValue/1000).toFixed(2)}K` 
                                            : `$${item.volumeValue.toFixed(2)}`;
                                    
                                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BLUE}VOLUME #${index+1}:${fancyColors.RESET} ${item.symbol} with ${fancyColors.BLUE}${formattedVolume}${fancyColors.RESET} at price ${item.price}`);
                                });
                            }
                            
                            // Calculate log-normalized volumes for better statistical analysis
                            // (Volumes are often log-normally distributed with extreme outliers)
                            const logVolumes = validVolumes.map(item => Math.log10(Math.max(1, item.volumeValue)));
                            
                            // Calculate mean and standard deviation of log volumes
                            const sum = logVolumes.reduce((a, b) => a + b, 0);
                            const mean = sum / logVolumes.length;
                            
                            const squareDiffs = logVolumes.map(value => {
                                const diff = value - mean;
                                return diff * diff;
                            });
                            const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
                            const stdDev = Math.sqrt(avgSquareDiff);
                            
                            // Identify unusually high volume (log scale): > mean + 2.5*stdDev
                            // Using 2.5 instead of 2.0 to be more selective for volume spikes
                            const significanceThreshold = mean + (2.5 * stdDev);
                            
                            // Find tokens with statistically significant high volume
                            const spikeTokens = validVolumes
                                .filter(item => Math.log10(Math.max(1, item.volumeValue)) > significanceThreshold)
                                .sort((a, b) => b.volumeValue - a.volumeValue);
                                
                            // Log tokens with volume spikes (excluding those already in top 3)
                            const highVolumeAddresses = new Set(highVolumeTokens.map(t => t.address));
                            const uniqueSpikeTokens = spikeTokens.filter(t => !highVolumeAddresses.has(t.address));
                            
                            if (uniqueSpikeTokens.length > 0) {
                                const logThreshold = Math.pow(10, significanceThreshold).toFixed(0);
                                const formattedThreshold = parseInt(logThreshold) > 1000000 
                                    ? `$${(parseInt(logThreshold)/1000000).toFixed(2)}M`
                                    : parseInt(logThreshold) > 1000
                                        ? `$${(parseInt(logThreshold)/1000).toFixed(2)}K` 
                                        : `$${logThreshold}`;
                                
                                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Detected ${uniqueSpikeTokens.length} unusual volume spikes (threshold: ~${formattedThreshold})${fancyColors.RESET}`);
                                
                                uniqueSpikeTokens.slice(0, 3).forEach(item => {
                                    const formattedVolume = item.volumeValue > 1000000 
                                        ? `$${(item.volumeValue/1000000).toFixed(2)}M`
                                        : item.volumeValue > 1000
                                            ? `$${(item.volumeValue/1000).toFixed(2)}K` 
                                            : `$${item.volumeValue.toFixed(2)}`;
                                    
                                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.MAGENTA}VOLUME SPIKE:${fancyColors.RESET} ${item.symbol} with ${fancyColors.MAGENTA}${formattedVolume}${fancyColors.RESET} at price ${item.price}`);
                                });
                            }
                        }
                    } catch (volumeStatsError) {
                        // Silently handle statistical calculation errors
                        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Error calculating volume statistics: ${volumeStatsError.message}`);
                    }
                    
                    // Reset for next batch
                    this._batchVolumeChanges = [];
                }
                
                // Now process the batch DB operations sequentially to minimize DB connections
                
                // 1. Process token updates in a single transaction if there are any
                if (tokenUpdates.length > 0) {
                    await marketDb.$transaction(async (tx) => {
                        for (const update of tokenUpdates) {
                            await tx.tokens.update({
                                where: { id: update.id },
                                data: update.data
                            });
                        }
                        
                        // Get token symbols for logging context
                        const updatedTokenSymbols = tokenUpdates.map(update => 
                            existingTokenMap[update.data.address]?.symbol || update.data.symbol || update.data.address.substring(0, 8)
                        ).slice(0, 5);
                        
                        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Completed ${tokenUpdates.length} token updates (examples: ${updatedTokenSymbols.join(', ')}${tokenUpdates.length > 5 ? '...' : ''})`);
                    });
                }
                
                // 2. Process token creations in batches of 50 to limit connection time
                const TOKEN_CREATE_BATCH_SIZE = 50;
                for (let i = 0; i < tokenCreates.length; i += TOKEN_CREATE_BATCH_SIZE) {
                    const createBatch = tokenCreates.slice(i, i + TOKEN_CREATE_BATCH_SIZE);
                    
                    // Process each token in its own transaction
                    for (const create of createBatch) {
                        try {
                            // Use individual transaction for each token to prevent transaction aborts from affecting other tokens
                            await marketDb.$transaction(async (tx) => {
                                // Create the token
                                const newToken = await tx.tokens.create({
                                    data: create.tokenData
                                });
                                
                                // Store token id in existing token map for future lookups
                                existingTokenMap[create.tokenData.address] = { 
                                    id: newToken.id, 
                                    address: create.tokenData.address, 
                                    symbol: create.tokenData.symbol || ''
                                };
                                
                                // Create price record if we have price data
                                if (create.priceData) {
                                    await tx.token_prices.create({
                                        data: {
                                            token_id: newToken.id,
                                            ...create.priceData
                                        }
                                    });
                                    
                                    // Add price history record
                                    await tx.token_price_history.create({
                                        data: {
                                            token_id: newToken.id,
                                            price: create.priceData.price,
                                            source: 'jupiter_api',
                                            timestamp: new Date()
                                        }
                                    });
                                }
                                
                                // Create website if we have website data
                                if (create.websiteData) {
                                    await tx.token_websites.create({
                                        data: {
                                            token_id: newToken.id,
                                            label: create.websiteData.label,
                                            url: create.websiteData.url
                                        }
                                    });
                                }
                                
                                // Create socials if we have social data
                                if (create.socialData) {
                                    for (const [type, url] of Object.entries(create.socialData)) {
                                        if (url) {
                                            await tx.token_socials.create({
                                                data: {
                                                    token_id: newToken.id,
                                                    type,
                                                    url: validateStringLength(url, 255)
                                                }
                                            });
                                        }
                                    }
                                }
                            });
                        } catch (createError) {
                            // Skip duplicates without failing the whole batch
                            if (createError.message.includes('duplicate key') || createError.message.includes('unique constraint')) {
                                logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Skipping duplicate token: ${create.tokenData.address}`);
                            } else {
                                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error creating token:${fancyColors.RESET}`, createError);
                            }
                        }
                    }
                    
                    // Log newly created tokens for better visibility
                    if (createBatch.length > 0) {
                        const newTokenSymbols = createBatch
                            .slice(0, 5)
                            .map(create => create.tokenData.symbol || create.tokenData.address.substring(0, 8));
                        
                        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} NEW TOKENS ${fancyColors.RESET} Created ${createBatch.length} tokens: ${newTokenSymbols.join(', ')}${createBatch.length > 5 ? '...' : ''}`);
                    }
                }
                
                // 3. Process price updates in batches
                const PRICE_UPDATE_BATCH_SIZE = 100;
                for (let i = 0; i < priceUpdates.length; i += PRICE_UPDATE_BATCH_SIZE) {
                    const priceBatch = priceUpdates.slice(i, i + PRICE_UPDATE_BATCH_SIZE);
                    
                    await marketDb.$transaction(async (tx) => {
                        for (const priceUpdate of priceBatch) {
                            await tx.token_prices.upsert({
                                where: { token_id: priceUpdate.tokenId },
                                update: priceUpdate.priceData,
                                create: {
                                    token_id: priceUpdate.tokenId,
                                    ...priceUpdate.priceData
                                }
                            });
                        }
                    });
                    
                    // Find and log most significant price changes
                    if (priceBatch.length > 0) {
                        try {
                            // Sort updates by absolute price change to find biggest movers
                            const significantMoves = priceBatch
                                .filter(update => update.priceData.change_24h)
                                .map(update => ({
                                    tokenId: update.tokenId,
                                    change: parseFloat(update.priceData.change_24h),
                                    price: update.priceData.price,
                                    symbol: existingTokenMap[Object.keys(existingTokenMap).find(
                                        key => existingTokenMap[key].id === update.tokenId
                                    )]?.symbol || `ID:${update.tokenId}`
                                }))
                                .filter(move => !isNaN(move.change)) // Filter out NaN values
                                .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
                                .slice(0, 3); // Top 3 movers
                                
                            if (significantMoves.length > 0) {
                                // Log significant price changes
                                significantMoves.forEach(move => {
                                    const color = move.change > 0 ? fancyColors.GREEN : fancyColors.RED;
                                    const direction = move.change > 0 ? 'UP' : 'DOWN';
                                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${color}PRICE ${direction} ${Math.abs(move.change).toFixed(2)}%:${fancyColors.RESET} ${move.symbol} at ${move.price}`);
                                });
                            }
                        } catch (error) {
                            // Silently handle any errors in price change logging
                        }
                        
                        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Completed batch of ${priceBatch.length} price updates`);
                    }
                }
                
                // 4. Process historical token data for all metrics
                if (historyRecords.length > 0) {
                    const HISTORY_BATCH_SIZE = 200;
                    for (let i = 0; i < historyRecords.length; i += HISTORY_BATCH_SIZE) {
                        const historyBatch = historyRecords.slice(i, i + HISTORY_BATCH_SIZE);
                        
                        await marketDb.token_price_history.createMany({
                            data: historyBatch
                        });
                    }
                    logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Created ${historyRecords.length} price history records`);
                }
                
                // 4b. Record comprehensive token history (volume, liquidity, market cap, rank)
                // Gather tokens with full data for comprehensive history
                const tokensForHistory = [];
                for (const tokenUpdate of tokenUpdates) {
                    // Find the matching price data
                    const priceUpdate = priceUpdates.find(p => p.tokenId === tokenUpdate.id);
                    if (priceUpdate) {
                        // Create a token object with all needed metrics
                        tokensForHistory.push({
                            id: tokenUpdate.id,
                            address: tokenUpdate.data.address,
                            symbol: tokenUpdate.data.symbol,
                            price: priceUpdate.priceData.price,
                            priceChange24h: priceUpdate.priceData.change_24h,
                            market_cap: priceUpdate.priceData.market_cap,
                            volume_24h: priceUpdate.priceData.volume_24h,
                            liquidity: priceUpdate.priceData.liquidity,
                            fdv: priceUpdate.priceData.fdv
                        });
                    }
                }
                
                // Process in batches of 100 for optimization
                const COMPREHENSIVE_BATCH_SIZE = 100;
                for (let i = 0; i < tokensForHistory.length; i += COMPREHENSIVE_BATCH_SIZE) {
                    const historyBatch = tokensForHistory.slice(i, i + COMPREHENSIVE_BATCH_SIZE);
                    
                    // Use our comprehensive history function to save all metrics at once
                    await tokenHistoryFunctions.recordComprehensiveTokenHistory(historyBatch, 'jupiter_api');
                }
                
                // 5. Process website updates
                const WEBSITE_BATCH_SIZE = 100;
                for (let i = 0; i < websiteUpdates.length; i += WEBSITE_BATCH_SIZE) {
                    const websiteBatch = websiteUpdates.slice(i, i + WEBSITE_BATCH_SIZE);
                    
                    await marketDb.$transaction(async (tx) => {
                        for (const website of websiteBatch) {
                            try {
                                // Check if website already exists for this token with this label
                                const existingWebsite = await tx.token_websites.findFirst({
                                    where: {
                                        token_id: website.tokenId,
                                        label: website.label
                                    }
                                });
                                
                                if (existingWebsite) {
                                    // Update existing website
                                    await tx.token_websites.update({
                                        where: { id: existingWebsite.id },
                                        data: { url: website.url }
                                    });
                                } else {
                                    // Create new website
                                    await tx.token_websites.create({
                                        data: {
                                            token_id: website.tokenId,
                                            label: website.label,
                                            url: website.url
                                        }
                                    });
                                }
                            } catch (error) {
                                logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Error processing website update: ${error.message}`);
                            }
                        }
                    });
                    
                    logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Processed batch of ${websiteBatch.length} website updates`);
                }
                
                // 6. Process social media updates
                const SOCIAL_BATCH_SIZE = 100;
                for (let i = 0; i < socialUpdates.length; i += SOCIAL_BATCH_SIZE) {
                    const socialBatch = socialUpdates.slice(i, i + SOCIAL_BATCH_SIZE);
                    
                    await marketDb.$transaction(async (tx) => {
                        for (const social of socialBatch) {
                            try {
                                // Check if social already exists for this token with this type
                                const existingSocial = await tx.token_socials.findFirst({
                                    where: {
                                        token_id: social.tokenId,
                                        type: social.type
                                    }
                                });
                                
                                if (existingSocial) {
                                    // Update existing social
                                    await tx.token_socials.update({
                                        where: { id: existingSocial.id },
                                        data: { url: social.url }
                                    });
                                } else {
                                    // Create new social
                                    await tx.token_socials.create({
                                        data: {
                                            token_id: social.tokenId,
                                            type: social.type,
                                            url: social.url
                                        }
                                    });
                                }
                            } catch (error) {
                                logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Error processing social update: ${error.message}`);
                            }
                        }
                    });
                    
                    logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Processed batch of ${socialBatch.length} social updates`);
                }
                
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GREEN}Completed all database operations for batch ${batchIndex + 1}/${totalBatches}${fancyColors.RESET}`);
            }
            
            // Update stats
            this.marketStats.updates.total++;
            this.marketStats.updates.successful++;
            this.marketStats.updates.lastUpdate = new Date().toISOString();
            this.marketStats.performance.lastUpdateTimeMs = Date.now() - startTime;
            
            // Note: WebSocket subscription removed as the endpoint is unconfirmed
            // Instead, we'll rely on regular polling of the REST API and future Helius integration
            // Here we could initialize Helius monitoring for specific token addresses in the future
            
            // Summarize the update with additional stats
            const timeElapsed = Math.round((Date.now() - startTime) / 1000);
            const tokensPerSecond = Math.round(processedCount / timeElapsed);
            
            // Summary details for admins to understand the update impact
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} UPDATE COMPLETE ${fancyColors.RESET} Processed ${processedCount}/${tokenList.length} tokens (${newTokensCount} new, ${updatedTokensCount} updated) in ${timeElapsed}s (${tokensPerSecond} tokens/sec)`);
            
            // Log a more detailed summary to provide insight into token coverage
            const tokenCoverage = ((processedCount / tokenList.length) * 100).toFixed(1);
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Update Summary:${fancyColors.RESET} Coverage: ${tokenCoverage}%, New tokens: ${newTokensCount}, Updated tokens: ${updatedTokensCount}`);
            
            return true;
        } catch (error) {
            this.marketStats.updates.failed++;
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} UPDATE FAILED ${fancyColors.RESET} Error updating token data: ${error.message}`, error);
            return false;
        }
    }
    
    // Helper method to update token website with length validation
    /**
     * Helper method to update token website with length validation
     * @param {number} tokenId - The token ID
     * @param {object} website - Website object with URL and label
     * @returns {Promise<void>}
     */
    async updateTokenWebsite(tokenId, website) {
        try {
            // Validate and truncate URL to prevent database errors
            const validUrl = website.url ? website.url.toString().substring(0, 255) : null;
            
            if (!validUrl) {
                return; // Skip if URL is invalid or empty after validation
            }
            
            // Check if the website already exists
            const existingWebsite = await marketDb.token_websites.findFirst({
                where: {
                    token_id: tokenId,
                    label: website.label
                }
            });
            
            if (existingWebsite) {
                // Update existing website
                await marketDb.token_websites.update({
                    where: { id: existingWebsite.id },
                    data: { url: validUrl }
                });
            } else {
                // Create new website
                await marketDb.token_websites.create({
                    data: {
                        token_id: tokenId,
                        label: website.label.substring(0, 50), // Ensure label is not too long
                        url: validUrl
                    }
                });
            }
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error updating token website:${fancyColors.RESET}`, error);
        }
    }
    
    /** Helper method to update token social with length validation */
    async updateTokenSocial(tokenId, social) {
        try {
            // Validate and truncate URL to prevent database errors
            const validUrl = social.url ? social.url.toString().substring(0, 255) : null;
            
            if (!validUrl) {
                return; // Skip if URL is invalid or empty after validation
            }
            
            // Check if the social already exists
            const existingSocial = await marketDb.token_socials.findFirst({
                where: {
                    token_id: tokenId,
                    type: social.type
                }
            });
            
            if (existingSocial) {
                // Update existing social
                await marketDb.token_socials.update({
                    where: { id: existingSocial.id },
                    data: { url: validUrl }
                });
            } else {
                // Create new social
                await marketDb.token_socials.create({
                    data: {
                        token_id: tokenId,
                        type: social.type.substring(0, 50), // Ensure type is not too long
                        url: validUrl
                    }
                });
            }
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error updating token social:${fancyColors.RESET}`, error);
        }
    }

    /** Start the interval to update token data in the database */
    startUpdateInterval() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        
        // Run an immediate update
        this.updateTokenData().catch(error => {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error in initial token data update:${fancyColors.RESET}`, error);
        });
        
        // Set up regular updates
        this.updateInterval = setInterval(async () => {
            try {
                await this.updateTokenData();
            } catch (error) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error in update interval:${fancyColors.RESET}`, error);
            }
        }, this.config.update.intervalMs);
        
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} SETUP ${fancyColors.RESET} Started token data update interval (${this.config.update.intervalMs / 1000}s) processing ${MAX_TOKENS_TO_PROCESS} tokens with Jupiter API (10 req/sec limit)`);
    }

    /** Records token ranks for historical tracking */
    async recordTokenRanks(tokens, tokenRanks) {
        try {
            if (!tokens || !tokenRanks) return;
            
            // Create rank history records for each token
            const rankRecords = [];
            const snapshotId = `rank_snapshot_${new Date().toISOString()}`;
            
            // For each token, look up its database ID and add a rank record
            for (const [address, rankInfo] of tokenRanks.entries()) {
                try {
                    // Find token ID from database
                    const token = await marketDb.tokens.findFirst({
                        where: { address },
                        select: { id: true }
                    });
                    
                    if (token && token.id) {
                        rankRecords.push({
                            tokenId: token.id,
                            rank: rankInfo.position,
                            source: 'jupiter_api',
                            snapshotId
                        });
                    }
                } catch (err) {
                    // Skip this token and continue with others
                    logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Error looking up token for rank recording: ${err.message}`);
                }
            }
            
            // Log result and record rank history in batches
            if (rankRecords.length > 0) {
                const BATCH_SIZE = 100;
                for (let i = 0; i < rankRecords.length; i += BATCH_SIZE) {
                    const batch = rankRecords.slice(i, i + BATCH_SIZE);
                    await tokenHistoryFunctions.recordRankHistoryBatch(batch);
                }
                
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded rank history for ${rankRecords.length} tokens`);
            }
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error recording token ranks:${fancyColors.RESET}`, error);
        }
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
            
            // WebSocket unsubscribe removed as we're no longer using WebSockets
            // Future: Clean up any Helius monitoring when implemented
            
            // Final stats update
            await serviceManager.markServiceStopped(
                this.name,
                this.config,
                {
                    ...this.stats,
                    marketStats: this.marketStats
                }
            );
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Service stopped`);
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error stopping service:${fancyColors.RESET}`, error);
            throw error;
        }
    }

    /**
     * Clean and validate a token address to ensure proper format
     * @param {string|any} address - The address to clean
     * @returns {string|null} - The cleaned address or null if invalid
     */
    cleanTokenAddress(address) {
        if (!address) return null;
        
        // Handle string type
        if (typeof address === 'string') {
            // Remove extra quotes that might be present in the address
            let cleaned = address.replace(/^["']+|["']+$/g, '');
            // Also handle escaped quotes
            cleaned = cleaned.replace(/\\"/g, '');
            
            // Don't perform strict Solana address validation
            // Allow "pump" suffix addresses and other custom formats
            // Just ensure it's not empty after cleaning
            if (cleaned && cleaned.length > 0) {
                return cleaned;
            }
        }
        
        // If address is an object with a specific address property, try that
        if (typeof address === 'object' && address !== null && address.address) {
            return this.cleanTokenAddress(address.address);
        }
        
        return null;
    }

    /**
     * Manual reset for the circuit breaker
     * This can be called to clear the circuit breaker state
     * @returns {boolean} True if reset was successful
     */
    resetCircuitBreaker() {
        try {
            if (!this.stats || !this.stats.circuitBreaker) {
                logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}No circuit breaker state found to reset${fancyColors.RESET}`);
                return false;
            }
            
            // Reset circuit breaker state
            this.stats.circuitBreaker.isOpen = false;
            this.stats.circuitBreaker.failures = 0;
            this.stats.circuitBreaker.lastReset = new Date().toISOString();
            this.stats.history.consecutiveFailures = 0;
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} CIRCUIT BREAKER RESET ${fancyColors.RESET} Circuit breaker manually reset and is now closed`);
            
            // REMOVED the immediate updateTokenData call that was causing flooding
            // Let the normal interval handle updates instead
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error resetting circuit breaker:${fancyColors.RESET}`, error);
            return false;
        }
    }

    /**
     * Implements the required onPerformOperation method from BaseService
     * This method will be called by the performOperation method in the BaseService class
     * @returns {Promise<boolean>}
     */
    async onPerformOperation() {
        try {
            // Check if service is operational
            if (!this.isOperational) {
                logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Service not operational, skipping operation`);
                return true;
            }
            
            // Perform the core service operation - update token data
            await this.updateTokenData();
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Operation error:${fancyColors.RESET} ${error.message}`);
            throw error; // Re-throw to let BaseService handle the error
        }
    }
}

// Create and export the marketDataService singleton
export default new MarketDataService();