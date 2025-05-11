// services/token-activation/token-activation-service.js

/**
 * Token Activation Service
 * 
 * @description Responsible for evaluating and updating the `is_active` flag on tokens 
 *              based on criteria like age, market cap, volume, and manual overrides.
 * 
 * @author BranchManager69
 * @version 2.1.0
 * @created 2025-05-11
 * @updated 2025-05-12
 */

import axios from 'axios';
import { BaseService } from '../../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors, serviceColors } from '../../utils/colors.js';
import prisma from '../../config/prisma.js';
import { jupiterClient } from '../solana-engine/jupiter-client.js'; // To fetch prices/metrics
import { heliusClient } from '../solana-engine/helius-client.js';
import dexScreenerCollector from '../token-enrichment/collectors/dexScreenerCollector.js';
import { jupiterConfig } from '../../config/external-api/jupiter-config.js'; // <-- IMPORT jupiterConfig
import { logError, set, inc } from '../../utils/service-suite/safe-service.js';

const DEFAULT_CHECK_INTERVAL_MS = 3 * 60 * 1000; // Every 3 minutes (reduced from 15 minutes)
const CANDIDATE_BATCH_SIZE = 500; // How many inactive/stale tokens to check metrics for at a time
const METRIC_STALE_THRESHOLD_HOURS = 6; // How old metrics can be before re-checking for active tokens

// Criteria for activation (configurable, could be moved to system_settings later)
// Tier 1: New Tokens (recently seen)
const CRITERIA_TIER1_MIN_MARKET_CAP = 50000;   // $50k
const CRITERIA_TIER1_MIN_VOLUME_24H = 100000;  // $100k

// Tier 2: Recent Tokens
const CRITERIA_TIER2_MIN_MARKET_CAP = 100000;  // $100k
const CRITERIA_TIER2_MIN_VOLUME_24H = 100000;  // $100k

// Tier 3: Established Tokens
const CRITERIA_TIER3_MIN_MARKET_CAP = 250000;  // $250k
const CRITERIA_TIER3_MIN_VOLUME_24H = 100000;  // $100k
const CRITERIA_MAX_AGE_HOURS_FOR_NEW = 24 * 3; // 3 days for "new" token auto-activation

const TOKEN_DETAILS_BATCH_SIZE = 10; // How many tokens to fetch details for in one sub-batch
const DELAY_BETWEEN_TOKEN_DETAILS_BATCH_MS = 5000; // 5 seconds delay
const JUPITER_RATE_LIMIT_RETRY_DELAY_MS = 30000; // 30 seconds for Jupiter 429 errors

const formatLog = {
  tag: () => `${serviceColors.tokenActivationService || fancyColors.PURPLE}[TokenActivationSvc]${fancyColors.RESET}`,
  header: (text) => `${serviceColors.tokenActivationServiceHeader || fancyColors.BG_PURPLE}${fancyColors.WHITE} ${text} ${fancyColors.RESET}`,
  // ... other specific formatters if needed ...
};

class TokenActivationService extends BaseService {
  constructor() {
    super({
      name: SERVICE_NAMES.TOKEN_ACTIVATION, // Will be added to service-constants
      description: 'Manages the active status of tokens based on dynamic criteria.',
      dependencies: [SERVICE_NAMES.JUPITER_CLIENT], // Needs Jupiter for price/volume data
      layer: 'DATA', // Operates on token data
      criticalLevel: 'MEDIUM',
      checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
      circuitBreaker: {
        enabled: true,
        failureThreshold: 3,
        resetTimeoutMs: 10 * 60 * 1000, // 10 minutes
        healthCheckIntervalMs: 2 * 60 * 1000, // 2 minutes
      }
    });
    this.updateTimeoutId = null;
    this.isProcessing = false;
  }

