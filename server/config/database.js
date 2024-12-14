import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../../utils/logger.js';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DB_PATH 
  ? dirname(process.env.DB_PATH)
  : join(__dirname, '..', 'data');
const dbPath = process.env.DB_PATH || join(DATA_DIR, 'leaderboard.db');

let db;

export function initDatabase() {
  return new Promise((resolve, reject) => {
    try {
      // Ensure data directory exists
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      // Set proper permissions for production
      if (process.env.NODE_ENV === 'production') {
        try {
          fs.chmodSync(DATA_DIR, 0o755);
          if (fs.existsSync(dbPath)) {
            fs.chmodSync(dbPath, 0o644);
          }
        } catch (err) {
          logger.warn('Could not set permissions:', err);
        }
      }

      db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
          logger.error('Failed to open database:', err);
          reject(err);
          return;
        }

        db.run('PRAGMA journal_mode = WAL');
        db.run('PRAGMA busy_timeout = 5000');
        
        db.serialize(() => {
          // Create the table with proper indices
          db.run(`
            CREATE TABLE IF NOT EXISTS leaderboard (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              finalValue REAL NOT NULL,
              returnPercentage REAL NOT NULL,
              bestToken TEXT NOT NULL,
              bestTokenReturn REAL,
              timestamp INTEGER NOT NULL
            )
          `);

          // Create index for faster sorting
          db.run(`
            CREATE INDEX IF NOT EXISTS idx_leaderboard_score 
            ON leaderboard(returnPercentage DESC)
          `);

          logger.info('Database initialized successfully at ' + dbPath);
          resolve(db);
        });
      });
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      reject(error);
    }
  });
}

export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) {
          logger.error('Error closing database:', err);
          reject(err);
          return;
        }
        db = null;
        logger.info('Database connection closed');
        resolve();
      });
    } else {
      resolve();
    }
  });
}