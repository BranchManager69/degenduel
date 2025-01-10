// /routes/auth.js
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
  logApi.info('Starting wallet verification', {
    requestId: req.id,
    wallet: req.body.wallet
  });

  try {
    const { wallet, signature, message } = req.body;
    
    logApi.debug('Received verification request', {
      requestId: req.id,
      wallet,
      messageLength: message?.length
    });

    // TODO: Add actual signature verification
    const verified = true; // Replace with actual verification

    if (!verified) {
      return res.status(401).json({ 
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE'
      });
    }

    logApi.debug('Creating session token', { requestId: req.id });
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

    logApi.info('Wallet authentication complete', {
      requestId: req.id,
      wallet
    });

    res.json({ 
      verified: true,
      // Optionally include any user data needed by the frontend
      user: {
        wallet_address: wallet
      }
    });

  } catch (error) {
    logApi.error('Wallet verification failed', {
      error: {
        message: error.message,
        stack: error.stack
      },
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
  logApi.info('Starting wallet connection', {
    requestId: req.id,
    wallet: req.body.wallet_address
  });

  try {
    const { wallet_address, nickname } = req.body;
    
    logApi.debug('Attempting database operation', {
      requestId: req.id,
      wallet: wallet_address
    });
    
    const result = await pool.query(`
      INSERT INTO users (wallet_address, nickname)
      VALUES ($1, $2)
      ON CONFLICT (wallet_address) 
      DO UPDATE SET last_login = CURRENT_TIMESTAMP
      RETURNING *
    `, [wallet_address, nickname]);

    logApi.debug('Database operation complete', {
      requestId: req.id,
      success: !!result.rows[0]
    });

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

    logApi.info('Wallet connection complete', {
      requestId: req.id,
      wallet: wallet_address
    });

    res.json(result.rows[0]);
  } catch (error) {
    logApi.error('Auth connect failed', {
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code // Useful for PostgreSQL errors
      },
      requestId: req.id,
      wallet: req.body.wallet_address
    });
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
  logApi.info('Starting wallet disconnection', {
    requestId: req.id,
    wallet: req.body.wallet
  });

  try {
    const { wallet } = req.body;
    
    logApi.debug('Attempting database update', {
      requestId: req.id,
      wallet
    });

    await pool.query(`
      UPDATE users 
      SET last_login = CURRENT_TIMESTAMP
      WHERE wallet_address = $1
    `, [wallet]);

    logApi.debug('Database update complete', {
      requestId: req.id,
      wallet
    });

    res.clearCookie('session');
    
    logApi.info('Wallet disconnection complete', {
      requestId: req.id,
      wallet
    });

    res.json({ success: true });
  } catch (error) {
    logApi.error('Wallet disconnect failed', {
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code
      },
      requestId: req.id,
      wallet: req.body.wallet
    });
    res.status(500).json({ error: error.message });
  }
});

export default router;