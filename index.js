import cookieParser from 'cookie-parser';
import express from 'express';
import dotenv from 'dotenv';
import chalk from 'chalk';
import gradient from 'gradient-string';
////import http from 'http'; // HTTP server for logs
////import fs from 'fs'; // File streaming for logs
////import { WebSocketServer } from 'ws'; // WebSocket support
import { initDatabase, closeDatabase } from './config/database.js';  // SQLite for leaderboard
import { pool, initPgDatabase, closePgDatabase } from './config/pg-database.js';
import { configureMiddleware } from './config/middleware.js';
////////import { authDebugMiddleware } from './middleware/debugMiddleware.js';
import { errorHandler } from './utils/errorHandler.js';
import userRoutes from './routes/users.js';
import authRoutes from './routes/auth.js';
import contestRoutes from './routes/contests.js';
import tradeRoutes from './routes/trades.js';
import statsRoutes from './routes/stats.js';
import tokenRoutes from './routes/tokens.js'; // new
import tokenBucketRoutes from './routes/tokenBuckets.js'; // new
import leaderboardRoutes from './routes/leaderboard.js'; // almost forgot this one!
//import testRoutesV1 from './routes/test-routes.js'; // OLD v1
//import testRoutesV2 from './routes/test-utils.js'; // MID v2
//import testRoutesV3 from './routes/test-utilities.js'; // NEW NOW OLD v3
import testRoutes from './routes/test-routes.js'; // NEWEST v4
import logger from './utils/logger.js'; // fixed
import setupSwagger from './config/swagger.js'; // ES6 default import
import superadminRoutes from './routes/superadmin.js';

// Prisma routes
import prismaUserRoutes from './routes/prisma/users.js';
import prismaStatsRoutes from './routes/prisma/stats.js';
import prismaAdminRoutes from './routes/prisma/admin.js';

dotenv.config();

const app = express();

const port = process.env.API_PORT || 3003; // Main port
////const logsPort = process.env.LOGS_PORT || 3334; // Log streaming port

// Use cookies
app.use(cookieParser());

// Log startup configuration
console.log('Starting API server with config:', {
  port,
  nodeEnv: process.env.NODE_ENV,
  dbHost: process.env.DB_HOST,
  dbName: process.env.DB_NAME,
  dbUser: process.env.DB_USER,
  hasDbPassword: !!process.env.DB_PASS
});

// Set up Swagger before other routes
setupSwagger(app);

// Configure middleware
configureMiddleware(app);

// Default route
app.get('/', (req, res) => {
  res.send(`
    Welcome to the DegenDuel API!
  `);
});

// Core API routes
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contests', contestRoutes);
app.use('/api/trades', tradeRoutes);
////app.use('/api/stats', statsRoutes);
app.use('/api/tokens', tokenRoutes); // new
app.use('/api/token-buckets', tokenBucketRoutes); // new
app.use('/api/leaderboard', leaderboardRoutes); // almost forgot this one!
app.use('/api/test', testRoutes); // NEWEST; tests v4

// (testing) New Prisma routes
app.use('/api/daddy', prismaUserRoutes);
app.use('/api/stats', prismaStatsRoutes);
app.use('/api/admin', prismaAdminRoutes);

// Superadmin routes
app.use('/api/superadmin', superadminRoutes);

// Server health route
app.get('/api/health', async (req, res) => {
  try {
    // Test PostgreSQL connection
    const pgResult = await pool.query('SELECT 1 as connected');
    
    res.status(200).json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      databases: {
        postgresql: pgResult.rows[0].connected === 1 ? 'connected' : 'error'
      },
      uptime: Math.floor(process.uptime())
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({ 
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling
app.use(errorHandler);

// Startup sequence occurs before startServer()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Visual startup sequence
async function displayStartupSequence() {
  console.log('\n  ✨ DEGENDUEL API INITIALIZING ✨\n');
}

// Main
async function startServer() {
  try {
      console.log(`\n      🎮  Starting DegenDuel API...`);

      await Promise.all([
          initDatabase().catch(err => {
              console.error('SQLite initialization failed:', err);
              throw err;
          }),
          initPgDatabase().catch(err => {
              console.error('PostgreSQL initialization failed:', err);
              throw err;
          })
      ]);

      await displayStartupSequence();

      // Main API server on port 3003
      const apiServer = app.listen(port, '0.0.0.0', () => {
          console.log(`    🎮  DegenDuel API ready on port ${port}`);
      });

      apiServer.on('error', (error) => {
          console.error('API Server error:', error);
          process.exit(1);
      });

      /*
      // WebSocket server for logs on port 3334
      const logsServer = http.createServer(); // Create a separate HTTP server for logs
      const wss = new WebSocketServer({ server: logsServer }); // Attach WebSocket server to logs server

      wss.on('connection', (ws) => {
          console.log('WebSocket connection established for logs.');

          // Stream log file to connected clients
          const stream = fs.createReadStream('app.log', { encoding: 'utf8' });
          stream.on('data', (chunk) => {
              ws.send(chunk);
          });

          ws.on('close', () => {
              console.log('WebSocket connection closed.');
              stream.destroy();
          });

          ws.on('error', (error) => console.error('WebSocket error:', error));

      });

      logsServer.listen(logsPort, '0.0.0.0', () => {
          console.log(`    📜  Logs WebSocket server ready on port ${logsPort}`);
      });

      logsServer.on('error', (error) => {
          console.error('Logs Server error:', error);
          process.exit(1);
      });
      */

  } catch (error) {
      console.error(`    ⛔  Failed to start server:`, error);
      process.exit(1);
  }
}

// Handle graceful shutdown
async function shutdown() {
  try {
    await Promise.all([
      closeDatabase(),    // SQLite
      closePgDatabase()   // PostgreSQL
    ]);
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();
