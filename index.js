// /index.js
import cookieParser from 'cookie-parser';
// import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { closeDatabase, initDatabase } from './config/database.js'; // SQLite for leaderboard
import { configureMiddleware } from './config/middleware.js';
import { closePgDatabase, initPgDatabase, pool } from './config/pg-database.js';
import setupSwagger from './config/swagger.js'; // ES6 default import
import authRoutes from './routes/auth.js';
import contestRoutes from './routes/contests.js';
import leaderboardRoutes from './routes/leaderboard.js'; // almost forgot this one!
import superadminRoutes from './routes/superadmin.js';
import testRoutes from './routes/test-routes.js'; // NEWEST v4
import tokenBucketRoutes from './routes/tokenBuckets.js'; // new
import tokenRoutes from './routes/tokens.js'; // new
import tradeRoutes from './routes/trades.js';
import userRoutes from './routes/users.js';
import { errorHandler } from './utils/errorHandler.js';
import logger from './utils/logger.js'; // fixed
dotenv.config();


/* DegenDuel API Server */

const app = express();
const port = process.env.API_PORT || 3003; // Main port
////const logsPort = process.env.LOGS_PORT || 3334; // Log streaming port

// CORS settings
// const allowedOrigins = [
//   'http://localhost:3000', 
//   'http://localhost:3001',
//   'http://localhost:3002',
//   'http://localhost:3003', 
//   'http://localhost:3004', 
//   'https://degenduel.me', 
//   'https://data.degenduel.me', 
//   'https://branch.bet', 
//   'https://app.branch.bet',
// ];
// const corsOptions = {
//   origin: (origin, callback) => {
//     if (allowedOrigins.includes(origin) || !origin) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   credentials: true,
//   allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With', 'Cache-Control', 'X-Wallet-Address'],
// };
// app.use(cors(corsOptions));

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

// Prisma routes
import prismaAdminRoutes from './routes/prisma/admin.js';
import prismaStatsRoutes from './routes/prisma/stats.js';
import prismaUserRoutes from './routes/prisma/users.js';

// Core API routes
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contests', contestRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/tokens', tokenRoutes); // new
app.use('/api/token-buckets', tokenBucketRoutes); // new
app.use('/api/leaderboard', leaderboardRoutes); // almost forgot this one!
app.use('/api/test', testRoutes); // NEWEST; tests v4
////app.use('/api/stats', statsRoutes);

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

startServer();
