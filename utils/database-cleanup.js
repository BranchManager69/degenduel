/**
 * Database Cleanup Utilities
 * 
 * This file contains utilities for gracefully cleaning up database connections
 * with proper timeout handling and error management.
 */

import { closeDatabase } from "../config/database.js"; // SQLite
import { closePgDatabase } from "../config/pg-database.js"; // PostgreSQL
import prisma from "../config/prisma.js"; // Prisma
import { logApi } from "./logger-suite/logger.js";
import { fancyColors } from './colors.js';

/**
 * Timeout promise creator for database operations
 * 
 * @param {string} name - Name of the database connection
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise} - A promise that rejects after timeoutMs
 */
function createTimeoutPromise(name, timeoutMs) {
  return new Promise((_, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Database ${name} cleanup timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    // Don't keep process alive due to timeout
    timeout.unref();
  });
}

/**
 * Close a database connection with timeout handling
 * 
 * @param {string} name - Database name for logging
 * @param {Function} closeFunction - Function to close the database
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} - Result object with status and details
 */
async function closeWithTimeout(name, closeFunction, timeoutMs = 5000) {
  try {
    const startTime = Date.now();
    
    // Execute close with timeout protection
    await Promise.race([
      closeFunction(),
      createTimeoutPromise(name, timeoutMs)
    ]);
    
    const duration = Date.now() - startTime;
    logApi.info(`Database connection closed: ${name} (${duration}ms)`);
    
    return {
      name,
      status: 'success',
      duration
    };
  } catch (error) {
    logApi.error(`Error closing ${name} database:`, error);
    
    return {
      name,
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Close all database connections with detailed reporting
 * 
 * @returns {Promise<Object>} - Detailed results of all database closure operations
 */
export async function cleanupAllDatabases() {
  logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} DB CLEANUP ${fancyColors.RESET} Starting database cleanup`);
  
  const startTime = Date.now();
  
  const results = await Promise.allSettled([
    closeWithTimeout('SQLite', closeDatabase),
    closeWithTimeout('PostgreSQL', closePgDatabase),
    closeWithTimeout('Prisma', async () => await prisma.$disconnect())
  ]);
  
  // Process results
  const successful = results.filter(r => 
    r.status === 'fulfilled' && r.value.status === 'success'
  ).length;
  
  const failed = results.filter(r => 
    r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'error')
  ).length;
  
  const totalTime = Date.now() - startTime;
  
  // Log detailed results
  if (failed === 0) {
    logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} DB CLEANUP ${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SUCCESS ${fancyColors.RESET} All database connections closed successfully (${totalTime}ms)`);
  } else {
    logApi.warn(`${fancyColors.BG_BLUE}${fancyColors.WHITE} DB CLEANUP ${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} WARNING ${fancyColors.RESET} Database cleanup: ${successful} succeeded, ${failed} failed (${totalTime}ms)`);
    
    // Log specific failures
    results.forEach(r => {
      if (r.status === 'rejected') {
        logApi.error(`${fancyColors.BG_BLUE}${fancyColors.WHITE} DB CLEANUP ${fancyColors.RESET} ${fancyColors.RED}Error: ${r.reason}${fancyColors.RESET}`);
      } else if (r.value.status === 'error') {
        logApi.error(`${fancyColors.BG_BLUE}${fancyColors.WHITE} DB CLEANUP ${fancyColors.RESET} ${fancyColors.RED}Error closing ${r.value.name}: ${r.value.error}${fancyColors.RESET}`);
      }
    });
  }
  
  return {
    success: failed === 0,
    successful,
    failed,
    totalTimeMs: totalTime,
    details: results.map(r => {
      if (r.status === 'rejected') {
        return { name: 'unknown', status: 'error', error: r.reason };
      }
      return r.value;
    })
  };
}

export default {
  cleanupAllDatabases
}; 