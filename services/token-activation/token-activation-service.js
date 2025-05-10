/**
 * Token Activation Service
 * @description Responsible for evaluating and updating the `is_active` flag on tokens 
 *              based on criteria like age, market cap, volume, and manual overrides.
 * @author BranchManager69 & Gemini
 * @version 1.0.0
 * @created 2025-05-12
 */

import axios from 'axios';
import { BaseService } from '../../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors, serviceColors } from '../../utils/colors.js';
import prisma from '../../config/prisma.js';
import { jupiterClient } from '../solana-engine/jupiter-client.js'; // To fetch prices/metrics
import { jupiterConfig } from '../../config/external-api/jupiter-config.js'; // <-- IMPORT jupiterConfig
import { logError, set, inc } from '../../utils/service-suite/safe-service.js';

const DEFAULT_CHECK_INTERVAL_MS = 15 * 60 * 1000; // Every 15 minutes
const CANDIDATE_BATCH_SIZE = 500; // How many inactive/stale tokens to check metrics for at a time
const METRIC_STALE_THRESHOLD_HOURS = 6; // How old metrics can be before re-checking for active tokens

// Criteria for activation (configurable, could be moved to system_settings later)
const CRITERIA_MIN_MARKET_CAP = 50000; // $50k
const CRITERIA_MIN_VOLUME_24H = 10000; // $10k
const CRITERIA_MAX_AGE_HOURS_FOR_NEW = 24 * 3; // 3 days for "new" token auto-activation

