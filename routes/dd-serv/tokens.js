// /routes/dd-serv/tokens.js

import express from 'express';
import { PrismaClient } from '@prisma/client';
import { logApi } from '../../utils/logger-suite/logger.js';
import ServiceManager, { SERVICE_NAMES } from '../../utils/service-suite/service-manager.js';
import redisManager from '../../utils/redis-suite/redis-manager.js';

const router = express.Router();
const prisma = new PrismaClient();
const TOKENS_CACHE_KEY = 'dd_serv:tokens';
const CACHE_TTL = 30; // 30 seconds

/**
 * @swagger
 * tags:
 *   name: DD-Serv
 *   description: API endpoints for accessing token and market data from the DegenDuel Data Server
 */

// Service monitoring state
const DD_SERV_CONFIG = {
  timeout_ms: 10000,
  max_retries: 3,
  retry_delay_ms: 5000,
  alert_threshold_failures: 3,
  circuit_breaker: {
    failure_threshold: 5,
    reset_timeout_ms: 30000
  }
};

// Circuit breaker state
let circuitState = {
  isOpen: false,
  failures: 0,
  lastFailure: null,
  lastSuccess: null,
  lastReset: null
};

// Initialize service stats
const initializeStats = () => ({
  operations: {
    total: 0,
    successful: 0,
    failed: 0
  },
  endpoints: {},
  performance: {
    average_response_time_ms: 0
  },
  last_successful_fetch: null,
  consecutive_failures: 0,
  circuit_breaker: {
    current_state: 'closed',
    failures: 0,
    last_failure: null,
    last_success: null,
    last_reset: null
  }
});

// Initialize stats
let ddServStats = initializeStats();

// Initialize service on service manager startup
(async () => {
  try {
    // Check if service should be enabled
    const setting = await prisma.system_settings.findUnique({
      where: { key: SERVICE_NAMES.DD_SERV }
    });

    const enabled = setting?.value?.enabled ?? true; // Default to true if not set

    // Mark service started
    await ServiceManager.markServiceStarted(
      SERVICE_NAMES.DD_SERV,
      {
        ...DD_SERV_CONFIG,
        enabled
      },
      ddServStats
    );

    // If service is disabled, log and return
    if (!enabled) {
      logApi.info('[dd-serv] Service is disabled via dashboard');
      return;
    }

    // Log success
    logApi.info('[dd-serv] Service initialized successfully');
  } catch (error) {
    // Log failure
    logApi.error('[dd-serv] Failed to initialize service:', error);
  }
})();

// Reset stats function
const resetStats = async () => {
  ddServStats = initializeStats();
  try {
    // Update service heartbeat
    await ServiceManager.updateServiceHeartbeat(
      SERVICE_NAMES.DD_SERV,
      DD_SERV_CONFIG,
      ddServStats
    );
    // Log success
    logApi.info('[dd-serv] Stats reset successfully');
  } catch (error) {
    // Log failure
    logApi.error('[dd-serv] Failed to reset stats:', error);
  }
};

// Reset stats endpoint
router.post('/reset-stats', async (req, res) => {
  try {
    // Reset stats
    await resetStats();
    // Log success
    res.json({ message: 'Stats reset successfully', stats: ddServStats });
  } catch (error) {
    // Log failure
    res.status(500).json({ error: error.message });
  }
});

