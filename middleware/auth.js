// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';

// For authenticated endpoints
export const requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies.session;
    logApi.info('Session token:', { token: !!token });
    
    if (!token) {
      return res.status(401).json({ error: 'No session token provided' });
    }

    const decoded = jwt.verify(token, config.jwt.secret);
    logApi.info('Decoded token:', { decoded });

    const walletAddress = decoded.wallet_address;
    if (!walletAddress) {
      return res.status(401).json({ error: 'Invalid session token' });
    }

    // Get user from database
    const user = await prisma.users.findUnique({
      where: {
        wallet_address: walletAddress
      }
    });
    logApi.info('User query result:', { user });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Attach user info to request
    req.user = user;
    next();
  } catch (error) {
    logApi.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Invalid session token' });
  }
};

// For admin/superadmin-only endpoints
export const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Requires admin access' });
  }
  next();
};

// For superadmin-only endpoints
export const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Requires superadmin access' });
  }
  next();
};
