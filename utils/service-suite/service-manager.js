// utils/service-manager.js

/*
 * This file is responsible for managing all DegenDuel services.
 * It allows the admin to start, stop, and update the state of all services.
 * 
 */

// Master Circuit Breaker
import { createCircuitBreakerWebSocket } from '../websocket-suite/circuit-breaker-ws.js';
// Services
import achievementService from '../../services/achievementService.js';
import adminWalletService from '../../services/adminWalletService.js';
import contestEvaluationService from '../../services/contestEvaluationService.js';
import contestWalletService from '../../services/contestWalletService.js';
import marketDataService from '../../services/marketDataService.js';
import referralService from '../../services/referralService.js';
import tokenSyncService from '../../services/tokenSyncService.js';
import tokenWhitelistService from '../../services/tokenWhitelistService.js';
import vanityWalletService from '../../services/vanityWalletService.js';
import walletRakeService from '../../services/walletRakeService.js';
// Other
import prisma from '../../config/prisma.js';
import { logApi } from '../logger-suite/logger.js';
import { getCircuitBreakerConfig, isHealthy, shouldReset } from './circuit-breaker-config.js';
import { SERVICE_NAMES, SERVICE_LAYERS, validateServiceName } from './service-constants.js';

/**
 * Service registry for managing all DegenDuel services
 */
export class ServiceManager {
    static services = new Map();
    static dependencies = new Map();
    static circuitBreakerWs = null;

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
     * Validates service dependencies
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
     * Registers a service with its dependencies
     */
    static register(service, dependencies = []) {
        if (!service) {
            logApi.error('Attempted to register undefined service');
            return;
        }

        if (!validateServiceName(service.name)) {
            logApi.error(`Invalid service name: ${service.name}`);
            return;
        }
        
        if (this.services.has(service.name)) {
            logApi.warn(`Service ${service.name} is already registered`);
            return;
        }

        // Validate dependencies
        const invalidDeps = dependencies.filter(dep => !validateServiceName(dep));
        if (invalidDeps.length > 0) {
            logApi.error(`Invalid dependencies for ${service.name}:`, invalidDeps);
            return;
        }

        this.services.set(service.name, service);
        this.dependencies.set(service.name, dependencies);
        this.validateDependencies(service.name, dependencies);
        logApi.info(`Registered service: ${service.name}`);
    }

    /**
     * Initialize all registered services in dependency order
     */
    static async initializeAll() {
        const initialized = new Set();
        const failed = new Set();

        for (const [serviceName, service] of this.services) {
            if (!initialized.has(serviceName)) {
                await this._initializeService(serviceName, initialized, failed, new Set());
            }
        }

        return {
            initialized: Array.from(initialized),
            failed: Array.from(failed)
        };
    }

    /**
     * Initialize a service and its dependencies
     */
    static async _initializeService(serviceName, initialized, failed, processing) {
        // Check for circular dependencies
        if (processing.has(serviceName)) {
            throw new Error(`Circular dependency detected: ${Array.from(processing).join(' -> ')} -> ${serviceName}`);
        }

        // Skip if already processed
        if (initialized.has(serviceName) || failed.has(serviceName)) {
            return;
        }

        processing.add(serviceName);

        // Initialize dependencies first
        const dependencies = this.dependencies.get(serviceName) || [];
        for (const dep of dependencies) {
            if (!initialized.has(dep)) {
                await this._initializeService(dep, initialized, failed, processing);
            }
        }

        // Initialize the service
        const service = this.services.get(serviceName);
        try {
            await service.initialize();
            initialized.add(serviceName);
        } catch (error) {
            failed.add(serviceName);
            throw error;
        }

        processing.delete(serviceName);
    }

    /**
     * Updates service state and broadcasts to WebSocket clients
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
     * Check if service should be allowed to operate
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
     * Marks a service as started
     */
    static async markServiceStarted(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: true,
            status: 'active',
            last_started: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Marks a service as stopped
     */
    static async markServiceStopped(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: false,
            status: 'stopped',
            last_stopped: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Updates service state with error
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
     * Updates service heartbeat
     */
    static async updateServiceHeartbeat(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: true,
            status: 'active',
            last_check: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Gets the current state of a service
     */
    static async getServiceState(serviceName) {
        try {
            const setting = await prisma.system_settings.findUnique({
                where: { key: serviceName }
            });
            
            // If no setting found, return null
            if (!setting) return null;

            // Handle both string and object value formats
            if (typeof setting.value === 'string') {
                try {
                    return JSON.parse(setting.value);
                } catch (e) {
                    logApi.error(`Invalid JSON in system_settings for ${serviceName}:`, {
                        value: setting.value,
                        error: e.message
                    });
                    return null;
                }
            }
            
            // If value is already an object, return it directly
            return setting.value;
        } catch (error) {
            logApi.error(`Failed to get service state for ${serviceName}:`, error);
            throw error;
        }
    }
}

// Register core services with dependencies
ServiceManager.register(tokenSyncService, []);
ServiceManager.register(marketDataService, []);
ServiceManager.register(vanityWalletService, []);
ServiceManager.register(contestEvaluationService.service, [SERVICE_NAMES.MARKET_DATA]);
ServiceManager.register(walletRakeService, [SERVICE_NAMES.CONTEST_EVALUATION]);
ServiceManager.register(referralService, [SERVICE_NAMES.CONTEST_EVALUATION]);
ServiceManager.register(contestWalletService, [SERVICE_NAMES.VANITY_WALLET]);
ServiceManager.register(adminWalletService, [SERVICE_NAMES.CONTEST_WALLET]);
ServiceManager.register(tokenWhitelistService, [SERVICE_NAMES.TOKEN_SYNC]);
ServiceManager.register(achievementService, [SERVICE_NAMES.CONTEST_EVALUATION]);

// Export service name constants for backward compatibility
export { SERVICE_NAMES, SERVICE_LAYERS };

export default ServiceManager; 