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
            activeConnections: 0,
            messageRate: 0,
            activeIncidents: 0,
            lastUpdate: new Date()
        };
        this.updateInterval = 5000; // 5 seconds
        this.isInitialized = false;
        
        // Start periodic updates after a short delay to allow services to register
        setTimeout(() => {
            this.startPeriodicUpdates();
            this.isInitialized = true;
        }, 2000);
    }

    /**
     * Update service metrics
     * @param {string} serviceName - Service name
     * @param {Object} metrics - Service metrics
     */
    updateServiceMetrics(serviceName, metrics = null) {
        if (!serviceName) {
            logApi.warn('Attempted to update metrics without a service name');
            return;
        }

        try {
            // Define default metrics structure
            const defaultMetrics = {
                metrics: {
                    totalConnections: 0,
                    activeSubscriptions: 0,
                    messageCount: 0,
                    errorCount: 0,
                    lastUpdate: new Date().toISOString(),
                    cacheHitRate: 0,
                    averageLatency: 0
                },
                performance: {
                    messageRate: 0,
                    errorRate: 0,
                    latencyTrend: []
                },
                status: this.isInitialized ? 'error' : 'initializing'
            };

            // If metrics is provided, validate and merge with defaults
            let validatedMetrics = { ...defaultMetrics };
            if (metrics) {
                // Validate and coerce metric values
                const incomingMetrics = metrics.metrics || {};
                const incomingPerformance = metrics.performance || {};

                validatedMetrics.metrics = {
                    ...defaultMetrics.metrics,
                    totalConnections: Number(incomingMetrics.totalConnections) || 0,
                    activeSubscriptions: Number(incomingMetrics.activeSubscriptions) || 0,
                    messageCount: Number(incomingMetrics.messageCount) || 0,
                    errorCount: Number(incomingMetrics.errorCount) || 0,
                    cacheHitRate: Number(incomingMetrics.cacheHitRate) || 0,
                    averageLatency: Number(incomingMetrics.averageLatency) || 0,
                    lastUpdate: new Date().toISOString()
                };

                validatedMetrics.performance = {
                    ...defaultMetrics.performance,
                    messageRate: Number(incomingPerformance.messageRate) || 0,
                    errorRate: Number(incomingPerformance.errorRate) || 0,
                    latencyTrend: Array.isArray(incomingPerformance.latencyTrend) 
                        ? incomingPerformance.latencyTrend.slice(-10) // Keep last 10 data points
                        : []
                };

                // Validate status
                validatedMetrics.status = ['operational', 'degraded', 'error', 'initializing'].includes(metrics.status)
                    ? metrics.status
                    : defaultMetrics.status;
            }

            // Add metadata
            validatedMetrics.name = serviceName;
            validatedMetrics.lastUpdate = new Date();

            // Update service metrics
            this.services.set(serviceName, validatedMetrics);

            // Log validation issues if any
            if (metrics && JSON.stringify(metrics) !== JSON.stringify(validatedMetrics)) {
                logApi.debug(`Metrics normalized for service ${serviceName}:`, {
                    original: metrics,
                    normalized: validatedMetrics
                });
            }

            // Only update system health if we're initialized
            if (this.isInitialized) {
                this.updateSystemHealth();
            }

        } catch (error) {
            logApi.error(`Error updating metrics for service ${serviceName}:`, error);
            // Set error state metrics
            this.services.set(serviceName, {
                name: serviceName,
                metrics: {
                    totalConnections: 0,
                    activeSubscriptions: 0,
                    messageCount: 0,
                    errorCount: 1,
                    lastUpdate: new Date().toISOString(),
                    cacheHitRate: 0,
                    averageLatency: 0
                },
                performance: {
                    messageRate: 0,
                    errorRate: 1,
                    latencyTrend: []
                },
                status: this.isInitialized ? 'error' : 'initializing',
                lastUpdate: new Date()
            });
            if (this.isInitialized) {
                this.updateSystemHealth();
            }
        }
    }

    /**
     * Update system health based on service metrics
     */
    updateSystemHealth() {
        try {
            let totalConnections = 0;
            let totalMessageRate = 0;
            let incidents = 0;
            let activeServices = 0;

            // Validate and aggregate metrics from each service
            for (const [serviceName, service] of this.services.entries()) {
                try {
                    // Count active services
                    activeServices++;

                    // Safely extract metrics with fallbacks
                    const metrics = service?.metrics || {};
                    const performance = service?.performance || {};
                    
                    // Aggregate connection counts with safe defaults
                    totalConnections += Number(metrics?.totalConnections) || 0;
                    totalMessageRate += Number(performance?.messageRate) || 0;

                    // Track incidents
                    const serviceStatus = service?.status || 'unknown';
                    switch (serviceStatus) {
                        case 'error':
                            incidents++;
                            break;
                        case 'degraded':
                            incidents += 0.5;
                            break;
                        case 'unknown':
                            incidents += 0.25;
                            break;
                    }

                    // Log any services with invalid metrics
                    if (!metrics?.totalConnections && metrics?.totalConnections !== 0) {
                        logApi.warn(`Invalid metrics for service ${serviceName}:`, {
                            service: serviceName,
                            metrics: metrics
                        });
                    }
                } catch (error) {
                    logApi.error(`Error processing metrics for service ${serviceName}:`, error);
                    incidents++;
                }
            }

            // Determine overall system status
            let status = 'operational';
            if (incidents > 0) {
                status = incidents >= activeServices * 0.5 ? 'error' : 'degraded';
            }

            // Update system health with validated metrics
            this.systemHealth = {
                status,
                activeConnections: Math.max(0, totalConnections),
                messageRate: Math.max(0, totalMessageRate),
                activeIncidents: Math.round(incidents),
                activeServices,
                lastUpdate: new Date()
            };

            logApi.debug('System health updated:', this.systemHealth);

        } catch (error) {
            logApi.error('Error updating system health:', error);
            // Set error state if update fails
            this.systemHealth = {
                status: 'error',
                activeConnections: 0,
                messageRate: 0,
                activeIncidents: 1,
                activeServices: 0,
                lastUpdate: new Date()
            };
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
     * Start periodic updates
     */
    startPeriodicUpdates() {
        setInterval(() => {
            try {
                // Clean up stale services (no updates in 1 minute)
                const now = Date.now();
                for (const [name, service] of this.services.entries()) {
                    if (now - new Date(service.lastUpdate).getTime() > 60000) {
                        this.services.delete(name);
                    }
                }
                
                // Only update system health if we're initialized
                if (this.isInitialized) {
                    this.updateSystemHealth();
                }
            } catch (error) {
                logApi.error('Error in periodic updates:', error);
            }
        }, this.updateInterval);
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
        this.startMetricsBroadcast();
        
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
     * Start metrics broadcast
     */
    startMetricsBroadcast() {
        setInterval(() => {
            const health = this.monitorService.getSystemHealth();
            
            this.broadcast({
                type: MESSAGE_TYPES.SYSTEM_HEALTH,
                data: health,
                timestamp: new Date().toISOString()
            });
        }, 5000);
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