// routes/auth-qr.js

/**
 * QR Code Authentication Routes
 * 
 * @description Handles QR code cross-device authentication
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-09
 */

import express from 'express';
import { randomBytes, createHash } from 'crypto';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config/config.js';
import QRCode from 'qrcode';
// Import authentication helpers
import {
  generateAccessToken,
  createRefreshToken,
  setAuthCookies,
  generateSessionId
} from '../utils/auth-helpers.js';

const router = express.Router();

// Create a dedicated logger for QR auth operations
const authLogger = {
  ...logApi.forService('AUTH_QR'),
  analytics: logApi.analytics
};

/**
 * Generate a secure random token for QR authentication
 */
function generateQRToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Create a new QR authentication session
 * @returns {Promise<Object>} Session data including token
 */
async function createQRSession() {
  const sessionToken = generateQRToken();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry
  
  const session = await prisma.qr_auth_sessions.create({
    data: {
      session_token: sessionToken,
      expires_at: expiresAt,
      session_data: {},
      status: 'pending'
    }
  });
  
  return {
    id: session.id,
    sessionToken,
    expiresAt
  };
}

/**
 * Get QR session by token
 * @param {string} token - Session token
 * @returns {Promise<Object|null>} Session data or null if not found
 */
async function getQRSession(token) {
  try {
    const session = await prisma.qr_auth_sessions.findUnique({
      where: { session_token: token }
    });
    
    // Check if session exists and hasn't expired
    if (!session || new Date(session.expires_at) < new Date()) {
      return null;
    }
    
    return session;
  } catch (error) {
    authLogger.error('Error getting QR session', {
      error: error.message,
      stack: error.stack,
      tokenPrefix: token.substring(0, 8)
    });
    return null;
  }
}

/**
 * Update QR session status
 * @param {string} token - Session token
 * @param {string} status - New status
 * @param {Object} data - Session data to update
 * @param {number} [userId] - User ID to associate
 * @returns {Promise<boolean>} Success status
 */
async function updateQRSession(token, status, data = {}, userId = null) {
  try {
    const updateData = {
      status,
      session_data: data
    };
    
    if (status === 'completed') {
      updateData.completed_at = new Date();
    }
    
    if (userId) {
      updateData.user_id = userId;
    }
    
    await prisma.qr_auth_sessions.update({
      where: { session_token: token },
      data: updateData
    });
    
    return true;
  } catch (error) {
    authLogger.error('Error updating QR session', {
      error: error.message,
      stack: error.stack,
      tokenPrefix: token.substring(0, 8),
      status
    });
    return false;
  }
}

/**
 * @route POST /api/auth/qr/generate
 * @description Generate a new QR code for authentication
 * @access Public
 */
router.post('/generate', async (req, res) => {
  try {
    // Create a new QR authentication session
    const session = await createQRSession();
    
    // Base URL for QR code
    const { origin } = req.headers;
    const baseUrl = origin || config.webauthn?.origin || 'https://degenduel.me';
    
    // Create the QR code URL that mobile app will handle
    const qrUrl = `${baseUrl}/qr-auth/${session.sessionToken}`;
    
    // Generate the QR code as a data URL
    const qrCode = await QRCode.toDataURL(qrUrl);
    
    authLogger.info('Generated QR authentication code', {
      sessionId: session.id,
      expiresAt: session.expiresAt
    });
    
    // Return QR code data and session info
    res.json({
      qrCode,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    authLogger.error('Error generating QR code', {
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: 'Failed to generate QR code',
      message: error.message
    });
  }
});

/**
 * @route GET /api/auth/qr/poll/:token
 * @description Poll for QR authentication status
 * @access Public
 */
router.get('/poll/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({ error: 'Missing session token' });
    }
    
    // Get session status
    const session = await getQRSession(token);
    
    if (!session) {
      return res.status(404).json({ 
        error: 'invalid_session',
        message: 'Session not found or expired' 
      });
    }
    
    // Return session status
    res.json({
      status: session.status,
      expiresAt: session.expires_at,
    });
    
  } catch (error) {
    authLogger.error('Error polling QR status', {
      error: error.message,
      stack: error.stack,
      token: req.params.token
    });
    
    res.status(500).json({
      error: 'Failed to poll QR status',
      message: error.message
    });
  }
});

