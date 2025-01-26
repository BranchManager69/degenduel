import { logApi } from '../utils/logger-suite/logger.js';
import prisma from './prisma.js';

// Export prisma client as pool for compatibility
export const pool = prisma;

/**
 * Initialize new PostgreSQL database and seed tables
 */
export async function initPgDatabase() {
  try {
    logApi.info('Initializing PostgreSQL database...');
    await prisma.$connect();
    logApi.info('PostgreSQL database initialized successfully');
  } catch (error) {
    logApi.error('PostgreSQL initialization failed:', error);
    throw error;
  }
}

/**
 * Close the PostgreSQL connection pool
 */
export async function closePgDatabase() {
  try {
    await prisma.$disconnect();
    logApi.info('PostgreSQL connection closed');
  } catch (error) {
    logApi.error('Failed to close PostgreSQL connection:', error);
    throw error;
  }
}

export default {
  pool,
  initPgDatabase,
  closePgDatabase
};