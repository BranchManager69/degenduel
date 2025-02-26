import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';

const LEVELING_SERVICE_CONFIG = {
    name: 'leveling_service',
    description: 'Manages user XP and level progression',
    checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 6,
        resetTimeoutMs: 70000,
        minHealthyPeriodMs: 120000
    },
    dependencies: [] // Removed dependency on ACHIEVEMENT
};

class LevelingService extends BaseService {
    constructor() {
        super(LEVELING_SERVICE_CONFIG);
    }

    async initialize() {
        try {
            await super.initialize();
            logApi.info('\t\tLeveling Service initialized');
            return true;
        } catch (error) {
            logApi.error('Leveling Service initialization error:', error);
            throw error;
        }
    }

    /**
     * Award XP to a user and check for level up
     */
    async awardXP(wallet_address, amount, source) {
        try {
            // Start transaction
            const result = await prisma.$transaction(async (tx) => {
                // Get user with their current level
                const user = await tx.users.findUnique({
                    where: { wallet_address },
                    include: {
                        user_level: true
                    }
                });

                if (!user) {
                    throw new Error('User not found');
                }

                // Calculate new XP total
                const newXP = (user.experience_points || 0) + amount;

                // Get next level requirements if they exist
                const nextLevel = await tx.user_levels.findFirst({
                    where: {
                        level_number: (user.user_level?.level_number || 0) + 1
                    }
                });

                // Check if user should level up
                let levelUp = false;
                if (nextLevel && newXP >= nextLevel.min_exp) {
                    // Get user's achievement counts
                    const achievementCounts = await tx.user_achievements.groupBy({
                        by: ['tier'],
                        where: { wallet_address },
                        _count: true
                    });

                    // Convert to required format
                    const counts = {
                        bronze: 0,
                        silver: 0,
                        gold: 0,
                        platinum: 0,
                        diamond: 0
                    };

                    achievementCounts.forEach(count => {
                        const tier = count.tier.toLowerCase();
                        if (counts[tier] !== undefined) {
                            counts[tier] = count._count;
                        }
                    });

                    // Check if user meets achievement requirements
                    levelUp = counts.bronze >= nextLevel.bronze_achievements_required &&
                            counts.silver >= nextLevel.silver_achievements_required &&
                            counts.gold >= nextLevel.gold_achievements_required &&
                            counts.platinum >= nextLevel.platinum_achievements_required &&
                            counts.diamond >= nextLevel.diamond_achievements_required;
                }

                // Update user
                const updatedUser = await tx.users.update({
                    where: { wallet_address },
                    data: {
                        experience_points: newXP,
                        user_level_id: levelUp ? nextLevel.id : user.user_level_id,
                        last_level_up: levelUp ? new Date() : user.last_level_up
                    },
                    include: {
                        user_level: true
                    }
                });

                // If leveled up, create websocket notification
                if (levelUp) {
                    await tx.websocket_messages.create({
                        data: {
                            type: 'LEVEL_UP',
                            wallet_address,
                            data: {
                                new_level: nextLevel.level_number,
                                class_name: nextLevel.class_name,
                                title: nextLevel.title
                            }
                        }
                    });

                    // Log level up
                    logApi.info('User leveled up', {
                        wallet_address,
                        new_level: nextLevel.level_number,
                        xp_gained: amount,
                        total_xp: newXP
                    });
                }

                return {
                    levelUp,
                    previousLevel: user.user_level,
                    newLevel: levelUp ? nextLevel : null,
                    xpGained: amount,
                    totalXP: newXP
                };
            });

            return result;

        } catch (error) {
            logApi.error('Failed to award XP:', {
                wallet_address,
                amount,
                source,
                error: error.message
            });
            throw new ServiceError('xp_award_failed', error.message);
        }
    }

    /**
     * Check if a user meets requirements for their next level
     */
    async checkLevelProgress(wallet_address) {
        try {
            const user = await prisma.users.findUnique({
                where: { wallet_address },
                include: {
                    user_level: true
                }
            });

            if (!user) {
                throw new Error('User not found');
            }

            const nextLevel = await prisma.user_levels.findFirst({
                where: {
                    level_number: (user.user_level?.level_number || 0) + 1
                }
            });

            if (!nextLevel) {
                return {
                    canLevelUp: false,
                    maxLevel: true,
                    currentLevel: user.user_level,
                    requirements: null
                };
            }

            // Get achievement counts
            const achievementCounts = await prisma.user_achievements.groupBy({
                by: ['tier'],
                where: { wallet_address },
                _count: true
            });

            const counts = {
                bronze: 0,
                silver: 0,
                gold: 0,
                platinum: 0,
                diamond: 0
            };

            achievementCounts.forEach(count => {
                const tier = count.tier.toLowerCase();
                if (counts[tier] !== undefined) {
                    counts[tier] = count._count;
                }
            });

            const requirements = {
                xp: {
                    current: user.experience_points || 0,
                    required: nextLevel.min_exp
                },
                achievements: {
                    bronze: { current: counts.bronze, required: nextLevel.bronze_achievements_required },
                    silver: { current: counts.silver, required: nextLevel.silver_achievements_required },
                    gold: { current: counts.gold, required: nextLevel.gold_achievements_required },
                    platinum: { current: counts.platinum, required: nextLevel.platinum_achievements_required },
                    diamond: { current: counts.diamond, required: nextLevel.diamond_achievements_required }
                }
            };

            const canLevelUp = 
                requirements.xp.current >= requirements.xp.required &&
                counts.bronze >= nextLevel.bronze_achievements_required &&
                counts.silver >= nextLevel.silver_achievements_required &&
                counts.gold >= nextLevel.gold_achievements_required &&
                counts.platinum >= nextLevel.platinum_achievements_required &&
                counts.diamond >= nextLevel.diamond_achievements_required;

            return {
                canLevelUp,
                maxLevel: false,
                currentLevel: user.user_level,
                nextLevel,
                requirements
            };

        } catch (error) {
            logApi.error('Failed to check level progress:', {
                wallet_address,
                error: error.message
            });
            throw new ServiceError('level_check_failed', error.message);
        }
    }
    
    /**
     * Implementation of the required performOperation method from BaseService
     * This is called periodically to perform health checks and maintenance
     */
    async performOperation() {
        try {
            // For leveling service, perform a basic health check
            // by querying the database to verify connection
            const levelCount = await prisma.user_levels.count();
            
            logApi.debug(`Leveling service health check passed: ${levelCount} level definitions found`);
            
            // Record success in the service stats
            await this.recordSuccess();
            return true;
        } catch (error) {
            logApi.error('Leveling service health check failed:', error);
            throw error;
        }
    }
}

// Export service singleton
const levelingService = new LevelingService();
export default levelingService; 