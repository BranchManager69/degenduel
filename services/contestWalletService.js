// services/contestWalletService.js

/*
 * This service is responsible for managing the contest wallets.
 * It allows the admin to create and manage contest wallets.
 * 
 */

// ** Service Auth **
import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import VanityWalletService from './vanityWalletService.js'; // Service Subclass
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../utils/service-suite/service-error.js';
import { config } from '../config/config.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
// ** Service Manager (?) **
import { ServiceManager } from '../utils/service-suite/service-manager.js';
// Solana
import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';

const CONTEST_WALLET_CONFIG = {
    name: 'contest_wallet_service',
    checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
    maxRetries: 3,
    retryDelayMs: 5000,
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
        encryption_algorithm: 'aes-256-gcm',
        min_balance_sol: 0.01
    }
};

// Contest Wallet Service
class ContestWalletService extends BaseService {
    constructor() {
        super(CONTEST_WALLET_CONFIG.name, CONTEST_WALLET_CONFIG);
        
        // Service-specific state
        this.walletStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            wallets: {
                created: 0,
                vanity_used: 0,
                generated: 0
            },
            errors: {
                creation_failures: 0,
                encryption_failures: 0,
                last_error: null
            },
            performance: {
                average_creation_time_ms: 0,
                last_operation_time_ms: 0
            }
        };
    }

    // Encrypt wallet private key
    encryptPrivateKey(privateKey) {
        try {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(
                this.config.wallet.encryption_algorithm,
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                iv
            );

            const encrypted = Buffer.concat([
                cipher.update(privateKey, 'utf8'),
                cipher.final()
            ]);

            const tag = cipher.getAuthTag();

            return JSON.stringify({
                encrypted: encrypted.toString('hex'),
                iv: iv.toString('hex'),
                tag: tag.toString('hex')
            });
        } catch (error) {
            this.walletStats.errors.encryption_failures++;
            this.walletStats.errors.last_error = error.message;
            throw ServiceError.operation('Failed to encrypt wallet key', {
                error: error.message,
                type: 'ENCRYPTION_ERROR'
            });
        }
    }

    // Create a new contest wallet, trying vanity wallet first
    async createContestWallet(contestId, preferredPattern = null, adminContext = null) {
        if (this.stats.circuitBreaker.isOpen) {
            throw ServiceError.operation('Circuit breaker is open for wallet creation');
        }

        const startTime = Date.now();
        try {
            // First, try to get a vanity wallet
            const vanityWallet = await VanityWalletService.getAvailableWallet(preferredPattern);
            
            let contestWallet;
            if (vanityWallet) {
                // Create contest wallet using vanity wallet
                contestWallet = await prisma.contest_wallets.create({
                    data: {
                        contest_id: contestId,
                        wallet_address: vanityWallet.wallet_address,
                        private_key: vanityWallet.private_key,
                        balance: 0,
                        created_at: new Date()
                    }
                });

                // Mark vanity wallet as used
                await VanityWalletService.assignWalletToContest(vanityWallet.id, contestId);

                this.walletStats.wallets.vanity_used++;
                logApi.info('Created contest wallet using vanity wallet', {
                    contest_id: contestId,
                    pattern: vanityWallet.pattern
                });
            } else {
                // If no vanity wallet available, generate a new one
                const keypair = Keypair.generate();
                contestWallet = await prisma.contest_wallets.create({
                    data: {
                        contest_id: contestId,
                        wallet_address: keypair.publicKey.toString(),
                        private_key: this.encryptPrivateKey(
                            Buffer.from(keypair.secretKey).toString('base64')
                        ),
                        balance: 0,
                        created_at: new Date()
                    }
                });

                this.walletStats.wallets.generated++;
                logApi.info('Created contest wallet with generated keypair', {
                    contest_id: contestId
                });
            }

            // Update statistics
            await this.recordSuccess();
            this.walletStats.wallets.created++;
            this.walletStats.operations.successful++;
            this.walletStats.performance.last_operation_time_ms = Date.now() - startTime;
            this.walletStats.performance.average_creation_time_ms = 
                (this.walletStats.performance.average_creation_time_ms * this.walletStats.operations.total + 
                (Date.now() - startTime)) / (this.walletStats.operations.total + 1);

            // Log admin action if context provided
            if (adminContext) {
                await AdminLogger.logAction(
                    adminContext.admin_address,
                    'CONTEST_WALLET_CREATE',
                    {
                        contest_id: contestId,
                        wallet_address: contestWallet.wallet_address,
                        used_vanity: !!vanityWallet
                    },
                    adminContext
                );
            }

            return contestWallet;
        } catch (error) {
            // Update error statistics
            this.walletStats.operations.failed++;
            this.walletStats.errors.creation_failures++;
            this.walletStats.errors.last_error = error.message;

            await this.handleError(error);
            throw error;
        }
    }

    // Main operation implementation - periodic health checks
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Get all contest wallets
            const contestWallets = await prisma.contest_wallets.findMany({
                include: {
                    contests: {
                        select: {
                            status: true
                        }
                    }
                }
            });

            // Check each wallet's state
            const results = {
                total: contestWallets.length,
                active: 0,
                completed: 0,
                issues: []
            };

            for (const wallet of contestWallets) {
                try {
                    if (wallet.contests?.status === 'active') {
                        results.active++;
                        // Additional health checks could be added here
                    } else if (wallet.contests?.status === 'completed') {
                        results.completed++;
                    }
                } catch (error) {
                    results.issues.push({
                        wallet: wallet.wallet_address,
                        error: error.message
                    });
                }
            }

            return {
                duration: Date.now() - startTime,
                ...results
            };
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            throw error;
        }
    }
}

// Create and export singleton instance
const contestWalletService = new ContestWalletService();
export default contestWalletService; 