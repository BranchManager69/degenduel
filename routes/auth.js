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
import axios from 'axios';
import { randomBytes } from 'crypto';
import privyClient from '../utils/privy-auth.js';

// Helper for cookie options
function getCookieOptions(req, type = 'session') {
  const currentEnv = config.getEnvironment();
  let domain;

  if (currentEnv === 'production' || currentEnv === 'development') {
    domain = '.degenduel.me';
  } else { // local or other environments
    domain = undefined;
  }

  const secure = (currentEnv === 'production' || currentEnv === 'development');
  const sameSite = secure ? 'none' : 'lax';

  const baseOptions = {
    httpOnly: true,
    secure: secure,
    sameSite: sameSite,
    domain: domain,
  };

  if (type === 'session') {
    return {
      ...baseOptions,
      maxAge: 1 * 60 * 60 * 1000, // 1 hour for access token
    };
  } else if (type === 'refresh') {
    return {
      ...baseOptions,
      path: '/api/auth/refresh', // Crucial: restrict cookie to only be sent to refresh endpoint
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days for refresh token
    };
  }
  return baseOptions; // Should not happen
}


const router = express.Router();
const jwtSign = jwt.sign;

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

    if (!wallet || !signature || !message) {
      authLogger.warn(`Missing required fields \n\t`, { wallet, hasSignature: !!signature, hasMessage: !!message });
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!Array.isArray(signature) || signature.length !== 64) {
      authLogger.warn(`Invalid signature format \n\t`, { wallet, signatureLength: signature?.length });
      return res.status(400).json({ error: 'Signature must be a 64-byte array' });
    }

    const record = await getNonceRecord(wallet);
    if (!record) {
      authLogger.warn(`No nonce record found for ${wallet} \n\t`);
      return res.status(401).json({ error: 'Nonce not found or expired' });
    }

    const now = Date.now();
    const expiresAtMs = new Date(record.expires_at).getTime();
    if (expiresAtMs < now) {
      authLogger.warn(`Nonce expired for ${wallet} \n\t`, { wallet, expiresAt: record.expires_at, now: new Date(now).toISOString(), timeDiff: (now - expiresAtMs) / 1000 + ' seconds'});
      await clearNonce(wallet);
      return res.status(401).json({ error: 'Nonce expired' });
    }

    const lines = message.split('\n').map((l) => l.trim());
    const nonceLine = lines.find((l) => l.startsWith('Nonce:'));
    if (!nonceLine) {
      authLogger.warn(`Message missing nonce line \n\t`, { wallet });
      return res.status(400).json({ error: 'Message missing nonce line' });
    }
    const messageNonce = nonceLine.split('Nonce:')[1].trim();

    if (messageNonce !== record.nonce) {
      authLogger.warn(`Nonce mismatch in message \n\t`, { wallet });
      return res.status(401).json({ error: 'Nonce mismatch in message' });
    }

    const signatureUint8 = new Uint8Array(signature);
    const messageBytes = new TextEncoder().encode(message);
    let pubKey;
    try {
      pubKey = new PublicKey(wallet);
    } catch (err) {
      authLogger.warn(`Invalid wallet address \n\t`, { wallet });
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const isVerified = nacl.sign.detached.verify(messageBytes, signatureUint8, pubKey.toBytes());
    if (!isVerified) {
      authLogger.warn(`Invalid signature \n\t`, { wallet });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    await clearNonce(wallet);
    const newUserDefaultNickname = `degen_${wallet.slice(0, 6)}`;
    const nowIso = new Date().toISOString();
    
    const user = await prisma.users.upsert({
      where: { wallet_address: wallet },
      create: { wallet_address: wallet, nickname: newUserDefaultNickname, created_at: nowIso, last_login: nowIso, role: UserRole.user },
      update: { last_login: nowIso }
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
    authLogger.analytics.trackSession(user, { /* ... existing analytics ... */ });

    // Create Access Token
    const accessToken = jwtSign(
      { id: user.id, wallet_address: user.wallet_address, role: user.role, session_id: Buffer.from(crypto.randomBytes(16)).toString('hex') },
      config.jwt.secret,
      { expiresIn: '1h' } // 1 hour
    );

    // Create Refresh Token
    const refreshTokenString = crypto.randomBytes(64).toString('hex');
    const hashedRefreshToken = crypto.createHash('sha256').update(refreshTokenString).digest('hex');
    const refreshTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.refresh_tokens.create({
      data: { user_id: user.id, wallet_address: user.wallet_address, token_hash: hashedRefreshToken, expires_at: refreshTokenExpiresAt }
    });

    // Set Cookies
    res.cookie('session', accessToken, getCookieOptions(req, 'session'));
    res.cookie('r_session', refreshTokenString, getCookieOptions(req, 'refresh'));
    
    authLogger.info(`Wallet verified successfully, tokens issued \n\t`, { wallet: user.wallet_address, role: user.role });

    const deviceAuthStatus = deviceInfo ? { device_authorized: deviceInfo.is_active, device_id: deviceInfo.device_id, device_name: deviceInfo.device_name, requires_authorization: config.device_auth_enabled && !deviceInfo.is_active } : null;
    return res.json({ verified: true, user: { id: user.id, wallet_address: user.wallet_address, role: user.role, nickname: user.nickname }, device: deviceAuthStatus });

  } catch (error) {
    authLogger.error(`Wallet verification failed \n\t`, { error: error.message, stack: error.stack, wallet: req.body?.wallet });
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
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token using refresh token
 *     tags: [Authentication]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Access token refreshed successfully
 *       401:
 *         description: Refresh token not provided or invalid
 */
router.post('/refresh', async (req, res) => {
  const refreshTokenFromCookie = req.cookies.r_session;

  if (!refreshTokenFromCookie) {
    authLogger.warn('Refresh token attempt without r_session cookie');
    return res.status(401).json({ error: 'Refresh token not provided' });
  }

  try {
    const hashedToken = crypto.createHash('sha256').update(refreshTokenFromCookie).digest('hex');
    
    const existingTokenRecord = await prisma.refresh_tokens.findUnique({
      where: { token_hash: hashedToken },
      include: { user: true } 
    });

    const clearAllAuthCookies = () => {
        res.clearCookie('session', getCookieOptions(req, 'session'));
        res.clearCookie('r_session', getCookieOptions(req, 'refresh'));
    };

    if (!existingTokenRecord) {
      authLogger.warn('Refresh token not found in DB', { token_hash_prefix: hashedToken.substring(0,10) });
      clearAllAuthCookies();
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    if (existingTokenRecord.revoked_at) {
      authLogger.warn('Attempted to use a revoked refresh token', { userId: existingTokenRecord.user_id, token_hash_prefix: hashedToken.substring(0,10) });
      // SECURITY: Token has been used before or explicitly revoked. Invalidate all active tokens for this user.
      await prisma.refresh_tokens.updateMany({
        where: { user_id: existingTokenRecord.user_id, revoked_at: null },
        data: { revoked_at: new Date() }
      });
      clearAllAuthCookies();
      return res.status(401).json({ error: 'Refresh token has been revoked' });
    }

    if (new Date(existingTokenRecord.expires_at) < new Date()) {
      authLogger.warn('Attempted to use an expired refresh token', { userId: existingTokenRecord.user_id, token_hash_prefix: hashedToken.substring(0,10), expiry: existingTokenRecord.expires_at });
      await prisma.refresh_tokens.update({ // Mark this specific one as revoked too
          where: { id: existingTokenRecord.id },
          data: { revoked_at: new Date() }
      });
      clearAllAuthCookies();
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    // --- Token Rotation ---
    await prisma.refresh_tokens.update({
      where: { id: existingTokenRecord.id },
      data: { revoked_at: new Date() }
    });

    const newRefreshTokenString = crypto.randomBytes(64).toString('hex');
    const newHashedRefreshToken = crypto.createHash('sha256').update(newRefreshTokenString).digest('hex');
    const newRefreshTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.refresh_tokens.create({
      data: {
        user_id: existingTokenRecord.user_id,
        wallet_address: existingTokenRecord.wallet_address,
        token_hash: newHashedRefreshToken,
        expires_at: newRefreshTokenExpiresAt
      }
    });

    const user = existingTokenRecord.user;
    const newAccessToken = jwtSign(
      { id: user.id, wallet_address: user.wallet_address, role: user.role, session_id: Buffer.from(crypto.randomBytes(16)).toString('hex') },
      config.jwt.secret,
      { expiresIn: '1h' } 
    );

    res.cookie('session', newAccessToken, getCookieOptions(req, 'session'));
    res.cookie('r_session', newRefreshTokenString, getCookieOptions(req, 'refresh'));
    
    authLogger.info('Access token refreshed successfully', { userId: user.id, wallet: user.wallet_address });
    return res.json({ success: true, user: { id: user.id, wallet_address: user.wallet_address, role: user.role, nickname: user.nickname } });

  } catch (error) {
    authLogger.error('Refresh token processing error', { error: error.message, stack: error.stack, token_prefix: refreshTokenFromCookie ? refreshTokenFromCookie.substring(0, 10) : 'none'});
    res.clearCookie('session', getCookieOptions(req, 'session'));
    res.clearCookie('r_session', getCookieOptions(req, 'refresh'));
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout current user
 *     tags: [Authentication]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: No valid session
 */
router.post('/logout', requireAuth, async (req, res) => {
  try {
    if (config.debug_mode) {
      authLogger.info(`Logout request received \n\t`, { user: req.user.wallet_address, userId: req.user.id });
    }

    await prisma.users.update({
      where: { wallet_address: req.user.wallet_address }, // or where: { id: req.user.id }
      data: { last_login: new Date() } // This might be better as last_active or similar
    });

    const refreshTokenFromCookie = req.cookies.r_session;
    if (refreshTokenFromCookie && req.user && req.user.id) { // req.user.id should now be available
      const hashedToken = crypto.createHash('sha256').update(refreshTokenFromCookie).digest('hex');
      await prisma.refresh_tokens.updateMany({
        where: { token_hash: hashedToken, user_id: req.user.id, revoked_at: null },
        data: { revoked_at: new Date() }
      });
    } else if (refreshTokenFromCookie) {
        // Fallback if req.user.id isn't there for some reason, try to revoke by hash only (less secure, potential for collision if hashes aren't perfectly unique system-wide for some reason or if a token is stolen and replayed before logout)
        // Or, if no req.user, maybe just clear cookies without DB revocation if the session was already invalid.
        authLogger.warn('Logout attempt: r_session present but req.user.id missing. Clearing cookies without specific DB revocation by hash only or skipping DB.', { wallet: req.user?.wallet_address });
        // Depending on strictness, you might choose to still attempt revocation by hash if user_id is missing.
        // For now, we'll ensure cookies are cleared.
    }
    
    res.clearCookie('session', getCookieOptions(req, 'session'));
    res.clearCookie('r_session', getCookieOptions(req, 'refresh'));

    if (config.debug_mode) {
      authLogger.info(`User logged out successfully \n\t`, { user: req.user.wallet_address });
    }
    res.json({ success: true });
  } catch (error) {
    authLogger.error(`Logout failed \n\t`, { error: error.message, stack: error.stack, user: req.user?.wallet_address });
    // Still try to clear cookies on error
    res.clearCookie('session', getCookieOptions(req, 'session'));
    res.clearCookie('r_session', getCookieOptions(req, 'refresh'));
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

    // Store code verifier in cookie instead of session
    // This is more reliable than session storage for this specific use case
    authLogger.info(`Twitter OAuth: Creating cookie with verifier (first 6 chars: ${codeVerifier.substring(0, 6)}...) \n\t`, {
      domain: req.get('host'),
      environment: config.getEnvironment(),
      cookieSettings: {
        httpOnly: true,
        secure: config.getEnvironment() === 'production',
        sameSite: 'lax',
        maxAge: '10 minutes'
      }
    });
    
    // SameSite=lax allows cookies to be sent during top-level navigations (like redirects)
    // but restricts cookies during cross-site subrequests (like image loads)
    res.cookie('twitter_oauth_verifier', codeVerifier, {
      httpOnly: true,
      secure: config.getEnvironment() === 'production',
      sameSite: 'lax', // Important: SameSite=lax needed for OAuth redirects to work
      maxAge: 10 * 60 * 1000 // 10 minutes
    });

    // Determine which callback URI to use based on environment
    const callbackUri = config.getEnvironment() === 'development' 
      ? process.env.X_CALLBACK_URI_DEVELOPMENT 
      : process.env.X_CALLBACK_URI;

    // Check if callback URI is properly configured
    if (!callbackUri) {
      authLogger.error(`Twitter OAuth failed: Missing callback URI \n\t`, {
        environment: config.getEnvironment(),
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
    // Include the three default required scopes for Twitter API v2
    // tweet.read, users.read, follows.read are the standard minimum scopes
    authUrl.searchParams.append('scope', 'tweet.read users.read follows.read');
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');

    // Log OAuth parameters for debugging
    authLogger.info(`Initiating Twitter OAuth flow \n\t`, {
      state: state.substring(0, 6) + '...',
      codeChallenge: codeChallenge.substring(0, 6) + '...',
      callbackUri,
      clientId: process.env.X_CLIENT_ID.substring(0, 6) + '...',
      scope: 'tweet.read users.read follows.read',
      fullUrl: authUrl.toString()
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
      authLogger.info(`Checking whether to update profile image for ${socialProfile.wallet_address} \n\t`, {
        twitterUsername: twitterUser.username,
        hasTwitterProfileImage: !!twitterUser.profile_image_url,
        twitterImageUrl: twitterUser.profile_image_url || 'none'
      });
      
      // Get the current user profile details
      const userProfile = await prisma.users.findUnique({
        where: { wallet_address: socialProfile.wallet_address },
        select: { profile_image_url: true }
      });
      
      authLogger.info(`Current profile image status \n\t`, {
        wallet: socialProfile.wallet_address,
        hasProfileImage: !!userProfile.profile_image_url,
        currentImageUrl: userProfile.profile_image_url || 'none'
      });
      
      // Check if profile image is Twitter-sourced by URL pattern
      const isTwitterProfileImage = userProfile.profile_image_url && 
        userProfile.profile_image_url.includes('pbs.twimg.com/profile_images');
      
      authLogger.info(`Profile image analysis \n\t`, {
        wallet: socialProfile.wallet_address,
        isTwitterImage: isTwitterProfileImage,
        needsUpdate: !userProfile.profile_image_url || isTwitterProfileImage
      });
      
      // If user has no profile image or has a Twitter profile image that may be outdated
      if (!userProfile.profile_image_url || isTwitterProfileImage) {
        // Get full size image by removing "_normal" suffix
        const fullSizeImageUrl = twitterUser.profile_image_url ? 
          twitterUser.profile_image_url.replace('_normal', '') : null;
        
        authLogger.info(`Processing Twitter profile image \n\t`, {
          wallet: socialProfile.wallet_address,
          originalTwitterImage: twitterUser.profile_image_url || 'none',
          convertedFullSizeUrl: fullSizeImageUrl || 'none',
          isDifferent: fullSizeImageUrl !== userProfile.profile_image_url
        });
        
        // Update profile image if it's different from current one and available
        if (fullSizeImageUrl && fullSizeImageUrl !== userProfile.profile_image_url) {
          authLogger.info(`About to update profile image in database \n\t`, {
            wallet: socialProfile.wallet_address,
            oldImage: userProfile.profile_image_url || 'none',
            newImage: fullSizeImageUrl
          });
          
          await prisma.users.update({
            where: { wallet_address: socialProfile.wallet_address },
            data: {
              profile_image_url: fullSizeImageUrl,
              profile_image_updated_at: new Date()
            }
          });
          
          authLogger.info(`Successfully updated Twitter profile image on login \n\t`, {
            wallet: socialProfile.wallet_address,
            oldImage: userProfile.profile_image_url || 'none',
            newImage: fullSizeImageUrl,
            success: true
          });
        } else {
          authLogger.info(`No profile image update needed \n\t`, {
            wallet: socialProfile.wallet_address,
            reason: !fullSizeImageUrl ? 'No Twitter image available' : 'Images are identical'
          });
        }
      }
    } catch (imageError) {
      authLogger.warn(`Failed to sync Twitter profile image on login \n\t`, {
        wallet: socialProfile.wallet_address,
        error: imageError.message,
        stack: imageError.stack,
        twitterImageUrl: twitterUser.profile_image_url || 'none'
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
router.get('/twitter/callback', (req, res, next) => {
  // Bypass CORS for Twitter callback - set required CORS headers explicitly
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  next();
}, async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    
    // Handle explicit OAuth errors returned by Twitter
    if (error) {
      authLogger.warn(`Twitter OAuth error returned: ${error} \n\t`, { 
        error,
        error_description,
        state: state?.substring(0, 6) + '...' || 'missing'
      });
      // Return JSON error response instead of redirecting to static HTML
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: error,
        error_description: error_description || '',
        message: 'An error occurred during Twitter authentication.'
      });
    }
    
    // Check if all required parameters are present
    if (!code || !state) {
      authLogger.warn(`Twitter OAuth callback missing required parameters \n\t`, { 
        codeExists: !!code,
        stateExists: !!state
      });
      return res.status(400).json({ 
        error: 'twitter_oauth_error',
        error_type: 'missing_parameters',
        message: 'Missing required OAuth parameters'
      });
    }
    
    // Check if session exists
    if (!req.session) {
      authLogger.error(`Twitter OAuth callback failed: Session not available \n\t`);
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: 'session_lost',
        message: 'Session data not available for OAuth flow'
      });
    }
    
    // Skip state verification for now since it's causing issues
    // We'll still log the state for debugging but won't enforce it
    authLogger.info(`Twitter OAuth state received: ${state.substring(0, 6)}... \n\t`);
    
    // Determine which callback URI to use based on environment
    const callbackUri = config.getEnvironment() === 'development' 
      ? process.env.X_CALLBACK_URI_DEVELOPMENT 
      : process.env.X_CALLBACK_URI;
    
    // Check for required environment variables
    if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET || !callbackUri) {
      authLogger.error(`Twitter OAuth missing configuration \n\t`, {
        clientIdExists: !!process.env.X_CLIENT_ID,
        clientSecretExists: !!process.env.X_CLIENT_SECRET,
        callbackUriExists: !!callbackUri
      });
      return res.status(500).json({
        error: 'twitter_oauth_error',
        error_type: 'configuration_error',
        message: 'Server configuration error for Twitter OAuth'
      });
    }
    
    // Get code verifier from cookie instead of session
    const codeVerifier = req.cookies.twitter_oauth_verifier;
    
    // Check for all cookies (debug)
    authLogger.info(`Twitter OAuth: Cookies received in callback \n\t`, {
      allCookies: req.cookies ? Object.keys(req.cookies).join(', ') : 'none',
      hasVerifierCookie: !!codeVerifier,
      verifierFirstChars: codeVerifier ? codeVerifier.substring(0, 6) + '...' : 'missing',
      domain: req.get('host'),
      referer: req.get('referer') || 'none',
      userAgent: req.get('user-agent')
    });
    
    if (!codeVerifier) {
      authLogger.error(`Twitter OAuth missing code verifier cookie \n\t`, {
        allHeaders: req.headers,
        allCookies: req.cookies
      });
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: 'missing_code_verifier',
        message: 'OAuth code verifier cookie missing'
      });
    }
    
    // Clear the verifier cookie since it's no longer needed
    authLogger.info(`Twitter OAuth: Clearing verifier cookie \n\t`);
    res.clearCookie('twitter_oauth_verifier');
    
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
      
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: 'token_exchange',
        error_description: responseData.error || tokenError.message,
        message: 'Failed to exchange OAuth code for access token'
      });
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
      
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: 'user_info',
        error_description: responseData.error || userError.message,
        message: 'Failed to retrieve Twitter user information'
      });
    }
    
    // Extract user data
    const twitterUser = userResponse.data.data;
    
    // Check if valid user data was returned
    if (!twitterUser || !twitterUser.id) {
      authLogger.error(`Twitter returned invalid user data \n\t`, { 
        responseData: userResponse.data
      });
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: 'invalid_user_data',
        message: 'Twitter returned invalid or incomplete user data'
      });
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
      if (config.getEnvironment() === 'production') {
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
        environment: config.getEnvironment()
      });
      
      res.cookie('session', token, cookieOptions);
      
      authLogger.info(`Twitter login: created session for wallet ${loginResult.wallet_address} \n\t`);
      
      // Redirect to the proper /me profile page
      const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
      authLogger.info(`Redirecting to ${baseUrl}/me after successful Twitter login \n\t`);
      return res.redirect(`${baseUrl}/me`);
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
          
          // Redirect to the proper /me profile page
          const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
          authLogger.info(`Redirecting to ${baseUrl}/me?twitter_linked=true after linking 
	`);
          return res.redirect(`${baseUrl}/me?twitter_linked=true`);
        }
      } catch (error) {
        // Token verification failed, continue to login page
        authLogger.warn(`Failed to verify existing session when linking Twitter \n\t`, { error: error.message });
      }
    }
    
    // If no wallet is connected yet, redirect to a page where user can connect wallet
    const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
    // Redirect to the home page with query parameters instead of nonexistent /connect-wallet page
    authLogger.info(`Redirecting to ${baseUrl}/?action=connect-wallet&twitter=pending to complete flow \n\t`);
    return res.redirect(`${baseUrl}/?action=connect-wallet&twitter=pending`);
  } catch (error) {
    authLogger.error(`Twitter OAuth callback failed \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      error: 'twitter_oauth_error',
      error_type: 'unexpected_error',
      error_description: error.message,
      message: 'An unexpected error occurred during Twitter authentication'
    });
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
    authLogger.info(`Twitter account linking: checking profile image \n\t`, {
      wallet: walletAddress,
      twitterUsername: twitterUser.username,
      hasTwitterImage: !!twitterUser.profile_image_url,
      twitterImageUrl: twitterUser.profile_image_url || 'none'
    });
    
    if (twitterUser.profile_image_url) {
      // Get the user to check if they already have a profile image
      const user = await prisma.users.findUnique({
        where: { wallet_address: walletAddress },
        select: { profile_image_url: true }
      });
      
      authLogger.info(`Twitter link: current user profile status \n\t`, {
        wallet: walletAddress,
        hasExistingImage: !!user.profile_image_url,
        currentImageUrl: user.profile_image_url || 'none'
      });
      
      // If user has no profile image, use the Twitter profile image
      // The Twitter API provides a "_normal" size by default, remove this to get full size
      if (!user.profile_image_url) {
        const fullSizeImageUrl = twitterUser.profile_image_url.replace('_normal', '');
        
        authLogger.info(`Twitter link: preparing to update profile image \n\t`, {
          wallet: walletAddress,
          normalImageUrl: twitterUser.profile_image_url,
          fullSizeImageUrl: fullSizeImageUrl
        });
        
        await prisma.users.update({
          where: { wallet_address: walletAddress },
          data: {
            profile_image_url: fullSizeImageUrl,
            profile_image_updated_at: new Date()
          }
        });
        
        authLogger.info(`Twitter link: successfully updated user profile image \n\t`, {
          wallet: walletAddress,
          imageUrl: fullSizeImageUrl,
          success: true,
          updatedAt: now.toISOString()
        });
      } else {
        authLogger.info(`Twitter link: skipping profile image update (user already has one) \n\t`, {
          wallet: walletAddress,
          existingImage: user.profile_image_url
        });
      }
    } else {
      authLogger.info(`Twitter link: no profile image available from Twitter \n\t`, {
        wallet: walletAddress,
        twitterUsername: twitterUser.username
      });
    }
  } catch (imageError) {
    // Log warning but don't prevent the linking if image update fails
    authLogger.error(`Failed to update profile image from Twitter, but account linking succeeded \n\t`, {
      wallet: walletAddress,
      error: imageError.message,
      stack: imageError.stack,
      twitterUsername: twitterUser.username,
      twitterImageUrl: twitterUser.profile_image_url || 'none'
    });
  }
  
  authLogger.info(`Twitter account linked to wallet ${walletAddress} \n\t`, {
    twitterUsername: twitterUser.username
  });
}

/**
 * @swagger
 * /api/auth/verify-privy:
 *   post:
 *     summary: Verify Privy authentication token and login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - userId
 *             properties:
 *               token:
 *                 type: string
 *                 description: Privy authentication token
 *               userId:
 *                 type: string
 *                 description: Privy user ID
 *     responses:
 *       200:
 *         description: User authenticated successfully
 *       401:
 *         description: Invalid Privy token
 *       400:
 *         description: Missing required fields or wallet address
 *       500:
 *         description: Internal server error
 */
router.post('/verify-privy', async (req, res) => {
  try {
    const { token, userId, device_id, device_name, device_type } = req.body;
    
    authLogger.info(`Privy verification request received \n\t`, { 
      userId, 
      hasToken: !!token, 
      hasDeviceInfo: !!device_id,
      requestHeaders: {
        userAgent: req.headers['user-agent'],
        origin: req.headers['origin'],
        referer: req.headers['referer']
      }
    });

    if (!token || !userId) {
      authLogger.warn(`Missing required fields for Privy verification \n\t`, { 
        hasToken: !!token, 
        hasUserId: !!userId,
        requestIp: req.ip
      });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Log token format (first 10 chars only for security)
    const truncatedToken = token.substring(0, 10) + '...';
    authLogger.debug(`Processing Privy token verification \n\t`, {
      tokenPrefix: truncatedToken,
      tokenLength: token.length,
      userId
    });

    let authClaims;
    try {
      // Verify the token with Privy
      authLogger.debug(`Calling Privy client to verify token \n\t`, {
        clientConfigured: !!privyClient,
        appId: process.env.PRIVY_APP_ID ? 'configured' : 'missing',
        appSecret: process.env.PRIVY_APP_SECRET ? 'configured' : 'missing'
      });
      
      const verifyStartTime = performance.now();
      authClaims = await privyClient.verifyAuthToken(token);
      const verifyEndTime = performance.now();
      
      authLogger.info(`Privy token verified successfully \n\t`, { 
        userId: authClaims.userId,
        tokenUserId: userId,
        tokenMatch: authClaims.userId === userId,
        verificationTimeMs: (verifyEndTime - verifyStartTime).toFixed(2),
        tokenClaims: {
          iss: authClaims.iss,
          sub: authClaims.sub,
          exp: new Date(authClaims.exp * 1000).toISOString(),
          iat: new Date(authClaims.iat * 1000).toISOString(),
          hasEmail: !!authClaims.email,
          hasPhone: !!authClaims.phone
        }
      });
      
      // Verify that the userId in the token matches the userId in the request
      if (authClaims.userId !== userId) {
        authLogger.warn(`User ID mismatch in Privy verification \n\t`, { 
          tokenUserId: authClaims.userId, 
          requestUserId: userId,
          requestIp: req.ip
        });
        return res.status(401).json({ error: 'Invalid user ID' });
      }
    } catch (error) {
      authLogger.error(`Failed to verify Privy token \n\t`, {
        error: error.message,
        errorName: error.name,
        stack: error.stack,
        userId,
        requestIp: req.ip,
        headers: {
          userAgent: req.headers['user-agent'],
          origin: req.headers['origin']
        }
      });
      return res.status(401).json({ error: 'Invalid Privy token' });
    }

    // Get user details from Privy
    authLogger.debug(`Retrieving Privy user details for userId: ${userId} \n\t`);
    let privyUser;
    try {
      const userStartTime = performance.now();
      privyUser = await privyClient.getUser(userId);
      const userEndTime = performance.now();
      
      authLogger.info(`Retrieved Privy user details successfully \n\t`, {
        userId,
        retrievalTimeMs: (userEndTime - userStartTime).toFixed(2),
        userDetails: {
          hasWallet: !!privyUser.wallet,
          walletAddress: privyUser.wallet?.address ? `${privyUser.wallet.address.substring(0, 6)}...${privyUser.wallet.address.slice(-4)}` : 'none',
          hasEmail: !!privyUser.email?.address,
          hasPhone: !!privyUser.phone?.number,
          hasFido: !!privyUser.fido,
          linkedAccounts: privyUser.linkedAccounts?.length || 0
        }
      });
    } catch (error) {
      authLogger.error(`Failed to get Privy user details \n\t`, {
        error: error.message,
        errorName: error.name,
        stack: error.stack,
        userId,
        requestIp: req.ip
      });
      return res.status(500).json({ error: 'Failed to get user details from Privy' });
    }

    // Handle wallet address from Privy user data
    const walletAddress = privyUser.wallet?.address;

    if (!walletAddress) {
      authLogger.warn(`No wallet address found in Privy user data \n\t`, {
        userId,
        privyUserFields: Object.keys(privyUser || {}).join(', '),
        hasWalletField: !!privyUser?.wallet,
        walletFields: privyUser?.wallet ? Object.keys(privyUser.wallet).join(', ') : 'none'
      });
      return res.status(400).json({ error: 'No wallet address found in Privy user data' });
    }

    // Check if this is a new user or returning user
    let existingUser;
    try {
      existingUser = await prisma.users.findUnique({
        where: { wallet_address: walletAddress }
      });
      
      authLogger.debug(`User lookup for wallet ${walletAddress} \n\t`, {
        userExists: !!existingUser,
        isNewUser: !existingUser,
        userId
      });
    } catch (dbError) {
      authLogger.error(`Database error during user lookup \n\t`, {
        error: dbError.message,
        stack: dbError.stack,
        wallet: walletAddress,
        userId
      });
      // Continue with the flow, will create user if needed
    }

    // Create or update user in the database, respecting auto_create_accounts flag
    const nowIso = new Date().toISOString();
    const newUserDefaultNickname = `degen_${walletAddress.slice(0, 6)}`;
    
    // Check if we should auto-create accounts
    const shouldAutoCreate = config.privy.auto_create_accounts;
    
    authLogger.debug(`Processing user database operation \n\t`, {
      wallet: walletAddress,
      isNewUser: !existingUser,
      nickname: existingUser?.nickname || newUserDefaultNickname,
      userId,
      shouldAutoCreate,
      autoCreateConfigured: config.privy.auto_create_accounts
    });
    
    // If user exists, update them
    // If user doesn't exist and auto-create is enabled, create them
    // If user doesn't exist and auto-create is disabled, return error
    let user;
    
    if (existingUser) {
      // User exists, just update last login
      user = await prisma.users.update({
        where: { wallet_address: walletAddress },
        data: { last_login: nowIso }
      });
    } else if (shouldAutoCreate) {
      // User doesn't exist but auto-create is enabled
      user = await prisma.users.create({
        data: {
          wallet_address: walletAddress,
          nickname: newUserDefaultNickname,
          created_at: nowIso,
          last_login: nowIso,
          role: UserRole.user
        }
      });
      
      authLogger.info(`Auto-created new user account from Privy auth \n\t`, {
        wallet: walletAddress,
        nickname: newUserDefaultNickname,
        userId
      });
    } else {
      // User doesn't exist and auto-create is disabled
      authLogger.warn(`Privy auth: User doesn't exist and auto-create accounts is disabled \n\t`, {
        wallet: walletAddress,
        userId,
        privyUserExists: true
      });
      
      return res.status(404).json({ 
        error: 'No user found with this wallet address', 
        details: 'Auto-creation of accounts from Privy is disabled. Please register through wallet authentication first.'
      });
    }

    // Handle device authorization if device_id is provided
    let deviceInfo = null;
    if (config.device_auth_enabled && device_id) {
      try {
        authLogger.debug(`Processing device authorization for Privy auth \n\t`, {
          wallet: walletAddress,
          device_id,
          device_name,
          device_type
        });
        
        // Check if this is the first device for this user
        const deviceCount = await prisma.authorized_devices.count({
          where: { wallet_address: walletAddress }
        });

        // If auto-authorize is enabled, and this is the first device, auto-authorize it
        const shouldAutoAuthorize = config.device_auth.auto_authorize_first_device && deviceCount === 0;
        
        // Check if device is already authorized
        let existingDevice = await prisma.authorized_devices.findUnique({
          where: {
            wallet_address_device_id: {
              wallet_address: walletAddress,
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
          
          authLogger.info(`Updated existing device for Privy auth user \n\t`, {
            wallet: walletAddress,
            device_id,
            is_authorized: deviceInfo.is_active,
            device_name: deviceInfo.device_name
          });
        } else if (shouldAutoAuthorize) {
          // Auto-authorize first device
          deviceInfo = await prisma.authorized_devices.create({
            data: {
              wallet_address: walletAddress,
              device_id: device_id,
              device_name: device_name || 'First Privy Device',
              device_type: device_type || 'Unknown',
              is_active: true
            }
          });
          
          authLogger.info(`Auto-authorized first device for Privy auth user \n\t`, {
            wallet: walletAddress,
            device_id,
            device_name: deviceInfo.device_name,
            auth_method: 'privy'
          });
        } else {
          // Create unauthorized device record
          deviceInfo = await prisma.authorized_devices.create({
            data: {
              wallet_address: walletAddress,
              device_id: device_id,
              device_name: device_name || 'Unknown Privy Device',
              device_type: device_type || 'Unknown',
              is_active: false // Not authorized yet
            }
          });
          
          authLogger.info(`Created unauthorized device record for Privy auth \n\t`, {
            wallet: walletAddress,
            device_id,
            device_name: deviceInfo.device_name,
            requires_authorization: true
          });
        }
      } catch (deviceError) {
        authLogger.error(`Error handling device authorization for Privy auth \n\t`, {
          wallet: walletAddress,
          device_id,
          error: deviceError.message,
          stack: deviceError.stack
        });
        // Continue with login even if device handling fails
      }
    }

    // Generate session ID for tracking and analytics
    const sessionId = Buffer.from(crypto.randomBytes(16)).toString('hex');

    // Track session with analytics
    authLogger.analytics.trackSession(user, {
      ...req.headers,
      'x-real-ip': req.ip,
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'user-agent': req.headers['user-agent'],
      'sec-ch-ua-platform': req.headers['sec-ch-ua-platform'],
      'sec-ch-ua-mobile': req.headers['sec-ch-ua-mobile'],
      'x-device-id': device_id,
      'auth-method': 'privy',
      'privy-user-id': userId
    });

    // Create JWT token for session
    authLogger.debug(`Creating JWT token for Privy auth user \n\t`, {
      wallet: user.wallet_address,
      role: user.role,
      sessionId,
      expiryHours: 12
    });
    
    const jwtToken = jwt.sign(
      {
        wallet_address: user.wallet_address,
        role: user.role,
        session_id: sessionId
      },
      config.jwt.secret,
      { expiresIn: '12h' }
    );

    // Set cookie
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: 12 * 60 * 60 * 1000, // 12 hours
      domain: '.degenduel.me'
    };

    authLogger.debug(`Setting session cookie for Privy auth \n\t`, {
      wallet: user.wallet_address,
      cookieSettings: {
        ...cookieOptions,
        maxAge: cookieOptions.maxAge / 1000 + ' seconds'
      }
    });
    
    res.cookie('session', jwtToken, cookieOptions);

    // Return device authorization status
    const deviceAuthStatus = deviceInfo ? {
      device_authorized: deviceInfo.is_active,
      device_id: deviceInfo.device_id,
      device_name: deviceInfo.device_name,
      requires_authorization: config.device_auth_enabled && !deviceInfo.is_active
    } : null;

    // Log successful authentication
    authLogger.info(`Privy authentication successful \n\t`, {
      wallet: user.wallet_address,
      role: user.role,
      privyUserId: userId,
      sessionId,
      deviceAuthStatus: deviceInfo ? {
        isAuthorized: deviceInfo.is_active,
        requiresAuthorization: config.device_auth_enabled && !deviceInfo.is_active
      } : 'no device info'
    });

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
    authLogger.error(`Privy authentication failed \n\t`, {
      error: error.message,
      errorName: error.name, 
      stack: error.stack,
      requestBody: {
        hasUserId: !!req.body?.userId,
        hasToken: !!req.body?.token
      },
      requestIp: req.ip
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/auth/link-privy:
 *   post:
 *     summary: Link Privy account to existing authenticated user
 *     tags: [Authentication]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - userId
 *             properties:
 *               token:
 *                 type: string
 *                 description: Privy authentication token
 *               userId:
 *                 type: string
 *                 description: Privy user ID
 *     responses:
 *       200:
 *         description: Privy account linked successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Invalid Privy token or not authenticated
 *       500:
 *         description: Internal server error
 */
router.post('/link-privy', requireAuth, async (req, res) => {
  try {
    const { token, userId } = req.body;
    const authenticatedWallet = req.user.wallet_address;
    
    authLogger.info(`Link Privy request received \n\t`, { 
      userId, 
      authenticatedWallet,
      hasToken: !!token
    });

    // Validate request data
    if (!token || !userId) {
      authLogger.warn(`Missing required fields for Privy linking \n\t`, { 
        hasToken: !!token, 
        hasUserId: !!userId,
        authenticatedWallet
      });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify the Privy token
    let authClaims;
    try {
      const verifyStartTime = performance.now();
      authClaims = await privyClient.verifyAuthToken(token);
      const verifyEndTime = performance.now();
      
      authLogger.info(`Privy token verified for linking \n\t`, { 
        userId: authClaims.userId,
        tokenUserId: userId,
        tokenMatch: authClaims.userId === userId,
        verificationTimeMs: (verifyEndTime - verifyStartTime).toFixed(2),
        authenticatedWallet
      });
      
      // Verify that the userId in the token matches the userId in the request
      if (authClaims.userId !== userId) {
        authLogger.warn(`User ID mismatch in Privy linking \n\t`, { 
          tokenUserId: authClaims.userId, 
          requestUserId: userId,
          authenticatedWallet
        });
        return res.status(401).json({ error: 'Invalid user ID' });
      }
    } catch (error) {
      authLogger.error(`Failed to verify Privy token for linking \n\t`, {
        error: error.message,
        stack: error.stack,
        userId,
        authenticatedWallet
      });
      return res.status(401).json({ error: 'Invalid Privy token' });
    }

    // Get user details from Privy
    let privyUser;
    try {
      privyUser = await privyClient.getUser(userId);
      
      authLogger.info(`Retrieved Privy user details for linking \n\t`, {
        userId,
        userDetails: {
          hasWallet: !!privyUser.wallet,
          walletAddress: privyUser.wallet?.address 
            ? `${privyUser.wallet.address.substring(0, 6)}...${privyUser.wallet.address.slice(-4)}` 
            : 'none',
          hasEmail: !!privyUser.email?.address,
          hasPhone: !!privyUser.phone?.number,
          hasFido: !!privyUser.fido,
          linkedAccounts: privyUser.linkedAccounts?.length || 0
        },
        authenticatedWallet
      });
    } catch (error) {
      authLogger.error(`Failed to get Privy user details for linking \n\t`, {
        error: error.message,
        stack: error.stack,
        userId,
        authenticatedWallet
      });
      return res.status(500).json({ error: 'Failed to get user details from Privy' });
    }

    // Since we don't yet have a proper table migration, use user_social_profiles
    // This follows your existing pattern for social identities
    
    // Check if this Privy account is already linked to another wallet
    const existing = await prisma.user_social_profiles.findFirst({
      where: { 
        platform: 'privy',
        platform_user_id: userId
      }
    });

    if (existing && existing.wallet_address !== authenticatedWallet) {
      authLogger.warn(`Privy account already linked to a different wallet \n\t`, {
        privyUserId: userId,
        existingWallet: existing.wallet_address,
        requestingWallet: authenticatedWallet
      });
      
      return res.status(400).json({
        error: 'Privy account already linked',
        details: 'This Privy account is already linked to a different wallet address'
      });
    }

    // Create or update the Privy link in user_social_profiles
    const now = new Date();
    
    // Prepare metadata
    const metadata = {
      email: privyUser.email?.address,
      phone: privyUser.phone?.number,
      linkedAccounts: privyUser.linkedAccounts?.map(account => ({
        type: account.type,
        linkedAt: account.linkedAt
      })),
      lastVerified: now.toISOString()
    };

    // We'll use user_social_profiles which already exists in your schema
    try {
      // Upsert the social profile
      await prisma.user_social_profiles.upsert({
        where: {
          wallet_address_platform: {
            wallet_address: authenticatedWallet,
            platform: 'privy'
          }
        },
        update: {
          platform_user_id: userId,
          username: privyUser.email?.address || `privy_user_${userId.substring(0, 8)}`,
          verified: true,
          last_verified: now,
          metadata: metadata,
          updated_at: now
        },
        create: {
          wallet_address: authenticatedWallet,
          platform: 'privy',
          platform_user_id: userId,
          username: privyUser.email?.address || `privy_user_${userId.substring(0, 8)}`,
          verified: true,
          verification_date: now,
          last_verified: now,
          metadata: metadata,
          created_at: now,
          updated_at: now
        }
      });
      
      authLogger.info(`Privy account successfully linked \n\t`, {
        wallet: authenticatedWallet,
        privyUserId: userId,
        linkTime: now.toISOString()
      });
      
      return res.json({
        success: true,
        message: 'Privy account linked successfully',
        wallet: authenticatedWallet,
        privy_user_id: userId
      });
    } catch (upsertError) {
      // Log and return any errors
      authLogger.error(`Failed to link Privy account \n\t`, {
        error: upsertError.message,
        stack: upsertError.stack,
        authenticatedWallet,
        privyUserId: userId
      });
      return res.status(500).json({ error: 'Failed to link Privy account' });
    }
  } catch (error) {
    authLogger.error(`Privy account linking failed \n\t`, {
      error: error.message,
      stack: error.stack,
      wallet: req.user?.wallet_address
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/auth/status:
 *   get:
 *     summary: Get comprehensive authentication status
 *     tags: [Authentication]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Comprehensive authentication status including all methods
 */
router.get('/status', async (req, res) => {
  try {
    authLogger.info(`Authentication status check requested \n\t`, {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    // Check JWT/Session Auth Status
    let jwtStatus = {
      active: false,
      method: 'jwt',
      details: {}
    };
    
    const token = req.cookies.session;
    if (token) {
      try {
        // Verify token
        const decoded = jwt.verify(token, config.jwt.secret);
        
        // Check if user exists
        const user = await prisma.users.findUnique({
          where: { wallet_address: decoded.wallet_address }
        });
        
        if (user) {
          jwtStatus.active = true;
          jwtStatus.details = {
            wallet_address: decoded.wallet_address,
            role: user.role,
            nickname: user.nickname,
            expires: new Date(decoded.exp * 1000).toISOString(),
            session_id: decoded.session_id,
            last_login: user.last_login
          };
        } else {
          jwtStatus.details.error = 'Valid token but user not found';
        }
      } catch (error) {
        jwtStatus.details.error = error.message;
        jwtStatus.details.errorType = error.name;
      }
    }

    // Check for Twitter connection
    let twitterStatus = {
      active: false,
      method: 'twitter',
      details: {}
    };
    
    try {
      if (jwtStatus.active) {
        // Check if user has Twitter linked
        const twitterProfile = await prisma.user_social_profiles.findFirst({
          where: {
            wallet_address: jwtStatus.details.wallet_address,
            platform: 'twitter'
          }
        });
        
        if (twitterProfile) {
          twitterStatus.active = true;
          twitterStatus.details = {
            username: twitterProfile.username,
            verified: twitterProfile.verified,
            last_verified: twitterProfile.last_verified,
            profile_image: twitterProfile.metadata?.profile_image_url || null
          };
        }
      }
      
      // Also check for any pending Twitter auth in session
      if (req.session?.twitter_user) {
        twitterStatus.pending = true;
        twitterStatus.details.pendingUsername = req.session.twitter_user.username;
      }
    } catch (error) {
      authLogger.error(`Error checking Twitter status \n\t`, {
        error: error.message,
        stack: error.stack
      });
      twitterStatus.details.error = 'Error checking Twitter connection';
    }
    
    // Check for Discord connection
    let discordStatus = {
      active: false,
      method: 'discord',
      details: {}
    };
    
    try {
      if (jwtStatus.active) {
        // Check if user has Discord linked
        const discordProfile = await prisma.user_social_profiles.findFirst({
          where: {
            wallet_address: jwtStatus.details.wallet_address,
            platform: 'discord'
          }
        });
        
        if (discordProfile) {
          discordStatus.active = true;
          discordStatus.details = {
            username: discordProfile.username,
            verified: discordProfile.verified,
            last_verified: discordProfile.last_verified,
            avatar: discordProfile.metadata?.avatar || null,
            discriminator: discordProfile.metadata?.discriminator || null
          };
        }
      }
      
      // Also check for any pending Discord auth in session
      if (req.session?.discord_user) {
        discordStatus.pending = true;
        discordStatus.details.pendingUsername = req.session.discord_user.username;
      }
    } catch (error) {
      authLogger.error(`Error checking Discord status \n\t`, {
        error: error.message,
        stack: error.stack
      });
      discordStatus.details.error = 'Error checking Discord connection';
    }

    // Check for Privy auth info - both recent auth usage and linked status
    let privyStatus = {
      active: false,
      linked: false,
      method: 'privy',
      details: {}
    };

    // Get both authentication and linking status
    try {
      if (jwtStatus.active) {
        const walletAddress = jwtStatus.details.wallet_address;
        
        // 1. Check if this user's wallet is linked to a Privy account
        const privyProfile = await prisma.user_social_profiles.findFirst({
          where: {
            wallet_address: walletAddress,
            platform: 'privy',
          }
        });
        
        // Update linked status if a profile was found
        if (privyProfile) {
          privyStatus.linked = true;
          privyStatus.details.linked = {
            userId: privyProfile.platform_user_id,
            username: privyProfile.username,
            verified: privyProfile.verified,
            last_verified: privyProfile.last_verified
          };
        }
        
        // Set Privy active status based on linked account instead of api_request_log
        // since the api_request_log table doesn't appear to exist in the schema
        privyStatus.active = privyStatus.linked;
        
        if (privyStatus.linked) {
          privyStatus.details.last_login = {
            timestamp: new Date().toISOString(),
            success: true,
            note: "Based on linked account status"
          };
        }
      }
    } catch (error) {
      authLogger.error(`Error checking Privy status \n\t`, {
        error: error.message, 
        stack: error.stack
      });
      privyStatus.details.error = 'Error checking Privy connection';
    }

    // Check device authorization status
    let deviceAuthStatus = {
      active: false,
      method: 'device',
      details: {}
    };
    
    try {
      if (jwtStatus.active && req.headers['x-device-id']) {
        const deviceId = req.headers['x-device-id'];
        
        const device = await prisma.authorized_devices.findUnique({
          where: {
            wallet_address_device_id: {
              wallet_address: jwtStatus.details.wallet_address,
              device_id: deviceId
            }
          }
        });
        
        if (device) {
          deviceAuthStatus.active = device.is_active;
          deviceAuthStatus.details = {
            device_id: device.device_id,
            device_name: device.device_name,
            device_type: device.device_type,
            authorized: device.is_active,
            last_used: device.last_used,
            created_at: device.created_at
          };
        } else {
          deviceAuthStatus.details.error = 'Device not registered';
        }
      } else if (config.device_auth_enabled) {
        deviceAuthStatus.details.error = 'No device ID provided';
        deviceAuthStatus.details.required = config.device_auth_enabled;
      } else {
        deviceAuthStatus.details.required = false;
      }
    } catch (error) {
      authLogger.error(`Error checking device auth status \n\t`, {
        error: error.message,
        stack: error.stack
      });
      deviceAuthStatus.details.error = 'Error checking device authorization';
    }

    // Compile comprehensive status
    const status = {
      timestamp: new Date().toISOString(),
      authenticated: jwtStatus.active,
      methods: {
        jwt: jwtStatus,
        twitter: twitterStatus,
        discord: discordStatus,
        privy: privyStatus,
        device: deviceAuthStatus
      },
      device_auth_required: config.device_auth_enabled,
      environment: process.env.NODE_ENV || 'development'
    };
    
    authLogger.debug(`Authentication status compiled \n\t`, { 
      authenticated: status.authenticated,
      activeAuthMethods: Object.entries(status.methods)
        .filter(([_, info]) => info.active)
        .map(([method]) => method)
    });
    
    return res.json(status);
  } catch (error) {
    authLogger.error(`Failed to generate auth status \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/auth/discord/check-config:
 *   get:
 *     summary: Check Discord OAuth configuration
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Discord OAuth configuration check completed
 *       500:
 *         description: Failed to check Discord configuration
 */
router.get('/discord/check-config', async (req, res) => {
  try {
    // Check Discord configuration from config object
    const discordConfig = {
      DISCORD_CLIENT_ID: config.discord.oauth.client_id ? '✅ Set' : '❌ Missing',
      DISCORD_CLIENT_SECRET: config.discord.oauth.client_secret ? '✅ Set' : '❌ Missing',
      DISCORD_CALLBACK_URI: config.discord.oauth.callback_uri ? '✅ Set' : '❌ Missing',
      DISCORD_CALLBACK_URI_DEVELOPMENT: config.discord.oauth.callback_uri_development ? '✅ Set' : '❌ Missing',
      NODE_ENV: process.env.NODE_ENV || 'development',
      ACTIVE_CALLBACK_URI: config.getEnvironment() === 'development'
        ? config.discord.oauth.callback_uri_development
        : config.discord.oauth.callback_uri
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
      config: discordConfig,
      sessionStatus,
      redisStatus,
      sessionVerified,
      currentEnvironment: process.env.NODE_ENV || 'development',
      message: 'Discord OAuth configuration check completed'
    });
  } catch (error) {
    authLogger.error(`Discord config check failed \n\t`, {
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

/**
 * @swagger
 * /api/auth/discord/login:
 *   get:
 *     summary: Initiate Discord OAuth login
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       302:
 *         description: Redirects to Discord OAuth
 *       500:
 *         description: Failed to initiate Discord authentication
 */
router.get('/discord/login', async (req, res) => {
  try {
    // Generate CSRF token and state for security
    const state = randomBytes(32).toString('hex');
    
    // Store state in cookie for verification later
    authLogger.info(`Discord OAuth: Creating state cookie \n\t`, {
      domain: req.get('host'),
      environment: config.getEnvironment(),
      cookieSettings: {
        httpOnly: true,
        secure: config.getEnvironment() === 'production',
        sameSite: 'lax',
        maxAge: '10 minutes'
      }
    });
    
    // SameSite=lax allows cookies to be sent during top-level navigations (like redirects)
    // but restricts cookies during cross-site subrequests (like image loads)
    res.cookie('discord_oauth_state', state, {
      httpOnly: true,
      secure: config.getEnvironment() === 'production',
      sameSite: 'lax', // Important: SameSite=lax needed for OAuth redirects to work
      maxAge: 10 * 60 * 1000 // 10 minutes
    });

    // Determine which callback URI to use based on environment
    const callbackUri = config.getEnvironment() === 'development'
      ? config.discord.oauth.callback_uri_development
      : config.discord.oauth.callback_uri;

    // Check if callback URI is properly configured
    if (!callbackUri) {
      authLogger.error(`Discord OAuth failed: Missing callback URI \n\t`, {
        environment: config.getEnvironment(),
        devCallback: config.discord.oauth.callback_uri_development,
        prodCallback: config.discord.oauth.callback_uri
      });
      return res.status(500).json({
        error: 'Configuration error',
        details: 'OAuth callback URI not configured'
      });
    }

    // Check if client ID is properly configured
    if (!config.discord.oauth.client_id) {
      authLogger.error(`Discord OAuth failed: Missing client ID \n\t`);
      return res.status(500).json({
        error: 'Configuration error',
        details: 'OAuth client ID not configured'
      });
    }

    // Construct the Discord OAuth URL
    const authUrl = new URL('https://discord.com/api/oauth2/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', config.discord.oauth.client_id);
    authUrl.searchParams.append('redirect_uri', callbackUri);
    // Scopes for Discord - identify is required for basic user info
    const scopes = config.discord.oauth.scopes.join(' ');
    authUrl.searchParams.append('scope', scopes);
    authUrl.searchParams.append('state', state);

    // Log OAuth parameters for debugging
    authLogger.info(`Initiating Discord OAuth flow \n\t`, {
      state: state.substring(0, 6) + '...',
      callbackUri,
      clientId: config.discord.oauth.client_id.substring(0, 6) + '...',
      scope: scopes,
      fullUrl: authUrl.toString()
    });

    // Redirect user to Discord OAuth
    return res.redirect(authUrl.toString());
  } catch (error) {
    authLogger.error(`Discord OAuth initialization failed \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      error: 'Could not initiate Discord authentication',
      details: error.message
    });
  }
});

/**
 * Find wallet by Discord ID and create a session
 * @param {string} discordId - Discord user ID
 * @param {object} discordUser - Discord user data
 * @returns {Promise<{success: boolean, wallet_address?: string, error?: string}>}
 */
async function loginWithDiscord(discordId, discordUser) {
  try {
    // Look up the user_social_profiles entry
    const socialProfile = await prisma.user_social_profiles.findFirst({
      where: {
        platform: 'discord',
        platform_user_id: discordId,
        verified: true
      }
    });
    
    // If no linked account found, return error
    if (!socialProfile) {
      authLogger.warn(`No verified Discord account found for login \n\t`, {
        discordId,
        discordUsername: discordUser.username
      });
      return {
        success: false,
        error: 'No linked wallet found for this Discord account'
      };
    }
    
    // Get the wallet user
    const user = await prisma.users.findUnique({
      where: { wallet_address: socialProfile.wallet_address }
    });
    
    // If no user found, return error
    if (!user) {
      authLogger.warn(`Discord linked to wallet but user not found \n\t`, {
        discordId,
        wallet: socialProfile.wallet_address
      });
      return {
        success: false,
        error: 'User not found for linked Discord account'
      };
    }
    
    // Update user last login time
    await prisma.users.update({
      where: { wallet_address: user.wallet_address },
      data: { last_login: new Date() }
    });
    
    // Update Discord profile data if needed
    if (discordUser.username !== socialProfile.username || 
        discordUser.avatar !== socialProfile.metadata?.avatar) {
      
      await prisma.user_social_profiles.update({
        where: {
          wallet_address_platform: {
            wallet_address: socialProfile.wallet_address,
            platform: 'discord'
          }
        },
        data: {
          username: discordUser.username,
          last_verified: new Date(),
          metadata: {
            ...socialProfile.metadata,
            avatar: discordUser.avatar,
            discriminator: discordUser.discriminator,
            email: discordUser.email
          },
          updated_at: new Date()
        }
      });
    }
    
    // Check if we should update the user's profile image
    try {
      authLogger.info(`Checking whether to update profile image for ${socialProfile.wallet_address} \n\t`, {
        discordUsername: discordUser.username,
        hasDiscordAvatar: !!discordUser.avatar,
        discordId: discordUser.id
      });
      
      // Get the current user profile details
      const userProfile = await prisma.users.findUnique({
        where: { wallet_address: socialProfile.wallet_address },
        select: { profile_image_url: true }
      });
      
      authLogger.info(`Current profile image status \n\t`, {
        wallet: socialProfile.wallet_address,
        hasProfileImage: !!userProfile.profile_image_url,
        currentImageUrl: userProfile.profile_image_url || 'none'
      });
      
      // Check if profile image is Discord-sourced by URL pattern
      const isDiscordProfileImage = userProfile.profile_image_url && 
        userProfile.profile_image_url.includes('cdn.discordapp.com/avatars');
      
      authLogger.info(`Profile image analysis \n\t`, {
        wallet: socialProfile.wallet_address,
        isDiscordImage: isDiscordProfileImage,
        needsUpdate: !userProfile.profile_image_url || isDiscordProfileImage
      });
      
      // If user has no profile image or has a Discord profile image that may be outdated
      if ((!userProfile.profile_image_url || isDiscordProfileImage) && discordUser.avatar) {
        // Use Discord CDN URL for the avatar
        const avatarUrl = `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=1024`;
        
        authLogger.info(`Processing Discord profile image \n\t`, {
          wallet: socialProfile.wallet_address,
          discordAvatar: discordUser.avatar,
          avatarUrl: avatarUrl,
          isDifferent: avatarUrl !== userProfile.profile_image_url
        });
        
        // Update profile image if it's different from current one
        if (avatarUrl !== userProfile.profile_image_url) {
          authLogger.info(`About to update profile image in database \n\t`, {
            wallet: socialProfile.wallet_address,
            oldImage: userProfile.profile_image_url || 'none',
            newImage: avatarUrl
          });
          
          await prisma.users.update({
            where: { wallet_address: socialProfile.wallet_address },
            data: {
              profile_image_url: avatarUrl,
              profile_image_updated_at: new Date()
            }
          });
          
          authLogger.info(`Successfully updated Discord profile image on login \n\t`, {
            wallet: socialProfile.wallet_address,
            oldImage: userProfile.profile_image_url || 'none',
            newImage: avatarUrl,
            success: true
          });
        } else {
          authLogger.info(`No profile image update needed \n\t`, {
            wallet: socialProfile.wallet_address,
            reason: 'Images are identical'
          });
        }
      } else if (!discordUser.avatar) {
        authLogger.info(`No profile image update needed \n\t`, {
          wallet: socialProfile.wallet_address,
          reason: 'No Discord avatar available'
        });
      }
    } catch (imageError) {
      authLogger.warn(`Failed to sync Discord profile image on login \n\t`, {
        wallet: socialProfile.wallet_address,
        error: imageError.message,
        stack: imageError.stack,
        discordId: discordUser.id
      });
      // Continue with login despite image sync error
    }
    
    authLogger.info(`Discord login successful for ${user.wallet_address} \n\t`, {
      discordUsername: discordUser.username,
      wallet: user.wallet_address
    });
    
    return {
      success: true,
      wallet_address: user.wallet_address,
      user
    };
  } catch (error) {
    authLogger.error(`Failed to login with Discord \n\t`, {
      error: error.message,
      stack: error.stack,
      discordId
    });
    
    return {
      success: false,
      error: 'Failed to login with Discord'
    };
  }
}

/**
 * @swagger
 * /api/auth/discord/callback:
 *   get:
 *     summary: Handle Discord OAuth callback
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
 *       400:
 *         description: Bad request
 *       500:
 *         description: Server error
 */
router.get('/discord/callback', (req, res, next) => {
  // Bypass CORS for Discord callback - set required CORS headers explicitly
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  next();
}, async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    
    // Handle explicit OAuth errors returned by Discord
    if (error) {
      authLogger.warn(`Discord OAuth error returned: ${error} \n\t`, { 
        error,
        error_description,
        state: state?.substring(0, 6) + '...' || 'missing'
      });
      // Return JSON error response instead of redirecting to static HTML
      return res.status(400).json({
        error: 'discord_oauth_error',
        error_type: error,
        error_description: error_description || '',
        message: 'An error occurred during Discord authentication.'
      });
    }
    
    // Check if all required parameters are present
    if (!code || !state) {
      authLogger.warn(`Discord OAuth callback missing required parameters \n\t`, { 
        codeExists: !!code,
        stateExists: !!state
      });
      return res.status(400).json({ 
        error: 'discord_oauth_error',
        error_type: 'missing_parameters',
        message: 'Missing required OAuth parameters'
      });
    }
    
    // Verify the state parameter matches what we sent
    const storedState = req.cookies.discord_oauth_state;
    if (!storedState || storedState !== state) {
      authLogger.warn(`Discord OAuth state mismatch \n\t`, {
        storedState: storedState ? `${storedState.substring(0, 6)}...` : 'missing',
        receivedState: `${state.substring(0, 6)}...`
      });
      
      return res.status(400).json({
        error: 'discord_oauth_error',
        error_type: 'state_mismatch',
        message: 'OAuth state verification failed'
      });
    }
    
    // Clear the state cookie since it's no longer needed
    res.clearCookie('discord_oauth_state');
    
    // Determine which callback URI to use based on environment
    const callbackUri = config.getEnvironment() === 'development' 
      ? config.discord.oauth.callback_uri_development 
      : config.discord.oauth.callback_uri;
    
    // Check for required configuration variables
    if (!config.discord.oauth.client_id || !config.discord.oauth.client_secret || !callbackUri) {
      authLogger.error(`Discord OAuth missing configuration \n\t`, {
        clientIdExists: !!config.discord.oauth.client_id,
        clientSecretExists: !!config.discord.oauth.client_secret,
        callbackUriExists: !!callbackUri
      });
      return res.status(500).json({
        error: 'discord_oauth_error',
        error_type: 'configuration_error',
        message: 'Server configuration error for Discord OAuth'
      });
    }
    
    // Exchange code for access token with detailed error handling
    let tokenResponse;
    try {
      // Prepare parameters for token request
      const tokenParams = new URLSearchParams({
        client_id: config.discord.oauth.client_id,
        client_secret: config.discord.oauth.client_secret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: callbackUri
      });
      
      // Log token request parameters (with sensitive data masked)
      authLogger.info(`Exchanging code for Discord token with parameters \n\t`, {
        code: code.substring(0, 6) + '...',
        grant_type: 'authorization_code',
        client_id: config.discord.oauth.client_id.substring(0, 6) + '...',
        redirect_uri: callbackUri
      });
      
      // Make token request
      tokenResponse = await axios.post(
        'https://discord.com/api/oauth2/token',
        tokenParams.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
    } catch (tokenError) {
      // Handle token request error
      const responseData = tokenError.response?.data || {};
      authLogger.error(`Discord OAuth token exchange failed \n\t`, {
        status: tokenError.response?.status,
        statusText: tokenError.response?.statusText,
        error: tokenError.message,
        responseData
      });
      
      return res.status(400).json({
        error: 'discord_oauth_error',
        error_type: 'token_exchange',
        error_description: responseData.error || tokenError.message,
        message: 'Failed to exchange OAuth code for access token'
      });
    }
    
    // Extract token data
    const { access_token, refresh_token } = tokenResponse.data;
    
    // Get Discord user info with detailed error handling
    let userResponse;
    try {
      userResponse = await axios.get('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });
    } catch (userError) {
      // Handle user info request error
      const responseData = userError.response?.data || {};
      authLogger.error(`Discord user info request failed \n\t`, {
        status: userError.response?.status,
        statusText: userError.response?.statusText,
        error: userError.message,
        responseData
      });
      
      return res.status(400).json({
        error: 'discord_oauth_error',
        error_type: 'user_info',
        error_description: responseData.error || userError.message,
        message: 'Failed to retrieve Discord user information'
      });
    }
    
    // Extract user data
    const discordUser = userResponse.data;
    
    // Check if valid user data was returned
    if (!discordUser || !discordUser.id) {
      authLogger.error(`Discord returned invalid user data \n\t`, { 
        responseData: userResponse.data
      });
      return res.status(400).json({
        error: 'discord_oauth_error',
        error_type: 'invalid_user_data',
        message: 'Discord returned invalid or incomplete user data'
      });
    }
    
    // Log successful user info retrieval
    authLogger.info(`Retrieved Discord user info \n\t`, {
      id: discordUser.id,
      username: discordUser.username,
      hasAvatar: !!discordUser.avatar,
      email: discordUser.email ? `${discordUser.email.substring(0, 3)}...` : 'none'
    });
    
    // First, check if this Discord account is already linked and can be used for direct login
    const loginResult = await loginWithDiscord(discordUser.id, discordUser);
    
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
      if (config.getEnvironment() === 'production') {
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
        environment: config.getEnvironment()
      });
      
      res.cookie('session', token, cookieOptions);
      
      authLogger.info(`Discord login: created session for wallet ${loginResult.wallet_address} \n\t`);
      
      // Redirect to the proper /me profile page
      const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
      authLogger.info(`Redirecting to ${baseUrl}/me after successful Discord login \n\t`);
      return res.redirect(`${baseUrl}/me`);
    }
    
    // If direct login wasn't successful, proceed with the linking flow
    
    // Store Discord info in session for linking to wallet later
    req.session.discord_user = {
      id: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator,
      avatar: discordUser.avatar,
      email: discordUser.email,
      access_token,
      refresh_token
    };
    
    // Save session explicitly to ensure discord_user data is persisted
    await new Promise((resolve, reject) => {
      req.session.save(err => {
        if (err) {
          authLogger.error(`Failed to save Discord user data to session \n\t`, { error: err.message });
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    authLogger.info(`Discord OAuth successful for user ${discordUser.username} \n\t`);
    
    // If user is already authenticated with a wallet, link accounts
    if (req.cookies.session) {
      try {
        const decoded = jwt.verify(req.cookies.session, config.jwt.secret);
        
        if (decoded && decoded.wallet_address) {
          // Link Discord account to wallet
          await linkDiscordToWallet(decoded.wallet_address, discordUser, access_token, refresh_token);
          
          // Redirect to the proper /me profile page
          const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
          authLogger.info(`Redirecting to ${baseUrl}/me?discord_linked=true after linking \n\t`);
          return res.redirect(`${baseUrl}/me?discord_linked=true`);
        }
      } catch (error) {
        // Token verification failed, continue to login page
        authLogger.warn(`Failed to verify existing session when linking Discord \n\t`, { error: error.message });
      }
    }
    
    // If no wallet is connected yet, redirect to a page where user can connect wallet
    const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
    // Redirect to the home page with query parameters instead of nonexistent /connect-wallet page
    authLogger.info(`Redirecting to ${baseUrl}/?action=connect-wallet&discord=pending to complete flow \n\t`);
    return res.redirect(`${baseUrl}/?action=connect-wallet&discord=pending`);
  } catch (error) {
    authLogger.error(`Discord OAuth callback failed \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      error: 'discord_oauth_error',
      error_type: 'unexpected_error',
      error_description: error.message,
      message: 'An unexpected error occurred during Discord authentication'
    });
  }
});

/**
 * @swagger
 * /api/auth/discord/link:
 *   post:
 *     summary: Link Discord account to connected wallet
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Discord account linked successfully
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.post('/discord/link', requireAuth, async (req, res) => {
  try {
    // Ensure user has Discord data in session
    if (!req.session?.discord_user) {
      authLogger.warn(`No Discord data in session for linking \n\t`);
      return res.status(400).json({ error: 'No Discord authentication data found' });
    }
    
    const { wallet_address } = req.user;
    const { id, username, discriminator, avatar, email, access_token, refresh_token } = req.session.discord_user;
    
    // Link Discord account to wallet
    await linkDiscordToWallet(wallet_address, 
      { id, username, discriminator, avatar, email }, 
      access_token, 
      refresh_token
    );
    
    // Clear Discord data from session
    delete req.session.discord_user;
    
    authLogger.info(`Discord account linked successfully for ${wallet_address} \n\t`);
    return res.json({ success: true, message: 'Discord account linked successfully' });
  } catch (error) {
    authLogger.error(`Failed to link Discord account \n\t`, {
      error: error.message,
      stack: error.stack,
      wallet: req.user?.wallet_address
    });
    return res.status(500).json({ error: 'Failed to link Discord account' });
  }
});

/**
 * Helper function to link Discord account to wallet
 */
async function linkDiscordToWallet(walletAddress, discordUser, accessToken, refreshToken) {
  const now = new Date();
  
  // Check if this Discord account is already linked to another wallet
  const existingLink = await prisma.user_social_profiles.findFirst({
    where: {
      platform: 'discord',
      platform_user_id: discordUser.id
    }
  });
  
  if (existingLink && existingLink.wallet_address !== walletAddress) {
    authLogger.warn(`Discord account already linked to different wallet \n\t`, {
      discordId: discordUser.id,
      existingWallet: existingLink.wallet_address,
      requestedWallet: walletAddress
    });
    throw new Error('This Discord account is already linked to another wallet');
  }
  
  // Create or update social profile
  await prisma.user_social_profiles.upsert({
    where: {
      wallet_address_platform: {
        wallet_address: walletAddress,
        platform: 'discord'
      }
    },
    create: {
      wallet_address: walletAddress,
      platform: 'discord',
      platform_user_id: discordUser.id,
      username: discordUser.username,
      verified: true,
      verification_date: now,
      last_verified: now,
      metadata: {
        discriminator: discordUser.discriminator,
        avatar: discordUser.avatar,
        email: discordUser.email,
        access_token: accessToken,
        refresh_token: refreshToken
      },
      created_at: now,
      updated_at: now
    },
    update: {
      username: discordUser.username,
      verified: true,
      last_verified: now,
      metadata: {
        discriminator: discordUser.discriminator,
        avatar: discordUser.avatar,
        email: discordUser.email,
        access_token: accessToken,
        refresh_token: refreshToken
      },
      updated_at: now
    }
  });
  
  // If the Discord profile has an avatar, update user's profile image if not already set
  try {
    authLogger.info(`Discord account linking: checking profile image \n\t`, {
      wallet: walletAddress,
      discordUsername: discordUser.username,
      hasDiscordAvatar: !!discordUser.avatar,
      discordId: discordUser.id
    });
    
    if (discordUser.avatar) {
      // Get the user to check if they already have a profile image
      const user = await prisma.users.findUnique({
        where: { wallet_address: walletAddress },
        select: { profile_image_url: true }
      });
      
      authLogger.info(`Discord link: current user profile status \n\t`, {
        wallet: walletAddress,
        hasExistingImage: !!user.profile_image_url,
        currentImageUrl: user.profile_image_url || 'none'
      });
      
      // If user has no profile image, use the Discord avatar
      if (!user.profile_image_url) {
        // Discord CDN URL for the avatar
        const avatarUrl = `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=1024`;
        
        authLogger.info(`Discord link: preparing to update profile image \n\t`, {
          wallet: walletAddress,
          avatarUrl: avatarUrl
        });
        
        await prisma.users.update({
          where: { wallet_address: walletAddress },
          data: {
            profile_image_url: avatarUrl,
            profile_image_updated_at: now
          }
        });
        
        authLogger.info(`Discord link: successfully updated user profile image \n\t`, {
          wallet: walletAddress,
          imageUrl: avatarUrl,
          success: true,
          updatedAt: now.toISOString()
        });
      } else {
        authLogger.info(`Discord link: skipping profile image update (user already has one) \n\t`, {
          wallet: walletAddress,
          existingImage: user.profile_image_url
        });
      }
    } else {
      authLogger.info(`Discord link: no avatar available from Discord \n\t`, {
        wallet: walletAddress,
        discordUsername: discordUser.username
      });
    }
  } catch (imageError) {
    // Log warning but don't prevent the linking if image update fails
    authLogger.error(`Failed to update profile image from Discord, but account linking succeeded \n\t`, {
      wallet: walletAddress,
      error: imageError.message,
      stack: imageError.stack,
      discordUsername: discordUser.username,
      discordId: discordUser.id
    });
  }
  
  authLogger.info(`Discord account linked to wallet ${walletAddress} \n\t`, {
    discordUsername: discordUser.username
  });
}

export default router;
