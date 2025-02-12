// /routes/referrals.js

import express, { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';
import { logApi } from '../utils/logger-suite/logger.js';
import { referralClickLimit, referralConversionLimit } from '../middleware/rateLimit.js';

const router = Router();
const prisma = new PrismaClient();

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

// Track initial referral click
router.post('/analytics/click', referralClickLimit, async (req, res) => {
    const {
        referralCode,
        source,
        landingPage,
        utmParams,
        device,
        browser,
        sessionId
    } = req.body;

    try {
        // Get IP and user agent
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        // Find referrer
        const referrer = await prisma.users.findUnique({
            where: { referral_code: referralCode.toUpperCase() },
            select: { wallet_address: true, is_banned: true }
        });

        if (!referrer || referrer.is_banned) {
            return res.status(404).json({ error: 'Invalid referral code' });
        }

        // Create click record
        const click = await prisma.referral_clicks.create({
            data: {
                referral_code: referralCode.toUpperCase(),
                referrer_id: referrer.wallet_address,
                source,
                landing_page: landingPage,
                utm_source: utmParams?.source,
                utm_medium: utmParams?.medium,
                utm_campaign: utmParams?.campaign,
                device,
                browser,
                ip_address: ip,
                user_agent: userAgent,
                session_id: sessionId
            }
        });

        logApi.info('Referral click tracked', {
            referralCode: referralCode.toUpperCase(),
            clickId: click.id,
            source,
            device
        });

        res.json({ success: true, clickId: click.id });
    } catch (error) {
        logApi.error('Error tracking referral click:', {
            error: error instanceof Error ? error.message : error,
            referralCode,
            source
        });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Track referral conversion
router.post('/analytics/conversion', referralConversionLimit, requireAuth, async (req, res) => {
    const { referralCode, sessionId } = req.body;
    const walletAddress = req.user.wallet_address;

    try {
        // Start a transaction
        await prisma.$transaction(async (tx) => {
            // Update click record
            await tx.referral_clicks.updateMany({
                where: { 
                    referral_code: referralCode.toUpperCase(),
                    session_id: sessionId,
                    converted: false
                },
                data: {
                    converted: true,
                    converted_at: new Date()
                }
            });

            // Get click data
            const click = await tx.referral_clicks.findFirst({
                where: { 
                    referral_code: referralCode.toUpperCase(),
                    session_id: sessionId
                }
            });

            if (click) {
                // Update referral with analytics data
                await tx.referrals.updateMany({
                    where: {
                        referral_code: referralCode.toUpperCase(),
                        referred_id: walletAddress
                    },
                    data: {
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

                logApi.info('Referral conversion tracked', {
                    referralCode: referralCode.toUpperCase(),
                    clickId: click.id,
                    walletAddress
                });
            }
        });

        res.json({ success: true });
    } catch (error) {
        logApi.error('Error tracking referral conversion:', {
            error: error instanceof Error ? error.message : error,
            referralCode,
            walletAddress
        });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Enhanced stats endpoint for referrers
router.get('/analytics', requireAuth, async (req, res) => {
    try {
        const [clicks, conversions, rewards] = await Promise.all([
            // Get click analytics
            prisma.referral_clicks.groupBy({
                by: ['source', 'device', 'browser'],
                where: { 
                    referrer_id: req.user.wallet_address,
                    timestamp: {
                        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
                    }
                },
                _count: true
            }),

            // Get conversion data
            prisma.referral_clicks.groupBy({
                by: ['source'],
                where: { 
                    referrer_id: req.user.wallet_address,
                    converted: true
                },
                _count: true
            }),

            // Get reward data
            prisma.referral_rewards.groupBy({
                by: ['reward_type'],
                where: { wallet_address: req.user.wallet_address },
                _sum: { amount: true }
            })
        ]);

        const response = {
            clicks: {
                by_source: clicks.reduce((acc, c) => ({ 
                    ...acc, 
                    [c.source]: c._count 
                }), {}),
                by_device: clicks.reduce((acc, c) => ({
                    ...acc,
                    [c.device]: c._count
                }), {}),
                by_browser: clicks.reduce((acc, c) => ({
                    ...acc,
                    [c.browser]: c._count
                }), {})
            },
            conversions: {
                by_source: conversions.reduce((acc, c) => ({
                    ...acc,
                    [c.source]: c._count
                }), {})
            },
            rewards: {
                by_type: rewards.reduce((acc, r) => ({
                    ...acc,
                    [r.reward_type]: r._sum.amount
                }), {})
            }
        };

        logApi.info('Referral analytics retrieved', {
            wallet: req.user.wallet_address,
            totalClicks: clicks.length,
            totalConversions: conversions.length
        });

        res.json(response);
    } catch (error) {
        logApi.error('Error getting referral analytics:', {
            error: error instanceof Error ? error.message : error,
            wallet: req.user.wallet_address
        });
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router; 