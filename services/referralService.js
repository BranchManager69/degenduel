// services/referralService.js

/*
 * This service is responsible for managing the referral program.
 * It handles referral tracking, milestone achievements, period rankings,
 * and reward distribution. It integrates with the Contest Evaluation Service
 * to track contest participation and performance.
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

const REFERRAL_SERVICE_CONFIG = {
    name: SERVICE_NAMES.REFERRAL,
    description: getServiceMetadata(SERVICE_NAMES.REFERRAL).description,
    checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    },
    dependencies: [], // Removed hard dependency on Contest Evaluation
    referral: {
        batchSize: 100,
        maxParallelProcessing: 5,
        processingTimeoutMs: 30000,
        minProcessInterval: 60000,
        periodLength: 'weekly',
        rankingUpdateInterval: 3600000, // 1 hour
        cacheTimeout: 300000 // 5 minutes
    }
};

// Referral Service
class ReferralService extends BaseService {
    constructor() {
        super(REFERRAL_SERVICE_CONFIG);
        
        // Initialize service-specific stats
        this.referralStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            referrals: {
                total: 0,
                active: 0,
                converted: 0,
                failed: 0,
                by_status: {}
            },
            periods: {
                total: 0,
                active: 0,
                completed: 0,
                rankings_updated: 0
            },
            rewards: {
                total_distributed: 0,
                successful_distributions: 0,
                failed_distributions: 0,
                total_amount: 0
            },
            milestones: {
                total: 0,
                achieved: 0,
                failed: 0,
                by_level: {}
            },
            performance: {
                average_processing_time_ms: 0,
                last_operation_time_ms: 0,
                average_reward_time_ms: 0
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
        this.activeProcessing = new Map();
        this.processingTimeouts = new Set();

        // Cache for period stats and rankings
        this.periodStatsCache = new Map();
        this.rankingsCache = new Map();
    }

    // Initialize the service
    async initialize() {
        try {
            // Check if referral service is disabled via service profile
            if (!config.services.referral_service) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Referral Service is disabled in the '${config.services.active_profile}' service profile`);
                return false;
            }
            
            // Call parent initialize first
            await super.initialize();
            
            // Check dependencies, but don't fail if contest eval is down
            // This makes the service more resilient
            const contestEvalStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.CONTEST_EVALUATION);
            if (!contestEvalStatus) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED}Contest Evaluation Service not healthy, but continuing initialization ${fancyColors.RESET}`);
                this.referralStats.dependencies.contestEvaluation = {
                    status: 'unhealthy',
                    lastCheck: new Date().toISOString(),
                    errors: 1
                };
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

            // Load initial referral state
            const [totalReferrals, activeReferrals, convertedReferrals] = await Promise.all([
                prisma.referrals.count(),
                prisma.referrals.count({ where: { status: 'qualified' } }),
                prisma.referrals.count({ where: { status: 'rewarded' } })
            ]);

            this.referralStats.referrals.total = totalReferrals;
            this.referralStats.referrals.active = activeReferrals;
            this.referralStats.referrals.converted = convertedReferrals;

            // Load status stats
            const statusStats = await prisma.referrals.groupBy({
                by: ['status'],
                _count: true
            });

            statusStats.forEach(stat => {
                this.referralStats.referrals.by_status[stat.status] = stat._count;
            });

            // Load milestone stats
            const [totalMilestones, achievedMilestones] = await Promise.all([
                prisma.referral_milestones.count(),
                prisma.referral_milestones.count({ where: { status: 'completed' } })
            ]);

            this.referralStats.milestones.total = totalMilestones;
            this.referralStats.milestones.achieved = achievedMilestones;

            // Load level stats
            const levelStats = await prisma.referral_milestones.groupBy({
                by: ['milestone_level'],
                _count: true,
                where: { status: 'completed' }
            });

            levelStats.forEach(stat => {
                this.referralStats.milestones.by_level[stat.milestone_level] = stat._count;
            });

            // Load period stats
            const [totalPeriods, activePeriods, completedPeriods] = await Promise.all([
                prisma.referral_periods.count(),
                prisma.referral_periods.count({ where: { end_date: { gt: new Date() } } }),
                prisma.referral_periods.count({ where: { end_date: { lt: new Date() } } })
            ]);

            this.referralStats.periods.total = totalPeriods;
            this.referralStats.periods.active = activePeriods;
            this.referralStats.periods.completed = completedPeriods;

            // Start ranking update interval
            this.startRankingUpdates();

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify({
                ...this.stats,
                referralStats: this.referralStats
            }));

            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            // Log successful service initialization
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}✅ ${fancyColors.BG_LIGHT_GREEN} Referral Service initialized ${fancyColors.RESET}`, {
            //    totalReferrals,
            //    activeReferrals,
            //    convertedReferrals,
            //    totalMilestones,
            //    achievedMilestones
            });

            return true;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED}Referral Service initialization error:${fancyColors.RESET} ${error.message}`);
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
                logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Service not operational, skipping operation`);
                return true;
            }
            
            // Call the original performOperation implementation
            await this.performOperation();
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Perform operation error:${fancyColors.RESET} ${error.message}`);
            throw error; // Important: re-throw to trigger circuit breaker
        }
    }

    // Perform operation
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Check dependency health but don't fail operations
            const contestEvalStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.CONTEST_EVALUATION);
            this.referralStats.dependencies.contestEvaluation = {
                status: contestEvalStatus ? 'healthy' : 'unhealthy',
                lastCheck: new Date().toISOString(),
                errors: contestEvalStatus ? 0 : (this.referralStats.dependencies.contestEvaluation?.errors || 0) + 1
            };

            if (!contestEvalStatus) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED}Contest Evaluation Service unhealthy, continuing with limited functionality ${fancyColors.RESET}`);
                // Continue execution instead of throwing an error
            }

            // Get current period
            const currentPeriod = await this.getCurrentPeriod();
            if (!currentPeriod) {
                await this.createNewPeriod();
            }

            // Process referrals in batches
            const results = await this.processReferrals();

            // Update performance metrics
            this.referralStats.performance.last_operation_time_ms = Date.now() - startTime;
            this.referralStats.performance.average_processing_time_ms = 
                (this.referralStats.performance.average_processing_time_ms * this.referralStats.operations.total + 
                (Date.now() - startTime)) / (this.referralStats.operations.total + 1);

            // Update ServiceManager state
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    referralStats: this.referralStats
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

    // Process referrals
    async processReferrals() {
        const startTime = Date.now();
        
        try {
            // Get pending referrals
            const referrals = await prisma.referrals.findMany({
                where: {
                    OR: [
                        { status: 'pending' },
                        { status: 'qualified', created_at: { lt: new Date(Date.now() - this.config.referral.minProcessInterval) } }
                    ]
                },
                take: this.config.referral.batchSize,
                orderBy: { created_at: 'asc' }
            });

            const results = {
                processed: 0,
                converted: 0,
                failed: 0,
                rewards_distributed: 0
            };

            // Process each referral
            for (const referral of referrals) {
                try {
                    // Skip if already being processed
                    if (this.activeProcessing.has(referral.id)) {
                        continue;
                    }

                    // Add to active processing
                    this.activeProcessing.set(referral.id, startTime);

                    // Set timeout
                    const timeout = setTimeout(() => {
                        this.activeProcessing.delete(referral.id);
                        this.referralStats.referrals.failed++;
                    }, this.config.referral.processingTimeoutMs);
                    
                    this.processingTimeouts.add(timeout);

                    // Process referral
                    const result = await this.processReferral(referral);
                    
                    // Update results
                    results.processed++;
                    if (result.converted) results.converted++;
                    if (result.reward_distributed) results.rewards_distributed++;

                    // Clear timeout and active processing
                    clearTimeout(timeout);
                    this.processingTimeouts.delete(timeout);
                    this.activeProcessing.delete(referral.id);

                } catch (error) {
                    results.failed++;
                    logApi.error(`Failed to process referral ${referral.id}:`, error);
                }
            }

            return results;
        } catch (error) {
            throw ServiceError.operation('Failed to process referrals', {
                error: error.message
            });
        }
    }

    // Process referral
    async processReferral(referral) {
        try {
            const result = {
                converted: false,
                reward_distributed: false
            };

            // Check if referral should be converted
            if (referral.status === 'pending') {
                const shouldConvert = await this.checkConversionCriteria(referral);
                if (shouldConvert) {
                    await this.convertReferral(referral);
                    result.converted = true;
                }
            }

            // Check milestones
            if (referral.status === 'qualified') {
                const milestoneResult = await this.checkMilestones(referral.referrer_id);
                if (milestoneResult.achieved) {
                    const rewardResult = await this.processRewards(referral.id);
                    result.reward_distributed = rewardResult.success;
                }
            }

            // Award XP for successful referral
            try {
                await levelingService.awardXP(
                    referral.referrer_id,
                    250, // XP for successful referral
                    {
                        type: 'REFERRAL_QUALIFIED',
                        referred_id: referral.referred_id
                    }
                );
            } catch (error) {
                logApi.error('Failed to award referral XP:', {
                    referrer: referral.referrer_id,
                    referred: referral.referred_id,
                    error: error.message
                });
            }

            return result;
        } catch (error) {
            throw ServiceError.operation('Failed to process referral', {
                referral_id: referral.id,
                error: error.message
            });
        }
    }

    // Check conversion criteria
    async checkConversionCriteria(referral) {
        // Implementation will vary based on conversion criteria
        // This is a placeholder for the actual implementation
        return false;
    }

    // Convert referral
    async convertReferral(referral) {
        try {
            await prisma.referrals.update({
                where: { id: referral.id },
                data: {
                    status: 'qualified',
                    qualified_at: new Date()
                }
            });

            this.referralStats.referrals.converted++;
            this.referralStats.referrals.by_status['qualified'] = 
                (this.referralStats.referrals.by_status['qualified'] || 0) + 1;

        } catch (error) {
            throw ServiceError.operation('Failed to convert referral', {
                referral_id: referral.id,
                error: error.message
            });
        }
    }

    // Get current period
    async getCurrentPeriod() {
        try {
            return await prisma.referral_periods.findFirst({
                where: {
                    start_date: { lte: new Date() },
                    end_date: { gt: new Date() }
                }
            });
        } catch (error) {
            throw ServiceError.operation('Failed to get current period', {
                error: error.message
            });
        }
    }

    async createNewPeriod() {
        try {
            const { startTime, endTime } = this.calculatePeriodDates();
            
            const period = await prisma.referral_periods.create({
                data: {
                    start_date: startTime,
                    end_date: endTime,
                    is_active: true,
                    status: 'active'
                }
            });

            this.referralStats.periods.total++;
            this.referralStats.periods.active++;

            return period;
        } catch (error) {
            throw ServiceError.operation('Failed to create new period', {
                error: error.message
            });
        }
    }

    // Calculate period dates
    calculatePeriodDates(periodLength = 'weekly') {
        const now = new Date();
        const startTime = new Date(now);
        const endTime = new Date(now);

        switch (periodLength) {
            case 'weekly':
                startTime.setHours(0, 0, 0, 0);
                startTime.setDate(startTime.getDate() - startTime.getDay());
                endTime.setTime(startTime.getTime() + 7 * 24 * 60 * 60 * 1000);
                break;
            case 'monthly':
                startTime.setDate(1);
                startTime.setHours(0, 0, 0, 0);
                endTime.setMonth(endTime.getMonth() + 1);
                endTime.setDate(1);
                endTime.setHours(0, 0, 0, 0);
                break;
            default:
                throw new Error(`Invalid period length: ${periodLength}`);
        }

        return { startTime, endTime };
    }
    
    // Calculate period statistics
    async calculatePeriodStats(period) {
        try {
            // Get total referrals in this period
            const totalReferrals = await prisma.referrals.count({
                where: {
                    created_at: {
                        gte: period.start_date,
                        lt: period.end_date
                    }
                }
            });
            
            // Get qualified referrals in this period
            const qualifiedReferrals = await prisma.referrals.count({
                where: {
                    status: 'qualified',
                    qualified_at: {
                        gte: period.start_date,
                        lt: period.end_date
                    }
                }
            });
            
            // Get unique referrers in this period
            const uniqueReferrers = await prisma.referrals.groupBy({
                by: ['referrer_id'],
                where: {
                    created_at: {
                        gte: period.start_date,
                        lt: period.end_date
                    }
                },
                _count: true
            });
            
            // Calculate conversion rate
            const conversionRate = totalReferrals > 0 
                ? (qualifiedReferrals / totalReferrals) * 100 
                : 0;
            
            return {
                period_id: period.id,
                start_date: period.start_date,
                end_date: period.end_date,
                total_referrals: totalReferrals,
                qualified_referrals: qualifiedReferrals,
                unique_referrers: uniqueReferrers.length,
                conversion_rate: conversionRate,
                status: period.status,
                updated_at: new Date()
            };
        } catch (error) {
            throw ServiceError.operation('Failed to calculate period stats', {
                period_id: period.id,
                error: error.message
            });
        }
    }
    
    // Calculate rankings for a period
    async calculateRankings(periodId) {
        try {
            // Get period
            const period = await prisma.referral_periods.findUnique({
                where: { id: periodId }
            });
            
            if (!period) {
                throw new Error(`Period with ID ${periodId} not found`);
            }
            
            // Get referrals grouped by referrer
            const referralCounts = await prisma.referrals.groupBy({
                by: ['referrer_id'],
                where: {
                    status: 'qualified',
                    qualified_at: {
                        gte: period.start_date,
                        lt: period.end_date
                    }
                },
                _count: {
                    referrer_id: true
                }
            });
            
            // Sort by count descending
            referralCounts.sort((a, b) => b._count.referrer_id - a._count.referrer_id);
            
            // Get previous rankings to calculate trends
            const previousRankings = await prisma.referral_period_rankings.findMany({
                where: { period_id: periodId }
            });
            
            const prevRankMap = new Map();
            previousRankings.forEach(ranking => {
                prevRankMap.set(ranking.user_id, ranking.rank);
            });
            
            // Create rankings with user info
            const rankings = await Promise.all(referralCounts.map(async (item, index) => {
                const user = await prisma.users.findUnique({
                    where: { wallet_address: item.referrer_id },
                    select: { username: true, nickname: true }
                });
                
                const prevRank = prevRankMap.get(item.referrer_id);
                let trend = 'stable';
                
                if (prevRank) {
                    if (index + 1 < prevRank) trend = 'up';
                    else if (index + 1 > prevRank) trend = 'down';
                }
                
                return {
                    user_id: item.referrer_id,
                    user: user || { username: 'Unknown' },
                    referral_count: item._count.referrer_id,
                    rank: index + 1,
                    trend
                };
            }));
            
            // Store the rankings in database
            await this.storeRankings(periodId, rankings);
            
            return rankings;
        } catch (error) {
            throw ServiceError.operation('Failed to calculate rankings', {
                period_id: periodId,
                error: error.message
            });
        }
    }
    
    // Store rankings in the database
    async storeRankings(periodId, rankings) {
        try {
            // First delete existing rankings for this period
            await prisma.referral_period_rankings.deleteMany({
                where: { period_id: periodId }
            });
            
            // Insert new rankings
            await Promise.all(rankings.map(async (ranking) => {
                await prisma.referral_period_rankings.create({
                    data: {
                        period_id: periodId,
                        user_id: ranking.user_id,
                        referral_count: ranking.referral_count,
                        rank: ranking.rank,
                        trend: ranking.trend
                    }
                });
            }));
            
            return true;
        } catch (error) {
            throw ServiceError.operation('Failed to store rankings', {
                period_id: periodId,
                error: error.message
            });
        }
    }

    // Start ranking updates
    async startRankingUpdates() {
        setInterval(async () => {
            try {
                await this.updateRankings();
            } catch (error) {
                logApi.error('Failed to update rankings:', error);
            }
        }, this.config.referral.rankingUpdateInterval);
    }

    // Update rankings
    async updateRankings() {
        try {
            const currentPeriod = await this.getCurrentPeriod();
            if (!currentPeriod) return;

            const rankings = await this.calculateRankings(currentPeriod.id);
            await this.storeRankings(currentPeriod.id, rankings);

            // Update cache
            this.rankingsCache.set(currentPeriod.id, {
                rankings,
                timestamp: Date.now()
            });

            this.referralStats.periods.rankings_updated++;

        } catch (error) {
            throw ServiceError.operation('Failed to update rankings', {
                error: error.message
            });
        }
    }

    // Get cached period stats
    async getCachedPeriodStats() {
        const currentPeriod = await this.getCurrentPeriod();
        if (!currentPeriod) return null;

        const cacheKey = `period_stats:${currentPeriod.id}`;
        const cached = this.periodStatsCache.get(cacheKey);

        if (cached && (Date.now() - cached.timestamp) < this.config.referral.cacheTimeout) {
            return cached.stats;
        }

        const stats = await this.calculatePeriodStats(currentPeriod);
        this.periodStatsCache.set(cacheKey, {
            stats,
            timestamp: Date.now()
        });

        return stats;
    }

    // Get cached rankings
    async getCachedRankings() {
        const currentPeriod = await this.getCurrentPeriod();
        if (!currentPeriod) return null;

        const cached = this.rankingsCache.get(currentPeriod.id);
        if (cached && (Date.now() - cached.timestamp) < this.config.referral.cacheTimeout) {
            return cached.rankings;
        }

        const rankings = await this.calculateRankings(currentPeriod.id);
        this.rankingsCache.set(currentPeriod.id, {
            rankings,
            timestamp: Date.now()
        });

        return rankings;
    }

    // Stop the service
    async stop() {
        try {
            await super.stop();
            
            // Clear all timeouts
            for (const timeout of this.processingTimeouts) {
                clearTimeout(timeout);
            }
            this.processingTimeouts.clear();
            
            // Clear active processing
            this.activeProcessing.clear();
            
            // Clear caches
            this.periodStatsCache.clear();
            this.rankingsCache.clear();
            
            // Final stats update
            await serviceManager.markServiceStopped(
                this.name,
                this.config,
                {
                    ...this.stats,
                    referralStats: this.referralStats
                }
            );
            
            logApi.info('Referral Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Referral Service:', error);
            throw error;
        }
    }

    // Implementation of trackClick method that was missing
    // This is called by the /api/referrals/analytics/click endpoint
    async trackClick(referralCode, clickData) {
        try {
            // Validate the referral code before proceeding
            const referrer = await prisma.users.findUnique({
                where: { referral_code: referralCode.toUpperCase() },
                select: { wallet_address: true }
            });

            if (!referrer) {
                throw new Error('Invalid referral code');
            }

            // Create a record of the click
            const click = await prisma.referral_clicks.create({
                data: {
                    referral_code: referralCode.toUpperCase(),
                    referrer_id: referrer.wallet_address,
                    source: clickData.source,
                    landing_page: clickData.landingPage,
                    utm_source: clickData.utmParams?.utm_source,
                    utm_medium: clickData.utmParams?.utm_medium,
                    utm_campaign: clickData.utmParams?.utm_campaign,
                    device: clickData.device,
                    browser: clickData.browser,
                    ip_address: clickData.ip_address,
                    user_agent: clickData.user_agent,
                    session_id: clickData.sessionId,
                    timestamp: new Date()
                }
            });

            // Update service stats
            this.referralStats.operations.total++;
            this.referralStats.operations.successful++;

            return {
                click_id: click.id,
                timestamp: click.timestamp,
                status: 'recorded'
            };
        } catch (error) {
            this.referralStats.operations.failed++;
            throw ServiceError.operation('Failed to track referral click', {
                referral_code: referralCode,
                error: error.message
            });
        }
    }
}

// Export service singleton
const referralService = new ReferralService();
export default referralService; 