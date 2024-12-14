import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../config/logger.js';

const router = express.Router();

// Get active contests
router.get('/active', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, 
             COUNT(DISTINCT cp.wallet_address) as participant_count,
             EXISTS(
               SELECT 1 FROM contest_participants 
               WHERE contest_id = c.id AND wallet_address = $1
             ) as is_participating
      FROM contests c
      LEFT JOIN contest_participants cp ON c.id = cp.contest_id
      WHERE c.end_time > CURRENT_TIMESTAMP
      GROUP BY c.id
      ORDER BY c.start_time ASC
    `, [req.query.wallet || null]);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get active contests failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get contest details
router.get('/:contestId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, 
             COUNT(DISTINCT cp.wallet_address) as participant_count,
             json_agg(DISTINCT t.symbol) as allowed_tokens
      FROM contests c
      LEFT JOIN contest_participants cp ON c.id = cp.contest_id
      LEFT JOIN token_bucket_memberships tbm ON c.token_bucket_id = tbm.bucket_id
      LEFT JOIN tokens t ON tbm.token_id = t.id
      WHERE c.id = $1
      GROUP BY c.id
    `, [req.params.contestId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contest not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get contest failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enter contest
router.post('/:contestId/enter', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check if contest exists and is open
    const contestCheck = await client.query(`
      SELECT * FROM contests 
      WHERE id = $1 AND start_time > CURRENT_TIMESTAMP
    `, [req.params.contestId]);
    
    if (contestCheck.rows.length === 0) {
      throw new Error('Contest not found or already started');
    }
    
    // Add participant
    await client.query(`
      INSERT INTO contest_participants (contest_id, wallet_address)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [req.params.contestId, req.body.wallet]);
    
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Enter contest failed:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Get contest leaderboard
router.get('/:contestId/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH user_performance AS (
        SELECT 
          cp.wallet_address,
          u.nickname,
          SUM(ctp.profit_loss) as total_pl,
          COUNT(DISTINCT ctp.token_id) as tokens_traded,
          MAX(ctp.profit_loss) as best_trade
        FROM contest_participants cp
        JOIN users u ON cp.wallet_address = u.wallet_address
        LEFT JOIN contest_token_performance ctp 
          ON cp.contest_id = ctp.contest_id 
          AND cp.wallet_address = ctp.wallet_address
        WHERE cp.contest_id = $1
        GROUP BY cp.wallet_address, u.nickname
      )
      SELECT 
        wallet_address,
        nickname,
        total_pl,
        tokens_traded,
        best_trade,
        RANK() OVER (ORDER BY total_pl DESC) as rank
      FROM user_performance
      ORDER BY total_pl DESC
    `, [req.params.contestId]);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get leaderboard failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;