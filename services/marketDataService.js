// services/marketDataService.js

/*
 * This service is responsible for providing real-time market data for all tokens.
 * It depends on the Token Sync Service for base data and adds real-time analytics,
 * price aggregation, and market sentiment analysis.
 */

// ** Service Auth **
//import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../utils/service-suite/service-error.js';
//import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
//import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';

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
    }
};

// Market Data Service
class MarketDataService extends BaseService {
    constructor() {
        ////super(MARKET_DATA_CONFIG.name, MARKET_DATA_CONFIG);
        super(MARKET_DATA_CONFIG);
        
        // Initialize caches
        this.cache = new Map();
        this.requestCount = 0;
        this.requestTimeouts = new Set();

        // Initialize service-specific stats
        this.marketStats = {
            data: {
                tokens: {
                    total: 0,
                    active: 0,
                    withPrices: 0
                },
                updates: {
                    prices: {
                        total: 0,
                        successful: 0,
                        failed: 0,
                        lastUpdate: null
                    }
                }
            },
            dependencies: {
                tokenSync: {
                    status: 'unknown',
                    lastCheck: null,
                    errors: 0
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
                        active: 0,
                        withPrices: 0
                    },
                    updates: {
                        prices: {
                            total: 0,
                            successful: 0,
                            failed: 0,
                            lastUpdate: null
                        }
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
                }
            };

            // Initialize cache
            this.cache.clear();
            this.requestTimeouts.clear();
            this.requestCount = 0;

            // Check for initial data but don't fail if not present
            logApi.info(`${fancyColors.MAGENTA}[marketDataService]${fancyColors.RESET} ${fancyColors.BG_DARK_GREEN}${fancyColors.BOLD} Checking for initial token data... ${fancyColors.RESET}`);
            const [activeTokens, tokensWithPrices] = await Promise.all([
                prisma.tokens.count({ where: { is_active: true } }),
                prisma.token_prices.count()
            ]);

            // Update stats regardless of data presence
            this.marketStats.data.tokens.total = await prisma.tokens.count();
            this.marketStats.data.tokens.active = activeTokens;
            this.marketStats.data.tokens.withPrices = tokensWithPrices;

            if (activeTokens === 0 || tokensWithPrices === 0) {
                logApi.info(`${fancyColors.MAGENTA}[marketDataService]${fancyColors.RESET} ${fancyColors.BG_DARK_RED} No initial token data available ${fancyColors.RESET}`, {
                    activeTokens,
                    tokensWithPrices
                });
            } else {
                logApi.info(`${fancyColors.MAGENTA}[marketDataService]${fancyColors.RESET} ${fancyColors.BG_DARK_GREEN} Initial token data validated ${fancyColors.RESET} \n\t\t`, {
                    activeTokens,
                    tokensWithPrices
                });
            }

            // Start cleanup interval
            this.startCleanupInterval();

            // Update stats
            this.stats = {
                ...this.stats,
                marketStats: this.marketStats
            };

            logApi.info(`${fancyColors.MAGENTA}[marketDataService]${fancyColors.RESET} ${fancyColors.GREEN}Market Data Service initialized${fancyColors.RESET}`, {
                activeTokens: this.marketStats.data.tokens.active,
                withPrices: this.marketStats.data.tokens.withPrices,
                status: 'ready'
            });

            this.isInitialized = true;
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[marketDataService]${fancyColors.RESET} ${fancyColors.RED}Market Data Service initialization error:${fancyColors.RESET}`, error);
            await this.handleError(error);
            throw error;
        }
    }

    // Perform operation
    async performOperation() {
        const startTime = Date.now();
        
        try {
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

    // Get price
    async getPrice(symbol) {
        const startTime = Date.now();
        
        try {
            await this.checkServiceHealth();
            
            // Check cache first
            const cacheKey = `price:${symbol}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) return cached;

            // First check if token exists and is active
            const token = await prisma.tokens.findFirst({
                where: { symbol, is_active: true }
            });

            if (!token) {
                // Token doesn't exist or isn't active - this is not a failure
                return null;
            }

            const price = await prisma.token_prices.findFirst({
                where: { symbol },
                orderBy: { timestamp: 'desc' }
            });

            const price24hAgo = await prisma.token_prices.findFirst({
                where: {
                    symbol,
                    timestamp: {
                        lte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                    }
                },
                orderBy: { timestamp: 'desc' }
            });

            // If token exists but no price, it's pending sync - not a failure
            if (!price) {
                const result = {
                    current: 0,
                    change_24h: 0,
                    volume_24h: 0,
                    high_24h: 0,
                    low_24h: 0,
                    timestamp: new Date(),
                    pending_sync: true
                };
                this.setCache(cacheKey, result);
                return result;
            }

            const result = {
                current: price.price,
                change_24h: price24hAgo ? ((price.price - price24hAgo.price) / price24hAgo.price) * 100 : 0,
                volume_24h: price.volume_24h || 0,
                high_24h: price.high_24h || price.price,
                low_24h: price.low_24h || price.price,
                timestamp: price.timestamp,
                pending_sync: false
            };

            // Update stats
            this.marketStats.data.updates.prices.successful++;
            this.marketStats.data.updates.prices.lastUpdate = new Date().toISOString();
            this.marketStats.performance.averageLatencyMs = 
                (this.marketStats.performance.averageLatencyMs * this.marketStats.data.updates.prices.total + 
                (Date.now() - startTime)) / (this.marketStats.data.updates.prices.total + 1);

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            this.marketStats.data.updates.prices.failed++;
            throw error;
        } finally {
            this.marketStats.data.updates.prices.total++;
        }
    }

    // Get volume
    async getVolume(symbol) {
        const startTime = Date.now();
        
        try {
            await this.checkServiceHealth();
            
            const cacheKey = `volume:${symbol}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) return cached;

            const volumes = await prisma.token_volumes.findMany({
                where: {
                    symbol,
                    timestamp: {
                        gte: new Date(Date.now() - 60 * 60 * 1000) // Last hour
                    }
                },
                orderBy: { timestamp: 'desc' }
            });

            if (volumes.length === 0) {
                this.marketStats.data.updates.volume.failed++;
                return null;
            }

            const result = {
                total: volumes.reduce((sum, v) => sum + v.volume, 0),
                trades_count: volumes.reduce((sum, v) => sum + v.trades_count, 0),
                buy_volume: volumes.reduce((sum, v) => sum + v.buy_volume, 0),
                sell_volume: volumes.reduce((sum, v) => sum + v.sell_volume, 0),
                interval: '1h',
                timestamp: new Date()
            };

            // Update stats
            this.marketStats.data.updates.volume.successful++;
            this.marketStats.data.updates.volume.lastUpdate = new Date().toISOString();
            this.marketStats.performance.averageLatencyMs = 
                (this.marketStats.performance.averageLatencyMs * this.marketStats.data.updates.volume.total + 
                (Date.now() - startTime)) / (this.marketStats.data.updates.volume.total + 1);

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            this.marketStats.data.updates.volume.failed++;
            throw error;
        } finally {
            this.marketStats.data.updates.volume.total++;
        }
    }

    // Get sentiment
    async getSentiment(symbol) {
        const startTime = Date.now();
        
        try {
            await this.checkServiceHealth();
            
            const cacheKey = `sentiment:${symbol}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) return cached;

            const sentiment = await prisma.token_sentiment.findFirst({
                where: { symbol },
                orderBy: { timestamp: 'desc' }
            });

            if (!sentiment) {
                this.marketStats.data.updates.sentiment.failed++;
                return null;
            }

            const previousVolumes = await prisma.token_volumes.findMany({
                where: {
                    symbol,
                    timestamp: {
                        gte: new Date(Date.now() - 15 * 60 * 1000) // Last 15 minutes
                    }
                },
                orderBy: { timestamp: 'desc' }
            });

            let volumeTrend = 'stable';
            if (previousVolumes.length >= 2) {
                const recentVolume = previousVolumes[0].volume;
                const oldVolume = previousVolumes[previousVolumes.length - 1].volume;
                const change = ((recentVolume - oldVolume) / oldVolume) * 100;
                
                if (change > 10) volumeTrend = 'increasing';
                else if (change < -10) volumeTrend = 'decreasing';
            }

            const result = {
                score: sentiment.sentiment_score,
                buy_pressure: sentiment.buy_pressure,
                sell_pressure: sentiment.sell_pressure,
                volume_trend: volumeTrend,
                timestamp: sentiment.timestamp
            };

            // Update stats
            this.marketStats.data.updates.sentiment.successful++;
            this.marketStats.data.updates.sentiment.lastUpdate = new Date().toISOString();
            this.marketStats.performance.averageLatencyMs = 
                (this.marketStats.performance.averageLatencyMs * this.marketStats.data.updates.sentiment.total + 
                (Date.now() - startTime)) / (this.marketStats.data.updates.sentiment.total + 1);

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            this.marketStats.data.updates.sentiment.failed++;
            throw error;
        } finally {
            this.marketStats.data.updates.sentiment.total++;
        }
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
            logApi.info(`${fancyColors.MAGENTA}[marketDataService]${fancyColors.RESET} ${fancyColors.BG_DARK_GREEN}${fancyColors.LIGHT_RED}${fancyColors.BOLD}Cleaned ${cleaned} expired entries from market data cache${fancyColors.RESET}`);
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
            
            // Clear cache
            if (this.cache) {
                this.cache.clear();
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
            
            logApi.info('Market Data Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Market Data Service:', error);
            throw error;
        }
    }
}

// Export service singleton
const marketDataService = new MarketDataService();
export default marketDataService;