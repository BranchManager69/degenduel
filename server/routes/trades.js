import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../../utils/logger.js';

const router = express.Router();

// Submit trade for contest
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

// Get user's trades for contest
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