// services/admin-wallet/admin-wallet-service.js

/**
 * Admin Wallet Service
 * @module admin-wallet-service
 *
 * @description Service responsible for managing administrative wallet operations.
 *              Handles secure wallet management, SOL/token transfers (single & batch),
 *              and balance monitoring. Delegates Solana interactions to modular components
 *              using the v2 compatibility layer.
 * 
 * @author BranchManager69
 * @version 2.0.0
 * @created 2025-05-05
 * @updated 2025-05-05
 */

// Service Auth (Currently unused)
// import { generateServiceAuthHeader } from '../../config/service-auth.js';
// Service Class
import { BaseService } from '../../utils/service-suite/base-service.js';
import { ServiceError } from '../../utils/service-suite/service-error.js'; // Keep if used in BaseService or direct throws
import prisma from '../../config/prisma.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import AdminLogger from '../../utils/admin-logger.js';
// Service Manager
import serviceManager from '../../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../../utils/service-suite/service-constants.js';
// import { SERVICE_LAYERS } from '../../utils/service-suite/service-constants.js'; // Unused
// Solana v1 imports (Removed as unused and logic delegated)
// import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
// Solana Engine (Used via delegation in modules)
import { solanaEngine } from '../../services/solana-engine/index.js';
// Wallet modules (Delegated operations)
import walletCrypto from './modules/wallet-crypto.js';
import walletTransactions from './modules/wallet-transactions.js';
import batchOperations from './modules/batch-operations.js';
import walletBalance from './modules/wallet-balance.js';
import walletBalanceWs from './modules/wallet-balance-ws.js'; // WebSocket-based wallet balance monitoring

// Config
import { config } from '../../config/config.js';

// Import the necessary signer creation functions
import { createKeyPairSignerFromBytes } from '@solana/signers';
import { createKeypairFromPrivateKey as createSignerFromLegacyKey } from './utils/solana-compat.js'; // It's in the same service's utils

