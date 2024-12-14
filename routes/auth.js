import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: API endpoints for user authentication
 */

/**
 * @swagger
 * /api/auth/verify-wallet:
 *   post:
 *     summary: Verify a wallet signature
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet
 *               - signature
 *               - message
 *             properties:
 *               wallet:
 *                 type: string
 *                 description: User's wallet address
 *               signature:
 *                 type: string
 *                 description: Signed message
 *               message:
 *                 type: string
 *                 description: Original message that was signed
 *     responses:
 *       200:
 *         description: Signature verified successfully
 *       500:
 *         description: Server error during verification
 */
router.post('/verify-wallet', async (req, res) => {
  try {
    const { wallet, signature, message } = req.body;
    // TODO: Add actual signature verification
    res.json({ verified: true });
  } catch (error) {
    logger.error('Wallet verification failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auth/connect:
 *   post:
 *     summary: Connect wallet and create/update user
 *     tags: [Authentication]
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
 *                 description: User's wallet address
 *               nickname:
 *                 type: string
 *                 description: User's chosen nickname
 *     responses:
 *       200:
 *         description: User connected successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet_address:
 *                   type: string
 *                 nickname:
 *                   type: string
 *                 last_login:
 *                   type: string
 *                   format: date-time
 */
router.post('/connect', async (req, res) => {
    try {
      const { wallet_address, nickname } = req.body;
      
      // Insert user if doesn't exist
      const result = await pool.query(`
        INSERT INTO users (wallet_address, nickname)
        VALUES ($1, $2)
        ON CONFLICT (wallet_address) 
        DO UPDATE SET last_login = CURRENT_TIMESTAMP
        RETURNING *
      `, [wallet_address, nickname]);
  
      res.json(result.rows[0]);
    } catch (error) {
      logger.error('Auth connect failed:', error);
      res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/auth/disconnect:
 *   post:
 *     summary: Disconnect wallet
 *     tags: [Authentication]
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
 *         description: Wallet disconnected successfully
 *       500:
 *         description: Server error during disconnection
 */
router.post('/disconnect', async (req, res) => {
  try {
    const { wallet } = req.body;
    await pool.query(`
      UPDATE users 
      SET last_login = CURRENT_TIMESTAMP
      WHERE wallet_address = $1
    `, [wallet]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Wallet disconnect failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;