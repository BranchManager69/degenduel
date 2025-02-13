// /services/referralService.js

import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { Decimal } from '@prisma/client/runtime/library';
import cache from '../utils/cache.js';

const REFERRAL_SERVICE_CONFIG = {
    name: 'referral_service',
    checkIntervalMs: 5 * 60 * 1000,  // Check every 5 minutes
    maxRetries: 3,
    retryDelayMs: 30000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
    },
    tracking: {
        maxClicksPerIP: 100,
        clickWindowMs: 15 * 60 * 1000,  // 15 minutes
        maxConversionsPerIP: 10,
        conversionWindowMs: 60 * 60 * 1000  // 1 hour
    },
    cache: {
        periodStatsTTL: 300,  // 5 minutes
        rankingsTTL: 60       // 1 minute
    }
};

class ReferralService extends BaseService {
    constructor() {
        super(REFERRAL_SERVICE_CONFIG.name, REFERRAL_SERVICE_CONFIG);
        
        // Service-specific state
        this.referralStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            clicks: {
                total: 0,
                by_source: {},
                by_device: {},
                by_campaign: {}
            },
            conversions: {
                total: 0,
                by_source: {},
                successful: 0,
                failed: 0
            },
            rewards: {
                total_distributed: new Decimal(0),
                by_type: {},
                pending: 0
            },
            performance: {
                average_operation_time_ms: 0,
                last_operation_time_ms: 0
            }
        };
    }

    // System Settings Management
    async getSystemSettings() {
        const settings = await prisma.system_settings.findFirst({
            where: { key: 'referral_settings' }
        });
        return settings?.value || {};
    }

    // Period Management
    async getCurrentPeriod() {
        return await prisma.referral_periods.findFirst({
            where: { is_active: true },
            orderBy: { start_date: 'desc' }
        });
    }

    async createNewPeriod() {
        const settings = await this.getSystemSettings();
        const { startDate, endDate } = this.calculatePeriodDates(settings.period_length);
        
        return await prisma.referral_periods.create({
            data: {
                start_date: startDate,
                end_date: endDate,
                is_active: true,
                status: 'in_progress'
            }
        });
    }

    calculatePeriodDates(periodLength = 'weekly') {
        const startDate = new Date();
        const endDate = new Date();
        
        switch (periodLength) {
            case 'weekly':
                endDate.setDate(endDate.getDate() + 7);
                break;
            case 'monthly':
                endDate.setMonth(endDate.getMonth() + 1);
                break;
            default:
                endDate.setDate(endDate.getDate() + 7); // Default to weekly
        }
        
        return { startDate, endDate };
    }

    // Milestone Management
    async checkMilestones(userId) {
        const settings = await this.getSystemSettings();
        const referralCount = await this.getUserReferralCount(userId);
        
        for (const [level, config] of Object.entries(settings.reward_tiers || {})) {
            if (referralCount >= config.referrals) {
                await this.createMilestone(userId, parseInt(level.split('_')[1]), config);
            }
        }
    }

    async createMilestone(userId, level, config) {
        const existing = await prisma.referral_milestones.findFirst({
            where: { 
                user_id: userId,
                milestone_level: level
            }
        });

        if (!existing) {
            await prisma.referral_milestones.create({
                data: {
                    user_id: userId,
                    milestone_level: level,
                    referral_count: config.referrals,
                    reward_amount: config.reward,
                    status: 'pending'
                }
            });
        }
    }

    // Ranking Management
    async updateRankings() {
        const currentPeriod = await this.getCurrentPeriod();
        if (!currentPeriod) return;

        const rankings = await this.calculateRankings(currentPeriod.id);
        await this.updateTrends(rankings);
        await this.storeRankings(currentPeriod.id, rankings);
    }

    async calculateRankings(periodId) {
        const referrals = await prisma.$queryRaw`
            SELECT 
                r.referrer_id as user_id,
                COUNT(*) as referral_count
            FROM referrals r
            JOIN referral_periods p ON r.created_at BETWEEN p.start_date AND p.end_date
            WHERE p.id = ${periodId}
            GROUP BY r.referrer_id
            ORDER BY referral_count DESC
        `;

        return referrals.map((r, index) => ({
            ...r,
            rank: index + 1
        }));
    }

    async updateTrends(newRankings) {
        const previousRankings = await prisma.referral_period_rankings.findMany({
            orderBy: { created_at: 'desc' },
            take: 1
        });

        return newRankings.map(ranking => {
            const previous = previousRankings.find(p => p.user_id === ranking.user_id);
            const trend = !previous ? 'stable' :
                         ranking.rank < previous.rank ? 'up' :
                         ranking.rank > previous.rank ? 'down' : 'stable';
            return { ...ranking, trend };
        });
    }

    async storeRankings(periodId, rankings) {
        const settings = await this.getSystemSettings();
        
        for (const ranking of rankings) {
            let rewardAmount = 0;
            
            // Calculate reward based on rank
            if (ranking.rank <= 3) {
                rewardAmount = settings.leaderboard_rewards.top_3[ranking.rank - 1];
            } else if (ranking.rank <= 10) {
                rewardAmount = settings.leaderboard_rewards.top_10;
            }

            await prisma.referral_period_rankings.upsert({
                where: {
                    period_id_user_id: {
                        period_id: periodId,
                        user_id: ranking.user_id
                    }
                },
                update: {
                    referral_count: ranking.referral_count,
                    rank: ranking.rank,
                    reward_amount: rewardAmount
                },
                create: {
                    period_id: periodId,
                    user_id: ranking.user_id,
                    referral_count: ranking.referral_count,
                    rank: ranking.rank,
                    reward_amount: rewardAmount,
                    status: 'pending'
                }
            });
        }
    }

    // Caching
    async getCachedPeriodStats() {
        const cacheKey = 'current_period_stats';
        let stats = await cache.get(cacheKey);
        
        if (!stats) {
            const currentPeriod = await this.getCurrentPeriod();
            if (!currentPeriod) return null;

            stats = {
                total_global_referrals: await this.getTotalGlobalReferrals(),
                current_period: {
                    start_date: currentPeriod.start_date,
                    end_date: currentPeriod.end_date,
                    days_remaining: Math.ceil((new Date(currentPeriod.end_date) - new Date()) / (1000 * 60 * 60 * 24))
                }
            };

            await cache.set(cacheKey, stats, this.config.cache.periodStatsTTL);
        }
        
        return stats;
    }

    async getCachedRankings() {
        const cacheKey = 'current_rankings';
        let rankings = await cache.get(cacheKey);
        
        if (!rankings) {
            const currentPeriod = await this.getCurrentPeriod();
            if (!currentPeriod) return [];

            rankings = await prisma.referral_period_rankings.findMany({
                where: { period_id: currentPeriod.id },
                orderBy: { rank: 'asc' },
                take: 100,
                include: {
                    user: {
                        select: {
                            username: true
                        }
                    }
                }
            });

            await cache.set(cacheKey, rankings, this.config.cache.rankingsTTL);
        }
        
        return rankings;
    }

    // Core operation: Track referral click
    async trackClick(referralCode, clickData) {
        try {
            // Check rate limiting
            const recentClicks = await prisma.referral_clicks.count({
                where: {
                    ip_address: clickData.ip_address,
                    timestamp: {
                        gte: new Date(Date.now() - this.config.tracking.clickWindowMs)
                    }
                }
            });

            if (recentClicks >= this.config.tracking.maxClicksPerIP) {
                throw ServiceError.validation('Rate limit exceeded for click tracking');
            }

            // Record the click
            const click = await prisma.referral_clicks.create({
                data: {
                    referral_code: referralCode,
                    source: clickData.source,
                    landing_page: clickData.landing_page,
                    utm_source: clickData.utm_params?.source,
                    utm_medium: clickData.utm_params?.medium,
                    utm_campaign: clickData.utm_params?.campaign,
                    device: clickData.device,
                    browser: clickData.browser,
                    ip_address: clickData.ip_address,
                    user_agent: clickData.user_agent,
                    session_id: clickData.session_id,
                    timestamp: new Date(),
                    referrer_id: clickData.referrer_id
                }
            });

            // Update statistics
            this.referralStats.clicks.total++;
            this.referralStats.clicks.by_source[clickData.source] = 
                (this.referralStats.clicks.by_source[clickData.source] || 0) + 1;
            this.referralStats.clicks.by_device[clickData.device] = 
                (this.referralStats.clicks.by_device[clickData.device] || 0) + 1;
            if (clickData.utm_params?.campaign) {
                this.referralStats.clicks.by_campaign[clickData.utm_params.campaign] = 
                    (this.referralStats.clicks.by_campaign[clickData.utm_params.campaign] || 0) + 1;
            }

            return click;
        } catch (error) {
            logApi.error('Failed to track referral click:', error);
            throw error;
        }
    }

    // Core operation: Process conversion
    async processConversion(sessionId, userData) {
        try {
            // Find the original click
            const click = await prisma.referral_clicks.findFirst({
                where: {
                    session_id: sessionId,
                    converted: false
                },
                orderBy: {
                    timestamp: 'desc'
                }
            });

            if (!click) {
                throw ServiceError.validation('No matching click found for conversion');
            }

            // Create the referral record
            const referral = await prisma.referrals.create({
                data: {
                    referrer_id: click.referrer_id,
                    referred_id: userData.wallet_address,
                    referral_code: click.referral_code,
                    status: 'PENDING',
                    source: click.source,
                    landing_page: click.landing_page,
                    utm_source: click.utm_source,
                    utm_medium: click.utm_medium,
                    utm_campaign: click.utm_campaign,
                    device: click.device,
                    browser: click.browser,
                    ip_address: click.ip_address,
                    user_agent: click.user_agent,
                    click_timestamp: click.timestamp,
                    session_id: click.session_id
                }
            });

            // Mark click as converted
            await prisma.referral_clicks.update({
                where: { id: click.id },
                data: {
                    converted: true,
                    converted_at: new Date()
                }
            });

            // Update statistics
            this.referralStats.conversions.total++;
            this.referralStats.conversions.by_source[click.source] = 
                (this.referralStats.conversions.by_source[click.source] || 0) + 1;
            this.referralStats.conversions.successful++;

            return referral;
        } catch (error) {
            this.referralStats.conversions.failed++;
            logApi.error('Failed to process conversion:', error);
            throw error;
        }
    }

    // Core operation: Process rewards
    async processRewards(referralId) {
        try {
            const referral = await prisma.referrals.findUnique({
                where: { id: referralId },
                include: {
                    referrer: true,
                    referred: true
                }
            });

            if (!referral || referral.status !== 'PENDING') {
                throw ServiceError.validation('Invalid referral for reward processing');
            }

            // Calculate reward amount based on your criteria
            const rewardAmount = new Decimal('1.0'); // Example fixed amount

            // Record the reward
            await prisma.referrals.update({
                where: { id: referralId },
                data: {
                    status: 'COMPLETED',
                    reward_amount: rewardAmount,
                    reward_paid_at: new Date(),
                    qualified_at: new Date()
                }
            });

            // Update statistics
            this.referralStats.rewards.total_distributed = 
                this.referralStats.rewards.total_distributed.add(rewardAmount);
            this.referralStats.rewards.by_type['signup_bonus'] = 
                (this.referralStats.rewards.by_type['signup_bonus'] || new Decimal(0)).add(rewardAmount);

            return {
                referralId,
                rewardAmount,
                status: 'COMPLETED'
            };
        } catch (error) {
            logApi.error('Failed to process rewards:', error);
            throw error;
        }
    }

    // Admin operation: Get referral analytics
    async getAnalytics(filters = {}) {
        try {
            const analytics = {
                clicks: await this._getClickAnalytics(filters),
                conversions: await this._getConversionAnalytics(filters),
                rewards: await this._getRewardAnalytics(filters)
            };

            return analytics;
        } catch (error) {
            logApi.error('Failed to get analytics:', error);
            throw error;
        }
    }

    // Helper: Get click analytics
    async _getClickAnalytics(filters) {
        const clicks = await prisma.referral_clicks.groupBy({
            by: ['source', 'device', 'utm_campaign'],
            _count: {
                _all: true
            },
            where: filters
        });

        return {
            total: await prisma.referral_clicks.count({ where: filters }),
            by_source: this._groupByField(clicks, 'source'),
            by_device: this._groupByField(clicks, 'device'),
            by_campaign: this._groupByField(clicks, 'utm_campaign')
        };
    }

    // Helper: Get conversion analytics
    async _getConversionAnalytics(filters) {
        const conversions = await prisma.referrals.groupBy({
            by: ['source', 'status'],
            _count: {
                _all: true
            },
            where: filters
        });

        return {
            total: await prisma.referrals.count({ where: filters }),
            by_source: this._groupByField(conversions, 'source'),
            by_status: this._groupByField(conversions, 'status')
        };
    }

    // Helper: Get reward analytics
    async _getRewardAnalytics(filters) {
        const rewards = await prisma.referrals.groupBy({
            by: ['status'],
            _sum: {
                reward_amount: true
            },
            where: {
                ...filters,
                reward_amount: { not: null }
            }
        });

        return {
            total_distributed: rewards.reduce((sum, r) => sum.add(r._sum.reward_amount || 0), new Decimal(0)),
            by_status: this._groupByField(rewards, 'status', '_sum.reward_amount')
        };
    }

    // Helper: Group analytics by field
    _groupByField(data, field, valueField = '_count._all') {
        return data.reduce((acc, item) => {
            if (item[field]) {
                acc[item[field]] = this._getNestedValue(item, valueField);
            }
            return acc;
        }, {});
    }

    // Helper: Get nested object value
    _getNestedValue(obj, path) {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }

    // Main operation implementation
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Update rankings
            await this.updateRankings();

            // Process pending rewards
            const pendingReferrals = await prisma.referrals.findMany({
                where: {
                    status: 'PENDING',
                    click_timestamp: {
                        lte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                    }
                }
            });

            for (const referral of pendingReferrals) {
                try {
                    await this.processRewards(referral.id);
                    await this.checkMilestones(referral.referrer_id);
                } catch (error) {
                    logApi.error(`Failed to process rewards for referral ${referral.id}:`, error);
                }
            }

            return {
                duration: Date.now() - startTime,
                processed: pendingReferrals.length,
                rankings_updated: true
            };
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            throw error;
        }
    }

    // Helper methods
    async getTotalGlobalReferrals() {
        return await prisma.referrals.count({
            where: { status: 'COMPLETED' }
        });
    }

    async getUserReferralCount(userId) {
        return await prisma.referrals.count({
            where: {
                referrer_id: userId,
                status: 'COMPLETED'
            }
        });
    }
}

// Create and export singleton instance
const referralService = new ReferralService();
export default referralService; 