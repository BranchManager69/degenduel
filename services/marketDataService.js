// services/marketDataService.js

/*
 * This service is responsible for providing real-time market data for all tokens.
 * It connects directly to the degenduel_market_data database for token information
 * and provides market data via WebSockets and APIs.
 */

// ** Service Class **
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../utils/service-suite/service-error.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { Decimal } from '@prisma/client/runtime/library'; // Why is this not used?
import { PrismaClient } from '@prisma/client';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import { fancyColors } from '../utils/colors.js';
import serviceEvents from '../utils/service-suite/service-events.js';

// Config
import { config } from '../config/config.js';
// Extra Config
const BROADCAST_INTERVAL = 10 // Broadcast every 10 seconds


// Initialize the marketDataService's dedicated internal Prisma client to the Market Database
/**
 * Initialize the marketDataService's dedicated internal Prisma client to the Market Database
 * 
 * @returns {PrismaClient} The Prisma client for the Market Database
 */
const marketDb = new PrismaClient({
    datasourceUrl: process.env.MARKET_DATABASE_URL
});

// Create the marketDataService's dedicated internal config
/**
 * Create the marketDataService's dedicated internal config
 * 
 * @returns {Object} The config for the marketDataService
 */
const MARKET_DATA_CONFIG = {
    name: SERVICE_NAMES.MARKET_DATA,
    description: getServiceMetadata(SERVICE_NAMES.MARKET_DATA).description,
    checkIntervalMs: 5000,
    maxRetries: 3,
    retryDelayMs: 1000,
    circuitBreaker: {
        failureThreshold: 10,
        resetTimeoutMs: 30000,
        minHealthyPeriodMs: 60000
    },
    backoff: {
        initialDelayMs: 100,
        maxDelayMs: 5000,
        factor: 2
    },
    cache: {
        maxSize: 10000,
        ttl: 10000,
        cleanupInterval: 1000
    },
    limits: {
        maxConcurrentRequests: 1000,
        requestTimeoutMs: 2000
    },
    broadcast: {
        intervalMs: BROADCAST_INTERVAL * 1000,
        changesOnly: true  // Only broadcast when data changes // TODO: Does this actually work?
    }
};

// ------------------------------------------------------------------------------------------------

// Market Data Service
/**
 * Market Data Service
 * 
 * @extends {BaseService}
 */
class MarketDataService extends BaseService {
    constructor() {
        super(MARKET_DATA_CONFIG);
        
        // Initialize caches
        this.cache = new Map();
        this.tokensCache = new Map();
        this.requestCount = 0;
        this.requestTimeouts = new Set();
        this.lastBroadcastData = null;
        this.broadcastInterval = null;

        // Initialize service-specific stats
        this.marketStats = {
            data: {
                tokens: {
                    total: 0,
                    active: 0
                },
                updates: {
                    total: 0,
                    successful: 0,
                    failed: 0,
                    lastUpdate: null
                },
                broadcasts: {
                    total: 0,
                    changesOnly: 0,
                    lastBroadcast: null
                }
            },
            performance: {
                averageLatencyMs: 0,
                lastOperationTimeMs: 0,
                averageOperationTimeMs: 0
            },
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            cache: {
                size: 0,
                hits: 0,
                misses: 0,
                lastCleanup: null
            },
            requests: {
                active: 0,
                rejected: 0,
                timedOut: 0
            }
        };
    }

