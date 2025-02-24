// websocket/circuit-breaker-ws.js

/*
 * This is the WebSocket server for the circuit breaker service.
 * It handles the subscription and unsubscription of circuit breakers by clients.
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import ServiceManager from '../utils/service-suite/service-manager.js';
import { isHealthy, getCircuitBreakerStatus } from '../utils/service-suite/circuit-breaker-config.js';

const HEARTBEAT_INTERVAL = 5000; // 5 seconds
const CLIENT_TIMEOUT = 7000;     // 7 seconds

// Get allowed origins from environment variables or use defaults
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
            path: '/api/v2/ws/circuit-breaker',
            maxPayload: 1024 * 16, // 16KB
            rateLimit: 60, // 60 messages per minute
            requireAuth: true,
            allowedOrigins: ALLOWED_ORIGINS
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

        const service = ServiceManager.services.get(serviceName);
        if (!service) return;

        const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
        const message = {
            type: 'service:update',
            timestamp: new Date().toISOString(),
            service: serviceName,
            status: ServiceManager.determineServiceStatus(service.stats),
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
            logApi.warn(`Circuit breaker opened for ${serviceName}`, {
                failures: service.stats.circuitBreaker.failures,
                lastFailure: service.stats.circuitBreaker.lastFailure,
                recoveryAttempts: service.stats.circuitBreaker.recoveryAttempts
            });
        } else if (circuitBreakerStatus.status === 'closed' && state.previousStatus === 'open') {
            logApi.info(`Circuit breaker closed for ${serviceName}`, {
                recoveryAttempts: service.stats.circuitBreaker.recoveryAttempts,
                lastReset: service.stats.circuitBreaker.lastReset
            });
        }
    }

    /**
     * Handle client connection
     */
    async onConnection(ws, request) {
        super.onConnection(ws, request);

        // Send current state of all services
        const services = Array.from(ServiceManager.services.entries());
        const states = await Promise.all(
            services.map(async ([name, service]) => {
                const state = await ServiceManager.getServiceState(name);
                const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
                return {
                    service: name,
                    status: ServiceManager.determineServiceStatus(service.stats),
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

        ws.send(JSON.stringify({
            type: 'services:state',
            timestamp: new Date().toISOString(),
            services: states
        }));
    }

    /**
     * Handle client message
     */
    onMessage(ws, message) {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'subscribe:services':
                    // Already handled by default behavior
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
                    ws.send(JSON.stringify({
                        type: 'error',
                        code: 4004,
                        message: 'Invalid message type',
                        timestamp: new Date().toISOString()
                    }));
            }
        } catch (error) {
            ws.send(JSON.stringify({
                type: 'error',
                code: 4004,
                message: 'Invalid message format',
                timestamp: new Date().toISOString()
            }));
        }
    }

    /**
     * Handle health check request
     */
    async handleHealthCheck(ws, serviceName) {
        const service = ServiceManager.services.get(serviceName);
        if (!service) {
            ws.send(JSON.stringify({
                type: 'error',
                code: 4004,
                message: 'Service not found',
                timestamp: new Date().toISOString()
            }));
            return;
        }

        const isServiceHealthy = await ServiceManager.checkServiceHealth(serviceName);
        const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
        
        ws.send(JSON.stringify({
            type: 'service:health_check_result',
            timestamp: new Date().toISOString(),
            service: serviceName,
            healthy: isServiceHealthy,
            status: ServiceManager.determineServiceStatus(service.stats),
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
        const service = ServiceManager.services.get(serviceName);
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
            const services = Array.from(ServiceManager.services.entries());
            const states = await Promise.all(
                services.map(async ([name, service]) => {
                    const state = await ServiceManager.getServiceState(name);
                    const circuitBreakerStatus = getCircuitBreakerStatus(service.stats);
                    return {
                        service: name,
                        status: ServiceManager.determineServiceStatus(service.stats),
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

            this.broadcast({
                type: 'services:state',
                timestamp: new Date().toISOString(),
                services: states
            });
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