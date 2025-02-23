// utils/service-manager.js

/*
 * This file is responsible for managing all DegenDuel services.
 * It allows the admin to start, stop, and update the state of all services.
 * 
 */

// Master Circuit Breaker
import { createCircuitBreakerWebSocket } from '../websocket-suite/circuit-breaker-ws.js';
import prisma from '../../config/prisma.js';
import { logApi } from '../logger-suite/logger.js';
import { getCircuitBreakerConfig, isHealthy, shouldReset } from './circuit-breaker-config.js';
import { 
    SERVICE_NAMES, 
    SERVICE_LAYERS, 
    getServiceMetadata,
    getServiceDependencies,
    getServiceCriticalLevel,
    validateDependencyChain 
} from './service-constants.js';
import { ServiceError } from './service-error.js';
import { serviceEvents } from './base-service.js';

/**
 * Consolidated service management system for DegenDuel
 * Combines functionality from ServiceManager and ServiceRegistry
 */
class ServiceManager {
    static services = new Map();
    static dependencies = new Map();
    static state = new Map();
    static circuitBreakerWs = null;

    /**
     * Initialize event listeners
     */
    static initializeEventListeners() {
        // Service lifecycle events
        serviceEvents.on('service:started', async (data) => {
            await this.markServiceStarted(data.name, data.config, data.stats);
        });

        serviceEvents.on('service:stopped', async (data) => {
            await this.markServiceStopped(data.name, data.config, data.stats);
        });

        serviceEvents.on('service:error', async (data) => {
            await this.markServiceError(data.name, data.error, data.config, data.stats);
        });

        serviceEvents.on('service:heartbeat', async (data) => {
            await this.updateServiceHeartbeat(data.name, data.config, data.stats);
        });

        serviceEvents.on('service:circuit_breaker', async (data) => {
            await this.updateServiceState(data.name, {
                status: data.status
            }, data.config, data.stats);
        });
    }

    /**
     * Initialize the circuit breaker WebSocket with a server
     * @param {http.Server} server - The HTTP server instance
     */
    static initializeWebSocket(server) {
        if (!server) {
            logApi.warn('Attempted to initialize circuit breaker WebSocket without server instance');
            return;
        }

        try {
            this.circuitBreakerWs = createCircuitBreakerWebSocket(server);
            logApi.info('Circuit breaker WebSocket initialized successfully');
        } catch (error) {
            logApi.error('Failed to initialize circuit breaker WebSocket:', error);
            throw error;
        }
    }

    /**
     * Register a service with its dependencies
     */
    static register(service, dependencies = []) {
        if (!service) {
            throw new Error('Attempted to register undefined service');
        }

        const metadata = getServiceMetadata(service.name);
        if (!metadata) {
            throw new Error(`Service ${service.name} not found in metadata`);
        }

        // Validate dependencies from metadata
        const allDependencies = new Set([
            ...dependencies,
            ...getServiceDependencies(service.name)
        ]);

        // Check for circular dependencies
        if (!validateDependencyChain(service.name)) {
            throw new Error(`Circular dependency detected for ${service.name}`);
        }

        this.services.set(service.name, service);
        this.dependencies.set(service.name, Array.from(allDependencies));
        
        logApi.info(`Registered service: ${service.name}`, {
            layer: metadata.layer,
            criticalLevel: metadata.criticalLevel,
            dependencies: Array.from(allDependencies)
        });
    }

    /**
     * Initialize all services in dependency order
     */
    static async initializeAll() {
        const initialized = new Set();
        const failed = new Set();
        const initOrder = this.calculateInitializationOrder();

        for (const serviceName of initOrder) {
            try {
                await this._initializeService(serviceName, initialized, failed);
            } catch (error) {
                logApi.error(`Failed to initialize ${serviceName}:`, error);
                failed.add(serviceName);
            }
        }

        return {
            initialized: Array.from(initialized),
            failed: Array.from(failed)
        };
    }

    /**
     * Calculate initialization order based on dependencies
     */
    static calculateInitializationOrder() {
        const visited = new Set();
        const order = [];

        function visit(serviceName) {
            if (visited.has(serviceName)) return;
            visited.add(serviceName);

            const dependencies = ServiceManager.dependencies.get(serviceName) || [];
            for (const dep of dependencies) {
                visit(dep);
            }
            order.push(serviceName);
        }

        // Start with infrastructure layer
        const infraServices = this.getServicesInLayer(SERVICE_LAYERS.INFRASTRUCTURE);
        for (const service of infraServices) {
            visit(service);
        }

        // Then data layer
        const dataServices = this.getServicesInLayer(SERVICE_LAYERS.DATA);
        for (const service of dataServices) {
            visit(service);
        }

        // Then contest layer
        const contestServices = this.getServicesInLayer(SERVICE_LAYERS.CONTEST);
        for (const service of contestServices) {
            visit(service);
        }

        // Finally wallet layer
        const walletServices = this.getServicesInLayer(SERVICE_LAYERS.WALLET);
        for (const service of walletServices) {
            visit(service);
        }

        return order;
    }

    /**
     * Initialize a single service
     */
    static async _initializeService(serviceName, initialized, failed) {
        if (initialized.has(serviceName) || failed.has(serviceName)) {
            return;
        }

        const dependencies = this.dependencies.get(serviceName) || [];
        for (const dep of dependencies) {
            if (!initialized.has(dep)) {
                await this._initializeService(dep, initialized, failed);
            }
            if (failed.has(dep)) {
                failed.add(serviceName);
                return;
            }
        }

        try {
            const service = this.services.get(serviceName);
            await service.initialize();
            initialized.add(serviceName);

            const metadata = getServiceMetadata(serviceName);
            logApi.info(`Initialized service: ${serviceName}`, {
                layer: metadata.layer,
                criticalLevel: metadata.criticalLevel
            });
        } catch (error) {
            failed.add(serviceName);
            throw error;
        }
    }

