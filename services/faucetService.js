// services/faucetService.js

/*
 * This service is responsible for managing the test SOL faucet.
 * It provides controlled distribution of test SOL to users and
 * automated recovery of unused funds.
 */

// ** Service Auth **
import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
// ** Dependencies **
import walletGeneratorService from './walletGenerationService.js';
// Solana
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
// Other
import LRUCache from 'lru-cache';

const FAUCET_SERVICE_CONFIG = {
    name: SERVICE_NAMES.FAUCET,
    description: getServiceMetadata(SERVICE_NAMES.FAUCET).description,
    checkIntervalMs: 60 * 60 * 1000, // Check every hour
    maxRetries: 3,
    retryDelayMs: 5 * 60 * 1000, // 5 minutes between retries
    circuitBreaker: {
        failureThreshold: 6,
        resetTimeoutMs: 75000,
        minHealthyPeriodMs: 120000
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    },
    cache: {
        maxSize: 1000,
        ttl: 15 * 60 * 1000 // 15 minutes
    },
    faucet: {
    defaultAmount: 0.025,
    minFaucetBalance: 0.05,
    maxTestUsers: 10,
    minConfirmations: 2,
    fees: {
        BASE_FEE: 0.000005,
        RENT_EXEMPTION: 0.00089088
        }
    }
};

