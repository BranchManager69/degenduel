import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { Decimal } from '@prisma/client/runtime/library';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Custom error class for portfolio analytics errors
class PortfolioAnalyticsError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.name = 'PortfolioAnalyticsError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Rate limiting setup
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20 // 20 requests per minute
});

router.use(analyticsLimiter);

// Get portfolio performance
router.get('/contests/:id/portfolio/performance/:wallet', requireAuth, async (req, res, next) => {
  try {
    const contestId = parseInt(req.params.id);
    const { wallet } = req.params;

    if (isNaN(contestId)) {
      throw new PortfolioAnalyticsError('Invalid contest ID', 400);
    }

    // Verify contest exists
    const contest = await prisma.contests.findUnique({
      where: { id: contestId }
    });

    if (!contest) {
      throw new PortfolioAnalyticsError('Contest not found', 404);
    }

    // Get all trades for this portfolio
    const trades = await prisma.contest_portfolio_trades.findMany({
      where: {
        contest_id: contestId,
        wallet_address: wallet
      },
      include: {
        tokens: {
          select: {
            symbol: true,
            name: true
          }
        }
      },
      orderBy: {
        executed_at: 'asc'
      }
    });

    if (trades.length === 0) {
      return res.json({
        total_trades: 0,
        total_volume: "0",
        profit_loss: "0",
        token_performance: []
      });
    }

    // Calculate performance metrics
    let totalVolume = new Decimal(0);
    let profitLoss = new Decimal(0);
    const tokenPerformance = new Map();

    // Process each trade
    trades.forEach(trade => {
      const volume = trade.virtual_amount.mul(trade.price_at_trade);
      totalVolume = totalVolume.add(volume);

      const tokenKey = trade.tokens.symbol;
      if (!tokenPerformance.has(tokenKey)) {
        tokenPerformance.set(tokenKey, {
          symbol: tokenKey,
          profit_loss: 0,
          trades: 0
        });
      }

      const tokenStats = tokenPerformance.get(tokenKey);
      tokenStats.trades += 1;
    });

    // Find best and worst trades
    const tradeProfits = await Promise.all(trades.map(async trade => {
      // Get current price for P&L calculation
      const currentPrice = await prisma.contest_token_prices.findFirst({
        where: {
          contest_id: contestId,
          token_id: trade.token_id
        },
        orderBy: {
          timestamp: 'desc'
        }
      });

      if (!currentPrice) {
        return {
          token_symbol: trade.tokens.symbol,
          profit_loss: 0,
          executed_at: trade.executed_at
        };
      }

      const profitLoss = currentPrice.price
        .sub(trade.price_at_trade)
        .div(trade.price_at_trade)
        .mul(100);

      return {
        token_symbol: trade.tokens.symbol,
        profit_loss: profitLoss.toNumber(),
        executed_at: trade.executed_at
      };
    }));

    const bestTrade = tradeProfits.reduce((best, current) => 
      current.profit_loss > best.profit_loss ? current : best
    );

    const worstTrade = tradeProfits.reduce((worst, current) => 
      current.profit_loss < worst.profit_loss ? current : worst
    );

    res.json({
      total_trades: trades.length,
      total_volume: totalVolume.toString(),
      profit_loss: profitLoss.toString(),
      best_trade: bestTrade,
      worst_trade: worstTrade,
      token_performance: Array.from(tokenPerformance.values())
    });
  } catch (error) {
    if (error instanceof PortfolioAnalyticsError) {
      logApi.warn('Portfolio performance error:', {
        error: error.message,
        details: error.details,
        statusCode: error.statusCode
      });
      res.status(error.statusCode).json({
        error: error.message,
        details: error.details
      });
    } else {
      logApi.error('Failed to get portfolio performance:', error);
      next(error);
    }
  }
});

