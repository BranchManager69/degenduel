// /index.js
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import { closeDatabase, initDatabase } from './config/database.js'; // SQLite for leaderboard
import { configureMiddleware } from './config/middleware.js';
import { closePgDatabase, initPgDatabase, pool } from './config/pg-database.js';
import setupSwagger from './config/swagger.js';
import { errorHandler } from './utils/errorHandler.js';
import { logApi } from './utils/logger-suite/logger.js';
dotenv.config();


/* DegenDuel API Server */

const app = express();

/*
 *
 *
 */

const port = process.env.API_PORT || 3003; // DegenDuel API port (main)
////const logsPort = process.env.LOGS_PORT || 3334; // Logs streaming port (stub)

// Cookies setup
app.use(cookieParser());

// Swagger setup
setupSwagger(app);

// Middleware setup
configureMiddleware(app);

// Log startup configuration (optional)
/*
  console.log('Starting API server with config:', {
   port,
   nodeEnv: process.env.NODE_ENV,
   dbHost: process.env.DB_HOST,
   dbName: process.env.DB_NAME,
   dbUser: process.env.DB_USER,
   hasDbPassword: !!process.env.DB_PASS
 });
*/


/* Routes Setup */

// Default API route (https://degenduel.com/api)
app.get('/', (req, res) => {
  res.send(`
    Welcome to the DegenDuel API!
  `);
});

// Prisma-enabled routes
import prismaAdminRoutes from './routes/prisma/admin.js';
import prismaBalanceRoutes from './routes/prisma/balance.js';
import prismaStatsRoutes from './routes/prisma/stats.js';
app.use('/api/balance', prismaBalanceRoutes);
app.use('/api/stats', prismaStatsRoutes);
app.use('/api', prismaAdminRoutes);

// DD-Serv-enabled routes
import ddServRoutes from './routes/dd-serv/tokens.js';
app.use('/api/dd-serv', ddServRoutes);

// Core API routes
import testRoutes from './archive/test-routes.js';
import authRoutes from './routes/auth.js';
import contestRoutes from './routes/contests.js';
import leaderboardRoutes from './routes/leaderboard.js';
import tokenBucketRoutes from './routes/tokenBuckets.js';
import tokenRoutes from './routes/tokens.js';
import tradeRoutes from './routes/trades.js';
import userRoutes from './routes/users.js';
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contests', contestRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/tokens', tokenRoutes); // new
app.use('/api/token-buckets', tokenBucketRoutes); // new
app.use('/api/leaderboard', leaderboardRoutes); // almost forgot this one!
app.use('/api/test', testRoutes); // NEWEST; tests v4

// Superadmin routes
import superadminRoutes from './routes/superadmin.js';
app.use('/api/superadmin', superadminRoutes);

// Server health route (ad hoc route)
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
    logApi.error('Health check failed:', error);
    res.status(500).json({ 
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling setup
app.use(errorHandler);

// Lite visual sequence
async function displayStartupSequence() {
  console.log('\t   ⚔️   DegenDuel API  \t\t|  ALMOST THERE...');
}

// Main
async function startServer() {
  try {
      console.log('\n');
      console.log(`\t   🤺  DegenDuel API  \t\t|  INITIALIZING...`);
      await Promise.all([
          initDatabase().catch(err => {
              console.error('Aborting DegenDuel API; failed to connect to SQLite:', err);
              throw err;
          }),
          initPgDatabase().catch(err => {
              console.error('Aborting DegenDuel API; failed to connect to PostgreSQL:', err);
              throw err;
          })
      ]);

      // Visual startup sequence
      await displayStartupSequence();

      //// Main API server listening on all interfaces
      ////const apiServer = app.listen(port, '0.0.0.0', () => {
      // Main API server listening only on localhost
      const apiServer = app.listen(port, '0.0.0.0', () => {
          console.log(`\t   🎯  DegenDuel API  \t\t|  READY!`);
          console.log(`\t     '--------------> Port ${port} (all interfaces)`);
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
    logApi.error('Error during shutdown:', error);
    process.exit(1);
  }
}


/* Server Events */

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

// Start the server
startServer();