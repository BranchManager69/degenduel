import express from 'express';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: API endpoints for user management
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users with optional filters
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [rank_score, total_earnings, total_contests]
 *     responses:
 *       200:
 *         description: List of users
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 10, offset = 0, sort } = req.query;
    
    const orderBy = sort ? {
      [sort]: 'desc'
    } : {
      created_at: 'desc'
    };

    const [users, total] = await Promise.all([
      prisma.users.findMany({
        take: parseInt(limit),
        skip: parseInt(offset),
        orderBy,
        select: {
          wallet_address: true,
          nickname: true,
          total_contests: true,
          total_wins: true,
          total_earnings: true,
          rank_score: true,
          created_at: true,
          last_login: true,
          _count: {
            select: {
              contest_participants: true
            }
          }
        }
      }),
      prisma.users.count()
    ]);

    res.json({
      users,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logger.error('Failed to fetch users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * @swagger
 * /api/users/{wallet}:
 *   get:
 *     summary: Get user profile by wallet address
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User profile data
 *       404:
 *         description: User not found
 */
router.get('/:wallet', async (req, res) => {
  try {
    const user = await prisma.users.findUnique({
      where: { wallet_address: req.params.wallet },
      include: {
        contest_participants: {
          take: 5,
          orderBy: { joined_at: 'desc' },
          include: {
            contests: true
          }
        },
        user_stats: true,
        user_social_profiles: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    logger.error('Failed to fetch user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create new user
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet_address
 *             properties:
 *               wallet_address:
 *                 type: string
 *                 example: "0x1234..."
 *               nickname:
 *                 type: string
 *                 example: "CryptoTrader123"
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/User'
 *                 - type: object
 *                   properties:
 *                     user_stats:
 *                       $ref: '#/components/schemas/UserStats'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Wallet address already exists"
 */
router.post('/', async (req, res) => {
  try {
    const { wallet_address, nickname } = req.body;

    const user = await prisma.users.create({
      data: {
        wallet_address,
        nickname,
        user_stats: {
          create: {} // Creates default stats
        }
      },
      include: {
        user_stats: true
      }
    });

    res.status(201).json(user);
  } catch (error) {
    logger.error('Failed to create user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * @swagger
 * /api/users/{wallet}:
 *   put:
 *     summary: Update user profile
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nickname:
 *                 type: string
 *               settings:
 *                 type: object
 *                 example: { "notifications": true, "theme": "dark" }
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         $ref: '#/components/responses/UserNotFound'
 */
router.put('/:wallet', async (req, res) => {
  try {
    const { nickname, settings } = req.body;

    const user = await prisma.users.update({
      where: { wallet_address: req.params.wallet },
      data: {
        nickname,
        settings: settings ? { ...settings } : undefined,
        updated_at: new Date()
      }
    });

    res.json(user);
  } catch (error) {
    logger.error('Failed to update user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * @swagger
 * /api/users/{wallet}/achievements:
 *   get:
 *     summary: Get user achievements
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     responses:
 *       200:
 *         description: User achievements
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/UserAchievement'
 *       404:
 *         $ref: '#/components/responses/UserNotFound'
 */
router.get('/:wallet/achievements', async (req, res) => {
  try {
    const achievements = await prisma.user_achievements.findMany({
      where: { wallet_address: req.params.wallet },
      orderBy: { achieved_at: 'desc' }
    });

    res.json(achievements);
  } catch (error) {
    logger.error('Failed to fetch achievements:', error);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

/**
 * @swagger
 * /api/users/{wallet}/stats:
 *   get:
 *     summary: Get detailed user statistics
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     responses:
 *       200:
 *         description: User statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 general:
 *                   $ref: '#/components/schemas/UserStats'
 *                 tokens:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       token_address:
 *                         type: string
 *                       times_picked:
 *                         type: integer
 *                       wins_with_token:
 *                         type: integer
 *                       avg_score_with_token:
 *                         type: string
 *                       tokens:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           name:
 *                             type: string
 *       404:
 *         $ref: '#/components/responses/UserNotFound'
 */
router.get('/:wallet/stats', async (req, res) => {
  try {
    const [stats, tokenStats] = await Promise.all([
      prisma.user_stats.findUnique({
        where: { wallet_address: req.params.wallet }
      }),
      prisma.user_token_stats.findMany({
        where: { wallet_address: req.params.wallet },
        include: {
          tokens: true
        }
      })
    ]);

    res.json({
      general: stats,
      tokens: tokenStats
    });
  } catch (error) {
    logger.error('Failed to fetch user stats:', error);
    res.status(500).json({ error: 'Failed to fetch user stats' });
  }
});

export default router;
