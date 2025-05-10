// services/solana-engine/jupiter-client.js

/**
 * Jupiter API Client
 * 
 * @description Fetches token addresses from Jupiter, provides price data, and manages token data primarily via the database.
 * @author @BranchManager69
 * @version 2.4.0 // Version updated for full DB-centric refactor
 * @updated 2025-05-12
 */

import axios from 'axios';
import { BaseService } from '../../utils/service-suite/base-service.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceSpecificColors, fancyColors } from '../../utils/colors.js';
import { jupiterConfig } from '../../config/external-api/jupiter-config.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import { createBatchProgress } from '../../utils/logger-suite/batch-progress.js';
import { 
  safe, 
  inc, 
  set, 
  logError, 
  isCircuitOpen,
  safeStats 
} from '../../utils/service-suite/safe-service.js';
import prisma from '../../config/prisma.js';

// Debug flags
const DEBUG_SHOW_BATCH_SAMPLE_TOKENS = false;

// Formatting helpers for consistent logging
const formatLog = {
  tag: () => `${serviceSpecificColors.jupiterClient.tag}[JupiterClient]${fancyColors.RESET}`,
  header: (text) => `${serviceSpecificColors.jupiterClient.header} ${text} ${fancyColors.RESET}`,
  success: (text) => `${serviceSpecificColors.jupiterClient.success}${text}${fancyColors.RESET}`,
  warning: (text) => `${serviceSpecificColors.jupiterClient.warning}${text}${fancyColors.RESET}`,
  error: (text) => `${serviceSpecificColors.jupiterClient.error}${text}${fancyColors.RESET}`,
  info: (text) => `${serviceSpecificColors.jupiterClient.info}${text}${fancyColors.RESET}`,
  highlight: (text) => `${serviceSpecificColors.jupiterClient.highlight}${text}${fancyColors.RESET}`,
  token: (symbol) => `${serviceSpecificColors.jupiterClient.token}${symbol || ''}${fancyColors.RESET}`,
  price: (price) => `${serviceSpecificColors.jupiterClient.price}${price || 0}${fancyColors.RESET}`,
  count: (num) => `${serviceSpecificColors.jupiterClient.count}${Number(num) || 0}${fancyColors.RESET}`,
};

// ------------------------------------------------------------------------------------------------

/**
 * Base class for Jupiter API modules
 */
class JupiterBase {
  constructor(config) {
    this.config = config;
  }

  /**
   * Make a request to Jupiter API
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data (for POST)
   * @param {Object} params - Query parameters (for GET)
   * @returns {Promise<any>} - Response data
   */
  async makeRequest(method, endpoint, data = null, params = null) {
    try {
      const options = {
        method,
        url: endpoint,
        headers: this.config.getHeaders(),
        timeout: 20000 // Increased timeout
      };

      if (data) options.data = data;
      if (params) options.params = params;

      const response = await axios(options);
      
      if (response.status !== 200) {
        throw new Error(`Jupiter API request failed with status ${response.status}`);
      }
      
      if (!response.data) {
        throw new Error('Invalid or empty response from Jupiter API');
      }
      
      return response.data;
    } catch (error) {
      const errorMessage = error.response ? `${error.message} - ${JSON.stringify(error.response.data)}` : error.message;
      logError(logApi, 'JupiterBase', `API Request Failed: ${method} ${endpoint} - ${errorMessage}`, error);
      throw error;
    }
  }
}

// ------------------------------------------------------------------------------------------------

/**
 * Token List service module
 * 
 * @extends JupiterBase
 */
class TokenListService extends JupiterBase {
  constructor(config) {
    super(config);
  }

  async fetchJupiterTokenAddresses() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING ALL TOKEN ADDRESSES')} from Jupiter API`);
      const response = await this.makeRequest('GET', this.config.endpoints.tokens.getTokens);

