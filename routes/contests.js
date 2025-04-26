// /routes/contests.js

/**
 * This file contains the routes for the contests API.
 * 
 * It includes routes for getting contests, entering contests, and getting contest leaderboards.
 * 
 */

import pkg from '@prisma/client';
import express from 'express';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { createContestWallet } from '../utils/solana-suite/solana-wallet.js';
import { verifyTransaction } from '../utils/solana-suite/web3-v2/solana-connection-v2.js';
import { colors, fancyColors } from '../utils/colors.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js'; // why import if unused?
import prisma from '../config/prisma.js';
import ReferralService from '../services/referralService.js';
import contestImageService from '../services/contestImageService.js';
import cache from '../utils/cache.js';
import * as crypto from 'crypto';

// Config
import { config } from '../config/config.js';

const { Prisma } = pkg; // what the fuck is this doing?  should it be using our unified prisma client?

// Router
const router = express.Router();

// For Decimal type and error handling
const { Decimal } = Prisma;
const { PrismaClientKnownRequestError } = Prisma; // why import if unused?

/**
 * @swagger
 * tags:
 *   name: Contests
 *   description: Contest management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Contest:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - contest_code
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: "Weekly Trading Contest"
 *         contest_code:
 *           type: string
 *           example: "WTC-001"
 *         description:
 *           type: string
 *           example: "Compete in our weekly gay trading contest"
 *         start_time:
 *           type: string
 *           format: date-time
 *         end_time:
 *           type: string
 *           format: date-time
 *         entry_fee:
 *           type: string
 *           example: "1.00"
 *         prize_pool:
 *           type: string
 *           example: "100.00"
 *         status:
 *           type: string
 *           enum: [pending, active, completed, cancelled]
 *         participant_count:
 *           type: integer
 *           example: 37
 *         min_participants:
 *           type: integer
 *           example: 2
 *         max_participants:
 *           type: integer
 *           example: 50
 *         allowed_buckets:
 *           type: array
 *           items:
 *             type: integer
 *           example: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
 *     
 *     ContestParticipant:
 *       type: object
 *       properties:
 *         contest_id:
 *           type: integer
 *         wallet_address:
 *           type: string
 *         initial_balance:
 *           type: string
 *         current_balance:
 *           type: string
 *         rank:
 *           type: integer
 *         final_rank:
 *           type: integer
 *         prize_amount:
 *           type: string
 *     
 *     Portfolio:
 *       type: object
 *       properties:
 *         contest_id:
 *           type: integer
 *         wallet_address:
 *           type: string
 *         token_id:
 *           type: integer
 *         weight:
 *           type: integer
 *
 *   responses:
 *     ContestNotFound:
 *       description: Contest was not found
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *                 example: Contest not found
 */

/* Contests Routes */

/**
 * @swagger
 * /api/contests:
 *   get:
 *     summary: Get all contests with optional filters
 *     tags: [Contests]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, active, completed, cancelled]
 *         description: Filter contests by status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of contests to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of contests to skip
 *     responses:
 *       200:
 *         description: List of contests
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contests:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Contest'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */

/**
 * @swagger
 * /api/contests/user-participations:
 *   get:
 *     summary: Get all contests that a user is participating in
 *     tags: [Contests]
 *     parameters:
 *       - in: query
 *         name: wallet_address
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address to check
 *     responses:
 *       200:
 *         description: List of contests the user is participating in
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 participations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       contest_id:
 *                         type: integer
 *                       contest:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           status:
 *                             type: string
 *                       initial_balance:
 *                         type: string
 *                       current_balance:
 *                         type: string
 *                       rank:
 *                         type: integer
 *                       final_rank:
 *                         type: integer
 *       400:
 *         description: Missing wallet address
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Missing wallet_address parameter"
 */
// Get all contests with optional filters (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/contests?status=active&limit=10&offset=0
router.get('/', async (req, res) => {
  try {
    const { status, limit = 10, offset = 0, wallet_address } = req.query;
    
    const where = status ? { status } : {};
    
    const [contests, total] = await Promise.all([
      prisma.contests.findMany({
        where,
        include: {
          _count: {
            select: {
              contest_participants: true
            }
          },
          // Include contest_participants but only for this wallet
          contest_participants: wallet_address ? {
            where: {
              wallet_address
            }
          } : false
        },
        take: parseInt(limit),
        skip: parseInt(offset),
        orderBy: {
          created_at: 'desc'
        }
      }),
      prisma.contests.count({ where })
    ]);

    // Add is_participating flag based on contest_participants
    const contestsWithParticipation = contests.map(contest => ({
      ...contest,
      is_participating: contest.contest_participants?.length > 0,
      // Remove the contest_participants array since we only needed it for the check
      contest_participants: undefined
    }));

    res.json({
      contests: contestsWithParticipation,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logApi.error('Failed to fetch contests:', error);
    res.status(500).json({ error: 'Failed to fetch contests' });
  }
});

/**
 * @swagger
 * /api/contests/{id}:
 *   get:
 *     summary: Get contest by ID with full details
 *     tags: [Contests]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contest ID
 *     responses:
 *       200:
 *         description: Detailed contest information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contest'
 *       404:
 *         $ref: '#/components/responses/ContestNotFound'
 *       500:
 *         description: Server error
 */
// Get contest by ID with full details (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/contests/1
router.get('/:id', async (req, res) => {
  try {
    const contest = await prisma.contests.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        contest_participants: {
          include: {
            users: {
              select: {
                nickname: true,
                wallet_address: true
              }
            }
          }
        },
        contest_portfolios: {
          include: {
            tokens: true
          }
        },
        contest_wallets: true
      }
    });

    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    // Flatten the wallet address into the contest object
    const response = {
      ...contest,
      wallet_address: contest.contest_wallets?.wallet_address || null,
      // Remove the nested contest_wallets object
      contest_wallets: undefined
    };

    res.json(response);
  } catch (error) {
    logApi.error('Failed to fetch contest:', error);
    res.status(500).json({ error: 'Failed to fetch contest' });
  }
});

/**
 * @swagger
 * /api/contests:
 *   post:
 *     summary: Create a new contest
 *     tags: [Contests]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - contest_code
 *               - entry_fee
 *               - start_time
 *               - end_time
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Weekly Trading Contest"
 *               contest_code:
 *                 type: string
 *                 example: "WTC-2024-01"
 *                 description: Unique identifier for the contest
 *               description:
 *                 type: string
 *                 example: "Join our weekly trading competition"
 *               entry_fee:
 *                 type: string
 *                 example: "1000000"
 *                 description: |
 *                   Entry fee in base units (non-negative).
 *                   Accepts:
 *                   - String numbers: "1000000", "1.5"
 *                   - Numbers with commas: "1,000,000"
 *                   - Regular numbers: 1000000
 *                   Will be converted to appropriate base units with up to 18 decimal places.
 *               start_time:
 *                 type: string
 *                 format: date-time
 *                 description: Must be in the future
 *               end_time:
 *                 type: string
 *                 format: date-time
 *                 description: Must be after start_time
 *               min_participants:
 *                 type: integer
 *                 minimum: 2
 *                 example: 10
 *               max_participants:
 *                 type: integer
 *                 minimum: 2
 *                 example: 100
 *               allowed_buckets:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 example: [1, 2, 3]
 *     responses:
 *       201:
 *         description: Contest created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contest'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Missing required fields"
 *                 fields:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["name", "contest_code"]
 *       409:
 *         description: Conflict error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Contest code already exists"
 *                 field:
 *                   type: string
 *                   example: "contest_code"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */
