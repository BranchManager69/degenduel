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
 * @version 1.9.1 // Refactored for Prisma transaction batching
 * @created 2025-04-28
 * @updated 2025-05-12 
 */

// Service Suite
import { BaseService } from '../../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
// Prisma
import prisma from '../../config/prisma.js';
// Logger
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';

// Import data collectors
import dexScreenerCollector from './collectors/dexScreenerCollector.js';
import heliusCollector from './collectors/heliusCollector.js';
import jupiterCollector from './collectors/jupiterCollector.js';

// Configuration
const CONFIG = {
  BATCH_SIZE: 10, // Further Reduced from 15 (was 50). For main enrichment transactions.
  BATCH_DELAY_MS: 5000, // Increased from 3000. Delay between main enrichment transactions.
  MAX_CONCURRENT_BATCHES: 1, 
  THROTTLE_MS: 100,
  DEXSCREENER_THROTTLE_MS: 500,
  PRIORITY_TIERS: { HIGH: 1, MEDIUM: 2, LOW: 3 },
  STRATEGIES: {
    FULL: ['dexscreener', 'helius', 'jupiter'],
    MARKET_ONLY: ['dexscreener', 'jupiter'],
    CHAIN_ONLY: ['helius', 'jupiter']
  },
  RETRY_INTERVALS: [5 * 60 * 1000, 30 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000],
  PRIORITY_SCORE: {
    WEIGHTS: {
      VOLUME: 0.5,
      VOLATILITY: 0.4,
      LIQUIDITY: 0.1
    },
    VOLUME_TIMEFRAMES: {
      MINUTES_5: 0.4,
      HOURS_1: 0.3,
      HOURS_6: 0.2,
      HOURS_24: 0.1
    },
    VOLATILITY_TIMEFRAMES: {
      MINUTES_5: 0.4,
      HOURS_1: 0.3,
      HOURS_6: 0.2,
      HOURS_24: 0.1
    },
    BASE_SCORES: {
      NEW_TOKEN: 80,
      PARTIAL_DATA: 60,
      COMPLETE_DATA: 40,
      FAILED_REFRESH: 70
    },
    DECAY: {
      SUCCESSFUL_REFRESH: 0.8,
      HOURS_SINCE_REFRESH: 0.1
    }
  }
};

class TokenEnrichmentService extends BaseService {
  constructor() {
    super({
      name: SERVICE_NAMES.TOKEN_ENRICHMENT,
      description: 'Token metadata and price enrichment',
      layer: 'DATA',
      criticalLevel: 'medium',
      checkIntervalMs: 60 * 1000 
    });
    
    this.db = null;
    this.processingQueue = [];
    this.isProcessingBatch = false; // Tracks if a master batch is currently being processed
    this.activeApiCollectionBatches = 0; // Tracks concurrent API collection stages
    
    this.collectors = {
      dexscreener: dexScreenerCollector,
      helius: heliusCollector,
      jupiter: jupiterCollector
    };
    
    this.stats = {
      ...this.stats, 
      processedTotal: 0,
      processedSuccess: 0,
      processedFailed: 0,
      enqueuedTotal: 0,
      currentQueueSize: 0,
      lastProcessedTime: null,
      dbTransactionErrors: 0,
      sources: {
        dexscreener: { success: 0, failed: 0 },
        helius: { success: 0, failed: 0 },
        jupiter: { success: 0, failed: 0 }
      }
    };
  }
  
  async initialize() {
    try {
      await super.initialize();
      this.db = prisma;
      await jupiterCollector.initialize();
      this.registerEventListeners();
      this.startProcessingQueue();
      
      setTimeout(async () => {
        try {
          const result = await this.reprocessStuckTokens(250);
          logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Startup recovery completed: ${result.enqueued} tokens re-enqueued`);
          setInterval(async () => {
            try {
              const periodicResult = await this.reprocessStuckTokens(100);
              logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Periodic recovery completed: ${periodicResult.enqueued} tokens re-enqueued`);
            } catch (err) {
              logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Periodic recovery failed: ${err.message || 'Unknown error'}`);
            }
          }, 10 * 60 * 1000);
        } catch (err) {
          logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Startup recovery failed: ${err.message || 'Unknown error'}`);
        }
      }, 5000);
      
