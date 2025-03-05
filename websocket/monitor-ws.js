/*
 * This is the WebSocket monitoring server.
 * It aggregates metrics from all WebSocket services and provides real-time monitoring.
 * 
 * Features:
 * - System-wide health monitoring
 * - Per-service metrics aggregation
 * - Real-time performance tracking
 * - Alert broadcasting
 * - Admin-only access
 * 
 * Message Types:
 * - SYSTEM_HEALTH: Overall system health update
 * - SERVICE_METRICS: Individual service metrics
 * - SERVICE_ALERT: Service alerts and notifications
 * - ERROR: Error messages
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
////import { BaseService } from '../utils/service-suite/base-service.js';

//import prisma from '../config/prisma.js';

// Message type constants
const MESSAGE_TYPES = {
    // Server -> Client
    SYSTEM_HEALTH: 'system:health',
    SERVICES_STATUS: 'services_status',   // Frontend expects this format
    SERVICE_UPDATE: 'service_update',     // Frontend expects this format
    SERVICE_METRICS: 'service:metrics',   // Legacy format
    SERVICE_ALERT: 'alert',               // Frontend expects this format
    ERROR: 'ERROR',
    
    // Client -> Server
    GET_INITIAL_STATE: 'get_initial_state',
    SERVICE_CONTROL: 'service_control'
};

// Error codes
const ERROR_CODES = {
    UNAUTHORIZED: 4003,
    SERVER_ERROR: 5001
};

/**
 * WebSocket Monitor Service
 * Aggregates and processes metrics from all WebSocket services
 */
class WebSocketMonitorService {
    constructor() {
        this.services = new Map();
        this.systemHealth = {
            status: 'initializing',
            activeIncidents: 0,
            lastUpdate: new Date()
        };
        this.isInitialized = false;
        
        // Mark as initialized after a short delay to allow services to register
        setTimeout(() => {
            this.isInitialized = true;
            logApi.info(`${fancyColors.BG_LIGHT_CYAN} WebSocketMonitorService ${fancyColors.RESET} ${fancyColors.BG_LIGHT_BLACK}${fancyColors.BOLD}${fancyColors.WHITE} Monitor service ready ${fancyColors.RESET}`);
        }, 2000);
    }

    /**
     * Update service metrics
     * @param {string} serviceName - Service name
     * @param {Object} metrics - Service metrics
     */
    updateServiceMetrics(serviceName, metrics = null) {
        if (!serviceName) return;

        try {
            // Store metrics as-is
            this.services.set(serviceName, {
                name: serviceName,
                ...metrics,
                status: metrics?.status || 'operational'
            });

            // Update system health
            this.updateSystemHealth();
        } catch (error) {
            logApi.error(`Error updating metrics for service ${serviceName}:`, error);
        }
    }

    /**
     * Update system health based on service metrics
     */
    updateSystemHealth() {
        try {
            let activeIncidents = 0;

            for (const service of this.services.values()) {
                if (service.status !== 'operational') {
                    activeIncidents++;
                }
            }

            this.systemHealth = {
                status: activeIncidents === 0 ? 'operational' : 
                        activeIncidents < 2 ? 'degraded' : 'error',
                activeIncidents,
                lastUpdate: new Date()
            };
        } catch (error) {
            logApi.error('Error updating system health:', error);
            this.systemHealth.status = 'error';
        }
    }

    /**
     * Get all service metrics
     * @returns {Array} Array of service metrics
     */
    getServiceMetrics() {
        return Array.from(this.services.values());
    }

    /**
     * Get system health
     * @returns {Object} System health metrics
     */
    getSystemHealth() {
        return this.systemHealth;
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.services.clear();
    }
}

/**
 * WebSocket Monitor Server
 * Handles real-time monitoring and metrics distribution
 */
class WebSocketMonitorServer extends BaseWebSocketServer {
    constructor(httpServer) {
        super(httpServer, {
            path: '/api/superadmin/ws/monitor',
            maxPayload: 1024 * 16, // 16KB max payload
            requireAuth: true,
            rateLimit: 600 // 10 updates/second - much more reasonable for admin monitoring
        });

        // Initialize stats object that was missing
        this.stats = {
            totalConnections: 0,
            messagesProcessed: 0,
            errors: 0,
            averageProcessingTime: 0,
            messagesPerSecond: 0,
            recentLatencies: []
        };
        
        this.monitorService = new WebSocketMonitorService();
        logApi.info('WebSocket Monitor server initialized');
    }

