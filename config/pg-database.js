import pg from 'pg';
import dotenv from 'dotenv';
import logger from '../utils/logger.js'; // unique
import { initTables } from '../db/init-tables.js'; // unique

dotenv.config();

export const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: parseInt(process.env.DB_PORT || '5432'),
});

// Debug listeners
pool.on('connect', () => logger.info('PostgreSQL connected successfully'));
pool.on('error', (err) => logger.error('PostgreSQL connection error:', err));

/**
 * Initialize the PostgreSQL database
 */
export async function initPgDatabase() {
  try {
    logger.info('Initializing PostgreSQL database...');
    await initTables(); // Create tables and seed the database
    logger.info('PostgreSQL database initialized successfully');
  } catch (error) {
    logger.error('PostgreSQL initialization failed:', error);
    throw error;
  }
}

/**
 * Close the PostgreSQL connection pool
 */
export async function closePgDatabase() {
  try {
    await pool.end();
    logger.info('PostgreSQL database connection closed');
  } catch (error) {
    logger.error('Error closing PostgreSQL database:', error);
    throw error;
  }
}