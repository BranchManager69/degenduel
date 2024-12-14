import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Trades
 *   description: API endpoints for managing contest trades
 */

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
router.post('/:contestId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { wallet, token_id, type, amount } = req.body;
    
    // Verify contest is active
    const contestCheck = await client.query(`
      SELECT * FROM contests 
      WHERE id = $1 
        AND start_time <= CURRENT_TIMESTAMP 
        AND end_time > CURRENT_TIMESTAMP
    `, [req.params.contestId]);
    
    if (contestCheck.rows.length === 0) {
      throw new Error('Contest not active');
    }
    
    // Record trade
    const result = await client.query(`
      INSERT INTO contest_token_performance 
        (contest_id, wallet_address, token_id, trade_type, amount)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [req.params.contestId, wallet, token_id, type, amount]);
    
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Submit trade failed:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
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
router.get('/:contestId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        ctp.*,
        t.symbol,
        t.name,
        tp.price as token_price
      FROM contest_token_performance ctp
      JOIN tokens t ON ctp.token_id = t.id
      LEFT JOIN token_prices tp ON t.id = tp.token_id
      WHERE contest_id = $1 AND wallet_address = $2
      ORDER BY ctp.created_at DESC
    `, [req.params.contestId, req.query.wallet]);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get trades failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;