  async initialize() {
    if (this.isInitialized) {
      logApi.warn(`${formatLog.tag()} ${this.name} already initialized.`);
      return true;
    }
    await super.initialize();
    logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} ${this.name}`);
    this._startUpdateScheduler();
    logApi.info(`${formatLog.tag()} ${this.name} initialized and update scheduler started.`);
    return true;
  }

  _startUpdateScheduler() {
    if (this.updateTimeoutId) {
      logApi.warn(`${formatLog.tag()} Update scheduler already active for ${this.name}.`);
      return;
    }
    const intervalMinutes = this.config.checkIntervalMs / (60 * 1000);
    logApi.info(`${formatLog.tag()} Starting token status update scheduler. Target interval: ${intervalMinutes} minutes, aligned to clock.`);
    
    this._scheduleNextUpdate();

    setTimeout(async () => {
      if (this.isProcessing) return;
      const timeToNextScheduled = this._calculateDelayToNextSlot();
      if (timeToNextScheduled < 20000) {
        logApi.info(`${formatLog.tag()} Post-startup run skipped, next scheduled run is very soon.`);
        return;
      }
      this.isProcessing = true;
      try {
        logApi.info(`${formatLog.tag()} ${formatLog.header('POST-STARTUP EXECUTION')} Running initial token status update...`);
        await this.updateTokenStatuses();
      } catch (err) { logError(logApi, this.name, 'Post-startup token status update failed', err); } 
      finally { this.isProcessing = false; }
    }, 20 * 1000);
  }

  _calculateDelayToNextSlot() {
    const now = new Date();
    const intervalMs = this.config.checkIntervalMs;
    if (intervalMs <= 0) {
      logApi.error(`${formatLog.tag()} Invalid checkIntervalMs for aligned scheduling: ${intervalMs}. Must be positive.`);
      return intervalMs;
    }
    const msSinceEpoch = now.getTime();
    const msIntoCurrentCycle = msSinceEpoch % intervalMs;
    let delayMs = intervalMs - msIntoCurrentCycle;

    if (delayMs < 5000) {
      delayMs += intervalMs;
    }
    return delayMs;
  }

  _scheduleNextUpdate() {
    if (!this.isStarted) {
      logApi.info(`${formatLog.tag()} Service stopped, not scheduling next update.`);
      return;
    }
    if (this.updateTimeoutId) {
      clearTimeout(this.updateTimeoutId);
    }

    const delayMs = this._calculateDelayToNextSlot();
    const nextRunTime = new Date(Date.now() + delayMs);
    logApi.info(`${formatLog.tag()} Next token status update scheduled for: ${nextRunTime.toLocaleTimeString()} (in ${Math.round(delayMs/1000)}s)`);

    this.updateTimeoutId = setTimeout(async () => {
      if (this.isProcessing) {
        logApi.warn(`${formatLog.tag()} Token activation update (scheduled) was due but still processing previous. Rescheduling.`);
        if (this.isStarted) this._scheduleNextUpdate();
        return;
      }
      this.isProcessing = true;
      try {
        logApi.info(`${formatLog.tag()} ${formatLog.header('SCHEDULED EXECUTION')} at ${new Date().toLocaleTimeString()}`);
        await this.updateTokenStatuses();
      } catch (error) {
        logError(logApi, this.name, 'Error during scheduled token status update (aligned)', error);
        await this.handleError(error);
      } finally {
        this.isProcessing = false;
        if (this.isStarted) {
          this._scheduleNextUpdate();
        }
      }
    }, delayMs);
  }

  _stopUpdateScheduler() {
    if (this.updateTimeoutId) {
      clearTimeout(this.updateTimeoutId);
      this.updateTimeoutId = null;
      logApi.info(`${formatLog.tag()} Stopped periodic token status update scheduler for ${this.name}.`);
    }
  }

  async stop() {
    logApi.info(`${formatLog.tag()} ${formatLog.header('STOPPING')} ${this.name}`);
    this.isStarted = false;
    this._stopUpdateScheduler();
    await super.stop();
    logApi.info(`${formatLog.tag()} ${this.name} stopped.`);
    return true;
  }

  /**
   * Main method called periodically to update token statuses.
   */
  async updateTokenStatuses() {
    logApi.info(`${formatLog.tag()} ${formatLog.header('UPDATE CYCLE')} Starting token active status evaluation...`);
    inc(this.stats.operations, 'total');
    const startTime = Date.now();

    try {
      const candidateAddresses = await this._selectCandidateTokenAddresses();
      if (candidateAddresses.length > 0) {
        await this._refreshMetricsForTokens(candidateAddresses);
      } else {
        logApi.info(`${formatLog.tag()} No candidate tokens needed metric refresh in this cycle.`);
      }

      const now = new Date();
      // Defines the cutoff for "New" tokens (e.g., anything seen within the last 24 hours)
      const newThresholdDate = new Date(now.getTime() - CRITERIA_MAX_AGE_HOURS_FOR_NEW * 60 * 60 * 1000);
      // Defines the cutoff for "Recent" tokens (e.g., anything seen within the last 7 days)
      // "Established" tokens are older than this.
      const recentThresholdDate = new Date(now.getTime() - CRITERIA_MAX_AGE_HOURS_FOR_NEW * 24 * 60 * 60 * 1000);

      // Make sure to use Prisma's recommended way for $executeRaw or $queryRaw with template literals
      // if not using $executeRawUnsafe for very specific reasons.
      // The $1, $2, etc. are placeholders for parameters.
      const updatedCount = await prisma.$executeRawUnsafe(
        `UPDATE tokens t
         SET
           is_active = CASE
             WHEN t.manually_activated = TRUE THEN TRUE
             -- Tier 1: New Tokens (seen more recently than newThresholdDate)
             WHEN t.first_seen_on_jupiter_at >= $1 AND tp.market_cap >= $2 AND tp.volume_24h >= $3 THEN TRUE
             -- Tier 2: Recent Tokens (seen more recently than recentThresholdDate but not newer than newThresholdDate)
             WHEN t.first_seen_on_jupiter_at < $1 AND t.first_seen_on_jupiter_at >= $4 AND tp.market_cap >= $5 AND tp.volume_24h >= $6 THEN TRUE
             -- Tier 3: Established Tokens (seen older than recentThresholdDate)
             WHEN t.first_seen_on_jupiter_at < $4 AND tp.market_cap >= $7 AND tp.volume_24h >= $8 THEN TRUE
             ELSE FALSE
           END,
           last_is_active_evaluation_at = NOW()
         FROM token_prices tp
         WHERE t.id = tp.token_id AND (
           t.is_active != (
             CASE
               WHEN t.manually_activated = TRUE THEN TRUE
               WHEN t.first_seen_on_jupiter_at >= $1 AND tp.market_cap >= $2 AND tp.volume_24h >= $3 THEN TRUE
               WHEN t.first_seen_on_jupiter_at < $1 AND t.first_seen_on_jupiter_at >= $4 AND tp.market_cap >= $5 AND tp.volume_24h >= $6 THEN TRUE
               WHEN t.first_seen_on_jupiter_at < $4 AND tp.market_cap >= $7 AND tp.volume_24h >= $8 THEN TRUE
               ELSE FALSE
             END
           ) OR t.last_is_active_evaluation_at IS NULL OR t.last_is_active_evaluation_at < (NOW() - INTERVAL '${METRIC_STALE_THRESHOLD_HOURS} hours')
         );`,
        newThresholdDate,               // $1
        CRITERIA_TIER1_MIN_MARKET_CAP,  // $2 - Tier 1 Market Cap ($50k)
        CRITERIA_TIER1_MIN_VOLUME_24H,  // $3 - Tier 1 Volume ($100k)
        recentThresholdDate,            // $4
        CRITERIA_TIER2_MIN_MARKET_CAP,  // $5 - Tier 2 Market Cap ($100k)
        CRITERIA_TIER2_MIN_VOLUME_24H,  // $6 - Tier 2 Volume ($100k)
        CRITERIA_TIER3_MIN_MARKET_CAP,  // $7 - Tier 3 Market Cap ($250k)
        CRITERIA_TIER3_MIN_VOLUME_24H   // $8 - Tier 3 Volume ($100k)
      );

      // After updating, log tokens that changed status for detailed tracking
      if (updatedCount > 0) {
        try {
          // Get details of tokens that just changed status
          const statusChanges = await prisma.$queryRaw`
            SELECT
              t.id, t.address, t.symbol, t.name, t.is_active,
              tp.market_cap, tp.volume_24h,
              t.first_seen_on_jupiter_at,
              CASE
                WHEN t.first_seen_on_jupiter_at >= ${newThresholdDate} THEN 'Tier 1 (New)'
                WHEN t.first_seen_on_jupiter_at < ${newThresholdDate} AND t.first_seen_on_jupiter_at >= ${recentThresholdDate} THEN 'Tier 2 (Recent)'
                ELSE 'Tier 3 (Established)'
              END as tier
            FROM tokens t
            JOIN token_prices tp ON t.id = tp.token_id
            WHERE t.last_is_active_evaluation_at > NOW() - INTERVAL '1 minute'
            AND t.last_is_active_evaluation_at < NOW()
            ORDER BY t.is_active DESC, tp.market_cap DESC
            LIMIT 100
          `;

          if (statusChanges && statusChanges.length > 0) {
            const activated = statusChanges.filter(t => t.is_active);
            const deactivated = statusChanges.filter(t => !t.is_active);

            if (activated.length > 0) {
              logApi.info(`${formatLog.tag()} TOKENS ACTIVATED: ${activated.length} tokens now active`);
              activated.forEach(token => {
                logApi.info(`${formatLog.tag()} ACTIVATED: ${token.symbol || token.address} (${token.tier}) - MC: $${Math.round(token.market_cap)}, Vol: $${Math.round(token.volume_24h)}`);
              });
            }

            if (deactivated.length > 0) {
              logApi.info(`${formatLog.tag()} TOKENS DEACTIVATED: ${deactivated.length} tokens now inactive`);
              deactivated.forEach(token => {
                logApi.info(`${formatLog.tag()} DEACTIVATED: ${token.symbol || token.address} (${token.tier}) - MC: $${Math.round(token.market_cap)}, Vol: $${Math.round(token.volume_24h)}`);
              });
            }
          }
        } catch (logError) {
          logApi.error(`${formatLog.tag()} Error generating detailed status change logs: ${logError.message}`);
        }
      }

      logApi.info(`${formatLog.tag()} Token active status evaluation complete. ${updatedCount} records potentially updated.`);
      inc(this.stats.operations, 'successful');
      this.stats.performance.lastOperationTimeMs = Date.now() - startTime;
      await this.recordSuccess();
    } catch (error) {
      logError(logApi, this.name, 'Error in updateTokenStatuses cycle', error);
      await this.handleError(error);
    }
  }

  /**
   * Selects token addresses that need their metrics (price, volume, MC) refreshed.
   * Candidates are: inactive tokens, or active tokens with stale metrics.
   */
  async _selectCandidateTokenAddresses() {
    logApi.debug(`${formatLog.tag()} Selecting candidate tokens for metric refresh...`);
    const staleMetricsDate = new Date(Date.now() - METRIC_STALE_THRESHOLD_HOURS * 60 * 60 * 1000);   
    
    // Fetch a batch of inactive tokens, prioritizing those never evaluated or evaluated longest ago
    const inactiveTokens = await prisma.tokens.findMany({
      where: { is_active: false },
      select: { address: true },
      take: CANDIDATE_BATCH_SIZE, // Use the full batch size for inactive ones initially
      orderBy: { last_is_active_evaluation_at: 'asc' } // NULLS FIRST is default for asc
    });

    // Fetch a batch of active tokens with stale metrics or no metrics in token_prices
    // Prioritize those with the oldest metric updates.
    const activeStaleTokens = await prisma.tokens.findMany({
        where: {
            is_active: true,
            OR: [
                { token_prices: { updated_at: { lt: staleMetricsDate } } }, // Check against token_prices.updated_at
                { token_prices: null } // If no price record exists yet for an active token
            ]
        },
        select: { address: true },
        take: CANDIDATE_BATCH_SIZE, // Also take a full batch for these; Set will merge
        orderBy: { token_prices: { updated_at: 'asc' } } // NULLS FIRST is default for asc
    });

    // Combine and get unique addresses
    const addresses = new Set([...inactiveTokens.map(t => t.address), ...activeStaleTokens.map(t => t.address)]);
    
    logApi.info(`${formatLog.tag()} Selected ${addresses.size} unique candidate tokens for metric refresh.`);
    return Array.from(addresses);
  }

  /**
   * Refreshes key metrics (price, volume, market_cap) for the given token addresses
   * and updates the `token_prices` table.
   */
  async _refreshMetricsForTokens(addresses) {
    if (!addresses || addresses.length === 0) {
      logApi.debug(`${formatLog.tag()} No addresses provided to _refreshMetricsForTokens.`);
      return;
    }
    logApi.info(`${formatLog.tag()} Refreshing metrics for ${addresses.length} tokens using DexScreener and Helius...`);

    try {
      // Fetch data from DexScreener (already handles internal batching)
      const dexScreenerResultsMap = await dexScreenerCollector.getTokensByAddressBatch(addresses);
      logApi.info(`${formatLog.tag()} Fetched DexScreener data for ${Object.keys(dexScreenerResultsMap).length} addresses.`);

      // Fetch data from Helius (already handles internal batching)
      const heliusRawResults = await heliusClient.tokens.getTokensMetadata(addresses);
      const heliusResultsMap = new Map();
      heliusRawResults.forEach(item => {
        if (item && item.mint) {
          heliusResultsMap.set(item.mint, item);
        }
      });
      logApi.info(`${formatLog.tag()} Fetched Helius metadata for ${heliusResultsMap.size} addresses.`);

      const tokenUpdates = [];
      const tokenPriceUpserts = [];
      const allNewSocials = [];
      const allNewWebsites = []; // Assuming a separate table or distinct handling

      const processedTokenIds = []; // For batch deleting socials/websites

      for (const address of addresses) {
        const dexData = dexScreenerResultsMap[address];
        const heliusData = heliusResultsMap.get(address);

        if (!dexData && !heliusData) {
          logApi.warn(`${formatLog.tag()} No data found for address: ${address} from either DexScreener or Helius.`);
          continue;
        }

        const tokenRecord = await prisma.tokens.findUnique({
          where: { address },
          select: { id: true, symbol: true, name: true, decimals: true, total_supply: true, coingeckoId: true }
        });

        if (!tokenRecord) {
          logApi.warn(`${formatLog.tag()} Token record not found in DB for address: ${address} during metric refresh.`);
          continue;
        }
        processedTokenIds.push(tokenRecord.id);

        // Prepare token table update data
        const tokenUpdateData = {
          metadata_last_updated_at: new Date(),
        };

        // Decimals: Prioritize Helius
        if (heliusData && heliusData.decimals !== undefined && heliusData.decimals !== null) {
          tokenUpdateData.decimals = heliusData.decimals;
        } else if (dexData && dexData.baseToken && dexData.baseToken.decimals !== undefined ) { // Check if DexScreener has decimals (unlikely for current collector)
           // logApi.warn(`${formatLog.tag()} Using DexScreener decimals for ${address} - Helius did not provide. This is unexpected.`);
           // tokenUpdateData.decimals = dexData.baseToken.decimals;
        }


        // Name & Symbol: Prioritize Helius (on-chain) if available, else DexScreener
        if (heliusData && heliusData.name) {
          tokenUpdateData.name = heliusData.name;
        } else if (dexData && dexData.name) {
          tokenUpdateData.name = dexData.name;
        }
        if (heliusData && heliusData.symbol) {
          tokenUpdateData.symbol = heliusData.symbol;
        } else if (dexData && dexData.symbol) {
          tokenUpdateData.symbol = dexData.symbol;
        }

        // Logo URL: DexScreener
        if (dexData && dexData.metadata && dexData.metadata.imageUrl) {
          tokenUpdateData.logo_url = dexData.metadata.imageUrl;
        } else if (dexData && dexData.info && dexData.info.imageUrl) { // Fallback for older collector structure
            tokenUpdateData.logo_url = dexData.info.imageUrl;
        }


        // Total Supply: Use Helius if available as initial, but TokenPriceWebSocketService handles ongoing.
        // Only set if not already set or if Helius value is significantly different and newer.
        if (heliusData && heliusData.total_supply && (tokenRecord.total_supply === null || tokenRecord.total_supply === undefined)) {
          try {
            tokenUpdateData.total_supply = parseFloat(heliusData.total_supply);
            if(isNaN(tokenUpdateData.total_supply)) delete tokenUpdateData.total_supply;
          } catch (e) { /* ignore parse error */ }
        }


        if (Object.keys(tokenUpdateData).length > 1) { // more than just metadata_last_updated_at
          tokenUpdates.push({ where: { id: tokenRecord.id }, data: tokenUpdateData });
        }

        // Prepare token_prices table upsert data (from DexScreener)
        if (dexData) {
          const priceUpsertData = {
            token_id: tokenRecord.id,
            price: dexData.price !== undefined && dexData.price !== null ? parseFloat(dexData.price) : null,
            market_cap: dexData.marketCap !== undefined && dexData.marketCap !== null ? parseFloat(dexData.marketCap) : null,
            fdv: dexData.fdv !== undefined && dexData.fdv !== null ? parseFloat(dexData.fdv) : null,
            volume_24h: dexData.volume && dexData.volume.h24 !== undefined && dexData.volume.h24 !== null ? parseFloat(dexData.volume.h24) : null,
            liquidity_usd: dexData.liquidity && dexData.liquidity.usd !== undefined && dexData.liquidity.usd !== null ? parseFloat(dexData.liquidity.usd) : null,
            updated_at: new Date(),
            // Store raw dexscreener data if needed for specific fields not yet mapped
            // raw_dexscreener_data: dexData, 
          };
          // Filter out null prices before pushing, as price is non-nullable in schema
          if (priceUpsertData.price !== null && !isNaN(priceUpsertData.price)) {
             tokenPriceUpserts.push({
                where: { token_id: tokenRecord.id },
                update: {
                    price: priceUpsertData.price,
                    market_cap: isNaN(priceUpsertData.market_cap) ? null : priceUpsertData.market_cap,
                    fdv: isNaN(priceUpsertData.fdv) ? null : priceUpsertData.fdv,
                    volume_24h: isNaN(priceUpsertData.volume_24h) ? null : priceUpsertData.volume_24h,
                    liquidity_usd: isNaN(priceUpsertData.liquidity_usd) ? null : priceUpsertData.liquidity_usd,
                    updated_at: priceUpsertData.updated_at,
                },
                create: {
                    token_id: priceUpsertData.token_id,
                    price: priceUpsertData.price,
                    market_cap: isNaN(priceUpsertData.market_cap) ? null : priceUpsertData.market_cap,
                    fdv: isNaN(priceUpsertData.fdv) ? null : priceUpsertData.fdv,
                    volume_24h: isNaN(priceUpsertData.volume_24h) ? null : priceUpsertData.volume_24h,
                    liquidity_usd: isNaN(priceUpsertData.liquidity_usd) ? null : priceUpsertData.liquidity_usd,
                    updated_at: priceUpsertData.updated_at,
                },
            });
          } else {
            logApi.debug(`${formatLog.tag()} Skipping price upsert for ${address} due to null/NaN price from DexScreener.`);
          }


          // Prepare token_socials and token_websites data
          if (dexData.socials) {
            for (const [type, url] of Object.entries(dexData.socials)) {
              if (url && typeof url === 'string') { // Ensure URL is a string
                allNewSocials.push({ token_id: tokenRecord.id, type: type.toLowerCase(), url: url });
              }
            }
          }
          if (dexData.websites && Array.isArray(dexData.websites)) {
            dexData.websites.forEach(site => {
              if (site.url && typeof site.url === 'string') {
                // Assuming a separate table for websites, or a generic type in token_socials
                // For this example, let's assume token_socials handles websites with type 'website'
                // And token_websites is a separate table.
                 allNewWebsites.push({ token_id: tokenRecord.id, label: site.label || 'website', url: site.url });
                 // If also adding to token_socials:
                 // allNewSocials.push({ token_id: tokenRecord.id, type: 'website', url: site.url });
              }
            });
          }
        }
      } // End of address loop

      // Batch Database Operations
      if (tokenUpdates.length > 0 || tokenPriceUpserts.length > 0 || allNewSocials.length > 0 || allNewWebsites.length > 0) {
        await prisma.$transaction(async (tx) => {
          logApi.info(`${formatLog.tag()} Starting Prisma transaction for DB updates...`);

          // Update tokens table
          if (tokenUpdates.length > 0) {
            logApi.info(`${formatLog.tag()} Updating ${tokenUpdates.length} records in 'tokens' table.`);
            for (const op of tokenUpdates) {
              await tx.tokens.update(op);
            }
          }

          // Upsert token_prices table
          if (tokenPriceUpserts.length > 0) {
            logApi.info(`${formatLog.tag()} Upserting ${tokenPriceUpserts.length} records in 'token_prices' table.`);
            for (const op of tokenPriceUpserts) {
              await tx.token_prices.upsert(op);
            }
          }
          
          if (processedTokenIds.length > 0) {
            // Delete existing socials and websites for these tokens then create new ones
            if (allNewSocials.length > 0) {
              logApi.info(`${formatLog.tag()} Deleting existing socials for ${processedTokenIds.length} tokens.`);
              await tx.token_socials.deleteMany({ where: { token_id: { in: processedTokenIds } } });
              logApi.info(`${formatLog.tag()} Creating ${allNewSocials.length} new records in 'token_socials' table.`);
              await tx.token_socials.createMany({ data: allNewSocials, skipDuplicates: true });
            }

            if (allNewWebsites.length > 0) { // Assuming token_websites table exists
              logApi.info(`${formatLog.tag()} Deleting existing websites for ${processedTokenIds.length} tokens.`);
              await tx.token_websites.deleteMany({ where: { token_id: { in: processedTokenIds } } });
              logApi.info(`${formatLog.tag()} Creating ${allNewWebsites.length} new records in 'token_websites' table.`);
              await tx.token_websites.createMany({ data: allNewWebsites, skipDuplicates: true });
            }
          }
          logApi.info(`${formatLog.tag()} Prisma transaction completed successfully.`);
        });
      } else {
        logApi.info(`${formatLog.tag()} No database updates required for this batch of addresses.`);
      }

    } catch (error) {
      logError(logApi, this.name, `Error in _refreshMetricsForTokens main try block: ${error.message}`, { count: addresses.length, firstAddress: addresses[0] });
      throw error;
    }
  }
}
