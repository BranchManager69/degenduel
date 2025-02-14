// /routes/users.js

import prisma from '../config/prisma.js';
import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { VALIDATION } from '../config/constants.js';
import { validateNicknameRules, generateDefaultUsername } from '../utils/username-generator/username-generator.js';
import rateLimit from 'express-rate-limit';
import { validateNickname } from '../utils/nickname-validator.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();
const upload = multer();

const { NAME } = VALIDATION;

// Zod input validation schemas
const getUsersQuerySchema = z.object({
  limit: z.string().transform(val => parseInt(val)).default('10'),
  offset: z.string().transform(val => parseInt(val)).default('0'),
  sort: z.enum(['rank_score', 'total_earnings', 'total_contests']).optional()
});

// Nickname validation schema - reusable for both create and update
const nicknameSchema = z.string()
  .min(NAME.MIN_LENGTH, `Nickname must be at least ${NAME.MIN_LENGTH} characters`)
  .max(NAME.MAX_LENGTH, `Nickname cannot exceed ${NAME.MAX_LENGTH} characters`)
  .regex(NAME.PATTERN, 'Nickname can only contain letters, numbers, and underscores')
  .transform(val => val.trim())
  .refine(
    (val) => validateNicknameRules(val).isValid,
    (val) => ({ message: validateNicknameRules(val).error })
  );

const createUserSchema = z.object({
  wallet_address: z.string(),
  nickname: nicknameSchema.optional()
});

const updateUserSchema = z.object({
  nickname: nicknameSchema,
  settings: z.record(z.any()).optional()
});

// Helper function to check nickname uniqueness
async function isNicknameUnique(nickname, excludeWallet = null) {
  const existingUser = await prisma.users.findFirst({
    where: {
      nickname: {
        equals: nickname,
        mode: 'insensitive'  // Case insensitive check
      },
      ...(excludeWallet && {
        NOT: {
          wallet_address: excludeWallet
        }
      })
    }
  });
  return !existingUser;
}

// Rate limiter: 120 requests per minute per IP
const nicknameCheckLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'Too many requests, please try again later' }
});

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: API endpoints for user management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         wallet_address:
 *           type: string
 *           description: User's wallet address
 *         nickname:
 *           type: string
 *           description: User's chosen nickname
 *         role:
 *           type: string
 *           enum: [user, admin, superadmin]
 *           description: User's role in the system
 *         is_banned:
 *           type: boolean
 *           description: Whether the user is banned
 *         ban_reason:
 *           type: string
 *           nullable: true
 *           description: Reason for user's ban if applicable
 *         current_balance:
 *           type: number
 *           format: decimal
 *           description: User's current balance
 *         total_deposits:
 *           type: number
 *           format: decimal
 *           description: Total amount deposited by user
 *         total_withdrawals:
 *           type: number
 *           format: decimal
 *           description: Total amount withdrawn by user
 *         total_contests:
 *           type: integer
 *           description: Total number of contests participated in
 *         total_wins:
 *           type: integer
 *           description: Total number of contests won
 *         total_earnings:
 *           type: number
 *           format: decimal
 *           description: Total earnings from contests
 *         win_rate:
 *           type: number
 *           format: float
 *           description: Percentage of contests won
 *         avg_position:
 *           type: number
 *           format: float
 *           description: Average finishing position in contests
 *         longest_win_streak:
 *           type: integer
 *           description: Longest consecutive contest wins
 *         current_win_streak:
 *           type: integer
 *           description: Current consecutive contest wins
 *         rank_score:
 *           type: number
 *           format: float
 *           description: User's ranking score
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Account creation timestamp
 *         last_login:
 *           type: string
 *           format: date-time
 *           description: Last login timestamp
 *         user_stats:
 *           type: object
 *           properties:
 *             total_trades:
 *               type: integer
 *               description: Total number of trades made
 *             total_volume:
 *               type: number
 *               format: decimal
 *               description: Total trading volume
 *             total_pnl:
 *               type: number
 *               format: decimal
 *               description: Total profit/loss from trading
 *             best_trade_pnl:
 *               type: number
 *               format: decimal
 *               description: Highest profit from a single trade
 *             worst_trade_pnl:
 *               type: number
 *               format: decimal
 *               description: Biggest loss from a single trade
 *             avg_trade_duration:
 *               type: number
 *               format: float
 *               description: Average duration of trades in seconds
 *             favorite_token:
 *               type: string
 *               description: Most frequently traded token
 *             best_token:
 *               type: string
 *               description: Token with highest profit
 *             worst_token:
 *               type: string
 *               description: Token with biggest loss
 */

