// config/middleware.js
import cors from 'cors';
import express from 'express';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from './config.js';

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

  app.use(cors({
    origin: function(origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = 'Nah... The DegenDuel CORS policy don\'t be allowing no access from your wack ass origin. You best be headin home now, boy...';
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Requested-With',
      'Cache-Control',
      'X-Wallet-Address'
    ],
    exposedHeaders: ['Content-Length', 'X-Wallet-Address'],
    maxAge: 86400,
  }));

  // Additional CORS headers for preflight requests
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Get origin from request
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }

    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, X-Requested-With, Cache-Control, X-Wallet-Address'
      );
      return res.status(200).json({});
    }
    next();
  });

  // Protect superadmin-only client routes
  app.use(['/amm-sim', '/api-playground', '/superadmin-dashboard'], requireAuth, requireSuperAdmin, (req, res, next) => {
    // For client-side routes, we want to serve the main index.html
    // This allows the client-side router to handle the route
    next();
  });

  // Protect admin-only client routes
  app.use(['/admin-dashboard'], requireAuth, requireAdmin, (req, res, next) => {
    next();
  });

  // Protect authenticated-only client routes
  app.use(['/profile'], requireAuth, (req, res, next) => {
    next();
  });

  // Body parsing
  app.use(express.json());

  // Unified logging for both development and production
  if (config.debug_mode === 'true') {
    app.use((req, res, next) => {
      logApi.info(`${req.method} ${req.url}`, {
        origin: req.headers.origin,
      ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      next();
    });
  } else {
    //console.log('Debug mode is disabled');
  }
}