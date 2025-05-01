// config/prisma.js

/**
 * @description This file is responsible for initializing the singleton Prisma client.
 * It is used to connect to the database and perform CRUD operations. * 
 * 
 * @author BranchManager69
 * @version 1.9.0
 * @created 2025-01-14
 * @updated 2025-05-01
 */

// Logger
import { logApi } from '../utils/logger-suite/logger.js';
// Prisma
import { PrismaClient } from '@prisma/client';
import { withOptimize } from "@prisma/extension-optimize"; // new Optimize extension
import './database-env.js';  // This must be imported before creating PrismaClient

// Config
import config from '../config/config.js';
const OPTIMIZE_API_KEY = config.api_keys.optimize;

// Create the base Prisma client first
const basePrisma = new PrismaClient({
  log: [
    // Removed query logging to reduce noise
    // { level: 'query', emit: 'event' },
    { level: 'info',  emit: 'event' },
    { level: 'warn',  emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

// Register event listeners on the base client
// No longer logging every query to reduce noise
// basePrisma.$on('query', e => logApi.debug('Query:', e));
basePrisma.$on('info',  e => logApi.info('Info:', e));
basePrisma.$on('warn',  e => logApi.warn('Warning:', e));
basePrisma.$on('error', e => logApi.error('Error:', e));

// Then extend it with Optimize
const prisma = basePrisma.$extends(withOptimize({
  apiKey: OPTIMIZE_API_KEY,
  // We can still control Optimize's own logging if we want:
  log: ['warn', 'error'],
  errorFormat: 'pretty',
}))

// DegenDuel Prisma client singleton
export { prisma };
export default prisma;