/* Users Routes */

/**
 * @swagger
 * /api/users/search:
 *   get:
 *     summary: Search users by wallet address or nickname
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: search
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query (minimum 2 characters)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *         description: Maximum number of users to return
 *     responses:
 *       200:
 *         description: List of matching users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid search query
 *       500:
 *         description: Server error
 */
// Search users by wallet address or nickname (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/users/search?search=test&limit=5
router.get('/search', async (req, res) => {
  const logContext = {
    path: 'GET /api/users/search',
    query: req.query
  };

  try {
    const { search, limit = 5 } = req.query;

    if (!search || search.length < 2) {
      logApi.warn('Invalid search query - too short', logContext);
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    logApi.debug('Searching users', { ...logContext, search, limit });

    const users = await prisma.users.findMany({
      where: {
        OR: [
          {
            wallet_address: {
              contains: search,
              mode: 'insensitive'
            }
          },
          {
            nickname: {
              contains: search,
              mode: 'insensitive'
            }
          }
        ]
      },
      take: parseInt(limit),
      select: {
        wallet_address: true,
        nickname: true,
        role: true,
        is_banned: true,
        ban_reason: true,
        balance: true,
        total_contests: true,
        total_wins: true,
        total_earnings: true,
        rank_score: true,
        created_at: true,
        last_login: true,
        user_stats: {
          select: {
            contests_entered: true,
            contests_won: true,
            total_prize_money: true,
            best_score: true,
            avg_score: true,
            last_updated: true
          }
        }
      }
    });

    logApi.info('Successfully searched users', {
      ...logContext,
      matchCount: users.length
    });

    res.json({ users });
  } catch (error) {
    logApi.error('Error searching users', {
      ...logContext,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });

    res.status(500).json({ error: 'Failed to search users' });
  }
});

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users with pagination and sorting
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of users to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of users to skip
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [rank_score, total_earnings, total_contests]
 *         description: Field to sort by (descending order)
 *     responses:
 *       200:
 *         description: List of users with pagination info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 total:
 *                   type: integer
 *                   description: Total number of users
 *                 limit:
 *                   type: integer
 *                   description: Number of users per page
 *                 offset:
 *                   type: integer
 *                   description: Number of users skipped
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid query parameters
 *                 details:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Database error while fetching users
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
      details: req.environment === 'development' ? error.details : undefined
    });
  }
});

/**
 * @swagger
 * /api/users/check-nickname:
 *   get:
 *     summary: Check nickname availability
 *     description: Check if a nickname is available for use
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: nickname
 *         required: true
 *         schema:
 *           type: string
 *         description: The nickname to check
 *     responses:
 *       200:
 *         description: Nickname availability status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 available:
 *                   type: boolean
 *                   description: Whether the nickname is available
 *       400:
 *         description: Invalid nickname format
 *       500:
 *         description: Internal server error
 */
