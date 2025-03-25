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
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
import { fancyColors } from '../utils/colors.js';
// ** Service Manager **
//import serviceManager from '../utils/service-suite/service-manager.js';

// Solana
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import { transferSOL } from '../utils/solana-suite/web3-v2/solana-transaction-fixed.js';
//import { fa } from '@faker-js/faker';

// Config
import { config } from '../config/config.js';

// Contest Wallet Config
const CONTEST_WALLET_CONFIG = {
    name:
        SERVICE_NAMES.CONTEST_WALLET, // get name from central service metadata
    description:
        getServiceMetadata(SERVICE_NAMES.CONTEST_WALLET).description, // get description from central service metadata
    checkIntervalMs:
        config.service_intervals.contest_wallet_check_cycle_interval * 1000, // cycle through all contest wallets (get all contest wallet balances)
    treasury: {
        walletAddress: config.master_wallet.treasury_address
    },
    reclaim: {
        minimumBalanceToReclaim: config.service_thresholds.contest_wallet_min_balance_for_reclaim, // SOL - minimum balance to consider reclaiming
        minimumAmountToTransfer: config.service_thresholds.contest_wallet_min_amount_to_transfer, // SOL - don't transfer if amount is too small
        contestStatuses: ['completed', 'cancelled'] // Only reclaim from contests with these statuses (i.e., not 'active' nor 'pending')
    },
    wallet: {
        encryption_algorithm: 'aes-256-gcm',
        min_balance_sol: config.service_thresholds.contest_wallet_min_balance_for_reclaim // minimum balance to consider reclaiming
    },
    circuitBreaker: {
        failureThreshold: 5, // number of failures before circuit is open
        resetTimeoutMs: 60 * 1000, // 1 minute timeout when circuit is open
        minHealthyPeriodMs: 120 * 1000 // 2 minutes of health before fully resetting
    },
    backoff: {
        initialDelayMs: 1 * 1000, // 1 second
        maxDelayMs: 30 * 1000, // 30 seconds
        factor: 2 // exponential backoff
    },
    // loose config vars, kept for backwards compatibility:
    maxRetries: 3, // maximum number of retries
    retryDelayMs: 5 * 1000, // 5 seconds
};

