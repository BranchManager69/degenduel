
import pkg from '@prisma/client';
import express from 'express';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';
const { Prisma, PrismaClient } = pkg;

const router = express.Router();
const prisma = new PrismaClient();

// For Decimal type and error handling
const { Decimal } = pkg.Prisma;
const { PrismaClientKnownRequestError } = pkg;

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
 *               allOf:
 *                 - $ref: '#/components/schemas/Contest'
 *                 - type: object
 *                   properties:
 *                     contest_participants:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ContestParticipant'
 *                     contest_portfolios:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Portfolio'
 *       404:
 *         $ref: '#/components/responses/ContestNotFound'
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
        }
      }
    });

    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    res.json(contest);
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

        // Use the cleaned string directly without Number conversion
        parsedEntryFee = cleanedFee;
      } else if (typeof entry_fee === 'number') {
        // Handle number input
        if (!Number.isFinite(entry_fee)) {
          throw new Error('Invalid number');
        }
        // Convert to string with full precision
        parsedEntryFee = entry_fee.toString();
      } else {
        throw new Error('Invalid entry fee type');
      }

      // Validate the value is non-negative using Prisma.Decimal for precise comparison
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

    logApi.info({
      requestId,
      message: 'Contest created successfully',
      data: {
        contest_id: contest.id,
        contest_code: contest.contest_code
      },
      duration: Date.now() - startTime
    });

    res.status(201).json(contest);
  } catch (error) {
    logApi.error({
      requestId,
      message: 'Failed to create contest',
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        meta: error.meta
      },
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      duration: Date.now() - startTime
    });
    
    // Handle specific database errors
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'Contest code already exists',
        field: error.meta?.target?.[0]
      });
    }

    // Handle other specific Prisma errors
    if (error.name === 'PrismaClientValidationError') {
      return res.status(400).json({
        error: 'Invalid data format',
        details: error.message
      });
    }

    res.status(500).json({
      error: 'Failed to create contest',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
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
 *             properties:
 *               wallet_address:
 *                 type: string
 *                 example: "0x1234..."
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
//   example: POST https://degenduel.me/api/contests/1/join
//      body: { "wallet_address": "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp" }
//      headers: { "Authorization": "Bearer <JWT>" }
router.post('/:id/join', requireAuth, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { wallet_address } = req.body;
  const contestId = parseInt(req.params.id);

  logApi.info('Attempting to join contest', {
    requestId,
    contestId,
    wallet_address,
  });

  try {
    // Input validation
    if (!wallet_address) {
      logApi.warn('Missing wallet address in join contest request', {
        requestId
      });
      return res.status(400).json({ 
        error: 'Invalid request',
        details: 'wallet_address is required'
      });
    }

    if (isNaN(contestId)) {
      logApi.warn('Invalid contest ID format', {
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
      logApi.debug('Fetching contest details', {
        requestId,
        contestId
      });

      const contest = await prisma.contests.findUnique({
        where: { id: contestId },
        include: {
          _count: {
            select: { contest_participants: true }
          }
        }
      });

      if (!contest) {
        throw new ContestError('Contest not found', 404);
      }

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
        throw new ContestError(`You've already got a spot reserved at this table.`, 409);
      }

      // Check if user exists
      const user = await prisma.users.findUnique({
        where: { wallet_address }
      });

      if (!user) {
        throw new ContestError('You\'ve gotta login it to win it, buddy...', 404);
      }

      // Validate contest status #TODO: remove this
      if (contest.status !== 'pending') {
        throw new ContestError('Hey, this table isn\'t supposed to be open right now. How did you get here?', 400, {
          status: contest.status
        });
      }

      // Check participant limits #TODO: fix this (max_participants is not being set properly initially via CreateContestModal)
      if (contest._count.contest_participants >= (contest.max_participants || 0)) {
        throw new ContestError('Sorry, there are no more open seats at this table.', 400, {
          currentParticipants: contest._count.contest_participants,
          maxParticipants: contest.max_participants
        });
      }

      // Convert and validate balances
      const userBalance = new Decimal(user.balance || '0');
      const entryFee = new Decimal(contest.entry_fee || '0');

      logApi.info('Balance validation', {
        requestId,
        contestId,
        userBalance: userBalance.toString(),
        entryFee: entryFee.toString()
      });

      if (userBalance.lessThan(entryFee)) {
        const requiredFormatted = entryFee.dividedBy(1000000).toFixed(2);
        const availableFormatted = userBalance.dividedBy(1000000).toFixed(2);
        
        throw new ContestError(
          `Insufficient balance!\nRequired: ${requiredFormatted} points. Available: ${availableFormatted} points.`,
          400,
          {
            required: entryFee.toString(),
            available: userBalance.toString(),
            difference: entryFee.minus(userBalance).toString()
          }
        );
      }

      // Create participation record
      const participation = await prisma.contest_participants.create({
        data: {
          contest_id: contestId,
          wallet_address,
          initial_balance: new Decimal(10000000),
          current_balance: new Decimal(10000000)
        }
      });

      // Update contest participant count
      await prisma.contests.update({
        where: { id: contestId },
        data: {
          participant_count: {
            increment: 1
          }
        }
      });

      // Deduct entry fee
      await prisma.users.update({
        where: { wallet_address },
        data: {
          balance: userBalance.minus(entryFee).toString()
        }
      });

      logApi.info('Successfully joined contest', {
        requestId,
        contestId,
        wallet_address,
        participationId: participation.id
      });

      return participation;
    });

    res.json(result);

  } catch (error) {
    logApi.error('Error in join contest endpoint', {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error?.code,
        meta: error?.meta
      },
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      duration: Date.now() - startTime
    });

    if (error instanceof ContestError) {
      return res.status(error.statusCode).json({
        error: error.message,
        ...(error.details && { details: error.details })
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return res.status(400).json({
        error: 'Database operation failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }

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

    try {
      const contest = await prisma.contests.update({
        where: { id: contestId },
        data: updateData
      });

      logApi.info('Contest updated successfully:', {
        requestId,
        contestId,
        contest: JSON.stringify(contest, (key, value) => 
          value instanceof Decimal ? value.toString() : value
        )
      });

      res.json(contest);
    } catch (prismaError) {
      logApi.error('Prisma update failed:', {
        requestId,
        error: {
          name: prismaError.name,
          message: prismaError.message,
          code: prismaError.code,
          meta: prismaError.meta
        },
        query: prismaError.query,
        stack: process.env.NODE_ENV === 'development' ? prismaError.stack : undefined
      });
      throw prismaError;
    }

  } catch (error) {
    logApi.error('Contest update failed:', {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        meta: error.meta
      },
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      body: JSON.stringify(req.body)
    });

    if (error instanceof ContestError) {
      return res.status(error.statusCode).json({
        error: error.message,
        ...(error.details && { details: error.details })
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return res.status(400).json({
        error: 'Database operation failed',
        details: process.env.NODE_ENV === 'development' ? {
          code: error.code,
          meta: error.meta,
          message: error.message
        } : undefined
      });
    }

    res.status(500).json({
      error: 'Failed to update contest',
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        code: error.code,
        meta: error.meta
      } : undefined
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

    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    if (contest.status !== 'pending') {
      return res.status(400).json({ error: 'Contest cannot be started' });
    }

    if (contest._count.contest_participants < (contest.min_participants || 2)) {
      return res.status(400).json({ error: 'Not enough participants' });
    }

    const updatedContest = await prisma.contests.update({
      where: { id: parseInt(req.params.id) },
      data: {
        status: 'active',
        start_time: new Date(),
        updated_at: new Date()
      }
    });

    res.json(updatedContest);
  } catch (error) {
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
// End a contest and calculate winners  (<< doesn't actually end it; ends are timed. this just sets the status to completed). (ADMIN ONLY)
//   example: POST https://degenduel.me/api/contests/1/end
//      body: { "wallet_address": "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp" }
//      headers: { "Authorization": "Bearer <JWT>" }
router.post('/:id/end', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await prisma.$transaction(async (prisma) => {
      const contest = await prisma.contests.findUnique({
        where: { id: parseInt(req.params.id) },
        include: {
          contest_participants: {
            orderBy: { current_balance: 'desc' }
          }
        }
      });

      if (!contest) {
        throw new Error('Contest not found');
      }

      if (contest.status !== 'active') {
        throw new Error('Contest is not active');
      }

      // Update participant rankings
      const participants = contest.contest_participants;
      for (let i = 0; i < participants.length; i++) {
        await prisma.contest_participants.update({
          where: {
            contest_id_wallet_address: {
              contest_id: contest.id,
              wallet_address: participants[i].wallet_address
            }
          },
          data: {
            final_rank: i + 1
          }
        });
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

      return {
        contest: updatedContest,
        rankings: participants.map((p, index) => ({
          wallet_address: p.wallet_address,
          rank: index + 1,
          final_balance: p.current_balance
        }))
      };
    });

    res.json(result);
  } catch (error) {
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
 * 
 * 
 * 
 *   ^ ALL OF THE ABOVE IS ANCIENT CODE; LEADERBOARD IS PROBABLY BROKEN!
 * 
 * 
 * 
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
//   example: POST https://degenduel.me/api/contests/1/portfolio
//      body: { "wallet_address": "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp", "tokens": [{"token_id": 1, "weight": 50}, {"token_id": 2, "weight": 50}] }
//      headers: { "Authorization": "Bearer <JWT>" }
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

      // Delete existing portfolio entries
      await prisma.contest_portfolios.deleteMany({
        where: {
          contest_id: contestId,
          wallet_address
        }
      });

      // Create new portfolio entries
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

      return portfolioEntries;
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
//   example: GET https://degenduel.me/api/contests/1/portfolio/BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp
//      headers: { "Authorization": "Bearer <JWT>" }
router.get('/:id/portfolio/:wallet', requireAuth, async (req, res) => {
  try {
    const portfolio = await prisma.contest_portfolios.findMany({
      where: {
        contest_id: parseInt(req.params.id),
        wallet_address: req.params.wallet
      },
      include: {
        tokens: true
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

export default router;