// Get trade analytics
router.get('/contests/:id/trades/analytics/:wallet', requireAuth, async (req, res, next) => {
  try {
    const contestId = parseInt(req.params.id);
    const { wallet } = req.params;

    if (isNaN(contestId)) {
      throw new PortfolioAnalyticsError('Invalid contest ID', 400);
    }

    // Verify contest exists
    const contest = await prisma.contests.findUnique({
      where: { id: contestId }
    });

    if (!contest) {
      throw new PortfolioAnalyticsError('Contest not found', 404);
    }

    // Get all trades
    const trades = await prisma.contest_portfolio_trades.findMany({
      where: {
        contest_id: contestId,
        wallet_address: wallet
      },
      include: {
        tokens: {
          select: {
            symbol: true
          }
        }
      },
      orderBy: {
        executed_at: 'asc'
      }
    });

    if (trades.length === 0) {
      return res.json({
        trade_frequency: {
          daily: 0,
          weekly: 0,
          monthly: 0
        },
        average_holding_time: "0h",
        most_traded_tokens: [],
        weight_distribution: {
          '0-25': 0,
          '26-50': 0,
          '51-75': 0,
          '76-100': 0
        }
      });
    }

    // Calculate trade frequency
    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const firstTradeDate = trades[0]?.executed_at || now;
    const daysSinceFirst = Math.max((now - firstTradeDate) / msPerDay, 1);

    const tradeFrequency = {
      daily: trades.length / daysSinceFirst,
      weekly: (trades.length / daysSinceFirst) * 7,
      monthly: (trades.length / daysSinceFirst) * 30
    };

    // Calculate most traded tokens
    const tokenTradeCount = new Map();
    trades.forEach(trade => {
      const symbol = trade.tokens.symbol;
      tokenTradeCount.set(symbol, (tokenTradeCount.get(symbol) || 0) + 1);
    });

    const mostTradedTokens = Array.from(tokenTradeCount.entries())
      .map(([symbol, count]) => ({ symbol, trade_count: count }))
      .sort((a, b) => b.trade_count - a.trade_count);

    // Calculate weight distribution
    const weightDistribution = {
      '0-25': 0,
      '26-50': 0,
      '51-75': 0,
      '76-100': 0
    };

    trades.forEach(trade => {
      if (trade.new_weight <= 25) weightDistribution['0-25']++;
      else if (trade.new_weight <= 50) weightDistribution['26-50']++;
      else if (trade.new_weight <= 75) weightDistribution['51-75']++;
      else weightDistribution['76-100']++;
    });

    // Calculate average holding time
    let totalHoldingTime = 0;
    let holdingTimeCount = 0;

    for (let i = 0; i < trades.length - 1; i++) {
      if (trades[i].token_id === trades[i + 1].token_id) {
        const holdingTime = trades[i + 1].executed_at - trades[i].executed_at;
        totalHoldingTime += holdingTime;
        holdingTimeCount++;
      }
    }

    const averageHoldingHours = holdingTimeCount > 0 
      ? Math.round(totalHoldingTime / holdingTimeCount / (1000 * 60 * 60))
      : 0;

    res.json({
      trade_frequency: tradeFrequency,
      average_holding_time: `${averageHoldingHours}h`,
      most_traded_tokens: mostTradedTokens,
      weight_distribution: weightDistribution
    });
  } catch (error) {
    if (error instanceof PortfolioAnalyticsError) {
      logApi.warn('Trade analytics error:', {
        error: error.message,
        details: error.details,
        statusCode: error.statusCode
      });
      res.status(error.statusCode).json({
        error: error.message,
        details: error.details
      });
    } else {
      logApi.error('Failed to get trade analytics:', error);
      next(error);
    }
  }
});

// Get portfolio rebalance history
router.get('/contests/:id/portfolio/rebalances/:wallet', requireAuth, async (req, res) => {
    try {
        const { id: contestId, wallet } = req.params;

        // Get all trades ordered by time
        const trades = await prisma.contest_portfolio_trades.findMany({
            where: {
                contest_id: parseInt(contestId),
                wallet_address: wallet
            },
            include: {
                tokens: {
                    select: {
                        symbol: true
                    }
                }
            },
            orderBy: {
                executed_at: 'asc'
            }
        });

        // Group trades by timestamp to identify rebalancing events
        const rebalances = [];
        let currentRebalance = null;

        trades.forEach(trade => {
            if (!currentRebalance || 
                Math.abs(trade.executed_at - currentRebalance.timestamp) > 60000) { // 1 minute window
                if (currentRebalance) {
                    rebalances.push(currentRebalance);
                }
                currentRebalance = {
                    id: rebalances.length + 1,
                    timestamp: trade.executed_at,
                    changes: [],
                    reason: 'REBALANCE'
                };
            }

            currentRebalance.changes.push({
                token_symbol: trade.tokens.symbol,
                old_weight: trade.old_weight,
                new_weight: trade.new_weight,
                price_at_change: trade.price_at_trade.toString()
            });
        });

        if (currentRebalance) {
            rebalances.push(currentRebalance);
        }

        res.json(rebalances);
    } catch (error) {
        logApi.error('Failed to get rebalance history:', error);
        res.status(500).json({ error: 'Failed to get rebalance history' });
    }
});

