// services/market-data/marketDataAnalytics.js

/**
 * Market Data Analytics
 * 
 * Statistical processing for price and volume analysis to detect significant changes.
 * Provides methods for analyzing price movements, volume spikes, and market trends.
 * 
 * @module marketDataAnalytics
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';

class MarketDataAnalytics {
    constructor() {
        // Collections for tracking price and volume changes
        this.priceChanges = [];
        this.volumeChanges = [];
    }

    /**
     * Add a price change to the collection
     * @param {string} symbol - Token symbol
     * @param {string} price - Current price
     * @param {number} change - Percentage change
     * @param {string} volume - 24h volume
     * @param {string} address - Token address
     */
    addPriceChange(symbol, price, change, volume, address) {
        this.priceChanges.push({
            symbol: symbol || address.substring(0, 8),
            price,
            change,
            volume: volume || 0,
            address
        });
    }

    /**
     * Add a volume change to the collection
     * @param {string} symbol - Token symbol
     * @param {string} volume - Current volume
     * @param {string} price - Current price
     * @param {string} address - Token address
     */
    addVolumeChange(symbol, volume, price, address) {
        this.volumeChanges.push({
            symbol: symbol || address.substring(0, 8),
            volume,
            price,
            address
        });
    }

    /**
     * Reset all collections
     */
    resetCollections() {
        this.priceChanges = [];
        this.volumeChanges = [];
    }

    /**
     * Process price changes to find statistically significant movements
     * @returns {Array} - Array of significant price changes
     */
    processPriceChanges() {
        try {
            if (this.priceChanges.length === 0) {
                return [];
            }
            
            // Calculate statistics for dynamic significance threshold
            const changes = this.priceChanges
                .map(item => Math.abs(item.change))
                .filter(val => !isNaN(val));
            
            if (changes.length <= 10) {
                // Not enough data points for meaningful statistics
                return [];
            }
            
            // Calculate mean and standard deviation
            const sum = changes.reduce((a, b) => a + b, 0);
            const mean = sum / changes.length;
            
            // Standard deviation calculation
            const squareDiffs = changes.map(value => {
                const diff = value - mean;
                return diff * diff;
            });
            const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
            const stdDev = Math.sqrt(avgSquareDiff);
            
            // Dynamic threshold: mean + 2 standard deviations (covers ~95% of normal distribution)
            const significanceThreshold = mean + (2 * stdDev);
            
            // Find and log significant changes based on this batch's statistics
            const significantChanges = this.priceChanges
                .filter(item => Math.abs(item.change) > significanceThreshold)
                .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
                .slice(0, 5);  // Top 5 most significant
                
            if (significantChanges.length > 0) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Found ${significantChanges.length} statistically significant price changes (threshold: ${significanceThreshold.toFixed(2)}%)${fancyColors.RESET}`);
                
                // Log each significant change
                significantChanges.forEach(item => {
                    const color = item.change > 0 ? fancyColors.GREEN : fancyColors.RED;
                    const direction = item.change > 0 ? 'UP' : 'DOWN';
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${color}PRICE ${direction} ${Math.abs(item.change).toFixed(2)}%:${fancyColors.RESET} ${item.symbol} at ${item.price}`);
                });
            }
            
            return significantChanges;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing price changes:${fancyColors.RESET}`, error);
            return [];
        }
    }

    /**
     * Process volume changes to find high-volume tokens and unusual spikes
     * @returns {Object} - Object containing high volume tokens and volume spikes
     */
    processVolumeChanges() {
        try {
            if (this.volumeChanges.length === 0) {
                return { highVolumeTokens: [], volumeSpikes: [] };
            }
            
            // Filter out undefined or zero volumes
            const validVolumes = this.volumeChanges
                .filter(item => item.volume && parseFloat(item.volume) > 0)
                .map(item => ({
                    ...item,
                    volumeValue: parseFloat(item.volume)
                }));
                
            if (validVolumes.length <= 10) {
                // Not enough data for meaningful analysis
                return { highVolumeTokens: [], volumeSpikes: [] };
            }
            
            // Sort by volume to find highest volume tokens
            const highVolumeTokens = [...validVolumes]
                .sort((a, b) => b.volumeValue - a.volumeValue)
                .slice(0, 3);  // Top 3 highest volume
            
            // Log highest volume tokens
            if (highVolumeTokens.length > 0) {
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Top trading volume tokens:${fancyColors.RESET}`);
                
                highVolumeTokens.forEach((item, index) => {
                    const formattedVolume = this.formatCurrency(item.volumeValue);
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BLUE}VOLUME #${index+1}:${fancyColors.RESET} ${item.symbol} with ${fancyColors.BLUE}${formattedVolume}${fancyColors.RESET} at price ${item.price}`);
                });
            }
            
            // Calculate log-normalized volumes for better statistical analysis
            // (Volumes are often log-normally distributed with extreme outliers)
            const logVolumes = validVolumes.map(item => Math.log10(Math.max(1, item.volumeValue)));
            
            // Calculate mean and standard deviation of log volumes
            const sum = logVolumes.reduce((a, b) => a + b, 0);
            const mean = sum / logVolumes.length;
            
            const squareDiffs = logVolumes.map(value => {
                const diff = value - mean;
                return diff * diff;
            });
            const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
            const stdDev = Math.sqrt(avgSquareDiff);
            
            // Identify unusually high volume (log scale): > mean + 2.5*stdDev
            // Using 2.5 instead of 2.0 to be more selective for volume spikes
            const significanceThreshold = mean + (2.5 * stdDev);
            
            // Find tokens with statistically significant high volume
            const spikeTokens = validVolumes
                .filter(item => Math.log10(Math.max(1, item.volumeValue)) > significanceThreshold)
                .sort((a, b) => b.volumeValue - a.volumeValue);
                
            // Log tokens with volume spikes (excluding those already in top 3)
            const highVolumeAddresses = new Set(highVolumeTokens.map(t => t.address));
            const uniqueSpikeTokens = spikeTokens.filter(t => !highVolumeAddresses.has(t.address));
            
            if (uniqueSpikeTokens.length > 0) {
                const logThreshold = Math.pow(10, significanceThreshold).toFixed(0);
                const formattedThreshold = this.formatCurrency(parseInt(logThreshold));
                
                logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.CYAN}Detected ${uniqueSpikeTokens.length} unusual volume spikes (threshold: ~${formattedThreshold})${fancyColors.RESET}`);
                
                uniqueSpikeTokens.slice(0, 3).forEach(item => {
                    const formattedVolume = this.formatCurrency(item.volumeValue);
                    logApi.info(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.MAGENTA}VOLUME SPIKE:${fancyColors.RESET} ${item.symbol} with ${fancyColors.MAGENTA}${formattedVolume}${fancyColors.RESET} at price ${item.price}`);
                });
            }
            
            return {
                highVolumeTokens,
                volumeSpikes: uniqueSpikeTokens
            };
            
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing volume changes:${fancyColors.RESET}`, error);
            return { highVolumeTokens: [], volumeSpikes: [] };
        }
    }

    /**
     * Format currency value for display
     * @param {number} value - Value to format
     * @returns {string} - Formatted value
     */
    formatCurrency(value) {
        if (value > 1000000) {
            return `$${(value/1000000).toFixed(2)}M`;
        } else if (value > 1000) {
            return `$${(value/1000).toFixed(2)}K`;
        } else {
            return `$${value.toFixed(2)}`;
        }
    }
}

// Create and export a singleton instance
const marketDataAnalytics = new MarketDataAnalytics();
export default marketDataAnalytics;