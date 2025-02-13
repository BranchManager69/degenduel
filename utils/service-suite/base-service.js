import prisma from '../../config/prisma.js';
import { logApi } from '../logger-suite/logger.js';
import ServiceManager, { SERVICE_NAMES } from '../service-suite/service-manager.js';

/**
 * Base configuration template for all services
 */
export const BASE_SERVICE_CONFIG = {
    checkIntervalMs: 5000,
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        minHealthyPeriodMs: 60000
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    }
};

/**
 * Base service class that all DegenDuel services should extend
 */
export class BaseService {
    constructor(name, config = {}) {
        this.name = name;
        this.config = {
            ...BASE_SERVICE_CONFIG,
            ...config
        };
        this.stats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            performance: {
                averageOperationTimeMs: 0,
                lastOperationTimeMs: 0
            },
            circuitBreaker: {
                failures: 0,
                lastFailure: null,
                lastSuccess: null,
                lastReset: null,
                isOpen: false
            },
            history: {
                lastStarted: null,
                lastStopped: null,
                lastError: null,
                lastErrorTime: null,
                consecutiveFailures: 0
            }
        };
        this.interval = null;
    }

    /**
     * Initialize the service
     */
    async initialize() {
        try {
            const isEnabled = await this.checkEnabled();
            if (!isEnabled) {
                logApi.info(`${this.name} is disabled`);
                return false;
            }

            await ServiceManager.markServiceStarted(
                this.name,
                this.config,
                this.stats
            );

            this.stats.history.lastStarted = new Date().toISOString();
            return true;
        } catch (error) {
            logApi.error(`Failed to initialize ${this.name}:`, error);
            throw error;
        }
    }

    /**
     * Start the service's main operation interval
     */
    async start() {
        if (this.interval) {
            clearInterval(this.interval);
        }

        this.interval = setInterval(async () => {
            try {
                const isEnabled = await this.checkEnabled();
                if (!isEnabled || this.stats.circuitBreaker.isOpen) {
                    return;
                }

                await this.performOperation();
                await this.recordSuccess();
            } catch (error) {
                await this.handleError(error);
            }
        }, this.config.checkIntervalMs);
    }

    /**
     * Stop the service
     */
    async stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        this.stats.history.lastStopped = new Date().toISOString();
        await ServiceManager.markServiceStopped(
            this.name,
            this.config,
            this.stats
        );
    }

    /**
     * Check if service is enabled
     */
    async checkEnabled() {
        try {
            const setting = await prisma.system_settings.findUnique({
                where: { key: this.name }
            });
            return setting?.value?.enabled ?? true;
        } catch (error) {
            logApi.error(`Error checking ${this.name} state:`, error);
            return false;
        }
    }

    /**
     * Handle operation success
     */
    async recordSuccess() {
        this.stats.operations.total++;
        this.stats.operations.successful++;
        this.stats.circuitBreaker.lastSuccess = new Date().toISOString();
        this.stats.circuitBreaker.failures = 0;
        this.stats.history.consecutiveFailures = 0;

        if (this.stats.circuitBreaker.isOpen) {
            const timeSinceLastFailure = Date.now() - new Date(this.stats.circuitBreaker.lastFailure).getTime();
            if (timeSinceLastFailure >= this.config.circuitBreaker.minHealthyPeriodMs) {
                this.stats.circuitBreaker.isOpen = false;
                this.stats.circuitBreaker.lastReset = new Date().toISOString();
                logApi.info(`Circuit breaker reset for ${this.name}`);
            }
        }

        await ServiceManager.updateServiceHeartbeat(
            this.name,
            this.config,
            this.stats
        );
    }

    /**
     * Handle operation error
     */
    async handleError(error) {
        this.stats.operations.total++;
        this.stats.operations.failed++;
        this.stats.history.consecutiveFailures++;
        this.stats.history.lastError = error.message;
        this.stats.history.lastErrorTime = new Date().toISOString();
        this.stats.circuitBreaker.failures++;
        this.stats.circuitBreaker.lastFailure = new Date().toISOString();

        if (this.stats.circuitBreaker.failures >= this.config.circuitBreaker.failureThreshold) {
            if (!this.stats.circuitBreaker.isOpen) {
                this.stats.circuitBreaker.isOpen = true;
                logApi.warn(`Circuit breaker opened for ${this.name}`, {
                    failures: this.stats.circuitBreaker.failures,
                    threshold: this.config.circuitBreaker.failureThreshold,
                    service: this.name
                });
            }
        }

        // If error indicates service is disabled, stop the service
        if (error.message === 'Service is disabled via dashboard') {
            await this.stop();
        }

        await ServiceManager.markServiceError(
            this.name,
            error,
            this.config,
            this.stats
        );
    }

    /**
     * Calculate backoff delay based on consecutive failures
     */
    getBackoffDelay() {
        return Math.min(
            this.config.backoff.initialDelayMs * Math.pow(this.config.backoff.factor, this.stats.history.consecutiveFailures),
            this.config.backoff.maxDelayMs
        );
    }

    /**
     * Main operation method - must be implemented by child classes
     */
    async performOperation() {
        throw new Error('performOperation must be implemented by child class');
    }
} 