// Create a new contest (ADMIN ONLY)
//   example: POST https://degenduel.me/api/contests
//     body: { "name": "Weekly Trading Contest", "contest_code": "WTC-2024-01", "entry_fee": "1000000", "start_time": "2025-01-01T00:00:00Z", "end_time": "2025-01-07T23:59:59Z", "min_participants": 10, "max_participants": 100, "allowed_buckets": [1, 2, 3] }
//     headers: { "Authorization": "Bearer <JWT>" }
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    const {
      name,
      contest_code,
      description,
      entry_fee,
      start_time,
      end_time,
      min_participants,
      max_participants,
      allowed_buckets = []
    } = req.body;

    logApi.info({
      requestId,
      message: 'Creating new contest',
      data: {
        contest_code,
        name,
        start_time,
        end_time,
        min_participants,
        max_participants
      }
    });

    // Validate required fields
    const requiredFields = ['name', 'contest_code', 'entry_fee', 'start_time', 'end_time'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    if (missingFields.length > 0) {
      logApi.warn({
        requestId,
        message: 'Missing required fields for contest creation',
        missingFields,
        duration: Date.now() - startTime
      });
      return res.status(400).json({
        error: 'Missing required fields',
        fields: missingFields
      });
    }

    // Validate dates
    const startDate = new Date(start_time);
    const endDate = new Date(end_time);
    const now = new Date();

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      logApi.warn({
        requestId,
        message: 'Invalid date format in contest creation',
        data: { start_time, end_time },
        duration: Date.now() - startTime
      });
      return res.status(400).json({
        error: 'Invalid date format for start_time or end_time'
      });
    }

    if (startDate <= now) {
      logApi.warn({
        requestId,
        message: 'Invalid start time - must be in future',
        data: { start_time, current_time: now },
        duration: Date.now() - startTime
      });
      return res.status(400).json({
        error: 'start_time must be in the future'
      });
    }

    if (endDate <= startDate) {
      logApi.warn({
        requestId,
        message: 'Invalid end time - must be after start time',
        data: { start_time, end_time },
        duration: Date.now() - startTime
      });
      return res.status(400).json({
        error: 'end_time must be after start_time'
      });
    }

    // Validate participants limits
    if (min_participants && max_participants && min_participants > max_participants) {
      logApi.warn({
        requestId,
        message: 'Invalid participant limits',
        data: { min_participants, max_participants },
        duration: Date.now() - startTime
      });
      return res.status(400).json({
        error: 'min_participants cannot be greater than max_participants'
      });
    }

    // Validate and parse entry fee
    let parsedEntryFee;
    try {
      // Handle different input formats
      if (typeof entry_fee === 'string') {
        // Remove any commas and whitespace
        const cleanedFee = entry_fee.replace(/,|\s/g, '');
        
        // Check if it's a valid decimal or integer format
        if (!/^\-?\d*\.?\d+$/.test(cleanedFee)) {
          throw new Error('Invalid number format');
        }

        parsedEntryFee = cleanedFee;
      } else if (typeof entry_fee === 'number') {
        if (!Number.isFinite(entry_fee)) {
          throw new Error('Invalid number');
        }
        parsedEntryFee = entry_fee.toString();
      } else {
        throw new Error('Invalid entry fee type');
      }

      if (new Decimal(parsedEntryFee).isNegative()) {
        logApi.warn({
          requestId,
          message: 'Negative entry fee provided',
          data: { entry_fee, parsed: parsedEntryFee },
          duration: Date.now() - startTime
        });
        return res.status(400).json({
          error: 'entry_fee cannot be negative'
        });
      }
    } catch (e) {
      logApi.warn({
        requestId,
        message: 'Invalid entry fee format',
        data: { entry_fee, error: e.message },
        duration: Date.now() - startTime
      });
      return res.status(400).json({
        error: 'Invalid entry_fee format',
        details: 'Entry fee must be a valid number or string representation of a number'
      });
    }

    // Validate allowed_buckets
    if (!Array.isArray(allowed_buckets)) {
      logApi.warn({
        requestId,
        message: 'Invalid allowed_buckets format',
        data: { allowed_buckets },
        duration: Date.now() - startTime
      });
      return res.status(400).json({
        error: 'allowed_buckets must be an array'
      });
    }

    // Create contest and wallet in a transaction
    const result = await prisma.$transaction(async (prisma) => {
      // 1. Create contest first
      const contest = await prisma.contests.create({
        data: {
          name,
          contest_code,
          description,
          entry_fee: new Decimal(parsedEntryFee),
          start_time: startDate,
          end_time: endDate,
          min_participants,
          max_participants,
          allowed_buckets,
          status: 'pending'
        }
      });

      logApi.info(`🏆 ${fancyColors.CYAN}[routes/contests]${fancyColors.RESET} Contest created, generating wallet`, {
        requestId,
        contest_id: contest.id,
        contest_code: contest.contest_code
      });
      
      // Generate AI image for the contest (non-blocking)
      // We don't await this to avoid slowing down contest creation
      setTimeout(() => {
        contestImageService.generateContestImage(contest)
          .then(imageUrl => {
            // Update contest with image URL
            return prisma.contests.update({
              where: { id: contest.id },
              data: { image_url: imageUrl }
            });
          })
          .then(() => {
            logApi.info(`🎨 ${fancyColors.GREEN}[routes/contests]${fancyColors.RESET} Contest image generated and saved`, {
              contest_id: contest.id,
              contest_name: contest.name
            });
          })
          .catch(error => {
            logApi.error(`❌ ${fancyColors.RED}[routes/contests]${fancyColors.RESET} Failed to generate contest image`, {
              contest_id: contest.id,
              error: error.message,
              stack: error.stack
            });
          });
      }, 100); // Small delay to ensure transaction completes first

      // 2. Use contestWalletService to create wallet (for proper vanity wallet support)
      let contestWallet;
      try {
        // Import contestWalletService (avoid circular dependencies)
        const contestWalletService = (await import('../services/contestWalletService.js')).default;
        contestWallet = await contestWalletService.createContestWallet(contest.id);
        
        // Log if this is a vanity wallet
        if (contestWallet.is_vanity) {
          logApi.info({
            requestId,
            message: `Using ${contestWallet.vanity_type} vanity wallet for contest`,
            data: {
              contest_id: contest.id,
              wallet_address: contestWallet.wallet_address,
              vanity_type: contestWallet.vanity_type
            }
          });
        }
      } catch (walletError) {
        // Fall back to direct wallet creation if service fails
        logApi.warn({
          requestId,
          message: 'Wallet service failed, falling back to direct wallet creation',
          error: walletError.message
        });
        
        // Direct wallet creation as a fallback
        const { publicKey, encryptedPrivateKey } = await createContestWallet();
        
        contestWallet = await prisma.contest_wallets.create({
          data: {
            contest_id: contest.id,
            wallet_address: publicKey,
            private_key: encryptedPrivateKey,
            balance: '0'
          }
        });
      }

      // Send success SMS alert
      //await sendSMSAlert(
      //  formatContestWalletAlert('creation', {
      //    contest_id: contest.id,
      //    wallet_address: contestWallet.wallet_address
      //  })
      //);
      logApi.info({
        requestId,
        message: 'Contest wallet created successfully',
        data: {
          contest_id: contest.id,
          wallet_address: contestWallet.wallet_address,
          is_vanity: contestWallet.is_vanity || false,
          vanity_type: contestWallet.vanity_type || null
        }
      });

      // Return contest with wallet info
      return {
        ...contest,
        wallet_address: contestWallet.wallet_address
      };
    });

    res.status(201).json(result);
  } catch (error) {
    // Send error SMS alert
    //await sendSMSAlert(
    //  formatContestWalletAlert('error', {
    //    contest_id: contest?.id || 'N/A',
    //    error: error.message
    //  })
    //);
    logApi.error('Error in contest creation:', {
      requestId,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: req.environment === 'development' ? error.stack : undefined
      } : error,
      duration: Date.now() - startTime
    });

    // Handle specific wallet errors
    if (error.name === 'WalletError') {
      return res.status(500).json({
        error: 'Failed to create contest wallet',
        code: error.code,
        message: error.message
      });
    }

    res.status(500).json({
      error: 'Failed to create contest',
      message: req.environment === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /api/contests/{id}/enter:
 *   post:
 *     summary: Enter a contest with initial portfolio in a single atomic transaction
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contest ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet_address
 *               - transaction_signature
 *               - portfolio
 *             properties:
 *               wallet_address:
 *                 type: string
 *                 example: "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp"
 *               transaction_signature:
 *                 type: string
 *                 example: "5KtP3EMKPGYyQ..."
 *               portfolio:
 *                 type: object
 *                 required:
 *                   - tokens
 *                 properties:
 *                   tokens:
 *                     type: array
 *                     items:
 *                       type: object
 *                       required:
 *                         - token_id
 *                         - weight
 *                       properties:
 *                         token_id:
 *                           type: integer
 *                           example: 1
 *                         weight:
 *                           type: integer
 *                           minimum: 0
 *                           maximum: 100
 *                           example: 50
 *     responses:
 *       200:
 *         description: Successfully entered contest with portfolio
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 participation:
 *                   $ref: '#/components/schemas/ContestParticipant'
 *                 portfolio:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Portfolio'
 *                 transaction:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     blockchain_tx_id:
 *                       type: string
 *                     signature:
 *                       type: string
 *                     slot:
 *                       type: number
 *       400:
 *         description: Invalid request or portfolio validation failed
 *       404:
 *         description: Contest not found
 *       409:
 *         description: Already participating or transaction used
 *       500:
 *         description: Server error
 */
// Standard error codes for contest operations
const ContestErrorCodes = {
  CONTEST_FULL: 'CONTEST_FULL',
  INVALID_PORTFOLIO: 'INVALID_PORTFOLIO',
  ALREADY_ENTERED: 'ALREADY_ENTERED',
  INVALID_TRANSACTION: 'INVALID_TRANSACTION',
  CONTEST_STARTED: 'CONTEST_STARTED',
  CONTEST_CANCELLED: 'CONTEST_CANCELLED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TIMEOUT: 'TIMEOUT',
  SYSTEM_ERROR: 'SYSTEM_ERROR'
};

// Timeout settings (in milliseconds)
const TIMEOUTS = {
  SOLANA_VERIFICATION: 30000,  // 30 seconds
  DATABASE_OPERATIONS: 10000,   // 10 seconds
  TOTAL_REQUEST: 45000         // 45 seconds
};

/**
 * @swagger
 * /api/contests/{id}/enter:
 *   post:
 *     summary: Enter a contest with initial portfolio in a single atomic transaction
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Contest ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet_address
 *               - transaction_signature
 *               - portfolio
 *             properties:
 *               wallet_address:
 *                 type: string
 *                 example: "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp"
 *               transaction_signature:
 *                 type: string
 *                 example: "5KtP3EMKPGYyQ..."
 *               portfolio:
 *                 type: object
 *                 required:
 *                   - tokens
 *                 properties:
 *                   tokens:
 *                     type: array
 *                     items:
 *                       type: object
 *                       required:
 *                         - token_id
 *                         - weight
 *                       properties:
 *                         token_id:
 *                           type: integer
 *                           example: 1
 *                         weight:
 *                           type: integer
 *                           minimum: 0
 *                           maximum: 100
 *                           example: 50
 *     responses:
 *       200:
 *         description: Successfully entered contest with portfolio
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 participation:
 *                   $ref: '#/components/schemas/ContestParticipant'
 *                 portfolio:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Portfolio'
 */
// Enter a contest with initial portfolio in a single atomic transaction
router.post('/:id/enter', requireAuth, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { wallet_address, transaction_signature, portfolio, idempotency_key = transaction_signature } = req.body;
  const contestId = parseInt(req.params.id);

  // Initialize metrics
  const metrics = {
    solana_verification_time: 0,
    database_operations_time: 0,
    total_time: 0
  };

  try {
    // Log the full request details
    logApi.info(`🎮 ${colors.neon}Contest entry request details${colors.reset}`, {
      requestId,
      body: {
        wallet_address,
        transaction_signature,
        portfolio,
        idempotency_key
      },
      params: {
        contestId
      },
      headers: req.headers
    });

    // Set response timeout
    req.setTimeout(TIMEOUTS.TOTAL_REQUEST);

    // Input validation
    if (!wallet_address || !transaction_signature || !portfolio?.tokens) {
      logApi.warn(`⚠️ ${colors.yellow}Missing required fields${colors.reset}`, {
        requestId,
        wallet_address: !!wallet_address,
        transaction_signature: !!transaction_signature,
        portfolio: !!portfolio?.tokens
      });
      throw new ContestError('Invalid request: missing required fields', 400, {
        code: ContestErrorCodes.INVALID_PORTFOLIO,
        fields: {
          wallet_address: !wallet_address,
          transaction_signature: !transaction_signature,
          portfolio: !portfolio?.tokens
        }
      });
    }

    // Verify all tokens exist before proceeding
    const tokenAddresses = portfolio.tokens.map(t => t.contractAddress);
    const existingTokens = await prisma.tokens.findMany({
      where: {
        address: {
          in: tokenAddresses
        }
      },
      select: {
        address: true
      }
    });

    const foundAddresses = new Set(existingTokens.map(t => t.address));
    const missingTokens = tokenAddresses.filter(addr => !foundAddresses.has(addr));
    
    if (missingTokens.length > 0) {
      throw new ContestError('One or more tokens not found', 400, {
        code: ContestErrorCodes.TOKEN_INVALID,
        missingTokens
      });
    }

    // Validate portfolio weights sum to 100%
    const totalWeight = portfolio.tokens.reduce((sum, token) => sum + token.weight, 0);
    if (totalWeight !== 100) {
      logApi.warn(`⚠️ ${colors.yellow}Invalid portfolio weights${colors.reset}`, {
        requestId,
        totalWeight
      });
      throw new ContestError('Portfolio weights must sum to 100%', 400, {
        code: ContestErrorCodes.INVALID_PORTFOLIO,
        totalWeight
      });
    }

    try {
      const result = await prisma.$transaction(async (prisma) => {
        // Get contest with participant count
        const contest = await prisma.contests.findUnique({
          where: { id: contestId },
          include: {
            _count: {
              select: { contest_participants: true }
            },
            contest_wallets: true
          }
        });

        if (!contest) {
          throw new ContestError('Contest not found', 404);
        }

        // Verify all tokens exist before proceeding
        const tokenAddresses = portfolio.tokens.map(t => t.contractAddress);
        const existingTokens = await prisma.tokens.findMany({
          where: {
            address: {
              in: tokenAddresses
            }
          },
          select: {
            address: true
          }
        });

        const foundAddresses = new Set(existingTokens.map(t => t.address));
        const missingTokens = tokenAddresses.filter(addr => !foundAddresses.has(addr));
        
        if (missingTokens.length > 0) {
          throw new ContestError('One or more tokens not found', 400, {
            code: ContestErrorCodes.TOKEN_INVALID,
            missingTokens
          });
        }

        // Contest state validations
        if (contest.status === 'cancelled') {
          throw new ContestError('Contest has been cancelled', 400, {
            code: ContestErrorCodes.CONTEST_CANCELLED
          });
        }

        if (contest.status !== 'pending') {
          throw new ContestError('Contest has already started', 400, {
            code: ContestErrorCodes.CONTEST_STARTED
          });
        }

        if (contest._count.contest_participants >= (contest.max_participants || 0)) {
          throw new ContestError('Contest is full', 400, {
            code: ContestErrorCodes.CONTEST_FULL,
            currentParticipants: contest._count.contest_participants,
            maxParticipants: contest.max_participants
          });
        }

        // Check for existing participation
        const existingParticipation = await prisma.contest_participants.findUnique({
          where: {
            contest_id_wallet_address: {
              contest_id: contestId,
              wallet_address
            }
          }
        });

        if (existingParticipation) {
          throw new ContestError('Already participating in this contest', 409, {
            code: ContestErrorCodes.ALREADY_ENTERED
          });
        }

        // Verify Solana transaction with timeout
        const verificationStartTime = Date.now();
        const verificationPromise = verifyTransaction(transaction_signature, {
          expectedAmount: new Decimal(contest.entry_fee || '0').toNumber(),
          expectedSender: wallet_address,
          expectedReceiver: contest.contest_wallets.wallet_address
        });

        const verificationResult = await Promise.race([
          verificationPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Solana verification timeout')), TIMEOUTS.SOLANA_VERIFICATION)
          )
        ]);

        metrics.solana_verification_time = Date.now() - verificationStartTime;

        // Initialize database operations start time
        const dbStartTime = Date.now();

        // Create transaction record if verification was successful
        if (verificationResult.verified) {
          const transactionRecord = await prisma.transactions.create({
            data: {
              wallet_address,
              type: 'CONTEST_ENTRY',
              amount: verificationResult.amount.toString(),
              balance_before: verificationResult.receiverBalanceBefore,
              balance_after: verificationResult.receiverBalanceAfter,
              contest_id: contestId,
              description: `Contest entry fee for ${contest.name}`,
              status: 'completed',
              metadata: {
                contest_code: contest.contest_code,
                solana_signature: transaction_signature,
                solana_slot: verificationResult.slot,
                portfolio_tokens: portfolio.tokens.map(t => ({
                  address: t.contractAddress,
                  weight: t.weight
                })),
                verification: {
                  blockchain_verified: true,
                  blockchain_verified_at: new Date().toISOString(),
                  admin_audited: false,
                  admin_audit_at: null,
                  admin_auditor: null,
                  audit_notes: null,
                  audit_status: 'unaudited'
                },
                rent_exemption: verificationResult.isFirstTransaction ? verificationResult.rentExemption : null
              }
            }
          });

          // Create blockchain transaction record
          const blockchainTx = await prisma.blockchain_transactions.create({
            data: {
              tx_hash: transaction_signature,
              signature: transaction_signature,
              wallet_from: wallet_address,
              wallet_to: contest.contest_wallets.wallet_address,
              amount: new Decimal(contest.entry_fee || '0'),
              token_type: 'SOL',
              chain: 'SOLANA',
              status: 'completed',
              type: 'CONTEST_ENTRY',
              contest_id: contestId,
              confirmed_at: new Date(),
              slot: verificationResult.slot
            }
          });

          // Update transaction with blockchain_tx_id
          await prisma.transactions.update({
            where: { id: transactionRecord.id },
            data: {
              metadata: {
                ...transactionRecord.metadata,
                blockchain_tx_id: blockchainTx.id
              }
            }
          });

          // Create participation record
          const participation = await prisma.contest_participants.create({
            data: {
              contest_id: contestId,
              wallet_address,
              // Use these fields for portfolio tracking and statistics displays
              initial_dxd_points: new Decimal(10000000),
              current_dxd_points: new Decimal(10000000),
              entry_transaction_id: transactionRecord.id
            }
          });

          // Create portfolio entries
          const portfolioEntries = await Promise.all(
            portfolio.tokens.map(token => 
              prisma.contest_portfolios.create({
                data: {
                  weight: token.weight,
                  contests: {
                    connect: {
                      id: contestId
                    }
                  },
                  tokens: {
                    connect: {
                      address: token.contractAddress
                    }
                  },
                  users: {
                    connect: {
                      wallet_address
                    }
                  }
                }
              })
            )
          );

          // Update contest participant count
          await prisma.contests.update({
            where: { id: contestId },
            data: {
              participant_count: {
                increment: 1
              }
            }
          });

          metrics.database_operations_time = Date.now() - dbStartTime;

          // Return the result
          return {
            participation,
            portfolio: portfolioEntries,
            transaction: {
              id: transactionRecord.id,
              blockchain_tx_id: blockchainTx.id,
              signature: transaction_signature,
              slot: verificationResult.slot,
              status: transactionRecord.status,
              rent_exemption: verificationResult.isFirstTransaction ? verificationResult.rentExemption : null
            }
          };
        } else {
          // Transaction verification failed
          throw new ContestError(`Transaction verification failed: ${verificationResult.error}`, 400, {
            code: ContestErrorCodes.INVALID_TRANSACTION,
            details: verificationResult.error
          });
        }
      }, {
        timeout: TIMEOUTS.DATABASE_OPERATIONS
      });

      metrics.total_time = Date.now() - startTime;

      // Log success metrics
      logApi.info(`🎉 ${colors.green}Successfully entered contest with portfolio${colors.reset}`, {
        requestId,
        contestId,
        wallet_address,
        metrics,
        duration: metrics.total_time
      });

      res.json(result);
    } catch (dbError) {
      // Handle database-specific errors
      logApi.error(`💥 ${colors.red}Database error in contest entry${colors.reset}`, {
        requestId,
        error: {
          name: dbError.name,
          message: dbError.message,
          code: dbError?.code,
          meta: dbError?.meta,
          stack: dbError.stack
        }
      });
      throw dbError; // Let the outer catch block handle the response
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.total_time = duration;

    // Enhanced error logging
    logApi.error(`💥 ${colors.red}Error in contest entry endpoint${colors.reset}`, {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error?.code,
        meta: error?.meta,
        stack: error.stack,
        cause: error.cause
      },
      request: {
        body: req.body,
        params: req.params,
        query: req.query
      },
      metrics,
      duration
    });

    // Enhanced error responses
    if (error instanceof ContestError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.details?.code || ContestErrorCodes.SYSTEM_ERROR,
        details: error.details
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return res.status(400).json({
        error: 'Database operation failed',
        code: ContestErrorCodes.SYSTEM_ERROR,
        details: error.message,
        meta: error.meta
      });
    }

    if (error.message === 'Solana verification timeout') {
      return res.status(408).json({
        error: 'Transaction verification timed out',
        code: ContestErrorCodes.TIMEOUT,
        details: 'Please try again or contact support if the issue persists'
      });
    }

    // Generic error response with more details in development
    res.status(500).json({
      error: 'Internal server error',
      code: ContestErrorCodes.SYSTEM_ERROR,
      message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack,
        details: error.message
      })
    });
  }
});

