// routes/auth-wallet.js

/**
 * Wallet Authentication Routes
 * 
 * @description Handles wallet-based authentication routes
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import { PublicKey } from '@solana/web3.js';
import express from 'express';
import nacl from 'tweetnacl';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { clearNonce, generateNonce, getNonceRecord } from '../utils/dbNonceStore.js';
import { requireAuth } from '../middleware/auth.js';
import { UserRole } from '../types/userRole.js';
import {
  generateAccessToken,
  createRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  generateSessionId
} from '../utils/auth-helpers.js';

const router = express.Router();

// Create a dedicated logger for wallet auth operations
const authLogger = {
  ...logApi.forService('AUTH_WALLET'),
  analytics: logApi.analytics
};

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

    // Generate session ID
    const sessionId = generateSessionId();
    
    // Create access token with user.id in payload
    const accessToken = generateAccessToken(user, sessionId, 'wallet');
    
    // Create refresh token
    const refreshToken = await createRefreshToken(user);

    // Set auth cookies
    setAuthCookies(res, req, accessToken, refreshToken);
    
    authLogger.info(`Wallet verified successfully, tokens issued \n\t`, { wallet: user.wallet_address, role: user.role });

    const deviceAuthStatus = deviceInfo ? { 
      device_authorized: deviceInfo.is_active, 
      device_id: deviceInfo.device_id, 
      device_name: deviceInfo.device_name, 
      requires_authorization: config.device_auth_enabled && !deviceInfo.is_active 
    } : null;
    
    return res.json({ 
      verified: true, 
      user: { 
        id: user.id,
        wallet_address: user.wallet_address, 
        role: user.role, 
        nickname: user.nickname 
      }, 
      device: deviceAuthStatus 
    });

  } catch (error) {
    authLogger.error(`Wallet verification failed \n\t`, { error: error.message, stack: error.stack, wallet: req.body?.wallet });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;