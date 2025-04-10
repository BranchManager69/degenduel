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
        
        // Prepare data for bulk insert
        const dataToInsert = volumeHistoryRecords.map(record => ({
            token_id: record.tokenId,
            volume: record.volume,
            volume_usd: record.volumeUsd || record.volume, // Use volume as default if volumeUsd not provided
            change_24h: record.change24h,
            source: record.source || 'jupiter_api',
            snapshot_id: record.snapshotId || new Date().toISOString(),
            timestamp: new Date()
        }));
        
        // Use createMany to insert all records in a single database operation
        await marketDb.token_volume_history.createMany({
            data: dataToInsert
        });
        
        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded ${dataToInsert.length} volume history records in batch`);
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
        
        // Prepare data for bulk insert
        const dataToInsert = liquidityHistoryRecords.map(record => ({
            token_id: record.tokenId,
            liquidity: record.liquidity,
            change_24h: record.change24h,
            source: record.source || 'jupiter_api',
            snapshot_id: record.snapshotId || new Date().toISOString(),
            timestamp: new Date()
        }));
        
        // Use createMany to insert all records in a single database operation
        await marketDb.token_liquidity_history.createMany({
            data: dataToInsert
        });
        
        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded ${dataToInsert.length} liquidity history records in batch`);
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
        
        // Prepare data for bulk insert
        const dataToInsert = marketCapHistoryRecords.map(record => ({
            token_id: record.tokenId,
            market_cap: record.marketCap,
            fdv: record.fdv, // Fully diluted valuation
            change_24h: record.change24h,
            source: record.source || 'jupiter_api',
            snapshot_id: record.snapshotId || new Date().toISOString(),
            timestamp: new Date()
        }));
        
        // Use createMany to insert all records in a single database operation
        await marketDb.token_market_cap_history.createMany({
            data: dataToInsert
        });
        
        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded ${dataToInsert.length} market cap history records in batch`);
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
        
        // Prepare data for bulk insert
        const dataToInsert = rankHistoryRecords.map(record => ({
            token_id: record.tokenId,
            rank: record.rank,
            source: record.source || 'jupiter_api',
            snapshot_id: record.snapshotId || new Date().toISOString(),
            timestamp: new Date()
        }));
        
        // Use createMany to insert all records in a single database operation
        await marketDb.token_rank_history.createMany({
            data: dataToInsert
        });
        
        logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded ${dataToInsert.length} rank history records in batch`);
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
                
                // Volume history
                if (token.volume_24h) {
                    volumeHistoryRecords.push({
                        tokenId: token.id,
                        volume: token.volume_24h,
                        volumeUsd: token.volume_24h, // Jupiter already gives USD volume
                        change24h: token.priceChange24h, // Use price change as proxy if volume change not available
                        source,
                        snapshotId
                    });
                }
                
                // Liquidity history
                if (token.liquidity) {
                    liquidityHistoryRecords.push({
                        tokenId: token.id,
                        liquidity: token.liquidity,
                        change24h: null, // We don't have liquidity change, so use null
                        source,
                        snapshotId
                    });
                }
                
                // Market cap history
                if (token.market_cap) {
                    marketCapHistoryRecords.push({
                        tokenId: token.id,
                        marketCap: token.market_cap,
                        fdv: token.fdv,
                        change24h: null, // We don't have market cap change, so use null
                        source,
                        snapshotId
                    });
                }
                
                // Rank history
                rankHistoryRecords.push({
                    tokenId: token.id,
                    rank: index + 1, // Add 1 because arrays are zero-indexed
                    source,
                    snapshotId
                });
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
        
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GREEN}Recorded comprehensive history for ${tokens.length} tokens:${fancyColors.RESET}`);
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} - Price: ${priceHistoryRecords.length} entries`);
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} - Volume: ${volumeHistoryRecords.length} entries`);
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} - Liquidity: ${liquidityHistoryRecords.length} entries`);
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} - Market Cap: ${marketCapHistoryRecords.length} entries`);
        logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} - Rank: ${rankHistoryRecords.length} entries`);
        
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