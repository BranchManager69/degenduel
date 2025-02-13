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
import AdminLogger from './utils/admin-logger.js';
// Services
import faucetManagementRoutes from "./routes/admin/faucet-management.js";
import serviceMetricsRoutes from "./routes/admin/service-metrics.js";
import tokenSyncRoutes from "./routes/admin/token-sync.js";
import vanityWalletRoutes from "./routes/admin/vanity-wallet-management.js";
import walletManagementRoutes from "./routes/admin/wallet-management.js";
import { memoryMonitoring } from "./scripts/monitor-memory.js";
import contestEvaluationService from "./services/contestEvaluationService.js";
import tokenSyncService from "./services/tokenSyncService.js";
import { walletRakeService } from "./services/walletRakeService.js";
import SolanaServiceManager from "./utils/solana-suite/solana-service-manager.js";
import PortfolioWebSocketServer from "./websocket/portfolio-ws.js";
import { createServer } from 'http';
import referralScheduler from './scripts/referral-scheduler.js';
import referralService from './services/referralService.js';

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

// Create epic startup animation function
async function displayStartupAnimation(port, initResults = {}) {
    // Helper to get status indicators
    const getStatusIndicators = (serviceName) => {
        const service = initResults[serviceName];
        if (!service) return { status: 'UNKNOWN ', symbol: '?', bars: '□ □ □ □ □' };
        return {
            status: service.success ? 'ONLINE  ' : 'ERROR   ', // Fixed width with spaces
            symbol: service.success ? '✓' : '✗',
            bars: service.success ? '■ ■ ■ ■ ■' : '□ □ □ □ □'
        };
    };

    // Create an epic ASCII art banner
    const epicBanner = `
\x1b[38;5;51m╔════════════════════════════════════════════════════════════════════════╗
║                                                                                  ║
║  \x1b[38;5;199m██████╗ ███████╗ ██████╗ ███████╗███╗   ██╗\x1b[38;5;51m                           ║
║  \x1b[38;5;199m██╔══██╗██╔════╝██╔════╝ ██╔════╝████╗  ██║\x1b[38;5;51m                           ║
║  \x1b[38;5;199m██║  ██║█████╗  ██║  ███╗█████╗  ██╔██╗ ██║\x1b[38;5;51m           \x1b[38;5;226m⚔️  ARENA\x1b[38;5;51m        ║
║  \x1b[38;5;199m██║  ██║██╔══╝  ██║   ██║██╔══╝  ██║╚██╗██║\x1b[38;5;51m                        ║
║  \x1b[38;5;199m██████╔╝███████╗╚██████╔╝███████╗██║ ╚████║\x1b[38;5;51m                        ║
║  \x1b[38;5;199m╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝\x1b[38;5;51m                        ║
║                                                                                  ║
║  \x1b[38;5;199m██████╗ ██╗   ██╗███████╗██╗\x1b[38;5;51m           \x1b[38;5;226m🏆 GLORY AWAITS\x1b[38;5;51m                 ║
║  \x1b[38;5;199m██╔══██╗██║   ██║██╔════╝██║\x1b[38;5;51m                                          ║
║  \x1b[38;5;199m██║  ██║██║   ██║█████╗  ██║\x1b[38;5;51m                                          ║
║  \x1b[38;5;199m██║  ██║██║   ██║██╔══╝  ██║\x1b[38;5;51m                                          ║
║  \x1b[38;5;199m██████╔╝╚██████╔╝███████╗███████╗\x1b[38;5;51m                                     ║
║  \x1b[38;5;199m╚═════╝  ╚═════╝ ╚══════╝╚══════╝\x1b[38;5;51m                                     ║
║                                                                        ║
╚════════════════════════════════════════════════════════════════════════╝\x1b[0m`;

    // Get status for each core service
    const dbStatus = getStatusIndicators('Database');
    const apiStatus = getStatusIndicators('Core');
    const wsStatus = getStatusIndicators('Portfolio WebSocket');
    const solanaStatus = getStatusIndicators('Solana Service Manager');
    const contestStatus = getStatusIndicators('Contest Evaluation Service');

    // Create dynamic status display based on actual initialization results
    const statusDisplay = `
\x1b[38;5;39m╔══════════════════════════ SYSTEM STATUS ═══════════════════════════╗
║\x1b[0m \x1b[38;5;${dbStatus.status.includes('ONLINE') ? '82' : '196m'}${dbStatus.symbol} Database Cluster    \x1b[38;5;247m|\x1b[0m \x1b[38;5;${dbStatus.status.includes('ONLINE') ? '82' : '196m'}${dbStatus.status}\x1b[38;5;247m|\x1b[0m \x1b[38;5;${dbStatus.status.includes('ONLINE') ? '82' : '196m'}${dbStatus.bars}\x1b[0m \x1b[38;5;39m\t\t\t\t║
║\x1b[0m \x1b[38;5;${apiStatus.status.includes('ONLINE') ? '82' : '196m'}${apiStatus.symbol} API Services        \x1b[38;5;247m|\x1b[0m \x1b[38;5;${apiStatus.status.includes('ONLINE') ? '82' : '196m'}${apiStatus.status}\x1b[38;5;247m|\x1b[0m \x1b[38;5;${apiStatus.status.includes('ONLINE') ? '82' : '196m'}${apiStatus.bars}\x1b[0m \x1b[38;5;39m\t\t\t\t║
║\x1b[0m \x1b[38;5;${wsStatus.status.includes('ONLINE') ? '82' : '196m'}${wsStatus.symbol} WebSocket Server    \x1b[38;5;247m|\x1b[0m \x1b[38;5;${wsStatus.status.includes('ONLINE') ? '82' : '196m'}${wsStatus.status}\x1b[38;5;247m|\x1b[0m \x1b[38;5;${wsStatus.status.includes('ONLINE') ? '82' : '196m'}${wsStatus.bars}\x1b[0m \x1b[38;5;39m\t\t\t\t║
║\x1b[0m \x1b[38;5;${solanaStatus.status.includes('ONLINE') ? '82' : '196m'}${solanaStatus.symbol} Solana Services     \x1b[38;5;247m|\x1b[0m \x1b[38;5;${solanaStatus.status.includes('ONLINE') ? '82' : '196m'}${solanaStatus.status}\x1b[38;5;247m|\x1b[0m \x1b[38;5;${solanaStatus.status.includes('ONLINE') ? '82' : '196m'}${solanaStatus.bars}\x1b[0m \x1b[38;5;39m\t\t\t\t║
║\x1b[0m \x1b[38;5;${contestStatus.status.includes('ONLINE') ? '82' : '196m'}${contestStatus.symbol} Contest Engine      \x1b[38;5;247m|\x1b[0m \x1b[38;5;${contestStatus.status.includes('ONLINE') ? '82' : '196m'}${contestStatus.status}\x1b[38;5;247m|\x1b[0m \x1b[38;5;${contestStatus.status.includes('ONLINE') ? '82' : '196m'}${contestStatus.bars}\x1b[0m \x1b[38;5;39m\t\t\t\t║
╚═══════════════════════════════════════════════════════════════════╝\x1b[0m`;

    // Calculate overall system status
    const allServices = [dbStatus, apiStatus, wsStatus, solanaStatus, contestStatus];
    const allOnline = allServices.every(s => s.status.includes('ONLINE'));
    const anyError = allServices.some(s => s.status.includes('ERROR'));
    const systemState = allOnline ? 'FULLY OPERATIONAL ✨' : (anyError ? 'DEGRADED PERFORMANCE ⚠️' : 'PARTIAL STARTUP ⏳');

    // Format duration nicely
    const duration = initResults.duration ? initResults.duration.toFixed(2) : 'N/A';

    // Create dynamic startup message
    const startupMessage = `
\x1b[38;5;51m╔══════════════════════════ INITIALIZATION COMPLETE ══════════════════════╗
║                                                                      ║
║  \x1b[38;5;199m🚀 DEGEN DUEL ARENA INITIALIZED ON PORT ${port}\x1b[38;5;51m                       ║
║  \x1b[38;5;${allOnline ? '226' : '196m'}⚡ SYSTEM STATUS: ${systemState}\x1b[38;5;51m                          ║
║  \x1b[38;5;82m💫 INITIALIZATION DURATION: ${duration}s\x1b[38;5;51m                              ║
║  \x1b[38;5;213m🌐 SERVICES ONLINE: ${allServices.filter(s => s.status.includes('ONLINE')).length}/${allServices.length}\x1b[38;5;51m                                       ║
║                                                                   ║
║  \x1b[38;5;226m⚔️  ENTER THE ARENA  ⚔️\x1b[38;5;51m                                            ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝\x1b[0m`;

    // Clear console for dramatic effect
    console.clear();
    
    // Add dramatic pause between elements
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    
    // Display epic startup sequence
    console.log('\n');
    console.log(epicBanner);
    await sleep(300);
    console.log(statusDisplay);
    await sleep(300);
    console.log(startupMessage);
    console.log('\n');
}

