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
import { TOKEN_VALIDATION } from '../config/constants.js'; //TODO: Verify all is correct
import { PublicKey } from '@solana/web3.js';
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

    // Fetch token prices
    async fetchTokenPrices(addresses) {
        logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]\t${fancyColors.RESET} ${fancyColors.DARK_GRAY}Fetching prices for ${fancyColors.BOLD}${addresses.length}${fancyColors.RESET}${fancyColors.DARK_GRAY} tokens...${fancyColors.RESET}`);
        
        // Check if price endpoint is configured
        const pricesEndpoint = this.config.api.endpoints.prices;
        if (!pricesEndpoint) {
            logApi.warn(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.RED}Price API endpoint not configured, using fallback data${fancyColors.RESET}`);
            return [];
        }

        // Get bulk token data from DD-serve
        logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET}\t\t ${fancyColors.GRAY}Fetching market data from${fancyColors.RESET} ${fancyColors.UNDERLINE}${fancyColors.BLUE}${pricesEndpoint}${fancyColors.RESET}`);
        try {
            // Make the API call
            const data = await this.makeApiCall(pricesEndpoint, {
                method: 'POST',
                data: { addresses }
            });
            
            // Validate the response format
            if (!data || !data.data || !Array.isArray(data.data)) {
                logApi.warn(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.RED}Invalid price data format received${fancyColors.RESET}`);
                return [];
            }
            
            // Log the response
            logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.GREEN}Received price data for ${fancyColors.BOLD_GREEN}${data.data.length}${fancyColors.RESET} ${fancyColors.GREEN}tokens${fancyColors.RESET}`);
            return data.data;
        } catch (error) {
            // Handle 404 error by using fallback empty data
            logApi.warn(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.BOLD} PRICE API UNAVAILABLE ${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.DARK_RED} No prices fetched${fancyColors.RESET} \n\t\t${fancyColors.LIGHT_RED}${error.message}${fancyColors.RESET} \t${fancyColors.LIGHT_RED}Trying fallback token data...${fancyColors.RESET}`);
            // Return empty array for now to prevent initialization failure
            return [];
        }
    }

    // Fetch token data
    async fetchTokenData() {
        // Check if primary endpoint is valid
        const tokensEndpoint = this.config.api.endpoints.tokens; // TODO: <----- PRIORITY 1: Transplant the current endpoint with the new one (MARKET_DATABASE_URL via new v69 websocket)
        if (!tokensEndpoint) {
            logApi.warn(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.RED}Primary token data endpoint not configured or invalid${fancyColors.RESET}`);
        } else {
            logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.DARK_GREEN}Attempting to fetch token data from ${fancyColors.RESET} ${fancyColors.UNDERLINE}${fancyColors.BLUE}${tokensEndpoint}${fancyColors.RESET}`);
            try {
                const result = await this.makeApiCall(tokensEndpoint);
                
                // Make sure we have a valid response with data array
                if (!result || !result.data || !Array.isArray(result.data)) {
                    throw ServiceError.validation('Invalid data format from token API', { 
                        endpoint: this.config.api.endpoints.tokens,
                        result: JSON.stringify(result).substring(0, 100) + '...'
                    });
                }
                
                // Log the response
                logApi.info(`${fancyColors.BG_DEBUG_GAME_DATABASE}${fancyColors.DARK_MAGENTA}[tokenSyncService]${fancyColors.RESET}${fancyColors.BG_DEBUG_GAME_DATABASE} ${fancyColors.DARK_GREEN}Game database currently contains ${fancyColors.GRAY}${result.data.length}${fancyColors.RESET}${fancyColors.BG_DEBUG_GAME_DATABASE} ${fancyColors.DARK_GREEN}tokens____________${fancyColors.RESET}`);
                return result.data;
            } catch (error) {
                logApi.error(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ⚠️  ${fancyColors.DARK_RED}${fancyColors.BOLD} ERROR! ${fancyColors.RESET}⚠️ \n\t\t${fancyColors.BOLD_RED}Error fetching token data from primary source:${fancyColors.RESET}\n\t\t\t${fancyColors.BOLD}${fancyColors.LIGHT_RED}${error.message}${fancyColors.RESET}`);
                // Continue to fallbacks
            }
        }
            
        // Try local fallback endpoint if the URL is valid
        if (this.config.api.endpoints.fallback) {
            try {
                logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.ORANGE}Attempting to fetch from local fallback endpoint${fancyColors.RESET}`);
                const fallbackResult = await this.makeApiCall(this.config.api.endpoints.fallback);
                
                if (fallbackResult && Array.isArray(fallbackResult)) {
                    logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.YELLOW}Received ${fallbackResult.length} tokens from local fallback${fancyColors.RESET}`);
                    return fallbackResult;
                } else if (fallbackResult && fallbackResult.data && Array.isArray(fallbackResult.data)) {
                    logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.YELLOW}Received ${fallbackResult.data.length} tokens from local fallback (data property)${fancyColors.RESET}`);
                    return fallbackResult.data;
                }
            } catch (fallbackError) {
                logApi.warn(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.DARK_RED}Fallback endpoint also failed:${fancyColors.RESET} ${fancyColors.DARK_RED}${fancyColors.ITALIC}${fallbackError.message}${fancyColors.RESET}`);
            }
        } else {
            logApi.warn(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.BOLD_RED}No valid fallback endpoint configured.${fancyColors.RESET} ${fancyColors.RED}Skipping fallback attempt.${fancyColors.RESET}`);
        }
            
        // If fallback also fails, try to use database
        const existingTokens = await prisma.tokens.findMany({
            where: { is_active: true },
            include: { token_prices: true }
        });
        
        if (existingTokens.length > 0) {
            logApi.info(`${fancyColors.BG_DEBUG_GAME_DATABASE}${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET}${fancyColors.BG_DEBUG_GAME_DATABASE} ${fancyColors.ORANGE}Using the existing ${fancyColors.BOLD_YELLOW}${fancyColors.UNDERLINE}${existingTokens.length}${fancyColors.RESET}$ ${fancyColors.ORANGE}tokens from database as fallback ${fancyColors.RESET}`);
            
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
        logApi.error(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.BG_DARK_RED}${fancyColors.BOLD}All token data sources failed.${fancyColors.RESET} ${fancyColors.BG_DARK_RED}Returning empty array...${fancyColors.RESET}`);
        return [];
    }

    // Core sync operations
    async updatePrices() {
        const startTime = Date.now();
        logApi.info(`${fancyColors.BG_DEBUG_GAME_DATABASE}${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET}${fancyColors.BG_DEBUG_GAME_DATABASE} ${fancyColors.BG_DARK_GREEN} Price update cycle starting______________________${fancyColors.RESET}`, {
        //    startTime: startTime,
        });
        
        try {
            // Get all tokens that are currently active in DegenDuel
            const activeTokens = await prisma.tokens.findMany({
                where: { is_active: true },
                select: { address: true, id: true }
            });

            if (activeTokens.length === 0) {
                logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.RED}No active tokens found for price update${fancyColors.RESET}`);
                return;
            }

            // Map addresses to their corresponding IDs
            const addresses = activeTokens.map(token => token.address);
            const addressToId = Object.fromEntries(activeTokens.map(token => [token.address, token.id]));

            // Fetch prices for all active tokens
            const priceData = await this.fetchTokenPrices(addresses);
            
            // Update prices in the database
            let updatedCount = 0;
            await prisma.$transaction(async (tx) => {
                for (const token of priceData) {
                    const tokenId = addressToId[token.contractAddress];
                    if (!tokenId) continue;

                    // Upsert the price data into the database
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

            // Update performance metrics
            const duration = Date.now() - startTime;
            this.syncStats.performance.lastPriceUpdateMs = duration;
            this.syncStats.performance.averageOperationTimeMs = 
                (this.syncStats.performance.averageOperationTimeMs * this.syncStats.operations.total + duration) / 
                (this.syncStats.operations.total + 1);

            // Log the results
            logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.BG_DARK_GREEN} Price update cycle completed ${fancyColors.RESET}`, {
            //    totalTokens: activeTokens.length,
            //    pricesReceived: priceData.length,
            //    pricesUpdated: updatedCount,
            //    duration: `${duration}ms`
            });
        } catch (error) {
            if (error.isServiceError) throw error;
            
            // Log the error
            logApi.error(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.RED}Error updating token prices:${fancyColors.RESET} \n${fancyColors.RED}${fancyColors.ITALIC}${error.message}${fancyColors.RESET}`);
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
            logApi.info(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.BG_DARK_GREEN} Starting metadata update.  ${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.BG_DARK_GREEN}${fancyColors.WHITE}${fullData.length} ${fancyColors.RESET}${fancyColors.BG_DARK_GREEN}tokens to process ${fancyColors.RESET}`);

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
                            logApi.warn(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.RED}Skipping token with missing required fields${fancyColors.RESET}`, {
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
                                logApi.warn(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.RED}SKIPPING TOKEN - Invalid Solana address: ${token.contractAddress}${fancyColors.RESET}`, {
                                    error: validationError.message,
                                    details: validationError.details
                                });
                                // Track validation failures
                                validationFailures++;
                                this.syncStats.validation.failures.addresses++;
                                continue; // Skip to next token
                            }
                            
                            // For other validation errors, log but continue with best effort
                            logApi.warn(`${fancyColors.MAGENTA}[tokenSyncService]${fancyColors.RESET} ${fancyColors.RED}Validation error for token ${token.contractAddress}: ${validationError.message}${fancyColors.RESET}`);
                            
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