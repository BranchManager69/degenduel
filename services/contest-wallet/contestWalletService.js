// services/contest-wallet/contestWalletService.js

/**
 * Contest Wallet Service
 * 
 * This service is responsible for managing contest wallets.
 * It has been updated to use SolanaEngine which provides enhanced RPC capabilities
 * with multi-endpoint support and automatic failover.
 * 
 * @module services/contest-wallet/contestWalletService
 */

// ** Service Auth **
import { generateServiceAuthHeader } from '../../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../../utils/service-suite/service-error.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import prisma from '../../config/prisma.js';
import { fancyColors, serviceSpecificColors } from '../../utils/colors.js';

// Import SolanaEngine (new direct integration)
import { solanaEngine } from '../../services/solana-engine/index.js';

// Import TreasuryCertifier for certification and stranded funds recovery
import TreasuryCertifier from './treasury-certifier.js';

// Contest Wallet formatting helpers
const formatLog = {
  // Service tag with consistent styling
  tag: () => `${serviceSpecificColors.contestWallet.tag}[contestWalletService]${fancyColors.RESET}`,
  
  // Headers with background highlighting
  header: (text) => `${serviceSpecificColors.contestWallet.header} ${text} ${fancyColors.RESET}`,
  
  // Standard information logs
  info: (text) => `${serviceSpecificColors.contestWallet.info}${text}${fancyColors.RESET}`,
  
  // Success messages
  success: (text) => `${serviceSpecificColors.contestWallet.success}${text}${fancyColors.RESET}`,
  
  // Warning messages
  warning: (text) => `${serviceSpecificColors.contestWallet.warning}${text}${fancyColors.RESET}`,
  
  // Error messages
  error: (text) => `${serviceSpecificColors.contestWallet.error}${text}${fancyColors.RESET}`,
  
  // Highlighted important info
  highlight: (text) => `${serviceSpecificColors.contestWallet.highlight}${text}${fancyColors.RESET}`,
  
  // Batch operation headers
  batch: (text) => `${serviceSpecificColors.contestWallet.batch} ${text} ${fancyColors.RESET}`,
  
  // Transfer operation headers (special case for funds movement)
  transfer: (text) => `${serviceSpecificColors.contestWallet.transfer} ${text} ${fancyColors.RESET}`,
  
  // Format balance with appropriate colors
  balance: (value) => {
    if (value < 0.01) {
      return `${fancyColors.DARK_GRAY}${value.toFixed(4)} SOL${fancyColors.RESET}`; // Very small balance
    } else if (value < 0.1) {
      return `${fancyColors.LIGHT_CYAN}${value.toFixed(4)} SOL${fancyColors.RESET}`; // Small balance
    } else if (value < 1) {
      return `${fancyColors.CYAN}${value.toFixed(4)} SOL${fancyColors.RESET}`; // Medium balance
    } else {
      return `${fancyColors.BOLD_CYAN}${value.toFixed(4)} SOL${fancyColors.RESET}`; // Large balance
    }
  },
  
  // Format balance change with appropriate colors
  balanceChange: (value) => {
    const absValue = Math.abs(value);
    if (absValue < 0.001) {
      return `${fancyColors.DARK_GRAY}${value >= 0 ? '+' : ''}${value.toFixed(6)} SOL${fancyColors.RESET}`;
    } else if (value > 0) {
      return `${absValue > 0.1 ? fancyColors.DARK_GREEN : fancyColors.LIGHT_GREEN}+${value.toFixed(4)} SOL${fancyColors.RESET}`;
    } else {
      return `${absValue > 0.1 ? fancyColors.DARK_RED : fancyColors.LIGHT_RED}${value.toFixed(4)} SOL${fancyColors.RESET}`;
    }
  }
};

// Solana
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';
import { SERVICE_NAMES, getServiceMetadata } from '../../utils/service-suite/service-constants.js';
//import { fa } from '@faker-js/faker';

// Config
import { config } from '../../config/config.js';

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
        encryption_algorithm: 'aes-256-gcm', // Explicitly defining the algorithm here to avoid config dependency
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
/** 
 * This service is responsible for managing the contest wallets.
 * It allows the admin to create and manage contest wallets.
 */
