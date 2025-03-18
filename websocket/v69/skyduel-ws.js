// websocket/v69/skyduel-ws.js

/**
 * SkyDuel WebSocket Server (v69)
 * 
 * Unified service management system that provides real-time monitoring and control of services
 * with detailed metrics, circuit breaker states, and dependency visualization.
 * 
 * Features:
 * - Real-time monitoring of all services
 * - Administrative control (start/stop/restart)
 * - Circuit breaker management
 * - Dependency visualization
 * - Service state and config updates
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../../utils/service-suite/service-constants.js';
import AdminLogger from '../../utils/admin-logger.js';
import { getCircuitBreakerConfig } from '../../utils/service-suite/circuit-breaker-config.js';

// Configuration
const WSS_PATH = '/api/v69/ws/skyduel';
const WSS_REQUIRE_AUTH = false; // TEMPORARILY disabled auth for testing
const WSS_MAX_PAYLOAD = 5 * 1024 * 1024; // 5MB
const WSS_PER_MESSAGE_DEFLATE = false;
const WSS_RATE_LIMIT = 500;

class SkyDuelWebSocket extends BaseWebSocketServer {
  /**
   * Create a new SkyDuelWebSocket
   * @param {http.Server} server - The HTTP server to attach the WebSocket to
   */
  constructor(server) {
    super(server, {
      path: WSS_PATH,
      requireAuth: WSS_REQUIRE_AUTH,
      publicEndpoints: ['*'], // ALL endpoints are public for testing
      maxPayload: WSS_MAX_PAYLOAD,
      perMessageDeflate: WSS_PER_MESSAGE_DEFLATE,
      rateLimit: WSS_RATE_LIMIT,
      authMode: 'query' // Use query auth mode for most reliable browser connections
    });

    // Initialize SkyDuel-specific state
    this.adminSessions = new Map(); // Map of active admin sessions
    this.serviceSubscriptions = new Map(); // Map of service name to set of WebSocket connections
    this.connectionHeartbeats = new Map(); // Map of WebSocket connections to last heartbeat time

    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BOLD}${fancyColors.WHITE} V69 WEBSOCKET ${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}SkyDuel WebSocket initialized${fancyColors.RESET}`);
  }

  /**
   * Initialize the SkyDuel WebSocket
   */
  async onInitialize() {
    try {
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.CYAN}SkyDuel WebSocket initialized${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.RED}Failed to initialize SkyDuel WebSocket:${fancyColors.RESET} ${error.message}`);
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

    // TEMPORARILY DISABLED: SkyDuel normally requires superadmin access
    /*
    if (!clientInfo.authenticated || 
       (clientInfo.user.role !== 'admin' && clientInfo.user.role !== 'superadmin')) {
      this.sendError(ws, 'UNAUTHORIZED', 'SkyDuel WebSocket requires superadmin access');
      ws.close(4003, 'Unauthorized');
      return;
    }
    */

    // Add connection to admin sessions map
    this.adminSessions.set(clientInfo.connectionId, {
      connectionId: clientInfo.connectionId,
      user: clientInfo.user,
      lastActivity: Date.now()
    });

    // Send welcome message
    this.sendToClient(ws, {
      type: 'welcome',
      message: 'Connected to SkyDuel WebSocket Server',
      connectionId: clientInfo.connectionId,
      timestamp: new Date().toISOString()
    });

    // Send initial service data
    this.sendServiceData(ws);
  }

  /**
   * Send current service data to a client
   * @param {WebSocket} ws - The WebSocket client
   */
  async sendServiceData(ws) {
    try {
      // Get all services from service manager
      const services = serviceManager.getAllServices();
      
      // Format service data for client
      const serviceData = Object.entries(services).map(([name, service]) => {
        const metadata = getServiceMetadata(name);
        return {
          name,
          displayName: metadata?.displayName || name,
          status: service.getStatus(),
          isRunning: service.isRunning(),
          hasActiveCircuitBreaker: service.hasActiveCircuitBreaker(),
          dependencies: metadata?.dependencies || [],
          description: metadata?.description || 'No description available',
          version: metadata?.version || '1.0.0',
          lastUpdate: service.getLastUpdateTime(),
          metrics: service.getMetrics()
        };
      });
      
      // Send service data to client
      this.sendToClient(ws, {
        type: 'service_data',
        services: serviceData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SKYDUEL ${fancyColors.RESET} ${fancyColors.RED}Error sending service data:${fancyColors.RESET} ${error.message}`);
    }
  }

  /**
   * Handle incoming message from client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The parsed message
   */
  async onMessage(ws, message) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    // Update admin session last activity
    const adminSession = this.adminSessions.get(clientInfo.connectionId);
    if (adminSession) {
      adminSession.lastActivity = Date.now();
    }

    // Handle message based on type
    switch (message.type) {
      case 'get_services':
        this.sendServiceData(ws);
        break;

      case 'subscribe_service':
        if (message.serviceName) {
          if (!this.serviceSubscriptions.has(message.serviceName)) {
            this.serviceSubscriptions.set(message.serviceName, new Set());
          }
          this.serviceSubscriptions.get(message.serviceName).add(clientInfo.connectionId);
          
          this.sendToClient(ws, {
            type: 'service_subscribed',
            serviceName: message.serviceName,
            timestamp: new Date().toISOString()
          });
        }
        break;

      case 'unsubscribe_service':
        if (message.serviceName && this.serviceSubscriptions.has(message.serviceName)) {
          this.serviceSubscriptions.get(message.serviceName).delete(clientInfo.connectionId);
          
          this.sendToClient(ws, {
            type: 'service_unsubscribed',
            serviceName: message.serviceName,
            timestamp: new Date().toISOString()
          });
        }
        break;

      case 'service_command':
        if (message.serviceName && message.command) {
          const service = serviceManager.getService(message.serviceName);
          
          if (!service) {
            this.sendError(ws, 'SERVICE_NOT_FOUND', `Service "${message.serviceName}" not found`);
            return;
          }
          
          // Log admin action
          AdminLogger.logAction(clientInfo.user, 'SERVICE_COMMAND', {
            service: message.serviceName,
            command: message.command,
            params: message.params
          });
          
          // Execute command
          try {
            let result;
            switch (message.command) {
              case 'start':
                result = await service.start();
                break;
              case 'stop':
                result = await service.stop();
                break;
              case 'restart':
                result = await service.restart();
                break;
              case 'reset_circuit_breaker':
                result = service.resetCircuitBreaker();
                break;
              default:
                this.sendError(ws, 'INVALID_COMMAND', `Invalid command "${message.command}"`);
                return;
            }
            
            // Send result to client
            this.sendToClient(ws, {
              type: 'service_command_result',
              serviceName: message.serviceName,
              command: message.command,
              result,
              timestamp: new Date().toISOString()
            });
            
            // Also broadcast service update to all subscribed clients
            this.broadcastServiceUpdate(message.serviceName);
          } catch (error) {
            this.sendError(ws, 'COMMAND_FAILED', `Failed to execute command "${message.command}" on service "${message.serviceName}": ${error.message}`);
          }
        }
        break;

      case 'heartbeat':
        // Update heartbeat time
        this.connectionHeartbeats.set(clientInfo.connectionId, Date.now());
        
        // Send heartbeat response
        this.sendToClient(ws, {
          type: 'heartbeat_ack',
          timestamp: new Date().toISOString()
        });
        break;

      default:
        logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SKYDUEL ${fancyColors.RESET} ${fancyColors.YELLOW}Unknown message type: ${message.type}${fancyColors.RESET}`);
    }
  }

  /**
   * Broadcast service update to all subscribed clients
   * @param {string} serviceName - The name of the service
   */
  broadcastServiceUpdate(serviceName) {
    if (!this.serviceSubscriptions.has(serviceName)) {
      return;
    }
    
    try {
      const service = serviceManager.getService(serviceName);
      if (!service) {
        return;
      }
      
      const metadata = getServiceMetadata(serviceName);
      const serviceData = {
        name: serviceName,
        displayName: metadata?.displayName || serviceName,
        status: service.getStatus(),
        isRunning: service.isRunning(),
        hasActiveCircuitBreaker: service.hasActiveCircuitBreaker(),
        dependencies: metadata?.dependencies || [],
        description: metadata?.description || 'No description available',
        version: metadata?.version || '1.0.0',
        lastUpdate: service.getLastUpdateTime(),
        metrics: service.getMetrics()
      };
      
      // Send update to all subscribed clients
      const subscribedConnections = this.serviceSubscriptions.get(serviceName);
      for (const connectionId of subscribedConnections) {
        const client = this.findClientByConnectionId(connectionId);
        if (client) {
          this.sendToClient(client, {
            type: 'service_update',
            service: serviceData,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SKYDUEL ${fancyColors.RESET} ${fancyColors.RED}Error broadcasting service update:${fancyColors.RESET} ${error.message}`);
    }
  }

  /**
   * Find client by connection ID
   * @param {string} connectionId - The connection ID
   * @returns {WebSocket|null} - The WebSocket client or null if not found
   */
  findClientByConnectionId(connectionId) {
    for (const [client, info] of this.clientInfoMap.entries()) {
      if (info.connectionId === connectionId) {
        return client;
      }
    }
    return null;
  }

  /**
   * Handle client disconnection
   * @param {WebSocket} ws - The WebSocket connection
   */
  onDisconnection(ws) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Remove from admin sessions
    this.adminSessions.delete(clientInfo.connectionId);
    
    // Remove from service subscriptions
    for (const [service, clients] of this.serviceSubscriptions.entries()) {
      clients.delete(clientInfo.connectionId);
    }
    
    // Remove heartbeat time
    this.connectionHeartbeats.delete(clientInfo.connectionId);
  }

  /**
   * Cleanup when shutting down
   */
  async onCleanup() {
    this.adminSessions.clear();
    this.serviceSubscriptions.clear();
    this.connectionHeartbeats.clear();
    
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.CYAN}SkyDuel WebSocket cleaned up${fancyColors.RESET}`);
  }
  
  /**
   * Get custom metrics for this WebSocket
   * @returns {Object} - Custom metrics
   */
  getCustomMetrics() {
    return {
      adminSessions: this.adminSessions.size,
      serviceSubscriptions: Array.from(this.serviceSubscriptions.entries())
        .map(([service, clients]) => ({ service, subscribers: clients.size })),
      activeConnections: this.clientInfoMap.size
    };
  }
}

export function createSkyDuelWebSocket(server) {
  return new SkyDuelWebSocket(server);
}