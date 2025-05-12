// services/contest-wallet/contestWalletService.js

/**
 * Contest Wallet Service
 * 
 * @description This service is responsible for managing contest wallets.
 *   It has been updated to use SolanaEngine which provides enhanced RPC capabilities
 *   with multi-endpoint support and automatic failover.
 * 
 * @module services/contest-wallet/contestWalletService
 * @author @BranchManager69
 * @version 1.9.1
 * @created 2025-04-28
 * @updated 2025-05-09 - Undergoing significant refactoring to support new v2 TreasuryCertifier.
 */

// Polyfill WebSocket for Node.js (use ws package)
import WebSocket from 'ws';
global.WebSocket = WebSocket;

// ** Service Auth **
import { generateServiceAuthHeader } from '../../config/service-auth.js'; // why unused?
// ** Service Class **
import { BaseService } from '../../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../../utils/service-suite/service-error.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import prisma from '../../config/prisma.js';
import { fancyColors, serviceSpecificColors } from '../../utils/colors.js';
// Removed bs58 and @solana/web3.js imports as they are no longer used
import crypto from 'crypto';
import { SERVICE_NAMES, getServiceMetadata } from '../../utils/service-suite/service-constants.js';
// Import SolanaEngine (new direct integration)
import { solanaEngine } from '../../services/solana-engine/index.js';
// Import TreasuryCertifier for certification and stranded funds recovery
import TreasuryCertifier from './treasury-certifier.js';
// Import VanityApiClient for vanity wallet operations
import VanityApiClient from '../../services/vanity-wallet/vanity-api-client.js';

// V2 Solana SDK Imports needed for refactored methods
import { generateKeyPair as generateKeyPairV2 } from '@solana/keys';
import { createKeyPairSignerFromBytes, createKeyPairSignerFromPrivateKeyBytes } from '@solana/signers';
import { getAddressFromPublicKey, address as v2Address } from '@solana/addresses';
import { Buffer } from 'node:buffer';

// Config
import { config } from '../../config/config.js';

