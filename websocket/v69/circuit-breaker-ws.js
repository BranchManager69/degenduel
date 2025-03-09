/**
 * Circuit Breaker WebSocket (v69)
 * 
 * This WebSocket provides real-time circuit breaker status updates for DegenDuel services:
 * - Service health monitoring
 * - Circuit breaker state changes
 * - Admin reset functionality
 * - Service performance metrics
 * - Layer-based grouping of services
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import { isHealthy, getCircuitBreakerStatus, getCircuitBreakerConfig } from '../../utils/service-suite/circuit-breaker-config.js';
import { fancyColors } from '../../utils/colors.js';

// Log prefix for Circuit Breaker WebSocket
const LOG_PREFIX = `${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE} CIRCUIT-WS ${fancyColors.RESET}`;

// Constants for message types
const MESSAGE_TYPES = {
  // Server → Client messages
  SERVICE_UPDATE: 'service:update',
  SERVICES_STATE: 'services:state',
  HEALTH_CHECK_RESULT: 'service:health_check_result',
  CIRCUIT_RESET_RESULT: 'service:circuit_breaker_reset_result',
  LAYER_STATUS: 'layer:status',
  
  // Client → Server messages
  SUBSCRIBE_ALL: 'subscribe_all',
  SUBSCRIBE_SERVICES: 'subscribe:services', 
  SUBSCRIBE_LAYER: 'subscribe:layer',
  SUBSCRIBE_SERVICE: 'subscribe:service',
  HEALTH_CHECK: 'service:health_check',
  RESET_CIRCUIT_BREAKER: 'service:reset_circuit_breaker'
};

// Constants for channel prefixes
const CHANNEL_PREFIXES = {
  SERVICES: 'services', // all services
  SERVICE: 'service',   // service.<serviceName>
  LAYER: 'layer',       // layer.<layerName>
  ADMIN: 'admin'        // admin.circuit_breakers
};

// Update interval for periodic broadcasts (5 seconds)
const HEARTBEAT_INTERVAL = 5000;

/**
 * Circuit Breaker WebSocket Server
 * Provides real-time circuit breaker status and management
 */
