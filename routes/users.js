import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: API endpoints for managing user accounts and profiles
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: A list of users.
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
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                   last_login:
 *                     type: string
 *                     format: date-time
 *                   total_contests:
 *                     type: integer
 *                   total_wins:
 *                     type: integer
 *                   total_earnings:
 *                     type: string
 *                   rank_score:
 *                     type: integer
 *                   settings:
 *                     type: object
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (error) {
    logger.error('Get users failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users/{wallet}:
 *   get:
 *     summary: Get a user by wallet address
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address of the user
 *     responses:
 *       200:
 *         description: A single user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet_address:
 *                   type: string
 *                 nickname:
 *                   type: string
 *       404:
 *         description: User not found
 */
router.get('/:wallet', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE wallet_address = $1',
      [req.params.wallet]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get user failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet_address
 *               - nickname
 *             properties:
 *               wallet_address:
 *                 type: string
 *               nickname:
 *                 type: string
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet_address:
 *                   type: string
 *                 nickname:
 *                   type: string
 *       400:
 *         description: Missing required fields
 */
router.post('/', async (req, res) => {
  const { wallet_address, nickname } = req.body;
  if (!wallet_address || !nickname) {
    return res.status(400).json({ error: 'Missing wallet_address or nickname' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO users (wallet_address, nickname) VALUES ($1, $2) RETURNING *',
      [wallet_address, nickname]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error adding user:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users/{wallet}:
 *   put:
 *     summary: Update a user profile
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address of the user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nickname:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated successfully
 *       404:
 *         description: User not found
 */
router.put('/:wallet', async (req, res) => {
  try {
    const { nickname } = req.body;
    const result = await pool.query(
      `
      UPDATE users 
      SET 
        nickname = COALESCE($2, nickname),
        last_login = CURRENT_TIMESTAMP
      WHERE wallet_address = $1
      RETURNING *
      `,
      [req.params.wallet, nickname]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update user failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users/{wallet}/settings:
 *   put:
 *     summary: Update a user's settings
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address of the user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               settings:
 *                 type: object
 *     responses:
 *       200:
 *         description: User settings updated successfully
 *       404:
 *         description: User not found
 */
router.put('/:wallet/settings', async (req, res) => {
  try {
    const { settings } = req.body;
    const result = await pool.query(
      `
      UPDATE users 
      SET settings = settings || $2::jsonb
      WHERE wallet_address = $1
      RETURNING *
      `,
      [req.params.wallet, JSON.stringify(settings)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update settings failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users/top:
 *   get:
 *     summary: Get top users by rank score
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Limit the number of top users returned
 *     responses:
 *       200:
 *         description: List of top users
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
 *                   rank_score:
 *                     type: integer
 *                   total_earnings:
 *                     type: string
 *       500:
 *         description: Server error
 */
router.get('/top', async (req, res) => {
  const { limit = 10 } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT wallet_address, nickname, rank_score, total_earnings 
      FROM users 
      ORDER BY rank_score DESC 
      LIMIT $1;
      `,
      [limit]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get top users failed:', error);
    res.status(500).json({ error: 'Failed to fetch top users.' });
  }
});

/**
 * @swagger
 * /api/users/{wallet}/rank/reset:
 *   post:
 *     summary: Reset user rank score
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address of the user
 *     responses:
 *       200:
 *         description: User rank score reset successfully
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/:wallet/rank/reset', async (req, res) => {
  try {
    const result = await pool.query(
      `
      UPDATE users 
      SET rank_score = 1000 
      WHERE wallet_address = $1 
      RETURNING *;
      `,
      [req.params.wallet]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    logger.error('Reset rank score failed:', error);
    res.status(500).json({ error: 'Failed to reset rank score.' });
  }
});

/**
 * @swagger
 * /api/users/earnings:
 *   get:
 *     summary: Get users by earnings range
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: min
 *         schema:
 *           type: string
 *           default: 0
 *         description: Minimum earnings
 *       - in: query
 *         name: max
 *         schema:
 *           type: string
 *           default: 1000000
 *         description: Maximum earnings
 *     responses:
 *       200:
 *         description: List of users within the earnings range
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
 *                   total_earnings:
 *                     type: string
 *       500:
 *         description: Server error
 */
router.get('/earnings', async (req, res) => {
  const { min = '0', max = '1000000' } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT wallet_address, nickname, total_earnings 
      FROM users 
      WHERE total_earnings BETWEEN $1 AND $2;
      `,
      [min, max]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get users by earnings range failed:', error);
    res.status(500).json({ error: 'Failed to fetch users by earnings range.' });
  }
});

/**
 * @swagger
 * /api/users/{wallet}/deactivate:
 *   patch:
 *     summary: Deactivate a user account
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address of the user
 *     responses:
 *       200:
 *         description: User deactivated successfully
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.patch('/:wallet/deactivate', async (req, res) => {
  try {
    const result = await pool.query(
      `
      UPDATE users 
      SET is_active = false 
      WHERE wallet_address = $1 
      RETURNING *;
      `,
      [req.params.wallet]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    logger.error('Deactivate user failed:', error);
    res.status(500).json({ error: 'Failed to deactivate user.' });
  }
});

/**
 * @swagger
 * /api/users/{wallet}/rank/recalculate:
 *   post:
 *     summary: Recalculate user rank score
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address of the user
 *     responses:
 *       200:
 *         description: User rank score recalculated successfully
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/:wallet/rank/recalculate', async (req, res) => {
  try {
    const userCheck = await pool.query(
      `SELECT * FROM users WHERE wallet_address = $1`,
      [req.params.wallet]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const newRankScore = Math.max(
      1000,
      Math.floor(userCheck.rows[0].total_wins * 50 + userCheck.rows[0].total_earnings / 1000)
    );

    const result = await pool.query(
      `
      UPDATE users 
      SET rank_score = $2 
      WHERE wallet_address = $1 
      RETURNING *;
      `,
      [req.params.wallet, newRankScore]
    );

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    logger.error('Recalculate rank failed:', error);
    res.status(500).json({ error: 'Failed to recalculate rank.' });
  }
});

export default router;