      let addresses = [];
      if (Array.isArray(response)) addresses = response.map(t => t.address).filter(Boolean);
      else if (response && typeof response === 'object') {
        const dataArray = response.data || response.tokens || response.result;
        if (Array.isArray(dataArray)) addresses = dataArray.map(t => t.address).filter(Boolean);
        else if (Object.keys(response).length > 100 && Object.values(response).every(v => typeof v === 'object' && v.address)) {
          addresses = Object.keys(response);
        }
      }
      
      if (addresses.length === 0 && response) logApi.warn(`${formatLog.tag()} ${formatLog.warning('Could not extract addresses. Sample:')}`, JSON.stringify(response).substring(0, 500));

      logApi.info(`${formatLog.tag()} ${formatLog.success('Fetched')} ${formatLog.count(addresses.length)} token addresses.`);
      return addresses;
    } catch (error) {
      logError(logApi, 'TokenListService', 'fetchJupiterTokenAddresses failed', error);
      throw error;
    }
  }
}

/**
 * Price service module
 * 
 * @extends JupiterBase
 */
class PriceService extends JupiterBase {
  constructor(config) {
    super(config);
    this.priceUpdateCallbacks = [];
    this.isFetchingPrices = false; // Lock managed by JupiterClient
  }

  /**
   * Register a callback function for price updates
   * @param {Function} callback - Function to call when prices are updated
   * @returns {Function} - Function to unregister the callback
   */
  onPriceUpdate(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    
    if (!this.priceUpdateCallbacks) {
      this.priceUpdateCallbacks = [];
    }
    
    this.priceUpdateCallbacks.push(callback);
    logApi.info(`${formatLog.tag()} ${formatLog.success('Registered new price update callback')}`);
    
    return () => {
      this.priceUpdateCallbacks = this.priceUpdateCallbacks.filter(cb => cb !== callback);
      logApi.info(`${formatLog.tag()} ${formatLog.success('Unregistered price update callback')}`);
    };
  }

  /**
   * Notify all registered callbacks about price updates
   * @param {Object} priceData - Price data from Jupiter API
   */
  notifyPriceUpdateCallbacks(priceData) {
    if (!this.priceUpdateCallbacks || this.priceUpdateCallbacks.length === 0) {
      return;
    }
    
    for (const callback of this.priceUpdateCallbacks) {
      try {
        callback(priceData);
      } catch (error) {
        // Use safe error logging
        logError(logApi, 'PriceService', 'Error in price update callback', error);
      }
    }
  }

