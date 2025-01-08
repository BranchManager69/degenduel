import express from 'express';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

const router = express.Router();
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

/**
 * @swagger
 * tags:
 *   name: Contests
 *   description: API endpoints for contest management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Contest:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         contest_code:
 *           type: string
 *           example: "WEEKLY-001"
 *         name:
 *           type: string
 *           example: "Weekly Crypto Challenge"
 *         description:
 *           type: string
 *           example: "Compete in our weekly trading contest"
 *         start_time:
 *           type: string
 *           format: date-time
 *         end_time:
 *           type: string
 *           format: date-time
 *         entry_fee:
 *           type: string
 *           example: "1000000"
 *         prize_pool:
 *           type: string
 *           example: "10000000"
 *         status:
 *           type: string
 *           enum: [pending, active, completed, cancelled]
 *         participant_count:
 *           type: integer
 *           example: 42
 *         min_participants:
 *           type: integer
 *           example: 2
 *         max_participants:
 *           type: integer
 *           example: 100
 *         allowed_buckets:
 *           type: array
 *           items:
 *             type: integer
 *           example: [1, 2, 3]
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
router.get('/', async (req, res) => {
  try {
    const { status, limit = 10, offset = 0 } = req.query;
    
    const where = status ? { status } : {};
    
    const [contests, total] = await Promise.all([
      prisma.contests.findMany({
        where,
        include: {
          _count: {
            select: {
              contest_participants: true
            }
          }
        },
        take: parseInt(limit),
        skip: parseInt(offset),
        orderBy: {
          created_at: 'desc'
        }
      }),
      prisma.contests.count({ where })
    ]);

    res.json({
      contests,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logger.error('Failed to fetch contests:', error);
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
    logger.error('Failed to fetch contest:', error);
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
 *               contest_code:
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
 *               min_participants:
 *                 type: integer
 *               max_participants:
 *                 type: integer
 *               allowed_buckets:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       201:
 *         description: Contest created successfully
 */
router.post('/', async (req, res) => {
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

    const contest = await prisma.contests.create({
      data: {
        name,
        contest_code,
        description,
        entry_fee: entry_fee ? BigInt(entry_fee) : BigInt(0),
        start_time: new Date(start_time),
        end_time: new Date(end_time),
        min_participants,
        max_participants,
        allowed_buckets,
        status: 'pending'
      }
    });

    res.status(201).json(contest);
  } catch (error) {
    logger.error('Failed to create contest:', error);
    res.status(500).json({ error: 'Failed to create contest' });
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
router.post('/:id/join', async (req, res) => {
  const { wallet_address } = req.body;
  const contestId = parseInt(req.params.id);

  try {
    // Start a transaction since we need to perform multiple operations
    const result = await prisma.$transaction(async (prisma) => {
      // Check if contest exists and is joinable
      const contest = await prisma.contests.findUnique({
        where: { id: contestId },
        include: {
          _count: {
            select: { contest_participants: true }
          }
        }
      });

      if (!contest) {
        throw new Error('Contest not found');
      }

      if (contest.status !== 'pending') {
        throw new Error('Contest is not open for entry');
      }

      if (contest._count.contest_participants >= (contest.max_participants || 0)) {
        throw new Error('Contest is full');
      }

      // Check if user has enough balance
      const user = await prisma.users.findUnique({
        where: { wallet_address }
      });

      if (!user) {
        throw new Error('User not found');
      }

      if (BigInt(user.balance) < BigInt(contest.entry_fee)) {
        throw new Error('Insufficient balance');
      }

      // Create participation record
      const participation = await prisma.contest_participants.create({
        data: {
          contest_id: contestId,
          wallet_address,
          initial_balance: BigInt(1000000), // Your default starting amount
          current_balance: BigInt(1000000)
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

      return participation;
    });

    res.json(result);
  } catch (error) {
    logger.error('Failed to join contest:', error);
    res.status(500).json({ error: error.message });
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
router.put('/:id', async (req, res) => {
  try {
    const {
      name,
      description,
      entry_fee,
      start_time,
      end_time,
      allowed_buckets
    } = req.body;

    const contest = await prisma.contests.update({
      where: { id: parseInt(req.params.id) },
      data: {
        name,
        description,
        entry_fee: entry_fee ? BigInt(entry_fee) : undefined,
        start_time: start_time ? new Date(start_time) : undefined,
        end_time: end_time ? new Date(end_time) : undefined,
        allowed_buckets,
        updated_at: new Date()
      }
    });

    res.json(contest);
  } catch (error) {
    logger.error('Failed to update contest:', error);
    res.status(500).json({ error: 'Failed to update contest' });
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
router.post('/:id/start', async (req, res) => {
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
    logger.error('Failed to start contest:', error);
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
router.post('/:id/end', async (req, res) => {
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
    logger.error('Failed to end contest:', error);
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
    logger.error('Failed to fetch leaderboard:', error);
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
router.post('/:id/portfolio', async (req, res) => {
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
    logger.error('Failed to update portfolio:', error);
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
router.get('/:id/portfolio/:wallet', async (req, res) => {
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
    logger.error('Failed to fetch portfolio:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

// Additional endpoints would include:
// PUT /contests/{id} - Update contest
// POST /contests/{id}/start - Start contest
// POST /contests/{id}/end - End contest
// GET /contests/{id}/leaderboard - Get contest leaderboard
// POST /contests/{id}/portfolio - Submit/update portfolio
// GET /contests/{id}/portfolio/{wallet} - Get user's portfolio

export default router;
