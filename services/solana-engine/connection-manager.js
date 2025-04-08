// services/solana-engine/connection-manager.js

/**
 * Connection Manager for SolanaEngine
 * 
 * Provides enhanced RPC connection management with:
 * - Multi-endpoint support
 * - Health monitoring and rotation
 * - Explicit endpoint selection
 * - Automatic failover
 */

import { Connection } from '@solana/web3.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import config from '../../config/config.js';
import { PrismaClient } from '@prisma/client';
import { clearInterval } from 'timers';

// Logging helpers
const formatLog = {
  tag: () => `${fancyColors.MAGENTA}[ConnectionManager]${fancyColors.RESET}`,
  header: (text) => `${fancyColors.BG_MAGENTA}${fancyColors.WHITE} ${text} ${fancyColors.RESET}`,
  success: (text) => `${fancyColors.GREEN}${text}${fancyColors.RESET}`,
  warning: (text) => `${fancyColors.YELLOW}${text}${fancyColors.RESET}`,
  error: (text) => `${fancyColors.RED}${text}${fancyColors.RESET}`,
  info: (text) => `${fancyColors.BLUE}${text}${fancyColors.RESET}`,
  endpoint: (id) => `${fancyColors.CYAN}${id}${fancyColors.RESET}`
};

// Default cache TTL values that can be imported by other modules
export const defaultCacheTTLs = {
  tokenMetadataTTL: 60 * 60 * 24, // 24 hours
  tokenPriceTTL: 60 * 60,        // 1 hour
  walletDataTTL: 60 * 5          // 5 minutes
};

// Global reference to current TTL settings that will be updated by ConnectionManager
export const cacheTTLs = { 
  // First read from environment variables, then use defaults
  tokenMetadataTTL: parseInt(process.env.TOKEN_METADATA_TTL || '0') || defaultCacheTTLs.tokenMetadataTTL,
  tokenPriceTTL: parseInt(process.env.TOKEN_PRICE_TTL || '0') || defaultCacheTTLs.tokenPriceTTL,
  walletDataTTL: parseInt(process.env.WALLET_DATA_TTL || '0') || defaultCacheTTLs.walletDataTTL
};

/**
 * Connection Manager for RPC endpoint management
 */
class ConnectionManager {
  constructor() {
    this.TAG = 'SolanaEngine';
    // Maps endpoint IDs to connection objects
    this.connections = new Map();
    
    // Maps endpoint IDs to health information
    this.endpointHealth = new Map();
    
    // Tracks current endpoint for rotation
    this.currentEndpointIndex = 0;
    
    // List of available endpoint IDs in priority order
    this.endpointIds = [];
    
    // Configuration for rotation and health checks
    this.config = {
      enabled: true,
      strategy: 'round-robin', // 'round-robin', 'weighted', 'adaptive'
      healthCheckIntervalMs: 60 * 1000,
      failoverThreshold: 2,
      recoveryThreshold: 3,
      retryDelayMs: 30 * 1000,
      // Optional explicit weights for endpoints (higher = more likely to be selected)
      endpointWeights: {},
      // Request queue settings
      maxConcurrentRequests: 5,
      minBackoffMs: 1000,
      maxBackoffMs: 15000,
      baseDelayMs: 250,
      minOperationSpacingMs: 100
    };
    
    // Health check timer
    this.healthCheckTimer = null;
    
    // Request statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0,
      byEndpoint: {}
    };
    
