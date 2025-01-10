// /config/middleware.js
import cors from 'cors';
import express from 'express';
import { logApi } from '../utils/logger-suite/logger.js';

export function configureMiddleware(app) {
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
      logApi.info(`${req.method} ${req.url}`);
      next();
    });
  }
  // Request logging in production
  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      logApi.info(`${req.method} ${req.url}`);
      next();
    });
  }

}