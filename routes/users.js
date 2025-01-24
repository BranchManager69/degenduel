import { PrismaClient } from '@prisma/client';
import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';

const router = express.Router();
const prisma = new PrismaClient();

// Zod input validation schemas
const getUsersQuerySchema = z.object({
  limit: z.string().transform(val => parseInt(val)).default('10'),
  offset: z.string().transform(val => parseInt(val)).default('0'),
  sort: z.enum(['rank_score', 'total_earnings', 'total_contests']).optional()
});
const createUserSchema = z.object({
  wallet_address: z.string(), // TODO: Add validation for wallet_address
  nickname: z.string().min(3).max(50).optional() // TODO: Add validation for nickname
});


/**
 * @swagger
 * tags:
 *   name: Users
 *   description: API endpoints for user management
 */

/* Users Routes */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: List of users
 */
// Get all users (NO AUTH REQUIRED*)
//   example: GET https://degenduel.me/api/users
router.get('/', async (req, res) => {
  const logContext = { 
    path: 'GET /api/users',
    query: req.query 
  };
  
  try {
    // Validate query parameters
    const validatedQuery = await getUsersQuerySchema.parseAsync(req.query)
      .catch(error => {
        logApi.warn('Invalid query parameters', { ...logContext, error });
        throw { status: 400, message: 'Invalid query parameters', details: error.errors };
      });
    
    const { limit, offset, sort } = validatedQuery;
    
    const orderBy = sort ? {
      [sort]: 'desc'
    } : {
      created_at: 'desc'
    };

    logApi.debug('Fetching users with parameters', { 
      ...logContext, 
      limit, 
      offset, 
      orderBy 
    });

    const [users, total] = await Promise.all([
      prisma.users.findMany({
        take: limit,
        skip: offset,
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
    ]).catch(error => {
      logApi.error('Database error while fetching users', { 
        ...logContext,
        error: error instanceof Error ? error.message : error
      });
      throw { status: 500, message: 'Database error while fetching users' };
    });

    logApi.info('Successfully fetched users', { 
      ...logContext,
      userCount: users.length,
      totalUsers: total
    });

    res.json({
      users,
      pagination: {
        total,
        limit,
        offset
      }
    });
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || 'Internal server error';
    
    logApi.error('Error in GET /users handler', {
      ...logContext,
      status,
      message,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });

    res.status(status).json({ 
      error: message,
      details: process.env.NODE_ENV === 'development' ? error.details : undefined
    });
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
// Get user profile by wallet address (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/users/BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp
router.get('/:wallet', async (req, res) => {
  const logContext = {
    path: 'GET /api/users/:wallet',
    wallet: req.params.wallet
  };

  try {
    //if (!req.params.wallet?.match(/^0x[a-fA-F0-9]{40}$/)) {
    //  logApi.warn('Invalid wallet address format', logContext);
    //  throw { status: 400, message: 'Invalid wallet address format' };
    //}

    logApi.debug('Fetching user profile', logContext);
    
    const user = await prisma.users.findUnique({
      where: { wallet_address: req.params.wallet },
      include: {
        contest_participants: {
          take: 5,
          orderBy: { joined_at: 'desc' },
          include: {
            contests: true
          }
        }
      }
    }).catch(error => {
      logApi.error('Database error while fetching user', {
        ...logContext,
        error: error instanceof Error ? error.message : error
      });
      throw { status: 500, message: 'Database error while fetching user' };
    });

    if (!user) {
      logApi.info('User not found', logContext);
      throw { status: 404, message: 'User not found' };
    }

    logApi.info('Successfully fetched user profile', {
      ...logContext,
      userId: user.id,
      hasContests: user.contest_participants.length > 0
    });

    res.json(user);
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || 'Internal server error';

    logApi.error('Error in GET /users/:wallet handler', {
      ...logContext,
      status,
      message,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });

    res.status(status).json({ 
      error: message,
      details: process.env.NODE_ENV === 'development' ? error.details : undefined
    });
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
// Create new user (NO AUTH REQUIRED)
//   example: POST https://degenduel.me/api/users
//   body: { "wallet_address": "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp", "nickname": "xXx420Sn1perx" }
router.post('/', async (req, res) => {
  const logContext = {
    path: 'POST /api/users',
    body: req.body
  };

  try {
    // Validate request body
    const validatedData = await createUserSchema.parseAsync(req.body)
      .catch(error => {
        logApi.warn('Invalid request body', { ...logContext, error });
        throw { status: 400, message: 'Invalid request body', details: error.errors };
      });
    
    logApi.debug('Creating new user', { 
      ...logContext, 
      wallet: validatedData.wallet_address 
    });

    // Check if user already exists
    const existingUser = await prisma.users.findUnique({
      where: { wallet_address: validatedData.wallet_address },
      select: { wallet_address: true }
    });

    if (existingUser) {
      logApi.warn('User already exists', { 
        ...logContext, 
        wallet: validatedData.wallet_address 
      });
      throw { status: 409, message: 'User already exists' };
    }

    const user = await prisma.users.create({
      data: {
        ...validatedData,
        user_stats: {
          create: {} // Creates default stats
        }
      },
      include: {
        user_stats: true
      }
    }).catch(error => {
      logApi.error('Database error while creating user', {
        ...logContext,
        error: error instanceof Error ? error.message : error
      });
      throw { status: 500, message: 'Database error while creating user' };
    });

    logApi.info('Successfully created new user', {
      ...logContext,
      userId: user.id,
      wallet: user.wallet_address
    });

    res.status(201).json(user);
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || 'Internal server error';

    logApi.error('Error in POST /users handler', {
      ...logContext,
      status,
      message,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });

    res.status(status).json({ 
      error: message,
      details: process.env.NODE_ENV === 'development' ? error.details : undefined
    });
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
// Update user profile by wallet address (AUTHENTICATED)
//   headers: { "Authorization": "Bearer <JWT>" }
//   example: PUT https://degenduel.me/api/users/BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp
router.put('/:wallet', requireAuth, async (req, res) => {
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
    logApi.error('Failed to update user:', error);
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
// Get user achievements by wallet address (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/users/BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp/achievements
router.get('/:wallet/achievements', async (req, res) => {
  try {
    const achievements = await prisma.user_achievements.findMany({
      where: { wallet_address: req.params.wallet },
      orderBy: { achieved_at: 'desc' }
    });

    res.json(achievements);
  } catch (error) {
    logApi.error('Failed to fetch achievements:', error);
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
// Get detailed user statistics by wallet address (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/users/BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp/stats
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
    logApi.error('Failed to fetch user stats:', error);
    res.status(500).json({ error: 'Failed to fetch user stats' });
  }
});

export default router;
