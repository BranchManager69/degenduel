// services/token-dex-data-service.js

/**
 * TokenDEXDataService
 * 
 * This service is responsible for fetching and updating token DEX data
 * from DexScreener and storing it in the database. It integrates with
 * the token refresh scheduler to regularly update token pool data.
 */

import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { PrismaClient } from '@prisma/client';
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import { fancyColors, serviceSpecificColors } from '../utils/colors.js';
import serviceEvents from '../utils/service-suite/service-events.js';
import { config } from '../config/config.js';
import { dexscreenerClient } from './solana-engine/dexscreener-client.js';
import solanaEngine from './solana-engine/index.js';

// Initialize database client
const prisma = new PrismaClient();

// Formatting helpers for consistent logging
const formatLog = {
  tag: () => `${serviceSpecificColors.tokenDEXData.tag}[TokenDEXData]${fancyColors.RESET}`,
  header: (text) => `${serviceSpecificColors.tokenDEXData.header} ${text} ${fancyColors.RESET}`,
  success: (text) => `${serviceSpecificColors.tokenDEXData.success}${text}${fancyColors.RESET}`,
  warning: (text) => `${serviceSpecificColors.tokenDEXData.warning}${text}${fancyColors.RESET}`,
  error: (text) => `${serviceSpecificColors.tokenDEXData.error}${text}${fancyColors.RESET}`,
  info: (text) => `${serviceSpecificColors.tokenDEXData.info}${text}${fancyColors.RESET}`,
  token: (text) => `${serviceSpecificColors.tokenDEXData.token}${text}${fancyColors.RESET}`,
  count: (num) => `${serviceSpecificColors.tokenDEXData.count}${num}${fancyColors.RESET}`,
};

/**
 * TokenDEXDataService class for managing token DEX data
 */
