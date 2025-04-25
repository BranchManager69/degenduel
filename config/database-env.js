/*

import dotenv from 'dotenv';
import { logApi } from '../utils/logger-suite/logger.js';

dotenv.config();

// Set DATABASE_URL based on environment
if (process.env.NODE_ENV === 'production') {
    if (!process.env.DATABASE_URL_PROD) {
        throw new Error('DATABASE_URL_PROD is required in production environment');
    }
    process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
    logApi.info('Using production database');
} else {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required in development environment');
    }
    logApi.info('Using development database');
}

export default {
    databaseUrl: process.env.DATABASE_URL,
    environment: process.env.NODE_ENV || 'development'
}; 

*/