import cors from 'cors';
import helmet from 'helmet';
import express from 'express';
import logger from '../../utils/logger.js';
import { CORS_CONFIG } from './constants.js';

export function configureMiddleware(app) {
  // Security headers
  app.use(helmet());

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
  const corsOptions = {
    origin: '*',  // Allow all origins for testing purposes
    methods: ['GET', 'POST', 'PUT', 'DELETE'],  // Adjust as needed
    allowedHeaders: ['Content-Type', 'Authorization'],
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