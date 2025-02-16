// utils/service-manager.js

import prisma from '../../config/prisma.js';
import { logApi } from '../logger-suite/logger.js';
import tokenSyncService from '../../services/tokenSyncService.js';
import vanityWalletService from '../../services/vanityWalletService.js';
import contestEvaluationService from '../../services/contestEvaluationService.js';
import walletRakeService from '../../services/walletRakeService.js';
import referralService from '../../services/referralService.js';
import contestWalletService from '../../services/contestWalletService.js';
import adminWalletService from '../../services/adminWalletService.js';
import { marketDataService } from '../../services/marketDataService.js';
import { tokenWhitelistService } from '../../services/tokenWhitelistService.js';
import { createCircuitBreakerWebSocket } from '../websocket-suite/circuit-breaker-ws.js';

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
     * Registers a service with its dependencies
     */
    static register(service, dependencies = []) {
        this.services.set(service.name, service);
        this.dependencies.set(service.name, dependencies);
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
     * Updates the system settings for a service
     * @param {string} serviceName - The name of the service (e.g., 'token_sync_service')
     * @param {object} state - The current state of the service
     * @param {object} config - Service configuration
     * @param {object} stats - Service statistics (optional)
     * @returns {Promise<void>}
     */
    static async updateServiceState(serviceName, state, config, stats = null) {
        try {
            const value = {
                running: state.running,
                status: state.status,
                last_started: state.last_started,
                last_stopped: state.last_stopped,
                last_check: state.last_check,
                last_error: state.last_error,
                last_error_time: state.last_error_time,
                config,
                ...(stats && { stats })
            };

            // Clean undefined values
            Object.keys(value).forEach(key => 
                value[key] === undefined && delete value[key]
            );

            await prisma.system_settings.upsert({
                where: { key: serviceName },
                update: {
                    value,
                    updated_at: new Date()
                },
                create: {
                    key: serviceName,
                    value,
                    description: `${serviceName} status and configuration`,
                    updated_at: new Date()
                }
            });

            // Broadcast state update via WebSocket if instance exists
            if (this.circuitBreakerWs) {
                this.circuitBreakerWs.notifyServiceUpdate(serviceName, value);
            }
        } catch (error) {
            logApi.error(`Failed to update service state for ${serviceName}:`, error);
            throw error;
        }
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
ServiceManager.register(vanityWalletService, []);
ServiceManager.register(contestEvaluationService.service, ['token_sync_service']);
ServiceManager.register(walletRakeService, ['contest_evaluation_service']);
ServiceManager.register(referralService, ['token_sync_service']);
ServiceManager.register(contestWalletService, ['vanity_wallet_service']);
ServiceManager.register(adminWalletService, ['contest_wallet_service']);
ServiceManager.register(marketDataService, ['token_sync_service']);
ServiceManager.register(tokenWhitelistService, ['token_sync_service']);

// Service name constants
export const SERVICE_NAMES = {
    TOKEN_SYNC: 'token_sync_service',
    VANITY_WALLET: 'vanity_wallet_service',
    CONTEST_EVALUATION: 'contest_evaluation_service',
    WALLET_RAKE: 'wallet_rake_service',
    REFERRAL: 'referral_service',
    CONTEST_WALLET: 'contest_wallet_service',
    ADMIN_WALLET: 'admin_wallet_service',
    DD_SERV: 'dd_serv_service',
    MARKET_DATA: 'market_data_service',
    TOKEN_WHITELIST: 'token_whitelist_service'
};

export default ServiceManager; 