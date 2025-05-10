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
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
// Prisma
import { prisma } from '../config/prisma.js';
// Solana Engine
import { jupiterClient, getJupiterClient } from './solana-engine/jupiter-client.js';
import { heliusClient } from './solana-engine/helius-client.js';
// Logger and Progress Utilities
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
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

/**
 * TokenRefreshScheduler - Advanced scheduling system for token price updates
 */
class TokenRefreshScheduler extends BaseService {
  constructor() {
    super({
      name: 'TokenRefreshScheduler',
      description: 'Advanced token refresh scheduling system',
      layer: 'DATA_PROCESSING',
      criticalLevel: 'medium',
      checkIntervalMs: 10000 // Health check every 10 seconds
    });

    // Configuration (will be loaded from db/env)
    this.config = {
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
    try {
      // Get active tokens from database with their refresh settings
      const tokens = await prisma.tokens.findMany({
        where: {
          is_active: true
        },
        select: {
          id: true,
          address: true,
          symbol: true,
          refresh_interval_seconds: true,
          priority_score: true,
          last_refresh_attempt: true,
          last_refresh_success: true,
          last_price_change: true,
          token_prices: {
            select: {
              price: true,
              updated_at: true,
              volume_24h: true,
              liquidity: true
            }
          },
          // Select contest-related fields to determine activity
          contest_portfolios: {
            take: 1,
            select: { id: true }
          },
          // Get latest rank from token_rank_history
          rank_history: {
            orderBy: {
              timestamp: 'desc'
            },
            take: 1,
            select: {
              rank: true,
              timestamp: true
            }
          }
        }
      });

      if (!tokens || tokens.length === 0) {
        logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} No active tokens found in DB to load into priority queue.`);
        this.activeTokens.clear();
        this.priorityQueue.clear(); // Assuming PriorityQueue has a clear method
        this.prioritizationCache.clear();
        return 0; // Return 0 if no active tokens
      }

      this.activeTokens.clear();
      this.priorityQueue.clear(); // Clear before repopulating
      this.prioritizationCache.clear();
      
      for (const token of tokens) {
        this.activeTokens.add(token.id);
        const priorityData = this.calculateTokenPriority(token); // This now needs to be more robust
        if (priorityData) { // Ensure priorityData is not null/undefined
          this.prioritizationCache.set(token.id, priorityData);
          this.priorityQueue.enqueue({
            id: token.id,
            address: token.address,
            symbol: token.symbol,
            priority: priorityData.score,
            nextRefreshTime: this.calculateNextRefreshTime(token, priorityData),
            interval: priorityData.refreshInterval
          });
        } else {
          logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Could not calculate priority for token ID ${token.id} (${token.symbol}), skipping enqueue.`);
        }
      }
      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Loaded ${this.priorityQueue.size()} active tokens into priority queue.`);
      const tokenStats = this.rankAnalyzer.analyzeTokenDistribution(tokens);
      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Token distribution analysis:`, tokenStats);
      return this.activeTokens.size; // Return current count of active tokens processed
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Error loading active tokens:`, error);
      // Do not re-throw here to allow scheduler to potentially recover or wait for data, but log it.
      // Or, if this is critical for initialization, it should re-throw and be caught by initialize().
      // For now, let initialize catch it if it bubbles up.
      throw error;
    }
  }

  /**
   * Calculate token priority based on various factors
   * @param {Object} token - Token object from database
   * @returns {Object} Priority data including score and refresh interval
   */
  calculateTokenPriority(token) {
    if (!token) return null; // Guard clause
    let priorityScore = token.priority_score || 0;
    let latestRank = token.rank_history && token.rank_history.length > 0 ? token.rank_history[0].rank : undefined;
    let baseTier = null;
    const tierNames = Object.keys(PRIORITY_TIERS);
    const sortedTiers = [...tierNames].sort((a, b) => PRIORITY_TIERS[b].rank_threshold - PRIORITY_TIERS[a].rank_threshold);
    
    if (latestRank === undefined) {
      baseTier = PRIORITY_TIERS[sortedTiers[0]] || PRIORITY_TIERS.MINIMAL; // Fallback to MINIMAL if sortedTiers[0] is somehow undefined
    } else {
      for (const tierName of sortedTiers) {
        if (PRIORITY_TIERS[tierName] && latestRank <= PRIORITY_TIERS[tierName].rank_threshold) {
          baseTier = PRIORITY_TIERS[tierName];
        } else if (PRIORITY_TIERS[tierName]) { // Current rank is greater than this tier's threshold, so it must be in a lower (or this) tier
          break;
        } else { // Should not happen if PRIORITY_TIERS is correctly populated
          logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Missing tier definition for: ${tierName} in PRIORITY_TIERS`);
        }
      }
      if (!baseTier) baseTier = PRIORITY_TIERS[sortedTiers[0]] || PRIORITY_TIERS.MINIMAL; // Fallback
    }
    
    if (!baseTier || !baseTier.score === undefined) { // Ensure baseTier is valid and has a score
      logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Could not determine base tier for token ${token.id} (${token.symbol}). Using default priority.`);
      baseTier = { name: 'DEFAULT_FALLBACK', score: 50, interval: 300, volatility_factor: 1.0 };
    }
    if (token.contest_portfolios && token.contest_portfolios.length > 0) {
      const highTierName = tierNames.find(name => PRIORITY_TIERS[name].score >= 500) || 'HIGH'; // Find a high-ish tier
      const highTier = PRIORITY_TIERS[highTierName] || baseTier; // Fallback to current baseTier if HIGH not found
      if (baseTier.score < highTier.score) baseTier = highTier;
      priorityScore += 300;
    }
    const tokenPriceData = token.token_prices; // This is an object, not an array
    if (tokenPriceData && tokenPriceData.volume_24h !== null && tokenPriceData.volume_24h !== undefined) {
      try {
        const volume = parseFloat(tokenPriceData.volume_24h.toString());
        if (!isNaN(volume)) {
          if (volume > 1000000) priorityScore += 200;
          else if (volume > 100000) priorityScore += 100;
          else if (volume > 10000) priorityScore += 50;
        }
      } catch (e) { logApi.warn('Error parsing volume for priority calc', e); }
    }
    const volatilityFactor = this.calculateVolatilityFactor(token);
    const baseInterval = token.refresh_interval_seconds || baseTier.interval || DEFAULT_MIN_INTERVAL_SECONDS;
    let adjustedInterval = Math.max(
      this.config.minIntervalSeconds,
      Math.floor(baseInterval / (volatilityFactor * (baseTier.volatility_factor || 1.0))
    ));
    if (this.config.dynamicIntervalsEnabled) {
      adjustedInterval = Math.min(adjustedInterval, baseTier.interval || DEFAULT_MIN_INTERVAL_SECONDS * 10);
    } else {
      adjustedInterval = baseInterval;
    }
    return {
      score: priorityScore + (baseTier.score || 0), // Add baseTier score to the calculated one
      baseTier: baseTier.name || 'UNKNOWN',
      refreshInterval: Math.max(this.config.minIntervalSeconds, adjustedInterval), // Ensure min interval
      volatilityFactor: volatilityFactor
    };
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
    this.lastBatchStartTime = Date.now();
    this.currentBatch = batch;
    
    // Set metadata on the batch for Jupiter to use in its logs
    batch.source_service = 'token_refresh_scheduler';
    batch.batch_group = `group-${new Date().getHours()}-${Math.floor(Date.now()/300000)}`; // 5-min groups for tracking
    
    // Increment API call counter
    this.apiCallsInCurrentWindow++;
    this.lifetimeBatches++;
    
    // Extract addresses for the batch
    const tokenAddresses = batch.map(token => token.address);
    
    // Fetch prices from Jupiter API - now includes batch numbering internally
    const priceData = await jupiterClient.getPrices(tokenAddresses);
    
    if (!priceData) {
      throw new Error(`Jupiter API returned empty price data for batch ${batchNum}/${totalBatches}`);
    }
    
    // Track successful result
    this.consecutiveFailures = 0;
    
    // Process results and update database
    await this.updateTokenPrices(batch, priceData);
    
    // Record completion time for metrics
    const batchDuration = Date.now() - this.lastBatchStartTime;
    this.metricsCollector.recordBatchCompletion(batch.length, batchDuration);
    
    // Clear current batch reference
    this.currentBatch = null;
    
    // Return the duration for the progress tracker
    return batchDuration;
  }

  /**
   * Update token prices in database
   * @param {Object[]} batch - Array of token objects being processed
   * @param {Object} priceData - Price data from Jupiter API
   */
  async updateTokenPrices(batch, priceData) {
    const updatePromises = [];
    const now = new Date();
    let updatedCount = 0;
    
    for (const token of batch) {
      // Get price from Jupiter data
      const price = priceData[token.address];
      
      if (price) {
        // Queue database update
        updatePromises.push(
          prisma.tokens.update({
            where: { id: token.id },
            data: { 
              last_refresh_success: now,
              last_refresh_attempt: now
            }
          })
        );
        
        // Get current price from database
        const currentPriceRecord = await prisma.token_prices.findUnique({
          where: { token_id: token.id },
          select: { price: true }
        });
        
        // Determine if price has changed
        const currentPrice = currentPriceRecord?.price;
        const newPrice = price.price;
        const priceChanged = !currentPrice || 
                             currentPrice.toString() !== newPrice.toString();
        
        // Update price if it exists
        if (currentPriceRecord) {
          updatePromises.push(
            prisma.token_prices.update({
              where: { token_id: token.id },
              data: {
                price: newPrice,
                updated_at: now
              }
            })
          );
        } else {
          // Create new price record if it doesn't exist
          updatePromises.push(
            prisma.token_prices.create({
              data: {
                token_id: token.id,
                price: newPrice,
                updated_at: now
              }
            })
          );
        }
        
        // If price has changed, update last_price_change and add to history
        if (priceChanged) {
          // Update last_price_change timestamp
          updatePromises.push(
            prisma.tokens.update({
              where: { id: token.id },
              data: { last_price_change: now }
            })
          );
          
          // Add entry to price history
          updatePromises.push(
            prisma.token_price_history.create({
              data: {
                token_id: token.id,
                price: newPrice,
                source: 'jupiter_api',
                timestamp: now
              }
            })
          );
          
          // Requeue with updated priority
          this.requeueWithUpdatedPriority(token, true);
        } else {
          // Requeue with same priority
          this.requeueWithUpdatedPriority(token, false);
        }
        
        updatedCount++;
      } else {
        // Price not found in response
        updatePromises.push(
          prisma.tokens.update({
            where: { id: token.id },
            data: { last_refresh_attempt: now }
          })
        );
        
        // Track failed token and implement backoff
        this.trackFailedToken(token);
        
        // Requeue with backoff
        this.requeueWithBackoff(token);
      }
      
      // Update metrics
      this.lifetimeUpdates += updatedCount;
    }
    
    // Execute all database updates
    await Promise.all(updatePromises);
    
    // Log summary
    logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Updated ${updatedCount}/${batch.length} token prices`);
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