// Main
async function initializeServer() {
    // Add colors to initialization logs
    console.log('\n\x1b[38;5;199m╭───────────────── DegenDuel Initialization Starting ─────────────────╮\x1b[0m');
    console.log('\x1b[38;5;199m│\x1b[38;5;226m               🔍 Swagger docs available at /api-docs                │\x1b[0m');
    console.log('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────────────╯\x1b[0m\n');

    InitLogger.startInitialization();
    const initResults = {};

    try {
        // Initialize Databases with colored logs - Start with Red (196)
        logApi.info('\n\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mDatabase Layer\x1b[0m\x1b[38;5;196m ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        logApi.info('\x1b[38;5;196m┣━━━━━━━━━━━ 🔄 Initializing PostgreSQL...\x1b[0m');
        await initPgDatabase();
        InitLogger.logInit('Database', 'PostgreSQL', 'success');
        initResults.Database = { success: true };
        logApi.info('\x1b[38;5;196m┃           ┗━━━━━━━━━━━ ☑️ PostgreSQL Ready\x1b[0m');

        logApi.info('\x1b[38;5;196m┣━━━━━━━━━━━ 🔄 Initializing SQLite...\x1b[0m');
        await initDatabase();
        InitLogger.logInit('Database', 'SQLite', 'success', { path: '/home/websites/degenduel/data/leaderboard.db' });
        logApi.info('\x1b[38;5;196m┗━━━━━━━━━━━ ✅ SQLite Ready\x1b[0m\n');

        // Initialize Referral Service
        logApi.info('\x1b[38;5;208m┣━━━━━━━━━━━ 🎯 Initializing Referral Service...\x1b[0m');
        await referralService.initialize();
        await referralService.start();
        await AdminLogger.logAction(
            'SYSTEM',
            AdminLogger.Actions.SERVICE.START,
            {
                service: 'referral_service',
                config: referralService.config
            }
        );
        InitLogger.logInit('Core', 'Referral Service', 'success');
        logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ☑️ Referral Service Ready\x1b[0m');

        // Start HTTP server - Orange (208)
        logApi.info('\n\x1b[38;5;208m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mCore Services\x1b[0m\x1b[38;5;208m ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        logApi.info('\x1b[38;5;208m┣━━━━━━━━━━━ 🌐 Starting Express Server...\x1b[0m');
        await new Promise((resolve, reject) => {
            server.listen(port, () => {
                InitLogger.logInit('Core', 'Express Server', 'success', { port });
                initResults.Core = { success: true };
                logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ☑️ Express Server Ready on Port ' + port + '\x1b[0m');
                resolve();
            });
            
            server.on('error', (error) => {
                initResults.Core = { success: false, error };
                reject(error);
            });
        });

        // WebSocket - Yellow (226)
        logApi.info('\x1b[38;5;226m┣━━━━━━━━━━━ 🌐 Initializing WebSocket Server...\x1b[0m');
        const portfolioWs = new PortfolioWebSocketServer(server);
        InitLogger.logInit('Core', 'Portfolio WebSocket', 'success');
        initResults['Portfolio WebSocket'] = { success: true };
        logApi.info('\x1b[38;5;226m┃           ┗━━━━━━━━━━━ ☑️ WebSocket Server Ready\x1b[0m');

        // Memory Monitor - Green (46)
        logApi.info('\x1b[38;5;46m┣━━━━━━━━━━━ 📊 Initializing Memory Monitor...\x1b[0m');
        memoryMonitoring.initMemoryMonitoring();
        InitLogger.logInit('Core', 'Memory Monitor', 'success');
        logApi.info('\x1b[38;5;46m┃           ┗━━━━━━━━━━━ ☑️ Memory Monitor Active\x1b[0m');

        // Solana Services - Blue (27)
        logApi.info('\x1b[38;5;27m┣━━━━━━━━━━━ ⚡ Initializing Solana Services...\x1b[0m');
        await SolanaServiceManager.initialize();
        InitLogger.logInit('Core', 'Solana Service Manager', 'success');
        initResults['Solana Service Manager'] = { success: true };
        logApi.info('\x1b[38;5;27m┃           ┗━━━━━━━━━━━ ☑️ Solana Services Ready\x1b[0m');

        // Token Sync - Indigo (57)
        logApi.info('\x1b[38;5;57m┣━━━━━━━━━━━ 🔄 Starting Token Sync Service...\x1b[0m');
        await tokenSyncService.initialize();
        await tokenSyncService.start();
        InitLogger.logInit('Core', 'Token Sync Service', 'success');
        logApi.info('\x1b[38;5;57m┃           ┗━━━━━━━━━━━ ✅ Token Sync Active\x1b[0m');

        // Wallet Service - Violet (93)
        logApi.info('\x1b[38;5;93m┣━━━━━━━━━━━ 💰 Starting Wallet Rake Service...\x1b[0m');
        await walletRakeService.initialize();
        await walletRakeService.start();
        await AdminLogger.logAction(
            'SYSTEM',
            AdminLogger.Actions.SERVICE.START,
            {
                service: 'wallet_rake_service',
                config: walletRakeService.config
            }
        );
        InitLogger.logInit('Core', 'Wallet Rake Service', 'success');
        logApi.info('\x1b[38;5;93m┃           ┗━━━━━━━━━━━ ☑️ Wallet Rake Active\x1b[0m');

        // Contest Service - Blue (27)
        logApi.info('\x1b[38;5;27m┣━━━━━━━━━━━ ⚡ Initializing Contest Evaluation...\x1b[0m');
        await contestEvaluationService.service.initialize();
        await contestEvaluationService.service.start();
        await AdminLogger.logAction(
            'SYSTEM',
            AdminLogger.Actions.SERVICE.START,
            {
                service: 'contest_evaluation_service',
                config: contestEvaluationService.service.config
            }
        );
        InitLogger.logInit('Core', 'Contest Evaluation Service', 'success');
        initResults['Contest Evaluation Service'] = { success: true };
        logApi.info('\x1b[38;5;27m┃           ┗━━━━━━━━━━━ ☑️ Contest Evaluation Ready\x1b[0m');

        // Initialize referral scheduler
        logApi.info('\x1b[38;5;93m┣━━━━━━━━━━━ 🎯 Starting Referral Scheduler...\x1b[0m');
        await referralScheduler;
        InitLogger.logInit('Core', 'Referral Scheduler', 'success');
        logApi.info('\x1b[38;5;93m┃           ┗━━━━━━━━━━━ ☑️ Referral Scheduler Active\x1b[0m');

        // Get initialization duration from InitLogger
        const summary = InitLogger.summarizeInitialization();
        initResults.duration = summary?.duration || 0;
        
        // Display the epic startup animation with actual initialization results
        await displayStartupAnimation(port, initResults);

    } catch (error) {
        logApi.error('\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ ERROR ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        logApi.error('\x1b[38;5;196m┃           ❌ Server Initialization Failed              ┃\x1b[0m');
        logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━ Error: ' + error.message + '\x1b[0m');
        // Still show the startup animation, but with error states
        await displayStartupAnimation(port, initResults);
        process.exit(1);
    }
}

// Handle graceful shutdown
async function shutdown() {
  try {
    // Stop token sync service
    await tokenSyncService.stop();

    // Close WebSocket server if it exists
    if (global.wss) {
      await new Promise((resolve) => {
        global.wss.close(() => {
          logApi.info("WebSocket server closed");
          resolve();
        });
      });
    }

    // Stop wallet rake service
    await walletRakeService.stop();
    await AdminLogger.logAction(
        'SYSTEM',
        AdminLogger.Actions.SERVICE.STOP,
        {
            service: 'wallet_rake_service',
            reason: 'Server shutdown'
        }
    );

    // Stop contest evaluation service
    await contestEvaluationService.service.stop();
    await AdminLogger.logAction(
        'SYSTEM',
        AdminLogger.Actions.SERVICE.STOP,
        {
            service: 'contest_evaluation_service',
            reason: 'Server shutdown'
        }
    );

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
