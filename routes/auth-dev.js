// routes/auth-dev.js

/**
 * Development Authentication Routes
 * 
 * @description Handles development-only authentication routes
 * 
 * @author BranchManager69
 * @version 2.0.0
 * @created 2025-05-08
 * @updated 2025-05-08
 */

import express from 'express';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import {
  generateAccessToken,
  createRefreshToken,
  setAuthCookies,
  generateSessionId
} from '../utils/auth-helpers.js';

const router = express.Router();

// Create a dedicated logger for dev auth operations
const authLogger = {
  ...logApi.forService('AUTH_DEV'),
  analytics: logApi.analytics
};

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

    // Generate session ID
    const sessionId = generateSessionId();

    // Create JWT token with user.id in payload
    const accessToken = generateAccessToken(user, sessionId, 'dev_login');
    
    // Create and store refresh token
    const refreshToken = await createRefreshToken(user);

    // Set auth cookies
    setAuthCookies(res, req, accessToken, refreshToken);

    // Log successful dev login
    authLogger.info(`DEV LOGIN SUCCESS \n\t`, {
      userId: user.id,
      wallet: user.wallet_address,
      role: user.role,
      sessionId
    });

    // Return success + additional user info
    return res.json({
      success: true,
      user: {
        id: user.id,
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

export default router;