  /**
   * Get current prices for specified tokens
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Promise<Object>} - Map of token addresses to price data
   */
  async getPrices(mintAddresses) {
    try {
      if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) return {};
      logApi.info(`${formatLog.tag()} ${formatLog.header('PriceService: FETCHING PRICES')} for ${formatLog.count(mintAddresses.length)} tokens`);
      const { maxTokensPerRequest, maxRequestsPerSecond, maxRetries, initialBackoffMs, maxBackoffMs } = this.config.rateLimit;
      const effectiveBatchSize = maxTokensPerRequest || 100;
      const totalBatches = Math.ceil(mintAddresses.length / effectiveBatchSize);
      const MAX_CONCURRENT_REQUESTS = maxRequestsPerSecond || 3;

      const throttleBatches = async (batches) => {
        const allBatchResults = {};
        const progress = createBatchProgress({ name: 'Jupiter Price Batch', total: batches.length, service: SERVICE_NAMES.JUPITER_CLIENT, operation: 'jupiter_price_batches' });
        progress.start();
        for (let i = 0; i < batches.length; i += MAX_CONCURRENT_REQUESTS) {
          const batchChunk = batches.slice(i, i + MAX_CONCURRENT_REQUESTS);
          const chunkPromises = batchChunk.map(async ({ batch, queryString, batchIndex }) => {
            let retries = 0; let currentBackoffMs = initialBackoffMs || 1000; let lastError = null; const batchNum = batchIndex + 1;
            while (retries < (maxRetries || 5)) {
              try {
                if (retries > 0) {
                  let delayForThisRetry = currentBackoffMs;
                  const statusCode = safe(lastError, 'response.status');
                  if (statusCode === 429 && lastError.response && lastError.response.headers && lastError.response.headers['retry-after']) {
                    const retryAfterValue = lastError.response.headers['retry-after'];
                    const retryAfterSeconds = parseInt(retryAfterValue, 10);
                    if (!isNaN(retryAfterSeconds)) delayForThisRetry = Math.max(delayForThisRetry, retryAfterSeconds * 1000);
                  }
                  delayForThisRetry = Math.min(delayForThisRetry, maxBackoffMs || 30000) + (Math.random() * 500);
                  logApi.info(`${formatLog.tag()} Retrying price batch ${batchNum} (attempt ${retries + 1}) after ${delayForThisRetry.toFixed(0)}ms`);
                  await new Promise(resolve => setTimeout(resolve, delayForThisRetry));
                  if (!(statusCode === 429)) currentBackoffMs = Math.min(currentBackoffMs * 2, maxBackoffMs || 30000);
                }
                progress.update(0, [`Prices Batch ${batchNum}/${totalBatches}`]);
                const response = await this.makeRequest('GET', this.config.endpoints.price.getPrices, null, { ids: queryString });
                if (response && response.data && typeof response.data === 'object') {
                  Object.assign(allBatchResults, response.data);
                } else if (response && typeof response === 'object' && Object.keys(response).length > 0 && !response.data) {
                  Object.assign(allBatchResults, response);
                } else {
                  logApi.warn(`${formatLog.tag()} Batch ${batchNum}: No price data in response or unexpected structure. Query: ${queryString}`);
                }
                progress.completeBatch(batchNum, batch.length, [], 0); return { success: true };
              } catch (error) {
                retries++; lastError = error; const statusCode = safe(error, 'response.status');
                if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
                  if (retries >= (maxRetries || 5)) { progress.trackError(batchNum, error, true, statusCode, 'PriceReqFailFinal'); return { success: false, error }; }
                  progress.trackWarning(batchNum, `Price batch attempt ${retries} failed: ${statusCode}`);
                } else { progress.trackError(batchNum, error, true, statusCode, 'PriceReqFailNonRetry'); return { success: false, error }; }
              }
            }
            progress.trackError(batchNum, lastError || new Error('Max retries for price batch'), true); return { success: false, error: lastError };
          });
          await Promise.all(chunkPromises);
          if (i + MAX_CONCURRENT_REQUESTS < batches.length) await new Promise(r => setTimeout(r, 250)); // Inter-chunk delay
        }
        progress.finish(); return allBatchResults;
      };
      const batchesForProcessing = [];
      for (let i = 0; i < mintAddresses.length; i += effectiveBatchSize) batchesForProcessing.push({ batch: mintAddresses.slice(i, i + effectiveBatchSize), queryString: mintAddresses.slice(i, i + effectiveBatchSize).join(','), batchIndex: Math.floor(i/effectiveBatchSize) });
      return await throttleBatches(batchesForProcessing);
    } catch (error) {
      logError(logApi, 'PriceService', 'getPrices main error', error);
      throw error;
    }
  }

  /**
   * Get price history for a token
   * @param {string} mintAddress - Token mint address
   * @param {string} interval - Time interval (e.g., '1d', '7d', '30d')
   * @returns {Promise<Object>} - Price history data
   */
  async getPriceHistory(mintAddress, interval = '7d') {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} price history for token ${formatLog.token(mintAddress)} over ${interval}`);
      
      const response = await this.makeRequest('GET', this.config.endpoints.price.getPriceHistory(mintAddress), null, { interval });
      
      if (!response.data || !response.data[mintAddress]) {
        throw new Error('Invalid response from Jupiter API');
      }
      
      const priceHistory = response.data[mintAddress];
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched price history for')} ${formatLog.token(mintAddress)}`);
      
      return priceHistory;
    } catch (error) {
      logError(logApi, 'PriceService', 'Failed to fetch price history', error);
      throw error;
    }
  }
}

/**
 * Swap service module
 * 
 * @extends JupiterBase
 */
class SwapService extends JupiterBase {
  constructor(config) {
    super(config);
  }