class CircuitBreakerWebSocketServer extends BaseWebSocketServer {
  /**
   * Create a new CircuitBreakerWebSocketServer
   * @param {http.Server} server - The HTTP server to attach to
   */
  constructor(server) {
    super(server, {
      path: '/api/v69/ws/circuit-breaker',
      requireAuth: true, // Authentication required for circuit breaker access
      publicEndpoints: [], // No public endpoints, everything requires auth
      maxPayload: 512 * 1024, // 512KB for detailed service data
      rateLimit: 120, // 2 messages per second
      heartbeatInterval: 30000 // 30s heartbeat
    });
    
    // Initialize state tracking
    this.serviceStates = new Map();   // Track service states
    this.serviceUpdates = new Map();  // Track pending service updates
    this.adminActions = new Map();    // Track admin actions for audit
    
    // Start periodic state broadcasts
    this._startPeriodicUpdates();
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.CYAN}Circuit Breaker WebSocket initialized on ${fancyColors.BOLD}${this.path}${fancyColors.RESET}`);
  }
  
  /**
   * Set up periodic state broadcasts
   * @private
   */
  _startPeriodicUpdates() {
    this._updatesInterval = setInterval(async () => {
      await this._broadcastServicesState();
    }, HEARTBEAT_INTERVAL);
  }
  
  /**
   * Initialize the circuit breaker WebSocket
   */
  async onInitialize() {
    try {
      // Register for service events
      serviceEvents.on('service:initialized', (data) => this._handleServiceUpdate(data.name));
      serviceEvents.on('service:circuit_breaker', (data) => {
        if (data.status === 'open') {
          this._handleCircuitOpen(data.name);
        } else if (data.status === 'closed') {
          this._handleCircuitClosed(data.name);
        } else if (data.status === 'recovering') {
          this._handleCircuitRecovery(data.name);
        }
      });
      
      // Load initial service states
      await this._updateAllServiceStates();
      
      logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}${fancyColors.BOLD}Initialization complete${fancyColors.RESET} with ${fancyColors.BOLD}${serviceManager.services.size}${fancyColors.RESET} services loaded`);
      return true;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Initialization failed: ${error.message}${fancyColors.RESET}`, error);
      return false;
    }
  }
  
  /**
   * Handle new client connection
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   */
  async onConnection(ws, req) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Generate wallet display string
    const walletDisplay = clientInfo.authenticated ? 
                        `${clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin' ? 
                          fancyColors.RED : fancyColors.PURPLE}${clientInfo.user.wallet_address.substring(0,8)}...${fancyColors.RESET}` : 
                        `${fancyColors.LIGHT_GRAY}unauthenticated${fancyColors.RESET}`;
    
    const roleDisplay = clientInfo.authenticated ?
                       `${clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin' ? 
                         fancyColors.RED : fancyColors.PURPLE}${clientInfo.user.role}${fancyColors.RESET}` :
                       `${fancyColors.LIGHT_GRAY}none${fancyColors.RESET}`;
    
    // Log connection
    logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}New connection${fancyColors.RESET} ID:${clientInfo.connectionId.substring(0,8)} ${walletDisplay} role:${roleDisplay}`, {
      connectionId: clientInfo.connectionId,
      authenticated: clientInfo.authenticated,
      wallet: clientInfo.authenticated ? clientInfo.user.wallet_address : 'unauthenticated',
      role: clientInfo.authenticated ? clientInfo.user.role : 'none'
    });
    
    // For authenticated users, automatically subscribe to services channel
    if (clientInfo.authenticated) {
      await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.SERVICES}`);
      
      // Send welcome message with available commands
      this.sendToClient(ws, {
        type: 'welcome',
        message: 'Circuit Breaker WebSocket Connected',
        capabilities: {
          subscribe: true,
          healthCheck: true,
          resetCircuitBreaker: ['admin', 'superadmin'].includes(clientInfo.user.role),
          adminAccess: ['admin', 'superadmin'].includes(clientInfo.user.role)
        },
        channels: {
          all: `${CHANNEL_PREFIXES.SERVICES}`,
          layers: Object.keys(this._getServicesByLayer()).map(layer => `${CHANNEL_PREFIXES.LAYER}.${layer}`),
          services: Array.from(serviceManager.services.keys()).map(service => `${CHANNEL_PREFIXES.SERVICE}.${service}`)
        }
      });
      
      // For admins, also subscribe to admin channel automatically
      if (['admin', 'superadmin'].includes(clientInfo.user.role)) {
        await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.ADMIN}.circuit_breakers`);
      }
      
      // Send current services state
      await this._sendServicesState(ws);
    }
  }
  
  /**
   * Handle client messages
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message from client
   */
  async onMessage(ws, message) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo || !clientInfo.authenticated) return;
    
    try {
      switch (message.type) {
        case MESSAGE_TYPES.SUBSCRIBE_ALL:
        case MESSAGE_TYPES.SUBSCRIBE_SERVICES:
          // Already handled by default subscription on connect
          break;
          
        case MESSAGE_TYPES.SUBSCRIBE_LAYER:
          await this._handleSubscribeLayer(ws, message);
          break;
          
        case MESSAGE_TYPES.SUBSCRIBE_SERVICE:
          await this._handleSubscribeService(ws, message);
          break;
          
        case MESSAGE_TYPES.HEALTH_CHECK:
          await this._handleHealthCheck(ws, clientInfo, message);
          break;
          
        case MESSAGE_TYPES.RESET_CIRCUIT_BREAKER:
          await this._handleResetCircuitBreaker(ws, clientInfo, message);
          break;
          
        default:
          this.sendError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${message.type}`);
          break;
      }
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Message handling failed: ${error.message}${fancyColors.RESET}`, error);
      this.sendError(ws, 'INTERNAL_ERROR', 'Error processing message');
    }
  }
  
  /**
   * Handle layer subscription
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message object
   * @private
   */
  async _handleSubscribeLayer(ws, message) {
    const { layer } = message;
    if (!layer) {
      return this.sendError(ws, 'MISSING_LAYER', 'Layer name is required');
    }
    
    // Check if layer exists
    const servicesByLayer = this._getServicesByLayer();
    if (!servicesByLayer[layer]) {
      return this.sendError(ws, 'INVALID_LAYER', `Layer ${layer} not found`);
    }
    
    // Subscribe to layer channel
    await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.LAYER}.${layer}`);
    
    // Send current layer state
    await this._sendLayerState(ws, layer);
  }
  
  /**
   * Handle service subscription
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message object
   * @private
   */
  async _handleSubscribeService(ws, message) {
    const { service } = message;
    if (!service) {
      return this.sendError(ws, 'MISSING_SERVICE', 'Service name is required');
    }
    
    // Check if service exists
    if (!serviceManager.services.has(service)) {
      return this.sendError(ws, 'INVALID_SERVICE', `Service ${service} not found`);
    }
    
    // Subscribe to service channel
    await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.SERVICE}.${service}`);
    
    // Send current service state
    await this._sendServiceState(ws, service);
  }
  
  /**
   * Handle health check request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {Object} message - The message object
   * @private
   */
  async _handleHealthCheck(ws, clientInfo, message) {
    const { service } = message;
    if (!service) {
      return this.sendError(ws, 'MISSING_SERVICE', 'Service name is required');
    }
    
    // Check if service exists
    const serviceInstance = serviceManager.services.get(service);
    if (!serviceInstance) {
      return this.sendError(ws, 'INVALID_SERVICE', `Service ${service} not found`);
    }
    
    // Get user role and wallet for logging
    const walletStr = clientInfo.authenticated ? 
                     clientInfo.user.wallet_address.substring(0,8) : 
                     'unauthenticated';
    const roleStr = clientInfo.authenticated ? 
                   clientInfo.user.role : 
                   'none';
    
    // Log health check request
    logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} HEALTH CHECK ${fancyColors.RESET} User ${walletStr} (${roleStr}) checking service ${service}`);
    
    // Perform health check
    try {
      const isServiceHealthy = await serviceManager.checkServiceHealth(service);
      const circuitBreakerStatus = getCircuitBreakerStatus(serviceInstance.stats);
      
      // Generate status color code
      const statusColor = circuitBreakerStatus.status === 'closed' ? fancyColors.GREEN :
                          circuitBreakerStatus.status === 'degraded' ? fancyColors.YELLOW :
                          fancyColors.RED;
      
      // Log health check result
      logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} HEALTH RESULT ${fancyColors.RESET} Service ${service} is ${statusColor}${circuitBreakerStatus.status}${fancyColors.RESET} (healthy: ${isServiceHealthy})`);
      
      // Send health check result
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.HEALTH_CHECK_RESULT,
        timestamp: new Date().toISOString(),
        service,
        healthy: isServiceHealthy,
        status: serviceManager.determineServiceStatus(serviceInstance.stats),
        circuit_breaker: {
          status: circuitBreakerStatus.status,
          details: circuitBreakerStatus.details,
          is_open: serviceInstance.stats.circuitBreaker.isOpen,
          failures: serviceInstance.stats.circuitBreaker.failures,
          last_failure: serviceInstance.stats.circuitBreaker.lastFailure,
          last_success: serviceInstance.stats.circuitBreaker.lastSuccess,
          recovery_attempts: serviceInstance.stats.circuitBreaker.recoveryAttempts
        }
      });
      
      // Also broadcast to service channel
      this.broadcastToChannel(`${CHANNEL_PREFIXES.SERVICE}.${service}`, {
        type: MESSAGE_TYPES.SERVICE_UPDATE,
        timestamp: new Date().toISOString(),
        service,
        status: serviceManager.determineServiceStatus(serviceInstance.stats),
        circuit_breaker: {
          status: circuitBreakerStatus.status,
          details: circuitBreakerStatus.details,
          is_open: serviceInstance.stats.circuitBreaker.isOpen,
          failures: serviceInstance.stats.circuitBreaker.failures
        },
        checked_by: {
          role: roleStr,
          wallet: walletStr.substring(0,8) + '...'
        }
      });
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Health check failed: ${error.message}${fancyColors.RESET}`, error);
      this.sendError(ws, 'HEALTH_CHECK_FAILED', `Failed to check health for service ${service}: ${error.message}`);
    }
  }
  
  /**
   * Handle circuit breaker reset request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {Object} message - The message object
   * @private
   */
  async _handleResetCircuitBreaker(ws, clientInfo, message) {
    const { service } = message;
    if (!service) {
      return this.sendError(ws, 'MISSING_SERVICE', 'Service name is required');
    }
    
    // Check if service exists
    const serviceInstance = serviceManager.services.get(service);
    if (!serviceInstance) {
      return this.sendError(ws, 'INVALID_SERVICE', `Service ${service} not found`);
    }
    
    // Check if user is admin
    if (!['admin', 'superadmin'].includes(clientInfo.user.role)) {
      return this.sendError(ws, 'UNAUTHORIZED', 'Only admins can reset circuit breakers');
    }
    
    // Get user role and wallet for logging
    const walletStr = clientInfo.user.wallet_address.substring(0,8) + '...';
    const roleStr = clientInfo.user.role;
    
    // Log reset attempt
    logApi.info(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} MANUAL RESET ${fancyColors.RESET} Admin ${roleStr} ${walletStr} attempting to reset circuit breaker for ${service}`);
    
    // Record admin action for audit
    this.adminActions.set(`${service}_${Date.now()}`, {
      action: 'reset_circuit_breaker',
      service,
      admin: walletStr,
      role: roleStr,
      timestamp: new Date().toISOString()
    });
    
    // Attempt to reset
    try {
      await serviceInstance.attemptCircuitRecovery();
      const circuitBreakerStatus = getCircuitBreakerStatus(serviceInstance.stats);
      
      // Log reset result
      const statusColor = circuitBreakerStatus.status === 'closed' ? fancyColors.GREEN :
                          circuitBreakerStatus.status === 'degraded' ? fancyColors.YELLOW :
                          fancyColors.RED;
                          
      logApi.info(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} RESET RESULT ${fancyColors.RESET} Service ${service} circuit breaker is now ${statusColor}${circuitBreakerStatus.status}${fancyColors.RESET}`);
      
      // Send reset result
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.CIRCUIT_RESET_RESULT,
        timestamp: new Date().toISOString(),
        service,
        success: !serviceInstance.stats.circuitBreaker.isOpen,
        status: circuitBreakerStatus.status,
        details: circuitBreakerStatus.details
      });
      
      // Broadcast to service channel
      this.broadcastToChannel(`${CHANNEL_PREFIXES.SERVICE}.${service}`, {
        type: MESSAGE_TYPES.SERVICE_UPDATE,
        timestamp: new Date().toISOString(),
        service,
        status: serviceManager.determineServiceStatus(serviceInstance.stats),
        circuit_breaker: {
          status: circuitBreakerStatus.status,
          details: circuitBreakerStatus.details,
          is_open: serviceInstance.stats.circuitBreaker.isOpen,
          failures: serviceInstance.stats.circuitBreaker.failures,
          reset_by: {
            role: roleStr,
            wallet: walletStr
          }
        }
      });
      
      // Also broadcast to admin channel
      this.broadcastToChannel(`${CHANNEL_PREFIXES.ADMIN}.circuit_breakers`, {
        type: 'admin:circuit_reset',
        timestamp: new Date().toISOString(),
        service,
        result: {
          success: !serviceInstance.stats.circuitBreaker.isOpen,
          status: circuitBreakerStatus.status
        },
        admin: {
          role: roleStr,
          wallet: walletStr
        }
      });
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Reset failed: ${error.message}${fancyColors.RESET}`, error);
      this.sendError(ws, 'RESET_FAILED', `Failed to reset circuit breaker for service ${service}: ${error.message}`);
    }
  }
  
  /**
   * Handle service update event
   * @param {string} serviceName - Service name
   * @private
   */
  async _handleServiceUpdate(serviceName) {
    const service = serviceManager.services.get(serviceName);
    if (!service) return;
    
    // Update our cached state
    const serviceState = await serviceManager.getServiceState(serviceName);
    this.serviceStates.set(serviceName, {
      ...serviceState,
      timestamp: new Date().toISOString()
    });
    
    // Queue update for broadcast
    this.serviceUpdates.set(serviceName, true);
    
    // If service has a circuit breaker state change, broadcast immediately
    const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
    const previousState = this.serviceStates.get(serviceName);
    
    if (previousState?.circuit_breaker?.status !== circuitBreakerStatus.status) {
      // Broadcast to service channel
      this._broadcastServiceUpdate(serviceName, {
        previousStatus: previousState?.circuit_breaker?.status
      });
      
      // Broadcast to layer channel
      const layer = this._getServiceLayer(serviceName);
      if (layer) {
        this._broadcastLayerUpdate(layer);
      }
    }
  }
  
  /**
   * Handle circuit breaker open event
   * @param {string} serviceName - Service name
   * @private
   */
  async _handleCircuitOpen(serviceName) {
    const service = serviceManager.services.get(serviceName);
    if (!service) return;
    
    const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
    
    // Log circuit open with colors
    logApi.warn(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} CIRCUIT OPEN ${fancyColors.RESET} Service ${fancyColors.BOLD}${serviceName}${fancyColors.RESET} circuit breaker opened after ${fancyColors.BOLD}${service.stats.circuitBreaker.failures}${fancyColors.RESET} failures`);
    
    // Broadcast to service channel
    this._broadcastServiceUpdate(serviceName, {
      previousStatus: 'closed',
      alert: {
        type: 'circuit_open',
        severity: 'critical',
        message: circuitBreakerStatus.details
      }
    });
    
    // Broadcast to layer channel
    const layer = this._getServiceLayer(serviceName);
    if (layer) {
      this._broadcastLayerUpdate(layer);
    }
    
    // Broadcast to all services channel (critical alert)
    this.broadcastToChannel(`${CHANNEL_PREFIXES.SERVICES}`, {
      type: 'service:alert',
      timestamp: new Date().toISOString(),
      service: serviceName,
      alert: {
        type: 'circuit_open',
        severity: 'critical',
        message: `Circuit breaker opened for ${serviceName} after ${service.stats.circuitBreaker.failures} failures`
      },
      circuit_breaker: {
        status: circuitBreakerStatus.status,
        details: circuitBreakerStatus.details,
        is_open: true,
        failures: service.stats.circuitBreaker.failures,
        last_failure: service.stats.circuitBreaker.lastFailure
      }
    });
    
    // Broadcast to admin channel
    this.broadcastToChannel(`${CHANNEL_PREFIXES.ADMIN}.circuit_breakers`, {
      type: 'admin:circuit_open',
      timestamp: new Date().toISOString(),
      service: serviceName,
      details: {
        failures: service.stats.circuitBreaker.failures,
        last_failure: service.stats.circuitBreaker.lastFailure,
        config: service.config.circuitBreaker
      }
    });
  }
  
  /**
   * Handle circuit breaker closed event
   * @param {string} serviceName - Service name
   * @private
   */
  async _handleCircuitClosed(serviceName) {
    const service = serviceManager.services.get(serviceName);
    if (!service) return;
    
    const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
    
    // Log circuit closed with colors
    logApi.info(`${LOG_PREFIX} ${fancyColors.BG_GREEN}${fancyColors.BLACK} CIRCUIT CLOSED ${fancyColors.RESET} Service ${fancyColors.BOLD}${serviceName}${fancyColors.RESET} circuit breaker closed after ${fancyColors.BOLD}${service.stats.circuitBreaker.recoveryAttempts}${fancyColors.RESET} recovery attempts`);
    
    // Broadcast to service channel
    this._broadcastServiceUpdate(serviceName, {
      previousStatus: 'open',
      alert: {
        type: 'circuit_closed',
        severity: 'info',
        message: `Circuit breaker closed for ${serviceName}`
      }
    });
    
    // Broadcast to layer channel
    const layer = this._getServiceLayer(serviceName);
    if (layer) {
      this._broadcastLayerUpdate(layer);
    }
    
    // Broadcast to all services channel
    this.broadcastToChannel(`${CHANNEL_PREFIXES.SERVICES}`, {
      type: 'service:alert',
      timestamp: new Date().toISOString(),
      service: serviceName,
      alert: {
        type: 'circuit_closed',
        severity: 'info',
        message: `Circuit breaker closed for ${serviceName}`
      },
      circuit_breaker: {
        status: circuitBreakerStatus.status,
        details: circuitBreakerStatus.details,
        is_open: false,
        recovery_attempts: service.stats.circuitBreaker.recoveryAttempts,
        last_reset: service.stats.circuitBreaker.lastReset
      }
    });
    
    // Broadcast to admin channel
    this.broadcastToChannel(`${CHANNEL_PREFIXES.ADMIN}.circuit_breakers`, {
      type: 'admin:circuit_closed',
      timestamp: new Date().toISOString(),
      service: serviceName,
      details: {
        recovery_attempts: service.stats.circuitBreaker.recoveryAttempts,
        last_reset: service.stats.circuitBreaker.lastReset
      }
    });
  }
  
  /**
   * Handle circuit breaker recovery attempt
   * @param {string} serviceName - Service name
   * @private
   */
  async _handleCircuitRecovery(serviceName) {
    const service = serviceManager.services.get(serviceName);
    if (!service) return;
    
    const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
    
    // Log recovery attempt with colors
    logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} RECOVERY ATTEMPT ${fancyColors.RESET} Service ${fancyColors.BOLD}${serviceName}${fancyColors.RESET} attempt #${fancyColors.BOLD}${service.stats.circuitBreaker.recoveryAttempts}${fancyColors.RESET}`);
    
    // Only broadcast to admin channel
    this.broadcastToChannel(`${CHANNEL_PREFIXES.ADMIN}.circuit_breakers`, {
      type: 'admin:recovery_attempt',
      timestamp: new Date().toISOString(),
      service: serviceName,
      details: {
        attempt: service.stats.circuitBreaker.recoveryAttempts,
        timestamp: service.stats.circuitBreaker.lastRecoveryAttempt,
        result: circuitBreakerStatus.status === 'closed' ? 'success' : 'failure'
      }
    });
    
    // If recovery attempt resulted in circuit closing, handle that event
    if (circuitBreakerStatus.status === 'closed') {
      await this._handleCircuitClosed(serviceName);
    }
  }
  
  /**
   * Update all service states
   * @private
   */
  async _updateAllServiceStates() {
    try {
      const services = Array.from(serviceManager.services.entries());
      
      // Fetch states in parallel
      await Promise.all(
        services.map(async ([name, service]) => {
          try {
            const state = await serviceManager.getServiceState(name);
            this.serviceStates.set(name, {
              ...state,
              timestamp: new Date().toISOString()
            });
          } catch (error) {
            logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Failed to get state for ${name}: ${error.message}${fancyColors.RESET}`, error);
          }
        })
      );
      
      logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}Updated ${fancyColors.BOLD}${this.serviceStates.size}${fancyColors.RESET}${fancyColors.CYAN} service states${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Failed to update service states: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Send all services state to a client
   * @param {WebSocket} ws - The WebSocket connection
   * @private
   */
  async _sendServicesState(ws) {
    try {
      // Ensure we have fresh data
      await this._updateAllServiceStates();
      
      const services = Array.from(serviceManager.services.entries());
      const states = await Promise.all(
        services.map(async ([name, service]) => {
          try {
            if (!service) {
              return this._createUnknownServiceState(name);
            }
            
            const state = this.serviceStates.get(name) || await serviceManager.getServiceState(name);
            const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
            
            return {
              service: name,
              status: serviceManager.determineServiceStatus(service.stats),
              circuit_breaker: {
                status: circuitBreakerStatus.status,
                details: circuitBreakerStatus.details,
                is_open: service.stats.circuitBreaker.isOpen,
                failures: service.stats.circuitBreaker.failures,
                last_failure: service.stats.circuitBreaker.lastFailure,
                last_success: service.stats.circuitBreaker.lastSuccess,
                recovery_attempts: service.stats.circuitBreaker.recoveryAttempts,
                last_recovery_attempt: service.stats.circuitBreaker.lastRecoveryAttempt,
                last_reset: service.stats.circuitBreaker.lastReset
              },
              operations: service.stats.operations,
              performance: service.stats.performance,
              config: service.config.circuitBreaker,
              layer: this._getServiceLayer(name),
              ...state
            };
          } catch (error) {
            logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Error getting state for ${name}: ${error.message}${fancyColors.RESET}`, error);
            return this._createErrorServiceState(name, error);
          }
        })
      );
      
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.SERVICES_STATE,
        timestamp: new Date().toISOString(),
        services: states
      });
      
      logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} STATE SENT ${fancyColors.RESET} Sent ${states.length} service states to client ${clientInfo?.connectionId?.substring(0,8) || 'unknown'}`);
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Error sending services state: ${error.message}${fancyColors.RESET}`, error);
      this.sendError(ws, 'STATE_FETCH_ERROR', 'Error fetching services state');
    }
  }
  
  /**
   * Send service state to a client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} serviceName - Service name
   * @private
   */
  async _sendServiceState(ws, serviceName) {
    try {
      const service = serviceManager.services.get(serviceName);
      if (!service) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.SERVICE_UPDATE,
          timestamp: new Date().toISOString(),
          service: serviceName,
          status: 'unknown',
          error: 'Service not found'
        });
        return;
      }
      
      const state = this.serviceStates.get(serviceName) || await serviceManager.getServiceState(serviceName);
      const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
      
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.SERVICE_UPDATE,
        timestamp: new Date().toISOString(),
        service: serviceName,
        status: serviceManager.determineServiceStatus(service.stats),
        circuit_breaker: {
          status: circuitBreakerStatus.status,
          details: circuitBreakerStatus.details,
          is_open: service.stats.circuitBreaker.isOpen,
          failures: service.stats.circuitBreaker.failures,
          last_failure: service.stats.circuitBreaker.lastFailure,
          last_success: service.stats.circuitBreaker.lastSuccess,
          recovery_attempts: service.stats.circuitBreaker.recoveryAttempts,
          last_recovery_attempt: service.stats.circuitBreaker.lastRecoveryAttempt,
          last_reset: service.stats.circuitBreaker.lastReset
        },
        operations: service.stats.operations,
        performance: service.stats.performance,
        config: service.config.circuitBreaker,
        layer: this._getServiceLayer(serviceName),
        ...state
      });
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Error sending service state for ${serviceName}: ${error.message}${fancyColors.RESET}`, error);
      this.sendError(ws, 'STATE_FETCH_ERROR', `Error fetching state for service ${serviceName}`);
    }
  }
  
  /**
   * Send layer state to a client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} layer - Layer name
   * @private
   */
  async _sendLayerState(ws, layer) {
    try {
      const servicesByLayer = this._getServicesByLayer();
      const layerServices = servicesByLayer[layer] || [];
      
      if (layerServices.length === 0) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.LAYER_STATUS,
          timestamp: new Date().toISOString(),
          layer,
          status: 'unknown',
          error: 'Layer has no services'
        });
        return;
      }
      
      // Get status of all services in this layer
      const servicesStatus = await Promise.all(
        layerServices.map(async (serviceName) => {
          const service = serviceManager.services.get(serviceName);
          if (!service) return { service: serviceName, status: 'unknown' };
          
          const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
          return {
            service: serviceName,
            status: serviceManager.determineServiceStatus(service.stats),
            circuit_breaker: {
              status: circuitBreakerStatus.status,
              is_open: service.stats.circuitBreaker.isOpen
            }
          };
        })
      );
      
      // Determine layer status based on service statuses
      const hasOpenCircuit = servicesStatus.some(s => s.circuit_breaker?.is_open);
      const allUnknown = servicesStatus.every(s => s.status === 'unknown');
      const hasDegraded = servicesStatus.some(s => s.circuit_breaker?.status === 'degraded');
      
      let layerStatus;
      if (allUnknown) {
        layerStatus = 'unknown';
      } else if (hasOpenCircuit) {
        layerStatus = 'critical';
      } else if (hasDegraded) {
        layerStatus = 'warning';
      } else {
        layerStatus = 'operational';
      }
      
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.LAYER_STATUS,
        timestamp: new Date().toISOString(),
        layer,
        status: layerStatus,
        services: servicesStatus
      });
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Error sending layer state for ${layer}: ${error.message}${fancyColors.RESET}`, error);
      this.sendError(ws, 'STATE_FETCH_ERROR', `Error fetching state for layer ${layer}`);
    }
  }
  
  /**
   * Broadcast current services state to all clients
   * @private
   */
  async _broadcastServicesState() {
    try {
      await this._updateAllServiceStates();
      
      const services = Array.from(serviceManager.services.entries())
        .map(([name, service]) => {
          try {
            if (!service) {
              return this._createUnknownServiceState(name);
            }
            
            const state = this.serviceStates.get(name);
            const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
            
            return {
              service: name,
              status: serviceManager.determineServiceStatus(service.stats),
              circuit_breaker: {
                status: circuitBreakerStatus.status,
                details: circuitBreakerStatus.details,
                is_open: service.stats.circuitBreaker.isOpen,
                failures: service.stats.circuitBreaker.failures,
                last_failure: service.stats.circuitBreaker.lastFailure,
                last_success: service.stats.circuitBreaker.lastSuccess
              },
              operations: service.stats.operations,
              layer: this._getServiceLayer(name),
              ...(state || {})
            };
          } catch (error) {
            logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error getting state for ${name}: ${error.message}${fancyColors.RESET}`, error);
            return this._createErrorServiceState(name, error);
          }
        });
      
      // Only broadcast if we have subscribers
      const channelName = CHANNEL_PREFIXES.SERVICES;
      const subscribers = this.channelSubscriptions.get(channelName);
      
      if (subscribers && subscribers.size > 0) {
        logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} BROADCAST ${fancyColors.RESET} Sending services state to ${subscribers.size} subscribers`);
        
        this.broadcastToChannel(channelName, {
          type: MESSAGE_TYPES.SERVICES_STATE,
          timestamp: new Date().toISOString(),
          services
        });
      }
      
      // Clear pending updates
      this.serviceUpdates.clear();
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Error broadcasting services state: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Broadcast service update to subscribers
   * @param {string} serviceName - Service name
   * @param {Object} additionalInfo - Additional information to include
   * @private
   */
  _broadcastServiceUpdate(serviceName, additionalInfo = {}) {
    try {
      const service = serviceManager.services.get(serviceName);
      if (!service) return;
      
      const state = this.serviceStates.get(serviceName);
      const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
      
      // Only broadcast if we have subscribers
      const channelName = `${CHANNEL_PREFIXES.SERVICE}.${serviceName}`;
      const subscribers = this.channelSubscriptions.get(channelName);
      
      if (subscribers && subscribers.size > 0) {
        logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} BROADCAST ${fancyColors.RESET} Sending service update for ${serviceName} to ${subscribers.size} subscribers`);
        
        this.broadcastToChannel(channelName, {
          type: MESSAGE_TYPES.SERVICE_UPDATE,
          timestamp: new Date().toISOString(),
          service: serviceName,
          status: serviceManager.determineServiceStatus(service.stats),
          circuit_breaker: {
            status: circuitBreakerStatus.status,
            details: circuitBreakerStatus.details,
            is_open: service.stats.circuitBreaker.isOpen,
            failures: service.stats.circuitBreaker.failures,
            last_failure: service.stats.circuitBreaker.lastFailure,
            last_success: service.stats.circuitBreaker.lastSuccess,
            recovery_attempts: service.stats.circuitBreaker.recoveryAttempts
          },
          operations: service.stats.operations,
          performance: service.stats.performance,
          layer: this._getServiceLayer(serviceName),
          ...(state || {}),
          ...additionalInfo
        });
      }
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Error broadcasting service update for ${serviceName}: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Broadcast layer update to subscribers
   * @param {string} layer - Layer name
   * @private
   */
  async _broadcastLayerUpdate(layer) {
    try {
      const servicesByLayer = this._getServicesByLayer();
      const layerServices = servicesByLayer[layer] || [];
      
      if (layerServices.length === 0) return;
      
      // Get status of all services in this layer
      const servicesStatus = await Promise.all(
        layerServices.map(async (serviceName) => {
          const service = serviceManager.services.get(serviceName);
          if (!service) return { service: serviceName, status: 'unknown' };
          
          const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
          return {
            service: serviceName,
            status: serviceManager.determineServiceStatus(service.stats),
            circuit_breaker: {
              status: circuitBreakerStatus.status,
              is_open: service.stats.circuitBreaker.isOpen
            }
          };
        })
      );
      
      // Determine layer status based on service statuses
      const hasOpenCircuit = servicesStatus.some(s => s.circuit_breaker?.is_open);
      const allUnknown = servicesStatus.every(s => s.status === 'unknown');
      const hasDegraded = servicesStatus.some(s => s.circuit_breaker?.status === 'degraded');
      
      let layerStatus;
      if (allUnknown) {
        layerStatus = 'unknown';
      } else if (hasOpenCircuit) {
        layerStatus = 'critical';
      } else if (hasDegraded) {
        layerStatus = 'warning';
      } else {
        layerStatus = 'operational';
      }
      
      // Only broadcast if we have subscribers
      const channelName = `${CHANNEL_PREFIXES.LAYER}.${layer}`;
      const subscribers = this.channelSubscriptions.get(channelName);
      
      if (subscribers && subscribers.size > 0) {
        logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} BROADCAST ${fancyColors.RESET} Sending layer update for ${layer} to ${subscribers.size} subscribers`);
        
        this.broadcastToChannel(channelName, {
          type: MESSAGE_TYPES.LAYER_STATUS,
          timestamp: new Date().toISOString(),
          layer,
          status: layerStatus,
          services: servicesStatus
        });
      }
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Error broadcasting layer update for ${layer}: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Get services organized by layer
   * @returns {Object} Services by layer
   * @private
   */
  _getServicesByLayer() {
    const result = {
      data: [],
      contest: [],
      wallet: [],
      infrastructure: []
    };
    
    for (const [name, service] of serviceManager.services.entries()) {
      const layer = this._getServiceLayer(name);
      if (layer && result[layer]) {
        result[layer].push(name);
      }
    }
    
    return result;
  }
  
  /**
   * Get layer for a service
   * @param {string} serviceName - Service name
   * @returns {string} Layer name
   * @private
   */
  _getServiceLayer(serviceName) {
    // Map service names to layers based on common patterns
    if (serviceName.includes('Token') || serviceName.includes('Market') || serviceName.includes('Data')) {
      return 'data';
    } else if (serviceName.includes('Contest') || serviceName.includes('Referral') || serviceName.includes('Achievement')) {
      return 'contest';
    } else if (serviceName.includes('Wallet') || serviceName.includes('Faucet') || serviceName.includes('Balance')) {
      return 'wallet';
    } else {
      return 'infrastructure';
    }
  }
  
  /**
   * Create an unknown service state object
   * @param {string} serviceName - Service name
   * @returns {Object} Unknown service state
   * @private
   */
  _createUnknownServiceState(serviceName) {
    return {
      service: serviceName,
      status: 'unknown',
      circuit_breaker: {
        status: 'unknown',
        details: 'Service not found',
        is_open: false,
        failures: 0,
        last_failure: null,
        last_success: null,
        recovery_attempts: 0,
        last_recovery_attempt: null,
        last_reset: null
      },
      operations: { total: 0, successful: 0, failed: 0 },
      performance: { averageOperationTimeMs: 0, lastOperationTimeMs: 0 },
      config: {}
    };
  }
  
  /**
   * Create an error service state object
   * @param {string} serviceName - Service name
   * @param {Error} error - Error object
   * @returns {Object} Error service state
   * @private
   */
  _createErrorServiceState(serviceName, error) {
    return {
      service: serviceName,
      status: 'error',
      error: error.message,
      circuit_breaker: {
        status: 'unknown',
        details: 'Error getting service state',
        is_open: false,
        failures: 0,
        last_failure: null,
        last_success: null,
        recovery_attempts: 0,
        last_recovery_attempt: null,
        last_reset: null
      },
      operations: { total: 0, successful: 0, failed: 0 },
      performance: { averageOperationTimeMs: 0, lastOperationTimeMs: 0 },
      config: {}
    };
  }
  
  /**
   * Clean up resources
   */
  async onCleanup() {
    // Clear intervals
    if (this._updatesInterval) {
      clearInterval(this._updatesInterval);
      this._updatesInterval = null;
    }
    
    // Clear caches
    this.serviceStates.clear();
    this.serviceUpdates.clear();
    this.adminActions.clear();
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}Cleanup complete${fancyColors.RESET}`);
  }
  
  /**
   * Get server metrics
   * @returns {Object} Server metrics
   */
  getMetrics() {
    return {
      name: 'Circuit Breaker WebSocket v69',
      status: 'operational',
      metrics: {
        ...this.stats,
        serviceCount: serviceManager.services.size,
        serviceStatesCached: this.serviceStates.size,
        channelSubscriptions: {
          servicesChannel: this.channelSubscriptions.get(CHANNEL_PREFIXES.SERVICES)?.size || 0,
          serviceChannels: Array.from(this.channelSubscriptions.entries())
            .filter(([channel]) => channel.startsWith(`${CHANNEL_PREFIXES.SERVICE}.`))
            .reduce((count, [, subscribers]) => count + subscribers.size, 0),
          layerChannels: Array.from(this.channelSubscriptions.entries())
            .filter(([channel]) => channel.startsWith(`${CHANNEL_PREFIXES.LAYER}.`))
            .reduce((count, [, subscribers]) => count + subscribers.size, 0),
          adminChannel: this.channelSubscriptions.get(`${CHANNEL_PREFIXES.ADMIN}.circuit_breakers`)?.size || 0
        },
        adminActions: this.adminActions.size,
        lastUpdate: new Date().toISOString()
      }
    };
  }
}

// Export singleton instance
let instance = null;

/**
 * Create circuit breaker WebSocket server instance
 * @param {http.Server} server - HTTP server
 * @returns {CircuitBreakerWebSocketServer} - Circuit breaker WebSocket server instance
 */
export function createCircuitBreakerWebSocket(server) {
  if (!instance) {
    instance = new CircuitBreakerWebSocketServer(server);
  }
  return instance;
}

export { CircuitBreakerWebSocketServer };
export default instance;