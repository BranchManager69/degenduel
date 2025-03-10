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
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import { fa } from '@faker-js/faker';
import { transferSOL } from '../utils/solana-suite/web3-v2/solana-transaction-v2.js';

const CONTEST_WALLET_CONFIG = {
    name: SERVICE_NAMES.CONTEST_WALLET,
    description: getServiceMetadata(SERVICE_NAMES.CONTEST_WALLET).description,
    checkIntervalMs: 1 * 60 * 1000, // Check every 1 minute
    treasury: {
        walletAddress: process.env.TREASURY_WALLET_ADDRESS || 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'
    },
    reclaim: {
        minimumBalanceToReclaim: 0.001, // SOL - minimum balance to consider reclaiming
        minimumAmountToTransfer: 0.0005, // SOL - don't transfer if amount is too small
        contestStatuses: ['completed', 'cancelled'] // Only reclaim from these statuses
    },
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
        if (!config.rpc_urls.primary) {
            throw new Error("RPC URL is not configured - check QUICKNODE_MAINNET_HTTP environment variable");
        }
        
        logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} Initializing with RPC: ${config.rpc_urls.primary}`);
        this.connection = new Connection(config.rpc_urls.primary, "confirmed");
        
        // Set treasury wallet address from config
        this.treasuryWalletAddress = CONTEST_WALLET_CONFIG.treasury.walletAddress;
        
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
            reclaimed_funds: {
                total_operations: 0,
                successful_operations: 0,
                failed_operations: 0,
                total_amount: 0,
                last_reclaim: null
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

    // Get unassociated vanity wallet
    async getUnassociatedVanityWallet() {
        try {
            // Check DUEL folder first (higher priority)
            const duelWallet = await this.getFirstUnassociatedWalletFromFolder('_DUEL');
            if (duelWallet) return duelWallet;
            
            // Then try DEGEN folder
            return this.getFirstUnassociatedWalletFromFolder('_DEGEN');
        } catch (error) {
            logApi.warn(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to get unassociated vanity wallet:${fancyColors.RESET}`, {
                error: error.message
            });
            return null;
        }
    }

    async getFirstUnassociatedWalletFromFolder(folderName) {
        try {
            const fs = await import('fs/promises');
            const dirPath = `/home/websites/degenduel/addresses/keypairs/public/${folderName}`;
            
            // Get files in directory
            const files = await fs.readdir(dirPath);
            
            // Filter for JSON files
            const keypairFiles = files.filter(f => f.endsWith('.json'));
            
            for (const file of keypairFiles) {
                // Extract public key from filename
                const publicKey = file.replace('.json', '');
                
                // Check if already in database
                const existing = await prisma.contest_wallets.findFirst({
                    where: { wallet_address: publicKey }
                });
                
                // If the wallet is not in the database, decrypt the private key and return it
                if (!existing) {
                    // Found an unassociated wallet
                    const keypairPath = `${dirPath}/${file}`;
                    const privateKeyPath = `/home/websites/degenduel/addresses/pkeys/public/${folderName}/${publicKey}.key`;
                    
                    // Read unencrypted private key
                    const privateKey = await fs.readFile(privateKeyPath, 'utf8');
                    
                    logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Found unassociated vanity wallet:${fancyColors.RESET} ${publicKey}`);
                    
                    // Return the unassociated wallet without encrypting the private key
                    return { 
                        publicKey, 
                        privateKey: privateKey.trim(),
                        isVanity: true,
                        vanityType: folderName.replace('_', '')
                    };
                }
            }
            
            // No unassociated wallets found
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}No unassociated wallets found in folder ${folderName}${fancyColors.RESET}`);
            return null;
        } catch (error) {
            logApi.warn(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to check folder ${folderName}:${fancyColors.RESET}`, {
                error: error.message
            });
            return null;
        }
    }

    // Create a new contest wallet
    async createContestWallet(contestId, adminContext = null) {
        if (this.stats.circuitBreaker.isOpen) {
            throw ServiceError.operation('Circuit breaker is open for wallet creation');
        }

        const startTime = Date.now();
        try {
            // Try to get a vanity address first
            const vanityWallet = await this.getUnassociatedVanityWallet();
            
            let contestWallet;
            if (vanityWallet) {
                // Use the vanity wallet
                contestWallet = await prisma.contest_wallets.create({
                    data: {
                        contest_id: contestId,
                        wallet_address: vanityWallet.publicKey,
                        private_key: this.encryptPrivateKey(vanityWallet.privateKey),
                        balance: 0,
                        created_at: new Date(),
                        is_vanity: true,
                        vanity_type: vanityWallet.vanityType
                    }
                });
                
                logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} \n\t${fancyColors.GREEN}Created contest wallet with ${vanityWallet.vanityType} vanity address${fancyColors.RESET}`, {
                    contest_id: contestId,
                    vanity_type: vanityWallet.vanityType
                });
            } else {
                // Fall back to random address generation
                const keypair = Keypair.generate();
                contestWallet = await prisma.contest_wallets.create({
                    data: {
                        contest_id: contestId,
                        wallet_address: keypair.publicKey.toString(),
                        private_key: this.encryptPrivateKey(
                            Buffer.from(keypair.secretKey).toString('base64')
                        ),
                        balance: 0,
                        created_at: new Date(),
                        is_vanity: false
                    }
                });
                
                logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} \n\t${fancyColors.YELLOW}Created contest wallet with random address (no vanity addresses available)${fancyColors.RESET}`, {
                    contest_id: contestId
                });
            }

            this.walletStats.wallets.generated++;

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
                        is_vanity: contestWallet.is_vanity || false,
                        vanity_type: contestWallet.vanity_type || null
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
        logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET}     ${fancyColors.GALAXY} Contest wallet balance refresh cycle starting   ${fancyColors.RESET}`, {
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
            
            // Track results
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
            // TODO: Bulk update all wallets' balances
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
            
            // Log completion
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET}     ${fancyColors.GALAXY} Contest wallet balance refresh cycle completed  ${fancyColors.RESET}`, {
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
            // Let the base class handle the error and circuit breaker
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
            // TODO: Bulk update all wallets' balances
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
    
    /**
     * Decrypt private key from encrypted storage
     * @param {string} encryptedData - The encrypted private key data
     * @returns {string} - The decrypted private key
     */
    decryptPrivateKey(encryptedData) {
        try {
            const { encrypted, iv, tag, aad } = JSON.parse(encryptedData);
            const decipher = crypto.createDecipheriv(
                this.config.wallet.encryption_algorithm,
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
            throw ServiceError.operation('Failed to decrypt private key', {
                error: error.message,
                type: 'DECRYPTION_ERROR'
            });
        }
    }

    /**
     * Perform a blockchain transfer from a contest wallet to a destination address
     * @param {Object} sourceWallet - The source wallet object containing encrypted private key
     * @param {string} destinationAddress - The destination wallet address
     * @param {number} amount - The amount to transfer in SOL
     * @returns {Promise<string>} - The transaction signature
     */
    async performBlockchainTransfer(sourceWallet, destinationAddress, amount) {
        try {
            const decryptedPrivateKey = this.decryptPrivateKey(sourceWallet.private_key);
            const privateKeyBytes = bs58.decode(decryptedPrivateKey);
            const fromKeypair = Keypair.fromSecretKey(privateKeyBytes);

            // Use the new v2 transaction utility
            const { signature } = await transferSOL(
                this.connection,
                fromKeypair,
                destinationAddress,
                amount
            );

            return signature;
        } catch (error) {
            throw ServiceError.blockchain('Blockchain transfer failed', {
                error: error.message,
                sourceWallet: sourceWallet.wallet_address,
                destination: destinationAddress,
                amount
            });
        }
    }

    /**
     * Reclaims funds from completed or cancelled contest wallets back to the treasury
     * 
     * @param {Object} options Optional parameters
     * @param {string[]} options.statusFilter Contest statuses to filter by (default: ['completed', 'cancelled'])
     * @param {number} options.minBalance Minimum balance to consider reclaiming (default: 0.001 SOL)
     * @param {number} options.minTransfer Minimum amount to transfer (default: 0.0005 SOL)
     * @param {string} options.specificContestId Optional specific contest ID to reclaim from
     * @param {string} options.adminAddress Admin wallet address for logging
     * @returns {Promise<Object>} Result summary
     */
    async reclaimUnusedFunds(options = {}) {
        const {
            statusFilter = this.config.reclaim.contestStatuses,
            minBalance = this.config.reclaim.minimumBalanceToReclaim,
            minTransfer = this.config.reclaim.minimumAmountToTransfer,
            specificContestId = null,
            adminAddress = 'SYSTEM'
        } = options;

        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_MAGENTA}Starting reclaim operation for unused contest funds${fancyColors.RESET}`);
        
        try {
            // Get eligible contest wallets based on filters
            const query = {
                include: {
                    contests: {
                        select: {
                            id: true,
                            contest_code: true,
                            status: true
                        }
                    }
                },
                where: {}
            };
            
            // Add filters
            if (specificContestId) {
                query.where.contest_id = parseInt(specificContestId);
            } else {
                query.where.contests = {
                    status: { in: statusFilter }
                };
            }
            
            const eligibleWallets = await prisma.contest_wallets.findMany(query);
            
            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} Found ${eligibleWallets.length} eligible wallets to check for reclaiming`);
            
            // Track results
            const results = {
                totalWallets: eligibleWallets.length,
                walletsThatMeetCriteria: 0,
                successfulTransfers: 0,
                failedTransfers: 0,
                totalAmountReclaimed: 0,
                details: []
            };
            
            // Process each wallet
            for (const wallet of eligibleWallets) {
                try {
                    // Get latest balance
                    const publicKey = new PublicKey(wallet.wallet_address);
                    const balance = await this.connection.getBalance(publicKey);
                    const solBalance = balance / LAMPORTS_PER_SOL;
                    
                    // Update wallet balance in database
                    await prisma.contest_wallets.update({
                        where: { id: wallet.id },
                        data: {
                            balance: solBalance,
                            last_sync: new Date()
                        }
                    });
                    
                    // Check if balance meets minimum criteria
                    if (solBalance < minBalance) {
                        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} Skipping wallet ${wallet.wallet_address} with low balance: ${solBalance.toFixed(6)} SOL`);
                        results.details.push({
                            contest_id: wallet.contest_id,
                            contest_code: wallet.contests?.contest_code,
                            wallet_address: wallet.wallet_address,
                            balance: solBalance,
                            status: 'skipped_low_balance'
                        });
                        continue;
                    }
                    
                    // Reserve a small amount for fees, approximately 0.0005 SOL (5000 lamports)
                    const reserveAmount = 0.0005;
                    const transferAmount = solBalance - reserveAmount;
                    
                    // Skip if transfer amount is too small
                    if (transferAmount < minTransfer) {
                        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} Skipping transfer from ${wallet.wallet_address}, amount too small: ${transferAmount.toFixed(6)} SOL`);
                        results.details.push({
                            contest_id: wallet.contest_id,
                            contest_code: wallet.contests?.contest_code,
                            wallet_address: wallet.wallet_address,
                            balance: solBalance,
                            transferAmount: transferAmount,
                            status: 'skipped_small_transfer'
                        });
                        continue;
                    }
                    
                    results.walletsThatMeetCriteria++;
                    
                    // Perform the transfer
                    logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_GREEN}Transferring ${transferAmount.toFixed(6)} SOL from contest ${wallet.contest_id} (${wallet.contests?.contest_code || 'Unknown'}) to treasury${fancyColors.RESET}`);
                    
                    try {
                        // Create a transaction record
                        const transaction = await prisma.transactions.create({
                            data: {
                                wallet_address: wallet.wallet_address,
                                type: config.transaction_types.WITHDRAWAL,
                                amount: transferAmount,
                                balance_before: solBalance,
                                balance_after: solBalance - transferAmount,
                                contest_id: wallet.contest_id,
                                description: `Reclaiming unused funds from ${wallet.contests?.contest_code || `Contest #${wallet.contest_id}`} wallet to treasury`,
                                status: 'PENDING',
                                created_at: new Date()
                            }
                        });
                        
                        // Perform blockchain transaction
                        const signature = await this.performBlockchainTransfer(
                            wallet,
                            this.treasuryWalletAddress,
                            transferAmount
                        );
                        
                        // Update transaction with success
                        await prisma.transactions.update({
                            where: { id: transaction.id },
                            data: {
                                status: 'COMPLETED',
                                blockchain_signature: signature,
                                completed_at: new Date()
                            }
                        });
                        
                        // Log success
                        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_GREEN}Successfully transferred ${transferAmount.toFixed(6)} SOL to treasury${fancyColors.RESET}
             Signature: ${signature}
             Explorer: https://solscan.io/tx/${signature}`);
                        
                        results.successfulTransfers++;
                        results.totalAmountReclaimed += transferAmount;
                        results.details.push({
                            contest_id: wallet.contest_id,
                            contest_code: wallet.contests?.contest_code,
                            wallet_address: wallet.wallet_address,
                            balance: solBalance,
                            transferAmount: transferAmount,
                            signature: signature,
                            status: 'success'
                        });
                        
                        // Update service stats
                        this.walletStats.reclaimed_funds.total_operations++;
                        this.walletStats.reclaimed_funds.successful_operations++;
                        this.walletStats.reclaimed_funds.total_amount += transferAmount;
                        this.walletStats.reclaimed_funds.last_reclaim = new Date().toISOString();
                        
                        // Log admin action
                        await AdminLogger.logAction(
                            adminAddress,
                            AdminLogger.Actions.WALLET.RECLAIM_FUNDS || 'WALLET_RECLAIM_FUNDS',
                            {
                                contest_id: wallet.contest_id,
                                contest_code: wallet.contests?.contest_code,
                                wallet_address: wallet.wallet_address,
                                amount: transferAmount.toString(),
                                signature: signature
                            }
                        );
                    } catch (error) {
                        logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}Failed to transfer funds from ${wallet.wallet_address}:${fancyColors.RESET}`, error);
                        
                        results.failedTransfers++;
                        this.walletStats.reclaimed_funds.failed_operations++;
                        results.details.push({
                            contest_id: wallet.contest_id,
                            contest_code: wallet.contests?.contest_code,
                            wallet_address: wallet.wallet_address,
                            balance: solBalance,
                            transferAmount: transferAmount,
                            error: error.message,
                            status: 'failed'
                        });
                    }
                } catch (error) {
                    logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}Failed to process wallet ${wallet.wallet_address}:${fancyColors.RESET}`, error);
                    
                    results.failedTransfers++;
                    results.details.push({
                        contest_id: wallet.contest_id,
                        contest_code: wallet.contests?.contest_code || null,
                        wallet_address: wallet.wallet_address,
                        error: error.message,
                        status: 'failed'
                    });
                }
            }
            
            // Summary log
            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_MAGENTA}Reclaim operation completed:${fancyColors.RESET} ${results.successfulTransfers}/${results.walletsThatMeetCriteria} transfers successful, total reclaimed: ${results.totalAmountReclaimed.toFixed(6)} SOL`);
            
            return results;
        } catch (error) {
            logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}Failed to reclaim unused funds:${fancyColors.RESET}`, error);
            throw error;
        }
    }
}

// Export service singleton
const contestWalletService = new ContestWalletService();
export default contestWalletService;