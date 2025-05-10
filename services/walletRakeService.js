// services/walletRakeService.js

/*
 * This service is responsible for collecting leftover Solana from contest wallets.
 * It checks all already-evaluated contests every 10 minutes for leftover SOL/tokens.
 * The contestEvaluateService should have already transferred all prizes to the contest winners.
 * Therefore, if anything is left over, it belongs to us and should be transferred to the 'main' DegenDuel wallet.
 */

// ** Service Auth **
import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../utils/service-suite/service-error.js';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
// Solana
// import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';
// Other
import { Decimal } from '@prisma/client/runtime/library';
import { solanaEngine } from './solana-engine/index.js';
import { createKeyPairSignerFromBytes } from '@solana/signers';
import { address as v2Address, getAddressFromPublicKey } from '@solana/addresses';
import { Buffer } from 'node:buffer';
import { createSystemTransferInstruction } from '@solana/pay';

const LAMPORTS_PER_SOL_V2 = 1_000_000_000;

const WALLET_RAKE_CONFIG = {
    name: SERVICE_NAMES.WALLET_RAKE,
    description: getServiceMetadata(SERVICE_NAMES.WALLET_RAKE).description,
    checkIntervalMs: 0.5 * 60 * 1000, // Check every 30 seconds
    maxRetries: 3,
    retryDelayMs: 5 * 60 * 1000, // 5 minutes between retries
    circuitBreaker: {
        failureThreshold: 8, // Higher threshold for financial operations
        resetTimeoutMs: 90000, // Longer reset time for fund collection
        minHealthyPeriodMs: 150000 // Longer health period required
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    },
    wallet: {
        min_balance_sol: config.master_wallet.min_contest_wallet_balance,
        master_wallet: config.master_wallet.address,
        min_rake_amount: 0.001 // Minimum SOL to rake
    },
    processing: {
        batchSize: 50,
        maxParallelOperations: 5,
        operationTimeoutMs: 60000
    }
};

// Wallet Rake Service
class WalletRakeService extends BaseService {
    constructor() {
        ////super(WALLET_RAKE_CONFIG.name, WALLET_RAKE_CONFIG);
        super(WALLET_RAKE_CONFIG);
        
        // Service-specific state
        this.rakeStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            amounts: {
                total_raked: 0,
                by_contest: {}
            },
            wallets: {
                processed: 0,
                skipped: 0,
                failed: 0,
                last_processed: {}
            },
            batches: {
                total: 0,
                successful: 0,
                failed: 0,
                average_size: 0
            },
            performance: {
                average_rake_time_ms: 0,
                last_rake_time_ms: 0,
                average_batch_time_ms: 0
            },
            dependencies: {
                contestWallet: {
                    status: 'unknown',
                    lastCheck: null,
                    errors: 0
                }
            }
        };

