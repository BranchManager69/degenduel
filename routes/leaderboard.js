// /routes/leaderboard.js
import express from 'express';
import { addScore, getLeaderboard } from '../archive/controllers/leaderboard.js';
import { validateGetLeaderboard, validateScore } from '../middleware/leaderboardValidation.js';
import { logApi } from '../utils/logger-suite/logger.js';
//import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';

const router = express.Router();

/*
 *
 * I am not sure if even a single one of these endpoints actually works
 * (I highly doubt it)
 * 
 */

/**
 * @swagger
 * @swagger
 * tags:
 *   name: Leaderboard
 *   description: API endpoints for global leaderboard management
 */

/* Leaderboard Routes */

/**
 * @swagger
 * /api/leaderboard:
 *   get:
 *     summary: Get global leaderboard
 *     tags: [Leaderboard]
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [all, month, week]
 *           default: all
 *         description: Time period for leaderboard data
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of records to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of records to skip
 *     responses:
 *       200:
 *         description: List of top performers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total number of ranked users
 *                 rankings:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       wallet_address:
 *                         type: string
 *                       nickname:
 *                         type: string
 *                       score:
 *                         type: number
 *                       contests_won:
 *                         type: integer
 *       400:
 *         description: Invalid parameters provided
 *       500:
 *         description: Server error
 */
//   example: GET https://degenduel.me/api/leaderboard?timeframe=all&limit=10&offset=0
router.get('/', validateGetLeaderboard, getLeaderboard);

/**
 * @swagger
 * /api/leaderboard:
 *   post:
 *     summary: Add new score to leaderboard
 *     tags: [Leaderboard]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet_address
 *               - score
 *               - contest_id
 *             properties:
 *               wallet_address:
 *                 type: string
 *                 description: User's wallet address
 *               score:
 *                 type: number
 *                 description: Score to be added
 *               contest_id:
 *                 type: string
 *                 description: ID of the contest this score is from
 *     responses:
 *       201:
 *         description: Score added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet_address:
 *                   type: string
 *                 new_score:
 *                   type: number
 *                 new_rank:
 *                   type: integer
 *       400:
 *         description: Invalid score data
 *       401:
 *         description: Unauthorized request
 *       500:
 *         description: Server error
 */
//   example: POST https://degenduel.me/api/leaderboard
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "score": 100, "contest_id": "1" }
router.post('/', validateScore, addScore);

/**
 * @swagger
 * /api/leaderboard/contest/{contestId}:
 *   get:
 *     summary: Get leaderboard for a specific contest
 *     tags: [Leaderboard]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of top performers to return
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
 *                   rank:
 *                     type: integer
 *                   wallet_address:
 *                     type: string
 *                   nickname:
 *                     type: string
 *                   performance:
 *                     type: number
 *       404:
 *         description: Contest not found
 *       500:
 *         description: Server error
 */