// Nickname availability check endpoint (no auth required)
router.get('/check-nickname', nicknameCheckLimiter, async (req, res) => {
    const startTime = Date.now();
    const { nickname } = req.query;

    try {
        // Validate nickname format
        const validation = validateNickname(nickname);
        if (!validation.isValid) {
            logApi.warn('Invalid nickname check attempt', {
                nickname,
                error: validation.error,
                ip: req.ip
            });
            return res.status(400).json({
                error: validation.error
            });
        }

        // Check database for existing nickname (case insensitive)
        const existingUser = await prisma.users.findFirst({
            where: {
                nickname: {
                    equals: nickname,
                    mode: 'insensitive'
                }
            }
        });

        // Add artificial delay if needed (minimum 100ms)
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime < 100) {
            await new Promise(resolve => setTimeout(resolve, 100 - elapsedTime));
        }

        return res.json({
            available: !existingUser
        });

    } catch (error) {
        logApi.error('Error checking nickname availability:', {
            nickname,
            error: error.message,
            ip: req.ip
        });
        return res.status(500).json({
            error: 'Internal server error'
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
 *         description: Wallet address of the user
 *     responses:
 *       200:
 *         description: User profile data with recent contests
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
 *                 total_wins:
 *                   type: integer
 *                 total_earnings:
 *                   type: number
 *                   format: float
 *                 rank_score:
 *                   type: number
 *                   format: float
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                 last_login:
 *                   type: string
 *                   format: date-time
 *                 contest_participants:
 *                   type: array
 *                   description: Last 5 contests participated in
 *                   items:
 *                     type: object
 *                     properties:
 *                       joined_at:
 *                         type: string
 *                         format: date-time
 *                       contests:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           status:
 *                             type: string
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: User not found
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Database error while fetching user
 */
// Get user profile by wallet address (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/users/{wallet}
//      headers: { "Cookie": "session=<jwt>" }
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
      details: req.environment === 'development' ? error.details : undefined
    });
  }
});

/**
 * @swagger
 * /api/users/by-username/{username}:
 *   get:
 *     summary: Get user profile by username
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Username of the user
 *     responses:
 *       200:
 *         description: User profile data with recent contests
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet_address:
 *                   type: string
 *                 username:
 *                   type: string
 *                 nickname:
 *                   type: string
 *                 total_contests:
 *                   type: integer
 *                 total_wins:
 *                   type: integer
 *                 total_earnings:
 *                   type: number
 *                   format: float
 *                 rank_score:
 *                   type: number
 *                   format: float
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                 last_login:
 *                   type: string
 *                   format: date-time
 *                 contest_participants:
 *                   type: array
 *                   description: Last 5 contests participated in
 *                   items:
 *                     type: object
 *                     properties:
 *                       joined_at:
 *                         type: string
 *                         format: date-time
 *                       contests:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           status:
 *                             type: string
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: User not found
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Database error while fetching user
 */
// Get user profile by username (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/users/by-username/{username}
router.get('/by-username/:username', async (req, res) => {
  const logContext = {
    path: 'GET /api/users/by-username/:username',
    username: req.params.username
  };

  try {
    logApi.debug('Fetching user profile by username', logContext);
    
    const user = await prisma.users.findUnique({
      where: { username: req.params.username },
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
      logApi.error('Database error while fetching user by username', {
        ...logContext,
        error: error instanceof Error ? error.message : error
      });
      throw { status: 500, message: 'Database error while fetching user' };
    });

    if (!user) {
      logApi.info('User not found by username', logContext);
      throw { status: 404, message: 'User not found' };
    }

    logApi.info('Successfully fetched user profile by username', {
      ...logContext,
      userId: user.id,
      hasContests: user.contest_participants.length > 0
    });

    res.json(user);
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || 'Internal server error';

    logApi.error('Error in GET /users/by-username/:username handler', {
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
      details: req.environment === 'development' ? error.details : undefined
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
 *                 description: User's wallet address
 *               nickname:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 50
 *                 description: Optional nickname for the user
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid input data
 *                 details:
 *                   type: array
 *                   items:
 *                     type: object
 *       409:
 *         description: User already exists
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: User already exists
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Database error while creating user
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
    // Generate default nickname if none provided
    if (!req.body.nickname) {
      let defaultNickname;
      let attempts = 0;
      const maxAttempts = 10;

      // Keep trying until we find a unique default nickname
      do {
        defaultNickname = generateDefaultUsername();
        // eslint-disable-next-line no-await-in-loop
        const isUnique = await isNicknameUnique(defaultNickname);
        if (isUnique) {
          req.body.nickname = defaultNickname;
          break;
        }
        attempts++;
      } while (attempts < maxAttempts);

      if (attempts >= maxAttempts) {
        throw { 
          status: 500, 
          message: 'Failed to generate unique default nickname' 
        };
      }
    }

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
      details: req.environment === 'development' ? error.details : undefined
    });
  }
});