/**
 * @swagger
 * /api/contests/{id}/join:
 *   post:
 *     summary: Join a contest
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contest ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet_address
 *               - transaction_signature
 *             properties:
 *               wallet_address:
 *                 type: string
 *                 example: "0x1234..."
 *               transaction_signature:
 *                 type: string
 *                 example: "..."
 *     responses:
 *       200:
 *         description: Successfully joined contest
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ContestParticipant'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Contest is full"
 *       404:
 *         $ref: '#/components/responses/ContestNotFound'
 */
// Join a wallet into a contest (AUTHENTICATED)
//   example: POST https://degenduel.me/api/contests/{contest_id}/join
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "wallet_address": "...", "transaction_signature": "..." }
router.post('/:id/join', requireAuth, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { wallet_address, transaction_signature } = req.body;
  const contestId = parseInt(req.params.id);

  logApi.info(`🎮 ${colors.neon}New contest join request${colors.reset}`, {
    requestId,
    contestId,
    wallet_address,
    transaction_signature
  });

  try {
    // Input validation
    if (!wallet_address) {
      logApi.warn(`⚠️ ${colors.yellow}Missing wallet address${colors.reset}`, {
        requestId
      });
      return res.status(400).json({ 
        error: 'Invalid request',
        details: 'wallet_address is required'
      });
    }

    if (!transaction_signature) {
      logApi.warn(`⚠️ ${colors.yellow}Missing transaction signature${colors.reset}`, {
        requestId
      });
      return res.status(400).json({
        error: 'Invalid request',
        details: 'transaction_signature is required'
      });
    }

    if (isNaN(contestId)) {
      logApi.warn(`⚠️ ${colors.yellow}Invalid contest ID format${colors.reset}`, {
        requestId,
        contestId: req.params.id
      });
      return res.status(400).json({ 
        error: 'Invalid request',
        details: 'Contest ID must be a number'
      });
    }

    const result = await prisma.$transaction(async (prisma) => {
      // Check if contest exists and is joinable
      logApi.debug(`🔍 ${colors.cyan}Fetching contest details${colors.reset}`, {
        requestId,
        contestId
      });

      const contest = await prisma.contests.findUnique({
        where: { id: contestId },
        include: {
          _count: {
            select: { contest_participants: true }
          },
          contest_wallets: true
        }
      });

      if (!contest) {
        logApi.warn(`❌ ${colors.red}Contest not found${colors.reset}`, {
          requestId,
          contestId
        });
        throw new ContestError('Contest not found', 404);
      }

      logApi.debug(`📊 ${colors.cyan}Contest found${colors.reset}`, {
        requestId,
        contestId,
        status: contest.status,
        currentParticipants: contest._count.contest_participants,
        maxParticipants: contest.max_participants
      });

      // Check if user is already participating
      const existingParticipation = await prisma.contest_participants.findUnique({
        where: {
          contest_id_wallet_address: {
            contest_id: contestId,
            wallet_address
          }
        }
      });

      if (existingParticipation) {
        logApi.warn(`👥 ${colors.yellow}User already participating${colors.reset}`, {
          requestId,
          contestId,
          wallet_address
        });
        throw new ContestError(`You've already got a spot reserved at this table.`, 409);
      }

      // Check if transaction signature was already used
      const existingTx = await prisma.blockchain_transactions.findUnique({
        where: { tx_hash: transaction_signature }
      });

      if (existingTx) {
        logApi.warn(`🔄 ${colors.yellow}Transaction signature already used${colors.reset}`, {
          requestId,
          tx_hash: transaction_signature
        });
        throw new ContestError('Transaction signature already used', 400);
      }

      // Validate contest status
      if (contest.status !== 'pending') {
        logApi.warn(`🚫 ${colors.red}Invalid contest status${colors.reset}`, {
          requestId,
          contestId,
          status: contest.status
        });
        throw new ContestError('Hey, this table isn\'t supposed to be open right now. How did you get here?', 400, {
          status: contest.status
        });
      }

      // Check participant limits
      if (contest._count.contest_participants >= (contest.max_participants || 0)) {
        logApi.warn(`👥 ${colors.yellow}Contest is full${colors.reset}`, {
          requestId,
          contestId,
          currentParticipants: contest._count.contest_participants,
          maxParticipants: contest.max_participants
        });
        throw new ContestError('Sorry, there are no more open seats at this table.', 400, {
          currentParticipants: contest._count.contest_participants,
          maxParticipants: contest.max_participants
        });
      }

      // Verify Solana transaction
      const entryFee = new Decimal(contest.entry_fee || '0');
      logApi.info(`💰 ${colors.cyan}Verifying transaction${colors.reset}`, {
        requestId,
        signature: transaction_signature,
        entryFee: entryFee.toString()
      });

      const verificationResult = await verifyTransaction(transaction_signature, {
        expectedAmount: entryFee.toNumber(),
        expectedSender: wallet_address,
        expectedReceiver: contest.contest_wallets.wallet_address
      });

      if (!verificationResult.verified) {
        logApi.warn(`❌ ${colors.red}Transaction verification failed${colors.reset}`, {
          requestId,
          error: verificationResult.error
        });
        throw new ContestError(`Transaction verification failed: ${verificationResult.error}`, 400);
      }

      logApi.info(`✅ ${colors.green}Transaction verified${colors.reset}`, {
        requestId,
        signature: transaction_signature,
        slot: verificationResult.slot
      });

      // Create blockchain transaction record
      logApi.debug(`📝 ${colors.cyan}Creating blockchain transaction record${colors.reset}`, {
        requestId
      });

      const blockchainTx = await prisma.blockchain_transactions.create({
        data: {
          tx_hash: transaction_signature,
          signature: transaction_signature,
          wallet_from: wallet_address,
          wallet_to: contest.contest_wallets.wallet_address,
          amount: entryFee,
          token_type: 'SOL',
          chain: 'SOLANA',
          status: 'completed',
          type: 'CONTEST_ENTRY',
          contest_id: contestId,
          confirmed_at: new Date(),
          slot: verificationResult.slot
        }
      });

      // Create transaction record
      logApi.debug(`📝 ${colors.cyan}Creating transaction record${colors.reset}`, {
        requestId
      });

      const transaction = await prisma.transactions.create({
        data: {
          wallet_address,
          type: 'CONTEST_ENTRY',
          amount: verificationResult.amount.toString(),
          balance_before: verificationResult.receiverBalanceBefore,
          balance_after: verificationResult.receiverBalanceAfter,
          contest_id: contestId,
          description: `Contest entry fee for ${contest.name}`,
          status: 'completed',
          metadata: {
            blockchain_tx_id: blockchainTx.id,
            contest_code: contest.contest_code,
            solana_signature: transaction_signature,
            solana_slot: verificationResult.slot,
            portfolio_tokens: portfolio.tokens.map(t => ({
              address: t.contractAddress,
              weight: t.weight
            })),
            verification: {
              blockchain_verified: true,
              blockchain_verified_at: new Date().toISOString(),
              admin_audited: false,
              admin_audit_at: null,
              admin_auditor: null,
              audit_notes: null,
              audit_status: 'unaudited'
            }
          }
        }
      });

      // Create participation record
      logApi.debug(`👤 ${colors.cyan}Creating participation record${colors.reset}`, {
        requestId
      });

      // Create participation record
      const participation = await prisma.contest_participants.create({
        data: {
          contest_id: contestId,
          wallet_address,
          initial_dxd_points: new Decimal(10000000), // TODO: (MIGHT NOT EVEN BE USED!)
          current_dxd_points: new Decimal(10000000), // TODO: (MIGHT NOT EVEN BE USED!)
          entry_transaction_id: transaction.id
        }
      });

      // Update contest participant count
      logApi.debug(`📊 ${colors.cyan}Updating contest participant count${colors.reset}`, {
        requestId
      });
      await prisma.contests.update({
        where: { id: contestId },
        data: {
          participant_count: {
            increment: 1
          }
        }
      });

      // Check referral qualification
      await ReferralService.checkContestQualification(wallet_address);

      // Invalidate cache for this user/contest after joining
      const participationCacheKey = `participation:${contestId}:${wallet_address}`;
      const walletParticipationsCacheKey = `wallet:participations:${wallet_address}`;
      await cache.del(participationCacheKey);
      await cache.del(walletParticipationsCacheKey);
      
      // Log success
      logApi.info(`🎉 ${colors.green}Successfully joined contest${colors.reset}`, {
        requestId,
        contestId,
        wallet_address,
        participationId: participation.id,
        transactionId: transaction.id,
        blockchainTxId: blockchainTx.id,
        slot: verificationResult.slot,
        duration: Date.now() - startTime,
        cacheCleared: true
      });
      
      // Send Discord notification for contest join (if more than 5 participants)
      try {
        // Only send notifications for contests that have at least 5 participants
        const updatedContest = await prisma.contests.findUnique({
          where: { id: contestId },
          select: { 
            name: true, 
            contest_code: true,
            participant_count: true,
            max_participants: true,
            entry_fee: true,
            start_time: true,
            prize_pool: true
          }
        });
        
        if (updatedContest && updatedContest.participant_count >= 5) {
          // Import service events dynamically
          const { default: serviceEvents, SERVICE_EVENTS } = await import('../utils/service-suite/service-events.js');
          
          // Get user nickname if available
          const user = await prisma.users.findUnique({
            where: { wallet_address },
            select: { nickname: true, username: true }
          });
          
          const displayName = user?.nickname || user?.username || wallet_address.substring(0, 6) + '...' + wallet_address.substring(wallet_address.length - 4);
          
          // Emit contest activity event for Discord notification
          serviceEvents.emit(SERVICE_EVENTS.CONTEST_ACTIVITY, {
            type: 'user_joined',
            contestId,
            contestName: updatedContest.name,
            contestCode: updatedContest.contest_code,
            userAddress: wallet_address,
            userDisplayName: displayName,
            currentParticipants: updatedContest.participant_count,
            maxParticipants: updatedContest.max_participants || 'unlimited',
            entryFee: updatedContest.entry_fee.toString(),
            prizePool: updatedContest.prize_pool.toString(),
            startTime: updatedContest.start_time.toISOString()
          });
          
          logApi.info(`📢 Discord notification sent for user joining contest ${updatedContest.contest_code}`);
        }
      } catch (discordError) {
        logApi.warn(`Failed to send Discord notification for contest join: ${discordError.message}`);
      }

      // Return the participation and transaction
      return {
        participation,
        transaction: {
          id: transaction.id,
          blockchain_tx_id: blockchainTx.id,
          signature: transaction_signature,
          slot: verificationResult.slot
        }
      };
    });

    // Return the result
    res.json(result);

  } catch (error) {
    // Log error
    const duration = Date.now() - startTime;
    logApi.error(`💥 ${colors.red}Error in join contest endpoint${colors.reset}`, {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error?.code,
        meta: error?.meta,
        stack: error.stack,
        cause: error.cause
      },
      duration
    });

    // Handle ContestError
    if (error instanceof ContestError) {
      return res.status(error.statusCode).json({
        error: error.message,
        ...(error.details && { details: error.details })
      });
    }

    // Handle Prisma errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return res.status(400).json({
        error: 'Database operation failed',
        details: error.message,
        meta: error.meta
      });
    }

    // Return a generic error message
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
});

