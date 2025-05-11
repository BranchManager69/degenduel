// config/middleware.js

import express from 'express';
import helmet from 'helmet';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { restrictDevAccess } from '../middleware/devAccessMiddleware.js';
import { environmentMiddleware } from '../middleware/environmentMiddleware.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from './config.js';
// ⛔ REMOVED: import { websocketBypassMiddleware } from '../middleware/debugMiddleware.js';
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
  // ████████████████████████████████████████████████████████████████████████████████
  // █ CRITICAL WEBSOCKET HANDLING - FIRST MIDDLEWARE - NO OTHER MIDDLEWARE BEFORE █
  // ████████████████████████████████████████████████████████████████████████████████
  
  // Universal WebSocket Detector - MUST be the first middleware in the chain
  app.use((req, res, next) => {
    // Method 1: Detect by standard WebSocket headers (most reliable)
    const hasUpgradeHeader = req.headers.upgrade?.toLowerCase() === 'websocket';
    const hasConnectionHeader = req.headers.connection?.toLowerCase()?.includes('upgrade');
    const hasWebSocketKey = !!req.headers['sec-websocket-key'];
    const hasWebSocketVersion = !!req.headers['sec-websocket-version'];
    
    // Method 2: Detect by URL pattern (fallback)
    const hasWebSocketURL = 
      req.url.includes('/api/v69/ws');
    
    // Combined detection - prioritize header evidence, fallback to URL
    const isWebSocketRequest = 
      (hasUpgradeHeader || hasConnectionHeader || hasWebSocketKey || hasWebSocketVersion) || 
      hasWebSocketURL;
    
    if (isWebSocketRequest) {
      // Flag for middleware chain to recognize WebSocket requests
      req.WEBSOCKET_REQUEST = true;
      
      // Log COMPLETE headers for WebSocket diagnostics
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WEBSOCKET ${fancyColors.RESET} ${req.url}`, {
        url: req.url,
        method: req.method,
        path: req.path,
        detection: {
          byHeaders: {
            hasUpgradeHeader,
            hasConnectionHeader,
            hasWebSocketKey,
            hasWebSocketVersion
          },
          byURL: hasWebSocketURL
        },
        allHeaders: req.headers,
        originalHeaders: {
          upgrade: req.headers.upgrade,
          connection: req.headers.connection,
          origin: req.headers.origin,
          host: req.headers.host,
          'sec-websocket-key': req.headers['sec-websocket-key'],
          'sec-websocket-version': req.headers['sec-websocket-version'],
          'sec-websocket-extensions': req.headers['sec-websocket-extensions'],
          'sec-websocket-protocol': req.headers['sec-websocket-protocol']
        }
      });
    }
    
    next();
  });

  /*******************************************************************
   * ⛔ REMOVED: Legacy websocketBypassMiddleware ⛔
   * 
   * The following line used to be here:
   * app.use(websocketBypassMiddleware);
   * 
   * This has been completely removed as the websocketBypassMiddleware
   * is deprecated and all WebSocket detection now happens in the 
   * Universal WebSocket Detector above.
   * 
   * Last active use: March 27th, 2025
   * Author of removal: Claude AI
   *******************************************************************/

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
    'https://dduel.me',
    'https://www.dduel.me',
    'https://privy.degenduel.me',
    // OAuth provider origins
    'https://twitter.com',
    'https://x.com',
    'https://api.twitter.com',
    // Local development with IP addresses
    'http://127.0.0.1:3004',
    'http://127.0.0.1:3005',
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

  // Body Parser middleware with WebSocket bypass
  app.use((req, res, next) => {
    // Skip body parsing for WebSocket requests (they don't have bodies)
    if (req.WEBSOCKET_REQUEST === true) {
      return next();
    }
    
    // For regular HTTP requests, use standard parsers
    express.json()(req, res, (err) => {
      if (err) {
        // Only log for non-WebSocket requests to reduce noise
        logApi.warn(`JSON parsing error: ${err.message}`);
      }
      
      express.urlencoded({ extended: true })(req, res, next);
    });
  });
  
  // Apply dev access restriction middleware early in the pipeline
  // This will restrict access to the dev subdomain to only authorized users
  app.use(restrictDevAccess);
  
  // Serve static files from uploads directory
  app.use('/uploads', express.static('uploads')); // TODO: ???

  // Environment middleware
  app.use(environmentMiddleware);

  // CORS middleware with WebSocket bypass and special handling for GPU server endpoints
  app.use((req, res, next) => {
    if (req.WEBSOCKET_REQUEST === true) {
      return next();
    }

    let origin = req.headers.origin;
    let derivedFrom = 'req.headers.origin';

    if (!origin && req.headers.referer) {
      try {
        const url = new URL(req.headers.referer);
        origin = url.origin;
        derivedFrom = 'req.headers.referer';
      } catch (error) {
        logApi.warn('⚠️ Invalid referer URL for CORS:', req.headers.referer);
        derivedFrom = 'referer_error';
      }
    }

    if (!origin && req.headers.host) {
      const protocol = req.secure ? 'https' : 'http';
      origin = `${protocol}://${req.headers.host}`;
      derivedFrom = 'req.headers.host';
    }
    
    logApi.info(`[CORS_DEBUG] Evaluating origin: '${origin}', Derived from: '${derivedFrom}', Path: ${req.path}, Method: ${req.method}`);

    const isOriginAllowed = (originToCheck) => {
      if (allowedOrigins.includes(originToCheck)) {
        logApi.info(`[CORS_DEBUG] Origin '${originToCheck}' IS in allowedOrigins list.`);
        return true;
      }
      if (originToCheck && (
          originToCheck.startsWith('http://localhost:') || 
          originToCheck.startsWith('http://127.0.0.1:') ||
          originToCheck.startsWith('https://localhost:') || 
          originToCheck.startsWith('https://127.0.0.1:')
      )) {
        logApi.info(`[CORS_DEBUG] Origin '${originToCheck}' IS a localhost variant.`);
        return true;
      }
      logApi.warn(`[CORS_DEBUG] Origin '${originToCheck}' NOT in allowedOrigins or localhost variants.`);
      return false;
    };

    if (origin && isOriginAllowed(origin)) {
      const existingAcao = res.getHeader('Access-Control-Allow-Origin');
      logApi.info(`[CORS_DIAGNOSTIC] Before setHeader, current ACAO: ${existingAcao}, Origin to set: '${origin}'`);
      
      res.setHeader('Access-Control-Allow-Origin', origin);
      
      const newAcao = res.getHeader('Access-Control-Allow-Origin');
      logApi.info(`[CORS_DIAGNOSTIC] After setHeader, new ACAO: ${newAcao}`);
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Cache-Control,X-Wallet-Address,Accept,Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
    } else {
      logApi.warn(`❌ Origin not allowed by BACKEND_MIDDLEWARE: '${origin}' for path: ${req.path}`);
    }

    if (req.method === 'OPTIONS') {
      logApi.info(`[CORS_DEBUG] OPTIONS request for path: ${req.path}, origin: '${origin}'. Responding 204.`);
      return res.status(204).end();
    }
    next();
  });

  // Security middleware (Helmet) with WebSocket bypass
  app.use((req, res, next) => {
    // Skip Helmet security for WebSocket requests
    if (req.WEBSOCKET_REQUEST === true) {
      return next();
    }
    
    // Apply Helmet for regular HTTP requests
    return helmet({
      useDefaults: false,
      contentSecurityPolicy: false,
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