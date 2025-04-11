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
import { fancyColors } from '../utils/colors.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import levelingService from './levelingService.js';

const ACHIEVEMENT_SERVICE_CONFIG = {
    name: 'achievement_service',
    description: getServiceMetadata('achievement_service').description,
    checkIntervalMs: 2 * 60 * 1000, // Check every 2 minutes
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
    dependencies: [], // Removed dependency on CONTEST_EVALUATION
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
            // Check if achievement service is disabled via service profile
            if (!config.services.achievement_service) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Achievement Service is disabled in the '${config.services.active_profile}' service profile`);
                return false;
            }
            
            // Call parent initialize first
            await super.initialize();
            
            // Soft check for contest evaluation service - no longer a hard dependency
            const contestEvalStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.CONTEST_EVALUATION);
            if (!contestEvalStatus) {
                logApi.warn(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Contest Evaluation Service not healthy, but continuing initialization${fancyColors.RESET}`);
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
                prisma.achievement_categories.count(),
                prisma.user_achievements.count()
            ]);

            this.achievementStats.achievements.total = totalAchievements;
            this.achievementStats.achievements.active = activeAchievements;
            this.achievementStats.achievements.awarded = awardedCount;

            // Load achievement type stats
            const achievementTypeStats = await prisma.user_achievements.groupBy({
                by: ['achievement_type'],
                _count: true
            });

            achievementTypeStats.forEach(stat => {
                this.achievementStats.achievements.by_category[stat.achievement_type] = stat._count;
            });

            // Load user stats
            const [totalUsers, usersWithAchievements] = await Promise.all([
                prisma.users.count(),
                prisma.users.count({
                    where: {
                        user_achievements: {
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

            logApi.info(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.GREEN}Achievement Service initialized${fancyColors.RESET}`, {
            //    totalAchievements,
            //    activeAchievements,
            //    awardedCount,
            //    usersWithAchievements
            });

            return true;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Achievement Service initialization error:${fancyColors.RESET}`, error);
            await this.handleError(error);
            throw error;
        }
    }

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
                logApi.debug(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} Service not operational, skipping operation`);
                return true;
            }
            
            // Call the original performOperation implementation
            await this.performOperation();
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Perform operation error:${fancyColors.RESET} ${error.message}`);
            throw error; // Important: re-throw to trigger circuit breaker
        }
    }

    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Soft check of contest evaluation - not a hard dependency anymore
            const contestEvalStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.CONTEST_EVALUATION);
            this.achievementStats.dependencies.contestEvaluation = {
                status: contestEvalStatus ? 'healthy' : 'degraded',
                lastCheck: new Date().toISOString(),
                errors: contestEvalStatus ? 0 : this.achievementStats.dependencies.contestEvaluation.errors + 1
            };

            if (!contestEvalStatus) {
                logApi.warn(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Contest Evaluation Service unhealthy, operating in limited mode${fancyColors.RESET}`);
                // Continue operation instead of throwing error
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
                    user_achievements: {
                        none: {}
                    }
                },
                take: this.config.achievement.batchSize,
                select: {
                    id: true,
                    wallet_address: true,
                    experience_points: true
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
                    logApi.error(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Failed to process achievements for user ${user.id}:${fancyColors.RESET}`, error);
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
            const categories = await prisma.achievement_categories.findMany();
            
            // Get achievement tiers and requirements separately
            const tiers = await prisma.achievement_tiers.findMany();
            const requirements = await prisma.achievement_tier_requirements.findMany();

            // Check each category
            for (const category of categories) {
                try {
                    const awarded = await this.checkCategoryAchievements(user, category);
                    results.awarded += awarded;
                    results.by_category[category.id] = awarded;
                } catch (error) {
                    results.failed++;
                    logApi.error(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Failed to check category ${category.id} for user ${user.id}:${fancyColors.RESET}`, error);
                }
            }

            // Update user's last check time - we don't have this field in schema
            // Updating timestamps through updated_at field instead
            await prisma.users.update({
                where: { id: user.id },
                data: { updated_at: new Date() }
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
                wallet_address: user.wallet_address,
                category: category.name
            },
            orderBy: {
                achieved_at: 'desc'
            }
        });

        // Get all tiers for processing
        const tiers = await prisma.achievement_tiers.findMany({
            orderBy: {
                points: 'asc'
            }
        });

        // Check each tier in order
        for (const tier of tiers) {
            // Skip if user already has this tier or higher
            if (currentAchievement && currentAchievement.tier === tier.name) {
                continue;
            }

            // Get requirements for this tier
            const requirements = await prisma.achievement_tier_requirements.findMany({
                where: {
                    tier_id: tier.id
                }
            });

            // Check if user meets requirements
            const meetsRequirements = await this.checkTierRequirements(user, tier, requirements);
            
            if (meetsRequirements) {
                try {
                    // Award the achievement and XP
                    await prisma.user_achievements.create({
                        data: {
                            wallet_address: user.wallet_address,
                            achievement_type: `${category.name.toUpperCase()}_ACHIEVEMENT`,
                            tier: tier.name,
                            category: category.name,
                            achieved_at: new Date(),
                            xp_awarded: tier.points
                        }
                    });

                    // Award XP based on tier
                    const tierXP = {
                        BRONZE: 100,
                        SILVER: 250,
                        GOLD: 500,
                        PLATINUM: 1000,
                        DIAMOND: 2500
                    }[tier.name] || 100;

                    await levelingService.awardXP(
                        user.wallet_address,
                        tierXP,
                        {
                            type: 'ACHIEVEMENT_EARNED',
                            category: category.name,
                            tier: tier.name
                        }
                    );

                    awarded++;
                    this.achievementStats.achievements.awarded++;
                    this.achievementStats.achievements.by_category[category.name] = 
                        (this.achievementStats.achievements.by_category[category.name] || 0) + 1;
                    this.achievementStats.achievements.by_tier[tier.name] = 
                        (this.achievementStats.achievements.by_tier[tier.name] || 0) + 1;

                } catch (error) {
                    logApi.error(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Failed to award achievement:${fancyColors.RESET}`, {
                        wallet_address: user.wallet_address,
                        category: category.name,
                        tier: tier.name,
                        error: error.message
                    });
                    throw error;
                }
            }
        }

        return awarded;
    }

    async checkTierRequirements(user, tier, requirements) {
        // Check each requirement
        for (const requirement of requirements) {
            try {
                const met = await this.checkRequirement(user, requirement);
                if (!met) return false;
            } catch (error) {
                logApi.error(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Failed to check requirement:${fancyColors.RESET}\n`, {
                    wallet_address: user.wallet_address,
                    requirement_id: requirement.id,
                    error: error.message
                });
                return false;
            }
        }
        return true;
    }

    async checkRequirement(user, requirement) {
        const startTime = Date.now();
        
        try {
            // Extract the actual value from the requirement_value JSON
            const value = requirement.requirement_value?.value;
            const category = requirement.requirement_value?.category;
            
            switch (requirement.achievement_type) {
                case 'CONTESTS_ENTERED':
                    const contestCount = await prisma.contest_participants.count({
                        where: { wallet_address: user.wallet_address }
                    });
                    return contestCount >= value;

                case 'CONTESTS_WON':
                    const winCount = await prisma.contest_participants.count({
                        where: {
                            wallet_address: user.wallet_address,
                            final_rank: 1
                        }
                    });
                    return winCount >= value;

                case 'TOTAL_PROFIT':
                    const profitStats = await prisma.user_stats.findUnique({
                        where: { wallet_address: user.wallet_address },
                        select: { total_profit: true }
                    });
                    return profitStats?.total_profit >= value;

                case 'TRADING_VOLUME':
                    const volumeStats = await prisma.user_stats.findUnique({
                        where: { wallet_address: user.wallet_address },
                        select: { total_volume: true }
                    });
                    return volumeStats?.total_volume >= value;

                case 'CONSECUTIVE_WINS':
                    const recentContests = await prisma.contest_participants.findMany({
                        where: { wallet_address: user.wallet_address },
                        orderBy: { contest_end: 'desc' },
                        take: value,
                        select: { final_rank: true }
                    });
                    return recentContests.length >= value && 
                           recentContests.every(c => c.final_rank === 1);

                case 'SOCIAL_ENGAGEMENT':
                    const socialProfiles = await prisma.user_social_profiles.count({
                        where: {
                            wallet_address: user.wallet_address,
                            verified: true
                        }
                    });
                    return socialProfiles >= value;

                case 'REFERRALS':
                    const referralCount = await prisma.referrals.count({
                        where: {
                            referrer_id: user.wallet_address,
                            status: 'qualified'
                        }
                    });
                    return referralCount >= value;

                case 'TOKENS_TRADED':
                    const uniqueTokens = await prisma.contest_portfolios.count({
                        where: { wallet_address: user.wallet_address },
                        distinct: ['token_id']
                    });
                    return uniqueTokens >= value;

                case 'EXPERIENCE_POINTS':
                    return user.experience_points >= value;

                case 'ACHIEVEMENT_COUNT':
                    const achievementCount = await prisma.user_achievements.count({
                        where: {
                            wallet_address: user.wallet_address,
                            category: category
                        }
                    });
                    return achievementCount >= value;

                default:
                    logApi.warn(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Unknown achievement requirement type:${fancyColors.RESET}`, requirement.achievement_type);
                    logApi.warn(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Requirement:${fancyColors.RESET}\n`, requirement);
                    return false;
            }
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Achievement requirement check failed:${fancyColors.RESET}\n`, {
                user_id: user.wallet_address,
                requirement: requirement,
                error: error.message
            });
            return false;
        } finally {
            // Update performance metrics
            const duration = Date.now() - startTime;
            this.achievementStats.performance.average_check_time_ms = 
                (this.achievementStats.performance.average_check_time_ms * this.achievementStats.checks.total + duration) 
                / (this.achievementStats.checks.total + 1);
        }
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
            
            logApi.info(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.GREEN}Achievement Service stopped successfully${fancyColors.RESET}`);
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Error stopping Achievement Service:${fancyColors.RESET}`, error);
            throw error;
        }
    }
}

// Export service singleton
const achievementService = new AchievementService();
export default achievementService;