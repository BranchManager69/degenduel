// services/vanityWalletService.js

/*
 * This service is responsible for managing the vanity wallet pool.
 * It allows the admin to add and remove wallets from the pool.
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
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';

const VANITY_WALLET_CONFIG = {
    name: SERVICE_NAMES.VANITY_WALLET,
    description: getServiceMetadata(SERVICE_NAMES.VANITY_WALLET).description,
    checkIntervalMs: 60 * 60 * 1000, // Check pool size every hour
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
    pool: {
        min_size: 10,
        max_size: 1000,
        low_threshold: 20,
        generation_batch_size: 5
    }
};

// Vanity Wallet Service
class VanityWalletService extends BaseService {
    constructor() {
        super(VANITY_WALLET_CONFIG.name, VANITY_WALLET_CONFIG);
        
        // Service-specific state
        this.poolStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            wallets: {
                total: 0,
                available: 0,
                used: 0,
                by_pattern: {}
            },
            assignments: {
                total: 0,
                successful: 0,
                failed: 0
            },
            pool_health: {
                last_check: null,
                below_threshold_count: 0,
                generation_requests: 0
            },
            performance: {
                average_operation_time_ms: 0,
                last_operation_time_ms: 0
            }
        };
    }

    // Get an available vanity wallet, prioritizing specific patterns if requested
    async getAvailableWallet(preferredPattern = null, adminContext = null) {
        if (this.stats.circuitBreaker.isOpen) {
            throw ServiceError.operation('Circuit breaker is open for wallet retrieval');
        }

        const startTime = Date.now();
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

            if (!wallet) {
                throw ServiceError.validation('No available vanity wallets', {
                    preferredPattern,
                    type: 'WALLET_NOT_FOUND'
                });
            }

            // Update statistics
            await this.recordSuccess();
            this.poolStats.operations.successful++;
            this.poolStats.performance.last_operation_time_ms = Date.now() - startTime;
            this.poolStats.performance.average_operation_time_ms = 
                (this.poolStats.performance.average_operation_time_ms * this.poolStats.operations.total + 
                (Date.now() - startTime)) / (this.poolStats.operations.total + 1);

            // Log admin action if context provided
            if (adminContext) {
                await AdminLogger.logAction(
                    adminContext.admin_address,
                    'VANITY_WALLET_RETRIEVE',
                    {
                        wallet_id: wallet.id,
                        pattern: wallet.pattern,
                        preferred_pattern: preferredPattern
                    },
                    adminContext
                );
            }

            return wallet;
        } catch (error) {
            this.poolStats.operations.failed++;
            await this.handleError(error);
            throw error;
        }
    }

    // Mark a wallet as used by a contest
    async assignWalletToContest(walletId, contestId, adminContext = null) {
        if (this.stats.circuitBreaker.isOpen) {
            throw ServiceError.operation('Circuit breaker is open for wallet assignment');
        }

        const startTime = Date.now();
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
            await this.recordSuccess();
            this.poolStats.assignments.total++;
            this.poolStats.assignments.successful++;
            this.poolStats.wallets.used++;
            this.poolStats.wallets.available--;
            this.poolStats.performance.last_operation_time_ms = Date.now() - startTime;

            // Log admin action if context provided
            if (adminContext) {
                await AdminLogger.logAction(
                    adminContext.admin_address,
                    'VANITY_WALLET_ASSIGN',
                    {
                        wallet_id: walletId,
                        contest_id: contestId,
                        pattern: result.pattern
                    },
                    adminContext
                );
            }

            return result;
        } catch (error) {
            this.poolStats.assignments.total++;
            this.poolStats.assignments.failed++;
            await this.handleError(error);
            throw error;
        }
    }

    // Add new wallets to the pool
    async addToPool(wallets, adminContext = null) {
        if (this.stats.circuitBreaker.isOpen) {
            throw ServiceError.operation('Circuit breaker is open for pool addition');
        }

        const startTime = Date.now();
        try {
            const results = await prisma.$transaction(
                wallets.map(wallet => 
                    prisma.vanity_wallet_pool.create({
                        data: {
                            wallet_address: wallet.address,
                            private_key: wallet.privateKey,
                            pattern: wallet.pattern,
                            created_at: new Date()
                        }
                    })
                )
            );

            // Update statistics
            await this.recordSuccess();
            this.poolStats.wallets.total += results.length;
            this.poolStats.wallets.available += results.length;
            results.forEach(wallet => {
                this.poolStats.wallets.by_pattern[wallet.pattern] = 
                    (this.poolStats.wallets.by_pattern[wallet.pattern] || 0) + 1;
            });

            // Log admin action if context provided
            if (adminContext) {
                await AdminLogger.logAction(
                    adminContext.admin_address,
                    'VANITY_WALLET_ADD',
                    {
                        count: results.length,
                        patterns: results.map(w => w.pattern)
                    },
                    adminContext
                );
            }

            return results;
        } catch (error) {
            await this.handleError(error);
            throw error;
        }
    }

    // Main operation implementation - periodic pool health checks
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Get current pool stats
            const stats = await this.getPoolStats();
            
            // Check if pool is below threshold
            if (stats.available < this.config.pool.low_threshold) {
                this.poolStats.pool_health.below_threshold_count++;
                this.poolStats.pool_health.generation_requests++;
                
                logApi.warn('Vanity wallet pool below threshold', {
                    available: stats.available,
                    threshold: this.config.pool.low_threshold
                });

                // Here you would trigger wallet generation
                // This could be implemented as a separate service call
            }

            this.poolStats.pool_health.last_check = new Date().toISOString();

            return {
                duration: Date.now() - startTime,
                stats: {
                    ...stats,
                    health: this.poolStats.pool_health
                }
            };
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            throw error;
        }
    }

    // Helper method to get current pool statistics
    async getPoolStats() {
        const [total, available, used] = await Promise.all([
            prisma.vanity_wallet_pool.count(),
            prisma.vanity_wallet_pool.count({ where: { is_used: false } }),
            prisma.vanity_wallet_pool.count({ where: { is_used: true } })
        ]);

        const byPattern = await prisma.vanity_wallet_pool.groupBy({
            by: ['pattern'],
            _count: true
        });

        return {
            total,
            available,
            used,
            by_pattern: Object.fromEntries(
                byPattern.map(p => [p.pattern, p._count])
            )
        };
    }
}

// Export service singleton
const vanityWalletService = new VanityWalletService();
export default vanityWalletService; 