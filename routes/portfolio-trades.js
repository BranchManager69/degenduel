import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { Decimal } from '@prisma/client/runtime/library';
import rateLimit from 'express-rate-limit';
import { broadcastTradeExecution } from '../websocket/portfolio-ws.js';

const router = express.Router();

// Custom error class for portfolio trade errors
class PortfolioTradeError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.name = 'PortfolioTradeError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Rate limiting setup
const tradeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10 // 10 trades per minute
});

// Apply rate limiting to trade execution
router.post('/:id/trades', tradeLimiter);

// Validation middleware
const validateTradeRequest = (req, res, next) => {
  const { wallet_address, token_id, type, new_weight } = req.body;

  if (!wallet_address) {
    throw new PortfolioTradeError('Wallet address is required');
  }

  if (!token_id || typeof token_id !== 'number') {
    throw new PortfolioTradeError('Valid token ID is required');
  }

  if (!type || !['BUY', 'SELL'].includes(type)) {
    throw new PortfolioTradeError('Valid trade type (BUY/SELL) is required');
  }

  if (typeof new_weight !== 'number' || new_weight < 0 || new_weight > 100) {
    throw new PortfolioTradeError('Weight must be between 0 and 100');
  }

  next();
};

/**
 * @swagger
 * /api/contests/{id}/trades:
 *   post:
 *     summary: Execute a portfolio trade in a contest
 *     tags: [Portfolio Trades]
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
 *               - token_id
 *               - type
 *               - new_weight
 *             properties:
 *               wallet_address:
 *                 type: string
 *                 example: "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp"
 *               token_id:
 *                 type: integer
 *                 example: 1
 *               type:
 *                 type: string
 *                 enum: [BUY, SELL]
 *               new_weight:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *                 example: 50
 */
router.post('/:id/trades', requireAuth, validateTradeRequest, async (req, res, next) => {
  const { wallet_address, token_id, type, new_weight } = req.body;
  const contestId = parseInt(req.params.id);

  try {
    if (isNaN(contestId)) {
      throw new PortfolioTradeError('Invalid contest ID', 400);
    }

    const result = await prisma.$transaction(async (prisma) => {
      // 1. Verify contest and participation
      const contest = await prisma.contests.findUnique({
        where: { id: contestId },
        include: {
          contest_participants: {
            where: { wallet_address }
          }
        }
      });

      if (!contest) {
        throw new PortfolioTradeError('Contest not found', 404);
      }

      if (contest.status !== 'active') {
        throw new PortfolioTradeError('Contest is not active', 409, {
          current_status: contest.status
        });
      }

      if (contest.contest_participants.length === 0) {
        throw new PortfolioTradeError('Not a participant in this contest', 403);
      }

      // 2. Get current portfolio state
      const currentPortfolio = await prisma.contest_portfolios.findFirst({
        where: {
          contest_id: contestId,
          wallet_address,
          token_id
        }
      });

      const old_weight = currentPortfolio?.weight || 0;

      // 3. Get current token price
      const latestPrice = await prisma.contest_token_prices.findFirst({
        where: {
          contest_id: contestId,
          token_id
        },
        orderBy: {
          timestamp: 'desc'
        }
      });

      if (!latestPrice) {
        throw new PortfolioTradeError('No price data available for token', 409);
      }

      // Validate total portfolio weight
      const otherTokens = await prisma.contest_portfolios.findMany({
        where: {
          contest_id: contestId,
          wallet_address,
          token_id: { not: token_id }
        }
      });

      const totalWeight = otherTokens.reduce((sum, p) => sum + p.weight, new_weight);
      if (totalWeight > 100) {
        throw new PortfolioTradeError('Total portfolio weight exceeds 100%', 400, {
          current_total: totalWeight,
          max_allowed: 100
        });
      }

      // 4. Calculate virtual amount based on weight change
      const weightDiff = Math.abs(new_weight - old_weight);
      const virtualAmount = new Decimal(weightDiff).mul(1000);

      // 5. Record the trade
      const trade = await prisma.contest_portfolio_trades.create({
        data: {
          contest_id: contestId,
          wallet_address,
          token_id,
          type,
          old_weight,
          new_weight,
          price_at_trade: latestPrice.price,
          virtual_amount: virtualAmount,
        }
      }).catch(error => {
        throw new PortfolioTradeError('Failed to record trade', 500, {
          error: error.message
        });
      });

      // 6. Update portfolio
      if (currentPortfolio) {
        await prisma.contest_portfolios.update({
          where: {
            contest_id_wallet_address_token_id: {
              contest_id: contestId,
              wallet_address,
              token_id
            }
          },
          data: {
            weight: new_weight
          }
        }).catch(error => {
          throw new PortfolioTradeError('Failed to update portfolio', 500, {
            error: error.message
          });
        });
      } else if (new_weight > 0) {
        await prisma.contest_portfolios.create({
          data: {
            contest_id: contestId,
            wallet_address,
            token_id,
            weight: new_weight
          }
        }).catch(error => {
          throw new PortfolioTradeError('Failed to create portfolio entry', 500, {
            error: error.message
          });
        });
      }

      // Broadcast the trade execution
      broadcastTradeExecution(trade);

      return trade;
    });

    // Log successful trade
    logApi.info('Trade executed successfully', {
      contest_id: contestId,
      wallet_address,
      token_id,
      type,
      old_weight: result.old_weight,
      new_weight: result.new_weight
    });

    res.json(result);
  } catch (error) {
    if (error instanceof PortfolioTradeError) {
      logApi.warn('Portfolio trade error:', {
        error: error.message,
        details: error.details,
        statusCode: error.statusCode
      });
      res.status(error.statusCode).json({
        error: error.message,
        details: error.details
      });
    } else {
      logApi.error('Unexpected error during trade execution:', error);
      next(error);
    }
  }
});