/**
 * @swagger
 * /api/users/{wallet}:
 *   put:
 *     summary: Update user profile
 *     description: Update a user's profile information. Requires authentication and the authenticated user must match the wallet address being updated.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nickname:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 50
 *                 description: New nickname for the user
 *               settings:
 *                 type: object
 *                 description: User preferences and settings
 *                 example: { "notifications": true, "theme": "dark" }
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid input data
 *                 details:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Authentication required
 *       403:
 *         description: Not authorized to update this user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Not authorized to update this user
 *       404:
 *         $ref: '#/components/responses/UserNotFound'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to update user
 *                 message:
 *                   type: string
 *                   description: Detailed error message (only in development)
 */
// Update user profile by wallet address (AUTHENTICATED)
//   headers: { "Cookie": "session=<jwt>" }
//   example: PUT https://degenduel.me/api/users/{wallet}
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "nickname": "xXx420Sn1perx" }
router.put('/:wallet', requireAuth, async (req, res) => {
  const logContext = {
    path: 'PUT /api/users/:wallet',
    wallet: req.params.wallet,
    body: req.body
  };

  try {
    // Validate request body
    const validatedData = await updateUserSchema.parseAsync(req.body)
      .catch(error => {
        logApi.warn('Invalid request body', { ...logContext, error });
        throw { status: 400, message: 'Invalid request body', details: error.errors };
      });

    // If nickname is being updated, check uniqueness
    if (validatedData.nickname) {
      const isUnique = await isNicknameUnique(validatedData.nickname, req.params.wallet);
      if (!isUnique) {
        logApi.warn('Nickname already taken', { 
          ...logContext, 
          nickname: validatedData.nickname 
        });
        return res.status(400).json({ 
          error: 'Nickname already taken',
          field: 'nickname'
        });
      }
    }

    const user = await prisma.users.update({
      where: { wallet_address: req.params.wallet },
      data: {
        ...validatedData,
        updated_at: new Date()
      }
    });

    logApi.info('Successfully updated user', {
      ...logContext,
      userId: user.id
    });

    res.json(user);
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || 'Failed to update user';

    logApi.error('Failed to update user:', {
      ...logContext,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });

    res.status(status).json({ 
      error: message,
      details: req.environment === 'development' ? error.details : undefined
    });
  }
});

/**
 * @swagger
 * /api/users/{wallet}/achievements:
 *   get:
 *     summary: Get user achievements
 *     description: Retrieve all achievements for a specific user, ordered by achievement date (descending)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address to fetch achievements for
 *     responses:
 *       200:
 *         description: List of user achievements
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/UserAchievement'
 *               example:
 *                 - id: 1
 *                   wallet_address: "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp"
 *                   achievement_id: "first_win"
 *                   achieved_at: "2024-02-20T15:30:00Z"
 *                   metadata: { "contest_id": 123, "prize": 100 }
 *       404:
 *         $ref: '#/components/responses/UserNotFound'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to fetch achievements
 *                 message:
 *                   type: string
 *                   description: Detailed error message (only in development)
 */
