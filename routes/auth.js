import express from 'express';
import pkg from 'jsonwebtoken';
import { config } from '../config/config.js';
import { pool } from '../config/pg-database.js';
import { logApi } from '../utils/logger-suite/logger.js';
const { sign } = pkg;

const router = express.Router();


/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: API endpoints for user authentication
 */

/* Auth Routes */

/**
 * @swagger
 * /api/auth/verify-wallet:
 *   post:
 *     summary: Verify a wallet signature and establish a session
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
 *         description: Signature verified and session established
 *       401:
 *         description: Invalid signature
 *       500:
 *         description: Server error during verification
 */
// Verify wallet signature and establish a session
router.post('/verify-wallet', async (req, res) => {
  try {
    const { wallet, signature, message } = req.body;
    
    // TODO: Add actual signature verification
    const verified = true; // Replace with actual verification

    if (!verified) {
      return res.status(401).json({ 
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE'
      });
    }

    // Create a session token
    const token = sign(
      { 
        wallet,
        timestamp: Date.now()
      },
      config.jwt.secret,
      { 
        expiresIn: '24h'  // Token expires in 24 hours
      }
    );

    // Set the session cookie
    res.cookie('session', token, {
      httpOnly: true,      // Prevents JavaScript access
      secure: true,        // Only sent over HTTPS
      sameSite: 'strict',  // Protects against CSRF
      maxAge: 24 * 60 * 60 * 1000  // 24 hours in milliseconds
    });

    // Log the successful authentication
    logApi.info('Wallet authenticated successfully', {
      wallet,
      requestId: req.id
    });

    res.json({ 
      verified: true,
      // Optionally include any user data needed by the frontend
      user: {
        wallet_address: wallet
      }
    });

  } catch (error) {
    logApi.error('Wallet verification failed:', {
      error,
      requestId: req.id
    });

    res.status(500).json({ 
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
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
// Connect wallet and create/update user
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

    // Create a fresh session token
    const token = sign(
      { 
        wallet: wallet_address,
        timestamp: Date.now()
      },
      config.jwt.secret,
      { 
        expiresIn: '24h'
      }
    );

    // Set the session cookie
    res.cookie('session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    // Log the connection
    logApi.info('Wallet connected successfully', {
      wallet: wallet_address,
      requestId: req.id
    });

    res.json(result.rows[0]);
  } catch (error) {
    logApi.error('Auth connect failed:', error);
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
// Disconnect wallet
router.post('/disconnect', async (req, res) => {
  try {
    const { wallet } = req.body;
    await pool.query(`
      UPDATE users 
      SET last_login = CURRENT_TIMESTAMP
      WHERE wallet_address = $1
    `, [wallet]);

    // Clear the session cookie
    res.clearCookie('session');
    
    res.json({ success: true });
  } catch (error) {
    logApi.error('Wallet disconnect failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;