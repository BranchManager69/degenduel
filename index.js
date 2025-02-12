// /index.js

import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import express from "express";
import fetch from "node-fetch";
import { closeDatabase, initDatabase } from "./config/database.js"; // SQLite for leaderboard
import { configureMiddleware } from "./config/middleware.js";
import { closePgDatabase, initPgDatabase } from "./config/pg-database.js";
import prisma from "./config/prisma.js";
import setupSwagger from "./config/swagger.js";
import maintenanceCheck from "./middleware/maintenanceMiddleware.js";
import { errorHandler } from "./utils/errorHandler.js";
import { logApi } from "./utils/logger-suite/logger.js";
import InitLogger from './utils/logger-suite/init-logger.js';
// Services
import faucetManagementRoutes from "./routes/admin/faucet-management.js";
import serviceMetricsRoutes from "./routes/admin/service-metrics.js";
import tokenSyncRoutes from "./routes/admin/token-sync.js";
import vanityWalletRoutes from "./routes/admin/vanity-wallet-management.js";
import walletManagementRoutes from "./routes/admin/wallet-management.js";
import { memoryMonitoring } from "./scripts/monitor-memory.js";
import contestEvaluationService from "./services/contestEvaluationService.js";
import tokenSyncService from "./services/tokenSyncService.js";
import { startWalletRakeService } from "./services/walletRakeService.js";
import SolanaServiceManager from "./utils/solana-suite/solana-service-manager.js";
import PortfolioWebSocketServer from "./websocket/portfolio-ws.js";
import { createServer } from 'http';

dotenv.config();

/* DegenDuel API Server */

const app = express();

// Use standard PORT environment variable
const port = process.env.PORT || 3004; // Default to production port if not specified
////const logsPort = process.env.LOGS_PORT || 3334; // Logs streaming port (stub)

// Create HTTP server instance
const server = createServer(app);

// Trust proxy headers since we're behind a reverse proxy
app.set("trust proxy", 1);

// Cookies setup
app.use(cookieParser());

// Swagger setup
setupSwagger(app);

// Middleware setup
configureMiddleware(app);

// Add response time tracking middleware
app.use(memoryMonitoring.setupResponseTimeTracking());

/* Routes Setup */

// Default API route (https://degenduel.com/api)
app.get("/", (req, res) => {
  res.send(`
    Welcome to the DegenDuel API! You probably should not be here.
  `);
});

// Import routes
import testRoutes from "./archive/test-routes.js";
import maintenanceRoutes from "./routes/admin/maintenance.js";
import authRoutes from "./routes/auth.js";
import contestRoutes from "./routes/contests.js";
import ddServRoutes from "./routes/dd-serv/tokens.js";
import prismaActivityRoutes from "./routes/prisma/activity.js";
import prismaAdminRoutes from "./routes/prisma/admin.js";
import prismaBalanceRoutes from "./routes/prisma/balance.js";
import leaderboardRoutes from "./routes/prisma/leaderboard.js";
import prismaStatsRoutes from "./routes/prisma/stats.js";
import statusRoutes from "./routes/status.js";
import superadminRoutes from "./routes/superadmin.js";
import tokenBucketRoutes from "./routes/tokenBuckets.js";
import tokenRoutes from "./routes/tokens.js";
import tradeRoutes from "./routes/trades.js";
import userRoutes from "./routes/users.js";
import v2TokenRoutes from "./routes/v2/tokens.js";
// v3 alpha routes
import portfolioAnalyticsRouter from "./routes/portfolio-analytics.js";
import portfolioTradesRouter from "./routes/portfolio-trades.js";
import referralRoutes from "./routes/referrals.js";

// 1. First mount public routes (no maintenance check needed)
app.use("/api/auth", authRoutes);
app.use("/api/status", statusRoutes);

// 2. Mount admin routes (no maintenance check needed)
app.use("/api/admin", prismaAdminRoutes);
app.use("/api/admin/maintenance", maintenanceRoutes);
app.use("/api/admin/token-sync", tokenSyncRoutes);
app.use("/api/admin/vanity-wallets", vanityWalletRoutes);
app.use("/api/admin/wallets", walletManagementRoutes);
app.use("/api/admin/faucet", faucetManagementRoutes);
app.use("/api/admin/metrics", serviceMetricsRoutes);
app.use("/api/superadmin", superadminRoutes);

