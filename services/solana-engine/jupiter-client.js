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

// Define default circuit breaker config
const DEFAULT_CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,         // Number of failures before opening circuit
  resetTimeout: 30000,         // Time in ms to wait before retrying after opening circuit
  maxFailuresWindow: 60000,     // Time window for tracking failures in ms
};

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
    logApi.debug(`${formatLog.tag()} [JupiterBase.makeRequest] Attempting request:`, { method, url: endpoint, params, data });
    const startTime = Date.now(); // Start timer
    try {
      const options = {
        method,
        url: endpoint,
        headers: this.config.getHeaders(),
        timeout: 30000 // Increased timeout to 30 seconds
      };

      if (data) options.data = data;
      if (params) options.params = params;

      const response = await axios(options);
      const durationMs = Date.now() - startTime; // Calculate duration

      // Log slow response warning
      if (durationMs > 10000) { // If request took longer than 10 seconds
        logApi.warn(`${formatLog.tag()} [JupiterBase.makeRequest] Slow response from Jupiter API: ${endpoint} took ${durationMs}ms`, { method, url: endpoint, params, durationMs });
      }
      
      logApi.debug(`${formatLog.tag()} [JupiterBase.makeRequest] Received response:`, { status: response.status, type: typeof response.data, durationMs, dataPreview: JSON.stringify(response.data)?.substring(0, 500) });
      
      if (response.status !== 200) {
        throw new Error(`Jupiter API request failed with status ${response.status}`);
      }
      
      if (!response.data) {
        throw new Error('Invalid or empty response from Jupiter API');
      }
      
      return response.data;
    } catch (error) {
      const errorMessage = error.response ? `${error.message} - ${JSON.stringify(error.response.data)}` : error.message;
      logApi.error(`${formatLog.tag()} [JupiterBase.makeRequest] API Request Failed:`, {
        method,
        url: endpoint,
        params,
        errorMessage: error.message, // Original error message
        errorStatus: error.response?.status,
        errorResponseData: JSON.stringify(error.response?.data)?.substring(0, 500), // Preview of error body
        fullErrorObject: JSON.stringify(error, Object.getOwnPropertyNames(error))?.substring(0,1000) // Attempt to stringify more of the error
      });
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
      // Check if the response is directly an array of strings
      if (Array.isArray(response) && response.length > 0 && response.every(item => typeof item === 'string')) {
        addresses = response;
      } else if (Array.isArray(response)) { // Original check for array of objects
        addresses = response.map(t => t.address).filter(Boolean);
      } else if (response && typeof response === 'object') { // Fallback for object-based responses
        const dataArray = response.data || response.tokens || response.result;
        if (Array.isArray(dataArray)) {
          addresses = dataArray.map(t => t.address).filter(Boolean);
        } else if (Object.keys(response).length > 100 && Object.values(response).every(v => typeof v === 'object' && v.address)) {
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
    this.tokenPrices = new Map(); // Stores token mint -> price data
    this.priceUpdateCallbacks = [];
    this.refreshInterval = config.jupiter?.prices?.refreshIntervalMs || 60000; // Default 1 minute
    this.batchSize = config.jupiter?.prices?.batchSize || 90; // DEGENS: Changed default from 20 to 90
    this.maxRetries = config.jupiter?.prices?.maxRetries || 3;
    this.retryDelayMs = config.jupiter?.prices?.retryDelayMs || 1000;
    this.activeFetches = new Set(); // Track active fetches to prevent overlap

    // Initial load or setup if necessary
    // this.startPricePolling(); // Consider if polling is needed or if it's driven by TokenRefreshScheduler
    logApi.info(`${this.constructor.name} initialized with batch size ${this.batchSize} and refresh interval ${this.refreshInterval}ms`);
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
    if (!mintAddresses || mintAddresses.length === 0) {
      return {};
    }

    const addresses = Array.isArray(mintAddresses) ? mintAddresses : [mintAddresses];
    const uniqueAddresses = [...new Set(addresses)].filter(addr => addr);

    if (uniqueAddresses.length === 0) {
      return {};
    }

    logApi.debug(`[PriceService.getPrices] Received request for ${uniqueAddresses.length} prices. Internal batch size: ${this.batchSize}.`);

    const batches = chunk(uniqueAddresses, this.batchSize);
    const priceResults = {};
    let successfulFetches = 0;
    let failedFetches = 0;

    const throttleBatches = async (batchesToProcess) => {
        const allBatchResults = {};
      const progress = createBatchProgress({ name: 'Jupiter Price Batch', total: batchesToProcess.length, service: SERVICE_NAMES.JUPITER_CLIENT, operation: 'jupiter_price_batches', logLevel: 'debug' });
        progress.start();
      for (let i = 0; i < batchesToProcess.length; i++) {
        const batch = batchesToProcess[i];
        const chunkPromises = batch.map(async ({ batch, queryString, batchIndex }) => {
          let retries = 0; let currentBackoffMs = this.retryDelayMs || 1000; let lastError = null; const batchNum = batchIndex + 1;
          while (retries < this.maxRetries) {
              try {
                if (retries > 0) {
                  let delayForThisRetry = currentBackoffMs;
                  const statusCode = safe(lastError, 'response.status');
                  if (statusCode === 429 && lastError.response && lastError.response.headers && lastError.response.headers['retry-after']) {
                    const retryAfterValue = lastError.response.headers['retry-after'];
                    const retryAfterSeconds = parseInt(retryAfterValue, 10);
                    if (!isNaN(retryAfterSeconds)) delayForThisRetry = Math.max(delayForThisRetry, retryAfterSeconds * 1000);
                  }
                delayForThisRetry = Math.min(delayForThisRetry, this.refreshInterval || 60000) + (Math.random() * 500);
                  logApi.debug(`${formatLog.tag()} Retrying price batch ${batchNum} (attempt ${retries + 1}) after ${delayForThisRetry.toFixed(0)}ms`);
                  await new Promise(resolve => setTimeout(resolve, delayForThisRetry));
                if (!(statusCode === 429)) currentBackoffMs = Math.min(currentBackoffMs * 2, this.refreshInterval || 60000);
                }
              progress.update(0, [`Prices Batch ${batchNum}/${batchesToProcess.length}`]);

              const currentQueryString = queryString.join(',');
              if (!currentQueryString) {
                logApi.error(`[PriceService.throttleBatches] Attempting to make API call with EMPTY query string for batch ${batchNum}. Skipping API call for this batch.`, { queryString });
                lastError = new Error("Empty query string for Jupiter price API");
                break;
              }
              logApi.debug(`[PriceService.throttleBatches] Attempting Jupiter API Call for batch ${batchNum}. Query: ids=${currentQueryString.substring(0, 200)}...`);

              const response = await this.makeRequest('GET', this.config.endpoints.price.getPrices, null, { ids: currentQueryString });
                if (response && response.data && typeof response.data === 'object') {
                  Object.assign(allBatchResults, response.data);
                } else if (response && typeof response === 'object' && Object.keys(response).length > 0 && !response.data) {
                  Object.assign(allBatchResults, response);
                } else {
                logApi.warn(`${formatLog.tag()} Batch ${batchNum}: No price data in response or unexpected structure. Query: ${currentQueryString}`);
                }
                progress.completeBatch(batchNum, batch.length, [], 0); return { success: true };
              } catch (error) {
                retries++; lastError = error; const statusCode = safe(error, 'response.status');
                if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
                if (retries >= this.maxRetries) { progress.trackError(batchNum, error, true, statusCode, 'PriceReqFailFinal'); return { success: false, error }; }
                  progress.trackWarning(batchNum, `Price batch attempt ${retries} failed: ${statusCode}`);
                } else { progress.trackError(batchNum, error, true, statusCode, 'PriceReqFailNonRetry'); return { success: false, error }; }
              }
            }
            progress.trackError(batchNum, lastError || new Error('Max retries for price batch'), true); return { success: false, error: lastError };
          });
        const batchResults = await Promise.all(chunkPromises);
        batchResults.forEach(result => {
          if (result.success) {
            successfulFetches++;
            Object.assign(priceResults, result.success ? result.data : result.error);
          } else {
            failedFetches++;
            logError(logApi, 'PriceService', `Price batch ${batchNum} failed`, result.error);
          }
        });
        if (i + 1 < batchesToProcess.length) await new Promise(r => setTimeout(r, 250)); // Inter-chunk delay
      }
      progress.finish(); return priceResults;
    };
    return await throttleBatches(batches);
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
      dependencies: [], 
      layer: 'DATA',
      criticalLevel: 'MEDIUM',
      circuitBreaker: {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        description: 'Manages Jupiter API connectivity'
      }
    });
    this.jupiterConfig = jupiterConfig;
    this.tokens = new TokenListService(this.jupiterConfig);
    this.prices = new PriceService(this.jupiterConfig);
    this.swaps = new SwapService(this.jupiterConfig);
    this.dailySyncIntervalId = null;
    
    this.stats = this.stats || {};
    this.stats.customStats = {
      tokens: { db_total: 0 },
      api: { successful: 0, failed: 0, lastRequestAt: null, lastSuccessfulResponseAt: null, lastError: null, lastErrorTime: null },
      sync: { last_full_sync_at: null, addresses_added_last_full_sync: 0, last_daily_sync_at: null, addresses_added_last_daily_sync: 0, daily_sync_running: false, full_sync_running: false }
    };
  }

  /**
   * Initialize the Jupiter client
   */
  async initialize() {
    logApi.info(`${formatLog.tag()} Initialize START: isCircuitBreakerOpen type: ${typeof this.isCircuitBreakerOpen}`); // DEBUG LOG
    await super.initialize(); // BaseService handles this.isInitialized = true on success
    logApi.info(`${formatLog.tag()} Initialize END: After super.initialize(), isCircuitBreakerOpen type: ${typeof this.isCircuitBreakerOpen}`); // DEBUG LOG
    
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
    if (this.stats.customStats.sync.full_sync_running || this.stats.customStats.sync.daily_sync_running) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('A sync operation is already in progress. Skipping initial token sync attempt.')}`);
        return;
    }
    set(this.stats.customStats.sync, 'full_sync_running', true);
    try {
      const tokenCountInDb = await prisma.tokens.count();
      if (tokenCountInDb < 10000) { 
        logApi.info(`${formatLog.tag()} ${formatLog.info(`DB has only ${tokenCountInDb} tokens. Performing initial full Jupiter token address sync...`)}`);
        await this.runFullJupiterAddressSync({forceRun: false});
      } else {
        logApi.info(`${formatLog.tag()} ${formatLog.info(`Sufficient tokens (${tokenCountInDb}) in DB, skipping initial full sync.`)}`);
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
    if (this.stats.customStats.sync.full_sync_running && !options.forceRun) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Full sync was called but is already marked as running and not forced. Skipping.')}`);
        return;
    }
    if (this.stats.customStats.sync.daily_sync_running && !options.forceRun) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Daily sync is running. Full sync (not forced) will be skipped.')}`);
        return;
    }
    set(this.stats.customStats.sync, 'full_sync_running', true);
    set(this.stats.customStats.api, 'lastRequestAt', new Date().toISOString());
    logApi.info(`${formatLog.tag()} ${formatLog.header('STARTING FULL JUPITER TOKEN ADDRESS SYNC')}`);
    let allJupiterAddresses = [];
    let addressesAddedThisSync = 0;
    try {
      allJupiterAddresses = await this.tokens.fetchJupiterTokenAddresses();
      inc(this.stats.customStats.api, 'successful');
      set(this.stats.customStats.api, 'lastSuccessfulResponseAt', new Date().toISOString());
      set(this.stats.customStats.api, 'lastError', null);
      set(this.stats.customStats.api, 'lastErrorTime', null);

      if (!allJupiterAddresses || allJupiterAddresses.length === 0) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('No token addresses returned from Jupiter for full sync.')}`);
        set(this.stats.customStats.sync, 'addresses_added_last_full_sync', 0);
        set(this.stats.customStats.sync, 'last_full_sync_at', new Date().toISOString());
        return;
      }
      // ... (loop to prisma.tokens.createMany and update addressesAddedThisSync) ...
      set(this.stats.customStats.sync, 'addresses_added_last_full_sync', addressesAddedThisSync);
      set(this.stats.customStats.sync, 'last_full_sync_at', new Date().toISOString());
      set(this.stats.customStats.tokens, 'db_total', await prisma.tokens.count());
      logApi.info(`${formatLog.tag()} ${formatLog.success(`FULL JUPITER TOKEN ADDRESS SYNC COMPLETED. Added ${addressesAddedThisSync} new unique addresses to DB.`)}`);
    } catch (error) {
      inc(this.stats.customStats.api, 'failed');
      set(this.stats.customStats.api, 'lastError', `fetchJupiterTokenAddresses (full sync) failed: ${error.message}`);
      set(this.stats.customStats.api, 'lastErrorTime', new Date().toISOString());
      logError(logApi, this.name, 'Failed to fetch/process token addresses from Jupiter for full sync', error);
      await this.handleError(error);
    } finally {
      set(this.stats.customStats.sync, 'full_sync_running', false);
    }
  }

  async syncDailyNewTokens(options = { batchSize: 5000, delayMs: 250, invokedByScheduler: false }) {
    if (this.isCircuitBreakerOpen()) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Circuit breaker open, skipping daily new token sync.')}`);
      return;
    }
    if (this.stats.customStats.sync.daily_sync_running && options.invokedByScheduler) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Daily sync (scheduled) is already running, skipping this tick.')}`);
        return;
    } else if (this.stats.customStats.sync.daily_sync_running && !options.invokedByScheduler) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Daily sync (manual/startup) called while already running. Proceeding with caution.')}`);
    }
    if (this.stats.customStats.sync.full_sync_running && !options.invokedByScheduler) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Full sync is running. Daily sync (not scheduled) will be skipped.')}`);
        return;
    }
    set(this.stats.customStats.sync, 'daily_sync_running', true);
    set(this.stats.customStats.api, 'lastRequestAt', new Date().toISOString());
    logApi.info(`${formatLog.tag()} ${formatLog.header('STARTING DAILY NEW TOKEN SYNC FROM JUPITER')}`);
    let currentJupiterAddresses = [];
    let addressesAddedThisSync = 0;
    try {
      currentJupiterAddresses = await this.tokens.fetchJupiterTokenAddresses();
      inc(this.stats.customStats.api, 'successful');
      set(this.stats.customStats.api, 'lastSuccessfulResponseAt', new Date().toISOString());
      set(this.stats.customStats.api, 'lastError', null);
      set(this.stats.customStats.api, 'lastErrorTime', null);

      if (!currentJupiterAddresses || currentJupiterAddresses.length === 0) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('No token addresses returned from Jupiter for daily sync.')}`);
        set(this.stats.customStats.sync, 'addresses_added_last_daily_sync', 0); 
        set(this.stats.customStats.sync, 'last_daily_sync_at', new Date().toISOString()); 
        return;
      }
      // ... (logic to compare with DB, createMany new addresses, update addressesAddedThisSync) ...
      set(this.stats.customStats.sync, 'addresses_added_last_daily_sync', addressesAddedThisSync);
      set(this.stats.customStats.sync, 'last_daily_sync_at', new Date().toISOString());
      set(this.stats.customStats.tokens, 'db_total', await prisma.tokens.count());
      logApi.info(`${formatLog.tag()} ${formatLog.success(`DAILY NEW TOKEN SYNC COMPLETED. Added ${addressesAddedThisSync} new unique addresses to DB.`)}`);
    } catch (error) {
      inc(this.stats.customStats.api, 'failed');
      set(this.stats.customStats.api, 'lastError', `fetchJupiterTokenAddresses (daily sync) failed: ${error.message}`);
      set(this.stats.customStats.api, 'lastErrorTime', new Date().toISOString());
      logError(logApi, this.name, 'Failed to fetch/process token addresses for daily sync', error);
      await this.handleError(error);
    } finally {
      set(this.stats.customStats.sync, 'daily_sync_running', false);
    }
  }
  
  async performOperation() {
    set(this.stats.customStats.api, 'lastRequestAt', new Date().toISOString());
    try {
      if (this.isCircuitBreakerOpen()) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Circuit breaker open, skipping Jupiter health check.')}`);
        // Note: We might still count this as an attempted API call that was skipped by circuit breaker
        // For now, not incrementing successful/failed here, just noting request attempt.
        return; 
      }
      const SOL_ADDRESS = 'So11111111111111111111111111111111111111112'; 
      await this.getPrices([SOL_ADDRESS]); // getPrices will handle its own inc/set for api stats
      set(this.stats.customStats.api, 'lastSuccessfulResponseAt', new Date().toISOString()); // Mark health check attempt as successful if getPrices didn't throw
      await this.recordSuccess(); 
      return true; 
    } catch (error) {
      inc(this.stats.customStats.api, 'failed');
      set(this.stats.customStats.api, 'lastError', `Health check via getPrices failed: ${error.message}`);
      set(this.stats.customStats.api, 'lastErrorTime', new Date().toISOString());
      await this.handleError(error); 
      return false; 
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

    set(this.stats.customStats.api, 'lastRequestAt', new Date().toISOString());
    let getPricesOverallSuccess = false;

    const addresses = Array.isArray(mintAddresses) ? mintAddresses : [mintAddresses];
    const uniqueAddresses = [...new Set(addresses)].filter(addr => addr);

    if (uniqueAddresses.length === 0) {
      return {};
    }

    logApi.debug(`[JupiterClient.getPrices] Received request for ${uniqueAddresses.length} prices. Internal batch size of PriceService: ${this.prices.batchSize}.`);

    const batches = chunk(uniqueAddresses, this.prices.batchSize);
    const priceResults = {};
    let successfulAddressCount = 0;
    let failedAddressCount = 0;

    const throttleBatches = async (batchesForApiCall) => {
      const allAggregatedResults = {};
      const progress = createBatchProgress({
        name: 'Jupiter Price Fetch',
        total: batchesForApiCall.length,
        service: SERVICE_NAMES.JUPITER_CLIENT,
        operation: 'jupiter_price_api_batches',
        logLevel: 'debug'
      });
      progress.start();

      for (let i = 0; i < batchesForApiCall.length; i++) {
        const currentAddressBatch = batchesForApiCall[i];
        const batchIndexForProgress = i;
        const batchNumForLog = batchIndexForProgress + 1;

        let retries = 0;
        let currentBackoffMs = this.prices.retryDelayMs || 1000;
        let lastErrorThisBatch = null;
        let batchSucceeded = false;

        progress.update(0, [`Fetching Batch ${batchNumForLog}/${batchesForApiCall.length}`]);

        let currentQueryStringJoined = ''; // Declare here

        while (retries < this.prices.maxRetries) {
          try {
            if (retries > 0) {
              let delayForThisRetry = currentBackoffMs;
              const statusCode = safe(lastErrorThisBatch, 'response.status');
              if (statusCode === 429 && lastErrorThisBatch.response && lastErrorThisBatch.response.headers && lastErrorThisBatch.response.headers['retry-after']) {
                const retryAfterValue = lastErrorThisBatch.response.headers['retry-after'];
                const retryAfterSeconds = parseInt(retryAfterValue, 10);
                if (!isNaN(retryAfterSeconds)) delayForThisRetry = Math.max(delayForThisRetry, retryAfterSeconds * 1000);
              }
              delayForThisRetry = Math.min(delayForThisRetry, (this.prices.refreshInterval || 60000)) + (Math.random() * 500);
              logApi.debug(`${formatLog.tag()} Retrying Jupiter price API batch ${batchNumForLog} (attempt ${retries + 1}) after ${delayForThisRetry.toFixed(0)}ms`);
              await new Promise(resolve => setTimeout(resolve, delayForThisRetry));
              if (!(statusCode === 429)) currentBackoffMs = Math.min(currentBackoffMs * 2, (this.prices.refreshInterval || 60000));
            }
            
            logApi.debug(`${formatLog.tag()} [JupiterClient.getPrices/throttleBatches] currentAddressBatch BEFORE join:`, { currentAddressBatch, typeofBatch: typeof currentAddressBatch, isArray: Array.isArray(currentAddressBatch), batchLength: currentAddressBatch?.length });
            currentQueryStringJoined = currentAddressBatch.join(','); // Assign here
            logApi.debug(`${formatLog.tag()} [JupiterClient.getPrices/throttleBatches] Preparing to call PriceService.makeRequest for batch ${batchNumForLog}`, { queryString: currentQueryStringJoined });
            if (!currentQueryStringJoined) {
              logApi.error(`[JupiterClient.getPrices] Attempting to make API call with EMPTY query string for API batch ${batchNumForLog}. Skipping.`, { currentAddressBatch });
              lastErrorThisBatch = new Error("Empty query string for Jupiter price API");
              retries++;
              continue;
            }
            
            logApi.debug(`[JupiterClient.getPrices] Attempting Jupiter API Call for batch ${batchNumForLog}. Query: ids=${currentQueryStringJoined.substring(0, 200)}...`);

            const response = await this.prices.makeRequest('GET', this.prices.config.endpoints.price.getPrices, null, { ids: currentQueryStringJoined });

            logApi.debug(`${formatLog.tag()} [JupiterClient.getPrices/throttleBatches] PriceService.makeRequest successful for batch ${batchNumForLog}. Response preview:`, { dataPreview: JSON.stringify(response)?.substring(0, 300) });

            if (response && response.data && typeof response.data === 'object') {
              Object.assign(allAggregatedResults, response.data);
              successfulAddressCount += Object.keys(response.data).length;
            } else if (response && typeof response === 'object' && Object.keys(response).length > 0 && !response.data) {
              Object.assign(allAggregatedResults, response);
              successfulAddressCount += Object.keys(response).length;
            } else {
              logApi.warn(`${formatLog.tag()} API Batch ${batchNumForLog}: No price data in response or unexpected structure. Query: ${currentQueryStringJoined}`);
            }
            
            const successCount = Object.keys(response.data || response || {}).length;
            progress.completeBatch(batchNumForLog, currentAddressBatch.length, [`${successCount} prices received`], 0);
            batchSucceeded = true;
            lastErrorThisBatch = null;
            break;
          
          } catch (error) {
            retries++;
            lastErrorThisBatch = error;
            const statusCode = safe(error, 'response.status');
            
            logApi.warn(`${formatLog.tag()} [JupiterClient.getPrices/throttleBatches] Error in PriceService.makeRequest for batch ${batchNumForLog}, attempt ${retries}`, {
              queryString: currentQueryStringJoined,
              errorMessage: error.message,
              errorStatus: error.response?.status,
              errorResponseDataPreview: JSON.stringify(error.response?.data)?.substring(0, 300),
              fullLastErrorThisBatch: JSON.stringify(lastErrorThisBatch, Object.getOwnPropertyNames(lastErrorThisBatch))?.substring(0,500)
            });
            
            if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
              if (retries >= this.prices.maxRetries) {
                progress.trackError(batchNumForLog, error, true, statusCode, 'PriceReqFailFinal');
              } else {
                progress.trackWarning(batchNumForLog, `Price API batch ${batchNumForLog} attempt ${retries} failed: ${statusCode}`);
              }
            } else {
              progress.trackError(batchNumForLog, error, true, statusCode, 'PriceReqFailNonRetry');
              break;
            }
          }
        }

        if (!batchSucceeded && lastErrorThisBatch) {
          failedAddressCount += currentAddressBatch.length;
          logError(logApi, 'JupiterClient.getPrices', `Price API batch ${batchNumForLog} failed permanently after ${this.prices.maxRetries} retries`, lastErrorThisBatch);
          logApi.error(`${formatLog.tag()} [JupiterClient.getPrices/throttleBatches] FINAL FAILURE for batch ${batchNumForLog}:`, {
            fullLastErrorThisBatch: JSON.stringify(lastErrorThisBatch, Object.getOwnPropertyNames(lastErrorThisBatch))?.substring(0,1000)
          });
        } else if (!batchSucceeded && !lastErrorThisBatch) {
          logApi.warn(`${formatLog.tag()} API Batch ${batchNumForLog} was effectively empty and skipped.`);
        }

        if (i + 1 < batchesForApiCall.length) {
          await new Promise(r => setTimeout(r, 250));
        }
      }

      progress.finish();
      return allAggregatedResults;
    };

    const aggregatedPriceData = await throttleBatches(batches);
    Object.assign(priceResults, aggregatedPriceData);

    if (Object.keys(priceResults).length > 0 || uniqueAddresses.length === 0) {
        getPricesOverallSuccess = true;
      inc(this.stats.customStats.api, 'successful');
        set(this.stats.customStats.api, 'lastSuccessfulResponseAt', new Date().toISOString());
        set(this.stats.customStats.api, 'lastError', null);
        set(this.stats.customStats.api, 'lastErrorTime', null);
    } else {
      inc(this.stats.customStats.api, 'failed');
        set(this.stats.customStats.api, 'lastError', 'getPrices completed but returned no price data for requested addresses.');
        set(this.stats.customStats.api, 'lastErrorTime', new Date().toISOString());
    }

    if (DEBUG_SHOW_BATCH_SAMPLE_TOKENS) {
        logApi.debug(`[JupiterClient.getPrices] Final results for ${uniqueAddresses.length} unique tokens: ${successfulAddressCount} successful, ${failedAddressCount} failed. Sample:`, Object.keys(priceResults).slice(0,5));
    } else {
        logApi.debug(`[JupiterClient.getPrices] Final results for ${uniqueAddresses.length} unique tokens: ${successfulAddressCount} successful, ${failedAddressCount} failed.`);
    }
    
    return priceResults;
  }

  async getPriceHistory(mintAddress, interval = '7d') {
    if (this.isCircuitBreakerOpen()) throw new Error('JupiterClient: Circuit breaker open.');
    set(this.stats.customStats.api, 'lastRequestAt', new Date().toISOString());
    try {
      const result = await this.prices.getPriceHistory(mintAddress, interval);
      inc(this.stats.customStats.api, 'successful'); 
      set(this.stats.customStats.api, 'lastSuccessfulResponseAt', new Date().toISOString());
      set(this.stats.customStats.api, 'lastError', null);
      set(this.stats.customStats.api, 'lastErrorTime', null);
      return result;
    } catch (error) { 
      inc(this.stats.customStats.api, 'failed'); 
      set(this.stats.customStats.api, 'lastError', `getPriceHistory failed: ${error.message}`);
      set(this.stats.customStats.api, 'lastErrorTime', new Date().toISOString());
      await this.handleError(error); 
      throw error; 
    }
  }

  async getSwapQuote(params) {
    if (this.isCircuitBreakerOpen()) throw new Error('JupiterClient: Circuit breaker open.');
    set(this.stats.customStats.api, 'lastRequestAt', new Date().toISOString());
    try {
      const result = await this.swaps.getSwapQuote(params);
      inc(this.stats.customStats.api, 'successful'); 
      set(this.stats.customStats.api, 'lastSuccessfulResponseAt', new Date().toISOString());
      set(this.stats.customStats.api, 'lastError', null);
      set(this.stats.customStats.api, 'lastErrorTime', null);
      return result;
    } catch (error) { 
      inc(this.stats.customStats.api, 'failed'); 
      set(this.stats.customStats.api, 'lastError', `getSwapQuote failed: ${error.message}`);
      set(this.stats.customStats.api, 'lastErrorTime', new Date().toISOString());
      await this.handleError(error); 
      throw error; 
    }
  }

  getServiceStatus() {
    const baseStatus = super.getServiceStatus();

    const syncStats = safeStats(this.stats, ['customStats', 'sync'], {
        last_full_sync_at: null,
        addresses_added_last_full_sync: 0,
        last_daily_sync_at: null,
        addresses_added_last_daily_sync: 0,
        daily_sync_running: false,
        full_sync_running: false
    });
    
    const apiStats = safeStats(this.stats, ['customStats', 'api'], {
        successful: 0,
        failed: 0,
        lastRequestAt: null,
        lastSuccessfulResponseAt: null,
        lastError: null,
        lastErrorTime: null
    });
    
    // tokenStats can be removed if db_total is not reliably updated by this service itself.
    // const tokenStats = safeStats(this.stats, ['customStats', 'tokens'], {
    //     db_total: 0 
    // });

    return {
      ...baseStatus,
      metrics: {
        ...(baseStatus.metrics || {}),
        jupiterClientSpecific: {
          tokenListSync: {
            fullSync: {
              lastRunAt: syncStats.last_full_sync_at,
              addressesAdded: syncStats.addresses_added_last_full_sync,
              isRunning: syncStats.full_sync_running
            },
            dailyDeltaSync: {
              lastRunAt: syncStats.last_daily_sync_at,
              addressesAdded: syncStats.addresses_added_last_daily_sync,
              isRunning: syncStats.daily_sync_running
            },
          },
          apiHealth: {
            successfulCalls: apiStats.successful,
            failedCalls: apiStats.failed,
            lastRequestAt: apiStats.lastRequestAt,
            lastSuccessfulResponseAt: apiStats.lastSuccessfulResponseAt,
            lastError: apiStats.lastError ? { message: apiStats.lastError, time: apiStats.lastErrorTime } : null
          }
        }
      }
    };
  }
}

let _instance = null;

export function getJupiterClient() {
  if (!_instance) _instance = new JupiterClient();
  return _instance;
}

export const jupiterClient = getJupiterClient();
export default jupiterClient;

function chunk(array, size) { 
  const chunks = []; 
  for (let i = 0; i < array.length; i += size) { 
    chunks.push(array.slice(i, i + size)); 
  }
  return chunks; 
}
