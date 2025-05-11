// services/token-refresh-scheduler.js

/**
 * Advanced Token Refresh Scheduler
 * 
 * This service intelligently manages token price refresh operations to maximize
 * API efficiency while ensuring prices are updated at appropriate intervals.
 * 
 * Key features:
 * - Dynamic scheduling based on token importance
 * - Adaptive rate limiting to stay within API constraints
 * - Prioritization of actively traded tokens
 * - Efficient batching to maximize throughput
 * - Circuit breaking for API failures
 * 
 * @author BranchManager69
 * @version 1.9.0
 * @created 2025-04-10
 * @updated 2025-05-02
 */

// Service Suite
import { BaseService } from '../utils/service-suite/base-service.js';
import { SERVICE_NAMES, SERVICE_LAYERS, DEFAULT_CIRCUIT_BREAKER_CONFIG, getServiceMetadata } from '../utils/service-suite/service-constants.js';
// Prisma
import { prisma } from '../config/prisma.js';
// Solana Engine
import { jupiterClient, getJupiterClient } from './solana-engine/jupiter-client.js';
import { heliusClient } from './solana-engine/helius-client.js';
import dexScreenerCollector from './token-enrichment/collectors/dexScreenerCollector.js';
// Logger and Progress Utilities
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors, serviceColors } from '../utils/colors.js';
import { createBatchProgress } from '../utils/logger-suite/batch-progress.js';
// Token Refresh Scheduler components
import PriorityQueue from './token-refresh-scheduler/priority-queue.js';
import TokenRankAnalyzer from './token-refresh-scheduler/rank-analyzer.js';
import BatchOptimizer from './token-refresh-scheduler/batch-optimizer.js';
import MetricsCollector from './token-refresh-scheduler/metrics-collector.js';

// Config
import { config } from '../config/config.js';

// Constants and configuration
const DEFAULT_MAX_TOKENS_PER_BATCH = 500;  // Updated from 100 to 500 for better Jupiter batching
const DEFAULT_MIN_INTERVAL_SECONDS = 15;   // Minimum refresh interval
const DEFAULT_BATCH_DELAY_MS = 3000;       // Min 3000ms delay between batch executions to avoid rate limiting
const DEFAULT_API_RATE_LIMIT = 30;         // Requests per second (30% of 100 limit to be conservative)
const DEFAULT_METRICS_INTERVAL_MS = 60000; // Metrics reporting interval (1 minute)

// Token priority tiers - initialized from database
let PRIORITY_TIERS = {
  // Default fallback tiers (will be overridden by database values)
  CRITICAL: { 
    score: 1000,
    interval: 15,    // 15 seconds
    volatility_factor: 2.0,
    rank_threshold: 50
  },
  HIGH: { 
    score: 500,
    interval: 30,    // 30 seconds 
    volatility_factor: 1.5,
    rank_threshold: 200
  },
  NORMAL: { 
    score: 200,
    interval: 60,    // 1 minute
    volatility_factor: 1.2,
    rank_threshold: 500
  },
  LOW: { 
    score: 100,
    interval: 180,   // 3 minutes
    volatility_factor: 1.0,
    rank_threshold: 1000
  },
  MINIMAL: { 
    score: 50,
    interval: 300,   // 5 minutes
    volatility_factor: 0.8,
    rank_threshold: 3000
  },
  INACTIVE: { 
    score: 10,
    interval: 600,   // 10 minutes
    volatility_factor: 0.5,
    rank_threshold: 100000
  }
};

// -- CURSOR AI MODIFICATION START --
// Add formatLog definition for this service
const formatLog = {
  tag: () => `${serviceColors.tokenRefreshScheduler || fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET}`, // Assuming you have a color for it
  header: (text) => `${serviceColors.tokenRefreshSchedulerHeader || fancyColors.BG_GOLD}${fancyColors.BLACK} ${text} ${fancyColors.RESET}`,
  // Add other specific formats if needed, or a generic one:
  info: (text) => `${fancyColors.GOLD}${text}${fancyColors.RESET}`,
  error: (text) => `${fancyColors.RED}${text}${fancyColors.RESET}`,
  success: (text) => `${fancyColors.GREEN}${text}${fancyColors.RESET}`,
  warning: (text) => `${fancyColors.YELLOW}${text}${fancyColors.RESET}`,
  token: (text) => `${fancyColors.MAGENTA}${text}${fancyColors.RESET}`
};
// -- CURSOR AI MODIFICATION END --

import serviceEvents, { SERVICE_EVENTS } from '../utils/service-suite/service-events.js';

/**
 * TokenRefreshScheduler - Advanced scheduling system for token price updates
 */
