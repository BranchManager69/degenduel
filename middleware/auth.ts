import { verify } from 'jsonwebtoken';
import { config } from '../config/config';

export const requireAuth = (req, res, next) => {
  const token = req.cookies.session;

  if (!token) {
    return res.status(401).json({ 
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  try {
    const decoded = verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ 
      error: 'Invalid session',
      code: 'INVALID_SESSION'
    });
  }
};