// services/admin-wallet/admin-wallet-service.js

/**
 * Admin Wallet Service
 *
 * @description This service is responsible for managing administrative wallet operations.
 * It handles secure wallet management, SOL/token transfers, and mass operations
 * for admin wallets. This service is completely separate from Contest Wallet Service
 * and manages platform-owned wallets for administrative purposes.
 * 
 * This version should be updated to use SolanaEngine directly for improved RPC performance
 * and reliability through multi-endpoint support and automatic failover.
 * 
 * NOTE: UPDATE ADMIN WALLET SERVICE TO USE SOLANA ENGINE DIRECTLY FOR IMPROVED RPC PERFORMANCE!
 * NOTE: UPDATE ADMIN WALLET SERVICE TO USE SOLANA WEB3.JS v2.x WITH SHIMS FOR SUPPORT!
 * 
 * @author BranchManager69
 * @version 1.9.0
 * @created 2025-04-14
 * @updated 2025-05-05
 */

// Service Auth
import { generateServiceAuthHeader } from '../../config/service-auth.js'; // why is this unused?
// Service Class
import { BaseService } from '../../utils/service-suite/base-service.js';
import { ServiceError } from '../../utils/service-suite/service-error.js';
import prisma from '../../config/prisma.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import AdminLogger from '../../utils/admin-logger.js';
// Service Manager
import serviceManager from '../../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../../utils/service-suite/service-constants.js';
import { SERVICE_LAYERS } from '../../utils/service-suite/service-constants.js'; // why is this unused?
// Solana
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'; // why are these unused?
// Solana Engine
import { solanaEngine } from '../../services/solana-engine/index.js';
// Wallet modules
import walletCrypto from './modules/wallet-crypto.js';
import walletTransactions from './modules/wallet-transactions.js';
import batchOperations from './modules/batch-operations.js';
import walletBalance from './modules/wallet-balance.js';

// Config
import { config } from '../../config/config.js';

// Admin Wallet Config
const ADMIN_WALLET_CONFIG = {
    name: SERVICE_NAMES.ADMIN_WALLET,
    description: getServiceMetadata(SERVICE_NAMES.ADMIN_WALLET).description,
    checkIntervalMs: 60 * 1000, // Check every minute
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 7, // Higher threshold for critical service
        resetTimeoutMs: 80000, // Longer reset time for financial operations
        minHealthyPeriodMs: 150000 // Longer health period required
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    },
    dependencies: [SERVICE_NAMES.SOLANA_ENGINE], // Now depends on SolanaEngine
    wallet: {
        encryption: {
            algorithm: 'aes-256-gcm',
            keyLength: 32,
            ivLength: 16,
            tagLength: 16
        },
        operations: {
            maxParallelTransfers: 5,
            transferTimeoutMs: 30000,
            minSOLBalance: 0.05,
            maxBatchSize: 50
        },
        // Preferred RPC endpoints for critical operations
        preferredEndpoints: {
            transfers: 'endpoint-1', // Can be configured to use specific endpoint
            balanceChecks: null      // null means use rotation strategy
        }
    }
};

// Admin Wallet Service
class AdminWalletService extends BaseService {
    constructor() {
        super(ADMIN_WALLET_CONFIG);
        
        // Initialize service-specific stats
        this.walletStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            transfers: {
                total: 0,
                successful: 0,
                failed: 0,
                sol_amount: 0,
                token_amount: 0,
                by_type: {}
            },
            wallets: {
                total: 0,
                active: 0,
                processing: 0,
                by_type: {}
            },
            batches: {
                total: 0,
                successful: 0,
                failed: 0,
                items_processed: 0
            },
            performance: {
                average_transfer_time_ms: 0,
                last_operation_time_ms: 0,
                average_batch_time_ms: 0
            },
            dependencies: {
                SOLANA: {
                    required: true,
                    status: 'pending',
                    lastCheck: null
                },
                SOLANA_ENGINE: {
                    required: true,
                    status: 'pending',
                    lastCheck: null
                }
            }
        };

