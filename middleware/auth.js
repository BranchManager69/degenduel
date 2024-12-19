import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

export const requireAuth = (req, res, next) => {
  const token = req.cookies.session;

  if (!token) {
    return res.status(401).json({ 
      error: 'Cookie authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    // Transform the decoded token to match your expected structure
    req.user = {
        wallet_address: decoded.wallet,  // Map 'wallet' to 'wallet_address'
        timestamp: decoded.timestamp,
        iat: decoded.iat,
        exp: decoded.exp
    };
    next();
  } catch (error) {
    res.status(401).json({ 
        error: 'Invalid session',
        code: 'INVALID_SESSION'
    });
  }
};

// Add this right after your existing requireAuth middleware
const postAuthDebug = (req, res, next) => {
  console.log('\n🔍 ==== Post-Auth Debug ====');
  console.log('👤 req.user:', req.user);
  console.log('🛣️ Moving to route handler');
  next();
};