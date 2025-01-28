// config/middleware.js
import cors from 'cors';
import express from 'express';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from './config.js';
import helmet from 'helmet';
import { environmentMiddleware } from '../middleware/environmentMiddleware.js';

export function configureMiddleware(app) {
  const allowedOrigins = [
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
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'http://localhost:5177',
    'https://degenduel.me', 
    'https://data.degenduel.me', 
    'https://game.degenduel.me',
    'https://dev.degenduel.me',
    'https://manager.degenduel.me',
    'https://wallets.degenduel.me',
    'https://branch.bet', 
    'https://app.branch.bet',
  ];

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Environment middleware
  app.use(environmentMiddleware);

  // Simple CORS middleware for all routes
  app.use((req, res, next) => {
    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '');
    
    // Detailed request logging
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

    // Log origin check
    if (!origin) {
      logApi.warn('⚠️ No origin or referer in request');
    } else {
      logApi.info(`🔎 Checking origin: ${origin}`);
      logApi.info(`📋 Allowed origins:`, allowedOrigins);
      logApi.info(`✓ Is origin allowed? ${allowedOrigins.includes(origin)}`);
    }

    // Always set CORS headers for game.degenduel.me
    const gameOrigin = 'https://game.degenduel.me';
    if (req.headers.origin === gameOrigin || req.headers.referer?.startsWith(gameOrigin)) {
      logApi.info('📝 Setting CORS headers for game domain');
      res.setHeader('Access-Control-Allow-Origin', gameOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Cache-Control,X-Wallet-Address,Accept,Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    // Also set headers for other allowed origins
    else if (origin && allowedOrigins.includes(origin)) {
      logApi.info('📝 Setting CORS headers for allowed origin:', origin);
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Cache-Control,X-Wallet-Address,Accept,Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
    } else {
      logApi.warn('❌ Origin not allowed:', origin);
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      logApi.info('👉 Handling OPTIONS preflight request');
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
          'https://api.degenduel.me', 
          'https://game.degenduel.me',
          'https://manager.degenduel.me',
          'https://wallets.degenduel.me',
          'https://branch.bet',
          'https://app.branch.bet',
          'https://data.degenduel.me',
          'https://dev.degenduel.me',
          'https://localhost:3003', 
          'https://localhost:3004',
          'https://localhost:3005',
          'https://localhost:3006',
          'https://localhost:3007',
          'https://localhost:3008',
          'https://localhost:3009',
          'https://localhost:3010',
          'https://localhost:5173',
          'https://localhost:5174',
          'https://localhost:5175',
          'https://localhost:5176',
          'https://localhost:5177'
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

  // Protected routes
  app.use(['/amm-sim', '/api-playground', '/superadmin-dashboard'], requireAuth, requireSuperAdmin, (req, res, next) => {
    next();
  });

  app.use(['/admin-dashboard'], requireAuth, requireAdmin, (req, res, next) => {
    next();
  });

  app.use(['/profile'], requireAuth, (req, res, next) => {
    next();
  });

  // Debug logging
  if (config.debug_mode === 'true') {
    app.use((req, res, next) => {
      logApi.info(`${req.method} ${req.url}`, {
        environment: req.environment,
        origin: req.headers.origin,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      next();
    });
  }
}