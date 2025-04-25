// services/token-history-functions.js

/**
 * This module contains functions for recording historical token metrics
 * including price, volume, liquidity, and market cap.
 * 
 * These functions are designed to be imported and used by the marketDataService.js
 * to add comprehensive historical data tracking.
 */

import { PrismaClient } from '@prisma/client';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';

// Initialize direct connection to Database
const marketDb = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL
});

/**
 * Records a batch of volume history records for multiple tokens
 * @param {Array} volumeHistoryRecords - Array of volume records to save
 * @returns {Promise<boolean>} - Success/failure
 */
export async function recordVolumeHistoryBatch(volumeHistoryRecords) {
    try {
        if (!volumeHistoryRecords || !Array.isArray(volumeHistoryRecords) || volumeHistoryRecords.length === 0) {
            return false;
        }
        
        // Prepare data for bulk insert, now including timeframe
        const dataToInsert = volumeHistoryRecords.map(record => ({
            token_id: record.tokenId,
            volume: record.volume,
            volume_usd: record.volumeUsd || record.volume, // Use volume as default if volumeUsd not provided
            change_24h: record.change24h,
            timeframe: record.timeframe || '24h', // Default to 24h if not specified
            source: record.source || 'jupiter_api',
            snapshot_id: record.snapshotId || new Date().toISOString(),
            timestamp: new Date()
        }));
        
        // Use createMany to insert all records in a single database operation
        await marketDb.token_volume_history.createMany({
            data: dataToInsert
        });
        
        // Group and log by timeframe
        const timeframeStats = {};
        dataToInsert.forEach(record => {
            const tf = record.timeframe || '24h';
            timeframeStats[tf] = (timeframeStats[tf] || 0) + 1;
        });
        
        const timeframeSummary = Object.entries(timeframeStats)
            .map(([tf, count]) => `${tf}:${count}`)
            .join(', ');
            
        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded ${dataToInsert.length} volume history records in batch (${timeframeSummary})`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error batch recording volume history:${fancyColors.RESET}`, error);
        return false;
    }
}

/**
 * Records a batch of liquidity history records for multiple tokens
 * @param {Array} liquidityHistoryRecords - Array of liquidity records to save
 * @returns {Promise<boolean>} - Success/failure
 */
export async function recordLiquidityHistoryBatch(liquidityHistoryRecords) {
    try {
        if (!liquidityHistoryRecords || !Array.isArray(liquidityHistoryRecords) || liquidityHistoryRecords.length === 0) {
            return false;
        }
        
        // Prepare data for bulk insert, now including timeframe
        const dataToInsert = liquidityHistoryRecords.map(record => ({
            token_id: record.tokenId,
            liquidity: record.liquidity,
            change_24h: record.change24h,
            timeframe: record.timeframe || '24h', // Default to 24h if not specified
            source: record.source || 'jupiter_api',
            snapshot_id: record.snapshotId || new Date().toISOString(),
            timestamp: new Date()
        }));
        
        // Use createMany to insert all records in a single database operation
        await marketDb.token_liquidity_history.createMany({
            data: dataToInsert
        });
        
        // Group and log by timeframe
        const timeframeStats = {};
        dataToInsert.forEach(record => {
            const tf = record.timeframe || '24h';
            timeframeStats[tf] = (timeframeStats[tf] || 0) + 1;
        });
        
        const timeframeSummary = Object.entries(timeframeStats)
            .map(([tf, count]) => `${tf}:${count}`)
            .join(', ');
            
        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded ${dataToInsert.length} liquidity history records in batch (${timeframeSummary})`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error batch recording liquidity history:${fancyColors.RESET}`, error);
        return false;
    }
}

/**
 * Records a batch of market cap history records for multiple tokens
 * @param {Array} marketCapHistoryRecords - Array of market cap records to save
 * @returns {Promise<boolean>} - Success/failure
 */