  /**
   * Get a swap quote between two tokens
   * @param {Object} params - Quote parameters (inputMint, outputMint, amount, etc.)
   * @returns {Promise<Object>} - Swap quote details
   */
  async getSwapQuote(params) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} swap quote from ${formatLog.token(params.inputMint)} to ${formatLog.token(params.outputMint)}`);
      
      const response = await this.makeRequest('GET', this.config.endpoints.quote.getQuote, null, params);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched swap quote')} with best price: ${formatLog.price(response.outAmount)}`);
      
      return response;
    } catch (error) {
      logError(logApi, 'SwapService', 'Failed to fetch swap quote', error);
      throw error;
    }
  }
}

/**
 * Jupiter Client for fetching market data and swap quotes
 * 
 * Updated in April 2025 to use Jupiter's new API Gateway:
 * - For paid access with API key: https://api.jup.ag/
 * - For free access (no API key): https://lite-api.jup.ag/
 * 
 * Note: As of May 1, 2025, api.jup.ag will return 401 errors without an API key
 * 
 * @extends BaseService
 */
class JupiterClient extends BaseService {
  constructor() {
    super({
      name: SERVICE_NAMES.JUPITER_CLIENT,
      description: 'Jupiter API client for market data and token address syncing',
      dependencies: [], // Can be empty if truly independent, or add [SERVICE_NAMES.SOLANA_ENGINE] if Helius/ConnectionManager is used by sub-services
      layer: 'DATA',
      criticalLevel: 'MEDIUM',
      circuitBreaker: { 
        enabled: true, 
        failureThreshold: 5, 
        resetTimeoutMs: 30000, 
        healthCheckIntervalMs: 15000, // Added for completeness, BaseService uses it
        description: 'Manages Jupiter API connectivity' 
      }
    });
    
    this.jupiterConfig = jupiterConfig;
    this.tokens = new TokenListService(this.jupiterConfig); // For fetching addresses
    this.prices = new PriceService(this.jupiterConfig);   // For fetching prices
    this.swaps = new SwapService(this.jupiterConfig);     // For swap quotes
    this.dailySyncIntervalId = null; // For managing the internal scheduler
    
    this.stats.customStats = {
      tokens: { 
        db_total: 0, // Will be updated by querying Prisma
      },
      api: { 
        successful: 0, 
        failed: 0, 
        lastRequest: null, 
        lastResponse: null, 
        lastError: null 
      },
      sync: { // New section for sync stats
        last_full_sync_at: null,
        addresses_added_last_full_sync: 0,
        last_daily_sync_at: null,
        addresses_added_last_daily_sync: 0,
        daily_sync_running: false,
        full_sync_running: false // To prevent concurrent full/daily syncs
      }
    };
  }

  /**
   * Initialize the Jupiter client
   */
  async initialize() {
    await super.initialize(); // BaseService handles this.isInitialized = true on success
    
    if (!this.jupiterConfig.apiKey) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Jupiter API key not configured. Market data features may be limited.')}`);
    }
    // Modules are already initialized in constructor
    
    logApi.info(`${formatLog.tag()} ${formatLog.success('Jupiter client core initialized. Starting background token sync tasks...')}`);
    
    // Non-blocking post-startup tasks
    // No await here, let them run in the background
    this._performInitialTokenAddressSync().catch(err => {
      logError(logApi, this.name, 'Background _performInitialTokenAddressSync failed', err);
    });

    this._startDailySyncInterval(); // Start internal scheduler for daily new token checks
    serviceEvents.emit('service:initialized', {
      name: this.name,
      config: this._getSafeConfig(),
      stats: this._getSafeStats()
    });
    
