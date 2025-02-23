import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../logger-suite/logger.js';
import ServiceManager from '../service-suite/service-manager.js';
import { isHealthy } from '../service-suite/circuit-breaker-config.js';

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

// Log configured origins on startup
logApi.info('WebSocket allowed origins:', {
    origins: ALLOWED_ORIGINS,
    source: process.env.ALLOWED_ORIGINS ? 'Environment' : 'Default'
});

class CircuitBreakerWebSocketServer extends BaseWebSocketServer {
    constructor(server) {
        // Create the configuration object
        const config = {
            path: '/api/v2/ws/circuit-breaker',
            maxMessageSize: 16 * 1024, // 16KB
            rateLimit: 60, // 60 messages per minute
            requireAuth: true,
            allowedOrigins: ALLOWED_ORIGINS
        };

        // Initialize base class with server and config
        super(server, config);

        this.services = new Map();

        // Start periodic state broadcasts
        this.startPeriodicUpdates();
    }

    initialize(server) {
        // Initialize WebSocket server with server instance
        super.initialize(server);
    }

    /**
     * Notify clients about a service update
     */
    async notifyServiceUpdate(serviceName, state) {
        if (!this.wss) return;

        const service = ServiceManager.services.get(serviceName);
        if (!service) return;

        const message = {
            type: 'service:update',
            timestamp: new Date().toISOString(),
            service: serviceName,
            status: ServiceManager.determineServiceStatus(service.stats),
            circuit_breaker: {
                is_open: service.stats.circuitBreaker.isOpen,
                failures: service.stats.circuitBreaker.failures,
                last_failure: service.stats.circuitBreaker.lastFailure,
                last_success: service.stats.circuitBreaker.lastSuccess,
                recovery_attempts: service.stats.circuitBreaker.recoveryAttempts
            },
            operations: service.stats.operations,
            performance: service.stats.performance,
            ...state
        };

        this.broadcast(message);
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
                return {
                    service: name,
                    status: ServiceManager.determineServiceStatus(service.stats),
                    circuit_breaker: {
                        is_open: service.stats.circuitBreaker.isOpen,
                        failures: service.stats.circuitBreaker.failures,
                        last_failure: service.stats.circuitBreaker.lastFailure,
                        last_success: service.stats.circuitBreaker.lastSuccess,
                        recovery_attempts: service.stats.circuitBreaker.recoveryAttempts
                    },
                    operations: service.stats.operations,
                    performance: service.stats.performance,
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
        ws.send(JSON.stringify({
            type: 'service:health_check_result',
            timestamp: new Date().toISOString(),
            service: serviceName,
            healthy: isServiceHealthy,
            status: ServiceManager.determineServiceStatus(service.stats)
        }));
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
                    return {
                        service: name,
                        status: ServiceManager.determineServiceStatus(service.stats),
                        circuit_breaker: {
                            is_open: service.stats.circuitBreaker.isOpen,
                            failures: service.stats.circuitBreaker.failures,
                            last_failure: service.stats.circuitBreaker.lastFailure,
                            last_success: service.stats.circuitBreaker.lastSuccess,
                            recovery_attempts: service.stats.circuitBreaker.recoveryAttempts
                        },
                        operations: service.stats.operations,
                        performance: service.stats.performance,
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
    } else if (server && !instance.wss) {
        // If we have an instance but it wasn't initialized with a server yet
        instance.initialize(server);
    }
    return instance;
}

// Export the class for testing
export { CircuitBreakerWebSocketServer }; 