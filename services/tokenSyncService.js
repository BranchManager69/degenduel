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
import { fancyColors } from '../utils/colors.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
// Solana
import { TOKEN_VALIDATION } from '../config/constants.js';
import { PublicKey } from '@solana/web3.js';
// Other
import axios from 'axios';
import { Decimal } from '@prisma/client/runtime/library';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
// Import marketDataService to replace deprecated API endpoints
import marketDataService from './marketDataService.js';

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
            // Add fallback URLs in case the primary ones are misconfigured
            prices: config.api_urls.data ? `${config.api_urls.data}/prices/bulk` : null, //TODO: Verify this is correct
            tokens: config.api_urls.data ? `${config.api_urls.data}/tokens` : null, //TODO: Verify this is correct
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

    // Initialize the service
    async initialize() {
        try {
            // Call parent initialize first
            await super.initialize();
            
            // Log API configuration
            logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.DARK_GREEN}Configuring Token Sync Service API...${fancyColors.RESET}`, {
            //    DATA_API: config.api_urls.data,
            //    prices_endpoint: this.config.api.endpoints.prices,
            //    tokens_endpoint: this.config.api.endpoints.tokens,
            //    fallback_endpoint: this.config.api.endpoints.fallback
            });
            
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
            logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.DARK_GREEN}Performing initial token sync...${fancyColors.RESET}`);
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
                
                logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.LIGHT_GREEN}${fancyColors.BG_DARK_GREEN} Initial token sync completed successfully ${fancyColors.RESET}`);
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

            // Mark the service as started
            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            // Log the service initialization
            logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.DARK_GREEN}Token Sync Service initialized${fancyColors.RESET}`, {
            //    activeTokens,
            //    totalTokens,
            //    hasInitialData: activeTokens > 0
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
        // Skip validation if no URL provided
        if (!url) return null;
        
        // Handle URL objects
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

    // Validate the description
    validateDescription(desc) {
        if (!desc) return null;
        const trimmed = desc.trim();
        return trimmed.length > this.config.validation.DESCRIPTION.MAX_LENGTH 
            ? trimmed.substring(0, this.config.validation.DESCRIPTION.MAX_LENGTH - 3) + '...' 
            : trimmed;
    }

    // Validate the symbol
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

    // Validate the name
    validateName(name) {
        const trimmed = name?.trim();
        if (!trimmed) {
            throw ServiceError.validation('Name is required');
        }
        return trimmed.length > this.config.validation.NAME.MAX_LENGTH 
            ? trimmed.substring(0, this.config.validation.NAME.MAX_LENGTH) 
            : trimmed;
    }

    // Validate the address
    validateAddress(address) {
        // Skip validation if no address provided
        if (!address) return null;
        
        try {
            // Use the PublicKey imported at the top of the file
            try {
                // Attempt to create a PublicKey - this validates format and checksums
                new PublicKey(address);
                return address; // Address is valid
            } catch (solanaError) {
                // This is a REAL validation error from the Solana library
                // We should throw a proper service error
                throw ServiceError.validation(`Invalid Solana address: ${address}`, {
                    address,
                    error: solanaError.message,
                    field: 'address'
                });
            }
        } catch (error) {
            // This catch only handles the case where we couldn't create the PublicKey
            if (error.isServiceError) {
                // This is our validation error from above, re-throw it
                throw error;
            }
            
            // Some other unexpected error occurred
            logApi.error(`CRITICAL: Error validating Solana address: ${error.message}`);
            
            // Throw validation error to skip this token completely
            throw ServiceError.validation(`Failed to validate Solana address: ${address}`, {
                address,
                error: error.message,
                field: 'address'
            });
        }
    }

    // API calls with circuit breaker protection
    async makeApiCall(endpoint, options = {}) {
        // Validate the endpoint URL first
        if (!endpoint) {
            throw new Error('Missing endpoint URL');
        }
        
        // Ensure endpoint is a valid URL
        try {
            new URL(endpoint);
        } catch (urlError) {
            throw new Error(`Invalid endpoint URL: ${endpoint}`);
        }
        
        // Make the API call
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
                throw ServiceError.network(`API timeout after ${this.config.api.timeoutMs/1000} seconds`, {
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

    // Helper function to format price with smart significant digits
    formatPrice(price) {
        if (price === null || price === undefined) return "N/A";
        
        // For high value tokens (≥ $1), show 2 decimal places
        if (price >= 1) {
            return price.toFixed(2);
        }
        // For medium value tokens ($0.01 to $1), show 4 decimal places
        else if (price >= 0.01) {
            return price.toFixed(4);
        }
        // For low value tokens ($0.0001 to $0.01), show 6 decimal places
        else if (price >= 0.0001) {
            return price.toFixed(6);
        }
        // For very low value tokens ($0.00000001 to $0.0001), show 8 decimal places
        else if (price >= 0.00000001) {
            return price.toFixed(8);
        }
        // For extremely low value meme coins, use scientific notation
        else {
            return price.toExponential(2);
        }
    }
    
    // Helper function to format market cap with appropriate suffix (K, M, B, T)
    formatMarketCap(marketCap) {
        if (!marketCap || marketCap <= 0) return "N/A";
        
        const trillion = 1_000_000_000_000;
        const billion = 1_000_000_000;
        const million = 1_000_000;
        const thousand = 1_000;
        
        // Format with appropriate suffix and decimal precision
        if (marketCap >= trillion) {
            // Trillions with no decimal for huge caps (≥ $1T)
            return `$${Math.floor(marketCap / trillion)}T`;
        } else if (marketCap >= billion) {
            // Billions with no decimal for large caps (≥ $1B)
            return `$${Math.floor(marketCap / billion)}B`;
        } else if (marketCap >= 100 * million) {
            // Hundreds of millions with no decimal (≥ $100M)
            return `$${Math.floor(marketCap / million)}M`;
        } else if (marketCap >= 10 * million) {
            // Tens of millions with 1 decimal (≥ $10M)
            return `$${(marketCap / million).toFixed(1)}M`;
        } else if (marketCap >= million) {
            // Single-digit millions with 2 decimals (≥ $1M)
            return `$${(marketCap / million).toFixed(2)}M`;
        } else if (marketCap >= 100 * thousand) {
            // Hundreds of thousands with no decimal (≥ $100K)
            return `$${Math.floor(marketCap / thousand)}K`;
        } else if (marketCap >= thousand) {
            // Thousands with 1 decimal (≥ $1K)
            return `$${(marketCap / thousand).toFixed(1)}K`;
        } else {
            // Below $1K just show the actual number
            return `$${Math.floor(marketCap)}`;
        }
    }

    // Fetch token prices using marketDataService with limited concurrency
    async fetchTokenPrices(addresses) {
        logApi.info(`[tokenSyncService] Fetching prices for ${addresses.length} tokens...`);
        
        try {
            // Process tokens in chunks to limit concurrency
            const BATCH_SIZE = 3; // Process 3 tokens at a time to avoid rate limits
            const results = [];
            
            // Helper function to process tokens in smaller batches
            const processBatch = async (batch) => {
                const batchPromises = batch.map(async (address) => {
                    // Add a small delay between requests in the same batch
                    const delay = Math.random() * 200; // 0-200ms delay for jitter
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    const token = await marketDataService.getTokenByAddress(address);
                    if (token) {
                        return {
                            contractAddress: address,
                            price: token.price || 0,
                            marketCap: token.market_cap || null,
                            timestamp: new Date().toISOString()
                        };
                    }
                    return null;
                });
                
                // Process this batch
                const batchResults = await Promise.all(batchPromises);
                return batchResults.filter(result => result !== null);
            };
            
            // Process all addresses in smaller batches
            for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
                const batch = addresses.slice(i, i + BATCH_SIZE);
                logApi.debug(`[tokenSyncService] Processing token batch ${i/BATCH_SIZE + 1}/${Math.ceil(addresses.length/BATCH_SIZE)}`);
                
                // Process this batch and add a small delay between batches
                const batchResults = await processBatch(batch);
                results.push(...batchResults);
                
                // Add delay between batches to avoid rate limits
                if (i + BATCH_SIZE < addresses.length) {
                    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms between batches
                }
            }
            
            logApi.info(`[tokenSyncService] Received price data for ${results.length}/${addresses.length} tokens`);
            return results;
        } catch (error) {
            logApi.error(`[tokenSyncService] Error fetching token prices: ${error.message}`);
            return [];
        }
    }

    // Fetch token data directly from marketDataService
    async fetchTokenData() {
        logApi.info(`[tokenSyncService] Fetching token data from marketDataService`);
        
        try {
            // Get all tokens directly from marketDataService
            const tokensFromMarketService = await marketDataService.getAllTokens();

            if (tokensFromMarketService && tokensFromMarketService.length > 0) {
                logApi.info(`[tokenSyncService] Successfully fetched ${tokensFromMarketService.length} tokens from marketDataService`);
                
                // Transform the data to the expected format for tokenSyncService
                return tokensFromMarketService.map(token => ({
                    id: token.id,
                    symbol: token.symbol,
                    name: token.name,
                    contractAddress: token.address,
                    price: token.price || 0,
                    marketCap: token.market_cap,
                    volume24h: token.volume_24h,
                    chain: "solana",
                    changesJson: { h24: token.change_24h },
                    imageUrl: token.image_url,
                    socials: token.socials || {
                        twitter: token.socials?.twitter,
                        telegram: token.socials?.telegram,
                        discord: token.socials?.discord
                    },
                    websites: token.websites ? token.websites.map(w => w.url || w) : []
                }));
            }
            
            // Fallback to database if marketDataService returns no data
            logApi.warn(`[tokenSyncService] No tokens returned from marketDataService, using local database fallback`);
            
            // If marketDataService fails, use local database as fallback
            const existingTokens = await prisma.tokens.findMany({
                where: { is_active: true },
                include: { token_prices: true }
            });
            
            if (existingTokens.length > 0) {
                logApi.info(`[tokenSyncService] Using ${existingTokens.length} tokens from local database as fallback`);
                
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
            logApi.error(`[tokenSyncService] All token data sources failed. Returning empty array.`);
            return [];
        } catch (error) {
            logApi.error(`[tokenSyncService] Error fetching token data: ${error.message}`);
            
            // If marketDataService fails, try local database as last resort
            try {
                const existingTokens = await prisma.tokens.findMany({
                    where: { is_active: true },
                    include: { token_prices: true }
                });
                
                if (existingTokens.length > 0) {
                    logApi.info(`[tokenSyncService] Recovered with ${existingTokens.length} tokens from local database after error`);
                    
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
            } catch (dbError) {
                logApi.error(`[tokenSyncService] Failed to fetch tokens from local database: ${dbError.message}`);
            }
            
            return [];
        }
    }

    // Core sync operations
    async updatePrices() {
        const startTime = Date.now();
        logApi.info(`[tokenSyncService] Price update cycle starting`);
        
        try {
            // Get all tokens that are currently active in DegenDuel
            const activeTokens = await prisma.tokens.findMany({
                where: { is_active: true },
                select: { address: true, id: true, symbol: true }
            });

            if (activeTokens.length === 0) {
                logApi.info(`[tokenSyncService] No active tokens found for price update`);
                return;
            }

            // Map addresses to their corresponding IDs and symbols
            const addresses = activeTokens.map(token => token.address);
            const tokenMap = Object.fromEntries(activeTokens.map(token => [token.address, { id: token.id, symbol: token.symbol }]));

            // Get current prices to compare with
            const currentPrices = await prisma.token_prices.findMany({
                where: { token_id: { in: activeTokens.map(token => token.id) } },
                include: { tokens: { select: { symbol: true, address: true, market_cap: true } } }
            });
            
            // Create a map of addresses to current prices
            const currentPriceMap = Object.fromEntries(
                currentPrices.map(price => [
                    price.tokens.address, 
                    { 
                        price: parseFloat(price.price), 
                        symbol: price.tokens.symbol,
                        marketCap: price.tokens.market_cap ? parseFloat(price.tokens.market_cap) : null
                    }
                ])
            );

            // Fetch prices for all active tokens
            logApi.info(`[tokenSyncService] Fetching prices for ${addresses.length} tokens...`);
            const priceData = await this.fetchTokenPrices(addresses);
            
            // Track price changes for reporting
            const priceChanges = [];
            
            // Update prices in the database
            let updatedCount = 0;
            await prisma.$transaction(async (tx) => {
                for (const token of priceData) {
                    const tokenInfo = tokenMap[token.contractAddress];
                    if (!tokenInfo) continue;

                    const tokenId = tokenInfo.id;
                    const newPrice = parseFloat(token.price);
                    const oldPriceInfo = currentPriceMap[token.contractAddress];
                    const oldPrice = oldPriceInfo ? oldPriceInfo.price : 0;
                    const marketCap = token.marketCap || (oldPriceInfo ? oldPriceInfo.marketCap : null);
                    
                    // Calculate percentage change if old price exists and is not zero
                    let percentChange = 0;
                    if (oldPrice > 0) {
                        percentChange = ((newPrice - oldPrice) / oldPrice) * 100;
                    }
                    
                    // Track significant price changes (> 0.1%)
                    if (Math.abs(percentChange) > 0.1) {
                        priceChanges.push({
                            symbol: tokenInfo.symbol,
                            oldPrice,
                            newPrice,
                            percentChange,
                            marketCap,
                            address: token.contractAddress
                        });
                    }

                    // Upsert the price data into the database
                    await tx.token_prices.upsert({
                        where: { token_id: tokenId },
                        create: {
                            token_id: tokenId,
                            price: new Decimal(newPrice),
                            updated_at: new Date(token.timestamp)
                        },
                        update: {
                            price: new Decimal(newPrice),
                            updated_at: new Date(token.timestamp)
                        }
                    });
                    updatedCount++;
                }
            });

            // Update performance metrics
            const duration = Date.now() - startTime;
            this.syncStats.performance.lastPriceUpdateMs = duration;
            this.syncStats.performance.averageOperationTimeMs = 
                (this.syncStats.performance.averageOperationTimeMs * this.syncStats.operations.total + duration) / 
                (this.syncStats.operations.total + 1);

            // Log the basic results
            logApi.info(`[tokenSyncService] Price update cycle completed: ${updatedCount}/${priceData.length} tokens updated in ${duration}ms`);
            
            // If there are significant price changes, log them in a separate message
            if (priceChanges.length > 0) {
                // Sort by absolute percentage change (largest first)
                priceChanges.sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));
                
                // Format the top changes (up to 5) for display
                const topChanges = priceChanges.slice(0, 5).map(change => {
                    const direction = change.percentChange > 0 ? '🟢' : '🔴';
                    const formattedPercent = change.percentChange.toFixed(2);
                    // Color formatting based on direction
                    const coloredPercent = change.percentChange > 0 ? 
                        `\x1b[32m+${formattedPercent}%\x1b[0m` : 
                        `\x1b[31m${formattedPercent}%\x1b[0m`;
                    
                    // Smart format the price and market cap
                    const formattedPrice = this.formatPrice(change.newPrice);
                    const formattedMC = this.formatMarketCap(change.marketCap);
                    
                    // Format: Symbol PercentChange Price MC
                    return `${direction} ${change.symbol.padEnd(6)} ${coloredPercent} $${formattedPrice.padEnd(12)} MC:$${formattedMC}`;
                }).join('\n    ');
                
                // Log the price changes with the total count and details
                logApi.info(`[tokenSyncService] Detected ${priceChanges.length} significant price changes:\n    ${topChanges}`);
                
                // If there are more changes than we displayed, mention it
                if (priceChanges.length > 5) {
                    logApi.info(`[tokenSyncService] ...and ${priceChanges.length - 5} more changes`);
                }
            } else {
                logApi.info(`[tokenSyncService] No significant price changes detected`);
            }
        } catch (error) {
            if (error.isServiceError) throw error;
            
            // Log the error
            logApi.error(`[tokenSyncService] Error updating token prices: ${error.message}`);
            throw ServiceError.operation('Failed to update token prices', {
                duration: Date.now() - startTime,
                error: error.message
            });
        }
    }

    // Update token metadata
    async updateMetadata(fullData) {
        const startTime = Date.now();
        
        try {
            logApi.info(`[tokenSyncService] Starting metadata update for ${fullData.length} tokens`);

            let created = 0;
            let updated = 0;
            let unchanged = 0;
            let validationFailures = 0;

            // Start a transaction to ensure atomicity
            await prisma.$transaction(async (tx) => {
                for (const token of fullData) {
                    try {
                        // Skip tokens with missing essential data
                        if (!token?.contractAddress || !token?.symbol || !token?.name) {
                            logApi.warn(`[tokenSyncService] Skipping token with missing required fields`, {
                                address: token?.contractAddress,
                                symbol: token?.symbol,
                                name: token?.name
                            });
                            continue; // Skip to the next token instead of throwing
                        }

                        // Try to validate all fields
                        let validatedData;
                        try {
                            // First validate the address since it's critical
                            const validatedAddress = this.validateAddress(token.contractAddress);
                            
                            // If we got here, the address is valid, now validate the rest
                            validatedData = {
                                address: validatedAddress,
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
                            // Check if this is an address validation error
                            if (validationError.isServiceError && 
                                validationError.type === ServiceErrorTypes.VALIDATION &&
                                validationError.details?.field === 'address') {
                                
                                // For address errors, log clearly and skip this token
                                logApi.warn(`[tokenSyncService] SKIPPING TOKEN - Invalid Solana address: ${token.contractAddress}`, {
                                    error: validationError.message,
                                    details: validationError.details
                                });
                                // Track validation failures
                                validationFailures++;
                                this.syncStats.validation.failures.addresses++;
                                continue; // Skip to next token
                            }
                            
                            // For other validation errors, log but continue with best effort
                            logApi.warn(`[tokenSyncService] Validation error for token ${token.contractAddress}: ${validationError.message}`);
                            
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
                        logApi.error(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.DARK_RED}Failed to process token:${fancyColors.RESET}`, {
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

            // Log the results if there were any token metadata has changed
            const duration = Date.now() - startTime;
            if (created > 0 || updated > 0 || validationFailures > 0) {
                logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.BG_DARK_GREEN}${fancyColors.LIGHT_YELLOW}${fancyColors.BOLD} Metadata update cycle completed ${fancyColors.RESET}`, {
                //    totalTokens: fullData.length,
                //    created,
                //    updated,
                //    unchanged,
                //    validationFailures,
                //    duration: `${duration}ms`,
                //    successRate: ((fullData.length - validationFailures) / fullData.length * 100).toFixed(2) + '%'
                });
            } else {
                //logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.LIGHT_GREEN}${fancyColors.ITALIC}No token metadata changes detected${fancyColors.RESET}`);
            }

            // Update performance metrics
            this.syncStats.performance.lastMetadataUpdateMs = duration;
            this.syncStats.performance.averageOperationTimeMs = 
                (this.syncStats.performance.averageOperationTimeMs * this.syncStats.operations.total + duration) / 
                (this.syncStats.operations.total + 1);

        } catch (error) {
            if (error.isServiceError) throw error;
            
            // Log the error
            logApi.error(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.RED}Error updating token metadata:${fancyColors.RESET} \n${fancyColors.RED}${fancyColors.ITALIC}${error.message}${fancyColors.RESET}`);
            throw ServiceError.operation('Failed to update token metadata', {
                duration: Date.now() - startTime,
                error: error.message
            });
        }
    }

    /**
     * Synchronize tokens across databases
     * This function ensures that all tokens in the main database are also in the market database
     * by calling the dedicated token-sync API endpoint in the lobby service
     */
    async synchronizeTokensAcrossDatabases() {
        logApi.info(`[tokenSyncService] Starting token synchronization across databases...`);
        
        try {
            // Get all active tokens from main database
            const activeTokens = await prisma.tokens.findMany({
                where: { is_active: true },
                select: { address: true, symbol: true, name: true }
            });
            
            logApi.info(`[tokenSyncService] Found ${activeTokens.length} active tokens in main database`);
            
            // Prepare tokens for the API request
            const tokensForSync = activeTokens.map(token => ({
                address: token.address,
                symbol: token.symbol,
                name: token.name || token.symbol
            }));
            
            // Call the token sync API (using imported axios from the top of the file)
            // Axios is already imported at the top: import axios from 'axios';
            const lobbyPort = process.env.LOBBY_PORT || 3006;
            const response = await axios.post(`http://localhost:${lobbyPort}/api/token-sync/check-missing`, {
                tokens: tokensForSync
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.API_KEY || 'internal-service'}`
                },
                timeout: 120000 // 2 minute timeout for discovery
            });
            
            if (response.status === 200 && response.data.success) {
                const results = response.data.results;
                logApi.info(`[tokenSyncService] Token sync completed: ${results.added}/${results.missing} tokens added to market database`);
                
                // Log detailed results if tokens were added
                if (results.added > 0) {
                    const addedTokens = results.details.filter(t => t.status === 'added');
                    logApi.info(`[tokenSyncService] Added tokens: ${addedTokens.map(t => t.symbol).join(', ')}`);
                }
                
                // Log failed tokens if any
                if (results.failed > 0) {
                    const failedTokens = results.details.filter(t => t.status === 'failed' || t.status === 'error');
                    logApi.warn(`[tokenSyncService] Failed to add tokens: ${failedTokens.map(t => t.symbol).join(', ')}`);
                }
                
                return {
                    totalActive: activeTokens.length,
                    missingInMarketDb: results.missing,
                    addedToMarketDb: results.added,
                    details: results.details
                };
            } else {
                logApi.warn(`[tokenSyncService] Token sync API call failed: ${JSON.stringify(response.data)}`);
                return {
                    error: 'API call failed',
                    totalActive: activeTokens.length,
                    missingInMarketDb: 0,
                    addedToMarketDb: 0
                };
            }
        } catch (error) {
            logApi.error(`[tokenSyncService] Error synchronizing tokens: ${error.message}`);
            return {
                error: error.message,
                totalActive: 0,
                missingInMarketDb: 0,
                addedToMarketDb: 0
            };
        }
    }
    
    /**
     * Simple placeholder for token addition
     * This will be replaced by a proper token discovery implementation
     */
    async addTokenToMarketDatabase(token) {
        logApi.info(`[tokenSyncService] Need to add token ${token.symbol} (${token.address}) to market database`);
        logApi.info(`[tokenSyncService] This function needs to be replaced with proper token discovery implementation`);
        
        // For now, we'll just log the missing tokens but not try to add them
        // The actual implementation will be done in the token discovery service
        return false;
    }

    // Main operation implementation
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // First ensure all tokens are synchronized across databases
            // Commented out as synchronization now happens automatically when processing token list
            // await this.synchronizeTokensAcrossDatabases();
            
            // Then update prices (higher priority)
            await this.updatePrices();
            
            // Then check if we need to update metadata (less frequent)
            try {
                const tokenData = await this.fetchTokenData();
                if (this.hasTokenListChanged(tokenData)) {
                    await this.updateMetadata(tokenData);
                }
            } catch (error) {
                logApi.warn(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.RED}Skipping metadata update due to error: ${error.message}${fancyColors.RESET}`);
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

    // Check if the token list has changed
    hasTokenListChanged(newTokens) {
        if (this.lastKnownTokens.size !== newTokens.length) {
            logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.BG_NEON} Token List Size Changed! \n\t${fancyColors.RESET} ${fancyColors.BG_DARK_YELLOW} ${this.lastKnownTokens.size} -> ${newTokens.length}`);
            return true;
        }

        for (const token of newTokens) {
            const existing = this.lastKnownTokens.get(token.contractAddress);
            if (!existing || 
                existing.name !== token.name || 
                existing.symbol !== token.symbol) {
                logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.BG_NEON}${fancyColors.BOLD} Change Detected in Token Metadata! ${fancyColors.RESET}\n\t${fancyColors.BG_DARK_YELLOW} ${token.symbol} ${fancyColors.RESET} \t${fancyColors.LIGHT_YELLOW}${token.contractAddress}${fancyColors.RESET} \n\t`, {
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

    // Stop the service
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
            
            logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.GREEN}Token Sync Service stopped successfully${fancyColors.RESET}`);
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.RED}Error stopping Token Sync Service:${fancyColors.RESET} \n${fancyColors.RED}${fancyColors.ITALIC}${error.message}${fancyColors.RESET}`);
            throw error;
        }
    }
}

// Export service singleton
const tokenSyncService = new TokenSyncService();
export default tokenSyncService; 