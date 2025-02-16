import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../logger-suite/logger.js';
import ServiceManager from '../service-suite/service-manager.js';

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
     * @param {string} serviceName - The name of the service
     * @param {object} state - The current state of the service
     */
    notifyServiceUpdate(serviceName, state) {
        if (!this.wss) return; // Not initialized yet

        this.services.set(serviceName, state);

        const message = {
            type: 'service:update',
            timestamp: new Date().toISOString(),
            service: serviceName,
            ...state
        };

        this.broadcast(message);
    }

    /**
     * Handle client connection
     * @param {WebSocket} ws - The WebSocket client
     * @param {object} request - The HTTP request
     */
    onConnection(ws, request) {
        super.onConnection(ws, request);

        // Send current service states
        if (this.services.size > 0) {
            const servicesArray = Array.from(this.services.entries()).map(([service, state]) => ({
                service,
                ...state
            }));

            ws.send(JSON.stringify({
                type: 'service:update',
                timestamp: new Date().toISOString(),
                services: servicesArray
            }));
        }
    }

    /**
     * Handle client message
     * @param {WebSocket} ws - The WebSocket client
     * @param {string} message - The message received
     */
    onMessage(ws, message) {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'subscribe:services':
                    // Client is requesting service updates
                    // We'll automatically send updates, so no action needed
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

    async broadcastServiceStates(targetClient = null) {
        try {
            const services = Array.from(ServiceManager.services.keys());
            const states = await Promise.all(
                services.map(async (serviceName) => {
                    const state = await ServiceManager.getServiceState(serviceName);
                    return {
                        service: serviceName,
                        status: this.determineServiceStatus(state),
                        circuit: {
                            state: state?.stats?.circuitBreaker?.isOpen ? 'open' : 'closed',
                            failureCount: state?.stats?.circuitBreaker?.failures || 0,
                            lastFailure: state?.stats?.circuitBreaker?.lastFailure,
                            recoveryAttempts: state?.stats?.history?.consecutiveFailures || 0
                        },
                        operations: state?.stats?.operations || {
                            total: 0,
                            successful: 0,
                            failed: 0
                        }
                    };
                })
            );

            const message = {
                type: 'service:update',
                timestamp: new Date().toISOString(),
                services: states
            };

            if (targetClient) {
                this.sendToClient(targetClient, message);
            } else {
                this.broadcast(message);
            }
        } catch (error) {
            logApi.error('Failed to broadcast service states:', error);
        }
    }

    determineServiceStatus(state) {
        if (!state) return 'unknown';
        if (state.stats?.circuitBreaker?.isOpen) return 'failed';
        if (state.stats?.history?.consecutiveFailures > 0) return 'degraded';
        return 'healthy';
    }

    startPeriodicUpdates() {
        // Broadcast service states every 5 seconds
        setInterval(() => {
            this.broadcastServiceStates();
        }, 5000);
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