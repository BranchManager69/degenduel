/**
 * Token Refresh Integration Module
 * 
 * This module integrates the advanced token refresh scheduler with the rest of the system,
 * exposing its capabilities to other services in a controlled way.
 */

import { BaseService } from '../utils/service-suite/base-service.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import { PrismaClient } from '@prisma/client';
import tokenRefreshScheduler from './token-refresh-scheduler.js';
import serviceManager from '../utils/service-suite/service-manager.js';
import serviceEvents from '../utils/service-suite/service-events.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
import { config } from '../config/config.js';

// Initialize Prisma client
const prisma = new PrismaClient();

// Service configuration
const TOKEN_REFRESH_CONFIG = {
  name: 'token_refresh_scheduler_service',
  displayName: 'Token Refresh Scheduler',
  description: 'Advanced service for optimally scheduling token price updates',
  intervalMs: 0, // No automatic interval - managed internally
  dependencies: [
    SERVICE_NAMES.MARKET_DATA, 
    SERVICE_NAMES.SOLANA_ENGINE,
    SERVICE_NAMES.CONTEST_WALLET  // Add dependency on contest wallet service to ensure it completes certification first
  ],
  emoji: '🔄',
  // Add circuit breaker configuration to fix errors
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    resetTimeoutMs: 30000
  }
};

/**
 * Initialize the token refresh system
 */
