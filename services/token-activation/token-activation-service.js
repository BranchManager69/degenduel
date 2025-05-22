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
import { SERVICE_NAMES, getServiceMetadata, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../utils/service-suite/service-constants.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors, serviceColors } from '../../utils/colors.js';
import prisma from '../../config/prisma.js';
import { jupiterClient } from '../solana-engine/jupiter-client.js'; // To fetch prices/metrics
import { heliusClient } from '../solana-engine/helius-client.js';
import dexScreenerCollector from '../token-enrichment/collectors/dexScreenerCollector.js';
import { jupiterConfig } from '../../config/external-api/jupiter-config.js'; // <-- IMPORT jupiterConfig
import { logError, set, inc } from '../../utils/service-suite/safe-service.js';

const DEFAULT_CHECK_INTERVAL_MS = 3 * 60 * 1000; // Every 3 minutes (reduced from 15 minutes)
const CANDIDATE_BATCH_SIZE = 100; // How many inactive/stale tokens to check metrics for at a time (Changed from 500)
const METRIC_STALE_THRESHOLD_HOURS = 6; // How old metrics can be before re-checking for active tokens

// Criteria for activation (configurable, could be moved to system_settings later)
// Tier 1: New Tokens (recently seen)
const CRITERIA_TIER1_MIN_MARKET_CAP = 50000;   // $50k
const CRITERIA_TIER1_MIN_VOLUME_24H = 50000;   // $50k (reduced from $100k to activate more tokens)

// Tier 2: Recent Tokens
const CRITERIA_TIER2_MIN_MARKET_CAP = 100000;  // $100k
const CRITERIA_TIER2_MIN_VOLUME_24H = 50000;   // $50k (reduced from $100k to activate more tokens)