        // Active transfer tracking
        this.activeTransfers = new Map();
        this.transferTimeouts = new Set();
    }
    
    /**
     * Initialize the service and validate dependencies
     */
    async initialize() {
        try {
            // Check if admin wallet service is disabled via service profile
            if (!config.services.admin_wallet_service) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Admin Wallet Service is disabled in the '${config.services.active_profile}' service profile`);
                return false;
            }
            
            // Call parent initialize first
            const success = await super.initialize();
            if (!success) {
                return false;
            }
            
            // Verify SolanaEngine is available
            if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} WAITING FOR SOLANA ENGINE ${fancyColors.RESET} SolanaEngine not yet initialized, will wait...`);
                
                // Add some tolerance for initialization order
                for (let i = 0; i < 5; i++) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    if (typeof solanaEngine.isInitialized === 'function' ? solanaEngine.isInitialized() : solanaEngine.isInitialized) {
                        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}SolanaEngine now available.${fancyColors.RESET}`);
                        break;
                    }
                }
                
                // Final check
                if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                    throw new Error('SolanaEngine is not available after waiting. Admin Wallet Service requires SolanaEngine.');
                }
            }
            
            // Update dependency status
            this.walletStats.dependencies.SOLANA_ENGINE.status = 'available';
            this.walletStats.dependencies.SOLANA_ENGINE.lastCheck = new Date();
            
            // Load configuration from database
            const settings = await prisma.system_settings.findUnique({
                where: { key: this.name }
            });

            if (settings?.value) {
                const dbConfig = typeof settings.value === 'string' 
                    ? JSON.parse(settings.value)
                    : settings.value;

                // Merge configs carefully preserving circuit breaker settings
                this.config = {
                    ...this.config,
                    ...dbConfig,
                    circuitBreaker: {
                        ...this.config.circuitBreaker,
                        ...(dbConfig.circuitBreaker || {})
                    }
                };
            }

            // Load initial wallet state
            const [totalWallets, activeWallets] = await Promise.all([
                prisma.managed_wallets.count(),
                prisma.managed_wallets.count({ where: { status: 'active' } })
            ]);

            this.walletStats.wallets.total = totalWallets;
            this.walletStats.wallets.active = activeWallets;

            // Initialize stats
            this.walletStats = {
                operations: {
                    total: 0,
                    successful: 0,
                    failed: 0
                },
                transfers: {
                    total: 0,
                    successful: 0,
                    failed: 0,
                    sol_amount: 0,
                    token_amount: 0
                },
                wallets: {
                    total: totalWallets,
                    active: activeWallets,
                    processing: 0,
                    updated: 0
                },
                balance_updates: {
                    total: 0,
                    successful: 0,
                    failed: 0,
                    last_update: null
                },
                performance: {
                    average_transfer_time_ms: 0,
                    average_balance_update_time_ms: 0,
                    last_operation_time_ms: 0
                },
                dependencies: {
                    SOLANA_ENGINE: {
                        required: true,
                        status: 'available',
                        lastCheck: new Date()
                    }
                }
            };
            
            // Get connection status from SolanaEngine for reporting
            let solanaStatus = { available: false };
            if (typeof solanaEngine.isInitialized === 'function' ? solanaEngine.isInitialized() : solanaEngine.isInitialized) {
                solanaStatus = {
                    available: true,
                    connectionStatus: solanaEngine.getConnectionStatus()
                };
            }
            logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Using SolanaEngine with ${solanaStatus.connectionStatus.healthyEndpoints}/${solanaStatus.connectionStatus.totalEndpoints} RPC endpoints available${fancyColors.RESET}`);

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify({
                ...this.stats,
                walletStats: this.walletStats
            }));

            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Admin Wallet Service initialized successfully${fancyColors.RESET}`);

            return true;
        } catch (error) {
            logApi.error(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.RED}Admin Wallet Service initialization error:${fancyColors.RESET}`, {
                error: error.message,
                stack: error.stack
            });
            await this.handleError(error);
            throw error;
        }
    }

    // Proxy methods to our modular implementations
    
    /* Wallet encryption/decryption */

    // Encrypt a wallet
    encryptWallet(privateKey) {
        return walletCrypto.encryptWallet(privateKey, this.config, process.env.WALLET_ENCRYPTION_KEY);
    }

    // Decrypt a wallet
    decryptWallet(encryptedData) {
        return walletCrypto.decryptWallet(encryptedData, process.env.WALLET_ENCRYPTION_KEY);
    }

    /* Transfer operations */

    // Transfer SOL (single wallet)
    async transferSOL(fromWalletEncrypted, toAddress, amount, description = '', adminId = null, context = {}) {
        const startTime = Date.now();
        
        try {
            // Skip if already being processed
            const transferKey = `${fromWalletEncrypted}:${toAddress}:${amount}`;
            if (this.activeTransfers.has(transferKey)) {
                throw ServiceError.operation('Transfer already in progress');
            }

            // Add to active transfers
            this.activeTransfers.set(transferKey, startTime);

            // Set timeout
            const timeout = setTimeout(() => {
                this.activeTransfers.delete(transferKey);
                this.walletStats.transfers.failed++;
            }, this.config.wallet.operations.transferTimeoutMs);
            
            this.transferTimeouts.add(timeout);

            // Perform transfer using our modular implementation
            const result = await walletTransactions.transferSOL(
                fromWalletEncrypted, 
                toAddress, 
                amount, 
                description, 
                solanaEngine, 
                this.config,
                process.env.WALLET_ENCRYPTION_KEY
            );
            
            // Update stats
            this.walletStats.transfers.total++;
            this.walletStats.transfers.successful++;
            this.walletStats.transfers.sol_amount += amount;
            this.walletStats.transfers.by_type['sol'] = 
                (this.walletStats.transfers.by_type['sol'] || 0) + 1;

            // Log admin action if context provided
            if (adminId) {
                await AdminLogger.logAction(
                    adminId,
                    'ADMIN_WALLET_TRANSFER',
                    {
                        from: fromWalletEncrypted,
                        to: toAddress,
                        amount,
                        type: 'sol',
                        description
                    },
                    context
                );
            }

            // Clear timeout and active transfer
            clearTimeout(timeout);
            this.transferTimeouts.delete(timeout);
            this.activeTransfers.delete(transferKey);

            return result;
        } catch (error) {
            this.walletStats.transfers.failed++;
            throw error;
        }
    }

    // Transfer tokens (single wallet)
    async transferToken(fromWalletEncrypted, toAddress, mint, amount, description = '', adminId = null, context = {}) {
        const startTime = Date.now();
        
        try {
            // Skip if already being processed
            const transferKey = `${fromWalletEncrypted}:${toAddress}:${mint}:${amount}`;
            if (this.activeTransfers.has(transferKey)) {
                throw ServiceError.operation('Transfer already in progress');
            }

            // Add to active transfers
            this.activeTransfers.set(transferKey, startTime);

            // Set timeout
            const timeout = setTimeout(() => {
                this.activeTransfers.delete(transferKey);
                this.walletStats.transfers.failed++;
            }, this.config.wallet.operations.transferTimeoutMs);
            
            this.transferTimeouts.add(timeout);

            // Perform transfer using our modular implementation
            const result = await walletTransactions.transferToken(
                fromWalletEncrypted, 
                toAddress, 
                mint, 
                amount, 
                description, 
                solanaEngine, 
                this.config,
                process.env.WALLET_ENCRYPTION_KEY
            );
            
            // Update stats
            this.walletStats.transfers.total++;
            this.walletStats.transfers.successful++;
            this.walletStats.transfers.token_amount += amount;
            this.walletStats.transfers.by_type['token'] = 
                (this.walletStats.transfers.by_type['token'] || 0) + 1;

            // Log admin action if context provided
            if (adminId) {
                await AdminLogger.logAction(
                    adminId,
                    'ADMIN_WALLET_TRANSFER',
                    {
                        from: fromWalletEncrypted,
                        to: toAddress,
                        mint,
                        amount,
                        type: 'token',
                        description
                    },
                    context
                );
            }

            // Clear timeout and active transfer
            clearTimeout(timeout);
            this.transferTimeouts.delete(timeout);
            this.activeTransfers.delete(transferKey);

            return result;
        } catch (error) {
            this.walletStats.transfers.failed++;
            throw error;
        }
    }

    // Transfer SOL (batch)
    async massTransferSOL(fromWalletEncrypted, transfers) {
        return batchOperations.massTransferSOL(
            fromWalletEncrypted,
            transfers, 
            solanaEngine, 
            this.config, 
            this.walletStats,
            process.env.WALLET_ENCRYPTION_KEY
        );
    }

    // Transfer tokens (batch)
    async massTransferTokens(fromWalletEncrypted, mint, transfers) {
        return batchOperations.massTransferTokens(
            fromWalletEncrypted, 
            mint, 
            transfers, 
            solanaEngine, 
            this.config, 
            this.walletStats,
            process.env.WALLET_ENCRYPTION_KEY
        );
    }

    /* Balance operations */

    // Update the balance of a single wallet
    async updateWalletBalance(wallet) {
        return walletBalance.updateWalletBalance(wallet, solanaEngine, this.config, this.walletStats);
    }
    
    // Update the balances of all the wallets
    async updateAllWalletBalances() {
        return walletBalance.updateAllWalletBalances(solanaEngine, this.config, this.walletStats);
    }

    /* Wallet state operations */   

    // Check the states of the wallets
    async checkWalletStates() {
        return walletBalance.checkWalletStates(solanaEngine, this.config);
    }

    /* Start/stop */

    // Stop the service
    async stop() {
        try {
            await super.stop();
            
            // Clear all timeouts
            for (const timeout of this.transferTimeouts) {
                clearTimeout(timeout);
            }
            this.transferTimeouts.clear();
            
            // Clear active transfers
            this.activeTransfers.clear();
            
            // Final stats update
            await serviceManager.markServiceStopped(
                this.name,
                this.config,
                {
                    ...this.stats,
                    walletStats: this.walletStats
                }
            );
            
            logApi.info('Admin Wallet Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Admin Wallet Service:', error);
            throw error;
        }
    }
    
    // Perform the main operation of the service
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
                logApi.debug(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} Service not operational, skipping operation`);
                return true;
            }
            
            // Call the original performOperation implementation
            await this.performOperation();
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.RED}Perform operation error:${fancyColors.RESET} ${error.message}`);
            throw error; // Important: re-throw to trigger circuit breaker
        }
    }

    // Main operation implementation:
    //   - Periodic health checks
    //   - Balance updates
    /**
     * Perform the main operation of the service
     * @returns {Promise<Object>} - The result of the operation
     */
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Check if SolanaEngine is available
            if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                const errorMsg = 'SolanaEngine not available, skipping admin wallet operations';
                logApi.warn(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}${errorMsg}${fancyColors.RESET}`);
                return {
                    error: errorMsg,
                    skipped: true,
                    duration: Date.now() - startTime
                };
            }
            
            // Update dependency status
            this.walletStats.dependencies.SOLANA_ENGINE.status = 'available';
            this.walletStats.dependencies.SOLANA_ENGINE.lastCheck = new Date();
            
            // Get managed wallets state
            const [totalWallets, activeWallets] = await Promise.all([
                prisma.managed_wallets.count(),
                prisma.managed_wallets.count({ where: { status: 'active' } })
            ]);
            
            // Update stats
            this.walletStats.wallets.total = totalWallets;
            this.walletStats.wallets.active = activeWallets;
            
            // Update all wallet balances
            const balanceUpdateResults = await this.updateAllWalletBalances();
            
            return {
                duration: Date.now() - startTime,
                wallets: {
                    total: totalWallets,
                    active: activeWallets
                },
                balance_updates: balanceUpdateResults
            };
        } catch (error) {
            logApi.error('☠️ Admin wallet service operation failed:', error);
            await this.handleError(error);
            throw error;
        }
    }
    
    /* Status check */

    // Get the service status
    /**
     * Get the service status
     * @returns {Object} - The status of the service
     */
    getServiceStatus() {
        const baseStatus = super.getServiceStatus();

        // Get SolanaEngine connection status
        let solanaStatus = { available: false };
        try {
            if (typeof solanaEngine.isInitialized === 'function' ? solanaEngine.isInitialized() : solanaEngine.isInitialized) {
                solanaStatus = {
                    available: true,
                    connectionStatus: solanaEngine.getConnectionStatus()
                };
            }
        } catch (error) {
            solanaStatus.error = error.message;
        }

        return {
            ...baseStatus,
            metrics: {
                ...this.stats,
                walletStats: this.walletStats,
                serviceStartTime: this.stats.history.lastStarted,
                solanaEngine: solanaStatus
            }
        };
    }
}

// Export Admin Wallet Service singleton
const adminWalletService = new AdminWalletService();
export default adminWalletService;