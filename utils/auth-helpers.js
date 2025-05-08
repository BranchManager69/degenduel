// utils/auth-helpers.js

/**
 * Authentication Helper Functions
 * 
 * @description Centralized authentication utilities for consistent token handling
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import { logApi } from './logger-suite/logger.js';
import { config } from '../config/config.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/prisma.js';

// Create a dedicated logger for auth operations
const authLogger = {
  ...logApi.forService('AUTH'),
  analytics: logApi.analytics
};

/**
 * Get standardized cookie options based on environment
 * @param {Object} req - Express request object
 * @param {string} type - Cookie type ('session' or 'refresh')
 * @returns {Object} Cookie options
 */
export function getCookieOptions(req, type = 'session') {
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

/**
 * Generate a random session ID
 * @returns {string} Random session ID
 */
export function generateSessionId() {
  return Buffer.from(crypto.randomBytes(16)).toString('hex');
}

/**
 * Generate an access token for a user
 * @param {Object} user - User object from database
 * @param {string} [sessionId] - Optional session ID (will be generated if not provided)
 * @param {string} [authMethod] - Optional authentication method used
 * @returns {string} JWT access token
 */
export function generateAccessToken(user, sessionId = null, authMethod = 'wallet') {
  if (!sessionId) {
    sessionId = generateSessionId();
  }
  
  return jwt.sign(
    {
      id: user.id,
      wallet_address: user.wallet_address,
      role: user.role,
      session_id: sessionId,
      auth_method: authMethod
    },
    config.jwt.secret,
    { expiresIn: '1h' } // Standard 1 hour expiration
  );
}

/**
 * Generate a WebSocket-specific token
 * @param {Object} user - User object from database
 * @param {string} sessionId - Session ID to maintain connection with main session
 * @returns {string} JWT token for WebSocket auth
 */
export function generateWebSocketToken(user, sessionId) {
  return jwt.sign(
    {
      id: user.id,
      wallet_address: user.wallet_address,
      role: user.role,
      session_id: sessionId
    },
    config.jwt.secret,
    { expiresIn: '1h' } // 1 hour expiration
  );
}

/**
 * Create a refresh token for a user and store it in the database
 * @param {Object} user - User object from database
 * @returns {string} Plain refresh token string (to be sent in cookie)
 */
export async function createRefreshToken(user) {
  // Generate a random string for the refresh token
  const refreshTokenString = crypto.randomBytes(64).toString('hex');
  
  // Hash it for storage in the database
  const hashedRefreshToken = crypto.createHash('sha256').update(refreshTokenString).digest('hex');
  
  // Set expiration (7 days)
  const refreshTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Store in database
  await prisma.refresh_tokens.create({
    data: {
      user_id: user.id,
      wallet_address: user.wallet_address,
      token_hash: hashedRefreshToken,
      expires_at: refreshTokenExpiresAt
    }
  });

  return refreshTokenString;
}

/**
 * Validate refresh token and return user if valid
 * @param {string} refreshToken - Refresh token from cookie
 * @returns {Promise<Object|null>} User object if token valid, null otherwise
 */
export async function validateRefreshToken(refreshToken) {
  if (!refreshToken) {
    return null;
  }
  
  try {
    // Hash the token
    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    // Find the token in database
    const tokenRecord = await prisma.refresh_tokens.findUnique({
      where: { token_hash: hashedToken },
      include: { user: true }
    });
    
    // Check if token exists
    if (!tokenRecord) {
      return null;
    }
    
    // Check if token has been revoked
    if (tokenRecord.revoked_at) {
      // SECURITY: Possibly revoke all tokens for this user
      return null;
    }
    
    // Check if token has expired
    if (new Date(tokenRecord.expires_at) < new Date()) {
      return null;
    }
    
    return tokenRecord.user;
  } catch (error) {
    authLogger.error('Error validating refresh token', {
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

/**
 * Revoke a specific refresh token
 * @param {string} refreshToken - Refresh token to revoke
 * @returns {Promise<boolean>} Success status
 */
export async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) {
    return false;
  }
  
  try {
    // Hash the token
    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    // Mark token as revoked
    await prisma.refresh_tokens.updateMany({
      where: { token_hash: hashedToken, revoked_at: null },
      data: { revoked_at: new Date() }
    });
    
    return true;
  } catch (error) {
    authLogger.error('Error revoking refresh token', {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

/**
 * Revoke all refresh tokens for a user
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
export async function revokeAllUserRefreshTokens(userId) {
  try {
    await prisma.refresh_tokens.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() }
    });
    return true;
  } catch (error) {
    authLogger.error('Error revoking all user refresh tokens', {
      error: error.message,
      stack: error.stack,
      userId
    });
    return false;
  }
}

/**
 * Set authentication cookies
 * @param {Object} res - Express response object
 * @param {Object} req - Express request object
 * @param {string} accessToken - JWT access token
 * @param {string} refreshToken - Refresh token
 */
export function setAuthCookies(res, req, accessToken, refreshToken) {
  res.cookie('session', accessToken, getCookieOptions(req, 'session'));
  res.cookie('r_session', refreshToken, getCookieOptions(req, 'refresh'));
}

/**
 * Clear authentication cookies
 * @param {Object} res - Express response object
 * @param {Object} req - Express request object
 */
export function clearAuthCookies(res, req) {
  res.clearCookie('session', getCookieOptions(req, 'session'));
  res.clearCookie('r_session', getCookieOptions(req, 'refresh'));
}

/**
 * Complete authentication flow - issue tokens, set cookies, track login
 * @param {Object} user - User database object
 * @param {Object} res - Express response object
 * @param {Object} req - Express request object
 * @param {string} authMethod - Authentication method used
 * @param {Object} [analyticsData] - Optional analytics data
 * @returns {Object} Auth data including user info
 */
export async function completeAuthentication(user, res, req, authMethod = 'wallet', analyticsData = {}) {
  // Update last login
  await prisma.users.update({
    where: { id: user.id },
    data: { last_login: new Date() }
  });
  
  // Generate session ID
  const sessionId = generateSessionId();
  
  // Create access token
  const accessToken = generateAccessToken(user, sessionId, authMethod);
  
  // Create refresh token
  const refreshToken = await createRefreshToken(user);
  
  // Set cookies
  setAuthCookies(res, req, accessToken, refreshToken);
  
  // Track session with analytics
  authLogger.analytics.trackSession(user, {
    ...analyticsData,
    auth_method: authMethod,
    session_id: sessionId
  });
  
  // Log success
  authLogger.info(`Authentication successful via ${authMethod}`, {
    userId: user.id,
    wallet: user.wallet_address,
    sessionId
  });
  
  // Return auth data
  return {
    verified: true,
    user: {
      id: user.id,
      wallet_address: user.wallet_address,
      role: user.role,
      nickname: user.nickname
    },
    auth_method: authMethod
  };
}