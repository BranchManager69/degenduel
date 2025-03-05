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
import { fancyColors, serviceColors, logColors } from '../colors.js';
const VERBOSE_SERVICE_INIT = false;

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
                logApi.warn(`${serviceColors.initializing}[SERVICE INIT]${fancyColors.RESET} ${this.name} already initialized`);
                return true;
            }

            const isEnabled = await this.checkEnabled();
            if (!isEnabled) {
                logApi.warn(`${serviceColors.initializing}[SERVICE INIT]${fancyColors.RESET} ${this.name} is disabled`);
                return false;
            }

            // Load previous state from system_settings
            const previousState = await prisma.system_settings.findUnique({
                where: { key: this.name }
            });

            if (previousState?.value) {
                try {
                    // Check if the previous state is a simplified version (from cleanup)
                    if (previousState.value.simplified === true) {
                        // Just load essential stats while preserving base structure
                        if (previousState.value.circuit_breaker) {
                            // Copy only essential circuit breaker state
                            this.stats.circuitBreaker.isOpen = previousState.value.circuit_breaker.isOpen || false;
                            this.stats.circuitBreaker.failures = previousState.value.circuit_breaker.failures || 0;
                            this.stats.circuitBreaker.lastFailure = previousState.value.circuit_breaker.lastFailure;
                            this.stats.circuitBreaker.lastReset = previousState.value.circuit_breaker.lastReset;
                            this.stats.circuitBreaker.recoveryAttempts = previousState.value.circuit_breaker.recoveryAttempts || 0;
                        }
                        
                        // Update history if available
                        if (previousState.value.last_started) {
                            this.stats.history.lastStarted = previousState.value.last_started;
                        }
                        if (previousState.value.last_stopped) {
                            this.stats.history.lastStopped = previousState.value.last_stopped;
                        }
                        if (previousState.value.last_error) {
                            this.stats.history.lastError = previousState.value.last_error;
                        }
                        if (previousState.value.last_error_time) {
                            this.stats.history.lastErrorTime = previousState.value.last_error_time;
                        }
                        
                        // Restore operations stats if available
                        if (previousState.value.operations) {
                            this.stats.operations.total = previousState.value.operations.total || 0;
                            this.stats.operations.successful = previousState.value.operations.successful || 0;
                            this.stats.operations.failed = previousState.value.operations.failed || 0;
                        }
                        
                        // Simple flat merge of configs
                        if (previousState.value.config) {
                            // Be selective about which config values to restore
                            const safeConfigKeys = [
                                'name', 'description', 'checkIntervalMs', 'maxRetries', 
                                'retryDelayMs', 'layer', 'criticalLevel'
                            ];
                            
                            for (const key of safeConfigKeys) {
                                if (previousState.value.config[key] !== undefined) {
                                    this.config[key] = previousState.value.config[key];
                                }
                            }
                            
                            // Carefully merge circuit breaker config if it exists
                            if (previousState.value.config.circuitBreaker) {
                                const cbConfig = previousState.value.config.circuitBreaker;
                                this.config.circuitBreaker = {
                                    ...this.config.circuitBreaker,
                                    enabled: cbConfig.enabled,
                                    failureThreshold: cbConfig.failureThreshold,
                                    resetTimeoutMs: cbConfig.resetTimeoutMs,
                                    healthCheckIntervalMs: cbConfig.healthCheckIntervalMs,
                                    description: cbConfig.description
                                };
                            }
                        }
                    } else {
                        // For legacy state (not simplified), carefully merge stats
                        if (previousState.value.stats) {
                            // Only copy specific fields to avoid deep nesting/duplication
                            if (previousState.value.stats.history) {
                                const history = previousState.value.stats.history;
                                this.stats.history.lastStarted = history.lastStarted;
                                this.stats.history.lastStopped = history.lastStopped;
                                this.stats.history.lastError = history.lastError;
                                this.stats.history.lastErrorTime = history.lastErrorTime;
                                this.stats.history.consecutiveFailures = history.consecutiveFailures || 0;
                            }
                            
                            // Circuit breaker state
                            if (previousState.value.stats.circuitBreaker) {
                                const cb = previousState.value.stats.circuitBreaker;
                                this.stats.circuitBreaker.isOpen = cb.isOpen || false;
                                this.stats.circuitBreaker.failures = cb.failures || 0; 
                                this.stats.circuitBreaker.lastFailure = cb.lastFailure;
                                this.stats.circuitBreaker.lastReset = cb.lastReset;
                                this.stats.circuitBreaker.recoveryAttempts = cb.recoveryAttempts || 0;
                            }
                            
                            // Operations stats
                            if (previousState.value.stats.operations) {
                                const ops = previousState.value.stats.operations;
                                this.stats.operations.total = ops.total || 0;
                                this.stats.operations.successful = ops.successful || 0;
                                this.stats.operations.failed = ops.failed || 0;
                            }
                            
                            // Performance stats
                            if (previousState.value.stats.performance) {
                                const perf = previousState.value.stats.performance;
                                this.stats.performance.lastOperationTimeMs = perf.lastOperationTimeMs || 0;
                                this.stats.performance.averageOperationTimeMs = perf.averageOperationTimeMs || 0;
                            }
                        }

                        // For config, only restore essential fields
                        if (previousState.value.config) {
                            // Be selective about which config values to restore
                            const safeConfigKeys = [
                                'name', 'description', 'checkIntervalMs', 'maxRetries', 
                                'retryDelayMs', 'layer', 'criticalLevel'
                            ];
                            
                            for (const key of safeConfigKeys) {
                                if (previousState.value.config[key] !== undefined) {
                                    this.config[key] = previousState.value.config[key];
                                }
                            }
                            
                            // Carefully merge circuit breaker config if it exists
                            if (previousState.value.config.circuitBreaker) {
                                const cbConfig = previousState.value.config.circuitBreaker;
                                this.config.circuitBreaker = {
                                    ...this.config.circuitBreaker,
                                    enabled: cbConfig.enabled,
                                    failureThreshold: cbConfig.failureThreshold,
                                    resetTimeoutMs: cbConfig.resetTimeoutMs,
                                    healthCheckIntervalMs: cbConfig.healthCheckIntervalMs,
                                    description: cbConfig.description
                                };
                            }
                        }
                    }
                } catch (error) {
                    // If there's any error, log it but continue with initialization
                    logApi.error(`Error restoring previous state for ${this.name}:`, error);
                    
                    // If the restore fails, don't retain any of the previous state
                    this.stats.history.lastError = "Failed to restore previous state: " + error.message;
                    this.stats.history.lastErrorTime = new Date().toISOString();
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
            logApi.info(`${fancyColors.BG_GREEN} CIRCUIT BREAKER RESET ${fancyColors.RESET} ${serviceColors.initializing}${this.name}${fancyColors.RESET}${fancyColors.DARK_YELLOW} initializing...${fancyColors.RESET}`);

            // Mark initialization success
            this.stats.history.lastStarted = new Date().toISOString();
            this.isInitialized = true;

            // Emit service initialized event with safe data
            this.events.emit('service:initialized', {
                name: this.name,
                config: this._getSafeConfig(),
                stats: this._getSafeStats()
            });

            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`${serviceColors.initialized}[SERVICE INIT]${fancyColors.RESET} Service ${this.name} initialized successfully`);
            }
            return true;
        } catch (error) {
            logApi.error(`${serviceColors.failed}[SERVICE INIT]${fancyColors.RESET} Failed to initialize service ${this.name}:`, error);
            throw error;
        }
    }

    /**
     * Attempt circuit breaker recovery
     */
    async attemptCircuitRecovery() {
        if (!this.stats.circuitBreaker.isOpen) return;

        try {
            // Check if we should attempt circuit breaker recovery
            if (!shouldReset(this.stats, this.config.circuitBreaker)) {
                const nextAttemptDelay = calculateBackoffDelay(
                    this.stats.circuitBreaker.recoveryAttempts,
                    this.config.circuitBreaker
                );
                
                // Ensure we have a valid delay value
                const validDelay = Math.max(1000, nextAttemptDelay || 5000);
                
                logApi.info(`${fancyColors.BG_RED}${fancyColors.BOLD} SERVICE CIRCUIT BREAKER ${fancyColors.RESET} ${serviceColors.failed}${this.name}${fancyColors.RESET}${fancyColors.BLACK} will try a reset in ${fancyColors.BOLD}${validDelay/1000} seconds${fancyColors.RESET}`);
                
                // Schedule next recovery attempt
                if (this.recoveryTimeout) clearTimeout(this.recoveryTimeout);
                this.recoveryTimeout = setTimeout(
                    () => this.attemptCircuitRecovery(),
                    validDelay
                );
                return;
            }

            // Perform health check
            logApi.info(`${fancyColors.BG_RED}${fancyColors.BOLD} SERVICE CIRCUIT BREAKER ${fancyColors.RESET} ${serviceColors.initializing}${this.name}${fancyColors.RESET}${fancyColors.DARK_YELLOW} attempting reset...${fancyColors.RESET}`);
            
            // Temporarily disable circuit breaker for health check
            const tempOpen = this.stats.circuitBreaker.isOpen;
            this.stats.circuitBreaker.isOpen = false;
            
            // Perform health check operation
            await this.performOperation();
            
            // Update recovery stats
            this.stats.circuitBreaker.failures = Math.max(0, this.stats.circuitBreaker.failures - 1);
            this.stats.circuitBreaker.lastRecoveryAttempt = new Date().toISOString();
            this.stats.circuitBreaker.recoveryAttempts++;

            // Check if recovery was successful
            if (this.stats.circuitBreaker.failures < this.config.circuitBreaker.failureThreshold) {
                this.stats.circuitBreaker.isOpen = false;
                this.stats.circuitBreaker.lastReset = new Date().toISOString();
                logApi.info(`${fancyColors.BG_RED}${fancyColors.BOLD} SERVICE CIRCUIT BREAKER ${fancyColors.RESET} ${serviceColors.initialized}${this.name}${fancyColors.RESET}${fancyColors.DARK_YELLOW} circuit breaker reset ${fancyColors.GREEN}successful${fancyColors.RESET}${fancyColors.DARK_YELLOW}!${fancyColors.RESET}`, {
                    newFailureCount: this.stats.circuitBreaker.failures
                });
            } else {
                // Restore previous state if recovery failed
                this.stats.circuitBreaker.isOpen = tempOpen;
                logApi.warn(`${fancyColors.BG_RED}${fancyColors.BOLD} SERVICE CIRCUIT BREAKER ${fancyColors.RESET} ${serviceColors.failed}${this.name}${fancyColors.RESET}${fancyColors.DARK_YELLOW} circuit breaker recovery ${fancyColors.RED}failed${fancyColors.RESET}${fancyColors.DARK_YELLOW}. Maintaining open state${fancyColors.RESET}`, {
                    failures: this.stats.circuitBreaker.failures,
                    threshold: this.config.circuitBreaker.failureThreshold
                });
            }

            // Emit circuit breaker state change with safe data
            this.events.emit('service:circuitBreaker', {
                name: this.name,
                isOpen: this.stats.circuitBreaker.isOpen,
                config: this._getSafeConfig(),
                stats: this._getSafeStats()
            });
        } catch (error) {
            // Log error and increment failures
            logApi.error(`${fancyColors.BG_RED}${fancyColors.BOLD} SERVICE CIRCUIT BREAKER ${fancyColors.RESET} ${serviceColors.failed}${this.name} circuit breaker recovery error:${fancyColors.RESET}`, error);
            
            // If we get an error during recovery, increment failures
            this.stats.circuitBreaker.failures++;
            this.stats.circuitBreaker.isOpen = true;
            
            // Schedule next recovery attempt with backoff
            const nextAttemptDelay = calculateBackoffDelay(
                this.stats.circuitBreaker.recoveryAttempts,
                this.config.circuitBreaker
            );
            
            // Schedule next recovery attempt with backoff
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
                logApi.info(`${serviceColors.running}[SERVICE START]${fancyColors.RESET} ${this.name} already started`);
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

            // Emit service started event with safe data
            this.events.emit('service:started', {
                name: this.name,
                config: this._getSafeConfig(),
                stats: this._getSafeStats()
            });

            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`${serviceColors.running}[SERVICE START]${fancyColors.RESET} Service ${this.name} started successfully`);
            }
            return true;
        } catch (error) {
            logApi.error(`${serviceColors.failed}[SERVICE START]${fancyColors.RESET} Failed to start service ${this.name}:`, error);
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

            // Clear the recovery timeout
            if (this.recoveryTimeout) {
                clearTimeout(this.recoveryTimeout);
                this.recoveryTimeout = null;
            }

            this.isStarted = false;

            // Emit service stopped event with safe data
            this.events.emit('service:stopped', {
                name: this.name,
                config: this._getSafeConfig(),
                stats: this._getSafeStats()
            });

            if (VERBOSE_SERVICE_INIT) {
                logApi.info(`${serviceColors.stopped}[SERVICE STOP]${fancyColors.RESET} Service ${this.name} stopped successfully`);
            }
            return true;
        } catch (error) {
            logApi.error(`${serviceColors.failed}[SERVICE STOP]${fancyColors.RESET} Failed to stop service ${this.name}:`, error);
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
            config: this._getSafeConfig(),
            stats: this._getSafeStats()
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
            logApi.warn(`${fancyColors.BG_RED}${fancyColors.BOLD} SERVICE CIRCUIT BREAKER ${fancyColors.RESET} ${serviceColors.failed}${this.name}${fancyColors.RESET} \n\t\t${fancyColors.LIGHT_GRAY}${fancyColors.ITALIC}${this.config.description}.${fancyColors.RESET} \t${fancyColors.DARK_RED}${fancyColors.BOLD}${this.stats.circuitBreaker.failures}${fancyColors.RESET}${fancyColors.DARK_RED} consecutive failures${fancyColors.RESET}`);
            this.stats.circuitBreaker.isOpen = true;
            // Schedule recovery attempt
            await this.attemptCircuitRecovery();
        }

        // Emit error event with safe data
        this.events.emit('service:error', {
            name: this.name,
            error,
            config: this._getSafeConfig(),
            stats: this._getSafeStats()
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
     * Create a safe version of config for storage or events
     * Prevents circular references and limits size
     * @private
     */
    _getSafeConfig() {
        try {
            // If no config available, return empty object
            if (!this.config) return { name: this.name };
            
            // Create a safe copy with only essential configuration
            const safeConfig = {
                name: this.config.name || this.name,
                description: this.config.description,
                layer: this.config.layer,
                criticalLevel: this.config.criticalLevel,
                dependencies: Array.isArray(this.config.dependencies) ? [...this.config.dependencies] : [],
                // Keep basic service settings
                checkIntervalMs: this.config.checkIntervalMs,
                maxRetries: this.config.maxRetries,
                retryDelayMs: this.config.retryDelayMs
            };
            
            // Include circuit breaker config if present (without stats)
            if (this.config.circuitBreaker) {
                safeConfig.circuitBreaker = { 
                    enabled: this.config.circuitBreaker.enabled,
                    failureThreshold: this.config.circuitBreaker.failureThreshold,
                    resetTimeoutMs: this.config.circuitBreaker.resetTimeoutMs,
                    healthCheckIntervalMs: this.config.circuitBreaker.healthCheckIntervalMs,
                    description: this.config.circuitBreaker.description
                };
                // Remove any stats or functions from circuit breaker config
                delete safeConfig.circuitBreaker.stats;
                delete safeConfig.circuitBreaker.service;
                delete safeConfig.circuitBreaker.history;
            }
            
            // Include backoff settings if present
            if (this.config.backoff) {
                safeConfig.backoff = { ...this.config.backoff };
            }
            
            return safeConfig;
        } catch (error) {
            logApi.warn(`Error creating safe config: ${error.message}`);
            return { name: this.name };
        }
    }
    
    /**
     * Create a safe version of stats for storage or events
     * Prevents circular references and limits size
     * @private
     */
    _getSafeStats() {
        try {
            // If no stats available, return empty object
            if (!this.stats) return {};
            
            // Create a safe copy with only essential metrics
            const safeStats = {};
            
            // Include circuit breaker state if available
            if (this.stats.circuitBreaker) {
                safeStats.circuitBreaker = {
                    isOpen: this.stats.circuitBreaker.isOpen || false,
                    failures: this.stats.circuitBreaker.failures || 0,
                    lastFailure: this.stats.circuitBreaker.lastFailure,
                    lastReset: this.stats.circuitBreaker.lastReset,
                    recoveryAttempts: this.stats.circuitBreaker.recoveryAttempts || 0
                };
            }
            
            // Include operation counts
            if (this.stats.operations) {
                safeStats.operations = {
                    total: this.stats.operations.total || 0,
                    successful: this.stats.operations.successful || 0,
                    failed: this.stats.operations.failed || 0
                };
            }
            
            // Include basic performance metrics
            if (this.stats.performance) {
                safeStats.performance = {
                    lastOperationTimeMs: this.stats.performance.lastOperationTimeMs,
                    averageOperationTimeMs: this.stats.performance.averageOperationTimeMs,
                };
            }
            
            // Include history summary without full details
            if (this.stats.history) {
                safeStats.history = {
                    lastError: this.stats.history.lastError,
                    lastStarted: this.stats.history.lastStarted,
                    lastStopped: this.stats.history.lastStopped,
                    lastErrorTime: this.stats.history.lastErrorTime,
                    consecutiveFailures: this.stats.history.consecutiveFailures || 0
                };
            }
            
            return safeStats;
        } catch (error) {
            logApi.warn(`Error creating safe stats: ${error.message}`);
            return {};
        }
    }

    /**
     * Perform the service's main operation
     */
    async performOperation() {
        try {
            // Check if circuit breaker is open
            if (this.stats.circuitBreaker.isOpen) {
                if (VERBOSE_SERVICE_INIT) {
                    logApi.warn(`${fancyColors.BG_RED}${fancyColors.BOLD} SERVICE CIRCUIT BREAKER ${fancyColors.RESET} ${this.name} circuit breaker is open, skipping operation`);
                }
                return;
            }

            // Perform the operation
            await this.onPerformOperation();
            await this.recordSuccess();
        } catch (error) {
            await this.handleError(error);
            throw error;
        }
    }
} 