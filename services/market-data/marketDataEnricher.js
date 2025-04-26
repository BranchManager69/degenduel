// services/market-data/marketDataEnricher.js

/**
 * Market Data Enricher
 * 
 * Enhances token data with additional metrics from external sources like DexScreener.
 * Provides comprehensive token data across multiple timeframes.
 * 
 * @module marketDataEnricher
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import { dexscreenerClient } from '../solana-engine/dexscreener-client.js';

class MarketDataEnricher {
    constructor() {
        // Enhancement tracking
        this.enhancedData = new Map();
    }

    /**
     * Enhance token data with additional metrics from DexScreener
     * 
     * @param {Array} tokensToEnhance - Array of token objects to enhance
     * @param {Function} validateStringLength - Function to validate string length
     * @param {PrismaClient} marketDb - Database client
     * @returns {Promise<Map>} - Map of token IDs to enhanced metrics
     */
    async enhanceTokenData(tokensToEnhance, validateStringLength, marketDb) {
        try {
            if (!tokensToEnhance || tokensToEnhance.length === 0) {
                logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}No tokens provided for enhancement${fancyColors.RESET}`);
                return new Map();
            }
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GOLD} DEXSCREENER ${fancyColors.RESET} Getting rich data for ${tokensToEnhance.length} tokens (all timeframes)`);
            
            // Create a map of token addresses to tokens for easy lookup when processing results
            const tokenAddressMap = {};
            for (const token of tokensToEnhance) {
                tokenAddressMap[token.address] = token;
            }
            
            // Get all token addresses to fetch in a single array
            const tokenAddresses = tokensToEnhance.map(token => token.address);
            
            // Check if DexScreener client is initialized before making the request
            if (!dexscreenerClient.initialized) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}DexScreener client not initialized, initializing now...${fancyColors.RESET}`);
                await dexscreenerClient.initialize();
            }
            
            // If we have too many tokens, split into smaller batches to prevent request lock timeouts
            const MAX_BATCH_SIZE = 500; // Process at most 500 tokens at once to prevent locking issues
            const tokenBatches = [];
            
            for (let i = 0; i < tokenAddresses.length; i += MAX_BATCH_SIZE) {
                tokenBatches.push(tokenAddresses.slice(i, i + MAX_BATCH_SIZE));
            }
            
            // Process each batch with a delay between batches
            const allResults = {};
            for (let i = 0; i < tokenBatches.length; i++) {
                const batchAddresses = tokenBatches[i];
                
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GOLD} DEXSCREENER ${fancyColors.RESET} Processing batch ${i+1}/${tokenBatches.length} (${batchAddresses.length} tokens)`);
                
                // Use the batch processing method to efficiently fetch token data for this batch
                const batchResult = await dexscreenerClient.getMultipleTokenPools('solana', batchAddresses);
                
                // Merge results
                Object.assign(allResults, batchResult);
                
                // Add a delay between batches to prevent locking issues (only if more batches coming)
                if (i < tokenBatches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay between batches
                }
            }
            
            // Store the token pool results for processing
            const tokenPoolsResult = allResults;
            
            // Process the results
            let enhancedCount = 0;
            let failedCount = 0;
            
            // Reset enhanced data map
            this.enhancedData = new Map();
            
            // Helper function to safely parse floating point numbers
            const safeParseFloat = (val) => {
                if (!val) return null;
                try {
                    const parsed = parseFloat(val);
                    if (isNaN(parsed) || !isFinite(parsed)) return null;
                    return parsed.toString();
                } catch (e) {
                    return null;
                }
            };
            
            for (const [tokenAddress, poolData] of Object.entries(tokenPoolsResult)) {
                try {
                    const token = tokenAddressMap[tokenAddress];
                    
                    // Skip if no token matched (shouldn't happen, but just to be safe)
                    if (!token) continue;
                    
                    // Skip if no pool data or error occurred
                    if (!poolData || poolData.error || !poolData.pairs || !poolData.pairs.length) {
                        failedCount++;
                        continue;
                    }
                    
                    // Sort pools by liquidity
                    const sortedPools = poolData.pairs.sort((a, b) => {
                        const liquidityA = parseFloat(a.liquidity?.usd || '0');
                        const liquidityB = parseFloat(b.liquidity?.usd || '0');
                        return liquidityB - liquidityA;
                    });
                    
                    // Use the highest liquidity pool for metrics
                    const topPool = sortedPools[0];
                    
                    // Create comprehensive metrics object with all time periods
                    const enhancedMetrics = {
                        // Volume metrics for all time periods
                        volume_24h: safeParseFloat(topPool.volume?.h24),
                        volume_6h: safeParseFloat(topPool.volume?.h6),
                        volume_1h: safeParseFloat(topPool.volume?.h1),
                        volume_5m: safeParseFloat(topPool.volume?.m5),
                        
                        // Price change metrics for all time periods
                        change_24h: safeParseFloat(topPool.priceChange?.h24),
                        change_6h: safeParseFloat(topPool.priceChange?.h6),
                        change_1h: safeParseFloat(topPool.priceChange?.h1),
                        change_5m: safeParseFloat(topPool.priceChange?.m5),
                        
                        // Liquidity and market cap
                        liquidity: safeParseFloat(topPool.liquidity?.usd),
                        market_cap: safeParseFloat(topPool.marketCap),
                        fdv: safeParseFloat(topPool.fdv),
                        
                        // Additional metadata
                        dex: topPool.dexId ? validateStringLength(topPool.dexId, 50) : null,
                        pair_address: topPool.pairAddress ? validateStringLength(topPool.pairAddress, 100) : null,
                        last_updated: new Date().toISOString()
                    };
                    
                    // Store enhanced metrics
                    this.enhancedData.set(token.id, enhancedMetrics);
                    enhancedCount++;
                    
                    // Also update our database with this comprehensive data
                    if (marketDb) {
                        try {
                            await marketDb.token_prices.update({
                                where: { token_id: token.id },
                                data: {
                                    volume_24h: enhancedMetrics.volume_24h,
                                    volume_6h: enhancedMetrics.volume_6h,
                                    volume_1h: enhancedMetrics.volume_1h,
                                    volume_5m: enhancedMetrics.volume_5m,
                                    change_24h: enhancedMetrics.change_24h,
                                    change_6h: enhancedMetrics.change_6h,
                                    change_1h: enhancedMetrics.change_1h,
                                    change_5m: enhancedMetrics.change_5m,
                                    liquidity: enhancedMetrics.liquidity,
                                    market_cap: enhancedMetrics.market_cap,
                                    fdv: enhancedMetrics.fdv,
                                    updated_at: new Date()
                                }
                            });
                        } catch (dbError) {
                            // If database update fails, we still have the enhanced data for this run
                            logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Could not update token_prices table with DexScreener data:${fancyColors.RESET} ${dbError.message}`);
                        }
                    }
                    
                } catch (enhancementError) {
                    failedCount++;
                    const token = tokenAddressMap[tokenAddress];
                    const symbol = token ? token.symbol : tokenAddress.substring(0, 8);
                    logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Could not enhance token ${symbol}:${fancyColors.RESET} ${enhancementError.message}`);
                }
            }
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} DexScreener enhancement completed: ${enhancedCount} tokens enhanced, ${failedCount} tokens failed`);
            
            return this.enhancedData;
        } catch (error) {
            logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Error enhancing tokens with DexScreener:${fancyColors.RESET} ${error.message}`);
            return new Map();
        }
    }

    /**
     * Get enhanced metric for a token
     * @param {number} tokenId - Token ID
     * @param {string} metricName - Name of the metric
     * @returns {string|null} - Metric value or null if not available
     */
    getEnhancedMetric(tokenId, metricName) {
        const metrics = this.enhancedData.get(tokenId);
        if (!metrics) return null;
        return metrics[metricName] || null;
    }

    /**
     * Check if a token has enhanced data
     * @param {number} tokenId - Token ID
     * @returns {boolean} - True if token has enhanced data
     */
    hasEnhancedData(tokenId) {
        return this.enhancedData.has(tokenId);
    }

    /**
     * Reset enhanced data
     */
    resetEnhancedData() {
        this.enhancedData = new Map();
    }
}

// Create and export a singleton instance
const marketDataEnricher = new MarketDataEnricher();
export default marketDataEnricher;