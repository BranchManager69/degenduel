// /index.js
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import { closeDatabase, initDatabase } from './config/database.js'; // SQLite for leaderboard
import { configureMiddleware } from './config/middleware.js';
import { closePgDatabase, initPgDatabase } from './config/pg-database.js';
import setupSwagger from './config/swagger.js';
import { errorHandler } from './utils/errorHandler.js';
import { logApi } from './utils/logger-suite/logger.js';
import prisma from './config/prisma.js';
import maintenanceCheck from './middleware/maintenanceMiddleware.js';
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

// Import routes
import prismaAdminRoutes from './routes/prisma/admin.js';
import prismaBalanceRoutes from './routes/prisma/balance.js';
import prismaStatsRoutes from './routes/prisma/stats.js';
import leaderboardRoutes from './routes/prisma/leaderboard.js';
import prismaActivityRoutes from './routes/prisma/activity.js';
import maintenanceRoutes from './routes/admin/maintenance.js';
import ddServRoutes from './routes/dd-serv/tokens.js';
import userRoutes from './routes/users.js';
import authRoutes from './routes/auth.js';
import contestRoutes from './routes/contests.js';
import tokenBucketRoutes from './routes/tokenBuckets.js';
import tokenRoutes from './routes/tokens.js';
import v2TokenRoutes from './routes/v2/tokens.js';
import tradeRoutes from './routes/trades.js';
import superadminRoutes from './routes/superadmin.js';
import testRoutes from './archive/test-routes.js';
import statusRoutes from './routes/status.js';

// 1. First mount public routes (no maintenance check needed)
app.use('/api/auth', authRoutes);
app.use('/api/status', statusRoutes);

// 2. Mount admin routes (no maintenance check needed)
app.use('/api/admin', prismaAdminRoutes);
app.use('/api/admin/maintenance', maintenanceRoutes);
app.use('/api/superadmin', superadminRoutes);

// 3. Apply maintenance check to all other routes
// Prisma-enabled routes
app.use('/api/balance', maintenanceCheck, prismaBalanceRoutes);
app.use('/api/stats', maintenanceCheck, prismaStatsRoutes);
app.use('/api/leaderboard', maintenanceCheck, leaderboardRoutes);
app.use('/api/activity', maintenanceCheck, prismaActivityRoutes);

// DD-Serv-enabled routes
app.use('/api/dd-serv', maintenanceCheck, ddServRoutes);

// Protected routes
app.use('/api/users', maintenanceCheck, userRoutes);
app.use('/api/contests', maintenanceCheck, contestRoutes);
app.use('/api/trades', maintenanceCheck, tradeRoutes);
app.use('/api/tokens', maintenanceCheck, tokenRoutes); // v1 tokens
app.use('/api/v2/tokens', maintenanceCheck, v2TokenRoutes); // v2 tokens
app.use('/api/token-buckets', maintenanceCheck, tokenBucketRoutes);

// Test routes (no maintenance check needed)
app.use('/api/test', testRoutes);

// Server health route (no maintenance check needed)
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1 as connected`;
    res.status(200).json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      databases: {
        postgresql: 'connected'
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
      closePgDatabase(),  // PostgreSQL
      prisma.$disconnect() // Disconnect Prisma
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

// Log startup info
logApi.info('Starting DegenDuel API...', {
  port: port,
  debug_mode: process.env.DEBUG_MODE
});