// Local Constants
const LAMPORTS_PER_SOL_V2 = 1_000_000_000;

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
        this.treasuryCertifierInstance = null; // Initialize the instance property
        
        // Initialize WebSocket subscription tracking
        this.websocketSubscriptions = {
            // Track wallet accounts being monitored via WebSocket
            subscribedAccounts: new Set(),
            // Track when subscriptions were last attempted
            subscriptionAttempts: new Map(),
            // Track accounts with active subscriptions
            activeSubscriptions: new Map(),
            // Timestamp of last recovery attempt
            lastRecoveryAttempt: null,
            // Track connection to unified WebSocket
            unifiedWsConnection: null,
            // Subscription recovery interval
            recoveryInterval: null
        };
        
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
    
    // Initialize the TreasuryCertifier
    /**
     * Initialize the TreasuryCertifier for the new simplified v2 health check.
     * 
     * @returns {Promise<TreasuryCertifier | null>} The TreasuryCertifier instance or null on failure.
     */
    async initTreasuryCertifier() {
        try {
            if (this.treasuryCertifierInstance) {
                logApi.info(`${formatLog.tag()} ${formatLog.header('TREASURY (v2)')} TreasuryCertifier already initialized, skipping.`);
                return this.treasuryCertifierInstance;
            }
            
            logApi.info(`${formatLog.tag()} ${formatLog.header('TREASURY (v2)')} Initializing new TreasuryCertifier (Minimalist Health Check)...`);
            
            // These should be class members or correctly scoped variables if not passed directly
            // For this edit, I'm assuming they are available in the class scope (e.g., this.logApi, this.formatLog)
            // or imported globally (like solanaEngine, prisma, config from the top of the file).
            this.treasuryCertifierInstance = new TreasuryCertifier({
                solanaEngine: solanaEngine, // Assuming global/module scope import
                prisma: prisma,             // Assuming global/module scope import
                logApi: logApi,           // Assuming global/module scope import or this.logApi
                formatLog: formatLog,       // Assuming global/module scope import or this.formatLog
                fancyColors: fancyColors,     // Assuming global/module scope import or this.fancyColors
                config: config              // Assuming global/module scope import (appConfig)
            });
            
            logApi.info(`${formatLog.tag()} ${formatLog.success('New TreasuryCertifier (v2 Minimalist) instance created.')}`);
            return this.treasuryCertifierInstance;
            
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error('TreasuryCertifier v2 initialization error:')}`, {
                error: error.message,
                stack: error.stack
            });
            if (this.walletStats && this.walletStats.errors) { // Safe access
                this.walletStats.errors.last_error = `TreasuryCertifier v2 init error: ${error.message}`;
            }
            return null; 
        }
    }

    // Initialize the contest wallet service
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
            
            const success = await super.initialize();
            if (!success) {
                return false;
            }
            
            if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                logApi.warn(`${formatLog.tag()} ${formatLog.header('WAITING FOR SOLANA')} ${formatLog.warning('SolanaEngine not yet initialized, will wait...')}`);
                for (let i = 0; i < 5; i++) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    if (typeof solanaEngine.isInitialized === 'function' ? solanaEngine.isInitialized() : solanaEngine.isInitialized) {
                        logApi.info(`${formatLog.tag()} ${formatLog.success('SolanaEngine now available.')}`);
                        break;
                    }
                }
                if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                    throw new Error('SolanaEngine is not available after waiting. Contest Wallet Service requires SolanaEngine.');
                }
            }
            
            const connectionStatus = solanaEngine.getConnectionStatus ? solanaEngine.getConnectionStatus() : { healthyEndpoints: 'N/A', totalEndpoints: 'N/A' };
            const healthyEndpoints = connectionStatus?.healthyEndpoints || 0;
            const totalEndpoints = connectionStatus?.totalEndpoints || 0;
            
            logApi.info(`${formatLog.tag()} ${formatLog.success('Contest Wallet Service initialized successfully')}`);
            logApi.info(`${formatLog.tag()} ${formatLog.info(`Using SolanaEngine with ${healthyEndpoints}/${totalEndpoints} healthy RPC endpoints`)}`);
            
            logApi.info(`${formatLog.tag()} ${formatLog.header('DIRECT RPC WEBSOCKET')} Setting up direct Solana RPC wallet monitoring`);
            this.initializeWebSocketMonitoring().then(() => {
                logApi.info(`${formatLog.tag()} ${formatLog.success('Direct RPC WebSocket monitoring initialized successfully')}`);
                if(this.walletStats && this.walletStats.websocket_monitoring) {
                    this.walletStats.websocket_monitoring.enabled = true;
                    this.walletStats.websocket_monitoring.initialized_at = new Date().toISOString();
                    this.walletStats.websocket_monitoring.status = 'active';
                }
            }).catch(err => {
                logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Failed to initialize direct RPC WebSocket monitoring: ${err.message}`)}`, {
                    error: err.message,
                    stack: err.stack
                });
                logApi.info(`${formatLog.tag()} ${formatLog.info('Falling back to traditional polling for wallet balances')}`);
                if(this.walletStats && this.walletStats.websocket_monitoring) {
                    this.walletStats.websocket_monitoring.enabled = false;
                    this.walletStats.websocket_monitoring.error = err.message;
                    this.walletStats.websocket_monitoring.status = 'fallback_to_polling';
                }
                this.startPollingFallback();
            });
            
            // Initialize the NEW TreasuryCertifier. 
            this.initTreasuryCertifier().then((certifierInstance) => {
                const selfTestEnabled = process.env.CONTEST_WALLET_SELF_TEST === 'true' || 
                                        (config.service_test && config.service_test.contest_wallet_self_test === true);

                if (certifierInstance && selfTestEnabled) {
                    logApi.info(`${formatLog.tag()} ${formatLog.header('SELF-TEST')} Scheduling wallet self-test with new TreasuryCertifier.`);
                    // Assuming scheduleSelfTest will call certifierInstance.runCertification()
                    // If scheduleSelfTest is async, its promise should be handled or returned.
                    this.scheduleSelfTest(certifierInstance); 
                } else if (certifierInstance) {
                    logApi.info(`${formatLog.tag()} ${formatLog.info('New TreasuryCertifier initialized, self-test not enabled.')}`);
                } else {
                    logApi.warn(`${formatLog.tag()} ${formatLog.warning('TreasuryCertifier failed to initialize. Self-test cannot run.')}`);
                }
            }).catch(err => {
                logApi.warn(`${formatLog.tag()} ${formatLog.warning('TreasuryCertifier init/self-test scheduling failed: ' + err.message)}`);
            });
            
            logApi.info(`${formatLog.tag()} ${formatLog.info('Service initialization continuing - Treasury certification (if enabled) runs via self-test.')}`);
            return true;
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error('Contest Wallet Service initialization error:')}`, {
                error: error.message,
                stack: error.stack
            });
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
            
            // Get current Solana balance using SolanaEngine, passing string address
            // connectionManager.executeSolanaRpcMethod (which executeConnectionMethod maps to)
            // should handle string addresses for 'getBalance'.
            const lamports = await solanaEngine.executeConnectionMethod('getBalance', wallet.wallet_address);
            const solBalance = lamports / LAMPORTS_PER_SOL_V2; // Use V2 constant
            
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
                previous_balance: wallet.balance || 0, // Ensure previous_balance is a number
                current_balance: solBalance,
                difference: solBalance - (wallet.balance || 0)
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
    
    // Update all wallets' balances via polling fallback
    /**
     * Start the traditional polling fallback for wallet balances
     * This method is called when WebSocket monitoring fails or is unavailable
     */
    startPollingFallback() {
        // Clear any existing polling interval
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        
        // Log start of polling fallback
        logApi.info(`${formatLog.tag()} ${formatLog.header('FALLBACK')} Starting balance polling fallback mechanism`);
        
        // Start polling interval - run updateAllWalletBalances at regular intervals
        const pollingIntervalMs = this.config.checkIntervalMs || 5 * 60 * 1000; // 5 minutes default
        
        // Run first poll immediately
        this.updateAllWalletBalances()
            .then(result => {
                logApi.info(`${formatLog.tag()} ${formatLog.success(`Initial polling completed: ${result.updated_count} wallets updated`)}`);
            })
            .catch(err => {
                logApi.error(`${formatLog.tag()} ${formatLog.error(`Initial polling fallback error: ${err.message}`)}`, {
                    error: err.message,
                    stack: err.stack
                });
            });
        
        // Set up regular polling interval
        this.pollingInterval = setInterval(() => {
            if (this.isOperational && !this.isShuttingDown) {
                // Check if WebSocket monitoring is back online
                if (this.websocketSubscriptions.unifiedWsConnection && 
                    this.websocketSubscriptions.unifiedWsConnection.readyState === 1) {
                    logApi.info(`${formatLog.tag()} ${formatLog.success('WebSocket connection restored, stopping polling fallback')}`);
                    
                    // WebSocket is back online, stop polling
                    clearInterval(this.pollingInterval);
                    this.pollingInterval = null;
                    
                    // Update status
                    this.walletStats.websocket_monitoring = {
                        enabled: true,
                        reconnected_at: new Date().toISOString(),
                        status: 'active'
                    };
                    
                    return;
                }
                
                // WebSocket still not available, continue polling
                this.updateAllWalletBalances().catch(err => {
                    logApi.error(`${formatLog.tag()} ${formatLog.error(`Polling fallback error: ${err.message}`)}`, {
                        error: err.message,
                        stack: err.stack
                    });
                });
            }
        }, pollingIntervalMs);
        
        // Ensure interval doesn't keep process alive during shutdown
        if (this.pollingInterval && this.pollingInterval.unref) {
            this.pollingInterval.unref();
        }
        
        // Store in stats
        this.walletStats.polling_fallback = {
            started_at: new Date().toISOString(),
            interval_ms: pollingIntervalMs,
            status: 'active'
        };
    }
    
    /**
     * Initialize WebSocket account monitoring for all contest wallets
     * This method sets up real-time monitoring of contest wallet balances
     * using the unified WebSocket system's Solana PubSub feature.
     */
    async initializeWebSocketMonitoring() {
        logApi.info(`${formatLog.tag()} ${formatLog.header('DIRECT RPC WEBSOCKET')} Initializing direct Solana RPC WebSocket monitoring for contest wallets`);

        try {
            // Import the wallet-balance-ws module
            const walletBalanceWs = (await import('./modules/wallet-balance-ws.js')).default;

            // Store module reference for later use
            this.walletBalanceWs = walletBalanceWs;

            // Initialize WebSocket monitoring stats in walletStats
            if (!this.walletStats.websocket_monitoring) {
                this.walletStats.websocket_monitoring = {
                    enabled: false,
                    status: 'initializing',
                    initialized_at: null,
                    last_connection_attempt: new Date().toISOString(),
                    connection_attempts: 0,
                    successful_connections: 0,
                    subscribed_accounts: 0,
                    active_subscriptions: 0,
                    last_balance_update: null,
                    balance_updates: 0,
                    significant_updates: 0,
                    connection_errors: 0,
                    subscription_errors: 0,
                    last_error: null,
                    last_error_time: null
                };
            }

            // Initialize the WebSocket connection with all contest wallets
            const initialized = await walletBalanceWs.initializeWalletBalanceWebSocket(solanaEngine, this.config);

            if (initialized) {
                logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully initialized direct Solana RPC WebSocket monitoring')}`);

                // Update stats
                this.walletStats.websocket_monitoring.enabled = true;
                this.walletStats.websocket_monitoring.status = 'active';
                this.walletStats.websocket_monitoring.initialized_at = new Date().toISOString();

                // Set up periodic status check
                this.startWebSocketStatusChecks();

                return true;
            } else {
                throw new Error('Failed to initialize direct Solana RPC WebSocket monitoring');
            }
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to initialize direct RPC WebSocket monitoring: ${error.message}`)}`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
    
    /**
     * Start periodic checks of WebSocket status to update internal stats
     */
    startWebSocketStatusChecks() {
        if (this.websocketStatusInterval) {
            clearInterval(this.websocketStatusInterval);
        }

        this.websocketStatusInterval = setInterval(() => {
            if (this.isOperational && !this.isShuttingDown && this.walletBalanceWs) {
                try {
                    // Get WebSocket status
                    const status = this.walletBalanceWs.getWebSocketStatus();

                    // Update internal stats
                    this.walletStats.websocket_monitoring.status = status.connectionState === 'connected' ? 'active' : 'reconnecting';
                    this.walletStats.websocket_monitoring.subscribed_accounts = status.walletCount || 0;
                    this.walletStats.websocket_monitoring.active_subscriptions = status.subscriptionCount || 0;
                    this.walletStats.websocket_monitoring.balance_updates = status.stats?.balanceUpdates || 0;
                    this.walletStats.websocket_monitoring.significant_updates = status.stats?.significantUpdates || 0;
                    this.walletStats.websocket_monitoring.last_update = status.stats?.lastUpdate;
                    this.walletStats.websocket_monitoring.connection_errors = status.stats?.errors || 0;
                    this.walletStats.websocket_monitoring.last_error = status.stats?.lastError;
                    this.walletStats.websocket_monitoring.last_error_time = status.stats?.lastErrorTime;

                    // Log status periodically
                    logApi.debug(`${formatLog.tag()} ${formatLog.info(`WebSocket status: ${status.connectionState}, ${status.walletCount} wallets monitored, ${status.subscriptionCount} active subscriptions`)}`);

                } catch (error) {
                    logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to check WebSocket status: ${error.message}`)}`, {
                        error: error.message
                    });
                }
            }
        }, 60 * 1000); // Check every minute

        // Ensure interval doesn't keep process alive during shutdown
        if (this.websocketStatusInterval && this.websocketStatusInterval.unref) {
            this.websocketStatusInterval.unref();
        }
    }

    /**
     * Add a new wallet to be monitored via WebSocket
     * @param {Object} wallet - Wallet object from database
     * @returns {Promise<boolean>} - Success status
     */
    async addWalletToWebSocketMonitor(wallet) {
        if (!this.walletBalanceWs || !wallet || !wallet.wallet_address) {
            return false;
        }

        try {
            return await this.walletBalanceWs.addWalletToMonitor(wallet);
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to add wallet to WebSocket monitor: ${error.message}`)}`, {
                error: error.message,
                wallet_address: wallet.wallet_address
            });
            return false;
        }
    }

    /**
     * Remove a wallet from WebSocket monitoring
     * @param {string} address - Wallet address to remove
     * @returns {boolean} - Success status
     */
    removeWalletFromWebSocketMonitor(address) {
        if (!this.walletBalanceWs || !address) {
            return false;
        }

        try {
            return this.walletBalanceWs.removeWalletFromMonitor(address);
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to remove wallet from WebSocket monitor: ${error.message}`)}`, {
                error: error.message,
                wallet_address: address
            });
            return false;
        }
    }

    /**
     * Refresh the list of wallets being monitored via WebSocket
     * @returns {Promise<boolean>} - Success status
     */
    async refreshWebSocketMonitoredWallets() {
        if (!this.walletBalanceWs) {
            return false;
        }

        try {
            return await this.walletBalanceWs.refreshMonitoredWallets();
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to refresh WebSocket monitored wallets: ${error.message}`)}`, {
                error: error.message
            });
            return false;
        }
    }

    /**
     * Get the current status of the WebSocket monitoring
     * @returns {Object} - WebSocket status
     */
    getWebSocketStatus() {
        if (!this.walletBalanceWs) {
            return {
                active: false,
                status: 'not_initialized',
                error: 'WebSocket monitoring not initialized'
            };
        }

        try {
            return this.walletBalanceWs.getWebSocketStatus();
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to get WebSocket status: ${error.message}`)}`, {
                error: error.message
            });
            return {
                active: false,
                status: 'error',
                error: error.message
            };
        }
    }

    /**
     * Create a WebSocket client for service-to-service communication
     * This client connects to the unified WebSocket server
     * to subscribe to Solana account updates
     * @deprecated Replaced by direct Solana RPC WebSocket connection
     */
    async createServiceWebSocketClient() {
        // If WebSocket is already connected, disconnect it first
        if (this.websocketSubscriptions.unifiedWsConnection) {
            try {
                this.websocketSubscriptions.unifiedWsConnection.close();
            } catch (err) {
                // Ignore close errors
            }
        }
        
        return new Promise(async (resolve, reject) => {
            try {
                // Check if the global WebSocketReadyEmitter exists
                if (global.webSocketReadyEmitter) {
                    logApi.info(`${formatLog.tag()} ${formatLog.info('Waiting for WebSocket server to be ready...')}`);
                    
                    // Wait for the websocket:ready event
            ;        await new Promise(waitResolve => {
                        // If the server is already ready, resolve immediately
                        if (global.webSocketServerReady === true) {
                            waitResolve();
                            return;
                        }
                        
                        // Otherwise wait for the ready event
                        const readyHandler = () => {
                            global.webSocketReadyEmitter.off('websocket:ready', readyHandler);
                            logApi.info(`${formatLog.tag()} ${formatLog.success('WebSocket server is now ready')}`);
                            global.webSocketServerReady = true;
                            waitResolve();
                        };
                        
                        global.webSocketReadyEmitter.once('websocket:ready', readyHandler);
                        
                        // Add a timeout just in case the event never fires
                        setTimeout(() => {
                            global.webSocketReadyEmitter.off('websocket:ready', readyHandler);
                            logApi.warn(`${formatLog.tag()} ${formatLog.warning('Timed out waiting for WebSocket server ready event')}`);
                            waitResolve(); // Continue anyway after timeout
                        }, 30000); // 30 second timeout
                    });
                }
                
                // Get WebSocket server URL from config
                // Fix: Use the same port that the unified WebSocket is actually running on (3004 or 3005)
                // We need to check both the app port and the unified websocket port configuration
                const wsProtocol = 'ws:'; // For internal comms, we use ws
                const host = 'localhost';
                
                // IMPORTANT: API_PORT is used for internal WebSocket connections
                // This is critical for proper WebSocket connectivity on development and production
                const port = process.env.API_PORT || config.port || 3004;
                
                // The unified WebSocket path
                const path = config.websocket?.config?.path || '/api/v69/ws';
                
                const wsUrl = `${wsProtocol}//${host}:${port}${path}`;
                
                // Add debug information
                logApi.info(`${formatLog.tag()} ${formatLog.header('WEBSOCKET')} Connection details: host=${host}, port=${port}, path=${path}`);
                logApi.info(`${formatLog.tag()} ${formatLog.info(`Connecting to unified WebSocket at ${wsUrl}`)}`);
                
                // Add retry mechanism for connection attempts
                let retryCount = 0;
                const maxRetries = 10;
                const connectWithRetry = async () => {
                    try {
                        // Create WebSocket connection
                        const ws = new WebSocket(wsUrl);
                        
                        // Set up event handlers
                        ws.onopen = () => {
                            logApi.info(`${formatLog.tag()} ${formatLog.success('WebSocket connection established')}`);
                            this.websocketSubscriptions.unifiedWsConnection = ws;
                            this.websocketSubscriptions.connectionRetries = 0; // Reset retry counter on success
                            resolve(ws);
                        };
                        
                        ws.onclose = (event) => {
                            logApi.warn(`${formatLog.tag()} ${formatLog.warning(`WebSocket connection closed: ${event.code}`)}`);
                            
                            // Clear subscriptions since connection is closed
                            this.websocketSubscriptions.activeSubscriptions.clear();
                            
                            // Reconnect after delay unless service is shutting down
                            if (this.isOperational && !this.isShuttingDown) {
                                // Use exponential backoff for reconnection attempts
                                const reconnectRetries = this.websocketSubscriptions.connectionRetries || 0;
                                const backoffTime = Math.min(1000 * Math.pow(2, reconnectRetries), 60000);
                                this.websocketSubscriptions.connectionRetries = reconnectRetries + 1;
                                
                                logApi.info(`${formatLog.tag()} ${formatLog.info(`Will attempt to reconnect in ${backoffTime/1000} seconds (retry #${this.websocketSubscriptions.connectionRetries})`)}`);
                                
                                setTimeout(() => {
                                    this.createServiceWebSocketClient().catch(err => {
                                        logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to reconnect WebSocket: ${err.message}`)}`, {
                                            error: err.message
                                        });
                                    });
                                }, backoffTime);
                            }
                        };
                        
                        ws.onerror = (error) => {
                            logApi.error(`${formatLog.tag()} ${formatLog.error(`WebSocket error: ${error.message || 'Unknown error'}`)}`);
                            
                            if (!this.websocketSubscriptions.unifiedWsConnection) {
                                // For connection errors, attempt retry if below max retries
                                if (retryCount < maxRetries) {
                                    retryCount++;
                                    const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Exponential backoff with max 30 sec
                                    
                                    logApi.error(`${formatLog.tag()} ${formatLog.error(`Connection attempt failed. Retrying in ${delay/1000} seconds (attempt ${retryCount}/${maxRetries})`)}`);
                                    
                                    setTimeout(connectWithRetry, delay);
                                } else {
                                    logApi.info(`${formatLog.tag()} ${formatLog.info('Falling back to traditional polling for wallet balances')}`);
                                    reject(new Error(`Failed to connect to WebSocket after ${maxRetries} attempts`));
                                }
                            }
                        };
                        
                        ws.onmessage = (event) => {
                            this.handleWebSocketMessage(event);
                        };
                    } catch (error) {
                        if (retryCount < maxRetries) {
                            retryCount++;
                            const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
                            
                            logApi.warn(`${formatLog.tag()} ${formatLog.warning(`WebSocket connection error: ${error.message}. Retrying in ${delay/1000} seconds (attempt ${retryCount}/${maxRetries})`)}`);
                            
                            setTimeout(connectWithRetry, delay);
                        } else {
                            logApi.info(`${formatLog.tag()} ${formatLog.info('Falling back to traditional polling for wallet balances')}`);
                            reject(error);
                        }
                    }
                };
                
                // Initialize retry counter if it doesn't exist
                if (this.websocketSubscriptions.connectionRetries === undefined) {
                    this.websocketSubscriptions.connectionRetries = 0;
                }
                
                // Start connection process with retry mechanism
                connectWithRetry();
                
            } catch (error) {
                logApi.info(`${formatLog.tag()} ${formatLog.info('Falling back to traditional polling for wallet balances')}`);
                reject(error);
            }
        });
    }
    
    /**
     * Handle incoming WebSocket messages from the unified WebSocket server
     * @param {MessageEvent} event - WebSocket message event
     */
    async handleWebSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
            
            // Handle different message types
            switch (message.type) {
                case 'ACKNOWLEDGMENT':
                    // Handle subscription acknowledgment
                    if (message.topic === 'solana' && message.action === 'subscribe') {
                        const accounts = message.data?.accepted?.accounts || [];
                        for (const account of accounts) {
                            this.websocketSubscriptions.activeSubscriptions.set(account, new Date());
                            logApi.debug(`${formatLog.tag()} ${formatLog.success(`Account subscription confirmed: ${account}`)}`);
                        }
                    }
                    break;
                
                case 'DATA':
                    // Handle account update data
                    if (message.topic === 'solana' && message.subtype === 'account-update') {
                        await this.handleAccountUpdate(message.data);
                    }
                    break;
                
                case 'ERROR':
                    // Handle subscription errors
                    logApi.warn(`${formatLog.tag()} ${formatLog.warning(`WebSocket error: ${message.error}`)}`, { 
                        topic: message.topic,
                        account: message.data?.account
                    });
                    
                    // If account-specific error, remove from active subscriptions
                    if (message.data?.account) {
                        this.websocketSubscriptions.activeSubscriptions.delete(message.data.account);
                    }
                    break;
                
                default:
                    // Unknown message type, just log it
                    logApi.debug(`${formatLog.tag()} ${formatLog.info(`Received unknown message type: ${message.type}`)}`, { message });
            }
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error(`Error handling WebSocket message: ${error.message}`)}`, {
                error: error.message,
                stack: error.stack
            });
        }
    }
    
    /**
     * Handle Solana account update from WebSocket
     * @param {Object} data - The account update data
     */
    async handleAccountUpdate(data) {
        try {
            // Extract account address and update data
            const { account, value } = data;
            
            if (!account || !value) {
                return; // Invalid data
            }
            
            // Find the contest wallet in database
            const wallet = await prisma.contest_wallets.findFirst({
                where: { wallet_address: account },
                include: {
                    contests: {
                        select: {
                            id: true,
                            contest_code: true,
                            status: true
                        }
                    }
                }
            });
            
            if (!wallet) {
                logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Received update for unknown wallet: ${account}`)}`);
                return;
            }
            
            // Extract lamports and calculate SOL balance
            const lamports = value.lamports || 0;
            const solBalance = lamports / LAMPORTS_PER_SOL_V2; // Use V2 constant
            
            // Compare with current balance in database
            const currentBalance = wallet.balance || 0;
            
            // If balance hasn't changed significantly (less than 0.0001 SOL), skip update
            if (Math.abs(solBalance - currentBalance) < 0.0001) {
                return;
            }
            
            // Update wallet balance in database
            await prisma.contest_wallets.update({
                where: { id: wallet.id },
                data: {
                    balance: solBalance,
                    last_sync: new Date(),
                    updated_at: new Date()
                }
            });
            
            // Log the balance update with nice formatting
            // Special formatting for notable changes
            if (Math.abs(solBalance - currentBalance) >= 0.01) {
                // Format contest ID and code with consistent spacing
                const formattedContestId = wallet.contests?.id ? wallet.contests.id.toString().padStart(4) : "N/A ".padStart(4);
                const formattedContestCode = (wallet.contests?.contest_code || "Unknown").padEnd(10);
                
                // Format difference with sign and color
                const diffText = formatLog.balanceChange(solBalance - currentBalance);
                
                // Log the update with consistent formatting
                logApi.info(`${formatLog.tag()} ${formatLog.highlight(`WS UPDATE`)} Contest ${formattedContestId} (${formattedContestCode}) Balance: ${formatLog.balance(solBalance)} ${diffText}`);
                
                // Update statistics
                this.walletStats.balance_updates.total++;
                this.walletStats.balance_updates.successful++;
                this.walletStats.balance_updates.last_update = new Date().toISOString();
                this.walletStats.wallets.updated++;
            } else {
                // For minor changes, use debug log level
                logApi.debug(`${formatLog.tag()} ${formatLog.info(`Minor balance update for ${account}: ${solBalance} SOL (change: ${(solBalance - currentBalance).toFixed(6)} SOL)`)}`);
            }
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error(`Error handling account update: ${error.message}`)}`, {
                error: error.message,
                stack: error.stack,
                account: data.account
            });
        }
    }
    
    /**
     * Subscribe to a batch of wallet accounts via WebSocket
     * @param {Array} wallets - Array of wallet objects to subscribe to
     */
    async subscribeToWalletBatch(wallets) {
        try {
            // Skip if WebSocket is not connected
            if (!this.websocketSubscriptions.unifiedWsConnection || 
                this.websocketSubscriptions.unifiedWsConnection.readyState !== WebSocket.OPEN) {
                throw new Error("WebSocket not connected");
            }
            
            // Extract wallet addresses
            const accounts = wallets.map(wallet => wallet.wallet_address);
            
            if (accounts.length === 0) {
                return; // Nothing to subscribe to
            }
            
            // Send subscription message to unified WebSocket
            const subscribeMsg = {
                type: 'solana:subscribe',
                accounts,
                commitment: 'confirmed'
            };
            
            this.websocketSubscriptions.unifiedWsConnection.send(JSON.stringify(subscribeMsg));
            
            // Track subscription attempts
            const now = new Date();
            for (const account of accounts) {
                this.websocketSubscriptions.subscriptionAttempts.set(account, now);
                this.websocketSubscriptions.subscribedAccounts.add(account);
            }
            
            logApi.info(`${formatLog.tag()} ${formatLog.info(`Subscribed to ${accounts.length} wallet accounts via WebSocket`)}`);
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to subscribe to wallet batch: ${error.message}`)}`, {
                error: error.message,
                stack: error.stack,
                walletCount: wallets.length
            });
            throw error;
        }
    }
    
    /**
     * Start periodic recovery of failed WebSocket subscriptions
     */
    startSubscriptionRecovery() {
        // Clear existing interval if it exists
        if (this.subscriptionRecoveryInterval) {
            clearInterval(this.subscriptionRecoveryInterval);
            this.subscriptionRecoveryInterval = null;
        }
        
        logApi.info(`${formatLog.tag()} ${formatLog.header('WEBSOCKET')} Starting subscription recovery interval`);
        
        // Run recovery process every 5 minutes
        this.subscriptionRecoveryInterval = setInterval(() => {
            if (this.isOperational && !this.isShuttingDown) {
                this.recoverFailedSubscriptions().catch(err => {
                    logApi.error(`${formatLog.tag()} ${formatLog.error(`Subscription recovery error: ${err.message}`)}`, {
                        error: err.message,
                        stack: err.stack
                    });
                });
            }
        }, 5 * 60 * 1000); // 5 minutes
        
        // Ensure interval doesn't keep process alive during shutdown
        if (this.subscriptionRecoveryInterval && this.subscriptionRecoveryInterval.unref) {
            this.subscriptionRecoveryInterval.unref();
        }
    }
    
    /**
     * Recover failed WebSocket subscriptions
     */
    async recoverFailedSubscriptions() {
        try {
            // Skip if WebSocket is not connected
            if (!this.websocketSubscriptions.unifiedWsConnection || 
                this.websocketSubscriptions.unifiedWsConnection.readyState !== WebSocket.OPEN) {
                return;
            }
            
            // Find accounts that we attempted to subscribe to but aren't active
            const failedAccounts = [];
            
            for (const account of this.websocketSubscriptions.subscribedAccounts) {
                if (!this.websocketSubscriptions.activeSubscriptions.has(account)) {
                    failedAccounts.push(account);
                }
            }
            
            if (failedAccounts.length === 0) {
                return; // No failed subscriptions to recover
            }
            
            logApi.info(`${formatLog.tag()} ${formatLog.header('RECOVERY')} Recovering ${failedAccounts.length} failed WebSocket subscriptions`);
            
            // Process in batches of 50
            const batchSize = 50;
            for (let i = 0; i < failedAccounts.length; i += batchSize) {
                const batch = failedAccounts.slice(i, i + batchSize);
                
                // Create subscription batch with wallet objects
                const walletBatch = await prisma.contest_wallets.findMany({
                    where: {
                        wallet_address: {
                            in: batch
                        }
                    },
                    include: {
                        contests: {
                            select: {
                                id: true,
                                contest_code: true,
                                status: true
                            }
                        }
                    }
                });
                
                // Subscribe to this batch
                await this.subscribeToWalletBatch(walletBatch);
                
                // Small delay between batches
                if (i + batchSize < failedAccounts.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            // Update last recovery timestamp
            this.websocketSubscriptions.lastRecoveryAttempt = new Date();
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to recover subscriptions: ${error.message}`)}`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
    
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
                
                // Create batch of STRING public keys for getMultipleAccountsInfo
                const publicKeysStrings = walletBatch.map(wallet => wallet.wallet_address);
                
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
                    const balancesInfoResults = await solanaEngine.executeConnectionMethod('getMultipleAccountsInfo', publicKeysStrings);
                    
                    // Reset consecutive rate limit counter on success
                    consecutiveRateLimitHits = 0;
                    
                    // Collect DB updates to do in a single transaction
                    const dbUpdates = [];
                    const balanceChanges = [];

                    // Process each contest wallet in the batch with its balance                    
                    for (let i = 0; i < walletBatch.length; i++) {
                        const wallet = walletBatch[i];
                        const accountInfo = balancesInfoResults[i];
                        
                        try {
                            // If account doesn't exist yet, it has 0 balance
                            const lamports = accountInfo ? accountInfo.lamports : 0;
                            const solBalance = lamports / LAMPORTS_PER_SOL_V2; // Use V2 constant
                            
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
                logApi.info(`${formatLog.tag()} ${formatLog.info('No wallets found with SOL balance')}`);
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
     * Implements the onPerformOperation method required by BaseService
     * This gets called regularly by the BaseService to perform the service's main operation
     * and is used for circuit breaker recovery
     * 
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

    /**
     * Perform the main operation of the contest wallet service
     * 
     * @returns {Promise<Object>} - The results of the operation
     */
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
     * Decrypt private key from encrypted storage.
     * Handles both new v2_seed format and legacy formats for backward compatibility.
     * 
     * @param {string} encryptedData - The encrypted private key data (JSON string).
     * @returns {Buffer} - The decrypted 32-byte private key seed or 64-byte legacy key as a Buffer.
     * @throws {ServiceError} - If decryption fails or format is unrecognized.
     */
    decryptPrivateKey(encryptedData) {
        this.logApi.debug(`${formatLog.tag()} Attempting to decrypt private key data.`);
        try {
            const decryptedBuffer = walletCrypto.decryptWallet(encryptedData, process.env.WALLET_ENCRYPTION_KEY);
            if (!(decryptedBuffer instanceof Buffer)) {
                throw ServiceError.operation('Decryption did not yield a Buffer, which is unexpected for encrypted keys.');
            }
            return decryptedBuffer;
            } catch (error) {
            this.logApi.error(`${formatLog.tag()} Error in decryptPrivateKey: ${error.message}`, { error });
            if (error instanceof ServiceError) throw error;
            throw ServiceError.operation(`Decryption failed: ${error.message}`, { originalError: error });
        }
    }

    /**
     * Performs a blockchain transfer from a managed contest wallet.
     * 
     * @param {Object} sourceWallet - The source wallet object from DB (must have encrypted_private_key).
     * @param {string} destinationAddressString - The recipient's public key string.
     * @param {number} amount - The amount in SOL to transfer.
     * @returns {Promise<Object>} - Transaction signature and details.
     */
    async performBlockchainTransfer(sourceWallet, destinationAddressString, amount) {
        this.logApi.info(`${formatLog.tag()} Initiating blockchain transfer from ${sourceWallet.wallet_address} to ${destinationAddressString} for ${amount} SOL.`);
        const startTime = Date.now();

        if (!sourceWallet || !sourceWallet.encrypted_private_key) {
            throw ServiceError.validation('Source wallet or its encrypted private key is missing.');
        }

        let signer;
        try {
            const decryptedKeyOrSeed = this.decryptPrivateKey(sourceWallet.encrypted_private_key);

            if (decryptedKeyOrSeed.length === 32) {
                this.logApi.debug(`${formatLog.tag()} Decrypted a 32-byte seed. Creating signer with createKeyPairSignerFromBytes.`);
                signer = await createKeyPairSignerFromBytes(decryptedKeyOrSeed);
            } else if (decryptedKeyOrSeed.length === 64) {
                this.logApi.debug(`${formatLog.tag()} Decrypted a 64-byte legacy key. Creating signer with createSignerFromLegacyKey (compat layer).`);
                signer = await createSignerFromLegacyKey(decryptedKeyOrSeed);
                } else {
                const errMsg = `Decrypted key/seed has an unexpected length: ${decryptedKeyOrSeed.length}. Expected 32 or 64 bytes.`;
                this.logApi.error(`${formatLog.tag()} ${errMsg}`);
                throw ServiceError.operation(errMsg, { type: 'KEY_MATERIAL_LENGTH_ERROR' });
            }
        } catch (error) {
            this.logApi.error(`${formatLog.tag()} Failed to decrypt key or create signer for wallet ${sourceWallet.wallet_address}: ${error.message}`, { stack: error.stack });
            if (error instanceof ServiceError) throw error;
            throw ServiceError.operation(`Key decryption or signer creation failed for ${sourceWallet.wallet_address}`, { originalError: error.message });
        }
        
        if (!signer) {
             throw ServiceError.operation(`Failed to create a signer for wallet ${sourceWallet.wallet_address}.`);
        }
        
        try {
            const transferResult = await this.executeTransfer(signer, destinationAddressString, amount);
            
            this.logApi.info(`${formatLog.tag()} Blockchain transfer successful. Signature: ${transferResult.signature}. Duration: ${Date.now() - startTime}ms`);
            return transferResult;
        } catch (error) {
            this.logApi.error(`${formatLog.tag()} Blockchain transfer from ${sourceWallet.wallet_address} failed: ${error.message}`, { stack: error.stack, amount, to: destinationAddressString });
            if (error instanceof ServiceError) throw error;
            throw ServiceError.operation(`Blockchain transfer failed: ${error.message}`, { originalError: error });
        }
    }

    /**
     * Executes the actual transfer using a v2 signer.
     * (This method would use solanaEngine.sendTransaction internally)
     * 
     * @param {KeyPairSigner} fromSigner_v2 - The v2 KeyPairSigner for the source wallet.
     * @param {string} destinationAddressString - The recipient's public key string.
     * @param {number} amount - The amount in SOL to transfer.
     * @returns {Promise<Object>} - Transaction signature and details.
     */
    async executeTransfer(fromSigner_v2, destinationAddressString, amount) {
        this.logApi.info(`${formatLog.tag()} Executing transfer with v2 signer ${fromSigner_v2.address} to ${destinationAddressString} for ${amount} SOL.`);
        
        if (!solanaEngine || typeof solanaEngine.sendTransaction !== 'function') {
             this.logApi.error(`${formatLog.tag()} solanaEngine.sendTransaction is not available or not a function.`);
             throw ServiceError.internal('SolanaEngine transaction sending capability is missing or invalid.');
        }

        const lamports = Math.round(amount * LAMPORTS_PER_SOL);

        // Manually define the data for a SystemProgram.transfer instruction
        // The instruction index for transfer is 2.
        // Data layout: instruction_index (u32), lamports (u64)
        const instructionData = Buffer.alloc(4 + 8); // 4 bytes for u32, 8 bytes for u64
        instructionData.writeUInt32LE(2, 0); // Instruction index for transfer
        instructionData.writeBigUInt64LE(BigInt(lamports), 4);

        const transferInstruction = {
            programAddress: SYSTEM_PROGRAM_ADDRESS, // System Program ID
            accounts: [
                {
                    address: fromSigner_v2.address,
                    role: 'writeableSigner', // Source account is writable and a signer
                },
                {
                    address: v2Address(destinationAddressString), // Destination account is writable
                    role: 'writeable',
                },
            ],
            data: instructionData,
        };
        
        const instructions = [transferInstruction];
        const feePayerAddress = fromSigner_v2.address;
        const signersArray = [fromSigner_v2];

        try {
            return await solanaEngine.sendTransaction(instructions, feePayerAddress, signersArray, { 
                commitment: 'confirmed', 
                waitForConfirmation: true 
            });
        } catch (error) {
            this.logApi.error(`${formatLog.tag()} solanaEngine.sendTransaction failed during executeTransfer: ${error.message}`, { stack: error.stack });
            // Re-throw to be caught by performBlockchainTransfer's error handler
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
                    // Create batch of STRING public keys
                    const publicKeysStrings = walletBatch.map(wallet => wallet.wallet_address);
                    const balanceInfos = await solanaEngine.executeConnectionMethod('getMultipleAccountsInfo', publicKeysStrings);
                    
                    // Reset consecutive rate limit counter on success
                    consecutiveRateLimitHits = 0;
                    
                    // Process each wallet with its balance
                    for (let i = 0; i < walletBatch.length; i++) {
                        const wallet = walletBatch[i];
                        const accountInfo = balanceInfos[i];
                        
                        try {
                            // If account doesn't exist yet, it has 0 balance
                            const lamports = accountInfo ? accountInfo.lamports : 0;
                            const solBalance = lamports / LAMPORTS_PER_SOL_V2; // Use V2 constant
                            
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
     * Run startup certification of the wallet functionality
     * 
     * @param {TreasuryCertifier} [certifierInstanceToUse] - Optional certifier instance, defaults to this.treasuryCertifierInstance
     * @param {number} [delayMs=5000] - Initial delay in milliseconds before running the test
     * @returns {Promise<void>}
     */
    async scheduleSelfTest(certifierInstanceToUse, delayMs = 5000) { // Added certifierInstanceToUse parameter
        try {
            const runSelfTestEnabled = process.env.CONTEST_WALLET_SELF_TEST === 'true' || 
                                    (config.service_test && config.service_test.contest_wallet_self_test === true);
            
            if (!runSelfTestEnabled) {
                logApi.info(`${formatLog.tag()} ${formatLog.info('Skipping Treasury Certification Self-Test (not enabled)')}`);
                return;
            }
            
            const certifier = certifierInstanceToUse || this.treasuryCertifierInstance;

            if (!certifier) {
                logApi.warn(`${formatLog.tag()} ${formatLog.warning('TreasuryCertifier instance not available for self-test. Skipping.')}`);
                return;
            }
            
            // The old TreasuryCertifier had persistentPool checks here, which are no longer relevant for the new minimalist one.

            // Check if a certification is already in progress (using _currentCertification from TreasuryCertifier)
            // The new certifier doesn't expose _currentCertification directly, but we can add an isBusy() method to it if needed.
            // For now, we assume runCertification can be called; it will handle its own internal state if any.
            // if (certifier._currentCertification && certifier._currentCertification.inProgress) {
            //     logApi.info(`${formatLog.tag()} ${formatLog.info(`Certification already in progress, skipping new self-test initiation`)}`);
            //     return;
            // }

            logApi.info(`${formatLog.tag()} ${formatLog.header('SELF-TEST')} Scheduling Treasury Certification run in ${delayMs}ms.`);

            // Wait for the initial delay
            await new Promise(resolve => setTimeout(resolve, delayMs));
            
            logApi.info(`${formatLog.tag()} ${formatLog.header('SELF-TEST')} Running Treasury Certification now...`);
            const certificationResult = await certifier.runCertification(); // New method takes no args
            
            if (certificationResult.success) {
                logApi.info(`${formatLog.tag()} ${formatLog.success('Treasury Certification Self-Test PASSED:')} ${certificationResult.message}`);
            } else {
                logApi.error(`${formatLog.tag()} ${formatLog.error('Treasury Certification Self-Test FAILED:')} ${certificationResult.message}`);
            }
            
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error('Error during Treasury Certification Self-Test scheduling or execution:')}`, {
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
        // Mark service as shutting down to prevent new operations
        this.isShuttingDown = true;

        // Clean up polling interval if it exists
        if (this.pollingInterval) {
            logApi.info(`${formatLog.tag()} ${formatLog.info('Cleaning up polling interval...')}`);
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }

        // Clean up subscription recovery interval if it exists
        if (this.subscriptionRecoveryInterval) {
            logApi.info(`${formatLog.tag()} ${formatLog.info('Cleaning up subscription recovery interval...')}`);
            clearInterval(this.subscriptionRecoveryInterval);
            this.subscriptionRecoveryInterval = null;
        }

        // Clean up WebSocket status check interval if it exists
        if (this.websocketStatusInterval) {
            logApi.info(`${formatLog.tag()} ${formatLog.info('Cleaning up WebSocket status check interval...')}`);
            clearInterval(this.websocketStatusInterval);
            this.websocketStatusInterval = null;
        }

        // Clean up WebSocket connection if it exists
        if (this.websocketSubscriptions && this.websocketSubscriptions.unifiedWsConnection) {
            logApi.info(`${formatLog.tag()} ${formatLog.info('Cleaning up old WebSocket connection...')}`);
            try {
                this.websocketSubscriptions.unifiedWsConnection.close();
                this.websocketSubscriptions.unifiedWsConnection = null;
            } catch (error) {
                logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error closing old WebSocket connection: ${error.message}`)}`);
            }
        }

        // Clean up direct RPC WebSocket connection if it exists
        if (this.walletBalanceWs) {
            logApi.info(`${formatLog.tag()} ${formatLog.info('Cleaning up direct RPC WebSocket connection...')}`);
            try {
                await this.walletBalanceWs.stopWalletBalanceWebSocket();
                this.walletBalanceWs = null;
            } catch (error) {
                logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error closing direct RPC WebSocket connection: ${error.message}`)}`);
            }
        }

        // Clean up certification resources if there was an active treasury certifier
        if (this.treasuryCertifierInstance) {
            try {
                logApi.info(`${formatLog.tag()} ${formatLog.info('Cleaning up Treasury Certification resources...')}`);
                // Handle in-progress certification cleanups
                if (typeof this.treasuryCertifierInstance.cleanup === 'function') {
                    await this.treasuryCertifierInstance.cleanup();
                }
            } catch (error) {
                logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error cleaning up Treasury Certification: ${error.message}`)}`);
            }
        }

        // Reset shutdown flag before calling super.stop() to ensure clean state
        this.isShuttingDown = false;

        // Continue with normal service shutdown
        return super.stop();
    }

    /**
     * Encrypt private key (now expects a 32-byte seed as Uint8Array)
     * 
     * @param {Uint8Array} privateKeySeedBytes - The 32-byte private key seed to encrypt.
     * @returns {string} - The encrypted private key data as a JSON string.
     */
    encryptPrivateKey(privateKeySeedBytes) {
        if (!(privateKeySeedBytes instanceof Uint8Array) || privateKeySeedBytes.length !== 32) {
            logApi.error(`${formatLog.tag()} ${formatLog.error('encryptPrivateKey expects a 32-byte Uint8Array seed.')}`, { 
                dataType: typeof privateKeySeedBytes,
                length: privateKeySeedBytes?.length
            });
            throw new ServiceError.validation('Invalid input for encryptPrivateKey: Expected 32-byte Uint8Array seed.');
        }

        logApi.info(`${formatLog.tag()} Encrypting 32-byte private key seed.`);
        try {
            const iv = crypto.randomBytes(12); // AES-GCM standard IV size
            const aad = crypto.randomBytes(16); // Optional AAD
            const algorithm = 'aes-256-gcm'; 

            const cipher = crypto.createCipheriv(
                algorithm,
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                iv
            );
            cipher.setAAD(aad);

            const encrypted = Buffer.concat([
                cipher.update(privateKeySeedBytes), // Directly encrypt the Uint8Array seed
                cipher.final()
            ]);
            const tag = cipher.getAuthTag();

            return JSON.stringify({
                encrypted: encrypted.toString('hex'),
                iv: iv.toString('hex'),
                tag: tag.toString('hex'),
                aad: aad.toString('hex'),
                version: 'v2_seed' // Indicate this is an encrypted v2 seed
            });
        } catch (error) {
            logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to encrypt private key seed:')}`, { error: error.message });
            throw ServiceError.operation('Failed to encrypt private key seed', { 
                error: error.message,
                type: 'ENCRYPTION_ERROR' 
            });
        }
    }

    async createContestWallet(contestId, adminContext = null, preferredVanityType = null) {
        const startTime = Date.now();
        this.logApi.info(`${formatLog.tag()} ${formatLog.header('CREATE WALLET')} Request for contest ID: ${contestId}, Vanity: ${preferredVanityType || 'any'}`);
        let contestWalletDbRecord;
        let vanityWalletDetails = null;
        let usedVanity = false;

        try {
            if (config.vanity_wallets && config.vanity_wallets.enabled) {
                this.logApi.info(`${formatLog.tag()} Attempting to fetch vanity wallet (type: ${preferredVanityType || 'any'}).`);
                vanityWalletDetails = await VanityApiClient.getAvailableVanityWallet(preferredVanityType);
            }

            let walletAddressToStore;
            let seed_32_bytes_uint8array; // Changed variable name for clarity
            let isVanityWallet = false;
            let vanityType = null;

            if (vanityWalletDetails && vanityWalletDetails.private_key) {
                usedVanity = true;
                this.logApi.info(`${formatLog.tag()} Using VANITY wallet: ${vanityWalletDetails.wallet_address} (ID: ${vanityWalletDetails.id}, Pattern: ${vanityWalletDetails.pattern})`);
                
                // VanityApiClient.getAvailableVanityWallet now returns the 32-byte seed as a Buffer.
                const decryptedSeedBuffer = vanityWalletDetails.private_key;
                if (!(decryptedSeedBuffer instanceof Buffer) || decryptedSeedBuffer.length !== 32) {
                    this.logApi.error('VanityApiClient.getAvailableVanityWallet did not return a 32-byte Buffer for private_key.', { typeofKey: typeof decryptedSeedBuffer, length: decryptedSeedBuffer?.length });
                    throw new ServiceError.validation('Invalid private key format received from VanityApiClient for vanity wallet.');
                }
                seed_32_bytes_uint8array = Uint8Array.from(decryptedSeedBuffer); // Convert Buffer to Uint8Array
                
                walletAddressToStore = vanityWalletDetails.wallet_address;
                isVanityWallet = true;
                vanityType = vanityWalletDetails.vanity_type || vanityWalletDetails.pattern;

                // Correctly use createKeyPairSignerFromPrivateKeyBytes for the 32-byte seed
                const tempSignerFromVanitySeed = await createKeyPairSignerFromPrivateKeyBytes(seed_32_bytes_uint8array);
                
                if (tempSignerFromVanitySeed.address !== walletAddressToStore) {
                    this.logApi.error(`${formatLog.tag()} ${formatLog.error('CRITICAL MISMATCH for VANITY wallet!')} Address from seed (${tempSignerFromVanitySeed.address}) != provided address (${walletAddressToStore}).`);
                    throw ServiceError.operation('Vanity wallet key integrity check failed: Address mismatch.');
                }
                this.logApi.info(`${formatLog.tag()} Vanity wallet seed-to-address verification successful.`);

            } else {
                // ... (random wallet generation logic remains the same, already provides 32-byte Uint8Array seed to seed_32_bytes_uint8array) ...
                if (config.vanity_wallets && config.vanity_wallets.enabled) {
                    this.logApi.warn(`${formatLog.tag()} ${formatLog.warning('No suitable vanity wallet. Generating RANDOM wallet.')}`);
                } else {
                    this.logApi.info(`${formatLog.tag()} Vanity wallets disabled/not requested. Generating RANDOM wallet.`);
                }
                const newV2KeyPair = await generateKeyPairV2();
                walletAddressToStore = await getAddressFromPublicKey(newV2KeyPair.publicKey);
                seed_32_bytes_uint8array = newV2KeyPair.secretKey;
                isVanityWallet = false;
                vanityType = null;
                this.logApi.info(`${formatLog.tag()} Generated RANDOM v2 wallet: ${walletAddressToStore}`);
            }

            const encryptedSeedJson = this.encryptPrivateKey(seed_32_bytes_uint8array);

            contestWalletDbRecord = await prisma.contest_wallets.create({
                data: {
                    contest_id: contestId,
                    wallet_address: walletAddressToStore,
                    private_key: encryptedSeedJson,
                    balance: 0,
                    created_at: new Date(),
                    is_vanity: isVanityWallet,
                    vanity_type: vanityType,
                    last_sync: new Date(),
                    updated_at: new Date()
                }
            });
            this.logApi.info(`${formatLog.tag()} ${formatLog.success('Contest wallet DB record created successfully.')} ID: ${contestWalletDbRecord.id}, Address: ${contestWalletDbRecord.wallet_address}`);

            if (usedVanity && vanityWalletDetails) {
                await VanityApiClient.assignVanityWalletToContest(vanityWalletDetails.id, contestId);
                this.logApi.info(`${formatLog.tag()} Marked vanity wallet ID ${vanityWalletDetails.id} as used by contest ID ${contestId}.`);
            }

            // Update stats (example)
            if (this.walletStats) { 
                this.walletStats.wallets.created = (this.walletStats.wallets.created || 0) + 1;
                if(isVanityWallet) this.walletStats.wallets.vanity_created = (this.walletStats.wallets.vanity_created || 0) + 1;
                else this.walletStats.wallets.random_created = (this.walletStats.wallets.random_created || 0) + 1;
            }
            
            // Admin logging (example)
            if (adminContext && AdminLogger) {
                await AdminLogger.logAction(
                    adminContext.admin_id || 'system', 
                    'CONTEST_WALLET_CREATED', 
                    {
                        contestId: contestId,
                        walletId: contestWalletDbRecord.id,
                        walletAddress: walletAddressToStore,
                        isVanity: isVanityWallet,
                        vanityType: vanityType
                    }, 
                    adminContext.ip_address
                );
            }

            return contestWalletDbRecord;

        } catch (error) {
            this.logApi.error(`${formatLog.tag()} ${formatLog.error('Error creating contest wallet:')}`, { 
                error: error.message, 
                contestId, 
                preferredVanityType, 
                stack: error.stack?.substring(0,500) 
            });
            if (this.walletStats?.errors) this.walletStats.errors.creation_failures = (this.walletStats.errors.creation_failures || 0) + 1;
            if (error instanceof ServiceError) throw error;
            throw ServiceError.operation('Failed to create contest wallet', { originalError: error.message });
        }
    }
}

// Export service singleton
const contestWalletService = new ContestWalletService();
export default contestWalletService;