// services/token-enrichment/tokenEnrichmentService.js

/**
 * Token Enrichment Service
 * @module services/token-enrichment/tokenEnrichmentService
 * 
 * This service coordinates the collection and storage of token metadata
 * from various sources. It receives events from the token detection service
 * and enriches the token data with metadata from multiple providers.
 * 
 * @author BranchManager69
 * @version 1.9.0
 * @created 2025-04-28
 * @updated 2025-05-01
 */

// Service Suite
import { BaseService } from '../../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import { ServiceError } from '../../utils/service-suite/service-error.js'; // why is this unused?
// Prisma
import prisma from '../../config/prisma.js';
// Redis
import redisManager from '../../utils/redis-suite/redis-manager.js'; // no stated need for this
// Logger
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';

// Config
//import { config } from '../../config/config.js';
//const isDev = config.getEnvironment() === 'development';

// Import data collectors
import dexScreenerCollector from './collectors/dexScreenerCollector.js';
import heliusCollector from './collectors/heliusCollector.js';
import jupiterCollector from './collectors/jupiterCollector.js';

// Configuration
const CONFIG = {
  // Processing configuration
  BATCH_SIZE: 50,
  BATCH_DELAY_MS: 100,
  MAX_CONCURRENT_BATCHES: 3,
  
  // Throttling to avoid rate limits
  THROTTLE_MS: 100,
  DEXSCREENER_THROTTLE_MS: 500, // DexScreener has stricter rate limits
  
  // Priority tiers for token processing
  PRIORITY_TIERS: {
    HIGH: 1,    // Process immediately
    MEDIUM: 2,  // Process after high priority
    LOW: 3      // Process during low activity periods
  },
  
  // Enrichment strategies - which sources to try and in what order
  STRATEGIES: {
    FULL: ['dexscreener', 'helius', 'jupiter'],
    MARKET_ONLY: ['dexscreener', 'jupiter'],
    CHAIN_ONLY: ['helius', 'jupiter']
  },
  
  // How often to retry failed enrichments
  RETRY_INTERVALS: [
    5 * 60 * 1000,   // 5 minutes
    30 * 60 * 1000,  // 30 minutes
    6 * 60 * 60 * 1000, // 6 hours
    24 * 60 * 60 * 1000 // 24 hours
  ],
  
  // Priority Scoring Configuration
  PRIORITY_SCORE: {
    // Weight factors for different metrics (must sum to 1.0)
    WEIGHTS: {
      VOLUME: 0.5,       // Trading volume (50% weight) 
      VOLATILITY: 0.4,   // Price volatility (40% weight)
      LIQUIDITY: 0.1     // Token liquidity (10% weight)
    },
    
    // Timeframe importance (recency bias - must sum to 1.0)
    VOLUME_TIMEFRAMES: {
      MINUTES_5: 0.4,    // 5-minute volume (40% weight)
      HOURS_1: 0.3,      // 1-hour volume (30% weight)
      HOURS_6: 0.2,      // 6-hour volume (20% weight)
      HOURS_24: 0.1      // 24-hour volume (10% weight)
    },
    
    // Price change timeframes (recency bias - must sum to 1.0)
    VOLATILITY_TIMEFRAMES: {
      MINUTES_5: 0.4,    // 5-minute price change (40% weight)
      HOURS_1: 0.3,      // 1-hour price change (30% weight)
      HOURS_6: 0.2,      // 6-hour price change (20% weight)
      HOURS_24: 0.1      // 24-hour price change (10% weight)
    },
    
    // Base priority scores for discovery status
    BASE_SCORES: {
      NEW_TOKEN: 80,     // Newly discovered tokens start with high priority 
      PARTIAL_DATA: 60,  // Tokens with some data but not complete
      COMPLETE_DATA: 40, // Tokens with complete data
      FAILED_REFRESH: 70 // Tokens that previously failed to refresh
    },
    
    // Decay factors
    DECAY: {
      SUCCESSFUL_REFRESH: 0.8, // Priority decays after successful refresh
      HOURS_SINCE_REFRESH: 0.1 // Priority increases by this factor per hour since last refresh
    }
  }
};

/**
 * Token Enrichment Service Class
 * 
 * @class TokenEnrichmentService
 * @extends {BaseService}
 */
class TokenEnrichmentService extends BaseService {
  constructor() {
    super({
      name: SERVICE_NAMES.TOKEN_ENRICHMENT,
      description: 'Token metadata and price enrichment',
      layer: 'DATA',
      criticalLevel: 'medium',
      checkIntervalMs: 60 * 1000 // 60 seconds
    });
    
    // Initialize state
    this.db = null;
    this.processingQueue = [];
    this.batchProcessing = false;
    this.activeBatches = 0;
    
    // Collectors
    this.collectors = {
      dexscreener: dexScreenerCollector,
      helius: heliusCollector,
      jupiter: jupiterCollector
    };
    
    // Merge service-specific stats into the base stats object
    this.stats = {
      ...this.stats, // Keep the base stats (operations, performance, circuitBreaker, history)
      // Add or overwrite with service-specific stats
      processedTotal: 0,
      processedSuccess: 0,
      processedFailed: 0,
      enqueuedTotal: 0,
      currentQueueSize: 0,
      lastProcessedTime: null,
      sources: {
        dexscreener: { success: 0, failed: 0 },
        helius: { success: 0, failed: 0 },
        jupiter: { success: 0, failed: 0 }
      }
    };
  }
  
  /**
   * Initialize the service
   * @returns {Promise<boolean>}
   */
  async initialize() {
    try {
      // Call parent initialize to set up base service functionality
      await super.initialize();
      
      // Use the singleton Prisma client
      this.db = prisma;

      // REMOVED: Self-registration with service manager
      // The following code was causing "dependencies is not iterable" errors because
      // this service is already registered by ServiceInitializer.registerDataLayer()
      // and doesn't need to register itself again during initialization.
      // const dependencies = [SERVICE_NAMES.TOKEN_DETECTION, SERVICE_NAMES.SOLANA_ENGINE];
      // serviceManager.register(this.name, dependencies);

      // Initialize collectors
      await jupiterCollector.initialize();
      
      // Set up event listeners
      this.registerEventListeners();
      
      // Start background processing
      this.startProcessingQueue();
      
      // Schedule recovery of stuck tokens after a brief delay (5 seconds)
      setTimeout(async () => {
        try {
          // Run a recovery pass on startup to fix stuck tokens
          const result = await this.reprocessStuckTokens(250); // Process up to 250 stuck tokens
          logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Startup recovery completed: ${result.enqueued} tokens re-enqueued`);
          
          // Set up a periodic recovery process (every 10 minutes instead of 30)
          setInterval(async () => {
            try {
              const periodicResult = await this.reprocessStuckTokens(100);
              logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Periodic recovery completed: ${periodicResult.enqueued} tokens re-enqueued`);
            } catch (err) {
              logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Periodic recovery failed: ${err.message || 'Unknown error'}`);
            }
          }, 10 * 60 * 1000); // Run every 10 minutes
        } catch (err) {
          logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Startup recovery failed: ${err.message || 'Unknown error'}`);
        }
      }, 5000);
      
