// config/middleware.js

import express from 'express';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from './config.js';
import helmet from 'helmet';
import { environmentMiddleware } from '../middleware/environmentMiddleware.js';
import { restrictDevAccess } from '../middleware/devAccessMiddleware.js';

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
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: [
          "'self'", 
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
  }));

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
        logApi.info(`${req.method} ${req.url}`, {
          environment: req.environment,
          origin: req.headers.origin,
          ip: req.ip,
          userAgent: req.headers['user-agent']
        });
      }
      next();
    });
  }
}