/**
 * @swagger
 * /api/contests/{id}:
 *   put:
 *     summary: Update contest details
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               entry_fee:
 *                 type: string
 *               start_time:
 *                 type: string
 *                 format: date-time
 *               end_time:
 *                 type: string
 *                 format: date-time
 *               allowed_buckets:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Contest updated successfully
 */
// Update the details of a contest (SUPERADMIN ONLY)
//   example: PUT https://degenduel.me/api/contests/10
//      body: { "name": "World Trade Center Rememberance Contest", "contest_code": "WTC-2001-911", "entry_fee": "0.911", "start_time": "2025-02-01T00:00:00Z", "end_time": "2025-02-07T23:59:59Z", "min_participants": 3, "max_participants": 100, "allowed_buckets": [1, 2, 3, 4, 5, 6, 7, 8, 9] }
//      headers: { "Authorization": "Bearer <JWT>" }
router.put('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const requestId = crypto.randomUUID();
  const contestId = parseInt(req.params.id);

  try {
    const {
      name,
      contest_code,
      description,
      entry_fee,
      prize_pool,
      current_prize_pool,
      start_time,
      end_time,
      entry_deadline,
      min_participants,
      max_participants,
      allowed_buckets,
      participant_count,
      last_entry_time,
      status,
      settings,
      cancelled_at,
      cancellation_reason
    } = req.body;

    // Log the request
    logApi.info('Contest update request received:', {
      requestId,
      contestId,
      body: req.body,
      headers: req.headers
    });

    // Validate contest exists
    const existingContest = await prisma.contests.findUnique({
      where: { id: contestId }
    });

    if (!existingContest) {
      logApi.warn('Contest not found:', {
        requestId,
        contestId
      });
      throw new ContestError('Contest not found', 404);
    }

    // Helper function to safely convert to Decimal
    const toDecimal = (value) => {
      if (value === undefined || value === null) return undefined;
      if (value === '') return null;
      const cleaned = value.toString().replace(/,|\s/g, '');
      return new Decimal(cleaned);
    };

    // Helper function to safely convert to Date
    const toDate = (value) => {
      if (value === undefined || value === null) return undefined;
      if (value === '') return null;
      return new Date(value);
    };

    // Helper function to safely convert to integer
    const toInt = (value) => {
      if (value === undefined || value === null) return undefined;
      if (value === '') return null;
      return parseInt(value);
    };

    // Prepare update data with exact field matching and type conversion
    const updateData = {
      ...(name !== undefined && { name }),
      ...(contest_code !== undefined && { contest_code }),
      ...(description !== undefined && { description }),
      ...(entry_fee !== undefined && { entry_fee: toDecimal(entry_fee) }),
      ...(prize_pool !== undefined && { prize_pool: toDecimal(prize_pool) }),
      ...(current_prize_pool !== undefined && { current_prize_pool: toDecimal(current_prize_pool) }),
      ...(start_time !== undefined && { start_time: toDate(start_time) }),
      ...(end_time !== undefined && { end_time: toDate(end_time) }),
      ...(entry_deadline !== undefined && { entry_deadline: toDate(entry_deadline) }),
      ...(min_participants !== undefined && { min_participants: toInt(min_participants) }),
      ...(max_participants !== undefined && { max_participants: toInt(max_participants) }),
      ...(allowed_buckets !== undefined && { allowed_buckets }),
      ...(participant_count !== undefined && { participant_count: toInt(participant_count) }),
      ...(last_entry_time !== undefined && { last_entry_time: toDate(last_entry_time) }),
      ...(status !== undefined && { status }),
      ...(settings !== undefined && { 
        settings: typeof settings === 'string' ? JSON.parse(settings) : settings 
      }),
      ...(cancelled_at !== undefined && { cancelled_at: toDate(cancelled_at) }),
      ...(cancellation_reason !== undefined && { cancellation_reason }),
      updated_at: new Date()
    };

    logApi.info('Attempting Prisma update:', {
      requestId,
      contestId,
      updateData: JSON.stringify(updateData, (key, value) => 
        value instanceof Decimal ? value.toString() : value
      )
    });

    // Attempt to update the contest
    try {
      const contest = await prisma.contests.update({
        where: { id: contestId },
        data: updateData
      });

      // Log success
      logApi.info('Contest updated successfully:', {
        requestId,
        contestId,
        contest: JSON.stringify(contest, (key, value) => 
          value instanceof Decimal ? value.toString() : value
        )
      });

      // Return the contest
      res.json(contest);
    } catch (prismaError) {
      // Log error
      logApi.error('Prisma update failed:', {
        requestId,
        error: {
          name: prismaError.name,
          message: prismaError.message,
          code: prismaError.code,
          meta: prismaError.meta,
          stack: prismaError.stack
        },
        query: prismaError.query
      });
      throw prismaError;
    }

  } catch (error) {
    // Log error
    logApi.error('Error in contest update:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });

    // Return a generic error message
    res.status(500).json({
      error: 'Failed to update contest',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
});

/**
 * @swagger
 * /api/contests/{id}/start:
 *   post:
 *     summary: Start a contest
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contest ID
 *     responses:
 *       200:
 *         description: Contest started successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contest'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Not enough participants"
 *       404:
 *         $ref: '#/components/responses/ContestNotFound'
 */
// "Start" a contest (<< doesn't actually start it; starts are timed. this just sets the status to active). (ADMIN ONLY)
//   example: POST https://degenduel.me/api/contests/1/start
//      body: { "wallet_address": "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp" }
//      headers: { "Authorization": "Bearer <JWT>" }
router.post('/:id/start', requireAuth, requireAdmin, async (req, res) => {
  try {
    const contest = await prisma.contests.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        _count: { select: { contest_participants: true } }
      }
    });

    // Check if contest exists
    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    // Check if contest is pending
    if (contest.status !== 'pending') {
      return res.status(400).json({ error: 'Contest cannot be started' });
    }

    // Check if there are enough participants
    if (contest._count.contest_participants < (contest.min_participants || 2)) {
      return res.status(400).json({ error: 'Not enough participants' });
    }

    // Update contest status
    const updatedContest = await prisma.contests.update({
      where: { id: parseInt(req.params.id) },
      data: {
        status: 'active',
        start_time: new Date(),
        updated_at: new Date()
      }
    });

    // Return the updated contest
    res.json(updatedContest);
  } catch (error) {
    // Log error
    logApi.error('Failed to start contest:', error);
    res.status(500).json({ error: 'Failed to start contest' });
  }
});

