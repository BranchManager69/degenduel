// services/liquidityService.js

import { BaseService } from '../utils/service-suite/base-service.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from '../config/config.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import prisma from '../config/prisma.js';
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';

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

class LiquidityService extends BaseService {
    constructor() {
        super(LIQUIDITY_CONFIG);
        
        // Initialize Solana connection with config RPC
        this.connection = new Connection(config.rpc_urls.primary, "confirmed");
        
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
            },
            dependencies: {
                walletGenerator: {
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

    async initialize() {
        try {
            // Call parent initialize first
            await super.initialize();
            
            // Check dependencies
            const walletGenStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.WALLET_GENERATOR);
            if (!walletGenStatus) {
                throw ServiceError.initialization('Wallet Generator Service not healthy');
            }

            // Check if we can connect to Solana
            await this.connection.getRecentBlockhash();
            
            // Find our wallet
            const wallet = await prisma.seed_wallets.findFirst({
                where: {
                    purpose: 'liquidity',
                    is_active: true
                }
            });

            if (wallet) {
                this.wallet = wallet;
                // Get initial balance
                const balance = await this.connection.getBalance(
                    new PublicKey(wallet.wallet_address)
                );
                
                // Update stats
                this.liquidityStats.wallets.total = 1;
                this.liquidityStats.wallets.active = 1;
                this.liquidityStats.wallets.balance_total = balance / 1000000000;
                this.liquidityStats.wallets.by_purpose.liquidity = {
                    count: 1,
                    balance: balance / 1000000000
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
                
                logApi.info('Liquidity Service initialized', {
                    wallet: wallet.wallet_address,
                    balance: this.liquidityStats.wallets.balance_total
                });
                
                return true;
            }

            // Throw error if no wallet found - service cannot operate without it
            throw new ServiceError.initialization('No active liquidity wallet found');
        } catch (error) {
            logApi.error('Liquidity Service initialization error:', error);
            throw error instanceof ServiceError ? error : new ServiceError.initialization(error.message);
        }
    }

    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Check dependency health
            const walletGenStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.WALLET_GENERATOR);
            this.liquidityStats.dependencies.walletGenerator = {
                status: walletGenStatus ? 'healthy' : 'unhealthy',
                lastCheck: new Date().toISOString(),
                errors: walletGenStatus ? 0 : this.liquidityStats.dependencies.walletGenerator.errors + 1
            };

            if (!walletGenStatus) {
                throw ServiceError.dependency('Wallet Generator Service unhealthy');
            }

            // Check if we have a wallet configured
            if (!this.wallet) {
                throw new ServiceError.operation('No active wallet configured');
            }
            
            // Check balance
            const balance = await this.connection.getBalance(
                new PublicKey(this.wallet.wallet_address)
            );
            
            // Update stats
            this.liquidityStats.wallets.balance_total = balance / 1000000000;
            this.liquidityStats.wallets.by_purpose.liquidity = {
                count: 1,
                balance: balance / 1000000000
            };
            this.liquidityStats.operations.total++;
            this.liquidityStats.operations.successful++;
            
            // Update performance metrics
            this.liquidityStats.performance.last_operation_time_ms = Date.now() - startTime;
            this.liquidityStats.performance.average_operation_time_ms = 
                (this.liquidityStats.performance.average_operation_time_ms * 
                (this.liquidityStats.operations.total - 1) + 
                (Date.now() - startTime)) / this.liquidityStats.operations.total;

            // Update ServiceManager state
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    liquidityStats: this.liquidityStats
                }
            );

            return {
                duration: Date.now() - startTime,
                balance: balance / 1000000000
            };
        } catch (error) {
            this.liquidityStats.operations.failed++;
            throw new ServiceError.operation('Balance check failed', error);
        }
    }

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
            
            logApi.info('Liquidity Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Liquidity Service:', error);
            throw error;
        }
    }
}

const liquidityService = new LiquidityService();
export default liquidityService;
