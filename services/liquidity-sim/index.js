/**
 * LiquiditySim - Token Liquidation Simulation Service
 * 
 * A comprehensive service for simulating token liquidation strategies under different
 * market conditions, accounting for position size, price impact, and volume constraints.
 */

import ammMath from './modules/amm-math.js';
import volumeProfiles from './modules/volume-profiles.js';
import liquidationSimulator from './modules/liquidation-simulator.js';
import { logApi } from '../../utils/logger-suite/logger.js';
// import express from 'express'; // Temporarily remove express import for testing
// import http from 'http';    // Temporarily remove http import for testing

// CLI demo mode when directly executed (npm run liq-sim)
const IS_MAIN_MODULE = import.meta.url === `file://${process.argv[1]}`;

class LiquiditySimService {
  constructor() {
    this.initialized = false;
    this.simulationCache = new Map();
    this.CACHE_TTL = 3600000; // 1 hour cache lifetime
    this.cacheCleanupInterval = null; // Ensure it's initialized
    logApi.info('[LiquiditySimService] Instance created (constructor run).'); // Log constructor call
  }
  
  /**
   * Initialize the LiquiditySim service
   */
  async initialize() {
    if (this.initialized) {
      logApi.warn('[LiquiditySimService] Service initialize() called, but already initialized.');
      return;
    }
    
    try {
      logApi.info('[LiquiditySimService] initialize() called. Setting up cache cleanup.');
      if (this.cacheCleanupInterval) clearInterval(this.cacheCleanupInterval); // Clear previous if any
      this.cacheCleanupInterval = setInterval(() => this.cleanupCache(), this.CACHE_TTL);
      this.initialized = true;
      logApi.info('[LiquiditySimService] Service initialized successfully (cache cleanup scheduled).');
    } catch (error) {
      logApi.error('[LiquiditySimService] Error initializing service:', error);
      throw error;
    }
  }
  
  /**
   * Shutdown the LiquiditySim service
   */
  async shutdown() {
    if (!this.initialized) {
      logApi.warn('[LiquiditySimService] Service not initialized');
      return;
    }
    
    try {
      logApi.info('[LiquiditySimService] Shutting down LiquiditySim service');
      
      // Clear cache cleanup interval
      if (this.cacheCleanupInterval) {
        clearInterval(this.cacheCleanupInterval);
      }
      
      this.initialized = false;
      logApi.info('[LiquiditySimService] Service shutdown complete');
    } catch (error) {
      logApi.error('[LiquiditySimService] Error during shutdown:', error);
      throw error;
    }
  }
  
  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    let expiredCount = 0;
    
