// config/prisma.js

/**
 * 
 * @description This file is responsible for initializing the singleton Prisma client.
 * It is used to connect to the database and perform CRUD operations. * 
 * 
 */

import { PrismaClient } from '@prisma/client';
import './database-env.js';  // This must be imported before creating PrismaClient
import { logApi } from '../utils/logger-suite/logger.js';

// Initialize the Prisma client
const prisma = new PrismaClient({
  log: ['error', 'warn'],
  errorFormat: 'pretty',
});

// Log all queries
prisma.$on('query', (e) => {
  logApi.debug('Query:', e);
});

// Log all errors
prisma.$on('error', (e) => {
  logApi.error('Prisma Error:', e);
});

// Log all info
prisma.$on('info', (e) => {
  logApi.info('Prisma Info:', e);
});

// Log all warnings
prisma.$on('warn', (e) => {
  logApi.warn('Prisma Warning:', e);
});

export default prisma; 