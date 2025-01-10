import dotenv from 'dotenv';
import pg from 'pg';
import { initTables } from '../db/recreation-and-seeding/init-tables.js';
import { logApi } from '../utils/logger-suite/logger.js'; // New DD Logging System

dotenv.config();

export const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: parseInt(process.env.DB_PORT || '5432'),
});

pool.on('connect', () => logApi.info('PostgreSQL connected successfully'));
pool.on('error', (err) => logApi.error('PostgreSQL connection error:', err));

/**
 * Initialize new PostgreSQL database and seed tables
 */
export async function initPgDatabase() {
  try {
    logApi.info('Initializing PostgreSQL database...');
    await initTables(); // Create tables and seed the database
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
    await pool.end();
    logApi.info('PostgreSQL database connection closed');
  } catch (error) {
    logApi.error('Error closing PostgreSQL database:', error);
    throw error;
  }
}