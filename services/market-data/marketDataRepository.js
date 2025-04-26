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
}

// Create and export a singleton instance
const marketDataRepository = new MarketDataRepository();
export default marketDataRepository;