// /config/middleware.js
import cors from 'cors';
////import helmet from 'helmet';
import express from 'express';
import logger from '../utils/logger.js'; // unique

export function configureMiddleware(app) {
  // Security headers
  ////app.use(helmet());

  // CORS configuration
  /* 
  const corsOptions = {
    origin: process.env.NODE_ENV === 'production'
      ? CORS_CONFIG.ALLOWED_ORIGINS.production
      : CORS_CONFIG.ALLOWED_ORIGINS.development,
    methods: CORS_CONFIG.METHODS,
    allowedHeaders: CORS_CONFIG.ALLOWED_HEADERS,
    maxAge: CORS_CONFIG.MAX_AGE
  }; 
  */
  const allowedOrigins = [
    'http://localhost:3000', 
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003', 
    'http://localhost:3004', 
    'https://degenduel.me', 
    'https://data.degenduel.me', 
    'https://dev.degenduel.me',
    'https://branch.bet', 
    'https://app.branch.bet',
  ];
  const corsOptions = {
    origin: (origin, callback) => {
      if (allowedOrigins.includes(origin) || !origin) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,  // <-- RE-ENABLE THIS
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With', 'Cache-Control', 'X-Wallet-Address'],
    maxAge: 86400
  };
  
  
  app.use(cors(corsOptions));
  
  // Body parsing
  app.use(express.json());
  
  // Request logging in development
  if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
      logger.info(`${req.method} ${req.url}`);
      next();
    });
  }
}