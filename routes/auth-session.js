// routes/auth-session.js

/**
 * Session Management Routes
 * 
 * @description Handles session management, including token refresh and session validation
 * 
 * @author BranchManager69
 * @version 2.0.0
 * @created 2025-05-08
 * @updated 2025-05-08
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { requireAuth } from '../middleware/auth.js';
import {
  generateAccessToken,
  createRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  generateSessionId
} from '../utils/auth-helpers.js';

const router = express.Router();

// Create a dedicated logger for session management
const authLogger = {
  ...logApi.forService('AUTH_SESSION'),
  analytics: logApi.analytics
};

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
        clearAuthCookies(res, req);
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

    const user = existingTokenRecord.user;
    const sessionId = generateSessionId();
    const newAccessToken = generateAccessToken(user, sessionId);
    const newRefreshToken = await createRefreshToken(user);

    // Set new cookies
    setAuthCookies(res, req, newAccessToken, newRefreshToken);
    
    authLogger.info('Access token refreshed successfully', { userId: user.id, wallet: user.wallet_address });
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
    authLogger.error('Refresh token processing error', { error: error.message, stack: error.stack, token_prefix: refreshTokenFromCookie ? refreshTokenFromCookie.substring(0, 10) : 'none'});
    clearAuthCookies(res, req);
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
        // Fallback if req.user.id isn't there for some reason
        authLogger.warn('Logout attempt: r_session present but req.user.id missing. Clearing cookies without specific DB revocation by hash only or skipping DB.', { wallet: req.user?.wallet_address });
    }
    
    // Clear auth cookies
    clearAuthCookies(res, req);

    if (config.debug_mode) {
      authLogger.info(`User logged out successfully \n\t`, { user: req.user.wallet_address });
    }
    res.json({ success: true });
  } catch (error) {
    authLogger.error(`Logout failed \n\t`, { error: error.message, stack: error.stack, user: req.user?.wallet_address });
    // Still try to clear cookies on error
    clearAuthCookies(res, req);
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
        id: user.id,
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

    // Get the user from the database
    const user = await prisma.users.findUnique({
      where: { wallet_address: decoded.wallet_address }
    });

    // If the user is not found, return a 401 error
    if (!user) {
      authLogger.debug(`User not found for token request \n\t`, { wallet: decoded.wallet_address });
      return res.status(401).json({ error: 'User not found' });
    }

    // Create a WebSocket-specific token
    const wsToken = jwt.sign(
      {
        id: user.id,
        wallet_address: user.wallet_address,
        role: user.role,
        session_id: decoded.session_id // Preserve the same session ID
      },
      config.jwt.secret,
      { expiresIn: '1h' } // Short expiration for WebSocket tokens
    );

    // Track token generation with analytics
    authLogger.analytics.trackInteraction(user, 'token_request', {
      success: true,
      session_id: decoded.session_id
    }, req.headers);

    // Log the WSS token generation
    authLogger.info(`[auth] WebSocket token generated`, { 
      wallet: user.wallet_address,
      userId: user.id,
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
 * /api/auth/disconnect:
 *   post:
 *     summary: Disconnect wallet and clear session (Alias for logout, essentially)
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
 *               - wallet
 *             properties:
 *               wallet:
 *                 type: string
 *                 description: Wallet address to disconnect (primarily for logging/confirmation)
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
 *       401:
 *         description: Not authenticated
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

    // Optional: Verify that the wallet in the body matches the authenticated user
    if (req.user?.wallet_address !== wallet) {
      logApi.warn(`Disconnect request wallet mismatch`, { authUser: req.user?.wallet_address, bodyWallet: wallet });
      // Depending on security requirements, you might return an error here
      // return res.status(403).json({ error: 'Wallet mismatch' });
    }

    // Optional: Update user record (e.g., last activity)
    // await prisma.users.update({
    //   where: { id: req.user.id }, 
    //   data: { last_login: new Date() } // Consider a different field like last_disconnected_at?
    // });

    // --- Refresh Token Revocation --- 
    const refreshTokenFromCookie = req.cookies.r_session;
    if (refreshTokenFromCookie && req.user && req.user.id) { 
      const hashedToken = crypto.createHash('sha256').update(refreshTokenFromCookie).digest('hex');
      await prisma.refresh_tokens.updateMany({
        where: { token_hash: hashedToken, user_id: req.user.id, revoked_at: null },
        data: { revoked_at: new Date() }
      });
    } else if (refreshTokenFromCookie) {
        authLogger.warn('Disconnect attempt: r_session present but req.user.id missing. Clearing cookies only.', { wallet: req.user?.wallet_address });
    }

    // Clear auth cookies using the helper
    clearAuthCookies(res, req);

    if (config.debug_mode) { logApi.info(`Wallet ${wallet} disconnected \\n\\t`, { userId: req.user?.id }); }
    res.json({ success: true });
  } catch (error) {
    if (config.debug_mode) { logApi.error(`Wallet disconnect failed \n\t`, { error }); }
    // Still try to clear cookies on error
    clearAuthCookies(res, req);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;