class TokenRefreshScheduler extends BaseService {
  constructor() {
    // Use service constants for name and try to get metadata for description, layer, criticalLevel
    const serviceName = SERVICE_NAMES.TOKEN_REFRESH_SCHEDULER;
    const metadata = getServiceMetadata(serviceName) || {};
    super({
      name: serviceName,
      description: metadata.description || 'Advanced token refresh scheduling system',
      layer: metadata.layer || SERVICE_LAYERS.DATA, // Default to DATA layer if not in metadata
      criticalLevel: metadata.criticalLevel || 'medium',
      checkIntervalMs: 1 * 60 * 1000, // Default 1 minute, used for onPerformOperation health check
      circuitBreaker: { // ADDED/CORRECTED circuit breaker config
        ...(DEFAULT_CIRCUIT_BREAKER_CONFIG), // Start with defaults
        failureThreshold: 7, // Custom override example
        resetTimeoutMs: 45000, // Custom override example
        description: metadata.description || 'Manages token refresh scheduling'
      },
      dependencies: [SERVICE_NAMES.JUPITER_CLIENT /*, SERVICE_NAMES.SOLANA_ENGINE*/],
    });

    // Configuration (will be loaded from db/env)
    this.config = {
      performance: {
        targetBatchSize: parseInt(config.token_refresh_scheduler_target_batch_size || '50'),
        maxTokensPerCycle: parseInt(config.token_refresh_scheduler_max_tokens_per_cycle || '200'),
        delayBetweenBatchesMs: parseInt(config.token_refresh_scheduler_delay_between_batches_ms || '100'), // DEGENS: Adjusted default
        maxConcurrentBatches: parseInt(config.token_refresh_scheduler_max_concurrent_batches || '1'),
      },
      rateLimit: {
        apiCallsPerWindow: parseInt(config.token_refresh_scheduler_api_calls_per_window || '1'),
        windowDurationMs: parseInt(config.token_refresh_scheduler_window_duration_ms || '1100'),
        maxFailedStreak: parseInt(config.token_refresh_scheduler_max_failed_streak || '5'),
      },
      maxTokensPerBatch: DEFAULT_MAX_TOKENS_PER_BATCH,
      minIntervalSeconds: DEFAULT_MIN_INTERVAL_SECONDS,
      batchDelayMs: DEFAULT_BATCH_DELAY_MS,
      apiRateLimit: DEFAULT_API_RATE_LIMIT,
      metricsIntervalMs: DEFAULT_METRICS_INTERVAL_MS,
      prioritizationEnabled: true,
      dynamicIntervalsEnabled: true,
      adaptiveRateLimitEnabled: true
    };

    // Core scheduler components
    this.priorityQueue = null;           // Will be initialized with PriorityQueue
    this.rankAnalyzer = null;            // Will be initialized with TokenRankAnalyzer
    this.batchOptimizer = null;          // Will be initialized with BatchOptimizer
    this.metricsCollector = null;        // Will be initialized with MetricsCollector

    // Scheduler state
    this.isRunning = false;              // Whether scheduler is actively running
    this.schedulerInterval = null;       // Main scheduling interval
    this.metricsInterval = null;         // Metrics collection interval
    
    // Performance tracking
    this.lastBatchStartTime = null;
    this.consecutiveFailures = 0;
    this.lifetimeUpdates = 0;
    this.lifetimeFailures = 0;
    this.lifetimeBatches = 0;
    
    // Rate limiting state
    this.apiCallsInCurrentWindow = 0;
    this.rateLimitWindowStartTime = Date.now();
    this.rateLimitAdjustmentFactor = 1.0;
    
    // Token refresh tracking
    this.activeTokens = new Set();       // Currently active token IDs
    this.failedTokens = new Map();       // token_id -> { failures, backoff }
    this.tokenSubscriptionCache = null;  // Cache of token subscriptions
    this.prioritizationCache = new Map(); // token_id -> priority data

    // Batching pipeline
    this.currentBatch = null;            // Currently processing batch
    this.pendingBatches = [];            // Queue of batches waiting to be processed
    
    // Debug state 
    this.debugMode = config.debug_mode === 'true' || config.debug_modes?.token_refresh === 'true';

    // -- CURSOR AI MODIFICATION START --
    this.jupiterClient = jupiterClient; // Explicitly assign imported singleton to instance property
    this.heliusClient = heliusClient;   // Might as well do it for heliusClient too for consistency
    this.dexScreenerCollector = dexScreenerCollector; // And for DexScreenerCollector
    // Log to confirm they are defined
    logApi.debug(`${formatLog.tag()} Constructor: jupiterClient type: ${typeof this.jupiterClient}, heliusClient type: ${typeof this.heliusClient}, dexScreenerCollector type: ${typeof this.dexScreenerCollector}`);
    // -- CURSOR AI MODIFICATION END --

    // Bind methods to ensure correct 'this' context
    this.processBatch = this.processBatch.bind(this);
    this.checkRateLimitWindow = this.checkRateLimitWindow.bind(this);
    this.runSchedulerCycle = this.runSchedulerCycle.bind(this); // Also good to bind if used in setInterval
  }