/**
 * @swagger
 * /api/contests/{id}/end:
 *   post:
 *     summary: End a contest and calculate winners
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contest ID
 *     responses:
 *       200:
 *         description: Contest ended successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contest:
 *                   $ref: '#/components/schemas/Contest'
 *                 rankings:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       wallet_address:
 *                         type: string
 *                       rank:
 *                         type: integer
 *                       final_balance:
 *                         type: string
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Contest is not active"
 *       404:
 *         $ref: '#/components/responses/ContestNotFound'
 */
// End a contest and calculate winners
router.post('/:id/end', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Start a transaction
    const result = await prisma.$transaction(async (prisma) => {
      // Find the contest
      const contest = await prisma.contests.findUnique({
        where: { id: parseInt(req.params.id) },
        include: {
          contest_participants: {
            orderBy: { current_balance: 'desc' }
          }
        }
      });

      // Check if contest exists
      if (!contest) {
        throw new Error('Contest not found');
      }

      // Check if contest is active
      if (contest.status !== 'active') {
        throw new Error('Contest is not active');
      }
      
      // Update participant rankings
      const participants = contest.contest_participants;
      for (let i = 0; i < participants.length; i++) {
        const participant = participants[i];
        await prisma.contest_participants.update({
          where: {
            contest_id_wallet_address: {
              contest_id: contest.id,
              wallet_address: participant.wallet_address
            }
          },
          data: {
            final_rank: i + 1
          }
        });

        // Check for and award a referral contest bonus if participant placed in top N
        const nTopN = 3;
        const isTopN = i < nTopN;
        if (isTopN) {
          await ReferralService.awardContestBonus(participant.wallet_address, contest.id);
        }
      }

      // Update contest status
      const updatedContest = await prisma.contests.update({
        where: { id: parseInt(req.params.id) },
        data: {
          status: 'completed',
          end_time: new Date(),
          updated_at: new Date()
        }
      });

      // Return the updated contest and rankings
      return {
        contest: updatedContest,
        rankings: participants.map((p, index) => ({
          wallet_address: p.wallet_address,
          rank: index + 1,
          final_balance: p.current_balance
        }))
      };
    });

    // Return the result
    res.json(result);
  } catch (error) {
    // Log error
    logApi.error('Failed to end contest:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/contests/{id}/leaderboard:
 *   get:
 *     summary: Get contest leaderboard
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contest ID
 *     responses:
 *       200:
 *         description: Contest leaderboard
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/ContestParticipant'
 *                   - type: object
 *                     properties:
 *                       users:
 *                         type: object
 *                         properties:
 *                           nickname:
 *                             type: string
 *                           wallet_address:
 *                             type: string
 *       404:
 *         $ref: '#/components/responses/ContestNotFound'
 */
/* 
 *  Get a contest's "leaderboard"(*)
 *    This is a misnomer. 
 *      It's not actually the contest's leaderboard.
 *      It's just the list of participants sorted by the User's 'balance' 
 *        (or 'points', or 'D.D. Bux', or whatever else refer to them as).
 * 
 *  IDEALLY, 
 *     Points should be a property of a Portfolio;
 *     and a Portfolio should be a property of a Participant;
 *     and a Participant should be a property of a Contest.
 * 
 *  AS IT STANDS,
 *     Points ('balance' in Users table) is property of a Participant a.k.a. a User -- :p (BAD)
 *     and a Participant is a property of a Contest.
 * 
 *  AND EVENTUALLY,
 *     Points should be a property of a Portfolio;
 *     and a Portfolio should be a property of a Participant;
 *     and a Participant should be a property of a Contest;
 *     and a Contest should be a property of a Contest_Series;
 *     and a Contest_Series should be a property of a Contest_Series_Season (...)
 * 
 * 
 *   ^ ALL OF THE ABOVE IS ANCIENT CODE; LEADERBOARD IS PROBABLY BROKEN!
 *  
 */
// Get a contest's "leaderboard"(*) (NO AUTH REQUIRED)
router.get('/:id/leaderboard', async (req, res) => {
  try {
    const leaderboard = await prisma.contest_participants.findMany({
      where: {
        contest_id: parseInt(req.params.id)
      },
      include: {
        users: {
          select: {
            nickname: true,
            wallet_address: true
          }
        }
      },
      orderBy: {
        current_balance: 'desc'
      }
    });

    res.json(leaderboard);
  } catch (error) {
    logApi.error('Failed to fetch leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * @swagger
 * /api/contests/{id}/portfolio:
 *   post:
 *     summary: Submit or update contest portfolio
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contest ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet_address
 *               - tokens
 *             properties:
 *               wallet_address:
 *                 type: string
 *                 example: "0x1234..."
 *               tokens:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - token_id
 *                     - weight
 *                   properties:
 *                     token_id:
 *                       type: integer
 *                       example: 1
 *                     weight:
 *                       type: integer
 *                       minimum: 0
 *                       maximum: 100
 *                       example: 50
 *     responses:
 *       200:
 *         description: Portfolio updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Portfolio'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Not a participant in this contest"
 *       404:
 *         $ref: '#/components/responses/ContestNotFound'
 */
// Submit or update contest portfolio (AUTHENTICATED)
//   example: POST https://degenduel.me/api/contests/{contest_id}/portfolio
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "tokens": [{"token_id": 1, "weight": 50}, {"token_id": 2, "weight": 50}] }
router.post('/:id/portfolio', requireAuth, async (req, res) => {
  const { wallet_address, tokens } = req.body;
  const contestId = parseInt(req.params.id);

  try {
    const result = await prisma.$transaction(async (prisma) => {
      // Verify contest and participation
      const participant = await prisma.contest_participants.findUnique({
        where: {
          contest_id_wallet_address: {
            contest_id: contestId,
            wallet_address
          }
        }
      });

      if (!participant) {
        throw new Error('Not a participant in this contest');
      }

      // Get current portfolio state
      const currentPortfolio = await prisma.contest_portfolios.findMany({
        where: {
          contest_id: contestId,
          wallet_address
        }
      });

      // Create a map of current weights
      const currentWeights = new Map(
        currentPortfolio.map(p => [p.token_id, p.weight])
      );

      // Get latest token prices
      const latestPrices = await Promise.all(
        tokens.map(token =>
          prisma.contest_token_prices.findFirst({
            where: {
              contest_id: contestId,
              token_id: token.token_id
            },
            orderBy: {
              timestamp: 'desc'
            }
          })
        )
      );

      if (latestPrices.some(price => !price)) {
        throw new Error('Price data not available for all tokens');
      }

      // Record trades for each token weight change
      const trades = await Promise.all(
        tokens.map(async (token, index) => {
          const currentWeight = currentWeights.get(token.token_id) || 0;
          const newWeight = token.weight;

          if (currentWeight !== newWeight) {
            return prisma.contest_portfolio_trades.create({
              data: {
                contest_id: contestId,
                wallet_address,
                token_id: token.token_id,
                type: newWeight > currentWeight ? 'BUY' : 'SELL',
                old_weight: currentWeight,
                new_weight: newWeight,
                price_at_trade: latestPrices[index].price,
                virtual_amount: new Decimal(Math.abs(newWeight - currentWeight)).mul(1000)
              }
            });
          }
        })
      );

      // Update portfolio entries
      await prisma.contest_portfolios.deleteMany({
        where: {
          contest_id: contestId,
          wallet_address
        }
      });

      const portfolioEntries = await Promise.all(
        tokens.map(token =>
          prisma.contest_portfolios.create({
            data: {
              contest_id: contestId,
              wallet_address,
              token_id: token.token_id,
              weight: token.weight
            }
          })
        )
      );

      return {
        portfolio: portfolioEntries,
        trades: trades.filter(t => t) // Remove null entries where weight didn't change
      };
    });

    res.json(result);
  } catch (error) {
    logApi.error('Failed to update portfolio:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/contests/{id}/portfolio/{wallet}:
 *   get:
 *     summary: Get user's contest portfolio
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contest ID
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     responses:
 *       200:
 *         description: User's contest portfolio
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/Portfolio'
 *                   - type: object
 *                     properties:
 *                       tokens:
 *                         $ref: '#/components/schemas/Token'
 *       404:
 *         description: Portfolio not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Portfolio not found"
 */
// Get user's contest portfolio (AUTHENTICATED)
//   example: GET https://degenduel.me/api/contests/{contest_id}/portfolio
//      headers: { "Cookie": "session=<jwt>" }
router.get('/:id/portfolio/:wallet', requireAuth, async (req, res) => {
  try {
    const portfolio = await prisma.contest_portfolios.findMany({
      where: {
        contest_id: parseInt(req.params.id),
        wallet_address: req.params.wallet
      },
      select: {
        contest_id: true,
        wallet_address: true,
        token_id: true,
        weight: true,
        created_at: true,
        tokens: {
          select: {
            address: true,
            symbol: true,
            name: true,
            decimals: true,
            is_active: true,
            market_cap: true,
            change_24h: true,
            volume_24h: true
          }
        }
      }
    });

    res.json(portfolio);
  } catch (error) {
    logApi.error('Failed to fetch portfolio:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

/*
// Additional endpoints would include:
// PUT /contests/{id} - Update contest
// POST /contests/{id}/start - Start contest
// POST /contests/{id}/end - End contest
// GET /contests/{id}/leaderboard - Get contest leaderboard
// POST /contests/{id}/portfolio - Submit/update portfolio
// GET /contests/{id}/portfolio/{wallet} - Get user's portfolio
*/

// Custom error class for contest-related errors
//   example: throw new ContestError('Contest not found', 404);
class ContestError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.name = 'ContestError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * @swagger
 * /api/contests/participations/{wallet}:
 *   get:
 *     summary: Get all contests that a user is participating in
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address to check
 *     responses:
 *       200:
 *         description: List of contests the user is participating in
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 participations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       contest_id:
 *                         type: integer
 *                       contest:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           status:
 *                             type: string
 *                       initial_balance:
 *                         type: string
 *                       current_balance:
 *                         type: string
 *                       rank:
 *                         type: integer
 *                       final_rank:
 *                         type: integer
 *       400:
 *         description: Invalid wallet address
 */
// Get all contests that a user is participating in (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/contests/participations/BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp
router.get('/participations/:wallet', async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const wallet_address = req.params.wallet;
  
  if (!wallet_address) {
    return res.status(400).json({
      error: 'Invalid wallet address'
    });
  }
  
  try {
    // Check cache first
    const cacheKey = `wallet:participations:${wallet_address}`;
    const cachedResult = await cache.get(cacheKey);
    
    if (cachedResult) {
      // Only log in verbose mode since these are common requests
      if (config.logging.verbose) {
        logApi.info(`[\x1b[38;5;51mroutes/contests\x1b[0m] 🔍 User contest participations check (\x1b[38;5;46mCACHE HIT\x1b[0m)`, {
          wallet_address,
          participationCount: cachedResult.participations.length
        });
      }
      
      return res.json(cachedResult);
    }
    
    // Find all contest participations for this wallet
    const participations = await prisma.contest_participants.findMany({
      where: {
        wallet_address
      },
      include: {
        contests: {
          select: {
            id: true,
            name: true,
            contest_code: true,
            description: true,
            status: true,
            start_time: true,
            end_time: true,
            entry_fee: true,
            prize_pool: true,
            participant_count: true
          }
        }
      },
      orderBy: [
        { joined_at: 'desc' }
      ]
    });
    
    // Format the response data
    const responseData = {
      participations: participations.map(p => ({
        ...p,
        // Convert Decimal fields to strings for JSON serialization
        initial_balance: p.initial_dxd_points.toString(),
        current_balance: p.current_dxd_points.toString(),
        // Rename the contests field to contest for clearer naming
        contest: {
          ...p.contests,
          // Convert Decimal fields
          entry_fee: p.contests.entry_fee?.toString(),
          prize_pool: p.contests.prize_pool?.toString(),
        },
        contests: undefined
      }))
    };
    
    // Cache the result for 5 minutes (300 seconds)
    await cache.set(cacheKey, responseData, 300);
    
    // Only log in verbose mode since these are common requests
    if (config.logging.verbose) {
      logApi.info(`[\x1b[38;5;51mroutes/contests\x1b[0m] 🔍 User contest participations check (\x1b[38;5;208mDB HIT\x1b[0m)`, {
        wallet_address,
        participationCount: participations.length
      });
    }
    
    return res.json(responseData);
    
  } catch (error) {
    logApi.error(`[\x1b[38;5;51mroutes/contests\x1b[0m] \x1b[38;5;196mError fetching user contest participations\x1b[0m`, {
      wallet_address,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    });
    
    res.status(500).json({
      error: 'Failed to fetch user contest participations',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
});

/**
 * @swagger
 * /api/contests/{id}/check-participation:
 *   get:
 *     summary: Check if a user is participating in a specific contest
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contest ID
 *       - in: query
 *         name: wallet_address
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address to check
 *     responses:
 *       200:
 *         description: Participation status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 is_participating:
 *                   type: boolean
 *                   example: true
 *                 participant_data:
 *                   type: object
 *                   nullable: true
 *                   description: Participant data if participating, null otherwise
 *       404:
 *         description: Contest not found
 */
// Check if a user is participating in a contest (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/contests/1/check-participation?wallet_address=BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp
router.get('/:id/check-participation', async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { wallet_address } = req.query;
  const contestId = parseInt(req.params.id);
  
  if (!wallet_address) {
    return res.status(400).json({
      error: 'Missing wallet_address parameter'
    });
  }
  
  if (isNaN(contestId)) {
    return res.status(400).json({
      error: 'Invalid contest ID'
    });
  }
  
  try {
    // Check cache first
    const cacheKey = `participation:${contestId}:${wallet_address}`;
    const cachedResult = await cache.get(cacheKey);
    
    if (cachedResult) {
      // Only log in verbose mode since these are common requests
      if (config.logging.verbose) {
        logApi.info(`[\x1b[38;5;51mroutes/contests\x1b[0m] 🔍 Contest participation check (\x1b[38;5;46mCACHE HIT\x1b[0m)`, {
          contestId,
          wallet_address,
          isParticipating: cachedResult.is_participating
        });
      }
      
      return res.json(cachedResult);
    }
    
    // Check if contest exists
    const contest = await prisma.contests.findUnique({
      where: { id: contestId }
    });
    
    // If contest not found, return 404
    if (!contest) {
      return res.status(404).json({
        error: 'Contest not found'
      });
    }
    
    // Check if user is a participant
    const participant = await prisma.contest_participants.findUnique({
      where: {
        contest_id_wallet_address: {
          contest_id: contestId,
          wallet_address
        }
      }
    });
    
    // Prepare response data
    const responseData = {
      is_participating: !!participant,
      participant_data: participant || null
    };
    
    // Cache the result for 5 minutes (300 seconds)
    const cacheDuration = 5 * 60; // 5 minutes in seconds
    await cache.set(cacheKey, responseData, cacheDuration);
    
    // Only log in verbose mode since these are common requests
    if (config.logging.verbose) {
      logApi.info(`[\x1b[38;5;51mroutes/contests\x1b[0m] 🔍 Contest participation check (\x1b[38;5;208mDB HIT\x1b[0m)`, {
        contestId,
        wallet_address,
        isParticipating: !!participant
      });
    }
    
    return res.json(responseData);
    
  } catch (error) {
    logApi.error(`[\x1b[38;5;51mroutes/contests\x1b[0m] \x1b[38;5;196mError checking contest participation\x1b[0m`, {
      contestId,
      wallet_address,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    });
    
    res.status(500).json({
      error: 'Failed to check contest participation',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
});

/**
 * @swagger
 * /api/contests/user-participations:
 *   get:
 *     summary: Get all contests that a user is participating in
 *     tags: [Contests]
 *     parameters:
 *       - in: query
 *         name: wallet_address
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address to check
 *     responses:
 *       200:
 *         description: List of contests the user is participating in
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 participations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       contest_id:
 *                         type: integer
 *                       contest:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           status:
 *                             type: string
 *                       initial_balance:
 *                         type: string
 *                       current_balance:
 *                         type: string
 *                       rank:
 *                         type: integer
 *                       final_rank:
 *                         type: integer
 *       400:
 *         description: Missing wallet address
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Missing wallet_address parameter"
 */
// Get all contests that a user is participating in (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/contests/user-participations?wallet_address=BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp
router.get('/user-participations', async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { wallet_address } = req.query;
  
  if (!wallet_address) {
    return res.status(400).json({
      error: 'Missing wallet_address parameter'
    });
  }
  
  try {
    // Find all contest participations for this wallet
    const participations = await prisma.contest_participants.findMany({
      where: {
        wallet_address
      },
      include: {
        contests: {
          select: {
            id: true,
            name: true,
            contest_code: true,
            description: true,
            status: true,
            start_time: true,
            end_time: true,
            entry_fee: true,
            prize_pool: true,
            participant_count: true
          }
        }
      },
      orderBy: [
        { joined_at: 'desc' }
      ]
    });
    
    logApi.info(`🔍 ${fancyColors.CYAN}[routes/contests]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.BLACK}User contest participations check${fancyColors.RESET}`, {
    //  requestId,
    //  wallet_address,
    //  participationCount: participations.length,
    //  duration: Date.now() - startTime
    });
    
    return res.json({
      participations: participations.map(p => ({
        ...p,
        // Convert Decimal fields to strings for JSON serialization
        initial_balance: p.initial_dxd_points.toString(),
        current_balance: p.current_dxd_points.toString(),
        // Rename the contests field to contest for clearer naming
        contest: {
          ...p.contests,
          // Convert Decimal fields
          entry_fee: p.contests.entry_fee?.toString(),
          prize_pool: p.contests.prize_pool?.toString(),
        },
        contests: undefined
      }))
    });
    
  } catch (error) {
    logApi.error(`💥 ${fancyColors.RED}[routes/contests]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.BLACK}Error fetching user contest participations${fancyColors.RESET}\n`, {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      duration: Date.now() - startTime
    });
    
    res.status(500).json({
      error: 'Failed to fetch user contest participations',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
});

export default router;