    // Initialize cache TTL values - will be properly set in loadConfiguration()
    this.cacheTTLs = { ...cacheTTLs };
  }
  
  /**
   * Initialize the Connection Manager with endpoints from config
   */
  async initialize() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} Connection Manager`);
      
      // Clear any existing connections
      this.connections.clear();
      this.endpointHealth.clear();
      this.endpointIds = [];
      
      // Load configuration from database
      await this.loadConfiguration();
      
      // Get endpoint configurations from global config
      await this.initializeEndpoints();
      
      // Start health check timer if enabled
      if (this.config.enabled && this.endpointIds.length > 1) {
        this.startHealthChecks();
      }
      
      const healthyCount = [...this.endpointHealth.values()].filter(h => h.isHealthy).length;
      logApi.info(`${formatLog.tag()} ${formatLog.success(`Connection Manager initialized with ${healthyCount}/${this.endpointIds.length} healthy endpoints`)}`);
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to initialize Connection Manager: ${error.message}`)}`);
      return false;
    }
  }
  
  /**
   * Load configuration from database
   * Throws error if configuration cannot be loaded
   */
  async loadConfiguration() {
    try {
      const prisma = new PrismaClient();
      
      // Check if configuration exists
      let dbConfig = await prisma.config_solana_engine.findFirst();
      
      if (!dbConfig) {
        // Configuration doesn't exist - this is a critical error
        throw new Error('SolanaEngine configuration not found in database. Please run database migration and setup initial configuration.');
      }
      
      // Update our configuration from database values
      this.config = {
        enabled: true,
        strategy: dbConfig.connection_strategy,
        healthCheckIntervalMs: dbConfig.health_check_interval,
        failoverThreshold: dbConfig.failure_threshold,
        recoveryThreshold: dbConfig.recovery_threshold,
        retryDelayMs: 30 * 1000, // Default
        endpointWeights: dbConfig.endpoint_weights || {},
        maxConcurrentRequests: dbConfig.max_concurrent_requests,
        minBackoffMs: 1000, // Default
        maxBackoffMs: 15000, // Default
        baseDelayMs: dbConfig.base_backoff_ms,
        minOperationSpacingMs: dbConfig.request_spacing_ms,
        adminBypassCache: dbConfig.admin_bypass_cache
      };
      
      // Cache TTLs - prioritize environment variables over database values
      // Read from .env first, then fallback to database, then to defaults
      const ttlUpdates = {
        tokenMetadataTTL: parseInt(process.env.TOKEN_METADATA_TTL || '0') || dbConfig.token_metadata_ttl || defaultCacheTTLs.tokenMetadataTTL,
        tokenPriceTTL: parseInt(process.env.TOKEN_PRICE_TTL || '0') || dbConfig.token_price_ttl || defaultCacheTTLs.tokenPriceTTL,
        walletDataTTL: parseInt(process.env.WALLET_DATA_TTL || '0') || dbConfig.wallet_data_ttl || defaultCacheTTLs.walletDataTTL
      };
      
      // Update instance TTLs
      this.cacheTTLs = ttlUpdates;
      
      // Update the global cacheTTLs reference
      Object.keys(ttlUpdates).forEach(key => {
        cacheTTLs[key] = ttlUpdates[key];
      });
      
      // Log the TTL values being used
      logApi.info(`${formatLog.tag()} Cache TTLs - Token Metadata: ${cacheTTLs.tokenMetadataTTL}s, Token Price: ${cacheTTLs.tokenPriceTTL}s, Wallet Data: ${cacheTTLs.walletDataTTL}s`);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Configuration loaded from database')}`);
      await prisma.$disconnect();
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to load configuration: ${error.message}`)}`);
      throw error; // Rethrow to prevent initialization
    }
  }
  
  /**
   * Initialize connections to all configured endpoints
   */
  async initializeEndpoints() {
    try {
      // Get all available RPC endpoints from config or environment variables
      let endpoints = config.rpc_urls.mainnet_http_all || [];
      
      // If no endpoints are configured in config, try using SOLANA_RPC_ENDPOINT from environment
      if (endpoints.length === 0 && process.env.SOLANA_RPC_ENDPOINT) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Using SOLANA_RPC_ENDPOINT from environment')}`);
        endpoints = [process.env.SOLANA_RPC_ENDPOINT];
      }
      
      if (endpoints.length === 0) {
        throw new Error('No RPC endpoints configured');
      }
      
      // Create connections for each endpoint
      for (const [index, endpoint] of endpoints.entries()) {
        const endpointId = `endpoint-${index + 1}`;
        
        try {
          // Create web3.js Connection object
          const connection = new Connection(
            endpoint,
            {
              commitment: 'confirmed',
              confirmTransactionInitialTimeout: config.solana_timeouts.rpc_initial_connection_timeout * 1000,
              // Use WebSocket from environment variable if available, otherwise use from config
              wsEndpoint: index === 0 ? (process.env.SOLANA_MAINNET_WSS || config.rpc_urls.mainnet_wss) : undefined,
              maxSupportedTransactionVersion: 0, // Support versioned transactions
              httpHeaders: {
                'X-DegenDuel-Request-Priority': 'normal',
                'X-DegenDuel-Connection-Id': endpointId
              }
            }
          );
          
          // Add to connections map
          this.connections.set(endpointId, {
            id: endpointId,
            connection,
            endpoint,
            index,
            isPrimary: index === 0,
            hasWebsocket: index === 0
          });
          
          // Add to ordered list
          this.endpointIds.push(endpointId);
          
          // Initialize health tracking
          this.endpointHealth.set(endpointId, {
            id: endpointId,
            endpoint,
            isHealthy: true,
            lastCheck: null,
            consecutiveFailures: 0,
            consecutiveSuccesses: 0,
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            rateLimitHits: 0,
            averageResponseTimeMs: 0,
            lastResponseTimeMs: 0
          });
          
          // Initialize stats tracking
          this.stats.byEndpoint[endpointId] = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            rateLimitHits: 0,
            retries: 0,
            lastRateLimitTime: 0,
            averageResponseTimeMs: 0
          };
          
          // Test connection
          const startTime = Date.now();
          await connection.getVersion();
          const responseTime = Date.now() - startTime;
          
          // Update health metrics
          const health = this.endpointHealth.get(endpointId);
          health.lastCheck = new Date();
          health.lastResponseTimeMs = responseTime;
          health.averageResponseTimeMs = responseTime;
          health.consecutiveSuccesses = 1;
          this.endpointHealth.set(endpointId, health);
          
          logApi.info(`${formatLog.tag()} ${formatLog.success(`Endpoint ${formatLog.endpoint(endpointId)} connected successfully`)} (${responseTime}ms)`);
        } catch (error) {
          // Log error but continue with other endpoints
          logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to initialize endpoint ${formatLog.endpoint(endpointId)}: ${error.message}`)}`);
          
          if (this.endpointHealth.has(endpointId)) {
            const health = this.endpointHealth.get(endpointId);
            health.isHealthy = false;
            health.consecutiveFailures = 1;
            health.lastCheck = new Date();
            this.endpointHealth.set(endpointId, health);
          }
        }
      }
      
      // Ensure we have at least one connection
      if (this.connections.size === 0) {
        throw new Error('Failed to initialize any RPC connections');
      }
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to initialize endpoints: ${error.message}`)}`);
      throw error;
    }
  }
  
  /**
   * Start periodic health checks for all connections
   */
  startHealthChecks() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    this.healthCheckTimer = setInterval(
      () => this.checkEndpointHealth(),
      this.config.healthCheckIntervalMs
    );
    
    logApi.info(`${formatLog.tag()} ${formatLog.info(`Started endpoint health checks (every ${this.config.healthCheckIntervalMs / 1000}s)`)}`);
  }
  
  /**
   * Check health of all endpoints
   */
  async checkEndpointHealth() {
    logApi.debug(`${formatLog.tag()} Checking health of all endpoints...`);
    
    // Check each endpoint
    for (const endpointId of this.endpointIds) {
      const connInfo = this.connections.get(endpointId);
      if (!connInfo) continue;
      
      try {
        // Get current health
        const health = this.endpointHealth.get(endpointId) || {
          id: endpointId,
          endpoint: connInfo.endpoint,
          isHealthy: false,
          lastCheck: null,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          rateLimitHits: 0,
          averageResponseTimeMs: 0,
          lastResponseTimeMs: 0
        };
        
        // Perform quick health check
        const startTime = Date.now();
        await connInfo.connection.getRecentBlockhash();
        const responseTime = Date.now() - startTime;
        
        // Update metrics
        health.lastCheck = new Date();
        health.lastResponseTimeMs = responseTime;
        health.totalRequests++;
        health.successfulRequests++;
        health.consecutiveSuccesses++;
        health.consecutiveFailures = 0;
        
        // Update rolling average response time (90% old value, 10% new value)
        health.averageResponseTimeMs = health.averageResponseTimeMs === 0 ?
          responseTime :
          (health.averageResponseTimeMs * 0.9) + (responseTime * 0.1);
        
        // Check if previously unhealthy endpoint has recovered
        if (!health.isHealthy && health.consecutiveSuccesses >= this.config.recoveryThreshold) {
          health.isHealthy = true;
          logApi.info(`${formatLog.tag()} ${formatLog.success(`Endpoint ${formatLog.endpoint(endpointId)} recovered after ${health.consecutiveSuccesses} successful checks`)}`);
        }
        
        // Update health record
        this.endpointHealth.set(endpointId, health);
        
      } catch (error) {
        // Health check failed
        const health = this.endpointHealth.get(endpointId) || {
          id: endpointId,
          endpoint: connInfo.endpoint,
          isHealthy: true,
          lastCheck: null,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          rateLimitHits: 0,
          averageResponseTimeMs: 0,
          lastResponseTimeMs: 0
        };
        
        // Update metrics
        health.lastCheck = new Date();
        health.totalRequests++;
        health.failedRequests++;
        health.consecutiveFailures++;
        health.consecutiveSuccesses = 0;
        
        // Check if endpoint should be marked unhealthy
        if (health.isHealthy && health.consecutiveFailures >= this.config.failoverThreshold) {
          health.isHealthy = false;
          logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Endpoint ${formatLog.endpoint(endpointId)} marked unhealthy after ${health.consecutiveFailures} consecutive failures`)}`);
        }
        
        // Update health record
        this.endpointHealth.set(endpointId, health);
        
        // Log error
        logApi.error(`${formatLog.tag()} ${formatLog.error(`Health check failed for endpoint ${formatLog.endpoint(endpointId)}: ${error.message}`)}`);
      }
    }
    
    // Log overall health status
    const healthyEndpoints = Array.from(this.endpointHealth.values()).filter(h => h.isHealthy);
    logApi.info(`${formatLog.tag()} ${formatLog.header('HEALTH')} ${healthyEndpoints.length}/${this.endpointIds.length} endpoints healthy`);
    
    // Log detailed status
    this.logEndpointHealth();
  }
  
  /**
   * Log detailed endpoint health information
   */
  logEndpointHealth() {
    for (const endpointId of this.endpointIds) {
      const health = this.endpointHealth.get(endpointId);
      if (!health) continue;
      
      const statusColor = health.isHealthy ? fancyColors.GREEN : fancyColors.RED;
      const statusText = health.isHealthy ? 'HEALTHY' : 'UNHEALTHY';
      const responseTime = health.lastResponseTimeMs ? `${health.lastResponseTimeMs}ms` : 'N/A';
      const avgResponseTime = health.averageResponseTimeMs ? `${Math.round(health.averageResponseTimeMs)}ms` : 'N/A';
      const successRate = health.totalRequests ? `${Math.round((health.successfulRequests / health.totalRequests) * 100)}%` : 'N/A';
      
      logApi.info(
        `${formatLog.tag()} ${formatLog.endpoint(endpointId)}: ` +
        `${statusColor}${statusText}${fancyColors.RESET} | ` +
        `Avg: ${avgResponseTime} | ` +
        `Last: ${responseTime} | ` +
        `Success: ${successRate}`
      );
    }
  }
  
  /**
   * Get a connection based on selection strategy
   * @param {Object} options - Connection selection options
   * @returns {Object} Connection information
   */
  getConnection(options = {}) {
    // If specific endpoint requested, try to use it
    if (options.endpointId && this.connections.has(options.endpointId)) {
      const connInfo = this.connections.get(options.endpointId);
      const health = this.endpointHealth.get(options.endpointId);
      
      // Check if endpoint is healthy or if we should ignore health
      if (health?.isHealthy || options.ignoreHealth) {
        return connInfo;
      } else if (!options.fallbackToRotation) {
        // If unhealthy and no fallback requested, throw error
        throw new Error(`Requested endpoint ${options.endpointId} is unhealthy`);
      }
      // Otherwise fall through to rotation strategy
    }
    
    // If websocket required, prioritize endpoints with websocket support
    if (options.requireWebsocket) {
      const wsEndpoints = [...this.connections.values()].filter(
        conn => conn.hasWebsocket && this.endpointHealth.get(conn.id)?.isHealthy
      );
      
      if (wsEndpoints.length > 0) {
        return wsEndpoints[0];
      }
      // If no healthy websocket endpoints, fall through to normal selection
    }
    
    // Use rotation strategy to select endpoint
    return this.selectEndpoint();
  }
  
  /**
   * Select an endpoint using the configured rotation strategy
   * @returns {Object} Selected connection information
   */
  selectEndpoint() {
    // Get healthy endpoints
    const healthyEndpoints = this.endpointIds
      .filter(id => this.endpointHealth.get(id)?.isHealthy)
      .map(id => this.connections.get(id));
    
    // If no healthy endpoints, use primary endpoint
    if (healthyEndpoints.length === 0) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('No healthy endpoints available, using primary endpoint')}`);
      return this.connections.get(this.endpointIds[0]);
    }
    
    // Apply rotation strategy
    let selected;
    
    switch (this.config.strategy) {
      case 'round-robin':
        // Simple round-robin through healthy endpoints
        this.currentEndpointIndex = (this.currentEndpointIndex + 1) % healthyEndpoints.length;
        selected = healthyEndpoints[this.currentEndpointIndex];
        break;
        
      case 'weighted':
        // Weight by inverse of average response time and explicit weights
        const totalWeight = healthyEndpoints.reduce((sum, connInfo) => {
          const health = this.endpointHealth.get(connInfo.id);
          const responseWeight = health?.averageResponseTimeMs ? 1000 / (health.averageResponseTimeMs + 10) : 1;
          const explicitWeight = this.config.endpointWeights[connInfo.id] || 1;
          return sum + (responseWeight * explicitWeight);
        }, 0);
        
        // Random selection based on weights
        let random = Math.random() * totalWeight;
        let cumulativeWeight = 0;
        
        for (const connInfo of healthyEndpoints) {
          const health = this.endpointHealth.get(connInfo.id);
          const responseWeight = health?.averageResponseTimeMs ? 1000 / (health.averageResponseTimeMs + 10) : 1;
          const explicitWeight = this.config.endpointWeights[connInfo.id] || 1;
          const weight = responseWeight * explicitWeight;
          
          cumulativeWeight += weight;
          if (random <= cumulativeWeight) {
            selected = connInfo;
            break;
          }
        }
        
        // Fallback if weighted selection fails
        if (!selected) {
          selected = healthyEndpoints[0];
        }
        break;
        
      case 'adaptive':
        // Score endpoints based on multiple factors
        const scored = healthyEndpoints.map(connInfo => {
          const health = this.endpointHealth.get(connInfo.id) || {};
          const stats = this.stats.byEndpoint[connInfo.id] || {};
          
          // Calculate score based on multiple factors (lower is better)
          const rateLimitScore = (stats.rateLimitHits || 0) * 100;
          const responseTimeScore = (health.averageResponseTimeMs || 1000) / 10;
          const errorScore = (health.failedRequests || 0) * 10;
          const usageScore = (stats.totalRequests || 0) / 10;
          
          // Apply explicit weighting if configured
          const explicitWeight = this.config.endpointWeights[connInfo.id] || 1;
          // For explicit weights, higher weight = lower score = more likely to be selected
          const weightFactor = explicitWeight > 0 ? (1 / explicitWeight) : 1;
          
          return {
            connection: connInfo,
            score: (rateLimitScore + responseTimeScore + errorScore + usageScore) * weightFactor
          };
        });
        
        // Sort by score (lowest/best first)
        scored.sort((a, b) => a.score - b.score);
        selected = scored[0].connection;
        break;
        
      default:
        // Default to primary endpoint
        selected = healthyEndpoints[0];
    }
    
    return selected;
  }
  
  /**
   * Execute a Solana RPC call with automatic endpoint selection
   * @param {Function} rpcFunction - Function to execute (receives connection)
   * @param {Object} options - Execution options
   * @returns {Promise<any>} Result of the RPC call
   */
  async executeRpc(rpcFunction, options = {}) {
    const connInfo = this.getConnection(options);
    const endpointId = connInfo.id;
    
    try {
      // Update stats before execution
      this.stats.totalRequests++;
      this.stats.byEndpoint[endpointId].totalRequests++;
      
      // Track request timing
      const startTime = Date.now();
      
      // Execute RPC call with the selected connection
      const result = await rpcFunction(connInfo.connection);
      
      // Update timing and success stats
      const responseTime = Date.now() - startTime;
      this.stats.successfulRequests++;
      this.stats.byEndpoint[endpointId].successfulRequests++;
      
      // Update health metrics
      const health = this.endpointHealth.get(endpointId);
      if (health) {
        health.successfulRequests++;
        health.totalRequests++;
        health.lastResponseTimeMs = responseTime;
        
        // Update rolling average response time
        health.averageResponseTimeMs = health.averageResponseTimeMs === 0 ?
          responseTime :
          (health.averageResponseTimeMs * 0.9) + (responseTime * 0.1);
        
        this.endpointHealth.set(endpointId, health);
      }
      
      // Update endpoint stats
      this.stats.byEndpoint[endpointId].averageResponseTimeMs = 
        this.stats.byEndpoint[endpointId].averageResponseTimeMs === 0 ?
          responseTime :
          (this.stats.byEndpoint[endpointId].averageResponseTimeMs * 0.9) + (responseTime * 0.1);
      
      // Only log if slower than threshold or for specific operations
      if (options.logPerformance || responseTime > 500) {
        logApi.debug(`${formatLog.tag()} ${formatLog.endpoint(endpointId)} completed in ${responseTime}ms`);
      }
      
      return result;
    } catch (error) {
      // Check if this is a rate limit error
      const isRateLimit = this.isRateLimitError(error);
      
      // Update failure stats
      if (isRateLimit) {
        this.stats.rateLimitHits++;
        this.stats.byEndpoint[endpointId].rateLimitHits++;
        this.stats.byEndpoint[endpointId].lastRateLimitTime = Date.now();
      } else {
        this.stats.failedRequests++;
        this.stats.byEndpoint[endpointId].failedRequests++;
      }
      
      // Update health metrics
      const health = this.endpointHealth.get(endpointId);
      if (health) {
        health.totalRequests++;
        health.failedRequests++;
        
        if (isRateLimit) {
          health.rateLimitHits++;
        }
        
        this.endpointHealth.set(endpointId, health);
      }
      
      // Log error with endpoint information
      if (isRateLimit) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Rate limit hit on endpoint ${formatLog.endpoint(endpointId)}`)}`);
      } else {
        logApi.error(`${formatLog.tag()} ${formatLog.error(`Error on endpoint ${formatLog.endpoint(endpointId)}: ${error.message}`)}`);
      }
      
      // If this is a rate limit error and fallback is enabled, try another endpoint
      if (isRateLimit && options.fallbackOnRateLimit !== false && this.endpointIds.length > 1) {
        // Find an alternative endpoint
        const alternativeOptions = {
          ...options,
          excludeEndpoints: [...(options.excludeEndpoints || []), endpointId]
        };
        
        try {
          logApi.info(`${formatLog.tag()} ${formatLog.info(`Retrying with different endpoint after rate limit`)}`);
          return await this.executeRpc(rpcFunction, alternativeOptions);
        } catch (retryError) {
          // If retry failed, throw the original error
          throw error;
        }
      }
      
      // Throw the original error
      throw error;
    }
  }
  
  /**
   * Check if an error is a rate limit error
   * @param {Error} error - The error to check
   * @returns {boolean} Whether the error is a rate limit error
   */
  isRateLimitError(error) {
    return error.message && (
      error.message.includes('429') ||
      error.message.includes('rate') ||
      error.message.includes('limit') ||
      error.message.includes('requests per second') ||
      error.message.includes('too many requests')
    );
  }
  
  /**
   * Execute a specific Solana RPC method with automatic endpoint selection
   * @param {string} methodName - Name of the method to execute
   * @param {Array} args - Arguments to pass to the method
   * @param {Object} options - Execution options
   * @returns {Promise<any>} Result of the RPC call
   */
  async executeMethod(methodName, args = [], options = {}) {
    return this.executeRpc(connection => {
      // Ensure the method exists
      if (typeof connection[methodName] !== 'function') {
        throw new Error(`Method ${methodName} does not exist on Connection`);
      }
      
      // Execute the method with arguments
      return connection[methodName](...args);
    }, options);
  }
  
  /**
   * Get status information for all endpoints
   * @returns {Object} Status object with endpoint health and stats
   */
  getStatus() {
    const endpointStatus = this.endpointIds.map(id => {
      const connInfo = this.connections.get(id);
      const health = this.endpointHealth.get(id) || {};
      const stats = this.stats.byEndpoint[id] || {};
      
      return {
        id,
        endpoint: connInfo?.endpoint || 'unknown',
        isPrimary: connInfo?.isPrimary || false,
        hasWebsocket: connInfo?.hasWebsocket || false,
        isHealthy: health.isHealthy || false,
        lastCheck: health.lastCheck,
        avgResponseTimeMs: Math.round(health.averageResponseTimeMs || 0),
        lastResponseTimeMs: health.lastResponseTimeMs || 0,
        successRate: health.totalRequests ?
          Math.round((health.successfulRequests / health.totalRequests) * 100) :
          null,
        rateLimitHits: stats.rateLimitHits || 0,
        requests: stats.totalRequests || 0
      };
    });
    
    return {
      activeStrategy: this.config.strategy,
      healthyEndpoints: endpointStatus.filter(e => e.isHealthy).length,
      totalEndpoints: endpointStatus.length,
      endpoints: endpointStatus,
      stats: {
        totalRequests: this.stats.totalRequests,
        successfulRequests: this.stats.successfulRequests,
        failedRequests: this.stats.failedRequests,
        rateLimitHits: this.stats.rateLimitHits
      }
    };
  }
  
  /**
   * Clean up resources when shutting down
   */
  cleanup() {
    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    // Close any active connections if needed
    // (Connection doesn't have a close method, but we'll clear references)
    this.connections.clear();
    this.endpointHealth.clear();
    this.endpointIds = [];
    
    logApi.info(`${formatLog.tag()} ${formatLog.header('SHUTDOWN')} Connection Manager resources released`);
  }
}

// Create singleton instance
const connectionManager = new ConnectionManager();
export default connectionManager;