// services/market-data/marketDataRepository.js

/**
 * Market Data Repository
 * 
 * Centralizes all database operations related to token data updates.
 * Provides optimized batch methods for token updates, price records, and related data.
 * 
 * @module marketDataRepository
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import tokenHistoryFunctions from '../token-history-functions.js';

class MarketDataRepository {
    constructor() {
        // Batch sizes for optimized database operations
        this.TOKEN_UPDATE_BATCH_SIZE = 100;
        this.TOKEN_CREATE_BATCH_SIZE = 50;
        this.PRICE_UPDATE_BATCH_SIZE = 100;
        this.HISTORY_BATCH_SIZE = 200;
        this.WEBSITE_BATCH_SIZE = 100;
        this.SOCIAL_BATCH_SIZE = 100;
    }
    
    /**
     * Get all existing tokens from the database
     * @param {PrismaClient} marketDb - The database client
     * @returns {Promise<Array>} - Array of tokens with their details
     */
    async getExistingTokens(marketDb) {
        try {
            // Query all tokens with their basic details
            const tokens = await marketDb.tokens.findMany({
                select: {
                    id: true,
                    address: true,
                    symbol: true,
                    name: true,
                    token_prices: {
                        select: {
                            price: true,
                            market_cap: true,
                            liquidity: true
                        }
                    }
                }
            });
            
            return tokens;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting existing tokens:${fancyColors.RESET}`, error);
            return [];
        }
    }
    
    /**
     * Create a map of tokens by address for fast lookup
     * @param {Array} tokens - Array of tokens from the database
     * @returns {Object} - Map of tokens with address as the key
     */
    createTokenMap(tokens) {
        const tokenMap = {};
        
        if (!tokens || tokens.length === 0) {
            return tokenMap;
        }
        
        // Create a map for fast token lookup by address
        for (const token of tokens) {
            if (token.address) {
                tokenMap[token.address] = {
                    id: token.id,
                    address: token.address,
                    symbol: token.symbol || '',
                    name: token.name || '',
                    price: token.token_prices?.price || null,
                    marketCap: token.token_prices?.market_cap || null,
                    liquidity: token.token_prices?.liquidity || null
                };
            }
        }
        
        return tokenMap;
    }

    /**
     * Process batch updates for tokens in database
     * 
     * @param {Array} tokenUpdates - Array of token updates
     * @param {Object} existingTokenMap - Map of existing tokens
     * @param {PrismaClient} marketDb - Database client
     * @returns {Promise<number>} - Number of updated tokens
     */
    async processTokenUpdates(tokenUpdates, existingTokenMap, marketDb) {
        let updatedCount = 0;
        
        if (tokenUpdates.length === 0) {
            return updatedCount;
        }
        
        // Process in smaller batches
        for (let i = 0; i < tokenUpdates.length; i += this.TOKEN_UPDATE_BATCH_SIZE) {
            const updateBatch = tokenUpdates.slice(i, i + this.TOKEN_UPDATE_BATCH_SIZE);
            
            await marketDb.$transaction(async (tx) => {
                for (const update of updateBatch) {
                    await tx.tokens.update({
                        where: { id: update.id },
                        data: update.data
                    });
                }
                
                // Get token symbols for logging context
                const updatedTokenSymbols = updateBatch.map(update => 
                    existingTokenMap[update.data.address]?.symbol || update.data.symbol || update.data.address.substring(0, 8)
                ).slice(0, 5);
                
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Completed ${updateBatch.length} token updates${fancyColors.RESET}${updateBatch.length > 0 ? ` ${fancyColors.DARK_GRAY}(examples: ${updatedTokenSymbols.slice(0, 3).join(', ')}${updateBatch.length > 3 ? '...' : ''})${fancyColors.RESET}` : ''}`);
            }, { 
                timeout: 30000 // Increased timeout to 30 seconds to handle larger batch of 100 tokens
            });
            
            updatedCount += updateBatch.length;
        }
        
        return updatedCount;
    }

    /**
     * Process batch creations for new tokens in database
     * 
     * @param {Array} tokenCreates - Array of token creations
     * @param {Object} existingTokenMap - Map to store existing tokens
     * @param {Function} validateStringLength - Function to validate string length
     * @param {PrismaClient} marketDb - Database client
     * @returns {Promise<number>} - Number of created tokens
     */
    async processTokenCreations(tokenCreates, existingTokenMap, validateStringLength, marketDb) {
        let createdCount = 0;
        
        if (tokenCreates.length === 0) {
            return createdCount;
        }
        
        // Process in batches to limit connection time
        for (let i = 0; i < tokenCreates.length; i += this.TOKEN_CREATE_BATCH_SIZE) {
            const createBatch = tokenCreates.slice(i, i + this.TOKEN_CREATE_BATCH_SIZE);
            
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
                    }, {
                        timeout: 20000 // Increase timeout to 20 seconds for token creation
                    });
                    
                    createdCount++;
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
        
        return createdCount;
    }

    /**
     * Process batch updates for token prices in database
     * 
     * @param {Array} priceUpdates - Array of price updates
     * @param {Object} existingTokenMap - Map of existing tokens
     * @param {PrismaClient} marketDb - Database client
     * @returns {Promise<number>} - Number of updated prices
     */
    async processPriceUpdates(priceUpdates, existingTokenMap, marketDb) {
        let updatedCount = 0;
        
        if (priceUpdates.length === 0) {
            return updatedCount;
        }
        
        // Process in batches
        for (let i = 0; i < priceUpdates.length; i += this.PRICE_UPDATE_BATCH_SIZE) {
            const priceBatch = priceUpdates.slice(i, i + this.PRICE_UPDATE_BATCH_SIZE);
            
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
            
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Completed batch of ${priceBatch.length} price updates`);
            updatedCount += priceBatch.length;
        }
        
        return updatedCount;
    }

    /**
     * Process batch creations for token price history
     * 
     * @param {Array} historyRecords - Array of history records
     * @param {PrismaClient} marketDb - Database client
     * @returns {Promise<number>} - Number of created history records
     */
    async processHistoryRecords(historyRecords, marketDb) {
        let createdCount = 0;
        
        if (historyRecords.length === 0) {
            return createdCount;
        }
        
        // Process in batches
        for (let i = 0; i < historyRecords.length; i += this.HISTORY_BATCH_SIZE) {
            const historyBatch = historyRecords.slice(i, i + this.HISTORY_BATCH_SIZE);
            
            await marketDb.token_price_history.createMany({
                data: historyBatch
            });
            
            createdCount += historyBatch.length;
        }
        
        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Created ${createdCount} price history records`);
        return createdCount;
    }
    
    /**
     * Handle price updates from various sources
     * @param {Object} priceData - Object with token prices
     * @param {PrismaClient} marketDb - Database client
     * @param {Function} recordPriceHistory - Function to record price history
     * @returns {Promise<number>} - Number of updated prices
     */
    async handlePriceUpdate(priceData, marketDb, recordPriceHistory) {
        let updatedCount = 0;
        
        try {
            if (!priceData || Object.keys(priceData).length === 0) {
                return updatedCount;
            }
            
            // Process each token's price update individually
            for (const [tokenId, priceInfo] of Object.entries(priceData)) {
                try {
                    // Validate token ID
                    const id = parseInt(tokenId, 10);
                    if (isNaN(id)) {
                        logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Invalid token ID for price update: ${tokenId}${fancyColors.RESET}`);
                        continue;
                    }
                    
                    // Build price update data
                    const updateData = {};
                    
                    // Handle different price data formats
                    if (typeof priceInfo === 'number' || typeof priceInfo === 'string') {
                        // Simple price value
                        updateData.price = priceInfo.toString();
                    } else if (typeof priceInfo === 'object' && priceInfo !== null) {
                        // Object with price and possibly other fields
                        if (priceInfo.price !== undefined) {
                            updateData.price = priceInfo.price.toString();
                        }
                        
                        // Add other fields if present
                        if (priceInfo.change_24h !== undefined) updateData.change_24h = priceInfo.change_24h;
                        if (priceInfo.market_cap !== undefined) updateData.market_cap = priceInfo.market_cap;
                        if (priceInfo.fdv !== undefined) updateData.fdv = priceInfo.fdv;
                        if (priceInfo.liquidity !== undefined) updateData.liquidity = priceInfo.liquidity;
                        if (priceInfo.volume_24h !== undefined) updateData.volume_24h = priceInfo.volume_24h;
                    }
                    
                    // Only update if we have data
                    if (Object.keys(updateData).length > 0) {
                        // Update token price
                        await marketDb.token_prices.upsert({
                            where: { token_id: id },
                            update: updateData,
                            create: {
                                token_id: id,
                                ...updateData
                            }
                        });
                        
                        // Record price history if we have a price and callback function
                        if (updateData.price && typeof recordPriceHistory === 'function') {
                            await recordPriceHistory(id, updateData.price, 'manual_update');
                        }
                        
                        updatedCount++;
                    }
                } catch (updateError) {
                    logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error updating price for token ${tokenId}:${fancyColors.RESET}`, updateError);
                }
            }
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Updated prices for ${updatedCount} tokens`);
            return updatedCount;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error handling price updates:${fancyColors.RESET}`, error);
            return updatedCount;
        }
    }

    /**
     * Process batch updates for token websites
     * 
     * @param {Array} websiteUpdates - Array of website updates
     * @param {PrismaClient} marketDb - Database client
     * @returns {Promise<number>} - Number of updated websites
     */
    async processWebsiteUpdates(websiteUpdates, marketDb) {
        let updatedCount = 0;
        
        if (websiteUpdates.length === 0) {
            return updatedCount;
        }
        
        // Process in batches
        for (let i = 0; i < websiteUpdates.length; i += this.WEBSITE_BATCH_SIZE) {
            const websiteBatch = websiteUpdates.slice(i, i + this.WEBSITE_BATCH_SIZE);
            
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
                        
                        updatedCount++;
                    } catch (error) {
                        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Error processing website update: ${error.message}`);
                    }
                }
            });
            
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Processed batch of ${websiteBatch.length} website updates`);
        }
        
        return updatedCount;
    }

    /**
     * Process batch updates for token social links
     * 
     * @param {Array} socialUpdates - Array of social updates
     * @param {PrismaClient} marketDb - Database client
     * @returns {Promise<number>} - Number of updated social links
     */
    async processSocialUpdates(socialUpdates, marketDb) {
        let updatedCount = 0;
        
        if (socialUpdates.length === 0) {
            return updatedCount;
        }
        
        // Process in batches
        for (let i = 0; i < socialUpdates.length; i += this.SOCIAL_BATCH_SIZE) {
            const socialBatch = socialUpdates.slice(i, i + this.SOCIAL_BATCH_SIZE);
            
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
                        
                        updatedCount++;
                    } catch (error) {
                        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Error processing social update: ${error.message}`);
                    }
                }
            });
            
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Processed batch of ${socialBatch.length} social updates`);
        }
        
        return updatedCount;
    }

    /**
     * Update token website with length validation
     * @param {number} tokenId - The token ID
     * @param {object} website - Website object with URL and label
     * @param {PrismaClient} marketDb - Database client
     * @returns {Promise<boolean>} - Success status
     */
    async updateTokenWebsite(tokenId, website, marketDb) {
        try {
            // Validate and truncate URL to prevent database errors
            const validUrl = website.url ? website.url.toString().substring(0, 255) : null;
            
            if (!validUrl) {
                return false; // Skip if URL is invalid or empty after validation
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
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error updating token website:${fancyColors.RESET}`, error);
            return false;
        }
    }

    /**
     * Update token social with length validation
     * @param {number} tokenId - The token ID
     * @param {object} social - Social object with URL and type
     * @param {PrismaClient} marketDb - Database client
     * @returns {Promise<boolean>} - Success status
     */
    async updateTokenSocial(tokenId, social, marketDb) {
        try {
            // Validate and truncate URL to prevent database errors
            const validUrl = social.url ? social.url.toString().substring(0, 255) : null;
            
            if (!validUrl) {
                return false; // Skip if URL is invalid or empty after validation
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
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error updating token social:${fancyColors.RESET}`, error);
            return false;
        }
    }

    /**
     * Create comprehensive token history records
     * @param {Array} tokensForHistory - Array of tokens with price data
     * @param {string} source - Source of the data
     * @returns {Promise<number>} - Number of history records created
     */
    async createComprehensiveHistory(tokensForHistory, source = 'jupiter_api') {
        try {
            if (!tokensForHistory || tokensForHistory.length === 0) {
                return 0;
            }
            
            // Process in batches for optimization
            const BATCH_SIZE = 100;
            let totalProcessed = 0;
            
            for (let i = 0; i < tokensForHistory.length; i += BATCH_SIZE) {
                const historyBatch = tokensForHistory.slice(i, i + BATCH_SIZE);
                
                // Use our comprehensive history function to save all metrics at once
                await tokenHistoryFunctions.recordComprehensiveTokenHistory(historyBatch, source);
                totalProcessed += historyBatch.length;
            }
            
            return totalProcessed;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error creating comprehensive history:${fancyColors.RESET}`, error);
            return 0;
        }
    }
    
    /**
     * Record token history for multiple tokens
     * @param {Array} tokensForHistory - Array of tokens to record history for
     * @param {Object} historyFunctions - Object with history recording functions
     * @returns {Promise<number>} - Number of tokens processed
     */
    async recordTokenHistory(tokensForHistory, historyFunctions) {
        try {
            if (!tokensForHistory || tokensForHistory.length === 0 || !historyFunctions) {
                return 0;
            }
            
            // Process in batches for better performance
            const BATCH_SIZE = 100;
            let totalProcessed = 0;
            
            for (let i = 0; i < tokensForHistory.length; i += BATCH_SIZE) {
                const historyBatch = tokensForHistory.slice(i, i + BATCH_SIZE);
                
                try {
                    // Use the provided history functions to record token data
                    await historyFunctions.recordComprehensiveTokenHistory(historyBatch, 'jupiter_api');
                    totalProcessed += historyBatch.length;
                } catch (batchError) {
                    logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error recording history batch:${fancyColors.RESET}`, batchError);
                }
            }
            
            if (totalProcessed > 0) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded history for ${totalProcessed} tokens`);
            }
            
            return totalProcessed;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error recording token history:${fancyColors.RESET}`, error);
            return 0;
        }
    }
    
    /**
     * Record price history in batch for multiple tokens
     * @param {Array} priceHistoryRecords - Array of price history records
     * @param {PrismaClient} marketDb - Database client
     * @returns {Promise<number>} - Number of records created
     */
    async recordPriceHistoryBatch(priceHistoryRecords, marketDb) {
        try {
            if (!priceHistoryRecords || priceHistoryRecords.length === 0) {
                return 0;
            }
            
            // Format the records for database insertion
            const records = priceHistoryRecords.map(record => ({
                token_id: record.tokenId,
                price: record.price.toString(),
                source: record.source || 'system',
                timestamp: record.timestamp || new Date()
            }));
            
            // Use createMany for efficient bulk insertion
            const result = await marketDb.token_price_history.createMany({
                data: records,
                skipDuplicates: true // Skip if exact duplicate exists
            });
            
            return result.count;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error recording price history batch:${fancyColors.RESET}`, error);
            return 0;
        }
    }
}

// Create and export a singleton instance
const marketDataRepository = new MarketDataRepository();
export default marketDataRepository;