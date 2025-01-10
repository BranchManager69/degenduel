import express from 'express';
import { pool } from '../config/pg-database.js';
import { logApi } from '../utils/logger-suite/logger.js';

const router = express.Router();

/*
 *
 *  NEEDS TO BE UPDATED TO USE PRISMA!
 *
 */

/**
 * @swagger
 * tags:
 *   name: Statistics
 *   description: API endpoints for user statistics and achievements
 */


/* Stats Routes */

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
// Get user's overall statistics
router.get('/:wallet', async (req, res) => {
    try {
        const result = await pool.query(`
        WITH user_stats AS (
            SELECT 
            wallet_address,
            COUNT(DISTINCT contest_id) as total_contests,
            SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END) as total_wins
            FROM contest_participants
            GROUP BY wallet_address
        )
        SELECT 
            u.*,
            COALESCE(us.total_contests, 0) as total_contests,
            COALESCE(us.total_wins, 0) as total_wins
        FROM users u
        LEFT JOIN user_stats us ON u.wallet_address = us.wallet_address
        WHERE u.wallet_address = $1
        `, [req.params.wallet]);

        if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        logApi.error('Get stats failed:', error);
        res.status(500).json({ error: error.message });
    }
});
  
/**
 * @swagger
 * /api/stats/{wallet}/history:
 *   get:
 *     summary: Get user's trading history
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
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   contest_id:
 *                     type: string
 *                   contest_name:
 *                     type: string
 *                   start_time:
 *                     type: string
 *                     format: date-time
 *                   end_time:
 *                     type: string
 *                     format: date-time
 *                   initial_balance:
 *                     type: number
 *                   current_balance:
 *                     type: number
 *                   rank:
 *                     type: integer
 *       500:
 *         description: Server error
 */
// Get user's contest history
router.get('/:wallet/history', async (req, res) => {
try {
      const result = await pool.query(`
        SELECT 
          c.id as contest_id,
          c.name as contest_name,
          c.start_time,
          c.end_time,
          cp.initial_balance,
          cp.current_balance,
          cp.rank
        FROM contests c
        JOIN contest_participants cp ON c.id = cp.contest_id
        WHERE cp.wallet_address = $1
        ORDER BY c.end_time DESC
        LIMIT $2
        OFFSET $3
      `, [req.params.wallet, req.query.limit || 10, req.query.offset || 0]);
      
      res.json(result.rows);
    } catch (error) {
      logApi.error('Get history failed:', error);
      res.status(500).json({ error: error.message });
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
 *                     enum: [first_contest, three_contests, five_contests]
 *                   achieved_at:
 *                     type: string
 *                     format: date-time
 *                   display_name:
 *                     type: string
 *                     description: Human-readable achievement name
 *                     example: "First Contest Entry"
 *       500:
 *         description: Server error
 */
// Get user's achievements
router.get('/:wallet/achievements', async (req, res) => {
    try {
      const result = await pool.query(`
        WITH user_achievements AS (
          -- First Contest Achievement
          SELECT 
            cp.wallet_address,
            'first_contest' as achievement,
            MIN(cp.joined_at) as achieved_at
          FROM contest_participants cp
          GROUP BY cp.wallet_address
  
          UNION ALL
  
          -- Multiple Contests Achievement
          SELECT 
            cp.wallet_address,
            CASE 
              WHEN COUNT(*) >= 5 THEN 'five_contests'
              WHEN COUNT(*) >= 3 THEN 'three_contests'
            END as achievement,
            MAX(cp.joined_at) as achieved_at
          FROM contest_participants cp
          GROUP BY cp.wallet_address
          HAVING COUNT(*) >= 3
        )
        SELECT 
          ua.achievement,
          ua.achieved_at,
          CASE ua.achievement
            WHEN 'first_contest' THEN 'First Contest Entry'
            WHEN 'three_contests' THEN 'Participated in 3 Contests'
            WHEN 'five_contests' THEN 'Participated in 5 Contests'
          END as display_name
        FROM user_achievements ua
        WHERE wallet_address = $1
        ORDER BY ua.achieved_at DESC
      `, [req.params.wallet]);
      
      res.json(result.rows);
    } catch (error) {
      logApi.error('Get achievements failed:', error);
      res.status(500).json({ error: error.message });
    }
});

export default router;