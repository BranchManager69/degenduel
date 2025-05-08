/**
 * Contest Leaderboard Routes
 * 
 * @description Routes for contest leaderboards and rankings
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { getAndValidateContest } from '../../utils/contest-helpers.js';

// Router
const router = express.Router();

// Create a dedicated logger for contest leaderboard operations
const leaderboardLogger = {
  ...logApi.forService('CONTESTS_LEADERBOARD'),
  analytics: logApi.analytics
};

/**
 * @route GET /api/contests/:id/leaderboard
 * @description Get the leaderboard for a contest
 * @access Public
 */
router.get('/:id/leaderboard', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 100, offset = 0 } = req.query;
    
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Invalid contest ID' });
    }
    
    // Check if contest exists
    const contest = await getAndValidateContest(parsedId);
    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }
    
    // Get leaderboard entries
    const leaderboard = await prisma.contest_participants.findMany({
      where: {
        contest_id: parsedId
      },
      include: {
        users: {
          select: {
            nickname: true,
            profile_image_url: true
          }
        },
        contest_portfolios: {
          include: {
            tokens: {
              select: {
                id: true,
                symbol: true,
                name: true,
                logo_url: true
              }
            }
          }
        }
      },
      orderBy: [
        // First order by rank (if available)
        { rank: 'asc' },
        // Then by balance (highest first)
        { current_balance: 'desc' }
      ],
      take: parseInt(limit),
      skip: parseInt(offset)
    });
    
    // Format the leaderboard entries
    const formattedLeaderboard = leaderboard.map(entry => {
      // Format portfolio data
      const portfolio = (entry.contest_portfolios || []).map(portfolio => ({
        token_id: portfolio.token_id,
        weight: portfolio.weight,
        token: {
          id: portfolio.tokens?.id,
          symbol: portfolio.tokens?.symbol,
          name: portfolio.tokens?.name,
          logo_url: portfolio.tokens?.logo_url
        }
      }));
      
      // Return formatted entry
      return {
        wallet_address: entry.wallet_address,
        initial_balance: entry.initial_balance,
        current_balance: entry.current_balance,
        rank: entry.rank,
        final_rank: entry.final_rank,
        prize_amount: entry.prize_amount,
        nickname: entry.users?.nickname || entry.wallet_address.slice(0, 6) + '...',
        profile_image_url: entry.users?.profile_image_url,
        portfolio
      };
    });
    
    // Get total count
    const totalParticipants = await prisma.contest_participants.count({
      where: { contest_id: parsedId }
    });
    
    res.json({
      contest: {
        id: contest.id,
        name: contest.name,
        status: contest.status,
        participant_count: totalParticipants
      },
      leaderboard: formattedLeaderboard,
      pagination: {
        total: totalParticipants,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    leaderboardLogger.error('Failed to fetch contest leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch contest leaderboard', message: error.message });
  }
});

export default router;