    for (const [key, entry] of this.simulationCache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.simulationCache.delete(key);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      logApi.debug(`[LiquiditySimService] Cleaned up ${expiredCount} expired cache entries`);
    }
  }
  
  /**
   * Run a token liquidation simulation
   * 
   * @param {Object} params - Simulation parameters
   * @param {boolean} useCache - Whether to use cached results (if available)
   * @param {boolean} broadcast - Whether to broadcast results via WebSocket
   * @returns {Object} Simulation results
   */
  runSimulation(params, useCache = true, broadcast = false) {
    if (!this.initialized) {
      logApi.warn('[LiquiditySimService] Service not initialized, initializing now');
      this.initialize();
    }
    
    // Generate cache key from params
    const cacheKey = this.generateCacheKey(params);
    
    // Check cache first if enabled
    if (useCache && this.simulationCache.has(cacheKey)) {
      const cachedEntry = this.simulationCache.get(cacheKey);
      logApi.debug('[LiquiditySimService] Using cached simulation results');
      
      // Broadcast results if requested
      if (broadcast) {
        this.broadcastSimulationResults({
          params,
          results: cachedEntry.results,
          fromCache: true
        });
      }
      
      return cachedEntry.results;
    }
    
    // Run the simulation
    const results = liquidationSimulator.runSimulation(params);
    
    // Cache the results if caching is enabled
    if (useCache) {
      this.simulationCache.set(cacheKey, {
        timestamp: Date.now(),
        results
      });
    }
    
    // Broadcast results if requested
    if (broadcast) {
      this.broadcastSimulationResults({
        params,
        results,
        fromCache: false
      });
    }
    
    return results;
  }
  
  /**
   * Broadcast simulation results through the unified WebSocket
   * 
   * @param {Object} data - The data to broadcast
   */
  async broadcastSimulationResults(data) {
    try {
      // Use dynamic import to avoid circular dependencies
      const { default: config } = await import('../../config/config.js');
      
      if (config.websocket && config.websocket.unifiedWebSocket) {
        // Use dynamic import for serviceEvents to avoid circular dependencies
        const { default: serviceEvents } = await import('../../utils/service-suite/service-events.js');
        
        // Emit the event for the WebSocket server to handle
        serviceEvents.emit('liquidity:broadcast', data);
        
        logApi.debug('[LiquiditySimService] Broadcast simulation results to WebSocket subscribers');
      } else {
        logApi.debug('[LiquiditySimService] Unified WebSocket not available, skipping broadcast');
      }
    } catch (error) {
      logApi.error('[LiquiditySimService] Error broadcasting simulation results:', error);
    }
  }
  
  /**
   * Run a grid of simulations for different acquisition levels and scenarios
   * 
   * @param {Object} params - Base simulation parameters
   * @param {boolean} useCache - Whether to use cached results (if available)
   * @param {boolean} broadcast - Whether to broadcast results via WebSocket
   * @returns {Object} Grid of simulation results
   */
  runSimulationGrid(params, useCache = true, broadcast = false) {
    if (!this.initialized) {
      logApi.warn('[LiquiditySimService] Service not initialized, initializing now');
      this.initialize();
    }
    
    // Generate cache key from params
    const cacheKey = this.generateCacheKey({ ...params, isGrid: true });
    
    // Check cache first if enabled
    if (useCache && this.simulationCache.has(cacheKey)) {
      const cachedEntry = this.simulationCache.get(cacheKey);
      logApi.debug('[LiquiditySimService] Using cached grid simulation results');
      
      // Broadcast results if requested
      if (broadcast) {
        this.broadcastSimulationResults({
          params,
          gridResults: cachedEntry.results,
          type: 'grid',
          fromCache: true
        });
      }
      
      return cachedEntry.results;
    }
    
    // Run the grid simulation
    const results = liquidationSimulator.runSimulationGrid(params);
    
    // Cache the results if caching is enabled
    if (useCache) {
      this.simulationCache.set(cacheKey, {
        timestamp: Date.now(),
        results
      });
    }
    
    // Broadcast results if requested
    if (broadcast) {
      this.broadcastSimulationResults({
        params,
        gridResults: results,
        type: 'grid',
        fromCache: false
      });
    }
    
    return results;
  }
  
  /**
   * Calculate token position based on acquisition level and personal ratio
   * 
   * @param {number} totalSupply - Total token supply
   * @param {string} acquisitionLevel - Acquisition level (low/medium/high)
   * @param {number} personalRatio - Personal allocation as fraction of acquired tokens (0-1)
   * @returns {Object} Object with organization and personal positions
   */
  calculatePosition(totalSupply, acquisitionLevel = 'medium', personalRatio = 0.5) {
    return liquidationSimulator.calculatePosition(totalSupply, acquisitionLevel, personalRatio);
  }
  
  /**
   * Calculate the maximum number of tokens that can be sold with a given price impact
   * 
   * @param {number} maxPriceImpactPct - The maximum price impact as a percentage (negative for sell impact)
   * @param {number} poolBaseReserve - The base token reserve in the pool
   * @param {number} poolQuoteReserve - The quote token reserve in the pool
   * @param {boolean} exact - Whether to use the exact calculation (true) or approximation (false)
   * @returns {number} The maximum number of tokens that can be sold
   */
  getMaxTokensForPriceImpact(maxPriceImpactPct, poolBaseReserve, poolQuoteReserve, exact = false) {
    return ammMath.getMaxTokensForPriceImpact(maxPriceImpactPct, poolBaseReserve, poolQuoteReserve, exact);
  }
  
  /**
   * Simulate selling a specific amount of tokens
   * 
   * @param {number} tokenAmount - The amount of tokens to sell
   * @param {number} poolBaseReserve - The base token reserve in the pool
   * @param {number} poolQuoteReserve - The quote token reserve in the pool
   * @returns {Object} Object containing received amount, new reserves, and price impact
   */
  simulateSell(tokenAmount, poolBaseReserve, poolQuoteReserve) {
    return ammMath.simulateSell(tokenAmount, poolBaseReserve, poolQuoteReserve);
  }
  
  /**
   * Generate a cache key from parameters
   * 
   * @param {Object} params - Simulation parameters
   * @returns {string} Cache key
   * @private
   */
  generateCacheKey(params) {
    // Create a stable representation of the parameters, sorting object keys
    const stableParams = JSON.stringify(params, (key, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value).sort().reduce((obj, key) => {
          obj[key] = value[key];
          return obj;
        }, {});
      }
      return value;
    });
    
    // Use a hash function (simple for now)
    return `sim_${stableParams.split('').reduce((hash, char) => {
      return ((hash << 5) - hash) + char.charCodeAt(0) | 0;
    }, 0)}`;
  }
  
  /**
   * Get available volume profile presets
   * 
   * @returns {Object} Volume profile presets
   */
  getVolumePresets() {
    return volumeProfiles.volumePresets;
  }
  
  /**
   * Generate a custom volume profile
   * 
   * @param {number} days - Number of days to simulate
   * @param {Object} customParams - Custom parameters for the volume profile
   * @returns {Object} Volume profile
   */
  generateCustomVolumeProfile(days, customParams) {
    return volumeProfiles.generateCustomVolumeProfile(days, customParams);
  }
}

// Create and export a singleton instance
const liquiditySimService = new LiquiditySimService();
logApi.warn('[LiquiditySimService] Singleton instance created. Automatic WebSocket registration and demo server are DISABLED.');

// const registerWithWebSocket = async () => { ... }; // Keep commented or as no-op
// setTimeout(async () => { ... }, 3000); // Keep commented

// if (IS_MAIN_MODULE) { ... } // Keep demo server commented out

export default liquiditySimService;