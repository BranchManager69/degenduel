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
// No need to import sign directly as jwt already includes it
import axios from 'axios';
import { randomBytes } from 'crypto';

const router = express.Router();
// Destructure jwt.sign into a variable
const jwtSign = jwt.sign;

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
// Twitter OAuth configuration check route
router.get('/twitter/check-config', async (req, res) => {
  try {
    // Check environment variables
    const config = {
      X_APP_ID: process.env.X_APP_ID ? '✅ Set' : '❌ Missing',
      X_CLIENT_ID: process.env.X_CLIENT_ID ? '✅ Set' : '❌ Missing',
      X_CLIENT_SECRET: process.env.X_CLIENT_SECRET ? '✅ Set' : '❌ Missing',
      X_CALLBACK_URI: process.env.X_CALLBACK_URI ? '✅ Set' : '❌ Missing',
      X_CALLBACK_URI_DEVELOPMENT: process.env.X_CALLBACK_URI_DEVELOPMENT ? '✅ Set' : '❌ Missing',
      NODE_ENV: process.env.NODE_ENV || 'development',
      ACTIVE_CALLBACK_URI: process.env.NODE_ENV === 'development' 
        ? process.env.X_CALLBACK_URI_DEVELOPMENT 
        : process.env.X_CALLBACK_URI
    };

    // Check session middleware
    const sessionStatus = req.session ? '✅ Working' : '❌ Not initialized';
    
    // Check Redis connection
    const redisManager = (await import('../utils/redis-suite/redis-manager.js')).default;
    const redisStatus = redisManager.isConnected ? '✅ Connected' : '❌ Not connected';
    
    // Try to use the session
    const sessionId = Math.random().toString(36).substring(7);
    req.session.test = sessionId;
    
    // Save session and verify
    await new Promise((resolve) => {
      req.session.save(() => resolve());
    });
    
    const sessionVerified = req.session.test === sessionId ? '✅ Verified' : '❌ Failed verification';
    
    return res.json({
      success: true,
      config,
      sessionStatus,
      redisStatus,
      sessionVerified,
      currentEnvironment: process.env.NODE_ENV || 'development',
      message: 'Twitter OAuth configuration check completed'
    });
  } catch (error) {
    authLogger.error(`Twitter config check failed \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ 
      success: false,
      error: 'Configuration check failed',
      details: error.message
    });
  }
});

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
    const token = jwtSign(
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
    const token = jwtSign(
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
    const wsToken = jwtSign(
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
    authLogger.info(`[auth] WebSocket token generated`, { 
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

/**
 * @swagger
 * /api/auth/twitter/login:
 *   get:
 *     summary: Initiate Twitter OAuth login
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       302:
 *         description: Redirects to Twitter OAuth
 */
router.get('/twitter/login', async (req, res) => {
  try {
    // Generate CSRF token and state for security
    const state = randomBytes(32).toString('hex');
    const codeVerifier = randomBytes(32).toString('hex');
    
    // Generate code challenge using SHA-256
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    // Ensure session object exists
    if (!req.session) {
      authLogger.error(`Twitter OAuth failed: Session middleware not properly initialized \n\t`);
      return res.status(500).json({ 
        error: 'Session middleware not properly initialized',
        details: 'Session object missing from request'
      });
    }

    // Store in session for verification later
    req.session.twitter_oauth = {
      state,
      codeVerifier,
      codeChallenge,
      created: new Date().toISOString()
    };

    // Save session explicitly to ensure it's persisted
    await new Promise((resolve, reject) => {
      req.session.save(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Verify session was saved by checking if we can read it back
    if (!req.session.twitter_oauth || req.session.twitter_oauth.state !== state) {
      authLogger.error(`Twitter OAuth failed: Session not properly saved \n\t`, {
        sessionExists: !!req.session,
        oauthDataExists: !!req.session.twitter_oauth,
        stateMatches: req.session.twitter_oauth?.state === state
      });
      return res.status(500).json({ 
        error: 'Session storage error',
        details: 'Unable to store OAuth state in session'
      });
    }

    // Determine which callback URI to use
    const callbackUri = process.env.NODE_ENV === 'development' 
      ? process.env.X_CALLBACK_URI_DEVELOPMENT 
      : process.env.X_CALLBACK_URI;

    // Check if callback URI is properly configured
    if (!callbackUri) {
      authLogger.error(`Twitter OAuth failed: Missing callback URI \n\t`, {
        environment: process.env.NODE_ENV,
        devCallback: process.env.X_CALLBACK_URI_DEVELOPMENT,
        prodCallback: process.env.X_CALLBACK_URI
      });
      return res.status(500).json({ 
        error: 'Configuration error',
        details: 'OAuth callback URI not configured'
      });
    }

    // Check if client ID is properly configured
    if (!process.env.X_CLIENT_ID) {
      authLogger.error(`Twitter OAuth failed: Missing client ID \n\t`);
      return res.status(500).json({ 
        error: 'Configuration error',
        details: 'OAuth client ID not configured'
      });
    }

    // Construct the Twitter OAuth URL
    const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', process.env.X_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', callbackUri);
    // Only request minimal profile read access
    authUrl.searchParams.append('scope', 'users.read:user');
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');

    // Log OAuth parameters for debugging
    authLogger.info(`Initiating Twitter OAuth flow \n\t`, {
      state: state.substring(0, 6) + '...',
      codeChallenge: codeChallenge.substring(0, 6) + '...',
      callbackUri,
      clientId: process.env.X_CLIENT_ID.substring(0, 6) + '...',
      scope: 'users.read:user'
    });

    // Redirect user to Twitter OAuth
    return res.redirect(authUrl.toString());
  } catch (error) {
    authLogger.error(`Twitter OAuth initialization failed \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ 
      error: 'Could not initiate Twitter authentication',
      details: error.message
    });
  }
});

