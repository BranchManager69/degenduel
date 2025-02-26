// services/tokenSyncService.js

/*
 * This service is responsible for fetching and updating token prices and metadata.
 * It stays up to date by constantly fetching from the DegenDuel Market Data API.
 * 
 */

// ** Service Auth **
import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../utils/service-suite/service-error.js';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
// Solana
import { TOKEN_VALIDATION } from '../config/constants.js'; //TODO: Verify all is correct
// Other
import axios from 'axios';
import { Decimal } from '@prisma/client/runtime/library';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';

const TOKEN_SYNC_CONFIG = {
    name: SERVICE_NAMES.TOKEN_SYNC,
    description: getServiceMetadata(SERVICE_NAMES.TOKEN_SYNC).description,
    checkIntervalMs: 30 * 1000, // Check every 30 seconds
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 4, // Lower threshold due to external API dependency
        resetTimeoutMs: 45000, // Faster reset for market data flow
        minHealthyPeriodMs: 120000
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    },
    validation: TOKEN_VALIDATION,
    api: {
        timeoutMs: 10000,
        endpoints: {
            prices: `${config.api_urls.data}/prices/bulk`,
            tokens: `${config.api_urls.data}/tokens`,
            fallback: config.api_urls.fallback
        }
    }
};

// Token Sync Service
class TokenSyncService extends BaseService {
    constructor() {
        ////super(TOKEN_SYNC_CONFIG.name, TOKEN_SYNC_CONFIG);
        super(TOKEN_SYNC_CONFIG);
        
        // Initialize service-specific state
        this.lastKnownTokens = new Map();
        this.syncStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            performance: {
                averageOperationTimeMs: 0,
                lastOperationTimeMs: 0,
                lastPriceUpdateMs: 0,
                lastMetadataUpdateMs: 0
            },
            tokens: {
                total: 0,
                active: 0,
                inactive: 0,
                lastUpdate: null
            },
            prices: {
                updated: 0,
                failed: 0,
                lastUpdate: null,
                averageUpdateTimeMs: 0
            },
            metadata: {
                created: 0,
                updated: 0,
                unchanged: 0,
                failed: 0,
                lastUpdate: null,
                averageUpdateTimeMs: 0
            },
            validation: {
                failures: {
                    urls: 0,
                    descriptions: 0,
                    symbols: 0,
                    names: 0,
                    addresses: 0
                },
                completeness: {
                    hasImage: 0,
                    hasDescription: 0,
                    hasTwitter: 0,
                    hasTelegram: 0,
                    hasDiscord: 0,
                    hasWebsite: 0
                }
            },
            api: {
                calls: 0,
                successful: 0,
                failed: 0,
                averageLatencyMs: 0
            }
        };
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

            // Perform immediate initial sync before counting tokens
            logApi.info('Performing initial token sync...');
            try {
                // Fetch token data with fallback mechanism
                const tokenData = await this.fetchTokenData();
                
                // Update metadata first
                await this.updateMetadata(tokenData);
                
                // Then update prices (only if we have tokens in the database)
                if (tokenData.length > 0) {
                    await this.updatePrices();
                } else {
                    logApi.warn('No tokens available for price update');
                }
                
                logApi.info('Initial token sync completed successfully');
            } catch (error) {
                logApi.error('Initial token sync failed:', error);
                // Don't throw - we'll retry on normal interval
            }

            // Now load token state
            const [activeTokens, totalTokens] = await Promise.all([
                prisma.tokens.count({ where: { is_active: true } }),
                prisma.tokens.count()
            ]);

