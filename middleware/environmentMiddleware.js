import { config } from '../config/config.js';

export const environmentMiddleware = (req, res, next) => {
  // Get environment from request origin
  const environment = config.getEnvironment(req.headers.origin);
  
  // Set environment on request object
  req.environment = environment;
  
  // Debug logging
  if (config.debug === 'true') {
    console.log(`[Environment Middleware] Origin: ${req.headers.origin}, Environment: ${environment}`);
  }
  
  next();
}; 