// Get user achievements by wallet address (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/users/{wallet}/achievements
//      headers: { "Cookie": "session=<jwt>" }
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
 *     description: Retrieve comprehensive statistics for a user, including general stats and token-specific performance metrics
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address to fetch statistics for
 *     responses:
 *       200:
 *         description: Detailed user statistics including general stats and token-specific performance
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 general:
 *                   $ref: '#/components/schemas/UserStats'
 *                   description: Overall user statistics
 *                 tokens:
 *                   type: array
 *                   description: Performance statistics for each token the user has traded
 *                   items:
 *                     type: object
 *                     properties:
 *                       token_address:
 *                         type: string
 *                         description: The unique address of the token
 *                       times_picked:
 *                         type: integer
 *                         description: Number of times this token was selected in contests
 *                       wins_with_token:
 *                         type: integer
 *                         description: Number of contests won using this token
 *                       avg_score_with_token:
 *                         type: string
 *                         description: Average performance score with this token
 *                       tokens:
 *                         type: object
 *                         description: Token metadata
 *                         properties:
 *                           symbol:
 *                             type: string
 *                             description: Token symbol (e.g., "BTC")
 *                           name:
 *                             type: string
 *                             description: Token name (e.g., "Bitcoin")
 *               example:
 *                 general:
 *                   total_contests: 50
 *                   total_wins: 20
 *                   total_earnings: "1000.50"
 *                   rank_score: 85.5
 *                   created_at: "2024-01-01T00:00:00Z"
 *                   updated_at: "2024-02-20T15:30:00Z"
 *                 tokens:
 *                   - token_address: "So11111111111111111111111111111111111111112"
 *                     times_picked: 30
 *                     wins_with_token: 12
 *                     avg_score_with_token: "75.5"
 *                     tokens:
 *                       symbol: "SOL"
 *                       name: "Solana"
 *       404:
 *         $ref: '#/components/responses/UserNotFound'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to fetch user stats
 *                 message:
 *                   type: string
 *                   description: Detailed error message (only in development)
 */
// Get detailed user statistics by wallet address (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/users/{wallet}/stats
//      headers: { "Cookie": "session=<jwt>" }
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

/**
 * @swagger
 * /api/users/{wallet}/profile-image:
 *   post:
 *     summary: Update user's profile image
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile image updated successfully
 *       400:
 *         description: Invalid request or file type
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/:wallet/profile-image', requireAuth, upload.single('image'), async (req, res) => {
  try {
    // Verify user exists and requester has permission
    const user = await prisma.users.findUnique({
      where: { wallet_address: req.params.wallet }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Ensure user can only update their own profile image unless they're admin
    if (req.user.wallet_address !== req.params.wallet && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Unauthorized to update this user\'s profile image' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Get file extension and check if it's allowed
    const fileExt = req.file.originalname.split('.').pop().toLowerCase();
    const allowedExts = ['jpg', 'jpeg', 'png', 'gif'];
    if (!allowedExts.includes(fileExt)) {
      return res.status(400).json({ error: 'Invalid file type. Allowed types: jpg, jpeg, png, gif' });
    }

    // Generate unique filename
    const filename = `${user.wallet_address}_${Date.now()}.${fileExt}`;
    const uploadPath = path.join(process.env.UPLOAD_DIR || 'uploads', 'profile-images', filename);

    // Ensure upload directory exists
    await fs.promises.mkdir(path.dirname(uploadPath), { recursive: true });

    // Write file
    await fs.promises.writeFile(uploadPath, req.file.buffer);

    // Generate public URL
    const publicUrl = `${process.env.API_URL}/uploads/profile-images/${filename}`;

    // Update user record
    await prisma.users.update({
      where: { wallet_address: req.params.wallet },
      data: {
        profile_image_url: publicUrl,
        profile_image_updated_at: new Date(),
        updated_at: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Profile image updated successfully',
      data: {
        profile_image_url: publicUrl
      }
    });

  } catch (error) {
    logApi.error('Failed to update profile image:', error);
    res.status(500).json({ error: 'Failed to update profile image' });
  }
});

export default router;
