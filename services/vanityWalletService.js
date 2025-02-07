import { PrismaClient } from '@prisma/client';
import { logApi } from '../utils/logger-suite/logger.js';
import ServiceManager, { SERVICE_NAMES } from '../utils/service-manager.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Configuration
const VANITY_WALLET_CONFIG = {
    min_pool_size: 10,
    max_pool_size: 1000,
    low_threshold: 20,
    generation_batch_size: 5,
    check_interval_ms: 60 * 60 * 1000 // Check pool size every hour
};

// Statistics tracking
let poolStats = {
    total_wallets: 0,
    available_wallets: 0,
    used_wallets: 0,
    by_pattern: {},
    operations: {
        total_assignments: 0,
        successful_assignments: 0,
        failed_assignments: 0
    },
    pool_health: {
        last_check: null,
        below_threshold_count: 0,
        generation_requests: 0
    }
};

let poolCheckInterval;

class VanityWalletService {
    static async initialize() {
        try {
            // Check if service should be enabled
            const setting = await prisma.system_settings.findUnique({
                where: { key: 'vanity_wallet_service' }
            });
            
            const enabled = setting?.value?.enabled ?? true; // Default to true for this critical service

            // Get initial pool stats
            const stats = await this.getPoolStats();
            poolStats = {
                ...poolStats,
                ...stats
            };

            await ServiceManager.markServiceStarted(
                SERVICE_NAMES.VANITY_WALLET,
                {
                    ...VANITY_WALLET_CONFIG,
                    enabled
                },
                poolStats
            );

            if (!enabled) {
                logApi.info('Vanity Wallet Service is disabled');
                return;
            }

            // Start periodic pool checks
            poolCheckInterval = setInterval(async () => {
                try {
                    // Check if service is still enabled
                    const currentSetting = await prisma.system_settings.findUnique({
                        where: { key: 'vanity_wallet_service' }
                    });
                    
                    if (!currentSetting?.value?.enabled) {
                        return;
                    }

                    const stats = await this.getPoolStats();
                    poolStats = {
                        ...poolStats,
                        ...stats,
                        pool_health: {
                            ...poolStats.pool_health,
                            last_check: new Date().toISOString()
                        }
                    };

                    // Check if pool is below threshold
                    if (stats.available_wallets < VANITY_WALLET_CONFIG.low_threshold) {
                        poolStats.pool_health.below_threshold_count++;
                        poolStats.pool_health.generation_requests++;
                        // Here you would trigger wallet generation
                        logApi.warn('Vanity wallet pool below threshold', {
                            available: stats.available_wallets,
                            threshold: VANITY_WALLET_CONFIG.low_threshold
                        });
                    }

                    await ServiceManager.updateServiceHeartbeat(
                        SERVICE_NAMES.VANITY_WALLET,
                        VANITY_WALLET_CONFIG,
                        poolStats
                    );
                } catch (error) {
                    await ServiceManager.markServiceError(
                        SERVICE_NAMES.VANITY_WALLET,
                        error,
                        VANITY_WALLET_CONFIG,
                        poolStats
                    );
                }
            }, VANITY_WALLET_CONFIG.check_interval_ms);

            if (enabled) {
                logApi.info('Vanity Wallet Service initialized');
            }
        } catch (error) {
            logApi.error('Failed to initialize Vanity Wallet Service:', error);
            throw error;
        }
    }

    static async shutdown() {
        try {
            if (poolCheckInterval) {
                clearInterval(poolCheckInterval);
                poolCheckInterval = null;
            }

            await ServiceManager.markServiceStopped(
                SERVICE_NAMES.VANITY_WALLET,
                VANITY_WALLET_CONFIG,
                poolStats
            );

            logApi.info('Vanity Wallet Service shut down');
        } catch (error) {
            logApi.error('Failed to shut down Vanity Wallet Service:', error);
            throw error;
        }
    }