export const initializeTokenRefresh = async () => {
  try {
    logApi.info(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Initializing token refresh integration`);
    
    // Check if service is disabled in the current profile
    if (!config.services.token_refresh_scheduler) {
      logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Token Refresh Scheduler is disabled in the '${config.services.active_profile}' service profile`);
      // Still mark as initialized but don't start the scheduler
      logApi.info(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Token refresh integration ready`);
      return true;
    }
    
    // Initialize the scheduler
    await tokenRefreshScheduler.initialize();
    
    // Register the scheduler with the service manager
    // This is already registered now, so we don't need to do it again
    // serviceManager.register(tokenRefreshScheduler);
    
    // Set up event listeners for market data
    setupEventListeners();
    
    // Start the scheduler
    await tokenRefreshScheduler.start();
    
    logApi.info(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Token refresh integration ready`);
    return true;
  } catch (error) {
    logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Initialization error:`, error);
    return false;
  }
};

/**
 * Set up event listeners to sync with other services
 */
export const setupEventListeners = () => {
  // Listen for token sync events from MarketDataService
  serviceEvents.on('market:tokens-updated', async (data) => {
    try {
      if (data && Array.isArray(data.updatedTokens) && data.updatedTokens.length > 0) {
        logApi.info(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Received token update event for ${data.updatedTokens.length} tokens`);
        
        // Reload active tokens
        await tokenRefreshScheduler.loadActiveTokens();
      }
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Error handling token update event:`, error);
    }
  });
  
  // Listen for circuit breaker events
  serviceEvents.on('circuitBreaker:tripped', async (data) => {
    if (data && data.serviceName === SERVICE_NAMES.MARKET_DATA) {
      logApi.warn(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Market data circuit breaker tripped, pausing scheduler`);
      
      // Pause the scheduler
      await tokenRefreshScheduler.stop();
    }
  });
  
  serviceEvents.on('circuitBreaker:reset', async (data) => {
    if (data && data.serviceName === SERVICE_NAMES.MARKET_DATA) {
      logApi.info(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Market data circuit breaker reset, resuming scheduler`);
      
      // Resume the scheduler
      await tokenRefreshScheduler.start();
    }
  });
};

/**
 * Manually refresh a specific token
 * @param {string} tokenAddress - Token address to refresh
 * @returns {Promise<Object>} Refresh result
 */
export const refreshToken = async (tokenAddress) => {
  try {
    // Find token in database
    const token = await prisma.tokens.findFirst({
      where: { address: tokenAddress },
      select: {
        id: true,
        address: true,
        symbol: true,
        refresh_interval_seconds: true
      }
    });
    
    if (!token) {
      throw new Error(`Token not found: ${tokenAddress}`);
    }
    
    // Create a single-token batch
    const batch = [{
      id: token.id,
      address: token.address,
      symbol: token.symbol,
      priority: 1000, // High priority
      nextRefreshTime: Date.now(), // Due now
      interval: token.refresh_interval_seconds || 30
    }];
    
    // Process the batch
    await tokenRefreshScheduler.processBatch(batch);
    
    return { success: true, message: `Refreshed token ${token.symbol || token.address}` };
  } catch (error) {
    logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Error refreshing token:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Update token refresh settings
 * @param {number} tokenId - Token ID to update
 * @param {Object} settings - New refresh settings
 * @returns {Promise<Object>} Update result
 */
export const updateTokenRefreshSettings = async (tokenId, settings) => {
  try {
    // Validate settings
    if (settings.refresh_interval_seconds && 
        (settings.refresh_interval_seconds < 15 || settings.refresh_interval_seconds > 3600)) {
      throw new Error('Refresh interval must be between 15 seconds and 1 hour');
    }
    
    // Update token in database
    await prisma.tokens.update({
      where: { id: tokenId },
      data: {
        refresh_interval_seconds: settings.refresh_interval_seconds,
        priority_score: settings.priority_score,
        refresh_metadata: settings.metadata
      }
    });
    
    // Reload active tokens to apply new settings
    await tokenRefreshScheduler.loadActiveTokens();
    
    return { success: true, message: `Updated refresh settings for token ID ${tokenId}` };
  } catch (error) {
    logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Error updating token refresh settings:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Get scheduler metrics
 * @returns {Promise<Object>} Current metrics
 */
export const getSchedulerMetrics = async () => {
  try {
    // Check if scheduler is initialized
    if (!tokenRefreshScheduler.isInitialized) {
      return { error: 'Scheduler not initialized' };
    }
    
    // Check if the metrics collector is initialized
    if (!tokenRefreshScheduler.metricsCollector) {
      logApi.warn(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Metrics collector not initialized, attempting re-initialization`);
      
      // Try to reinitialize core components
      try {
        // Re-initialize components if needed
        if (!tokenRefreshScheduler.metricsCollector) {
          const MetricsCollector = (await import('./token-refresh-scheduler/metrics-collector.js')).default;
          tokenRefreshScheduler.metricsCollector = new MetricsCollector(tokenRefreshScheduler.config);
        }
        
        if (!tokenRefreshScheduler.priorityQueue) {
          const PriorityQueue = (await import('./token-refresh-scheduler/priority-queue.js')).default;
          tokenRefreshScheduler.priorityQueue = new PriorityQueue(tokenRefreshScheduler.config);
        }
        
        if (!tokenRefreshScheduler.rankAnalyzer) {
          const TokenRankAnalyzer = (await import('./token-refresh-scheduler/rank-analyzer.js')).default;
          tokenRefreshScheduler.rankAnalyzer = new TokenRankAnalyzer(tokenRefreshScheduler.config);
        }
        
        if (!tokenRefreshScheduler.batchOptimizer) {
          const BatchOptimizer = (await import('./token-refresh-scheduler/batch-optimizer.js')).default;
          tokenRefreshScheduler.batchOptimizer = new BatchOptimizer(tokenRefreshScheduler.config);
        }
        
        // Reload active tokens
        await tokenRefreshScheduler.loadActiveTokens();
      } catch (reinitError) {
        logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Failed to re-initialize scheduler components:`, reinitError);
        return { 
          error: 'Scheduler components not initialized',
          details: reinitError.message
        };
      }
    }
    
    // Check if components are successfully initialized
    if (!tokenRefreshScheduler.metricsCollector || !tokenRefreshScheduler.priorityQueue) {
      return { 
        error: 'Scheduler components still not initialized after recovery attempt',
        metricsCollector: !!tokenRefreshScheduler.metricsCollector,
        priorityQueue: !!tokenRefreshScheduler.priorityQueue,
        rankAnalyzer: !!tokenRefreshScheduler.rankAnalyzer,
        batchOptimizer: !!tokenRefreshScheduler.batchOptimizer
      };
    }
    
    // Get metrics from the scheduler
    const metrics = tokenRefreshScheduler.metricsCollector.getMetrics();
    
    // Add scheduler state with null-checks
    metrics.scheduler = {
      isRunning: tokenRefreshScheduler.isRunning,
      activeTokens: tokenRefreshScheduler.activeTokens?.size || 0,
      failedTokens: tokenRefreshScheduler.failedTokens?.size || 0,
      rateLimitAdjustment: tokenRefreshScheduler.rateLimitAdjustmentFactor || 1.0,
      queueSize: tokenRefreshScheduler.priorityQueue?.size() || 0
    };
    
    return metrics;
  } catch (error) {
    logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Error getting scheduler metrics:`, error);
    return { error: error.message };
  }
};

/**
 * Get refresh recommendations
 * @returns {Promise<Object>} Refresh recommendations
 */
export const getRefreshRecommendations = async () => {
  try {
    // Check if the rank analyzer is initialized
    if (!tokenRefreshScheduler.rankAnalyzer) {
      logApi.warn(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Rank analyzer not initialized, attempting re-initialization`);
      
      // Try to reinitialize rank analyzer component
      try {
        const TokenRankAnalyzer = (await import('./token-refresh-scheduler/rank-analyzer.js')).default;
        tokenRefreshScheduler.rankAnalyzer = new TokenRankAnalyzer(tokenRefreshScheduler.config);
      } catch (reinitError) {
        logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Failed to re-initialize rank analyzer:`, reinitError);
        return { 
          error: 'Rank analyzer not initialized',
          details: reinitError.message
        };
      }
    }
    
    // Get active tokens
    const tokens = await prisma.tokens.findMany({
      where: { is_active: true },
      select: {
        id: true,
        address: true,
        symbol: true,
        refresh_interval_seconds: true,
        token_prices: {
          select: { price: true, updated_at: true }
        },
        rank_history: {
          orderBy: { timestamp: 'desc' },
          take: 1,
          select: { rank: true }
        }
      }
    });
    
    // Check again that rank analyzer is available
    if (!tokenRefreshScheduler.rankAnalyzer) {
      return { error: 'Rank analyzer still not initialized after recovery attempt' };
    }
    
    // Get recommendations from rank analyzer
    const recommendations = tokenRefreshScheduler.rankAnalyzer.getRefreshRecommendations(tokens);
    
    return recommendations;
  } catch (error) {
    logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Error getting refresh recommendations:`, error);
    return { error: error.message };
  }
};

/**
 * TokenRefreshService class that extends BaseService
 */
class TokenRefreshService extends BaseService {
  constructor() {
    super(TOKEN_REFRESH_CONFIG);
    this.isInitialized = false;
  }
  
  /**
   * Initialize the service
   */
  async initialize() {
    try {
      logApi.info(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.GREEN}Initializing token refresh service...${fancyColors.RESET}`);
      await initializeTokenRefresh();
      this.isInitialized = true;
      logApi.info(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.GREEN}Token refresh service initialized successfully${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.RED}Error initializing token refresh service:${fancyColors.RESET}`, error);
      return false;
    }
  }
  
  /**
   * Perform the service's main operation 
   */
  async performOperation() {
    try {
      // Check if service is disabled in the current profile
      // Use the imported config object
      if (!config.services.token_refresh_scheduler) {
        // Just log info and return success
        logApi.debug(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.YELLOW}Token refresh scheduler is disabled in the current service profile, nothing to do${fancyColors.RESET}`);
        return true;
      }
    
      // First, check if the scheduler exists and has basic properties
      if (!tokenRefreshScheduler) {
        throw new Error(`Scheduler not available: tokenRefreshScheduler is null or undefined`);
      }
      
      // Check if the scheduler appears to be properly defined
      if (typeof tokenRefreshScheduler.initialize !== 'function' || 
          typeof tokenRefreshScheduler.start !== 'function') {
        throw new Error(`Scheduler appears corrupted: essential functions missing`);
      }
      
      // If scheduler is not initialized, try initializing it
      if (!tokenRefreshScheduler.isInitialized) {
        logApi.warn(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.YELLOW}Scheduler not initialized, attempting to initialize...${fancyColors.RESET}`);
        try {
          // Try re-initializing
          await tokenRefreshScheduler.initialize();
        } catch (initError) {
          throw new Error(`Scheduler initialization failed: ${initError.message}`);
        }
      }
      
      // Get scheduler metrics to verify health
      const metrics = await getSchedulerMetrics();
      
      if (metrics.error) {
        // Instead of immediately throwing, try to recover
        logApi.warn(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.YELLOW}Scheduler health check issue: ${metrics.error}. Attempting recovery...${fancyColors.RESET}`);
        
        // Try initializing from scratch
        const initResult = await initializeTokenRefresh();
        if (!initResult) {
          throw new Error(`Scheduler health check failed: ${metrics.error} (recovery failed)`);
        }
        
        // Re-check metrics after recovery
        const recoveryMetrics = await getSchedulerMetrics();
        if (recoveryMetrics.error) {
          throw new Error(`Scheduler health check still failing after recovery: ${recoveryMetrics.error}`);
        }
      }
      
      // Verify that token scheduler is operating correctly
      if (!metrics.scheduler || metrics.scheduler.isRunning === false) {
        logApi.info(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Restarting token refresh scheduler`);
        // Try to restart the scheduler if it's not running
        await tokenRefreshScheduler.start();
      } else {
        // Execute a token refresh cycle to verify system is working
        // Find highest priority tokens to refresh as a test
        const tokens = await prisma.tokens.findMany({
          where: { is_active: true },
          orderBy: [
            { priority_score: 'desc' }
          ],
          take: 5,
          select: {
            id: true,
            address: true,
            symbol: true
          }
        });
        
        if (tokens && tokens.length > 0) {
          const addresses = tokens.map(t => t.address);
          logApi.info(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Performing test refresh of ${tokens.length} tokens`);
          
          // Process a batch using the scheduler directly
          const batch = tokens.map(token => ({
            id: token.id,
            address: token.address,
            symbol: token.symbol,
            priority: 1000,
            nextRefreshTime: Date.now(),
            interval: 30
          }));
          
          // Check if processBatch exists
          if (typeof tokenRefreshScheduler.processBatch !== 'function') {
            logApi.warn(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Scheduler processBatch method not available, skipping test refresh`);
          } else if (tokenRefreshScheduler.isRunning) {
            // Process the batch through the scheduler
            try {
              await tokenRefreshScheduler.processBatch(batch);
              logApi.info(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Test refresh completed successfully`);
            } catch (batchError) {
              logApi.warn(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Test refresh failed, but service is still operational:`, batchError);
              // Don't throw here - the service can still operate even if test refresh fails
            }
          }
        }
      }
      
      logApi.info(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Operation completed successfully`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.RED}Operation error:${fancyColors.RESET}`, error);
      throw error;
    }
  }
  
  /**
   * Perform operation required by the circuit breaker system
   * This wraps the performOperation method with additional checks
   * This is called automatically by BaseService during normal operation and circuit breaker recovery
   */
  async onPerformOperation() {
    try {
      // Skip operation if service is not properly initialized
      if (!this.isOperational) {
        logApi.debug(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Service not operational, skipping operation`);
        return true;
      }
      
      // Check if this instance is initialized
      if (!this.isInitialized) {
        logApi.warn(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Service not initialized, attempting initialization...`);
        try {
          const initResult = await this.initialize();
          if (!initResult) {
            logApi.error(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Initialization failed during circuit breaker recovery`);
            return false;
          }
        } catch (initError) {
          logApi.error(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Initialization error during circuit breaker recovery:`, initError);
          return false;
        }
      }
      
      // Check if service is disabled in the current profile
      if (!config.services.token_refresh_scheduler) {
        // Only log at debug level to avoid flooding logs
        logApi.debug(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.YELLOW}Token refresh scheduler is disabled in the current service profile, skipping checks${fancyColors.RESET}`);
        return true; // Return true to prevent circuit breaker from tripping
      }
      
      // Check that token refresh scheduler is available
      if (!tokenRefreshScheduler) {
        logApi.warn(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Token refresh scheduler not available, attempting import...`);
        
        try {
          // Try to re-import scheduler
          const schedulerModule = await import('./token-refresh-scheduler.js');
          const refreshedScheduler = schedulerModule.default;
          
          // Check if import succeeded
          if (!refreshedScheduler) {
            logApi.error(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Failed to import token refresh scheduler`);
            return false;
          }
          
          // Initialize the refreshed scheduler
          await refreshedScheduler.initialize();
        } catch (importError) {
          logApi.error(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Failed to import or initialize scheduler:`, importError);
          return false;
        }
      }
      
      // Now check if scheduler is initialized
      if (!tokenRefreshScheduler.isInitialized) {
        logApi.warn(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Token refresh scheduler not initialized, attempting initialization...`);
        try {
          await tokenRefreshScheduler.initialize();
        } catch (initError) {
          logApi.error(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Scheduler initialization error:`, initError);
          return false;
        }
      }
      
      // Call the actual operation implementation with proper error handling
      try {
        return await this.performOperation();
      } catch (opError) {
        logApi.error(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.RED}Perform operation error:${fancyColors.RESET} ${opError.message}`);
        throw opError; // Important: re-throw to trigger circuit breaker
      }
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.RED}OnPerformOperation error:${fancyColors.RESET} ${error.message}`);
      throw error; // Important: re-throw to trigger circuit breaker
    }
  }
  
  /**
   * Refresh a token by address
   */
  async refreshToken(tokenAddress) {
    return refreshToken(tokenAddress);
  }
  
  /**
   * Update token refresh settings
   */
  async updateTokenRefreshSettings(tokenId, settings) {
    return updateTokenRefreshSettings(tokenId, settings);
  }
  
  /**
   * Get scheduler metrics
   */
  async getSchedulerMetrics() {
    return getSchedulerMetrics();
  }
  
  /**
   * Get refresh recommendations
   */
  async getRefreshRecommendations() {
    return getRefreshRecommendations();
  }

  /**
   * Handle errors in the service
   * @param {Error} error - The error that occurred
   * @param {string} context - Context information about where the error occurred
   * @returns {boolean} - Whether the error was handled
   */
  handleError(error, context = '') {
    // First call parent's handleError to manage circuit breaker
    const handled = super.handleError(error, context);
    
    // Log with our service-specific format
    logApi.error(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.RED}Error${context ? ' in ' + context : ''}:${fancyColors.RESET}`, error);
    
    return handled;
  }
}

// Create and export a singleton instance
const tokenRefreshService = new TokenRefreshService();

export default tokenRefreshService;