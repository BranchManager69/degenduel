// services/liquidityService.js

/** 
 * This service is responsible for managing the liquidity of the platform.
 * It handles the creation, activation, and maintenance of liquidity wallets.
 * It also provides a standardized interface for other services to access liquidity.
 */

import { BaseService } from '../utils/service-suite/base-service.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from '../config/config.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import prisma from '../config/prisma.js';
import { fancyColors } from '../utils/colors.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import serviceEvents from '../utils/service-suite/service-events.js';
import { generateKeyPair as generateKeyPairV2 } from '@solana/keys';
import { getAddressFromPublicKey } from '@solana/addresses';
import crypto from 'crypto'; // For encryption
import { solanaEngine } from './solana-engine/index.js';

const LIQUIDITY_CONFIG = {
    name: SERVICE_NAMES.LIQUIDITY,
    description: getServiceMetadata(SERVICE_NAMES.LIQUIDITY).description,
    checkIntervalMs: 60 * 1000,  // Check every minute
    maxRetries: 3,
    retryDelayMs: 5000,
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
    wallet: {
        minBalance: 0.05,
        masterWallet: config.master_wallet.address
    }
};

// Liquidity Service
class LiquidityService extends BaseService {
    constructor() {
        super(LIQUIDITY_CONFIG);
        this.wallet = null; // Keep track of the active liquidity wallet from DB
        
        // Initialize service-specific stats
        this.liquidityStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            wallets: {
                total: 0,
                active: 0,
                balance_total: 0,
                by_purpose: {}
            },
            transfers: {
                total: 0,
                successful: 0,
                failed: 0,
                amount_total: 0
            },
            performance: {
                average_operation_time_ms: 0,
                last_operation_time_ms: 0,
                average_transfer_time_ms: 0
            }
        };

        // Active processing tracking
        this.activeOperations = new Map();
        this.operationTimeouts = new Set();
        