    // Get an available vanity wallet, prioritizing specific patterns if requested
    static async getAvailableWallet(preferredPattern = null) {
        try {
            const wallet = await prisma.vanity_wallet_pool.findFirst({
                where: {
                    is_used: false,
                    ...(preferredPattern ? { pattern: preferredPattern } : {})
                },
                orderBy: {
                    created_at: 'asc' // Use oldest wallets first
                }
            });

            return wallet;
        } catch (error) {
            logApi.error('Failed to get available vanity wallet:', error);
            return null;
        }
    }

    // Mark a wallet as used by a contest
    static async assignWalletToContest(walletId, contestId) {
        try {
            const result = await prisma.vanity_wallet_pool.update({
                where: { id: walletId },
                data: {
                    is_used: true,
                    used_at: new Date(),
                    used_by_contest: contestId
                }
            });

            // Update statistics
            poolStats.operations.total_assignments++;
            poolStats.operations.successful_assignments++;
            poolStats.used_wallets++;
            poolStats.available_wallets--;

            // Update service state
            await ServiceManager.updateServiceHeartbeat(
                SERVICE_NAMES.VANITY_WALLET,
                VANITY_WALLET_CONFIG,
                poolStats
            );

            return result;
        } catch (error) {
            // Update error statistics
            poolStats.operations.total_assignments++;
            poolStats.operations.failed_assignments++;

            // Update service state with error
            await ServiceManager.markServiceError(
                SERVICE_NAMES.VANITY_WALLET,
                error,
                VANITY_WALLET_CONFIG,
                poolStats
            );

            logApi.error('Failed to assign vanity wallet to contest:', error);
            throw error;
        }
    }

    // Add new wallets to the pool
    static async addToPool(wallets) {
        try {
            const results = await prisma.$transaction(
                wallets.map(wallet => 
                    prisma.vanity_wallet_pool.create({
                        data: {
                            wallet_address: wallet.address,
                            private_key: wallet.privateKey,
                            pattern: wallet.pattern
                        }
                    })
                )
            );

            // Update statistics
            poolStats.total_wallets += results.length;
            poolStats.available_wallets += results.length;
            results.forEach(wallet => {
                poolStats.by_pattern[wallet.pattern] = 
                    (poolStats.by_pattern[wallet.pattern] || 0) + 1;
            });

            // Update service state
            await ServiceManager.updateServiceHeartbeat(
                SERVICE_NAMES.VANITY_WALLET,
                VANITY_WALLET_CONFIG,
                poolStats
            );

            logApi.info(`Added ${results.length} vanity wallets to pool`, {
                patterns: results.map(w => w.pattern)
            });

            return results;
        } catch (error) {
            // Update service state with error
            await ServiceManager.markServiceError(
                SERVICE_NAMES.VANITY_WALLET,
                error,
                VANITY_WALLET_CONFIG,
                poolStats
            );

            logApi.error('Failed to add vanity wallets to pool:', error);
            throw error;
        }
    }

    // Get pool statistics
    static async getPoolStats() {
        try {
            const stats = await prisma.$transaction([
                // Total wallets
                prisma.vanity_wallet_pool.count(),
                // Available wallets
                prisma.vanity_wallet_pool.count({
                    where: { is_used: false }
                }),
                // Stats by pattern
                prisma.vanity_wallet_pool.groupBy({
                    by: ['pattern'],
                    _count: true,
                    where: { is_used: false }
                })
            ]);

            return {
                total_wallets: stats[0],
                available_wallets: stats[1],
                used_wallets: stats[0] - stats[1],
                by_pattern: stats[2].reduce((acc, curr) => ({
                    ...acc,
                    [curr.pattern]: curr._count
                }), {})
            };
        } catch (error) {
            logApi.error('Failed to get vanity wallet pool stats:', error);
            throw error;
        }
    }
}

// Initialize service when module is loaded
VanityWalletService.initialize().catch(error => {
    logApi.error('Failed to initialize Vanity Wallet Service:', error);
});

export default VanityWalletService; 