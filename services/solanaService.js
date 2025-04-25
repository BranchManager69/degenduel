// services/solanaService.js

/*
 * This service manages the Solana blockchain connection and provides a standardized interface for other services to access Solana.
 * It also handles the connection health monitoring and automatic reconnection.
 * 
 * It implements a centralized request queue with global rate limiting to prevent 429 errors
 * across multiple services that make Solana RPC calls.
 */

import { Connection } from '@solana/web3.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { BaseService } from '../utils/service-suite/base-service.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { fancyColors } from '../utils/colors.js';

// Config
import { config, validateSolanaConfig } from '../config/config.js';

// Configure the Solana service itself
const SOLANA_SERVICE_CONFIG = {
    name: SERVICE_NAMES.SOLANA,
    description: getServiceMetadata(SERVICE_NAMES.SOLANA).description,
    layer: getServiceMetadata(SERVICE_NAMES.SOLANA).layer,
    criticalLevel: getServiceMetadata(SERVICE_NAMES.SOLANA).criticalLevel,
    checkIntervalMs: 30 * 1000, // 30 seconds (matches intended monitoring interval)
    maxRetries: 3, // 3 retries
    retryDelayMs: 5 * 1000, // 5 seconds
    circuitBreaker: {
        failureThreshold: 3, // 3 failures
        resetTimeoutMs: 60 * 1000, // 60 seconds
        minHealthyPeriodMs: 2 * 60 * 1000 // 2 minutes
    },
    dependencies: [],
    rpcLimiter: {
        maxConcurrentRequests: 5,         // Max parallel requests
        minBackoffMs: 1000,               // Min backoff on rate limit (1 second)
        maxBackoffMs: 15000,              // Max backoff on rate limit (15 seconds)
        baseDelayMs: 250,                 // Base delay for exponential backoff
        minOperationSpacingMs: 100,       // Min gap between operations
    }
};

/**
 * Service that maintains and monitors Solana blockchain connection
 * Provides a standardized interface for other services to access Solana
 */
class SolanaService extends BaseService {
    constructor() {
        super(SOLANA_SERVICE_CONFIG);
        this.connection = null;
        
        // Initialize centralized RPC request queue and rate limiting
        this.rpcStats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            rateLimitHits: 0,
            retries: 0,
            currentBackoffMs: 0,
            lastRateLimitTime: 0,
            activeRequests: 0,
            maxConcurrentRequests: SOLANA_SERVICE_CONFIG.rpcLimiter.maxConcurrentRequests,
            requestsByMethod: {},
            lastOperationTime: 0
        };
        
