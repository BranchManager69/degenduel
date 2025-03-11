// /routes/referrals.js

import express, { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';
import { logApi } from '../utils/logger-suite/logger.js';
import { referralClickLimit, referralConversionLimit } from '../middleware/rateLimit.js';
import { body } from 'express-validator';
import { validateRequest } from '../middleware/validateRequest.js';
import rateLimit from 'express-rate-limit';
import referralService from '../services/referralService.js';
import prisma from '../config/prisma.js';

const router = Router();

// Generate a random referral code
function generateReferralCode(length = 8) {
    return crypto.randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length)
        .toUpperCase();
}

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

// Rate limiting setup as per documentation
const clickLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // 100 requests per IP
});

const conversionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10 // 10 attempts per IP
});

// Track referral click
router.post('/analytics/click',
    clickLimiter,
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
            logApi.error('Failed to track referral click:', error);
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    }
);

// Track conversion
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
);

// Get analytics (requires authentication)
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
);

// Get leaderboard statistics
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

// Get leaderboard rankings
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

/**
 * @api {get} /api/referrals/details Get referrer details from referral code
 * @apiName GetReferrerDetails
 * @apiGroup Referrals
 * @apiDescription Get detailed information about a referrer based on their referral code
 * 
 * @apiParam {String} code Referral code
 * 
 * @apiSuccess {Boolean} success Indicates if the operation was successful
 * @apiSuccess {Object} referrer Referrer information
 * @apiSuccess {String} referrer.nickname Referrer's nickname
 * @apiSuccess {String} referrer.wallet_address Referrer's wallet address
 * @apiSuccess {Object} referrer.profile_image Profile image info
 * @apiSuccess {String} referrer.profile_image.url Full profile image URL
 * @apiSuccess {String} referrer.profile_image.thumbnail_url Thumbnail profile image URL
 * @apiSuccess {Object} rewards Information about referral rewards
 */
router.get('/details',
    async (req, res) => {
        try {
            const { code } = req.query;
            
            logApi.info(`Referrer details requested for code: ${code}`, {
                ip: req.ip,
                user_agent: req.get('user-agent')
            });
            
            if (!code) {
                logApi.warn('Referrer details request missing code parameter');
                return res.status(400).json({
                    success: false,
                    error: 'Referral code is required'
                });
            }
            
            // Find the user with this referral code
            const referrer = await prisma.users.findUnique({
                where: { referral_code: code.toUpperCase() },
                select: {
                    wallet_address: true,
                    username: true,
                    nickname: true,
                    profile_image_url: true,
                    profile_image_updated_at: true,
                    is_banned: true
                }
            });
            
            if (!referrer) {
                logApi.info(`Referrer details request for invalid code: ${code}`);
                return res.status(404).json({
                    success: false,
                    error: 'Invalid referral code'
                });
            }
            
            if (referrer.is_banned) {
                return res.status(403).json({
                    success: false,
                    error: 'This referral code is no longer valid'
                });
            }
            
            // Get referral rewards info from database or config
            // This is placeholder implementation - adjust according to your actual rewards system
            const referralRewards = {
                user_bonus: "Increased XP for first week",
                referrer_bonus: "250 XP and milestone rewards"
            };
            
            // Build profile image URLs
            const profileImageInfo = referrer.profile_image_url ? {
                url: referrer.profile_image_url,
                thumbnail_url: referrer.profile_image_url,
                updated_at: referrer.profile_image_updated_at
            } : null;
            
            logApi.info(`Referrer details successfully retrieved for code: ${code}`, {
                referrer_wallet: referrer.wallet_address
            });
            
            res.json({
                success: true,
                referrer: {
                    nickname: referrer.nickname || referrer.username,
                    wallet_address: referrer.wallet_address,
                    profile_image: profileImageInfo
                },
                rewards: referralRewards
            });
        } catch (error) {
            logApi.error('Failed to get referrer details:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve referrer information'
            });
        }
    }
);

// Get user milestones
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

// Get user period rankings
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

export default router; 