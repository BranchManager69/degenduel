// config/middleware.js

import express from 'express';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from './config.js';
import helmet from 'helmet';
import { environmentMiddleware } from '../middleware/environmentMiddleware.js';
import { restrictDevAccess } from '../middleware/devAccessMiddleware.js';
import { websocketBypassMiddleware } from '../middleware/debugMiddleware.js';
import { fancyColors } from '../utils/colors.js';

// Load from config
const LOG_EVERY_REQUEST = config.logging.request_logging !== false;

// Whether to use verbose logging
const VERBOSE_LOGGING = config.logging.verbose === true;

// Middleware debug mode
const MIDDLEWARE_DEBUG_MODE = false;

// Game origin
const gameOrigin = config.api_urls.game;
const lobbyOrigin = config.api_urls.lobby;
const reflectionsOrigin = config.api_urls.reflections;

// Master middleware config
export function configureMiddleware(app) {  
  // ENHANCED WEBSOCKET BYPASS: Add the dedicated WebSocket bypass middleware first
  // This ensures all WebSocket requests preserve their headers and bypass problematic middleware
  app.use(websocketBypassMiddleware);
  
  // Add a second layer of WebSocket detection at the HTTP server level
  // This catches any requests that might have been missed by the bypass middleware
  app.use((req, res, next) => {
    // Check if this is a WebSocket upgrade request that wasn't caught by the bypass
    if (!req._isWebSocketRequest && req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
      logApi.info(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS-SECONDARY-BYPASS ${fancyColors.RESET} WebSocket upgrade request detected in secondary layer: ${req.url}`, {
        headers: req.headers,
        url: req.url,
        _highlight: true
      });
      
      // Mark as WebSocket request
      req._isWebSocketRequest = true;
    }
    
    // If this is a WebSocket request detected by either layer, add a response
    // header to indicate it's been properly bypassed
    if (req._isWebSocketRequest) {
      res.setHeader('X-WebSocket-Bypass', 'true');
    }
    
    // Continue with next middleware
    next();
  });

  // Allowed origins (CORS) - HTTPS only, plus localhost for development
  const allowedOrigins = [
    'https://degenduel.me', 
    'https://data.degenduel.me', 
    'https://talk.degenduel.me',
    'https://game.degenduel.me',
    'https://dev.degenduel.me',
    'https://manager.degenduel.me',
    'https://wallets.degenduel.me',
    'https://reflections.degenduel.me',
    'https://lobby.degenduel.me',
    'https://branch.bet', 
    'https://app.branch.bet',
    // Development origins
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
    'http://localhost:3004',
    'http://localhost:3005',
    'http://localhost:3006',
    'http://localhost:3007',
    'http://localhost:3008',
    'http://localhost:3009',
    'http://localhost:3010',
    'http://localhost:3011',
    'http://localhost:3012',
    'http://localhost:3013',
    'http://localhost:3014',
    'http://localhost:3015',
    'http://localhost:4173',
    'http://localhost:5000',
    'http://localhost:5001',
    'http://localhost:6000',
    'http://localhost:6001',
    'http://localhost:56347'
  ];

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Apply dev access restriction middleware early in the pipeline
  // This will restrict access to the dev subdomain to only authorized users
  app.use(restrictDevAccess);
  
  // Serve static files from uploads directory
  app.use('/uploads', express.static('uploads')); // TODO: ???

  // Environment middleware
  app.use(environmentMiddleware);

  // CORS middleware for all routes
  app.use((req, res, next) => {
    let origin = req.headers.origin;
    
    // If no origin but has referer, extract origin from referer
    if (!origin && req.headers.referer) {
      try {
        const url = new URL(req.headers.referer);
        origin = url.origin;
      } catch (error) {
        logApi.warn('⚠️ Invalid referer URL:', req.headers.referer);
      }
    }

    // If still no origin, try to extract from host header
    if (!origin && req.headers.host) {
      const protocol = req.secure ? 'https' : 'http';
      origin = `${protocol}://${req.headers.host}`;
    }
    
    // Detailed request logging
    if (MIDDLEWARE_DEBUG_MODE) {
      logApi.info('🔍 CORS Request Details:', {
        origin,
        referer: req.headers.referer,
        method: req.method,
        path: req.path,
        headers: req.headers,
        url: req.url,
        originalUrl: req.originalUrl,
        timestamp: new Date().toISOString()
      });
    }

    // Log origin check
    if (MIDDLEWARE_DEBUG_MODE) {
      if (!origin) {
        logApi.warn('⚠️⚠️ No origin or referer in request');
      } else {
        logApi.info(`🔎🔎 Checking origin: ${origin}`);
        logApi.info(`📋📋 Allowed origins:`, allowedOrigins);
        logApi.info(`✓✓ Is origin allowed? ${allowedOrigins.includes(origin)}`);
      }
    }

    // game.degenduel.me
    if (origin === gameOrigin || origin?.startsWith(gameOrigin)) {
      if (MIDDLEWARE_DEBUG_MODE) {
        logApi.info(`📝 Setting CORS headers for ${gameOrigin}`);
      }
      // Set special CORS headers for game.degenduel.me
      res.setHeader('Access-Control-Allow-Origin', gameOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Cache-Control,X-Wallet-Address,Accept,Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    // Also set headers for other allowed origins
    else if (origin && allowedOrigins.includes(origin)) {
      if (MIDDLEWARE_DEBUG_MODE) {
        logApi.info(`📝 Setting CORS headers for ${origin}`);
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Cache-Control,X-Wallet-Address,Accept,Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
    } else {
      logApi.warn(`❌ Origin not allowed: ${origin}`);
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      if (MIDDLEWARE_DEBUG_MODE) {
        logApi.info('👉 Handling OPTIONS preflight request');
      }
      return res.status(204).end();
    }

    next();
  });

  // Security middleware - after CORS
  // IMPORTANT: MODIFIED HELMET CONFIG FOR WEBSOCKETS
  // First add a check to completely bypass Helmet for WebSocket requests
  app.use((req, res, next) => {
    // Super aggressive WebSocket detection to bypass Helmet entirely
    if (
      // Check standard WebSocket headers
      (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') ||
      // Check for WebSocket URL patterns
      req.url.includes('/ws/') || 
      req.url.includes('/socket') ||
      req.url.includes('/websocket') ||
      // Check for the flag set by bypass middleware
      req._isWebSocketRequest === true
    ) {
      // Log the Helmet bypass for debugging
      logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} HELMET BYPASS ${fancyColors.RESET} Bypassing Helmet for WebSocket request: ${req.url}`, {
        url: req.url,
        headers: {
          upgrade: req.headers.upgrade,
          connection: req.headers.connection,
          'sec-websocket-key': req.headers['sec-websocket-key'] ? '(present)' : '(missing)'
        },
        _highlight: true
      });
      // Skip Helmet completely for WebSocket requests
      return next();
    }
    
    // Apply Helmet only for non-WebSocket requests
    return helmet({
      // CRITICAL: Disable Helmet entirely for WebSocket upgrade requests
      // This ensures Helmet doesn't interfere with WebSocket handshakes
      useDefaults: false, // Don't use Helmet defaults that might block WebSockets
      contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: [
          "'self'", 
          // Allow all WebSocket origins for testing
          'wss://*',
          'ws://*',
          // Specific WebSocket endpoints
          'wss://degenduel.me', 
          'wss://game.degenduel.me',
          'wss://manager.degenduel.me',
          'wss://talk.degenduel.me',
          'wss://wallets.degenduel.me',
          'wss://lobby.degenduel.me',
          'wss://branch.bet',
          'wss://app.branch.bet',
          'wss://reflections.degenduel.me',
          'wss://data.degenduel.me',
          'wss://dev.degenduel.me',
          // HTTP endpoints
          'https://degenduel.me', 
          'https://admin.degenduel.me',
          'https://game.degenduel.me',
          'https://manager.degenduel.me',
          'https://talk.degenduel.me',
          'https://wallets.degenduel.me',
          'https://lobby.degenduel.me',
          'https://branch.bet',
          'https://app.branch.bet',
          'https://data.degenduel.me',
          'https://dev.degenduel.me',
          'https://reflections.degenduel.me',
          // Development origins for HTTP
          'http://localhost:*',
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:3002',
          'http://localhost:3003',
          'http://localhost:3004',
          'http://localhost:3005',
          'http://localhost:3006',
          'http://localhost:3007',
          'http://localhost:3008',
          'http://localhost:3009',
          'http://localhost:3010',
          'http://localhost:3011',
          'http://localhost:3012',
          'http://localhost:3013',
          'http://localhost:3014',
          'http://localhost:3015',
          'http://localhost:4173',
          'http://localhost:5000',
          'http://localhost:5001',
          'http://localhost:6000',
          'http://localhost:6001',
          'http://localhost:56347',
          // Development origins for WebSockets (ws://)
          'ws://localhost:*',
          'ws://localhost:3000',
          'ws://localhost:3001',
          'ws://localhost:3002',
          'ws://localhost:3003',
          'ws://localhost:3004',
          'ws://localhost:3005',
          'ws://localhost:3006',
          'ws://localhost:3007',
          'ws://localhost:3008',
          'ws://localhost:3009',
          'ws://localhost:3010',
          'ws://localhost:3011',
          'ws://localhost:3012',
          'ws://localhost:3013',
          'ws://localhost:3014',
          'ws://localhost:3015',
          'ws://localhost:4173',
          'ws://localhost:5000',
          'ws://localhost:5001',
          'ws://localhost:6000',
          'ws://localhost:6001',
          'ws://localhost:56347'
        ],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })(req, res, next);
  });

  // Environment info
  app.use((req, res, next) => {
    req.environment = config.getEnvironment(req.headers.origin);
    next();
  });

  /* Protected Routes */

  // Superadmin auth required
  // TODO: ADD MANY MORE PROTECTED ROUTES
  app.use(['/amm-sim', '/api-playground', '/superadmin-dashboard'], requireAuth, requireSuperAdmin, (req, res, next) => {
    next();
  });

  // Admin auth required
  // TODO: ADD MANY MORE PROTECTED ROUTES
  app.use(['/admin-dashboard'], requireAuth, requireAdmin, (req, res, next) => {
    next();
  });

  // User auth required
  // TODO: ADD MORE PROTECTED ROUTES
  app.use(['/profile'], requireAuth, (req, res, next) => {
    next();
  });

  // Logs from middleware
  if (config.debug_mode === 'true' || LOG_EVERY_REQUEST) {
    app.use((req, res, next) => {
      // Skip request logging if not in verbose mode and the request is for certain routes
      const isRequestLoggingRoute = req.url.startsWith('/api/status') || 
                                  req.url.startsWith('/api/admin/maintenance') ||
                                  req.url.startsWith('/api/auth/token') ||
                                  req.url.includes('check-participation') ||
                                  req.url.includes('_t='); // Common parameter for cache busting
                                  
      const shouldLog = LOG_EVERY_REQUEST && (VERBOSE_LOGGING || !isRequestLoggingRoute);
      
      if (shouldLog) {
        // Get client IP address
        const clientIp = req.ip || 
                        req.headers['x-forwarded-for'] || 
                        req.headers['x-real-ip'] || 
                        req.connection.remoteAddress;
        
        // Log basic info immediately for performance
        logApi.info(`${req.method} ${req.url}`, {
          environment: req.environment,
          origin: req.headers.origin,
          ip: clientIp,
          userAgent: req.headers['user-agent']
        });
        
        // Then asynchronously fetch IP info if we have the API key
        // This happens after the response continues so it doesn't slow down the request
        if (config.ipinfo.api_key && clientIp) {
          // Use setTimeout to ensure this doesn't block the request
          setTimeout(async () => {
            try {
              // Use the IP info service we added to the logger
              const ipInfo = await logApi.getIpInfo(clientIp);
              if (ipInfo && !ipInfo.bogon && !ipInfo.error) {
                // Log the detailed info separately
                logApi.debug(`IP Info: ${clientIp}`, {
                  ip: clientIp,
                  path: req.url,
                  method: req.method,
                  ip_info: ipInfo,
                  city: ipInfo.city,
                  region: ipInfo.region,
                  country: ipInfo.country,
                  loc: ipInfo.loc,
                  org: ipInfo.org,
                  postal: ipInfo.postal,
                  timezone: ipInfo.timezone
                });
              }
            } catch (error) {
              logApi.error(`Failed to get IP info for ${clientIp}:`, {
                error: error.message,
                ip: clientIp
              });
            }
          }, 0);
        }
      }
      next();
    });
  }
}