// Contest Wallet Service
class ContestWalletService extends BaseService {
    constructor() {
        ////super(CONTEST_WALLET_CONFIG.name, CONTEST_WALLET_CONFIG);
        super(CONTEST_WALLET_CONFIG);
        
        // Initialize Solana connection
        if (!config.rpc_urls.primary) {
            throw new Error("RPC URL is not configured - check SOLANA_MAINNET_HTTP environment variable");
        }
        
        logApi.info(`[contestWalletService] Initializing with RPC: ${config.rpc_urls.primary}`);
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
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} DEBUG: Searching for vanity wallets... ${fancyColors.RESET}`);
            
            // Check DUEL folder first (higher priority)
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BLUE}DEBUG: Checking _DUEL folder first${fancyColors.RESET}`);
            const duelWallet = await this.getFirstUnassociatedWalletFromFolder('_DUEL');
            if (duelWallet) {
                logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}DEBUG: Found DUEL wallet: ${duelWallet.publicKey}${fancyColors.RESET}`);
                return duelWallet;
            }
            
            // Then try DEGEN folder
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BLUE}DEBUG: Checking _DEGEN folder next${fancyColors.RESET}`);
            const degenWallet = await this.getFirstUnassociatedWalletFromFolder('_DEGEN');
            if (degenWallet) {
                logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}DEBUG: Found DEGEN wallet: ${degenWallet.publicKey}${fancyColors.RESET}`);
                return degenWallet;
            }
            
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}DEBUG: No vanity wallets found in either folder${fancyColors.RESET}`);
            return null;
        } catch (error) {
            logApi.warn(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} DEBUG: Error finding vanity wallet: ${error.message} ${fancyColors.RESET}`, {
                error: error.message,
                stack: error.stack
            });
            return null;
        }
    }

    async getFirstUnassociatedWalletFromFolder(folderName) {
        try {
            const fs = await import('fs/promises');
            const dirPath = `/home/websites/degenduel/addresses/keypairs/public/${folderName}`;
            
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BLUE}DEBUG: Checking directory: ${dirPath}${fancyColors.RESET}`);
            
            // Get files in directory
            const files = await fs.readdir(dirPath);
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BLUE}DEBUG: Found ${files.length} files in ${folderName} directory${fancyColors.RESET}`);
            
            // Filter for JSON files
            const keypairFiles = files.filter(f => f.endsWith('.json'));
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BLUE}DEBUG: Found ${keypairFiles.length} JSON files in ${folderName} directory${fancyColors.RESET}`);
            
            if (keypairFiles.length > 0) {
                logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BLUE}DEBUG: First few keypair files: ${keypairFiles.slice(0, 3).join(', ')}${fancyColors.RESET}`);
            }
            
            for (const file of keypairFiles) {
                // Extract public key from filename
                const publicKey = file.replace('.json', '');
                logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BLUE}DEBUG: Checking wallet: ${publicKey}${fancyColors.RESET}`);
                
                // Check if already in database
                const existing = await prisma.contest_wallets.findFirst({
                    where: { wallet_address: publicKey }
                });
                
                if (existing) {
                    logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}DEBUG: Wallet already used: ${publicKey}${fancyColors.RESET}`);
                    continue;
                }
                
                // If the wallet is not in the database, decrypt the private key and return it
                if (!existing) {
                    // Found an unassociated wallet
                    const keypairPath = `${dirPath}/${file}`;
                    const privateKeyPath = `/home/websites/degenduel/addresses/pkeys/public/${folderName}/${publicKey}.key`;
                    
                    logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BLUE}DEBUG: Looking for private key at: ${privateKeyPath}${fancyColors.RESET}`);
                    
                    try {
                        // Check if private key file exists
                        await fs.access(privateKeyPath);
                        
                        // Read unencrypted private key
                        const privateKey = await fs.readFile(privateKeyPath, 'utf8');
                        logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}DEBUG: Read private key with length: ${privateKey.length}${fancyColors.RESET}`);
                        
                        logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Found unassociated vanity wallet:${fancyColors.RESET} ${publicKey}`);
                        
                        // Return the unassociated wallet without encrypting the private key
                        return { 
                            publicKey, 
                            privateKey: privateKey.trim(),
                            isVanity: true,
                            vanityType: folderName.replace('_', '')
                        };
                    } catch (accessError) {
                        logApi.warn(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.RED}DEBUG: Cannot access private key file: ${accessError.message}${fancyColors.RESET}`);
                        continue; // Try next wallet
                    }
                }
            }
            
            // No unassociated wallets found
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}No unassociated wallets found in folder ${folderName}${fancyColors.RESET}`);
            return null;
        } catch (error) {
            logApi.warn(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} DEBUG: Failed to check folder ${folderName}: ${error.message} ${fancyColors.RESET}`, {
                error: error.message,
                stack: error.stack,
                folder: folderName
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
            logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} DEBUG: Starting contest wallet creation for contest ID: ${contestId} ${fancyColors.RESET}`);
            
            // Try to get a vanity address first
            const vanityWallet = await this.getUnassociatedVanityWallet();
            
            let contestWallet;
            if (vanityWallet) {
                logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} DEBUG: Using vanity wallet for contest ${contestId} ${fancyColors.RESET}`);
                logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}DEBUG: Vanity details: ${JSON.stringify({
                    publicKey: vanityWallet.publicKey,
                    privateKeyLength: vanityWallet.privateKey.length,
                    isVanity: vanityWallet.isVanity,
                    vanityType: vanityWallet.vanityType
                })}${fancyColors.RESET}`);
                
                // Use the vanity wallet
                try {
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
                    
                    logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}DEBUG: Successfully created DB record for vanity wallet${fancyColors.RESET}`);
                    logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} \n\t${fancyColors.GREEN}Created contest wallet with ${vanityWallet.vanityType} vanity address${fancyColors.RESET}`, {
                        contest_id: contestId,
                        vanity_type: vanityWallet.vanityType,
                        is_vanity: contestWallet.is_vanity
                    });
                } catch (dbError) {
                    logApi.error(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} DEBUG: Failed to create vanity wallet DB record: ${dbError.message} ${fancyColors.RESET}`, {
                        error: dbError.message,
                        stack: dbError.stack,
                        contestId,
                        publicKey: vanityWallet.publicKey
                    });
                    throw dbError;
                }
            } else {
                logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}DEBUG: No vanity wallet available, generating random wallet${fancyColors.RESET}`);
                
                // Fall back to random address generation
                const keypair = Keypair.generate();
                const publicKey = keypair.publicKey.toString();
                const secretKeyBase64 = Buffer.from(keypair.secretKey).toString('base64');
                
                logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BLUE}DEBUG: Generated random wallet: ${publicKey}${fancyColors.RESET}`);
                
                try {
                    contestWallet = await prisma.contest_wallets.create({
                        data: {
                            contest_id: contestId,
                            wallet_address: publicKey,
                            private_key: this.encryptPrivateKey(secretKeyBase64),
                            balance: 0,
                            created_at: new Date(),
                            is_vanity: false
                        }
                    });
                    
                    logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}DEBUG: Successfully created DB record for random wallet${fancyColors.RESET}`);
                    logApi.info(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} \n\t${fancyColors.YELLOW}Created contest wallet with random address (no vanity addresses available)${fancyColors.RESET}`, {
                        contest_id: contestId,
                        is_vanity: contestWallet.is_vanity
                    });
                } catch (dbError) {
                    logApi.error(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} DEBUG: Failed to create random wallet DB record: ${dbError.message} ${fancyColors.RESET}`, {
                        error: dbError.message,
                        stack: dbError.stack,
                        contestId,
                        publicKey
                    });
                    throw dbError;
                }
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
        logApi.info(`[contestWalletService] Contest wallet balance refresh cycle starting`);

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
            
            // Sort contest wallets by contest ID (ascending; last are the contest wallets most recently created)
            contestWallets.sort((a, b) => a.contests?.id - b.contests?.id);
            
            // Track active contests
            contestWallets.forEach(wallet => {
                if (wallet.contests?.status === 'active') {
                    results.active_contests++;
                }
            });
            
            // Process contest wallets in batches
            // Use configured batch size from config
            const BATCH_SIZE = config.solana_timeouts.rpc_wallet_batch_size || 10;
            
            // Calculate total batches needed to process all contest wallets
            let currentBatch = 0;
            const totalBatches = Math.ceil(contestWallets.length / BATCH_SIZE);
            
            // Track rate limit hits to implement exponential backoff
            let consecutiveRateLimitHits = 0;
            
            // Set dynamic delay based on total batches to spread requests
            const baseDelayBetweenBatches = Math.max(1000, Math.min(5000, 300 * totalBatches));
            
            // Process each batch of contest wallets
            while (currentBatch < totalBatches) {
                // Calculate start and end indices for current batch
                const startIndex = currentBatch * BATCH_SIZE;
                const endIndex = Math.min(startIndex + BATCH_SIZE, contestWallets.length);
                const walletBatch = contestWallets.slice(startIndex, endIndex);
                
                // Create batch of PublicKeys
                const publicKeys = walletBatch.map(wallet => new PublicKey(wallet.wallet_address));
                
                // Calculate delay based on consecutive rate limit hits 
                try {
                    // Implement exponential backoff with higher base delay: 1000ms → 2000ms → 4000ms → 8000ms → 16000ms
                    const delayBetweenBatches = Math.min(16000, 
                        consecutiveRateLimitHits === 0 ? baseDelayBetweenBatches : Math.pow(2, consecutiveRateLimitHits) * baseDelayBetweenBatches);
                    
                    // Log the batch being processed
                    logApi.info(`[contestWalletService] Getting balances of contest wallets #${startIndex+1}-${endIndex} (batch ${currentBatch+1} of ${totalBatches}), waiting ${delayBetweenBatches}ms between batches`);
                    
                    // Add delay before EVERY request to avoid rate limits, not just after the first one
                    await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
                    
                    // Get balances of all contest wallets from a single RPC call
                    const balances = await this.connection.getMultipleAccountsInfo(publicKeys);
                    
                    // Reset consecutive rate limit counter on success
                    consecutiveRateLimitHits = 0;
                    
                    // Collect DB updates to do in a single transaction
                    const dbUpdates = [];
                    const balanceChanges = [];

                    // Process each contest wallet in the batch with its balance                    
                    for (let i = 0; i < walletBatch.length; i++) {
                        const wallet = walletBatch[i];
                        const accountInfo = balances[i];
                        
                        try {
                            // If account doesn't exist yet, it has 0 balance
                            const lamports = accountInfo ? accountInfo.lamports : 0;
                            const solBalance = lamports / LAMPORTS_PER_SOL;
                            
                            // Compare with previous balance
                            const previousBalance = wallet.balance || 0;
                            const difference = solBalance - previousBalance;
                            
                            // Collect update for batch processing
                            dbUpdates.push({
                                wallet_id: wallet.id,
                                balance: solBalance
                            });
                            
                            // Track successful update
                            results.updated++;
                            
                            // Log notable balance changes (≥ 0.0001 SOL)
                            if (Math.abs(difference) >= 0.0001) {
                                balanceChanges.push({
                                    wallet_address: wallet.wallet_address,
                                    previous_balance: previousBalance,
                                    current_balance: solBalance,
                                    difference: difference,
                                    contest_id: wallet.contests?.id,
                                    contest_code: wallet.contests?.contest_code
                                });
                            }
                        } catch (error) {
                            // Log error
                            results.failed++;
                            logApi.error(`[contestWalletService] Error processing wallet ${wallet.wallet_address}:`, {
                                error: error.message,
                                wallet_address: wallet.wallet_address,
                                contest_id: wallet.contests?.id,
                                contest_code: wallet.contests?.contest_code
                            });
                        }
                    }
                    
                    // Process all database updates in a single transaction to reduce database load
                    if (dbUpdates.length > 0) {
                        await prisma.$transaction(async (tx) => {
                            const now = new Date();
                            for (const update of dbUpdates) {
                                await tx.contest_wallets.update({
                                    where: { id: update.wallet_id },
                                    data: {
                                        balance: update.balance,
                                        last_sync: now,
                                        updated_at: now
                                    }
                                });
                            }
                        });
                    }
                    
                    // Log balance changes separately
                    for (const change of balanceChanges) {
                        results.updates.push({
                            success: true,
                            wallet_address: change.wallet_address,
                            previous_balance: change.previous_balance,
                            current_balance: change.current_balance,
                            difference: change.difference
                        });
                        
                        logApi.info(`[contestWalletService] Balance of contest wallet ${change.contest_id} (${change.contest_code}) has changed by ${change.difference.toFixed(4)} SOL \n\t${fancyColors.BLUE}${fancyColors.UNDERLINE}https://solscan.io/address/${change.wallet_address}${fancyColors.RESET}`);
                    }
                } catch (error) {
                    // Check if this is a rate limit error
                    const isRateLimited = error.message.includes('429') || 
                                         error.message.includes('rate') || 
                                         error.message.includes('limit') ||
                                         error.message.includes('requests per second') ||
                                         error.message.includes('too many requests');
                    
                    if (isRateLimited) {
                        // Increment consecutive rate limit counter
                        consecutiveRateLimitHits++;
                        
                        // Get config values with defaults
                        const RPC_RATE_LIMIT_RETRY_DELAY = (config.solana_timeouts.rpc_rate_limit_retry_delay || 15) * 1000; // convert to ms
                        const RPC_RATE_LIMIT_RETRY_BACKOFF_FACTOR = config.solana_timeouts.rpc_rate_limit_retry_backoff_factor || 2;
                        const RPC_RATE_LIMIT_MAX_DELAY = (config.solana_timeouts.rpc_rate_limit_max_delay || 30) * 1000; // convert to ms
                        
                        // Calculate exponential backoff delay with more configurable approach
                        const backoffDelay = Math.min(
                            RPC_RATE_LIMIT_MAX_DELAY, 
                            RPC_RATE_LIMIT_RETRY_DELAY * Math.pow(RPC_RATE_LIMIT_RETRY_BACKOFF_FACTOR, consecutiveRateLimitHits - 1)
                        );
                        
                        // Log rate limit error
                        logApi.warn(`${fancyColors.MAGENTA}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} SOLANA RPC RATE LIMIT ${fancyColors.RESET} ${fancyColors.RED}Hit #${consecutiveRateLimitHits} - Adding ${backoffDelay}ms delay${fancyColors.RESET}`, {
                            service: 'SOLANA',
                            error_type: 'RATE_LIMIT',
                            batch: currentBatch + 1,
                            total_batches: totalBatches,
                            retry_ms: backoffDelay,
                            consecutive_hits: consecutiveRateLimitHits,
                            rpc_provider: config.rpc_urls.primary,
                            original_message: error.message,
                            severity: 'warning',
                            alert_type: 'rate_limit'
                        });
                        
                        // Wait longer based on consecutive failures
                        await new Promise(resolve => setTimeout(resolve, backoffDelay));
                        
                        // Don't increment currentBatch - retry the same batch
                        continue;
                    } else {
                        // For non-rate limit errors, log and move on
                        results.failed += walletBatch.length;
                        logApi.error(`[contestWalletService] Failed to fetch batch ${currentBatch+1}:`, {
                            error: error.message,
                            batch_size: walletBatch.length
                        });
                        
                        // Standard delay for general errors
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
                
                // Move to the next batch
                currentBatch++;
            }
            
            // Update overall performance stats
            this.walletStats.performance.last_operation_time_ms = Date.now() - startTime;
            this.walletStats.balance_updates.total += results.updated;
            this.walletStats.balance_updates.successful += results.updated;
            this.walletStats.balance_updates.failed += results.failed;
            
            // Log completion
            logApi.info(`[contestWalletService] Contest wallet balance refresh cycle completed: ${results.updated}/${results.total} wallets updated in ${((Date.now() - startTime)/1000).toFixed(1)}s`);
            
            // Add a cooldown period after batch completion to prevent immediate rate limiting in other services
            // This helps spread out the RPC calls across the system
            const cooldownMs = 2000; // 2 second cooldown
            await new Promise(resolve => setTimeout(resolve, cooldownMs));
            logApi.info(`[contestWalletService] RPC cooldown period (${cooldownMs}ms) completed after wallet balance update`);
            
            return {
                duration: Date.now() - startTime,
                ...results
            };
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            logApi.error(`[contestWalletService] Failed to update wallet balances:`, {
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
            
            // Process wallets in smaller batches to avoid rate limiting
            // For reclaiming funds, use half the normal batch size for extra safety
            const BATCH_SIZE = Math.max(1, Math.floor((config.solana_timeouts.rpc_wallet_batch_size || 10) / 2));
            let walletIndex = 0;
            
            // Track rate limit hits for adaptive delays
            let consecutiveRateLimitHits = 0;
            
            // Set more aggressive base delay for reclaiming (higher stakes operation)
            const baseDelayBetweenBatches = Math.max(2000, Math.min(8000, 500 * Math.ceil(eligibleWallets.length/BATCH_SIZE)));
            
            while (walletIndex < eligibleWallets.length) {
                // Extract current batch
                const endIndex = Math.min(walletIndex + BATCH_SIZE, eligibleWallets.length);
                const walletBatch = eligibleWallets.slice(walletIndex, endIndex);
                
                // Calculate adaptive delay between batches - more conservative for fund reclaiming
                const delayBetweenBatches = Math.min(20000, consecutiveRateLimitHits === 0 ? 
                    baseDelayBetweenBatches : Math.pow(2, consecutiveRateLimitHits) * baseDelayBetweenBatches);
                
                logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} Processing reclaim batch ${Math.floor(walletIndex/BATCH_SIZE)+1}/${Math.ceil(eligibleWallets.length/BATCH_SIZE)} (${walletBatch.length} wallets) - Delay: ${delayBetweenBatches}ms`);
                
                // Always wait between batches, even for the first one
                await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
                
                try {
                    // Create batch of PublicKeys
                    const publicKeys = walletBatch.map(wallet => new PublicKey(wallet.wallet_address));
                    
                    // Get multiple balances in a single RPC call
                    const balanceInfos = await this.connection.getMultipleAccountsInfo(publicKeys);
                    
                    // Reset consecutive rate limit counter on success
                    consecutiveRateLimitHits = 0;
                    
                    // Process each wallet with its balance
                    for (let i = 0; i < walletBatch.length; i++) {
                        const wallet = walletBatch[i];
                        const accountInfo = balanceInfos[i];
                        
                        try {
                            // If account doesn't exist yet, it has 0 balance
                            const lamports = accountInfo ? accountInfo.lamports : 0;
                            const solBalance = lamports / LAMPORTS_PER_SOL;
                            
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
                    
                    // Move to the next batch
                    walletIndex += BATCH_SIZE;
                    
                } catch (error) {
                    // Check if this is a rate limit error
                    const isRateLimited = error.message && (
                        error.message.includes('429') || 
                        error.message.includes('rate') || 
                        error.message.includes('limit') ||
                        error.message.includes('requests per second') ||
                        error.message.includes('too many requests')
                    );
                    
                    if (isRateLimited) {
                        // Increment consecutive rate limit counter
                        consecutiveRateLimitHits++;
                        
                        // Get config values with defaults - with higher values for reclaiming operations
                        const RPC_RATE_LIMIT_RETRY_DELAY = (config.solana_timeouts.rpc_rate_limit_retry_delay || 15) * 1000 * 2; // 2x regular delay for reclaiming
                        const RPC_RATE_LIMIT_RETRY_BACKOFF_FACTOR = config.solana_timeouts.rpc_rate_limit_retry_backoff_factor || 2;
                        const RPC_RATE_LIMIT_MAX_DELAY = (config.solana_timeouts.rpc_rate_limit_max_delay || 30) * 1000 * 1.5; // 1.5x max delay for reclaiming
                        
                        // Calculate exponential backoff delay with more configurable approach
                        const backoffDelay = Math.min(
                            RPC_RATE_LIMIT_MAX_DELAY, 
                            RPC_RATE_LIMIT_RETRY_DELAY * Math.pow(RPC_RATE_LIMIT_RETRY_BACKOFF_FACTOR, consecutiveRateLimitHits - 1)
                        );
                        
                        logApi.warn(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} SOLANA RPC RATE LIMIT ${fancyColors.RESET} ${fancyColors.RED}Hit #${consecutiveRateLimitHits} - Adding ${backoffDelay}ms delay${fancyColors.RESET}`, {
                            service: 'SOLANA',
                            error_type: 'RATE_LIMIT',
                            batch: Math.floor(walletIndex/BATCH_SIZE)+1,
                            total_batches: Math.ceil(eligibleWallets.length/BATCH_SIZE),
                            retry_ms: backoffDelay,
                            consecutive_hits: consecutiveRateLimitHits,
                            rpc_provider: config.rpc_urls.primary,
                            original_message: error.message,
                            severity: 'warning',
                            alert_type: 'rate_limit'
                        });
                        
                        // Wait longer based on consecutive failures
                        await new Promise(resolve => setTimeout(resolve, backoffDelay));
                        
                        // Don't increment walletIndex - retry the same batch
                    } else {
                        // For non-rate limit errors, log and move on
                        results.failedTransfers += walletBatch.length;
                        logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} Failed to fetch balance batch:`, {
                            error: error.message,
                            batch_size: walletBatch.length
                        });
                        
                        // Standard delay for general errors
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Move to next batch
                        walletIndex += BATCH_SIZE;
                    }
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