      this.isInitialized = true;
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Token enrichment service ready`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      await this.handleError(error);
      this.isInitialized = false;
      return false;
    }
  }
  
  registerEventListeners() {
    // Remove listener for individual 'token:new'
    // serviceEvents.on('token:new', async (tokenInfo) => { ... });

    // Add listener for batched 'tokens:discovered' event
    serviceEvents.on('tokens:discovered', async (eventData) => {
      try {
        if (eventData && Array.isArray(eventData.addresses) && eventData.addresses.length > 0) {
          await this.handleDiscoveredTokensBatch(eventData.addresses);
        }
      } catch (error) {
        await this.handleError(error); // Ensure BaseService error handling is called
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error handling tokens:discovered event:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      }
    });
    
    // Listen for manual enrichment requests (can still use enqueueTokenEnrichment for single adds)
    serviceEvents.on('token:enrich', async (tokenInfo) => {
      try {
        // For single ad-hoc enrichment, calculate priority or let enqueue do it by passing null
        await this.enqueueTokenEnrichment(tokenInfo.address, CONFIG.PRIORITY_TIERS.HIGH, null); 
      } catch (error) {
        await this.handleError(error);
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error handling token:enrich event:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      }
    });
    
    serviceEvents.on('system:maintenance', (data) => {
      this.pauseProcessing = data.active;
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${data.active ? 'Paused' : 'Resumed'} processing due to maintenance mode`);
    });
  }
  
  async handleDiscoveredTokensBatch(addressesFromEvent) {
    logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Received batch of ${addressesFromEvent.length} discovered tokens to process.`);
    
    const processingChunkSize = 50; // Further Reduced from 100. For createMany.
    const delayBetweenChunksMs = 15000; // Increased from 10000. Delay between createMany chunks (15 seconds).

    for (let i = 0; i < addressesFromEvent.length; i += processingChunkSize) {
      const currentChunkAddresses = addressesFromEvent.slice(i, i + processingChunkSize);
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Processing chunk ${Math.floor(i / processingChunkSize) + 1}: ${currentChunkAddresses.length} tokens for creation & enqueue.`);

      const newTokensData = currentChunkAddresses.map(address => ({
        address: address,
        first_seen_on_jupiter_at: new Date(),
            discovery_count: 1,
            metadata_status: 'pending',
        is_active: false // Will be activated by TokenActivationService after validation
      }));

      try {
        if (newTokensData.length > 0) {
          const creationResult = await this.db.tokens.createMany({
            data: newTokensData,
            skipDuplicates: true, // Important to avoid errors if a token somehow gets re-processed before enrichment
          });
          logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} CHUNK CREATED ${fancyColors.RESET} ${creationResult.count} new token records (attempted: ${currentChunkAddresses.length}).`);

          // Now enqueue them all for enrichment with a default high priority score
          let enqueuedInChunkCount = 0;
          for (const address of currentChunkAddresses) { 
            // Enqueue based on the chunk we attempted to create.
            // enqueueTokenEnrichment for new tokens with score already avoids DB hit.
            await this.enqueueTokenEnrichment(address, CONFIG.PRIORITY_TIERS.HIGH, CONFIG.PRIORITY_SCORE.BASE_SCORES.NEW_TOKEN || 80);
            enqueuedInChunkCount++;
          }
          logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Enqueued ${enqueuedInChunkCount} tokens from current chunk for enrichment.`);
      }
    } catch (error) {
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error in handleDiscoveredTokensBatch (chunk ${Math.floor(i / processingChunkSize) + 1}) creating/enqueueing tokens:${fancyColors.RESET}`, error);
        // If createMany fails for a chunk, we log and continue to the next chunk.
        // Individual enqueue errors are handled within enqueueTokenEnrichment.
      }

      if (i + processingChunkSize < addressesFromEvent.length) {
        logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Delaying ${delayBetweenChunksMs}ms before next discovery chunk...`);
        await this.sleep(delayBetweenChunksMs); 
      }
    }
    logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Finished processing all chunks of discovered tokens.`);
  }

  async sleep(ms) { // Make sure this utility method is present in your class
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async enqueueTokenEnrichment(tokenAddress, priorityTier = CONFIG.PRIORITY_TIERS.MEDIUM, initialPriorityScore = null) {
    try {
      let finalPriorityScore = initialPriorityScore;
      
      // This block should now only be hit if initialPriorityScore is explicitly passed as null from somewhere OTHER than handleNewToken,
      // or if a default score from CONFIG.PRIORITY_SCORE.BASE_SCORES was not available.
      if (finalPriorityScore === null) { 
        logApi.warn(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} enqueueTokenEnrichment called with null initialPriorityScore for ${tokenAddress}. Calculating score (should be rare).`);
        try {
          const token = await this.db.tokens.findFirst({ where: { address: tokenAddress }, include: { token_prices: true } });
          if (token) {
            finalPriorityScore = this.calculatePriorityScore(token);
          } else {
            logApi.warn(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Token ${tokenAddress} not found when trying to calculate score in enqueue.`);
            finalPriorityScore = 0; 
          }
        } catch (scoreError) {
          logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting priority score for token ${tokenAddress} in enqueue:${fancyColors.RESET} ${scoreError.message || 'Unknown error'}`);
          finalPriorityScore = CONFIG.PRIORITY_SCORE.BASE_SCORES.PARTIAL_DATA || 60; 
        }
      }
      
      const queueItem = {
        address: tokenAddress,
        priorityTier,
        priorityScore: finalPriorityScore, 
        addedAt: new Date(),
        attempts: 0
      };
      
      this.processingQueue.push(queueItem);
      
      if (this.stats) {
        this.stats.enqueuedTotal = (this.stats.enqueuedTotal || 0) + 1;
        this.stats.currentQueueSize = this.processingQueue ? this.processingQueue.length : 0;
      }
      
      logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Enqueued ${tokenAddress} (tier: ${priorityTier}, score: ${finalPriorityScore}, queue: ${this.stats.currentQueueSize})`);
      
      if (!this.isProcessingBatch && this.activeApiCollectionBatches < CONFIG.MAX_CONCURRENT_BATCHES) {
        this.processNextMasterBatch();
      }
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error enqueueing token:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
    }
  }
  
  startProcessingQueue() {
    this.processingInterval = setInterval(() => {
      if (!this.pauseProcessing) {
        const canStartBatches = this.processingQueue.length > 0 && !this.isProcessingBatch && this.activeApiCollectionBatches < CONFIG.MAX_CONCURRENT_BATCHES;
        if (canStartBatches) {
            this.processNextMasterBatch();
        }
        logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Queue status: ${this.processingQueue.length} items, Active Master Batch: ${this.isProcessingBatch}, Active API Batches: ${this.activeApiCollectionBatches}/${CONFIG.MAX_CONCURRENT_BATCHES}`);
      }
      this.emitHeartbeat();
    }, 5000);
    logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Started queue processing monitor`);
  }
  
  emitHeartbeat() {
    try {
      const safeStats = {
        queueSize: this.processingQueue.length,
        activeBatches: this.activeApiCollectionBatches,
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
      serviceEvents.emit('service:heartbeat', {
        name: this.name,
        timestamp: new Date().toISOString(),
        stats: safeStats
      });
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error emitting heartbeat:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
    }
  }
  
  async prepareTokenDbOperations(tokenAddress, collectedData, existingTokenWithPrice) {
    const dbOps = [];
    if (!existingTokenWithPrice) {
      logApi.warn(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Token ${tokenAddress} not found in DB for prepareTokenDbOperations.`);
      return dbOps;
    }

    const combinedData = this.mergeTokenData(collectedData); // 'collectedData' is the result from API calls
    let metadataStatus = 'pending';
    const hasBasicInfo = !!(combinedData.symbol && combinedData.name && combinedData.decimals !== undefined);

    if (hasBasicInfo) metadataStatus = 'complete';
    else if (existingTokenWithPrice.metadata_status === 'pending' && existingTokenWithPrice.last_refresh_attempt) metadataStatus = 'failed';
    
    const tokenUpdatePayload = {
        symbol: combinedData.symbol, name: combinedData.name, decimals: combinedData.decimals,
        color: combinedData.color || '#888888', image_url: combinedData.imageUrl,
        header_image_url: combinedData.headerUrl, open_graph_image_url: combinedData.openGraphUrl,
        description: combinedData.description, last_refresh_success: new Date(), metadata_status: metadataStatus,
        last_refresh_attempt: new Date(), 
        refresh_metadata: {
            ...(existingTokenWithPrice.refresh_metadata || {}),
            enrichment_attempts: (existingTokenWithPrice.refresh_metadata?.enrichment_attempts || 0) + 1, 
            last_enrichment_attempt: new Date().toISOString(), 
            last_enrichment_success: new Date().toISOString(), 
            enrichment_status: metadataStatus,
            enhanced_market_data: {
                priceChanges: combinedData.priceChanges || {},
                volumes: combinedData.volumes || {},
                transactions: combinedData.transactions || {},
                pairCreatedAt: combinedData.pairCreatedAt ? combinedData.pairCreatedAt.toISOString() : null,
                boosts: combinedData.boosts || null,
                // Ensure numeric fields are correctly parsed or null
                liquidity: (combinedData.liquidity !== undefined && !isNaN(parseFloat(combinedData.liquidity))) ? parseFloat(combinedData.liquidity) : null,
                market_cap: (combinedData.marketCap !== undefined && !isNaN(parseFloat(combinedData.marketCap))) ? parseFloat(combinedData.marketCap) : null,
                fdv: (combinedData.fdv !== undefined && !isNaN(parseFloat(combinedData.fdv))) ? parseFloat(combinedData.fdv) : null,
                volume_24h: (combinedData.volume24h !== undefined && !isNaN(parseFloat(combinedData.volume24h))) ? parseFloat(combinedData.volume24h) : null
            }
        }
    };
    dbOps.push(prisma.tokens.update({ where: { id: existingTokenWithPrice.id }, data: tokenUpdatePayload }));

    // Upsert token_prices (payload already ensures numbers/null from combinedData via mergeTokenData)
    if (combinedData.price !== undefined && combinedData.price !== null && !isNaN(parseFloat(combinedData.price))) {
        const price = parseFloat(combinedData.price);
        const priceUpsertPayload = {
            price: price.toString(), // Prisma Decimal fields take string representation of number
            change_24h: combinedData.priceChange24h, // Should be number or null from mergeTokenData
            market_cap: combinedData.marketCap,     // Should be number or null
            fdv: combinedData.fdv,                  // Should be number or null
            liquidity: combinedData.liquidity,      // Should be number or null
            volume_24h: combinedData.volume24h,   // Should be number or null
            updated_at: new Date()
        };
        dbOps.push(prisma.token_prices.upsert({
            where: { token_id: existingTokenWithPrice.id },
            update: priceUpsertPayload,
            create: { token_id: existingTokenWithPrice.id, ...priceUpsertPayload }
        }));
        // Add token_price_history create
        dbOps.push(prisma.token_price_history.create({ data: { token_id: existingTokenWithPrice.id, price: price.toString(), source: 'enrichment_service', timestamp: new Date() } }));
        const oldPrice = existingTokenWithPrice.token_prices ? parseFloat(existingTokenWithPrice.token_prices.price || '0') : 0;
        if (price !== oldPrice) {
            dbOps.push(prisma.tokens.update({ where: { id: existingTokenWithPrice.id }, data: { last_price_change: new Date() } }));
        }
    }

    const websiteUrl = combinedData.socials?.website;
    const otherSocials = { ...(combinedData.socials || {}) };
    if (otherSocials.website) delete otherSocials.website;

    if (Object.keys(otherSocials).length > 0 || websiteUrl || (combinedData.websites && combinedData.websites.length > 0)) {
        dbOps.push(prisma.token_socials.deleteMany({ where: { token_id: existingTokenWithPrice.id } }));
        dbOps.push(prisma.token_websites.deleteMany({ where: { token_id: existingTokenWithPrice.id } }));

        for (const [type, url] of Object.entries(otherSocials)) {
            if (url && typeof url === 'string') {
                dbOps.push(prisma.token_socials.create({ data: { token_id: existingTokenWithPrice.id, type: type.toLowerCase(), url: url.substring(0, 255) } }));
            }
        }
        if (websiteUrl) {
            const websiteLabel = collectedData.dexscreener?.websiteLabel || 'Official';
            dbOps.push(prisma.token_websites.create({ data: { token_id: existingTokenWithPrice.id, label: websiteLabel, url: websiteUrl.substring(0, 255) } }));
        }
        if (combinedData.websites && Array.isArray(combinedData.websites)) {
            combinedData.websites.forEach(site => {
                if (site.url && typeof site.url === 'string' && site.url !== websiteUrl) {
                    dbOps.push(prisma.token_websites.create({ data: { token_id: existingTokenWithPrice.id, label: site.label || 'Website', url: site.url.substring(0, 255) } }));
                }
            });
        }
    }
    
    const priorityScore = this.calculatePriorityScore({ ...existingTokenWithPrice, ...combinedData });
    dbOps.push(prisma.tokens.update({ where: { id: existingTokenWithPrice.id }, data: { priority_score: priorityScore, last_priority_calculation: new Date() } }));
    
    return dbOps;
  }

  async processNextMasterBatch() {
    if (this.isCircuitBreakerOpen() || this.isProcessingBatch || !this.processingQueue || this.processingQueue.length === 0) {
      return;
    }
    this.isProcessingBatch = true; // Mark master batch processing START

    const batchItems = [];
    const tempQueue = [...this.processingQueue]; // Work on a copy
    this.processingQueue.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0) || a.addedAt - b.addedAt);
    
    // Take up to BATCH_SIZE items for this master batch
    while (this.processingQueue.length > 0 && batchItems.length < CONFIG.BATCH_SIZE) {
        batchItems.push(this.processingQueue.shift());
    }
    if (this.stats) this.stats.currentQueueSize = this.processingQueue.length;

    if (batchItems.length === 0) {
        this.isProcessingBatch = false;
        return;
    }

    const batchTokenAddresses = batchItems.map(item => item.address);
    logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} MASTER BATCH START ${fancyColors.RESET} Processing ${batchItems.length} tokens.`);
    this.activeApiCollectionBatches++;

    let collectedDataForAllTokens = {};
    let collectionSuccess = false;
    try {
      // Step 1: Collect data for all tokens in the batch using parallel API calls
        const apiPromises = [
        this.collectors.jupiter.getTokenInfoBatch(batchTokenAddresses),
        this.collectors.helius.getTokenMetadataBatch(batchTokenAddresses),
        this.collectors.dexscreener.getTokensByAddressBatch(batchTokenAddresses)
      ];
      const [jupiterResults, heliusResults, dexScreenerResults] = await Promise.all(apiPromises);

      batchTokenAddresses.forEach(address => {
        collectedDataForAllTokens[address] = {
          address: address,
          jupiter: jupiterResults[address] || null,
          helius: heliusResults[address] || null,
          dexscreener: dexScreenerResults[address] || null
        };
      });
      collectionSuccess = true;
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} API data collection complete for master batch.`);
    } catch (collectionError) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error collecting API data for master batch: ${collectionError.message}${fancyColors.RESET}`);
      // Re-enqueue all items in this failed batch for a later retry
      batchItems.forEach(item => this.enqueueTokenEnrichment(item.address, item.priorityTier, (item.priorityScore || 50) - 10));
      if (this.stats) {
        this.stats.processedTotal = (this.stats.processedTotal || 0) + batchItems.length;
        this.stats.processedFailed = (this.stats.processedFailed || 0) + batchItems.length;
      }
    } finally {
      this.activeApiCollectionBatches--; 
      if (this.activeApiCollectionBatches < 0) this.activeApiCollectionBatches = 0; 

      this.isProcessingBatch = false; 

      if (this.processingQueue.length > 0 && !this.isProcessingBatch && this.activeApiCollectionBatches < CONFIG.MAX_CONCURRENT_BATCHES) {
        logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Scheduling next master batch. Queue: ${this.processingQueue.length}, Active API Batches: ${this.activeApiCollectionBatches}`);
        setTimeout(() => {
          if (!this.isCircuitBreakerOpen()) { 
            this.processNextMasterBatch(); // Corrected to call processNextMasterBatch
          }
        }, CONFIG.BATCH_DELAY_MS);
      } else {
        logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} No new master batch scheduled. Queue: ${this.processingQueue.length}, Active Master: ${this.isProcessingBatch}, Active API: ${this.activeApiCollectionBatches}`);
      }
    }

    if (!collectionSuccess) {
        return; // Exit if API collection failed for the batch
    }

    // Step 2: Prepare all DB operations
    let allDbOperationsForBatch = [];
    let successfullyPreparedCount = 0;
    let failedToPrepareCount = 0;

    // Fetch existing token records for the batch in one go
    const existingTokensMap = new Map();
    if (batchItems.length > 0) {
        const tokensFromDb = await this.db.tokens.findMany({
            where: { address: { in: batchTokenAddresses } },
            include: { token_prices: true }
        });
        tokensFromDb.forEach(t => existingTokensMap.set(t.address, t));
    }

    for (const item of batchItems) {
        const enrichedData = collectedDataForAllTokens[item.address];
        const existingToken = existingTokensMap.get(item.address);

        if (enrichedData && existingToken) {
            // REMOVED: await this.incrementEnrichmentAttempts(item.address); 
            const ops = await this.prepareTokenDbOperations(item.address, enrichedData, existingToken);
            if (ops.length > 0) {
                allDbOperationsForBatch.push(...ops);
                successfullyPreparedCount++;
            } else {
                failedToPrepareCount++;
                // Logic to mark as failed if prepareTokenDbOperations returns empty (e.g. no data)
                 await this.db.tokens.update({
                    where: { id: existingToken.id }, // Assuming existingToken has id
                    data: { 
                        metadata_status: 'failed',
                        last_refresh_attempt: new Date(),
                        refresh_metadata: { 
                            ...(existingToken.refresh_metadata || {}),
                            enrichment_attempts: (existingToken.refresh_metadata?.enrichment_attempts || 0) + 1,
                            last_enrichment_attempt: new Date().toISOString(),
                            last_enrichment_error: 'No DB operations generated from enrich data',
                            last_error_time: new Date().toISOString()
                        }
                    }
                });
            }
        } else {
            failedToPrepareCount++;
            logApi.warn(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Missing enrichedData or existingToken for ${item.address}.`);
             if(existingToken) { // If token exists but no data collected
                await this.db.tokens.update({
                    where: { id: existingToken.id },
                     data: { 
                        metadata_status: 'failed',
                        last_refresh_attempt: new Date(),
                        refresh_metadata: { 
                            ...(existingToken.refresh_metadata || {}),
                            enrichment_attempts: (existingToken.refresh_metadata?.enrichment_attempts || 0) + 1,
                            last_enrichment_attempt: new Date().toISOString(),
                            last_enrichment_error: 'No data collected by any source for batch item (master batch)',
                            last_error_time: new Date().toISOString()
                        }
                    }
                });
            }
        }
    }

    // Step 3: Execute DB operations in a single transaction
    if (allDbOperationsForBatch.length > 0) {
      try {
        logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Executing transaction with ${allDbOperationsForBatch.length} DB operations for ${successfullyPreparedCount} tokens.`);
        await this.db.$transaction(allDbOperationsForBatch);
        logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} DB TRANSACTION COMPLETE ${fancyColors.RESET} for ${successfullyPreparedCount} tokens.`);
        
        if (this.stats) {
          this.stats.processedTotal = (this.stats.processedTotal || 0) + batchItems.length;
          this.stats.processedSuccess = (this.stats.processedSuccess || 0) + successfullyPreparedCount;
          this.stats.processedFailed = (this.stats.processedFailed || 0) + failedToPrepareCount;
          this.stats.lastProcessedTime = new Date().toISOString();
        }
        // Emit enriched event for successfully processed tokens
        batchItems.filter((item, idx) => allDbOperationsForBatch.some(op => 
            (op.model === 'tokens' && op.args?.where?.address === item.address) || 
            (op.model === 'token_prices' && op.args?.where?.token_id === existingTokensMap.get(item.address)?.id)
        )).forEach(item => {
            serviceEvents.emit('token:enriched', {
              address: item.address,
              enrichedAt: new Date().toISOString(),
              sources: Object.keys(collectedDataForAllTokens[item.address] || {}).filter(k => k !== 'address' && collectedDataForAllTokens[item.address][k])
            });
        });

      } catch (dbError) {
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}DB Transaction Error for master batch: ${dbError.message}${fancyColors.RESET}`);
        if (this.stats) {
          this.stats.dbTransactionErrors = (this.stats.dbTransactionErrors || 0) + 1;
          this.stats.processedTotal = (this.stats.processedTotal || 0) + batchItems.length;
          this.stats.processedFailed = (this.stats.processedFailed || 0) + batchItems.length; // All items in batch considered failed if transaction fails
        }
        // Re-enqueue all items from this batch as the transaction failed
        batchItems.forEach(item => this.enqueueTokenEnrichment(item.address, item.priorityTier, (item.priorityScore || 50) - 15));
      }
    } else {
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} No DB operations to execute for this master batch.`);
       if (this.stats && batchItems.length > 0) {
          this.stats.processedTotal = (this.stats.processedTotal || 0) + batchItems.length;
          this.stats.processedFailed = (this.stats.processedFailed || 0) + batchItems.length;
      }
    }
    
    // Update priority scores for tokens that had operations prepared (implies data was found)
    const addressesToUpdatePriority = batchItems
        .filter((item,idx) => allDbOperationsForBatch.some(op => 
            (op.model === 'tokens' && op.args?.where?.address === item.address) || 
            (op.model === 'token_prices' && op.args?.where?.token_id === existingTokensMap.get(item.address)?.id) // Approximation
        )) 
        .map(item => item.address);

    if (addressesToUpdatePriority.length > 0) {
      await this.updateTokenPriorityScores(addressesToUpdatePriority);
    }

    logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} MASTER BATCH COMPLETE ${fancyColors.RESET} Attempted: ${batchItems.length}, DB Ops Prepared for: ${successfullyPreparedCount}, Failed to Prepare: ${failedToPrepareCount}`);
    
    this.isProcessingBatch = false;
    if (this.processingQueue.length > 0 && this.activeApiCollectionBatches < CONFIG.MAX_CONCURRENT_BATCHES) {
        setTimeout(() => {
        if (!this.isCircuitBreakerOpen()) {
          this.processNextMasterBatch();
        }
        }, CONFIG.BATCH_DELAY_MS);
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
  // Enrich a single token - can be kept for ad-hoc calls or specific retries
  // but ensure it uses a transaction if making DB writes.
  // For simplicity, this version will do its own transaction.
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
      result.price = (data.dexscreener.priceUsd !== undefined && !isNaN(parseFloat(data.dexscreener.priceUsd))) ? parseFloat(data.dexscreener.priceUsd) : ((data.dexscreener.price !== undefined && !isNaN(parseFloat(data.dexscreener.price))) ? parseFloat(data.dexscreener.price) : null);
      result.priceChange24h = !isNaN(parseFloat(data.dexscreener.priceChange?.h24)) ? parseFloat(data.dexscreener.priceChange.h24) : null;
      result.volume24h = !isNaN(parseFloat(data.dexscreener.volume?.h24)) ? parseFloat(data.dexscreener.volume.h24) : null;
      
      const rawLiquidity = data.dexscreener.liquidity;
      if (rawLiquidity && typeof rawLiquidity === 'object' && rawLiquidity.usd !== undefined && !isNaN(parseFloat(rawLiquidity.usd))) {
        result.liquidity = parseFloat(rawLiquidity.usd);
      } else if (!isNaN(parseFloat(rawLiquidity))) {
        result.liquidity = parseFloat(rawLiquidity);
      } else {
        result.liquidity = null;
      }

      result.fdv = !isNaN(parseFloat(data.dexscreener.fdv)) ? parseFloat(data.dexscreener.fdv) : null;
      result.marketCap = !isNaN(parseFloat(data.dexscreener.marketCap)) ? parseFloat(data.dexscreener.marketCap) : null;
      
      result.priceChanges = data.dexscreener.priceChange || {};
      result.volumes = data.dexscreener.volume || {};
      result.transactions = data.dexscreener.txns || {};
      if (data.dexscreener.pairCreatedAt) result.pairCreatedAt = data.dexscreener.pairCreatedAt;
      if (data.dexscreener.boosts) result.boosts = data.dexscreener.boosts;
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