class TokenDEXDataService extends BaseService {
  constructor() {
    super({
      name: SERVICE_NAMES.TOKEN_DEX_DATA,
      description: 'Token DEX data management service',
      layer: 'DATA',
      criticalLevel: 'medium',
      checkIntervalMs: 60 * 1000 // Once per minute
    });

    // Service state
    this.isRefreshing = false;
    this.lastRefreshTime = null;
    this.nextScheduledRefresh = null;
    this.refreshStats = {
      totalUpdates: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      lastUpdateTime: null,
      tokensProcessed: 0,
      poolsFound: 0,
      poolsUpdated: 0,
      errors: []
    };

    // Configuration
    this.config = {
      maxTokensPerBatch: 25, // Process 25 tokens at a time to respect rate limits
      refreshIntervalMs: 15 * 60 * 1000, // Default refresh every 15 minutes
      priorityThreshold: 50, // Priority score threshold for frequent updates
      highPriorityRefreshIntervalMs: 5 * 60 * 1000, // High priority tokens every 5 minutes
      maxPoolsPerToken: 50, // Maximum number of pools to store per token
      minLiquidityUsd: 1000, // Minimum liquidity in USD to store a pool
    };
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      // Check if service is enabled via service profile
      if (!config.services.token_dex_data_service) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('SERVICE DISABLED')} Token DEX Data Service is disabled in the '${config.services.active_profile}' service profile`);
        return false;
      }

      logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} Token DEX Data Service`);

      // Initialize the DexScreener client
      if (!dexscreenerClient.initialized) {
        await dexscreenerClient.initialize();
      }

      // Register for token data refresh events
      serviceEvents.on('token.refresh', this.handleTokenRefreshEvent.bind(this));
      serviceEvents.on('token.batch.refresh', this.handleBatchRefreshEvent.bind(this));

      // Schedule first refresh
      this.scheduleNextRefresh();

      this.isInitialized = true;
      logApi.info(`${formatLog.tag()} ${formatLog.success('INITIALIZED')} Token DEX Data Service ready`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Initialization error:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Schedule the next refresh operation
   */
  scheduleNextRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTokenPools();
    }, this.config.refreshIntervalMs);

    this.nextScheduledRefresh = new Date(Date.now() + this.config.refreshIntervalMs);
    logApi.info(`${formatLog.tag()} ${formatLog.info('Next pool refresh scheduled at')} ${this.nextScheduledRefresh.toISOString()}`);
  }
  
  /**
   * Perform operation method required by the circuit breaker system
   * This is the main method that the circuit breaker will call to check if the service is working
   */
  async performOperation() {
    try {
      // Just check if DEX screener client is initialized - no need to actually make API calls
      // This prevents rate limiting issues while still verifying basic service health
      if (!dexscreenerClient.initialized) {
        await dexscreenerClient.initialize();
      }
      
      // Check that we have a database connection
      const tokenCount = await prisma.tokens.count({
        where: { is_active: true }
      });
      
      // Log success
      logApi.debug(`${formatLog.tag()} ${formatLog.success('Health check successful:')} DexScreener client initialized, database has ${formatLog.count(tokenCount)} active tokens`);
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Perform operation error:')} ${error.message}`);
      throw error; // Important: re-throw to trigger circuit breaker
    }
  }
  
  /**
   * OnPerformOperation method required by the circuit breaker system
   * This wraps the performOperation method with additional checks
   */
  async onPerformOperation() {
    try {
      // Skip operation if service is not properly initialized or started
      if (!this.isOperational || !this._initialized) {
        logApi.debug(`${formatLog.tag()} Service not operational or initialized, skipping operation`);
        return true;
      }
      
      // Call the actual operation implementation
      return await this.performOperation();
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Perform operation error:')} ${error.message}`);
      throw error; // Important: re-throw to trigger circuit breaker
    }
  }

  /**
   * Handle token refresh event from token refresh scheduler
   * @param {Object} data - Token refresh event data
   */
  async handleTokenRefreshEvent(data) {
    try {
      if (!data || !data.tokenAddress) {
        return;
      }

      // Check if this is a high priority token
      const token = await prisma.tokens.findFirst({
        where: { address: data.tokenAddress },
        select: { 
          id: true, 
          address: true, 
          symbol: true, 
          priority_score: true,
          refresh_metadata: true
        }
      });

      if (!token) {
        return;
      }

      // For high priority tokens, refresh DEX data immediately
      if (token.priority_score >= this.config.priorityThreshold) {
        logApi.info(`${formatLog.tag()} ${formatLog.header('REFRESHING')} DEX pools for high priority token ${formatLog.token(token.symbol || token.address)}`);
        await this.refreshPoolsForToken(token.address);
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error handling token refresh event:')} ${error.message}`);
    }
  }

  /**
   * Handle batch refresh event from token refresh scheduler
   * @param {Object} data - Batch refresh event data
   */
  async handleBatchRefreshEvent(data) {
    try {
      if (!data || !data.tokens || !Array.isArray(data.tokens) || data.tokens.length === 0) {
        return;
      }

      // Extract token addresses
      const tokenAddresses = data.tokens
        .filter(token => token && token.address)
        .map(token => token.address);

      if (tokenAddresses.length > 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.header('BATCH REFRESHING')} DEX pools for ${formatLog.count(tokenAddresses.length)} tokens`);
        await this.refreshPoolsForMultipleTokens(tokenAddresses);
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error handling batch refresh event:')} ${error.message}`);
    }
  }

  /**
   * Main refresh method to update token pools
   */
  async refreshTokenPools() {
    if (this.isRefreshing) {
      logApi.info(`${formatLog.tag()} ${formatLog.warning('Refresh already in progress, skipping')}`);
      return;
    }

    this.isRefreshing = true;
    this.refreshStats.lastUpdateTime = new Date();
    let tokensToRefresh = [];

    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('STARTING')} token pool refresh`);

      // Get tokens ordered by priority score and last refresh time
      tokensToRefresh = await prisma.tokens.findMany({
        where: { 
          is_active: true,
          // Only tokens that haven't been refreshed recently
          OR: [
            { last_refresh_attempt: null },
            { 
              last_refresh_attempt: { 
                lt: new Date(Date.now() - this.config.refreshIntervalMs) 
              } 
            }
          ]
        },
        select: { 
          id: true, 
          address: true, 
          symbol: true, 
          priority_score: true 
        },
        orderBy: [
          { priority_score: 'desc' },
          { last_refresh_attempt: 'asc' }
        ],
        take: 100 // Limit the number of tokens to process
      });

      if (tokensToRefresh.length === 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('No tokens need refreshing at this time')}`);
        this.isRefreshing = false;
        this.scheduleNextRefresh();
        return;
      }

      logApi.info(`${formatLog.tag()} ${formatLog.info('Found')} ${formatLog.count(tokensToRefresh.length)} ${formatLog.info('tokens to refresh')}`);

      // Process tokens in batches to respect rate limits
      const batches = [];
      for (let i = 0; i < tokensToRefresh.length; i += this.config.maxTokensPerBatch) {
        batches.push(tokensToRefresh.slice(i, i + this.config.maxTokensPerBatch));
      }

      // Process each batch
      let processedTokens = 0;
      let successfulTokens = 0;
      let failedTokens = 0;
      let poolsFound = 0;
      let poolsUpdated = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchAddresses = batch.map(token => token.address);
        
        logApi.info(`${formatLog.tag()} ${formatLog.header('PROCESSING')} batch ${i + 1}/${batches.length} with ${formatLog.count(batch.length)} tokens`);
        
        try {
          const batchResult = await this.refreshPoolsForMultipleTokens(batchAddresses);
          
          processedTokens += batch.length;
          successfulTokens += batchResult.successCount || 0;
          failedTokens += batchResult.failureCount || 0;
          poolsFound += batchResult.poolsFound || 0;
          poolsUpdated += batchResult.poolsUpdated || 0;
          
          // Wait between batches to avoid overwhelming the API
          if (i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } catch (error) {
          logApi.error(`${formatLog.tag()} ${formatLog.error(`Error processing batch ${i + 1}:`)} ${error.message}`);
          failedTokens += batch.length;
        }
      }

      // Update stats
      this.refreshStats.totalUpdates++;
      this.refreshStats.successfulUpdates += (successfulTokens > 0) ? 1 : 0;
      this.refreshStats.failedUpdates += (failedTokens > 0) ? 1 : 0;
      this.refreshStats.tokensProcessed = processedTokens;
      this.refreshStats.poolsFound = poolsFound;
      this.refreshStats.poolsUpdated = poolsUpdated;
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('COMPLETED')} token pool refresh: ${formatLog.count(successfulTokens)}/${formatLog.count(processedTokens)} successful, ${formatLog.count(poolsUpdated)} pools updated`);
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error during token pool refresh:')} ${error.message}`);
      this.refreshStats.errors.push({
        time: new Date(),
        message: error.message,
        tokensAffected: tokensToRefresh.length
      });
      
      // Keep only the last 10 errors
      if (this.refreshStats.errors.length > 10) {
        this.refreshStats.errors = this.refreshStats.errors.slice(-10);
      }
      
      this.refreshStats.failedUpdates++;
    } finally {
      this.isRefreshing = false;
      this.lastRefreshTime = new Date();
      this.scheduleNextRefresh();
    }
  }

  /**
   * Refresh pools for a specific token
   * @param {string} tokenAddress - Token address
   * @returns {Object} - Result of the refresh operation
   */
  async refreshPoolsForToken(tokenAddress) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('REFRESHING')} pools for token ${formatLog.token(tokenAddress)}`);

      // Mark token as refreshed
      await prisma.tokens.update({
        where: { address: tokenAddress },
        data: { last_refresh_attempt: new Date() }
      });

      // Fetch pools from DexScreener
      const poolsData = await dexscreenerClient.getTokenPools('solana', tokenAddress);
      
      if (!poolsData || !poolsData.pairs || !Array.isArray(poolsData.pairs)) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('No pools found for token')} ${formatLog.token(tokenAddress)}`);
        return { 
          success: false, 
          poolsFound: 0, 
          poolsUpdated: 0 
        };
      }

      // Filter to Solana pools only (should already be Solana-only since we specified 'solana' in the API call)
      const solanaPoolsRaw = poolsData.pairs.filter(pair => 
        pair && pair.chainId === 'solana' && pair.dexId && pair.pairAddress
      );

      // Apply minimum liquidity filter and sort by liquidity
      const solanaPoolsFiltered = solanaPoolsRaw
        .filter(pair => {
          // Parse liquidity as a number, defaulting to 0 if invalid
          const liquidity = parseFloat(pair.liquidity?.usd || '0');
          return liquidity >= this.config.minLiquidityUsd;
        })
        .sort((a, b) => {
          // Sort by liquidity descending
          const liquidityA = parseFloat(a.liquidity?.usd || '0');
          const liquidityB = parseFloat(b.liquidity?.usd || '0');
          return liquidityB - liquidityA;
        });

      // Limit to max pools per token
      const solanaPoolsLimited = solanaPoolsFiltered.slice(0, this.config.maxPoolsPerToken);

      logApi.info(`${formatLog.tag()} ${formatLog.info('Found')} ${formatLog.count(solanaPoolsRaw.length)} ${formatLog.info('pools total')}, ${formatLog.count(solanaPoolsLimited.length)} ${formatLog.info('after filtering')} for token ${formatLog.token(tokenAddress)}`);

      // Begin transaction to update pools and token metadata
      const updateResult = await prisma.$transaction(async (tx) => {
        // First, let's get existing pools for this token
        const existingPools = await tx.token_pools.findMany({
          where: { tokenAddress }
        });

        const existingPoolAddresses = new Set(existingPools.map(p => p.address));
        const newPoolAddresses = new Set(solanaPoolsLimited.map(p => p.pairAddress));
        
        // Pools to add (in new pools but not in existing)
        const poolsToAdd = solanaPoolsLimited.filter(p => !existingPoolAddresses.has(p.pairAddress));
        
        // Pools to remove (in existing but not in new pools)
        const poolsToRemove = existingPools.filter(p => !newPoolAddresses.has(p.address));

        // Prepare data for creating new pools
        const poolCreateData = poolsToAdd.map(pool => ({
          address: pool.pairAddress,
          tokenAddress: tokenAddress,
          dex: pool.dexId.toUpperCase(), // Normalize DEX ID (e.g., "raydium" -> "RAYDIUM")
          programId: pool.programAddress || pool.pairAddress, // Fallback to pairAddress if programAddress is missing
          dataSize: 0, // Default values, would be updated from on-chain data if available
          tokenOffset: 0, // Default values, would be updated from on-chain data if available
          createdAt: new Date(),
          lastUpdated: new Date()
        }));

        // Delete pools that are no longer in the filtered list
        if (poolsToRemove.length > 0) {
          await tx.token_pools.deleteMany({
            where: {
              tokenAddress,
              address: {
                in: poolsToRemove.map(p => p.address)
              }
            }
          });
        }

        // Create new pools
        let createdCount = 0;
        for (const poolData of poolCreateData) {
          try {
            await tx.token_pools.create({
              data: poolData
            });
            createdCount++;
          } catch (error) {
            logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error creating pool ${poolData.address}:`)} ${error.message}`);
          }
        }

        // Extract token metadata from the pool data
        // Each pair contains details about the token in baseToken or quoteToken
        let tokenMetadata = null;
        let tokenInfo = null;
        let highestLiquidityPool = null;
        
        // Find the highest liquidity pool to use as source for token data
        if (solanaPoolsLimited.length > 0) {
          highestLiquidityPool = solanaPoolsLimited[0]; // Already sorted by liquidity

          // Determine if our token is the base or quote token
          if (highestLiquidityPool.baseToken && highestLiquidityPool.baseToken.address.toLowerCase() === tokenAddress.toLowerCase()) {
            tokenMetadata = highestLiquidityPool.baseToken;
          } else if (highestLiquidityPool.quoteToken && highestLiquidityPool.quoteToken.address.toLowerCase() === tokenAddress.toLowerCase()) {
            tokenMetadata = highestLiquidityPool.quoteToken;
          }
          
          // Extract additional token info from the pool
          tokenInfo = highestLiquidityPool.info || null;
        }
        
        // Extract social links and websites
        const socialLinks = {};
        const websites = [];
        
        if (tokenInfo && tokenInfo.socials && Array.isArray(tokenInfo.socials)) {
          tokenInfo.socials.forEach(social => {
            if (social.type === 'twitter') {
              socialLinks.twitter_url = social.url;
            } else if (social.type === 'telegram') {
              socialLinks.telegram_url = social.url;
            } else if (social.type === 'discord') {
              socialLinks.discord_url = social.url;
            }
          });
        }
        
        if (tokenInfo && tokenInfo.websites && Array.isArray(tokenInfo.websites)) {
          tokenInfo.websites.forEach(website => {
            websites.push({
              url: website.url,
              label: website.label || 'Website'
            });
          });
          
          // Set the primary website URL in the token record
          if (websites.length > 0) {
            socialLinks.website_url = websites[0].url;
          }
        }
        
        // Extract tags from token data
        const tags = [];
        
        // Get any existing token record
        const existingToken = await tx.tokens.findUnique({
          where: { address: tokenAddress },
          select: { tags: true }
        });
        
        // Merge with existing tags if present
        if (existingToken && existingToken.tags) {
          try {
            const existingTags = existingToken.tags;
            if (Array.isArray(existingTags)) {
              tags.push(...existingTags);
            } else if (typeof existingTags === 'object') {
              // If it's a JSON object, extract any tags
              for (const [key, value] of Object.entries(existingTags)) {
                if (value === true && !tags.includes(key)) {
                  tags.push(key);
                }
              }
            }
          } catch (error) {
            logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error processing existing tags for ${tokenAddress}:`)} ${error.message}`);
          }
        }
        
        // Prepare token update data
        const tokenUpdateData = {
          last_refresh_success: new Date(),
          refresh_metadata: {
            lastPoolRefresh: new Date().toISOString(),
            poolsFound: solanaPoolsRaw.length,
            poolsStored: existingPools.length - poolsToRemove.length + createdCount
          }
        };
        
        // Add token metadata if available
        if (tokenMetadata) {
          // Only set these fields if we don't already have them
          if (tokenMetadata.name) tokenUpdateData.name = tokenMetadata.name;
          if (tokenMetadata.symbol) tokenUpdateData.symbol = tokenMetadata.symbol;
        }
        
        // Add token socials and websites if available
        if (Object.keys(socialLinks).length > 0) {
          Object.assign(tokenUpdateData, socialLinks);
        }
        
        // Add image URL if available
        if (tokenInfo && tokenInfo.imageUrl) {
          tokenUpdateData.image_url = tokenInfo.imageUrl;
        }
        
        // Add highest liquidity pool information
        if (highestLiquidityPool) {
          // Get the existing token record to get its ID
          const token = await tx.tokens.findUnique({
            where: { address: tokenAddress },
            select: { id: true }
          });
          
          if (token) {
            // Extract market metrics
            const marketCap = highestLiquidityPool.marketCap ? parseFloat(highestLiquidityPool.marketCap) : null;
            const fdv = highestLiquidityPool.fdv ? parseFloat(highestLiquidityPool.fdv) : null;
            const liquidity = highestLiquidityPool.liquidity?.usd ? parseFloat(highestLiquidityPool.liquidity.usd) : null;
            const priceUsd = highestLiquidityPool.priceUsd ? parseFloat(highestLiquidityPool.priceUsd) : null;
            const volume24h = highestLiquidityPool.volume?.h24 ? parseFloat(highestLiquidityPool.volume.h24) : null;
            const priceChange24h = highestLiquidityPool.priceChange?.h24 ? parseFloat(highestLiquidityPool.priceChange.h24) : null;
            
            // Store price in token_prices table
            const existingPrice = await tx.token_prices.findUnique({
              where: { token_id: token.id }
            });
            
            if (existingPrice) {
              // Update existing price record
              await tx.token_prices.update({
                where: { token_id: token.id },
                data: {
                  price: priceUsd,
                  change_24h: priceChange24h,
                  market_cap: marketCap,
                  fdv: fdv,
                  liquidity: liquidity,
                  volume_24h: volume24h,
                  updated_at: new Date()
                }
              });
            } else {
              // Create new price record
              await tx.token_prices.create({
                data: {
                  token_id: token.id,
                  price: priceUsd,
                  change_24h: priceChange24h,
                  market_cap: marketCap,
                  fdv: fdv,
                  liquidity: liquidity,
                  volume_24h: volume24h,
                  created_at: new Date(),
                  updated_at: new Date()
                }
              });
            }
            
            // Store historical price data if appropriate tables exist
            try {
              // Check if token_price_history table exists and is accessible
              const now = new Date();
              
              // Add to price history
              if (priceUsd) {
                await tx.token_price_history.create({
                  data: {
                    token_id: token.id,
                    price: priceUsd,
                    timestamp: now
                  }
                });
              }
              
              // Add to market cap history
              if (marketCap) {
                await tx.token_market_cap_history.create({
                  data: {
                    token_id: token.id,
                    market_cap: marketCap,
                    timestamp: now
                  }
                });
              }
              
              // Add to volume history
              if (volume24h) {
                await tx.token_volume_history.create({
                  data: {
                    token_id: token.id,
                    volume: volume24h,
                    timestamp: now
                  }
                });
              }
              
              // Add to liquidity history
              if (liquidity) {
                await tx.token_liquidity_history.create({
                  data: {
                    token_id: token.id,
                    liquidity: liquidity,
                    timestamp: now
                  }
                });
              }
            } catch (historyError) {
              // If history tables don't exist or can't be accessed, just log and continue
              logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Could not store history data for token ${tokenAddress}:`)} ${historyError.message}`);
            }
          }
          
          // Just store pool reference information in metadata
          tokenUpdateData.refresh_metadata = {
            ...tokenUpdateData.refresh_metadata,
            primaryPoolAddress: highestLiquidityPool.pairAddress,
            primaryDex: highestLiquidityPool.dexId,
            lastDexDataUpdate: new Date().toISOString()
          };
          
          // Add coingeckoId if available
          if (highestLiquidityPool.coingeckoId) {
            tokenUpdateData.coingeckoId = highestLiquidityPool.coingeckoId;
          }
          
          // We don't update token_rank_history here since ranking comes from Jupiter, not DexScreener
          
          // Add tags from token data
          if (tags.length > 0) {
            tokenUpdateData.tags = tags;
          }
        }
        
        // Update token record with the additional data
        await tx.tokens.update({
          where: { address: tokenAddress },
          data: tokenUpdateData
        });
        
        // If we have website and social links, store them in their own tables
        if (websites.length > 0) {
          // Get token ID
          const token = await tx.tokens.findUnique({
            where: { address: tokenAddress },
            select: { id: true }
          });
          
          if (token) {
            // Delete existing websites for this token
            await tx.token_websites.deleteMany({
              where: { token_id: token.id }
            });
            
            // Add new websites
            for (const website of websites) {
              try {
                await tx.token_websites.create({
                  data: {
                    token_id: token.id,
                    label: website.label,
                    url: website.url,
                    created_at: new Date()
                  }
                });
              } catch (error) {
                logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error creating website for token ${tokenAddress}:`)} ${error.message}`);
              }
            }
          }
        }
        
        // Handle socials in token_socials table
        if (tokenInfo && tokenInfo.socials && Array.isArray(tokenInfo.socials)) {
          // Get token ID
          const token = await tx.tokens.findUnique({
            where: { address: tokenAddress },
            select: { id: true }
          });
          
          if (token) {
            // Delete existing socials for this token
            await tx.token_socials.deleteMany({
              where: { token_id: token.id }
            });
            
            // Add new socials
            for (const social of tokenInfo.socials) {
              try {
                await tx.token_socials.create({
                  data: {
                    token_id: token.id,
                    type: social.type,
                    url: social.url,
                    created_at: new Date()
                  }
                });
              } catch (error) {
                logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error creating social for token ${tokenAddress}:`)} ${error.message}`);
              }
            }
          }
        }

        return {
          poolsFound: solanaPoolsRaw.length,
          poolsFiltered: solanaPoolsLimited.length,
          poolsAdded: createdCount,
          poolsRemoved: poolsToRemove.length,
          poolsTotal: existingPools.length - poolsToRemove.length + createdCount,
          tokenUpdated: !!tokenMetadata
        };
      });

      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully updated pools for token')} ${formatLog.token(tokenAddress)}: ${formatLog.count(updateResult.poolsAdded)} added, ${formatLog.count(updateResult.poolsRemoved)} removed, ${formatLog.count(updateResult.poolsTotal)} total`);

      return {
        success: true,
        poolsFound: updateResult.poolsFound,
        poolsUpdated: updateResult.poolsAdded + updateResult.poolsRemoved,
        poolsTotal: updateResult.poolsTotal,
        tokenUpdated: updateResult.tokenUpdated
      };
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Error refreshing pools for token ${tokenAddress}:`)} ${error.message}`);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Refresh pools for multiple tokens
   * @param {string[]} tokenAddresses - Array of token addresses
   * @returns {Object} - Result of the batch refresh operation
   */
  async refreshPoolsForMultipleTokens(tokenAddresses) {
    let successCount = 0;
    let failureCount = 0;
    let poolsFound = 0;
    let poolsUpdated = 0;

    // Mark all tokens as being refreshed
    await prisma.tokens.updateMany({
      where: {
        address: {
          in: tokenAddresses
        }
      },
      data: {
        last_refresh_attempt: new Date()
      }
    });

    // Use the DexScreener client's batch capability
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('BATCH FETCHING')} pools for ${formatLog.count(tokenAddresses.length)} tokens`);
      
      // Batch-fetch pools for all tokens
      const batchResults = await dexscreenerClient.getMultipleTokenPools('solana', tokenAddresses);
      
      // Process each token's results
      for (const tokenAddress of tokenAddresses) {
        try {
          const tokenResult = batchResults[tokenAddress];
          
          // Skip tokens with errors from the batch request
          if (!tokenResult || tokenResult.error) {
            failureCount++;
            continue;
          }
          
          // Create a compatible pool data structure
          const poolsData = {
            pairs: tokenResult.pairs || []
          };
          
          // Manually refresh this token with the pre-fetched data
          const refreshResult = await this.processPoolData(tokenAddress, poolsData);
          
          if (refreshResult.success) {
            successCount++;
            poolsFound += refreshResult.poolsFound || 0;
            poolsUpdated += refreshResult.poolsUpdated || 0;
          } else {
            failureCount++;
          }
        } catch (tokenError) {
          logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error processing token ${tokenAddress}:`)} ${tokenError.message}`);
          failureCount++;
        }
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Batch refresh completed:')} ${formatLog.count(successCount)}/${formatLog.count(tokenAddresses.length)} successful, ${formatLog.count(poolsUpdated)} pools updated`);
      
      return {
        successCount,
        failureCount,
        poolsFound,
        poolsUpdated
      };
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error during batch refresh:')} ${error.message}`);
      
      // If batch method fails, fall back to individual refreshes
      logApi.info(`${formatLog.tag()} ${formatLog.info('Falling back to individual token refreshes...')}`);
      
      for (const tokenAddress of tokenAddresses) {
        try {
          const result = await this.refreshPoolsForToken(tokenAddress);
          if (result.success) {
            successCount++;
            poolsFound += result.poolsFound || 0;
            poolsUpdated += result.poolsUpdated || 0;
          } else {
            failureCount++;
          }
        } catch (tokenError) {
          logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error refreshing token ${tokenAddress}:`)} ${tokenError.message}`);
          failureCount++;
        }
      }
      
      return {
        successCount,
        failureCount,
        poolsFound,
        poolsUpdated,
        fallbackUsed: true
      };
    }
  }

  /**
   * Process pool data for a token (separated for reuse with pre-fetched data)
   * @param {string} tokenAddress - Token address
   * @param {Object} poolsData - Pool data from DexScreener
   * @returns {Object} - Result of processing
   */
  async processPoolData(tokenAddress, poolsData) {
    try {
      if (!poolsData || !poolsData.pairs || !Array.isArray(poolsData.pairs)) {
        return { 
          success: false, 
          poolsFound: 0, 
          poolsUpdated: 0 
        };
      }

      // Filter to Solana pools
      const solanaPoolsRaw = poolsData.pairs.filter(pair => 
        pair && pair.chainId === 'solana' && pair.dexId && pair.pairAddress
      );

      // Apply minimum liquidity filter and sort by liquidity
      const solanaPoolsFiltered = solanaPoolsRaw
        .filter(pair => {
          const liquidity = parseFloat(pair.liquidity?.usd || '0');
          return liquidity >= this.config.minLiquidityUsd;
        })
        .sort((a, b) => {
          const liquidityA = parseFloat(a.liquidity?.usd || '0');
          const liquidityB = parseFloat(b.liquidity?.usd || '0');
          return liquidityB - liquidityA;
        });

      // Limit to max pools per token
      const solanaPoolsLimited = solanaPoolsFiltered.slice(0, this.config.maxPoolsPerToken);

      // Begin transaction to update pools
      const updateResult = await prisma.$transaction(async (tx) => {
        // First, get existing pools for this token
        const existingPools = await tx.token_pools.findMany({
          where: { tokenAddress }
        });

        const existingPoolAddresses = new Set(existingPools.map(p => p.address));
        const newPoolAddresses = new Set(solanaPoolsLimited.map(p => p.pairAddress));
        
        // Pools to add (in new pools but not in existing)
        const poolsToAdd = solanaPoolsLimited.filter(p => !existingPoolAddresses.has(p.pairAddress));
        
        // Pools to remove (in existing but not in new pools)
        const poolsToRemove = existingPools.filter(p => !newPoolAddresses.has(p.address));

        // Prepare data for creating new pools
        const poolCreateData = poolsToAdd.map(pool => ({
          address: pool.pairAddress,
          tokenAddress: tokenAddress,
          dex: pool.dexId.toUpperCase(), // Normalize DEX ID
          programId: pool.programAddress || pool.pairAddress, 
          dataSize: 0, // Default values
          tokenOffset: 0, // Default values
          createdAt: new Date(),
          lastUpdated: new Date()
        }));

        // Delete pools that are no longer in the filtered list
        if (poolsToRemove.length > 0) {
          await tx.token_pools.deleteMany({
            where: {
              tokenAddress,
              address: {
                in: poolsToRemove.map(p => p.address)
              }
            }
          });
        }

        // Create new pools
        let createdCount = 0;
        for (const poolData of poolCreateData) {
          try {
            await tx.token_pools.create({
              data: poolData
            });
            createdCount++;
          } catch (error) {
            // Skip logging for duplicate key errors
            if (!error.message.includes('duplicate key')) {
              logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error creating pool ${poolData.address}:`)} ${error.message}`);
            }
          }
        }

        // Mark token as successfully refreshed
        await tx.tokens.update({
          where: { address: tokenAddress },
          data: { 
            last_refresh_success: new Date(),
            refresh_metadata: {
              lastPoolRefresh: new Date().toISOString(),
              poolsFound: solanaPoolsRaw.length,
              poolsStored: existingPools.length - poolsToRemove.length + createdCount
            }
          }
        });

        return {
          poolsFound: solanaPoolsRaw.length,
          poolsFiltered: solanaPoolsLimited.length,
          poolsAdded: createdCount,
          poolsRemoved: poolsToRemove.length,
          poolsTotal: existingPools.length - poolsToRemove.length + createdCount
        };
      });

      return {
        success: true,
        poolsFound: updateResult.poolsFound,
        poolsUpdated: updateResult.poolsAdded + updateResult.poolsRemoved,
        poolsTotal: updateResult.poolsTotal
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Get DEX pools for a specific token
   * @param {string} tokenAddress - Token address
   * @param {Object} options - Query options
   * @returns {Promise<Array>} - Array of pools
   */
  async getPoolsForToken(tokenAddress, options = {}) {
    try {
      const { forceRefresh = false, minLiquidityUsd = 0 } = options;
      
      // Check if we need to refresh data first
      if (forceRefresh) {
        await this.refreshPoolsForToken(tokenAddress);
      }
      
      // Query pools from database
      const pools = await prisma.token_pools.findMany({
        where: { tokenAddress }
      });
      
      if (!pools || pools.length === 0) {
        // No pools in database, try to fetch them
        if (!forceRefresh) {
          // Only refresh if we haven't just done so
          await this.refreshPoolsForToken(tokenAddress);
          
          // Query again after refresh
          return await prisma.token_pools.findMany({
            where: { tokenAddress }
          });
        }
        return [];
      }
      
      return pools;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Error getting pools for token ${tokenAddress}:`)} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get service statistics
   * @returns {Object} - Service statistics
   */
  getStats() {
    return {
      ...super.getStats(),
      isRefreshing: this.isRefreshing,
      lastRefreshTime: this.lastRefreshTime,
      nextScheduledRefresh: this.nextScheduledRefresh,
      refreshStats: this.refreshStats,
      config: {
        ...this.config,
        // Don't expose sensitive information
        apiKey: undefined
      }
    };
  }
}

// Create singleton instance
const tokenDEXDataService = new TokenDEXDataService();

// Export the service
export default tokenDEXDataService;