            this.syncStats.tokens.active = activeTokens;
            this.syncStats.tokens.total = totalTokens;
            this.syncStats.tokens.inactive = totalTokens - activeTokens;

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify({
                ...this.stats,
                syncStats: this.syncStats
            }));

            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            logApi.info('\t\tToken Sync Service initialized', {
                activeTokens,
                totalTokens,
                hasInitialData: activeTokens > 0
            });

            return true;
        } catch (error) {
            logApi.error('Token Sync Service initialization error:', error);
            await this.handleError(error);
            throw error;
        }
    }

    // Validation utilities
    validateUrl(url) {
        if (!url) return null;
        
        if (typeof url === 'object') {
            url = url.href || url.url;
            if (!url) {
                throw ServiceError.validation('Invalid URL object format', { url });
            }
        }

        if (typeof url !== 'string') {
            throw ServiceError.validation(`Invalid URL type: ${typeof url}`);
        }

        try {
            const parsedUrl = new URL(url);
            if (!this.config.validation.URLS.ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
                throw ServiceError.validation(`Invalid protocol for URL: ${url}`);
            }
            if (url.length > this.config.validation.URLS.MAX_LENGTH) {
                throw ServiceError.validation(`URL too long: ${url}`);
            }
            return url;
        } catch (error) {
            throw ServiceError.validation(`Invalid URL: ${url}`, { error: error.message });
        }
    }

    validateDescription(desc) {
        if (!desc) return null;
        const trimmed = desc.trim();
        return trimmed.length > this.config.validation.DESCRIPTION.MAX_LENGTH 
            ? trimmed.substring(0, this.config.validation.DESCRIPTION.MAX_LENGTH - 3) + '...' 
            : trimmed;
    }

    validateSymbol(symbol) {
        if (!symbol) return null;
        
        let cleanSymbol = symbol.trim()
            .toUpperCase()
            .replace(/[^A-Z0-9-_.]/g, '');
        
        if (!cleanSymbol) {
            throw ServiceError.validation(`Symbol became empty after cleaning: ${symbol}`);
        }
        
        // Just enforce max length without pattern validation
        return cleanSymbol.substring(0, this.config.validation.SYMBOL.MAX_LENGTH);
    }

    validateName(name) {
        const trimmed = name?.trim();
        if (!trimmed) {
            throw ServiceError.validation('Name is required');
        }
        return trimmed.length > this.config.validation.NAME.MAX_LENGTH 
            ? trimmed.substring(0, this.config.validation.NAME.MAX_LENGTH) 
            : trimmed;
    }

    validateAddress(address) {
        // Skip validation if no address provided
        if (!address) return null;
        
        try {
            // Ensure the pattern is properly created as a RegExp object
            const pattern = new RegExp(this.config.validation.ADDRESS.SOLANA_PATTERN);
            if (!pattern.test(address)) {
                // Log warning but don't throw so we can continue processing other tokens
                logApi.warn(`Invalid Solana address format: ${address}`);
                return address; // Still return the address but with a warning
            }
            return address;
        } catch (error) {
            logApi.warn(`Error validating address: ${address}`, error);
            return address; // Return the address anyway rather than failing
        }
    }

    // API calls with circuit breaker protection
    async makeApiCall(endpoint, options = {}) {
        try {
            const response = await axios({
                ...options,
                url: endpoint,
                timeout: this.config.api.timeoutMs,
                headers: {
                    ...options.headers,
                    ...generateServiceAuthHeader()
                }
            });
            return response.data;
        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                throw ServiceError.network(`API timeout after ${this.config.api.timeoutMs}ms`, {
                    endpoint,
                    timeout: this.config.api.timeoutMs
                });
            }
            throw ServiceError.network(error.message, {
                endpoint,
                status: error.response?.status,
                data: error.response?.data
            });
        }
    }

    async fetchTokenPrices(addresses) {
        logApi.info(`Fetching prices for ${addresses.length} tokens...`);
        // Get bulk token data from DD-serve
        try {
            const data = await this.makeApiCall(this.config.api.endpoints.prices, {
                method: 'POST',
                data: { addresses }
            });
            logApi.info(`Received price data for ${data.data.length} tokens`);
            return data.data;
        } catch (error) {
            // Handle 404 error by using fallback mock data
            logApi.warn(`Price API unavailable, using fallback data: ${error.message}`);
            // Return empty array for now to prevent initialization failure
            return [];
        }
    }

    async fetchTokenData() {
        logApi.info('Fetching token data from data service...');
        try {
            const result = await this.makeApiCall(this.config.api.endpoints.tokens);
            
            // Make sure we have a valid response with data array
            if (!result || !result.data || !Array.isArray(result.data)) {
                throw ServiceError.validation('Invalid data format from token API', { 
                    endpoint: this.config.api.endpoints.tokens,
                    result: JSON.stringify(result).substring(0, 100) + '...'
                });
            }
            
            logApi.info(`Received token data with ${result.data.length} tokens`);
            return result.data;
        } catch (error) {
            logApi.warn(`Error fetching token data from primary source: ${error.message}`);
            
            // Try local fallback endpoint first if the URL is valid
        if (this.config.api.endpoints.fallback) {
            try {
                logApi.info('Attempting to fetch from local fallback endpoint...');
                const fallbackResult = await this.makeApiCall(this.config.api.endpoints.fallback);
                
                if (fallbackResult && Array.isArray(fallbackResult)) {
                    logApi.info(`Received ${fallbackResult.length} tokens from local fallback`);
                    return fallbackResult;
                } else if (fallbackResult && fallbackResult.data && Array.isArray(fallbackResult.data)) {
                    logApi.info(`Received ${fallbackResult.data.length} tokens from local fallback (data property)`);
                    return fallbackResult.data;
                }
            } catch (fallbackError) {
                logApi.warn(`Fallback endpoint also failed: ${fallbackError.message}`);
            }
        } else {
            logApi.warn('No valid fallback endpoint configured, skipping fallback attempt');
        }
            
            // If fallback also fails, try to use database
            const existingTokens = await prisma.tokens.findMany({
                where: { is_active: true },
                include: { token_prices: true }
            });
            
            if (existingTokens.length > 0) {
                logApi.info(`Using ${existingTokens.length} tokens from database as fallback`);
                
                // Transform to expected format
                return existingTokens.map(token => ({
                    id: token.id,
                    symbol: token.symbol,
                    name: token.name,
                    contractAddress: token.address,
                    price: token.token_prices?.price || 0,
                    marketCap: token.market_cap,
                    volume24h: token.volume_24h,
                    chain: "solana",
                    changesJson: { h24: token.change_24h },
                    imageUrl: token.image_url,
                    socials: {
                        twitter: token.twitter_url,
                        telegram: token.telegram_url,
                        discord: token.discord_url
                    },
                    websites: token.website_url ? [token.website_url] : []
                }));
            }
            
            // If we have no data at all, return empty array rather than failing
            logApi.error('All token data sources failed, returning empty array');
            return [];
        }
    }

    // Core sync operations
    async updatePrices() {
        const startTime = Date.now();
        
        try {
            const activeTokens = await prisma.tokens.findMany({
                where: { is_active: true },
                select: { address: true, id: true }
            });

            if (activeTokens.length === 0) {
                logApi.info('No active tokens found for price update');
                return;
            }

            const addresses = activeTokens.map(token => token.address);
            const addressToId = Object.fromEntries(activeTokens.map(token => [token.address, token.id]));

            const priceData = await this.fetchTokenPrices(addresses);
            
            let updatedCount = 0;
            await prisma.$transaction(async (tx) => {
                for (const token of priceData) {
                    const tokenId = addressToId[token.contractAddress];
                    if (!tokenId) continue;

                    await tx.token_prices.upsert({
                        where: { token_id: tokenId },
                        create: {
                            token_id: tokenId,
                            price: new Decimal(token.price),
                            updated_at: new Date(token.timestamp)
                        },
                        update: {
                            price: new Decimal(token.price),
                            updated_at: new Date(token.timestamp)
                        }
                    });
                    updatedCount++;
                }
            });

            const duration = Date.now() - startTime;
            logApi.info(`Price update cycle completed`, {
                totalTokens: activeTokens.length,
                pricesReceived: priceData.length,
                pricesUpdated: updatedCount,
                duration: `${duration}ms`
            });

            // Update performance metrics
            this.syncStats.performance.lastPriceUpdateMs = duration;
            this.syncStats.performance.averageOperationTimeMs = 
                (this.syncStats.performance.averageOperationTimeMs * this.syncStats.operations.total + duration) / 
                (this.syncStats.operations.total + 1);

        } catch (error) {
            if (error.isServiceError) throw error;
            
            throw ServiceError.operation('Failed to update token prices', {
                duration: Date.now() - startTime,
                error: error.message
            });
        }
    }

    async updateMetadata(fullData) {
        const startTime = Date.now();
        
        try {
            logApi.info(`Starting metadata update for ${fullData.length} tokens...`);

            let created = 0;
            let updated = 0;
            let unchanged = 0;
            let validationFailures = 0;

            await prisma.$transaction(async (tx) => {
                for (const token of fullData) {
                    try {
                        // Skip tokens with missing essential data
                        if (!token?.contractAddress || !token?.symbol || !token?.name) {
                            logApi.warn('Skipping token with missing required fields', {
                                address: token?.contractAddress,
                                symbol: token?.symbol,
                                name: token?.name
                            });
                            continue; // Skip to the next token instead of throwing
                        }

                        // Try to validate all fields but don't fail if some validation fails
                        let validatedData;
                        try {
                            validatedData = {
                                address: this.validateAddress(token.contractAddress),
                                symbol: this.validateSymbol(token.symbol),
                                name: this.validateName(token.name),
                                decimals: 9,
                                is_active: true,
                                market_cap: token.marketCap ? new Decimal(token.marketCap) : null,
                                change_24h: token.change_h24 ? new Decimal(token.change_h24) : null,
                                volume_24h: token.volume24h ? new Decimal(token.volume24h) : null,
                                image_url: this.validateUrl(token.imageUrl),
                                description: this.validateDescription(token.description),
                                twitter_url: this.validateUrl(token.socials?.twitter),
                                telegram_url: this.validateUrl(token.socials?.telegram),
                                discord_url: this.validateUrl(token.socials?.discord),
                                website_url: this.validateUrl(token.websites?.[0])
                            };
                        } catch (validationError) {
                            // Log but continue with best effort
                            logApi.warn(`Validation error for token ${token.contractAddress}: ${validationError.message}`);
                            
                            // Fall back to minimal valid data
                            validatedData = {
                                address: token.contractAddress,
                                symbol: token.symbol?.slice(0, 10) || 'UNKNOWN', // Ensure not too long
                                name: token.name?.slice(0, 50) || 'Unknown Token', // Ensure not too long
                                decimals: 9,
                                is_active: true
                            };
                        }

                        const existingToken = await tx.tokens.findUnique({
                            where: { address: token.contractAddress }
                        });

                        if (existingToken) {
                            await tx.tokens.update({
                                where: { id: existingToken.id },
                                data: validatedData
                            });
                            updated++;
                        } else {
                            await tx.tokens.create({
                                data: validatedData
                            });
                            created++;
                        }

                        // Update metadata completeness stats
                        this.syncStats.validation.completeness.hasImage += validatedData.image_url ? 1 : 0;
                        this.syncStats.validation.completeness.hasDescription += validatedData.description ? 1 : 0;
                        this.syncStats.validation.completeness.hasTwitter += validatedData.twitter_url ? 1 : 0;
                        this.syncStats.validation.completeness.hasTelegram += validatedData.telegram_url ? 1 : 0;
                        this.syncStats.validation.completeness.hasDiscord += validatedData.discord_url ? 1 : 0;
                        this.syncStats.validation.completeness.hasWebsite += validatedData.website_url ? 1 : 0;

                    } catch (error) {
                        if (error.type === ServiceErrorTypes.VALIDATION) {
                            validationFailures++;
                            this.syncStats.validation.failures[error.details?.field || 'other']++;
                        }
                        logApi.error('Failed to process token:', {
                            token: token?.contractAddress,
                            error: error.message
                        });
                    }
                }
            });

            // Update our cache with the latest token list
            this.lastKnownTokens = new Map(
                fullData
                    .filter(token => token?.contractAddress && token?.name && token?.symbol)
                    .map(token => [
                        token.contractAddress,
                        { name: token.name, symbol: token.symbol }
                    ])
            );

            const duration = Date.now() - startTime;
            logApi.info('Metadata update completed', {
                totalTokens: fullData.length,
                created,
                updated,
                unchanged,
                validationFailures,
                duration: `${duration}ms`,
                successRate: ((fullData.length - validationFailures) / fullData.length * 100).toFixed(2) + '%'
            });

            // Update performance metrics
            this.syncStats.performance.lastMetadataUpdateMs = duration;
            this.syncStats.performance.averageOperationTimeMs = 
                (this.syncStats.performance.averageOperationTimeMs * this.syncStats.operations.total + duration) / 
                (this.syncStats.operations.total + 1);

        } catch (error) {
            if (error.isServiceError) throw error;
            
            throw ServiceError.operation('Failed to update token metadata', {
                duration: Date.now() - startTime,
                error: error.message
            });
        }
    }

    // Main operation implementation
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // First update prices (higher priority)
            await this.updatePrices();
            
            // Then check if we need to update metadata (less frequent)
            try {
                const tokenData = await this.fetchTokenData();
                if (this.hasTokenListChanged(tokenData)) {
                    await this.updateMetadata(tokenData);
                }
            } catch (error) {
                logApi.warn(`Skipping metadata update due to error: ${error.message}`);
                // Continue with other operations even if metadata update fails
            }

            // Update performance metrics
            this.syncStats.performance.lastOperationTimeMs = Date.now() - startTime;
            this.syncStats.performance.averageOperationTimeMs = 
                (this.syncStats.performance.averageOperationTimeMs * this.syncStats.operations.total + 
                (Date.now() - startTime)) / (this.syncStats.operations.total + 1);

            // Update ServiceManager state
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    syncStats: this.syncStats
                }
            );

            return {
                duration: Date.now() - startTime,
                pricesUpdated: true,
                metadataUpdated: true,
                stats: this.syncStats
            };
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            throw error;
        }
    }

    hasTokenListChanged(newTokens) {
        if (this.lastKnownTokens.size !== newTokens.length) {
            logApi.info(`Token list size changed: ${this.lastKnownTokens.size} -> ${newTokens.length}`);
            return true;
        }

        for (const token of newTokens) {
            const existing = this.lastKnownTokens.get(token.contractAddress);
            if (!existing || 
                existing.name !== token.name || 
                existing.symbol !== token.symbol) {
                logApi.info(`Token changed: ${token.contractAddress}`, {
                    old: existing,
                    new: {
                        name: token.name,
                        symbol: token.symbol
                    }
                });
                return true;
            }
        }
        return false;
    }

    async stop() {
        try {
            await super.stop();
            
            // Clear state
            this.lastKnownTokens.clear();
            
            // Final stats update
            await serviceManager.markServiceStopped(
                this.name,
                this.config,
                {
                    ...this.stats,
                    syncStats: this.syncStats
                }
            );
            
            logApi.info('Token Sync Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Token Sync Service:', error);
            throw error;
        }
    }
}

// Export service singleton
const tokenSyncService = new TokenSyncService();
export default tokenSyncService; 