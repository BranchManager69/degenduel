// /routes/referrals.js

/**
 * 
 * This file needs a lot of work.
 * 
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';
import { logApi } from '../utils/logger-suite/logger.js';
import { body } from 'express-validator';
import { validateRequest } from '../middleware/validateRequest.js';
import rateLimit from 'express-rate-limit';
import referralService from '../services/referralService.js';
import prisma from '../config/prisma.js';
import { referralClickLimit, referralConversionLimit } from '../middleware/rateLimit.js'; // why are these unused?

// Config
import config from '../config/config.js';

// Referrals router
const router = Router();


/* Helpers */

// Generate a random referral code
function generateReferralCode(length = 8) {
    return crypto.randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length)
        .toUpperCase();
}


/* Routes */

// Get or generate referral code for authenticated user
router.get('/code', requireAuth, async (req, res) => {
    try {
        const user = await prisma.users.findUnique({
            where: { wallet_address: req.user.wallet_address },
            select: { referral_code: true, username: true, nickname: true }
        });

        if (user.referral_code) {
            return res.json({ referral_code: user.referral_code });
        }

        // Generate base code from username or nickname
        let baseCode = '';
        if (user.username) {
            baseCode = user.username.slice(0, 15).toUpperCase();
        } else if (user.nickname) {
            baseCode = user.nickname.slice(0, 15).toUpperCase();
        }

        // If no username/nickname, generate random code
        if (!baseCode) {
            baseCode = generateReferralCode(8);
        }

        // Ensure uniqueness by appending random characters if needed
        let referralCode = baseCode;
        let isUnique = false;
        let attempts = 0;
        
        while (!isUnique) {
            const existing = await prisma.users.findUnique({
                where: { referral_code: referralCode }
            });
            
            if (!existing) {
                isUnique = true;
            } else {
                // If collision, append 4 random characters to the base code
                const suffix = generateReferralCode(4);
                // Trim baseCode if needed to keep total length reasonable
                referralCode = `${baseCode.slice(0, 15)}${suffix}`;
                attempts++;
                
                // If we've tried too many times, fall back to fully random code
                if (attempts >= 10) {
                    referralCode = generateReferralCode(16);
                }
            }
        }

        // Save the referral code
        await prisma.users.update({
            where: { wallet_address: req.user.wallet_address },
            data: { referral_code: referralCode }
        });

        res.json({ referral_code: referralCode });
    } catch (error) {
        console.error('Error in /referrals/code:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get referral statistics for authenticated user
router.get('/stats', requireAuth, async (req, res) => {
    try {
        const [referrals, rewards] = await Promise.all([
            prisma.referrals.findMany({
                where: { referrer_id: req.user.wallet_address },
                include: {
                    referred: {
                        select: {
                            username: true,
                            created_at: true
                        }
                    }
                },
                orderBy: { created_at: 'desc' }
            }),
            prisma.referral_rewards.findMany({
                where: { wallet_address: req.user.wallet_address },
                orderBy: { created_at: 'desc' }
            })
        ]);

        const stats = {
            total_referrals: referrals.length,
            qualified_referrals: referrals.filter(r => r.status === 'qualified').length,
            pending_referrals: referrals.filter(r => r.status === 'pending').length,
            total_rewards: rewards.reduce((sum, r) => sum + Number(r.amount), 0),
            recent_referrals: referrals.slice(0, 5).map(r => ({
                username: r.referred.username,
                status: r.status,
                joined_at: r.created_at
            })),
            recent_rewards: rewards.slice(0, 5).map(r => ({
                type: r.reward_type,
                amount: r.amount,
                date: r.created_at,
                description: r.description
            }))
        };

        res.json(stats);
    } catch (error) {
        console.error('Error in /referrals/stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Apply referral code (for new users during registration)
router.post('/apply', async (req, res) => {
    const { referral_code, wallet_address } = req.body;

    if (!referral_code || !wallet_address) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Find referrer
        const referrer = await prisma.users.findUnique({
            where: { referral_code: referral_code.toUpperCase() },
            select: {
                wallet_address: true,
                is_banned: true
            }
        });

        if (!referrer) {
            return res.status(404).json({ error: 'Invalid referral code' });
        }

        if (referrer.is_banned) {
            return res.status(400).json({ error: 'This referral code is no longer valid' });
        }

        if (referrer.wallet_address === wallet_address) {
            return res.status(400).json({ error: 'You cannot refer yourself' });
        }

        // Check if user already has a referral
        const existingReferral = await prisma.referrals.findFirst({
            where: { referred_id: wallet_address }
        });

        if (existingReferral) {
            return res.status(400).json({ error: 'User already has a referral' });
        }

        // Create referral record in a transaction to ensure consistency
        await prisma.$transaction(async (tx) => {
            await tx.users.update({
                where: { wallet_address },
                data: {
                    referred_by_code: referral_code.toUpperCase()
                }
            });

            await tx.referrals.create({
                data: {
                    referrer_id: referrer.wallet_address,
                    referred_id: wallet_address,
                    referral_code: referral_code.toUpperCase(),
                    status: 'pending'
                }
            });
        });

        res.json({ 
            success: true, 
            message: 'Referral code applied successfully',
            referrer_wallet: referrer.wallet_address
        });
    } catch (error) {
        console.error('Error in /referrals/apply:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Click rate limiting setup as per documentation
const clickLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // 100 requests per IP
});

// Conversion rate limiting setup as per documentation
const conversionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10 // 10 attempts per IP
});

// Track referral click
/* 
 * ================================================================
 * TEMPORARILY DISABLED - 2025-03-25
 * 
 * This endpoint was causing excessive log spam when misused by
 * client-side navigation to non-referral paths. We're replacing it
 * with a no-op implementation until the referral system is properly
 * implemented and needed.
 *
 * Original implementation is commented out below.
 * ================================================================
 */
router.post('/analytics/click', (req, res) => {
    // Return a successful empty response without any processing
    // This effectively disables the endpoint without breaking the API contract
    res.json({
        success: true,
        data: {
            status: 'noop',
            message: 'Referral tracking temporarily disabled'
        }
    });
});

/* Original implementation kept for reference
router.post('/analytics/click',
    clickLimiter,
    // First middleware: check if this is likely a misrouted request 
    (req, res, next) => {
        // Quick check if this is likely a navigation request, not a proper API call
        // Proper API calls should have a JSON content type and a body with required fields
        if (!req.is('application/json') || !req.body || !req.body.referralCode) {
            // This is likely a misrouted page navigation - reject silently without logging
            return res.status(400).json({
                success: false,
                error: 'Invalid request format'
            });
        }
        next();
    },
    [
        body('referralCode').isString().trim().notEmpty(),
        body('source').isString().trim().optional(),
        body('landingPage').isString().trim().optional(),
        body('utmParams').isObject().optional(),
        body('device').isString().trim().optional(),
        body('browser').isString().trim().optional(),
        body('sessionId').isString().trim().notEmpty()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await referralService.trackClick(
                req.body.referralCode,
                {
                    ...req.body,
                    ip_address: req.ip,
                    user_agent: req.get('user-agent')
                }
            );

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            // Don't log invalid referral codes - these are expected
            if (error.message !== 'Invalid referral code') {
                logApi.error('Failed to track referral click:', error);
            }
            
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    }
*/

// Track conversion
/* 
 * ================================================================
 * TEMPORARILY DISABLED - 2025-03-25
 * 
 * This endpoint is part of the referral tracking system that's
 * causing issues. Disabling until the system is needed.
 *
 * Original implementation is commented out below.
 * ================================================================
 */
router.post('/analytics/conversion', requireAuth, (req, res) => {
    // Return a successful empty response
    res.json({
        success: true,
        data: {
            status: 'noop',
            message: 'Referral conversion tracking temporarily disabled'
        }
    });
});

/* Original implementation kept for reference
router.post('/analytics/conversion',
    requireAuth,
    conversionLimiter,
    [
        body('referralCode').isString().trim().notEmpty(),
        body('sessionId').isString().trim().notEmpty()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await referralService.processConversion(
                req.body.sessionId,
                {
                    wallet_address: req.user.wallet_address,
                    ...req.body
                }
            );

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            logApi.error('Failed to process conversion:', error);
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    }
*/

// Get analytics (requires authentication)
/* 
 * ================================================================
 * TEMPORARILY DISABLED - 2025-03-25
 * 
 * This endpoint is part of the referral analytics system that's
 * currently disabled. Providing a mock response.
 *
 * Original implementation is commented out below.
 * ================================================================
 */
router.get('/analytics', requireAuth, (req, res) => {
    // Return mock analytics data
    res.json({
        clicks: {
            total: 0,
            conversion_rate: 0,
            by_source: {},
            by_campaign: {},
            by_date: {}
        },
        conversions: {
            total: 0,
            by_date: {}
        },
        status: 'disabled',
        message: 'Referral analytics temporarily disabled'
    });
});

/* Original implementation kept for reference
router.get('/analytics',
    requireAuth,
    async (req, res) => {
        try {
            // Extract filter parameters from query
            const filters = {
                ...(req.query.startDate && {
                    timestamp: {
                        gte: new Date(req.query.startDate)
                    }
                }),
                ...(req.query.endDate && {
                    timestamp: {
                        lte: new Date(req.query.endDate)
                    }
                }),
                ...(req.query.source && { source: req.query.source }),
                ...(req.query.campaign && { utm_campaign: req.query.campaign })
            };

            const analytics = await referralService.getAnalytics(filters);

            res.json(analytics);
        } catch (error) {
            logApi.error('Failed to get analytics:', error);
            res.status(500).json({
                error: error.message
            });
        }
    }
*/

// Get referrals leaderboard statistics
/* 
 * ================================================================
 * TEMPORARILY DISABLED - 2025-03-25
 * 
 * This endpoint is part of the referral leaderboard system that's
 * currently disabled. Providing a mock response.
 *
 * Original implementation is commented out below.
 * ================================================================
 */
router.get('/leaderboard/stats', (req, res) => {
    // Return mock leaderboard stats
    res.json({
        success: true,
        data: {
            period_id: 1,
            start_date: new Date(),
            end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
            total_referrals: 0,
            qualified_referrals: 0,
            unique_referrers: 0,
            conversion_rate: 0,
            status: 'disabled',
            message: 'Referral leaderboard temporarily disabled'
        }
    });
});

/* Original implementation kept for reference
router.get('/leaderboard/stats',
    async (req, res) => {
        try {
            const stats = await referralService.getCachedPeriodStats();
            
            if (!stats) {
                return res.status(404).json({
                    success: false,
                    error: 'No active referral period found'
                });
            }

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            logApi.error('Failed to get leaderboard stats:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get leaderboard statistics'
            });
        }
    }
);
*/

// Get referrals leaderboard rankings
/* 
 * ================================================================
 * TEMPORARILY DISABLED - 2025-03-25
 * 
 * This endpoint is part of the referral rankings system that's
 * currently disabled. Providing a mock response.
 *
 * Original implementation is commented out below.
 * ================================================================
 */
router.get('/leaderboard/rankings', (req, res) => {
    // Return empty rankings
    res.json({
        success: true,
        data: [] // Empty rankings array
    });
});

/* Original implementation kept for reference
router.get('/leaderboard/rankings',
    async (req, res) => {
        try {
            const rankings = await referralService.getCachedRankings();
            
            res.json({
                success: true,
                data: rankings.map(r => ({
                    username: r.user.username,
                    referrals: r.referral_count,
                    rank: r.rank,
                    trend: r.trend || 'stable'
                }))
            });
        } catch (error) {
            logApi.error('Failed to get leaderboard rankings:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get leaderboard rankings'
            });
        }
    }
);
*/

// Get user milestones
/**
 * @api {get} /api/referrals/milestones Get user milestones
 * @apiName GetUserMilestones
 * @apiGroup Referrals
 * @apiDescription Get all milestones for the authenticated user
 * 
 */
/* 
 * ================================================================
 * TEMPORARILY DISABLED - 2025-03-25
 * 
 * This endpoint is part of the referral system that's currently disabled.
 * Providing a mock response with empty milestones.
 *
 * Original implementation is commented out below.
 * ================================================================
 */
router.get('/milestones', requireAuth, (req, res) => {
    // Return empty milestones array
    res.json({
        success: true,
        data: [] // Empty milestones array
    });
});

/* Original implementation kept for reference
router.get('/milestones',
    requireAuth,
    async (req, res) => {
        try {
            const milestones = await prisma.referral_milestones.findMany({
                where: { user_id: req.user.wallet_address },
                orderBy: { milestone_level: 'asc' }
            });

            res.json({
                success: true,
                data: milestones
            });
        } catch (error) {
            logApi.error('Failed to get user milestones:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get milestone information'
            });
        }
    }
);
*/

// Get user period rankings
/**
 * @api {get} /api/referrals/rankings/me Get user period rankings
 * @apiName GetUserPeriodRankings
 * @apiGroup Referrals
 * @apiDescription Get the current period rankings for the authenticated user
 * 
 */
/* 
 * ================================================================
 * TEMPORARILY DISABLED - 2025-03-25
 * 
 * This endpoint is part of the referral ranking system that's
 * currently disabled. Providing a mock response.
 *
 * Original implementation is commented out below.
 * ================================================================
 */
router.get('/rankings/me', requireAuth, (req, res) => {
    // Return mock ranking data
    res.json({
        success: true,
        data: {
            referral_count: 0,
            rank: null,
            trend: 'stable',
            message: 'Referral system temporarily disabled'
        }
    });
});

/* Original implementation kept for reference
router.get('/rankings/me',
    requireAuth,
    async (req, res) => {
        try {
            const currentPeriod = await referralService.getCurrentPeriod();
            if (!currentPeriod) {
                return res.status(404).json({
                    success: false,
                    error: 'No active referral period found'
                });
            }

            const ranking = await prisma.referral_period_rankings.findFirst({
                where: {
                    period_id: currentPeriod.id,
                    user_id: req.user.wallet_address
                }
            });

            res.json({
                success: true,
                data: ranking || {
                    referral_count: 0,
                    rank: null,
                    trend: 'stable'
                }
            });
        } catch (error) {
            logApi.error('Failed to get user ranking:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get ranking information'
            });
        }
    }
);
*/

export default router; 