/**
 * Find wallet by Twitter ID and create a session
 * @param {string} twitterId - Twitter user ID
 * @param {object} twitterUser - Twitter user data
 * @returns {Promise<{success: boolean, wallet_address?: string, error?: string}>}
 */
async function loginWithTwitter(twitterId, twitterUser) {
  try {
    // Look up the user_social_profiles entry
    const socialProfile = await prisma.user_social_profiles.findFirst({
      where: {
        platform: 'twitter',
        platform_user_id: twitterId,
        verified: true
      }
    });
    
    // If no linked account found, return error
    if (!socialProfile) {
      authLogger.warn(`No verified Twitter account found for login \n\t`, {
        twitterId,
        twitterUsername: twitterUser.username
      });
      return {
        success: false,
        error: 'No linked wallet found for this Twitter account'
      };
    }
    
    // Get the wallet user
    const user = await prisma.users.findUnique({
      where: { wallet_address: socialProfile.wallet_address }
    });
    
    // If no user found, return error
    if (!user) {
      authLogger.warn(`Twitter linked to wallet but user not found \n\t`, {
        twitterId,
        wallet: socialProfile.wallet_address
      });
      return {
        success: false,
        error: 'User not found for linked Twitter account'
      };
    }
    
    // Update user last login time
    await prisma.users.update({
      where: { wallet_address: user.wallet_address },
      data: { last_login: new Date() }
    });
    
    // Update Twitter profile data if needed
    if (twitterUser.username !== socialProfile.username || 
        twitterUser.profile_image_url !== socialProfile.metadata?.profile_image_url) {
      
      await prisma.user_social_profiles.update({
        where: {
          wallet_address_platform: {
            wallet_address: socialProfile.wallet_address,
            platform: 'twitter'
          }
        },
        data: {
          username: twitterUser.username,
          last_verified: new Date(),
          metadata: {
            ...socialProfile.metadata,
            name: twitterUser.name,
            profile_image_url: twitterUser.profile_image_url
          },
          updated_at: new Date()
        }
      });
    }
    
    // Check if we should update the user's profile image
    try {
      // Get the current user profile details
      const userProfile = await prisma.users.findUnique({
        where: { wallet_address: socialProfile.wallet_address },
        select: { profile_image_url: true }
      });
      
      // Check if profile image is Twitter-sourced by URL pattern
      const isTwitterProfileImage = userProfile.profile_image_url && 
        userProfile.profile_image_url.includes('pbs.twimg.com/profile_images');
      
      // If user has no profile image or has a Twitter profile image that may be outdated
      if (!userProfile.profile_image_url || isTwitterProfileImage) {
        // Get full size image by removing "_normal" suffix
        const fullSizeImageUrl = twitterUser.profile_image_url.replace('_normal', '');
        
        // Update profile image if it's different from current one
        if (fullSizeImageUrl !== userProfile.profile_image_url) {
          await prisma.users.update({
            where: { wallet_address: socialProfile.wallet_address },
            data: {
              profile_image_url: fullSizeImageUrl,
              profile_image_updated_at: new Date()
            }
          });
          
          authLogger.info(`Updated Twitter profile image on login \n\t`, {
            wallet: socialProfile.wallet_address,
            oldImage: userProfile.profile_image_url || 'none',
            newImage: fullSizeImageUrl
          });
        }
      }
    } catch (imageError) {
      authLogger.warn(`Failed to sync Twitter profile image on login \n\t`, {
        wallet: socialProfile.wallet_address,
        error: imageError.message
      });
      // Continue with login despite image sync error
    }
    
    authLogger.info(`Twitter login successful for ${user.wallet_address} \n\t`, {
      twitterUsername: twitterUser.username,
      wallet: user.wallet_address
    });
    
    return {
      success: true,
      wallet_address: user.wallet_address,
      user
    };
  } catch (error) {
    authLogger.error(`Failed to login with Twitter \n\t`, {
      error: error.message,
      stack: error.stack,
      twitterId
    });
    
    return {
      success: false,
      error: 'Failed to login with Twitter'
    };
  }
}

