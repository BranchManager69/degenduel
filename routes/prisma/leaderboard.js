import { PrismaClient } from '@prisma/client';
import express from 'express';
import { z } from 'zod';
import { logApi } from '../../utils/logger-suite/logger.js';

const router = express.Router();
const prisma = new PrismaClient();

// Validation schema
const getLeaderboardSchema = z.object({
  limit: z.string().transform(Number).pipe(z.number().min(1).max(100)).default('10'),
  offset: z.string().transform(Number).pipe(z.number().min(0)).default('0'),
  timeframe: z.enum(['all', 'month', 'week']).default('all'),
}).strict();

// Calculate trend based on historical data
const calculateTrend = (currentRank, previousRank) => {
  if (!previousRank) return '→';
  if (currentRank < previousRank) return '↑';
  if (currentRank > previousRank) return '↓';
  return '→';
};

/**
 * @swagger
 * /api/leaderboard/global:
 *   get:
 *     summary: Get global user rankings
 *     description: Returns top users based on their rank_score (ELO-like rating)
 *     tags: [Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of records to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of records to skip
 *     responses:
 *       200:
 *         description: List of top ranked users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total number of ranked users
 *                 rankings:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       wallet_address:
 *                         type: string
 *                       nickname:
 *                         type: string
 *                       rank_score:
 *                         type: integer
 *                       highest_rank_score:
 *                         type: integer
 *                       percentile:
 *                         type: number
 *                       trend:
 *                         type: string
 *                         enum: ['↑', '↓', '→']
 *                       avg_position:
 *                         type: number
 *                       total_contests:
 *                         type: integer
 *                       total_earnings:
 *                         type: string
 */
router.get('/global', async (req, res) => {
  try {
    const { limit, offset } = getLeaderboardSchema.parse(req.query);

    // Get total count for pagination and percentile calculation
    const total = await prisma.users.count();

    // Get top users with their stats
    const rankings = await prisma.users.findMany({
      select: {
        wallet_address: true,
        nickname: true,
        user_stats: {
          select: {
            contests_entered: true,
            contests_won: true,
            total_prize_money: true,
            best_score: true,
            avg_score: true
          }
        },
        contest_participants: {
          select: {
            final_rank: true
          },
          where: {
            contests: {
              status: 'completed'
            }
          }
        }
      },
      take: limit,
      skip: offset,
      orderBy: {
        user_stats: {
          best_score: 'desc'
        }
      }
    });

    // Add rank numbers and calculate additional metrics
    const rankedUsers = rankings.map((user, index) => {
      const currentRank = offset + index + 1;
      const percentile = ((total - currentRank) / total) * 100;
      
      // Calculate average position in contests
      const avgPosition = user.contest_participants.length > 0
        ? user.contest_participants.reduce((sum, p) => sum + p.final_rank, 0) / user.contest_participants.length
        : null;

      return {
        rank: currentRank,
        wallet_address: user.wallet_address,
        nickname: user.nickname,
        rank_score: user.user_stats?.best_score?.toNumber() || 0,
        highest_rank_score: user.user_stats?.best_score?.toNumber() || 0,
        percentile: Math.round(percentile * 100) / 100,
        trend: calculateTrend(currentRank, currentRank + 1), // Simplified trend
        avg_position: avgPosition ? Math.round(avgPosition * 100) / 100 : null,
        total_contests: user.user_stats?.contests_entered || 0,
        total_earnings: user.user_stats?.total_prize_money?.toString() || '0'
      };
    });

    res.json({
      total,
      rankings: rankedUsers
    });
  } catch (error) {
    logApi.error('Failed to fetch global rankings:', error);
    res.status(500).json({ error: 'Failed to fetch global rankings' });
  }
});

/**
 * @swagger
 * /api/leaderboard/contests/performance:
 *   get:
 *     summary: Get top performers across all contests
 *     description: Returns users with best overall contest performance
 *     tags: [Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of records to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of records to skip
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [all, month, week]
 *           default: all
 *         description: Time period for performance data
 *     responses:
 *       200:
 *         description: List of top contest performers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                 rankings:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       wallet_address:
 *                         type: string
 *                       nickname:
 *                         type: string
 *                       contests_won:
 *                         type: integer
 *                       total_contests:
 *                         type: integer
 *                       win_rate:
 *                         type: number
 *                       longest_win_streak:
 *                         type: integer
 *                       current_win_streak:
 *                         type: integer
 *                       avg_position:
 *                         type: number
 *                       percentile:
 *                         type: number
 *                       trend:
 *                         type: string
 *                         enum: ['↑', '↓', '→']
 *                       total_earnings:
 *                         type: string
 */
router.get('/contests/performance', async (req, res) => {
  try {
    const { limit, offset, timeframe } = getLeaderboardSchema.parse(req.query);

    // Calculate date range based on timeframe
    const dateFilter = timeframe === 'all' ? {} : {
      created_at: {
        gte: new Date(
          timeframe === 'week'
            ? Date.now() - 7 * 24 * 60 * 60 * 1000
            : Date.now() - 30 * 24 * 60 * 60 * 1000
        )
      }
    };

    // Get total count for percentile calculation
    const total = await prisma.users.count({
      where: {
        total_contests: { gt: 0 }
      }
    });

    // Get users with their contest performance
    const rankings = await prisma.users.findMany({
      select: {
        wallet_address: true,
        nickname: true,
        total_contests: true,
        total_earnings: true,
        contest_participants: {
          where: {
            AND: [
              { contest: { status: 'COMPLETED' } },
              dateFilter
            ]
          },
          select: {
            final_rank: true,
            created_at: true
          },
          orderBy: {
            created_at: 'asc'
          }
        }
      },
      where: {
        total_contests: { gt: 0 }
      },
      orderBy: {
        total_earnings: 'desc'
      },
      take: limit,
      skip: offset
    });

    // Calculate enhanced metrics and format data
    const rankedUsers = rankings.map((user, index) => {
      const currentRank = offset + index + 1;
      const percentile = ((total - currentRank) / total) * 100;
      
      // Calculate win streaks and average position
      let currentStreak = 0;
      let longestStreak = 0;
      let currentStreakCount = 0;
      const positions = user.contest_participants.map(p => p.final_rank);
      
      positions.forEach(rank => {
        if (rank === 1) {
          currentStreakCount++;
          longestStreak = Math.max(longestStreak, currentStreakCount);
        } else {
          currentStreakCount = 0;
        }
      });
      currentStreak = currentStreakCount;

      const contestsWon = positions.filter(rank => rank === 1).length;
      const avgPosition = positions.length > 0
        ? positions.reduce((sum, rank) => sum + rank, 0) / positions.length
        : null;

      return {
        rank: currentRank,
        wallet_address: user.wallet_address,
        nickname: user.nickname,
        contests_won: contestsWon,
        total_contests: user.total_contests,
        win_rate: user.total_contests ? (contestsWon / user.total_contests) * 100 : 0,
        longest_win_streak: longestStreak,
        current_win_streak: currentStreak,
        avg_position: avgPosition ? Math.round(avgPosition * 100) / 100 : null,
        percentile: Math.round(percentile * 100) / 100,
        trend: calculateTrend(currentRank, currentRank + 1), // Simplified trend
        total_earnings: user.total_earnings?.toString() || '0'
      };
    });

    res.json({
      total,
      rankings: rankedUsers
    });
  } catch (error) {
    logApi.error('Failed to fetch contest performance rankings:', error);
    res.status(500).json({ error: 'Failed to fetch contest performance rankings' });
  }
});

export default router; 