    /**
     * Handle client connection
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} request - HTTP request
     */
    async onConnection(ws, request) {
        // Verify admin access
        if (!request.user?.role || !['admin', 'superadmin'].includes(request.user.role)) {
            ws.close(ERROR_CODES.UNAUTHORIZED, 'Unauthorized');
            return;
        }

        super.onConnection(ws, request);

        // Send initial state in both formats (new frontend format and legacy format)
        this.sendToClient(ws, {
            type: MESSAGE_TYPES.SYSTEM_HEALTH,
            data: this.monitorService.getSystemHealth()
        });

        // Send the services_status message that the frontend expects
        this.sendToClient(ws, {
            type: MESSAGE_TYPES.SERVICES_STATUS,
            data: this.monitorService.getServiceMetrics()
        });

        // Send individual service updates too (legacy format)
        this.monitorService.getServiceMetrics().forEach(metrics => {
            this.sendToClient(ws, {
                type: MESSAGE_TYPES.SERVICE_METRICS,
                service: metrics.name,
                data: metrics
            });
        });
    }
    
    /**
     * Handle client messages
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} message - Client message
     */
    async onMessage(ws, message) {
        try {
            if (!message || !message.type) {
                return;
            }
            
            // Process message based on type
            switch (message.type) {
                case MESSAGE_TYPES.GET_INITIAL_STATE:
                    this.handleGetInitialState(ws);
                    break;
                
                case MESSAGE_TYPES.SERVICE_CONTROL:
                    await this.handleServiceControl(ws, message);
                    break;
                
                default:
                    // Unknown message type
                    this.sendToClient(ws, {
                        type: MESSAGE_TYPES.ERROR,
                        error: 'Unknown message type',
                        requestedType: message.type
                    });
            }
        } catch (error) {
            logApi.error('Error handling WebSocket message:', error);
            this.sendToClient(ws, {
                type: MESSAGE_TYPES.ERROR,
                error: 'Failed to process message',
                details: error.message
            });
        }
    }
    
    /**
     * Handle get_initial_state message
     * @param {WebSocket} ws - WebSocket connection
     */
    handleGetInitialState(ws) {
        // Send current system health
        this.sendToClient(ws, {
            type: MESSAGE_TYPES.SYSTEM_HEALTH,
            data: this.monitorService.getSystemHealth()
        });
        
        // Send all service metrics in the format the frontend expects
        this.sendToClient(ws, {
            type: MESSAGE_TYPES.SERVICES_STATUS,
            data: this.monitorService.getServiceMetrics()
        });
    }
    
    /**
     * Handle service_control message
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} message - Client message
     */
    async handleServiceControl(ws, message) {
        if (!message.service || !message.action) {
            this.sendToClient(ws, {
                type: MESSAGE_TYPES.ERROR,
                error: 'Invalid service control request',
                details: 'Service name and action are required'
            });
            return;
        }
        
        const { service, action } = message;
        
        // Check if service exists
        if (!global.wsServers[service]) {
            this.sendToClient(ws, {
                type: MESSAGE_TYPES.ERROR,
                error: 'Service not found',
                service
            });
            return;
        }
        
        try {
            let result;
            
            // Execute requested action
            switch (action) {
                case 'restart':
                    // Cleanup and reinitialize the service
                    await global.wsServers[service].cleanup();
                    // The service will be reinitialized by the initializer on next app restart
                    result = { success: true, message: `Service ${service} restarting` };
                    break;
                    
                case 'stop':
                    // Just cleanup the service
                    await global.wsServers[service].cleanup();
                    result = { success: true, message: `Service ${service} stopped` };
                    break;
                    
                default:
                    result = { success: false, message: `Action ${action} not supported` };
            }
            
            // Send the result
            this.sendToClient(ws, {
                type: MESSAGE_TYPES.SERVICE_UPDATE,
                service,
                data: {
                    status: result.success ? 'success' : 'error',
                    message: result.message,
                    timestamp: new Date().toISOString()
                }
            });
            
            // Broadcast the service update to all clients
            if (result.success) {
                this.broadcastServiceAlert(service, {
                    severity: 'info',
                    message: `Service ${action} requested: ${result.message}`
                });
                
                // Update the service metrics
                const metrics = global.wsServers[service]?.getMetrics?.() || {
                    status: action === 'stop' ? 'stopped' : 'restarting',
                    metrics: {
                        lastUpdate: new Date().toISOString()
                    }
                };
                
                this.updateServiceMetrics(service, metrics);
            }
            
        } catch (error) {
            logApi.error(`Error controlling service ${service}:`, error);
            this.sendToClient(ws, {
                type: MESSAGE_TYPES.ERROR,
                error: `Failed to ${action} service ${service}`,
                details: error.message
            });
        }
    }

