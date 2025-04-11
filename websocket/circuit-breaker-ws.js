// websocket/circuit-breaker-ws.js

/*
 * This is the WebSocket server for the circuit breaker service.
 * It handles the subscription and unsubscription of circuit breakers by clients.
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import serviceManager from '../utils/service-suite/service-manager.js';
import { isHealthy, getCircuitBreakerStatus } from '../utils/service-suite/circuit-breaker-config.js';
import { fancyColors } from '../utils/colors.js';

const HEARTBEAT_INTERVAL = 5000; // 5 seconds
const CLIENT_TIMEOUT = 7000;     // 7 seconds

// TODO: Use the allowed origins list defined elsewhere; this one is missing MANY subdomains.
const DEFAULT_ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
    'http://localhost:3004',
    'http://localhost:3005',
    'http://localhost:3006',
    'http://localhost:3007',
    'http://localhost:3008', 
    'http://localhost:56347',
    'https://branch.bet',
    'https://degenduel.me',
    'https://app.degenduel.me',
    'https://data.degenduel.me',
    'https://dev.degenduel.me',
];
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : DEFAULT_ALLOWED_ORIGINS;
// Log configured origins on startup (im sick of seeing this)
if (0===1) {
    logApi.info('WebSocket allowed origins:', {
        origins: ALLOWED_ORIGINS,
        source: process.env.ALLOWED_ORIGINS ? 'Environment' : 'Default'
    });
}

// Circuit Breaker WebSocket Server
class CircuitBreakerWebSocketServer extends BaseWebSocketServer {
    constructor(server) {
        // Create the configuration object
        const config = {
            path: '/api/ws/circuit-breaker',
            maxPayload: 1024 * 16, // 16KB
            rateLimit: 60, // 60 messages per minute
            requireAuth: true,
            allowedOrigins: ALLOWED_ORIGINS,
            perMessageDeflate: false, // Disable compression to avoid RSV1 flag issues
            useCompression: false     // Also set the alias property for clarity
        };

        // Initialize base class with server and config
        super(server, config);

        this.services = new Map();
        this.recoveryTimeouts = new Map();

        // Start periodic state broadcasts
        this.startPeriodicUpdates();
    }

    /**
     * Notify clients about a service update
     */
    async notifyServiceUpdate(serviceName, state) {
        if (!this.wss) return;

        const service = serviceManager.services.get(serviceName);
        if (!service) return;

        const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
        const message = {
            type: 'service:update',
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
            ...state
        };

        this.broadcast(message);

        // Log significant state changes
        if (circuitBreakerStatus.status === 'open') {
            logApi.warn(`${fancyColors.RED}[SERVICE CIRCUIT BREAKER]${fancyColors.RESET} Circuit breaker opened for ${serviceName}`, {
                failures: service.stats.circuitBreaker.failures,
                lastFailure: service.stats.circuitBreaker.lastFailure,
                recoveryAttempts: service.stats.circuitBreaker.recoveryAttempts
            });
        } else if (circuitBreakerStatus.status === 'closed' && state.previousStatus === 'open') {
            logApi.info(`${fancyColors.GREEN}[SERVICE CIRCUIT BREAKER]${fancyColors.RESET} Circuit breaker closed for ${serviceName}`, {
                recoveryAttempts: service.stats.circuitBreaker.recoveryAttempts,
                lastReset: service.stats.circuitBreaker.lastReset
            });
        }
    }

    /**
     * Add initialize method to support the WebSocket initialization process
     */
    async initialize() {
        // Any specific initialization logic for circuit breaker WebSocket
        logApi.info('Circuit Breaker WebSocket server initialized');
        return true;
    }

    /**
     * Handle client message - renamed to match base class method
     */
    async handleClientMessage(ws, data, clientInfo) {
        try {
            switch (data.type) {
                case 'subscribe_all':
                case 'subscribe:services':
                    // Already handled by default behavior
                    this.sendToClient(ws, {
                        type: 'subscription:success',
                        message: 'Subscribed to all service updates',
                        timestamp: new Date().toISOString()
                    });
                    break;

                case 'service:health_check':
                    if (data.service) {
                        this.handleHealthCheck(ws, data.service);
                    }
                    break;

                case 'service:reset_circuit_breaker':
                    if (data.service) {
                        this.handleCircuitBreakerReset(ws, data.service);
                    }
                    break;

                default:
                    this.sendError(ws, 'Invalid message type', 4004);
            }
        } catch (error) {
            logApi.error('Error handling client message:', error);
            this.sendError(ws, 'Invalid message format', 4004);
        }
    }

    /**
     * Send the current state of all services to a client
     * Use after connection to provide initial state
     */
    async sendAllServicesState(ws) {
        try {
            const services = Array.from(serviceManager.services.entries());
            const states = await Promise.all(
                services.map(async ([name, service]) => {
                    const state = await serviceManager.getServiceState(name);
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
                        ...state
                    };
                })
            );

            this.sendToClient(ws, {
                type: 'services:state',
                timestamp: new Date().toISOString(),
                services: states
            });
        } catch (error) {
            logApi.error('Error sending services state:', error);
            this.sendError(ws, 'Error fetching services state', 5000);
        }
    }

    /**
     * Handle health check request
     */
    async handleHealthCheck(ws, serviceName) {
        const service = serviceManager.services.get(serviceName);
        if (!service) {
            ws.send(JSON.stringify({
                type: 'error',
                code: 4004,
                message: 'Service not found',
                timestamp: new Date().toISOString()
            }));
            return;
        }

        const isServiceHealthy = await serviceManager.checkServiceHealth(serviceName);
        const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
        
        ws.send(JSON.stringify({
            type: 'service:health_check_result',
            timestamp: new Date().toISOString(),
            service: serviceName,
            healthy: isServiceHealthy,
            status: serviceManager.determineServiceStatus(service.stats),
            circuit_breaker: {
                status: circuitBreakerStatus.status,
                details: circuitBreakerStatus.details,
                is_open: service.stats.circuitBreaker.isOpen,
                failures: service.stats.circuitBreaker.failures
            }
        }));
    }

    /**
     * Handle circuit breaker reset request
     */
    async handleCircuitBreakerReset(ws, serviceName) {
        const service = serviceManager.services.get(serviceName);
        if (!service) {
            ws.send(JSON.stringify({
                type: 'error',
                code: 4004,
                message: 'Service not found',
                timestamp: new Date().toISOString()
            }));
            return;
        }

        try {
            await service.attemptCircuitRecovery();
            const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
            
            ws.send(JSON.stringify({
                type: 'service:circuit_breaker_reset_result',
                timestamp: new Date().toISOString(),
                service: serviceName,
                success: !service.stats.circuitBreaker.isOpen,
                status: circuitBreakerStatus.status,
                details: circuitBreakerStatus.details
            }));
        } catch (error) {
            ws.send(JSON.stringify({
                type: 'error',
                code: 5000,
                message: 'Failed to reset circuit breaker',
                details: error.message,
                timestamp: new Date().toISOString()
            }));
        }
    }

    /**
     * Start periodic state broadcasts
     */
    startPeriodicUpdates() {
        setInterval(async () => {
            try {
                const services = Array.from(serviceManager.services.entries());
                const states = await Promise.all(
                    services.map(async ([name, service]) => {
                        try {
                            if (!service) {
                                return {
                                    service: name,
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

                            const state = await serviceManager.getServiceState(name);
                            const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
                            
                            return {
                                service: name,
                                status: serviceManager.determineServiceStatus(service.stats),
                                circuit_breaker: {
                                    status: circuitBreakerStatus.status,
                                    details: circuitBreakerStatus.details,
                                    is_open: circuitBreakerStatus.isOpen,
                                    failures: circuitBreakerStatus.failures,
                                    last_failure: circuitBreakerStatus.lastFailure,
                                    last_success: circuitBreakerStatus.lastSuccess,
                                    recovery_attempts: circuitBreakerStatus.recoveryAttempts,
                                    last_recovery_attempt: circuitBreakerStatus.lastRecoveryAttempt,
                                    last_reset: circuitBreakerStatus.lastReset
                                },
                                operations: service.stats?.operations || { total: 0, successful: 0, failed: 0 },
                                performance: service.stats?.performance || { averageOperationTimeMs: 0, lastOperationTimeMs: 0 },
                                config: service.config?.circuitBreaker || {},
                                ...state
                            };
                        } catch (error) {
                            logApi.error(`Error getting state for service ${name}:`, error);
                            return {
                                service: name,
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
                    })
                );

                this.broadcast({
                    type: 'services:state',
                    timestamp: new Date().toISOString(),
                    services: states
                });
            } catch (error) {
                logApi.error('Error in periodic update:', error);
            }
        }, HEARTBEAT_INTERVAL);
    }

    /**
     * Get server metrics
     * @returns {Object} Server metrics
     */
    getMetrics() {
        return {
            metrics: {
                totalConnections: this._getConnectedClients().length,
                activeSubscriptions: this.services.size,
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
            status: 'operational'
        };
    }

    /**
     * Clean up resources
     */
    cleanup() {
        super.cleanup();
        // Clear all recovery timeouts
        for (const timeout of this.recoveryTimeouts.values()) {
            clearTimeout(timeout);
        }
        this.recoveryTimeouts.clear();
    }
}

let instance = null;

/**
 * Create or get the circuit breaker WebSocket instance
 * @param {http.Server} server - The HTTP server instance
 * @returns {CircuitBreakerWebSocketServer} The WebSocket server instance
 */
export function createCircuitBreakerWebSocket(server) {
    if (!instance) {
        instance = new CircuitBreakerWebSocketServer(server);
    }
    return instance;
}

// Export the class for testing
export { CircuitBreakerWebSocketServer };

// Export the singleton instance
export default instance;