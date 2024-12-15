import { pool } from '../config/pg-database.js';
import { readFile } from 'fs/promises';
import logger from '../utils/logger.js';
import { seedData } from './seed.js';

export async function initTables({ seed = false } = {}) {
  try {
    // Check if tables already exist
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'contests'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      // Initialize the database schema
      const schemaSql = await readFile(new URL('./schema.sql', import.meta.url), 'utf-8');
      
      // Execute the entire schema as one transaction
      await pool.query(schemaSql);
      logger.info('Database schema initialized successfully');
    } else {
      logger.info('Database schema already exists, skipping initialization');
    }

    if (seed) {
      await seedData();
      logger.info('Database seeded successfully');
    }
  } catch (error) {
    logger.error('Error initializing database schema:', error);
    throw error;
  }
}