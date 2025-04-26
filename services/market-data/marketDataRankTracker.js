// services/market-data/marketDataRankTracker.js

/**
 * Market Data Rank Tracker
 * 
 * Handles all token rank tracking logic, including position changes, 
 * entrances, exits, and statistical calculations for significance.
 * 
 * @module marketDataRankTracker
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import tokenHistoryFunctions from '../token-history-functions.js';

class MarketDataRankTracker {
    constructor() {
        // Previous token ranks for comparison
        this.previousTokenRanks = null;
        
        // Collection for tracking volume and price changes
        this._batchPriceChanges = [];
        this._batchVolumeChanges = [];
    }

    /**
     * Track token rank changes, new entrances, and exits from top token list
     * 
     * @param {Array} tokenSubset - Array of tokens in the current ranking
     * @param {Object} existingTokenMap - Map of token addresses to database objects
     * @param {PrismaClient} marketDb - Database client for recording ranks
     * @returns {Object} - Statistics about rank changes
     */
    async trackRankChanges(tokenSubset, existingTokenMap, marketDb) {
        // Skip if no tokens provided
        if (!tokenSubset || tokenSubset.length === 0) {
            return { entrances: [], exits: [], rankChanges: [] };
        }

        const entrances = [];
        const exits = [];
        const rankChanges = [];
        
        // Initialize rank tracking on first run
        if (!this.previousTokenRanks) {
            // First run - initialize the tracking with position information
            this.previousTokenRanks = new Map();
            
            // Initialize with current addresses and their positions
            tokenSubset.forEach((token, index) => {
                const address = typeof token === 'string' ? 
                    token.replace(/^["']+|["']+$/g, '').replace(/\\"/g, '') : 
                    token.address;
                
                // Store the token's position and symbol for comparison
                const symbol = typeof token === 'string' ? 
                    address.substring(0, 8) : 
                    token.symbol || address.substring(0, 8);
                    
                this.previousTokenRanks.set(address, {
                    position: index + 1, // 1-based position
                    symbol: symbol
                });
            });
            
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Initialized token rank tracking with ${this.previousTokenRanks.size} tokens${fancyColors.RESET}`);
            
            return { entrances: [], exits: [], rankChanges: [] };
        }
        
        // Build the current token ranking map
        const currentTokenRanks = new Map();
        tokenSubset.forEach((token, index) => {
            const address = typeof token === 'string' ? 
                token.replace(/^["']+|["']+$/g, '').replace(/\\"/g, '') : 
                token.address;
            
            const symbol = typeof token === 'string' ? 
                address.substring(0, 8) : 
                token.symbol || address.substring(0, 8);
                
            currentTokenRanks.set(address, {
                position: index + 1, // 1-based position
                symbol: symbol
            });
        });
        
        // Create sets for easier entrance/exit detection
        const currentTopAddresses = new Set(currentTokenRanks.keys());
        const previousTopAddresses = new Set(this.previousTokenRanks.keys());
        
        // Find new tokens that weren't in the previous list (entrances)
        currentTopAddresses.forEach(address => {
            if (!previousTopAddresses.has(address)) {
                // Find the token in the current list for additional info
                const token = tokenSubset.find(t => 
                    (typeof t === 'string' ? 
                        t.replace(/^["']+|["']+$/g, '').replace(/\\"/g, '') : 
                        t.address) === address
                );
                
                const symbol = typeof token === 'string' ? 
                    address.substring(0, 8) : 
                    token.symbol || address.substring(0, 8);
                    
                entrances.push({ address, symbol });
            }
        });
        
        // Find tokens that were in the previous list but aren't anymore (exits)
        previousTopAddresses.forEach(address => {
            if (!currentTopAddresses.has(address)) {
                // Get previous information for this token
                const tokenInfo = this.previousTokenRanks.get(address);
                const prevRank = tokenInfo?.position || 0;
                const symbol = tokenInfo?.symbol || address.substring(0, 8);
                
                exits.push({ 
                    address, 
                    symbol,
                    prevRank
                });
            }
        });
        
        // Log entrances and exits
        if (entrances.length > 0) {
            const entranceSymbols = entrances.map(e => e.symbol).slice(0, 5);
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} NEW ARRIVALS ${fancyColors.RESET} ${entrances.length} tokens entered top list: ${entranceSymbols.join(', ')}${entrances.length > 5 ? '...' : ''}`);
            
            // Log each entrance individually with more details if we have few of them
            if (entrances.length <= 5) {
                entrances.forEach(entrance => {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GREEN}NEW LIST ENTRY:${fancyColors.RESET} ${entrance.symbol} (${entrance.address.substring(0, 8)}...)`);
                });
            }
        }
        
        // Log drops
        if (exits.length > 0) {
            const exitSymbols = exits.map(e => e.symbol).slice(0, 5);
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} DROPPED OUT ${fancyColors.RESET} ${exits.length} tokens exited top list: ${exitSymbols.join(', ')}${exits.length > 5 ? '...' : ''}`);
            
            // Log each exit individually with more details if we have few of them
            if (exits.length <= 5) {
                exits.forEach(exit => {
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}DROPPED FROM LIST:${fancyColors.RESET} ${exit.symbol} (${exit.address.substring(0, 8)}...)`);
                });
            }
        }
        
        // Record the current token ranks for historical tracking
        await this.recordTokenRanks(tokenSubset, currentTokenRanks, marketDb);
        
        // Process each token that stayed in the list
        currentTopAddresses.forEach(address => {
            if (previousTopAddresses.has(address)) {
                // Get previous and current positions
                const prevInfo = this.previousTokenRanks.get(address);
                const currInfo = currentTokenRanks.get(address);
                
                if (prevInfo && currInfo) {
                    // -------------------------------------------------------------------------
                    // TOKEN HOTNESS GRADING METHODOLOGY
                    // -------------------------------------------------------------------------
                    // This comprehensive approach combines several factors to identify truly
                    // significant token movements, with special emphasis on the top 50 ranks.
                    // The system uses both rank changes and volume data for a complete picture.
                    // -------------------------------------------------------------------------
                    
                    // 1. Basic rank change (raw positions moved)
                    const change = prevInfo.position - currInfo.position; // Positive = improved
                    
                    // 2. Calculate percentage change relative to previous position
                    // (Moving from 50→25 is 50% improvement, from 900→800 is only 11%)
                    const percentChange = Math.abs(change / prevInfo.position) * 100;
                    
                    // 3. Logarithmic rank importance 
                    // This makes movements in top ranks dramatically more important
                    // We use log10(max_rank/current_rank + 1) which creates a curve where:
                    // - Rank 1 is ~3x more important than rank 50
                    // - Rank 1 is ~6x more important than rank 1000
                    const MAX_TOKENS_TO_PROCESS = 5000; // Same as parent service setting
                    const logRankWeight = Math.log10(MAX_TOKENS_TO_PROCESS / currInfo.position + 1) * 3;
                    
                    // 4. Calculate weighted significance score 
                    const weightedScore = percentChange * logRankWeight;
                    
                    // 5. Volume component - if available
                    // Get volume data for this token from current and previous data
                    // Current volume comes from the collected data
                    let volumeGrowth = null;
                    let volumeGrowthCategory = 'unknown'; // 'rising', 'falling', 'stable', 'unknown'
                    
                    // Calculate volume growth if we have the data
                    if (this._batchVolumeChanges) {
                        // Find current volume data
                        const volumeData = this._batchVolumeChanges.find(v => v.address === address);
                        if (volumeData && volumeData.volume) {
                            // We have current volume, compare with previous if available
                            const currentVolume = parseFloat(volumeData.volume);
                            
                            // Store with the entry for future comparison
                            currInfo.volume = currentVolume;
                            
                            // Check if we had previous volume data
                            if (prevInfo.volume) {
                                // Calculate volume growth percentage
                                volumeGrowth = ((currentVolume / prevInfo.volume) - 1) * 100;
                                
                                // Categorize volume change with some tolerance for minor fluctuations
                                if (volumeGrowth > 10) {
                                    volumeGrowthCategory = 'rising';
                                } else if (volumeGrowth < -10) {
                                    volumeGrowthCategory = 'falling';
                                } else {
                                    volumeGrowthCategory = 'stable';
                                }
                            }
                        }
                    }
                    
                    // 6. Calculate final hotness score
                    // Base: Weighted rank change
                    // Bonus: Volume growth (if applicable)
                    let hotnessScore = weightedScore;
                    
                    // Add volume growth bonus if available
                    if (volumeGrowth !== null && volumeGrowth > 0) {
                        // Volume growth can boost the score
                        // We apply a modest multiplier for normal cases
                        // And a stronger multiplier for dramatic volume growth
                        const volumeBoost = volumeGrowth > 100 ? 1.5 : // >100% growth = 1.5x boost
                                          volumeGrowth > 50 ? 1.3 :   // >50% growth = 1.3x boost
                                          volumeGrowth > 20 ? 1.2 :   // >20% growth = 1.2x boost
                                          1.1;                        // All other positive growth
                        
                        hotnessScore *= volumeBoost;
                    }
                    
                    // 7. Determine if this change is significant enough to track
                    // Multiple factors make a significant change:
                    // - Raw movement (10+ positions)
                    // - Weighted score (15+ for normal tokens)
                    // - Any movement in top 50 ranks (even small changes matter)
                    // - Volume growth combined with positive rank change
                    const isRawSignificant = Math.abs(change) >= 10;
                    const isWeightedSignificant = weightedScore >= 15;
                    const isTopRank = currInfo.position <= 50; // Special emphasis on top 50
                    const isVolumeIncreasing = volumeGrowthCategory === 'rising';
                    
                    // For top ranks, we apply lower thresholds
                    const isSignificantForTopRank = isTopRank && (Math.abs(change) >= 3 || weightedScore >= 5);
                    
                    // Track if token is "hot" (positive rank change + volume growth)
                    const isHot = change > 0 && isVolumeIncreasing;
                    
                    // Determine if this token movement should be tracked
                    if (isRawSignificant || isWeightedSignificant || isSignificantForTopRank || isHot) {
                        rankChanges.push({
                            address,
                            symbol: currInfo.symbol,
                            prevRank: prevInfo.position,
                            currentRank: currInfo.position,
                            change,
                            percentChange: percentChange.toFixed(1),
                            weightedScore: weightedScore.toFixed(1),
                            volumeGrowth: volumeGrowth !== null ? volumeGrowth.toFixed(1) : null,
                            volumeGrowthCategory,
                            hotnessScore: hotnessScore.toFixed(1),
                            isTopRank,
                            isHot
                        });
                    }
                }
            }
        });
        
        // Sort by hotness score (most significant first)
        rankChanges.sort((a, b) => parseFloat(b.hotnessScore) - parseFloat(a.hotnessScore));
        
        // Extract hot tokens (those with positive rank change + volume growth)
        const hotTokens = rankChanges.filter(item => item.isHot).slice(0, 5);
        
        // For remaining tokens, split into risers and droppers by raw change
        const otherTokens = rankChanges.filter(item => !item.isHot);
        const risers = otherTokens.filter(item => item.change > 0)
            .sort((a, b) => parseFloat(b.hotnessScore) - parseFloat(a.hotnessScore))
            .slice(0, 5);
        const droppers = otherTokens.filter(item => item.change < 0)
            .sort((a, b) => parseFloat(a.hotnessScore) - parseFloat(b.hotnessScore))
            .slice(0, 5);
        
        // Log HOT tokens (highest priority - both rising in rank and volume)
        if (hotTokens && hotTokens.length > 0) {
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_MAGENTA}${fancyColors.WHITE} HOT TOKENS ${fancyColors.RESET} Rising in both rank and volume:`);
            
            try {
                hotTokens.forEach(token => {
                    if (!token) return; // Skip invalid tokens
                    
                    // Format nicely with hotness score info
                    const volInfo = token.volumeGrowth ? ` | Vol +${token.volumeGrowth}%` : '';
                    const scoreInfo = ` | Score: ${token.hotnessScore || 'N/A'}`;
                    const rankInfo = token.isTopRank ? ` [TOP ${token.currentRank}]` : '';
                    const symbol = token.symbol || 'UNKNOWN';
                    const prevRank = token.prevRank || 0;
                    const currentRank = token.currentRank || 0;
                    const change = token.change || 0;
                    
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.MAGENTA}HOT TOKEN:${fancyColors.RESET} ${symbol}${rankInfo} | Rank ${prevRank} → ${currentRank} (+${change})${volInfo}${scoreInfo}`);
                });
            } catch (error) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing hot tokens:${fancyColors.RESET}`, error);
            }
        }
        
        // Log top risers (tokens rising in rank but not marked as HOT)
        if (risers && risers.length > 0) {
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Top rank climbers:${fancyColors.RESET}`);
            
            try {
                risers.forEach(riser => {
                    if (!riser) return; // Skip invalid risers
                    
                    // Add top rank flag if in top 50
                    const rankInfo = riser.isTopRank ? ` [TOP ${riser.currentRank}]` : '';
                    // Include hotness score for context
                    const scoreInfo = ` | Score: ${riser.hotnessScore || 'N/A'}`;
                    const symbol = riser.symbol || 'UNKNOWN';
                    const prevRank = riser.prevRank || 0;
                    const currentRank = riser.currentRank || 0;
                    const change = riser.change || 0;
                    
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.GREEN}RANK UP ${change} spots:${fancyColors.RESET} ${symbol}${rankInfo} moved ${prevRank} → ${currentRank}${scoreInfo}`);
                });
            } catch (error) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing rank risers:${fancyColors.RESET}`, error);
            }
        }
        
        // Log top droppers (tokens falling in rank)
        if (droppers && droppers.length > 0) {
            logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Largest rank drops:${fancyColors.RESET}`);
            
            try {
                droppers.forEach(dropper => {
                    if (!dropper) return; // Skip invalid droppers
                    
                    // Add top rank flag if in top 50
                    const rankInfo = dropper.isTopRank ? ` [TOP ${dropper.currentRank}]` : '';
                    // Include hotness score for context
                    const scoreInfo = ` | Score: ${dropper.hotnessScore || 'N/A'}`;
                    const symbol = dropper.symbol || 'UNKNOWN';
                    const prevRank = dropper.prevRank || 0;
                    const currentRank = dropper.currentRank || 0;
                    const change = dropper.change || 0;
                    
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}RANK DOWN ${Math.abs(change)} spots:${fancyColors.RESET} ${symbol}${rankInfo} moved ${prevRank} → ${currentRank}${scoreInfo}`);
                });
            } catch (error) {
                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing rank droppers:${fancyColors.RESET}`, error);
            }
        }
        
        // Update previous list for next comparison
        this.previousTokenRanks = currentTokenRanks;
        
        return {
            entrances,
            exits,
            rankChanges,
            hotTokens,
            risers,
            droppers
        };
    }

    /**
     * Records token ranks for historical tracking
     * @param {Array} tokens - Array of tokens
     * @param {Map} tokenRanks - Map of token addresses to rank information
     * @param {PrismaClient} marketDb - Database client
     */
    async recordTokenRanks(tokens, tokenRanks, marketDb) {
        try {
            if (!tokens || !tokenRanks) return;
            
            // Create rank history records for each token
            const rankRecords = [];
            const snapshotId = `rank_snapshot_${new Date().toISOString()}`;
            
            // For each token, look up its database ID and add a rank record
            for (const [address, rankInfo] of tokenRanks.entries()) {
                try {
                    // Find token ID from database
                    const token = await marketDb.tokens.findFirst({
                        where: { address },
                        select: { id: true }
                    });
                    
                    if (token && token.id) {
                        rankRecords.push({
                            tokenId: token.id,
                            rank: rankInfo.position,
                            source: 'jupiter_api',
                            snapshotId
                        });
                    }
                } catch (err) {
                    // Skip this token and continue with others
                    logApi.debug(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Error looking up token for rank recording: ${err.message}`);
                }
            }
            
            // Log result and record rank history in batches
            if (rankRecords.length > 0) {
                const BATCH_SIZE = 100;
                for (let i = 0; i < rankRecords.length; i += BATCH_SIZE) {
                    const batch = rankRecords.slice(i, i + BATCH_SIZE);
                    await tokenHistoryFunctions.recordRankHistoryBatch(batch);
                }
                
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} Recorded rank history for ${rankRecords.length} tokens`);
            }
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error recording token ranks:${fancyColors.RESET}`, error);
        }
    }

    /**
     * Add a price change to the tracking batch
     * @param {Object} priceChange - Price change data
     */
    addPriceChange(symbol, price, change, volume, address) {
        if (!this._batchPriceChanges) {
            this._batchPriceChanges = [];
        }
        
        this._batchPriceChanges.push({
            symbol, price, change, volume, address
        });
    }

    /**
     * Add a volume change to the tracking batch
     * @param {Object} volumeChange - Volume change data
     */
    addVolumeChange(symbol, volume, price, address) {
        if (!this._batchVolumeChanges) {
            this._batchVolumeChanges = [];
        }
        
        this._batchVolumeChanges.push({
            symbol, volume, price, address
        });
    }

    /**
     * Reset batched changes
     */
    resetBatchedChanges() {
        this._batchPriceChanges = [];
        this._batchVolumeChanges = [];
    }
}

// Create and export a singleton instance
const marketDataRankTracker = new MarketDataRankTracker();
export default marketDataRankTracker;