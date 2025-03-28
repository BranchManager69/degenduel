// /middleware/auth.js

/**
 * Authentication Middleware
 * 
 * This middleware handles user authentication for protected endpoints.
 * It verifies the session token, searches for the user in the database,
 * and attaches the user info to the request object.
 * 
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {Function} next - The next middleware function.
 */

import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';

// Config
import { config } from '../config/config.js';
const AUTH_DEBUG_MODE_OVERRIDE = 'true';

// Set AUTH_DEBUG_MODE
const AUTH_DEBUG_MODE = (config.debug_modes.auth === true || config.debug_modes.auth === 'true') || AUTH_DEBUG_MODE_OVERRIDE === 'true';
if (AUTH_DEBUG_MODE) {
  logApi.info('AUTH_DEBUG_MODE:', AUTH_DEBUG_MODE); 
}

// For authenticated endpoints
export const requireAuth = async (req, res, next) => {
  try {
    // Get session token from cookies
    const token = req.cookies.session;
    // Log session token
    if (AUTH_DEBUG_MODE) { logApi.info('Session token:', { token: !!token }); }
    // No session token; return 401
    if (!token) {
      if (AUTH_DEBUG_MODE) { logApi.info('No session token provided'); }
      return res.status(401).json({ error: 'No session token provided' });
    }

    // Decode session token
    const decoded = jwt.verify(token, config.jwt.secret);
    if (AUTH_DEBUG_MODE) { logApi.info('Decoded token:', { decoded }); }

    // Get wallet address from decoded token
    const walletAddress = decoded.wallet_address;
    if (!walletAddress) {
      // Invalid session token; return 401
      logApi.info('Invalid session token');
      return res.status(401).json({ error: 'Invalid session token' });
    }

    // Search for user in database
    const user = await prisma.users.findUnique({
      where: {
        wallet_address: walletAddress
      }
    });
    // Log user query result
    if (AUTH_DEBUG_MODE) { logApi.info('User query result:', { user }); }

    // User not found; return 401
    if (!user) {
      logApi.info('User not found');
      return res.status(401).json({ error: 'User not found' });
    }

    // User found; attach user info to request
    req.user = user;
    // Continue to next middleware
    next();
  } catch (error) {
    // Error; return 401
    logApi.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Invalid session token' });
  }
};

// For admin-or-above endpoints
export const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    // User is neither admin nor superadmin; return 403
    if (AUTH_DEBUG_MODE) { logApi.info('User is not admin or superadmin'); }
    return res.status(403).json({ error: 'Requires admin access' });
  }
  // User is admin or superadmin; continue
  next();
};

// For superadmin-only endpoints
export const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    // User is not superadmin; return 403
    if (AUTH_DEBUG_MODE) { logApi.info('User is not superadmin'); }
    return res.status(403).json({ error: 'Requires superadmin access' });
  }
  // User is superadmin; continue
  next();
};
