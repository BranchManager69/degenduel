// /admin/analytics-dashboard

import express from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import prisma from '../../config/prisma.js';
import { logApi } from '../../utils/logger-suite/logger.js';

const router = express.Router();
const analyticsLogger = logApi.forService('ANALYTICS');

// Get real-time user activity
router.get('/realtime', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        // Get active sessions in last 15 minutes
        const activeSessions = await prisma.system_settings.findMany({
            where: {
                key: 'user_session',
                updated_at: {
                    gte: new Date(Date.now() - 15 * 60 * 1000)
                }
            }
        });

        // Transform sessions into user activity
        const activeUsers = activeSessions.map(session => {
            const data = JSON.parse(session.value);
            return {
                wallet: data.user.wallet_address,
                nickname: data.user.nickname,
                current_page: data.last_page,
                last_action: data.last_action,
                last_active: data.last_active,
                session_duration: Date.now() - new Date(data.session_start).getTime(),
                device: data.client.device_type,
                location: data.geo?.country,
                interests: data.user_interests || [],
                portfolio_value: data.portfolio_stats?.total_value,
                favorite_tokens: data.portfolio_stats?.most_traded,
                risk_score: calculateRiskScore(data),
                trading_style: analyzeTradingStyle(data)
            };
        });

        // Get behavioral patterns
        const userPatterns = await analyzeUserPatterns(activeUsers.map(u => u.wallet));

        // Combine everything into rich analytics
        const enrichedAnalytics = {
            active_users: activeUsers,
            total_active: activeUsers.length,
            user_segments: segmentUsers(activeUsers),
            behavioral_patterns: userPatterns,
            geographic_distribution: aggregateGeography(activeUsers),
            device_breakdown: aggregateDevices(activeUsers),
            trading_insights: {
                popular_pairs: await getPopularTradingPairs(),
                volume_trends: await getVolumeTrends(),
                risk_distribution: calculateRiskDistribution(activeUsers)
            },
            user_interests: aggregateInterests(activeUsers),
            engagement_metrics: await getEngagementMetrics(),
            retention_data: await getRetentionData()
        };

        res.json(enrichedAnalytics);
    } catch (error) {
        analyticsLogger.error('Failed to get analytics', { error });
        res.status(500).json({ error: 'Failed to get analytics' });
    }
});

// Get user journey/behavior analysis
router.get('/user/:wallet/journey', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { wallet } = req.params;
        
        // Get all user interactions in chronological order
        const interactions = await prisma.websocket_messages.findMany({
            where: { 
                wallet_address: wallet,
                timestamp: {
                    gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
                }
            },
            orderBy: { timestamp: 'asc' }
        });

        // Analyze the journey
        const journey = {
            interaction_timeline: interactions.map(parseInteraction),
            common_patterns: findBehaviorPatterns(interactions),
            interests: await inferUserInterests(wallet),
            trading_preferences: await analyzeTradingPreferences(wallet),
            risk_profile: await calculateDetailedRiskProfile(wallet),
            social_connections: await mapSocialConnections(wallet),
            feature_usage: await getFeatureUsageStats(wallet),
            session_analytics: await getDetailedSessionAnalytics(wallet)
        };

        res.json(journey);
    } catch (error) {
        analyticsLogger.error('Failed to get user journey', { error });
        res.status(500).json({ error: 'Failed to get user journey' });
    }
});

// Helper functions for rich analytics
const calculateRiskScore = (userData) => {
    // Complex risk scoring based on:
    // - Portfolio composition
    // - Trading frequency
    // - Position sizes
    // - Win/loss ratio
    // Returns 1-100 score
};

const analyzeTradingStyle = (userData) => {
    // Analyze trading patterns to categorize user:
    // - Day trader
    // - Swing trader
    // - Position trader
    // - Scalper
    // Based on holding times, trade frequency, etc.
};

const analyzeUserPatterns = async (wallets) => {
    // Find common behavior patterns:
    // - Time of day activity
    // - Regular trading intervals
    // - Preferred token types
    // - Response to market conditions
};

const segmentUsers = (users) => {
    return {
        by_activity: {
            power_users: users.filter(u => u.session_duration > 2 * 60 * 60 * 1000),
            regular: users.filter(u => u.session_duration > 30 * 60 * 1000),
            casual: users.filter(u => u.session_duration <= 30 * 60 * 1000)
        },
        by_portfolio: {
            whale: users.filter(u => u.portfolio_value > 100000),
            dolphin: users.filter(u => u.portfolio_value > 10000),
            fish: users.filter(u => u.portfolio_value <= 10000)
        },
        by_style: {
            aggressive: users.filter(u => u.risk_score > 75),
            moderate: users.filter(u => u.risk_score > 25 && u.risk_score <= 75),
            conservative: users.filter(u => u.risk_score <= 25)
        }
    };
};

const inferUserInterests = async (wallet) => {
    // Analyze:
    // - Tokens they trade
    // - Time spent on different pages
    // - Click patterns
    // - Search history
    // - Social interactions
    // Returns interest categories with confidence scores
};

const getEngagementMetrics = async () => {
    // Calculate:
    // - Average session duration
    // - Pages per session
    // - Bounce rate
    // - Feature adoption rate
    // - Social interaction rate
};

const getRetentionData = async () => {
    // Analyze:
    // - Daily/weekly active users
    // - Cohort retention
    // - Churn prediction
    // - Reactivation rates
};

const mapSocialConnections = async (wallet) => {
    // Map user's network:
    // - Direct connections
    // - Influence score
    // - Community participation
    // - Contest interactions
};

export default router; 