/**
 * @route POST /api/auth/qr/verify/:token
 * @description Verify QR code from mobile device
 * @access Private (must be authenticated on mobile device)
 */
router.post('/verify/:token', requireAuth, async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({ error: 'Missing session token' });
    }
    
    // Get current user from authenticated session (mobile device)
    const user = req.user;
    
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Invalid authentication' });
    }
    
    // Get QR session
    const session = await getQRSession(token);
    
    if (!session) {
      return res.status(404).json({ 
        error: 'invalid_session',
        message: 'Session not found or expired' 
      });
    }
    
    if (session.status !== 'pending') {
      return res.status(400).json({ 
        error: 'invalid_session_state',
        message: `Session in invalid state: ${session.status}` 
      });
    }
    
    // Update session status to approved and associate user
    const updated = await updateQRSession(token, 'approved', {
      verified_at: new Date().toISOString(),
      device_info: {
        user_agent: req.headers['user-agent'],
        ip: req.ip
      }
    }, user.id);
    
    if (!updated) {
      return res.status(500).json({ error: 'Failed to update session' });
    }
    
    authLogger.info('QR authentication approved by mobile device', {
      userId: user.id,
      wallet: user.wallet_address,
      sessionToken: token.substring(0, 8)
    });
    
    // Return success
    res.json({
      success: true,
      message: 'QR authentication approved. You can close this page.'
    });
    
  } catch (error) {
    authLogger.error('Error verifying QR authentication', {
      error: error.message,
      stack: error.stack,
      token: req.params.token,
      userId: req.user?.id
    });
    
    res.status(500).json({
      error: 'Failed to verify QR authentication',
      message: error.message
    });
  }
});

/**
 * @route POST /api/auth/qr/complete/:token
 * @description Complete QR authentication and issue tokens
 * @access Public (from desktop browser)
 */
router.post('/complete/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({ error: 'Missing session token' });
    }
    
    // Get QR session with user data
    const session = await prisma.qr_auth_sessions.findUnique({
      where: { session_token: token },
      include: { user: true }
    });
    
    if (!session) {
      return res.status(404).json({ 
        error: 'invalid_session',
        message: 'Session not found or expired' 
      });
    }
    
    if (session.status !== 'approved') {
      return res.status(400).json({ 
        error: 'invalid_session_state',
        message: `Session in invalid state: ${session.status}. Must be approved by mobile device first.` 
      });
    }
    
    // Get user data
    const user = session.user;
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Generate auth tokens
    const sessionId = generateSessionId();
    const accessToken = generateAccessToken(user, sessionId, 'qr_code');
    const refreshToken = await createRefreshToken(user);
    
    // Set cookies
    setAuthCookies(res, req, accessToken, refreshToken);
    
    // Update session status to completed
    await updateQRSession(token, 'completed', {
      completed_at: new Date().toISOString(),
      device_info: {
        user_agent: req.headers['user-agent'],
        ip: req.ip
      }
    });
    
    // Update user's last login
    await prisma.users.update({
      where: { id: user.id },
      data: { last_login: new Date() }
    });
    
    authLogger.info('QR authentication completed successfully', {
      userId: user.id,
      wallet: user.wallet_address,
      sessionToken: token.substring(0, 8)
    });
    
    // Return user data
    res.json({
      verified: true,
      user: {
        id: user.id,
        wallet_address: user.wallet_address,
        role: user.role,
        nickname: user.nickname
      },
      auth_method: 'qr_code'
    });
    
  } catch (error) {
    authLogger.error('Error completing QR authentication', {
      error: error.message,
      stack: error.stack,
      token: req.params.token
    });
    
    res.status(500).json({
      error: 'Failed to complete QR authentication',
      message: error.message
    });
  }
});

/**
 * @route POST /api/auth/qr/cancel/:token
 * @description Cancel QR authentication session
 * @access Public
 */
router.post('/cancel/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({ error: 'Missing session token' });
    }
    
    // Update session status to cancelled
    await updateQRSession(token, 'cancelled');
    
    res.json({
      success: true,
      message: 'QR authentication cancelled'
    });
    
  } catch (error) {
    authLogger.error('Error cancelling QR authentication', {
      error: error.message,
      stack: error.stack,
      token: req.params.token
    });
    
    res.status(500).json({
      error: 'Failed to cancel QR authentication',
      message: error.message
    });
  }
});

export default router;