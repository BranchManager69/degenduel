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
import express from 'express';
import http from 'http';

// CLI demo mode when directly executed (npm run liq-sim)
const IS_MAIN_MODULE = import.meta.url === `file://${process.argv[1]}`;

class LiquiditySimService {
  constructor() {
    this.initialized = false;
    this.simulationCache = new Map();
    this.CACHE_TTL = 3600000; // 1 hour cache lifetime
  }
  
  /**
   * Initialize the LiquiditySim service
   */
  async initialize() {
    if (this.initialized) {
      logApi.warn('[LiquiditySimService] Service already initialized');
      return;
    }
    
    try {
      logApi.info('[LiquiditySimService] Initializing LiquiditySim service');
      
      // Set up cache cleanup interval
      this.cacheCleanupInterval = setInterval(() => this.cleanupCache(), this.CACHE_TTL);
      
      this.initialized = true;
      logApi.info('[LiquiditySimService] Service initialized successfully');
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

// Register the service with the WebSocket server when available
const registerWithWebSocket = async () => {
  try {
    const config = (await import('../../config/config.js')).default;
    
    // Check if the unified WebSocket is available
    if (config.websocket && config.websocket.unifiedWebSocket) {
      const unifiedWs = config.websocket.unifiedWebSocket;
      
      // Register event handler for broadcasting simulation results
      unifiedWs.registerEventHandler('liquidity:broadcast', (data) => {
        unifiedWs.broadcastToTopic(config.websocket.topics.TERMINAL, {
          type: config.websocket.messageTypes.DATA,
          topic: config.websocket.topics.TERMINAL,
          subtype: 'liquidity-sim',
          action: 'update',
          data: data,
          timestamp: new Date().toISOString()
        });
      });
      
      logApi.info('[LiquiditySimService] Successfully registered with unified WebSocket server');
    } else {
      logApi.warn('[LiquiditySimService] Unified WebSocket server not available for registration');
    }
  } catch (error) {
    logApi.error('[LiquiditySimService] Error registering with WebSocket server:', error);
  }
};

// Register with WebSocket when the module is imported - use dynamic import for ES modules
setTimeout(async () => {
  try {
    await registerWithWebSocket();
  } catch (error) {
    logApi.error('[LiquiditySimService] Error in delayed WebSocket registration:', error);
  }
}, 3000); // Wait 3 seconds to ensure WebSocket server is initialized

// Run demo server when executed directly (npm run liq-sim)
if (IS_MAIN_MODULE) {
  (async () => {
    try {
      await liquiditySimService.initialize();
      
      // Create simple demo Express server
      const app = express();
      const PORT = 4269;
      
      // Add JSON middleware
      app.use(express.json());
      
      // Add demo routes
      app.get('/', async (req, res) => {
        // Check WebSocket status
        let wsStatus = 'Not available';
        let wsPath = '';
        let wsTopic = '';
        
        try {
          const { default: config } = await import('../../config/config.js');
          if (config.websocket && config.websocket.unifiedWebSocket) {
            wsStatus = 'Available';
            wsPath = config.websocket.config.path;
            wsTopic = config.websocket.topics.TERMINAL;
          }
        } catch (error) {
          wsStatus = `Error: ${error.message}`;
        }
        
        res.send(`
          <html>
            <head>
              <title>LiquiditySim Demo</title>
              <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                h1 { color: #333; }
                pre { background: #f5f5f5; padding: 10px; border-radius: 5px; overflow: auto; }
                .endpoint { background: #e9f7fe; padding: 15px; border-left: 4px solid #0277bd; margin-bottom: 20px; }
                .url { font-weight: bold; color: #0277bd; }
                .desc { margin-top: 10px; }
                .websocket { background: #f0f7ff; padding: 15px; border-radius: 5px; margin: 20px 0; }
                .status { font-weight: bold; }
                .status.available { color: #00aa00; }
                .status.unavailable { color: #ff0000; }
                button { 
                  background: #0277bd; color: white; border: none; padding: 10px 15px; 
                  border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 10px;
                }
                button:hover { background: #015c8d; }
                #result { margin-top: 10px; background: #f5fff5; padding: 10px; border-radius: 4px; display: none; }
              </style>
              <script>
                async function testWebSocket() {
                  const resultEl = document.getElementById('result');
                  try {
                    const response = await fetch('/api/test-websocket');
                    const data = await response.json();
                    resultEl.textContent = JSON.stringify(data, null, 2);
                    resultEl.style.display = 'block';
                  } catch (error) {
                    resultEl.textContent = 'Error: ' + error.message;
                    resultEl.style.display = 'block';
                  }
                }
              </script>
            </head>
            <body>
              <h1>🚀 LiquiditySim Demo Server</h1>
              <p>Welcome to the LiquiditySim demo server. This tool helps simulate token liquidation strategies with realistic constraints.</p>
              
              <div class="websocket">
                <h3>WebSocket Status</h3>
                <p>
                  Status: <span class="status ${wsStatus === 'Available' ? 'available' : 'unavailable'}">${wsStatus}</span><br>
                  ${wsStatus === 'Available' ? `
                  Path: ${wsPath}<br>
                  Topic: ${wsTopic}<br>
                  Subtype: liquidity-sim` : ''}
                </p>
                <button onclick="testWebSocket()">Test WebSocket Broadcast</button>
                <pre id="result"></pre>
              </div>
              
              <h2>Available Endpoints:</h2>
              
              <div class="endpoint">
                <div class="url">GET /api/presets</div>
                <div class="desc">Get all available volume profile presets</div>
              </div>
              
              <div class="endpoint">
                <div class="url">GET /api/websocket-status</div>
                <div class="desc">Check WebSocket status</div>
              </div>
              
              <div class="endpoint">
                <div class="url">GET /api/test-websocket</div>
                <div class="desc">Send a test message to WebSocket subscribers</div>
              </div>
              
              <div class="endpoint">
                <div class="url">POST /api/simulate</div>
                <div class="desc">Run a token liquidation simulation with the provided parameters</div>
                <p>Example body:</p>
                <pre>
{
  "position": {
    "tokens": 1000000,
    "percentOfSupply": 0.01
  },
  "pool": {
    "baseReserve": 10000000,
    "quoteReserve": 5000000,
    "priceUsd": 0.5
  },
  "scenarios": ["base", "bull", "bear"],
  "days": 30,
  "strategies": ["conservative", "moderate", "aggressive"]
}
                </pre>
                <p>Optional query parameter: <code>?broadcast=true</code> to broadcast results via WebSocket</p>
              </div>
              
              <div class="endpoint">
                <div class="url">POST /api/price-impact</div>
                <div class="desc">Calculate maximum tokens that can be sold within a price impact limit</div>
                <p>Example body:</p>
                <pre>
{
  "maxPriceImpactPct": -2,
  "poolBaseReserve": 10000000,
  "poolQuoteReserve": 5000000,
  "exact": true
}
                </pre>
              </div>
            </body>
          </html>
        `);
      });
      
      // API endpoints
      
      // Get all volume profile presets
      app.get('/api/presets', (req, res) => {
        try {
          const presets = liquiditySimService.getVolumePresets();
          res.json({ success: true, presets });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      });
      
      // Get WebSocket status
      app.get('/api/websocket-status', async (req, res) => {
        try {
          // Check if WebSocket is registered
          const { default: config } = await import('../../config/config.js');
          const wsAvailable = !!(config.websocket && config.websocket.unifiedWebSocket);
          
          res.json({ 
            success: true, 
            websocket: {
              available: wsAvailable,
              path: wsAvailable ? config.websocket.config.path : null,
              topic: wsAvailable ? config.websocket.topics.TERMINAL : null,
              subtype: 'liquidity-sim'
            }
          });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      });
      
      // Run a simulation
      app.post('/api/simulate', (req, res) => {
        try {
          const params = req.body;
          const broadcast = req.query.broadcast === 'true'; // Optional query param to broadcast results
          const results = liquiditySimService.runSimulation(params, true, broadcast);
          res.json({ success: true, results, broadcast });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      });
      
      // Calculate price impact
      app.post('/api/price-impact', (req, res) => {
        try {
          const { maxPriceImpactPct, poolBaseReserve, poolQuoteReserve, exact } = req.body;
          const maxTokens = liquiditySimService.getMaxTokensForPriceImpact(
            maxPriceImpactPct, 
            poolBaseReserve, 
            poolQuoteReserve, 
            exact
          );
          res.json({ success: true, maxTokens });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      });
      
      // WebSocket test route
      app.get('/api/test-websocket', async (req, res) => {
        try {
          // Broadcast a test message
          await liquiditySimService.broadcastSimulationResults({
            type: 'test',
            message: 'This is a test message from the LiquiditySim service',
            timestamp: new Date().toISOString()
          });
          
          res.json({ 
            success: true, 
            message: 'Test message sent to WebSocket subscribers'
          });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      });
      
      // Start the server
      const server = http.createServer(app);
      server.listen(PORT, () => {
        console.log(`\n🚀 LiquiditySim demo server running at http://localhost:${PORT}`);
        console.log(`\n📊 Available endpoints:`);
        console.log(`  • GET  /api/presets - Get volume profile presets`);
        console.log(`  • GET  /api/websocket-status - Check WebSocket status`);
        console.log(`  • GET  /api/test-websocket - Send test message to WebSocket`);
        console.log(`  • POST /api/simulate - Run liquidation simulation`);
        console.log(`  • POST /api/price-impact - Calculate price impact limits\n`);
      });
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down demo server...');
        server.close();
        await liquiditySimService.shutdown();
        process.exit(0);
      });
      
    } catch (error) {
      console.error('Error starting demo server:', error);
      process.exit(1);
    }
  })();
}

export default liquiditySimService;