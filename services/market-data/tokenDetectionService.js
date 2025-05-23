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
import { SERVICE_NAMES, getServiceMetadata, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../utils/service-suite/service-constants.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
// Logger
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
// Jupiter Client
import { getJupiterClient } from '../solana-engine/jupiter-client.js';
// Token List Delta Tracker
import tokenListDeltaTracker from './tokenListDeltaTracker.js';
// Market Data Repository
import marketDataRepository from './marketDataRepository.js';
// Database
import { prisma } from '../../config/prisma.js';

// Config
import { config } from '../../config/config.js';
const CONFIG = {
    // How often to check for new tokens (in seconds)
    CHECK_INTERVAL_SECONDS: 3600, // Changed to 1 hour (3600 seconds)
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
        const serviceName = SERVICE_NAMES.TOKEN_DETECTION_SERVICE || 'token_detection_service'; 
        const metadata = getServiceMetadata(serviceName) || {};
        super({
            name: serviceName,
            description: metadata.description || 'Detects new tokens and schedules metadata processing',
            dependencies: [SERVICE_NAMES.JUPITER_CLIENT],
            layer: metadata.layer || 'MONITORING', 
            criticalLevel: metadata.criticalLevel || 'medium',
            checkIntervalMs: metadata.checkIntervalMs || CONFIG.CHECK_INTERVAL_SECONDS * 1000,
            circuitBreaker: metadata.circuitBreaker || { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, enabled: true, failureThreshold: 5 }
        });
        
        // Service state
        this.isRunning = false;
        this.checkInterval = null;
        this.cleanupInterval = null;
        this.jupiterClient = null;
        this.marketDb = null;
        
        // Merge service-specific stats into the base stats object
        this.stats = {
            ...this.stats, // Keep the base stats (operations, performance, circuitBreaker, history)
            // Add or overwrite with service-specific stats
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

            await super.initialize();

            this.jupiterClient = getJupiterClient();

            if (!this.jupiterClient || !this.jupiterClient.isInitialized) { 
                logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}CRITICAL: Jupiter client not fully initialized when TokenDetectionService.initialize() was called. This indicates a potential issue with service dependency management or startup order. JupiterClient.isInitialized: ${this.jupiterClient?.isInitialized}${fancyColors.RESET}`);
                throw ServiceError.dependency("JupiterClient not initialized for TokenDetectionService. Dependency management should ensure this.");
            }

            serviceEvents.on('token:new', this.handleNewToken.bind(this));

            this.startCleanupInterval();

            logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Token detection service ready`);
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Initialization failed:${fancyColors.RESET}`, error);
            await this.handleError(error); 
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
                
                let tokensToProcessThisCycle = changes.added;
                const MAX_NEW_TOKENS_PER_CYCLE = 10000; // Limit how many new tokens we try to process at once

                if (changes.added.length > MAX_NEW_TOKENS_PER_CYCLE) {
                    logApi.warn(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Detected ${changes.added.length} new tokens, processing only ${MAX_NEW_TOKENS_PER_CYCLE} this cycle to manage load.`);
                    tokensToProcessThisCycle = changes.added.slice(0, MAX_NEW_TOKENS_PER_CYCLE);
                    // The rest will be picked up by tokenListDeltaTracker as still "new" in the next run
                }

                this.stats.detectionHistory.unshift({
                    timestamp: new Date().toISOString(),
                    added: tokensToProcessThisCycle.length, // Log how many we are actually processing
                    removed: changes.removed.length,
                    total: changes.totalTracked
                });
                
                if (this.stats.detectionHistory.length > 100) {
                    this.stats.detectionHistory = this.stats.detectionHistory.slice(0, 100);
                }
                
                this.queueTokensForProcessing(tokensToProcessThisCycle);
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
        
        const batchOfAddresses = this.processingQueue.slice(0, CONFIG.BATCH_SIZE);
        this.processingQueue = this.processingQueue.slice(CONFIG.BATCH_SIZE);
        
        try {
          logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.CYAN}Emitting discovery event for batch of ${batchOfAddresses.length} tokens${fancyColors.RESET}`);
          
          // Process each token individually to get full enrichment
          if (batchOfAddresses.length > 0) {
            for (const address of batchOfAddresses) {
              // Call handleNewToken directly for each new token
              await this.handleNewToken(address);
            }
            
            // Also emit the batch event for any other listeners
            serviceEvents.emit('tokens:discovered', { 
              addresses: batchOfAddresses,
              discoveredAt: new Date().toISOString()
            });
          }
          
          // Add a delay before processing next batch from the internal queue
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
            const tokenAddress = tokenInfo.address || tokenInfo;
            logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Processing new token: ${tokenAddress}`);
            
            // 1. Check if token already exists in database
            const existingToken = await prisma.tokens.findUnique({
                where: { address: tokenAddress }
            });
            
            if (existingToken) {
                logApi.debug(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Token ${tokenAddress} already exists, skipping`);
                return;
            }
            
            // 2. Fetch symbol and name from Helius
            let tokenSymbol = null;
            let tokenName = null;
            try {
                const heliusClient = await import('../solana-engine/helius-client.js');
                const metadata = await heliusClient.heliusClient.tokens.getTokensMetadata([tokenAddress]);
                if (metadata && metadata[0]) {
                    tokenSymbol = metadata[0].symbol;
                    tokenName = metadata[0].name;
                    logApi.debug(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Got symbol: ${tokenSymbol}, name: ${tokenName} from Helius`);
                }
            } catch (heliusError) {
                logApi.warn(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Failed to get metadata from Helius for ${tokenAddress}: ${heliusError.message}`);
            }
            
            // 3. Fetch price, market cap, and volume from DexScreener
            let priceData = null;
            let marketCap = null;
            let volume24h = null;
            try {
                const dexScreenerCollector = await import('../token-enrichment/collectors/dexScreenerCollector.js');
                const dexData = await dexScreenerCollector.default.getTokensByAddressBatch([tokenAddress]);
                if (dexData && dexData[tokenAddress]) {
                    const tokenData = dexData[tokenAddress];
                    priceData = tokenData.price;
                    marketCap = tokenData.marketCap;
                    volume24h = tokenData.volume?.h24;
                    logApi.debug(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Got price: ${priceData}, market cap: ${marketCap}, volume: ${volume24h} from DexScreener`);
                }
            } catch (dexError) {
                logApi.warn(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} Failed to get market data from DexScreener for ${tokenAddress}: ${dexError.message}`);
            }
            
            // 4. Create database record with all available data
            const tokenCreateData = {
                tokenData: {
                    address: tokenAddress,
                    symbol: tokenSymbol,
                    name: tokenName,
                    is_active: false, // Will be set by token activation service based on criteria
                    created_at: new Date(),
                    updated_at: new Date()
                },
                priceData: priceData ? {
                    price: parseFloat(priceData),
                    market_cap: marketCap ? parseFloat(marketCap) : null,
                    volume_24h: volume24h ? parseFloat(volume24h) : null,
                    updated_at: new Date()
                } : null
            };
            
            // Use marketDataRepository to create the token with all data
            await marketDataRepository.processTokenCreations(
                [tokenCreateData],
                {}, // existingTokenMap - empty since this is a new token
                (str, maxLength) => str ? str.substring(0, maxLength) : str, // validateStringLength function
                prisma
            );
            
            logApi.info(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.GREEN}Successfully created token ${tokenAddress} with symbol: ${tokenSymbol}, price: ${priceData}, market cap: ${marketCap}${fancyColors.RESET}`);
            
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
            // ServiceManager and BaseService should ensure JupiterClient (dependency) is initialized and started.
            // Check isInitialized (property from JupiterClient) and isStarted (property from BaseService)
            if (!this.jupiterClient || !this.jupiterClient.isInitialized || !this.jupiterClient.isStarted) { 
                logApi.warn(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} JupiterClient not initialized or not started. Skipping token detection cycle.`);
                throw ServiceError.dependency('Jupiter client not initialized or not started for performOperation');
            }
            const result = await this.checkForNewTokens();
            // BaseService.recordSuccess() or .handleError() will be called by the framework
            return !result.error; // Return true if no error from checkForNewTokens
        } catch (error) {
            logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Operation failed:${fancyColors.RESET}`, error);
            // No need to call await this.handleError(error) here, BaseService wrapper does it.
            throw error; // Re-throw for BaseService to handle circuit breaking
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
            
            // Merge with existing stats, then reset service-specific parts
            this.stats = {
                ...this.stats, // Preserve base stats structure
                // Reset service-specific stats
                lastCheck: null,
                totalDetected: 0,
                tokensAdded: 0,
                tokensRemoved: 0,
                lastBatchSize: 0,
                detectionHistory: [],
                // Ensure base operation stats are also reset as per original intent
                operations: {
                    total: 0,
                    successful: 0,
                    failed: 0
                }
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