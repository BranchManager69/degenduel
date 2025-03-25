// services/solanaService.js

/*
 * This service manages the Solana blockchain connection and provides a standardized interface for other services to access Solana.
 * It also handles the connection health monitoring and automatic reconnection.
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
    dependencies: []
};

/**
 * Service that maintains and monitors Solana blockchain connection
 * Provides a standardized interface for other services to access Solana
 */
class SolanaService extends BaseService {
    constructor() {
        super(SOLANA_SERVICE_CONFIG);
        this.connection = null;
    }

    /**
     * Initialize the Solana connection
     */
    async initialize() {
        try {
            // Call parent initialization first
            await super.initialize();
            
            // Check if connection is already initialized
            if (this.connection) {
                logApi.info('Solana connection already initialized');
                return true;
            }
            
            // Validate Solana configuration
            validateSolanaConfig();
            
            // Create Solana connection with web3.js v2 compatible configuration // TODO: maybe
            this.connection = new Connection(
                config.rpc_urls.mainnet_http,
                {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: config.solana_timeouts.rpc_initial_connection_timeout * 1000,
                    wsEndpoint: config.rpc_urls.mainnet_wss,
                    maxSupportedTransactionVersion: 0 // Support versioned transactions
                    //maxSupportedTransactionVersion: 2 // Support versioned transactions // ??? 
                }
            );
            
            // Test connection with initial request
            const versionInfo = await this.connection.getVersion();
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}\t\t✅ ${fancyColors.BG_LIGHT_GREEN} Solana connection established successfully ${fancyColors.RESET}`, {
                //version: versionInfo?.solana || 'unknown',
                //feature_set: versionInfo?.feature_set || 0
            });
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED}Failed to initialize Solana service: ${error.message} ${fancyColors.RESET}`);
            throw new ServiceError('solana_init_failed', `Failed to initialize Solana service: ${error.message}`);
        }
    }
    
    /**
     * Regular operation - check connection health
     */
    async performOperation() {
        try {
            // Test Solana connection with v2.x compatible approach
            // Try to get slot first as a basic health check
            const slot = await this.connection.getSlot();
            
            // Try to get version info if available
            let versionInfo = { solana: 'Unknown', feature_set: 0 };
            try {
                const result = await this.connection.getVersion();
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
                feature_set: versionInfo.feature_set || 0
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
                await this.connection.destroy();
            }

            // Attempt to create new connection
            this.connection = new Connection(
                config.rpc_urls.mainnet_http, 
                {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: config.solana_timeouts.rpc_reconnection_timeout * 1000,
                    wsEndpoint: config.rpc_urls.mainnet_wss
                }
            );
            // Test connection
            await this.connection.getVersion();
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
     * Clean up resources
     */
    async stop() {
        try {
            await super.stop();
            
            // Clean up Solana connection if needed
            this.connection = null;
            
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