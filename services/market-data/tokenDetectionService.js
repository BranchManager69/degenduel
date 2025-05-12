// services/market-data/tokenDetectionService.js

/**
 * Token Detection Service
 * @module services/market-data/tokenDetectionService
 * 
 * @description A service that continuously monitors for new tokens on the Solana blockchain.
 * 
 * It efficiently detects new tokens by comparing successive token lists 
 * from Jupiter API and schedules processing of new tokens.
 * 
 * @author BranchManager69
 * @version 1.9.0
 * @created 2025-04-10
 * @updated 2025-05-02
 */

// Service Suite
import { BaseService } from '../../utils/service-suite/base-service.js';
import { ServiceError } from '../../utils/service-suite/service-error.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
// Logger
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
// Jupiter Client
import { getJupiterClient } from '../solana-engine/jupiter-client.js';
// Token List Delta Tracker
import tokenListDeltaTracker from './tokenListDeltaTracker.js';
// Market Data Repository
import marketDataRepository from './marketDataRepository.js'; // what is this?

// Config
import { config } from '../../config/config.js';
const CONFIG = {
    // How often to check for new tokens (in seconds)
    CHECK_INTERVAL_SECONDS: 30,
    // Cleanup old token sets more frequently to save Redis memory
    CLEANUP_INTERVAL_MINUTES: 5,
    // Maximum number of tokens to process in a batch
    BATCH_SIZE: 50,
    // Delay between processing batches (in milliseconds)
    BATCH_DELAY_MS: 100
}; // extra config?

/**
 * Token Detection Service
 * Efficiently tracks new tokens and schedules them for processing
 * 
 * @extends {BaseService}
 */
class TokenDetectionService extends BaseService {
    constructor() {
        super({
            name: 'token_detection_service',
            description: 'Detects new tokens and schedules metadata processing',
            layer: 'MONITORING', 
            criticalLevel: 'medium',
            checkIntervalMs: 30 * 1000 // 30 seconds
        });
        
        // Service state
        this.isRunning = false;
        this.checkInterval = null;
        this.cleanupInterval = null;
        this.jupiterClient = null;
        this.marketDb = null;
        
        // Stats
        this.stats = {
            lastCheck: null,
            totalDetected: 0,
            tokensAdded: 0,
            tokensRemoved: 0,
            lastBatchSize: 0,
            detectionHistory: []
        };
        
        // Batch processing state
        this.processingQueue = [];
        this.isProcessingBatch = false;
    }
    
    /**
     * Initialize the service
     * @returns {Promise<boolean>} - True if initialized successfully
     */
    async initialize() {
        try {
            logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Initializing token detection service...`);

            // Register with service manager if not already registered
            if (!serviceManager.services.has(this.name)) {
                serviceManager.register(this.name, this);
            }

            // Get Jupiter client
            this.jupiterClient = getJupiterClient();

            if (!this.jupiterClient || !this.jupiterClient.isInitialized) {
                // Fixed property name from 'initialized' to 'isInitialized' to match JupiterClient class
                logApi.warn(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Jupiter client not initialized, will retry later${fancyColors.RESET}`);
                return false;
            }

            // Register event listeners
            serviceEvents.on('token:new', this.handleNewToken.bind(this));

            // Start check interval
            this.startCheckInterval();

            // Start cleanup interval
            this.startCleanupInterval();

