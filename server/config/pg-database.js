import pg from 'pg';
import dotenv from 'dotenv';
import logger from './logger.js';
import { initTables } from './init-tables.js';

dotenv.config();

export const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});

// debug listeners
pool.on('connect', () => {
  logger.info('PostgreSQL connected successfully');
});

pool.on('error', (err) => {
  logger.error('PostgreSQL connection error:', err);
});

export async function initPgDatabase() {
  try {
    // Create all initially-required tables if they don't already exist
    await initTables();
    logger.info('PostgreSQL database initialized successfully');
  } catch (error) {
    logger.error('PostgreSQL database initialization failed:', error);
    throw error;
  }
}

export async function closePgDatabase() {
  try {
    await pool.end();
    logger.info('PostgreSQL database connection closed');
  } catch (error) {
    logger.error('Error closing PostgreSQL database:', error);
    throw error;
  }
}