// Utility function for monitored fetch with retries and circuit breaker
async function monitoredFetch(url, options = {}, endpointName = 'unknown') {
  // Add retry cycle ID
  const retryCycleId = Math.random().toString(36).substring(2, 8);
  
  // Check service state first
  const setting = await prisma.system_settings.findUnique({
    where: { key: SERVICE_NAMES.DD_SERV }
  });

  if (!setting?.value?.enabled) {
    throw new Error('Service is disabled via dashboard');
  }

  // Check circuit breaker
  if (circuitState.isOpen) {
    const now = Date.now();
    const resetTimeout = circuitState.lastFailure + DD_SERV_CONFIG.circuit_breaker.reset_timeout_ms;
    
    if (now < resetTimeout) {
      throw new Error('Circuit breaker is open - service temporarily disabled');
    }
    
    // Only reset the circuit breaker after the timeout has passed
    logApi.info('[dd-serv] Circuit breaker reset timeout reached, resetting state');
    circuitState.isOpen = false;
    circuitState.failures = 0;
    circuitState.lastReset = now;
  }

  const startTime = Date.now();
  
  // Initialize endpoint stats if not exists
  if (!ddServStats.endpoints[endpointName]) {
    ddServStats.endpoints[endpointName] = {
      total: 0,
      successful: 0,
      failed: 0,
      average_response_time_ms: 0,
      last_error: null,
      last_success: null
    };
  }

  let lastError = null;
  
  for (let attempt = 1; attempt <= DD_SERV_CONFIG.max_retries; attempt++) {
    try {
      // Log attempt start
      logApi.info(`[dd-serv] 🔄 Request cycle ${retryCycleId} - Attempt ${attempt}/${DD_SERV_CONFIG.max_retries}\n` +
        `Endpoint: ${endpointName}\n` +
        `URL: ${url}`);

      // Setup timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DD_SERV_CONFIG.timeout_ms);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      // Update stats
      const duration = Date.now() - startTime;
      ddServStats.operations.total++;
      ddServStats.endpoints[endpointName].total++;
      
      if (response.ok) {
        // Log success
        logApi.info(`[dd-serv] 😅 Request cycle ${retryCycleId} succeeded on attempt ${attempt}`);
        
        // Success handling
        ddServStats.operations.successful++;
        ddServStats.endpoints[endpointName].successful++;
        ddServStats.consecutive_failures = 0;
        ddServStats.last_successful_fetch = new Date().toISOString();
        ddServStats.endpoints[endpointName].last_success = new Date().toISOString();
        
        // Reset circuit breaker state
        circuitState.failures = 0;
        circuitState.lastSuccess = Date.now();
        circuitState.isOpen = false;
        
        // Update performance metrics
        const endpointStats = ddServStats.endpoints[endpointName];
        endpointStats.average_response_time_ms = 
          (endpointStats.average_response_time_ms * (endpointStats.total - 1) + duration) / endpointStats.total;
        
        // Update service state
        await ServiceManager.updateServiceHeartbeat(
          SERVICE_NAMES.DD_SERV,
          DD_SERV_CONFIG,
          ddServStats
        );
        
        return response;
      }
      
      // Non-200 response
      const text = await response.text();
      logApi.warn(`[dd-serv] ❌ Request cycle ${retryCycleId} failed (Attempt ${attempt}/${DD_SERV_CONFIG.max_retries})\n` +
        `Status: ${response.status}\n` +
        `Endpoint: ${endpointName}\n` +
        `URL: ${url}\n` +
        `Response: ${text}`);
      throw new Error(`HTTP ${response.status}: ${text}`);
      
    } catch (err) {
      lastError = err;
      
      // Update failure stats with safe error object
      const safeError = {
        message: err.message,
        name: err.name,
        code: err.code,
        type: err.type
      };
      
      // Log the failure with cycle ID
      logApi.warn(`[dd-serv] ❌ Request cycle ${retryCycleId} failed (Attempt ${attempt}/${DD_SERV_CONFIG.max_retries})\n` +
        `Error: ${safeError.message}\n` +
        `Endpoint: ${endpointName}\n` +
        `URL: ${url}\n` +
        `Type: ${safeError.type || safeError.name}`);
      
      ddServStats.operations.failed++;
      ddServStats.endpoints[endpointName].failed++;
      ddServStats.consecutive_failures++;
      ddServStats.endpoints[endpointName].last_error = safeError;
      
      // Update circuit breaker state
      circuitState.failures++;
      circuitState.lastFailure = Date.now();
      
      // Check if we should open circuit breaker
      if (circuitState.failures >= DD_SERV_CONFIG.circuit_breaker.failure_threshold) {
        circuitState.isOpen = true;
        logApi.error(`\n[dd-serv] \t☠️ ☢️ 💥 ☠️ ☢️ 💥 CIRCUIT BREAKER OPENED 💥 ☢️ ☠️ 💥 ☢️ ☠️\n` + 
          `.=====================================================\n` +
          `||  Request Cycle: ${retryCycleId}\n` +
          `||  Consecutive Failures: ${circuitState.failures}\n` +
          `||  Last Failure: ${new Date(circuitState.lastFailure).toISOString()}\n` +
          `||  Last Success: ${circuitState.lastSuccess ? new Date(circuitState.lastSuccess).toISOString() : 'Never'}\n` +
          `||  Error: ${safeError.message}\n` +
          `'=====================================================`);
      }
      
      // Check if we need to alert
      if (ddServStats.consecutive_failures >= DD_SERV_CONFIG.alert_threshold_failures) {
        const severity = Math.min(Math.floor(ddServStats.consecutive_failures / DD_SERV_CONFIG.alert_threshold_failures), 3);
        const alerts = ['⚠️', '⚠️⚠️', '🚨', '🚨🚨'][severity];
        logApi.error(`[dd-serv] ${alerts} Service Degradation Alert ${alerts}\n` +
          `------------------------------------\n` +
          `Request Cycle: ${retryCycleId}\n` +
          `Consecutive Failures: ${ddServStats.consecutive_failures}\n` +
          `Last Success: ${ddServStats.last_successful_fetch || 'Never'}\n` +
          `Endpoint: ${endpointName}\n` +
          `Error: ${safeError.message}\n` +
          `Circuit Breaker: ${circuitState.isOpen ? '🔓 OPEN' : '🔒 CLOSED'} (${circuitState.failures} failures)\n` +
          `------------------------------------`);
      }
      
      // Update service state with error
      await ServiceManager.markServiceError(
        SERVICE_NAMES.DD_SERV,
        safeError,
        DD_SERV_CONFIG,
        ddServStats
      );
      
      // If this is not the last attempt, wait before retrying
      if (attempt < DD_SERV_CONFIG.max_retries) {
        const delay = DD_SERV_CONFIG.retry_delay_ms * attempt;
        logApi.info(`[dd-serv] 🔄 Request cycle ${retryCycleId} - Retry ${attempt + 1}/${DD_SERV_CONFIG.max_retries} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }
  
  // If we get here, all retries failed
  logApi.error(`[dd-serv] ❌ Request cycle ${retryCycleId} - All retries exhausted`);
  throw lastError;
}


/* DD-Serv Tokens Routes */

// Service health monitoring endpoint
//   example: GET https://degenduel.me/api/dd-serv/health
/**
 * @swagger
 * /api/dd-serv/health:
 *   get:
 *     summary: Get the health status of the DD-Serv
 *     tags: [DD-Serv]
 */
router.get('/health', async (req, res) => {
  try {
    const state = await ServiceManager.getServiceState(SERVICE_NAMES.DD_SERV);
    res.json({
      status: ddServStats.consecutive_failures >= DD_SERV_CONFIG.alert_threshold_failures ? 'degraded' : 'healthy',
      stats: ddServStats,
      config: DD_SERV_CONFIG,
      state
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Circuit breaker status endpoint
//   example: GET https://degenduel.me/api/dd-serv/circuit-breaker
/**
 * @swagger
 * /api/dd-serv/circuit-breaker:
 *   get:
 *     summary: Get the circuit breaker status of the DD-Serv
 *     tags: [DD-Serv]
 */
router.get('/circuit-breaker', async (req, res) => {
  res.json({
    state: circuitState.isOpen ? 'open' : 'closed',
    failures: circuitState.failures,
    last_failure: circuitState.lastFailure ? new Date(circuitState.lastFailure).toISOString() : null,
    last_success: circuitState.lastSuccess ? new Date(circuitState.lastSuccess).toISOString() : null,
    config: DD_SERV_CONFIG.circuit_breaker
  });
});

// Get OFFICIAL DD-Serv list of tokens
//   example: GET https://degenduel.me/api/dd-serv/tokens
/**
 * @swagger
 * /api/dd-serv/tokens:
 *   get:
 *     summary: Get a list of all tokens from the DD-Serv (data.degenduel.me)
 *     tags: [DD-Serv]
 */ 
router.get('/tokens', async (req, res) => {
  try {
    // Try to get cached data first
    const cachedData = await redisManager.get(TOKENS_CACHE_KEY);
    if (cachedData) {
      return res.json({
        ...cachedData,
        _cached: true,
        _cachedAt: new Date(cachedData.timestamp).toISOString()
      });
    }

    // If no cache, fetch fresh data
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch('https://data.degenduel.me/api/tokens', {
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      const text = await response.text();
      logApi.error(`[dd-serv] tokens fetch error ${response.status}: ${text}`);
      
      // If data service fails but we have stale cache, return it
      const staleCache = await redisManager.get(TOKENS_CACHE_KEY);
      if (staleCache) {
        return res.json({
          ...staleCache,
          _cached: true,
          _stale: true,
          _cachedAt: new Date(staleCache.timestamp).toISOString()
        });
      }
      
      return res.status(response.status).json({ error: text });
    }

    // Parse and cache the new data
    const tokenDataJson = await response.json();
    await redisManager.set(TOKENS_CACHE_KEY, tokenDataJson, CACHE_TTL);

    res.json(tokenDataJson);

  } catch (err) {
    const errorMessage = err.name === 'AbortError' 
      ? 'Request timed out while fetching tokens from data service'
      : err.message;
      
    logApi.error('[dd-serv] Error fetching tokens:', {
      error: errorMessage,
      type: err.name,
      stack: err.stack
    });
    
    // Try to get stale cache as fallback
    try {
      const staleCache = await redisManager.get(TOKENS_CACHE_KEY);
      if (staleCache) {
        return res.json({
          ...staleCache,
          _cached: true,
          _stale: true,
          _cachedAt: new Date(staleCache.timestamp).toISOString()
        });
      }
    } catch (redisErr) {
      logApi.error('[dd-serv] Redis error:', redisErr);
    }
    
    res.status(503).json({ 
      error: errorMessage,
      service_status: 'degraded',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/dd-serv/tokens/list:
 *   get:
 *     summary: Get a list of tokens with configurable detail level
 *     tags: [DD-Serv]
 *     parameters:
 *       - in: query
 *         name: detail
 *         schema:
 *           type: string
 *           enum: [simple, full]
 *         description: Level of detail to return (simple = address/name/symbol only, full = all token data)
 *         default: simple
 *     responses:
 *       200:
 *         description: An array of token information
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
// Get (official DD-Serv?*) list of tokens with configurable detail level (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/dd-serv/tokens/list?detail=simple
//   example: GET https://degenduel.me/api/dd-serv/tokens/list?detail=full
router.get('/tokens/list', async (req, res) => {
  try {
    const { detail = 'simple' } = req.query;
    
    const response = await monitoredFetch(
      'https://data.degenduel.me/api/tokens',
      {},
      'tokens_list'
    );
    
    const tokenDataJson = await response.json();
    
    // Validate response structure
    if (!tokenDataJson || !tokenDataJson.data || !Array.isArray(tokenDataJson.data)) {
      throw new Error('Invalid response format from data service');
    }
    
    if (detail === 'simple') {
      const simpleTokens = tokenDataJson.data.map(token => ({
        contractAddress: token.contractAddress || null,
        name: token.name || 'Unknown',
        symbol: token.symbol || 'UNKNOWN'
      }));
      return res.json(simpleTokens);
    }
    
    // Return full flattened token data with null checks
    const flattenedTokens = tokenDataJson.data.map(token => ({
      timestamp: tokenDataJson.timestamp || new Date().toISOString(),
      id: token.id,
      symbol: token.symbol || 'UNKNOWN',
      name: token.name || 'Unknown',
      contractAddress: token.contractAddress,
      chain: token.chain,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
      marketCap: token.marketCap || 0,
      price: token.price || 0,
      volume24h: token.volume24h || 0,
      change_h1: token.changesJson?.h1 || 0,
      change_h6: token.changesJson?.h6 || 0,
      change_m5: token.changesJson?.m5 || 0,
      change_h24: token.changesJson?.h24 || 0,
      imageUrl: token.imageUrl || null,
      liquidity_usd: token.liquidity?.usd || 0,
      liquidity_base: token.liquidity?.base || 0,
      liquidity_quote: token.liquidity?.quote || 0,
      pairUrl: token.pairUrl || null,
      transactions_h1_buys: token.transactionsJson?.h1?.buys || 0,
      transactions_h1_sells: token.transactionsJson?.h1?.sells || 0,
      transactions_h6_buys: token.transactionsJson?.h6?.buys || 0,
      transactions_h6_sells: token.transactionsJson?.h6?.sells || 0,
      transactions_m5_buys: token.transactionsJson?.m5?.buys || 0,
      transactions_m5_sells: token.transactionsJson?.m5?.sells || 0,
      transactions_h24_buys: token.transactionsJson?.h24?.buys || 0,
      transactions_h24_sells: token.transactionsJson?.h24?.sells || 0,
      baseToken_name: token.baseToken?.name || null,
      baseToken_symbol: token.baseToken?.symbol || null,
      baseToken_address: token.baseToken?.address || null,
      headerImage: token.headerImage || null,
      openGraphImage: token.openGraphImage || null,
      quoteToken_name: token.quoteToken?.name || null,
      quoteToken_symbol: token.quoteToken?.symbol || null,
      quoteToken_address: token.quoteToken?.address || null,
      websites: token.websites || [],
      coingeckoId: token.coingeckoId || null,
      priceChanges: token.priceChanges || {},
      socials: token.socials || {}
    }));
    
    res.json(flattenedTokens);

  } catch (err) {
    const errorMessage = err.name === 'AbortError'
      ? 'Request timed out while fetching tokens from data service'
      : err.message;
      
    logApi.error('[dd-serv] Error fetching token list:', {
      error: errorMessage,
      type: err.name,
      stack: err.stack,
      endpoint: 'tokens_list'
    });
    
    res.status(503).json({
      error: errorMessage,
      service_status: 'degraded',
      timestamp: new Date().toISOString(),
      endpoint: 'tokens_list'
    });
  }
});

/**
 * @swagger
 * /api/dd-serv/tokens/{tokenAddress}/price-history:
 *   get:
 *     summary: Get price history of a token
 *     tags: [DD-Serv]
 *     parameters:
 *       - in: path
 *         name: tokenAddress
 *         required: true
 *         description: The address of the token
 */
// Get OFFICIAL DD-Serv price history of a token (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/dd-serv/tokens/3c5mzP5u2QJHnc3GYifvjAYy7sxXq32fu3bwiUAepump/price-history
router.get('/tokens/:tokenAddress/price-history', async (req, res) => {
  const { tokenAddress } = req.params;
  try {
    const response = await fetch(`https://data.degenduel.me/api/tokens/${tokenAddress}/price-history`);
    const priceHistory = await response.json();
    res.json(priceHistory);
  } catch (err) {
    logApi.error('[dd-serv] Error fetching price history:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/dd-serv/tokens/bulk-price-history:
 *   post:
 *     summary: Get price history for multiple tokens
 *     tags: [DD-Serv]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of token contract addresses
 *     responses:
 *       200:
 *         description: Object containing price histories for requested tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
// Get (official DD-Serv?*) price history for multiple tokens (NO AUTH REQUIRED)
//   example: POST https://degenduel.me/api/dd-serv/tokens/bulk-price-history
//   body: { "addresses": ["3c5mzP5u2QJHnc3GYifvjAYy7sxXq32fu3bwiUAepump", "sol11111111111111111111111111111111111111112"] }
router.post('/tokens/bulk-price-history', async (req, res) => {
  const { addresses } = req.body;
  
  if (!Array.isArray(addresses)) {
    return res.status(400).json({ error: 'addresses must be an array of strings' });
  }

  try {
    // Fetch price histories in parallel
    const priceHistories = await Promise.all(
      addresses.map(async (address) => {
        try {
          const response = await fetch(`https://data.degenduel.me/api/tokens/${address}/price-history`);
          if (!response.ok) {
            const text = await response.text();
            logApi.error(`[dd-serv] price history fetch error for ${address}: ${response.status}: ${text}`);
            return { [address]: { error: `Failed to fetch: ${text}` } };
          }
          const data = await response.json();
          return { [address]: data };
        } catch (err) {
          logApi.error(`[dd-serv] Error fetching price history for ${address}:`, err);
          return { [address]: { error: err.message } };
        }
      })
    );

    // Combine all results into a single object
    const result = Object.assign({}, ...priceHistories);
    res.json(result);

  } catch (err) {
    logApi.error('[dd-serv] Error in bulk price history:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;