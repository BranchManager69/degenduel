import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { ServiceManager } from '../utils/service-suite/service-manager.js';

export class MarketDataService extends BaseService {
    constructor() {
        // Initialize with proper config structure
        const config = {
            updateInterval: 100, // 100ms for 10 updates/second
            maxConcurrentRequests: 100,
            cacheTimeout: 1000, // 1 second cache
            circuitBreaker: {
                failureThreshold: 5,
                resetTimeoutMs: 60000, // 1 minute
                minHealthyPeriodMs: 120000 // 2 minutes
            }
        };
        
        super('market_data_service', config);
        
        this.cache = new Map();
        this.requestCount = 0;
        this.requestTimeouts = new Set(); // Track timeouts for cleanup
        
        // Initialize stats after super, preserving base stats
        const baseStats = { ...this.stats };
        this.stats = {
            ...baseStats,
            requestCount: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errors: 0,
            lastError: null,
            marketData: {
                circuitBreaker: {
                    isOpen: false,
                    failures: 0,
                    lastFailure: null,
                    recoveryAttempts: 0,
                    lastCheck: null
                }
            }
        };
    }

    // Required by BaseService
    async performOperation() {
        try {
            // Perform health check and maintenance
            await this.checkCircuitBreaker();
            this.cleanupCache();
            
            // Update service heartbeat
            return true;
        } catch (error) {
            this.handleError('performOperation', error);
            return false;
        }
    }

    async initialize() {
        try {
            // Call parent initialize first
            await super.initialize();
            
            // Load configuration from database
            const settings = await prisma.system_settings.findUnique({
                where: { key: this.name }
            });

            if (settings?.value) {
                const dbConfig = typeof settings.value === 'string' 
                    ? JSON.parse(settings.value)
                    : settings.value;

                // Merge configs carefully preserving circuit breaker settings
                this.config = {
                    ...this.config,
                    ...dbConfig,
                    circuitBreaker: {
                        ...this.config.circuitBreaker,
                        ...(dbConfig.circuitBreaker || {})
                    }
                };
            }

            // Initialize cache and stats
            this.cache.clear();
            
            // Update only our specific stats, preserve BaseService stats
            const currentStats = { ...this.stats };
            this.stats = {
                ...currentStats,
                requestCount: 0,
                cacheHits: 0,
                cacheMisses: 0,
                errors: 0,
                lastError: null,
                marketData: {
                    ...currentStats.marketData,
                    circuitBreaker: {
                        isOpen: false,
                        failures: 0,
                        lastFailure: null,
                        recoveryAttempts: 0,
                        lastCheck: null
                    }
                }
            };

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify(this.stats));
            await ServiceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            logApi.info('Market Data Service initialized');
            return true;
        } catch (error) {
            logApi.error('Market Data Service initialization error:', error);
            await this.handleError('initialize', error);
            throw error;
        }
    }

    async checkCircuitBreaker() {
        const now = Date.now();
        const circuitBreaker = this.stats.marketData.circuitBreaker;

        // Update last check time
        circuitBreaker.lastCheck = new Date().toISOString();

        // Check if circuit breaker should be reset
        if (circuitBreaker.isOpen && circuitBreaker.lastFailure) {
            const timeSinceLastFailure = now - new Date(circuitBreaker.lastFailure).getTime();
            if (timeSinceLastFailure >= this.config.circuitBreaker.resetTimeoutMs) {
                circuitBreaker.isOpen = false;
                circuitBreaker.failures = 0;
                circuitBreaker.recoveryAttempts++;
                logApi.info('Circuit breaker reset for market data service');
            }
        }
    }

    async stop() {
        try {
            // Call parent stop first
            await super.stop();
            
            // Clear all intervals
            clearInterval(this.circuitBreakerInterval);
            clearInterval(this.cacheCleanupInterval);
            
            // Clear all request timeouts
            for (const timeout of this.requestTimeouts) {
                clearTimeout(timeout);
            }
            this.requestTimeouts.clear();
            
            // Clear cache
            this.cache.clear();
            
            logApi.info('Market Data Service stopped');
        } catch (error) {
            await this.handleError(error);
            throw ServiceError.shutdown(error.message);
        }
    }

    async getPrice(symbol) {
        try {
            await this.checkServiceHealth();
            
            // Check cache first
            const cacheKey = `price:${symbol}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) return cached;

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

            if (!price) return null;

            const result = {
                current: price.price,
                change_24h: price24hAgo ? ((price.price - price24hAgo.price) / price24hAgo.price) * 100 : 0,
                volume_24h: price.volume_24h || 0,
                high_24h: price.high_24h || price.price,
                low_24h: price.low_24h || price.price
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            this.handleError('getPrice', error);
            return null;
        }
    }

    async getVolume(symbol) {
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

            if (volumes.length === 0) return null;

            const result = {
                total: volumes.reduce((sum, v) => sum + v.volume, 0),
                trades_count: volumes.reduce((sum, v) => sum + v.trades_count, 0),
                buy_volume: volumes.reduce((sum, v) => sum + v.buy_volume, 0),
                sell_volume: volumes.reduce((sum, v) => sum + v.sell_volume, 0),
                interval: '1h'
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            this.handleError('getVolume', error);
            return null;
        }
    }

    async getSentiment(symbol) {
        try {
            await this.checkServiceHealth();
            
            const cacheKey = `sentiment:${symbol}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) return cached;

            const sentiment = await prisma.token_sentiment.findFirst({
                where: { symbol },
                orderBy: { timestamp: 'desc' }
            });

            if (!sentiment) return null;

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
                volume_trend: volumeTrend
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            this.handleError('getSentiment', error);
            return null;
        }
    }

    // Cache management
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.config.cacheTimeout) {
            this.stats.cacheHits++;
            return cached.data;
        }
        this.stats.cacheMisses++;
        return null;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    cleanupCache() {
        const now = Date.now();
        for (const [key, value] of this.cache) {
            if (now - value.timestamp > this.config.cacheTimeout) {
                this.cache.delete(key);
            }
        }
    }

    // Service health checks
    async checkServiceHealth() {
        if (this.stats.marketData.circuitBreaker.isOpen) {
            throw ServiceError.unavailable('Circuit breaker is open');
        }

        if (this.requestCount >= this.config.maxConcurrentRequests) {
            throw ServiceError.overloaded('Too many concurrent requests');
        }

        this.requestCount++;
        setTimeout(() => this.requestCount--, 1000);
    }

    // Error handling
    handleError(operation, error) {
        // If only one argument is passed, it's the error
        if (!error) {
            error = operation;
            operation = 'unknown';
        }

        try {
            // Call parent error handler with the error
            super.handleError(error);
            
            // Update our specific stats
            this.stats.marketData.circuitBreaker.failures++;
            this.stats.marketData.circuitBreaker.lastFailure = new Date().toISOString();
            
            if (error instanceof ServiceError) {
                throw error;
            }

            throw ServiceError.operation(`${operation}: ${error.message}`);
        } catch (err) {
            // Ensure we throw a proper error even if something goes wrong in error handling
            if (err instanceof ServiceError) {
                throw err;
            }
            throw ServiceError.operation(`${operation}: ${error?.message || 'Unknown error'}`);
        }
    }
}

// Create and export singleton instance
export const marketDataService = new MarketDataService();
export default marketDataService; 