// Admin Wallet Config
const ADMIN_WALLET_CONFIG = {
    name: SERVICE_NAMES.ADMIN_WALLET,
    description: getServiceMetadata(SERVICE_NAMES.ADMIN_WALLET).description,
    checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes (reduced from 1 minute to avoid rate limits)
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
            balanceChecks: config.rpc_urls.mainnet_http // CORRECTED: Using 'config' directly
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

            // Initialize WebSocket balance monitoring
            try {
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.CYAN}Initializing WebSocket-based wallet balance monitoring${fancyColors.RESET}`);
                const wsInitialized = await walletBalanceWs.initializeWalletBalanceWebSocket(solanaEngine, this.config);
                if (wsInitialized) {
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}WebSocket monitoring initialized successfully${fancyColors.RESET}`);
                    this.walletStats.monitoring = {
                        mode: 'websocket',
                        status: 'active',
                        initialized: true
                    };
                } else {
                    logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}WebSocket monitoring failed to initialize, will fall back to polling${fancyColors.RESET}`);
                    this.walletStats.monitoring = {
                        mode: 'polling',
                        status: 'active',
                        initialized: false
                    };
                }
            } catch (error) {
                logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Failed to initialize WebSocket monitoring: ${error.message}${fancyColors.RESET}`);
                this.walletStats.monitoring = {
                    mode: 'polling',
                    status: 'active',
                    initialized: false,
                    error: error.message
                };
            }

            // Initialize stats, preserving the monitoring configuration
            const monitoring = this.walletStats.monitoring || {
                mode: 'polling',
                status: 'active',
                initialized: false
            };

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
                },
                // Preserve the monitoring configuration
                monitoring
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
        // Delegate to crypto module
        return walletCrypto.encryptV2SeedBuffer(privateKey, this.config, process.env.WALLET_ENCRYPTION_KEY);
    }

    // Decrypt a wallet
    decryptWallet(encryptedData) {
        // Delegate to crypto module
        return walletCrypto.decryptWallet(encryptedData, process.env.WALLET_ENCRYPTION_KEY);
    }

    /* Transfer operations */

    // Transfer SOL (single wallet)
    async transferSOL(fromWalletEncryptedData, toAddress, amount, description = '', adminId = null, context = {}) {
        const startTime = Date.now();
        
        try {
            const transferKey = `${fromWalletEncryptedData}:${toAddress}:${amount}`;
            if (this.activeTransfers.has(transferKey)) {
                throw ServiceError.operation('Transfer already in progress');
            }
            this.activeTransfers.set(transferKey, startTime);
            const timeout = setTimeout(() => {
                this.activeTransfers.delete(transferKey);
                this.walletStats.transfers.failed++;
            }, this.config.wallet.operations.transferTimeoutMs);
            this.transferTimeouts.add(timeout);

            // 1. Decrypt
            const decryptedKeyOrSeed = this.decryptWallet(fromWalletEncryptedData);

            // 2. Create Signer
            let signer;
            if (decryptedKeyOrSeed.length === 32) {
                this.logApi.debug(`[AdminWalletService] transferSOL: Decrypted a 32-byte seed. Creating signer with createKeyPairSignerFromBytes.`);
                signer = await createKeyPairSignerFromBytes(decryptedKeyOrSeed);
            } else if (decryptedKeyOrSeed.length === 64) {
                this.logApi.debug(`[AdminWalletService] transferSOL: Decrypted a 64-byte legacy key. Creating signer with createSignerFromLegacyKey.`);
                signer = await createSignerFromLegacyKey(decryptedKeyOrSeed);
            } else {
                const errMsg = `transferSOL: Decrypted key/seed has an unexpected length: ${decryptedKeyOrSeed.length}. Expected 32 or 64 bytes.`;
                this.logApi.error(`[AdminWalletService] ${errMsg}`);
                throw ServiceError.operation(errMsg, { type: 'KEY_MATERIAL_LENGTH_ERROR' });
            }

            if (!signer) {
                throw ServiceError.operation(`transferSOL: Failed to create a signer.`);
            }

            // 3. Perform transfer using the v2 signer
            const result = await walletTransactions.transferSOLWithSigner(
                signer, 
                toAddress, 
                amount, 
                description, 
                solanaEngine,
                this.config
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
                        from: fromWalletEncryptedData,
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
            if (!(error instanceof ServiceError)) {
                this.logApi.error(`[AdminWalletService] Unexpected error in transferSOL: ${error.message}`, { stack: error.stack, toAddress, amount });
            }
            throw error;
        }
    }

    // Transfer tokens (single wallet)
    async transferToken(fromWalletEncryptedData, toAddress, mint, amount, description = '', adminId = null, context = {}) {
        const startTime = Date.now();
        
        try {
            const transferKey = `${fromWalletEncryptedData}:${toAddress}:${mint}:${amount}`;
            if (this.activeTransfers.has(transferKey)) {
                throw ServiceError.operation('Transfer already in progress');
            }
            this.activeTransfers.set(transferKey, startTime);
            const timeout = setTimeout(() => {
                this.activeTransfers.delete(transferKey);
                this.walletStats.transfers.failed++;
            }, this.config.wallet.operations.transferTimeoutMs);
            this.transferTimeouts.add(timeout);

            // 1. Decrypt
            const decryptedKeyOrSeed = this.decryptWallet(fromWalletEncryptedData);

            // 2. Create Signer
            let signer;
            if (decryptedKeyOrSeed.length === 32) {
                this.logApi.debug(`[AdminWalletService] transferToken: Decrypted a 32-byte seed. Creating signer with createKeyPairSignerFromBytes.`);
                signer = await createKeyPairSignerFromBytes(decryptedKeyOrSeed);
            } else if (decryptedKeyOrSeed.length === 64) {
                this.logApi.debug(`[AdminWalletService] transferToken: Decrypted a 64-byte legacy key. Creating signer with createSignerFromLegacyKey.`);
                signer = await createSignerFromLegacyKey(decryptedKeyOrSeed);
            } else {
                const errMsg = `transferToken: Decrypted key/seed has an unexpected length: ${decryptedKeyOrSeed.length}. Expected 32 or 64 bytes.`;
                this.logApi.error(`[AdminWalletService] ${errMsg}`);
                throw ServiceError.operation(errMsg, { type: 'KEY_MATERIAL_LENGTH_ERROR' });
            }

            if (!signer) {
                throw ServiceError.operation(`transferToken: Failed to create a signer.`);
            }
            
            // 3. Perform transfer using the v2 signer
            const result = await walletTransactions.transferTokenWithSigner(
                signer, 
                toAddress, 
                mint, 
                amount, 
                description, 
                solanaEngine,
                this.config
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
                        from: fromWalletEncryptedData,
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
            if (!(error instanceof ServiceError)) {
                this.logApi.error(`[AdminWalletService] Unexpected error in transferToken: ${error.message}`, { stack: error.stack, toAddress, mint, amount });
            }
            throw error;
        }
    }

    // Transfer SOL (batch)
    async massTransferSOL(fromWalletEncryptedData, transfers) {
        // 1. Decrypt
        const decryptedKeyOrSeed = this.decryptWallet(fromWalletEncryptedData);

        // 2. Create Signer
        let signer;
        if (decryptedKeyOrSeed.length === 32) {
            signer = await createKeyPairSignerFromBytes(decryptedKeyOrSeed);
        } else if (decryptedKeyOrSeed.length === 64) {
            signer = await createSignerFromLegacyKey(decryptedKeyOrSeed);
        } else {
            throw ServiceError.operation(`massTransferSOL: Decrypted key/seed has an unexpected length: ${decryptedKeyOrSeed.length}.`);
        }
        if (!signer) throw ServiceError.operation(`massTransferSOL: Failed to create a signer.`);

        // Delegate to batch module, now passing the signer
        return batchOperations.massTransferSOLWithSigner(
            signer,
            transfers, 
            solanaEngine, 
            this.config, 
            this.walletStats
        );
    }

    // Transfer tokens (batch)
    async massTransferTokens(fromWalletEncryptedData, mint, transfers) {
        // 1. Decrypt
        const decryptedKeyOrSeed = this.decryptWallet(fromWalletEncryptedData);

        // 2. Create Signer
        let signer;
        if (decryptedKeyOrSeed.length === 32) {
            signer = await createKeyPairSignerFromBytes(decryptedKeyOrSeed);
        } else if (decryptedKeyOrSeed.length === 64) {
            signer = await createSignerFromLegacyKey(decryptedKeyOrSeed);
        } else {
            throw ServiceError.operation(`massTransferTokens: Decrypted key/seed has an unexpected length: ${decryptedKeyOrSeed.length}.`);
        }
        if (!signer) throw ServiceError.operation(`massTransferTokens: Failed to create a signer.`);
        
        // Delegate to batch module, now passing the signer
        return batchOperations.massTransferTokensWithSigner(
            signer, 
            mint, 
            transfers, 
            solanaEngine, 
            this.config, 
            this.walletStats
        );
    }

    /* Balance operations */

    // Update the balance of a single wallet
    async updateWalletBalance(wallet) {
        // Delegate to balance module
        return walletBalance.updateWalletBalance(wallet, solanaEngine, this.config, this.walletStats);
    }
    
    // Update the balances of all the wallets
    async updateAllWalletBalances() {
        // Delegate to balance module
        return walletBalance.updateAllWalletBalances(solanaEngine, this.config, this.walletStats);
    }

    /* Wallet state operations */   

    // Check the states of the wallets
    async checkWalletStates() {
        // Delegate to balance module
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

            // Stop WebSocket monitoring if active
            if (this.walletStats.monitoring?.mode === 'websocket' && this.walletStats.monitoring?.initialized) {
                try {
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.CYAN}Stopping WebSocket wallet balance monitoring${fancyColors.RESET}`);
                    const stopped = walletBalanceWs.stopWalletBalanceWebSocket();
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}WebSocket monitoring ${stopped ? 'stopped' : 'failed to stop'}${fancyColors.RESET}`);
                } catch (wsError) {
                    logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error stopping WebSocket monitoring: ${wsError.message}${fancyColors.RESET}`);
                }
            }

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

            // Check if WebSocket monitoring is active
            let balanceUpdateResults = { skipped: false };

            if (this.walletStats.monitoring?.mode === 'websocket' && this.walletStats.monitoring?.initialized) {
                // Get WebSocket status
                const wsStatus = walletBalanceWs.getWebSocketStatus();

                // Update monitoring stats regardless of connection state
                this.walletStats.monitoring.lastCheck = new Date().toISOString();
                this.walletStats.monitoring.connectionState = wsStatus.connectionState;
                this.walletStats.monitoring.walletCount = wsStatus.walletCount || 0;
                this.walletStats.monitoring.subscriptionCount = wsStatus.subscriptionCount || 0;
                this.walletStats.monitoring.readyState = wsStatus.readyState;
                this.walletStats.monitoring.readyStateText = wsStatus.readyStateText;

                if (wsStatus.connectionState === 'connected') {
                    // WebSocket is working fine, skip polling
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Using WebSocket for wallet monitoring (${wsStatus.walletCount} wallets). Skipping RPC balance polling.${fancyColors.RESET}`);

                    // Set status to active
                    this.walletStats.monitoring.status = 'active';
                    this.walletStats.monitoring.lastSuccessfulConnection = new Date().toISOString();

                    balanceUpdateResults = {
                        duration: 0,
                        skipped: true,
                        mode: 'websocket',
                        total: wsStatus.walletCount,
                        updated: 0,
                        failed: 0,
                        websocket_status: wsStatus
                    };

                    // Log our connectivity success to Logtail
                    logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}WebSocket monitoring active with ${wsStatus.walletCount} wallets and ${wsStatus.subscriptionCount} subscriptions. Ready state: ${wsStatus.readyStateText}${fancyColors.RESET}`);

                } else {
                    // WebSocket is not connected, log this and continue with polling
                    logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}WebSocket monitoring not connected (${wsStatus.connectionState}), falling back to balance polling${fancyColors.RESET}`);

                    // Update connection status
                    this.walletStats.monitoring.status = 'reconnecting';
                    this.walletStats.monitoring.lastConnectionAttempt = new Date().toISOString();
                    this.walletStats.monitoring.reconnectAttempts = wsStatus.reconnectAttempts || 0;

                    // Try to refresh WebSocket connection
                    try {
                        await walletBalanceWs.refreshMonitoredWallets();
                    } catch (error) {
                        logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Failed to refresh WebSocket wallets: ${error.message}${fancyColors.RESET}`);
                        this.walletStats.monitoring.lastError = error.message;
                        this.walletStats.monitoring.lastErrorTime = new Date().toISOString();
                    }

                    // Fall back to polling
                    balanceUpdateResults = await this.updateAllWalletBalances();
                    balanceUpdateResults.mode = 'polling_fallback';
                    balanceUpdateResults.websocket_status = wsStatus;
                }
            } else {
                // WebSocket monitoring not active, use polling
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.CYAN}Using RPC polling for wallet balance updates${fancyColors.RESET}`);
                balanceUpdateResults = await this.updateAllWalletBalances();
                balanceUpdateResults.mode = 'polling';
            }

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

        // Get WebSocket monitoring status if active
        let wsStatus = { active: false };
        if (this.walletStats.monitoring?.mode === 'websocket' && this.walletStats.monitoring?.initialized) {
            try {
                wsStatus = {
                    active: true,
                    ...walletBalanceWs.getWebSocketStatus()
                };
            } catch (error) {
                wsStatus = {
                    active: false,
                    error: error.message
                };
            }
        }

        // Log the full status information during initialization or when debugging is needed
        logApi.debug(`${fancyColors.CYAN}[${this.name}]${fancyColors.RESET} Service status report generated. WebSocket monitor status: ${wsStatus.active ? 'active' : 'inactive'}, Wallets monitored: ${wsStatus.walletCount || 0}`);

        return {
            ...baseStatus,
            metrics: {
                ...this.stats,
                walletStats: this.walletStats,
                serviceStartTime: this.stats.history.lastStarted,
                solanaEngine: solanaStatus,
                walletMonitoring: {
                    ...this.walletStats.monitoring,
                    wsStatus
                }
            }
        };
    }
}

// Export Admin Wallet Service singleton
const adminWalletService = new AdminWalletService();
export default adminWalletService;