// 3. Apply maintenance check to all other routes
// Prisma-enabled routes (inaccessible when in maintenance mode)
app.use("/api/balance", maintenanceCheck, prismaBalanceRoutes);
app.use("/api/stats", maintenanceCheck, prismaStatsRoutes);
app.use("/api/leaderboard", maintenanceCheck, leaderboardRoutes);
app.use("/api/activity", maintenanceCheck, prismaActivityRoutes);
// DD-Serv-enabled routes (inaccessible when in maintenance mode)
app.use("/api/dd-serv", maintenanceCheck, ddServRoutes);
// Protected routes (inaccessible when in maintenance mode)
app.use("/api/users", maintenanceCheck, userRoutes);
app.use("/api/contests", maintenanceCheck, contestRoutes);
app.use("/api/trades", maintenanceCheck, tradeRoutes);
app.use("/api/tokens", maintenanceCheck, tokenRoutes); // v1 tokens
app.use("/api/v2/tokens", maintenanceCheck, v2TokenRoutes); // v2 tokens with market data
app.use("/api/token-buckets", maintenanceCheck, tokenBucketRoutes);
// v3 alpha routes (inaccessible when in maintenance mode)
app.use("/api/portfolio", maintenanceCheck, portfolioTradesRouter);
app.use("/api/portfolio-analytics", maintenanceCheck, portfolioAnalyticsRouter);
app.use("/api/referrals", maintenanceCheck, referralRoutes);

// Test routes (no maintenance check needed)
app.use("/api/test", testRoutes);
// Server health route (no maintenance check needed)
app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1 as connected`;
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      databases: {
        postgresql: "connected",
      },
      uptime: Math.floor(process.uptime()),
    });
  } catch (error) {
    logApi.error("Health check failed:", error);
    res.status(500).json({
      status: "error",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Add direct market data route that forwards to v2 tokens
app.get("/api/marketData/latest", maintenanceCheck, async (req, res) => {
  try {
    const response = await fetch(
      `http://localhost:${port}/api/v2/tokens/marketData/latest`
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logApi.error("Failed to forward market data request:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch market data",
    });
  }
});

// Error handling setup
app.use(errorHandler);

// Main
async function initializeServer() {
    InitLogger.startInitialization();

    try {
        // Initialize Databases
        logApi.info('Initializing PostgreSQL database...');
        await initPgDatabase();
        InitLogger.logInit('Database', 'PostgreSQL', 'success');

        logApi.info('Initializing SQLite database...');
        await initDatabase();
        InitLogger.logInit('Database', 'SQLite', 'success', { path: '/home/websites/degenduel/data/leaderboard.db' });

        // Start HTTP server first
        await new Promise((resolve, reject) => {
            server.listen(port, () => {
                InitLogger.logInit('Core', 'Express Server', 'success', { port });
                resolve();
            });
            
            server.on('error', (error) => {
                reject(error);
            });
        });

        // Initialize WebSocket Server with the running HTTP server
        const portfolioWs = new PortfolioWebSocketServer(server);
        InitLogger.logInit('Core', 'Portfolio WebSocket', 'success');

        // Memory Monitoring
        memoryMonitoring.initMemoryMonitoring();
        InitLogger.logInit('Core', 'Memory Monitor', 'success');

        // Initialize remaining services
        await SolanaServiceManager.initialize();
        InitLogger.logInit('Core', 'Solana Service Manager', 'success');

        await tokenSyncService.startSync();
        InitLogger.logInit('Core', 'Token Sync Service', 'success');

        await startWalletRakeService();
        InitLogger.logInit('Core', 'Wallet Rake Service', 'success');

        await contestEvaluationService.startContestEvaluationService();
        InitLogger.logInit('Core', 'Contest Evaluation Service', 'success');

        // Final Summary
        InitLogger.summarizeInitialization();
        logApi.info('⚔️  DegenDuel API  ========  Server READY on port ' + port + '!');

    } catch (error) {
        logApi.error('Server initialization failed:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
async function shutdown() {
  try {
    // Stop token sync service
    tokenSyncService.stopSync();

    // Close WebSocket server if it exists
    if (global.wss) {
      await new Promise((resolve) => {
        global.wss.close(() => {
          logApi.info("WebSocket server closed");
          resolve();
        });
      });
    }

    await Promise.all([
      closeDatabase(), // SQLite
      closePgDatabase(), // PostgreSQL
      prisma.$disconnect(), // Disconnect Prisma
    ]);
    process.exit(0);
  } catch (error) {
    logApi.error("Error during shutdown:", error);
    process.exit(1);
  }
}

// Termination
process.on("SIGTERM", shutdown);

// Interruption
process.on("SIGINT", shutdown);

// Uncaught Exception
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// Unhandled Rejection
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Start the server
initializeServer();

// Log startup info
logApi.info("Starting DegenDuel API...", {
  port: port,
  debug_mode: process.env.DEBUG_MODE,
});