// Get portfolio snapshots
router.get('/contests/:id/portfolio/snapshots/:wallet', requireAuth, async (req, res) => {
    try {
        const { id: contestId, wallet } = req.params;
        const { interval = 'daily', start_date, end_date } = req.query;

        // Validate dates
        const startTimestamp = start_date ? new Date(start_date) : new Date(0);
        const endTimestamp = end_date ? new Date(end_date) : new Date();

        // Get all trades in the time range
        const trades = await prisma.contest_portfolio_trades.findMany({
            where: {
                contest_id: parseInt(contestId),
                wallet_address: wallet,
                executed_at: {
                    gte: startTimestamp,
                    lte: endTimestamp
                }
            },
            include: {
                tokens: {
                    select: {
                        symbol: true
                    }
                }
            },
            orderBy: {
                executed_at: 'asc'
            }
        });

        // Generate snapshots based on interval
        const snapshots = [];
        let currentTime = new Date(startTimestamp);
        
        while (currentTime <= endTimestamp) {
            // Get portfolio state at this timestamp
            const portfolioState = await prisma.$queryRaw`
                SELECT * FROM get_portfolio_state_at_timestamp(${contestId}, ${wallet}, ${currentTime})
            `;

            // Calculate total value
            const totalValue = portfolioState.reduce((sum, position) => 
                sum.add(new Decimal(position.weight).mul(position.price)), new Decimal(0)
            );

            snapshots.push({
                timestamp: currentTime,
                total_value: totalValue.toString(),
                tokens: portfolioState.map(position => ({
                    symbol: position.token_symbol,
                    weight: position.weight,
                    value: new Decimal(position.weight).mul(position.price).toString()
                }))
            });

            // Increment time based on interval
            switch (interval) {
                case 'hourly':
                    currentTime = new Date(currentTime.getTime() + 60 * 60 * 1000);
                    break;
                case 'daily':
                    currentTime = new Date(currentTime.getTime() + 24 * 60 * 60 * 1000);
                    break;
                case 'weekly':
                    currentTime = new Date(currentTime.getTime() + 7 * 24 * 60 * 60 * 1000);
                    break;
            }
        }

        res.json(snapshots);
    } catch (error) {
        logApi.error('Failed to get portfolio snapshots:', error);
        res.status(500).json({ error: 'Failed to get portfolio snapshots' });
    }
});

// Validate portfolio trade
router.post('/contests/:id/trades/validate', requireAuth, async (req, res) => {
    try {
        const { id: contestId } = req.params;
        const { wallet_address, token_id, type, new_weight } = req.body;

        // Get current portfolio state
        const currentPortfolio = await prisma.contest_portfolios.findMany({
            where: {
                contest_id: parseInt(contestId),
                wallet_address
            },
            include: {
                tokens: {
                    select: {
                        symbol: true
                    }
                }
            }
        });

        // Calculate new portfolio state
        const currentWeights = new Map(
            currentPortfolio.map(p => [p.token_id, p.weight])
        );

        currentWeights.set(token_id, new_weight);

        // Validate total weight
        const totalWeight = Array.from(currentWeights.values())
            .reduce((sum, weight) => sum + weight, 0);

        const valid = totalWeight === 100;
        const warnings = [];

        if (totalWeight !== 100) {
            warnings.push(`Total weight would be ${totalWeight}%, must be 100%`);
        }

        // Get token details
        const token = await prisma.tokens.findUnique({
            where: { id: token_id },
            select: { symbol: true }
        });

        res.json({
            valid,
            warnings,
            projected_portfolio: {
                total_weight: totalWeight,
                tokens: [{
                    symbol: token.symbol,
                    new_weight,
                    old_weight: currentWeights.get(token_id) || 0
                }]
            }
        });
    } catch (error) {
        logApi.error('Failed to validate trade:', error);
        res.status(500).json({ error: 'Failed to validate trade' });
    }
});

// Error handling middleware
router.use((err, req, res, next) => {
  logApi.error('Portfolio analytics error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

export default router; 