    /**
     * Update service metrics
     * @param {string} serviceName - Service name
     * @param {Object} metrics - Service metrics
     */
    updateServiceMetrics(serviceName, metrics) {
        this.monitorService.updateServiceMetrics(serviceName, metrics);
        
        // Send in new frontend format
        this.broadcast({
            type: MESSAGE_TYPES.SERVICE_UPDATE,
            service: serviceName,
            data: metrics,
            timestamp: new Date().toISOString()
        });
        
        // Also send in legacy format for backward compatibility
        this.broadcast({
            type: MESSAGE_TYPES.SERVICE_METRICS,
            service: serviceName,
            data: metrics,
            timestamp: new Date().toISOString()
        });
        
        // Periodically broadcast consolidated services_status
        // This ensures all clients have the latest full picture
        if (this._lastServicesStatusBroadcast === undefined || 
            Date.now() - this._lastServicesStatusBroadcast > 5000) {
            this._lastServicesStatusBroadcast = Date.now();
            
            this.broadcast({
                type: MESSAGE_TYPES.SERVICES_STATUS,
                data: this.monitorService.getServiceMetrics(),
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Broadcast service alert
     * @param {string} serviceName - Service name
     * @param {Object} alert - Alert data
     */
    broadcastServiceAlert(serviceName, alert) {
        // Use the alert format that the frontend expects
        this.broadcast({
            type: MESSAGE_TYPES.SERVICE_ALERT,
            service: serviceName,
            data: {
                severity: alert.severity || 'info',
                message: alert.message,
                timestamp: new Date().toISOString()
            }
        });
    }
    
    /**
     * Get metrics from the WebSocket server
     * Uses the expected format for the frontend
     * @returns {Object} Metrics data
     */
    getMetrics() {
        const clients = this.wss ? this.wss.clients.size : 0;
        const uptime = process.uptime();
        
        return {
            name: "Monitor WebSocket",
            status: "operational",
            metrics: {
                totalConnections: this.stats.totalConnections,
                activeSubscriptions: clients,
                messageCount: this.stats.messagesProcessed,
                errorCount: this.stats.errors,
                cacheHitRate: 100,  // No caching for monitor
                averageLatency: this.stats.averageProcessingTime || 0,
                lastUpdate: new Date().toISOString()
            },
            performance: {
                messageRate: this.stats.messagesPerSecond || 0,
                errorRate: this.stats.messagesProcessed > 0 
                    ? (this.stats.errors / this.stats.messagesProcessed) * 100 
                    : 0,
                latencyTrend: this.stats.recentLatencies || []
            },
            config: {
                maxMessageSize: this.maxPayload,
                rateLimit: this.rateLimit,
                requireAuth: this.requireAuth
            },
            // Adding dependency information for frontend visualization
            dependencies: []
        };
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.monitorService.cleanup();
        super.cleanup();
        logApi.info('WebSocket Monitor server cleaned up');
    }
}

// Singleton instance
let instance = null;

/**
 * Create or return existing WebSocketMonitorServer instance
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {WebSocketMonitorServer} WebSocket monitor server instance
 */
export function createWebSocketMonitor(httpServer) {
    if (!instance) {
        instance = new WebSocketMonitorServer(httpServer);
    }
    return instance;
}

export { WebSocketMonitorServer };
export default instance; 