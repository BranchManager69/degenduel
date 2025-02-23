// services/vanityWalletService.js

/*
 * This service is responsible for managing the vanity wallet pool.
 * It handles the generation, validation, and assignment of vanity wallets
 * for contests. The service ensures a healthy pool of available wallets
 * and manages the lifecycle of vanity wallet patterns.
 */

// ** Service Auth **
import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
// Dependencies
import { VanityPool } from '../utils/solana-suite/vanity-pool.js';

const VANITY_WALLET_CONFIG = {
    name: SERVICE_NAMES.VANITY_WALLET,
    description: getServiceMetadata(SERVICE_NAMES.VANITY_WALLET).description,
    checkIntervalMs: 60 * 60 * 1000, // Check pool size every hour
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 4, // Lower threshold for quick recovery
        resetTimeoutMs: 45000, // Faster reset for wallet availability
        minHealthyPeriodMs: 120000 // Standard health period
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    },
    pool: {
        minSize: 10,
        maxSize: 1000,
        lowThreshold: 20,
        generationBatchSize: 5,
        maxParallelOperations: 3,
        operationTimeoutMs: 60000,
        patterns: {
            maxLength: 8,
            allowedChars: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            defaultPosition: 'start'
        }
    }
};

class VanityWalletService extends BaseService {
    constructor() {
        super(VANITY_WALLET_CONFIG);
        
        // Initialize vanity pool
        this.vanityPool = new VanityPool();

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
            generation: {
                total: 0,
                successful: 0,
                failed: 0,
                average_time_ms: 0
            },
            pool_health: {
                last_check: null,
                below_threshold_count: 0,
                generation_requests: 0
            },
            performance: {
                average_operation_time_ms: 0,
                last_operation_time_ms: 0,
                average_assignment_time_ms: 0
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
            const walletGeneratorStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.WALLET_GENERATOR);
            if (!walletGeneratorStatus) {
                throw ServiceError.initialization('Wallet Generator Service not healthy');
            }

            // Load configuration from database
            const settings = await prisma.system_settings.findUnique({
                where: { key: this.name }
            });

            if (settings?.value) {
                const dbConfig = typeof settings.value === 'string' 
                    ? JSON.parse(settings.value)
                    : settings.value;

                // Merge configs carefully preserving circuit breaker settings
                this.config = {
                    ...this.config,
                    ...dbConfig,
                    circuitBreaker: {
                        ...this.config.circuitBreaker,
                        ...(dbConfig.circuitBreaker || {})
                    }
                };
            }

            // Initialize vanity pool
            await this.vanityPool.initialize();

            // Load initial pool state
            const [totalWallets, availableWallets] = await Promise.all([
                prisma.vanity_wallet_pool.count(),
                prisma.vanity_wallet_pool.count({ where: { is_used: false } })
            ]);

            // Initialize stats
            this.poolStats.wallets.total = totalWallets;
            this.poolStats.wallets.available = availableWallets;
            this.poolStats.wallets.used = totalWallets - availableWallets;

            // Load pattern stats
            const patternStats = await prisma.vanity_wallet_pool.groupBy({
                by: ['pattern'],
                _count: true
            });

            patternStats.forEach(stat => {
                this.poolStats.wallets.by_pattern[stat.pattern] = stat._count;
            });

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify({
                ...this.stats,
                poolStats: this.poolStats
            }));

            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            logApi.info('Vanity Wallet Service initialized', {
                totalWallets,
                availableWallets,
                patternStats
            });

            return true;
        } catch (error) {
            logApi.error('Vanity Wallet Service initialization error:', error);
            await this.handleError(error);
            throw error;
        }
    }

    validatePattern(pattern) {
        if (!pattern) return true; // No pattern is valid

        if (pattern.length > this.config.pool.patterns.maxLength) {
            throw ServiceError.validation('Pattern too long');
        }

        const validChars = new Set(this.config.pool.patterns.allowedChars);
        for (const char of pattern) {
            if (!validChars.has(char)) {
                throw ServiceError.validation(`Invalid character in pattern: ${char}`);
            }
        }

        return true;
    }

    async getAvailableWallet(preferredPattern = null, adminContext = null) {
        if (this.stats.circuitBreaker.isOpen) {
            throw ServiceError.operation('Circuit breaker is open for wallet retrieval');
        }

        const startTime = Date.now();
        try {
            // Validate pattern if provided
            if (preferredPattern) {
                this.validatePattern(preferredPattern);
            }

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

    async assignWalletToContest(walletId, contestId, adminContext = null) {
        if (this.stats.circuitBreaker.isOpen) {
            throw ServiceError.operation('Circuit breaker is open for wallet assignment');
        }

        const startTime = Date.now();
        try {
            // Add to active operations
            this.activeOperations.set(walletId, {
                startTime,
                contestId,
                type: 'assignment'
            });

            // Set timeout
            const timeout = setTimeout(() => {
                this.activeOperations.delete(walletId);
                this.poolStats.assignments.failed++;
                logApi.error('Assignment operation timeout:', {
                    walletId,
                    contestId
                });
            }, this.config.pool.operationTimeoutMs);
            
            this.operationTimeouts.add(timeout);

            const result = await prisma.vanity_wallet_pool.update({
                where: { id: walletId },
                data: {
                    is_used: true,
                    used_at: new Date(),
                    used_by_contest: contestId
                }
            });

            // Clear timeout and active operation
            clearTimeout(timeout);
            this.operationTimeouts.delete(timeout);
            this.activeOperations.delete(walletId);

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

    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Check dependency health
            const walletGeneratorStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.WALLET_GENERATOR);
            this.poolStats.dependencies.walletGenerator = {
                status: walletGeneratorStatus ? 'healthy' : 'unhealthy',
                lastCheck: new Date().toISOString(),
                errors: walletGeneratorStatus ? 0 : this.poolStats.dependencies.walletGenerator.errors + 1
            };

            if (!walletGeneratorStatus) {
                throw ServiceError.dependency('Wallet Generator Service unhealthy');
            }

            // Get current pool stats
            const stats = await this.getPoolStats();
            
            // Check if pool is below threshold
            if (stats.available < this.config.pool.lowThreshold) {
                this.poolStats.pool_health.below_threshold_count++;
                this.poolStats.pool_health.generation_requests++;
                
                logApi.warn('Vanity wallet pool below threshold', {
                    available: stats.available,
                    threshold: this.config.pool.lowThreshold
                });

                // Generate new wallets
                const newWallets = await this.vanityPool.generateBatch({
                    count: this.config.pool.generationBatchSize
                });

                await this.addToPool(newWallets);
            }

            this.poolStats.pool_health.last_check = new Date().toISOString();

            // Update ServiceManager state
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    poolStats: this.poolStats
                }
            );

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

    async stop() {
        try {
            await super.stop();
            
            // Stop vanity pool
            await this.vanityPool.stop();
            
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
                    poolStats: this.poolStats
                }
            );
            
            logApi.info('Vanity Wallet Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Vanity Wallet Service:', error);
            throw error;
        }
    }
}

// Export service singleton
const vanityWalletService = new VanityWalletService();
export default vanityWalletService; 