/**
 * Token Enrichment Service
 * 
 * This service coordinates the collection and storage of token metadata
 * from various sources. It receives events from the token detection service
 * and enriches the token data with metadata from multiple providers.
 * 
 * @module services/token-enrichment/tokenEnrichmentService
 */

import { BaseService } from '../../utils/service-suite/base-service.js';
import { ServiceError } from '../../utils/service-suite/service-error.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import serviceEvents from '../../utils/service-suite/service-events.js';

// Import database client
import { PrismaClient } from '@prisma/client';

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
  ]
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
    
    // Statistics
    this.stats = {
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
      // Create database connection
      this.db = new PrismaClient({
        datasourceUrl: process.env.DATABASE_URL
      });
      
      // Register with service manager with explicit dependencies
      const dependencies = [SERVICE_NAMES.TOKEN_DETECTION, SERVICE_NAMES.SOLANA_ENGINE];
      serviceManager.register(this.name, dependencies);
      
      // Initialize collectors
      await jupiterCollector.initialize();
      
      // Set up event listeners
      this.registerEventListeners();
      
      // Start background processing
      this.startProcessingQueue();
      
      this.isInitialized = true;
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Token enrichment service ready`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET}`, error);
      return false;
    }
  }
  
  /**
   * Register event listeners
   */
  registerEventListeners() {
    // Listen for new token events from token detection service
    serviceEvents.on('token:new', async (tokenInfo) => {
      await this.handleNewToken(tokenInfo);
    });
    
    // Listen for manual enrichment requests
    serviceEvents.on('token:enrich', async (tokenInfo) => {
      await this.enqueueTokenEnrichment(tokenInfo.address, CONFIG.PRIORITY_TIERS.HIGH);
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
        // Token already exists, update discovery timestamp
        await this.db.tokens.update({
          where: { id: existingToken.id },
          data: { 
            last_discovery: new Date(),
            discovery_count: { increment: 1 }
          }
        });
        
        // Only re-enqueue for enrichment if it's been a while or metadata is incomplete
        // Get enrichment data from refresh_metadata if available
        const refreshMetadata = existingToken.refresh_metadata || {};
        const lastEnrichmentAttempt = refreshMetadata.last_enrichment_attempt 
                                    ? new Date(refreshMetadata.last_enrichment_attempt) 
                                    : null;
        
        const shouldReEnrich = existingToken.metadata_status !== 'complete' || 
                               !lastEnrichmentAttempt ||
                               new Date() - lastEnrichmentAttempt > 24 * 60 * 60 * 1000;
        
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
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error handling new token:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Enqueue a token for enrichment
   * @param {string} tokenAddress - Token address
   * @param {number} priority - Priority tier
   */
  async enqueueTokenEnrichment(tokenAddress, priority = CONFIG.PRIORITY_TIERS.MEDIUM) {
    try {
      // Create queue item
      const queueItem = {
        address: tokenAddress,
        priority,
        addedAt: new Date(),
        attempts: 0
      };
      
      // Add to processing queue
      this.processingQueue.push(queueItem);
      this.stats.enqueuedTotal++;
      this.stats.currentQueueSize = this.processingQueue.length;
      
      logApi.debug(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Enqueued ${tokenAddress} for enrichment (priority: ${priority}, queue size: ${this.processingQueue.length})`);
      
      // Start processing if not already running
      if (!this.batchProcessing && this.activeBatches < CONFIG.MAX_CONCURRENT_BATCHES) {
        this.processNextBatch();
      }
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error enqueueing token:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Start the queue processing mechanism
   */
  startProcessingQueue() {
    // Set interval to check queue and start processing if needed
    setInterval(() => {
      if (this.processingQueue.length > 0 && !this.batchProcessing && this.activeBatches < CONFIG.MAX_CONCURRENT_BATCHES) {
        this.processNextBatch();
      }
    }, 5000); // Check every 5 seconds
    
    logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} Started queue processing monitor`);
  }
  
  /**
   * Process the next batch of tokens
   */
  async processNextBatch() {
    if (this.processingQueue.length === 0) {
      this.batchProcessing = false;
      return;
    }
    
    this.batchProcessing = true;
    this.activeBatches++;
    
    try {
      // Sort queue by priority and time
      this.processingQueue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority; // Lower number = higher priority
        }
        return a.addedAt - b.addedAt; // Older items first
      });
      
      // Take the next batch
      const batch = this.processingQueue.splice(0, CONFIG.BATCH_SIZE);
      this.stats.currentQueueSize = this.processingQueue.length;
      
      // Process each token in the batch
      const processingPromises = batch.map(item => this.enrichToken(item.address));
      
      // Wait for all tokens to be processed
      await Promise.allSettled(processingPromises);
      
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
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing batch:${fancyColors.RESET}`, error);
      
      // Reduce active batches count and reset processing flag if needed
      this.activeBatches--;
      this.batchProcessing = this.activeBatches > 0;
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
      return token.refresh_metadata?.enrichment_attempts || 0;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting enrichment attempts:${fancyColors.RESET}`, error);
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
      
      // Update token record to mark enrichment attempt
      await this.db.tokens.updateMany({
        where: { address: tokenAddress },
        data: { 
          last_refresh_attempt: new Date(), // Using existing last_refresh_attempt field
          refresh_metadata: {
            last_enrichment_attempt: new Date().toISOString(),
            enrichment_attempts: 1 // Initialize counter
          }
        }
      });
      
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
      
      // Update statistics
      this.stats.processedTotal++;
      if (success) {
        this.stats.processedSuccess++;
      } else {
        this.stats.processedFailed++;
      }
      
      this.stats.lastProcessedTime = new Date().toISOString();
      
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
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error enriching token ${tokenAddress}:${fancyColors.RESET}`, error);
      
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
        logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Database error:${fancyColors.RESET}`, dbError);
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
        where: { address: tokenAddress }
      });
      
      if (!existingToken) {
        logApi.warn(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.YELLOW}Token ${tokenAddress} not found in database${fancyColors.RESET}`);
        return false;
      }
      
      // Combine data from all sources with priority order
      const combinedData = this.mergeTokenData(data);
      
      // Update token record with combined data
      await this.db.tokens.update({
        where: { id: existingToken.id },
        data: {
          symbol: combinedData.symbol,
          name: combinedData.name,
          decimals: combinedData.decimals,
          color: combinedData.color || '#888888',
          image_url: combinedData.imageUrl,
          description: combinedData.description,
          last_refresh_success: new Date(), // Use existing field instead of 'last_enrichment'
          metadata_status: 'complete'
        }
      });
      
      // Store token price if available
      if (combinedData.price !== undefined) {
        await this.db.token_prices.upsert({
          where: { token_id: existingToken.id },
          update: {
            price: combinedData.price.toString(),
            change_24h: combinedData.priceChange24h,
            market_cap: combinedData.marketCap,
            fdv: combinedData.fdv,
            liquidity: combinedData.liquidity,
            volume_24h: combinedData.volume24h,
            updated_at: new Date()
          },
          create: {
            token_id: existingToken.id,
            price: combinedData.price.toString(),
            change_24h: combinedData.priceChange24h,
            market_cap: combinedData.marketCap,
            fdv: combinedData.fdv,
            liquidity: combinedData.liquidity,
            volume_24h: combinedData.volume24h,
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
      }
      
      // Store social links if available
      if (combinedData.socials && Object.keys(combinedData.socials).length > 0) {
        // Delete existing socials
        await this.db.token_socials.deleteMany({
          where: { token_id: existingToken.id }
        });
        
        // Add new socials
        for (const [type, url] of Object.entries(combinedData.socials)) {
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
      }
      
      // Store website if available
      if (combinedData.socials?.website) {
        await this.db.token_websites.upsert({
          where: { 
            token_id_label: {
              token_id: existingToken.id,
              label: 'Official'
            }
          },
          update: {
            url: combinedData.socials.website.substring(0, 255)
          },
          create: {
            token_id: existingToken.id,
            label: 'Official',
            url: combinedData.socials.website.substring(0, 255)
          }
        });
      }
      
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error storing token data:${fancyColors.RESET}`, error);
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
      imageUrl: ['helius', 'jupiter'],
      description: ['helius']
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
          if (field === 'imageUrl') value = null; // DexScreener doesn't provide image URL
          if (field === 'description') value = null; // DexScreener doesn't provide description
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
      result.priceChange24h = data.dexscreener.priceChange24h;
      result.volume24h = data.dexscreener.volume24h;
      result.liquidity = data.dexscreener.liquidity;
      result.fdv = data.dexscreener.fdv;
      result.marketCap = data.dexscreener.marketCap;
    }
    
    // Merge social data
    result.socials = {};
    
    // Add socials from DexScreener
    if (data.dexscreener && data.dexscreener.socials) {
      Object.entries(data.dexscreener.socials).forEach(([type, url]) => {
        if (url) result.socials[type] = url;
      });
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
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Health check failed:${fancyColors.RESET}`, error);
      throw error;
    }
  }
  
  /**
   * Perform service operation
   * @returns {Promise<Object>}
   */
  async performOperation() {
    try {
      // Check service health
      await this.checkServiceHealth();
      
      // Update statistics
      this.stats.currentQueueSize = this.processingQueue.length;
      
      // Do other operation tasks as needed
      // For now, just check health and return stats
      
      return {
        success: true,
        stats: this.stats
      };
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Operation failed:${fancyColors.RESET}`, error);
      
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
      
      // Clean up event listeners
      serviceEvents.removeAllListeners('token:new');
      serviceEvents.removeAllListeners('token:enrich');
      
      // Close database connection
      await this.db.$disconnect();
      
      logApi.info(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} STOPPED ${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error stopping service:${fancyColors.RESET}`, error);
    }
  }
}

// Create and export singleton instance
const tokenEnrichmentService = new TokenEnrichmentService();
export default tokenEnrichmentService;