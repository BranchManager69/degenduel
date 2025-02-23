import prisma from '../../config/prisma.js';
import { logApi } from '../logger-suite/logger.js';
import ServiceManager from './service-manager.js';
import { 
    getCircuitBreakerConfig, 
    isHealthy, 
    shouldReset,
    calculateBackoffDelay,
    getCircuitBreakerStatus 
} from './circuit-breaker-config.js';

/**
 * Base configuration template for all services
 */
export const BASE_SERVICE_CONFIG = {
    checkIntervalMs: 5000,
    maxRetries: 3,
    retryDelayMs: 5000,
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
            ...config,
            circuitBreaker: getCircuitBreakerConfig(name)
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
                isOpen: false,
                recoveryAttempts: 0,
                lastRecoveryAttempt: null
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
        this.recoveryTimeout = null;
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

            // Load previous state from system_settings
            const previousState = await ServiceManager.getServiceState(this.name);
            if (previousState) {
                if (previousState.stats) {
                    this.stats = {
                        ...this.stats,
                        ...previousState.stats,
                        circuitBreaker: {
                            ...this.stats.circuitBreaker,
                            ...previousState.stats.circuitBreaker
                        }
                    };

                    // Time-Based Circuit Breaker Recovery
                    if (this.stats.circuitBreaker.isOpen) {
                        await this.attemptCircuitRecovery();
                    }

                    // Cascading Service Recovery
                    if (this.stats.circuitBreaker.isOpen) {
                        const dependencies = ServiceManager.dependencies.get(this.name) || [];
                        for (const dep of dependencies) {
                            const depState = await ServiceManager.getServiceState(dep);
                            if (depState?.stats?.circuitBreaker?.isOpen) {
                                logApi.warn(`${this.name} initialization blocked: dependency ${dep} circuit breaker is open`, {
                                    dependency: dep,
                                    dependencyFailures: depState.stats.circuitBreaker.failures,
                                    dependencyLastFailure: depState.stats.circuitBreaker.lastFailure
                                });
                                return false;
                            }
                        }
                    }
                }

                // Restore any custom config that was saved
                if (previousState.config) {
                    this.config = {
                        ...this.config,
                        ...previousState.config
                    };
                }
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
     * Attempt circuit breaker recovery
     */
    async attemptCircuitRecovery() {
        if (!this.stats.circuitBreaker.isOpen) return;

        try {
            // Check if we should attempt recovery
            if (!shouldReset(this.stats, this.config.circuitBreaker)) {
                const nextAttemptDelay = calculateBackoffDelay(
                    this.stats.circuitBreaker.recoveryAttempts,
                    this.config.circuitBreaker
                );
                
                logApi.info(`${this.name} circuit breaker recovery scheduled in ${nextAttemptDelay}ms`);
                
                // Schedule next recovery attempt
                if (this.recoveryTimeout) clearTimeout(this.recoveryTimeout);
                this.recoveryTimeout = setTimeout(
                    () => this.attemptCircuitRecovery(),
                    nextAttemptDelay
                );
                
                return;
            }

            // Perform health check
            logApi.info(`${this.name} attempting circuit breaker recovery`);
            
            // Temporarily disable circuit breaker for health check
            const tempOpen = this.stats.circuitBreaker.isOpen;
            this.stats.circuitBreaker.isOpen = false;
            
            await this.performOperation();
            
            // Update recovery stats
            this.stats.circuitBreaker.failures = Math.max(0, this.stats.circuitBreaker.failures - 1);
            this.stats.circuitBreaker.lastRecoveryAttempt = new Date().toISOString();
            this.stats.circuitBreaker.recoveryAttempts++;

            if (this.stats.circuitBreaker.failures < this.config.circuitBreaker.failureThreshold) {
                this.stats.circuitBreaker.isOpen = false;
                this.stats.circuitBreaker.lastReset = new Date().toISOString();
                logApi.info(`${this.name} circuit breaker reset successful`, {
                    newFailureCount: this.stats.circuitBreaker.failures
                });
            } else {
                this.stats.circuitBreaker.isOpen = tempOpen;
                logApi.warn(`${this.name} circuit breaker recovery failed - maintaining open state`, {
                    failures: this.stats.circuitBreaker.failures,
                    threshold: this.config.circuitBreaker.failureThreshold
                });
            }

            // Update service state
            await ServiceManager.updateServiceState(
                this.name,
                { status: getCircuitBreakerStatus(this.stats) },
                this.config,
                this.stats
            );

        } catch (error) {
            logApi.error(`${this.name} circuit breaker recovery failed:`, error);
            this.stats.circuitBreaker.failures++;
            this.stats.circuitBreaker.lastFailure = new Date().toISOString();
            this.stats.circuitBreaker.recoveryAttempts++;
            
            // Schedule next recovery attempt
            const nextAttemptDelay = calculateBackoffDelay(
                this.stats.circuitBreaker.recoveryAttempts,
                this.config.circuitBreaker
            );
            
            if (this.recoveryTimeout) clearTimeout(this.recoveryTimeout);
            this.recoveryTimeout = setTimeout(
                () => this.attemptCircuitRecovery(),
                nextAttemptDelay
            );
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
                // Check both service enabled state and circuit breaker status
                const [isEnabled, isHealthy] = await Promise.all([
                    this.checkEnabled(),
                    ServiceManager.checkServiceHealth(this.name)
                ]);

                if (!isEnabled || !isHealthy) {
                    return;
                }

                await this.performOperation();
                await this.recordSuccess();
            } catch (error) {
                await this.handleError(error);
            }
        }, this.config.checkIntervalMs);

        this.stats.history.lastStarted = new Date().toISOString();
        await ServiceManager.markServiceStarted(this.name, this.config, this.stats);
    }

    /**
     * Stop the service
     */
    async stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        if (this.recoveryTimeout) {
            clearTimeout(this.recoveryTimeout);
            this.recoveryTimeout = null;
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

        // Check if we should open the circuit
        if (this.stats.circuitBreaker.failures >= this.config.circuitBreaker.failureThreshold) {
            this.stats.circuitBreaker.isOpen = true;
            // Schedule recovery attempt
            await this.attemptCircuitRecovery();
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
            this.config.backoff.initialDelayMs * Math.pow(
                this.config.backoff.factor,
                this.stats.history.consecutiveFailures
            ),
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