    // Initialize the service
    async initialize() {
        try {
            // Initialize market stats structure
            this.marketStats = {
                data: {
                    tokens: {
                        total: 0,
                        active: 0
                    },
                    updates: {
                        total: 0,
                        successful: 0,
                        failed: 0,
                        lastUpdate: null
                    },
                    broadcasts: {
                        total: 0,
                        changesOnly: 0,
                        lastBroadcast: null
                    }
                },
                performance: {
                    averageLatencyMs: 0,
                    lastOperationTimeMs: 0,
                    averageOperationTimeMs: 0
                },
                operations: {
                    total: 0,
                    successful: 0,
                    failed: 0
                },
                cache: {
                    size: 0,
                    hits: 0,
                    misses: 0,
                    lastCleanup: null
                },
                requests: {
                    active: 0,
                    rejected: 0,
                    timedOut: 0
                }
            };

            // Initialize cache
            this.cache.clear();
            this.tokensCache.clear();
            this.requestTimeouts.clear();
            this.requestCount = 0;

            // Check market database connection
            logApi.info(`[MktDataSvc] Connecting to market database...`);
            try {
                const tokenCount = await marketDb.tokens.count();
                this.marketStats.data.tokens.total = tokenCount;
                
                if (tokenCount === 0) {
                    logApi.warn(`[MktDataSvc] Connected to market database, but no tokens found`);
                } else {
                    logApi.info(`[MktDataSvc] Connected to market database, found ${tokenCount} tokens`);
                }
                
                // Preload tokens to cache
                try {
                    logApi.info(`[MktDataSvc] Preloading tokens to cache...`);
                    await this.refreshTokensCache();
                    logApi.info(`[MktDataSvc] Preloaded tokens to cache`);
                } catch (error) {
                    logApi.error(`[MktDataSvc] Error preloading tokens to cache:`, error);
                }
                
                // Start cleanup interval
                try {
                    logApi.info(`[MktDataSvc] Starting cleanup interval...`);
                    this.startCleanupInterval();
                    logApi.info(`[MktDataSvc] Cleanup interval started`);
                } catch (error) {
                    logApi.error(`[MktDataSvc] Error starting cleanup interval:`, error);
                }
                
                // Start broadcast interval if needed
                try {
                    logApi.info(`[MktDataSvc] Starting broadcast interval...`);
                    this.startBroadcastInterval();
                    logApi.info(`[MktDataSvc] Broadcast interval started`);
                } catch (error) {
                    logApi.error(`[MktDataSvc] Error starting broadcast interval:`, error);
                }
                
            } catch (dbError) {
                logApi.error(`[MktDataSvc] Market Data Service failed to connect to market database: ${dbError.message}`);
                throw new Error(`Failed to connect to market database: ${dbError.message}`);
            }

            // Update stats
            this.stats = {
                ...this.stats,
                marketStats: this.marketStats
            };

            logApi.info(`[MktDataSvc] Market Data Service initialized`);

            this.isInitialized = true;
            return true;
        } catch (error) {
            logApi.error(`[MktDataSvc] Market Data Service initialization error:`, error);
            await this.handleError(error);
            throw error;
        }
    }

