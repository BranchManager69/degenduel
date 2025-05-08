/**
 * Base Contest Routes
 * 
 * @description Core CRUD operations for contests
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import express from 'express';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { Prisma } from '@prisma/client';
import { createContestWallet } from '../../utils/solana-suite/solana-wallet.js';
import contestImageService from '../../services/contestImageService.js';
import { 
  validateContestParams,
  getAndValidateContest
} from '../../utils/contest-helpers.js';

// Router
const router = express.Router();

// For Decimal type and error handling
const { Decimal } = Prisma;

// Create a dedicated logger for contest operations
const contestLogger = {
  ...logApi.forService('CONTESTS_BASE'),
  analytics: logApi.analytics
};

/**
 * @route GET /api/contests
 * @description Get all contests with optional filters
 * @access Public
 */
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
    contestLogger.error('Failed to fetch contests:', error);
    res.status(500).json({ error: 'Failed to fetch contests' });
  }
});

/**
 * @route GET /api/contests/:id
 * @description Get contest by ID with full details
 * @access Public
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
    contestLogger.error('Failed to fetch contest:', error);
    res.status(500).json({ error: 'Failed to fetch contest' });
  }
});

/**
 * @route POST /api/contests
 * @description Create a new contest
 * @access Private (requires auth)
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const isAdmin = ['admin', 'superadmin'].includes(user.role);
    const body = req.body;

    // Process and sanitize inputs
    const sanitizedData = {
      name: body.name,
      contest_code: body.contest_code,
      description: body.description || '',
      entry_fee: String(body.entry_fee).replace(/,/g, ''),
      start_time: new Date(body.start_time),
      end_time: new Date(body.end_time),
      min_participants: body.min_participants ? parseInt(body.min_participants, 10) : 2,
      max_participants: body.max_participants ? parseInt(body.max_participants, 10) : 100,
      allowed_buckets: body.allowed_buckets || [],
      status: 'pending',
      visibility: body.visibility || 'public'
    };

    // Validate contest parameters
    const validation = validateContestParams(sanitizedData);
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Invalid contest parameters', 
        fields: validation.errors
      });
    }

    // If not admin, check if user has contest creation credits
    if (!isAdmin) {
      const userCredits = await prisma.contest_creation_credits.findFirst({
        where: { wallet_address: user.wallet_address, used: false }
      });

      if (!userCredits) {
        return res.status(403).json({
          error: 'insufficient_credits',
          message: 'You need contest creation credits to create a contest'
        });
      }
    }

    // Check if contest code already exists
    const existingContest = await prisma.contests.findFirst({
      where: { contest_code: sanitizedData.contest_code }
    });

    if (existingContest) {
      return res.status(409).json({
        error: 'contest_code_exists',
        message: 'Contest code already exists',
        field: 'contest_code'
      });
    }

    // Create a Solana wallet for the contest
    let contestWallet;
    try {
      contestWallet = await createContestWallet();
      if (!contestWallet || !contestWallet.publicKey) {
        throw new Error('Failed to create contest wallet');
      }
    } catch (walletError) {
      contestLogger.error('Failed to create contest wallet', walletError);
      return res.status(500).json({
        error: 'wallet_creation_failed',
        message: 'Failed to create contest wallet'
      });
    }

    // Create the contest in a transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Create contest
      const newContest = await tx.contests.create({
        data: {
          ...sanitizedData,
          created_by: user.wallet_address,
          prize_pool: sanitizedData.entry_fee, // Initially set to match entry fee, updated as people join
          contest_wallets: {
            create: {
              wallet_address: contestWallet.publicKey,
              wallet_type: 'contest',
              keypair_encrypted: contestWallet.encryptedKeyPair,
              created_by: user.wallet_address
            }
          }
        }
      });

      // If regular user, mark contest creation credit as used
      if (!isAdmin) {
        await tx.contest_creation_credits.updateMany({
          where: { 
            wallet_address: user.wallet_address, 
            used: false 
          },
          data: { 
            used: true, 
            used_at: new Date(),
            contest_id: newContest.id
          },
          take: 1
        });
      }

      return newContest;
    });

    // Generate contest image in the background (don't wait for it)
    contestImageService.generateContestImage(result.id)
      .catch(error => {
        contestLogger.error('Error generating contest image:', {
          error: error.message,
          contestId: result.id
        });
      });

    // Return the newly created contest
    res.status(201).json({
      ...result,
      wallet_address: contestWallet.publicKey
    });
  } catch (error) {
    contestLogger.error('Failed to create contest:', error);
    
    // Check for known database errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: 'duplicate_contest',
          message: 'A contest with this code already exists',
          field: 'contest_code'
        });
      }
    }
    
    res.status(500).json({ error: 'Failed to create contest', message: error.message });
  }
});

/**
 * @route PUT /api/contests/:id
 * @description Update a contest
 * @access Private (requires admin)
 */
router.put('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id, 10);
    
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Invalid contest ID' });
    }
    
    // Get the existing contest
    const existingContest = await getAndValidateContest(parsedId);
    if (!existingContest) {
      return res.status(404).json({ error: 'Contest not found' });
    }
    
    // Only allow updates to pending contests
    if (existingContest.status !== 'pending') {
      return res.status(400).json({
        error: 'contest_active',
        message: `Cannot update a contest with status "${existingContest.status}"`
      });
    }
    
    const body = req.body;
    const updateData = {};
    
    // Only include fields that are provided in the request
    if (body.name) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.entry_fee) updateData.entry_fee = String(body.entry_fee).replace(/,/g, '');
    if (body.start_time) updateData.start_time = new Date(body.start_time);
    if (body.end_time) updateData.end_time = new Date(body.end_time);
    if (body.min_participants) updateData.min_participants = parseInt(body.min_participants, 10);
    if (body.max_participants) updateData.max_participants = parseInt(body.max_participants, 10);
    if (body.allowed_buckets) updateData.allowed_buckets = body.allowed_buckets;
    if (body.visibility) updateData.visibility = body.visibility;
    
    // Validate the update data
    if (Object.keys(updateData).length > 0) {
      // For validation, merge existing data with updates
      const validationData = { ...existingContest, ...updateData };
      const validation = validateContestParams(validationData);
      
      if (!validation.isValid) {
        return res.status(400).json({
          error: 'Invalid contest parameters',
          fields: validation.errors
        });
      }
      
      // Update contest
      const updatedContest = await prisma.contests.update({
        where: { id: parsedId },
        data: {
          ...updateData,
          updated_at: new Date(),
          updated_by: req.user.wallet_address
        }
      });
      
      // If contest image setting changed, regenerate image in background
      if (body.image_settings && Object.keys(body.image_settings).length > 0) {
        contestImageService.generateContestImage(parsedId, body.image_settings)
          .catch(error => {
            contestLogger.error('Error regenerating contest image:', {
              error: error.message,
              contestId: parsedId
            });
          });
      }
      
      res.json({
        contest: updatedContest,
        message: 'Contest updated successfully'
      });
    } else {
      res.json({
        contest: existingContest,
        message: 'No changes to update'
      });
    }
  } catch (error) {
    contestLogger.error('Failed to update contest:', error);
    res.status(500).json({ error: 'Failed to update contest', message: error.message });
  }
});

export default router;