  /**
   * Initialize the scheduler
   */
  async initialize() {
    try {
      // Check if service is enabled via service profile
      if (!config.services.token_refresh_scheduler) {
        logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Token Refresh Scheduler is disabled in the '${config.services.active_profile}' service profile`);
        return false; // Skip initialization
      }

      // Load configuration
      await this.loadConfiguration();
      
      // Initialize components
      this.priorityQueue = new PriorityQueue(this.config);
      this.rankAnalyzer = new TokenRankAnalyzer(this.config);
      this.batchOptimizer = new BatchOptimizer(this.config);
      this.metricsCollector = new MetricsCollector(this.config);
      
      // Use the singleton Jupiter client that should already be initialized by SolanaEngine
      if (!jupiterClient.initialized) {
        logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Jupiter client not initialized yet, using existing singleton...`);
        // Don't initialize here, just use the existing instance from SolanaEngine
      } else {
        logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Using already initialized Jupiter client`);
      }
      
      // Load active tokens and initialize priority queue
      await this.loadActiveTokens();
      
      // Start metrics collection
      this.startMetricsCollection();
      
      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Token Refresh Scheduler ready with ${this.activeTokens.size} active tokens`);
      
      this.isInitialized = true;

      // -- CURSOR AI MODIFICATION START --
      // Double check clients are available before proceeding with logic that uses them
      if (!this.jupiterClient || typeof this.jupiterClient.getPrices !== 'function') {
        logApi.error(`${formatLog.tag()} CRITICAL ERROR during initialize: JupiterClient is not available or missing getPrices.`);
        throw new Error("JupiterClient failed to load correctly for TokenRefreshScheduler.");
      }
      if (!this.heliusClient || typeof this.heliusClient.tokens?.getTokensMetadata !== 'function') {
        logApi.error(`${formatLog.tag()} CRITICAL ERROR during initialize: HeliusClient is not available or missing tokens.getTokensMetadata.`);
        throw new Error("HeliusClient failed to load correctly for TokenRefreshScheduler.");
      }
      if (!this.dexScreenerCollector || typeof this.dexScreenerCollector.getTokensByAddressBatch !== 'function') {
        logApi.error(`${formatLog.tag()} CRITICAL ERROR during initialize: DexScreenerCollector is not available or missing getTokensByAddressBatch.`);
        throw new Error("DexScreenerCollector failed to load correctly for TokenRefreshScheduler.");
      }
      // -- CURSOR AI MODIFICATION END --
      
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET}`, error);
      await this.handleError(error);
      throw error;
    }
  }

  /**
   * Load configuration from database
   */
  async loadConfiguration() {
    try {
      // Override defaults with environment variables if present
      this.config.maxTokensPerBatch = parseInt(process.env.TOKEN_REFRESH_MAX_BATCH_SIZE || DEFAULT_MAX_TOKENS_PER_BATCH);
      this.config.minIntervalSeconds = parseInt(process.env.TOKEN_REFRESH_MIN_INTERVAL || DEFAULT_MIN_INTERVAL_SECONDS);
      this.config.batchDelayMs = parseInt(process.env.TOKEN_REFRESH_BATCH_DELAY || DEFAULT_BATCH_DELAY_MS);
      this.config.apiRateLimit = parseInt(process.env.TOKEN_REFRESH_API_RATE_LIMIT || DEFAULT_API_RATE_LIMIT);
      this.config.metricsIntervalMs = parseInt(process.env.TOKEN_REFRESH_METRICS_INTERVAL || DEFAULT_METRICS_INTERVAL_MS);

      // Feature flags
      this.config.prioritizationEnabled = process.env.TOKEN_REFRESH_PRIORITIZATION !== 'false';
      this.config.dynamicIntervalsEnabled = process.env.TOKEN_REFRESH_DYNAMIC_INTERVALS !== 'false';
      this.config.adaptiveRateLimitEnabled = process.env.TOKEN_REFRESH_ADAPTIVE_RATE !== 'false';
      
      // Load priority tiers from database
      await this.loadPriorityTiers();
      
      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Configuration loaded:`, {
        maxTokensPerBatch: this.config.maxTokensPerBatch,
        minIntervalSeconds: this.config.minIntervalSeconds,
        batchDelayMs: this.config.batchDelayMs,
        apiRateLimit: this.config.apiRateLimit,
        features: {
          prioritization: this.config.prioritizationEnabled,
          dynamicIntervals: this.config.dynamicIntervalsEnabled,
          adaptiveRateLimit: this.config.adaptiveRateLimitEnabled
        }
      });
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Error loading configuration:`, error);
      // Use defaults if configuration loading fails
    }
  }
  
  /**
   * Load priority tiers from database
   */
  async loadPriorityTiers() {
    try {
      // Get priority tiers from database
      const tiers = await prisma.token_refresh_priority_tiers.findMany({
        where: {
          is_active: true
        },
        orderBy: {
          priority_score: 'desc'
        }
      });
      
      if (tiers.length === 0) {
        logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} No priority tiers found in database. Using defaults.`);
        return;
      }
      
      // Reset default tiers with database values
      const newTiers = {};
      
      for (const tier of tiers) {
        newTiers[tier.name] = {
          score: tier.priority_score,
          interval: tier.refresh_interval_seconds,
          volatility_factor: tier.volatility_factor,
          rank_threshold: tier.rank_threshold,
          max_tokens_per_batch: tier.max_tokens_per_batch,
          batch_delay_ms: tier.batch_delay_ms
        };
      }
      
      // Update global PRIORITY_TIERS
      PRIORITY_TIERS = newTiers;
      
      // Log loaded tiers
      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Loaded ${tiers.length} priority tiers from database`);
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Error loading priority tiers:`, error);
      logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Using default priority tiers`);
    }
  }

  /**
   * Load active tokens from database and initialize priority queue
   */
  async loadActiveTokens() {
    logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} STEP 1: Attempting to load active tokens from DB...`);
    let tokens = [];
    try {
      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} STEP 2: Calling prisma.tokens.findMany (with MINIMAL select)...`);
      tokens = await prisma.tokens.findMany({
        where: { is_active: true },
        take: 100,
        select: {
          id: true,
          address: true,
          symbol: true,
        }
      });
      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} STEP 3: Found ${tokens ? tokens.length : 'null object'} tokens marked is_active: true (after take: 100, minimal select).`);
      if (!tokens || tokens.length === 0) {
        logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} No active tokens in DB. Clearing queues by re-initializing.`);
        this.activeTokens.clear();
        this.priorityQueue = new PriorityQueue(this.config);
        this.prioritizationCache.clear();
        return 0;
      }
      if (!this.priorityQueue) {
        logApi.warn("[TokenRefreshSched] PriorityQueue was null in loadActiveTokens! Re-initializing.");
        this.priorityQueue = new PriorityQueue(this.config);
      } else {
        this.priorityQueue = new PriorityQueue(this.config);
        logApi.debug("[TokenRefreshSched] Cleared existing PriorityQueue by re-initializing before repopulating.");
      }
      if (!this.rankAnalyzer) {
        logApi.warn("[TokenRefreshSched] TokenRankAnalyzer was null in loadActiveTokens! Re-initializing.");
        this.rankAnalyzer = new TokenRankAnalyzer(this.config);
      }
      this.activeTokens.clear();
      this.prioritizationCache.clear();
      
      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} STEP 4: Processing ${tokens.length} active tokens for priority queue...`);
      for (const [index, token] of tokens.entries()) {
        if (!token || !token.id) {
          logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Invalid token at index ${index}, skipping.`);
          continue;
        }
        logApi.debug(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} LOOP START: Processing token ${index + 1}/${tokens.length}: ${token.symbol || token.address} (minimal data loaded)`);
        this.activeTokens.add(token.id);
        const priorityData = this.calculateTokenPriority(token);
        if (priorityData) {
          this.prioritizationCache.set(token.id, priorityData);
          this.priorityQueue.enqueue({
            id: token.id,
            address: token.address,
            symbol: token.symbol,
            priority: priorityData.score,
            nextRefreshTime: this.calculateNextRefreshTime(token, priorityData),
            interval: priorityData.refreshInterval
          });
          logApi.debug(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} LOOP END: Enqueued ${token.symbol || token.address} with priority ${priorityData.score}`);
        } else {
          logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} LOOP END: Could not calculate priority for token ID ${token.id} (${token.symbol || token.address}) with minimal data, skipping enqueue.`);
        }
      }
      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} STEP 5: Loaded ${this.priorityQueue.size()} active tokens into priority queue.`);
      if (tokens.length > 0 && this.rankAnalyzer) {
        logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} STEP 6: Analyzing token distribution (with minimal data)...`);
        const tokenStats = this.rankAnalyzer.analyzeTokenDistribution(tokens);
        logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} STEP 7: Token distribution analysis complete:`, tokenStats);
      } else if (!this.rankAnalyzer) {
        logApi.warn("[TokenRefreshSched] RankAnalyzer not available for token distribution analysis.");
      }
      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} STEP 8: loadActiveTokens completed successfully (with minimal select).`);
      return this.activeTokens.size;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} CRITICAL ERROR in loadActiveTokens:`, error);
      logApi.error("[TokenRefreshSched] Error Stack:", error.stack); // Log stack trace
      throw error;
    }
  }

  /**
   * Calculate token priority based on various factors
   * @param {Object} token - Token object from database
   * @returns {Object} Priority data including score and refresh interval
   */
  calculateTokenPriority(token) {
    if (!token || !token.id) { // Check for token and token.id early
        logApi.warn("[TokenRefreshSched] calculateTokenPriority called with invalid token object");
        return null;
    }
    try { // Add a try-catch within calculateTokenPriority for more granular error reporting
        let priorityScore = token.priority_score || 0;
        let latestRank = token.rank_history && token.rank_history.length > 0 && token.rank_history[0] ? token.rank_history[0].rank : undefined;

        let baseTier = null;
        const tierNames = Object.keys(PRIORITY_TIERS);
        const sortedTiers = [...tierNames].sort((a, b) => (PRIORITY_TIERS[b]?.rank_threshold || 0) - (PRIORITY_TIERS[a]?.rank_threshold || 0));
        
        if (latestRank === undefined || latestRank === null) {
            baseTier = PRIORITY_TIERS[sortedTiers[0]] || PRIORITY_TIERS.MINIMAL;
        } else {
            for (const tierName of sortedTiers) {
                const tier = PRIORITY_TIERS[tierName];
                if (tier && latestRank <= tier.rank_threshold) {
                    baseTier = tier;
                } else if (tier) {
                    break;
                } else {
                    logApi.warn("[TokenRefreshSched] Missing tier definition for: " + tierName + " in PRIORITY_TIERS");
                }
            }
            if (!baseTier) baseTier = PRIORITY_TIERS[sortedTiers[0]] || PRIORITY_TIERS.MINIMAL;
        }
        
        if (!baseTier || baseTier.score === undefined) {
            logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Could not determine valid base tier for token ${token.id} (${token.symbol || token.address}). Using default priority.`);
            baseTier = { name: 'DEFAULT_FALLBACK', score: 10, interval: 600, volatility_factor: 1.0, rank_threshold: 999999 }; // Ensure all fields for fallback
        }
        if (token.contest_portfolios && Array.isArray(token.contest_portfolios) && token.contest_portfolios.length > 0) {
            const highTierName = tierNames.find(name => PRIORITY_TIERS[name]?.score >= 500) || 'HIGH';
            const highTier = PRIORITY_TIERS[highTierName] || baseTier;
            if (baseTier.score < highTier.score) baseTier = { ...highTier }; // Copy to avoid modifying original PRIORITY_TIERS
            priorityScore += 300;
        }
        const tokenPriceData = token.token_prices;
        if (tokenPriceData && tokenPriceData.volume_24h !== null && tokenPriceData.volume_24h !== undefined) {
            try {
                const volume = parseFloat(tokenPriceData.volume_24h.toString());
                if (!isNaN(volume)) {
                    if (volume > 1000000) priorityScore += 200;
                    else if (volume > 100000) priorityScore += 100;
                    else if (volume > 10000) priorityScore += 50;
                }
            } catch (e) { logApi.warn("[TokenRefreshSched] Error parsing volume for priority calc for token " + token.id + ": " + e.message); }
        }
        const volatilityFactor = this.calculateVolatilityFactor(token);
        const baseInterval = token.refresh_interval_seconds || baseTier.interval || DEFAULT_MIN_INTERVAL_SECONDS;
        let adjustedInterval = Math.max(
            this.config.minIntervalSeconds || 15, // Ensure config value or default
            Math.floor(baseInterval / (volatilityFactor * (baseTier.volatility_factor || 1.0)))
        );
        if (this.config.dynamicIntervalsEnabled) {
            adjustedInterval = Math.min(adjustedInterval, baseTier.interval || (DEFAULT_MIN_INTERVAL_SECONDS * 20)); // Cap with a fallback
        } else {
            adjustedInterval = baseInterval;
        }

        return {
            score: priorityScore + (baseTier.score || 0),
            baseTier: baseTier.name || 'UNKNOWN',
            refreshInterval: Math.max(this.config.minIntervalSeconds || 15, adjustedInterval),
            volatilityFactor: volatilityFactor
        };
    } catch (calcError) {
        logApi.error("[TokenRefreshSched] Error in calculateTokenPriority for token " + token?.id + " (" + token?.symbol + "):", calcError);
        return null; // Return null if any error occurs during calculation
    }
  }

  /**
   * Calculate volatility factor based on recent price changes
   * @param {Object} token - Token object from database
   * @returns {number} Volatility factor (1.0 is baseline)
   */
  calculateVolatilityFactor(token) {
    // Default factor if no history is available
    let volatilityFactor = 1.0;
    
    // If we have price change data, calculate based on frequency
    if (token.last_price_change && token.last_refresh_success) {
      const priceChangeTime = new Date(token.last_price_change).getTime();
      const lastRefreshTime = new Date(token.last_refresh_success).getTime();
      
      // Only use data if we have recent refreshes (last 24 hours)
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      if (lastRefreshTime > oneDayAgo) {
        // Calculate elapsed time since last price change
        const hoursSinceChange = (Date.now() - priceChangeTime) / (60 * 60 * 1000);
        
        if (hoursSinceChange < 1) {
          // Changed in last hour - high volatility
          volatilityFactor = 2.0;
        } else if (hoursSinceChange < 3) {
          // Changed in last 3 hours - moderate volatility
          volatilityFactor = 1.5;
        } else if (hoursSinceChange < 6) {
          // Changed in last 6 hours - slight volatility
          volatilityFactor = 1.2;
        } else if (hoursSinceChange > 48) {
          // No change in 48+ hours - very stable
          volatilityFactor = 0.8;
        } else if (hoursSinceChange > 24) {
          // No change in 24+ hours - stable
          volatilityFactor = 0.9;
        }
      }
    }
    
    return volatilityFactor;
  }

  /**
   * Calculate next refresh time for a token
   * @param {Object} token - Token object from database
   * @param {Object} priorityData - Priority data from calculateTokenPriority
   * @returns {number} Timestamp when token should next be refreshed
   */
  calculateNextRefreshTime(token, priorityData) {
    const now = Date.now();
    
    // Get last successful refresh time
    const lastRefreshTime = token.last_refresh_success
      ? new Date(token.last_refresh_success).getTime()
      : (token.last_refresh_attempt
          ? new Date(token.last_refresh_attempt).getTime()
          : now - (24 * 60 * 60 * 1000)); // Default to 24h ago if no history
    
    // Calculate time elapsed since last refresh
    const elapsedMs = now - lastRefreshTime;
    
    // Get refresh interval (in ms)
    const intervalMs = priorityData.refreshInterval * 1000;
    
    // Calculate when next refresh is due
    if (elapsedMs >= intervalMs) {
      // Already overdue - schedule immediately
      return now;
    } else {
      // Schedule at appropriate time
      return lastRefreshTime + intervalMs;
    }
  }

  /**
   * Start the scheduler
   */
  async start() {
    if (this.isRunning) {
      logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Scheduler is already running`);
      return;
    }
    
    // Mark as running
    this.isRunning = true;
    
    // Reset state
    this.lastBatchStartTime = null;
    this.consecutiveFailures = 0;
    this.apiCallsInCurrentWindow = 0;
    this.rateLimitWindowStartTime = Date.now();
    
    // Clear any existing interval
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
    }
    
    // Run immediately
    await this.runSchedulerCycle();
    
    // Set up interval for scheduler cycles
    this.schedulerInterval = setInterval(
      this.runSchedulerCycle.bind(this),
      5000 // Check for due tokens every 5 seconds
    );
    
    logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} STARTED ${fancyColors.RESET} Token refresh scheduler started`);
  }

  /**
   * Stop the scheduler
   */
  async stop() {
    if (!this.isRunning) {
      logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Scheduler is not running`);
      return;
    }
    
    // Mark as not running
    this.isRunning = false;
    
    // Clear scheduler interval
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    
    // Clear metrics interval
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} STOPPED ${fancyColors.RESET} Token refresh scheduler stopped`);
  }

  /**
   * Run a single scheduler cycle
   */
  async runSchedulerCycle() {
    try {
      if (!this.isRunning) return;
      
      // Check if the scheduler is initialized properly
      if (!this.isInitialized) {
        logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Scheduler not fully initialized, attempting re-initialization...`);
        try {
          // Attempt to initialize from scratch
          const initResult = await this.initialize();
          if (!initResult) {
            throw new Error("Scheduler re-initialization failed");
          }
        } catch (initError) {
          logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Re-initialization error:`, initError);
          this.consecutiveFailures++;
          const backoffMs = Math.min(1000 * Math.pow(2, this.consecutiveFailures), 30000);
          logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Backing off for ${backoffMs}ms after initialization failure`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          return; // Exit cycle after initialization failure
        }
      }
      
      // Ensure all components are initialized
      if (!this.priorityQueue || !this.rankAnalyzer || !this.batchOptimizer || !this.metricsCollector) {
        logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Components not initialized. Trying to re-initialize...`);
        try {
          // Re-initialize component objects
          this.priorityQueue = new PriorityQueue(this.config);
          this.rankAnalyzer = new TokenRankAnalyzer(this.config);
          this.batchOptimizer = new BatchOptimizer(this.config);
          this.metricsCollector = new MetricsCollector(this.config);
          
          // Load active tokens
          await this.loadActiveTokens();
          
          // Validate that components are now initialized
          if (!this.priorityQueue || !this.rankAnalyzer || !this.batchOptimizer || !this.metricsCollector) {
            throw new Error("Scheduler components still null after re-initialization attempt");
          }
          
          logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.GREEN}Successfully re-initialized scheduler components${fancyColors.RESET}`);
        } catch (componentError) {
          logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Component re-initialization error:`, componentError);
          this.consecutiveFailures++;
          const backoffMs = Math.min(1000 * Math.pow(2, this.consecutiveFailures), 30000);
          logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Backing off for ${backoffMs}ms after component initialization failure`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          return; // Exit cycle after component initialization failure
        }
      }
      
      // Check for rate limit window reset
      this.checkRateLimitWindow();
      
      // Calculate how many API calls we can make in this cycle
      const availableApiCalls = this.calculateAvailableApiCalls();
      
      if (availableApiCalls <= 0) {
        if (this.debugMode) {
          logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Rate limit reached, skipping cycle`);
        }
        return;
      }
      
      // Double-check priorityQueue is initialized before using getDueItems
      if (!this.priorityQueue) {
        logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Priority queue still not initialized. Cannot continue cycle.`);
        return;
      }
      
      // Get due tokens from priority queue
      let dueTokens = [];
      try {
        const currentTime = Date.now();
        dueTokens = this.priorityQueue.getDueItems(currentTime, availableApiCalls * this.config.maxTokensPerBatch);
      } catch (queueError) {
        logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Error getting due items from priority queue:`, queueError);
        this.consecutiveFailures++;
        return; // Exit the cycle
      }
      
      if (dueTokens.length === 0) {
        if (this.debugMode) {
          logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} No tokens due for refresh`);
        }
        return;
      }
      
      // Double-check batchOptimizer is initialized
      if (!this.batchOptimizer) {
        logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Batch optimizer not initialized. Cannot create batches.`);
        return;
      }
      
      // Organize tokens into optimized batches
      let batches = [];
      try {
        batches = this.batchOptimizer.createBatches(dueTokens, {
          maxTokensPerBatch: this.config.maxTokensPerBatch,
          maxBatches: availableApiCalls
        });
      } catch (batchError) {
        logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Error creating batches:`, batchError);
        this.consecutiveFailures++;
        return; // Exit the cycle
      }
      
      if (batches.length === 0) {
        return;
      }
      
      // Initialize batch progress tracker
      const totalTokenCount = batches.reduce((sum, batch) => sum + batch.length, 0);
      const progress = createBatchProgress({
        name: 'Token Refresh',
        total: batches.length,
        service: this.name,
        operation: 'token_price_refresh',
        category: 'scheduler',
        metadata: {
          total_tokens: totalTokenCount,
          due_tokens: dueTokens.length,
          available_api_calls: availableApiCalls,
          rate_limit_adjustment: this.rateLimitAdjustmentFactor,
          scheduler_cycle: Date.now()
        }
      });
      
      // Start the progress tracker
      progress.start();

      // Execute batches sequentially with proper rate limiting
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        // Skip if scheduler was stopped
        if (!this.isRunning) {
          progress.finish({ message: "Token refresh interrupted - scheduler stopped" });
          break;
        }
        
        const batch = batches[batchIndex];
        const batchNum = batchIndex + 1;
        
        // Update progress with current batch info
        const tokenExamples = batch.slice(0, 3)
          .map(token => token.symbol || `ID:${token.id}`)
          .join(', ');
        
        progress.update(0, [`Processing batch ${batchNum}/${batches.length} (${batch.length} tokens, e.g. ${tokenExamples}...)`]);
        
        try {
          // Process the batch and track timing
          const batchStartTime = Date.now();
          await this.processBatch(batch, batchNum, batches.length);
          const batchDuration = Date.now() - batchStartTime;
          
          // Mark batch complete with timing
          progress.completeBatch(batchNum, batch.length, [`${batch.length} tokens updated`], batchDuration);
          
          // Add calculated delay between batches based on rate limit
          if (batchIndex < batches.length - 1) {
            // Use a minimum delay that respects API rate limits
            const minDelayMs = Math.max(this.config.batchDelayMs, 2000); // At least 2000ms between batches
            
            // Add exponential backoff if we've had any failures
            if (this.consecutiveFailures > 0) {
              const backoffFactor = Math.min(Math.pow(2, this.consecutiveFailures), 15);
              const backoffMs = minDelayMs * backoffFactor;
              progress.update(0, [`Adding ${backoffMs}ms delay (backoff factor: ${backoffFactor})`]);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            } else {
              // Normal delay - update progress
              progress.update(0, [`Standard delay ${minDelayMs}ms between batches`]);
              await new Promise(resolve => setTimeout(resolve, minDelayMs));
            }
          }
        } catch (error) {
          // Track batch error
          progress.trackError(
            batchNum,
            error,
            false, // Not fatal, will continue with other batches
            error.response?.status || null,
            error.name || 'ProcessingError'
          );
        }
      }
      
      // Complete the progress tracker
      progress.finish({
        message: `Token refresh complete: ${totalTokenCount} tokens in ${batches.length} batches`
      });
      
      // If we got here, reset consecutive failures as the cycle completed successfully
      if (this.consecutiveFailures > 0) {
        logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.GREEN}Scheduler cycle completed successfully after previous failures. Resetting failure counter.${fancyColors.RESET}`);
        this.consecutiveFailures = 0;
      }
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Error in scheduler cycle:`, error);
      this.consecutiveFailures++;
      
      // If too many consecutive failures, back off
      if (this.consecutiveFailures > 5) {
        const backoffMs = Math.min(1000 * Math.pow(2, this.consecutiveFailures - 5), 30000);
        logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Too many failures, backing off for ${backoffMs}ms`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  /**
   * Check if rate limit window needs to be reset
   */
  checkRateLimitWindow() {
    const now = Date.now();
    const windowSizeMs = 1000; // 1 second window
    
    if (now - this.rateLimitWindowStartTime >= windowSizeMs) {
      // Reset window
      this.rateLimitWindowStartTime = now;
      this.apiCallsInCurrentWindow = 0;
    }
  }

  /**
   * Calculate how many API calls we can make right now
   * @returns {number} Number of available API calls
   */
  calculateAvailableApiCalls() {
    // Calculate how many calls we can make in the current window
    const limitPerWindow = Math.floor(this.config.apiRateLimit * this.rateLimitAdjustmentFactor);
    const remainingCalls = Math.max(0, limitPerWindow - this.apiCallsInCurrentWindow);
    return remainingCalls;
  }

  /**
   * Process a batch of tokens
   * @param {Object[]} batch - Array of token objects to refresh
   * @param {number} batchNum - Current batch number (1-based)
   * @param {number} totalBatches - Total number of batches
   */
  async processBatch(batch, batchNum = 1, totalBatches = 1) {
    const batchStartTime = Date.now();
    this.checkRateLimitWindow(); // Ensure rate limit window is current

    // Defensive check for apiCallsInCurrentWindow
    if (typeof this.apiCallsInCurrentWindow !== 'number') {
      logApi.warn(`[TokenRefreshScheduler.processBatch] apiCallsInCurrentWindow was not a number (${typeof this.apiCallsInCurrentWindow}). Initializing to 0.`);
      this.apiCallsInCurrentWindow = 0;
    }

    if (!batch || batch.length === 0) {
      logApi.debug('[TokenRefreshScheduler.processBatch] Empty batch, skipping.');
      return { processed: 0, successful: 0, failed: 0, durationMs: 0, pricedTokens: new Set() };
    }

    const tokenAddresses = batch.map(t => t.address);
    // Reduce verbosity for small batches (typically test refreshes)
    if (batch.length <= 5) {
      logApi.debug(`[TokenRefreshScheduler.processBatch] Processing batch ${batchNum}/${totalBatches} with ${batch.length} tokens. Addresses: ${tokenAddresses.slice(0,5).join(', ')}...`);
    } else {
      logApi.info(`[TokenRefreshScheduler.processBatch] Processing batch ${batchNum}/${totalBatches} with ${batch.length} tokens. Addresses: ${tokenAddresses.slice(0,5).join(', ')}...`);
    }

    let priceData = null;
    let fetchSuccess = false;
    let pricedTokensInBatch = new Set();

    try {
      // Ensure we are using the instance property `this.jupiterClient`
      if (!this.jupiterClient || typeof this.jupiterClient.getPrices !== 'function') {
        logApi.error(`${formatLog.tag()} [processBatch] JupiterClient or getPrices method is undefined when attempting to fetch prices.`);
        throw new Error('JupiterClient not available in processBatch');
      }
      priceData = await this.jupiterClient.getPrices(tokenAddresses);
      fetchSuccess = true; // Assume success if no exception
      logApi.debug(`[TokenRefreshScheduler.processBatch] JupiterClient.getPrices returned for batch ${batchNum}. Found prices for ${Object.keys(priceData || {}).length} tokens.`);

    } catch (error) {
      logApi.error(`${formatLog.tag()} [processBatch] Error fetching prices from JupiterClient for batch ${batchNum}: ${error.message}`, { 
        error: error.message, // Pass only message to avoid circular issues if error is complex
        batchTokenCount: batch.length,
      });
      // Mark all tokens in this batch as failed for this attempt and requeue them
      batch.forEach(token => {
        this.trackFailedToken(token);
        this.requeueWithBackoff(token); // Requeue with backoff due to API error
      });
      if (this.metricsCollector && typeof this.metricsCollector.recordBatchFailure === 'function') {
        this.metricsCollector.recordBatchFailure(batch.length, Date.now() - batchStartTime, error.message);
      }
      return { processed: batch.length, successful: 0, failed: batch.length, durationMs: Date.now() - batchStartTime, pricedTokens: pricedTokensInBatch };
    }

    // Update token prices in DB and handle requeuing
    // DEGENS: This call will now only use the `priceData` from the single batch call.
    // No internal individual retries will happen in `updateTokenPrices`.
    const { updatedCount, failedToPriceCount, successfullyPricedTokens } = await this.updateTokenPrices(batch, priceData);
    pricedTokensInBatch = successfullyPricedTokens;

    const batchDuration = Date.now() - batchStartTime;
    if (updatedCount > 0 || failedToPriceCount > 0) { // Only record if there was an attempt
        this.metricsCollector.recordBatchCompletion(updatedCount + failedToPriceCount, batchDuration, updatedCount, failedToPriceCount);
    }
    
    // Reduce verbosity for small batches
    if (batch.length <= 5) {
      logApi.debug(`[TokenRefreshScheduler.processBatch] Batch ${batchNum}/${totalBatches} completed. Processed: ${batch.length}, Updated in DB: ${updatedCount}, Failed to price: ${failedToPriceCount}. Duration: ${batchDuration}ms`);
    } else {
      logApi.info(`[TokenRefreshScheduler.processBatch] Batch ${batchNum}/${totalBatches} completed. Processed: ${batch.length}, Updated in DB: ${updatedCount}, Failed to price: ${failedToPriceCount}. Duration: ${batchDuration}ms`);
    }

    // Update rate limit window
    this.apiCallsInCurrentWindow += Math.ceil(tokenAddresses.length / (this.jupiterClient.prices.batchSize || 90)); // Estimate API calls made by JupiterClient

    return {
      processed: batch.length,
      successful: updatedCount,
      failed: failedToPriceCount,
      durationMs: batchDuration,
      pricedTokens: pricedTokensInBatch
    };
  }

  /**
   * Update token prices in database
   * @param {Object[]} batch - Array of token objects being processed
   * @param {Object} priceData - Price data from Jupiter API
   */
  async updateTokenPrices(batch, priceData) {
    const startTime = Date.now();
    let updatedCount = 0;
    let failedToPriceCount = 0;
    const tokensForRequeue = []; 
    const successfullyPricedTokens = new Set(); 

    logApi.debug(`${formatLog.tag()} [updateTokenPrices] Updating prices for batch of ${batch.length} tokens. Received ${Object.keys(priceData || {}).length} price entries.`);

    // -- CURSOR AI MODIFICATION START --
    const tokenPriceUpsertOps = [];
    const tokenMetaUpdateOps = [];

    for (const token of batch) { 
      const currentPriceInfo = priceData ? priceData[token.address] : null;

      if (currentPriceInfo && currentPriceInfo.price !== undefined && currentPriceInfo.price !== null) {
        const newPrice = parseFloat(currentPriceInfo.price);
        if (isNaN(newPrice)) {
            logApi.warn(`${formatLog.tag()} [updateTokenPrices] Invalid price NaN for ${token.symbol || token.address}. Skipping price update.`);
            failedToPriceCount++;
            this.trackFailedToken(token); 
            continue;
        }

        const existingTokenPriceRecord = await prisma.token_prices.findUnique({
            where: { token_id: token.id },
            select: { price: true }
        });
        const oldPrice = existingTokenPriceRecord ? parseFloat(existingTokenPriceRecord.price) : null;
        const priceChanged = oldPrice !== newPrice;

        tokenPriceUpsertOps.push({
          where: { token_id: token.id },
          update: {
            price: newPrice,
            updated_at: new Date(),
            // Add other fields here if JupiterClient.getPrices provides them (e.g., market_cap, volume_24h)
            // market_cap: currentPriceInfo.marketCap ? parseFloat(currentPriceInfo.marketCap) : null,
            // volume_24h: currentPriceInfo.volume?.h24 ? parseFloat(currentPriceInfo.volume.h24) : null,
          },
          create: {
            token_id: token.id,
            price: newPrice,
            updated_at: new Date(),
            // market_cap: currentPriceInfo.marketCap ? parseFloat(currentPriceInfo.marketCap) : null,
            // volume_24h: currentPriceInfo.volume?.h24 ? parseFloat(currentPriceInfo.volume.h24) : null,
          },
        });

        const tokenTableUpdateData = {
          last_refresh_success: new Date(),
          // consecutive_failed_refreshes: 0, // This field does not exist in the schema
          // last_jupiter_response_id: currentPriceInfo.id, // Uncomment if you have this field on tokens table
        };
        if (priceChanged) {
            tokenTableUpdateData.last_price_change = new Date();
        }
        tokenMetaUpdateOps.push({
            where: { id: token.id },
            data: tokenTableUpdateData
        });

        serviceEvents.emit(SERVICE_EVENTS.TOKEN_PRICE_UPDATED, {
          tokenId: token.id,
          address: token.address,
          symbol: token.symbol,
          newPrice: newPrice,
          oldPrice: oldPrice,
          source: 'jupiter', // Or more generic like 'TokenRefreshScheduler'
          timestamp: new Date(),
        });
        
        if (this.metricsCollector && typeof this.metricsCollector.recordTokenPriceUpdate === 'function') {
            this.metricsCollector.recordTokenPriceUpdate(token.address, newPrice, oldPrice);
        }
        successfullyPricedTokens.add(token.address);
        updatedCount++;
        logApi.debug(`[TokenRefreshScheduler] Successfully prepared price update for ${token.symbol || token.address} to ${newPrice}`);
        
        tokensForRequeue.push({ token, priceChanged });

      } else {
        logApi.warn(`[TokenRefreshScheduler] Price not found in Jupiter response for ${token.symbol || token.address}. Will attempt in next cycle.`, { 
          token_id: token.id,
          token_address: token.address
        });
        this.trackFailedToken(token); 
        failedToPriceCount++;
      }
    }

    if (tokenPriceUpsertOps.length > 0 || tokenMetaUpdateOps.length > 0) {
        try {
            await prisma.$transaction(async (tx) => {
                if (tokenMetaUpdateOps.length > 0) {
                    logApi.debug(`${formatLog.tag()} [updateTokenPrices] Updating ${tokenMetaUpdateOps.length} records in 'tokens' table.`);
                    for (const op of tokenMetaUpdateOps) {
                        await tx.tokens.update(op);
                    }
                }
                if (tokenPriceUpsertOps.length > 0) {
                    logApi.debug(`${formatLog.tag()} [updateTokenPrices] Upserting ${tokenPriceUpsertOps.length} records in 'token_prices' table.`);
                    for (const op of tokenPriceUpsertOps) {
                        await tx.token_prices.upsert(op);
                    }
                }
            });
            logApi.debug(`${formatLog.tag()} [updateTokenPrices] Prisma transaction for price updates completed.`);
        } catch (dbError) {
            logApi.error(`[TokenRefreshScheduler] DB transaction error during updateTokenPrices: ${dbError.message}`, { error: dbError });
            failedToPriceCount += batch.length - updatedCount; 
            updatedCount = 0; 
        }
    }
    // -- CURSOR AI MODIFICATION END --

    // Requeue tokens
    for (const { token, priceChanged } of tokensForRequeue) {
      this.requeueWithUpdatedPriority(token, priceChanged);
    }
    
    const duration = Date.now() - startTime;
    logApi.debug(`[TokenRefreshScheduler.updateTokenPrices] Finished. DB Updated: ${updatedCount}, Not Priced: ${failedToPriceCount}. Duration: ${duration}ms`);

    return {
      updatedCount,
      failedToPriceCount,
      successfullyPricedTokens
    };
  }

  /**
   * Track a failed token and implement backoff
   * @param {Object} token - Token that failed to update
   */
  trackFailedToken(token) {
    // Get or initialize failure record
    let failureRecord = this.failedTokens.get(token.id) || {
      failures: 0,
      backoffMs: 1000, // Start with 1s backoff
      lastAttempt: 0
    };
    
    // Update failure record
    failureRecord.failures++;
    failureRecord.lastAttempt = Date.now();
    failureRecord.backoffMs = Math.min(
      failureRecord.backoffMs * 2,  // Exponential backoff
      5 * 60 * 1000                 // Max 5 minute backoff
    );
    
    // Store updated record
    this.failedTokens.set(token.id, failureRecord);
  }

  /**
   * Requeue token with backoff based on failure history
   * @param {Object} token - Token to requeue
   */
  requeueWithBackoff(token) {
    const failureRecord = this.failedTokens.get(token.id);
    if (!failureRecord) {
      // No failure record, requeue normally with small delay
      const nextRefreshTime = Date.now() + 30000; // 30s delay
      this.priorityQueue.enqueue({
        ...token,
        nextRefreshTime
      });
      return;
    }
    
    // Calculate next refresh time with exponential backoff
    const nextRefreshTime = failureRecord.lastAttempt + failureRecord.backoffMs;
    
    // Requeue with same priority but delayed time
    this.priorityQueue.enqueue({
      ...token,
      nextRefreshTime
    });
  }

  /**
   * Requeue token with updated priority based on latest data
   * @param {Object} token - Token to requeue
   * @param {boolean} priceChanged - Whether price has changed
   */
  requeueWithUpdatedPriority(token, priceChanged) {
    // Get cached priority data
    let priorityData = this.prioritizationCache.get(token.id);
    
    // If price changed, adjust volatility factor
    if (priceChanged && priorityData) {
      // Increase volatility factor for more frequent updates
      priorityData.volatilityFactor = Math.min(2.0, priorityData.volatilityFactor * 1.2);
      
      // Update refresh interval based on new volatility
      priorityData.refreshInterval = Math.max(
        this.config.minIntervalSeconds,
        Math.floor(priorityData.refreshInterval / 1.2)
      );
    } else if (!priceChanged && priorityData) {
      // Gradually decrease volatility factor for stable tokens
      priorityData.volatilityFactor = Math.max(0.8, priorityData.volatilityFactor * 0.95);
      
      // Update refresh interval based on decreased volatility
      const maxInterval = 300; // Cap at 5 minutes
      priorityData.refreshInterval = Math.min(
        maxInterval, 
        Math.floor(priorityData.refreshInterval * 1.05)
      );
    }
    
    // Update cache
    if (priorityData) {
      this.prioritizationCache.set(token.id, priorityData);
    }
    
    // Calculate next refresh time
    const intervalMs = (priorityData?.refreshInterval || token.interval || 60) * 1000;
    const nextRefreshTime = Date.now() + intervalMs;
    
    // Requeue with updated parameters
    this.priorityQueue.enqueue({
      ...token,
      priority: priorityData?.score || token.priority,
      nextRefreshTime,
      interval: priorityData?.refreshInterval || token.interval
    });
  }

  /**
   * Start metrics collection
   */
  startMetricsCollection() {
    // Clear any existing interval
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    // Set up interval for metrics reporting
    this.metricsInterval = setInterval(() => {
      try {
        // Get metrics from collector
        const metrics = this.metricsCollector.getMetrics();
        
        // Add scheduler metrics
        metrics.scheduler = {
          activeTokens: this.activeTokens.size,
          failedTokens: this.failedTokens.size,
          lifetimeUpdates: this.lifetimeUpdates,
          lifetimeFailures: this.lifetimeFailures,
          lifetimeBatches: this.lifetimeBatches,
          consecutiveFailures: this.consecutiveFailures,
          queueSize: this.priorityQueue.size(),
          rateLimitAdjustment: this.rateLimitAdjustmentFactor
        };
        
        // Log metrics
        logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} METRICS ${fancyColors.RESET} Token refresh metrics:`, metrics);
        
        // Adaptive rate limit adjustment
        if (this.config.adaptiveRateLimitEnabled) {
          this.adjustRateLimit(metrics);
        }
      } catch (error) {
        logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Error collecting metrics:`, error);
      }
    }, this.config.metricsIntervalMs);
  }

  /**
   * Adaptively adjust rate limit based on performance metrics
   * @param {Object} metrics - Current performance metrics
   */
  adjustRateLimit(metrics) {
    // Don't adjust if we have failures
    if (this.consecutiveFailures > 0) {
      // Reduce rate limit if we're having issues
      this.rateLimitAdjustmentFactor = Math.max(0.5, this.rateLimitAdjustmentFactor * 0.9);
      return;
    }
    
    // Get success rate from metrics
    const successRate = metrics.batchStats?.successRate || 1.0;
    
    if (successRate < 0.9) {
      // Below 90% success - reduce rate limit
      this.rateLimitAdjustmentFactor = Math.max(0.5, this.rateLimitAdjustmentFactor * 0.95);
    } else if (successRate > 0.98 && this.rateLimitAdjustmentFactor < 1.0) {
      // Above 98% success and not at full rate - increase slightly
      this.rateLimitAdjustmentFactor = Math.min(1.0, this.rateLimitAdjustmentFactor * 1.05);
    }
    
    // Log adjustment if it changes significantly
    if (Math.abs(this.rateLimitAdjustmentFactor - 1.0) > 0.1) {
      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Adjusted rate limit factor to ${this.rateLimitAdjustmentFactor.toFixed(2)}`);
    }
  }

  /**
   * Implements the required onPerformOperation method from BaseService
   * This method will be called by the performOperation method in the BaseService class
   * @returns {Promise<boolean>}
   */
  async onPerformOperation() {
    try {
      // Check if service is operational
      if (!this.isOperational || !this.isRunning) {
        logApi.debug(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Service not operational, skipping operation`);
        return true;
      }
      
      // The service already runs via its own scheduler intervals,
      // so we don't need to perform any operation here.
      // This method is primarily needed for circuit breaker recovery.
      
      // We can run a basic health check to ensure the scheduler is functioning
      const metrics = this.metricsCollector?.getMetrics() || {};
      
      // Report health status
      logApi.debug(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Service health check: OK (activeTokens: ${this.activeTokens.size}, queueSize: ${this.priorityQueue?.size() || 0})`);
      
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.RED}Operation error:${fancyColors.RESET} ${error.message}`);
      throw error; // Re-throw to let BaseService handle the error
    }
  }
}

// Token refresh scheduler helper modules -----------------------

// Create and export the token refresh scheduler singleton
const tokenRefreshScheduler = new TokenRefreshScheduler();
export default tokenRefreshScheduler;