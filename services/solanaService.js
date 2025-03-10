// services/solanaService.js

/*
 * This service manages the Solana blockchain connection and provides a standardized interface for other services to access Solana.
 * It also handles the connection health monitoring and automatic reconnection.
 */

import { Connection } from '@solana/web3.js';
import { validateSolanaConfig } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { BaseService } from '../utils/service-suite/base-service.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { fancyColors } from '../utils/colors.js';

// Configuration for Solana service
const SOLANA_SERVICE_CONFIG = {
    name: SERVICE_NAMES.SOLANA,
    description: getServiceMetadata(SERVICE_NAMES.SOLANA).description,
    layer: getServiceMetadata(SERVICE_NAMES.SOLANA).layer,
    criticalLevel: getServiceMetadata(SERVICE_NAMES.SOLANA).criticalLevel,
    checkIntervalMs: 30000, // 30 seconds - match current monitoring interval
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 3,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
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
            
            if (this.connection) {
                logApi.info('Solana connection already initialized');
                return true;
            }
            
            // Validate Solana configuration
            validateSolanaConfig();
            
            // Create Solana connection with web3.js v2 compatible configuration
            this.connection = new Connection(
                process.env.QUICKNODE_MAINNET_HTTP,
                {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: 120000,
                    wsEndpoint: process.env.QUICKNODE_MAINNET_WSS,
                    maxSupportedTransactionVersion: 0 // Support versioned transactions
                }
            );
            
            // Test connection with initial request
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}\t\t✅ ${fancyColors.BG_LIGHT_GREEN} Solana connection established successfully ${fancyColors.RESET}`, {
            //    version: versionInfo?.solana || 'unknown',
            //    feature_set: versionInfo?.feature_set || 0
            });
            //const versionInfo = await this.connection.getVersion();
            
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
            this.connection = new Connection(
                process.env.QUICKNODE_MAINNET_HTTP,
                {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: 120000,
                    wsEndpoint: process.env.QUICKNODE_MAINNET_WSS
                }
            );
            
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