// services/walletRakeService.js

/*
 * This service is responsible for collecting leftover Solana from contest wallets.
 * It should check all already-evaluated contests every 10 minutes for leftover SOL/tokens.
 *   Remember, the contestEvaluateService should have already transferred all prizes to the contest winners.
 *   Therefore, if anything is left over, it belongs to us and should be transferred to the 'main' DegenDuel wallet.
 * For buffer purposes, I will always want to keep 0.01 SOL in contest wallets; account for this while raking.
 *
 * DegenDuel's 'main' wallet address to rake contest wallet funds to: BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp (my main personal wallet!)
 *
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
import ServiceManager from '../utils/service-suite/service-manager.js';
// Solana
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';
// Other
import { Decimal } from '@prisma/client/runtime/library';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';

const WALLET_RAKE_CONFIG = {
    name: SERVICE_NAMES.WALLET_RAKE,
    description: getServiceMetadata(SERVICE_NAMES.WALLET_RAKE).description,
    checkIntervalMs: 10 * 60 * 1000, // Check every 10 minutes
    maxRetries: 3,
    retryDelayMs: 5 * 60 * 1000, // 5 minutes between retries
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000, // 1 minute timeout when circuit is open
        minHealthyPeriodMs: 120000 // 2 minutes of health before fully resetting
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
    }
};

// Wallet Rake Service
class WalletRakeService extends BaseService {
    constructor() {
        super(WALLET_RAKE_CONFIG.name, WALLET_RAKE_CONFIG);
        
        // Initialize Solana connection
        this.connection = new Connection(config.rpc_urls.primary, "confirmed");
        
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
            performance: {
                average_rake_time_ms: 0,
                last_rake_time_ms: 0
            }
        };
    }

    // Utility: Decrypt wallet private key
    decryptPrivateKey(encryptedData) {
        try {
            const { encrypted, iv, tag, aad } = JSON.parse(encryptedData);
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                Buffer.from(iv, 'hex')
            );
            
            decipher.setAuthTag(Buffer.from(tag, 'hex'));
            if (aad) decipher.setAAD(Buffer.from(aad));
            
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(encrypted, 'hex')),
                decipher.final()
            ]);
            
            return decrypted.toString();
        } catch (error) {
            throw ServiceError.operation('Failed to decrypt wallet key', {
                error: error.message,
                type: 'DECRYPTION_ERROR'
            });
        }
    }

    // Core operation: Transfer SOL with safety checks
    async transferSOL(fromKeypair, amount, contestId, retryCount = 0) {
        try {
            // Verify current balance before transfer
            const currentBalance = await this.connection.getBalance(fromKeypair.publicKey);
            const minRequired = this.config.wallet.min_balance_sol * LAMPORTS_PER_SOL;
            
            if (currentBalance < (amount + minRequired)) {
                throw ServiceError.validation('Insufficient balance for rake operation', {
                    available: currentBalance / LAMPORTS_PER_SOL,
                    required: (amount + minRequired) / LAMPORTS_PER_SOL
                });
            }

            // Create and send transaction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: new PublicKey(this.config.wallet.master_wallet),
                    lamports: amount,
                })
            );

            const signature = await this.connection.sendTransaction(transaction, [fromKeypair]);
            await this.connection.confirmTransaction(signature);

            // Get contest details for logging
            const contest = await prisma.contests.findUnique({
                where: { id: contestId },
                select: { 
                    created_by_user_id: true,
                    contest_code: true
                }
            });

            // Log the successful rake transaction
            const tx = await prisma.transactions.create({
                data: {
                    wallet_address: fromKeypair.publicKey.toString(),
                    type: config.transaction_types.CONTEST_WALLET_RAKE,
                    amount: amount / LAMPORTS_PER_SOL,
                    balance_before: currentBalance / LAMPORTS_PER_SOL,
                    balance_after: (currentBalance - amount) / LAMPORTS_PER_SOL,
                    description: `Rake operation from contest ${contest?.contest_code || contestId}`,
                    status: config.transaction_statuses.COMPLETED,
                    blockchain_signature: signature,
                    completed_at: new Date(),
                    created_at: new Date(),
                    user_id: contest?.created_by_user_id,
                    contest_id: contestId
                }
            });

            // Update last processed time for this wallet
            this.rakeStats.wallets.last_processed[fromKeypair.publicKey.toString()] = Date.now();

            return { signature, transaction: tx };
        } catch (error) {
            // Log failed rake attempt
            await prisma.transactions.create({
                data: {
                    wallet_address: fromKeypair.publicKey.toString(),
                    type: config.transaction_types.CONTEST_WALLET_RAKE,
                    amount: amount / LAMPORTS_PER_SOL,
                    description: `Failed rake operation: ${error.message}`,
                    status: config.transaction_statuses.FAILED,
                    error_details: JSON.stringify(error),
                    created_at: new Date(),
                    contest_id: contestId
                }
            });

            // Handle retries
            if (retryCount < this.config.maxRetries) {
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
                return this.transferSOL(fromKeypair, amount, contestId, retryCount + 1);
            }

            throw error;
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

            // Get wallet balance
            const pubkey = new PublicKey(wallet.wallet_address);
            const balance = await this.connection.getBalance(pubkey);
            const minBalance = this.config.wallet.min_balance_sol * LAMPORTS_PER_SOL;

            // Skip if balance is too low
            if (balance <= minBalance) {
                this.rakeStats.wallets.skipped++;
                return null;
            }

            // Calculate rake amount
            const rakeAmount = balance - minBalance;
            if (rakeAmount < (this.config.wallet.min_rake_amount * LAMPORTS_PER_SOL)) {
                this.rakeStats.wallets.skipped++;
                return null;
            }

            // Create keypair for transfer
            const decryptedPrivateKey = this.decryptPrivateKey(wallet.private_key);
            const privateKeyBytes = bs58.decode(decryptedPrivateKey);
            const fromKeypair = Keypair.fromSecretKey(privateKeyBytes);

            // Perform transfer with retries
            const result = await this.transferSOL(fromKeypair, rakeAmount, wallet.contest_id);

            // Update statistics
            this.rakeStats.operations.total++;
            this.rakeStats.operations.successful++;
            this.rakeStats.amounts.total_raked += rakeAmount / LAMPORTS_PER_SOL;
            this.rakeStats.amounts.by_contest[wallet.contest_id] = 
                (this.rakeStats.amounts.by_contest[wallet.contest_id] || 0) + (rakeAmount / LAMPORTS_PER_SOL);
            this.rakeStats.wallets.processed++;

            // Log admin action if context provided
            if (adminContext) {
                await AdminLogger.logAction(
                    adminContext.admin_address,
                    'WALLET_RAKE',
                    {
                        contest_id: wallet.contest_id,
                        wallet_address: wallet.wallet_address,
                        amount: rakeAmount / LAMPORTS_PER_SOL,
                        signature: result.signature
                    },
                    adminContext
                );
            }

            return result;
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

    // Main operation implementation
    async performOperation() {
        const startTime = Date.now();
        
        try {
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

            // Process each wallet
            const results = [];
            for (const wallet of contestWallets) {
                try {
                    const result = await this.processWallet(wallet);
                    if (result) {
                        results.push({
                            wallet: wallet.wallet_address,
                            contest: wallet.contest_id,
                            status: 'success',
                            signature: result.signature
                        });
                    }
                } catch (error) {
                    results.push({
                        wallet: wallet.wallet_address,
                        contest: wallet.contest_id,
                        status: 'failed',
                        error: error.message
                    });
                    
                    // Let circuit breaker handle consecutive failures
                    if (error.isServiceError) throw error;
                }
            }

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
}

// Export service singleton
const walletRakeService = new WalletRakeService();
export default walletRakeService;