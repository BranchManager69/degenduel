import { config } from '../config/config.js';

export const environmentMiddleware = (req, res, next) => {
  // Get environment from request origin
  const environment = config.getEnvironment(req.headers.origin);
  
  // Set environment on request object
  req.environment = environment;
  
  // Add environment to request logger context
  if (req.log && typeof req.log.child === 'function') {
    req.log = req.log.child({ environment });
  }
  
  // Debug logging - expanded to include NODE_ENV
  if (config.debug_mode === 'true' || config.debug_modes.middleware === 'true') {
    console.log(`[Environment Middleware] Origin: ${req.headers.origin}, NODE_ENV: ${process.env.NODE_ENV}, Environment: ${environment}, Port: ${process.env.PORT}`);
  }
  
  next();
}; 
