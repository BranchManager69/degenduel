// utils/service-manager.js

/*
 * This file is responsible for managing all DegenDuel services.
 * It allows the admin to start, stop, and update the state of all services.
 * 
 */

// Master Circuit Breaker
import { createCircuitBreakerWebSocket } from '../../websocket/circuit-breaker-ws.js';
import prisma from '../../config/prisma.js';
import { logApi } from '../logger-suite/logger.js';
import { getCircuitBreakerConfig, isHealthy, shouldReset } from './circuit-breaker-config.js';
import { 
    SERVICE_NAMES, 
    SERVICE_LAYERS, 
    getServiceMetadata,
    getServiceDependencies,
    //getServiceCriticalLevel,
    validateDependencyChain 
} from './service-constants.js';
//import { ServiceError } from './service-error.js';
import serviceEvents from './service-events.js';
import { BaseService } from './base-service.js';
import path from 'path';
import AdminLogger from '../admin-logger.js';
import SystemSettingsUtil from '../system-settings-util.js';

const VERBOSE_SERVICE_INIT = false;

/**
 * Consolidated service management system for DegenDuel
 * Combines functionality from ServiceManager and ServiceRegistry
 */
class ServiceManager {
    constructor() {
        this.services = new Map();
        this.dependencies = new Map();
        this.state = new Map();
        this.circuitBreakerWs = null;
        ////this.SUPER_VERBOSE = false;
        this.initializeEventListeners();
    }

