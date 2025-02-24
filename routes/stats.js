// /routes/stats.js

import express from 'express';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
//import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Statistics
 *   description: API endpoints for user statistics and achievements
 */

/* Stats Routes */

/**
 * @swagger
 * /api/stats/{wallet}:
 *   get:
 *     summary: Get user's overall statistics
 *     tags: [Statistics]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     responses:
 *       200:
 *         description: User's statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet_address:
 *                   type: string
 *                 nickname:
 *                   type: string
 *                 total_contests:
 *                   type: integer
 *                   description: Total number of contests participated in
 *                 total_wins:
 *                   type: integer
 *                   description: Total number of contests won
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
// Get user's overall statistics (NO AUTH REQUIRED)
//      example: GET https://degenduel.me/api/stats/{wallet}
//      headers: { "Cookie": "session=<jwt>" }
router.get('/:wallet', async (req, res) => {
    try {
        // Get user and their contest participation stats
        const user = await prisma.users.findUnique({
            where: {
                wallet_address: req.params.wallet
            },
            include: {
                contest_participants: {
                    select: {
                        contest_id: true,
                        rank: true
                    }
                }
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Calculate stats
        const total_contests = user.contest_participants.length;
        const total_wins = user.contest_participants.filter(p => p.rank === 1).length;

        // Format response
        const response = {
            ...user,
            total_contests,
            total_wins,
            contest_participants: undefined // Remove the raw data
        };

        res.json(response);
    } catch (error) {
        logApi.error('Get stats failed:', error);
        res.status(500).json({ error: error.message });
    }
});
  
/**
 * @swagger
 * /api/stats/{wallet}/history:
 *   get:
 *     summary: Get user's trading history
 *     tags: [Statistics]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of records to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of records to skip
 *     responses:
 *       200:
 *         description: User's contest history
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   contest_id:
 *                     type: string
 *                   contest_name:
 *                     type: string
 *                   start_time:
 *                     type: string
 *                     format: date-time
 *                   end_time:
 *                     type: string
 *                     format: date-time
 *                   initial_balance:
 *                     type: number
 *                   current_balance:
 *                     type: number
 *                   rank:
 *                     type: integer
 *       500:
 *         description: Server error
 */
// Get user's contest history (NO AUTH REQUIRED)
//      example: GET https://degenduel.me/api/stats/{wallet}/history
//      headers: { "Cookie": "session=<jwt>" }
router.get('/:wallet/history', async (req, res) => {
    try {
        const history = await prisma.contest_participants.findMany({
            where: {
                wallet_address: req.params.wallet
            },
            include: {
                contest: true
            },
            orderBy: {
                contest: {
                    end_time: 'desc'
                }
            },
            take: parseInt(req.query.limit) || 10,
            skip: parseInt(req.query.offset) || 0
        });

        // Format response
        const response = history.map(entry => ({
            contest_id: entry.contest_id,
            contest_name: entry.contest.name,
            start_time: entry.contest.start_time,
            end_time: entry.contest.end_time,
            initial_balance: entry.initial_balance,
            current_balance: entry.current_balance,
            rank: entry.rank
        }));

        res.json(response);
    } catch (error) {
        logApi.error('Get history failed:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/stats/{wallet}/achievements:
 *   get:
 *     summary: Get user's achievements
 *     tags: [Statistics]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     responses:
 *       200:
 *         description: User's achievements
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   achievement:
 *                     type: string
 *                     enum: [first_contest, three_contests, five_contests]
 *                   achieved_at:
 *                     type: string
 *                     format: date-time
 *                   display_name:
 *                     type: string
 *                     description: Human-readable achievement name
 *                     example: "First Contest Entry"
 *       500:
 *         description: Server error
 */
// Get user's achievements (NO AUTH REQUIRED)
//      example: GET https://degenduel.me/api/stats/{wallet}/achievements
//      headers: { "Cookie": "session=<jwt>" }
router.get('/:wallet/achievements', async (req, res) => {
    try {
        // Get user achievements from the database
        const userAchievements = await prisma.user_achievements.findMany({
            where: {
                wallet_address: req.params.wallet
            },
            include: {
                achievement_categories: true,
                achievement_tiers: true
            },
            orderBy: {
                achieved_at: 'desc'
            }
        });

        // Format the response
        const achievements = userAchievements.map(achievement => ({
            id: achievement.id,
            achievement_type: achievement.achievement_type,
            category: achievement.category,
            tier: achievement.tier,
            display_name: achievement.achievement_categories?.name || achievement.achievement_type,
            tier_name: achievement.achievement_tiers?.name || achievement.tier,
            achieved_at: achievement.achieved_at,
            xp_awarded: achievement.xp_awarded,
            value: achievement.value
        }));

        // Still include legacy achievements for backward compatibility
        // Get all contest participations for the user
        const participations = await prisma.contest_participants.findMany({
            where: {
                wallet_address: req.params.wallet
            },
            orderBy: {
                joined_at: 'asc'
            },
            select: {
                joined_at: true
            }
        });

        const legacyAchievements = [];
        if (participations.length > 0) {
            // First contest achievement
            legacyAchievements.push({
                achievement: 'first_contest',
                achieved_at: participations[0].joined_at,
                display_name: 'First Contest Entry',
                legacy: true
            });

            // Multiple contests achievements
            if (participations.length >= 3) {
                legacyAchievements.push({
                    achievement: 'three_contests',
                    achieved_at: participations[2].joined_at,
                    display_name: 'Participated in 3 Contests',
                    legacy: true
                });
            }

            if (participations.length >= 5) {
                legacyAchievements.push({
                    achievement: 'five_contests',
                    achieved_at: participations[4].joined_at,
                    display_name: 'Participated in 5 Contests',
                    legacy: true
                });
            }
        }

        // Combine both achievement types
        res.json([...achievements, ...legacyAchievements]);
    } catch (error) {
        logApi.error('Get achievements failed:', error);
        logApi.error(error.stack);
        res.status(500).json({ error: error.message });
    }
});

export default router;