// services/market-data/marketDataBatchProcessor.js

/**
 * Market Data Batch Processor
 * 
 * Manages the parallel processing of token data in batches and groups
 * to optimize API usage and respect rate limits.
 * 
 * @module marketDataBatchProcessor
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import { jupiterClient } from '../solana-engine/jupiter-client.js';
import { heliusClient } from '../solana-engine/helius-client.js';

// Configuration constants
const MAX_TOKENS_PER_BATCH = 100; // Jupiter API limit per request

class MarketDataBatchProcessor {
    constructor() {
        // Batch processing configuration
        this.PARALLEL_BATCHES_JUPITER_API = 10; // Process 10 batches in parallel (Jupiter API rate limit)
    }

    /**
     * Process a list of tokens in optimized batches
     * 
     * @param {Array} tokenSubset - Array of tokens to process
     * @param {Function} validateStringLength - Function to validate string lengths
     * @param {Function} sanitizeObject - Function to sanitize object data
     * @returns {Promise<Array>} - Results of batch processing
     */
    async processBatches(tokenSubset, validateStringLength, sanitizeObject) {
        // Use Jupiter's max supported batch size
        const batchSize = MAX_TOKENS_PER_BATCH;
        const totalBatches = Math.ceil(tokenSubset.length / batchSize);
        const totalGroups = Math.ceil(totalBatches / this.PARALLEL_BATCHES_JUPITER_API);
        
        // Log optimization details
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} OPTIMIZATION ${fancyColors.RESET} Processing ${totalBatches} batches in ${totalGroups} parallel groups (${this.PARALLEL_BATCHES_JUPITER_API} batches per group)`);
        
        const allBatchResults = [];
        
        // Process batches in groups to respect API rate limits
        for (let groupIndex = 0; groupIndex < totalGroups; groupIndex++) {
            const startBatch = groupIndex * this.PARALLEL_BATCHES_JUPITER_API;
            const endBatch = Math.min(startBatch + this.PARALLEL_BATCHES_JUPITER_API, totalBatches);
            const batchesInGroup = endBatch - startBatch;
            const groupTokenCount = Math.min(batchesInGroup * batchSize, tokenSubset.length - (startBatch * batchSize));
            
            const groupStartTime = Date.now();
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} BATCH GROUP ${groupIndex + 1}/${totalGroups} ${fancyColors.RESET} Processing ${batchesInGroup} batches (${groupTokenCount} tokens) in parallel`);
            
            // Create an array of promises for concurrent batch processing
            const batchPromises = [];
            
            // Queue up concurrent batch operations
            for (let batchIndex = startBatch; batchIndex < endBatch; batchIndex++) {
                batchPromises.push(this.processSingleBatch(batchIndex, tokenSubset, batchSize, totalBatches));
            }
            
            // Process all batches in this group concurrently and wait for results
            const batchResults = await Promise.all(batchPromises);
            
            // Calculate and log group processing time
            const groupEndTime = Date.now();
            const groupProcessingTime = groupEndTime - groupStartTime;
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Completed all ${batchesInGroup} batches in group ${groupIndex + 1} in ${(groupProcessingTime / 1000).toFixed(2)}s${fancyColors.RESET}`);
            
            // Add this group's results to the all results array
            allBatchResults.push(...batchResults);
            
            // Add a delay between groups to respect rate limits
            if (groupIndex < totalGroups - 1) {
                const waitTime = 1000; // 1 second wait between groups
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Rate limit protection: Waiting ${waitTime}ms before next group${fancyColors.RESET}`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        
        return allBatchResults;
    }

    /**
     * Process a single batch of tokens
     * 
     * @param {number} batchIndex - Index of the batch
     * @param {Array} tokenSubset - Array of all tokens
     * @param {number} batchSize - Size of each batch
     * @param {number} totalBatches - Total number of batches
     * @returns {Promise<Object>} - Batch processing results
     */
    async processSingleBatch(batchIndex, tokenSubset, batchSize, totalBatches) {
        try {
            const batchStartTime = Date.now();
            
            const batchStart = batchIndex * batchSize;
            const batchEnd = Math.min(batchStart + batchSize, tokenSubset.length);
            const batchTokens = tokenSubset.slice(batchStart, batchEnd);
            
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Starting batch ${batchIndex + 1}/${totalBatches} with ${batchTokens.length} tokens`);
            
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
                logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Batch ${batchIndex + 1}/${totalBatches}: Fetched metadata for ${tokenMetadata.length}/${tokenAddresses.length} tokens`);
            } catch (error) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Batch ${batchIndex + 1}/${totalBatches}: Error fetching metadata:${fancyColors.RESET}`, error.message);
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
                const priceCount = Object.keys(tokenPrices).length;
                logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Batch ${batchIndex + 1}/${totalBatches}: Fetched prices for ${priceCount}/${tokenAddresses.length} tokens`);
                
                // Only log sample fields for the first batch in group
                if (batchIndex % 10 === 0 && Object.keys(tokenPrices).length > 0) {
                    const sampleToken = Object.values(tokenPrices)[0];
                    logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}JUPITER SAMPLE DATA${fancyColors.RESET} price=${!!sampleToken.price}, market_cap=${!!sampleToken.marketCap}, volume_24h=${!!sampleToken.volume24h}, liquidity=${!!sampleToken.liquidity}`);
                }
            } catch (error) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Batch ${batchIndex + 1}/${totalBatches}: Error fetching prices:${fancyColors.RESET}`, error.message);
            }
            
            const fetchTime = Date.now() - batchStartTime;
            logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Batch ${batchIndex + 1}/${totalBatches}: Data fetch completed in ${fetchTime}ms`);
            
            return {
                batchIndex,
                batchTokens,
                metadataMap,
                tokenPrices,
                tokenAddresses,
                fetchTime
            };
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing batch ${batchIndex + 1}/${totalBatches}:${fancyColors.RESET}`, error);
            return {
                batchIndex,
                error: error.message,
                batchTokens: [],
                metadataMap: {},
                tokenPrices: {},
                tokenAddresses: []
            };
        }
    }

    /**
     * Helper method to clean token address
     * Removes quotes and ensures consistent format
     * 
     * @param {string} address - Token address to clean
     * @returns {string} - Cleaned address
     */
    cleanTokenAddress(address) {
        if (!address) return null;
        
        // Handle string addresses - remove quotes
        if (typeof address === 'string') {
            return address.replace(/^["']+|["']+$/g, '').replace(/\\"/g, '');
        }
        
        return address;
    }

    /**
     * Prepare validation functions for token data
     * @returns {Object} - Object with validation functions
     */
    getValidationFunctions() {
        // Add validation function to handle string field lengths
        const validateStringLength = (str, maxLength, defaultValue = '') => {
            if (!str) return defaultValue;
            // Clean control characters and invalid Unicode chars
            const cleanStr = String(str).replace(/[\x00-\x1F\x7F-\x9F\uFFFE\uFFFF]/g, '');
            return cleanStr.substring(0, maxLength);
        };
        
        // Helper function to safely clean object data
        const sanitizeObject = (obj) => {
            if (!obj) return null;
            try {
                // Test if object is serializeable without errors
                const serialized = JSON.stringify(obj);
                // If it passes, parse it back
                return JSON.parse(serialized);
            } catch (e) {
                // If serialization fails, create a new clean object
                const safeObj = {};
                for (const [key, value] of Object.entries(obj)) {
                    if (typeof value === 'string') {
                        // Replace invalid characters in strings
                        safeObj[key] = value.replace(/[\x00-\x1F\x7F-\x9F\uFFFE\uFFFF]/g, '');
                    } else if (typeof value === 'number' || value === null || value === undefined) {
                        safeObj[key] = value;
                    } else if (typeof value === 'object') {
                        // Recursively sanitize nested objects
                        safeObj[key] = sanitizeObject(value);
                    }
                }
                return safeObj;
            }
        };
        
        return {
            validateStringLength,
            sanitizeObject
        };
    }
}

// Create and export a singleton instance
const marketDataBatchProcessor = new MarketDataBatchProcessor();
export default marketDataBatchProcessor;