    /**
     * Update service state and broadcast changes
     */
    static async updateServiceState(serviceName, state, config, stats = null) {
        try {
            // Get current circuit breaker config
            const circuitBreakerConfig = getCircuitBreakerConfig(serviceName);
            
            // Update state with circuit breaker status
            const serviceState = {
                running: state.running,
                status: this.determineServiceStatus(stats),
                last_started: state.last_started,
                last_stopped: state.last_stopped,
                last_check: state.last_check,
                last_error: state.last_error,
                last_error_time: state.last_error_time,
                config: {
                    ...config,
                    circuitBreaker: circuitBreakerConfig
                },
                ...(stats && { stats })
            };

            // Update database
            await prisma.system_settings.upsert({
                where: { key: serviceName },
                update: {
                    value: serviceState,
                    updated_at: new Date()
                },
                create: {
                    key: serviceName,
                    value: serviceState,
                    description: `${serviceName} status and configuration`,
                    updated_at: new Date()
                }
            });

            // Update local state
            this.state.set(serviceName, serviceState);

            // Broadcast update if WebSocket is available
            if (this.circuitBreakerWs) {
                this.circuitBreakerWs.notifyServiceUpdate(serviceName, serviceState);
            }

            return serviceState;
        } catch (error) {
            logApi.error(`Failed to update service state for ${serviceName}:`, error);
            throw error;
        }
    }

    /**
     * Get the current state of a service
     */
    static async getServiceState(serviceName) {
        try {
            // Check local state first
            const localState = this.state.get(serviceName);
            if (localState) return localState;

            // Fallback to database
            const setting = await prisma.system_settings.findUnique({
                where: { key: serviceName }
            });
            
            if (!setting) return null;

            // Parse value if it's a string
            const value = typeof setting.value === 'string' 
                ? JSON.parse(setting.value) 
                : setting.value;

            // Cache in local state
            this.state.set(serviceName, value);
            
            return value;
        } catch (error) {
            logApi.error(`Failed to get service state for ${serviceName}:`, error);
            throw error;
        }
    }

    /**
     * Check service health and manage circuit breaker
     */
    static async checkServiceHealth(serviceName) {
        const service = this.services.get(serviceName);
        if (!service) return false;

        const state = await this.getServiceState(serviceName);
        if (!state) return true; // No state = new service, allow operation

        // Check circuit breaker status
        if (state.stats?.circuitBreaker?.isOpen) {
            if (shouldReset(state.stats, state.config.circuitBreaker)) {
                // Attempt recovery
                try {
                    await service.performOperation();
                    await this.markServiceRecovered(serviceName);
                    return true;
                } catch (error) {
                    await this.markServiceError(serviceName, error);
                    return false;
                }
            }
            return false;
        }

        return true;
    }

    /**
     * Determine overall service status
     */
    static determineServiceStatus(stats) {
        if (!stats) return 'unknown';
        
        if (stats.circuitBreaker?.isOpen) return 'circuit_open';
        if (stats.history?.consecutiveFailures > 0) return 'degraded';
        if (!isHealthy(stats)) return 'unhealthy';
        
        return 'healthy';
    }

    /**
     * Get all services in a specific layer
     */
    static getServicesInLayer(layer) {
        return Array.from(this.services.entries())
            .filter(([_, service]) => service.config.layer === layer)
            .map(([name]) => name);
    }

    /**
     * Validate service dependencies
     */
    static validateDependencies(serviceName, dependencies) {
        const missingDeps = [];
        for (const dep of dependencies) {
            if (!this.services.has(dep)) {
                missingDeps.push(dep);
            }
        }
        if (missingDeps.length > 0) {
            logApi.warn(`Missing dependencies for ${serviceName}:`, {
                missing: missingDeps,
                available: Array.from(this.services.keys())
            });
        }
        return missingDeps.length === 0;
    }

    /**
     * Mark service as recovered from circuit breaker
     */
    static async markServiceRecovered(serviceName) {
        const service = this.services.get(serviceName);
        if (!service) return;

        service.stats.circuitBreaker.isOpen = false;
        service.stats.circuitBreaker.failures = 0;
        service.stats.circuitBreaker.lastReset = new Date().toISOString();
        service.stats.circuitBreaker.recoveryAttempts++;

        await this.updateServiceState(
            serviceName,
            { running: true, status: 'recovered' },
            service.config,
            service.stats
        );
    }

    /**
     * Mark service as started
     */
    static async markServiceStarted(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: true,
            status: 'active',
            last_started: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Mark service as stopped
     */
    static async markServiceStopped(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: false,
            status: 'stopped',
            last_stopped: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Mark service error
     */
    static async markServiceError(serviceName, error, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: true,
            status: 'error',
            last_error: error.message,
            last_error_time: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Update service heartbeat
     */
    static async updateServiceHeartbeat(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: true,
            status: 'active',
            last_check: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Clean up all services
     */
    static async cleanup() {
        const results = {
            successful: [],
            failed: []
        };

        for (const [serviceName, service] of this.services) {
            try {
                await service.stop();
                results.successful.push(serviceName);
            } catch (error) {
                results.failed.push({
                    service: serviceName,
                    error: error.message
                });
            }
        }

        this.services.clear();
        this.dependencies.clear();
        this.state.clear();

        return results;
    }
}

// Initialize event listeners
ServiceManager.initializeEventListeners();

// Export service name constants for backward compatibility
export { SERVICE_NAMES, SERVICE_LAYERS };

export default ServiceManager; 