// utils/service-manager.js

/*
 * This file is responsible for managing all DegenDuel services.
 * It allows the admin to start, stop, and update the state of all services.
 * 
 */

// Master Circuit Breaker
import prisma from '../../config/prisma.js';
import { logApi } from '../logger-suite/logger.js';
import { 
    isHealthy, shouldReset,
    //getCircuitBreakerConfig, 
} from './circuit-breaker-config.js';
import { createCircuitBreakerWebSocket } from '../../websocket/circuit-breaker-ws.js';
import { 
    SERVICE_NAMES, 
    SERVICE_LAYERS, 
    getServiceMetadata,
    getServiceDependencies,
    validateDependencyChain,
    //getServiceCriticalLevel,
} from './service-constants.js';
//import { ServiceError } from './service-error.js';
import serviceEvents from './service-events.js';
import { BaseService } from './base-service.js';
import path from 'path';
import AdminLogger from '../admin-logger.js';
import SystemSettingsUtil from '../system-settings-util.js';
import { fancyColors } from '../colors.js';

// Config
import { config } from '../../config/config.js';

// Manual debug modes
const VERBOSE_SERVICE_INIT = false;
const DEBUG_SERVICE_REGISTRATION = process.env.DEBUG_SERVICE_REGISTRATION === 'true' || false;

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
        // Check if the server is provided
        if (!server) {
            logApi.warn('Attempted to initialize circuit breaker WebSocket without server instance');
            return;
        }

        // Initialize the circuit breaker WebSocket
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
        const callStack = new Error().stack || '';
        // Extreme debugging - log the caller
        if (DEBUG_SERVICE_REGISTRATION) {
            logApi.info(`${fancyColors.RED}🔥 CALLER (DEBUG): ${callStack.split('\n').slice(0, 5).join('\n')}${fancyColors.RESET}`);
        }
        
        // CRITICAL FIX: Prevent all undefined registrations
        if (!serviceOrName || serviceOrName === undefined) {
            // Log the entire stack trace for the undefined service
            logApi.error(`${fancyColors.RED}🔥 CRITICAL: Attempted to register undefined service. Call stack: ${callStack}${fancyColors.RESET}`);
            throw new Error('Attempted to register undefined service');
        }
        
        // Enhanced SAFETY: Block any getters that might return undefined
        // This prevents accessing a getter that doesn't exist on config.services
        if (typeof serviceOrName === 'function') {
            logApi.error(`${fancyColors.RED}🔥 CRITICAL: Attempted to register a function as a service. Call stack: ${callStack}${fancyColors.RESET}`);
            throw new Error('Cannot register a function as a service');
        }
        
        // SUPER CRITICAL SAFETY: Enhanced protection against problematic services
        // These are cases we want to block from registration (but not crash)
        
        // Case 1: Direct registration of solana_service
        if (
            (typeof serviceOrName === 'string' && (serviceOrName === 'solana_service' || serviceOrName === 'solanaService')) ||
            (typeof serviceOrName === 'object' && serviceOrName?.name === 'solana_service')
        ) {
            logApi.error(`${fancyColors.RED}🔥 CRITICAL: Blocked attempt to register deprecated solana_service. Call stack: ${callStack}${fancyColors.RESET}`);
            // Instead of throwing an error, just return false to avoid crashing
            return false;
        }
        
        // Case 2: Service is the raw imported solanaService module (without name property)
        if (
            typeof serviceOrName === 'object' && 
            !serviceOrName?.name && 
            (serviceOrName?.connectionOptions && serviceOrName?.rpcStats)
        ) {
            logApi.error(`${fancyColors.RED}🔥 CRITICAL: Blocked attempt to register raw solanaService module. Call stack: ${callStack}${fancyColors.RESET}`);
            return false;
        }
        
        // Case 3: Service is undefined or literally has no name property
        if (
            typeof serviceOrName === 'object' && 
            !serviceOrName?.name && 
            !serviceOrName?.config?.name
        ) {
            logApi.error(`${fancyColors.RED}🔥 CRITICAL: Blocked attempt to register unknown service without name. Call stack: ${callStack}${fancyColors.RESET}`);
            return false;
        }
        
        // Detect if the problem is with vanity wallet service
        if (
            typeof serviceOrName === 'object' && 
            serviceOrName && 
            serviceOrName.name === 'vanity_wallet_service'
        ) {
            //logApi.info(`${fancyColors.RED}🔥 VANITY WALLET HOOK POINT${fancyColors.RESET}`);
            
            // Print out the next 5 items in the call stack
            //logApi.info(`${fancyColors.RED}🔥 STACK AFTER VANITY: ${callStack.split('\n').slice(1, 10).join('\n')}${fancyColors.RESET}`);
        }

        // Enhanced protection for service name resolution
        let serviceName;
        if (typeof serviceOrName === 'string') {
            serviceName = serviceOrName;
        } else if (typeof serviceOrName === 'object' && serviceOrName !== null) {
            // Check for service name in multiple locations with protection against undefined
            serviceName = serviceOrName.config?.name || serviceOrName.name;
            if (!serviceName) {
                logApi.error(`${fancyColors.RED}🔥 CRITICAL: Service object does not have a name property. Call stack: ${callStack}${fancyColors.RESET}`);
                throw new Error('Service object must have a name property');
            }
        } else {
            // This should never happen due to earlier checks, but just in case
            logApi.error(`${fancyColors.RED}🔥 CRITICAL: Invalid service type '${typeof serviceOrName}'. Call stack: ${callStack}${fancyColors.RESET}`);
            throw new Error(`Invalid service type '${typeof serviceOrName}'`);
        }
        
        // Final validation for the service name
        if (serviceName === 'undefined' || serviceName === undefined) {
            logApi.error(`${fancyColors.RED}🔥 CRITICAL: Invalid service name '${serviceName}'. Call stack: ${callStack}${fancyColors.RESET}`);
            throw new Error(`Invalid service name '${serviceName}'`);
        }

        // Log the service registration
        logApi.info(`${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.LIGHT_YELLOW}${fancyColors.ITALIC}Registering ${fancyColors.UNDERLINE}${serviceName}${fancyColors.RESET}${fancyColors.LIGHT_YELLOW}${fancyColors.ITALIC}...${fancyColors.RESET}`, {
            type: typeof serviceOrName,
            isInstance: serviceOrName instanceof BaseService,
            hasConfig: serviceOrName?.config !== undefined,
            configName: serviceOrName?.config?.name,
            directName: serviceOrName?.name,
            dependencies
            });
        
        // Debug name resolution
        if (VERBOSE_SERVICE_INIT) {
            logApi.info(`[ServiceManager] Name resolution:`, {
                resolvedName: serviceName,
                availableNames: Object.values(SERVICE_NAMES)
            });
        }

        // Get service instance
        const service = typeof serviceOrName === 'string' ? null : serviceOrName;

        // Get service metadata
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
            logApi.info(`${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.LIGHT_GREEN}${fancyColors.BG_GRAY} ${serviceName} ${fancyColors.RESET}`, {
            //    layer: metadata.layer,
            //    criticalLevel: metadata.criticalLevel,
            //    dependencies: allDependencies.size ? Array.from(allDependencies) : []
            });
        } else {
            logApi.info(`${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.LIGHT_GREEN}${fancyColors.BG_GRAY} ${serviceName} ${fancyColors.RESET}`);
        }

        // Return true if the service was registered successfully
        return true;
    }

    /**
     * Initialize all services in dependency order
     */
    async initializeAll() {
        // Initialize the set of initialized services
        const initialized = new Set();
        // Initialize the set of failed services
        const failed = new Set();
        // Calculate the initialization order
        const initOrder = this.calculateInitializationOrder();

        // Log the starting service initialization
        logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Starting service initialization in order...${fancyColors.RESET}`, {
        //    order: initOrder,
        //    totalServices: initOrder.length,
        //    registeredServices: Array.from(this.services.keys())
        });

        // First, initialize infrastructure layer services
        const infraServices = initOrder.filter(service => {
            const metadata = getServiceMetadata(service);
            return metadata?.layer === SERVICE_LAYERS.INFRASTRUCTURE;
        });

        // Log the infrastructure services to be initialized
        logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Initializing infrastructure services...${fancyColors.RESET}`, {
        //    services: infraServices,
        //    count: infraServices.length
        });

        // Initialize the infrastructure services
        for (const serviceName of infraServices) {
            // Try to initialize the infrastructure service
            try {
                // Log the infrastructure service to be initialized
                if (VERBOSE_SERVICE_INIT) {
                    logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Attempting to initialize infrastructure service ${serviceName}:${fancyColors.RESET}`, {
                        metadata: getServiceMetadata(serviceName),
                        dependencies: this.dependencies.get(serviceName) || []
                    });
                } else {
                    //logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Attempting to initialize infrastructure service ${serviceName}`, {
                    //    metadata: getServiceMetadata(serviceName),
                    //    dependencies: this.dependencies.get(serviceName) || []
                    //});
                }

                // Initialize the infrastructure service
                const success = await this._initializeService(serviceName, initialized, failed);
                if (success) {
                    // Log the infrastructure service initialization completed successfully
                    if (VERBOSE_SERVICE_INIT) {
                        logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.GREEN}${fancyColors.ITALIC}Infrastructure service ${serviceName} initialization completed successfully${fancyColors.RESET}`);
                    }
                } else {
                    // Log the infrastructure service initialization returned false
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.RED}${fancyColors.ITALIC}Infrastructure service ${serviceName} initialization returned false${fancyColors.RESET}`);
                }
            } catch (error) {
                // Log the infrastructure service initialization failed
                if (VERBOSE_SERVICE_INIT) {
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.RED}${fancyColors.ITALIC}Failed to initialize infrastructure service ${serviceName}:${fancyColors.RESET}`, {
                        error: error.message,
                        stack: error.stack,
                        metadata: getServiceMetadata(serviceName)
                    });
                } else {
                    // Log the infrastructure service initialization failed
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.RED}${fancyColors.ITALIC}Failed to initialize infrastructure service ${serviceName}:${fancyColors.RESET}`, {
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
        // Log the remaining services to be initialized
        logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Initializing remaining services...${fancyColors.RESET}`, {
        //    services: remainingServices,
        //    count: remainingServices.length
        });

        // Initialize the remaining services
        for (const serviceName of remainingServices) {
            try {
                // Log the remaining service to be initialized
                if (VERBOSE_SERVICE_INIT) {
                    logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Attempting to initialize service ${serviceName}:${fancyColors.RESET}`, {
                        metadata: getServiceMetadata(serviceName),
                        dependencies: this.dependencies.get(serviceName) || []
                    });
                } else {
                    //logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Attempting to initialize service ${serviceName}`, {
                    //    metadata: getServiceMetadata(serviceName),
                    //    dependencies: this.dependencies.get(serviceName) || []
                    //});
                }

                // Initialize the remaining service
                const success = await this._initializeService(serviceName, initialized, failed);
                if (success) {
                    // Log the remaining service initialization completed successfully
                    logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.GREEN}${fancyColors.ITALIC}Service ${serviceName} initialization completed successfully${fancyColors.RESET}`);
                } else {
                    // Log the remaining service initialization returned false
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.RED}${fancyColors.ITALIC}Service ${serviceName} initialization returned false${fancyColors.RESET}`);
                }
            } catch (error) {
                // Log the remaining service initialization failed
                if (VERBOSE_SERVICE_INIT) {
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.RED}${fancyColors.ITALIC}Failed to initialize service ${serviceName}:${fancyColors.RESET}`, {
                        error: error.message,
                        stack: error.stack,
                        metadata: getServiceMetadata(serviceName)
                    });
                } else {
                    // Log the remaining service initialization failed
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.RED}${fancyColors.ITALIC}Failed to initialize service ${serviceName}:${fancyColors.RESET}`, {
                        //error: error.message,
                        //stack: error.stack,
                        //metadata: getServiceMetadata(serviceName)
                    });
                }
                failed.add(serviceName);
            }
        }

        // Log the service initialization summary
        const summary = {
            initialized: Array.from(initialized),
            failed: Array.from(failed),
            totalAttempted: initOrder.length,
            successRate: `${(initialized.size / initOrder.length * 100).toFixed(1)}%`
        };

        // Log the service initialization summary
        if (VERBOSE_SERVICE_INIT) {
            logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.GREEN}${fancyColors.ITALIC}Service initialization completed:${fancyColors.RESET}`, summary);
        } else {
            logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.GREEN}${fancyColors.ITALIC}Service initialization completed:${fancyColors.RESET}`, {
                //initialized: initialized.size,
                //failed: failed.size
            });
        }

        // Return the service initialization summary
        return {
            initialized: Array.from(initialized),
            failed: Array.from(failed)
        };
    }

    /**
     * Calculate initialization order based on dependencies
     */
    calculateInitializationOrder() {
        // Initialize the set of visited services
        const visited = new Set();
        // Initialize the order of services to be initialized
        const order = [];
        // Store reference to instance dependencies
        const dependencies = this.dependencies;

        function visit(serviceName) {
            // Return if the service has already been visited
            if (visited.has(serviceName)) return;
            // Add the service to the visited set
            visited.add(serviceName);
            // Get the dependencies of the service
            const serviceDeps = dependencies.get(serviceName) || [];
            // Visit the dependencies
            for (const dep of serviceDeps) {
                visit(dep);
            }
            // Add the service to the order
            order.push(serviceName);
        }

        // Start with infrastructure layer
        const infraServices = this.getServicesInLayer(SERVICE_LAYERS.INFRASTRUCTURE);

        // Visit the infrastructure services
        for (const service of infraServices) {
            visit(service);
        }

        // Then data layer
        const dataServices = this.getServicesInLayer(SERVICE_LAYERS.DATA);

        // Visit the data services
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

        // Return the order of services to be initialized
        return order;
    }

    /**
     * Initialize a single service
     */
    async _initializeService(serviceName, initialized, failed) {
        // Try to initialize the service
        try {
            // Log the starting service initialization
            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.ITALIC}${fancyColors.LIGHT_YELLOW}Starting initialization of service ${fancyColors.DARK_MAGENTA}${fancyColors.BOLD}${fancyColors.ITALIC}${serviceName}${fancyColors.RESET}`);
            }

            // Return true if the service has already been initialized
            if (initialized.has(serviceName)) {
                logApi.warn(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Service ${serviceName} already initialized`);
                return true;
            }

            // Return false if the service has previously failed
            if (failed.has(serviceName)) {
                logApi.warn(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Service ${serviceName} previously failed`);
                return false;
            }

            // Get the service instance
            let service = this.services.get(serviceName);
            if (!service) {
                // Log the service not found error
                const error = new Error(`Service ${serviceName} not found in registered services`);
                if (VERBOSE_SERVICE_INIT) {
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${error.message}`, {
                        availableServices: Array.from(this.services.keys()),
                        metadata: getServiceMetadata(serviceName)
                    });
                } else {
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${error.message}`, {
                        //availableServices: Array.from(this.services.keys()),
                        //metadata: getServiceMetadata(serviceName)
                    });
                }
                failed.add(serviceName);
                return false;
            }

            // Check dependencies first
            const dependencies = this.dependencies.get(serviceName) || [];

            // Log the dependencies to be checked
            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Checking dependencies for ${serviceName}:`, {
                    dependencies,
                    metadata: getServiceMetadata(serviceName)
                });
            } else {
                //logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Checking dependencies for ${serviceName}:`, {
                //    dependencies,
                //    metadata: getServiceMetadata(serviceName)
                //});
            }

            // Check each dependency
            for (const dep of dependencies) {
                // Check if this dependency is disabled by service profile before doing anything else
                if (failed.has(dep)) {
                    // Check if it's in failed because it's disabled by profile
                    const depState = this.state.get(dep);
                    const isDisabledByProfile = depState && depState.status === 'disabled_by_config';
                    
                    if (isDisabledByProfile) {
                        // This dependency is intentionally disabled, so we can skip it
                        logApi.warn(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.YELLOW}Dependency ${dep} is disabled by service profile, skipping dependency check for ${serviceName}${fancyColors.RESET}`);
                        // Skip this dependency entirely
                        continue;
                    }
                }
                
                // Return true if the dependency has already been initialized
                if (!initialized.has(dep)) {
                    try {
                        // Log the dependency to be initialized
                        if (VERBOSE_SERVICE_INIT) {
                            logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Initializing dependency ${dep} for ${serviceName}`);
                        }

                        // Initialize the dependency
                        const success = await this._initializeService(dep, initialized, failed);

                        // Check if the dependency failed but it's intentionally disabled by service profile
                        if (!success) {
                            // Check if the dependency is disabled by service profile
                            // First, get the state to see if it's a profile-disabled service
                            const depState = this.state.get(dep);
                            const isDisabledByProfile = depState && depState.status === 'disabled_by_config';
                            
                            if (isDisabledByProfile) {
                                // This dependency is intentionally disabled, so we can skip it
                                logApi.warn(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.YELLOW}Dependency ${dep} is disabled by service profile, skipping dependency check for ${serviceName}${fancyColors.RESET}`);
                                // Continue to the next dependency instead of failing
                                continue;
                            } else {
                                // Log the dependency initialization failed
                                const error = new Error(`Cannot initialize ${serviceName} - dependency ${dep} failed to initialize`);
                                if (VERBOSE_SERVICE_INIT) {
                                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${error.message}`, {
                                        service: serviceName,
                                        dependency: dep,
                                        metadata: getServiceMetadata(dep)
                                    });
                                } else {
                                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${error.message}`, {
                                        service: serviceName,
                                        dependency: dep,
                                        //metadata: getServiceMetadata(dep)
                                    });
                                }
                                failed.add(serviceName);
                                return false;
                            }
                        }

                        // Wait for dependency to be fully started
                        const depService = this.services.get(dep);
                        if (depService && !depService.isStarted) {
                            if (VERBOSE_SERVICE_INIT) {
                                logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Waiting for dependency ${dep} to start`);
                            }
                            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait a bit
                            const depStatus = await this.checkServiceHealth(dep);
                            if (!depStatus) {
                                // Check if this dependency is disabled by profile
                                const depState = this.state.get(dep);
                                const isDisabledByProfile = depState && depState.status === 'disabled_by_config';
                                
                                if (isDisabledByProfile) {
                                    // This dependency is intentionally disabled, so we can skip the health check
                                    logApi.warn(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.YELLOW}Dependency ${dep} is disabled by service profile, skipping health check for ${serviceName}${fancyColors.RESET}`);
                                    // Continue without failing
                                } else {
                                    const error = new Error(`Cannot initialize ${serviceName} - dependency ${dep} not healthy after start`);
                                    if (VERBOSE_SERVICE_INIT) {
                                        logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${error.message}`, {
                                            service: serviceName,
                                            dependency: dep,
                                            metadata: getServiceMetadata(dep)
                                        });
                                    } else {
                                        logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${error.message}`, {
                                            service: serviceName,
                                            dependency: dep,
                                            //metadata: getServiceMetadata(dep)
                                        });
                                    }
                                    failed.add(serviceName);
                                    return false;
                                }
                            }
                        }
                    } catch (error) {
                        // Log the dependency initialization failed
                        if (VERBOSE_SERVICE_INIT) {
                            logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Error initializing dependency ${dep} for ${serviceName}:`, {
                                error: error.message,
                                stack: error.stack,
                                service: serviceName,
                                dependency: dep,
                                metadata: getServiceMetadata(dep)
                            });
                        } else {
                            logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Error initializing dependency ${dep} for ${serviceName}:`, {
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
                    // Log the dependency already initialized
                    if (VERBOSE_SERVICE_INIT) {
                        logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Dependency ${dep} already initialized for ${serviceName}`);
                    }
                }
            }

            // Try to initialize the service
            try {
                // Log the running initialize() for the service
                if (VERBOSE_SERVICE_INIT) {
                    logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Running initialize() for ${serviceName}`, {
                        metadata: getServiceMetadata(serviceName),
                        config: service.config
                    });
                } else {
                    //logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Running initialize() for ${serviceName}`, {
                    //    metadata: getServiceMetadata(serviceName),
                    //    config: service.config
                    //});
                }

                // Initialize the service
                const success = await service.initialize();

                // Log the service initialization completed successfully
                if (success) {
                    if (VERBOSE_SERVICE_INIT) {
                        logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Running start() for ${serviceName}`);
                    }

                    // Start the service
                    await service.start();

                    // Add the service to the initialized set
                    initialized.add(serviceName);

                    // Mark the service as started
                    await this.markServiceStarted(serviceName, service.config, service.stats);
                    service.isStarted = true;

                    // Log the service initialization completed successfully
                    if (VERBOSE_SERVICE_INIT) {
                        logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Service ${serviceName} initialized and started successfully`, {
                        //    config: service.config,
                        //    stats: service.stats
                        });
                    } else {
                        //logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Service ${serviceName} initialized and started successfully`, {
                        //    config: service.config,
                        //    stats: service.stats
                        //});
                    }

                    // Return true if the service initialization completed successfully
                    return true;
                } else {
                    // Check for service disabled via service profile
                    if ((serviceName === SERVICE_NAMES.MARKET_DATA && !config.services.market_data) ||
                        (serviceName === SERVICE_NAMES.CONTEST_EVALUATION && !config.services.contest_evaluation) ||
                        (serviceName === SERVICE_NAMES.TOKEN_WHITELIST && !config.services.token_whitelist) ||
                        (serviceName === SERVICE_NAMES.LIQUIDITY && !config.services.liquidity) ||
                        (serviceName === SERVICE_NAMES.USER_BALANCE_TRACKING && !config.services.user_balance_tracking) ||
                        (serviceName === SERVICE_NAMES.WALLET_RAKE && !config.services.wallet_rake) ||
                        (serviceName === SERVICE_NAMES.CONTEST_SCHEDULER && !config.services.contest_scheduler) ||
                        (serviceName === SERVICE_NAMES.ACHIEVEMENT && !config.services.achievement_service) ||
                        (serviceName === SERVICE_NAMES.REFERRAL && !config.services.referral_service) ||
                        (serviceName === SERVICE_NAMES.LEVELING && !config.services.leveling_service) ||
                        (serviceName === SERVICE_NAMES.CONTEST_WALLET && !config.services.contest_wallet_service) ||
                        (serviceName === SERVICE_NAMES.ADMIN_WALLET && !config.services.admin_wallet_service) ||
                        (serviceName === SERVICE_NAMES.SOLANA && !config.services.solana_service)) {
                        
                        // For intentionally disabled services, log as warning instead of error
                        logApi.warn(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} DISABLED ${fancyColors.RESET} ${fancyColors.YELLOW}Service ${serviceName} is intentionally disabled in the '${config.services.active_profile}' service profile${fancyColors.RESET}`);
                        
                        // Add detailed logging regardless of verbosity setting
                        logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.YELLOW}This is normal based on the active service profile configuration${fancyColors.RESET}`, {
                            service: serviceName,
                            status: 'disabled_by_profile',
                            active_profile: config.services.active_profile,
                            metadata: getServiceMetadata(serviceName)
                        });
                        
                        // Mark as failed for record keeping but with a special status
                        this.state.set(serviceName, {
                            ...this.state.get(serviceName) || {},
                            status: 'disabled_by_config',
                            running: false
                        });
                        
                        // Still add to failed list for consistency, but with special note
                        failed.add(serviceName);
                        return false;
                    } else {
                        // Log the service initialization returned false
                        const error = new Error(`Service ${serviceName} initialization returned false`);
                        // Always log detailed error info regardless of verbosity
                        logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${error.message}`, {
                            metadata: getServiceMetadata(serviceName),
                            service: serviceName,
                            status: 'init_returned_false'
                        });
                        
                        failed.add(serviceName);
                        return false;
                    }
                }
            } catch (error) {
                // Log the service initialization failed
                if (VERBOSE_SERVICE_INIT) {
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Error initializing service ${serviceName}:`, {
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
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${error.message}`, {
                    //    metadata: getServiceMetadata(serviceName)
                    });
                }
                failed.add(serviceName);
                return false;
            }
        } catch (error) {
            // Log the unexpected error in _initializeService
            if (VERBOSE_SERVICE_INIT) {
                logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Unexpected error in _initializeService for ${serviceName}:`, {
                    error: error.message,
                    stack: error.stack,
                    metadata: getServiceMetadata(serviceName)
                });
            } else {
                logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} Unexpected error in _initializeService for ${serviceName}:`, {
                //    error: error.message,
                //    metadata: getServiceMetadata(serviceName)
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
        // Clean up the service state
        return SystemSettingsUtil.deleteSetting(serviceName);
    }

    /**
     * Update service state and broadcast changes
     * Modified to prevent recursive embedding and limit state size
     */
    async updateServiceState(serviceName, state, config, stats = null) {
        try {
            // Create a safe, minimized version of the config object
            const safeConfig = this._createSafeConfig(config);
            
            // Create a safe version of the stats object
            const safeStats = this._createSafeStats(stats);
            
            // Create a clean service state object with only essential info
            const serviceState = {
                status: state.status || 'unknown',
                running: !!state.running,
                last_check: new Date().toISOString(),
                update_count: ((this.state.get(serviceName)?.update_count || 0) + 1),
                last_started: state.last_started || this.state.get(serviceName)?.last_started,
                last_stopped: state.last_stopped || this.state.get(serviceName)?.last_stopped,
                last_error: state.last_error || this.state.get(serviceName)?.last_error,
                last_error_time: state.last_error_time || this.state.get(serviceName)?.last_error_time,
                config: safeConfig,
                stats: safeStats
            };

            // Use the utility to safely upsert the setting
            await SystemSettingsUtil.upsertSetting(
                serviceName,
                serviceState,
                'Consolidated service health status',
                null // No updated_by for system operations
            );

            // Update local state (full version for runtime use)
            this.state.set(serviceName, {
                ...state,
                config: config || {},
                stats: stats || {},
                update_count: serviceState.update_count
            });

            // Broadcast update if WebSocket is available
            if (this.circuitBreakerWs) {
                this.circuitBreakerWs.notifyServiceUpdate(serviceName, state);
            }
        } catch (error) {
            logApi.error(`Error in updateServiceState for ${serviceName}:`, error);
            // Don't throw the error to prevent service initialization failures
        }
    }
    
    /**
     * Create a minimized safe version of config object for storage
     * Removes circular references and duplicate data
     * @private
     */
    _createSafeConfig(config) {
        if (!config) return {};
        
        try {
            // Extract only essential configuration data
            const safeConfig = {
                name: config.name,
                description: config.description,
                dependencies: Array.isArray(config.dependencies) ? [...config.dependencies] : [],
                layer: config.layer,
                criticalLevel: config.criticalLevel,
                // Keep basic service settings
                checkIntervalMs: config.checkIntervalMs,
                maxRetries: config.maxRetries,
                retryDelayMs: config.retryDelayMs
            };
            
            // Include circuit breaker config if present (without stats)
            if (config.circuitBreaker) {
                safeConfig.circuitBreaker = {
                    enabled: config.circuitBreaker.enabled,
                    failureThreshold: config.circuitBreaker.failureThreshold,
                    resetTimeoutMs: config.circuitBreaker.resetTimeoutMs,
                    healthCheckIntervalMs: config.circuitBreaker.healthCheckIntervalMs,
                    description: config.circuitBreaker.description
                };
            }
            
            // Include backoff settings if present
            if (config.backoff) {
                safeConfig.backoff = { ...config.backoff };
            }
            
            // Return the safe config
            return safeConfig;
        } catch (error) {
            logApi.warn(`Error creating safe config object: ${error.message}`);
            return { name: config.name || "unknown" };
        }
    }
    
    /**
     * Create a minimized safe version of stats object for storage
     * Keeps only current essential metrics, not the full history
     * @private
     */
    _createSafeStats(stats) {
        if (!stats) return {};
        
        try {
            // Create a minimal stats object with just essential data
            const safeStats = {};
            
            // Handle circuit breaker status
            if (stats.circuitBreaker) {
                safeStats.circuitBreaker = {
                    isOpen: stats.circuitBreaker.isOpen || false,
                    failures: stats.circuitBreaker.failures || 0,
                    lastFailure: stats.circuitBreaker.lastFailure,
                    lastReset: stats.circuitBreaker.lastReset,
                    recoveryAttempts: stats.circuitBreaker.recoveryAttempts || 0
                };
            }
            
            // Include operation counts if present (without details)
            if (stats.operations) {
                safeStats.operations = {
                    total: stats.operations.total || 0,
                    successful: stats.operations.successful || 0,
                    failed: stats.operations.failed || 0
                };
            }
            
            // Include very basic performance metrics if present
            if (stats.performance) {
                safeStats.performance = {
                    lastOperationTimeMs: stats.performance.lastOperationTimeMs,
                    averageOperationTimeMs: stats.performance.averageOperationTimeMs
                };
            }
            
            // Service-specific safe stats extraction
            if (stats.specialStats) {
                safeStats.specialStats = { ...stats.specialStats };
            }
            
            // Return the safe stats
            return safeStats;
        } catch (error) {
            logApi.warn(`Error creating safe stats object: ${error.message}`);
            return {};
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
     * Get all registered services
     * @returns {Map} Map of service names to service instances
     */
    getServices() {
        return this.services;
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

        try {
            logApi.info(`[ServiceManager] Starting service cleanup in dependency-aware order`);
            
            // Calculate proper shutdown order (reverse of initialization order)
            const initOrder = this.calculateInitializationOrder();
            const shutdownOrder = [...initOrder].reverse();
            
            // Group services by shutdown priority for better visualization
            const servicesByLayer = {};
            for (const service of shutdownOrder) {
                const metadata = getServiceMetadata(service);
                const layer = metadata?.layer || 'unknown';
                if (!servicesByLayer[layer]) {
                    servicesByLayer[layer] = [];
                }
                servicesByLayer[layer].push(service);
            }
            
            // Log shutdown plan
            logApi.info(`[ServiceManager] Service shutdown plan:`);
            Object.entries(servicesByLayer).forEach(([layer, services]) => {
                logApi.info(`  ${layer}: ${services.join(', ')}`);
            });
            
            // Perform shutdown with timeouts and graceful error handling
            for (const serviceName of shutdownOrder) {
                const service = this.services.get(serviceName);
                
                if (!service) {
                    logApi.debug(`[ServiceManager] Service ${serviceName} not running, skipping shutdown`);
                    continue;
                }
                
                try {
                    // Create shutdown timeout
                    const SHUTDOWN_TIMEOUT = 10000; // 10 seconds per service
                    let shutdownComplete = false;
                    
                    const timeoutPromise = new Promise((_, reject) => {
                        const timeout = setTimeout(() => {
                            reject(new Error(`Service ${serviceName} shutdown timed out after ${SHUTDOWN_TIMEOUT}ms`));
                        }, SHUTDOWN_TIMEOUT);
                        timeout.unref(); // Don't keep process alive
                    });
                    
                    // Start measuring shutdown time
                    const startTime = Date.now();
                    
                    // Attempt to stop the service with timeout
                    await Promise.race([
                        (async () => {
                            await service.stop();
                            shutdownComplete = true;
                        })(),
                        timeoutPromise
                    ]);
                    
                    // If we got here without an error, the service was stopped successfully
                    if (shutdownComplete) {
                        const shutdownTime = Date.now() - startTime;
                        logApi.info(`[ServiceManager] Service ${serviceName} stopped successfully in ${shutdownTime}ms`);
                        results.successful.push(serviceName);
                    }
                } catch (error) {
                    logApi.error(`[ServiceManager] Failed to stop service ${serviceName}: ${error.message}`);
                    results.failed.push({
                        service: serviceName,
                        error: error.message
                    });
                    
                    // Continue shutting down other services even if one fails
                }
            }

            // Final cleanup of internal data structures
            this.services.clear();
            this.dependencies.clear();
            this.state.clear();

            return results;
        } catch (error) {
            logApi.error(`[ServiceManager] Unexpected error during service cleanup: ${error.message}`);
            results.failed.push({
                service: 'ServiceManager',
                error: error.message
            });
            
            // Attempt to clean up as many services as possible despite error
            for (const [serviceName, service] of this.services) {
                try {
                    await service.stop();
                    results.successful.push(serviceName);
                } catch (serviceError) {
                    results.failed.push({
                        service: serviceName,
                        error: serviceError.message
                    });
                }
            }
            
            this.services.clear();
            this.dependencies.clear();
            this.state.clear();
            
            return results;
        }
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