        // Request queue for centralized RPC calls
        this.requestQueue = [];
        this.processingQueue = false;
    }

    /**
     * Initialize the Solana connection
     */
    async initialize() {
        try {
            // Check if solana service is disabled via service profile
            if (!config.services.solana_service) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Solana Service is disabled in the '${config.services.active_profile}' service profile`);
                return false;
            }
            
            // Call parent initialization first
            const success = await super.initialize();
            if (!success) {
                return false;
            }
            
            // Check if connection is already initialized
            if (this.connection) {
                logApi.info('Solana connection already initialized');
                return true;
            }
            
            // Validate Solana configuration
            validateSolanaConfig();
            
            // Create Solana connection with web3.js v2 compatible configuration
            // Add custom rate limiting and retry logic to prevent rate limit errors
            this.connection = new Connection(
                config.rpc_urls.mainnet_http,
                {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: config.solana_timeouts.rpc_initial_connection_timeout * 1000,
                    wsEndpoint: config.rpc_urls.mainnet_wss,
                    maxSupportedTransactionVersion: 0, // Support versioned transactions
                    // Rate limit mitigation
                    httpHeaders: {
                        'X-DegenDuel-Request-Priority': 'normal'
                    }
                }
            );
            
            // Initialize RPC limiter
            this.setupRateLimitHandling();
            
            // Test connection with initial request
            const versionInfo = await this.executeRpcRequest(() => this.connection.getVersion(), 'getVersion');
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}\t\t✅ ${fancyColors.BG_LIGHT_GREEN} Solana connection established successfully ${fancyColors.RESET}`, {
                version: versionInfo?.solana || 'unknown',
                feature_set: versionInfo?.feature_set || 0
            });
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED}Failed to initialize Solana service: ${error.message} ${fancyColors.RESET}`);
            throw new ServiceError('solana_init_failed', `Failed to initialize Solana service: ${error.message}`);
        }
    }
    
    /**
     * Setup rate limit handling
     */
    setupRateLimitHandling() {
        // Initialize RPC limiter settings
        this.rpcLimiter = {
            maxConcurrentRequests: SOLANA_SERVICE_CONFIG.rpcLimiter.maxConcurrentRequests,
            minBackoffMs: SOLANA_SERVICE_CONFIG.rpcLimiter.minBackoffMs,
            maxBackoffMs: SOLANA_SERVICE_CONFIG.rpcLimiter.maxBackoffMs,
            baseDelayMs: SOLANA_SERVICE_CONFIG.rpcLimiter.baseDelayMs,
            minOperationSpacingMs: SOLANA_SERVICE_CONFIG.rpcLimiter.minOperationSpacingMs,
            currentBackoffMs: 0,
            consecutiveHits: 0,
            lastHitTime: 0
        };
        
        logApi.info('Solana RPC rate limiter initialized', {
            maxConcurrentRequests: this.rpcLimiter.maxConcurrentRequests,
            minBackoffMs: this.rpcLimiter.minBackoffMs,
            maxBackoffMs: this.rpcLimiter.maxBackoffMs
        });
    }
    
    /**
     * Add a request to the centralized RPC queue
     * @param {Function} rpcCall - Function that performs the RPC call
     * @param {string} methodName - Name of the method being called
     * @param {Object} options - Additional options
     * @returns {Promise<any>} - Result of the RPC call
     */
    async executeRpcRequest(rpcCall, methodName = 'unknown', options = {}) {
        return new Promise((resolve, reject) => {
            // Track method-specific stats
            if (!this.rpcStats.requestsByMethod[methodName]) {
                this.rpcStats.requestsByMethod[methodName] = {
                    total: 0,
                    successful: 0,
                    failed: 0,
                    rateLimitHits: 0
                };
            }
            
            // Add request to queue
            this.requestQueue.push({
                rpcCall,
                methodName,
                options,
                resolve,
                reject,
                queuedAt: Date.now()
            });
            
            // Start processing queue if not already processing
            this.processNextRequest();
        });
    }
    
    /**
     * Process the next request in the queue
     */
    async processNextRequest() {
        // Prevent concurrent queue processing
        if (this.processingQueue) return;
        this.processingQueue = true;
        
        try {
            // Process requests while queue has items and we're below max concurrent requests
            while (this.requestQueue.length > 0 && this.rpcStats.activeRequests < this.rpcLimiter.maxConcurrentRequests) {
                // Get the next request
                const request = this.requestQueue.shift();
                
                // Execute the request
                this.rpcStats.activeRequests++;
                this.rpcStats.totalRequests++;
                this.rpcStats.requestsByMethod[request.methodName].total++;
                
                // Apply minimum operation spacing if needed
                const now = Date.now();
                const timeSinceLastOp = now - this.rpcStats.lastOperationTime;
                if (timeSinceLastOp < this.rpcLimiter.minOperationSpacingMs) {
                    const waitTime = this.rpcLimiter.minOperationSpacingMs - timeSinceLastOp;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
                
                // Apply backoff if we've hit rate limits recently
                if (this.rpcLimiter.currentBackoffMs > 0) {
                    logApi.debug(`⏱️ Applying rate limit backoff of ${this.rpcLimiter.currentBackoffMs}ms for ${request.methodName}`, {
                        service: 'SOLANA',
                        operation: request.methodName,
                        backoff_ms: this.rpcLimiter.currentBackoffMs,
                        consecutive_hits: this.rpcLimiter.consecutiveHits
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, this.rpcLimiter.currentBackoffMs));
                }
                
                // Update operation timestamp
                this.rpcStats.lastOperationTime = Date.now();
                
                // Execute the RPC call and handle response
                this.executeRpcCall(request.rpcCall, request.methodName, request.resolve, request.reject);
            }
        } catch (error) {
            logApi.error('Error processing Solana RPC request queue:', error);
        } finally {
            this.processingQueue = false;
            
            // Check if there are more requests to process
            if (this.requestQueue.length > 0 && this.rpcStats.activeRequests < this.rpcLimiter.maxConcurrentRequests) {
                setTimeout(() => this.processNextRequest(), 0);
            }
        }
    }
    
    /**
     * Execute an RPC call with rate limiting
     * @param {Function} rpcCall - Function that performs the RPC call
     * @param {string} methodName - Name of the method being called
     * @param {Function} resolve - Promise resolve function
     * @param {Function} reject - Promise reject function
     */
    async executeRpcCall(rpcCall, methodName, resolve, reject) {
        try {
            // Execute the RPC call
            const result = await rpcCall();
            
            // Handle successful call
            this.rpcStats.successfulRequests++;
            this.rpcStats.requestsByMethod[methodName].successful++;
            
            // Decrease backoff on success (but don't go to zero immediately)
            if (this.rpcLimiter.currentBackoffMs > 0) {
                this.rpcLimiter.currentBackoffMs = Math.max(0, Math.floor(this.rpcLimiter.currentBackoffMs / 2));
                this.rpcLimiter.consecutiveHits = Math.max(0, this.rpcLimiter.consecutiveHits - 1);
            }
            
            resolve(result);
        } catch (error) {
            // Check if this is a rate limit error
            const isRateLimit = this.isRateLimitError(error);
            
            if (isRateLimit) {
                // Update rate limit stats
                this.rpcStats.rateLimitHits++;
                this.rpcStats.requestsByMethod[methodName].rateLimitHits++;
                this.rpcLimiter.consecutiveHits++;
                this.rpcLimiter.lastHitTime = Date.now();
                
                // Calculate exponential backoff with jitter
                const baseDelay = Math.min(
                    this.rpcLimiter.maxBackoffMs,
                    Math.max(
                        this.rpcLimiter.minBackoffMs,
                        Math.pow(2, this.rpcLimiter.consecutiveHits) * this.rpcLimiter.baseDelayMs
                    )
                );
                
                // Add jitter (±20% randomness)
                this.rpcLimiter.currentBackoffMs = Math.floor(baseDelay * (0.8 + Math.random() * 0.4));
                
                // Log rate limit with consistent format
                logApi.warn(`${fancyColors.RED}[solana-rpc]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} RATE LIMIT ${fancyColors.RESET} ${fancyColors.BOLD_RED}${methodName}${fancyColors.RESET} ${fancyColors.RED}Hit #${this.rpcLimiter.consecutiveHits}${fancyColors.RESET} ${fancyColors.LIGHT_RED}Retry in ${this.rpcLimiter.currentBackoffMs}ms${fancyColors.RESET} ${fancyColors.DARK_RED}(via SolanaService)${fancyColors.RESET}`, {
                    error_type: 'RATE_LIMIT',
                    operation: methodName,
                    hit_count: this.rpcLimiter.consecutiveHits.toString(),
                    retry_ms: this.rpcLimiter.currentBackoffMs,
                    rpc_provider: this.connection.rpcEndpoint,
                    original_message: error.message,
                    source_service: 'SolanaService',
                    severity: 'warning',
                    alert_type: 'rate_limit'
                });
                
                // Add retry to queue
                this.rpcStats.retries++;
                this.requestQueue.unshift({
                    rpcCall,
                    methodName,
                    resolve,
                    reject,
                    queuedAt: Date.now(),
                    retryCount: 1
                });
            } else {
                // Not a rate limit, update failure stats
                this.rpcStats.failedRequests++;
                this.rpcStats.requestsByMethod[methodName].failed++;
                
                // Reject with the original error
                reject(error);
            }
        } finally {
            // Decrease active requests count
            this.rpcStats.activeRequests--;
            
            // Continue processing queue
            setTimeout(() => this.processNextRequest(), 0);
        }
    }
    
    /**
     * Check if an error is a rate limit error
     * @param {Error} error - The error to check
     * @returns {boolean} - True if this is a rate limit error
     */
    isRateLimitError(error) {
        return error.message && (
            error.message.includes('429') ||
            error.message.includes('rate') ||
            error.message.includes('limit') ||
            error.message.includes('requests per second') ||
            error.message.includes('too many requests')
        );
    }
    
    /**
     * Implements the onPerformOperation method required by BaseService
     * This gets called regularly by the BaseService to perform the service's main operation
     * and is used for circuit breaker recovery
     * @returns {Promise<boolean>} Success status
     */
    async onPerformOperation() {
        try {
            // Skip operation if service is not properly initialized or started
            if (!this.isOperational) {
                logApi.debug(`${fancyColors.CYAN}[solanaService]${fancyColors.RESET} Service not operational, skipping operation`);
                return true;
            }
            
            // Call the original performOperation implementation
            await this.performOperation();
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.CYAN}[solanaService]${fancyColors.RESET} ${fancyColors.RED}Perform operation error:${fancyColors.RESET} ${error.message}`);
            throw error; // Important: re-throw to trigger circuit breaker
        }
    }

    /**
     * Regular operation - check connection health
     */
    async performOperation() {
        try {
            // Test Solana connection with v2.x compatible approach
            // Try to get slot first as a basic health check
            const slot = await this.executeRpcRequest(() => this.connection.getSlot(), 'getSlot');
            
            // Try to get version info if available
            let versionInfo = { solana: 'Unknown', feature_set: 0 };
            try {
                const result = await this.executeRpcRequest(() => this.connection.getVersion(), 'getVersion');
                versionInfo = result;
            } catch (versionError) {
                logApi.warn(`Failed to get version info, but connection is working: ${versionError.message}`);
            }
            
            // Record successful operation
            await this.recordSuccess();
            
            return {
                status: 'healthy',
                slot,
                version: versionInfo.solana ? `Solana Core ${versionInfo.solana}` : 'Unknown',
                feature_set: versionInfo.feature_set || 0,
                rpcStats: {
                    totalRequests: this.rpcStats.totalRequests,
                    rateLimitHits: this.rpcStats.rateLimitHits,
                    currentBackoff: this.rpcLimiter.currentBackoffMs,
                    queueLength: this.requestQueue.length,
                    activeRequests: this.rpcStats.activeRequests
                }
            };
        } catch (error) {
            // If connection is lost, attempt to reconnect
            logApi.warn('Solana connection error detected, attempting reconnect...', error);
            
            try {
                await this.reconnect();
                return {
                    status: 'reconnected',
                    message: 'Connection re-established after error'
                };
            } catch (reconnectError) {
                throw new ServiceError('solana_connection_error', `Solana connection error: ${error.message}`);
            }
        }
    }
    
    /**
     * Attempt to reconnect to Solana
     */
    async reconnect() {
        try {
            // Close existing connection, if one exists
            if (this.connection) {
                logApi.info('Closing and re-establishing Solana connection...');
                // Just set to null as Connection doesn't have a destroy method
                this.connection = null;
            }

            // Attempt to create new connection
            this.connection = new Connection(
                config.rpc_urls.mainnet_http, 
                {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: config.solana_timeouts.rpc_reconnection_timeout * 1000,
                    wsEndpoint: config.rpc_urls.mainnet_wss,
                    httpHeaders: {
                        'X-DegenDuel-Request-Priority': 'normal'
                    }
                }
            );
            
            // Test connection
            await this.executeRpcRequest(() => this.connection.getVersion(), 'getVersion-reconnect');
            logApi.info('Solana connection re-established');
            return true;
        } catch (error) {
            logApi.error('Failed to reconnect to Solana:', error);
            throw new ServiceError('solana_reconnect_failed', `Failed to reconnect to Solana: ${error.message}`);
        }
    }
    
    /**
     * Get the Solana connection
     */
    getConnection() {
        if (!this.connection) {
            throw new ServiceError('solana_not_initialized', 'Solana service not initialized');
        }
        return this.connection;
    }
    
    /**
     * Execute an RPC method through the centralized queue
     * This is the main method that other services should use
     * @param {string} methodName - Name of the RPC method to call
     * @param {Array} args - Arguments to pass to the method
     * @returns {Promise<any>} - Result of the RPC call
     */
    async executeConnectionMethod(methodName, ...args) {
        if (!this.connection) {
            throw new ServiceError('solana_not_initialized', 'Solana service not initialized');
        }
        
        // Ensure the method exists on the connection object
        if (typeof this.connection[methodName] !== 'function') {
            throw new ServiceError('invalid_method', `Method ${methodName} does not exist on Solana connection`);
        }
        
        // Execute the method through our central queue
        return this.executeRpcRequest(
            () => this.connection[methodName](...args),
            methodName
        );
    }
    
    /**
     * Clean up resources
     */
    async stop() {
        try {
            await super.stop();
            
            // Process any remaining requests in the queue
            logApi.info(`Processing ${this.requestQueue.length} remaining requests before shutdown...`);
            
            // Set a timeout for processing the queue
            const shutdownTimeout = setTimeout(() => {
                logApi.warn(`Shutdown timeout reached with ${this.requestQueue.length} requests still in queue`);
                this.requestQueue = [];
            }, 10000);
            
            // Wait for all active requests to complete
            while (this.rpcStats.activeRequests > 0 || this.requestQueue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            clearTimeout(shutdownTimeout);
            
            // Clean up Solana connection if needed
            if (this.connection) {
                try {
                    // The Connection class doesn't have a destroy method
                    // Just set it to null to allow garbage collection
                    this.connection = null;
                } catch (error) {
                    logApi.warn('Error cleaning up Solana connection during shutdown:', error);
                }
            }
            
            logApi.info('Solana service stopped successfully');
            return true;
        } catch (error) {
            logApi.error('Error stopping Solana service:', error);
            throw error;
        }
    }
    
    /**
     * Get detailed service status for monitoring
     */
    getServiceStatus() {
        const baseStatus = super.getServiceStatus();
        
        return {
            ...baseStatus,
            connectionActive: !!this.connection,
            rpcStats: {
                totalRequests: this.rpcStats.totalRequests,
                successfulRequests: this.rpcStats.successfulRequests,
                failedRequests: this.rpcStats.failedRequests,
                rateLimitHits: this.rpcStats.rateLimitHits,
                retries: this.rpcStats.retries,
                queueLength: this.requestQueue.length,
                activeRequests: this.rpcStats.activeRequests,
                currentBackoff: this.rpcLimiter.currentBackoffMs
            },
            metrics: {
                ...this.stats,
                serviceStartTime: this.stats.history.lastStarted
            }
        };
    }
}

// Create and export the singleton instance
const solanaService = new SolanaService();
export default solanaService;