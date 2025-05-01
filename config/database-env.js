// config/database-env.js

/**
 * @description This file is responsible for setting the database URL based on the environment.
 * 
 * Currently, we use prod database in production and development environments.
 * There is no dev database yet.
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-01
 */

import dotenv from 'dotenv';

dotenv.config();

// ——————————————————————————————
// Production: uncommented, always in effect
// ——————————————————————————————
if (!process.env.DATABASE_URL_PROD) {
  throw new Error('DATABASE_URL_PROD is required in production environment');
}
process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;

// ——————————————————————————————
// Development: commented out, for future use
// —————————————————————————————~
// /*
// if (!process.env.DATABASE_URL) {
//   throw new Error('DATABASE_URL is required in development environment');
// }
// process.env.DATABASE_URL = process.env.DATABASE_URL;
// */

export default {
  databaseUrl: process.env.DATABASE_URL,
  environment: process.env.NODE_ENV || 'production',
};


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