/**
 * @swagger
 * /api/contests/{id}/trades/{wallet}:
 *   get:
 *     summary: Get trade history for a participant
 *     tags: [Portfolio Trades]
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
 *         description: Participant's wallet address
 */
router.get('/:id/trades/:wallet', requireAuth, async (req, res, next) => {
  const contestId = parseInt(req.params.id);
  const walletAddress = req.params.wallet;

  try {
    if (isNaN(contestId)) {
      throw new PortfolioTradeError('Invalid contest ID', 400);
    }

    // Verify contest exists
    const contest = await prisma.contests.findUnique({
      where: { id: contestId }
    });

    if (!contest) {
      throw new PortfolioTradeError('Contest not found', 404);
    }

    const trades = await prisma.contest_portfolio_trades.findMany({
      where: {
        contest_id: contestId,
        wallet_address: walletAddress
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
        executed_at: 'desc'
      }
    });

    res.json(trades);
  } catch (error) {
    if (error instanceof PortfolioTradeError) {
      logApi.warn('Portfolio trade history error:', {
        error: error.message,
        details: error.details,
        statusCode: error.statusCode
      });
      res.status(error.statusCode).json({
        error: error.message,
        details: error.details
      });
    } else {
      logApi.error('Failed to fetch trade history:', error);
      next(error);
    }
  }
});

/**
 * @swagger
 * /api/contests/{id}/portfolio-state/{wallet}:
 *   get:
 *     summary: Get portfolio state at a specific timestamp
 *     tags: [Portfolio Trades]
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
 *         description: Participant's wallet address
 *       - in: query
 *         name: timestamp
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Timestamp to get portfolio state at (defaults to current time)
 */
router.get('/:id/portfolio-state/:wallet', requireAuth, async (req, res, next) => {
  const contestId = parseInt(req.params.id);
  const walletAddress = req.params.wallet;
  const timestamp = req.query.timestamp ? new Date(req.query.timestamp) : new Date();

  try {
    if (isNaN(contestId)) {
      throw new PortfolioTradeError('Invalid contest ID', 400);
    }

    if (isNaN(timestamp.getTime())) {
      throw new PortfolioTradeError('Invalid timestamp', 400);
    }

    // Verify contest exists
    const contest = await prisma.contests.findUnique({
      where: { id: contestId }
    });

    if (!contest) {
      throw new PortfolioTradeError('Contest not found', 404);
    }

    // Use the database function we created
    const portfolioState = await prisma.$queryRaw`
      SELECT * FROM get_portfolio_state_at_timestamp(${contestId}, ${walletAddress}, ${timestamp})
    `;

    // Enrich with token details
    const enrichedState = await Promise.all(
      portfolioState.map(async (position) => {
        const token = await prisma.tokens.findUnique({
          where: { id: position.token_id },
          select: {
            symbol: true,
            name: true
          }
        });
        return { ...position, token };
      })
    );

    res.json(enrichedState);
  } catch (error) {
    if (error instanceof PortfolioTradeError) {
      logApi.warn('Portfolio state error:', {
        error: error.message,
        details: error.details,
        statusCode: error.statusCode
      });
      res.status(error.statusCode).json({
        error: error.message,
        details: error.details
      });
    } else {
      logApi.error('Failed to fetch portfolio state:', error);
      next(error);
    }
  }
});

// Error handling middleware
router.use((err, req, res, next) => {
  logApi.error('Portfolio trades error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

export default router; 