class FaucetService extends BaseService {
    constructor() {
        super(FAUCET_SERVICE_CONFIG);
        
        // Initialize Solana connection
        this.connection = new Connection(config.rpc_urls.devnet_http, "confirmed");
        
        // Initialize cache for rate limiting
        this.transactionCache = new LRUCache({
            max: this.config.cache.maxSize || 1000, // Default to 1000 items
            ttl: this.config.cache.ttl || 15 * 60 * 1000 // Default to 15 minutes
        });

        // Initialize service-specific stats
        this.faucetStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            transactions: {
                total: 0,
                successful: 0,
                failed: 0,
                totalAmount: 0,
                averageAmount: 0
            },
            recovery: {
                attempts: 0,
                successful: 0,
                failed: 0,
                totalRecovered: 0
            },
            faucet: {
                balance: 0,
                lastCheck: null,
                recoveryAttempts: 0,
                lowBalanceCount: 0
            },
            performance: {
                averageTransactionTimeMs: 0,
                lastOperationTimeMs: 0,
                confirmationTimeMs: 0
            }
        };
    }

    async initialize() {
        try {
            // Call parent initialize first
            await super.initialize();

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

            // Reset circuit breaker state for fresh initialization
            this.stats.circuitBreaker = {
                isOpen: false,
                failures: 0,
                lastFailure: null,
                lastReset: new Date().toISOString(),
                recoveryTimeout: null
            };

            // Initialize faucet wallet
            await this.initializeFaucetWallet();

            // Start recovery monitoring
            this.startRecoveryMonitoring();

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify({
                ...this.stats,
                faucetStats: this.faucetStats
            }));

            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            logApi.info('Faucet Service initialized');
            return true;
        } catch (error) {
            logApi.error('Faucet Service initialization error:', error);
            await this.handleError(error);
            throw error;
        }
    }

    async initializeFaucetWallet() {
        try {
            // First try to find existing faucet wallet
            let wallet = await prisma.seed_wallets.findFirst({
                where: {
                    purpose: 'faucet',
                    is_active: true
                }
            });

            // If no wallet exists, generate one using WalletGenerator
            if (!wallet) {
                logApi.info('No faucet wallet found, generating new one...');
                const walletInfo = await walletGeneratorService.generateWallet('faucet', {
                    metadata: {
                        purpose: 'faucet',
                        created_at: new Date().toISOString()
                    }
                });

                // Verify the wallet was created
                wallet = await prisma.seed_wallets.findFirst({
                    where: {
                        purpose: 'faucet',
                        is_active: true
                    }
                });

                if (!wallet) {
                    throw ServiceError.operation('Failed to create faucet wallet');
                }
            }

            this.faucetWallet = wallet;
            this.faucetStats.faucet.balance = await this.connection.getBalance(
                new PublicKey(wallet.wallet_address)
            ) / LAMPORTS_PER_SOL;

            // During initialization, don't treat zero balance as a failure
            // Just log a warning and allow initialization to proceed
            if (this.faucetStats.faucet.balance < this.config.faucet.minFaucetBalance) {
                // Reset circuit breaker state since this is initialization
                this.stats.circuitBreaker.failures = 0;
                this.stats.circuitBreaker.isOpen = false;
                this.stats.circuitBreaker.lastReset = new Date().toISOString();
                
                logApi.warn('Faucet wallet initialized with low balance - funding required', {
                    address: wallet.wallet_address,
                    balance: this.faucetStats.faucet.balance,
                    minimum: this.config.faucet.minFaucetBalance
                });
            } else {
                logApi.info('Faucet wallet initialized', {
                    address: wallet.wallet_address,
                    balance: this.faucetStats.faucet.balance
                });
            }

            return true;
        } catch (error) {
            throw ServiceError.operation('Failed to initialize faucet wallet', {
                error: error.message
            });
        }
    }

    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Check faucet balance
            await this.checkBalance();
            
            // Clean up expired transactions
            this.cleanupCache();
            
            // Attempt recovery if needed
            if (this.shouldAttemptRecovery()) {
                await this.recoverFromTestWallets();
            }

            // Update stats
            this.faucetStats.performance.lastOperationTimeMs = Date.now() - startTime;
            this.faucetStats.performance.averageTransactionTimeMs = 
                (this.faucetStats.performance.averageTransactionTimeMs * this.faucetStats.operations.total + 
                (Date.now() - startTime)) / (this.faucetStats.operations.total + 1);

            // Update ServiceManager state - don't count low balance as a failure
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    // Override circuit breaker stats if only issue is low balance
                    circuitBreaker: this.faucetStats.faucet.balance < this.config.faucet.minFaucetBalance
                        ? {
                            ...this.stats.circuitBreaker,
                            isOpen: false,  // Don't open circuit breaker for low balance
                            failures: 0     // Reset failure count
                        }
                        : this.stats.circuitBreaker,
                    faucetStats: this.faucetStats
                }
            );
            
            return {
                balance: this.faucetStats.faucet.balance,
                transactions: this.faucetStats.transactions,
                recovery: this.faucetStats.recovery
            };
        } catch (error) {
            await this.handleError(error);
            return false;
        }
    }

    async checkBalance() {
        try {
            const balance = await this.connection.getBalance(
                new PublicKey(this.faucetWallet.wallet_address)
            );
            
            this.faucetStats.faucet.balance = balance / LAMPORTS_PER_SOL;
            this.faucetStats.faucet.lastCheck = new Date().toISOString();

            if (this.faucetStats.faucet.balance < this.config.faucet.minFaucetBalance) {
                this.faucetStats.faucet.lowBalanceCount++;
                logApi.warn('Faucet balance below minimum', {
                    balance: this.faucetStats.faucet.balance,
                    minimum: this.config.faucet.minFaucetBalance
                });
            }

            return this.faucetStats.faucet.balance;
        } catch (error) {
            throw ServiceError.operation('Failed to check faucet balance', {
                error: error.message
            });
        }
    }

    shouldAttemptRecovery() {
        return (
            this.faucetStats.faucet.balance < this.config.faucet.minFaucetBalance &&
            this.faucetStats.faucet.lowBalanceCount >= 3
        );
    }

    async recoverFromTestWallets() {
        const startTime = Date.now();
        this.faucetStats.recovery.attempts++;

        try {
            // Find test wallets with balance
            const testWallets = await prisma.seed_wallets.findMany({
                where: {
                    purpose: 'test_wallet',
                    is_active: true
                }
            });

            let totalRecovered = 0;
            let successfulRecoveries = 0;

            for (const wallet of testWallets) {
                try {
                    const balance = await this.connection.getBalance(
                        new PublicKey(wallet.wallet_address)
                    );

                    if (balance > LAMPORTS_PER_SOL * 0.01) { // Only recover if > 0.01 SOL
                        const recoveryAmount = balance - (LAMPORTS_PER_SOL * 0.005); // Leave 0.005 SOL
                        
                        await this.executeTransfer(
                            wallet,
                            this.faucetWallet.wallet_address,
                            recoveryAmount,
                            { description: 'Faucet recovery' }
                        );

                        totalRecovered += recoveryAmount / LAMPORTS_PER_SOL;
                        successfulRecoveries++;
                    }
                } catch (error) {
                    logApi.error('Failed to recover from wallet:', {
                        wallet: wallet.wallet_address,
                        error: error.message
                    });
                }
            }

            // Update recovery stats
            this.faucetStats.recovery.successful++;
            this.faucetStats.recovery.totalRecovered += totalRecovered;
            this.faucetStats.faucet.recoveryAttempts++;
            this.faucetStats.faucet.lowBalanceCount = 0; // Reset counter

            logApi.info('Recovery operation completed', {
                recovered: totalRecovered,
                successful: successfulRecoveries,
                duration: Date.now() - startTime
            });

            return {
                recovered: totalRecovered,
                successful: successfulRecoveries
            };
        } catch (error) {
            this.faucetStats.recovery.failed++;
            throw ServiceError.operation('Failed to recover funds', {
                error: error.message
            });
        }
    }

    async sendSOL(toAddress, amount, options = {}) {
        const startTime = Date.now();
        
        try {
            // Validate amount
            if (amount > this.config.faucet.defaultAmount * 2) {
                throw ServiceError.validation('Amount exceeds maximum allowed');
            }

            // Check rate limiting
            if (this.transactionCache.has(toAddress)) {
                throw ServiceError.validation('Rate limit exceeded');
            }

            // Verify faucet balance
            if (this.faucetStats.faucet.balance < (amount + this.config.faucet.minFaucetBalance)) {
                throw ServiceError.operation('Insufficient faucet balance');
            }

            // Execute transfer
            const result = await this.executeTransfer(
                this.faucetWallet,
                toAddress,
                amount * LAMPORTS_PER_SOL,
                options
            );

            // Update stats
            this.faucetStats.transactions.total++;
            this.faucetStats.transactions.successful++;
            this.faucetStats.transactions.totalAmount += amount;
            this.faucetStats.transactions.averageAmount = 
                this.faucetStats.transactions.totalAmount / this.faucetStats.transactions.successful;

            // Add to rate limit cache
            this.transactionCache.set(toAddress, {
                amount,
                timestamp: Date.now()
            });

            return result;
        } catch (error) {
            this.faucetStats.transactions.total++;
            this.faucetStats.transactions.failed++;
            throw error;
        } finally {
            this.faucetStats.performance.lastOperationTimeMs = Date.now() - startTime;
        }
    }

    async executeTransfer(sourceWallet, toAddress, amount, options = {}) {
        try {
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: new PublicKey(sourceWallet.wallet_address),
                    toPubkey: new PublicKey(toAddress),
                    lamports: amount
                })
            );

            const signature = await this.connection.sendTransaction(
                transaction,
                [Keypair.fromSecretKey(bs58.decode(sourceWallet.private_key))]
            );

            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction(
                signature,
                this.config.faucet.minConfirmations
            );

            if (confirmation.value.err) {
                throw ServiceError.operation('Transaction failed', {
                    error: confirmation.value.err
                });
            }

            // Log transaction
            await prisma.transactions.create({
                data: {
                    wallet_address: sourceWallet.wallet_address,
                    type: 'FAUCET_TRANSFER',
                    amount: amount / LAMPORTS_PER_SOL,
                    description: options.description || 'Faucet distribution',
                    status: 'completed',
                        blockchain_signature: signature,
                    completed_at: new Date()
                }
            });

            return {
                signature,
                amount: amount / LAMPORTS_PER_SOL
            };
        } catch (error) {
            throw ServiceError.operation('Transfer failed', {
                error: error.message,
                source: sourceWallet.wallet_address,
                destination: toAddress,
                amount: amount / LAMPORTS_PER_SOL
            });
        }
    }

    startRecoveryMonitoring() {
        // Check balance every hour
        setInterval(async () => {
            try {
                await this.checkBalance();
                
                if (this.shouldAttemptRecovery()) {
                    await this.recoverFromTestWallets();
                }
            } catch (error) {
                logApi.error('Recovery monitoring error:', error);
            }
        }, this.config.checkIntervalMs);
    }

    cleanupCache() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, value] of this.transactionCache.entries()) {
            if (now - value.timestamp > this.config.cache.ttl) {
                this.transactionCache.delete(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            logApi.info(`Cleaned ${cleaned} expired transaction(s) from cache`);
        }
    }

    async stop() {
        try {
            await super.stop();
            
            // Clear intervals
                clearInterval(this.recoveryInterval);

            logApi.info('Faucet Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Faucet Service:', error);
            throw error;
        }
    }
}

// Create and export singleton instance
const faucetService = new FaucetService();
export default faucetService;
