// services/achievementService.js

/*
 * This service is responsible for managing and tracking user achievements.
 * It monitors user activities, evaluates achievement criteria, and awards
 * achievements when conditions are met. It integrates with the Contest
 * Evaluation Service to track contest-related achievements.
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

const ACHIEVEMENT_SERVICE_CONFIG = {
    name: 'achievement_service',
    description: getServiceMetadata('achievement_service').description,
    checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 6,
        resetTimeoutMs: 70000,
        minHealthyPeriodMs: 120000
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    },
    dependencies: [SERVICE_NAMES.CONTEST_EVALUATION],
    achievement: {
        batchSize: 100,
        maxParallelChecks: 5,
        checkTimeoutMs: 30000,
        minCheckInterval: 60000
    }
};

class AchievementService extends BaseService {
    constructor() {
        super(ACHIEVEMENT_SERVICE_CONFIG);
        
        // Initialize service-specific stats
        this.achievementStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            achievements: {
                total: 0,
                active: 0,
                awarded: 0,
                failed: 0,
                by_category: {},
                by_tier: {}
            },
            checks: {
                total: 0,
                successful: 0,
                failed: 0,
                skipped: 0,
                last_check: null
            },
            users: {
                total: 0,
                with_achievements: 0,
                processing: 0
            },
            performance: {
                average_check_time_ms: 0,
                last_operation_time_ms: 0,
                average_award_time_ms: 0
            },
            dependencies: {
                contestEvaluation: {
                    status: 'unknown',
                    lastCheck: null,
                    errors: 0
                }
            }
        };

        // Active processing tracking
        this.activeChecks = new Map();
        this.checkTimeouts = new Set();
    }

    async initialize() {
        try {
            // Call parent initialize first
            await super.initialize();
            
            // Check dependencies
            const contestEvalStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.CONTEST_EVALUATION);
            if (!contestEvalStatus) {
                throw ServiceError.initialization('Contest Evaluation Service not healthy');
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

            // Load initial achievement state
            const [totalAchievements, activeAchievements, awardedCount] = await Promise.all([
                prisma.achievement_categories.count(),
                prisma.achievement_categories.count({ where: { is_active: true } }),
                prisma.user_achievements.count()
            ]);

            this.achievementStats.achievements.total = totalAchievements;
            this.achievementStats.achievements.active = activeAchievements;
            this.achievementStats.achievements.awarded = awardedCount;

            // Load category and tier stats
            const categoryStats = await prisma.user_achievements.groupBy({
                by: ['category_id'],
                _count: true
            });

            const tierStats = await prisma.user_achievements.groupBy({
                by: ['tier_id'],
                _count: true
            });

            categoryStats.forEach(stat => {
                this.achievementStats.achievements.by_category[stat.category_id] = stat._count;
            });

            tierStats.forEach(stat => {
                this.achievementStats.achievements.by_tier[stat.tier_id] = stat._count;
            });

            // Load user stats
            const [totalUsers, usersWithAchievements] = await Promise.all([
                prisma.users.count(),
                prisma.users.count({
                    where: {
                        achievements: {
                            some: {}
                        }
                    }
                })
            ]);

            this.achievementStats.users.total = totalUsers;
            this.achievementStats.users.with_achievements = usersWithAchievements;

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify({
                ...this.stats,
                achievementStats: this.achievementStats
            }));

            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            logApi.info('Achievement Service initialized', {
                totalAchievements,
                activeAchievements,
                awardedCount,
                usersWithAchievements
            });

            return true;
        } catch (error) {
            logApi.error('Achievement Service initialization error:', error);
            await this.handleError(error);
            throw error;
        }
    }

    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Check dependency health
            const contestEvalStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.CONTEST_EVALUATION);
            this.achievementStats.dependencies.contestEvaluation = {
                status: contestEvalStatus ? 'healthy' : 'unhealthy',
                lastCheck: new Date().toISOString(),
                errors: contestEvalStatus ? 0 : this.achievementStats.dependencies.contestEvaluation.errors + 1
            };

            if (!contestEvalStatus) {
                throw ServiceError.dependency('Contest Evaluation Service unhealthy');
            }

            // Process achievements in batches
            const results = await this.processPendingAchievements();

            // Update performance metrics
            this.achievementStats.performance.last_operation_time_ms = Date.now() - startTime;
            this.achievementStats.performance.average_check_time_ms = 
                (this.achievementStats.performance.average_check_time_ms * this.achievementStats.operations.total + 
                (Date.now() - startTime)) / (this.achievementStats.operations.total + 1);

            // Update ServiceManager state
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    achievementStats: this.achievementStats
                }
            );

            return {
                duration: Date.now() - startTime,
                results
            };
        } catch (error) {
            await this.handleError(error);
            return false;
        }
    }

    async processPendingAchievements() {
        const startTime = Date.now();
        
        try {
            // Get users who need achievement checks
            const users = await prisma.users.findMany({
                where: {
                    OR: [
                        { last_achievement_check: null },
                        {
                            last_achievement_check: {
                                lt: new Date(Date.now() - this.config.achievement.minCheckInterval)
                            }
                        }
                    ]
                },
                take: this.config.achievement.batchSize,
                orderBy: {
                    last_achievement_check: 'asc'
                }
            });

            const results = {
                processed: 0,
                awarded: 0,
                failed: 0,
                skipped: 0,
                by_category: {}
            };

            // Process each user's achievements
            for (const user of users) {
                try {
                    // Skip if already being processed
                    if (this.activeChecks.has(user.id)) {
                        results.skipped++;
                        continue;
                    }

                    // Add to active checks
                    this.activeChecks.set(user.id, startTime);

                    // Set timeout
                    const timeout = setTimeout(() => {
                        this.activeChecks.delete(user.id);
                        this.achievementStats.checks.failed++;
                    }, this.config.achievement.checkTimeoutMs);
                    
                    this.checkTimeouts.add(timeout);

                    // Check achievements
                    const userResults = await this.checkUserAchievements(user);
                    
                    // Update results
                    results.processed++;
                    results.awarded += userResults.awarded;
                    results.failed += userResults.failed;

                    // Update category stats
                    Object.entries(userResults.by_category).forEach(([category, count]) => {
                        results.by_category[category] = (results.by_category[category] || 0) + count;
                    });

                    // Clear timeout and active check
                    clearTimeout(timeout);
                    this.checkTimeouts.delete(timeout);
                    this.activeChecks.delete(user.id);

                } catch (error) {
                    results.failed++;
                    logApi.error(`Failed to process achievements for user ${user.id}:`, error);
                }
            }

            // Update stats
            this.achievementStats.checks.total += results.processed;
            this.achievementStats.checks.successful += results.processed - results.failed;
            this.achievementStats.checks.failed += results.failed;
            this.achievementStats.checks.skipped += results.skipped;
            this.achievementStats.checks.last_check = new Date().toISOString();

            return results;
        } catch (error) {
            throw ServiceError.operation('Failed to process pending achievements', {
                error: error.message
            });
        }
    }

    async checkUserAchievements(user) {
        const results = {
            awarded: 0,
            failed: 0,
            by_category: {}
        };

        try {
            // Get all achievement categories
            const categories = await prisma.achievement_categories.findMany({
                where: { is_active: true },
                include: {
                    tiers: {
                        include: {
                            requirements: true
                        }
                    }
                }
            });

            // Check each category
            for (const category of categories) {
                try {
                    const awarded = await this.checkCategoryAchievements(user, category);
                    results.awarded += awarded;
                    results.by_category[category.id] = awarded;
                } catch (error) {
                    results.failed++;
                    logApi.error(`Failed to check category ${category.id} for user ${user.id}:`, error);
                }
            }

            // Update user's last check time
            await prisma.users.update({
                where: { id: user.id },
                data: { last_achievement_check: new Date() }
            });

            return results;
        } catch (error) {
            throw ServiceError.operation('Failed to check user achievements', {
                user_id: user.id,
                error: error.message
            });
        }
    }

    async checkCategoryAchievements(user, category) {
        let awarded = 0;

        // Get user's current tier in this category
        const currentAchievement = await prisma.user_achievements.findFirst({
            where: {
                user_id: user.id,
                category_id: category.id
            },
            orderBy: {
                awarded_at: 'desc'
            }
        });

        // Check each tier in order
        for (const tier of category.tiers) {
            // Skip if user already has this tier or higher
            if (currentAchievement && currentAchievement.tier_id >= tier.id) {
                continue;
            }

            // Check if user meets requirements
            const meetsRequirements = await this.checkTierRequirements(user, tier);
            
            if (meetsRequirements) {
                try {
                    // Award the achievement
                    await prisma.user_achievements.create({
                        data: {
                            user_id: user.id,
                            category_id: category.id,
                            tier_id: tier.id,
                            awarded_at: new Date()
                        }
                    });

                    awarded++;
                    this.achievementStats.achievements.awarded++;
                    this.achievementStats.achievements.by_category[category.id] = 
                        (this.achievementStats.achievements.by_category[category.id] || 0) + 1;
                    this.achievementStats.achievements.by_tier[tier.id] = 
                        (this.achievementStats.achievements.by_tier[tier.id] || 0) + 1;

                } catch (error) {
                    logApi.error(`Failed to award achievement:`, {
                        user_id: user.id,
                        category_id: category.id,
                        tier_id: tier.id,
                        error: error.message
                    });
                    throw error;
                }
            }
        }

        return awarded;
    }

    async checkTierRequirements(user, tier) {
        // Check each requirement
        for (const requirement of tier.requirements) {
            try {
                const met = await this.checkRequirement(user, requirement);
                if (!met) return false;
            } catch (error) {
                logApi.error(`Failed to check requirement:`, {
                    user_id: user.id,
                    requirement_id: requirement.id,
                    error: error.message
                });
                return false;
            }
        }
        return true;
    }

    async checkRequirement(user, requirement) {
        // Implementation will vary based on requirement type
        // This is a placeholder for the actual implementation
        return false;
    }

    async stop() {
        try {
            await super.stop();
            
            // Clear all timeouts
            for (const timeout of this.checkTimeouts) {
                clearTimeout(timeout);
            }
            this.checkTimeouts.clear();
            
            // Clear active checks
            this.activeChecks.clear();
            
            // Final stats update
            await serviceManager.markServiceStopped(
                this.name,
                this.config,
                {
                    ...this.stats,
                    achievementStats: this.achievementStats
                }
            );
            
            logApi.info('Achievement Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Achievement Service:', error);
            throw error;
        }
    }
}

// Export service singleton
const achievementService = new AchievementService();
export default achievementService;