    // Refresh tokens cache
    async refreshTokensCache() {
        try {
            const tokens = await marketDb.tokens.findMany({
                include: {
                    token_socials: true,
                    token_websites: true
                }
            });

            //// Log token refresh with comma-separated list of tokens
            ////const tokenSymbols = tokens.map(t => t.symbol).join(', ');
            ////logApi.info(`[MktDataSvc] Refreshed token cache with ${tokens.length} tokens: ${tokenSymbols}`);
            
            // Format token count with consistent spacing
            const formattedCount = tokens.length.toString().padStart(3);

            // Calculate category thresholds (for cache details)
            const mktCapBlueChipThreshold = 100; // $ million
            const mktCapThresholdMajor = 25; // $ million
            const mktCapThresholdMid = 10; // $ million
            const mktCapThresholdSmall = 1; // $ million
            const mktCapThresholdMicro = 0.1; // $ million
            const mktCapThresholdNano = 0.05; // $ million
            const mktCapThresholdDeadButNeverForgotten = 0.001; // $ million
            const MILLION = 1000000;
            
            // Calculate category counts for cache details
            const categoryCounts = {
                blueChipTokens: tokens.filter(t => t.market_cap && parseFloat(t.market_cap) >= mktCapBlueChipThreshold * MILLION).length,
                majorTokens: tokens.filter(t => t.market_cap && parseFloat(t.market_cap) < mktCapBlueChipThreshold * MILLION && parseFloat(t.market_cap) >= mktCapThresholdMajor * MILLION).length,
                midCapTokens: tokens.filter(t => t.market_cap && parseFloat(t.market_cap) < mktCapThresholdMajor * MILLION && parseFloat(t.market_cap) >= mktCapThresholdMid * MILLION).length,
                smallCapTokens: tokens.filter(t => t.market_cap && parseFloat(t.market_cap) < mktCapThresholdMid * MILLION && parseFloat(t.market_cap) >= mktCapThresholdSmall * MILLION).length,
                microCapTokens: tokens.filter(t => t.market_cap && parseFloat(t.market_cap) < mktCapThresholdSmall * MILLION && parseFloat(t.market_cap) >= mktCapThresholdMicro * MILLION).length,
                nanoCapTokens: tokens.filter(t => t.market_cap && parseFloat(t.market_cap) < mktCapThresholdMicro * MILLION && parseFloat(t.market_cap) >= mktCapThresholdNano * MILLION).length,
                deadButNeverForgottenTokens: tokens.filter(t => t.market_cap && parseFloat(t.market_cap) < mktCapThresholdNano * MILLION && parseFloat(t.market_cap) >= mktCapThresholdDeadButNeverForgotten * MILLION).length,

                noCapTokens: tokens.filter(t => !t.market_cap).length, // No market cap data
                hasPriceTokens: tokens.filter(t => t.price && parseFloat(t.price) > 0).length, // Has price data
                hasImageTokens: tokens.filter(t => t.image_url).length, // Has image data
                hasSocialTokens: tokens.filter(t => t.token_socials && t.token_socials.length > 0).length // Has social data
            };
            
            // Format details string
            const cacheDetailsStr = ` \n\t Blue Chip: ${categoryCounts.blueChipTokens} · Major: ${categoryCounts.majorTokens} · Mid: ${categoryCounts.midCapTokens} · Small: ${categoryCounts.smallCapTokens} · Micro: ${categoryCounts.microCapTokens} · Nano: ${categoryCounts.nanoCapTokens} · Dead: ${categoryCounts.deadCapTokens} · Dead: ${categoryCounts.deadButNeverForgottenTokens} · No cap: ${categoryCounts.noCapTokens}  \n\tPrice data: ${categoryCounts.hasPriceTokens} · Socials: ${categoryCounts.hasSocialTokens} · Media: ${categoryCounts.hasImageTokens}`;
            
            // Log with improved formatting and purple color theme (distinct from magenta token sync)
            logApi.info(`${fancyColors.PURPLE}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_PURPLE}${fancyColors.WHITE} CACHE REFRESHED ${fancyColors.RESET} ${fancyColors.BOLD_PURPLE}${formattedCount} tokens${fancyColors.RESET} ${fancyColors.LIGHT_PURPLE}(${cacheDetailsStr})${fancyColors.RESET}`);
            
            // Clear and rebuild tokensCache
            this.tokensCache.clear();
            
            // Track any token errors in a list
            const errorTokens = [];
            
            // Set the tokens in the cache
            tokens.forEach(token => {
                try {
                    this.tokensCache.set(token.symbol, this.formatTokenData(token));
                } catch (error) {
                    errorTokens.push(token.symbol);
                    // Format token symbol with consistent width
                    const formattedSymbol = token.symbol.padEnd(8);
                    
                    // Log with improved formatting and purple color
                    logApi.error(`${fancyColors.PURPLE}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BOLD_PURPLE}✗ ${formattedSymbol}${fancyColors.RESET} ${fancyColors.RED}Cache error: ${error.message}${fancyColors.RESET}`);
                }
            });
            
            // Only log errors if any occurred
            if (errorTokens.length > 0) {
                // Format count with consistent spacing
                const formattedCount = errorTokens.length.toString().padStart(3);
                
                // Log with improved formatting and purple color
                logApi.warn(`${fancyColors.PURPLE}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} CACHE ERRORS ${fancyColors.RESET} ${fancyColors.BOLD_PURPLE}${formattedCount} tokens${fancyColors.RESET} ${fancyColors.YELLOW}${errorTokens.join(', ')}${fancyColors.RESET}`);
            }
            
            // Update service stats
            this.marketStats.data.tokens.total = tokens.length;
            this.marketStats.data.updates.successful++;
            this.marketStats.data.updates.lastUpdate = new Date().toISOString();
            
            return tokens.length;
        } catch (error) {
            logApi.error(`${fancyColors.PURPLE}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BOLD_PURPLE}✗ ERROR:${fancyColors.RESET} ${fancyColors.LIGHT_PURPLE}Failed to refresh tokens cache:${fancyColors.RESET} ${fancyColors.RED}${error.message}${fancyColors.RESET}`);
            this.marketStats.data.updates.failed++;
            throw error;
        } finally {
            this.marketStats.data.updates.total++;
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
        
        return {
            id: token.id,
            symbol: token.symbol,
            name: token.name,
            price: parseFloat(token.price) || 0,
            change_24h: parseFloat(token.change_24h) || 0,
            color: token.color || '#888888',
            address: token.address,
            decimals: token.decimals || 9,
            market_cap: token.market_cap,
            fdv: token.fdv,
            liquidity: token.liquidity,
            volume_24h: token.volume_24h,
            image_url: token.image_url,
            buy_pressure: token.buy_pressure,
            socials: socials,
            websites: websites
        };
    }

    // Perform operation
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Refresh tokens data from market database
            await this.refreshTokensCache();
            
            // Perform maintenance
            this.cleanupCache();
            await this.checkServiceHealth();

            // Update performance metrics
            this.marketStats.performance.lastOperationTimeMs = Date.now() - startTime;
            this.marketStats.performance.averageOperationTimeMs = 
                (this.marketStats.performance.averageOperationTimeMs * this.marketStats.operations.total + 
                (Date.now() - startTime)) / (this.marketStats.operations.total + 1);

            // Update ServiceManager state
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    marketStats: this.marketStats
                }
            );

            return {
                duration: Date.now() - startTime,
                stats: this.marketStats
            };
        } catch (error) {
            await this.handleError(error);
            return false;
        }
    }

    // Get all tokens
    async getAllTokens() {
        try {
            await this.checkServiceHealth();
            
            // If cache is empty, refresh it
            if (this.tokensCache.size === 0) {
                await this.refreshTokensCache();
            }
            
            // Convert map to array
            return Array.from(this.tokensCache.values());
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting all tokens:${fancyColors.RESET}`, error);
            throw error;
        }
    }

    // Get token by symbol
    async getToken(symbol) {
        const startTime = Date.now();
        
        try {
            await this.checkServiceHealth();
            
            // Check cache first
            if (this.tokensCache.has(symbol)) {
                this.marketStats.cache.hits++;
                return this.tokensCache.get(symbol);
            }
            
            // Not in cache, query database
            this.marketStats.cache.misses++;
            
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

            // Format and cache the token
            const formattedToken = this.formatTokenData(token);
            this.tokensCache.set(symbol, formattedToken);
            
            // Update metrics
            this.marketStats.performance.averageLatencyMs = 
                (this.marketStats.performance.averageLatencyMs * this.marketStats.data.updates.total + 
                (Date.now() - startTime)) / (this.marketStats.data.updates.total + 1);
            
            return formattedToken;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting token:${fancyColors.RESET}`, error);
            throw error;
        }
    }

    // Get token by address
    async getTokenByAddress(address) {
        try {
            await this.checkServiceHealth();
            
            // Search in cache first
            for (const token of this.tokensCache.values()) {
                if (token.address === address) {
                    this.marketStats.cache.hits++;
                    return token;
                }
            }
            
            // Not in cache, query database
            this.marketStats.cache.misses++;
            
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

            // Format and cache the token
            const formattedToken = this.formatTokenData(token);
            this.tokensCache.set(token.symbol, formattedToken);
            
            return formattedToken;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting token by address:${fancyColors.RESET}`, error);
            throw error;
        }
    }

    // Generate broadcast data
    async generateBroadcastData() {
        try {
            const allTokens = await this.getAllTokens();
            
            // Format the data for broadcasting
            const broadcastData = {
                type: 'token_update',
                timestamp: new Date().toISOString(),
                data: allTokens
            };
            
            // Check if data has changed since last broadcast
            const hasChanged = !this.lastBroadcastData || 
                JSON.stringify(broadcastData.data) !== JSON.stringify(this.lastBroadcastData.data);
            
            if (hasChanged || !this.config.broadcast.changesOnly) {
                this.lastBroadcastData = broadcastData;
                if (hasChanged) {
                    this.marketStats.data.broadcasts.changesOnly++;
                }
                this.marketStats.data.broadcasts.total++;
                this.marketStats.data.broadcasts.lastBroadcast = broadcastData.timestamp;
                
                return broadcastData;
            }
            
            return null; // No changes to broadcast
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error generating broadcast data:${fancyColors.RESET}`, error);
            return null;
        }
    }

    // Start broadcast interval
    startBroadcastInterval() {
        if (this.broadcastInterval) {
            clearInterval(this.broadcastInterval);
        }
        
        this.broadcastInterval = setInterval(async () => {
            try {
                const broadcastData = await this.generateBroadcastData();
                
                if (broadcastData) {
                    // Emit an event that WebSockets can listen for via serviceEvents
                    serviceEvents.emit('market:broadcast', broadcastData);
                    
                    // Format token count with consistent spacing
                    const formattedCount = broadcastData.data.length.toString().padStart(3);
                    
                    // Calculate token price stats for the broadcast
                    const tokensWithPriceChange = broadcastData.data.filter(t => t.change_24h && Math.abs(t.change_24h) > 0.5).length;
                    const topGainers = broadcastData.data
                        .filter(t => t.change_24h && t.change_24h > 2)
                        .sort((a, b) => b.change_24h - a.change_24h)
                        .slice(0, 3)
                        .map(t => t.symbol);
                    
                    // Format broadcast details
                    const broadcastDetailsStr = topGainers.length > 0 ? 
                        `${tokensWithPriceChange} with sig. changes · Top gainers: ${topGainers.join(', ')}` : 
                        `${tokensWithPriceChange} with sig. changes`;
                    
                    // Log with improved formatting and purple color theme
                    logApi.info(`${fancyColors.PURPLE}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_PURPLE}${fancyColors.WHITE} BROADCASTING ${fancyColors.RESET} ${fancyColors.BOLD_PURPLE}${formattedCount} tokens${fancyColors.RESET} ${fancyColors.LIGHT_PURPLE}(${broadcastDetailsStr})${fancyColors.RESET}`);
                }
            } catch (error) {
                logApi.error(`[MktDataSvc] Error in broadcast interval:`, error);
            }
        }, this.config.broadcast.intervalMs);
        
        logApi.info(`[MktDataSvc] Started market data broadcast interval (${this.config.broadcast.intervalMs}ms)`);
    }

    // Cache management
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.config.cache.ttl) {
            this.marketStats.cache.hits++;
            return cached.data;
        }
        this.marketStats.cache.misses++;
        return null;
    }

    // Set the cache
    setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        this.marketStats.cache.size = this.cache.size;
    }

    // Start the cleanup interval
    startCleanupInterval() {
        setInterval(() => {
            this.cleanupCache();
        }, this.config.cache.cleanupInterval);
    }

    // Cleanup the cache
    cleanupCache() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, value] of this.cache) {
            if (now - value.timestamp > this.config.cache.ttl) {
                this.cache.delete(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            this.marketStats.cache.size = this.cache.size;
            this.marketStats.cache.lastCleanup = new Date().toISOString();
            // Format cleaned count with consistent spacing
            const formattedCleaned = cleaned.toString().padStart(3);
            const formattedRemaining = this.cache.size.toString().padStart(3);
            
            // Log with improved formatting and purple color theme
            logApi.info(`${fancyColors.PURPLE}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_PURPLE}${fancyColors.WHITE} CACHE CLEANED ${fancyColors.RESET} ${fancyColors.BOLD_PURPLE}${formattedCleaned} entries${fancyColors.RESET} ${fancyColors.LIGHT_PURPLE}(${formattedRemaining} remaining)${fancyColors.RESET}`);
        }
    }

    // Service health checks
    async checkServiceHealth() {
        if (this.stats.circuitBreaker.isOpen) {
            throw ServiceError.unavailable('Circuit breaker is open');
        }

        if (this.requestCount >= this.config.limits.maxConcurrentRequests) {
            this.marketStats.requests.rejected++;
            throw ServiceError.overloaded('Too many concurrent requests');
        }

        this.requestCount++;
        this.marketStats.requests.active++;
        
        const timeout = setTimeout(() => {
            this.requestCount--;
            this.marketStats.requests.active--;
            this.marketStats.requests.timedOut++;
        }, this.config.limits.requestTimeoutMs);
        
        this.requestTimeouts.add(timeout);
    }

    // Stop the service
    async stop() {
        try {
            await super.stop();
            
            // Clear all timeouts
            for (const timeout of this.requestTimeouts) {
                clearTimeout(timeout);
            }
            this.requestTimeouts.clear();
            
            // Clear broadcast interval
            if (this.broadcastInterval) {
                clearInterval(this.broadcastInterval);
                this.broadcastInterval = null;
            }
            
            // Clear cache
            if (this.cache) {
                this.cache.clear();
            }
            
            if (this.tokensCache) {
                this.tokensCache.clear();
            }
            
            // Reset cache size in stats if it exists
            if (this.marketStats && this.marketStats.cache) {
                this.marketStats.cache.size = 0;
            }
            
            // Final stats update
            await serviceManager.markServiceStopped(
                this.name,
                this.config,
                {
                    ...this.stats,
                    marketStats: this.marketStats
                }
            );
            
            logApi.info(`[MktDataSvc] Market Data Service stopped`);
        } catch (error) {
            logApi.error(`[MktDataSvc] Error stopping Market Data Service:`, error);
            throw error;
        }
    }
}

// Export the marketDataService singleton
const marketDataService = new MarketDataService();
export default marketDataService;