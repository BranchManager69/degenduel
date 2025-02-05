// /routes/trades.js

import express from 'express';
import prisma from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Trades
 *   description: API endpoints for managing contest trades
 */

/* Trades Routes */

/**
 * @swagger
 * /api/trades/{contestId}:
 *   post:
 *     summary: Submit a new trade for a contest
 *     tags: [Trades]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet
 *               - token_id
 *               - type
 *               - amount
 *             properties:
 *               wallet:
 *                 type: string
 *                 description: User's wallet address
 *               token_id:
 *                 type: string
 *                 description: ID of the token being traded
 *               type:
 *                 type: string
 *                 enum: [buy, sell]
 *                 description: Type of trade
 *               amount:
 *                 type: number
 *                 description: Amount of tokens to trade
 *     responses:
 *       200:
 *         description: Trade submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 contest_id:
 *                   type: string
 *                 wallet_address:
 *                   type: string
 *                 token_id:
 *                   type: string
 *                 trade_type:
 *                   type: string
 *                 amount:
 *                   type: number
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Contest not active or invalid trade parameters
 *       500:
 *         description: Server error
 */
// Submit a new trade for a contest (AUTHENTICATED)
//      headers: { "Authorization": "Bearer <JWT>" }
//      example: POST https://degenduel.me/api/trades/1
router.post('/:contestId', requireAuth, async (req, res) => {
  try {
    const { wallet, token_id, type, amount } = req.body;

    // Validate trade parameters
    if (!wallet || !token_id || !type || !amount) {
      return res.status(400).json({ error: 'Missing required trade parameters.' });
    }

    // Verify contest is active
    const contest = await prisma.contests.findFirst({
      where: {
        id: req.params.contestId,
        start_time: { lte: new Date() },
        end_time: { gt: new Date() }
      }
    });
    
    if (!contest) {
      throw new Error('Contest not active.');
    }

    // Record trade
    const result = await prisma.contest_token_performance.create({
      data: {
        contest_id: req.params.contestId,
        wallet_address: wallet,
        token_id: token_id,
        trade_type: type,
        amount: amount
      }
    });
    
    res.json(result);
  } catch (error) {
    logApi.error('Submit trade failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/trades/{contestId}:
 *   get:
 *     summary: Get user's trades for a specific contest
 *     tags: [Trades]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest
 *       - in: query
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     responses:
 *       200:
 *         description: List of user's trades for the contest
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   contest_id:
 *                     type: string
 *                   wallet_address:
 *                     type: string
 *                   token_id:
 *                     type: string
 *                   symbol:
 *                     type: string
 *                   name:
 *                     type: string
 *                   trade_type:
 *                     type: string
 *                   amount:
 *                     type: number
 *                   token_price:
 *                     type: number
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *       500:
 *         description: Server error
 */
// Get user's trades for a specific contest (NO AUTH REQUIRED)
//      example: GET https://degenduel.me/api/trades/{contest_id}
//      headers: { "Cookie": "session=<jwt>" }
router.get('/:contestId', async (req, res) => {
  const { contestId } = req.params;
  const { wallet } = req.query;

  try {
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address is required.' });
    }

    const trades = await prisma.contest_token_performance.findMany({
      where: {
        contest_id: contestId,
        wallet_address: wallet
      },
      include: {
        token: {
          select: {
            symbol: true,
            name: true,
            token_prices: {
              select: {
                price: true
              },
              take: 1,
              orderBy: {
                created_at: 'desc'
              }
            }
          }
        }
      },
      orderBy: {
        created_at: 'desc'
      }
    });

    // Format the response to match the previous structure
    const formattedTrades = trades.map(trade => ({
      ...trade,
      symbol: trade.token.symbol,
      name: trade.token.name,
      token_price: trade.token.token_prices[0]?.price || null
    }));

    res.json(formattedTrades);
  } catch (error) {
    logApi.error('Get trades failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;