        // Dynamic interval tracking
        this.lastIntervalUpdate = Date.now();
        this.dynamicIntervalCheck();
    }
    
    /**
     * Periodically check if the service interval has changed in the database
     * This allows for dynamic adjustment of the service interval without restart
     */
    async dynamicIntervalCheck() {
        try {
            // Import here to avoid circular dependencies
            const { getServiceInterval } = await import('../utils/service-suite/service-interval-adapter.js');
            
            // Get the current interval from the new service_configuration table
            const configuredInterval = await getServiceInterval(
                this.name,
                this.config.checkIntervalMs // Default from static config
            );
            
            // Only update if different from current interval
            if (this.config.checkIntervalMs !== configuredInterval) {
                logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.BLACK} INTERVAL UPDATED ${fancyColors.RESET} ${fancyColors.CYAN}${this.config.checkIntervalMs}ms → ${configuredInterval}ms${fancyColors.RESET}`);
                
                // Update the config
                this.config.checkIntervalMs = configuredInterval;
                
                // If the service is already running, restart the interval with new timing
                if (this.isStarted && this.operationInterval) {
                    clearInterval(this.operationInterval);
                    this.operationInterval = setInterval(
                        () => this.performOperation().catch(error => this.handleError(error)),
                        this.config.checkIntervalMs
                    );
                }
            }
        } catch (error) {
            // Don't let errors in interval checking break the service
            logApi.error(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.RED}Error checking for interval updates:${fancyColors.RESET}`, {
                error: error.message
            });
        }
        
        // Schedule next check (every 30 seconds)
        setTimeout(() => this.dynamicIntervalCheck(), 30000);
    }

    /**
     * Encrypts a 32-byte private key seed specifically for liquidity wallets.
     * @param {Uint8Array} privateKeySeedBytes - The 32-byte private key seed.
     * @returns {string} - Encrypted JSON string { version, encrypted, iv, tag, aad }.
     */
    encryptPrivateKeyLocal(privateKeySeedBytes) {
        if (!(privateKeySeedBytes instanceof Uint8Array) || privateKeySeedBytes.length !== 32) {
            throw new ServiceError.validation('encryptPrivateKeyLocal expects a 32-byte Uint8Array seed.');
        }
        try {
            const iv = crypto.randomBytes(12);
            const aad = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'), iv);
            cipher.setAAD(aad);
            let encrypted = cipher.update(privateKeySeedBytes);
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            const tag = cipher.getAuthTag();
            return JSON.stringify({
                version: 'v2_seed_liquidity',
                encrypted: encrypted.toString('hex'),
                iv: iv.toString('hex'),
                tag: tag.toString('hex'),
                aad: aad.toString('hex')
            });
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.RED}Failed to encrypt seed locally:${fancyColors.RESET}`, error);
            throw ServiceError.operation('Local seed encryption failed', { originalError: error.message });
        }
    }

    // Initialize the service
    async initialize() {
        try {
            await super.initialize();
            if (!config.services.liquidity) {
                logApi.warn(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Liquidity Service is disabled in the '${config.services.active_profile}' service profile`);
                return false; // Skip initialization
            }
            
            // Test connection via solanaEngine
            await solanaEngine.executeConnectionMethod('getLatestBlockhash');
            logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} Connection test via solanaEngine successful.`);
            
            // Find the most recent active liquidity wallet
            logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET}${fancyColors.CYAN}${fancyColors.BG_LIGHT_BLUE} 🔍 ${fancyColors.DARK_BLUE}Checking for existing liquidity wallets... ${fancyColors.RESET}`);
            
            // Find all liquidity wallets
            const allLiquidityWallets = await prisma.seed_wallets.findMany({
                where: { purpose: 'liquidity' },
                orderBy: { created_at: 'desc' }
            });
            
            // Get details about the wallets - remove debug messages
            const walletsInfo = allLiquidityWallets.map(w => {
                return {
                    address: w.wallet_address.substring(0, 8) + '...',
                    active: !!w.is_active,
                    created: new Date(w.created_at).toLocaleTimeString()
                };
            });
            
            logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET}${fancyColors.BG_LIGHT_CYAN} 📊 ${fancyColors.BOLD}${fancyColors.LIGHT_CYAN} Liquidity Wallets: ${fancyColors.RESET}${fancyColors.LIGHT_CYAN}${fancyColors.BOLD_BLUE}${fancyColors.BG_YELLOW}${fancyColors.UNDERLINE} ${allLiquidityWallets.length} ${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.BG_LIGHT_CYAN} found ${fancyColors.RESET}`, {
            //    wallets: walletsInfo
            });
            
            // Now check for active liquidity wallet(s)
            const existingWallets = await prisma.seed_wallets.findMany({
                where: {
                    purpose: 'liquidity',
                    is_active: true
                },
                orderBy: { created_at: 'desc' }
            });
            
            logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET}${fancyColors.BG_LIGHT_CYAN} 🤑  ${fancyColors.BOLD_GREEN}Active Liquidity Wallets: ${fancyColors.RESET}${fancyColors.LIGHT_CYAN}${fancyColors.BOLD_BLUE}${fancyColors.BG_YELLOW}${fancyColors.UNDERLINE} ${existingWallets.length} ${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.BG_LIGHT_CYAN} found ${fancyColors.RESET}`, {
            //    wallets: walletsInfo
            });
            
            // Use the most recently created liquidity wallet
            const wallet = existingWallets[0];
            if (wallet) {
                this.wallet = wallet;
                // Get balance via solanaEngine, passing string address
                const balanceResult = await solanaEngine.executeConnectionMethod('getBalance', wallet.wallet_address);
                const fetchedBalanceLamports = balanceResult.value; // This is BigInt
                const fetchedBalanceSol = fetchedBalanceLamports !== null ? Number(fetchedBalanceLamports) / LAMPORTS_PER_SOL_V2 : 0;
                
                this.liquidityStats.wallets.total = 1;
                this.liquidityStats.wallets.active = 1;
                this.liquidityStats.wallets.balance_total = fetchedBalanceSol;
                this.liquidityStats.wallets.by_purpose.liquidity = {
                    count: 1,
                    balance: fetchedBalanceSol
                };
                
                // Update ServiceManager state
                await serviceManager.markServiceStarted(
                    this.name,
                    this.config,
                    {
                        ...this.stats,
                        liquidityStats: this.liquidityStats
                    }
                );
                
                // Log the wallet in use
                logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET}${fancyColors.BG_LIGHT_CYAN}${fancyColors.BOLD_GREEN} Using wallet: ${wallet.wallet_address} (Balance: ${fetchedBalanceSol.toFixed(4)} SOL) ${fancyColors.RESET}`, {
                //    balance: this.liquidityStats.wallets.balance_total
                });

                // Log success with detailed information
                logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET}${fancyColors.BG_LIGHT_CYAN}${fancyColors.BOLD_GREEN} Liquidity Service initialized ${fancyColors.RESET}`, {
                //    wallet: wallet.wallet_address,
                //    balance: this.liquidityStats.wallets.balance_total
                });
                
                return true;
            }

            // No wallet found (or we need to create a new one)
            // Check if we can reactivate the most recent wallet instead of creating a new one
            if (allLiquidityWallets.length > 0) {
                logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.ORANGE}Reactivating most recent liquidity wallet instead of creating a new one${fancyColors.RESET}`);
                
                // Take the most recent wallet (already ordered by created_at desc)
                const mostRecentWallet = allLiquidityWallets[0];
                
                // Reactivate it - mark this wallet as active while ensuring all others are inactive
                // Let's use a transaction to ensure these operations are consistent
                await prisma.$transaction(async (prismaTransaction) => {
                    // First mark all as inactive to prevent multiple active wallets using raw SQL
                    await prismaTransaction.$executeRaw`UPDATE seed_wallets SET is_active = false WHERE purpose = 'liquidity'`;
                    
                        // Then reactivate only the most recent one
                    await prismaTransaction.$executeRaw`UPDATE seed_wallets SET is_active = true WHERE wallet_address = ${mostRecentWallet.wallet_address}`;
                });
                
                // Record the activation in logs
                logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.GREEN}Activated wallet for liquidity:${fancyColors.RESET} ${fancyColors.BLUE}${mostRecentWallet.wallet_address}${fancyColors.RESET}`);
                
                
                // Use this wallet
                this.wallet = mostRecentWallet;
                
                // Get initial balance
                const balanceResult = await solanaEngine.executeConnectionMethod('getBalance', mostRecentWallet.wallet_address);
                const reactivatedBalanceLamports = balanceResult.value; // This is BigInt
                const reactivatedBalanceSol = reactivatedBalanceLamports !== null ? Number(reactivatedBalanceLamports) / LAMPORTS_PER_SOL_V2 : 0;
                
                // Update stats
                this.liquidityStats.wallets.total = 1;
                this.liquidityStats.wallets.active = 1;
                this.liquidityStats.wallets.balance_total = reactivatedBalanceSol;
                this.liquidityStats.wallets.by_purpose.liquidity = {
                    count: 1,
                    balance: reactivatedBalanceSol
                };
                
                // Log success with detailed information
                logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.ORANGE}REACTIVATED WALLET:${fancyColors.RESET} ${fancyColors.GREEN}Using existing wallet instead of creating new one${fancyColors.RESET}`, {
                    wallet: mostRecentWallet.wallet_address,
                    balance: reactivatedBalanceSol,
                    created: new Date(mostRecentWallet.created_at).toLocaleString()
                });
                
                // Update ServiceManager state
                await serviceManager.markServiceStarted(
                    this.name,
                    this.config,
                    {
                        ...this.stats,
                        liquidityStats: this.liquidityStats
                    }
                );
                
                return true;
            }
            
            // If no existing wallets at all, create a new one
            logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.ORANGE}No liquidity wallets found.${fancyColors.RESET} ${fancyColors.GREEN}Creating a new one...${fancyColors.RESET}`);
            
            try {
                // Generate a new wallet specifically for liquidity purposes
                const walletIdentifier = `liquidity_wallet_${Date.now()}`;
                
                // Create the wallet in the database directly (since the generateWallet method
                // has different purpose formatting)
                const newV2KeyPair = await generateKeyPairV2();
                const newWalletAddress = await getAddressFromPublicKey(newV2KeyPair.publicKey);
                const seed_32_bytes = newV2KeyPair.secretKey;
                const encryptedSeedJson = this.encryptPrivateKeyLocal(seed_32_bytes);
                
                // Save to database
                const newWallet = await prisma.seed_wallets.create({
                    data: {
                        wallet_address: newWalletAddress,
                        private_key: encryptedSeedJson,
                        purpose: 'liquidity',
                        is_active: true,
                        metadata: {
                            created_by: 'liquidity_service_v2',
                            created_at: new Date().toISOString(),
                            description: 'Name: ${walletIdentifier} (automatically created liquidity wallet)'
                        }
                    }
                });
                
                // Store the wallet in our instance
                this.wallet = newWallet;
                
                // Get initial balance (will be 0 for new wallet)
                const balance = 0; // Empty wallet initially
                
                // Update stats
                this.liquidityStats.wallets.total = 1;
                this.liquidityStats.wallets.active = 1;
                this.liquidityStats.wallets.balance_total = balance;
                this.liquidityStats.wallets.by_purpose.liquidity = {
                    count: 1,
                    balance: balance
                };
                
                // Update ServiceManager state
                await serviceManager.markServiceStarted(
                    this.name,
                    this.config,
                    {
                        ...this.stats,
                        liquidityStats: this.liquidityStats
                    }
                );
                
                logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.GREEN}Created new liquidity wallet successfully${fancyColors.RESET}`, {
                    wallet: newWalletAddress
                });
                
                return true;
            } catch (error) {
                // If we fail to create a wallet, fall back to degraded mode
                logApi.error(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.RED}Failed to create liquidity wallet:${fancyColors.RESET} \n${fancyColors.RED}${fancyColors.ITALIC}${error.message}${fancyColors.RESET}`);
                
                // Update ServiceManager state with degraded status
                await serviceManager.markServiceStarted(
                    this.name,
                    this.config,
                    {
                        ...this.stats,
                        liquidityStats: this.liquidityStats,
                        status: 'degraded',
                        message: 'Failed to create liquidity wallet'
                    }
                );
                
                return true;
            }
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.RED}Liquidity Service initialization error:${fancyColors.RESET} \n${fancyColors.RED}${fancyColors.ITALIC}${error.message}${fancyColors.RESET}`);
            throw error instanceof ServiceError ? error : ServiceError.initialization(error.message);
        }
    }

    /**
     * Implements the onPerformOperation method (new pattern)
     * This gets called by the BaseService performOperation method
     * @returns {Promise<boolean>}
     */
    async onPerformOperation() {
        const startTime = Date.now();
        
        try {
            // Check if we have a wallet configured
            if (!this.wallet) {
                // No wallet, operate in degraded mode
                logApi.warn('${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.RED}Liquidity Service operating without an active wallet${fancyColors.RESET}');
                
                // Update ServiceManager state with degraded status
                await serviceManager.updateServiceHeartbeat(
                    this.name,
                    this.config,
                    {
                        ...this.stats,
                        liquidityStats: this.liquidityStats,
                        status: 'degraded',
                        message: 'No active liquidity wallet'
                    }
                );
                
                return true; // Return true to avoid circuit breaker
            }
            
            // Check balance via solanaEngine
            const balanceResultOp = await solanaEngine.executeConnectionMethod('getBalance', this.wallet.wallet_address);
            const currentBalanceLamports = balanceResultOp.value; // This is BigInt
            const currentBalanceSol = currentBalanceLamports !== null ? Number(currentBalanceLamports) / LAMPORTS_PER_SOL_V2 : 0;
            
            // Update stats
            this.liquidityStats.wallets.balance_total = currentBalanceSol;
            this.liquidityStats.wallets.by_purpose.liquidity = {
                count: 1,
                balance: currentBalanceSol
            };
            this.liquidityStats.operations.total++;
            this.liquidityStats.operations.successful++;
            
            // Update performance metrics
            this.liquidityStats.performance.last_operation_time_ms = Date.now() - startTime;
            if (this.liquidityStats.operations.total > 1) { // Avoid division by zero if total is 1 and successful is 0 or 1 from current op
                this.liquidityStats.performance.average_operation_time_ms = 
                    (this.liquidityStats.performance.average_operation_time_ms * 
                    (this.liquidityStats.operations.total - 1) + 
                    (this.liquidityStats.performance.last_operation_time_ms)) / this.liquidityStats.operations.total;
            } else {
                 this.liquidityStats.performance.average_operation_time_ms = this.liquidityStats.performance.last_operation_time_ms;
            }

            // Update ServiceManager state
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    liquidityStats: this.liquidityStats
                }
            );

            return true; // Success
        } catch (error) {
            this.liquidityStats.operations.failed++;
            logApi.error(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.RED}Operation error:${fancyColors.RESET} ${error.message}`);
            throw ServiceError.operation('Balance check failed', error);
        }
    }
    
    // Keep the original performOperation for backward compatibility
    // This won't actually get called by BaseService anymore since we've added onPerformOperation
    // We're keeping it for backward compatibility with any code that might directly call this method
    async performOperation() {
        return this.onPerformOperation();
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
                    liquidityStats: this.liquidityStats
                }
            );
            
            logApi.info(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.GREEN}Liquidity Service stopped successfully${fancyColors.RESET}`);
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[liquidityService]${fancyColors.RESET} ${fancyColors.RED}Error stopping Liquidity Service:${fancyColors.RESET} \n${fancyColors.RED}${fancyColors.ITALIC}${error.message}${fancyColors.RESET}`);
            throw error;
        }
    }
}

// Define LAMPORTS_PER_SOL_V2 if not already globally available or imported from a shared const file
const LAMPORTS_PER_SOL_V2 = 1_000_000_000;

const liquidityService = new LiquidityService();
export default liquidityService;