const TOKEN_DETAILS_BATCH_SIZE = 10; // How many tokens to fetch details for in one sub-batch
const DELAY_BETWEEN_TOKEN_DETAILS_BATCH_MS = 5000; // 5 seconds delay

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
        newThresholdDate,           // $1
        CRITERIA_MIN_MARKET_CAP,     // $2
        CRITERIA_MIN_VOLUME_24H,     // $3
        recentThresholdDate,        // $4
        CRITERIA_MIN_MARKET_CAP,     // $5 CORRECTED
        CRITERIA_MIN_VOLUME_24H,     // $6 CORRECTED
        CRITERIA_MIN_MARKET_CAP,     // $7 CORRECTED
        CRITERIA_MIN_VOLUME_24H      // $8 CORRECTED
      );

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
    logApi.info(`${formatLog.tag()} Refreshing metrics for ${addresses.length} tokens (in sub-batches of ${TOKEN_DETAILS_BATCH_SIZE})...`);

    try {
      const priceDataMap = await jupiterClient.getPrices(addresses);

      if (!priceDataMap || Object.keys(priceDataMap).length === 0) {
        logApi.warn(`${formatLog.tag()} No price data returned from jupiterClient for ${addresses.length} addresses during metric refresh.`);
        return;
      }

      const upsertPromises = [];
      let processedCount = 0;

      for (let i = 0; i < addresses.length; i += TOKEN_DETAILS_BATCH_SIZE) {
        const batchAddresses = addresses.slice(i, i + TOKEN_DETAILS_BATCH_SIZE);
        logApi.info(`${formatLog.tag()} Processing token details sub-batch ${Math.floor(i / TOKEN_DETAILS_BATCH_SIZE) + 1}/${Math.ceil(addresses.length / TOKEN_DETAILS_BATCH_SIZE)} (${batchAddresses.length} tokens)`);

        for (const address of batchAddresses) {
          processedCount++;
          const priceInfo = priceDataMap[address];
          const tokenRecord = await prisma.tokens.findUnique({
            where: { address },
            select: { id: true, symbol: true, name: true, decimals: true, total_supply: true, coingeckoId: true }
          });

          if (!tokenRecord) {
            logApi.warn(`${formatLog.tag()} Token record not found in DB for address: ${address} during metric refresh.`);
            continue;
          }
          let currentPrice = null;
          if (priceInfo && priceInfo.price !== undefined && priceInfo.price !== null) {
            currentPrice = parseFloat(priceInfo.price);
            if (isNaN(currentPrice)) currentPrice = null;
          } else {
            logApi.warn(`${formatLog.tag()} No valid price found from Jupiter Price API for ${address}. It will be set to null.`);
            upsertPromises.push(prisma.token_prices.upsert({
              where: { token_id: tokenRecord.id },
              update: { price: null, market_cap: null, volume_24h: null, liquidity: null, fdv: null, updated_at: new Date() },
              create: { token_id: tokenRecord.id, price: null, market_cap: null, volume_24h: null, liquidity: null, fdv: null, updated_at: new Date() }
            }));
            continue; 
          }
          let marketCap = null;
          let volume24h = null;
          let liquidity = null; 
          let fdv = null;       
          let tokenApiData = null;

          try {
            if (typeof axios === 'undefined') {
              logApi.error(`${formatLog.tag()} CRITICAL: axios is UNDEFINED right before trying to use it for address ${address}!`);
            } else {
              logApi.debug(`${formatLog.tag()} DEBUG: axios IS DEFINED. Type: ${typeof axios}. Has .get: ${typeof axios.get === 'function'}`);
            }
            
            const tokenApiUrl = jupiterConfig.endpoints.tokens.getToken(address);
            logApi.debug(`${formatLog.tag()} Attempting to fetch from Jupiter Token API URL: '${tokenApiUrl}' for address: '${address}'`); 

            const tokenInfoResponse = await axios.get(tokenApiUrl, { 
              headers: jupiterConfig.getHeaders ? jupiterConfig.getHeaders() : undefined,
              timeout: 10000 
            });
            tokenApiData = tokenInfoResponse.data;

            if (tokenApiData) {
              if (tokenApiData.daily_volume !== undefined && tokenApiData.daily_volume !== null) {
                volume24h = parseFloat(tokenApiData.daily_volume);
                if (isNaN(volume24h)) volume24h = null;
              }
              if (tokenApiData.market_cap_usd !== undefined && tokenApiData.market_cap_usd !== null) {
                  marketCap = parseFloat(tokenApiData.market_cap_usd);
                  if(isNaN(marketCap)) marketCap = null;
              } else if (tokenApiData.marketCap) {
                  marketCap = parseFloat(tokenApiData.marketCap);
                  if(isNaN(marketCap)) marketCap = null;
              } else if (currentPrice !== null) {
                const supplySource = tokenApiData.supply || tokenRecord.total_supply;
                const decimalsSource = tokenApiData.decimals !== undefined ? tokenApiData.decimals : tokenRecord.decimals;
                if (supplySource !== null && decimalsSource !== null) {
                  try {
                    const supply = parseFloat(supplySource.toString()) / Math.pow(10, parseInt(decimalsSource.toString()));
                    marketCap = currentPrice * supply;
                    if (isNaN(marketCap)) marketCap = null;
                  } catch (mcCalcError) {
                    logApi.warn(`${formatLog.tag()} Could not calculate market cap for ${address}: ${mcCalcError.message}`);
                  }
                }
              }
              if ((tokenApiData.decimals !== undefined && tokenRecord.decimals !== tokenApiData.decimals) || 
                  (tokenApiData.supply !== undefined && tokenRecord.total_supply?.toString() !== tokenApiData.supply?.toString())){
                  await prisma.tokens.update({
                      where: {id: tokenRecord.id},
                      data: {
                          decimals: tokenApiData.decimals !== undefined ? parseInt(tokenApiData.decimals) : tokenRecord.decimals,
                          total_supply: tokenApiData.supply !== undefined ? parseFloat(tokenApiData.supply) / Math.pow(10, parseInt(tokenApiData.decimals || tokenRecord.decimals || 9)) : tokenRecord.total_supply,
                          name: tokenRecord.name || tokenApiData.name, 
                          symbol: tokenRecord.symbol || tokenApiData.symbol, 
                          metadata_last_updated_at: new Date(), 
                      }
                  });
              }
            }
          } catch (tokenApiError) {
            if (tokenApiError.message && tokenApiError.message.toLowerCase().includes('invalid url')) {
              logError(logApi, this.name, `Failed to fetch from Jupiter Token API for ${address} due to INVALID URL. Constructed URL was: '${tokenApiUrl}'`, tokenApiError.response ? tokenApiError.response.status : 'N/A');
            } else {
              logError(logApi, this.name, `Failed to fetch from Jupiter Token API for ${address}: ${tokenApiError.message}`.substring(0, 200), tokenApiError.response ? tokenApiError.response.status : 'N/A');
            }
          }
          const parseDecimal = (val) => (val !== undefined && val !== null && !isNaN(parseFloat(val))) ? parseFloat(val) : null;
          upsertPromises.push(prisma.token_prices.upsert({
            where: { token_id: tokenRecord.id },
            update: {
              price: parseDecimal(currentPrice),
              market_cap: parseDecimal(marketCap),
              volume_24h: parseDecimal(volume24h),
              liquidity: parseDecimal(liquidity), 
              fdv: parseDecimal(fdv),             
              updated_at: new Date()
            },
            create: {
              token_id: tokenRecord.id,
              price: parseDecimal(currentPrice),
              market_cap: parseDecimal(marketCap),
              volume_24h: parseDecimal(volume24h),
              liquidity: parseDecimal(liquidity), 
              fdv: parseDecimal(fdv),             
              updated_at: new Date()
            }
          }));
        } // End inner for...of loop (batchAddresses)

        if (i + TOKEN_DETAILS_BATCH_SIZE < addresses.length) {
          logApi.info(`${formatLog.tag()} Token details sub-batch complete. Waiting ${DELAY_BETWEEN_TOKEN_DETAILS_BATCH_MS}ms...`);
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_TOKEN_DETAILS_BATCH_MS));
        }
      } // End outer for loop (addresses in batches)

      if (upsertPromises.length > 0) {
        logApi.info(`${formatLog.tag()} Attempting to batch upsert metrics for ${upsertPromises.length} tokens into token_prices.`);
        const transactionResults = await prisma.$transaction(upsertPromises);
        logApi.info(`${formatLog.tag()} Successfully upserted metrics for ${transactionResults.length} tokens in token_prices.`);
      } else {
        logApi.info(`${formatLog.tag()} No valid metrics to update in token_prices for the provided addresses.`);
      }
    } catch (error) {
      logError(logApi, this.name, `Error in _refreshMetricsForTokens main try block: ${error.message}`, { count: addresses.length, firstAddress: addresses[0] });
      throw error; 
    }
  }
  
  // performOperation is effectively updateTokenStatuses, managed by internal interval
  // BaseService.performOperation will call onPerformOperation if defined.
  async onPerformOperation() {
    // This is the method BaseService will call if checkIntervalMs is used by BaseService itself.
    // For this service, we use a custom interval, so this can be a no-op or trigger manually if needed.
    logApi.debug(`${formatLog.tag()} onPerformOperation called. Main logic is in updateTokenStatuses via internal interval.`);
    // Optionally, could trigger an update if not already processing:
    // if (!this.isProcessing) { await this.updateTokenStatuses(); }
  }
}

export default new TokenActivationService(); 