        // Active processing tracking
        this.activeOperations = new Map();
        this.operationTimeouts = new Set();
    }

    // Initialize the service
    async initialize() {
        try {
            // Call parent initialize first
            await super.initialize();
            
            // Check if service is enabled via service profile
            if (!config.services.wallet_rake) {
                logApi.warn(`${fancyColors.MAGENTA}[walletRakeService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Wallet Rake Service is disabled in the '${config.services.active_profile}' service profile`);
                return false; // Skip initialization
            }
            
            // Check dependencies
            const contestWalletStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.CONTEST_WALLET);
            if (!contestWalletStatus) {
                throw ServiceError.initialization('Contest Wallet Service not healthy');
            }

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

            // Test connection via solanaEngine
            await solanaEngine.executeConnectionMethod('getLatestBlockhash');
            logApi.info('[WalletRakeService] Connection test via solanaEngine successful.');

            // Load initial rake state
            const [totalRaked, totalWallets] = await Promise.all([
                prisma.transactions.aggregate({
                    where: { type: 'WITHDRAWAL' },
                    _sum: { amount: true }
                }),
                prisma.contest_wallets.count({
                    where: {
                        contests: {
                            status: {
                                in: ['completed', 'cancelled']
                            }
                        }
                    }
                })
            ]);

            // Initialize stats
            this.rakeStats.amounts.total_raked = totalRaked._sum.amount || 0;
            this.rakeStats.wallets.total = totalWallets;

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify({
                ...this.stats,
                rakeStats: this.rakeStats
            }));

            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            logApi.info('\t\tWallet Rake Service initialized', {
            //    totalRaked: this.rakeStats.amounts.total_raked,
            //    totalWallets: this.rakeStats.wallets.total
            });

            return true;
        } catch (error) {
            logApi.error('Wallet Rake Service initialization error:', error);
            await this.handleError(error);
            throw error;
        }
    }

    /**
     * Decrypts a private key stored by ContestWalletService (expected v2_seed format).
     * @param {string} encryptedDataJson - The encrypted private key data (JSON string from DB).
     * @returns {Buffer} - The decrypted 32-byte private key seed as a Buffer.
     */
    decryptPrivateKey(encryptedDataJson) {
        let parsedData;
        try {
            parsedData = JSON.parse(encryptedDataJson);
        } catch (e) {
            logApi.error('[WalletRakeService] Failed to parse encryptedDataJson', { data: encryptedDataJson, error: e.message });
            throw ServiceError.operation('Failed to decrypt key: Invalid JSON format.', { type: 'DECRYPTION_ERROR_JSON_PARSE' });
        }

        // Expecting keys from ContestWalletService which should be 'v2_seed' or similar from our refactor
        if (parsedData.version && (parsedData.version === 'v2_seed' || parsedData.version.startsWith('v2_seed'))) {
            try {
                const { encrypted, iv, tag, aad } = parsedData;
                if (!encrypted || !iv || !tag || !aad) {
                    throw new Error(`Encrypted key (version: ${parsedData.version}) is missing required fields.`);
                }
                const decipher = crypto.createDecipheriv(
                    'aes-256-gcm', // Assuming standard AES-256-GCM
                    Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                    Buffer.from(iv, 'hex')
                );
                decipher.setAuthTag(Buffer.from(tag, 'hex'));
                decipher.setAAD(Buffer.from(aad, 'hex'));
                let decryptedSeed = decipher.update(Buffer.from(encrypted, 'hex'));
                decryptedSeed = Buffer.concat([decryptedSeed, decipher.final()]);
                if (decryptedSeed.length !== 32) {
                    throw new Error(`Decrypted seed (version: ${parsedData.version}) is not 32 bytes, got ${decryptedSeed.length} bytes.`);
                }
                return decryptedSeed; // Return 32-byte seed Buffer
            } catch (error) {
                logApi.error('[WalletRakeService] Failed to decrypt v2_seed format private key:', { error: error.message, version: parsedData.version });
                throw ServiceError.operation('Failed to decrypt v2_seed format private key', {
                    originalError: error.message, type: 'DECRYPTION_ERROR_V2_SEED'
                });
            }
        } else {
            // This service should ONLY be dealing with keys created by ContestWalletService or similar v2 services.
            // Legacy key formats from other sources are not expected here.
            logApi.error('[WalletRakeService] Unrecognized encrypted private key format or version for contest wallet key.', { parsedData });
            throw ServiceError.operation('Unrecognized encrypted key format for contest wallet.', {
                version: parsedData.version, type: 'DECRYPTION_ERROR_UNRECOGNIZED'
            });
        }
    }

    // Process a single wallet
    async processWallet(wallet, adminContext = null) {
        const startTime = Date.now();
        
        try {
            // Skip if processed too recently
            const lastProcessed = this.rakeStats.wallets.last_processed[wallet.wallet_address];
            if (lastProcessed && (Date.now() - lastProcessed) < this.config.checkIntervalMs) {
                this.rakeStats.wallets.skipped++;
                return null;
            }

            const balanceResult = await solanaEngine.executeConnectionMethod('getBalance', wallet.wallet_address);
            const balanceLamports = balanceResult.value;
            
            const minBalanceLamports = Math.round(this.config.wallet.min_balance_sol * LAMPORTS_PER_SOL_V2);
            const minRakeAmountLamports = Math.round(this.config.wallet.min_rake_amount * LAMPORTS_PER_SOL_V2);

            if (balanceLamports <= minBalanceLamports) {
                this.rakeStats.wallets.skipped++;
                return null;
            }

            const rakeAmountLamports = balanceLamports - minBalanceLamports;
            if (rakeAmountLamports < minRakeAmountLamports) {
                this.rakeStats.wallets.skipped++;
                return null;
            }

            const decryptedSeed_32bytes = this.decryptPrivateKey(wallet.private_key);
            const rakeSourceSigner_v2 = await createKeyPairSignerFromBytes(decryptedSeed_32bytes);

            // Verify derived address matches stored address
            if (rakeSourceSigner_v2.address !== wallet.wallet_address) {
                logApi.error('[WalletRakeService] CRITICAL: Derived address from decrypted seed MISMATCHES stored wallet address!', 
                    { stored: wallet.wallet_address, derived: rakeSourceSigner_v2.address, contestId: wallet.contest_id });
                throw new ServiceError.security('Rake source wallet address mismatch after decryption.');
            }

            // Add to active operations
            this.activeOperations.set(wallet.wallet_address, {
                startTime,
                contestId: wallet.contest_id,
                amount: rakeAmountLamports
            });

            // Set timeout
            const timeout = setTimeout(() => {
                this.activeOperations.delete(wallet.wallet_address);
                this.rakeStats.wallets.failed++;
                logApi.error('Rake operation timeout:', {
                    wallet: wallet.wallet_address,
                    contest: wallet.contest_id
                });
            }, this.config.processing.operationTimeoutMs);
            
            this.operationTimeouts.add(timeout);

            // V2 Rake Transfer
            const v2RakeInstruction = createSystemTransferInstruction({
                fromAddress: rakeSourceSigner_v2.address,
                toAddress: v2Address(this.config.wallet.master_wallet),
                lamports: BigInt(rakeAmountLamports)
            });

            const txResult = await solanaEngine.sendTransaction(
                [v2RakeInstruction],
                rakeSourceSigner_v2.address,
                [rakeSourceSigner_v2],
                { commitment: 'confirmed' }
            );
            const signature = txResult.signature;
            
            // Clear timeout and active operation
            clearTimeout(timeout);
            this.operationTimeouts.delete(timeout);
            this.activeOperations.delete(wallet.wallet_address);

            // Update statistics
            this.rakeStats.operations.total++;
            this.rakeStats.operations.successful++;
            this.rakeStats.amounts.total_raked += rakeAmountLamports / LAMPORTS_PER_SOL_V2;
            this.rakeStats.amounts.by_contest[wallet.contest_id] = 
                (this.rakeStats.amounts.by_contest[wallet.contest_id] || 0) + (rakeAmountLamports / LAMPORTS_PER_SOL_V2);
            this.rakeStats.wallets.processed++;

            // Log admin action if context provided
            if (adminContext) {
                await AdminLogger.logAction(
                    adminContext.admin_address,
                    'WALLET_RAKE',
                    {
                        contest_id: wallet.contest_id,
                        wallet_address: wallet.wallet_address,
                        amount: rakeAmountLamports / LAMPORTS_PER_SOL_V2,
                        signature: signature
                    },
                    adminContext
                );
            }

            // Ensure Prisma logging uses correct amounts and potentially a new type like 'RAKE_TRANSFER'
            await prisma.transactions.create({
                data: {
                    wallet_address: rakeSourceSigner_v2.address,
                    type: 'RAKE_TRANSFER', // More specific type
                    amount: new Decimal(rakeAmountLamports / LAMPORTS_PER_SOL_V2),
                    balance_before: balanceLamports / LAMPORTS_PER_SOL_V2,
                    balance_after: (balanceLamports - rakeAmountLamports) / LAMPORTS_PER_SOL_V2,
                    description: `Rake operation from contest ${wallet.contest_code || wallet.contest_id}`,
                    status: config.transaction_statuses.COMPLETED,
                    blockchain_signature: signature,
                    completed_at: new Date(),
                    created_at: new Date(),
                    user_id: wallet.created_by_user_id,
                    contest_id: wallet.contest_id
                }
            });

            return { signature, transaction: {
                wallet_address: wallet.wallet_address,
                type: 'WITHDRAWAL',
                amount: rakeAmountLamports / LAMPORTS_PER_SOL_V2,
                balance_before: balanceLamports / LAMPORTS_PER_SOL_V2,
                balance_after: (balanceLamports - rakeAmountLamports) / LAMPORTS_PER_SOL_V2,
                description: `Rake operation from contest ${wallet.contest_code || wallet.contest_id}`,
                status: config.transaction_statuses.COMPLETED,
                blockchain_signature: signature,
                completed_at: new Date(),
                created_at: new Date(),
                user_id: wallet.created_by_user_id,
                contest_id: wallet.contest_id
            } };
        } catch (error) {
            this.rakeStats.operations.total++;
            this.rakeStats.operations.failed++;
            this.rakeStats.wallets.failed++;
            throw error;
        } finally {
            // Update performance metrics
            const duration = Date.now() - startTime;
            this.rakeStats.performance.last_rake_time_ms = duration;
            this.rakeStats.performance.average_rake_time_ms = 
                (this.rakeStats.performance.average_rake_time_ms * (this.rakeStats.operations.total - 1) + duration) / 
                this.rakeStats.operations.total;
        }
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
                logApi.debug(`[${this.name}] Service not operational, skipping operation`);
                return true;
            }
            
            // Call the original performOperation implementation
            await this.performOperation();
            
            return true;
        } catch (error) {
            logApi.error(`[${this.name}] Perform operation error: ${error.message}`);
            throw error; // Important: re-throw to trigger circuit breaker
        }
    }

    // Main operation implementation
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Check dependency health
            const contestWalletStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.CONTEST_WALLET);
            this.rakeStats.dependencies.contestWallet = {
                status: contestWalletStatus ? 'healthy' : 'unhealthy',
                lastCheck: new Date().toISOString(),
                errors: contestWalletStatus ? 0 : this.rakeStats.dependencies.contestWallet.errors + 1
            };

            if (!contestWalletStatus) {
                throw ServiceError.dependency('Contest Wallet Service unhealthy');
            }

            // Get eligible contest wallets
            const contestWallets = await prisma.contest_wallets.findMany({
                where: {
                    contests: {
                        status: {
                            in: ['completed', 'cancelled']
                        }
                    }
                },
                include: {
                    contests: {
                        select: {
                            id: true,
                            status: true,
                            contest_code: true
                        }
                    }
                }
            });

            // Process wallets in batches
            const results = [];
            for (let i = 0; i < contestWallets.length; i += this.config.processing.batchSize) {
                const batch = contestWallets.slice(i, i + this.config.processing.batchSize);
                const batchStartTime = Date.now();

                // Process batch with parallel limit
                const batchPromises = batch.map(wallet => this.processWallet(wallet));
                const batchResults = await Promise.allSettled(batchPromises);

                // Update batch stats
                this.rakeStats.batches.total++;
                const successfulBatch = batchResults.filter(r => r.status === 'fulfilled').length;
                this.rakeStats.batches.successful += successfulBatch;
                this.rakeStats.batches.failed += batchResults.length - successfulBatch;
                this.rakeStats.batches.average_size = 
                    (this.rakeStats.batches.average_size * (this.rakeStats.batches.total - 1) + batch.length) / 
                    this.rakeStats.batches.total;

                // Update performance metrics
                const batchDuration = Date.now() - batchStartTime;
                this.rakeStats.performance.average_batch_time_ms = 
                    (this.rakeStats.performance.average_batch_time_ms * (this.rakeStats.batches.total - 1) + batchDuration) / 
                    this.rakeStats.batches.total;

                // Collect results
                batchResults.forEach((result, index) => {
                    if (result.status === 'fulfilled' && result.value) {
                        results.push({
                            wallet: batch[index].wallet_address,
                            contest: batch[index].contest_id,
                            status: 'success',
                            signature: result.value.signature
                        });
                    } else if (result.status === 'rejected') {
                        results.push({
                            wallet: batch[index].wallet_address,
                            contest: batch[index].contest_id,
                            status: 'failed',
                            error: result.reason.message
                        });
                    }
                });
            }

            // Update ServiceManager state
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    rakeStats: this.rakeStats
                }
            );

            return {
                duration: Date.now() - startTime,
                processed: results.length,
                successful: results.filter(r => r.status === 'success').length,
                failed: results.filter(r => r.status === 'failed').length,
                results
            };
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            throw error;
        }
    }

    // Admin operation: Force rake specific wallet
    async forceRakeWallet(walletAddress, adminAddress, context = {}) {
        try {
            const wallet = await prisma.contest_wallets.findFirst({
                where: { wallet_address: walletAddress },
                include: {
                    contests: {
                        select: {
                            id: true,
                            status: true
                        }
                    }
                }
            });

            if (!wallet) {
                throw ServiceError.validation('Wallet not found');
            }

            const result = await this.processWallet(wallet, {
                admin_address: adminAddress,
                ...context
            });

            return {
                success: true,
                data: result
            };
        } catch (error) {
            logApi.error('Force rake operation failed:', error);
            throw error;
        }
    }

    // Stop the service
    async stop() {
        try {
            await super.stop();
            
            // Clear all timeouts
            for (const timeout of this.operationTimeouts) {
                clearTimeout(timeout);
            }
            this.operationTimeouts.clear();
            
            // Clear active operations
            this.activeOperations.clear();
            
            // Final stats update
            await serviceManager.markServiceStopped(
                this.name,
                this.config,
                {
                    ...this.stats,
                    rakeStats: this.rakeStats
                }
            );
            
            logApi.info('Wallet Rake Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Wallet Rake Service:', error);
            throw error;
        }
    }
}

// Export service singleton
const walletRakeService = new WalletRakeService();
export default walletRakeService;