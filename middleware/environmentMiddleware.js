import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';

// Cache to track which origins we've already logged
const seenOrigins = new Set();

export const environmentMiddleware = (req, res, next) => {
  // Get environment from request origin
  const environment = config.getEnvironment(req.headers.origin);
  
  // Set environment on request object
  req.environment = environment;
  
  // Add environment to request logger context
  if (req.log && typeof req.log.child === 'function') {
    req.log = req.log.child({ environment });
  }
  
  // Format origin for logging - identify internal requests
  let formattedOrigin;
  if (!req.headers.origin) {
    // Try to identify internal service calls
    const path = req.originalUrl || req.url || 'unknown';
    const method = req.method || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Determine if this is likely an internal service call
    if (
      path.includes('/api/status') || 
      path.includes('/health') || 
      path.includes('/api/v69') ||
      userAgent.includes('node-fetch') ||
      userAgent.includes('axios')
    ) {
      formattedOrigin = `${fancyColors.DARK_CYAN}[INTERNAL SERVICE]${fancyColors.RESET} ${method} ${path}`;
    } else {
      formattedOrigin = `${fancyColors.LIGHT_GRAY}[undefined]${fancyColors.RESET} ${method} ${path}`;
    }
  } else {
    formattedOrigin = req.headers.origin;
  }
  
  // Create a unique key for this request type to avoid duplicate logs
  const requestKey = `${formattedOrigin}|${environment}|${config.services.active_profile}`;
  
  // Debug logging - expanded to include NODE_ENV
  // Only log if:
  // 1. Debug mode is enabled, OR
  // 2. We haven't seen this origin before, OR
  // 3. This is the first request in this session
  if (
    config.debug_mode === 'true' || 
    config.debug_modes.middleware === 'true' ||
    !seenOrigins.has(requestKey) ||
    seenOrigins.size === 0
  ) {
    logApi.info(
      `[Environment Middleware] Origin: ${formattedOrigin}, NODE_ENV: ${config.services.active_profile}, Environment: ${environment}, Port: ${config.port}`, 
      { 
        environment,
        origin: req.headers.origin || 'internal',
        path: req.originalUrl || req.url,
        method: req.method
      }
    );
    
    // Add to seen origins
    seenOrigins.add(requestKey);
    
    // Prevent the set from growing too large over time
    if (seenOrigins.size > 100) {
      seenOrigins.clear();
    }
  }
  
  next();
}; 