// Tier 3: Established Tokens
const CRITERIA_TIER3_MIN_MARKET_CAP = 250000;  // $250k
const CRITERIA_TIER3_MIN_VOLUME_24H = 50000;   // $50k (reduced from $100k to activate more tokens)
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
    const serviceName = SERVICE_NAMES.TOKEN_ACTIVATION; // Will be added to service-constants
    const metadata = getServiceMetadata(serviceName) || {};
    super({
      name: serviceName,
      description: metadata.description || 'Manages the active status of tokens based on dynamic criteria.',
      dependencies: [SERVICE_NAMES.JUPITER_CLIENT], // Needs Jupiter for price/volume data
      layer: metadata.layer || 'DATA', // Operates on token data
      criticalLevel: metadata.criticalLevel || 'MEDIUM',
      checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
      circuitBreaker: {
        ...(metadata.circuitBreaker || DEFAULT_CIRCUIT_BREAKER_CONFIG), // Start with defaults, allow override
        enabled: metadata.circuitBreaker?.enabled !== undefined ? metadata.circuitBreaker.enabled : true,
        failureThreshold: metadata.circuitBreaker?.failureThreshold || 3,
        resetTimeoutMs: metadata.circuitBreaker?.resetTimeoutMs || 10 * 60 * 1000, 
        healthCheckIntervalMs: metadata.circuitBreaker?.healthCheckIntervalMs || 2 * 60 * 1000,
      }
    });
    this.updateTimeoutId = null;
    this.isProcessing = false;

    // Ensure this.stats is initialized by BaseService, then add lastCycleDetails
    this.stats = this.stats || {}; // Should be initialized by super()
    this.stats.lastCycleDetails = {
        startTime: null,
        endTime: null,
        durationMs: 0,
        status: 'idle', // idle, selecting_candidates, refreshing_metrics, evaluating_status, completed, failed
        candidatesSelected: 0,
        metricsRefreshedCount: 0, // Number of tokens for which metrics were attempted to be refreshed
        dbTokensUpdated: 0,
        dbPricesUpserted: 0,
        dbSocialsUpdated: 0,
        dbWebsitesUpdated: 0,
        activatedInCycle: 0,
        deactivatedInCycle: 0,
        errorMessage: null,
    };
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
    const cycleStartTime = Date.now();
    
    set(this.stats.lastCycleDetails, {
        startTime: new Date(cycleStartTime).toISOString(),
        endTime: null,
        durationMs: 0,
        status: 'selecting_candidates',
        candidatesSelected: 0,
        metricsRefreshedCount: 0,
        dbTokensUpdated: 0,
        dbPricesUpserted: 0,
        dbSocialsUpdated: 0,
        dbWebsitesUpdated: 0,
        activatedInCycle: 0,
        deactivatedInCycle: 0,
        errorMessage: null,
    });

    try {
      const candidateAddresses = await this._selectCandidateTokenAddresses();
      set(this.stats.lastCycleDetails, 'candidatesSelected', candidateAddresses.length);
      set(this.stats.lastCycleDetails, 'status', 'refreshing_metrics');

      if (candidateAddresses.length > 0) {
        await this._refreshMetricsForTokens(candidateAddresses, this.stats.lastCycleDetails);
      } else {
        logApi.info(`${formatLog.tag()} No candidate tokens needed metric refresh in this cycle.`);
      }

      set(this.stats.lastCycleDetails, 'status', 'evaluating_status');
      const now = new Date();
      const newThresholdDate = new Date(now.getTime() - CRITERIA_MAX_AGE_HOURS_FOR_NEW * 60 * 60 * 1000);
      const recentThresholdDate = new Date(now.getTime() - CRITERIA_MAX_AGE_HOURS_FOR_NEW * 24 * 60 * 60 * 1000);

      const activeBefore = await prisma.tokens.count({ where: { is_active: true } });

      const updatedCountRawSql = await prisma.$executeRawUnsafe(
        `UPDATE tokens t
         SET
           is_active = CASE
             WHEN t.manually_activated = TRUE THEN TRUE
             WHEN t.first_seen_on_jupiter_at >= $1 AND tp.market_cap >= $2 AND tp.volume_24h >= $3 THEN TRUE
             WHEN t.first_seen_on_jupiter_at < $1 AND t.first_seen_on_jupiter_at >= $4 AND tp.market_cap >= $5 AND tp.volume_24h >= $6 THEN TRUE
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
        newThresholdDate, CRITERIA_TIER1_MIN_MARKET_CAP, CRITERIA_TIER1_MIN_VOLUME_24H,
        recentThresholdDate, CRITERIA_TIER2_MIN_MARKET_CAP, CRITERIA_TIER2_MIN_VOLUME_24H,
        CRITERIA_TIER3_MIN_MARKET_CAP, CRITERIA_TIER3_MIN_VOLUME_24H
      );
      
      const activeAfter = await prisma.tokens.count({ where: { is_active: true } });
      const changedCount = Math.abs(activeAfter - activeBefore);
      set(this.stats.lastCycleDetails, 'activatedInCycle', Math.max(0, activeAfter - activeBefore));
      set(this.stats.lastCycleDetails, 'deactivatedInCycle', Math.max(0, activeBefore - activeAfter));

      logApi.info(`${formatLog.tag()} Token active status evaluation complete. ${updatedCountRawSql} records potentially evaluated by SQL, ${changedCount} status changes detected.`);
      inc(this.stats.operations, 'successful');
      set(this.stats.performance, 'lastOperationTimeMs', Date.now() - cycleStartTime);
      await this.recordSuccess();
      set(this.stats.lastCycleDetails, 'status', 'completed');
    } catch (error) {
      logError(logApi, this.name, 'Error in updateTokenStatuses cycle', error);
      set(this.stats.lastCycleDetails, 'status', 'failed');
      set(this.stats.lastCycleDetails, 'errorMessage', error.message);
      await this.handleError(error);
    } finally {
      set(this.stats.lastCycleDetails, 'endTime', new Date().toISOString());
      set(this.stats.lastCycleDetails, 'durationMs', Date.now() - cycleStartTime);
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
  async _refreshMetricsForTokens(addresses, lastCycleDetailsRef) {
    if (!addresses || addresses.length === 0) {
      logApi.debug(`${formatLog.tag()} No addresses provided to _refreshMetricsForTokens.`);
      if (lastCycleDetailsRef) {
        set(lastCycleDetailsRef, 'metricsRefreshedCount', 0);
        set(lastCycleDetailsRef, 'dbTokensUpdated', 0);
        set(lastCycleDetailsRef, 'dbPricesUpserted', 0);
        set(lastCycleDetailsRef, 'dbSocialsUpdated', 0);
        set(lastCycleDetailsRef, 'dbWebsitesUpdated', 0);
      }
      return;
    }
    logApi.info(`${formatLog.tag()} Refreshing metrics for ${addresses.length} tokens using DexScreener and Helius...`);
    
    if (lastCycleDetailsRef) {
        set(lastCycleDetailsRef, 'metricsRefreshedCount', addresses.length); 
        set(lastCycleDetailsRef, 'dbTokensUpdated', 0); // Will be set by actual transaction result count
        set(lastCycleDetailsRef, 'dbPricesUpserted', 0); // Will be set by actual transaction result count
        set(lastCycleDetailsRef, 'dbSocialsUpdated', 0); // Will be set by actual transaction result count
        set(lastCycleDetailsRef, 'dbWebsitesUpdated', 0); // Will be set by actual transaction result count
        set(lastCycleDetailsRef, 'errorMessage', null);
    }

    try {
      const dexScreenerResultsMap = await dexScreenerCollector.getTokensByAddressBatch(addresses);
      const heliusRawResults = await heliusClient.tokens.getTokensMetadata(addresses);
      const heliusResultsMap = new Map();
      heliusRawResults.forEach(item => { if (item?.mint) heliusResultsMap.set(item.mint, item); });
      logApi.info(`${formatLog.tag()} Fetched API data for ${addresses.length} tokens.`);

      // Pre-fetch all necessary token records from DB for the entire 'addresses' list
      const tokenRecordsMap = new Map();
      if (addresses.length > 0) {
        const tokensFromDb = await prisma.tokens.findMany({
            where: { address: { in: addresses } },
            select: { id: true, address: true, symbol: true, name: true, decimals: true, total_supply: true, coingeckoId: true }
        });
        tokensFromDb.forEach(t => tokenRecordsMap.set(t.address, t));
      }

      const SUB_BATCH_SIZE = 20; 
      let overallTokensProcessedCount = 0;
      let overallPricesUpsertedCount = 0;
      let overallSocialsCreatedCount = 0;
      let overallWebsitesCreatedCount = 0;

      for (let i = 0; i < addresses.length; i += SUB_BATCH_SIZE) {
        const subBatchAddresses = addresses.slice(i, i + SUB_BATCH_SIZE);
        const allDbOperationsInSubBatch = [];
        const processedTokenIdsForSocialsAndWebsitesInSubBatch = [];
        let tokensProcessedInSubBatch = 0;
        let pricesUpsertedInSubBatch = 0;
        let socialsCreatedInSubBatch = 0;
        let websitesCreatedInSubBatch = 0;

        logApi.info(`${formatLog.tag()} Processing DB sub-batch ${Math.floor(i / SUB_BATCH_SIZE) + 1} for ${subBatchAddresses.length} tokens.`);

        for (const address of subBatchAddresses) {
          const dexData = dexScreenerResultsMap[address]; 
          const heliusData = heliusResultsMap.get(address);
          
          const tokenRecord = tokenRecordsMap.get(address); // Get from pre-fetched map

          if (!tokenRecord || (!dexData && !heliusData)) { // If no record or no API data, skip
            if(!tokenRecord) logApi.warn(`${formatLog.tag()} Token record not found in pre-fetched map for address: ${address}`);
            else logApi.warn(`${formatLog.tag()} No API data for ${address}`);
            continue;
          }
          
          processedTokenIdsForSocialsAndWebsitesInSubBatch.push(tokenRecord.id);

          const tokenUpdateData = { metadata_last_updated_at: new Date() };
          if (heliusData?.decimals !== undefined && heliusData.decimals !== null) tokenUpdateData.decimals = heliusData.decimals;
          if (heliusData?.name) tokenUpdateData.name = heliusData.name; else if (dexData?.name) tokenUpdateData.name = dexData.name;
          if (heliusData?.symbol) tokenUpdateData.symbol = heliusData.symbol; else if (dexData?.symbol) tokenUpdateData.symbol = dexData.symbol;
          if (dexData?.metadata?.imageUrl) tokenUpdateData.image_url = dexData.metadata.imageUrl;
          if (heliusData?.total_supply && (tokenRecord.total_supply === null || tokenRecord.total_supply === undefined)) {
            try { const ts = parseFloat(heliusData.total_supply); if(!isNaN(ts)) tokenUpdateData.total_supply = ts; } catch (e) { /* ignore */ }
          }

          if (Object.keys(tokenUpdateData).length > 1) {
            allDbOperationsInSubBatch.push(prisma.tokens.update({ where: { id: tokenRecord.id }, data: tokenUpdateData }));
            tokensProcessedInSubBatch++;
          }

          if (dexData) {
            const price = dexData.price !== undefined && dexData.price !== null ? parseFloat(dexData.price) : null;
            if (price !== null && !isNaN(price)) {
              const priceUpsertPayload = {
                price: price,
                market_cap: isNaN(parseFloat(dexData.marketCap)) ? null : parseFloat(dexData.marketCap),
                fdv: isNaN(parseFloat(dexData.fdv)) ? null : parseFloat(dexData.fdv),
                volume_24h: dexData.volume?.h24 !== undefined && dexData.volume.h24 !== null ? parseFloat(dexData.volume.h24) : null,
                liquidity: dexData.liquidity?.usd !== undefined && dexData.liquidity.usd !== null ? parseFloat(dexData.liquidity.usd) : null,
                updated_at: new Date(),
              };
              allDbOperationsInSubBatch.push(prisma.token_prices.upsert({
                where: { token_id: tokenRecord.id },
                update: priceUpsertPayload,
                create: { token_id: tokenRecord.id, ...priceUpsertPayload },
              }));
              pricesUpsertedInSubBatch++;
            }
            if (dexData.socials) {
              for (const [type, url] of Object.entries(dexData.socials)) {
                if (url && typeof url === 'string') {
                  allDbOperationsInSubBatch.push(prisma.token_socials.create({ data: { token_id: tokenRecord.id, type: type.toLowerCase(), url: url } }));
                  socialsCreatedInSubBatch++; 
                }
              }
            }
            if (dexData.websites && Array.isArray(dexData.websites)) {
              dexData.websites.forEach(site => {
                if (site.url && typeof site.url === 'string') {
                  allDbOperationsInSubBatch.push(prisma.token_websites.create({ data: { token_id: tokenRecord.id, label: site.label || 'website', url: site.url } }));
                  websitesCreatedInSubBatch++;
                }
              });
            }
          }
        } // End of sub-batch address loop

        if (allDbOperationsInSubBatch.length > 0) {
            const deleteSocialsOps = processedTokenIdsForSocialsAndWebsitesInSubBatch.length > 0 ? 
                [prisma.token_socials.deleteMany({ where: { token_id: { in: processedTokenIdsForSocialsAndWebsitesInSubBatch } } })] : [];
            const deleteWebsitesOps = processedTokenIdsForSocialsAndWebsitesInSubBatch.length > 0 ? 
                [prisma.token_websites.deleteMany({ where: { token_id: { in: processedTokenIdsForSocialsAndWebsitesInSubBatch } } })] : [];
            
            const finalSubBatchOps = [...deleteSocialsOps, ...deleteWebsitesOps, ...allDbOperationsInSubBatch];
            
            logApi.info(`${formatLog.tag()} Executing DB sub-batch transaction with ${finalSubBatchOps.length} operations for ${tokensProcessedInSubBatch} tokens.`);
            await prisma.$transaction(finalSubBatchOps);
            logApi.info(`${formatLog.tag()} DB sub-batch transaction completed for ${tokensProcessedInSubBatch} tokens.`);

            overallTokensProcessedCount += tokensProcessedInSubBatch;
            overallPricesUpsertedCount += pricesUpsertedInSubBatch;
            overallSocialsCreatedCount += socialsCreatedInSubBatch;
            overallWebsitesCreatedCount += websitesCreatedInSubBatch;
        }
        
        // Add a delay between sub-batch transactions to reduce contention
        if (i + SUB_BATCH_SIZE < addresses.length) { // Don't delay after the very last sub-batch
            logApi.debug(`${formatLog.tag()} Delaying 500ms after DB sub-batch for _refreshMetricsForTokens...`);
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }

      } // End of main sub-batch loop

      if (lastCycleDetailsRef) {
        set(lastCycleDetailsRef, 'dbTokensUpdated', overallTokensProcessedCount);
        set(lastCycleDetailsRef, 'dbPricesUpserted', overallPricesUpsertedCount);
        set(lastCycleDetailsRef, 'dbSocialsUpdated', overallSocialsCreatedCount);
        set(lastCycleDetailsRef, 'dbWebsitesUpdated', overallWebsitesCreatedCount);
      }
      logApi.info(`${formatLog.tag()} Prisma transactions completed successfully for _refreshMetricsForTokens.`);

    } catch (error) {
      logError(logApi, this.name, `Error in _refreshMetricsForTokens: ${error.message}`, { count: addresses.length, firstAddress: addresses[0] });
      if (lastCycleDetailsRef) {
        set(lastCycleDetailsRef, 'errorMessage', `_refreshMetricsForTokens: ${error.message}`);
      }
      throw error; 
    }
  }
  
  getServiceStatus() {
    const baseStatus = super.getServiceStatus();
    
    let nextRunTime = null;
    if (this.isStarted && this.updateTimeoutId && typeof this.updateTimeoutId.ref === 'function') {
        if (!this.isProcessing) {
            try {
              const delayMs = this._calculateDelayToNextSlot();
              nextRunTime = new Date(Date.now() + delayMs).toISOString();
            } catch (e) { nextRunTime = "Error calculating next run"; }
        } else if (this.isProcessing && this.stats.lastCycleDetails?.startTime) {
            nextRunTime = `Currently processing (started at ${this.stats.lastCycleDetails.startTime})`;
        }
    } else if (this.isStarted && !this.updateTimeoutId && !this.isProcessing) {
        nextRunTime = "Scheduler not running, attempting to restart on next health check or manual trigger.";
    }

    return {
      ...baseStatus,
      metrics: {
        ...(baseStatus.metrics || {}), // Ensure baseStatus.metrics exists
        tokenActivationServiceSpecific: {
          isCurrentlyProcessing: this.isProcessing,
          nextScheduledRunAttempt: nextRunTime,
          lastCycleDetails: this.stats.lastCycleDetails || { status: 'not_run_yet', errorMessage: null }
        }
      }
    };
  }

  // Added to satisfy ServiceManager and provide a periodic operation hook
  async onPerformOperation() {
    if (!this.isOperational) {
      logApi.debug(`${formatLog.tag()} Service not operational, skipping operation.`);
      return true;
    }
    try {
      logApi.debug(`${formatLog.tag()} [onPerformOperation] Performing scheduled token status update...`);
      // This is the main periodic task of this service
      await this.updateTokenStatuses(); 
      return true;
    } catch (error) {
      logError(logApi, this.name, 'Error during onPerformOperation (token status update)', error);
      await this.handleError(error); // Let BaseService handle circuit breaker logic
      throw error; // Re-throw to ensure failure is noted by ServiceManager if necessary
    }
  }
}

export default new TokenActivationService(); 
