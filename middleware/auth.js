// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { pool } from '../config/pg-database.js';
import { logApi } from '../utils/logger-suite/logger.js';

// For authenticated endpoints
export const requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies.session;
    if (!token) {
      logApi.warn('No session token provided');
      return res.status(401).json({ 
        error: 'Cookie authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    // 1) Verify JWT
    const decoded = jwt.verify(token, config.jwt.secret);
    const walletAddress = decoded.wallet;

    // 2) Fetch user from DB to get the *latest* role
    const { rows } = await pool.query(
      'SELECT wallet_address, role FROM users WHERE wallet_address = $1',
      [walletAddress]
    );
    if (rows.length === 0) {
      logApi.warn(`No user found in DB for wallet=${walletAddress}`);
      return res.status(401).json({ error: 'User not found' });
    }

    const dbUser = rows[0];

    // 3) Attach user info to req
    req.user = {
      wallet_address: dbUser.wallet_address,
      role: dbUser.role
    };

    logApi.info(`User authenticated: ${req.user.wallet_address} (role=${req.user.role})`);
    next();
  } catch (error) {
    logApi.error(`User authentication failed: ${error.message}`);
    return res.status(401).json({
      error: 'Invalid or expired session',
      code: 'INVALID_SESSION'
    });
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