class ContestWalletService extends BaseService {
    /**
     * Constructor for the ContestWalletService
     */
    constructor() {
        super(CONTEST_WALLET_CONFIG);
        
        // Solana connection will be obtained from SolanaEngine
        // We no longer need to initialize our own connection
        
        logApi.info(`${formatLog.tag()} ${formatLog.header('Initializing')} Contest Wallet Service`);
        
        // Initialize TreasuryCertifier
        this.treasuryCertifier = null;
        
        // Debug: Check format objects to ensure they're properly defined
        if (!formatLog.batch || typeof formatLog.batch !== 'function') {
            logApi.error(`${fancyColors.RED}[constructor]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} FORMAT ERROR ${fancyColors.RESET} formatLog.batch is not properly defined: ${typeof formatLog.batch}`);
        } else {
            // Test batch formatting
            const testBatch = formatLog.batch("TEST BATCH MESSAGE");
            logApi.info(`${formatLog.tag()} Test batch formatting: ${testBatch}`);
        }
        
        // Helper method for consistent batch formatting
        this.formatBatchInfo = (operation, cycleId, walletIndex, batchSize, totalWallets) => {
            const currentBatch = Math.floor(walletIndex/batchSize) + 1;
            const totalBatches = Math.ceil(totalWallets/batchSize);
            return {
                label: `${operation} ${cycleId} Batch ${currentBatch}/${totalBatches}`,
                currentBatch,
                totalBatches,
                walletStart: walletIndex + 1,
                walletEnd: Math.min(walletIndex + batchSize, totalWallets),
                totalWallets
            };
        };
        
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
    
    /**
     * Initialize the TreasuryCertifier and perform stranded funds recovery
     * This method initializes the TreasuryCertifier component and
     * runs a scan for any stranded funds from previous certification runs
     * 
     * @returns {Promise<void>}
     */
    async initTreasuryCertifier() {
        try {
            logApi.info(`${formatLog.tag()} ${formatLog.header('TREASURY')} Initializing TreasuryCertifier`);
            
            // Initialize the TreasuryCertifier instance with required dependencies
            this.treasuryCertifier = new TreasuryCertifier({
                solanaEngine,
                prisma,
                logApi,
                formatLog,
                fancyColors,
                decryptPrivateKey: this.decryptPrivateKey.bind(this),
                config
            });
            
            // Scan for and recover any stranded funds from previous certification runs
            logApi.info(`${formatLog.tag()} ${formatLog.header('RECOVERY')} Scanning for stranded certification funds...`);
            
            const recoveryResults = await this.treasuryCertifier.scanForStrandedFunds(this.treasuryWalletAddress);
            
            if (recoveryResults.recoveredFunds) {
                // Update service stats with recovered amounts
                this.walletStats.reclaimed_funds.total_operations++;
                this.walletStats.reclaimed_funds.successful_operations++;
                this.walletStats.reclaimed_funds.total_amount += recoveryResults.totalRecovered || 0;
                this.walletStats.reclaimed_funds.last_reclaim = new Date().toISOString();
                
                logApi.info(`${formatLog.tag()} ${formatLog.success(`Successfully recovered ${recoveryResults.totalRecovered} SOL to treasury`)}`);
                
                // Log detailed recovery information
                if (recoveryResults.details && recoveryResults.details.length > 0) {
                    recoveryResults.details.forEach(detail => {
                        logApi.info(`${formatLog.tag()} ${formatLog.info(`Recovered ${formatLog.balance(detail.recovered)} from ${detail.walletAddress.slice(0, 8)}...`)}`);
                    });
                }
            } else {
                logApi.info(`${formatLog.tag()} ${formatLog.info('No stranded funds found to recover.')}`);
            }
            
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error('TreasuryCertifier initialization error:')}`, {
                error: error.message,
                stack: error.stack
            });
            // Don't throw the error - we want the service to continue even if recovery fails
            this.walletStats.reclaimed_funds.failed_operations++;
            this.walletStats.errors.last_error = `TreasuryCertifier error: ${error.message}`;
        }
    }

    /**
     * Initialize the contest wallet service
     * Overrides the BaseService initialize method to add service profile check
     * and verify SolanaEngine availability
     * 
     * @returns {Promise<boolean>} - True if initialization succeeded, false otherwise
     */
    async initialize() {
        try {
            // Check if contest wallet service is disabled via service profile
            if (!config.services.contest_wallet_service) {
                logApi.warn(`${formatLog.tag()} ${formatLog.header('SERVICE DISABLED')} Contest Wallet Service is disabled in the '${config.services.active_profile}' service profile`);
                return false;
            }
            
            // Call parent initialize
            const success = await super.initialize();
            if (!success) {
                return false;
            }
            
            // Verify SolanaEngine is available
            if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                logApi.warn(`${formatLog.tag()} ${formatLog.header('WAITING FOR SOLANA')} ${formatLog.warning('SolanaEngine not yet initialized, will wait...')}`);
                
                // Add some tolerance for initialization order
                for (let i = 0; i < 5; i++) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    if (typeof solanaEngine.isInitialized === 'function' ? solanaEngine.isInitialized() : solanaEngine.isInitialized) {
                        logApi.info(`${formatLog.tag()} ${formatLog.success('SolanaEngine now available.')}`);
                        break;
                    }
                }
                
                // Final check
                if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                    throw new Error('SolanaEngine is not available after waiting. Contest Wallet Service requires SolanaEngine.');
                }
            }
            
            // Get SolanaEngine connection status
            const connectionStatus = solanaEngine.getConnectionStatus();
            const healthyEndpoints = connectionStatus.healthyEndpoints || 0;
            const totalEndpoints = connectionStatus.totalEndpoints || 0;
            
            logApi.info(`${formatLog.tag()} ${formatLog.success('Contest Wallet Service initialized successfully')}`);
            logApi.info(`${formatLog.tag()} ${formatLog.info(`Using SolanaEngine with ${healthyEndpoints}/${totalEndpoints} healthy RPC endpoints`)}`);
            
            // Initialize the TreasuryCertifier and scan for stranded funds
            // Don't await this - run it in the background to avoid blocking service initialization
            this.initTreasuryCertifier().catch(err => {
                logApi.warn(`${formatLog.tag()} ${formatLog.warning('TreasuryCertifier initialization failed: ' + err.message)}`);
            });
            
            // Run the startup self-test without blocking initialization
            if (process.env.CONTEST_WALLET_SELF_TEST === 'true' || 
                (config.service_test && config.service_test.contest_wallet_self_test)) {
                logApi.info(`${formatLog.tag()} ${formatLog.header('SELF-TEST')} Running wallet self-test in background`);
                
                // Don't await this - run it in the background to avoid blocking service initialization
                this.scheduleSelfTest().then(() => {
                    logApi.info(`${formatLog.tag()} ${formatLog.success('Self-test completed in background')}`);
                }).catch(err => {
                    logApi.warn(`${formatLog.tag()} ${formatLog.warning('Self-test failed in background: ' + err.message)}`);
                });
                
                logApi.info(`${formatLog.tag()} ${formatLog.info('Service initialization continuing - self-test runs in background')}`);
            } else {
                logApi.info(`${formatLog.tag()} ${formatLog.info('Skipping self-test (not enabled)')}`);
            }
            
            return true;
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error('Contest Wallet Service initialization error:')}`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    // Encrypt wallet private key
    /**
     * Encrypt wallet private key
     * 
     * @param {string} privateKey - The private key to encrypt
     * @returns {string} - The encrypted private key
     */
    encryptPrivateKey(privateKey) {
        try {
            const iv = crypto.randomBytes(16);
            
            // Use the local config value for encryption algorithm, which is hardcoded in CONTEST_WALLET_CONFIG
            // This prevents reliance on global config which doesn't have this property
            const algorithm = 'aes-256-gcm'; // Hardcoded to match key-recovery.js
            
            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Using encryption algorithm: ${algorithm} for encryption${fancyColors.RESET}`);
            
            const cipher = crypto.createCipheriv(
                algorithm,
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
    /**
     * Get unassociated vanity wallet from the database
     * 
     * @returns {Promise<Object>} - The results of the operation
     */
    async getUnassociatedVanityWallet() {
        try {
            const VanityApiClient = (await import('../../services/vanity-wallet/vanity-api-client.js')).default;
            logApi.info(`${formatLog.tag()} ${formatLog.header('Searching')} for vanity wallets in database...`);
            
            // Check for DUEL vanity wallet first (higher priority)
            logApi.info(`${formatLog.tag()} ${formatLog.info('Checking for DUEL pattern first')}`);
            const duelWallet = await VanityApiClient.getAvailableVanityWallet('DUEL');
            if (duelWallet) {
                logApi.info(`${formatLog.tag()} ${formatLog.header('Found')} DUEL wallet: ${duelWallet.wallet_address}`);
                
                // Parse the private key from JSON string
                const privateKey = JSON.parse(duelWallet.private_key);
                
                return {
                    publicKey: duelWallet.wallet_address,
                    privateKey: JSON.stringify(privateKey),
                    isVanity: true,
                    vanityType: 'DUEL',
                    dbId: duelWallet.id
                };
            }
            
            // Then check for DEGEN vanity wallet
            logApi.info(`${formatLog.tag()} ${formatLog.info('Checking for DEGEN pattern next')}`);
            const degenWallet = await VanityApiClient.getAvailableVanityWallet('DEGEN');
            if (degenWallet) {
                logApi.info(`${formatLog.tag()} ${formatLog.header('Found')} DEGEN wallet: ${degenWallet.wallet_address}`);
                
                // Parse the private key from JSON string
                const privateKey = JSON.parse(degenWallet.private_key);
                
                return {
                    publicKey: degenWallet.wallet_address,
                    privateKey: JSON.stringify(privateKey),
                    isVanity: true,
                    vanityType: 'DEGEN',
                    dbId: degenWallet.id
                };
            }
            
            // If still no wallet found, try any available vanity wallet
            logApi.info(`${formatLog.tag()} ${formatLog.info('Checking for any available vanity wallet')}`);
            const anyWallet = await VanityApiClient.getAvailableVanityWallet();
            if (anyWallet) {
                logApi.info(`${formatLog.tag()} ${formatLog.header('Found')} vanity wallet with pattern ${anyWallet.pattern}: ${anyWallet.wallet_address}`);
                
                // Parse the private key from JSON string
                const privateKey = JSON.parse(anyWallet.private_key);
                
                return {
                    publicKey: anyWallet.wallet_address,
                    privateKey: JSON.stringify(privateKey),
                    isVanity: true,
                    vanityType: anyWallet.pattern,
                    dbId: anyWallet.id
                };
            }
            
            logApi.info(`${formatLog.tag()} ${formatLog.header('Not Found')} No available vanity wallets in database`);
            return null;
        } catch (error) {
            logApi.warn(`${formatLog.tag()} ${formatLog.header('Error')} Finding vanity wallet: ${formatLog.error(error.message)}`, {
                error: error.message,
                stack: error.stack
            });
            return null;
        }
    }

    // Get first unassociated wallet from folder
    /**
     * Get first unassociated wallet from folder
     * 
     * @param {string} folderName - The name of the folder to check
     * @returns {Promise<Object>} - The results of the operation
     */
    async getFirstUnassociatedWalletFromFolder(folderName) {
        try {
            const fs = await import('fs/promises');
            const dirPath = `/home/websites/degenduel/addresses/keypairs/public/${folderName}`;
            
            logApi.info(`${formatLog.tag()} ${formatLog.info(`Checking directory: ${dirPath}`)}`);
            
            // Get files in directory
            const files = await fs.readdir(dirPath);
            logApi.info(`${formatLog.tag()} ${formatLog.info(`Found ${files.length} files in ${folderName} directory`)}`);
            
            // Filter for JSON files
            const keypairFiles = files.filter(f => f.endsWith('.json'));
            logApi.info(`${formatLog.tag()} ${formatLog.info(`Found ${keypairFiles.length} JSON files in ${folderName} directory`)}`);
            
            if (keypairFiles.length > 0) {
                logApi.info(`${formatLog.tag()} ${formatLog.info(`First few keypair files: ${keypairFiles.slice(0, 3).join(', ')}`)}`);
            }
            
            for (const file of keypairFiles) {
                // Extract public key from filename
                const publicKey = file.replace('.json', '');
                logApi.info(`${formatLog.tag()} ${formatLog.info(`Checking wallet: ${publicKey}`)}`);
                
                // Check if already in database
                const existing = await prisma.contest_wallets.findFirst({
                    where: { wallet_address: publicKey }
                });
                
                if (existing) {
                    logApi.info(`${formatLog.tag()} ${formatLog.header('Already Used')} Wallet: ${publicKey}`);
                    continue;
                }
                
                // If the wallet is not in the database, decrypt the private key and return it
                if (!existing) {
                    // Found an unassociated wallet
                    const keypairPath = `${dirPath}/${file}`;
                    const privateKeyPath = `/home/websites/degenduel/addresses/pkeys/public/${folderName}/${publicKey}.key`;
                    
                    logApi.info(`${formatLog.tag()} ${formatLog.info(`Looking for private key at: ${privateKeyPath}`)}`);
                    
                    try {
                        // Check if private key file exists
                        await fs.access(privateKeyPath);
                        
                        // Read unencrypted private key
                        const privateKey = await fs.readFile(privateKeyPath, 'utf8');
                        logApi.info(`${formatLog.tag()} ${formatLog.success(`Read private key with length: ${privateKey.length}`)}`);
                        
                        logApi.info(`${formatLog.tag()} ${formatLog.header('Success')} Found unassociated vanity wallet: ${publicKey}`);
                        
                        // Return the unassociated wallet without encrypting the private key
                        return { 
                            publicKey, 
                            privateKey: privateKey.trim(),
                            isVanity: true,
                            vanityType: folderName.replace('_', '')
                        };
                    } catch (accessError) {
                        logApi.warn(`${formatLog.tag()} ${formatLog.header('Error')} Cannot access private key file: ${formatLog.error(accessError.message)}`);
                        continue; // Try next wallet
                    }
                }
            }
            
            // No unassociated wallets found
            logApi.info(`${formatLog.tag()} ${formatLog.header('Not Found')} No unassociated wallets in folder ${folderName}`);
            return null;
        } catch (error) {
            logApi.warn(`${formatLog.tag()} ${formatLog.header('Error')} Failed to check folder ${folderName}: ${formatLog.error(error.message)}`, {
                error: error.message,
                stack: error.stack,
                folder: folderName
            });
            return null;
        }
    }

    // Create a new contest wallet
    /**
     * Create a new contest wallet
     * 
     * @param {number} contestId - The ID of the contest
     * @param {Object} adminContext - The admin context
     * @returns {Promise<Object>} - The results of the operation
     */
    async createContestWallet(contestId, adminContext = null) {
        if (this.stats.circuitBreaker.isOpen) {
            throw ServiceError.operation('Circuit breaker is open for wallet creation');
        }

        const startTime = Date.now();
        try {
            logApi.info(`${formatLog.tag()} ${formatLog.header('Starting')} Contest wallet creation for contest ID: ${contestId}`);
            
            // Try to get a vanity address first
            const vanityWallet = await this.getUnassociatedVanityWallet();
            
            let contestWallet;
            if (vanityWallet) {
                logApi.info(`${formatLog.tag()} ${formatLog.header('Using')} Vanity wallet for contest ${contestId}`);
                logApi.info(`${formatLog.tag()} ${formatLog.success(`Vanity details: ${JSON.stringify({
                    publicKey: vanityWallet.publicKey,
                    privateKeyLength: vanityWallet.privateKey.length,
                    isVanity: vanityWallet.isVanity,
                    vanityType: vanityWallet.vanityType
                })}`)}`);
                
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
                    
                    // Mark the vanity wallet as used in our database
                    if (vanityWallet.dbId) {
                        const VanityApiClient = (await import('../../services/vanity-wallet/vanity-api-client.js')).default;
                        await VanityApiClient.assignVanityWalletToContest(vanityWallet.dbId, contestId);
                        logApi.info(`${formatLog.tag()} ${formatLog.header('Success')} Marked vanity wallet as used in database`);
                    }
                    
                    logApi.info(`${formatLog.tag()} ${formatLog.header('Success')} Created DB record for vanity wallet`);
                    logApi.info(`${formatLog.tag()} ${formatLog.success(`Created contest wallet with ${vanityWallet.vanityType} vanity address`)}`, {
                        contest_id: contestId,
                        vanity_type: vanityWallet.vanityType,
                        is_vanity: contestWallet.is_vanity
                    });
                } catch (dbError) {
                    logApi.error(`${formatLog.tag()} ${formatLog.header('Error')} Failed to create vanity wallet DB record: ${formatLog.error(dbError.message)}`, {
                        error: dbError.message,
                        stack: dbError.stack,
                        contestId,
                        publicKey: vanityWallet.publicKey
                    });
                    throw dbError;
                }
            } else {
                logApi.info(`${formatLog.tag()} ${formatLog.header('Fallback')} No vanity wallet available, generating random wallet`);
                
                // Fall back to random address generation
                const keypair = Keypair.generate();
                const publicKey = keypair.publicKey.toString();
                const secretKeyBase64 = Buffer.from(keypair.secretKey).toString('base64');
                
                logApi.info(`${formatLog.tag()} ${formatLog.info(`Generated random wallet: ${publicKey}`)}`);
                
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
                    
                    logApi.info(`${formatLog.tag()} ${formatLog.header('Success')} Created DB record for random wallet`);
                    logApi.info(`${formatLog.tag()} ${formatLog.warning(`Created contest wallet with random address (no vanity addresses available)`)}`, {
                        contest_id: contestId,
                        is_vanity: contestWallet.is_vanity
                    });
                } catch (dbError) {
                    logApi.error(`${formatLog.tag()} ${formatLog.header('Error')} Failed to create random wallet DB record: ${formatLog.error(dbError.message)}`, {
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

            // Log success
            logApi.info(`${formatLog.tag()} ${formatLog.header('Complete')} Created contest wallet for contest ID: ${contestId}`);

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
            
            // Return the contest wallet
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
    /**
     * Fetch and update Solana balance for a wallet
     * 
     * @param {Object} wallet - The wallet to update
     * @returns {Promise<Object>} - The results of the operation
     */
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
            
            // Get current Solana balance using SolanaEngine
            const publicKey = new PublicKey(wallet.wallet_address);
            const lamports = await solanaEngine.executeConnectionMethod('getBalance', publicKey);
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
    /**
     * Bulk update all wallets' balances
     * 
     * @returns {Promise<Object>} - The results of the operation
     */
    async updateAllWalletBalances() {
        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Starting ${fancyColors.RESET} Contest wallet balance refresh cycle`);

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
                    
                    // Format batch numbers with consistent spacing
                    const formattedBatchNum = (currentBatch+1).toString().padStart(2);
                    const formattedTotalBatches = totalBatches.toString().padStart(2);
                    const formattedStartIndex = (startIndex+1).toString().padStart(3);
                    const formattedEndIndex = endIndex.toString().padStart(3);
                    
                    // Log the batch being processed with consistent formatting
                    logApi.info(`${formatLog.tag()} ${formatLog.batch(`${formattedBatchNum}/${formattedTotalBatches}`)} Wallets #${formattedStartIndex}-${formattedEndIndex}`);
                    
                    // Add delay before EVERY request to avoid rate limits, not just after the first one
                    await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
                    
                    // Get balances of all contest wallets from a single RPC call using SolanaEngine
                    const balances = await solanaEngine.executeConnectionMethod('getMultipleAccountsInfo', publicKeys);
                    
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
                            // Log error with better formatting
                            results.failed++;
                            
                            // Format contest ID and code with consistent spacing
                            const formattedContestId = wallet.contests?.id ? wallet.contests.id.toString().padStart(4) : "N/A ".padStart(4);
                            const formattedContestCode = (wallet.contests?.contest_code || "Unknown").padEnd(10);
                            const shortAddress = wallet.wallet_address.substring(0, 8) + '...' + wallet.wallet_address.substring(wallet.wallet_address.length - 4);
                            
                            logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BOLD_CYAN}✗ Contest ${formattedContestId}${fancyColors.RESET} ${fancyColors.LIGHT_CYAN}(${formattedContestCode})${fancyColors.RESET} ${fancyColors.RED}Error: ${error.message}${fancyColors.RESET} ${fancyColors.GRAY}[${shortAddress}]${fancyColors.RESET}`);
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
                        
                        // Format contest ID and code with consistent spacing
                        const formattedContestId = change.contest_id ? change.contest_id.toString().padStart(4) : "N/A ".padStart(4);
                        const formattedContestCode = (change.contest_code || "Unknown").padEnd(10);
                        
                        // Format balance changes with color based on direction and magnitude
                        const diffAbs = Math.abs(change.difference);
                        let diffColor;
                        
                        if (diffAbs < 0.001) {
                            // Very small change
                            diffColor = fancyColors.DARK_GRAY;
                        } else if (change.difference > 0) {
                            // Positive change - green shades based on size
                            diffColor = diffAbs > 0.1 ? fancyColors.DARK_GREEN : fancyColors.LIGHT_GREEN;
                        } else {
                            // Negative change - red shades based on size
                            diffColor = diffAbs > 0.1 ? fancyColors.DARK_RED : fancyColors.LIGHT_RED;
                        }
                        
                        // Format difference with sign, 4 decimal places
                        const sign = change.difference >= 0 ? '+' : '';
                        const formattedDiff = `${sign}${change.difference.toFixed(4)}`;
                        
                        // Format current balance with 4 decimal places and consistent spacing
                        const formattedBalance = change.current_balance.toFixed(4).padStart(10);
                        
                        // Log with better formatting - using CYAN instead of MAGENTA for consistency
                        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.CYAN}✓ ${fancyColors.BOLD_CYAN}Contest ${formattedContestId}${fancyColors.RESET} ${fancyColors.LIGHT_CYAN}(${formattedContestCode})${fancyColors.RESET} ${fancyColors.CYAN}Balance: ${formattedBalance} SOL${fancyColors.RESET} ${diffColor}${formattedDiff} SOL${fancyColors.RESET} \n\t${fancyColors.GRAY}${fancyColors.UNDERLINE}https://solscan.io/address/${change.wallet_address}${fancyColors.RESET}`);
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
                        
                        // Log rate limit error with standardized format
                        logApi.warn(`${fancyColors.RED}[solana-rpc]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} RATE LIMIT ${fancyColors.RESET} ${fancyColors.BOLD_RED}WalletBatch${fancyColors.RESET} ${fancyColors.RED}Hit #${consecutiveRateLimitHits}${fancyColors.RESET} ${fancyColors.LIGHT_RED}Retry in ${backoffDelay}ms${fancyColors.RESET} ${fancyColors.DARK_RED}(via contestWalletSvc)${fancyColors.RESET}`, {
                            service: 'SOLANA',
                            error_type: 'RATE_LIMIT',
                            operation: 'WalletBatch',
                            hit_count: consecutiveRateLimitHits.toString(),
                            source_service: 'contestWalletService',
                            batch: currentBatch + 1,
                            total_batches: totalBatches,
                            retry_ms: backoffDelay,
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
            
            // Track wallets with SOL
            const walletsWithBalance = [];
            
            // Create balanceChanges list from results if it exists
            const balanceChanges = results.updates?.filter(update => update.success && update.difference !== 0) || [];
            
            // Attempt to find all wallets with balance > 0.001 SOL
            // We'll map through all contest wallets to check them
            const walletsWithSolBalance = await prisma.contest_wallets.findMany({
                where: { balance: { gt: 0.001 } },
                include: {
                    contests: {
                        select: {
                            id: true,
                            contest_code: true,
                            status: true
                        }
                    }
                },
                orderBy: { balance: 'desc' }
            });
            
            // Add wallets with balance to our tracking list
            for (const wallet of walletsWithSolBalance) {
                walletsWithBalance.push({
                    contest_id: wallet.contests?.id,
                    contest_code: wallet.contests?.contest_code,
                    wallet_address: wallet.wallet_address,
                    balance: parseFloat(wallet.balance)
                });
            }
            
            // Create a map of contest IDs to statuses for faster lookup
            const contestsStatusMap = new Map();
            for (const wallet of contestWallets) {
                if (wallet.contests?.id && wallet.contests?.status) {
                    contestsStatusMap.set(wallet.contests.id, wallet.contests.status);
                }
            }
            
            // Calculate and format stats with consistent spacing
            const totalTime = Date.now() - startTime;
            const formattedSeconds = (totalTime/1000).toFixed(1).padStart(4);
            const formattedUpdated = results.updated.toString().padStart(3);
            const formattedTotal = results.total.toString().padStart(3);
            const successRate = (results.updated / results.total) * 100;
            const formattedSuccessRate = successRate.toFixed(0).padStart(3);
            
            // Log completion with better formatting
            logApi.info(`${formatLog.tag()} ${formatLog.header('COMPLETED')} ${formattedUpdated}/${formattedTotal} wallets (${formattedSuccessRate}%) in ${formattedSeconds}s`);
            
            // Sort wallets by balance (descending)
            walletsWithBalance.sort((a, b) => b.balance - a.balance);
            
            // Log summary of wallets with SOL
            if (walletsWithBalance.length > 0) {
                logApi.info(`${formatLog.tag()} ${formatLog.header('WALLETS WITH SOL')} Found ${walletsWithBalance.length} wallets`);
                
                // Log top wallets with SOL (top 10 or all if less than 10)
                const topWallets = walletsWithBalance.slice(0, Math.min(10, walletsWithBalance.length));
                for (const wallet of topWallets) {
                    const formattedContestId = wallet.contest_id ? wallet.contest_id.toString().padStart(4) : "N/A ".padStart(4);
                    const formattedContestCode = (wallet.contest_code || "Unknown").padEnd(10);
                    const formattedBalance = wallet.balance.toFixed(4).padStart(10);
                    const shortAddress = wallet.wallet_address.substring(0, 8) + '...' + wallet.wallet_address.substring(wallet.wallet_address.length - 4);
                    
                    logApi.info(`${formatLog.tag()} ${formatLog.info(`#${formattedContestId} ${formattedContestCode}  ${formattedBalance} SOL ${fancyColors.GRAY}[${shortAddress}]${fancyColors.RESET}`)}`);
                }
                
                // If more than 10 wallets, summarize the rest
                if (walletsWithBalance.length > 10) {
                    const remainingWallets = walletsWithBalance.length - 10;
                    const remainingBalance = walletsWithBalance.slice(10).reduce((sum, wallet) => sum + wallet.balance, 0);
                    logApi.info(`${formatLog.tag()} ${formatLog.info(`+ ${remainingWallets} more wallets with total balance: ${remainingBalance.toFixed(4)} SOL`)}`);
                }
                
                // Calculate total SOL in all wallets
                const totalSOL = walletsWithBalance.reduce((sum, wallet) => sum + wallet.balance, 0);
                logApi.info(`${formatLog.tag()} ${formatLog.header('TOTAL SOL')} ${totalSOL.toFixed(4)} SOL across ${walletsWithBalance.length} wallets`);
            } else {
                logApi.info(`${formatLog.tag()} ${formatLog.warning('No wallets found with SOL balance')}`);
            }
            
            // Add a cooldown period after batch completion to prevent immediate rate limiting in other services
            // This helps spread out the RPC calls across the system
            const cooldownMs = 2000; // 2 second cooldown
            await new Promise(resolve => setTimeout(resolve, cooldownMs));
            
            // Log cooldown completion with better formatting
            logApi.info(`${formatLog.tag()} ${formatLog.info('RPC cooldown period completed')}`);
            
            // Auto-reclaim evaluation for wallets with balance over threshold
            // Only run if there are wallets with SOL
            if (walletsWithBalance.length > 0) {
                // Get the configuration values
                const minBalance = this.config.reclaim.minimumBalanceToReclaim;
                const minTransfer = this.config.reclaim.minimumAmountToTransfer;
                const statusFilter = this.config.reclaim.contestStatuses;
                
                // Filter wallets eligible for auto-reclaiming
                const eligibleWallets = walletsWithBalance.filter(wallet => {
                    // Check wallet has sufficient balance
                    if (wallet.balance < minBalance) return false;
                    
                    // Get the contest info from our database to check status
                    const contestStatus = contestsStatusMap.get(wallet.contest_id);
                    
                    // Only include wallets from completed or cancelled contests
                    return statusFilter.includes(contestStatus);
                });
                
                if (eligibleWallets.length > 0) {
                    const totalEligibleSOL = eligibleWallets.reduce((sum, wallet) => sum + wallet.balance, 0);
                    logApi.info(`${formatLog.tag()} ${formatLog.header('Auto-Reclaim')} Found ${eligibleWallets.length} eligible wallets with ${totalEligibleSOL.toFixed(4)} SOL available to reclaim`);
                    
                    try {
                        // Auto-reclaim funds from eligible wallets
                        await this.reclaimUnusedFunds({
                            statusFilter,
                            minBalance,
                            minTransfer,
                            adminAddress: 'SYSTEM_AUTO'
                        });
                    } catch (reclaimError) {
                        logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Auto-reclaim operation failed: ${reclaimError.message}`);
                    }
                } else {
                    logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.LIGHT_CYAN}No wallets eligible for auto-reclaim at this time${fancyColors.RESET}`);
                }
            }
            
            return {
                duration: Date.now() - startTime,
                ...results
            };
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Failed ${fancyColors.RESET} Could not update wallet balances: ${error.message}`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    // Main operation implementation - periodic health checks and balance updates
    /**
     * Perform the main operation of the contest wallet service
     * 
     * @returns {Promise<Object>} - The results of the operation
     */
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
                logApi.debug(`${formatLog.tag()} Service not operational, skipping operation`);
                return true;
            }
            
            // Call the original performOperation implementation
            await this.performOperation();
            
            return true;
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error('Perform operation error:')} ${error.message}`);
            throw error; // Important: re-throw to trigger circuit breaker
        }
    }

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
            // Check if the data might already be in plaintext format (not JSON)
            if (typeof encryptedData === 'string' && !encryptedData.startsWith('{')) {
                logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key appears to be in plaintext format already${fancyColors.RESET}`);
                return encryptedData; // Return as-is if not in JSON format
            }
            
            const { encrypted, iv, tag, aad } = JSON.parse(encryptedData);
            
            // Use the local config value for encryption algorithm, which is hardcoded in CONTEST_WALLET_CONFIG
            // This prevents reliance on global config which doesn't have this property
            const algorithm = 'aes-256-gcm'; // Hardcoded to match key-recovery.js
            
            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Using encryption algorithm: ${algorithm}${fancyColors.RESET}`);
            
            const decipher = crypto.createDecipheriv(
                algorithm,
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
            logApi.warn(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Decryption error: ${error.message}, length: ${encryptedData?.length}, preview: ${typeof encryptedData === 'string' ? encryptedData.substring(0, 20) + '...' : 'not a string'}${fancyColors.RESET}`);
            
            // If JSON parsing failed, it might be plaintext - return as-is
            if (error.message && (error.message.includes('JSON') || error.message.includes('Unexpected token'))) {
                logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key appears to be unencrypted, returning as-is${fancyColors.RESET}`);
                return encryptedData;
            }
            
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
            // Log wallet info without revealing sensitive data
            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Transfer ${fancyColors.RESET} ${amount} SOL from ${sourceWallet.wallet_address} to ${destinationAddress}`, {
                is_vanity: sourceWallet.is_vanity,
                vanity_type: sourceWallet.vanity_type,
                wallet_db_id: sourceWallet.id,
                contest_id: sourceWallet.contest_id,
                wallet_address: sourceWallet.wallet_address,
                private_key_format: typeof sourceWallet.private_key === 'string' 
                    ? (sourceWallet.private_key.startsWith('{') ? 'JSON' : 'plaintext') 
                    : typeof sourceWallet.private_key,
                private_key_length: sourceWallet.private_key?.length || 0
            });
            
            const decryptedPrivateKey = this.decryptPrivateKey(sourceWallet.private_key);
            
            // Handle many different private key formats used across wallet services
            let privateKeyBytes;
            let fromKeypair;
            
            // Debug info for key troubleshooting
            const keyInfo = {
                wallet_address: sourceWallet.wallet_address,
                key_length: decryptedPrivateKey.length,
                key_format: typeof decryptedPrivateKey,
                is_vanity: sourceWallet.is_vanity,
                vanity_type: sourceWallet.vanity_type
            };
            
            // Try different formats in order of likelihood
            try {
                // Method 1: First check if it might be a hex string (used in solana-wallet.js)
                if (/^[0-9a-fA-F]+$/.test(decryptedPrivateKey)) {
                    try {
                        // For hex format, make sure we have the correct length (64 bytes = 128 hex chars)
                        if (decryptedPrivateKey.length === 128) {
                            privateKeyBytes = Buffer.from(decryptedPrivateKey, 'hex');
                            fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
                            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as standard hex (128 chars)${fancyColors.RESET}`);
                            return await this.executeTransfer(fromKeypair, destinationAddress, amount);
                        } else {
                            // Try creating a Uint8Array of the correct size
                            const secretKey = new Uint8Array(64); // 64 bytes for ed25519 keys
                            const hexData = Buffer.from(decryptedPrivateKey, 'hex');
                            
                            // Copy available bytes (may be smaller than 64)
                            for (let i = 0; i < Math.min(hexData.length, 64); i++) {
                                secretKey[i] = hexData[i];
                            }
                            
                            fromKeypair = Keypair.fromSecretKey(secretKey);
                            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as padded hex (${decryptedPrivateKey.length} chars)${fancyColors.RESET}`);
                            return await this.executeTransfer(fromKeypair, destinationAddress, amount);
                        }
                    } catch (hexError) {
                        keyInfo.hex_error = hexError.message;
                        // Continue to next format
                        logApi.warn(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Hex key decoding failed: ${hexError.message}${fancyColors.RESET}`);
                    }
                }
                
                // Method 2: Try as base58 (commonly used for vanity wallets)
                try {
                    privateKeyBytes = bs58.decode(decryptedPrivateKey);
                    
                    // Validate length for BS58 too - Solana keypair needs 64 bytes
                    if (privateKeyBytes.length !== 64) {
                        const paddedKey = new Uint8Array(64);
                        for (let i = 0; i < Math.min(privateKeyBytes.length, 64); i++) {
                            paddedKey[i] = privateKeyBytes[i];
                        }
                        privateKeyBytes = paddedKey;
                        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as base58 (padded to 64 bytes)${fancyColors.RESET}`);
                    } else {
                        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as base58 (correct 64 byte length)${fancyColors.RESET}`);
                    }
                    
                    fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
                    return await this.executeTransfer(fromKeypair, destinationAddress, amount);
                } catch (bs58Error) {
                    keyInfo.bs58_error = bs58Error.message;
                    logApi.warn(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Base58 key decoding failed: ${bs58Error.message}${fancyColors.RESET}`);
                    // Continue to next format
                }
                
                // Method 3: Try as base64 (used for generated wallets)
                try {
                    privateKeyBytes = Buffer.from(decryptedPrivateKey, 'base64');
                    
                    // Validate length for Base64 too - Solana keypair needs 64 bytes
                    if (privateKeyBytes.length !== 64) {
                        const paddedKey = new Uint8Array(64);
                        for (let i = 0; i < Math.min(privateKeyBytes.length, 64); i++) {
                            paddedKey[i] = privateKeyBytes[i];
                        }
                        privateKeyBytes = paddedKey;
                        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as base64 (padded to 64 bytes)${fancyColors.RESET}`);
                    } else {
                        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as base64 (correct 64 byte length)${fancyColors.RESET}`);
                    }
                    
                    fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
                    return await this.executeTransfer(fromKeypair, destinationAddress, amount);
                } catch (base64Error) {
                    keyInfo.base64_error = base64Error.message;
                    logApi.warn(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Base64 key decoding failed: ${base64Error.message}${fancyColors.RESET}`);
                    // Continue to next format
                }
                
                // Method 4: Check if it's a JSON string with secretKey
                if (decryptedPrivateKey.startsWith('{') && decryptedPrivateKey.includes('secretKey')) {
                    try {
                        const keyObject = JSON.parse(decryptedPrivateKey);
                        if (keyObject.secretKey) {
                            // Handle array format
                            if (Array.isArray(keyObject.secretKey)) {
                                // Check if we need to pad to 64 bytes
                                if (keyObject.secretKey.length !== 64) {
                                    const paddedKey = new Uint8Array(64);
                                    for (let i = 0; i < Math.min(keyObject.secretKey.length, 64); i++) {
                                        paddedKey[i] = keyObject.secretKey[i];
                                    }
                                    privateKeyBytes = paddedKey;
                                    logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded from JSON array (padded to 64 bytes)${fancyColors.RESET}`);
                                } else {
                                    privateKeyBytes = Uint8Array.from(keyObject.secretKey);
                                    logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded from JSON array (correct 64 byte length)${fancyColors.RESET}`);
                                }
                            } 
                            // Handle string format
                            else if (typeof keyObject.secretKey === 'string') {
                                // Try decoding as base58 or base64
                                try {
                                    privateKeyBytes = bs58.decode(keyObject.secretKey);
                                    logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded from JSON.secretKey as base58 string${fancyColors.RESET}`);
                                } catch (err) {
                                    // Try base64
                                    privateKeyBytes = Buffer.from(keyObject.secretKey, 'base64');
                                    logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded from JSON.secretKey as base64 string${fancyColors.RESET}`);
                                }
                                
                                // Ensure correct length
                                if (privateKeyBytes.length !== 64) {
                                    const paddedKey = new Uint8Array(64);
                                    for (let i = 0; i < Math.min(privateKeyBytes.length, 64); i++) {
                                        paddedKey[i] = privateKeyBytes[i];
                                    }
                                    privateKeyBytes = paddedKey;
                                    logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}JSON string key padded to 64 bytes${fancyColors.RESET}`);
                                }
                            }
                            
                            fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
                            return await this.executeTransfer(fromKeypair, destinationAddress, amount);
                        }
                    } catch (jsonError) {
                        keyInfo.json_error = jsonError.message;
                        logApi.warn(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}JSON key decoding failed: ${jsonError.message}${fancyColors.RESET}`);
                        // Continue to next format
                    }
                }
                
                // Last resort fallback: Try to generate a keypair from whatever data we have
                try {
                    logApi.warn(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} FALLBACK ${fancyColors.RESET} All standard methods failed, attempting emergency key recovery${fancyColors.RESET}`);
                    
                    // Try to recover by doing a brute force approach which tries multiple key formats
                    // Check if we can create a Solana keypair directly from the wallet address
                    try {
                        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Attempting to regenerate keypair from wallet address${fancyColors.RESET}`);
                        
                        // Highly dangerous but last resort: create a deterministic private key from the wallet address
                        // This will NOT match the original private key but it's consistent and tied to the address
                        const addressHash = crypto.createHash('sha512').update(sourceWallet.wallet_address).digest();
                        const backupSeed = addressHash.slice(0, 32);
                        
                        // Use the backup seed to generate a new keypair
                        const backupKeypair = Keypair.fromSeed(backupSeed);
                        
                        // Check if this address matches the original by pure coincidence (extremely unlikely)
                        if (backupKeypair.publicKey.toBase58() === sourceWallet.wallet_address) {
                            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} MIRACLE ${fancyColors.RESET} Backup keypair matches the wallet address (astoundingly unlikely)${fancyColors.RESET}`);
                            return await this.executeTransfer(backupKeypair, destinationAddress, amount);
                        }
                        
                        // Since backup keypair doesn't match (expected), try to bypass public key checks using the keyPair anyway
                        // In a controlled test environment, this might be acceptable for demonstration
                        if (process.env.ALLOW_EMERGENCY_KEYPAIR === 'TRUE') {
                            logApi.warn(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} BYPASS ${fancyColors.RESET} Using emergency backup keypair with NON-MATCHING PUBLIC KEY - ONLY FOR DEMO${fancyColors.RESET}`);
                            logApi.warn(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.RED}Emergency key: ${backupKeypair.publicKey.toBase58()} vs Wallet: ${sourceWallet.wallet_address}${fancyColors.RESET}`);
                            return await this.executeTransfer(backupKeypair, destinationAddress, amount);
                        }
                    } catch (directError) {
                        logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.RED}Direct address derivation failed: ${directError.message}${fancyColors.RESET}`);
                    }
                    
                    // More standard approach: hash the private key and use it as a seed
                    const hash = crypto.createHash('sha512').update(decryptedPrivateKey).digest();
                    const seed = hash.slice(0, 32);
                    
                    // Create full 64-byte secret key (first 32 bytes is seed, second 32 bytes is derived)
                    const secretKey = new Uint8Array(64);
                    for (let i = 0; i < 32; i++) {
                        secretKey[i] = seed[i];
                    }
                    
                    // Generate the rest of the key
                    const keyPair = Keypair.fromSeed(seed);
                    
                    // Copy both seed and resulting pubkey data into our secret key
                    // This may not be a standard ed25519 keypair but might work for Solana
                    const resultPubKey = keyPair.publicKey.toBytes();
                    for (let i = 0; i < 32; i++) {
                        secretKey[i + 32] = resultPubKey[i % resultPubKey.length];
                    }
                    
                    const emergencyKeypair = Keypair.fromSecretKey(secretKey);
                    
                    // Double check that the public key matches our wallet address
                    if (emergencyKeypair.publicKey.toBase58() === sourceWallet.wallet_address) {
                        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SUCCESS ${fancyColors.RESET} Emergency key derivation worked! Public key matches wallet address${fancyColors.RESET}`);
                        return await this.executeTransfer(emergencyKeypair, destinationAddress, amount);
                    } else {
                        logApi.warn(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.RED}Emergency key derivation failed: Generated public key ${emergencyKeypair.publicKey.toBase58()} doesn't match wallet address ${sourceWallet.wallet_address}${fancyColors.RESET}`);
                    }
                } catch (emergencyError) {
                    logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} EMERGENCY FAILED ${fancyColors.RESET} ${emergencyError.message}${fancyColors.RESET}`);
                }
                
                // If we reach here, all formats failed
                throw new Error("Failed to decode private key in any supported format");
                
            } catch (formatError) {
                // All attempts to decode the key failed
                logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Key Format Error ${fancyColors.RESET} Failed to decode private key: ${formatError.message}`, keyInfo);
                throw new Error(`Cannot decode private key: ${formatError.message}`);
            }
        } catch (error) {
            throw ServiceError.blockchain('Blockchain transfer failed', {
                error: error.message,
                sourceWallet: sourceWallet.wallet_address,
                destination: destinationAddress,
                amount
            });
        }
    }
    
    // Helper to execute the actual transfer once we have a valid keypair
    async executeTransfer(fromKeypair, destinationAddress, amount) {
        try {
            // Verify keypair structure and validity
            try {
                const pubKeyStr = fromKeypair.publicKey.toString();
                const secretKeyLength = fromKeypair.secretKey ? fromKeypair.secretKey.length : 0;
                
                // Log keypair details for debugging
                logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Keypair Check ${fancyColors.RESET} Public key: ${pubKeyStr}, Secret key length: ${secretKeyLength}`, {
                    public_key_type: typeof fromKeypair.publicKey,
                    is_public_key: fromKeypair.publicKey instanceof PublicKey,
                    secret_key_type: typeof fromKeypair.secretKey,
                    secret_key_is_array: Array.isArray(fromKeypair.secretKey),
                    secret_key_is_uint8array: fromKeypair.secretKey instanceof Uint8Array
                });
                
                // Validate the keypair by checking that the public key is derivable from the secret key
                if (fromKeypair.secretKey && fromKeypair.secretKey.length === 64) {
                    // Try re-creating the keypair to verify consistency
                    const verificationKeypair = Keypair.fromSecretKey(fromKeypair.secretKey);
                    const matches = verificationKeypair.publicKey.toString() === pubKeyStr;
                    logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${matches ? fancyColors.GREEN : fancyColors.RED}Public key verification: ${matches ? 'MATCH' : 'MISMATCH'}${fancyColors.RESET}`);
                    
                    if (!matches) {
                        // Try to recover - reconstruct keypair from secret key
                        fromKeypair = Keypair.fromSecretKey(fromKeypair.secretKey);
                        logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Keypair reconstructed from secret key${fancyColors.RESET}`);
                    }
                }
            } catch (keypairError) {
                logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Keypair Error ${fancyColors.RESET} ${keypairError.message}${fancyColors.RESET}`);
                // Continue anyway - the error will be caught in the main try/catch
            }
            
            // Verify connection through SolanaEngine before transfer
            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} Using SolanaEngine for transfer`);
            
            // Directly try to get blockhash as a health check
            try {
                const blockHashTest = await solanaEngine.executeConnectionMethod('getLatestBlockhash');
                logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Pre-transfer blockhash check successful${fancyColors.RESET}`, {
                    blockhash: blockHashTest?.value?.blockhash?.substring(0, 8) + '...',
                    has_value: !!blockHashTest?.value
                });
            } catch (bhError) {
                logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.RED}Pre-transfer blockhash check failed${fancyColors.RESET}`, {
                    error: bhError.message
                });
                // Continue despite error - the main transfer will handle it appropriately
            }
            
            // Verify destination address
            try {
                const destPubKey = new PublicKey(destinationAddress);
                logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Destination address validated: ${destPubKey.toString()}${fancyColors.RESET}`);
            } catch (destError) {
                logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.RED}Invalid destination address: ${destError.message}${fancyColors.RESET}`);
                // Continue anyway - the error will be caught in the transaction creation
            }
            
            // Create a transaction to transfer SOL
            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Executing ${fancyColors.RESET} Transfer of ${amount} SOL to ${destinationAddress}${fancyColors.RESET}`);
            
            // Create transaction object
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: new PublicKey(destinationAddress),
                    lamports: Math.round(amount * LAMPORTS_PER_SOL) // Convert SOL to lamports
                })
            );
            
            // Send the transaction using SolanaEngine with preferred endpoint options
            const signature = await solanaEngine.sendTransaction(
                transaction, 
                [fromKeypair], 
                {
                    commitment: 'confirmed',
                    skipPreflight: false,
                    // Use a preferred endpoint for critical operations if available
                    endpointId: this.config.wallet?.preferredEndpoints?.transfers
                }
            );
            
            // Return the signature
            return signature;
        } catch (error) {
            // Log the specific error with detailed information
            logApi.error(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} SOL transfer failed using @solana/transactions v2.1`, {
                error: error.message,
                stack: error.stack,
                from: fromKeypair.publicKey.toString(),
                to: destinationAddress,
                amount: amount
            });
            
            // Rethrow to allow the calling function to handle it
            throw error;
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
     * @param {boolean} options.forceStatus Whether to bypass the status filter and reclaim from all contests (emergency use only)
     * @returns {Promise<Object>} Result summary
     */
    async reclaimUnusedFunds(options = {}) {
        // Generate a unique cycle ID based on timestamp
        const cycleId = `RC-${Date.now().toString(36).toUpperCase()}`;
        
        const {
            statusFilter = this.config.reclaim.contestStatuses,
            minBalance = this.config.reclaim.minimumBalanceToReclaim,
            minTransfer = this.config.reclaim.minimumAmountToTransfer,
            specificContestId = null,
            adminAddress = 'SYSTEM',
            forceStatus = false
        } = options;

        // Log start of operation with indication if this is a force reclaim
        if (forceStatus) {
            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} EMERGENCY ${fancyColors.RESET} Starting force reclaim operation for ALL contest funds`);
        } else {
            logApi.info(`${formatLog.tag()} ${formatLog.header(`Starting Cycle ${cycleId}`)} Reclaim operation for unused contest funds`);
            
            // Log admin action for cycle start
            await AdminLogger.logAction(
                adminAddress,
                'WALLET_RECLAIM_CYCLE_START',
                {
                    cycle_id: cycleId,
                    specific_contest_id: specificContestId,
                    min_balance: minBalance,
                    min_transfer: minTransfer,
                    status_filter: statusFilter
                }
            );
        }
        
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
            
            // Add filters - bypass status filter if forceStatus is true
            if (specificContestId) {
                // If specific contest ID is provided, always use that regardless of force flag
                query.where.contest_id = parseInt(specificContestId);
            } else if (!forceStatus) {
                // Apply status filter only if not in force mode
                query.where.contests = {
                    status: { in: statusFilter }
                };
            } // If forceStatus=true and no specificContestId, no filters - get all contests
            
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
                
                // Get formatted batch information
                const batchInfo = this.formatBatchInfo('Reclaim', cycleId, walletIndex, BATCH_SIZE, eligibleWallets.length);
                
                // Log with consistent batch formatting
                logApi.info(`${formatLog.tag()} ${formatLog.batch(`Reclaim ${cycleId} Batch ${Math.floor(walletIndex/BATCH_SIZE)+1}/${Math.ceil(eligibleWallets.length/BATCH_SIZE)}`)} ${walletBatch.length} wallets - Delay: ${delayBetweenBatches}ms`);
                
                // Always wait between batches, even for the first one
                await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
                
                try {
                    // Create batch of PublicKeys
                    const publicKeys = walletBatch.map(wallet => new PublicKey(wallet.wallet_address));
                    
                    // Get multiple balances in a single RPC call using SolanaEngine
                    const balanceInfos = await solanaEngine.executeConnectionMethod('getMultipleAccountsInfo', publicKeys);
                    
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
                                // Don't log every skipped wallet - too noisy
                                // Instead increment a counter for summary logging
                                results.skipped_zero_balance = (results.skipped_zero_balance || 0) + 1;
                                results.details.push({
                                    contest_id: wallet.contest_id,
                                    contest_code: wallet.contests?.contest_code,
                                    wallet_address: wallet.wallet_address,
                                    balance: solBalance,
                                    status: 'skipped_low_balance'
                                });
                                continue;
                            }
                            
                            // Reserve a small buffer reserve
                            const reserveAmount = 0.0005; // 0.0005 SOL = 5000 lamports
                            const transferAmount = solBalance - reserveAmount; // amount to transfer after reserving buffer
                            
                            // Skip if transfer amount would be too small after accounting for buffer reserve
                            if (transferAmount < minTransfer) {
                                logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} Skipping transfer from ${wallet.wallet_address} (amount too small: ${(transferAmount - reserveAmount).toFixed(6)} SOL; buffer reserve: ${reserveAmount.toFixed(6)} SOL)`);
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
                            
                            // Attempt the contest wallet balance reclaim transfer
                            logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE} TRANSFER ${fancyColors.RESET} ${fancyColors.CYAN}Contest ${wallet.contest_id} (${wallet?.contests?.contest_code}) transferring ${fancyColors.BOLD_CYAN}${transferAmount.toFixed(6)} SOL${fancyColors.RESET} ${fancyColors.CYAN}to DegenDuel treasury...${fancyColors.RESET}`);
                            
                            try {
                                // Create a transaction record without wallet_address to avoid foreign key constraint
                                // Contest wallets don't have a corresponding user record 
                                // Instead, we'll track the wallet through the contest_id only and 
                                // store the wallet address in the metadata for reference
                                const transaction = await prisma.transactions.create({
                                    data: {
                                        // Removed wallet_address to avoid foreign key constraint with users table
                                        type: config.transaction_types.WITHDRAWAL,
                                        amount: transferAmount,
                                        balance_before: solBalance,
                                        balance_after: solBalance - transferAmount,
                                        contest_id: wallet.contest_id,
                                        description: `Reclaiming unused funds from ${wallet.contests?.contest_code || `Contest #${wallet.contest_id}`} wallet to treasury`,
                                        status: config.transaction_statuses.PENDING,
                                        created_at: new Date(),
                                        // Store additional information in metadata
                                        metadata: {
                                            contest_wallet_address: wallet.wallet_address,
                                            treasury_destination: this.treasuryWalletAddress,
                                            auto_reclaim: adminAddress === 'SYSTEM_AUTO'
                                        }
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
                                        status: config.transaction_statuses.COMPLETED,
                                        blockchain_signature: signature,
                                        completed_at: new Date(),
                                        // Update metadata with additional transaction details
                                        metadata: {
                                            ...transaction.metadata,
                                            transaction_signature: signature,
                                            completed_timestamp: new Date().toISOString()
                                        }
                                    }
                                });
                                
                                // Log success
                                logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_GREEN}Successfully transferred ${transferAmount.toFixed(6)} SOL to treasury${fancyColors.RESET}
                     Signature: ${typeof signature === 'object' ? JSON.stringify(signature) : signature}
                     Explorer: https://solscan.io/tx/${typeof signature === 'object' ? signature.toString() : signature}`);
                                
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
                                        cycle_id: cycleId,
                                        contest_id: wallet.contest_id,
                                        contest_code: wallet.contests?.contest_code,
                                        wallet_address: wallet.wallet_address,
                                        amount: transferAmount.toString(),
                                        signature: signature
                                    }
                                );
                            } catch (error) {
                                logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to transfer funds from ${wallet.wallet_address}:`)}`, error);
                                
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
                        
                        // Get formatted batch information for consistent logging
                        const batchInfo = this.formatBatchInfo('Reclaim', cycleId, walletIndex, BATCH_SIZE, eligibleWallets.length);
                        
                        logApi.warn(`${fancyColors.RED}[solana-rpc]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} RATE LIMIT ${fancyColors.RESET} ${fancyColors.BOLD_RED}ReclaimFunds${fancyColors.RESET} ${fancyColors.RED}Hit #${consecutiveRateLimitHits}${fancyColors.RESET} ${fancyColors.LIGHT_RED}Retry in ${backoffDelay}ms${fancyColors.RESET} ${fancyColors.DARK_RED}(via contestWalletSvc)${fancyColors.RESET}`, {
                            service: 'SOLANA',
                            error_type: 'RATE_LIMIT',
                            operation: 'ReclaimFunds',
                            hit_count: consecutiveRateLimitHits.toString(),
                            source_service: 'contestWalletService',
                            batch: Math.floor(walletIndex/BATCH_SIZE)+1,
                            total_batches: Math.ceil(eligibleWallets.length/BATCH_SIZE),
                            retry_ms: backoffDelay,
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
                        
                        // Get formatted batch information
                        const batchInfo = this.formatBatchInfo('Reclaim', cycleId, walletIndex, BATCH_SIZE, eligibleWallets.length);
                        
                        // Enhanced error logging with consistent batch formatting
                        logApi.error(`${formatLog.tag()} ${formatLog.error(`BATCH ERROR: Failed to fetch Reclaim ${cycleId} Batch ${Math.floor(walletIndex/BATCH_SIZE)+1}/${Math.ceil(eligibleWallets.length/BATCH_SIZE)}:`)}`, {
                            error: error.message,
                            error_name: error.name || 'Unknown',
                            stack: error.stack,
                            batch_size: walletBatch.length,
                            batch_number: Math.floor(walletIndex/BATCH_SIZE)+1,
                            total_batches: Math.ceil(eligibleWallets.length/BATCH_SIZE),
                            wallet_start: walletIndex + 1,
                            wallet_end: Math.min(walletIndex + BATCH_SIZE, eligibleWallets.length),
                            total_wallets: eligibleWallets.length,
                            error_details: error.toString()
                        });
                        
                        // Wait a bit before continuing to the next batch after an error
                        const errorDelay = 3000; // 3 seconds delay after errors
                        await new Promise(resolve => setTimeout(resolve, errorDelay));
                        
                        // Move to next batch
                        walletIndex += BATCH_SIZE;
                    }
                }
            }
            
            // Log summary of skipped wallets instead of individual ones
            if (results.skipped_zero_balance) {
                logApi.info(`${formatLog.tag()} Skipped ${results.skipped_zero_balance} wallets with zero/low balance`);
            }
            
            // Summary log with special formatting for emergency reclaims
            if (forceStatus) {
                logApi.info(`${fancyColors.CYAN}[contestWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} EMERGENCY COMPLETE ${fancyColors.RESET} Force reclaim operation: ${results.successfulTransfers}/${results.walletsThatMeetCriteria} transfers successful, total reclaimed: ${results.totalAmountReclaimed.toFixed(6)} SOL`);
            } else {
                logApi.info(`${formatLog.tag()} ${formatLog.header(`Complete Cycle ${cycleId}`)} Reclaim operation: ${results.successfulTransfers}/${results.walletsThatMeetCriteria} transfers successful, total reclaimed: ${results.totalAmountReclaimed.toFixed(6)} SOL`);
                
                // Log admin action for cycle completion
                await AdminLogger.logAction(
                    adminAddress,
                    'WALLET_RECLAIM_CYCLE_COMPLETE',
                    {
                        cycle_id: cycleId,
                        total_wallets: eligibleWallets.length,
                        eligible_wallets: results.walletsThatMeetCriteria,
                        successful_transfers: results.successfulTransfers,
                        failed_transfers: results.failedTransfers,
                        total_amount_reclaimed: results.totalAmountReclaimed.toFixed(6),
                        duration_seconds: Math.floor((Date.now() - parseInt(cycleId.substring(3), 36)) / 1000)
                    }
                );
            }
            
            return results;
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to reclaim unused funds:`)}`, error);
            throw error;
        }
    }
    /**
     * Schedule a self-test to run after service startup
     * 
     * @param {number} [delayMs=5000] - Delay in milliseconds before running the test
     * @returns {void}
     */
    /**
     * Run startup certification of the wallet functionality
     * 
     * @param {number} [delayMs=5000] - Initial delay in milliseconds before running the test
     * @returns {Promise<void>}
     */
    async scheduleSelfTest(delayMs = 5000) {
        try {
            // Import the TreasuryCertifier
            const TreasuryCertifier = (await import('./treasury-certifier.js')).default;
            
            // Check if certification is enabled in environment or config
            const runCertification = process.env.CONTEST_WALLET_SELF_TEST === 'true' || 
                                    (config.service_test && config.service_test.contest_wallet_self_test);
            
            if (!runCertification) {
                logApi.info(`${formatLog.tag()} ${formatLog.info('Skipping Treasury Certification (not enabled)')}`);
                return;
            }
            
            // Initialize the certifier with required dependencies
            const treasuryCertifier = new TreasuryCertifier({
                solanaEngine,
                prisma,
                logApi,
                formatLog,
                fancyColors,
                decryptPrivateKey: this.decryptPrivateKey.bind(this),
                config
            });
            
            // Store certifier instance for cleanup during service shutdown
            this.treasuryCertifier = treasuryCertifier;
            
            // Run the certification process
            await treasuryCertifier.runCertification(delayMs);
            
        } catch (error) {
            // Log but don't fail initialization if certification setup fails
            logApi.error(`${formatLog.tag()} ${formatLog.error('Treasury Certification error:')}`, {
                error: error.message,
                stack: error.stack
            });
        }
    }
    
    /**
     * Override stop method to ensure any in-progress certification is cleaned up
     * @returns {Promise<boolean>}
     */
    async stop() {
        // Clean up certification resources if there was an active treasury certifier
        if (this.treasuryCertifier) {
            try {
                logApi.info(`${formatLog.tag()} ${formatLog.info('Cleaning up Treasury Certification resources...')}`);
                // Handle in-progress certification cleanups
                if (typeof this.treasuryCertifier.cleanup === 'function') {
                    await this.treasuryCertifier.cleanup();
                }
            } catch (error) {
                logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error cleaning up Treasury Certification: ${error.message}`)}`);
            }
        }
        
        // Continue with normal service shutdown
        return super.stop();
    }
}

// Export service singleton
const contestWalletService = new ContestWalletService();
export default contestWalletService;