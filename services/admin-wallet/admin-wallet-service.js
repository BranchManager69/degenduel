// services/admin-wallet/admin-wallet-service.js

/*
 * This service is responsible for managing administrative wallet operations.
 * It handles secure wallet management, SOL/token transfers, and mass operations
 * for admin wallets. This service is completely separate from Contest Wallet Service
 * and manages platform-owned wallets for administrative purposes.
 * 
 * This version is updated to use SolanaEngine directly for improved RPC performance
 * and reliability through multi-endpoint support and automatic failover.
 */

// ** Service Auth **
import { generateServiceAuthHeader } from '../../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../../utils/service-suite/base-service.js';
import { ServiceError } from '../../utils/service-suite/service-error.js';
import { config } from '../../config/config.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import prisma from '../../config/prisma.js';
// ** Service Manager **
import serviceManager from '../../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, SERVICE_LAYERS, getServiceMetadata } from '../../utils/service-suite/service-constants.js';
// Solana
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, createTransferInstruction } from '@solana/spl-token';
import bs58 from 'bs58';
import crypto from 'crypto';
import { transferSOL, transferToken } from '../../utils/solana-suite/web3-v2/solana-transaction-fixed.js';
import { solanaEngine } from '../../services/solana-engine/index.js';
import { fancyColors } from '../../utils/colors.js';

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
            if (!solanaEngine.isInitialized()) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} WAITING FOR SOLANA ENGINE ${fancyColors.RESET} SolanaEngine not yet initialized, will wait...`);
                
                // Add some tolerance for initialization order
                for (let i = 0; i < 5; i++) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    if (solanaEngine.isInitialized()) {
                        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}SolanaEngine now available.${fancyColors.RESET}`);
                        break;
                    }
                }
                
                // Final check
                if (!solanaEngine.isInitialized()) {
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
            const connectionStatus = solanaEngine.getConnectionStatus();
            logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Using SolanaEngine with ${connectionStatus.healthyEndpoints}/${connectionStatus.totalEndpoints} RPC endpoints available${fancyColors.RESET}`);

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

    async checkWalletStates() {
        try {
            // Get active wallets
            const wallets = await prisma.managed_wallets.findMany({
                where: { status: 'active' }
            });

            const results = {
                checked: 0,
                healthy: 0,
                issues: []
            };

            // Check each wallet's state using SolanaEngine
            for (const wallet of wallets) {
                try {
                    // Use SolanaEngine for balance checks
                    const balance = await solanaEngine.executeConnectionMethod(
                        'getBalance',
                        new PublicKey(wallet.wallet_address),
                        { endpointId: this.config.wallet.preferredEndpoints.balanceChecks }
                    );
                    
                    results.checked++;

                    if (balance < this.config.wallet.operations.minSOLBalance * LAMPORTS_PER_SOL) {
                        results.issues.push({
                            wallet: wallet.wallet_address,
                            type: 'low_balance',
                            balance: balance / LAMPORTS_PER_SOL
                        });
                    } else {
                        results.healthy++;
                    }
                } catch (error) {
                    results.issues.push({
                        wallet: wallet.wallet_address,
                        type: 'check_failed',
                        error: error.message
                    });
                }
            }

            return results;
        } catch (error) {
            throw ServiceError.operation('Failed to check wallet states', {
                error: error.message
            });
        }
    }

    // Wallet encryption/decryption
    encryptWallet(privateKey) {
        try {
            const iv = crypto.randomBytes(this.config.wallet.encryption.ivLength);
            const cipher = crypto.createCipheriv(
                this.config.wallet.encryption.algorithm,
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                iv
            );

            const encrypted = Buffer.concat([
                cipher.update(privateKey),
                cipher.final()
            ]);

            const tag = cipher.getAuthTag();

            return JSON.stringify({
                encrypted: encrypted.toString('hex'),
                iv: iv.toString('hex'),
                tag: tag.toString('hex')
            });
        } catch (error) {
            throw ServiceError.operation('Failed to encrypt wallet', {
                error: error.message,
                type: 'ENCRYPTION_ERROR'
            });
        }
    }

    decryptWallet(encryptedData) {
        try {
            const { encrypted, iv, tag } = JSON.parse(encryptedData);
            const decipher = crypto.createDecipheriv(
                this.config.wallet.encryption.algorithm,
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                Buffer.from(iv, 'hex')
            );
            
            decipher.setAuthTag(Buffer.from(tag, 'hex'));
            
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(encrypted, 'hex')),
                decipher.final()
            ]);
            
            return decrypted.toString();
        } catch (error) {
            throw ServiceError.operation('Failed to decrypt wallet', {
                error: error.message,
                type: 'DECRYPTION_ERROR'
            });
        }
    }

    // Transfer operations
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

            // Perform transfer
            const result = await this._transferSOL(fromWalletEncrypted, toAddress, amount, description);
            
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

            // Perform transfer
            const result = await this._transferToken(fromWalletEncrypted, toAddress, mint, amount, description);
            
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

    async _transferSOL(fromWalletEncrypted, toAddress, amount, description = '') {
        try {
            const decryptedPrivateKey = this.decryptWallet(fromWalletEncrypted);
            const privateKeyBytes = bs58.decode(decryptedPrivateKey);
            const fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
            
            // Create transaction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: new PublicKey(toAddress),
                    lamports: amount * LAMPORTS_PER_SOL
                })
            );

            // Use SolanaEngine for transaction sending
            // Specify the preferred endpoint for critical transfers if configured
            const signature = await solanaEngine.sendTransaction(
                transaction, 
                [fromKeypair], 
                {
                    endpointId: this.config.wallet.preferredEndpoints.transfers,
                    commitment: 'confirmed',
                    skipPreflight: false
                }
            );

            // Log the transaction
            await prisma.transactions.create({
                data: {
                    wallet_address: fromKeypair.publicKey.toString(),
                    type: 'ADMIN_TRANSFER',
                    amount,
                    description,
                    status: 'completed',
                    blockchain_signature: signature,
                    completed_at: new Date(),
                    created_at: new Date()
                }
            });

            return { signature };
        } catch (error) {
            throw ServiceError.operation('SOL transfer failed', {
                error: error.message,
                from: fromWalletEncrypted,
                to: toAddress,
                amount
            });
        }
    }

    async _transferToken(fromWalletEncrypted, toAddress, mint, amount, description = '') {
        try {
            const decryptedPrivateKey = this.decryptWallet(fromWalletEncrypted);
            const privateKeyBytes = bs58.decode(decryptedPrivateKey);
            const fromKeypair = Keypair.fromSecretKey(privateKeyBytes);

            const mintPublicKey = new PublicKey(mint);
            const toPublicKey = new PublicKey(toAddress);

            // Get token accounts
            const fromTokenAccount = await solanaEngine.executeConnectionMethod(
                'getTokenAccountsByOwner',
                fromKeypair.publicKey,
                {
                    mint: mintPublicKey
                },
                {
                    encoding: 'jsonParsed'
                }
            );

            const fromTokenAccountAddress = fromTokenAccount.value[0]?.pubkey;
            if (!fromTokenAccountAddress) {
                throw new Error(`Source token account not found for mint ${mint}`);
            }

            // Check if destination token account exists
            let toTokenAccount;
            try {
                toTokenAccount = await solanaEngine.executeConnectionMethod(
                    'getTokenAccountsByOwner',
                    toPublicKey,
                    {
                        mint: mintPublicKey
                    },
                    {
                        encoding: 'jsonParsed'
                    }
                );
            } catch (error) {
                // If we can't find it, we'll need to create it
                toTokenAccount = { value: [] };
            }

            // Prepare transaction
            const transaction = new Transaction();

            // If destination doesn't have a token account, create it
            let toTokenAccountAddress;
            if (toTokenAccount.value.length === 0) {
                // Get associated token address
                const associatedTokenAddress = await getAssociatedTokenAddress(
                    mintPublicKey,
                    toPublicKey
                );
                
                // Create token account instruction would go here
                // For now, we'll throw an error since we need the token account to exist
                throw new Error(`Destination doesn't have a token account for mint ${mint}`);
            } else {
                toTokenAccountAddress = toTokenAccount.value[0].pubkey;
            }

            // Add transfer instruction
            transaction.add(
                createTransferInstruction(
                    fromTokenAccountAddress,
                    toTokenAccountAddress,
                    fromKeypair.publicKey,
                    amount
                )
            );

            // Use SolanaEngine for transaction sending
            // Specify the preferred endpoint for critical transfers if configured
            const signature = await solanaEngine.sendTransaction(
                transaction, 
                [fromKeypair], 
                {
                    endpointId: this.config.wallet.preferredEndpoints.transfers,
                    commitment: 'confirmed',
                    skipPreflight: false
                }
            );

            // Log the transaction
            await prisma.transactions.create({
                data: {
                    wallet_address: fromKeypair.publicKey.toString(),
                    type: 'ADMIN_TOKEN_TRANSFER',
                    amount,
                    token_mint: mint,
                    description,
                    status: 'completed',
                    blockchain_signature: signature,
                    completed_at: new Date(),
                    created_at: new Date()
                }
            });

            return { signature };
        } catch (error) {
            throw ServiceError.operation('Token transfer failed', {
                error: error.message,
                from: fromWalletEncrypted,
                to: toAddress,
                mint,
                amount
            });
        }
    }

    // Batch operations
    async massTransferSOL(fromWalletEncrypted, transfers) {
        const startTime = Date.now();
        
        try {
            if (transfers.length > this.config.wallet.operations.maxBatchSize) {
                throw ServiceError.validation('Batch size exceeds maximum allowed');
            }

            const results = {
                total: transfers.length,
                successful: 0,
                failed: 0,
                transfers: []
            };

            // Process transfers in parallel with limit
            const chunks = [];
            for (let i = 0; i < transfers.length; i += this.config.wallet.operations.maxParallelTransfers) {
                const chunk = transfers.slice(i, i + this.config.wallet.operations.maxParallelTransfers);
                chunks.push(chunk);
            }

            for (const chunk of chunks) {
                const chunkResults = await Promise.allSettled(
                    chunk.map(transfer => 
                        this.transferSOL(
                            fromWalletEncrypted,
                            transfer.toAddress,
                            transfer.amount,
                            transfer.description
                        )
                    )
                );

                chunkResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        results.successful++;
                        results.transfers.push({
                            ...chunk[index],
                            status: 'success',
                            signature: result.value.signature
                        });
                    } else {
                        results.failed++;
                        results.transfers.push({
                            ...chunk[index],
                            status: 'failed',
                            error: result.reason.message
                        });
                    }
                });
            }

            // Update batch stats
            this.walletStats.batches.total++;
            this.walletStats.batches.successful += results.successful;
            this.walletStats.batches.failed += results.failed;
            this.walletStats.batches.items_processed += transfers.length;
            this.walletStats.performance.average_batch_time_ms = 
                (this.walletStats.performance.average_batch_time_ms * this.walletStats.batches.total + 
                (Date.now() - startTime)) / (this.walletStats.batches.total + 1);

            return results;
        } catch (error) {
            throw ServiceError.operation('Mass SOL transfer failed', {
                error: error.message,
                transfer_count: transfers.length
            });
        }
    }

    async massTransferTokens(fromWalletEncrypted, mint, transfers) {
        const startTime = Date.now();
        
        try {
            if (transfers.length > this.config.wallet.operations.maxBatchSize) {
                throw ServiceError.validation('Batch size exceeds maximum allowed');
            }

            const results = {
                total: transfers.length,
                successful: 0,
                failed: 0,
                transfers: []
            };

            // Process transfers in parallel with limit
            const chunks = [];
            for (let i = 0; i < transfers.length; i += this.config.wallet.operations.maxParallelTransfers) {
                const chunk = transfers.slice(i, i + this.config.wallet.operations.maxParallelTransfers);
                chunks.push(chunk);
            }

            for (const chunk of chunks) {
                const chunkResults = await Promise.allSettled(
                    chunk.map(transfer => 
                        this.transferToken(
                            fromWalletEncrypted,
                            transfer.toAddress,
                            mint,
                            transfer.amount,
                            transfer.description
                        )
                    )
                );

                chunkResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        results.successful++;
                        results.transfers.push({
                            ...chunk[index],
                            status: 'success',
                            signature: result.value.signature
                        });
                    } else {
                        results.failed++;
                        results.transfers.push({
                            ...chunk[index],
                            status: 'failed',
                            error: result.reason.message
                        });
                    }
                });
            }

            // Update batch stats
            this.walletStats.batches.total++;
            this.walletStats.batches.successful += results.successful;
            this.walletStats.batches.failed += results.failed;
            this.walletStats.batches.items_processed += transfers.length;
            this.walletStats.performance.average_batch_time_ms = 
                (this.walletStats.performance.average_batch_time_ms * this.walletStats.batches.total + 
                (Date.now() - startTime)) / (this.walletStats.batches.total + 1);

            return results;
        } catch (error) {
            throw ServiceError.operation('Mass token transfer failed', {
                error: error.message,
                mint,
                transfer_count: transfers.length
            });
        }
    }

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
    
    // Fetch and update Solana balance for a managed wallet
    async updateWalletBalance(wallet) {
        try {
            const startTime = Date.now();
            
            // Skip if no wallet address
            if (!wallet.public_key) {
                return {
                    success: false,
                    error: 'No wallet address provided'
                };
            }
            
            // Get current Solana balance via SolanaEngine
            const publicKey = new PublicKey(wallet.public_key);
            const lamports = await solanaEngine.executeConnectionMethod(
                'getBalance',
                publicKey,
                { endpointId: this.config.wallet.preferredEndpoints.balanceChecks }
            );
            
            const solBalance = lamports / LAMPORTS_PER_SOL;
            
            // Update wallet metadata with balance info in database
            const currentMetadata = wallet.metadata || {};
            const updatedMetadata = {
                ...currentMetadata,
                balance: {
                    sol: solBalance,
                    last_updated: new Date().toISOString()
                }
            };
            
            await prisma.managed_wallets.update({
                where: { id: wallet.id },
                data: {
                    metadata: updatedMetadata,
                    updated_at: new Date()
                }
            });
            
            // Update stats
            this.walletStats.balance_updates.total++;
            this.walletStats.balance_updates.successful++;
            this.walletStats.balance_updates.last_update = new Date().toISOString();
            this.walletStats.wallets.updated++;
            
            // Update performance metrics
            const duration = Date.now() - startTime;
            this.walletStats.performance.average_balance_update_time_ms = 
                (this.walletStats.performance.average_balance_update_time_ms * 
                    (this.walletStats.balance_updates.total - 1) + duration) / 
                this.walletStats.balance_updates.total;
            
            // Get previous balance for comparison
            const previousBalance = currentMetadata?.balance?.sol || 0;
            
            return {
                success: true,
                wallet_id: wallet.id,
                public_key: wallet.public_key,
                label: wallet.label,
                previous_balance: previousBalance,
                current_balance: solBalance,
                difference: solBalance - previousBalance
            };
        } catch (error) {
            // Update error stats
            this.walletStats.balance_updates.failed++;
            
            logApi.error('Failed to update admin wallet balance', {
                wallet_id: wallet.id,
                public_key: wallet.public_key,
                error: error.message,
                stack: error.stack
            });
            
            return {
                success: false,
                wallet_id: wallet.id,
                public_key: wallet.public_key,
                error: error.message
            };
        }
    }
    
    // Bulk update all managed wallets' balances
    async updateAllWalletBalances() {
        const startTime = Date.now();
        try {
            // Get all managed wallets
            const managedWallets = await prisma.managed_wallets.findMany({
                where: {
                    status: 'active'
                }
            });
            
            const results = {
                total: managedWallets.length,
                updated: 0,
                failed: 0,
                updates: []
            };
            
            // Update each wallet's balance
            for (const wallet of managedWallets) {
                try {
                    // Update balance
                    const updateResult = await this.updateWalletBalance(wallet);
                    
                    if (updateResult.success) {
                        results.updated++;
                        
                        // Only add significant balance changes to the results
                        if (Math.abs(updateResult.difference) > 0.001) {
                            results.updates.push(updateResult);
                        }
                    } else {
                        results.failed++;
                    }
                } catch (error) {
                    results.failed++;
                    logApi.error('Error updating individual admin wallet balance', {
                        wallet_id: wallet.id,
                        public_key: wallet.public_key,
                        error: error.message
                    });
                }
            }
            
            // Update overall performance stats
            this.walletStats.performance.last_operation_time_ms = Date.now() - startTime;
            
            return {
                duration: Date.now() - startTime,
                ...results
            };
        } catch (error) {
            logApi.error('Failed to update admin wallet balances', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
    
    // Main operation implementation - periodic health checks and balance updates
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Check if SolanaEngine is available
            if (!solanaEngine.isInitialized()) {
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
    
    /**
     * Get detailed service status for monitoring
     * 
     * @returns {Promise<Object>} - The status of the service
     */
    getServiceStatus() {
        const baseStatus = super.getServiceStatus();

        // Get SolanaEngine connection status
        let solanaStatus = { available: false };
        try {
            if (solanaEngine.isInitialized()) {
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

// Export service singleton
const adminWalletService = new AdminWalletService();
export default adminWalletService;