      this.isInitialized = true;
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Token enrichment service ready`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      // Handle the error properly using BaseService's handler
      await this.handleError(error);
      this.isInitialized = false;
      return false;
    }
  }
  
  /**
   * Register event listeners
   */
  registerEventListeners() {
    // Listen for new token events from token detection service
    serviceEvents.on('token:new', async (tokenInfo) => {
      try {
        await this.handleNewToken(tokenInfo);
      } catch (error) {
        // Always use handleError for proper circuit breaker integration
        await this.handleError(error);
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error handling token:new event:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      }
    });
    
    // Listen for manual enrichment requests
    serviceEvents.on('token:enrich', async (tokenInfo) => {
      try {
        await this.enqueueTokenEnrichment(tokenInfo.address, CONFIG.PRIORITY_TIERS.HIGH);
      } catch (error) {
        await this.handleError(error);
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error handling token:enrich event:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      }
    });
    
    // Listen for system events
    serviceEvents.on('system:maintenance', (data) => {
      // Pause processing during maintenance
      this.pauseProcessing = data.active;
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${data.active ? 'Paused' : 'Resumed'} processing due to maintenance mode`);
    });
  }
  
  /**
   * Handle a new token event
   * @param {Object} tokenInfo - Information about the new token
   */
  async handleNewToken(tokenInfo) {
    try {
      // Check if we already know about this token
      const existingToken = await this.db.tokens.findFirst({
        where: { address: tokenInfo.address }
      });
      
      if (existingToken) {
        // Token already exists, update discovery timestamp and increment counter
        await this.db.tokens.update({
          where: { id: existingToken.id },
          data: { 
            last_discovery: new Date(),
            discovery_count: { increment: 1 }  // Use Prisma's increment operation for atomicity
          }
        });
        
        logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Incremented discovery count for ${tokenInfo.address}`);
        
        // Only re-enqueue for enrichment if it's been a while or metadata is incomplete
        // Get enrichment data from refresh_metadata if available
        const refreshMetadata = existingToken.refresh_metadata || {};
        const lastEnrichmentAttempt = refreshMetadata.last_enrichment_attempt 
                                    ? new Date(refreshMetadata.last_enrichment_attempt) 
                                    : existingToken.last_refresh_attempt;  // Fallback to last_refresh_attempt
                                    
        const lastEnrichmentSuccess = refreshMetadata.last_enrichment_success
                                    ? new Date(refreshMetadata.last_enrichment_success)
                                    : existingToken.last_refresh_success;  // Fallback to last_refresh_success
        
        const attemptCount = refreshMetadata.enrichment_attempts || 0;
        const daysSinceLastAttempt = lastEnrichmentAttempt 
                                    ? (new Date() - lastEnrichmentAttempt) / (1000 * 60 * 60 * 24)
                                    : 999; // Large number to ensure processing if no attempt record
        
        // Calculate re-enrichment conditions
        const isPending = existingToken.metadata_status === 'pending';
        const isFailed = existingToken.metadata_status === 'failed';
        const isOldAttempt = daysSinceLastAttempt > 1; // Re-attempt if older than 1 day
        const hasLowAttempts = attemptCount < 3; // Retry if fewer than 3 attempts
        
        // Decide whether to re-enrich based on more nuanced conditions
        const shouldReEnrich = (isPending && (isOldAttempt || hasLowAttempts)) || // Retry pending with conditions
                               isFailed && isOldAttempt || // Retry failed if it's been a while
                               !lastEnrichmentAttempt || // Always try if never attempted
                               daysSinceLastAttempt > 7; // Weekly refresh for all tokens
        
        // Log decision for debugging
        logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Re-enrichment decision for ${tokenInfo.address}: ${shouldReEnrich ? 'YES' : 'NO'} (status: ${existingToken.metadata_status}, attempts: ${attemptCount}, days since: ${daysSinceLastAttempt.toFixed(1)})`);
        
        if (shouldReEnrich) {
          // Add to enrichment queue with medium priority
          await this.enqueueTokenEnrichment(tokenInfo.address, CONFIG.PRIORITY_TIERS.MEDIUM);
        }
      } else {
        // New token, create initial record with minimal data
        const newToken = await this.db.tokens.create({
          data: {
            address: tokenInfo.address,
            first_discovery: new Date(),
            last_discovery: new Date(),
            discovery_count: 1,
            metadata_status: 'pending',
            is_active: true
          }
        });
        
        logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} NEW TOKEN ${fancyColors.RESET} Created record for ${tokenInfo.address}`);
        
        // Add to enrichment queue with high priority
        await this.enqueueTokenEnrichment(tokenInfo.address, CONFIG.PRIORITY_TIERS.HIGH);
      }
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error handling new token:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      logApi.debug(`[TokenEnrichmentSvc] Error details: ${error.code || ''} ${error.name || ''}`); // Safe details without circular refs
    }
  }
  
  /**
   * Enqueue a token for enrichment
   * @param {string} tokenAddress - Token address
   * @param {number} priorityTier - Priority tier from CONFIG.PRIORITY_TIERS
   * @param {number} priorityScore - Optional priority score (0-100)
   */
  async enqueueTokenEnrichment(tokenAddress, priorityTier = CONFIG.PRIORITY_TIERS.MEDIUM, priorityScore = null) {
    try {
      // Get priority score from database if not provided
      if (priorityScore === null) {
        try {
          const token = await this.db.tokens.findFirst({
            where: { address: tokenAddress },
            include: { token_prices: true }
          });
          
          if (token) {
            // Calculate priority score if token exists
            priorityScore = this.calculatePriorityScore(token);
            
            // Update token with new priority score
            await this.db.tokens.update({
              where: { id: token.id },
              data: { 
                priority_score: priorityScore,
                last_priority_calculation: new Date() 
              }
            });
          } else {
            // Unknown tokens get zero priority
            priorityScore = 0;
          }
        } catch (scoreError) {
          // On error, assign zero priority
          logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting priority score for ${tokenAddress}:${fancyColors.RESET} ${scoreError.message || 'Unknown error'}`);
          logApi.debug(`[TokenEnrichmentSvc] Score error details for ${tokenAddress}: ${scoreError.code || ''} ${scoreError.name || ''}`);
          priorityScore = 0;
        }
      }
      
      // Create queue item
      const queueItem = {
        address: tokenAddress,
        priorityTier, // Old tier-based priority (renamed for clarity)
        priorityScore, // Primary numeric score for sorting (0-100)
        addedAt: new Date(),
        attempts: 0
      };
      
      // Add to processing queue
      this.processingQueue.push(queueItem);
      
      // Safely update stats with null checks
      if (this.stats) {
        this.stats.enqueuedTotal = (this.stats.enqueuedTotal || 0) + 1;
        this.stats.currentQueueSize = this.processingQueue ? this.processingQueue.length : 0;
      }
      
      logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Enqueued ${tokenAddress} for enrichment (tier: ${priorityTier}, score: ${priorityScore}, queue size: ${this.processingQueue ? this.processingQueue.length : 0})`);
      
      // Start processing if not already running
      if (!this.batchProcessing && this.activeBatches < CONFIG.MAX_CONCURRENT_BATCHES) {
        this.processNextBatch();
      }
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error enqueueing token:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      logApi.debug(`[TokenEnrichmentSvc] Enqueue error details: ${error.code || ''} ${error.name || ''}`);
    }
  }
  
  /**
   * Start the queue processing mechanism
   */
  startProcessingQueue() {
    // Set interval to check queue and start processing if needed
    this.processingInterval = setInterval(() => {
      // Only process if not in maintenance mode
      if (!this.pauseProcessing) {
        // Start processing batches if queue has items and we're under max batches
        const canStartBatches = this.processingQueue.length > 0 && this.activeBatches < CONFIG.MAX_CONCURRENT_BATCHES;
        
        if (canStartBatches) {
          const batchesToStart = Math.min(
            CONFIG.MAX_CONCURRENT_BATCHES - this.activeBatches,
            Math.ceil(this.processingQueue.length / CONFIG.BATCH_SIZE)
          );
          
          logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Starting ${batchesToStart} batches (queue: ${this.processingQueue.length}, active: ${this.activeBatches})`);
          
          // Start multiple batches in parallel (up to MAX_CONCURRENT_BATCHES)
          for (let i = 0; i < batchesToStart; i++) {
            this.processNextBatch();
          }
        }
        
        // Report status periodically
        logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Queue status: ${this.processingQueue.length} items, ${this.activeBatches}/${CONFIG.MAX_CONCURRENT_BATCHES} active batches`);
      }
      
      // Emit heartbeat for service monitoring
      this.emitHeartbeat();
    }, 5000); // Check every 5 seconds
    
    logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Started queue processing monitor`);
  }
  
  /**
   * Emit service heartbeat event
   * Used for health monitoring
   */
  emitHeartbeat() {
    try {
      // Create safe stats object (no circular references)
      const safeStats = {
        queueSize: this.processingQueue.length,
        activeBatches: this.activeBatches,
        processedTotal: this.stats.processedTotal,
        processedSuccess: this.stats.processedSuccess,
        processedFailed: this.stats.processedFailed,
        lastProcessedTime: this.stats.lastProcessedTime,
        sources: {
          dexscreener: { ...this.stats.sources.dexscreener },
          helius: { ...this.stats.sources.helius },
          jupiter: { ...this.stats.sources.jupiter }
        }
      };
      
      // Emit service heartbeat event
      serviceEvents.emit('service:heartbeat', {
        name: this.name,
        timestamp: new Date().toISOString(),
        stats: safeStats
      });
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error emitting heartbeat:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
    }
  }
  
  /**
   * Process the next batch of tokens with more efficient parallel processing
   */
  async processNextBatch() {
    // First check if circuit breaker is open
    if (this.isCircuitBreakerOpen()) {
      logApi.warn(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Circuit breaker open, skipping batch processing${fancyColors.RESET}`);
      this.batchProcessing = false;
      return;
    }
    
    if (!this.processingQueue || this.processingQueue.length === 0) {
      this.batchProcessing = false;
      return;
    }
    
    this.batchProcessing = true;
    this.activeBatches = (this.activeBatches || 0) + 1;
    
    try {
      // Sort queue primarily by priorityScore (high scores first) then by other factors
      this.processingQueue.sort((a, b) => {
        // Primary sorting by priorityScore (higher score = higher priority)
        if (a.priorityScore !== b.priorityScore) {
          return b.priorityScore - a.priorityScore;
        }
        
        // Secondary sorting by tier (lower tier number = higher priority)
        if (a.priorityTier !== b.priorityTier) {
          return a.priorityTier - b.priorityTier;
        }
        
        // Tertiary sorting by age (older items first)
        return a.addedAt - b.addedAt;
      });
      
      // Take the next batch
      const batch = this.processingQueue.splice(0, CONFIG.BATCH_SIZE);
      
      // Safely update stats
      if (this.stats) {
        this.stats.currentQueueSize = this.processingQueue ? this.processingQueue.length : 0;
      }
      
      // Extract addresses from batch
      const batchAddresses = batch.map(item => item.address);
      
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} BATCH START ${fancyColors.RESET} Processing batch of ${batchAddresses.length} tokens using parallel API calls`);
      
      // Optimized Collect data in parallel to reduce overall time
      try {
        // Start all API requests in parallel
        const apiPromises = [
          jupiterCollector.getTokenInfoBatch(batchAddresses),
          heliusCollector.getTokenMetadataBatch(batchAddresses),
          dexScreenerCollector.getTokensByAddressBatch(batchAddresses)
        ];
        
        // Wait for all API responses
        const [jupiterData, heliusData, dexScreenerData] = await Promise.all(apiPromises);
        
        // Log API success/failure metrics
        const jupiterSuccess = Object.keys(jupiterData || {}).length;
        const heliusSuccess = Object.keys(heliusData || {}).length;
        const dexScreenerSuccess = Object.keys(dexScreenerData || {}).length;
        
        logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} API success: Jupiter ${jupiterSuccess}/${batchAddresses.length}, Helius ${heliusSuccess}/${batchAddresses.length}, DexScreener ${dexScreenerSuccess}/${batchAddresses.length}`);
        
        // Process each token with the collected data
        const processingPromises = batch.map(item => {
          // Create a combined data object for this token
          const tokenData = {
            address: item.address,
            jupiter: jupiterData[item.address] || null,
            helius: heliusData[item.address] || null,
            dexscreener: dexScreenerData[item.address] || null
          };
          
          // Check data completeness for each token
          const hasJupiter = !!tokenData.jupiter;
          const hasHelius = !!tokenData.helius;
          const hasDexScreener = !!tokenData.dexscreener;
          
          // Log if any API failed to return data for this token (for monitoring issues)
          if (!hasJupiter || !hasHelius || !hasDexScreener) {
            logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} INCOMPLETE DATA ${fancyColors.RESET} Token ${item.address}: Jupiter ${hasJupiter ? '✅' : '❌'}, Helius ${hasHelius ? '✅' : '❌'}, DexScreener ${hasDexScreener ? '✅' : '❌'}`);
          }
          
          // Process and store the token data
          return this.processAndStoreToken(item.address, tokenData);
        });
        
        // Wait for all tokens to be processed
        const results = await Promise.allSettled(processingPromises);
        
        // Calculate success statistics
        const successCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
        const failCount = batch.length - successCount;
        
        // Calculate and update token priority scores for successfully processed tokens
        const successfulTokens = batch.filter((item, index) => 
          results[index].status === 'fulfilled' && results[index].value === true
        );
        
        if (successfulTokens.length > 0) {
          await this.updateTokenPriorityScores(successfulTokens.map(item => item.address));
        }
        
        logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} BATCH COMPLETE ${fancyColors.RESET} Processed ${batchAddresses.length} tokens in batch mode: ${successCount} success, ${failCount} failed`);
      } catch (batchError) {
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ⚠️ BATCH FAILURE ⚠️ ${fancyColors.RESET} ${fancyColors.RED}Falling back to individual processing:${fancyColors.RESET} ${batchError.message || 'Unknown error'}`);
        logApi.debug(`[TokenEnrichmentSvc] Batch failure details: ${batchError.code || ''} ${batchError.name || ''}`);
        
        // Fallback to processing tokens individually
        logApi.warn(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Starting individual fallback processing for ${batch.length} tokens${fancyColors.RESET}`);
        
        // Process each token with individual API calls (fallback)
        const processingPromises = batch.map(item => this.enrichToken(item.address));
        const fallbackResults = await Promise.allSettled(processingPromises);
        
        // Calculate fallback success statistics
        const fallbackSuccessCount = fallbackResults.filter(r => r.status === 'fulfilled' && r.value === true).length;
        const fallbackFailCount = batch.length - fallbackSuccessCount;
        
        logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} FALLBACK COMPLETE ${fancyColors.RESET} Individually processed ${batch.length} tokens: ${fallbackSuccessCount} success, ${fallbackFailCount} failed`);
        
        // Update priority scores for successful fallbacks too
        const successfulTokens = batch.filter((item, index) => 
          fallbackResults[index].status === 'fulfilled' && fallbackResults[index].value === true
        );
        
        if (successfulTokens.length > 0) {
          await this.updateTokenPriorityScores(successfulTokens.map(item => item.address));
        }
      }
      
      // Clean up
      this.activeBatches--;
      this.batchProcessing = this.activeBatches > 0;
      
      // Continue with next batch if there are more items
      if (this.processingQueue.length > 0 && this.activeBatches < CONFIG.MAX_CONCURRENT_BATCHES) {
        setTimeout(() => {
          this.processNextBatch();
        }, CONFIG.BATCH_DELAY_MS);
      }
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing batch:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      logApi.debug(`[TokenEnrichmentSvc] Batch processing error details: ${error.code || ''} ${error.name || ''}`);
      
      // Reduce active batches count and reset processing flag if needed
      this.activeBatches--;
      this.batchProcessing = this.activeBatches > 0;
    }
  }
  
  /**
   * Process and store token data from batch processing
   * @param {string} tokenAddress - Token address
   * @param {Object} enrichedData - Combined data from all sources
   * @returns {Promise<boolean>} Success status
   */
  async processAndStoreToken(tokenAddress, enrichedData) {
    try {
      // Start timing
      const startTime = Date.now();
      
      // Increment enrichment attempts counter
      const attemptCount = await this.incrementEnrichmentAttempts(tokenAddress);
      
      // Update token record to mark enrichment attempt
      await this.db.tokens.updateMany({
        where: { address: tokenAddress },
        data: { 
          last_refresh_attempt: new Date() // Using existing last_refresh_attempt field
        }
      });
      
      logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Processing batch data for ${tokenAddress} (attempt ${attemptCount})`);
      
      // Check if we have any useful data
      const hasData = enrichedData.jupiter || enrichedData.helius || enrichedData.dexscreener;
      if (!hasData) {
        logApi.warn(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.YELLOW}No data collected for ${tokenAddress}${fancyColors.RESET}`);
        
        // Update token record to mark failed enrichment
        await this.db.tokens.updateMany({
          where: { address: tokenAddress },
          data: { 
            metadata_status: 'failed',
            refresh_metadata: {
              last_enrichment_error: 'No data collected',
              last_error_time: new Date().toISOString()
            }
          }
        });
        
        this.stats.processedFailed++;
        return false;
      }
      
      // Store the enriched data
      const success = await this.storeTokenData(tokenAddress, enrichedData);
      
      // Update statistics with safe access
      if (this.stats) {
        this.stats.processedTotal = (this.stats.processedTotal || 0) + 1;
        if (success) {
          this.stats.processedSuccess = (this.stats.processedSuccess || 0) + 1;
        } else {
          this.stats.processedFailed = (this.stats.processedFailed || 0) + 1;
        }
        
        this.stats.lastProcessedTime = new Date().toISOString();
      }
      
      // Log performance
      const elapsedMs = Date.now() - startTime;
      logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${success ? fancyColors.GREEN : fancyColors.YELLOW}Processed ${tokenAddress} in ${elapsedMs}ms (${success ? 'success' : 'partial'})${fancyColors.RESET}`);
      
      // Emit event if successful
      if (success) {
        serviceEvents.emit('token:enriched', {
          address: tokenAddress,
          enrichedAt: new Date().toISOString(),
          sources: Object.keys(enrichedData).filter(key => enrichedData[key] !== null && key !== 'address')
        });
      }
      
      return success;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing token ${tokenAddress}:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      logApi.debug(`[TokenEnrichmentSvc] Error details: ${error.code || ''} ${error.name || ''} ${error.stack ? error.stack.split('\n')[0] : ''}`);
      
      // Update token record to mark failed enrichment
      try {
        await this.db.tokens.updateMany({
          where: { address: tokenAddress },
          data: { 
            metadata_status: 'failed',
            refresh_metadata: {
              last_enrichment_error: error.message,
              last_error_time: new Date().toISOString()
            }
          }
        });
      } catch (dbError) {
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Database error:${fancyColors.RESET} ${dbError.message || 'Unknown error'}`);
      logApi.debug(`[TokenEnrichmentSvc] Database error details: ${dbError.code || ''} ${dbError.name || ''}`);
      }
      
      this.stats.processedFailed++;
      return false;
    }
  }
  
  /**
   * Get current enrichment attempts count
   * @param {string} tokenAddress - Token address
   * @returns {Promise<number>} - Current attempts count or 0
   */
  async getEnrichmentAttempts(tokenAddress) {
    try {
      const token = await this.db.tokens.findFirst({
        where: { address: tokenAddress }
      });
      
      if (!token) return 0;
      
      // Get attempts from refresh_metadata if available
      const currentAttempts = token.refresh_metadata?.enrichment_attempts || 0;
      
      // Log for debugging
      logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Token ${tokenAddress} has ${currentAttempts} enrichment attempts`);
      
      return currentAttempts;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting enrichment attempts:${fancyColors.RESET}`, error);
      return 0;
    }
  }
  
  /**
   * Update enrichment attempts count
   * @param {string} tokenAddress - Token address
   * @returns {Promise<number>} - New attempts count
   */
  async incrementEnrichmentAttempts(tokenAddress) {
    try {
      const token = await this.db.tokens.findFirst({
        where: { address: tokenAddress }
      });
      
      if (!token) return 0;
      
      // Get current attempts from refresh_metadata if available
      const currentAttempts = token.refresh_metadata?.enrichment_attempts || 0;
      const newAttempts = currentAttempts + 1;
      
      // Update with new count
      const refreshMetadata = {
        ...(token.refresh_metadata || {}),
        enrichment_attempts: newAttempts,
        last_enrichment_attempt: new Date().toISOString()
      };
      
      await this.db.tokens.update({
        where: { id: token.id },
        data: { 
          refresh_metadata: refreshMetadata
        }
      });
      
      logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Incremented enrichment attempts for ${tokenAddress} to ${newAttempts}`);
      return newAttempts;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error incrementing enrichment attempts:${fancyColors.RESET}`, error);
      return 0;
    }
  }
  
  /**
   * Enrich a single token with metadata from all sources
   * @param {string} tokenAddress - Token address
   */
  async enrichToken(tokenAddress) {
    try {
      // Start timing
      const startTime = Date.now();
      
      // Increment enrichment attempts counter
      const attemptCount = await this.incrementEnrichmentAttempts(tokenAddress);
      
      // Update token record to mark enrichment attempt
      await this.db.tokens.updateMany({
        where: { address: tokenAddress },
        data: { 
          last_refresh_attempt: new Date() // Using existing last_refresh_attempt field
        }
      });
      
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Starting enrichment for ${tokenAddress} (attempt ${attemptCount})`);
      
      
      // Get token data from all sources
      const enrichedData = await this.collectTokenData(tokenAddress);
      
      // No data collected
      if (!enrichedData || Object.keys(enrichedData).length === 0) {
        logApi.warn(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.YELLOW}No data collected for ${tokenAddress}${fancyColors.RESET}`);
        
        // Update token record to mark failed enrichment
        await this.db.tokens.updateMany({
          where: { address: tokenAddress },
          data: { 
            metadata_status: 'failed',
            refresh_metadata: {
              last_enrichment_error: 'No data collected',
              last_error_time: new Date().toISOString()
            }
          }
        });
        
        this.stats.processedFailed++;
        return false;
      }
      
      // Store the enriched data
      const success = await this.storeTokenData(tokenAddress, enrichedData);
      
      // Update statistics with safe access
      if (this.stats) {
        this.stats.processedTotal = (this.stats.processedTotal || 0) + 1;
        if (success) {
          this.stats.processedSuccess = (this.stats.processedSuccess || 0) + 1;
        } else {
          this.stats.processedFailed = (this.stats.processedFailed || 0) + 1;
        }
        
        this.stats.lastProcessedTime = new Date().toISOString();
      }
      
      // Log performance
      const elapsedMs = Date.now() - startTime;
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${success ? fancyColors.GREEN : fancyColors.YELLOW}Enriched ${tokenAddress} in ${elapsedMs}ms (${success ? 'success' : 'partial'})${fancyColors.RESET}`);
      
      // Emit event if successful
      if (success) {
        serviceEvents.emit('token:enriched', {
          address: tokenAddress,
          enrichedAt: new Date().toISOString(),
          sources: Object.keys(enrichedData)
        });
      }
      
      return success;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error enriching token ${tokenAddress}:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      logApi.debug(`[TokenEnrichmentSvc] Enrichment error details: ${error.code || ''} ${error.name || ''} ${error.stack ? error.stack.split('\n')[0] : ''}`);
      
      // Update token record to mark failed enrichment
      try {
        await this.db.tokens.updateMany({
          where: { address: tokenAddress },
          data: { 
            metadata_status: 'failed',
            refresh_metadata: {
              last_enrichment_error: error.message,
              last_error_time: new Date().toISOString()
            }
          }
        });
      } catch (dbError) {
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Database error:${fancyColors.RESET} ${dbError.message || 'Unknown error'}`);
      logApi.debug(`[TokenEnrichmentSvc] Database error details: ${dbError.code || ''} ${dbError.name || ''}`);
      }
      
      this.stats.processedFailed++;
      return false;
    }
  }
  
  /**
   * Collect token data from all sources
   * @param {string} tokenAddress - Token address
   * @returns {Promise<Object>} Combined token data
   */
  async collectTokenData(tokenAddress) {
    const enrichedData = {
      // Basic token data
      address: tokenAddress,
      
      // Data from sources
      dexscreener: null,
      helius: null,
      jupiter: null
    };
    
    // Try to get data from each source
    try {
      // Jupiter data (basic info) - fastest and most reliable for basic info
      enrichedData.jupiter = await jupiterCollector.getTokenInfo(tokenAddress);
      await this.sleep(CONFIG.THROTTLE_MS);
      
      // Helius data (on-chain data)
      enrichedData.helius = await heliusCollector.getTokenMetadata(tokenAddress);
      if (enrichedData.helius) {
        this.stats.sources.helius.success++;
      } else {
        this.stats.sources.helius.failed++;
      }
      await this.sleep(CONFIG.THROTTLE_MS);
      
      // DexScreener data (market data) - can be slow and rate-limited
      enrichedData.dexscreener = await dexScreenerCollector.getTokenByAddress(tokenAddress);
      if (enrichedData.dexscreener) {
        this.stats.sources.dexscreener.success++;
      } else {
        this.stats.sources.dexscreener.failed++;
      }
      await this.sleep(CONFIG.DEXSCREENER_THROTTLE_MS);
      
      // Check if we have any useful data
      const hasData = enrichedData.jupiter || enrichedData.helius || enrichedData.dexscreener;
      return hasData ? enrichedData : null;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error collecting token data:${fancyColors.RESET}`, error);
      return enrichedData;
    }
  }
  
  /**
   * Store enriched token data in the database
   * @param {string} tokenAddress - Token address
   * @param {Object} data - Enriched token data
   * @returns {Promise<boolean>} Success status
   */
  async storeTokenData(tokenAddress, data) {
    try {
      // Get existing token
      const existingToken = await this.db.tokens.findFirst({
        where: { address: tokenAddress },
        include: { token_prices: true }
      });
      
      if (!existingToken) {
        logApi.warn(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Token ${tokenAddress} not found in database${fancyColors.RESET}`);
        return false;
      }
      
      // Combine data from all sources with priority order
      const combinedData = this.mergeTokenData(data);
      
      // Define metadata status - fix previous issue where status was not being updated properly
      let metadataStatus = 'pending'; // Default status
      
      // CRITICAL: Address is the most important field for any token - it must exist
      // Then check other required basic info fields
      const hasAddress = !!tokenAddress; // Must have valid token address
      const hasBasicInfo = hasAddress && 
                           combinedData.symbol && 
                           combinedData.name && 
                           combinedData.decimals;
      
      // Check if we have the required token info
      if (!hasAddress) {
        // No address = automatic failure
        metadataStatus = 'failed';
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Missing address for token, cannot process${fancyColors.RESET}`);
      } else if (hasBasicInfo) {
        // Has all required fields
        metadataStatus = 'complete';
      } else if (existingToken.metadata_status === 'pending' && existingToken.last_refresh_attempt) {
        // If this is a retry and we still don't have all basic info, mark as failed
        metadataStatus = 'failed';
      }
      
      // Update token record with combined data
      await this.db.tokens.update({
        where: { id: existingToken.id },
        data: {
          symbol: combinedData.symbol,
          name: combinedData.name,
          decimals: combinedData.decimals,
          color: combinedData.color || '#888888',
          image_url: combinedData.imageUrl,
          // Use dedicated columns for additional images
          header_image_url: combinedData.headerUrl,
          open_graph_image_url: combinedData.openGraphUrl,
          description: combinedData.description,
          last_refresh_success: new Date(),
          metadata_status: metadataStatus,
          discovery_count: existingToken.discovery_count + 1, // Fix discovery count increment
          
          // Store enhanced metadata in the refresh_metadata JSON field
          refresh_metadata: {
            ...existingToken.refresh_metadata,
            last_enrichment_success: new Date().toISOString(),
            enrichment_status: metadataStatus,
            
            // NEW: Store enhanced market data
            enhanced_market_data: {
              // Detailed price changes for all timeframes
              priceChanges: combinedData.priceChanges,
              
              // Detailed volume data for all timeframes
              volumes: combinedData.volumes,
              
              // Transaction counts
              transactions: combinedData.transactions,
              
              // Creation date
              pairCreatedAt: combinedData.pairCreatedAt ? combinedData.pairCreatedAt.toISOString() : null,
              
              // Boost information
              boosts: combinedData.boosts
            }
          }
        }
      });
      
      // Log status change if it changed
      if (metadataStatus !== existingToken.metadata_status) {
        logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} STATUS UPDATE ${fancyColors.RESET} Token ${tokenAddress} metadata status changed from '${existingToken.metadata_status}' to '${metadataStatus}'`);
      }
      
      // Store token price if available
      if (combinedData.price !== undefined) {
        await this.db.token_prices.upsert({
          where: { token_id: existingToken.id },
          update: {
            price: combinedData.price.toString(),
            change_24h: combinedData.priceChange24h || null,
            market_cap: combinedData.marketCap || null,
            fdv: combinedData.fdv || null,
            liquidity: combinedData.liquidity || null,
            volume_24h: combinedData.volume24h || null,
            updated_at: new Date()
          },
          create: {
            token_id: existingToken.id,
            price: combinedData.price.toString(),
            change_24h: combinedData.priceChange24h || null,
            market_cap: combinedData.marketCap || null,
            fdv: combinedData.fdv || null,
            liquidity: combinedData.liquidity || null,
            volume_24h: combinedData.volume24h || null,
            updated_at: new Date()
          }
        });
        
        // Add price history record
        await this.db.token_price_history.create({
          data: {
            token_id: existingToken.id,
            price: combinedData.price.toString(),
            source: 'enrichment_service',
            timestamp: new Date()
          }
        });
        
        // Update token's last_price_change field if price changed
        if (existingToken.token_prices) {
          const oldPrice = parseFloat(existingToken.token_prices.price || '0');
          const newPrice = parseFloat(combinedData.price || '0');
          
          // Update last_price_change whenever ANY price change is detected
          // This ensures we capture all price movements, even small ones that accumulate
          if (newPrice !== oldPrice) {
            await this.db.tokens.update({
              where: { id: existingToken.id },
              data: { last_price_change: new Date() }
            });
            
            // Still log significant changes (>1%) for monitoring
            if (Math.abs((newPrice - oldPrice) / oldPrice) > 0.01) {
              logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Significant price change for ${tokenAddress}: ${oldPrice} -> ${newPrice} (${((newPrice - oldPrice) / oldPrice * 100).toFixed(2)}%)`);
            }
          }
        }
      }
      
      // Store social links if available
      if (combinedData.socials && Object.keys(combinedData.socials).length > 0) {
        // Extract website URL (if any) - we'll handle this separately
        const websiteUrl = combinedData.socials.website;
        const otherSocials = {...combinedData.socials};
        delete otherSocials.website;
        
        // Delete existing social links (except website which is in token_websites)
        await this.db.token_socials.deleteMany({
          where: { token_id: existingToken.id }
        });
        
        // Add social media links (Twitter, Telegram, Discord, etc.)
        for (const [type, url] of Object.entries(otherSocials)) {
          if (url) {
            await this.db.token_socials.create({
              data: {
                token_id: existingToken.id,
                type,
                url: url.substring(0, 255) // Ensure URL is not too long
              }
            });
          }
        }
        
        // NEW: Store all websites in dedicated table if available
        // First, handle the primary website for backward compatibility
        if (websiteUrl) {
          try {
            // Get the website label if available from DexScreener
            const websiteLabel = data.dexscreener?.websiteLabel || 'Official'; // Corrected: use 'data' parameter
            
            await this.db.token_websites.upsert({
              where: { 
                id: (await this.db.token_websites.findFirst({
                  where: { 
                    token_id: existingToken.id,
                    label: websiteLabel
                  }
                }))?.id || 0
              },
              update: {
                url: websiteUrl.substring(0, 255)
              },
              create: {
                token_id: existingToken.id,
                label: websiteLabel,
                url: websiteUrl.substring(0, 255)
              }
            });
            
            logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Updated primary website for ${tokenAddress}: ${websiteUrl}`);
          } catch (websiteError) {
            logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error storing primary website for ${tokenAddress}:${fancyColors.RESET}`, websiteError);
          }
        }
        
        // NEW: Store additional websites if available
        if (combinedData.websites && Array.isArray(combinedData.websites) && combinedData.websites.length > 1) {
          try {
            // Skip the first website as it's already been handled above
            for (let i = 1; i < combinedData.websites.length; i++) {
              const website = combinedData.websites[i];
              if (!website.url) continue;
              
              // Store additional website with its label
              await this.db.token_websites.upsert({
                where: {
                  id: (await this.db.token_websites.findFirst({
                    where: {
                      token_id: existingToken.id,
                      label: website.label || `Additional ${i}`
                    }
                  }))?.id || 0
                },
                update: {
                  url: website.url.substring(0, 255)
                },
                create: {
                  token_id: existingToken.id,
                  label: website.label || `Additional ${i}`,
                  url: website.url.substring(0, 255)
                }
              });
            }
            
            logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Stored ${combinedData.websites.length - 1} additional websites for ${tokenAddress}`);
          } catch (additionalWebsiteError) {
            logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error storing additional websites for ${tokenAddress}:${fancyColors.RESET}`, additionalWebsiteError);
          }
        }
        
        // Log successful social data update
        if (Object.keys(otherSocials).length > 0) {
          logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Updated social links for ${tokenAddress}: ${Object.keys(otherSocials).join(', ')}`);
        }
      }
      
      // Calculate and update priority score after all data is stored
      const priorityScore = this.calculatePriorityScore({
        ...existingToken,
        token_prices: existingToken.token_prices || null,
        ...combinedData
      });
      
      await this.db.tokens.update({
        where: { id: existingToken.id },
        data: { 
          priority_score: priorityScore,
          last_priority_calculation: new Date() 
        }
      });
      
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error storing token data:${fancyColors.RESET}`, error);
      
      // Mark token as failed if there's a persistent error
      try {
        await this.db.tokens.updateMany({
          where: { address: tokenAddress },
          data: { 
            metadata_status: 'failed',
            refresh_metadata: {
              last_enrichment_error: error.message,
              last_error_time: new Date().toISOString()
            }
          }
        });
      } catch (updateError) {
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error marking token as failed:${fancyColors.RESET}`, updateError);
      }
      
      return false;
    }
  }
  
  /**
   * Merge token data from multiple sources
   * @param {Object} data - Data from all sources
   * @returns {Object} Merged token data
   */
  mergeTokenData(data) {
    // Define source priorities (which source to prefer for each field)
    const sourcePriorities = {
      symbol: ['dexscreener', 'helius', 'jupiter'],
      name: ['dexscreener', 'helius', 'jupiter'],
      decimals: ['jupiter', 'helius', 'dexscreener'],
      price: ['dexscreener', 'jupiter'],
      imageUrl: ['dexscreener', 'helius', 'jupiter'], // Now prioritize DexScreener for images
      description: ['dexscreener', 'helius'], // Now prioritize DexScreener for descriptions too
      headerUrl: ['dexscreener'],
      openGraphUrl: ['dexscreener']
    };
    
    // Prepare result object
    const result = {
      address: data.address
    };
    
    // Extract data from sources with priority
    for (const [field, sources] of Object.entries(sourcePriorities)) {
      for (const source of sources) {
        // Skip if source data is not available
        if (!data[source]) continue;
        
        // Extract field based on source
        let value = null;
        
        if (source === 'dexscreener') {
          if (field === 'symbol') value = data.dexscreener.symbol;
          if (field === 'name') value = data.dexscreener.name;
          if (field === 'decimals') value = 9; // DexScreener doesn't provide decimals, default to 9
          if (field === 'price') value = data.dexscreener.price;
          // NEW: DexScreener now provides image URL and other media
          if (field === 'imageUrl') value = data.dexscreener.metadata?.imageUrl;
          if (field === 'description') value = data.dexscreener.metadata?.description;
          if (field === 'headerUrl') value = data.dexscreener.metadata?.headerUrl;
          if (field === 'openGraphUrl') value = data.dexscreener.metadata?.openGraphUrl;
        } else if (source === 'helius') {
          if (field === 'symbol') value = data.helius.symbol;
          if (field === 'name') value = data.helius.name;
          if (field === 'decimals') value = data.helius.decimals;
          if (field === 'price') value = null; // Helius doesn't provide price
          if (field === 'imageUrl') value = data.helius.imageUrl;
          if (field === 'description') value = data.helius.description;
        } else if (source === 'jupiter') {
          if (field === 'symbol') value = data.jupiter.symbol;
          if (field === 'name') value = data.jupiter.name;
          if (field === 'decimals') value = data.jupiter.decimals;
          if (field === 'price') value = null; // Jupiter doesn't provide price in token info
          if (field === 'imageUrl') value = data.jupiter.logoURI;
          if (field === 'description') value = null; // Jupiter doesn't provide description
        }
        
        // If we found a value, use it and stop looking
        if (value !== null && value !== undefined) {
          result[field] = value;
          break;
        }
      }
    }
    
    // Merge market data (from DexScreener primarily)
    if (data.dexscreener) {
      // Basic market data
      result.priceChange24h = data.dexscreener.priceChange24h;
      result.volume24h = data.dexscreener.volume24h;
      result.liquidity = data.dexscreener.liquidity?.usd || data.dexscreener.liquidity; // Handle both formats
      result.fdv = data.dexscreener.fdv;
      result.marketCap = data.dexscreener.marketCap;
      
      // NEW: Add detailed price changes for all timeframes
      result.priceChanges = data.dexscreener.priceChange || {};
      
      // NEW: Add detailed volume data for all timeframes
      result.volumes = data.dexscreener.volume || {};
      
      // NEW: Add transaction counts
      result.transactions = data.dexscreener.txns || {};
      
      // NEW: Add pair creation date if available
      if (data.dexscreener.pairCreatedAt) {
        result.pairCreatedAt = data.dexscreener.pairCreatedAt;
      }
      
      // NEW: Add boost information if available
      if (data.dexscreener.boosts) {
        result.boosts = data.dexscreener.boosts;
      }
    }
    
    // Merge social data
    result.socials = {};
    
    // NEW: Store all websites in a dedicated array
    result.websites = [];
    
    // Add socials from DexScreener
    if (data.dexscreener) {
      // Copy all social links
      if (data.dexscreener.socials) {
        Object.entries(data.dexscreener.socials).forEach(([type, url]) => {
          if (url) result.socials[type] = url;
        });
      }
      
      // NEW: Copy all websites with their labels
      if (data.dexscreener.websites && Array.isArray(data.dexscreener.websites)) {
        result.websites = [...data.dexscreener.websites];
        
        // For backward compatibility, copy website label
        if (data.dexscreener.websiteLabel) {
          result.websiteLabel = data.dexscreener.websiteLabel;
        } else if (result.websites.length > 0) {
          result.websiteLabel = result.websites[0].label || 'Official';
        }
      }
    }
    
    // Add socials from Helius (only if not already present)
    if (data.helius && data.helius.socials) {
      Object.entries(data.helius.socials).forEach(([type, url]) => {
        if (url && !result.socials[type]) result.socials[type] = url;
      });
    }
    
    // Generate a color if not provided
    if (!result.color) {
      // Simple hash function to generate consistent colors
      let hash = 0;
      for (let i = 0; i < (result.symbol || result.address).length; i++) {
        hash = ((result.symbol || result.address).charCodeAt(i) + ((hash << 5) - hash)) & 0xFFFFFF;
      }
      result.color = `#${hash.toString(16).padStart(6, '0')}`;
    }
    
    return result;
  }
  
  /**
   * Sleep function for throttling
   * @param {number} ms - Milliseconds to sleep
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Basic service health check
   * @returns {Promise<boolean>}
   */
  async checkServiceHealth() {
    try {
      // Check database connection
      await this.db.$queryRaw`SELECT 1 as ping`;
      
      // All good
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Health check failed:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      logApi.debug(`[TokenEnrichmentSvc] Health check error details: ${error.code || ''} ${error.name || ''}`);
      throw error;
    }
  }
  
  /**
   * Check if the circuit breaker is currently open
   * @returns {boolean} True if circuit breaker is open
   */
  isCircuitBreakerOpen() {
    // Access the circuit breaker from BaseService
    if (this.circuitBreaker) {
      return this.circuitBreaker.isOpen();
    }
    return false; 
  }
  
  /**
   * Perform service operation
   * @returns {Promise<Object>}
   */
  async performOperation() {
    try {
      // Check if circuit breaker is open
      if (this.isCircuitBreakerOpen()) {
        logApi.warn(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Circuit breaker open, skipping operation${fancyColors.RESET}`);
        
        // Emit circuit breaker status event
        serviceEvents.emit('service:circuit-breaker', {
          name: this.name,
          status: 'open',
          timestamp: new Date().toISOString()
        });
        
        return {
          success: false,
          error: 'Circuit breaker open',
          circuitBreaker: 'open'
        };
      }
      
      // Check service health
      await this.checkServiceHealth();
      
      // Update statistics (with safe access)
      if (this.stats) {
        this.stats.currentQueueSize = this.processingQueue ? this.processingQueue.length : 0;
      }
      
      // Emit service status event for monitoring
      serviceEvents.emit('token-enrichment:status', {
        name: this.name,
        status: 'healthy',
        queueSize: this.processingQueue ? this.processingQueue.length : 0,
        activeBatches: this.activeBatches || 0,
        timestamp: new Date().toISOString()
      });
      
      // Return health status and safe stats
      return {
        success: true,
        stats: this.stats ? { ...this.stats } : {}
      };
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Operation failed:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      logApi.debug(`[TokenEnrichmentSvc] Operation error details: ${error.code || ''} ${error.name || ''}`);
      
      // Always use handleError for proper circuit breaker integration
      await this.handleError(error);
      
      // Emit failure event
      serviceEvents.emit('token-enrichment:error', {
        name: this.name,
        error: {
          message: error.message,
          code: error.code
        },
        timestamp: new Date().toISOString()
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Calculate a token's priority score based on multiple factors
   * @param {Object} tokenData - Token data including market metrics
   * @returns {number} Priority score (0-100, higher = more important)
   */
  calculatePriorityScore(tokenData) {
    try {
      if (!tokenData) return 0;
      
      let score = 0;
      const weights = CONFIG.PRIORITY_SCORE.WEIGHTS;
      
      // Check token status and assign base score
      if (tokenData.metadata_status === 'pending' && !tokenData.last_refresh_attempt) {
        // New token that has never been processed
        score = CONFIG.PRIORITY_SCORE.BASE_SCORES.NEW_TOKEN;
      } else if (tokenData.metadata_status === 'failed') {
        // Failed token - give it high priority to retry
        score = CONFIG.PRIORITY_SCORE.BASE_SCORES.FAILED_REFRESH;
      } else if (tokenData.metadata_status === 'pending') {
        // Partially processed token
        score = CONFIG.PRIORITY_SCORE.BASE_SCORES.PARTIAL_DATA;
      } else {
        // Complete data - lowest base priority
        score = CONFIG.PRIORITY_SCORE.BASE_SCORES.COMPLETE_DATA;
      }
      
      // Factor 1: Volume Score (0-100)
      let volumeScore = 0;
      if (tokenData.token_prices?.volume_24h) {
        // Log scale to handle wide range of volumes (from 1 to billions)
        const volume = parseFloat(tokenData.token_prices.volume_24h) || 0;
        if (volume > 0) {
          // Logarithmic scale: log10(volume) / 9 * 100
          // This maps $1 to ~11, $1000 to ~33, $1M to ~67, $1B to 100
          volumeScore = Math.min(100, Math.max(0, (Math.log10(volume) / 9) * 100));
        }
      }
      
      // Factor 2: Volatility Score (0-100)
      let volatilityScore = 0;
      if (tokenData.token_prices?.change_24h) {
        // Absolute value of price change - more change (either direction) = higher priority
        const priceChange = Math.abs(parseFloat(tokenData.token_prices.change_24h) || 0);
        // 100% change = score of 100, scales linearly
        volatilityScore = Math.min(100, priceChange);
      }
      
      // Factor 3: Liquidity Score (0-100)
      let liquidityScore = 0;
      if (tokenData.token_prices?.liquidity) {
        // Log scale to handle wide range of liquidity (from 1 to billions)
        const liquidity = parseFloat(tokenData.token_prices.liquidity) || 0;
        if (liquidity > 0) {
          // Logarithmic scale: log10(liquidity) / 9 * 100
          liquidityScore = Math.min(100, Math.max(0, (Math.log10(liquidity) / 9) * 100));
        }
      }
      
      // Apply weights to each factor
      const weightedScore = 
        (volumeScore * weights.VOLUME) +
        (volatilityScore * weights.VOLATILITY) +
        (liquidityScore * weights.LIQUIDITY);
      
      // Add weighted score to base score, but cap at 100
      score = Math.min(100, score + weightedScore);
      
      // Apply time-based adjustment
      if (tokenData.last_refresh_success) {
        // Decay priority after successful refresh
        score *= CONFIG.PRIORITY_SCORE.DECAY.SUCCESSFUL_REFRESH;
        
        // But increase it based on time since last refresh
        const hoursSinceLastRefresh = (new Date() - new Date(tokenData.last_refresh_success)) / (1000 * 60 * 60);
        score += Math.min(30, hoursSinceLastRefresh * CONFIG.PRIORITY_SCORE.DECAY.HOURS_SINCE_REFRESH);
      }
      
      // Ensure score is within 0-100 range
      score = Math.max(0, Math.min(100, score));
      
      // Round to integer
      return Math.round(score);
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error calculating priority score:${fancyColors.RESET}`, error);
      return 50; // Default mid-priority on error
    }
  }
  
  /**
   * Update priority scores for multiple tokens
   * @param {string[]} tokenAddresses - Array of token addresses to update
   * @returns {Promise<void>}
   */
  async updateTokenPriorityScores(tokenAddresses) {
    if (!tokenAddresses || tokenAddresses.length === 0) return;
    
    try {
      // Get token data needed for priority calculation
      const tokens = await this.db.tokens.findMany({
        where: {
          address: {
            in: tokenAddresses
          }
        },
        include: {
          token_prices: true,
          price_history: {
            take: 1,
            orderBy: {
              timestamp: 'desc'
            }
          }
        }
      });
      
      // Process each token and update its priority score
      for (const token of tokens) {
        try {
          // Calculate new priority score
          const priorityScore = this.calculatePriorityScore(token);
          
          // Update the token's priority_score in database
          await this.db.tokens.update({
            where: { id: token.id },
            data: { 
              priority_score: priorityScore,
              last_priority_calculation: new Date() 
            }
          });
          
          logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Updated priority score for ${token.address} to ${priorityScore}`);
        } catch (error) {
          logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error updating priority for token ${token.address}:${fancyColors.RESET}`, error);
        }
      }
      
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Updated priority scores for ${tokens.length} tokens`);
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error updating token priority scores:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Reprocess tokens stuck in 'pending' state
   * @param {number} limit - Maximum number of tokens to reprocess
   * @returns {Promise<{ processed: number, enqueued: number }>}
   */
  async reprocessStuckTokens(limit = 100) {
    try {
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} RECOVERY ${fancyColors.RESET} Finding stuck tokens (limit: ${limit})...`);
      
      // Find tokens that are stuck in pending state
      // Use a 1-hour age threshold instead of 24 hours
      const stuckTokens = await this.db.tokens.findMany({
        where: {
          metadata_status: 'pending',
          last_refresh_attempt: {
            lt: new Date(Date.now() - 1 * 60 * 60 * 1000) // Older than 1 hour
          }
        },
        take: limit,
        orderBy: { 
          priority_score: 'desc' // Highest priority first
        },
        include: {
          token_prices: true
        }
      });
      
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Found ${stuckTokens.length} tokens stuck in 'pending' state`);
      
      let enqueued = 0;
      
      // Re-enqueue them with high priority
      for (const token of stuckTokens) {
        // Update token priority score before enqueueing
        const priorityScore = this.calculatePriorityScore(token);
        
        // Update token with new priority score
        await this.db.tokens.update({
          where: { id: token.id },
          data: { 
            priority_score: priorityScore,
            last_priority_calculation: new Date() 
          }
        });
        
        // Add token to processing queue with updated priorityScore
        // Use HIGH priority tier but priorityScore for fine-grained sorting
        await this.enqueueTokenEnrichment(token.address, CONFIG.PRIORITY_TIERS.HIGH, priorityScore);
        enqueued++;
      }
      
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} RECOVERY COMPLETE ${fancyColors.RESET} Re-enqueued ${enqueued} tokens for processing`);
      
      return {
        processed: stuckTokens.length,
        enqueued
      };
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error reprocessing stuck tokens:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      logApi.debug(`[TokenEnrichmentSvc] Reprocessing error details: ${error.code || ''} ${error.name || ''}`);
      return {
        processed: 0,
        enqueued: 0
      };
    }
  }
  
  /**
   * Sleep utility function for delay
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Stop the service
   * @returns {Promise<boolean>}
   */
  async stop() {
    try {
      // Call parent stop first to handle BaseService cleanup
      await super.stop();
      
      // Clean up event listeners
      serviceEvents.removeAllListeners('token:new');
      serviceEvents.removeAllListeners('token:enrich');
      serviceEvents.removeAllListeners('system:maintenance');
      
      // Clear processing interval
      if (this.processingInterval) {
        clearInterval(this.processingInterval);
        this.processingInterval = null;
      }
      
      // Clear any timers/intervals
      if (this.recoveryTimeout) {
        clearTimeout(this.recoveryTimeout);
        this.recoveryTimeout = null;
      }
      
      // Do not actually disconnect Prisma client, as it's a singleton
      // Just clean up our reference to it
      this.db = null;
      
      // Emit service stopped event
      serviceEvents.emit('service:stopped', {
        name: this.name,
        timestamp: new Date().toISOString(),
        stats: {
          processedTotal: this.stats.processedTotal,
          processedSuccess: this.stats.processedSuccess,
          processedFailed: this.stats.processedFailed
        }
      });
      
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} STOPPED ${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error stopping service:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      return false;
    }
  }
}

// Create and export singleton instance
const tokenEnrichmentService = new TokenEnrichmentService();
export default tokenEnrichmentService;