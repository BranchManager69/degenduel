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
import { serviceEvents, BaseService } from './base-service.js';

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
    static register(serviceOrName, dependencies = []) {
        if (!serviceOrName) {
            throw new Error('Attempted to register undefined service');
        }

        // Add detailed logging for service identification
        logApi.info(`[ServiceManager] Starting registration:`, {
            type: typeof serviceOrName,
            isInstance: serviceOrName instanceof BaseService,
            hasConfig: serviceOrName?.config !== undefined,
            configName: serviceOrName?.config?.name,
            directName: serviceOrName?.name,
            dependencies
        });

        // Handle both service instances and service names
        const serviceName = typeof serviceOrName === 'string' 
            ? serviceOrName 
            : serviceOrName.config?.name || serviceOrName.name;

        // Add logging for name resolution
        logApi.info(`[ServiceManager] Name resolution:`, {
            resolvedName: serviceName,
            availableNames: Object.values(SERVICE_NAMES)
        });

        const service = typeof serviceOrName === 'string' ? null : serviceOrName;

        const metadata = getServiceMetadata(serviceName);
        if (!metadata) {
            throw new Error(`Service ${serviceName} not found in metadata. Available services: ${Object.values(SERVICE_NAMES).join(', ')}`);
        }

        // Validate dependencies from metadata
        const allDependencies = new Set([
            ...dependencies,
            ...getServiceDependencies(serviceName)
        ]);

        // Check for circular dependencies
        if (!validateDependencyChain(serviceName)) {
            throw new Error(`Circular dependency detected for ${serviceName}`);
        }

        // Register service and dependencies
        if (service) {
            if (!(service instanceof BaseService)) {
                throw new Error(`Service ${serviceName} must be an instance of BaseService`);
            }
            this.services.set(serviceName, service);
        }
        this.dependencies.set(serviceName, Array.from(allDependencies));

        // Log registration
        logApi.info(`Registered service: ${serviceName}`, {
            layer: metadata.layer,
            criticalLevel: metadata.criticalLevel,
            dependencies: allDependencies.size ? Array.from(allDependencies) : []
        });

        return true;
    }

    /**
     * Initialize all services in dependency order
     */
    static async initializeAll() {
        const initialized = new Set();
        const failed = new Set();
        const initOrder = this.calculateInitializationOrder();

        logApi.info('Starting service initialization in order:', initOrder);

        // First, initialize infrastructure layer services
        const infraServices = initOrder.filter(service => {
            const metadata = getServiceMetadata(service);
            return metadata?.layer === SERVICE_LAYERS.INFRASTRUCTURE;
        });

        logApi.info('Initializing infrastructure services:', infraServices);
        for (const serviceName of infraServices) {
            try {
                logApi.info(`[SERVICE INIT] Attempting to initialize infrastructure service ${serviceName}`);
                const success = await this._initializeService(serviceName, initialized, failed);
                if (success) {
                    logApi.info(`[SERVICE INIT] Infrastructure service ${serviceName} initialization completed successfully`);
                } else {
                    logApi.error(`[SERVICE INIT] Infrastructure service ${serviceName} initialization returned false`);
                }
            } catch (error) {
                logApi.error(`[SERVICE INIT] Failed to initialize infrastructure service ${serviceName}:`, error);
                failed.add(serviceName);
            }
        }

        // Then initialize remaining services in dependency order
        const remainingServices = initOrder.filter(service => !infraServices.includes(service));
        logApi.info('Initializing remaining services:', remainingServices);
        for (const serviceName of remainingServices) {
            try {
                logApi.info(`[SERVICE INIT] Attempting to initialize service ${serviceName}`);
                const success = await this._initializeService(serviceName, initialized, failed);
                if (success) {
                    logApi.info(`[SERVICE INIT] Service ${serviceName} initialization completed successfully`);
                } else {
                    logApi.error(`[SERVICE INIT] Service ${serviceName} initialization returned false`);
                }
            } catch (error) {
                logApi.error(`[SERVICE INIT] Failed to initialize service ${serviceName}:`, error);
                failed.add(serviceName);
            }
        }

        logApi.info('Service initialization completed:', {
            initialized: Array.from(initialized),
            failed: Array.from(failed)
        });

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
        try {
            logApi.info(`[SERVICE INIT] Starting initialization of service ${serviceName}`);

            if (initialized.has(serviceName)) {
                logApi.info(`[SERVICE INIT] Service ${serviceName} already initialized`);
                return true;
            }
            if (failed.has(serviceName)) {
                logApi.info(`[SERVICE INIT] Service ${serviceName} previously failed`);
                return false;
            }

            let service = this.services.get(serviceName);
            if (!service) {
                const error = new Error(`Service ${serviceName} not found in registered services`);
                logApi.error(`[SERVICE INIT] ${error.message}`, {
                    availableServices: Array.from(this.services.keys())
                });
                failed.add(serviceName);
                return false;
            }

            // Check dependencies first
            const dependencies = this.dependencies.get(serviceName) || [];
            logApi.info(`[SERVICE INIT] Checking dependencies for ${serviceName}:`, dependencies);
            for (const dep of dependencies) {
                if (!initialized.has(dep)) {
                    try {
                        logApi.info(`[SERVICE INIT] Initializing dependency ${dep} for ${serviceName}`);
                        const success = await this._initializeService(dep, initialized, failed);
                        if (!success) {
                            const error = new Error(`Cannot initialize ${serviceName} - dependency ${dep} failed to initialize`);
                            logApi.error(`[SERVICE INIT] ${error.message}`);
                            failed.add(serviceName);
                            return false;
                        }

                        // Wait for dependency to be fully started
                        const depService = this.services.get(dep);
                        if (!depService.isStarted) {
                            logApi.info(`[SERVICE INIT] Waiting for dependency ${dep} to start`);
                            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait a bit
                            const depStatus = await this.checkServiceHealth(dep);
                            if (!depStatus) {
                                const error = new Error(`Cannot initialize ${serviceName} - dependency ${dep} not healthy after start`);
                                logApi.error(`[SERVICE INIT] ${error.message}`);
                                failed.add(serviceName);
                                return false;
                            }
                        }
                    } catch (error) {
                        logApi.error(`[SERVICE INIT] Error initializing dependency ${dep} for ${serviceName}:`, {
                            error: error.message,
                            stack: error.stack
                        });
                        failed.add(serviceName);
                        return false;
                    }
                } else {
                    logApi.info(`[SERVICE INIT] Dependency ${dep} already initialized for ${serviceName}`);
                }
            }

            try {
                logApi.info(`[SERVICE INIT] Running initialize() for ${serviceName}`);
                const success = await service.initialize();
                if (success) {
                    logApi.info(`[SERVICE INIT] Running start() for ${serviceName}`);
                    await service.start();
                    initialized.add(serviceName);
                    await this.markServiceStarted(serviceName, service.config, service.stats);
                    service.isStarted = true;
                    logApi.info(`[SERVICE INIT] Service ${serviceName} initialized and started successfully`);
                    return true;
                } else {
                    const error = new Error(`Service ${serviceName} initialization returned false`);
                    logApi.error(`[SERVICE INIT] ${error.message}`);
                    failed.add(serviceName);
                    return false;
                }
            } catch (error) {
                logApi.error(`[SERVICE INIT] Error initializing service ${serviceName}:`, {
                    error: error.message,
                    stack: error.stack,
                    service: {
                        name: serviceName,
                        config: service.config,
                        stats: service.stats
                    }
                });
                failed.add(serviceName);
                return false;
            }
        } catch (error) {
            logApi.error(`[SERVICE INIT] Unexpected error in _initializeService for ${serviceName}:`, {
                error: error.message,
                stack: error.stack
            });
            failed.add(serviceName);
            return false;
        }
    }

    /**
     * Clean up problematic service state
     */
    static async cleanupServiceState(serviceName) {
        try {
            // Delete existing state
            await prisma.system_settings.delete({
                where: { key: serviceName }
            }).catch(() => {}); // Ignore if doesn't exist

            // Clear from local state
            this.state.delete(serviceName);

            logApi.info(`Cleaned up state for service: ${serviceName}`);
            return true;
        } catch (error) {
            logApi.error(`Failed to clean up state for ${serviceName}:`, error);
            return false;
        }
    }

    /**
     * Update service state and broadcast changes
     */
    static async updateServiceState(serviceName, state, config, stats = null) {
        try {
            // Get current circuit breaker config
            const circuitBreakerConfig = getCircuitBreakerConfig(serviceName);
            
            // Helper to safely serialize values
            const safeSerialize = (obj) => {
                const seen = new WeakSet();
                try {
                    return JSON.parse(JSON.stringify(obj, (key, value) => {
                        if (typeof value === 'bigint') return value.toString();
                        if (value instanceof Date) return value.toISOString();
                        if (value instanceof Set) return Array.from(value);
                        if (value instanceof Map) return Object.fromEntries(value);
                        if (typeof value === 'object' && value !== null) {
                            if (seen.has(value)) {
                                return '[Circular]';
                            }
                            seen.add(value);
                        }
                        return value;
                    }));
                } catch (err) {
                    logApi.warn(`Failed to serialize object:`, err);
                    return null;
                }
            };
            
            // Update state with circuit breaker status
            const serviceState = {
                running: state.running,
                status: this.determineServiceStatus(stats),
                last_started: state.last_started,
                last_stopped: state.last_stopped,
                last_check: state.last_check,
                last_error: state.last_error,
                last_error_time: state.last_error_time
            };

            // Safely serialize config
            const serializedConfig = safeSerialize({
                ...config,
                circuitBreaker: circuitBreakerConfig
            });

            if (serializedConfig) {
                serviceState.config = serializedConfig;
            } else {
                // Fallback to basic config
                serviceState.config = {
                    circuitBreaker: circuitBreakerConfig
                };
            }

            // Only include stats if they exist and can be safely serialized
            if (stats) {
                const serializedStats = safeSerialize(stats);
                if (serializedStats) {
                    serviceState.stats = serializedStats;
                } else {
                    // Include basic stats if full serialization fails
                    serviceState.stats = {
                        operations: {},
                        performance: {},
                        circuitBreaker: stats.circuitBreaker || {}
                    };
                }
            }

            // Try to update, if it fails due to recursion, clean up and try again
            try {
                // Update individual service state
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

                // Update consolidated service health record
                await prisma.system_settings.upsert({
                    where: { key: 'service_health' },
                    update: {
                        value: {
                            service_name: serviceName,
                            status: serviceState.status,
                            running: serviceState.running,
                            last_check: new Date().toISOString()
                        },
                        updated_at: new Date()
                    },
                    create: {
                        key: 'service_health',
                        value: {
                            service_name: serviceName,
                            status: serviceState.status,
                            running: serviceState.running,
                            last_check: new Date().toISOString()
                        },
                        description: 'Consolidated service health status',
                        updated_at: new Date()
                    }
                });
            } catch (error) {
                if (error.message.includes('recursion limit exceeded')) {
                    // Clean up and try again
                    await this.cleanupServiceState(serviceName);
                    await prisma.system_settings.create({
                        data: {
                            key: serviceName,
                            value: serviceState,
                            description: `${serviceName} status and configuration`,
                            updated_at: new Date()
                        }
                    });
                } else {
                    throw error;
                }
            }

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
            .filter(([serviceName]) => {
                const metadata = getServiceMetadata(serviceName);
                return metadata?.layer === layer;
            })
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
     * Clean up all service states
     */
    static async cleanupAllServiceStates() {
        try {
            // Delete all service states
            await prisma.system_settings.deleteMany({
                where: {
                    key: {
                        in: Object.values(SERVICE_NAMES)
                    }
                }
            });

            // Clear local state
            this.state.clear();

            logApi.info('Cleaned up all service states');
            return true;
        } catch (error) {
            logApi.error('Failed to clean up service states:', error);
            return false;
        }
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

    /**
     * Add a dependency between services
     */
    static addDependency(serviceName, dependencyOrDependencies) {
        const dependencies = Array.isArray(dependencyOrDependencies) 
            ? dependencyOrDependencies 
            : [dependencyOrDependencies];

        // Get current dependencies
        const currentDependencies = this.dependencies.get(serviceName) || [];

        // Add new dependencies
        const allDependencies = new Set([...currentDependencies, ...dependencies]);

        // Check for circular dependencies
        if (!validateDependencyChain(serviceName)) {
            throw new Error(`Circular dependency detected for ${serviceName}`);
        }

        // Update dependencies
        this.dependencies.set(serviceName, Array.from(allDependencies));

        // Log dependency addition
        logApi.info(`Added dependencies for ${serviceName}:`, dependencies);

        return true;
    }
}

// Initialize event listeners
ServiceManager.initializeEventListeners();

// Export service name constants for backward compatibility
export { SERVICE_NAMES, SERVICE_LAYERS };

export default ServiceManager; 