export async function recordMarketCapHistoryBatch(marketCapHistoryRecords) {
    try {
        if (!marketCapHistoryRecords || !Array.isArray(marketCapHistoryRecords) || marketCapHistoryRecords.length === 0) {
            return false;
        }
        
        // Prepare data for bulk insert, now including timeframe
        const dataToInsert = marketCapHistoryRecords.map(record => ({
            token_id: record.tokenId,
            market_cap: record.marketCap,
            fdv: record.fdv, // Fully diluted valuation
            change_24h: record.change24h,
            timeframe: record.timeframe || '24h', // Default to 24h if not specified
            source: record.source || 'jupiter_api',
            snapshot_id: record.snapshotId || new Date().toISOString(),
            timestamp: new Date()
        }));
        
        // Use createMany to insert all records in a single database operation
        await marketDb.token_market_cap_history.createMany({
            data: dataToInsert
        });
        
        // Group and log by timeframe
        const timeframeStats = {};
        dataToInsert.forEach(record => {
            const tf = record.timeframe || '24h';
            timeframeStats[tf] = (timeframeStats[tf] || 0) + 1;
        });
        
        const timeframeSummary = Object.entries(timeframeStats)
            .map(([tf, count]) => `${tf}:${count}`)
            .join(', ');
            
        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded ${dataToInsert.length} market cap history records in batch (${timeframeSummary})`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error batch recording market cap history:${fancyColors.RESET}`, error);
        return false;
    }
}

/**
 * Records a batch of rank history records for multiple tokens
 * @param {Array} rankHistoryRecords - Array of rank records to save
 * @returns {Promise<boolean>} - Success/failure
 */
export async function recordRankHistoryBatch(rankHistoryRecords) {
    try {
        if (!rankHistoryRecords || !Array.isArray(rankHistoryRecords) || rankHistoryRecords.length === 0) {
            return false;
        }
        
        // Prepare data for bulk insert, now including timeframe
        const dataToInsert = rankHistoryRecords.map(record => ({
            token_id: record.tokenId,
            rank: record.rank,
            timeframe: record.timeframe || '24h', // Default to 24h if not specified
            source: record.source || 'jupiter_api',
            snapshot_id: record.snapshotId || new Date().toISOString(),
            timestamp: new Date()
        }));
        
        // Use createMany to insert all records in a single database operation
        await marketDb.token_rank_history.createMany({
            data: dataToInsert
        });
        
        // Group and log by timeframe
        const timeframeStats = {};
        dataToInsert.forEach(record => {
            const tf = record.timeframe || '24h';
            timeframeStats[tf] = (timeframeStats[tf] || 0) + 1;
        });
        
        const timeframeSummary = Object.entries(timeframeStats)
            .map(([tf, count]) => `${tf}:${count}`)
            .join(', ');
            
        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded ${dataToInsert.length} rank history records in batch (${timeframeSummary})`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error batch recording rank history:${fancyColors.RESET}`, error);
        return false;
    }
}

/**
 * Utility function to create a batch snapshot ID
 * @returns {string} - Unique snapshot ID for grouping updates
 */
export function createSnapshotId() {
    return `snapshot_${new Date().toISOString()}`;
}

/**
 * Records comprehensive history for a batch of tokens, including
 * price, volume, liquidity, market cap, and rank
 * @param {Array} tokens - Array of token data objects with all metrics
 * @param {string} source - Source of the data
 * @returns {Promise<boolean>} - Success/failure
 */
