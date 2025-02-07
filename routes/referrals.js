// /routes/referrals.js

import express from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';

const router = express.Router();
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
            select: { referral_code: true, username: true }
        });

        if (user.referral_code) {
            return res.json({ referral_code: user.referral_code });
        }

        // Generate code based on username or random string
        let referralCode = user.username ? 
            user.username.slice(0, 16).toUpperCase() : // Use username if available
            generateReferralCode(8); // Otherwise generate random code

        // Ensure uniqueness
        let isUnique = false;
        while (!isUnique) {
            const existing = await prisma.users.findUnique({
                where: { referral_code: referralCode }
            });
            if (!existing) {
                isUnique = true;
            } else {
                referralCode = generateReferralCode(8);
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
            where: { referral_code: referral_code }
        });

        if (!referrer) {
            return res.status(404).json({ error: 'Invalid referral code' });
        }

        // Check if user already has a referral
        const existingReferral = await prisma.referrals.findFirst({
            where: { referred_id: wallet_address }
        });

        if (existingReferral) {
            return res.status(400).json({ error: 'User already has a referral' });
        }

        // Create referral record
        await prisma.users.update({
            where: { wallet_address },
            data: {
                referred_by_code: referral_code
            }
        });

        await prisma.referrals.create({
            data: {
                referrer_id: referrer.wallet_address,
                referred_id: wallet_address,
                referral_code,
                status: 'pending'
            }
        });

        res.json({ success: true, message: 'Referral code applied successfully' });
    } catch (error) {
        console.error('Error in /referrals/apply:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router; 