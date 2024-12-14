import express from 'express';
import { pool } from '../config/pg-database.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Test
 *   description: Test endpoints for development and debugging purposes
 *   x-display-name: "⚠️ Test Routes"
 */

/**
 * @swagger
 * /api/test/test-user:
 *   post:
 *     summary: Create a test user
 *     tags: [Test]
 *     description: Creates a test user with predefined values. For development use only.
 *     responses:
 *       200:
 *         description: Test user created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet_address:
 *                   type: string
 *                   example: "0xTestWallet456"
 *                 nickname:
 *                   type: string
 *                   example: "TestUser2"
 *                 rank_score:
 *                   type: integer
 *                   example: 1000
 *       500:
 *         description: Server error
 */
router.post('/test-user', async (req, res) => {
  try {
    const result = await pool.query(`
      INSERT INTO users (wallet_address, nickname, rank_score)
      VALUES ($1, $2, $3)
      RETURNING *
    `, ['0xTestWallet456', 'TestUser2', 1000]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/test/test-user/{wallet}:
 *   put:
 *     summary: Update test user's rank score
 *     tags: [Test]
 *     description: Increases the rank score of a test user by 10 points
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Test user's wallet address
 *     responses:
 *       200:
 *         description: Rank score updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet_address:
 *                   type: string
 *                 rank_score:
 *                   type: integer
 *       500:
 *         description: Server error
 */
router.put('/test-user/:wallet', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE users 
      SET rank_score = rank_score + 10
      WHERE wallet_address = $1
      RETURNING *
    `, [req.params.wallet]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/test/test-user/{wallet}/settings:
 *   put:
 *     summary: Update test user's settings
 *     tags: [Test]
 *     description: Updates the settings of a test user with predefined values
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Test user's wallet address
 *     responses:
 *       200:
 *         description: Settings updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet_address:
 *                   type: string
 *                 settings:
 *                   type: object
 *                   properties:
 *                     theme:
 *                       type: string
 *                       example: "dark"
 *                     notifications:
 *                       type: boolean
 *                       example: true
 *       500:
 *         description: Server error
 */
router.put('/test-user/:wallet/settings', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE users 
      SET settings = settings || '{"theme": "dark", "notifications": true}'::jsonb
      WHERE wallet_address = $1
      RETURNING *
    `, [req.params.wallet]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/test/test-user/{wallet}/profile:
 *   put:
 *     summary: Update multiple test user fields
 *     tags: [Test]
 *     description: Updates multiple fields of a test user simultaneously
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Test user's wallet address
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet_address:
 *                   type: string
 *                 nickname:
 *                   type: string
 *                   example: "UpdatedNick"
 *                 rank_score:
 *                   type: integer
 *                 settings:
 *                   type: object
 *                   properties:
 *                     showBalance:
 *                       type: boolean
 *                       example: true
 *                 last_login:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Server error
 */
router.put('/test-user/:wallet/profile', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE users 
      SET 
        nickname = 'UpdatedNick',
        rank_score = rank_score + 5,
        settings = settings || '{"showBalance": true}'::jsonb,
        last_login = CURRENT_TIMESTAMP
      WHERE wallet_address = $1
      RETURNING *
    `, [req.params.wallet]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