/**
 * @swagger
 * /api/auth/twitter/callback:
 *   get:
 *     summary: Handle Twitter OAuth callback
 *     tags: [Authentication]
 *     security: []
 *     parameters:
 *       - name: code
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: state
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirects to app with token
 */
router.get('/twitter/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    
    // Handle explicit OAuth errors returned by Twitter
    if (error) {
      authLogger.warn(`Twitter OAuth error returned: ${error} \n\t`, { 
        error,
        error_description,
        state: state?.substring(0, 6) + '...' || 'missing'
      });
      return res.redirect(`/twitter-error.html?error=${encodeURIComponent(error)}&description=${encodeURIComponent(error_description || '')}`);
    }
    
    // Check if all required parameters are present
    if (!code || !state) {
      authLogger.warn(`Twitter OAuth callback missing required parameters \n\t`, { 
        codeExists: !!code,
        stateExists: !!state
      });
      return res.redirect('/twitter-error.html?error=missing_parameters');
    }
    
    // Check if session exists
    if (!req.session) {
      authLogger.error(`Twitter OAuth callback failed: Session not available \n\t`);
      return res.redirect('/twitter-error.html?error=session_lost');
    }
    
    // Validate state parameter to prevent CSRF attacks
    if (!req.session.twitter_oauth || req.session.twitter_oauth.state !== state) {
      authLogger.warn(`Twitter OAuth state mismatch \n\t`, {
        expected: req.session.twitter_oauth?.state?.substring(0, 6) + '...' || 'missing',
        received: state.substring(0, 6) + '...',
        sessionExists: !!req.session,
        oauthDataExists: !!req.session.twitter_oauth
      });
      return res.redirect('/twitter-error.html?error=invalid_state');
    }
    
    // Determine which callback URI to use
    const callbackUri = process.env.NODE_ENV === 'development' 
      ? process.env.X_CALLBACK_URI_DEVELOPMENT 
      : process.env.X_CALLBACK_URI;
    
    // Check for required environment variables
    if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET || !callbackUri) {
      authLogger.error(`Twitter OAuth missing configuration \n\t`, {
        clientIdExists: !!process.env.X_CLIENT_ID,
        clientSecretExists: !!process.env.X_CLIENT_SECRET,
        callbackUriExists: !!callbackUri
      });
      return res.redirect('/twitter-error.html?error=configuration_error');
    }
    
    // Get code verifier from session
    const codeVerifier = req.session.twitter_oauth.codeVerifier;
    if (!codeVerifier) {
      authLogger.error(`Twitter OAuth missing code verifier in session \n\t`);
      return res.redirect('/twitter-error.html?error=missing_code_verifier');
    }
    
    // Exchange code for access token with detailed error handling
    let tokenResponse;
    try {
      // Prepare parameters for token request
      const tokenParams = new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: process.env.X_CLIENT_ID,
        redirect_uri: callbackUri,
        code_verifier: codeVerifier
      });
      
      // Log token request parameters (with sensitive data masked)
      authLogger.info(`Exchanging code for token with parameters \n\t`, {
        code: code.substring(0, 6) + '...',
        grant_type: 'authorization_code',
        client_id: process.env.X_CLIENT_ID.substring(0, 6) + '...',
        redirect_uri: callbackUri,
        code_verifier: codeVerifier.substring(0, 6) + '...'
      });
      
      // Make token request
      tokenResponse = await axios.post(
        'https://api.twitter.com/2/oauth2/token',
        tokenParams,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(
              `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
            ).toString('base64')}`
          }
        }
      );
    } catch (tokenError) {
      // Handle token request error
      const responseData = tokenError.response?.data || {};
      authLogger.error(`Twitter OAuth token exchange failed \n\t`, {
        status: tokenError.response?.status,
        statusText: tokenError.response?.statusText,
        error: tokenError.message,
        responseData
      });
      
      return res.redirect(`/twitter-error.html?error=token_exchange&details=${encodeURIComponent(responseData.error || tokenError.message)}`);
    }
    
    // Extract token data
    const { access_token, refresh_token } = tokenResponse.data;
    
    // Get Twitter user info with detailed error handling
    let userResponse;
    try {
      userResponse = await axios.get('https://api.twitter.com/2/users/me', {
        headers: {
          Authorization: `Bearer ${access_token}`
        },
        params: {
          'user.fields': 'id,name,username,profile_image_url'
        }
      });
    } catch (userError) {
      // Handle user info request error
      const responseData = userError.response?.data || {};
      authLogger.error(`Twitter user info request failed \n\t`, {
        status: userError.response?.status,
        statusText: userError.response?.statusText,
        error: userError.message,
        responseData
      });
      
      return res.redirect(`/twitter-error.html?error=user_info&details=${encodeURIComponent(responseData.error || userError.message)}`);
    }
    
    // Extract user data
    const twitterUser = userResponse.data.data;
    
    // Check if valid user data was returned
    if (!twitterUser || !twitterUser.id) {
      authLogger.error(`Twitter returned invalid user data \n\t`, { 
        responseData: userResponse.data
      });
      return res.redirect('/twitter-error.html?error=invalid_user_data');
    }
    
    // Log successful user info retrieval
    authLogger.info(`Retrieved Twitter user info \n\t`, {
      id: twitterUser.id,
      username: twitterUser.username,
      hasProfileImage: !!twitterUser.profile_image_url
    });
    
    // First, check if this Twitter account is already linked and can be used for direct login
    const loginResult = await loginWithTwitter(twitterUser.id, twitterUser);
    
    if (loginResult.success) {
      // Create JWT token for session
      const token = jwtSign(
        {
          wallet_address: loginResult.wallet_address,
          role: loginResult.user.role,
          session_id: Buffer.from(crypto.randomBytes(16)).toString('hex')
        },
        config.jwt.secret,
        { expiresIn: '12h' } // 12 hours
      );
      
      // Set cookie
      const cookieOptions = {
        httpOnly: true,
        maxAge: 12 * 60 * 60 * 1000, // 12 hours
      };
      
      // Adjust cookie settings based on environment
      if (process.env.NODE_ENV === 'production') {
        cookieOptions.sameSite = 'none';
        cookieOptions.secure = true;
        cookieOptions.domain = '.degenduel.me';
      } else {
        // In development, use less strict settings
        cookieOptions.sameSite = 'lax';
        cookieOptions.secure = false;
        // Don't set domain in development to use default
      }
      
      authLogger.info(`Setting auth cookie with options \n\t`, { 
        ...cookieOptions,
        environment: process.env.NODE_ENV || 'development'
      });
      
      res.cookie('session', token, cookieOptions);
      
      authLogger.info(`Twitter login: created session for wallet ${loginResult.wallet_address} \n\t`);
      
      // Redirect to homepage or dashboard
      return res.redirect('/');
    }
    
    // If direct login wasn't successful, proceed with the linking flow
    
    // Store Twitter info in session for linking to wallet later
    req.session.twitter_user = {
      id: twitterUser.id,
      username: twitterUser.username,
      name: twitterUser.name,
      profile_image_url: twitterUser.profile_image_url,
      access_token,
      refresh_token
    };
    
    // Save session explicitly to ensure twitter_user data is persisted
    await new Promise((resolve, reject) => {
      req.session.save(err => {
        if (err) {
          authLogger.error(`Failed to save Twitter user data to session \n\t`, { error: err.message });
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    authLogger.info(`Twitter OAuth successful for user ${twitterUser.username} \n\t`);
    
    // If user is already authenticated with a wallet, link accounts
    if (req.cookies.session) {
      try {
        const decoded = jwt.verify(req.cookies.session, config.jwt.secret);
        
        if (decoded && decoded.wallet_address) {
          // Link Twitter account to wallet
          await linkTwitterToWallet(decoded.wallet_address, twitterUser, access_token, refresh_token);
          
          // Redirect to profile page or success page
          return res.redirect('/profile?twitter_linked=true');
        }
      } catch (error) {
        // Token verification failed, continue to login page
        authLogger.warn(`Failed to verify existing session when linking Twitter \n\t`, { error: error.message });
      }
    }
    
    // If no wallet is connected yet, redirect to a page where user can connect wallet
    return res.redirect('/connect-wallet?twitter=pending');
  } catch (error) {
    authLogger.error(`Twitter OAuth callback failed \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.redirect(`/twitter-error.html?error=unexpected_error&details=${encodeURIComponent(error.message)}`);
  }
});

/**
 * @swagger
 * /api/auth/twitter/link:
 *   post:
 *     summary: Link Twitter account to connected wallet
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Twitter account linked successfully
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.post('/twitter/link', requireAuth, async (req, res) => {
  try {
    // Ensure user has Twitter data in session
    if (!req.session?.twitter_user) {
      authLogger.warn(`No Twitter data in session for linking \n\t`);
      return res.status(400).json({ error: 'No Twitter authentication data found' });
    }
    
    const { wallet_address } = req.user;
    const { id, username, name, profile_image_url, access_token, refresh_token } = req.session.twitter_user;
    
    // Link Twitter account to wallet
    await linkTwitterToWallet(wallet_address, 
      { id, username, name, profile_image_url }, 
      access_token, 
      refresh_token
    );
    
    // Clear Twitter data from session
    delete req.session.twitter_user;
    
    authLogger.info(`Twitter account linked successfully for ${wallet_address} \n\t`);
    return res.json({ success: true, message: 'Twitter account linked successfully' });
  } catch (error) {
    authLogger.error(`Failed to link Twitter account \n\t`, {
      error: error.message,
      stack: error.stack,
      wallet: req.user?.wallet_address
    });
    return res.status(500).json({ error: 'Failed to link Twitter account' });
  }
});

/**
 * Helper function to link Twitter account to wallet
 */
async function linkTwitterToWallet(walletAddress, twitterUser, accessToken, refreshToken) {
  const now = new Date();
  
  // Check if this Twitter account is already linked to another wallet
  const existingLink = await prisma.user_social_profiles.findFirst({
    where: {
      platform: 'twitter',
      platform_user_id: twitterUser.id
    }
  });
  
  if (existingLink && existingLink.wallet_address !== walletAddress) {
    authLogger.warn(`Twitter account already linked to different wallet \n\t`, {
      twitterId: twitterUser.id,
      existingWallet: existingLink.wallet_address,
      requestedWallet: walletAddress
    });
    throw new Error('This Twitter account is already linked to another wallet');
  }
  
  // Create or update social profile
  await prisma.user_social_profiles.upsert({
    where: {
      wallet_address_platform: {
        wallet_address: walletAddress,
        platform: 'twitter'
      }
    },
    create: {
      wallet_address: walletAddress,
      platform: 'twitter',
      platform_user_id: twitterUser.id,
      username: twitterUser.username,
      verified: true,
      verification_date: now,
      last_verified: now,
      metadata: {
        name: twitterUser.name,
        profile_image_url: twitterUser.profile_image_url,
        access_token: accessToken,
        refresh_token: refreshToken
      },
      created_at: now,
      updated_at: now
    },
    update: {
      username: twitterUser.username,
      verified: true,
      last_verified: now,
      metadata: {
        name: twitterUser.name,
        profile_image_url: twitterUser.profile_image_url,
        access_token: accessToken,
        refresh_token: refreshToken
      },
      updated_at: now
    }
  });
  
  // If the Twitter profile has an image, update user's profile image if not already set
  try {
    if (twitterUser.profile_image_url) {
      // Get the user to check if they already have a profile image
      const user = await prisma.users.findUnique({
        where: { wallet_address: walletAddress },
        select: { profile_image_url: true }
      });
      
      // If user has no profile image, use the Twitter profile image
      // The Twitter API provides a "_normal" size by default, remove this to get full size
      if (!user.profile_image_url) {
        const fullSizeImageUrl = twitterUser.profile_image_url.replace('_normal', '');
        
        await prisma.users.update({
          where: { wallet_address: walletAddress },
          data: {
            profile_image_url: fullSizeImageUrl,
            profile_image_updated_at: now
          }
        });
        
        authLogger.info(`Updated user profile image from Twitter \n\t`, {
          wallet: walletAddress,
          imageUrl: fullSizeImageUrl
        });
      }
    }
  } catch (imageError) {
    // Log warning but don't prevent the linking if image update fails
    authLogger.warn(`Failed to update profile image from Twitter, but account linking succeeded \n\t`, {
      wallet: walletAddress,
      error: imageError.message
    });
  }
  
  authLogger.info(`Twitter account linked to wallet ${walletAddress} \n\t`, {
    twitterUsername: twitterUser.username
  });
}

export default router;

