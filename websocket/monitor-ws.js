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
//import prisma from '../config/prisma.js';

// Message type constants
const MESSAGE_TYPES = {
    // Server -> Client
    SYSTEM_HEALTH: 'system:health',
    SERVICE_METRICS: 'service:metrics',
    SERVICE_ALERT: 'service:alert',
    ERROR: 'ERROR'
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
            logApi.info('Monitor service ready');
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
            rateLimit: 60 // 1 update/second
        });

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

        // Send initial state
        this.sendToClient(ws, {
            type: MESSAGE_TYPES.SYSTEM_HEALTH,
            data: this.monitorService.getSystemHealth()
        });

        this.monitorService.getServiceMetrics().forEach(metrics => {
            this.sendToClient(ws, {
                type: MESSAGE_TYPES.SERVICE_METRICS,
                service: metrics.name,
                data: metrics
            });
        });
    }

    /**
     * Update service metrics
     * @param {string} serviceName - Service name
     * @param {Object} metrics - Service metrics
     */
    updateServiceMetrics(serviceName, metrics) {
        this.monitorService.updateServiceMetrics(serviceName, metrics);
        
        this.broadcast({
            type: MESSAGE_TYPES.SERVICE_METRICS,
            service: serviceName,
            data: metrics,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Broadcast service alert
     * @param {string} serviceName - Service name
     * @param {Object} alert - Alert data
     */
    broadcastServiceAlert(serviceName, alert) {
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