import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Contests
 *   description: API endpoints for managing trading contests
 */

// (no Swagger definition yet)
router.get('/', async (req, res) => {
  try {
    const contests = await pool.query('SELECT * FROM contests WHERE status != $1', ['completed']);
    res.json(contests.rows);
  } catch (error) {
    console.error('Error fetching contests:', error);
    res.status(500).json({ error: 'Failed to fetch contests.' });
  }
});


/**
 * @swagger
 * /api/contests/active:
 *   get:
 *     summary: Get all active contests
 *     tags: [Contests]
 *     parameters:
 *       - in: query
 *         name: wallet
 *         schema:
 *           type: string
 *         description: User's wallet address to check participation status
 *     responses:
 *       200:
 *         description: List of active contests
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   start_time:
 *                     type: string
 *                     format: date-time
 *                   end_time:
 *                     type: string
 *                     format: date-time
 *                   participant_count:
 *                     type: integer
 *                   is_participating:
 *                     type: boolean
 *       500:
 *         description: Server error
 */
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

/**
 * @swagger
 * /api/contests/{contestId}:
 *   get:
 *     summary: Get contest details by ID
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest
 *     responses:
 *       200:
 *         description: Contest details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 start_time:
 *                   type: string
 *                   format: date-time
 *                 end_time:
 *                   type: string
 *                   format: date-time
 *                 participant_count:
 *                   type: integer
 *                 allowed_tokens:
 *                   type: array
 *                   items:
 *                     type: string
 *       404:
 *         description: Contest not found
 *       500:
 *         description: Server error
 */
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

/**
 * @swagger
 * /api/contests/{contestId}/enter:
 *   post:
 *     summary: Enter a contest
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest to enter
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet
 *             properties:
 *               wallet:
 *                 type: string
 *                 description: User's wallet address
 *     responses:
 *       200:
 *         description: Successfully entered contest
 *       500:
 *         description: Server error or contest already started
 */
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

/**
 * @swagger
 * /api/contests/{contestId}/leaderboard:
 *   get:
 *     summary: Get contest leaderboard
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest
 *     responses:
 *       200:
 *         description: Contest leaderboard
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   wallet_address:
 *                     type: string
 *                   nickname:
 *                     type: string
 *                   total_pl:
 *                     type: number
 *                   tokens_traded:
 *                     type: integer
 *                   best_trade:
 *                     type: number
 *                   rank:
 *                     type: integer
 *       500:
 *         description: Server error
 */
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