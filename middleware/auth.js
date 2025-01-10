// /middleware/auth.js
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite';

// (I cannot find where, if anywhere, this is being used)
export const requireAuth = (req, res, next) => {
  const token = req.cookies.session;
  if (!token) {
    logApi.warn('No session token provided');
    return res.status(401).json({ 
      error: 'Cookie authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    // Transform the decoded token to match our expected structure
    req.user = {
        wallet_address: decoded.wallet,  // Map 'wallet' to 'wallet_address'
        timestamp: decoded.timestamp,
        iat: decoded.iat,
        exp: decoded.exp
    };
    logApi.info(`User authenticated: ${req.user.wallet_address}`);
    next();
  } catch (error) {
    logApi.error(`User authentication failed: ${error.message}`);
    res.status(401).json({ 
        error: 'Invalid session',
        code: 'INVALID_SESSION'
    });
  }
};

// Add this right after our existing requireAuth middleware
// (unusued for now)
const postAuthDebug = (req, res, next) => {
  console.log('\n🔍 ==== Post-Auth Debug ====');
  console.log('👤 req.user:', req.user);
  console.log('🛣️ Moving to route handler');
  next();
};