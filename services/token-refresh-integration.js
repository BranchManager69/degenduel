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

// Initialize Prisma client
const prisma = new PrismaClient();

// Service configuration
const TOKEN_REFRESH_CONFIG = {
  name: 'token_refresh_scheduler_service',
  displayName: 'Token Refresh Scheduler',
  description: 'Advanced service for optimally scheduling token price updates',
  intervalMs: 0, // No automatic interval - managed internally
  dependencies: [SERVICE_NAMES.MARKET_DATA, SERVICE_NAMES.SOLANA_ENGINE],
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
    if (!tokenRefreshScheduler.isInitialized) {
      return { error: 'Scheduler not initialized' };
    }
    
    // Get metrics from the scheduler
    const metrics = tokenRefreshScheduler.metricsCollector.getMetrics();
    
    // Add scheduler state
    metrics.scheduler = {
      isRunning: tokenRefreshScheduler.isRunning,
      activeTokens: tokenRefreshScheduler.activeTokens.size,
      failedTokens: tokenRefreshScheduler.failedTokens.size,
      rateLimitAdjustment: tokenRefreshScheduler.rateLimitAdjustmentFactor,
      queueSize: tokenRefreshScheduler.priorityQueue.size()
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
      // Get scheduler metrics to verify health
      const metrics = await getSchedulerMetrics();
      
      if (metrics.error) {
        throw new Error(`Scheduler health check failed: ${metrics.error}`);
      }
      
      // Verify that token scheduler is operating correctly
      if (!metrics.scheduler || metrics.scheduler.isRunning === false) {
        logApi.info(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Restarting token refresh scheduler`);
        // Try to restart the scheduler if it's not running
        await initializeTokenRefresh();
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
          
          // Process the batch through the scheduler
          if (tokenRefreshScheduler.isRunning) {
            await tokenRefreshScheduler.processBatch(batch);
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
      if (!this.isOperational || !this._initialized) {
        logApi.debug(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Service not operational or initialized, skipping operation`);
        return true;
      }
      
      // Check that token refresh scheduler is available
      if (!tokenRefreshScheduler || !tokenRefreshScheduler.isInitialized) {
        logApi.debug(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} Token refresh scheduler not available, skipping operation`);
        return false;
      }
      
      // Call the actual operation implementation
      return await this.performOperation();
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenRefreshService]${fancyColors.RESET} ${fancyColors.RED}Perform operation error:${fancyColors.RESET} ${error.message}`);
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