            this.isInitialized = true;
            logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Token detection service ready`);
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Initialization failed:${fancyColors.RESET}`, error);
            this.handleError(error);
            return false;
        }
    }
    
    /**
     * Start the interval to regularly check for new tokens
     */
    startCheckInterval() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        
        this.checkInterval = setInterval(async () => {
            try {
                await this.checkForNewTokens();
            } catch (error) {
                logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Error in check interval:${fancyColors.RESET}`, error);
            }
        }, CONFIG.CHECK_INTERVAL_SECONDS * 1000);
        
        logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Started token detection interval (every ${CONFIG.CHECK_INTERVAL_SECONDS}s)`);
    }
    
    /**
     * Start the interval to clean up old token sets
     */
    startCleanupInterval() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        this.cleanupInterval = setInterval(async () => {
            try {
                const removed = await tokenListDeltaTracker.cleanupOldSets(true);
                if (removed > 0) {
                    logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Cleanup removed ${removed} old token sets`);
                }
            } catch (error) {
                logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Error in cleanup interval:${fancyColors.RESET}`, error);
            }
        }, CONFIG.CLEANUP_INTERVAL_MINUTES * 60 * 1000);
        
        logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Started cleanup interval (every ${CONFIG.CLEANUP_INTERVAL_MINUTES} minutes)`);
    }
    
    /**
     * Check for new tokens by comparing current token list with previous
     * @returns {Promise<Object>} - Results of the check
     */
    async checkForNewTokens() {
        const startTime = Date.now();
        
        try {
            // Get current token list from Jupiter using the tokens.fetchJupiterTokenAddresses method
            const tokenList = await this.jupiterClient.tokens.fetchJupiterTokenAddresses();

            if (!Array.isArray(tokenList) || tokenList.length === 0) {
                logApi.warn(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Empty or invalid token list from Jupiter${fancyColors.RESET}`);
                return { error: 'Invalid token list' };
            }
            
            // The fetchJupiterTokenAddresses method already returns an array of token addresses
            // so we can use it directly
            const tokenAddresses = tokenList;
            
            if (tokenAddresses.length === 0) {
                logApi.warn(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.YELLOW}No valid token addresses extracted from Jupiter list${fancyColors.RESET}`);
                return { error: 'No valid token addresses' };
            }
            
            // Track changes in token list
            const changes = await tokenListDeltaTracker.trackChanges(tokenAddresses);
            
            // Update stats
            this.stats.lastCheck = new Date().toISOString();
            this.stats.lastBatchSize = tokenAddresses.length;
            
            if (changes.added.length > 0) {
                this.stats.totalDetected += changes.added.length;
                this.stats.tokensAdded += changes.added.length;
                
                // Keep history of detection events (limited to last 100)
                this.stats.detectionHistory.unshift({
                    timestamp: new Date().toISOString(),
                    added: changes.added.length,
                    removed: changes.removed.length,
                    total: changes.totalTracked
                });
                
                // Limit history size
                if (this.stats.detectionHistory.length > 100) {
                    this.stats.detectionHistory = this.stats.detectionHistory.slice(0, 100);
                }
                
                // Schedule processing of new tokens
                this.queueTokensForProcessing(changes.added);
            }
            
            if (changes.removed.length > 0) {
                this.stats.tokensRemoved += changes.removed.length;
            }
            
            // Calculate time taken
            const elapsedMs = Date.now() - startTime;
            
            logApi.debug(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Checked ${tokenAddresses.length} tokens in ${elapsedMs}ms`);
            
            if (changes.added.length > 0 || changes.removed.length > 0) {
                logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} DETECTED ${fancyColors.RESET} +${changes.added.length} new, -${changes.removed.length} removed tokens (${elapsedMs}ms)`);
                
                // If we have significant changes, emit an event
                if (changes.added.length > 10 || changes.removed.length > 10) {
                    serviceEvents.emit('tokens:significant_change', {
                        added: changes.added.length,
                        removed: changes.removed.length,
                        timestamp: new Date().toISOString()
                    });
                }
            }
            
            return {
                tokenCount: tokenAddresses.length,
                changes: {
                    added: changes.added.length,
                    removed: changes.removed.length,
                    unchanged: changes.unchanged
                },
                elapsedMs
            };
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Error checking for new tokens:${fancyColors.RESET}`, error);
            return { error: error.message };
        }
    }
    
    /**
     * Queue tokens for metadata processing
     * @param {Array<string>} tokens - Array of token addresses to process
     */
    queueTokensForProcessing(tokens) {
        if (!Array.isArray(tokens) || tokens.length === 0) {
            return;
        }
        
        // Add tokens to processing queue
        this.processingQueue = [...this.processingQueue, ...tokens];
        
        // Start processing if not already in progress
        if (!this.isProcessingBatch) {
            this.processNextBatch();
        }
    }
    
    /**
     * Process next batch of tokens in the queue
     */
    async processNextBatch() {
        if (this.processingQueue.length === 0) {
            this.isProcessingBatch = false;
            return;
        }
        
        this.isProcessingBatch = true;
        
        // Get next batch
        const batch = this.processingQueue.slice(0, CONFIG.BATCH_SIZE);
        this.processingQueue = this.processingQueue.slice(CONFIG.BATCH_SIZE);
        
        try {
            logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.CYAN}Processing batch of ${batch.length} tokens${fancyColors.RESET}`);
            
            // For each token, emit an event for enrichment
            batch.forEach(tokenAddress => {
                serviceEvents.emit('token:new', {
                    address: tokenAddress,
                    discoveredAt: new Date().toISOString()
                });
            });
            
            // Add a delay before processing next batch
            setTimeout(() => {
                this.processNextBatch();
            }, CONFIG.BATCH_DELAY_MS);
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing token batch:${fancyColors.RESET}`, error);
            
            // Continue with next batch despite error
            setTimeout(() => {
                this.processNextBatch();
            }, CONFIG.BATCH_DELAY_MS * 5); // Longer delay after error
        }
    }
    
    /**
     * Handle a new token event
     * @param {Object} tokenInfo - Token information
     */
    async handleNewToken(tokenInfo) {
        try {
            // This is just a placeholder - actual implementation will depend on your token processing strategy
            // This would typically involve fetching metadata, initializing database records, etc.
            logApi.debug(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Received new token event: ${tokenInfo.address}`);
            
            // In a real implementation, you would enrich token data and save it to the database
            // Example of what could happen:
            // 1. Check if token already exists in database
            // 2. Fetch metadata from various sources
            // 3. Fetch price data if available
            // 4. Create database record
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Error handling new token:${fancyColors.RESET}`, error);
        }
    }
    
    /**
     * Get current service health status
     * @returns {Promise<boolean>} - True if service is healthy
     */
    async checkServiceHealth() {
        try {
            // Check Jupiter client
            if (!this.jupiterClient || !this.jupiterClient.initialized) {
                throw ServiceError.dependency('Jupiter client not initialized');
            }
            
            // Check token list tracker
            const trackerStats = await tokenListDeltaTracker.getStats();
            if (trackerStats.error) {
                throw ServiceError.dependency(`Token list tracker error: ${trackerStats.error}`);
            }
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Health check failed:${fancyColors.RESET}`, error);
            throw error;
        }
    }
    
    /**
     * Perform service operation (check for new tokens)
     * @returns {Promise<Object>} - Operation result
     */
    async performOperation() {
        try {
            // Check service health
            await this.checkServiceHealth();
            
            // Check for new tokens
            const result = await this.checkForNewTokens();
            
            return {
                success: !result.error,
                result
            };
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Operation failed:${fancyColors.RESET}`, error);
            await this.handleError(error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Stop the service
     * @returns {Promise<void>}
     */
    async stop() {
        try {
            await super.stop();
            
            // Clear intervals
            if (this.checkInterval) {
                clearInterval(this.checkInterval);
                this.checkInterval = null;
            }
            
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }
            
            // Remove event listeners
            serviceEvents.removeAllListeners('token:new');
            
            logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} STOPPED ${fancyColors.RESET}`);
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Error stopping service:${fancyColors.RESET}`, error);
        }
    }
    
    /**
     * Clean up resources and reset state before shutdown
     * @returns {Promise<void>}
     */
    async cleanup() {
        try {
            // Stop the service first
            await this.stop();
            
            // Reset processing state
            this.isProcessingBatch = false;
            this.processingQueue = [];
            
            // Initialize stats with safe default values
            this.stats = {
                operations: {
                    total: 0,
                    successful: 0,
                    failed: 0
                },
                lastCheck: null,
                totalDetected: 0,
                tokensAdded: 0,
                tokensRemoved: 0,
                lastBatchSize: 0,
                detectionHistory: []
            };
            
            logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} CLEANUP ${fancyColors.RESET} Service resources cleaned up`);
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Error during cleanup:${fancyColors.RESET}`, error);
            return false;
        }
    }
}

// Create and export singleton instance
const tokenDetectionService = new TokenDetectionService();
export default tokenDetectionService;