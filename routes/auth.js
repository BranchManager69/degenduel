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
// example: POST https://degenduel.me/api/auth/verify-wallet
//    body: { "wallet": "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp", "signature": "[actual wallet signature here]", "message": "Welcome to DegenDuel." }
router.post('/verify-wallet', async (req, res) => {
  logApi.info('Starting wallet verification', {
    requestId: req.id,
    wallet: req.body.wallet
  });

  try {
    const { wallet, signature, message } = req.body;
    
    logApi.debug('📨 Received verification request', {
      requestId: req.id,
      wallet,
      messageLength: message?.length
    });

    /* TODO: Add actual signature verification */
    const verified = true;

    if (!verified) {
      // Signing failed
      return res.status(401).json({ 
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE'
      });
    }

    // Create JWT for user's session (24 hours)
    logApi.debug('🔐 Creating session token', { requestId: req.id });
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
      httpOnly: true,               // Prevents JavaScript access
      secure: true,                 // Only sent over HTTPS
      sameSite: 'lax',              // Protects against CSRF
      maxAge: 24 * 60 * 60 * 1000   // 24 hours in milliseconds
    });

    // Return the session token and user data
    res.json({ 
      verified: true,                 // Wallet signature verified
      token: token,                   // Session token
      user: {
        wallet_address: wallet,       // Wallet address
        //nickname: 'Branch Manager'  // User's chosen nickname
      }
    });
    
    // Log the successful authentication
    logApi.info(`🔐 Authenticated*\n\tWaiting for session cookie...`, {
      wallet,
      requestId: req.id
    });

    // Return the session token and user data
    res.json({ 
      verified: true,                 // Wallet signature verified
      token: token,                   // Session token
      user: {
        wallet_address: wallet,       // Wallet address
      }
    });

    // Log the successful authentication
    logApi.info(`🔐 Successfully authenticated!\n\tWelcome, ${wallet}.`, {
      wallet,
      requestId: req.id
    });

  } catch (error) {
    // Auth failed at wallet verification
    logApi.error('🚫 Wallet verification failed', {
      error: {
        message: error.message,
        stack: error.stack
      },
      requestId: req.id
    });

    // Return error message
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
// Connect wallet and create/update user (??)
//   example: POST https://degenduel.me/api/auth/connect
//      body: { "wallet_address": "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp", "nickname": "BM" }
router.post('/connect', async (req, res) => {
  logApi.info('🔐 Starting wallet connection', {
    requestId: req.id,
    wallet: req.body.wallet_address
  });

  try {
    const { wallet_address, nickname } = req.body;
    
    logApi.debug('🔐 Attempting database operation', {
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

    logApi.debug('🔐 Database operation complete', {
      requestId: req.id,
      success: !!result.rows[0]
    });

    // Create a fresh session token
    logApi.debug(`🔐 Creating session token for ${wallet_address}`, { requestId: req.id });
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
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    // // Return the session token and user data
    // res.json({ 
    //   token: token,
    //   user: {
    //     wallet_address: wallet_address,
    //     //nickname: 'Branch Manager'
    //   }
    // });

    // Log the connection
    logApi.info(`🔐 Wallet connected!`, {
      wallet: wallet_address,
      requestId: req.id
    });

    // Return the user data
    res.json(result.rows[0]);

  
  } catch (error) {
    logApi.error('🚫 Auth connect failed', {
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code // Useful for PostgreSQL errors
      },
      requestId: req.id,
      wallet: req.body.wallet_address
    });

    // Return error message
    res.status(500).json({
      error: error.message,
      code: error.code
    });
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
// Disconnect wallet (??)
//   example: POST https://degenduel.me/api/auth/disconnect
//      body: { "wallet": "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp" }
router.post('/disconnect', async (req, res) => {
  logApi.info('🔐 Starting wallet disconnection', {
    requestId: req.id,
    wallet: req.body.wallet
  });

  try {
    const { wallet } = req.body;
    
    logApi.debug('🔐 Attempting database update', {
      requestId: req.id,
      wallet
    });

    await pool.query(`
      UPDATE users 
      SET last_login = CURRENT_TIMESTAMP
      WHERE wallet_address = $1
    `, [wallet]);

    logApi.debug('🔐 Database update complete', {
      requestId: req.id,
      wallet
    });

    res.clearCookie('session');
    
    logApi.info('🔐 Wallet disconnection complete', {
      requestId: req.id,
      wallet
    });

    res.json({ success: true });
  } catch (error) {
    logApi.error('🚫 Wallet disconnect failed', {
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code
      },
      requestId: req.id,
      wallet: req.body.wallet
    });

    // Return error message
    res.status(500).json({
      error: error.message,
      code: error.code
    });
  }
});

export default router;