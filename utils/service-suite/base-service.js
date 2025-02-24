import prisma from '../../config/prisma.js';
import { logApi } from '../logger-suite/logger.js';
import { 
    getCircuitBreakerConfig, 
    isHealthy, 
    shouldReset,
    calculateBackoffDelay,
    getCircuitBreakerStatus 
} from './circuit-breaker-config.js';
import { EventEmitter } from 'events';
import serviceManager from './service-manager.js';
import serviceEvents from './service-events.js';
import { ServiceError } from './service-error.js';

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
    constructor(config) {
        if (!config || !config.name) {
            logApi.error(config);
            throw new Error('Service configuration must include a name');
        }

        this.config = {
            ...BASE_SERVICE_CONFIG,
            ...config
        };

        this.isOperational = false;
        this.name = config.name;
        this.layer = config.layer;
        this.criticalLevel = config.criticalLevel;
        this.dependencies = config.dependencies || [];
        this.serviceManager = serviceManager;
        this.events = serviceEvents;

        this.isInitialized = false;
        this.isStarted = false;

        // Initialize base stats structure that should never be overwritten
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
            if (this.isInitialized) {
                logApi.info(`${this.name} already initialized`);
                return true;
            }

            const isEnabled = await this.checkEnabled();
            if (!isEnabled) {
                logApi.info(`${this.name} is disabled`);
                return false;
            }

            // Load previous state from system_settings
            const previousState = await prisma.system_settings.findUnique({
                where: { key: this.name }
            });

            if (previousState?.value) {
                // Merge stats carefully preserving base structure
                if (previousState.value.stats) {
                    this.stats = {
                        ...this.stats,
                        ...previousState.value.stats,
                        // Always preserve these core structures
                        history: {
                            ...this.stats.history,
                            ...previousState.value.stats.history
                        },
                        circuitBreaker: {
                            ...this.stats.circuitBreaker,
                            ...previousState.value.stats.circuitBreaker
                        }
                    };
                }

                // Restore any custom config that was saved
                if (previousState.value.config) {
                    this.config = {
                        ...this.config,
                        ...previousState.value.config,
                        // Preserve circuit breaker config
                        circuitBreaker: {
                            ...this.config.circuitBreaker,
                            ...(previousState.value.config.circuitBreaker || {})
                        }
                    };
                }
            }

            // Reset circuit breaker state for fresh initialization
            this.stats.circuitBreaker = {
                isOpen: false,
                failures: 0,
                lastFailure: null,
                lastReset: new Date().toISOString(),
                recoveryTimeout: null,
                recoveryAttempts: 0
            };

            // Mark initialization success
            this.stats.history.lastStarted = new Date().toISOString();
            this.isInitialized = true;

            // Emit service initialized event
            this.events.emit('service:initialized', {
                name: this.name,
                config: this.config,
                stats: this.stats
            });

            logApi.info(`${this.name} initialized successfully`);
            return true;
        } catch (error) {
            logApi.error(`${this.name} initialization error:`, error);
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
                
                if (nextAttemptDelay && !isNaN(nextAttemptDelay)) {
                    logApi.info(`${this.name} circuit breaker recovery scheduled in ${nextAttemptDelay}ms`);
                    
                    // Schedule next recovery attempt
                    if (this.recoveryTimeout) clearTimeout(this.recoveryTimeout);
                    this.recoveryTimeout = setTimeout(
                        () => this.attemptCircuitRecovery(),
                        nextAttemptDelay
                    );
                } else {
                    logApi.error(`${this.name} invalid circuit breaker recovery delay calculated`, {
                        recoveryAttempts: this.stats.circuitBreaker.recoveryAttempts,
                        config: this.config.circuitBreaker
                    });
                }
                
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

            // Emit circuit breaker state change
            this.events.emit('service:circuit_breaker', {
                name: this.name,
                status: getCircuitBreakerStatus(this.stats),
                config: this.config,
                stats: this.stats
            });

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
        try {
            if (!this.isInitialized) {
                throw new Error(`Cannot start ${this.name} - not initialized`);
            }

            if (this.isStarted) {
                logApi.info(`${this.name} already started`);
                return true;
            }

            // Clear any existing intervals
            if (this.operationInterval) {
                clearInterval(this.operationInterval);
            }

            // Start the operation interval
            this.operationInterval = setInterval(
                () => this.performOperation().catch(error => this.handleError(error)),
                this.config.checkIntervalMs
            );

            this.isStarted = true;

            // Emit service started event
            this.events.emit('service:started', {
                name: this.name,
                config: this.config,
                stats: this.stats
            });

            logApi.info(`Service ${this.name} started successfully`);
            return true;
        } catch (error) {
            logApi.error(`Failed to start service ${this.name}:`, error);
            throw error;
        }
    }

    /**
     * Stop the service
     */
    async stop() {
        try {
            // Clear the operation interval
            if (this.operationInterval) {
                clearInterval(this.operationInterval);
                this.operationInterval = null;
            }

            // Clear any recovery timeouts
            if (this.recoveryTimeout) {
                clearTimeout(this.recoveryTimeout);
                this.recoveryTimeout = null;
            }

            this.isStarted = false;
            this.stats.history.lastStopped = new Date().toISOString();

            // Emit service stopped event
            this.events.emit('service:stopped', {
                name: this.name,
                config: this.config,
                stats: this.stats
            });

            logApi.info(`Service ${this.name} stopped successfully`);
            return true;
        } catch (error) {
            logApi.error(`Failed to stop service ${this.name}:`, error);
            throw error;
        }
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

        this.events.emit('service:heartbeat', {
            name: this.name,
            config: this.config,
            stats: this.stats
        });
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

        this.events.emit('service:error', {
            name: this.name,
            error,
            config: this.config,
            stats: this.stats
        });
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