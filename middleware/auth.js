// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';

const AUTH_DEBUG_MODE = config.debug_mode;

// For authenticated endpoints
export const requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies.session;
    if (AUTH_DEBUG_MODE === 'true' || AUTH_DEBUG_MODE === true) { logApi.info('Session token:', { token: !!token }); }

    if (!token) {
      if (AUTH_DEBUG_MODE === 'true' || AUTH_DEBUG_MODE === true) { logApi.info('No session token provided'); }
      return res.status(401).json({ error: 'No session token provided' });
    }

    const decoded = jwt.verify(token, config.jwt.secret);
    if (AUTH_DEBUG_MODE === 'true' || AUTH_DEBUG_MODE === true) { logApi.info('Decoded token:', { decoded }); }

    const walletAddress = decoded.wallet_address;
    if (!walletAddress) {
      if (AUTH_DEBUG_MODE === 'true' || AUTH_DEBUG_MODE === true) { logApi.info('Invalid session token'); }
      return res.status(401).json({ error: 'Invalid session token' });
    }

    // Get user from database
    const user = await prisma.users.findUnique({
      where: {
        wallet_address: walletAddress
      }
    });
    if (AUTH_DEBUG_MODE === 'true' || AUTH_DEBUG_MODE === true) { logApi.info('User query result:', { user }); }

    if (!user) {
      if (AUTH_DEBUG_MODE === 'true' || AUTH_DEBUG_MODE === true) { logApi.info('User not found'); }
      return res.status(401).json({ error: 'User not found' });
    }

    // Attach user info to request
    req.user = user;
    next();
  } catch (error) {
    if (AUTH_DEBUG_MODE === 'true' || AUTH_DEBUG_MODE === true) { logApi.error('Auth middleware error:', error); }  
    return res.status(401).json({ error: 'Invalid session token' });
  }
};

// For admin/superadmin-only endpoints
export const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    if (AUTH_DEBUG_MODE === 'true' || AUTH_DEBUG_MODE === true) { logApi.info('User is not admin or superadmin'); }
    return res.status(403).json({ error: 'Requires admin access' });
  }
  next();
};

// For superadmin-only endpoints
export const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    if (AUTH_DEBUG_MODE === 'true' || AUTH_DEBUG_MODE === true) { logApi.info('User is not superadmin'); }
    return res.status(403).json({ error: 'Requires superadmin access' });
  }
  next();
};
