import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';

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
    logApi.info(`[Environment Middleware] Origin: ${req.headers.origin}, NODE_ENV: ${config.services.active_profile}, Environment: ${environment}, Port: ${config.port}`, { environment });
  }
  
  next();
}; 