    // this.isInitialized is true if super.initialize() didn't throw
    return true;
  }

  _startDailySyncInterval(intervalHours = 24) {
    if (this.dailySyncIntervalId) {
      logApi.info(`${formatLog.tag()} ${formatLog.info('Daily token sync interval already running.')}`);
      return;
    }
    // Ensure interval is at least 1 hour
    const intervalMs = Math.max(1 * 60 * 60 * 1000, intervalHours * 60 * 60 * 1000);
    logApi.info(`${formatLog.tag()} ${formatLog.info(`Starting daily token sync. Interval: ${intervalMs / (60*60*1000)} hours.`)}`);
    
    this.dailySyncIntervalId = setInterval(async () => {
      if (this.stats.customStats.sync.daily_sync_running || this.stats.customStats.sync.full_sync_running) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('A sync operation is already in progress, skipping scheduled daily sync tick.')}`);
        return;
      }
      set(this.stats.customStats.sync, 'daily_sync_running', true);
      try {
        await this.syncDailyNewTokens({ invokedByScheduler: true }); // Pass flag
      } catch (error) {
        logError(logApi, this.name, 'Error during scheduled daily token sync', error);
      } finally {
        set(this.stats.customStats.sync, 'daily_sync_running', false);
      }
    }, intervalMs);

    // Optionally, run it once relatively soon after startup if DB was not empty 
    // (initial full sync handles the empty DB case)
    setTimeout(async () => {
        if (this.stats.customStats.sync.daily_sync_running || this.stats.customStats.sync.full_sync_running) return;
        const tokenCount = await prisma.tokens.count();
        if (tokenCount > 10000) { // Only run if DB wasn't just freshly populated by full_sync
            set(this.stats.customStats.sync, 'daily_sync_running', true);
            try { 
                logApi.info(`${formatLog.tag()} ${formatLog.info('Running an initial daily-type sync shortly after startup (DB not empty).')}`);
                await this.syncDailyNewTokens({batchSize: 2000, delayMs: 100, invokedByScheduler: false});
            } catch (err) {logError(logApi, this.name, 'Post-startup daily-type sync failed\n', err); } 
            finally {set(this.stats.customStats.sync, 'daily_sync_running', false);};
        }
    }, 2 * 60 * 1000); // e.g., 2 minutes after application start
  }

  _stopDailySyncInterval() {
    if (this.dailySyncIntervalId) {
      clearInterval(this.dailySyncIntervalId);
      this.dailySyncIntervalId = null;
      logApi.info(`${formatLog.tag()} ${formatLog.info('Stopped daily token sync interval.')}`);
    }
  }

  async _performInitialTokenAddressSync() {
    // Prevent multiple full syncs from running if initialize is called again
    if (this.stats.customStats.sync.full_sync_running) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Initial full token sync is already in progress or completed for this startup.')}`);
        return;
    }
    set(this.stats.customStats.sync, 'full_sync_running', true);
    try {
      const tokenCountInDb = await prisma.tokens.count();
      // If DB is empty or has very few tokens, assume it's a first run or needs full bootstrap.
      if (tokenCountInDb < 10000) { // Threshold can be adjusted
        logApi.info(`${formatLog.tag()} ${formatLog.info(`DB has only ${tokenCountInDb} tokens. Performing initial full Jupiter token address sync...`)}`);
        await this.runFullJupiterAddressSync({forceRun: true}); // forceRun to ensure it runs if called here
      } else {
        logApi.info(`${formatLog.tag()} ${formatLog.info(`Sufficient tokens (${tokenCountInDb}) in DB, skipping initial full sync. Daily delta sync will handle new tokens.`)}`);
      }
      set(this.stats.customStats.tokens, 'db_total', await prisma.tokens.count());
    } catch (error) {
      logError(logApi, this.name, '_performInitialTokenAddressSync process failed', error);
    } finally {
        set(this.stats.customStats.sync, 'full_sync_running', false);
    }
  }

  async runFullJupiterAddressSync(options = { batchSize: 5000, delayMs: 250, forceRun: false }) {
    if (this.isCircuitBreakerOpen()) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Circuit breaker is open, skipping full Jupiter address sync.')}`);
      return;
    }
    // Prevent concurrent runs unless forced (e.g. by initial sync logic)
    if (this.stats.customStats.sync.full_sync_running && !options.forceRun) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Full sync was called but is already marked as running and not forced. Skipping.')}`);
        return;
    }
    set(this.stats.customStats.sync, 'full_sync_running', true); // Ensure it's set if forced
    logApi.info(`${formatLog.tag()} ${formatLog.header('STARTING FULL JUPITER TOKEN ADDRESS SYNC')}`);
    let allJupiterAddresses = [];
    let addressesAddedThisSync = 0;
    try {
      allJupiterAddresses = await this.tokens.fetchJupiterTokenAddresses();
      if (!allJupiterAddresses || allJupiterAddresses.length === 0) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('No token addresses returned from Jupiter for full sync.')}`);
        set(this.stats.customStats.sync, 'last_full_sync_at', new Date().toISOString());
        set(this.stats.customStats.sync, 'addresses_added_last_full_sync', 0);
        set(this.stats.customStats.sync, 'full_sync_running', false);
        return;
      }
    } catch (error) {
      logError(logApi, this.name, 'Failed to fetch token addresses from Jupiter for full sync', error);
      await this.handleError(error); // Trigger circuit breaker if applicable
      set(this.stats.customStats.sync, 'full_sync_running', false);
      return;
    }
    const totalAddresses = allJupiterAddresses.length;
    logApi.info(`${formatLog.tag()} ${formatLog.info(`Fetched ${totalAddresses} addresses from Jupiter. Beginning DB sync...`)}`);
    for (let i = 0; i < totalAddresses; i += options.batchSize) {
      const batch = allJupiterAddresses.slice(i, i + options.batchSize);
      try {
        const createData = batch.map(address => ({
          address: address,
          is_active: false, // Default
          first_seen_on_jupiter_at: new Date(),
          // last_jupiter_sync_at will be set by @updatedAt on prisma model
        }));
        const result = await prisma.tokens.createMany({
          data: createData,
          skipDuplicates: true,
        });
        addressesAddedThisSync += result.count;
        logApi.info(`${formatLog.tag()} ${formatLog.info(`Full Sync Batch ${Math.floor(i / options.batchSize) + 1}/${Math.ceil(totalAddresses / options.batchSize)}. Added ${result.count} new tokens this batch. Processed up to ${Math.min(i + options.batchSize, totalAddresses)}/${totalAddresses} addresses.`)}`);
      } catch (dbError) {
        logError(logApi, this.name, `DB error syncing Jupiter address batch ${Math.floor(i / options.batchSize) + 1}`, dbError);
        // Decide if you want to stop or continue on batch errors. For full sync, usually continue.
      }
      if (options.delayMs > 0 && (i + options.batchSize < totalAddresses)) {
        await new Promise(resolve => setTimeout(resolve, options.delayMs));
      }
    }
    set(this.stats.customStats.sync, 'last_full_sync_at', new Date().toISOString());
    set(this.stats.customStats.sync, 'addresses_added_last_full_sync', addressesAddedThisSync);
    set(this.stats.customStats.tokens, 'db_total', await prisma.tokens.count());
    set(this.stats.customStats.sync, 'full_sync_running', false);
    logApi.info(`${formatLog.tag()} ${formatLog.success(`FULL JUPITER TOKEN ADDRESS SYNC COMPLETED. Added ${addressesAddedThisSync} new unique addresses to DB.`)}`);
  }

  async syncDailyNewTokens(options = { batchSize: 5000, delayMs: 250, invokedByScheduler: false }) {
    if (this.isCircuitBreakerOpen()) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Circuit breaker open, skipping daily new token sync.')}`);
      return;
    }
    // Prevent overlap if called by scheduler vs manually/startup
    if (this.stats.customStats.sync.daily_sync_running && options.invokedByScheduler) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Daily sync (scheduled) is already running, skipping this tick.')}`);
        return;
    } else if (this.stats.customStats.sync.daily_sync_running && !options.invokedByScheduler) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Daily sync (manual/startup) called while already running. Proceeding with caution.')}`);
        // Allow it to run if manually triggered, but be aware of potential overlap if interval is very short
    }
    set(this.stats.customStats.sync, 'daily_sync_running', true);
    logApi.info(`${formatLog.tag()} ${formatLog.header('STARTING DAILY NEW TOKEN SYNC FROM JUPITER')}`);
    let currentJupiterAddresses = [];
    let addressesAddedThisSync = 0;
    try {
      currentJupiterAddresses = await this.tokens.fetchJupiterTokenAddresses();
      if (!currentJupiterAddresses || currentJupiterAddresses.length === 0) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('No token addresses returned from Jupiter for daily sync.')}`);
        set(this.stats.customStats.sync, 'last_daily_sync_at', new Date().toISOString()); 
        set(this.stats.customStats.sync, 'addresses_added_last_daily_sync', 0); 
        set(this.stats.customStats.sync, 'daily_sync_running', false);
        return;
      }
    } catch (error) {
      logError(logApi, this.name, 'Failed to fetch token addresses from Jupiter for daily sync', error);
      await this.handleError(error); // Notify circuit breaker
      set(this.stats.customStats.sync, 'daily_sync_running', false);
      return;
    }
    
    logApi.info(`${formatLog.tag()} ${formatLog.info(`Fetched ${currentJupiterAddresses.length} current addresses from Jupiter. Comparing with DB...`)}`);
    const existingDbAddresses = new Set(
      (await prisma.tokens.findMany({ select: { address: true }, orderBy: {id: 'asc'} })).map(t => t.address)
    ); // Added orderBy for minor potential DB optimization during large reads
    logApi.info(`${formatLog.tag()} ${formatLog.info(`Found ${existingDbAddresses.size} addresses in local DB.`)}`);
    const newAddresses = currentJupiterAddresses.filter(addr => !existingDbAddresses.has(addr));
    if (newAddresses.length === 0) {
      logApi.info(`${formatLog.tag()} ${formatLog.success('No new token addresses found from Jupiter today.')}`);
    } else {
      logApi.info(`${formatLog.tag()} ${formatLog.info(`Found ${newAddresses.length} new token addresses to add.`)}`);
      for (let i = 0; i < newAddresses.length; i += options.batchSize) {
        const batch = newAddresses.slice(i, i + options.batchSize);
        try {
          const createData = batch.map(address => ({
            address: address,
            is_active: false,
            first_seen_on_jupiter_at: new Date(),
          }));
          const result = await prisma.tokens.createMany({
            data: createData,
            skipDuplicates: true, // Technically redundant due to pre-filter, but safe
          });
          addressesAddedThisSync += result.count;
          logApi.info(`${formatLog.tag()} ${formatLog.info(`Daily Sync Batch ${Math.floor(i / options.batchSize) + 1}/${Math.ceil(newAddresses.length / options.batchSize)}. Added ${result.count} new. Total new this sync: ${addressesAddedThisSync}`)}`);
        } catch (dbError) {
          logError(logApi, this.name, `DB error adding new Jupiter address batch ${Math.floor(i / options.batchSize) + 1}`, dbError);
        }
        if (options.delayMs > 0 && (i + options.batchSize < newAddresses.length)) {
          await new Promise(resolve => setTimeout(resolve, options.delayMs));
        }
      }
    }
    set(this.stats.customStats.sync, 'last_daily_sync_at', new Date().toISOString());
    set(this.stats.customStats.sync, 'addresses_added_last_daily_sync', addressesAddedThisSync);
    set(this.stats.customStats.tokens, 'db_total', await prisma.tokens.count());
    set(this.stats.customStats.sync, 'daily_sync_running', false);
    logApi.info(`${formatLog.tag()} ${formatLog.success(`DAILY NEW TOKEN SYNC COMPLETED. Added ${addressesAddedThisSync} new unique addresses to DB.`)}`);
  }
  
  async performOperation() { // Heartbeat / Health check for BaseService
    try {
      if (this.isCircuitBreakerOpen()) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Circuit breaker open, skipping Jupiter health check.')}`);
        return; // Return void, not false, to prevent BaseService misinterpreting this during CB open state
      }
      // Light-weight check: fetch price for a known, common token like SOL
      const SOL_ADDRESS = 'So11111111111111111111111111111111111111112'; // Wrapped SOL address
      await this.getPrices([SOL_ADDRESS]); // getPrices now handles its own internal lock for PriceService
      
      inc(this.stats.customStats.api, 'successful');
      set(this.stats.customStats.api, 'lastError', null); // Clear last error on success
      // lastRequest/Response are implicitly covered by successful makeRequest calls within getPrices
      
      await this.recordSuccess(); // For BaseService circuit breaker
      // serviceEvents.emit('service:heartbeat', { name: this.name, /* ... */ }); // BaseService might do this already
      return true; // Indicate success for BaseService
    } catch (error) {
      inc(this.stats.customStats.api, 'failed');
      set(this.stats.customStats.api, 'lastError', error.message);
      await this.handleError(error); // For BaseService circuit breaker (records failure)
      return false; // Indicate failure for BaseService
    }
  }
  
  async stop() {
    this._stopDailySyncInterval();
    await super.stop();
    logApi.info(`${formatLog.tag()} ${formatLog.success('Jupiter client stopped.')}`);
    return true;
  }

  // Public Methods (Proxies or direct calls)
  onPriceUpdate(callback) { return this.prices.onPriceUpdate(callback); }
  subscribeToPrices(mintAddresses) { logApi.info('JupiterClient.subscribeToPrices called, but direct subscriptions are deprecated. Token activity drives price fetching.'); return true; }
  unsubscribeFromPrices(mintAddresses) { logApi.info('JupiterClient.unsubscribeFromPrices called, direct unsubscriptions deprecated.'); return true; }

  async getPrices(mintAddresses) {
    if (this.isCircuitBreakerOpen()) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Circuit breaker is open, cannot fetch prices.')}`);
      throw new Error('JupiterClient: Circuit breaker is open');
    }
    if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) return {};

    // PriceService.getPrices has its own internal isFetchingPrices lock, no need to duplicate here.
    // However, JupiterClient itself might want a higher-level lock if multiple parts of the app call its getPrices concurrently.
    // For now, assuming PriceService lock is sufficient or calls are not heavily concurrent at this client level.
    try {
      const result = await this.prices.getPrices(mintAddresses);
      this.prices.notifyPriceUpdateCallbacks(result); // Notify any direct listeners
      inc(this.stats.customStats.api, 'successful');
      set(this.stats.customStats.api, 'lastRequest', new Date().toISOString());
      set(this.stats.customStats.api, 'lastResponse', new Date().toISOString());
      return result;
    } catch (error) {
      inc(this.stats.customStats.api, 'failed');
      set(this.stats.customStats.api, 'lastError', error.message);
      await this.handleError(error);
      throw error;
    }
  }

  async getPriceHistory(mintAddress, interval = '7d') {
    if (this.isCircuitBreakerOpen()) throw new Error('JupiterClient: Circuit breaker open.');
    try {
      const result = await this.prices.getPriceHistory(mintAddress, interval);
      inc(this.stats.customStats.api, 'successful'); /* ... other stats ... */ return result;
    } catch (error) { inc(this.stats.customStats.api, 'failed'); /* ... other stats ... */ await this.handleError(error); throw error; }
  }

  async getSwapQuote(params) {
    if (this.isCircuitBreakerOpen()) throw new Error('JupiterClient: Circuit breaker open.');
    try {
      const result = await this.swaps.getSwapQuote(params);
      inc(this.stats.customStats.api, 'successful'); /* ... other stats ... */ return result;
    } catch (error) { inc(this.stats.customStats.api, 'failed'); /* ... other stats ... */ await this.handleError(error); throw error; }
  }
}

// ------------------------------------------------------------------------------------------------

let _instance = null;

export function getJupiterClient() {
  if (!_instance) _instance = new JupiterClient();
  return _instance;
}

export const jupiterClient = getJupiterClient();
export default jupiterClient;

function chunk(array, size) { const chunks = []; for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size)); return chunks; }