import express from 'express';
import { getLeaderboard, addScore } from '../controllers/leaderboard.js';
import { validateScore, validateGetLeaderboard } from '../middleware/validation.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Leaderboard
 *   description: API endpoints for global leaderboard management
 */

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
router.post('/', validateScore, addScore);

export default router;