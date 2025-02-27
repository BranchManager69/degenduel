// routes/auth.js

import { PublicKey } from '@solana/web3.js';
import express from 'express';
import jwt from 'jsonwebtoken';
import nacl from 'tweetnacl';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { clearNonce, generateNonce, getNonceRecord } from '../utils/dbNonceStore.js';
import { requireAuth } from '../middleware/auth.js';
import { UserRole } from '../types/userRole.js';
import crypto from 'crypto';

const router = express.Router();
const { sign } = jwt;

// Create a service-specific logger with analytics
const authLogger = {
    ...logApi.forService('AUTH'),
    analytics: logApi.analytics
};

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: User authentication endpoints
 */

/**
 * @swagger
 * /api/auth/challenge:
 *   get:
 *     summary: Get a challenge nonce for wallet authentication
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address to generate nonce for
 *     responses:
 *       200:
 *         description: Challenge nonce generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nonce:
 *                   type: string
 *       400:
 *         description: Missing wallet address
 *       500:
 *         description: Internal server error
 */
// Example: GET /api/auth/challenge?wallet=<WALLET_ADDR>
router.get('/challenge', async (req, res) => {
  try {
    // Debug mode
    if (config.debug_mode) { logApi.info('Challenge request received', { wallet: req.query.wallet }); }
    
    const { wallet } = req.query;
    if (!wallet) {
      if (config.debug_mode) { logApi.warn('Missing wallet address in challenge request'); }
      return res.status(400).json({ error: 'Missing wallet address' });
    }

    if (config.debug_mode) { logApi.info('Attempting to generate nonce', { wallet }); } 
    // Generate nonce & store in DB
    const nonce = await generateNonce(wallet);
    if (config.debug_mode) { logApi.info('Nonce generated successfully', { wallet, nonce }); }
    return res.json({ nonce });
  } catch (error) {
    if (config.debug_mode) { 
      logApi.error('Failed to generate nonce', { 
        error: error.message,
        stack: error.stack,
        wallet: req.query.wallet,
        details: error
      });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/auth/verify-wallet:
 *   post:
 *     summary: Verify wallet signature and authenticate user
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
 *                 description: Wallet address
 *               signature:
 *                 type: array
 *                 items:
 *                   type: number
 *                 description: 64-byte signature array
 *               message:
 *                 type: string
 *                 description: Message that was signed
 *     responses:
 *       200:
 *         description: Wallet verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verified:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     wallet_address:
 *                       type: string
 *                     role:
 *                       type: string
 *                     nickname:
 *                       type: string
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Invalid signature or nonce
 *       500:
 *         description: Internal server error
 */
// The front-end will send: { wallet, signature: Array(64), message: "...theNonceHere..." }
router.post('/verify-wallet', async (req, res) => {
  try {
    const { wallet, signature, message } = req.body;
    authLogger.info('Verify wallet request received', { wallet });

    if (!wallet || !signature || !message) {
      authLogger.warn('Missing required fields', { wallet, hasSignature: !!signature, hasMessage: !!message });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!Array.isArray(signature) || signature.length !== 64) {
      authLogger.warn('Invalid signature format', { wallet, signatureLength: signature?.length });
      return res.status(400).json({ error: 'Signature must be a 64-byte array' });
    }

    // 1) Get the nonce from DB
    const record = await getNonceRecord(wallet);
    if (!record) {
      authLogger.warn('No nonce record found', { wallet });
      return res.status(401).json({ error: 'Nonce not found or expired' });
    }

    // Check if it's expired
    const now = Date.now();
    const expiresAtMs = new Date(record.expires_at).getTime();
    if (expiresAtMs < now) {
      authLogger.warn('Nonce expired', { 
        wallet,
        expiresAt: record.expires_at,
        now: new Date(now).toISOString(),
        timeDiff: (now - expiresAtMs) / 1000 + ' seconds'
      });
      await clearNonce(wallet);
      return res.status(401).json({ error: 'Nonce expired' });
    }

    // 2) Check that the message from the front end actually includes the nonce
    const lines = message.split('\n').map((l) => l.trim());
    const nonceLine = lines.find((l) => l.startsWith('Nonce:'));
    if (!nonceLine) {
      return res.status(400).json({ error: 'Message missing nonce line' });
    }
    const messageNonce = nonceLine.split('Nonce:')[1].trim();

    if (messageNonce !== record.nonce) {
      return res.status(401).json({ error: 'Nonce mismatch in message' });
    }

    // 3) Real signature check
    const signatureUint8 = new Uint8Array(signature);
    const messageBytes = new TextEncoder().encode(message);

    let pubKey;
    try {
      pubKey = new PublicKey(wallet);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const isVerified = nacl.sign.detached.verify(messageBytes, signatureUint8, pubKey.toBytes());
    if (!isVerified) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 4) Clear the nonce from DB so it can't be reused
    await clearNonce(wallet);

    // 5) Upsert user in DB
    const nowIso = new Date().toISOString();
    const user = await prisma.users.upsert({
      where: { wallet_address: wallet },
      create: {
        wallet_address: wallet,
        created_at: nowIso,
        last_login: nowIso,
        role: UserRole.user
      },
      update: {
        last_login: nowIso
      }
    });

    // Track session with analytics
    authLogger.analytics.trackSession(user, {
      ...req.headers,
      'x-real-ip': req.ip,
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'user-agent': req.headers['user-agent'],
      'sec-ch-ua-platform': req.headers['sec-ch-ua-platform'],
      'sec-ch-ua-mobile': req.headers['sec-ch-ua-mobile']
    });

    // 6) Create JWT
    const token = sign(
      {
        wallet_address: user.wallet_address,
        role: user.role,
        session_id: Buffer.from(crypto.randomBytes(16)).toString('hex')
      },
      config.jwt.secret,
      { expiresIn: '24h' }
    );

    // 7) Set cookie
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      domain: '.degenduel.me' // Always set in production URL
    };

    res.cookie('session', token, cookieOptions);

    // After successful verification
    authLogger.info('Wallet verified successfully', { 
      wallet,
      role: user.role,
      cookieOptions: {
        ...cookieOptions,
        maxAge: cookieOptions.maxAge / 1000 + ' seconds'
      }
    });

    return res.json({
      verified: true,
      token,
      user: {
        wallet_address: user.wallet_address,
        role: user.role,
        nickname: user.nickname
      }
    });
  } catch (error) {
    authLogger.error('Wallet verification failed', {
      error: error.message,
      stack: error.stack,
      wallet: req.body?.wallet
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/auth/dev-login:
 *   post:
 *     summary: Development-only endpoint for quick admin login
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - secret
 *               - wallet_address
 *             properties:
 *               secret:
 *                 type: string
 *                 description: Development mode secret key
 *               wallet_address:
 *                 type: string
 *                 description: Wallet address to login as
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid secret
 *       404:
 *         description: Not found or user not found
 */
router.post('/dev-login', async (req, res) => {
  // TEMPORARY: Allow dev login in any environment and port
  // Original restriction: Only available in development mode and on dev port
  // if (process.env.NODE_ENV !== 'development' || process.env.PORT !== '3005') {
  //   authLogger.warn('Attempted dev login in production or wrong port', {
  //     env: process.env.NODE_ENV,
  //     port: process.env.PORT
  //   });
  //   return res.status(404).json({ error: 'Not found' });
  // }

  try {
    const { secret, wallet_address } = req.body;
    
    // Verify secret
    if (secret !== process.env.DEV_LOGIN_SECRET) {
      authLogger.warn('Invalid dev login secret attempt', {
        wallet: wallet_address,
        providedSecret: secret?.substring(0, 3) + '...'  // Log only first 3 chars for security
      });
      return res.status(401).json({ error: 'Invalid secret' });
    }

    // Get user from database
    const user = await prisma.users.findUnique({
      where: { wallet_address }
    });

    if (!user) {
      authLogger.warn('Dev login attempted for non-existent user', { wallet: wallet_address });
      return res.status(404).json({ error: 'User not found' });
    }

    // Create session ID
    const sessionId = Buffer.from(crypto.randomBytes(16)).toString('hex');

    // Create JWT token (same as normal login)
    const token = sign(
      {
        wallet_address: user.wallet_address,
        role: user.role,
        session_id: sessionId
      },
      config.jwt.secret,
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('session', token, {
      httpOnly: true,
      secure: false,  // Allow non-HTTPS in development
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // Log successful dev login
    authLogger.info('Development login successful', {
      wallet: user.wallet_address,
      role: user.role,
      sessionId
    });

    // Return success with user info
    return res.json({
      success: true,
      user: {
        wallet_address: user.wallet_address,
        role: user.role,
        nickname: user.nickname
      }
    });
  } catch (error) {
    authLogger.error('Dev login error:', {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/auth/disconnect:
 *   post:
 *     summary: Disconnect wallet and clear session
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
 *                 description: Wallet address to disconnect
 *     responses:
 *       200:
 *         description: Wallet disconnected successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Missing wallet address
 *       500:
 *         description: Internal server error
 */
router.post('/disconnect', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) {
      logApi.warn('Missing wallet address in disconnect request');
      return res.status(400).json({ error: 'Missing wallet' });
    }

    await prisma.users.update({
      where: { wallet_address: wallet },
      data: { last_login: new Date() }
    });

    // Clear the cookie
    res.clearCookie('session', { domain: '.degenduel.me' });

    if (config.debug_mode) { logApi.info(`Wallet ${wallet} disconnected`); }
    res.json({ success: true });
  } catch (error) {
    if (config.debug_mode) { logApi.error('Wallet disconnect failed', { error }); }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user and clear session
 *     tags: [Authentication]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
//   example: POST https://degenduel.me/api/auth/logout
//      headers: { "Cookie": "session=<jwt>" }
router.post('/logout', requireAuth, async (req, res) => {
  try {
    if (config.debug_mode) {
      logApi.info('Logout request received', {
        user: req.user.wallet_address
      });
    }

    // Update last login time
    await prisma.users.update({
      where: { wallet_address: req.user.wallet_address },
      data: { last_login: new Date() }
    });

    // Clear the cookie
    res.clearCookie('session', {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      domain: req.environment === 'production' ? '.degenduel.me' : undefined
    });

    if (config.debug_mode) {
      logApi.info('User logged out successfully', {
        user: req.user.wallet_address
      });
    }
    res.json({ success: true });
  } catch (error) {
    logApi.error('Logout failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/auth/session:
 *   get:
 *     summary: Check current session status
 *     tags: [Authentication]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Session is valid
 *       401:
 *         description: No valid session
 */
router.get('/session', async (req, res) => {
  try {
    const token = req.cookies.session;
    if (!token) {
      authLogger.debug('No token provided');
      return res.status(401).json({ error: 'No session token provided' });
    }

    const decoded = jwt.verify(token, config.jwt.secret);
    
    const user = await prisma.users.findUnique({
      where: { wallet_address: decoded.wallet_address }
    });

    if (!user) {
      authLogger.debug('User not found', { wallet: decoded.wallet_address });
      return res.status(401).json({ error: 'User not found' });
    }

    // Track session check with analytics
    authLogger.analytics.trackInteraction(user, 'session_check', {
      success: true,
      session_id: decoded.session_id
    }, req.headers);

    // Only log role mismatches at warn level
    if (user.role !== decoded.role) {
      authLogger.warn('Role mismatch detected', {
        wallet: user.wallet_address,
        stored_role: user.role,
        token_role: decoded.role
      });
    }

    res.json({
      authenticated: true,
      user: {
        wallet_address: user.wallet_address,
        role: user.role,
        nickname: user.nickname
      }
    });

  } catch (error) {
    // Track failed session checks
    authLogger.analytics.trackInteraction(null, 'session_check', {
      success: false,
      error: error.message
    }, req.headers);

    authLogger.error('Session validation failed', { error: error.message });
    res.status(401).json({ error: 'Invalid session token' });
  }
});

export default router;