//   example: GET https://degenduel.me/api/leaderboard/contest/1?limit=10
router.get('/contest/:contestId', async (req, res) => {
    const { contestId } = req.params;
    const { limit = 10 } = req.query;

    logApi.info('Fetching contest leaderboard', {
        contestId,
        limit
    });

    try {
        const result = await pool.query(
            `
            SELECT 
                ROW_NUMBER() OVER (ORDER BY SUM(ctp.profit_loss) DESC) AS rank,
                cp.wallet_address,
                u.nickname,
                SUM(ctp.profit_loss) AS performance
            FROM contest_token_performance ctp
            JOIN contest_participants cp ON ctp.wallet_address = cp.wallet_address
            JOIN users u ON cp.wallet_address = u.wallet_address
            WHERE cp.contest_id = $1
            GROUP BY cp.wallet_address, u.nickname
            ORDER BY performance DESC
            LIMIT $2;
            `,
            [contestId, limit]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Contest not found or no participants.' });
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching contest leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch contest leaderboard.' });
    }
});

/**
 * @swagger
 * /api/leaderboard/token/{tokenId}:
 *   get:
 *     summary: Get leaderboard by token
 *     tags: [Leaderboard]
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the token
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of top performers to return
 *     responses:
 *       200:
 *         description: Token-specific leaderboard
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   rank:
 *                     type: integer
 *                   wallet_address:
 *                     type: string
 *                   nickname:
 *                     type: string
 *                   token_performance:
 *                     type: number
 *       500:
 *         description: Server error
 */
//   example: GET https://degenduel.me/api/leaderboard/token/1?limit=10
router.get('/token/:tokenId', async (req, res) => {
    const { tokenId } = req.params;
    const { limit = 10 } = req.query;

    try {
        const result = await pool.query(
            `
            SELECT 
                ROW_NUMBER() OVER (ORDER BY SUM(ctp.profit_loss) DESC) AS rank,
                ctp.wallet_address,
                u.nickname,
                SUM(ctp.profit_loss) AS token_performance
            FROM contest_token_performance ctp
            JOIN users u ON ctp.wallet_address = u.wallet_address
            WHERE ctp.token_id = $1
            GROUP BY ctp.wallet_address, u.nickname
            ORDER BY token_performance DESC
            LIMIT $2;
            `,
            [tokenId, limit]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching leaderboard by token:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard by token.' });
    }
});

/**
 * @swagger
 * /api/leaderboard/history:
 *   get:
 *     summary: Get historical leaderboard data
 *     tags: [Leaderboard]
 *     parameters:
 *       - in: query
 *         name: season
 *         schema:
 *           type: string
 *           description: Season or timeframe for historical data
 *     responses:
 *       200:
 *         description: Historical leaderboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   season:
 *                     type: string
 *                   rankings:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         rank:
 *                           type: integer
 *                         wallet_address:
 *                           type: string
 *                         nickname:
 *                           type: string
 *                         score:
 *                           type: number
 *       500:
 *         description: Server error
 */
//   example: GET https://degenduel.me/api/leaderboard/history?season=2024
router.get('/history', async (req, res) => {
    const { season } = req.query;

    try {
        const query = season
            ? `SELECT * FROM leaderboard_history WHERE season = $1 ORDER BY rank ASC`
            : `SELECT * FROM leaderboard_history ORDER BY season ASC, rank ASC`;

        const params = season ? [season] : [];

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching leaderboard history:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard history.' });
    }
});

/**
 * @swagger
 * /api/leaderboard/adjust:
 *   patch:
 *     summary: Adjust user rank manually
 *     tags: [Leaderboard]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet_address
 *               - adjustment
 *             properties:
 *               wallet_address:
 *                 type: string
 *               adjustment:
 *                 type: integer
 *                 description: Value to add/subtract from rank score
 *     responses:
 *       200:
 *         description: User rank adjusted successfully
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
//   example: POST https://degenduel.me/api/leaderboard/adjust
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "adjustment": 100 }
router.patch('/adjust', async (req, res) => {
    const { wallet_address, adjustment } = req.body;

    try {
        const result = await pool.query(
            `
            UPDATE users 
            SET rank_score = rank_score + $2 
            WHERE wallet_address = $1 
            RETURNING wallet_address, rank_score;
            `,
            [wallet_address, adjustment]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error('Error adjusting user rank:', error);
        res.status(500).json({ error: 'Failed to adjust rank.' });
    }
});

/**
 * @swagger
 * /api/leaderboard/reset:
 *   post:
 *     summary: Reset the global leaderboard
 *     tags: [Leaderboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Global leaderboard reset successfully
 *       401:
 *         description: Unauthorized request
 *       500:
 *         description: Server error
 */
//   example: POST https://degenduel.me/api/leaderboard/reset
router.post('/reset', async (req, res) => {
    try {
        await pool.query(`
            UPDATE users 
            SET rank_score = 1000, total_contests = 0, total_wins = 0, total_earnings = 0;
        `);
        res.json({ success: true, message: 'Global leaderboard reset successfully.' });
    } catch (error) {
        console.error('Error resetting global leaderboard:', error);
        res.status(500).json({ error: 'Failed to reset leaderboard.' });
    }
});

export default router;