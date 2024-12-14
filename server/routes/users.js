import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: API endpoints for user management and profiles
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
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

export default router;
