// /routes/prisma/stats.js

import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js'; // New DD Logging System

const router = Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * tags:
 *   name: Statistics
 *   description: Platform and wallet statistics endpoints
 */

/* Stats Routes */

/**
 * @swagger
 * /api/stats/platform:
 *   get:
 *     summary: Get platform-wide statistics
 *     tags: [Statistics]
 *     responses:
 *       200:
 *         description: Platform statistics overview
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalUsers:
 *                   type: integer
 *                   example: 1500
 *                 totalContests:
 *                   type: integer
 *                   example: 250
 *                 totalVolume:
 *                   type: string
 *                   example: "1000000000"
 *                 activeContests:
 *                   type: integer
 *                   example: 25
 *                 totalPrizesPaid:
 *                   type: string
 *                   example: "500000000"
 *                 avgContestSize:
 *                   type: number
 *                   example: 8.5
 *                 topPerformingTokens:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       symbol:
 *                         type: string
 *                       winRate:
 *                         type: number
 *                       useCount:
 *                         type: integer
 */
// Get platform stats (SUPERADMIN ONLY)
//   example: GET https://degenduel.me/api/stats/platform
//      headers: { "Authorization": "Bearer <JWT>" }
router.get('/platform', requireAuth, requireSuperAdmin, async (req, res) => {
    const logContext = {
        path: 'GET /api/stats/platform',
        query: req.query
    };
    
    logApi.info('Fetching platform statistics', logContext);
    const debugMode = true;

    try {
        if (debugMode) {
            // Mock data generation...
            logApi.debug('Using mock data for platform statistics', logContext);
            
            const mockUserCount = 5000;

            const mockContestStats = {
                _count: {
                    _all: 100,
                    contest_participants: 2500
                }
            };

            const mockVolumeStats = {
                _sum: {
                    amount: 1250000 // Simulated total transaction amount
                }
            };

            const mockTokenStats = [
                {
                    token_id: 1,
                    tokens: { symbol: 'BTC' },
                    _avg: { profit_loss: 0.15 },
                    _count: { token_id: 250 }
                },
                {
                    token_id: 2,
                    tokens: { symbol: 'ETH' },
                    _avg: { profit_loss: 0.12 },
                    _count: { token_id: 200 }
                },
                // Add more mock token entries as needed
            ];

            const mockActiveContests = 25;

            // Debug logging
            console.log('Mock Data Generated:', {
                userCount: mockUserCount,
                contestStats: mockContestStats,
                volumeStats: mockVolumeStats,
                tokenStats: mockTokenStats,
                activeContests: mockActiveContests
            });

            // Prepare and send mock response
            const mockStats = {
                totalUsers: mockUserCount,
                totalContests: mockContestStats._count._all,
                totalVolume: mockVolumeStats._sum.amount?.toString() || "0",
                activeContests: mockActiveContests,
                totalPrizesPaid: (mockVolumeStats._sum.amount || 0) / 2,
                avgContestSize: mockContestStats._count.contest_participants / mockContestStats._count._all,
                topPerformingTokens: mockTokenStats.map(stat => ({
                    symbol: stat.tokens.symbol,
                    winRate: stat._avg.profit_loss || 0,
                    useCount: stat._count.token_id
                }))
            };

            logApi.info('Mock platform statistics generated successfully', { stats: mockStats });
            return res.json(mockStats);
        }

        // Production code
        const [
            userCount,
            contestStats,
            volumeStats,
            tokenStats
        ] = await Promise.all([
            // Total users
            prisma.users.count(),
            
            // Contest statistics
            prisma.contests.aggregate({
                _count: {
                    _all: true,
                    contest_participants: true,
                },
                where: {
                    status: 'completed'
                }
            }),
            
            // Volume statistics
            prisma.transactions.aggregate({
                _sum: {
                    amount: true
                },
                where: {
                    type: {
                        in: ['CONTEST_ENTRY', 'PRIZE_PAYOUT']
                    }
                }
            }),
            
            // Top performing tokens
            prisma.contest_token_performance.groupBy({
                by: ['token_id'],
                _avg: {
                    profit_loss: true
                },
                _count: {
                    token_id: true
                },
                orderBy: {
                    _avg: {
                        profit_loss: 'desc'
                    }
                },
                take: 10,
                select: {
                    tokens: {
                        select: {
                            symbol: true
                        }
                    }
                }
            })
        ]);

        const activeContests = await prisma.contests.count({
            where: {
                status: 'active'
            }
        });

        const stats = {
            totalUsers: userCount,
            totalContests: contestStats._count._all,
            totalVolume: volumeStats._sum.amount?.toString() || "0",
            activeContests,
            totalPrizesPaid: (volumeStats._sum.amount || 0) / 2,
            avgContestSize: contestStats._count.contest_participants / contestStats._count._all,
            topPerformingTokens: tokenStats.map(stat => ({
                symbol: stat.tokens.symbol,
                winRate: stat._avg.profit_loss || 0,
                useCount: stat._count.token_id
            }))
        };

        logApi.info('Platform statistics fetched successfully', { stats });
        res.json(stats);

    } catch (error) {
        logApi.error('Failed to fetch platform statistics', {
            error: {
                name: error.name,
                message: error.message,
                code: error?.code
            }
        });
        
        res.status(500).json({ error: 'Failed to fetch platform statistics' });
    }
});

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
  const { wallet } = req.params;
  
  logApi.info('Fetching wallet statistics', { wallet_address: wallet });

  try {
    const [
      contestStats,
      tokenStats,
      recentActivity
    ] = await Promise.all([
      // Contest statistics
      prisma.contest_participants.aggregate({
        _count: {
          _all: true
        },
        _avg: {
          final_rank: true
        },
        _sum: {
          prize_amount: true
        },
        where: {
          wallet_address: wallet
        }
      }),

      // Token performance
      prisma.contest_token_performance.findMany({
        where: {
          wallet_address: wallet
        },
        select: {
          token_id: true,
          profit_loss: true,
          tokens: {
            select: {
              symbol: true
            }
          }
        }
      }).then(performances => {
        // Group and aggregate the data
        const tokenStats = Object.values(performances.reduce((acc, perf) => {
          const tokenId = perf.token_id;
          if (!acc[tokenId]) {
            acc[tokenId] = {
              symbol: perf.tokens.symbol,
              avgProfit: 0,
              useCount: 0,
              totalProfit: 0
            };
          }
          acc[tokenId].useCount++;
          acc[tokenId].totalProfit += perf.profit_loss || 0;
          return acc;
        }, {})).map(stat => ({
          ...stat,
          avgProfit: stat.totalProfit / stat.useCount
        }));
        return tokenStats;
      }),

      // Recent activity
      prisma.transactions.findMany({
        where: {
          wallet_address: wallet
        },
        orderBy: {
          created_at: 'desc'
        },
        take: 10
      })
    ]);

    // Calculate win rate
    const totalWins = await prisma.contest_participants.count({
      where: {
        wallet_address: wallet,
        final_rank: 1
      }
    });

    const response = {
      contestStats: {
        totalParticipated: contestStats._count._all,
        winRate: contestStats._count._all ? totalWins / contestStats._count._all : 0,
        avgRank: contestStats._avg.final_rank || 0,
        totalEarnings: contestStats._sum.prize_amount?.toString() || "0"
      },
      tokenPerformance: tokenStats,
      recentActivity: recentActivity.map(activity => ({
        type: activity.type,
        amount: activity.amount.toString(),
        timestamp: activity.created_at
      }))
    };

    logApi.info('Wallet statistics fetched successfully', {
      wallet_address: wallet,
      stats_summary: {
        total_participated: response.contestStats.totalParticipated,
        win_rate: response.contestStats.winRate,
        total_earnings: response.contestStats.totalEarnings
      }
    });

    res.json(response);
  } catch (error) {
    logApi.error('Failed to fetch wallet statistics', {
      error: {
        name: error.name,
        message: error.message,
        code: error?.code
      },
      wallet_address: wallet,
      path: req.path,
      method: req.method
    });
    res.status(500).json({ error: 'Failed to fetch wallet statistics' });
  }
});

