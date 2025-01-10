// /routes/prisma/stats.js - Centralized logging for DegenDuel backend services.
import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
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
// Get platform stats
//   example: GET https://degenduel.me/api/stats/platform
router.get('/platform', async (req, res) => {
    const log = logApi.withRequest(req);
    
    log.info('Fetching platform statistics');
    const debugMode = true;

    try {
        if (debugMode) {
            // Mock data generation...
            log.debug('Using mock data for platform statistics');
            
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

            log.info('Mock platform statistics generated successfully', { stats: mockStats });
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
                include: {
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

        log.info('Platform statistics fetched successfully', { stats });
        res.json(stats);

    } catch (error) {
        log.error('Failed to fetch platform statistics', {
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
 * /api/stats/wallet/{address}:
 *   get:
 *     summary: Get detailed statistics for a specific wallet
 *     tags: [Statistics]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address to get statistics for
 *     responses:
 *       200:
 *         description: Wallet statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contestStats:
 *                   type: object
 *                   properties:
 *                     totalParticipated:
 *                       type: integer
 *                     winRate:
 *                       type: number
 *                     avgRank:
 *                       type: number
 *                     totalEarnings:
 *                       type: string
 *                 tokenPerformance:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       symbol:
 *                         type: string
 *                       avgProfit:
 *                         type: number
 *                       useCount:
 *                         type: integer
 *                 recentActivity:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                       amount:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 */
// Get stats of a wallet
//   example: GET https://degenduel.me/api/stats/wallet/BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp
router.get('/wallet/:address', async (req, res) => {
  const log = logApi.withRequest(req);
  const { address } = req.params;
  
  log.info('Fetching wallet statistics', { wallet_address: address });

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
          wallet_address: address
        }
      }),

      // Token performance
      prisma.contest_token_performance.groupBy({
        by: ['token_id'],
        where: {
          wallet_address: address
        },
        _avg: {
          profit_loss: true
        },
        _count: {
          token_id: true
        },
        include: {
          tokens: {
            select: {
              symbol: true
            }
          }
        }
      }),

      // Recent activity
      prisma.transactions.findMany({
        where: {
          wallet_address: address
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
        wallet_address: address,
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
      tokenPerformance: tokenStats.map(stat => ({
        symbol: stat.tokens.symbol,
        avgProfit: stat._avg.profit_loss || 0,
        useCount: stat._count.token_id
      })),
      recentActivity: recentActivity.map(activity => ({
        type: activity.type,
        amount: activity.amount.toString(),
        timestamp: activity.created_at
      }))
    };

    log.info('Wallet statistics fetched successfully', {
      wallet_address: address,
      stats_summary: {
        total_participated: response.contestStats.totalParticipated,
        win_rate: response.contestStats.winRate,
        total_earnings: response.contestStats.totalEarnings
      }
    });

    res.json(response);
  } catch (error) {
    log.error('Failed to fetch wallet statistics', {
      error: {
        name: error.name,
        message: error.message,
        code: error?.code
      },
      wallet_address: address
    });
    res.status(500).json({ error: 'Failed to fetch wallet statistics' });
  }
});

export default router; 