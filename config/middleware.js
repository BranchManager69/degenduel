// config/middleware.js

import express from 'express';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from './config.js';
import helmet from 'helmet';
import { environmentMiddleware } from '../middleware/environmentMiddleware.js';

// Game origin
const gameOrigin = config.api_urls.game;

// Middleware debug mode // TODO: temp hard override
////const MIDDLEWARE_DEBUG_MODE = config.debug_modes.middleware;
const MIDDLEWARE_DEBUG_MODE = false;

// Master middleware config
export function configureMiddleware(app) {  

  // Allowed origins (CORS) - HTTPS only
  const allowedOrigins = [
    'https://degenduel.me', 
    'https://api.degenduel.me',
    'https://data.degenduel.me', 
    'https://game.degenduel.me',
    'https://dev.degenduel.me',
    'https://manager.degenduel.me',
    'https://wallets.degenduel.me',
    'https://branch.bet', 
    'https://app.branch.bet'
  ];

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // Serve static files from uploads directory
  app.use('/uploads', express.static('uploads'));
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
          'wss://api.degenduel.me', 
          'wss://game.degenduel.me',
          'wss://manager.degenduel.me',
          'wss://wallets.degenduel.me',
          'wss://branch.bet',
          'wss://app.branch.bet',
          'wss://data.degenduel.me',
          'wss://dev.degenduel.me',
          'https://degenduel.me', 
          'https://admin.degenduel.me',
          'https://api.degenduel.me', 
          'https://game.degenduel.me',
          'https://manager.degenduel.me',
          'https://wallets.degenduel.me',
          'https://branch.bet',
          'https://app.branch.bet',
          'https://data.degenduel.me',
          'https://dev.degenduel.me'
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
  app.use(['/amm-sim', '/api-playground', '/superadmin-dashboard'], requireAuth, requireSuperAdmin, (req, res, next) => {
    next();
  });

  // Admin auth required
  app.use(['/admin-dashboard'], requireAuth, requireAdmin, (req, res, next) => {
    next();
  });

  // User auth required
  app.use(['/profile'], requireAuth, (req, res, next) => {
    next();
  });

  // Log requests
  if (config.debug_mode === 'true') {
    app.use((req, res, next) => {
      if (MIDDLEWARE_DEBUG_MODE) {
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