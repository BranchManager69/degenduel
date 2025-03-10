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
    if (config.debug_mode) { logApi.info(`Challenge request received for ${req.query.wallet} \n\t`); }
    
    const { wallet } = req.query;
    if (!wallet) {
      if (config.debug_mode) { logApi.warn(`Missing wallet address in challenge request \n\t`); }
      return res.status(400).json({ error: 'Missing wallet address' });
    }

    if (config.debug_mode) { logApi.info(`Attempting to generate nonce for ${wallet} \n\t`); } 
    // Generate nonce & store in DB
    const nonce = await generateNonce(wallet);
    if (config.debug_mode) { logApi.info(`Nonce generated successfully for ${wallet} \n\t`, { nonce }); }
    return res.json({ nonce });
  } catch (error) {
    if (config.debug_mode) { 
      logApi.error(`Failed to generate nonce for ${req.query.wallet} \n\t`, { 
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
    const { wallet, signature, message, device_id, device_name, device_type } = req.body;
    authLogger.info(`Verify wallet request received \n\t`, { wallet });

    // 0) Check if required fields are present
    if (!wallet || !signature || !message) {
      authLogger.warn(`Missing required fields \n\t`, { wallet, hasSignature: !!signature, hasMessage: !!message });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!Array.isArray(signature) || signature.length !== 64) {
      authLogger.warn(`Invalid signature format \n\t`, { wallet, signatureLength: signature?.length });
      return res.status(400).json({ error: 'Signature must be a 64-byte array' });
    }

    // 1) Get the nonce from DB
    const record = await getNonceRecord(wallet);
    if (!record) {
      authLogger.warn(`No nonce record found for ${wallet} \n\t`);
      return res.status(401).json({ error: 'Nonce not found or expired' });
    }

    // 1.1) Check if old nonce is expired
    const now = Date.now();
    const expiresAtMs = new Date(record.expires_at).getTime();
    if (expiresAtMs < now) {
      authLogger.warn(`Nonce expired for ${wallet} \n\t`, { 
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
      authLogger.warn(`Message missing nonce line \n\t`, { wallet });
      return res.status(400).json({ error: 'Message missing nonce line' });
    }
    const messageNonce = nonceLine.split('Nonce:')[1].trim();

    // 2.1) Verify the nonce
    if (messageNonce !== record.nonce) {
      authLogger.warn(`Nonce mismatch in message \n\t`, { wallet });
      return res.status(401).json({ error: 'Nonce mismatch in message' });
    }

    // 3) Real signature check
    const signatureUint8 = new Uint8Array(signature);
    const messageBytes = new TextEncoder().encode(message);

    // 3.1) Verify the wallet address
    let pubKey;
    try {
      pubKey = new PublicKey(wallet);
    } catch (err) {
      authLogger.warn(`Invalid wallet address \n\t`, { wallet });
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // 3.2) Verify the signature
    const isVerified = nacl.sign.detached.verify(messageBytes, signatureUint8, pubKey.toBytes());
    if (!isVerified) {
      authLogger.warn(`Invalid signature \n\t`, { wallet });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 4) Clear the nonce from DB so it can't be reused
    await clearNonce(wallet);

    // 4.1) Generate a default nickname for new users
    const newUserDefaultNickname = `degen_${wallet.slice(0, 6)}`;

    // 5) Upsert user in DB
    const nowIso = new Date().toISOString();
    const user = await prisma.users.upsert({
      where: { wallet_address: wallet },
      create: {
        wallet_address: wallet,
        nickname: newUserDefaultNickname, // set a default nickname for new users
        created_at: nowIso,
        last_login: nowIso,
        role: UserRole.user // role for new users = user
      },
      update: {
        last_login: nowIso
      }
    });

    // Handle device authorization if device_id is provided
    let deviceInfo = null;
    if (config.device_auth_enabled && device_id) {
      try {
        // Check if this is the first device for this user
        const deviceCount = await prisma.authorized_devices.count({
          where: { wallet_address: wallet }
        });

        // If auto-authorize is enabled, and this is the first device, auto-authorize it
        const shouldAutoAuthorize = config.device_auth.auto_authorize_first_device && deviceCount === 0;
        
        // Check if device is already authorized
        let existingDevice = await prisma.authorized_devices.findUnique({
          where: {
            wallet_address_device_id: {
              wallet_address: wallet,
              device_id: device_id
            }
          }
        });
        
        // If the device is already authorized, update it
        if (existingDevice) {
          // Update existing device
          deviceInfo = await prisma.authorized_devices.update({
            where: { id: existingDevice.id },
            data: {
              device_name: device_name || existingDevice.device_name,
              device_type: device_type || existingDevice.device_type,
              last_used: new Date(),
              is_active: existingDevice.is_active
            }
          });
        } else if (shouldAutoAuthorize) {
          // Auto-authorize first device
          deviceInfo = await prisma.authorized_devices.create({
            data: {
              wallet_address: wallet,
              device_id: device_id,
              device_name: device_name || 'First Device',
              device_type: device_type || 'Unknown',
              is_active: true
            }
          });
          
          authLogger.info('Auto-authorized first device for user \n\t', {
            wallet,
            device_id,
            device_name: deviceInfo.device_name
          });
        } else {
          // Create unauthorized device record
          deviceInfo = await prisma.authorized_devices.create({
            data: {
              wallet_address: wallet,
              device_id: device_id,
              device_name: device_name || 'Unknown Device',
              device_type: device_type || 'Unknown',
              is_active: false // Not authorized yet
            }
          });
          
          authLogger.info('Created unauthorized device record \n\t', {
            wallet,
            device_id,
            device_name: deviceInfo.device_name
          });
        }
      } catch (deviceError) {
        authLogger.error('Error handling device authorization \n\t', {
          wallet,
          device_id,
          error: deviceError.message
        });
        // Continue with login even if device handling fails
      }
    }

    // Track session with analytics
    authLogger.analytics.trackSession(user, {
      ...req.headers,
      'x-real-ip': req.ip,
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'user-agent': req.headers['user-agent'],
      'sec-ch-ua-platform': req.headers['sec-ch-ua-platform'],
      'sec-ch-ua-mobile': req.headers['sec-ch-ua-mobile'],
      'x-device-id': device_id
    });

    // 6) Create JWT
    const token = sign(
      {
        wallet_address: user.wallet_address,
        role: user.role,
        session_id: Buffer.from(crypto.randomBytes(16)).toString('hex')
      },
      config.jwt.secret,
      { expiresIn: '12h' } // 12 hours (edited 3/7/25)
    );

    // 7) Create cookie
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: 12 * 60 * 60 * 1000, // 12 hours (edited 3/7/25)
      domain: '.degenduel.me' // Always set in production URL
    };

    // Set the cookie
    res.cookie('session', token, cookieOptions);

    // After successful verification
    authLogger.info(`Wallet verified successfully \n\t`, { 
      wallet,
      role: user.role,
      cookieOptions: {
        ...cookieOptions,
        maxAge: cookieOptions.maxAge / 1000 + ' seconds'
      }
    });

    // Return device authorization status
    const deviceAuthStatus = deviceInfo ? {
      device_authorized: deviceInfo.is_active,
      device_id: deviceInfo.device_id,
      device_name: deviceInfo.device_name,
      requires_authorization: config.device_auth_enabled && !deviceInfo.is_active
    } : null;

    return res.json({
      verified: true,
      user: {
        wallet_address: user.wallet_address,
        role: user.role,
        nickname: user.nickname
      },
      device: deviceAuthStatus
    });
  } catch (error) {
    authLogger.error(`Wallet verification failed \n\t`, {
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
  // Allow from localhost only - this endpoint is safe if it's only accessible from localhost
  const localIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  const isLocalhost = localIPs.includes(req.ip);
  
  // Only allow from localhost for security
  if (!isLocalhost) {
    authLogger.warn(`ACCESS DENIED: Dev login attempted by non-localhost IP ${req.ip} on port ${process.env.PORT} \n\t`);
    return res.status(403).json({ error: `ACCESS DENIED: Dev login bypass attempted by non-localhost IP!` });
  }

  try {
    const { secret, wallet_address } = req.body;
    
    // Verify secret
    if (secret !== process.env.BRANCH_MANAGER_LOGIN_SECRET) {
      authLogger.warn(`ACCESS DENIED: Invalid BRANCH_MANAGER_LOGIN_SECRET \n\t`, {
        providedSecret: secret?.substring(0, 3) + '...'  // only first 3 chars logged for security
      });
      return res.status(403).json({ error: 'ACCESS DENIED: Invalid BRANCH_MANAGER_LOGIN_SECRET' });
    }

    // Get user from database
    const user = await prisma.users.findUnique({
      where: { wallet_address }
    });

    // User not found
    if (!user) {
      authLogger.warn(`NO USER FOUND: Dev login bypass successful, but no user was found for wallet \n\t`, { wallet: wallet_address });
      return res.status(401).json({ error: `NO USER FOUND: Dev login bypass successful, but no user was found for wallet: ${wallet_address}` });
    }

    // Create session ID
    const sessionId = Buffer.from(crypto.randomBytes(16)).toString('hex');

    // Create JWT token as if this was a normal login
    const token = sign(
      {
        wallet_address: user.wallet_address,
        role: user.role,
        session_id: sessionId
      },
      config.jwt.secret,
      { expiresIn: '1h' } // 1 hour (edited 3/8/25)
    );

    // Set cookie
    res.cookie('session', token, {
      httpOnly: true,
      secure: false,  // Allow non-HTTPS since we're in dev mode
      sameSite: 'strict',
      maxAge: 1 * 60 * 60 * 1000 // 1 hour (edited 3/8/25)
    });

    // Log successful dev login
    authLogger.info(`DEV LOGIN SUCCESS \n\t`, {
      wallet: user.wallet_address,
      role: user.role,
      sessionId
    });

    // Return success + additional user info (e.g. nickname)
    return res.json({
      success: true,
      user: {
        wallet_address: user.wallet_address,
        role: user.role,
        nickname: user.nickname
      }
    });
  } catch (error) {
    authLogger.error(`DEV LOGIN ERROR \n\t`, {
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
router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) {
      logApi.warn(`Missing wallet address in disconnect request \n\t`);
      return res.status(400).json({ error: 'Missing wallet address in disconnect request' });
    }

    await prisma.users.update({
      where: { wallet_address: wallet },
      data: { last_login: new Date() }
    });

    // Clear the cookie
    res.clearCookie('session', { domain: '.degenduel.me' });

    if (config.debug_mode) { logApi.info(`Wallet ${wallet} disconnected \n\t`); }
    res.json({ success: true });
  } catch (error) {
    if (config.debug_mode) { logApi.error(`Wallet disconnect failed \n\t`, { error }); }
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
      logApi.info(`Logout request received \n\t`, {
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
      logApi.info(`User logged out successfully \n\t`, {
        user: req.user.wallet_address
      });
    }
    res.json({ success: true });
  } catch (error) {
    logApi.error(`Logout failed \n\t`, { error });
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
router.get('/session', requireAuth, async (req, res) => {
  try {
    const token = req.cookies.session;
    if (!token) {
      authLogger.debug(`No token provided \n\t`);
      return res.status(401).json({ error: 'No session token provided' });
    }

    const decoded = jwt.verify(token, config.jwt.secret);
    
    const user = await prisma.users.findUnique({
      where: { wallet_address: decoded.wallet_address }
    });

    if (!user) {
      authLogger.debug(`User not found \n\t`, { wallet: decoded.wallet_address });
      return res.status(401).json({ error: 'User not found' });
    }

    // Track session check with analytics
    authLogger.analytics.trackInteraction(user, 'session_check', {
      success: true,
      session_id: decoded.session_id
    }, req.headers);

    // Only log role mismatches at warn level
    if (user.role !== decoded.role) {
      authLogger.warn(`Role mismatch detected \n\t`, {
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

    authLogger.error(`Session validation failed \n\t`, { error: error.message });
    res.status(401).json({ error: 'Invalid session token' });
  }
});

/**
 * @swagger
 * /api/auth/token:
 *   get:
 *     summary: Use current access token to get a WebSocket connection
 *     tags: [Authentication]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token provided successfully
 *       401:
 *         description: No valid session
 */
router.get('/token', requireAuth, async (req, res) => {
  try {
    const sessionToken = req.cookies.session;
    if (!sessionToken) {
      authLogger.debug(`No session token provided for token request \n\t`);
      return res.status(401).json({ error: 'No session token provided' });
    }

    // Decode the session token
    const decoded = jwt.verify(sessionToken, config.jwt.secret);

    // Get the user from the database using the decoded wallet address from the session token
    const user = await prisma.users.findUnique({
      where: { wallet_address: decoded.wallet_address }
    });

    // If the user is not found, return a 401 error
    if (!user) {
      authLogger.debug(`User not found for token request \n\t`, { wallet: decoded.wallet_address });
      return res.status(401).json({ error: 'User not found' });
    }

    // Create a WebSocket-specific token with shorter-than-normal expiration
    const wsToken = sign(
      {
        wallet_address: user.wallet_address,
        role: user.role,
        session_id: decoded.session_id // Preserve the same session ID
      },
      config.jwt.secret,
      { expiresIn: '1h' } // Short expiration for WebSocket tokens (but is this *too* short?)
    );

    // Track token generation with analytics
    authLogger.analytics.trackInteraction(user, 'token_request', {
      success: true,
      session_id: decoded.session_id
    }, req.headers);

    // Log the WSS token generation
    authLogger.info(`WebSocket token generated \n\t`, { 
      wallet: user.wallet_address,
      session_id: decoded.session_id
    });

    // Return the WSS token to the client with a 1 hour expiration
    return res.json({
      token: wsToken,
      expiresIn: 3600 // 1 hour in seconds
    });

  } catch (error) {
    // Track failed WSS token requests
    authLogger.analytics.trackInteraction(null, 'token_request', {
      success: false,
      error: error.message
    }, req.headers);

    // Log the failed WSS token generation
    authLogger.error(`Token generation failed \n\t`, { error: error.message });
    res.status(401).json({ error: 'Invalid session' });
  }
});

export default router;