    /**
     * Initialize event listeners
     */
    initializeEventListeners() {
        // Service lifecycle events
        serviceEvents.on('service:initialized', async (data) => {
            await this.markServiceStarted(data.name, data.config, data.stats);
        });

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
                status: data.status,
                config: data.config,
                stats: data.stats
            });
        });
    }

    /**
     * Initialize the circuit breaker WebSocket with a server
     * @param {http.Server} server - The HTTP server instance
     */
    initializeWebSocket(server) {
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
    register(serviceOrName, dependencies = []) {
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

        // Debug name resolution
        if (VERBOSE_SERVICE_INIT) {
            logApi.info(`[ServiceManager] Name resolution:`, {
                resolvedName: serviceName,
                availableNames: Object.values(SERVICE_NAMES)
            });
        }

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

        // Debug registration
        if (VERBOSE_SERVICE_INIT) {
            logApi.info(`Registered service: ${serviceName}`, {
                layer: metadata.layer,
                criticalLevel: metadata.criticalLevel,
                dependencies: allDependencies.size ? Array.from(allDependencies) : []
            });
        } else {
            logApi.info(`Registered service: ${serviceName}`);
        }

        return true;
    }

    /**
     * Initialize all services in dependency order
     */
    async initializeAll() {
        const initialized = new Set();
        const failed = new Set();
        const initOrder = this.calculateInitializationOrder();

        logApi.info('Starting service initialization in order:', {
            order: initOrder,
            totalServices: initOrder.length,
            registeredServices: Array.from(this.services.keys())
        });

        // First, initialize infrastructure layer services
        const infraServices = initOrder.filter(service => {
            const metadata = getServiceMetadata(service);
            return metadata?.layer === SERVICE_LAYERS.INFRASTRUCTURE;
        });

        logApi.info('Initializing infrastructure services:', {
            services: infraServices,
            count: infraServices.length
        });

        for (const serviceName of infraServices) {
            try {
                if (VERBOSE_SERVICE_INIT) {
                    logApi.info(`[SERVICE INIT] Attempting to initialize infrastructure service ${serviceName}`, {
                        metadata: getServiceMetadata(serviceName),
                        dependencies: this.dependencies.get(serviceName) || []
                    });
                } else {
                    //logApi.info(`[SERVICE INIT] Attempting to initialize infrastructure service ${serviceName}`, {
                    //    metadata: getServiceMetadata(serviceName),
                    //    dependencies: this.dependencies.get(serviceName) || []
                    //});
                }

                const success = await this._initializeService(serviceName, initialized, failed);
                if (success) {
                    if (VERBOSE_SERVICE_INIT) {
                        logApi.info(`[SERVICE INIT] Infrastructure service ${serviceName} initialization completed successfully`);
                    }
                } else {
                    logApi.error(`[SERVICE INIT] Infrastructure service ${serviceName} initialization returned false`);
                }
            } catch (error) {
                if (VERBOSE_SERVICE_INIT) {
                    logApi.error(`[SERVICE INIT] Failed to initialize infrastructure service ${serviceName}:`, {
                        error: error.message,
                        stack: error.stack,
                        metadata: getServiceMetadata(serviceName)
                    });
                } else {
                    logApi.error(`[SERVICE INIT] Failed to initialize infrastructure service ${serviceName}:`, {
                        //error: error.message,
                        //stack: error.stack,
                        //metadata: getServiceMetadata(serviceName)
                    });
                }
                failed.add(serviceName);
            }
        }

        // Then initialize remaining services in dependency order
        const remainingServices = initOrder.filter(service => !infraServices.includes(service));
        logApi.info('Initializing remaining services:', {
            services: remainingServices,
            count: remainingServices.length
        });

        for (const serviceName of remainingServices) {
            try {
                if (VERBOSE_SERVICE_INIT) {
                    logApi.info(`[SERVICE INIT] Attempting to initialize service ${serviceName}`, {
                        metadata: getServiceMetadata(serviceName),
                        dependencies: this.dependencies.get(serviceName) || []
                    });
                } else {
                    //logApi.info(`[SERVICE INIT] Attempting to initialize service ${serviceName}`, {
                    //    metadata: getServiceMetadata(serviceName),
                    //    dependencies: this.dependencies.get(serviceName) || []
                    //});
                }

                const success = await this._initializeService(serviceName, initialized, failed);
                if (success) {
                    logApi.info(`[SERVICE INIT] Service ${serviceName} initialization completed successfully`);
                } else {
                    logApi.error(`[SERVICE INIT] Service ${serviceName} initialization returned false`);
                }
            } catch (error) {
                if (VERBOSE_SERVICE_INIT) {
                    logApi.error(`[SERVICE INIT] Failed to initialize service ${serviceName}:`, {
                        error: error.message,
                        stack: error.stack,
                        metadata: getServiceMetadata(serviceName)
                    });
                } else {
                    logApi.error(`[SERVICE INIT] Failed to initialize service ${serviceName}:`, {
                        //error: error.message,
                        //stack: error.stack,
                        //metadata: getServiceMetadata(serviceName)
                    });
                }
                failed.add(serviceName);
            }
        }

        const summary = {
            initialized: Array.from(initialized),
            failed: Array.from(failed),
            totalAttempted: initOrder.length,
            successRate: `${(initialized.size / initOrder.length * 100).toFixed(1)}%`
        };

        if (VERBOSE_SERVICE_INIT) {
            logApi.info('Service initialization completed:', summary);
        } else {
            logApi.info('Service initialization completed:', {
                //initialized: initialized.size,
                //failed: failed.size
            });
        }

        return {
            initialized: Array.from(initialized),
            failed: Array.from(failed)
        };
    }

    /**
     * Calculate initialization order based on dependencies
     */
    calculateInitializationOrder() {
        const visited = new Set();
        const order = [];
        const dependencies = this.dependencies; // Store reference to instance dependencies

        function visit(serviceName) {
            if (visited.has(serviceName)) return;
            visited.add(serviceName);

            const serviceDeps = dependencies.get(serviceName) || [];
            for (const dep of serviceDeps) {
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
    async _initializeService(serviceName, initialized, failed) {
        try {
            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`[SERVICE INIT] Starting initialization of service ${serviceName}`);
            }

            if (initialized.has(serviceName)) {
                logApi.warn(`[SERVICE INIT] Service ${serviceName} already initialized`);
                return true;
            }
            if (failed.has(serviceName)) {
                logApi.warn(`[SERVICE INIT] Service ${serviceName} previously failed`);
                return false;
            }

            let service = this.services.get(serviceName);
            if (!service) {
                const error = new Error(`Service ${serviceName} not found in registered services`);
                if (VERBOSE_SERVICE_INIT) {
                    logApi.error(`[SERVICE INIT] ${error.message}`, {
                        availableServices: Array.from(this.services.keys()),
                        metadata: getServiceMetadata(serviceName)
                    });
                } else {
                    logApi.error(`[SERVICE INIT] ${error.message}`, {
                        //availableServices: Array.from(this.services.keys()),
                        //metadata: getServiceMetadata(serviceName)
                    });
                }
                failed.add(serviceName);
                return false;
            }

            // Check dependencies first
            const dependencies = this.dependencies.get(serviceName) || [];
            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`[SERVICE INIT] Checking dependencies for ${serviceName}:`, {
                    dependencies,
                    metadata: getServiceMetadata(serviceName)
                });
            } else {
                //logApi.info(`[SERVICE INIT] Checking dependencies for ${serviceName}:`, {
                //    dependencies,
                //    metadata: getServiceMetadata(serviceName)
                //});
            }

            for (const dep of dependencies) {
                if (!initialized.has(dep)) {
                    try {
                        if (VERBOSE_SERVICE_INIT) {
                            logApi.info(`[SERVICE INIT] Initializing dependency ${dep} for ${serviceName}`);
                        }
                        const success = await this._initializeService(dep, initialized, failed);
                        if (!success) {
                            const error = new Error(`Cannot initialize ${serviceName} - dependency ${dep} failed to initialize`);
                            if (VERBOSE_SERVICE_INIT) {
                                logApi.error(`[SERVICE INIT] ${error.message}`, {
                                    service: serviceName,
                                    dependency: dep,
                                    metadata: getServiceMetadata(dep)
                                });
                            } else {
                                logApi.error(`[SERVICE INIT] ${error.message}`, {
                                    service: serviceName,
                                    dependency: dep,
                                    //metadata: getServiceMetadata(dep)
                                });
                            }
                            failed.add(serviceName);
                            return false;
                        }

                        // Wait for dependency to be fully started
                        const depService = this.services.get(dep);
                        if (!depService.isStarted) {
                            if (VERBOSE_SERVICE_INIT) {
                                logApi.info(`[SERVICE INIT] Waiting for dependency ${dep} to start`);
                            }
                            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait a bit
                            const depStatus = await this.checkServiceHealth(dep);
                            if (!depStatus) {
                                const error = new Error(`Cannot initialize ${serviceName} - dependency ${dep} not healthy after start`);
                                if (VERBOSE_SERVICE_INIT) {
                                    logApi.error(`[SERVICE INIT] ${error.message}`, {
                                        service: serviceName,
                                        dependency: dep,
                                        metadata: getServiceMetadata(dep)
                                    });
                                } else {
                                    logApi.error(`[SERVICE INIT] ${error.message}`, {
                                        service: serviceName,
                                        dependency: dep,
                                        //metadata: getServiceMetadata(dep)
                                    });
                                }
                                failed.add(serviceName);
                                return false;
                            }
                        }
                    } catch (error) {
                        if (VERBOSE_SERVICE_INIT) {
                            logApi.error(`[SERVICE INIT] Error initializing dependency ${dep} for ${serviceName}:`, {
                                error: error.message,
                                stack: error.stack,
                                service: serviceName,
                                dependency: dep,
                                metadata: getServiceMetadata(dep)
                            });
                        } else {
                            logApi.error(`[SERVICE INIT] Error initializing dependency ${dep} for ${serviceName}:`, {
                                error: error.message,
                                //stack: error.stack,
                                service: serviceName,
                                dependency: dep,
                                metadata: getServiceMetadata(dep)
                            });
                        }
                        failed.add(serviceName);
                        return false;
                    }
                } else {
                    if (VERBOSE_SERVICE_INIT) {
                        logApi.info(`[SERVICE INIT] Dependency ${dep} already initialized for ${serviceName}`);
                    }
                }
            }

            try {
                if (VERBOSE_SERVICE_INIT) {
                    logApi.info(`[SERVICE INIT] Running initialize() for ${serviceName}`, {
                        metadata: getServiceMetadata(serviceName),
                        config: service.config
                    });
                } else {
                    //logApi.info(`[SERVICE INIT] Running initialize() for ${serviceName}`, {
                    //    metadata: getServiceMetadata(serviceName),
                    //    config: service.config
                    //});
                }

                const success = await service.initialize();
                if (success) {
                    if (VERBOSE_SERVICE_INIT) {
                        logApi.info(`[SERVICE INIT] Running start() for ${serviceName}`);
                    }
                    await service.start();
                    initialized.add(serviceName);
                    await this.markServiceStarted(serviceName, service.config, service.stats);
                    service.isStarted = true;
                    if (VERBOSE_SERVICE_INIT) {
                        logApi.info(`[SERVICE INIT] Service ${serviceName} initialized and started successfully`, {
                            config: service.config,
                            stats: service.stats
                        });
                    } else {
                        //logApi.info(`[SERVICE INIT] Service ${serviceName} initialized and started successfully`, {
                        //    config: service.config,
                        //    stats: service.stats
                        //});
                    }
                    return true;
                } else {
                    const error = new Error(`Service ${serviceName} initialization returned false`);
                    if (VERBOSE_SERVICE_INIT) {
                        logApi.error(`[SERVICE INIT] ${error.message}`, {
                            metadata: getServiceMetadata(serviceName)
                        });
                    } else {
                        logApi.error(`[SERVICE INIT] ${error.message}`, {
                            //metadata: getServiceMetadata(serviceName)
                        });
                    }
                    failed.add(serviceName);
                    return false;
                }
            } catch (error) {
                if (VERBOSE_SERVICE_INIT) {
                    logApi.error(`[SERVICE INIT] Error initializing service ${serviceName}:`, {
                        error: error.message,
                        stack: error.stack,
                        service: {
                            name: serviceName,
                            config: service.config,
                            stats: service.stats
                        },
                        metadata: getServiceMetadata(serviceName)
                    });
                } else {
                    logApi.error(`[SERVICE INIT] ${error.message}`, {
                        //metadata: getServiceMetadata(serviceName)
                    });
                }
                failed.add(serviceName);
                return false;
            }
        } catch (error) {
            if (VERBOSE_SERVICE_INIT) {
                logApi.error(`[SERVICE INIT] Unexpected error in _initializeService for ${serviceName}:`, {
                    error: error.message,
                    stack: error.stack,
                    metadata: getServiceMetadata(serviceName)
                });
            } else {
                logApi.error(`[SERVICE INIT] Unexpected error in _initializeService for ${serviceName}:`, {
                    //error: error.message,
                    //metadata: getServiceMetadata(serviceName)
                });
            }
            failed.add(serviceName);
            return false;
        }
    }

    /**
     * Clean up problematic service state
     */
    async cleanupServiceState(serviceName) {
        return SystemSettingsUtil.deleteSetting(serviceName);
    }

    /**
     * Update service state and broadcast changes
     */
    async updateServiceState(serviceName, state, config, stats = null) {
        try {
            // Create a service state object
            const serviceState = {
                status: state.status || 'unknown',
                running: !!state.running,
                last_check: new Date().toISOString(),
                config: config || {},
                stats: stats || {}
            };

            // Use the utility to safely upsert the setting
            await SystemSettingsUtil.upsertSetting(
                serviceName,
                serviceState,
                'Consolidated service health status',
                null // No updated_by for system operations
            );

            // Update local state
            this.state.set(serviceName, state);

            // Broadcast update if WebSocket is available
            if (this.circuitBreakerWs) {
                this.circuitBreakerWs.notifyServiceUpdate(serviceName, state);
            }
        } catch (error) {
            console.error(`Error in updateServiceState for ${serviceName}:`, error);
            // Don't throw the error to prevent service initialization failures
        }
    }

    /**
     * Get the current state of a service
     */
    async getServiceState(serviceName) {
        try {
            // Check local state first
            const localState = this.state.get(serviceName);
            if (localState) return localState;

            // Fallback to database using our utility
            const value = await SystemSettingsUtil.getSetting(serviceName);
            
            if (!value) return null;

            // Cache in local state
            this.state.set(serviceName, value);
            
            return value;
        } catch (error) {
            logApi.error(`Failed to get service state for ${serviceName}:`, error);
            return null;
        }
    }

    /**
     * Check service health and manage circuit breaker
     */
    async checkServiceHealth(serviceName) {
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
    determineServiceStatus(stats) {
        if (!stats) return 'unknown';
        
        if (stats.circuitBreaker?.isOpen) return 'circuit_open';
        if (stats.history?.consecutiveFailures > 0) return 'degraded';
        if (!isHealthy(stats)) return 'unhealthy';
        
        return 'healthy';
    }

    /**
     * Get all services in a specific layer
     */
    getServicesInLayer(layer) {
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
    validateDependencies(serviceName, dependencies) {
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
    async markServiceRecovered(serviceName) {
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
    async markServiceStarted(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: true,
            status: 'active',
            last_started: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Mark service as stopped
     */
    async markServiceStopped(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: false,
            status: 'stopped',
            last_stopped: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Mark service error
     */
    async markServiceError(serviceName, error, config, stats = null) {
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
    async updateServiceHeartbeat(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: true,
            status: 'active',
            last_check: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Clean up all service states
     */
    async cleanupAllServiceStates() {
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

            if (VERBOSE_SERVICE_INIT) {
                logApi.info('Cleaned up all service states');
            }
            return true;
        } catch (error) {
            logApi.error('Failed to clean up service states:', error);
            return false;
        }
    }

    /**
     * Clean up all services
     */
    async cleanup() {
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
    addDependency(serviceName, dependencyOrDependencies) {
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
        if (VERBOSE_SERVICE_INIT) {
            logApi.info(`Added dependencies for ${serviceName}:`, dependencies);
        }

        return true;
    }

    /**
     * Start a specific service by its file name
     */
    async startService(serviceFile, adminContext = null) {
        try {
            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`[ServiceManager] Starting service from file: ${serviceFile}`);
            }
            
            // Get service instance
            const service = this.services.get(serviceFile);
            if (!service) {
                // If service doesn't exist, try to load it
                const servicePath = path.join(process.cwd(), 'websocket', serviceFile);
                try {
                    const serviceModule = await import(servicePath);
                    if (serviceModule && serviceModule.default) {
                        this.services.set(serviceFile, serviceModule.default);
                    }
                } catch (error) {
                    throw new Error(`Failed to load service ${serviceFile}: ${error.message}`);
                }
            }

            const serviceInstance = this.services.get(serviceFile);
            if (!serviceInstance) {
                throw new Error(`Service ${serviceFile} not found or failed to load`);
            }

            // Initialize if needed
            if (!serviceInstance.isInitialized) {
                await serviceInstance.initialize();
            }

            // Start the service
            await serviceInstance.start();
            
            // Update service state
            await this.markServiceStarted(serviceFile, serviceInstance.config, serviceInstance.stats);

            // Log admin action if context provided
            if (adminContext?.adminAddress) {
                await AdminLogger.logAction(
                    adminContext.adminAddress,
                    AdminLogger.Actions.SERVICE.START,
                    { service: serviceFile, status: 'success' },
                    {
                        ip_address: adminContext.ip,
                        user_agent: adminContext.userAgent
                    }
                );
            }

            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`[ServiceManager] Service ${serviceFile} started successfully`);
            }
            return true;
        } catch (error) {
            // Log failed admin action if context provided
            if (adminContext?.adminAddress) {
                await AdminLogger.logAction(
                    adminContext.adminAddress,
                    AdminLogger.Actions.SERVICE.START,
                    { 
                        service: serviceFile, 
                        status: 'failed',
                        error: error.message 
                    },
                    {
                        ip_address: adminContext.ip,
                        user_agent: adminContext.userAgent
                    }
                );
            }

            logApi.error(`[ServiceManager] Failed to start service ${serviceFile}:`, error);
            throw error;
        }
    }

    /**
     * Stop a specific service by its file name
     */
    async stopService(serviceFile, adminContext = null) {
        try {
            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`[ServiceManager] Stopping service: ${serviceFile}`);
            }
            
            const service = this.services.get(serviceFile);
            if (!service) {
                throw new Error(`Service ${serviceFile} not found`);
            }

            // Stop the service
            await service.stop();
            
            // Update service state
            await this.markServiceStopped(serviceFile, service.config, service.stats);

            // Log admin action if context provided
            if (adminContext?.adminAddress) {
                await AdminLogger.logAction(
                    adminContext.adminAddress,
                    AdminLogger.Actions.SERVICE.STOP,
                    { service: serviceFile, status: 'success' },
                    {
                        ip_address: adminContext.ip,
                        user_agent: adminContext.userAgent
                    }
                );
            }

            logApi.info(`[ServiceManager] Service ${serviceFile} stopped successfully`);
            return true;
        } catch (error) {
            // Log failed admin action if context provided
            if (adminContext?.adminAddress) {
                await AdminLogger.logAction(
                    adminContext.adminAddress,
                    AdminLogger.Actions.SERVICE.STOP,
                    { 
                        service: serviceFile, 
                        status: 'failed',
                        error: error.message 
                    },
                    {
                        ip_address: adminContext.ip,
                        user_agent: adminContext.userAgent
                    }
                );
            }

            logApi.error(`[ServiceManager] Failed to stop service ${serviceFile}:`, error);
            throw error;
        }
    }

    /**
     * Restart a specific service by its file name
     */
    async restartService(serviceFile, adminContext = null) {
        try {
            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`[ServiceManager] Restarting service: ${serviceFile}`);
            }
            
            // Stop service if it exists
            const service = this.services.get(serviceFile);
            if (service) {
                await this.stopService(serviceFile, adminContext);
            }

            // Start service
            await this.startService(serviceFile, adminContext);

            // Log admin action if context provided
            if (adminContext?.adminAddress) {
                await AdminLogger.logAction(
                    adminContext.adminAddress,
                    AdminLogger.Actions.SERVICE.CONFIGURE,
                    { 
                        service: serviceFile, 
                        action: 'restart',
                        status: 'success' 
                    },
                    {
                        ip_address: adminContext.ip,
                        user_agent: adminContext.userAgent
                    }
                );
            }

            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`[ServiceManager] Service ${serviceFile} restarted successfully`);
            }
            return true;
        } catch (error) {
            // Log failed admin action if context provided
            if (adminContext?.adminAddress) {
                await AdminLogger.logAction(
                    adminContext.adminAddress,
                    AdminLogger.Actions.SERVICE.CONFIGURE,
                    { 
                        service: serviceFile, 
                        action: 'restart',
                        status: 'failed',
                        error: error.message 
                    },
                    {
                        ip_address: adminContext.ip,
                        user_agent: adminContext.userAgent
                    }
                );
            }

            logApi.error(`[ServiceManager] Failed to restart service ${serviceFile}:`, error);
            throw error;
        }
    }
}

// Create and export singleton instance
const serviceManager = new ServiceManager();
export default serviceManager;