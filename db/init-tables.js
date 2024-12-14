import { pool } from '../config/pg-database.js';
import { readFile } from 'fs/promises';
import logger from '../utils/logger.js';
import { seedData } from './seed.js';

export async function initTables({ seed = false } = {}) { // Optional seeding
  try {
    // Initialize the database schema
    const schemaSql = await readFile(new URL('./schema.sql', import.meta.url), 'utf-8');
    await pool.query(schemaSql);
    logger.info('Database schema initialized successfully');

    // Optionally seed the database
    if (seed) {
      await seedData();
      logger.info('Database seeded successfully');
    }
  } catch (error) {
    logger.error('Error initializing database schema:', error);
    throw error;
  }
}
