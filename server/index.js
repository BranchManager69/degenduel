import express from 'express';
import { initDatabase, closeDatabase } from './config/database.js';  // SQLite for leaderboard
import { pool, initPgDatabase, closePgDatabase } from './config/pg-database.js';
import { configureMiddleware } from './config/middleware.js';
import { errorHandler } from './utils/errorHandler.js';
import leaderboardRoutes from './routes/leaderboard.js';
import userRoutes from './routes/users.js';
import authRoutes from './routes/auth.js';
import contestRoutes from './routes/contests.js';
import tradeRoutes from './routes/trades.js';
import statsRoutes from './routes/stats.js';
import testRoutes from './routes/test-routes.js';
import logger from '../utils/logger.js';
import { setupSwagger } from './config/swagger.js';

const app = express();
const port = process.env.API_PORT || 3003;

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
    <h1>Welcome to the DegenDuel API!</h1><br>
    <a href="/api/health">Server Health</a><br>
    <a href="/api/test">Test Route</a><br>
    <a href="/api/users">Users Route</a><br>
    <a href="/api/auth">Auth Route</a><br>
    <a href="/api/contests">Contests Route</a><br>
    <a href="/api/trades">Trades Route</a><br>
    <a href="/api/stats">Stats Route</a><br>
    <p>Enjoy DegenDuel!</p><br>
  `);
});

// Core API routes
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contests', contestRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/stats', statsRoutes);

// Generic test route
app.use('/api/test', testRoutes);

// Server health check route
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

// Initialize databases and start server
async function startServer() {
  try {
    console.log('Initializing databases...');
    
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
    
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`API server started and listening on port ${port}`);
    });

    server.on('error', (error) => {
      console.error('Server error:', error);
      process.exit(1);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
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