/**
 * @swagger
 * /api/stats/{wallet}/history:
 *   get:
 *     summary: Get user's contest history
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
 */
router.get('/:wallet/history', async (req, res) => {
  const { wallet } = req.params;
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const history = await prisma.contest_participants.findMany({
      where: {
        wallet_address: wallet
      },
      select: {
        initial_balance: true,
        current_balance: true,
        rank: true,
        contests: {
          select: {
            id: true,
            name: true,
            start_time: true,
            end_time: true
          }
        }
      },
      orderBy: {
        joined_at: 'desc'
      },
      take: limit,
      skip: offset
    });

    const formattedHistory = history.map(entry => {
      // Calculate portfolio return
      const initial = parseFloat(entry.initial_balance?.toString() || "0");
      const current = parseFloat(entry.current_balance?.toString() || "0");
      const portfolioReturn = initial > 0 ? ((current - initial) / initial * 100).toFixed(2) : "0.00";

      return {
        contest_id: entry.contests.id,
        contest_name: entry.contests.name,
        start_time: entry.contests.start_time,
        end_time: entry.contests.end_time,
        portfolio_return: `${portfolioReturn}%`,
        rank: entry.rank || "-"
      };
    });

    res.json(formattedHistory);
  } catch (error) {
    logApi.error('Failed to fetch contest history', {
      error: {
        name: error.name,
        message: error.message,
        code: error?.code
      },
      wallet_address: wallet,
      path: req.path,
      method: req.method
    });
    res.status(500).json({ error: 'Failed to fetch contest history' });
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
 *                   achieved_at:
 *                     type: string
 *                     format: date-time
 *                   display_name:
 *                     type: string
 */
router.get('/:wallet/achievements', async (req, res) => {
  const { wallet } = req.params;
  
  try {
    // Get all contest participations for the user
    const participations = await prisma.contest_participants.findMany({
      where: {
        wallet_address: wallet
      },
      orderBy: {
        joined_at: 'asc'
      },
      select: {
        joined_at: true
      }
    });

    const achievements = [];

    // First Contest Achievement
    if (participations.length > 0) {
      achievements.push({
        achievement: 'first_contest',
        achieved_at: participations[0].joined_at,
        display_name: 'First Contest Entry'
      });
    }

    // Multiple Contests Achievements
    if (participations.length >= 3) {
      achievements.push({
        achievement: 'three_contests',
        achieved_at: participations[2].joined_at,
        display_name: 'Participated in 3 Contests'
      });
    }

    if (participations.length >= 5) {
      achievements.push({
        achievement: 'five_contests',
        achieved_at: participations[4].joined_at,
        display_name: 'Participated in 5 Contests'
      });
    }

    // Sort achievements by achieved_at date
    achievements.sort((a, b) => b.achieved_at - a.achieved_at);

    res.json(achievements);
  } catch (error) {
    logApi.error('Failed to fetch achievements', {
      error: {
        name: error.name,
        message: error.message,
        code: error?.code
      },
      wallet_address: wallet,
      path: req.path,
      method: req.method
    });
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

//   example: GET https://degenduel.me/api/stats/{wallet}/history
//      headers: { "Cookie": "session=<jwt>" }
//   example: GET https://degenduel.me/api/stats/{wallet}/achievements
//      headers: { "Cookie": "session=<jwt>" }

export default router; 