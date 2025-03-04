// services/contestWalletService.js

/*
 * This service is responsible for managing the contest wallets.
 * It allows the admin to create and manage contest wallets.
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
import { fancyColors } from '../utils/colors.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
// Solana
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import crypto from 'crypto';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import { fa } from '@faker-js/faker';

const CONTEST_WALLET_CONFIG = {
    name: SERVICE_NAMES.CONTEST_WALLET,
    description: getServiceMetadata(SERVICE_NAMES.CONTEST_WALLET).description,
    checkIntervalMs: 1 * 60 * 1000, // Check every 1 minute
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
        ////super(CONTEST_WALLET_CONFIG.name, CONTEST_WALLET_CONFIG);
        super(CONTEST_WALLET_CONFIG);
        
        // Initialize Solana connection
        // TODO: Shouldn't this use our existing Solana service?
        this.connection = new Connection(config.rpc_urls.primary, "confirmed");
        
        // Service-specific state
        this.walletStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            wallets: {
                created: 0,
                generated: 0,
                updated: 0
            },
            balance_updates: {
                total: 0,
                successful: 0,
                failed: 0,
                last_update: null
            },
            errors: {
                creation_failures: 0,
                encryption_failures: 0,
                balance_update_failures: 0,
                last_error: null
            },
            performance: {
                average_creation_time_ms: 0,
                average_balance_update_time_ms: 0,
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

    // Create a new contest wallet
    async createContestWallet(contestId, adminContext = null) {
        if (this.stats.circuitBreaker.isOpen) {
            throw ServiceError.operation('Circuit breaker is open for wallet creation');
        }

        const startTime = Date.now();
        try {
            // Generate a new wallet
            const keypair = Keypair.generate();
            const contestWallet = await prisma.contest_wallets.create({
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
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} \n\t${fancyColors.GREEN}Created contest wallet with generated keypair${fancyColors.RESET}`, {
                contest_id: contestId
            });

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
                        wallet_address: contestWallet.wallet_address
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

    // Fetch and update Solana balance for a wallet
    async updateWalletBalance(wallet) {
        try {
            const startTime = Date.now();
            
            // Skip if no wallet address
            if (!wallet.wallet_address) {
                return {
                    success: false,
                    error: 'No wallet address provided'
                };
            }
            
            // Get current Solana balance
            const publicKey = new PublicKey(wallet.wallet_address);
            const lamports = await this.connection.getBalance(publicKey);
            const solBalance = lamports / LAMPORTS_PER_SOL;
            
            //// Log balance update
            //logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BLACK}Balance of wallet ${wallet.wallet_address} is ${lamports} lamports${fancyColors.RESET} (${solBalance} SOL)`);
            //logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Updating balance for ${fancyColors.BOLD_YELLOW}Contest ${wallet.contests?.id}${fancyColors.RESET} (${fancyColors.BOLD_YELLOW}${wallet.contests?.contest_code}${fancyColors.RESET})${fancyColors.RESET}`, {
            //    contest_id: wallet.contests?.id,
            //    contest_code: wallet.contests?.contest_code,
            //    balance: solBalance
            //});

            // Update wallet in database
            await prisma.contest_wallets.update({
                where: { id: wallet.id },
                data: {
                    balance: solBalance,
                    last_sync: new Date(),
                    updated_at: new Date() // duplicate of last_sync?
                }
            });

            // Only log contest wallet balance update if there's been a change >= 0.01 SOL
            if (solBalance !== wallet.balance && Math.abs(solBalance - wallet.balance) >= 0.01) {
                logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET}  ${fancyColors.GREEN}Updated balance for ${fancyColors.BOLD_GREEN}Contest ${wallet.contests?.id}${fancyColors.RESET} (${fancyColors.BLACK}${wallet.contests?.contest_code}${fancyColors.RESET})${fancyColors.RESET} \n\t${fancyColors.RAINBOW_BLUE}${fancyColors.BOLD}Change: ${(solBalance - wallet.balance).toFixed(4)} SOL${fancyColors.RESET} \t${fancyColors.BLUE}${fancyColors.UNDERLINE}www.solscan.io/address/${wallet.wallet_address}${fancyColors.RESET}`, {
                //    contest_id: wallet.contests?.id,
                //    contest_code: wallet.contests?.contest_code,
                //    balance: solBalance
                });
            }
            
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
            
            return {
                success: true,
                wallet_address: wallet.wallet_address,
                previous_balance: wallet.balance,
                current_balance: solBalance,
                difference: solBalance - wallet.balance
            };
        } catch (error) {
            // Update error stats
            this.walletStats.balance_updates.failed++;
            this.walletStats.errors.balance_update_failures++;
            this.walletStats.errors.last_error = error.message;
            
            logApi.error(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.RED}Failed to update wallet balance${fancyColors.RESET}`, {
                wallet_address: wallet.wallet_address,
                error: error.message,
                stack: error.stack
            });
            
            return {
                success: false,
                wallet_address: wallet.wallet_address,
                error: error.message
            };
        }
    }
    
    // Bulk update all wallets' balances
    async updateAllWalletBalances() {
        logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.GALAXY}Contest wallet balance refresh cycle starting...${fancyColors.RESET}`, {
        //    duration_ms: Date.now() - startTime,
        //    total_wallets: results.total,
        //    successful_updates: results.updated,
        //    failed_updates: results.failed,
        //    active_contests: results.active_contests,
        //    significant_changes: results.updates.length
        });

        const startTime = Date.now();
        try {
            // Get all contest wallets
            const contestWallets = await prisma.contest_wallets.findMany({
                include: {
                    contests: {
                        select: {
                            status: true,
                            id: true,
                            contest_code: true
                        }
                    }
                }
            });
            
            const results = {
                total: contestWallets.length,
                updated: 0,
                failed: 0,
                active_contests: 0,
                updates: []
            };
            
            // Sort contest wallets by contest ID
            contestWallets.sort((a, b) => a.contests?.id - b.contests?.id);
            
            // Update each wallet's balance
            for (const wallet of contestWallets) {
                try {
                    // Track active contests
                    if (wallet.contests?.status === 'active') {
                        results.active_contests++;
                    }
                    
                    // Update balance
                    const updateResult = await this.updateWalletBalance(wallet);
                    
                    if (updateResult.success) {
                        results.updated++;
                        
                        // Only add significant balance changes to the results  
                        if (Math.abs(updateResult.difference) > 0.0001) {
                            results.updates.push(updateResult);
                            logApi.info(`${fancyColors.MAGENTA}[contestWalletService] ⚠️ ${fancyColors.RESET} ${fancyColors.BOLD_YELLOW}${fancyColors.BG_BROWN}Significant balance change${fancyColors.RESET} ${fancyColors.BOLD_YELLOW}detected for ${fancyColors.BOLD_YELLOW}Contest ${wallet.contests?.id}${fancyColors.RESET} (${fancyColors.BOLD_YELLOW}${wallet.contests?.contest_code}${fancyColors.RESET})${fancyColors.RESET} \n\t\t${fancyColors.BLUE}${fancyColors.UNDERLINE}https://solscan.io/address/${wallet.wallet_address}${fancyColors.RESET}\n`, {
                                contest_id: wallet.contests?.id,
                                contest_code: wallet.contests?.contest_code,
                                wallet_address: wallet.wallet_address,
                                previous_balance: updateResult.previous_balance,
                                current_balance: updateResult.current_balance,
                                difference: updateResult.difference
                            });
                        }
                    } else {
                        results.failed++;
                        logApi.warn(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.RED}Failed to update ${fancyColors.BOLD_YELLOW}Contest ${wallet.contests?.id}${fancyColors.RESET} (${fancyColors.BOLD_YELLOW}${wallet.contests?.contest_code}${fancyColors.RESET})${fancyColors.RESET} \n\t\t${fancyColors.BLUE}${fancyColors.UNDERLINE}https://solscan.io/address/${wallet.wallet_address}${fancyColors.RESET}\n`, {
                            contest_id: wallet.contests?.id,
                            contest_code: wallet.contests?.contest_code,
                            wallet_address: wallet.wallet_address,
                            error: updateResult.error
                        });
                    }
                } catch (error) {
                    results.failed++;
                    logApi.error(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.RED}Error updating ${fancyColors.BOLD_YELLOW}Contest ${wallet.contests?.id}${fancyColors.RESET} (${fancyColors.BOLD_YELLOW}${wallet.contests?.contest_code}${fancyColors.RESET})${fancyColors.RESET} \n\t\t${fancyColors.BLUE}${fancyColors.UNDERLINE}https://solscan.io/address/${wallet.wallet_address}${fancyColors.RESET}\n`, {
                        wallet_address: wallet.wallet_address,
                        contest_id: wallet.contests?.id,
                        contest_code: wallet.contests?.contest_code,
                        error: error.message
                    });
                }
            }
            
            // Update overall performance stats
            this.walletStats.performance.last_operation_time_ms = Date.now() - startTime;
            
            // Log completion summary
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.GALAXY}Contest wallet balance refresh cycle completed${fancyColors.RESET}`, {
            //    duration_ms: Date.now() - startTime,
            //    total_wallets: results.total,
            //    successful_updates: results.updated,
            //    failed_updates: results.failed,
            //    active_contests: results.active_contests,
            //    significant_changes: results.updates.length
            });
            
            return {
                duration: Date.now() - startTime,
                ...results
            };
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}Failed to update wallet balances${fancyColors.RESET}`, {
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

            // Check each wallet's state
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
            
            // Update all wallet balances
            const balanceUpdateResults = await this.updateAllWalletBalances();
            
            return {
                duration: Date.now() - startTime,
                basic_check: results,
                balance_updates: balanceUpdateResults
            };
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            throw error;
        }
    }
}

// Export service singleton
const contestWalletService = new ContestWalletService();
export default contestWalletService; 