export async function recordComprehensiveTokenHistory(tokens, source = 'jupiter_api') {
    try {
        if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
            return false;
        }
        
        // Generate a common snapshot ID for all records in this batch
        const snapshotId = createSnapshotId();
        
        // Prepare history records for each metric
        const priceHistoryRecords = [];
        const volumeHistoryRecords = [];
        const liquidityHistoryRecords = [];
        const marketCapHistoryRecords = [];
        const rankHistoryRecords = [];
        
        // Process each token and prepare records for batch insertion
        tokens.forEach((token, index) => {
            if (token.id && token.address) {
                // Price history
                if (token.price) {
                    priceHistoryRecords.push({
                        tokenId: token.id,
                        price: token.price,
                        source,
                        snapshotId
                    });
                }
                
                // Volume history (capturing all timeframes)
                if (token.volume_24h) {
                    // Create standard 24h volume record
                    volumeHistoryRecords.push({
                        tokenId: token.id,
                        volume: token.volume_24h,
                        volumeUsd: token.volume_24h, // Jupiter already gives USD volume
                        change24h: token.change_24h || token.priceChange24h, // Use change_24h or fall back to priceChange24h
                        timeframe: '24h', // Track the timeframe explicitly
                        source,
                        snapshotId
                    });
                    
                    // Also track additional timeframes if available (from DexScreener enhanced data)
                    if (token.volume_6h) {
                        volumeHistoryRecords.push({
                            tokenId: token.id,
                            volume: token.volume_6h,
                            volumeUsd: token.volume_6h,
                            change24h: token.change_6h || null,
                            timeframe: '6h',
                            source,
                            snapshotId
                        });
                    }
                    
                    if (token.volume_1h) {
                        volumeHistoryRecords.push({
                            tokenId: token.id,
                            volume: token.volume_1h,
                            volumeUsd: token.volume_1h,
                            change24h: token.change_1h || null,
                            timeframe: '1h',
                            source,
                            snapshotId
                        });
                    }
                    
                    if (token.volume_5m) {
                        volumeHistoryRecords.push({
                            tokenId: token.id,
                            volume: token.volume_5m,
                            volumeUsd: token.volume_5m,
                            change24h: token.change_5m || null,
                            timeframe: '5m',
                            source,
                            snapshotId
                        });
                    }
                }
                
                // Liquidity history (with timeframe support)
                if (token.liquidity) {
                    // Standard 24h liquidity record
                    liquidityHistoryRecords.push({
                        tokenId: token.id,
                        liquidity: token.liquidity,
                        change24h: null, // We don't have liquidity change, so use null
                        timeframe: '24h',
                        source,
                        snapshotId
                    });
                    
                    // Also track additional timeframes if available (from DexScreener enhanced data)
                    if (token.liquidity_6h) {
                        liquidityHistoryRecords.push({
                            tokenId: token.id,
                            liquidity: token.liquidity_6h,
                            change24h: null,
                            timeframe: '6h',
                            source,
                            snapshotId
                        });
                    }
                    
                    if (token.liquidity_1h) {
                        liquidityHistoryRecords.push({
                            tokenId: token.id,
                            liquidity: token.liquidity_1h,
                            change24h: null,
                            timeframe: '1h',
                            source,
                            snapshotId
                        });
                    }
                }
                
                // Market cap history (with timeframe support)
                if (token.market_cap) {
                    // Standard 24h market cap record
                    marketCapHistoryRecords.push({
                        tokenId: token.id,
                        marketCap: token.market_cap,
                        fdv: token.fdv,
                        change24h: null, // We don't have market cap change, so use null
                        timeframe: '24h',
                        source,
                        snapshotId
                    });
                    
                    // Also track additional timeframes if available (from DexScreener enhanced data)
                    if (token.market_cap_6h) {
                        marketCapHistoryRecords.push({
                            tokenId: token.id,
                            marketCap: token.market_cap_6h,
                            fdv: token.fdv_6h || token.fdv,
                            change24h: null,
                            timeframe: '6h',
                            source,
                            snapshotId
                        });
                    }
                    
                    if (token.market_cap_1h) {
                        marketCapHistoryRecords.push({
                            tokenId: token.id,
                            marketCap: token.market_cap_1h,
                            fdv: token.fdv_1h || token.fdv,
                            change24h: null,
                            timeframe: '1h',
                            source,
                            snapshotId
                        });
                    }
                }
                
                // Rank history (with timeframe support)
                rankHistoryRecords.push({
                    tokenId: token.id,
                    rank: index + 1, // Add 1 because arrays are zero-indexed
                    timeframe: '24h', // Ranks are typically 24h based
                    source,
                    snapshotId
                });
                
                // Add rank for other timeframes if we ever implement this
                if (token.rank_6h) {
                    rankHistoryRecords.push({
                        tokenId: token.id,
                        rank: token.rank_6h,
                        timeframe: '6h',
                        source,
                        snapshotId
                    });
                }
                
                if (token.rank_1h) {
                    rankHistoryRecords.push({
                        tokenId: token.id,
                        rank: token.rank_1h,
                        timeframe: '1h',
                        source, 
                        snapshotId
                    });
                }
            }
        });
        
        // Record all history in parallel using Promise.all
        await Promise.all([
            // Only call the batch functions if there are records to save
            priceHistoryRecords.length > 0 ? 
                marketDb.token_price_history.createMany({ data: priceHistoryRecords.map(r => ({
                    token_id: r.tokenId,
                    price: r.price,
                    source: r.source,
                    timestamp: new Date()
                })) }) : Promise.resolve(),
                
            volumeHistoryRecords.length > 0 ? 
                recordVolumeHistoryBatch(volumeHistoryRecords) : Promise.resolve(),
                
            liquidityHistoryRecords.length > 0 ? 
                recordLiquidityHistoryBatch(liquidityHistoryRecords) : Promise.resolve(),
                
            marketCapHistoryRecords.length > 0 ? 
                recordMarketCapHistoryBatch(marketCapHistoryRecords) : Promise.resolve(),
                
            rankHistoryRecords.length > 0 ? 
                recordRankHistoryBatch(rankHistoryRecords) : Promise.resolve()
        ]);
        
        // Calculate percentages of tokens with each type of data
        const pricePercent = tokens.length > 0 ? Math.round((priceHistoryRecords.length / tokens.length) * 100) : 0;
        const volumePercent = tokens.length > 0 ? Math.round((volumeHistoryRecords.length / tokens.length) * 100) : 0;
        const liquidityPercent = tokens.length > 0 ? Math.round((liquidityHistoryRecords.length / tokens.length) * 100) : 0;
        const marketCapPercent = tokens.length > 0 ? Math.round((marketCapHistoryRecords.length / tokens.length) * 100) : 0;
        const rankPercent = tokens.length > 0 ? Math.round((rankHistoryRecords.length / tokens.length) * 100) : 0;
        
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GREEN}Recorded comprehensive history for ${tokens.length} tokens:${fancyColors.RESET}`);
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} - Price: ${priceHistoryRecords.length} entries (${pricePercent}% of tokens)`);
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} - Volume: ${volumeHistoryRecords.length} entries (${volumePercent}% of tokens)`);
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} - Liquidity: ${liquidityHistoryRecords.length} entries (${liquidityPercent}% of tokens)`);
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} - Market Cap: ${marketCapHistoryRecords.length} entries (${marketCapPercent}% of tokens)`);
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} - Rank: ${rankHistoryRecords.length} entries (${rankPercent}% of tokens)`);
        
        // Sample top tokens with/without data for debugging
        if (tokens.length > 0) {
            const tokensWithVolume = tokens.filter(t => t.volume_24h).map(t => t.symbol || t.address.substring(0, 8)).slice(0, 3);
            const tokensWithoutVolume = tokens.filter(t => !t.volume_24h).map(t => t.symbol || t.address.substring(0, 8)).slice(0, 3);
            
            if (tokensWithVolume.length > 0) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GREEN}Sample tokens WITH volume data:${fancyColors.RESET} ${tokensWithVolume.join(', ')}`);
            }
            
            if (tokensWithoutVolume.length > 0) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Sample tokens WITHOUT volume data:${fancyColors.RESET} ${tokensWithoutVolume.join(', ')}`);
            }
        }
        
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error recording comprehensive token history:${fancyColors.RESET}`, error);
        return false;
    }
}

// Export the utility functions for use in marketDataService.js
export default {
    recordVolumeHistoryBatch,
    recordLiquidityHistoryBatch,
    recordMarketCapHistoryBatch,
    recordRankHistoryBatch,
    recordComprehensiveTokenHistory,
    createSnapshotId
};