// index.js

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
//import AdminLogger from './utils/admin-logger.js';
import { memoryMonitoring } from "./scripts/monitor-memory.js";
import SolanaServiceManager from "./utils/solana-suite/solana-service-manager.js";
import serviceManager from "./utils/service-suite/service-manager.js";
import ServiceInitializer from "./utils/service-suite/service-initializer.js";
import { createServer } from 'http';
import referralScheduler from './scripts/referral-scheduler.js';
// Services
import faucetManagementRoutes from "./routes/admin/faucet-management.js";
import serviceMetricsRoutes from "./routes/admin/service-metrics.js";
import tokenSyncRoutes from "./routes/admin/token-sync.js";
import walletManagementRoutes from "./routes/admin/wallet-management.js";
//import contestEvaluationService from "./services/contestEvaluationService.js";
//import tokenSyncService from "./services/tokenSyncService.js";
//import walletRakeService from "./services/walletRakeService.js";
//import tokenWhitelistService from "./services/tokenWhitelistService.js";
import WebSocketInitializer from './utils/websocket-suite/websocket-initializer.js';
// Import WebSocket test routes
import websocketTestRoutes from './routes/admin/websocket-test.js';
// Import Circuit Breaker routes
import circuitBreakerRoutes from './routes/admin/circuit-breaker.js';
import serviceManagementRoutes from './routes/admin/service-management.js';
// Import (some) Admin Routes
import contestManagementRoutes from "./routes/admin/contest-management.js";

// Hard-code all logging flags to reduce verbosity
const VERBOSE_EXPRESS_LOGS = false;
const VERBOSE_SERVICE_LOGS = false;
const SHOW_STARTUP_ANIMATION = true; // Keep animations but reduce service logs
const QUIET_INITIALIZATION = true; // Dramatically reduce initialization logs

dotenv.config();

/* DegenDuel API Server */

const app = express();

// Use standard PORT environment variable
const port = process.env.PORT || 3004; // Default to production port if not specified
////const logsPort = process.env.LOGS_PORT || 3334; // Logs streaming port (stub)

// Create HTTP server instance
const server = createServer(app);

// WebSocket servers and service initialization moved to the initializeServer() function
// This ensures a single initialization path for all components

// Basic Express configuration
if (!QUIET_INITIALIZATION) {
  logApi.info('\x1b[38;5;208m┣━━━━━━━━━━━ 🔒 Configuring Server Security...\x1b[0m');
}
app.set("trust proxy", 1);
app.use(cookieParser());
setupSwagger(app);
configureMiddleware(app);
app.use(memoryMonitoring.setupResponseTimeTracking());

if (!QUIET_INITIALIZATION) {
  logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ Basic Express Configuration Complete\x1b[0m');
}

/* Import Routes */

// Start with DegenDuel API root route (https://degenduel.me/api)
if (!QUIET_INITIALIZATION) {
  logApi.info('\x1b[38;5;208m┃           ┣━━━━━━━━━━━ 🌐 Configuring Routes...\x1b[0m');
}

app.get("/", (req, res) => {
  res.send(`Welcome to the DegenDuel API! You probably should not be here.`);
});

// Import Main DegenDuel API routes
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
// Virtual Agent routes
import virtualAgentRoutes from "./routes/virtual-agent.js";

/* Mount Routes */
// Public Routes
app.use("/api/auth", authRoutes);
app.use("/api/status", statusRoutes);

// Admin Routes
app.use("/api/admin", prismaAdminRoutes);
app.use("/api/admin/maintenance", maintenanceRoutes);
app.use("/api/admin/token-sync", tokenSyncRoutes);
app.use("/api/admin/wallets", walletManagementRoutes);
app.use("/api/admin/contests", contestManagementRoutes);
app.use("/api/admin/faucet", faucetManagementRoutes);
app.use("/api/admin/metrics", serviceMetricsRoutes);
app.use("/api/admin/service-management", serviceManagementRoutes);
app.use("/api/superadmin", superadminRoutes);
app.use('/api/admin/websocket', websocketTestRoutes);
app.use("/api/admin/circuit-breaker", circuitBreakerRoutes);

// Protected routes (with maintenance check)
// earliest protected routes
app.use("/api/balance", maintenanceCheck, prismaBalanceRoutes);
app.use("/api/stats", maintenanceCheck, prismaStatsRoutes);
app.use("/api/leaderboard", maintenanceCheck, leaderboardRoutes);
app.use("/api/activity", maintenanceCheck, prismaActivityRoutes);
// DD-Serv-enabled protected routes (inaccessible when in maintenance mode)
app.use("/api/dd-serv", maintenanceCheck, ddServRoutes);
// more protected routes (inaccessible when in maintenance mode)
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
// Virtual Agent routes (inaccessible when in maintenance mode)
app.use("/api/virtual-agent", maintenanceCheck, virtualAgentRoutes);
// Test routes (no maintenance check needed)
app.use("/api/test", testRoutes);

// Server health route (not using router)
app.get("/api/health", async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1 as connected`;
    
    // Get service statuses
    const serviceStatuses = {};
    if (serviceManager) {
      const services = serviceManager.getServices();
      for (const [name, service] of services) {
        serviceStatuses[name] = {
          initialized: service.isInitialized,
          operational: service.isOperational,
          lastError: service.stats?.history?.lastError
        };
      }
    }

    // Check WebSocket servers
    const wsStatus = {};
    if (global.wsServers) {
      for (const [name, ws] of Object.entries(global.wsServers)) {
        wsStatus[name] = {
          connected: ws?.wss?.clients?.size || 0,
          status: ws?.isInitialized ? 'ready' : 'initializing'
        };
      }
    }

    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      databases: {
        postgresql: "connected"
      },
      services: serviceStatuses,
      websockets: wsStatus,
      memory: process.memoryUsage()
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
// Direct market data route
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

if (!QUIET_INITIALIZATION) {
  logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ All Routes Mounted\x1b[0m');
}

// Create epic startup animation function
// TODO: Move this to a separate file and renovate it dramatically with our newest services, circuit breakers, routes, db summary of major metrics (For example, user count and tokens count, nothing too much at all, contests count, wallet's count, literally not even much more than this) etc.
// But right now the data is almost completely uselessand I just don't even look at this part anymoreoh and then why the **** are we having a happy and sad start up animation how about we just keep it simple and flexible
// There is no need for a sad startup animation, it's just a waste of time and space
// If it's a quick fix then do it but if it's anything more than meets the eye just save it for later
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
    const wsStatus = getStatusIndicators('WebSocket');
    const solanaStatus = getStatusIndicators('Solana Service Manager');
    const contestStatus = getStatusIndicators('Contest Evaluation Service');

    // Create dynamic status display based on actual initialization results
    const statusDisplay = `
\x1b[38;5;39m╔══════════════════════════ SYSTEM STATUS ═══════════════════════════╗
║\x1b[0m \x1b[38;5;${dbStatus.status.includes('ONLINE') ? '82' : '196m'}${dbStatus.symbol} Database Cluster    \x1b[38;5;247m|\x1b[0m \x1b[38;5;${dbStatus.status.includes('ONLINE') ? '82' : '196m'}${dbStatus.status}\x1b[38;5;247m|\x1b[0m \x1b[38;5;${dbStatus.status.includes('ONLINE') ? '82' : '196m'}${dbStatus.bars}\x1b[0m \x1b[38;5;39m\t\t\t\t║
║\x1b[0m \x1b[38;5;${apiStatus.status.includes('ONLINE') ? '82' : '196m'}${apiStatus.symbol} API Services        \x1b[38;5;247m|\x1b[0m \x1b[38;5;${apiStatus.status.includes('ONLINE') ? '82' : '196m'}${apiStatus.status}\x1b[38;5;247m|\x1b[0m \x1b[38;5;${apiStatus.status.includes('ONLINE') ? '82' : '196m'}${apiStatus.bars}\x1b[0m \x1b[38;5;39m\t\t\t\t║
║\x1b[0m \x1b[38;5;${wsStatus.status.includes('ONLINE') ? '82' : '196m'}${wsStatus.symbol} WebSocket Server    \x1b[38;5;247m|\x1b[0m \x1b[38;5;${wsStatus.status.includes('ONLINE') ? '82' : '196m'}${wsStatus.status}\x1b[38;5;247m|\x1b[0m \x1b[38;5;${wsStatus.status.includes('ONLINE') ? '82' : '196m'}${wsStatus.bars}\x1b[0m \x1b[38;5;39m\t\t\t\t║
║\x1b[0m \x1b[38;5;${solanaStatus.status.includes('ONLINE') ? '82' : '196m'}${solanaStatus.symbol} Solana Services     \x1b[38;5;247m|\x1b[0m \x1b[38;5;${solanaStatus.status.includes('ONLINE') ? '82' : '196m'}${solanaStatus.status}\x1b[38;5;247m|\x1b[0m \x1b[38;5;${solanaStatus.status.includes('ONLINE') ? '82' : '196m'}${solanaStatus.bars}\x1b[0m \x1b[38;5;39m\t\t\t\t║
║\x1b[0m \x1b[38;5;${contestStatus.status.includes('ONLINE') ? '82' : '196m'}${contestStatus.symbol} Contest Engine      \x1b[38;5;247m|\x1b[0m \x1b[38;5;${contestStatus.status.includes('ONLINE') ? '82' : '196m'}${contestStatus.status}\x1b[38;5;247m|\x1b[0m \x1b[38;5;${contestStatus.status.includes('ONLINE') ? '82' : '196m'}${contestStatus.bars}\x1b[0m \x1b[38;5;39m\t\t║
╚════════════════════════════════════════════════════════════════════╝\x1b[0m`;

    // Calculate overall system status
    const allServices = [dbStatus, apiStatus, wsStatus, solanaStatus, contestStatus];
    const allOnline = allServices.every(s => s.status.includes('ONLINE'));
    const anyError = allServices.some(s => s.status.includes('ERROR'));
    
    // Get service initialization status
    const servicesStatus = initResults.servicesStatus || { total: 0, initialized: 0, failed: 0 };
    const systemState = allOnline ? 'FULLY OPERATIONAL ✨' : (anyError ? 'DEGRADED PERFORMANCE ⚠️' : 'PARTIAL STARTUP ⏳');

    // Format duration nicely
    const duration = initResults.duration ? initResults.duration.toFixed(2) : 'N/A';

    // Create dynamic startup message
    const startupMessage = `
\x1b[38;5;51m╔══════════════════════════ INITIALIZATION COMPLETE ══════════════════════╗
║                                                                         ║
║  \x1b[38;5;199m🚀 DEGEN DUEL ARENA INITIALIZED ON PORT ${port}\x1b[38;5;51m                           ║
║  \x1b[38;5;${allOnline ? '226' : '196m'}⚡ SYSTEM STATUS: ${systemState}\x1b[38;5;51m                                  ║
║  \x1b[38;5;82m💫 INITIALIZATION DURATION: ${duration}s\x1b[38;5;51m                                      ║
║  \x1b[38;5;213m🌐 SERVICES ONLINE: ${servicesStatus.initialized}/${servicesStatus.total}\x1b[38;5;51m                                               ║
║                                                                        ║
║  \x1b[38;5;226m⚔️  ENTER THE ARENA  ⚔️\x1b[38;5;51m                                                 ║
║                                                                        ║
╚════════════════════════════════════════════════════════════════════════╝\x1b[0m`;

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

// Create sad startup failure animation function
async function displayStartupFailureAnimation(port, initResults = {}) {
    // Helper to get status indicators
    const getStatusIndicators = (serviceName) => {
        const service = initResults[serviceName];
        if (!service) return { status: 'UNKNOWN ', symbol: '?', bars: '□ □ □ □ □' };
        return {
            status: service.success ? 'ONLINE  ' : 'ERROR   ',
            symbol: service.success ? '✓' : '✗',
            bars: service.success ? '■ ■ ■ ■' : '□ □ □ □'
        };
    };

    // Create a sad ASCII art banner
    const sadBanner = `
\x1b[38;5;196m╔══════════════════════════ SYSTEM STATUS ═══════════════════════════╗
║                                                                         ║
║  \x1b[38;5;199m🚨 DEGEN DUEL ARENA INITIALIZATION FAILED\x1b[38;5;51m                           ║
║                                                                         ║
╚════════════════════════════════════════════════════════════════════════╝\x1b[0m`;

    // Get status for each core service
    const dbStatus = getStatusIndicators('Database');
    const apiStatus = getStatusIndicators('Core');
    const wsStatus = getStatusIndicators('WebSocket');
    const solanaStatus = getStatusIndicators('Solana Service Manager');
    const contestStatus = getStatusIndicators('Contest Engine');

    // Create status display
    const statusDisplay = `
\x1b[38;5;196m╔══════════════════════════ SYSTEM STATUS ═══════════════════════════╗
║  Database Cluster    | ${dbStatus.status} |  ${dbStatus.bars}                              ║
║  API Services        | ${apiStatus.status} |  ${apiStatus.bars}                              ║
║  WebSocket Server    | ${wsStatus.status} | ${wsStatus.bars}                           ║
║  Solana Services     | ${solanaStatus.status} |  ${solanaStatus.bars}                              ║
║  Contest Engine      | ${contestStatus.status} | ${contestStatus.bars}           ║
╚════════════════════════════════════════════════════════════════════════╝`;

    // Add dramatic pause between elements
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    // Display failure message
    console.log(sadBanner);
    await sleep(300);
    console.log(statusDisplay);
    await sleep(300);
}

// Main initialization function
//    (This has been pretty darn reliable and is a greatstarting pointbut I think we have been working on it for a long time now and the formatting may not be quite as aligned as it once was with the Roy G Biv intent of services starting and also we've added many services so in organization might be in order)
//    Namely this should makeextensive use of the verbosity flag that we've put in the initialization however it's in this file and it would need to then of course be communicated with whatever file you move this initialization to...that is if you ever move this function to another file, it you know it's up to you
//    There are also just little colored issues throughout that aren't really that bad but you know here and there some color can get away fromus becausefor example a closing formatof one of the boxes that you're drawing might not becorrectly colored and it starts anyway I don't even want you to think about that too much but you know keep it in mind
async function initializeServer() {
    // Add colors to initialization logs
    console.log('\n\x1b[38;5;199m╭───────────────── DegenDuel Initialization Starting ─────────────────╮\x1b[0m');
    console.log('\x1b[38;5;199m│\x1b[38;5;226m               🔍 Swagger docs available at /api-docs                \x1b[38;5;199m│\x1b[0m');
    console.log('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────────────╯\x1b[0m\n');

    // Start initialization logging
    InitLogger.startInitialization();
    const initResults = {};

    // Initialize Databases
    try {
        // Colored logs - Start with Red (196)
        logApi.info('\n\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mDatabase Layer\x1b[0m\x1b[38;5;196m ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        logApi.info('\x1b[38;5;196m┣━━━━━━━━━━━ 🔄 Initializing PostgreSQL...\x1b[0m');
        await initPgDatabase();
        InitLogger.logInit('Database', 'PostgreSQL', 'success');
        initResults.Database = { success: true };
        logApi.info('\x1b[38;5;196m┃           ┗━━━━━━━━━━━ ☑️ PostgreSQL Ready\x1b[0m');

        // Initialize SQLite
        logApi.info('\x1b[38;5;196m┣━━━━━━━━━━━ 🔄 Initializing SQLite...\x1b[0m');
        await initDatabase();
        InitLogger.logInit('Database', 'SQLite', 'success', { path: '/home/websites/degenduel/data/leaderboard.db' });
        logApi.info('\x1b[38;5;196m┗━━━━━━━━━━━ ✅ SQLite Ready\x1b[0m\n');

        // Initialize WebSocket Layer using the WebSocket Initializer
        try {
            // Initialize all WebSocket servers with a single call to the dedicated initializer
            await WebSocketInitializer.initializeWebSockets(server, initResults);
            // Initialize Services Layer (Moved outside WebSocket try-catch)
            logApi.info('\x1b[38;5;27m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mServices Layer\x1b[0m\x1b[38;5;27m ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
            // (Solana Service Manager is now initialized through the service system)
            logApi.info('\x1b[38;5;27m┣━━━━━━━━━━━ 🔄 Note: Solana Service now initialized via service system...\x1b[0m');

            // Initialize grouped services // (Note: I'm not married to these groupings, I'm open to suggestions)
            try {
                // First try to register "core services"
                if (VERBOSE_EXPRESS_LOGS) {
                    logApi.info('Registering core services...');
                }
                const coreServices = await ServiceInitializer.registerCoreServices().catch(error => {
                    logApi.error('Failed to register core services:', error.message);
                    if (VERBOSE_EXPRESS_LOGS) {
                        logApi.error('Error details:', {
                            error: error.message,
                            stack: error.stack
                        });
                    }
                    throw error;
                });
                
                if (VERBOSE_EXPRESS_LOGS) {
                    logApi.info('Core services registered:', coreServices);
                } else {
                    logApi.info(`✅ Registered ${Array.isArray(coreServices) ? coreServices.length : 'all'} core services`);
                }
                
                // Then try to initialize them
                if (VERBOSE_EXPRESS_LOGS) {
                    logApi.info('Initializing services...');
                }
                
                const results = await ServiceInitializer.initializeServices().catch(error => {
                    logApi.error('Failed to initialize services:', error.message);
                    if (VERBOSE_EXPRESS_LOGS) {
                        logApi.error('Error details:', {
                            error: error.message,
                            stack: error.stack
                        });
                    }
                    throw error;
                });

                // Store results but only log details when verbose
                initResults.Services = {
                    initialized: Array.isArray(results?.initialized) ? results.initialized : [],
                    failed: Array.isArray(results?.failed) ? results.failed : []
                };
                
                const successCount = initResults.Services.initialized.length;
                const failedCount = initResults.Services.failed.length;

                logApi.info(`🚀 Services initialization: ${successCount} succeeded, ${failedCount} failed`);
                
                if (VERBOSE_EXPRESS_LOGS) {
                    logApi.info('Service initialization details:', {
                        initialized: initResults.Services.initialized,
                        failed: initResults.Services.failed
                    });
                } else if (failedCount > 0) {
                    // Always show failed services even in non-verbose mode
                    logApi.warn('Failed services:', initResults.Services.failed);
                }

            } catch (error) {
                logApi.error('🚫 Service initialization failed:', error.message);
                if (VERBOSE_EXPRESS_LOGS) {
                    logApi.error('Detailed error information:', {
                        error: error.message,
                        stack: error.stack,
                        phase: 'service_initialization'
                    });
                }
                initResults.Services = {
                    initialized: [],
                    failed: ['Service initialization failed: ' + error.message]
                };
                throw error;  // Re-throw to trigger full initialization failure
            }

        } catch (error) {
            logApi.error('\x1b[38;5;196m┃           ✗ WebSocket initialization failed:', error.message, '\x1b[0m');
            if (VERBOSE_EXPRESS_LOGS) {
                logApi.error('WebSocket error details:', error);
            }
            initResults.WebSocket = { success: false, error: error.message };
            throw error;
        }

    } catch (error) {
        // Display server startup error and failure animation
        logApi.error('\n');
        logApi.error('\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ ERROR ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        logApi.error('\x1b[38;5;196m┃           ❌ Server Initialization Failed              ┃\x1b[0m');
        logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━ Error: ' + error.message + '\x1b[0m');
        
        if (VERBOSE_EXPRESS_LOGS) {
            logApi.error('Full error details:', error);
        }
        
        logApi.error('\n');
        
        // Only show animation if enabled
        if (SHOW_STARTUP_ANIMATION) {
            await displayStartupFailureAnimation(port, initResults);
        }
        
        process.exit(1);
    }
}

// Handle graceful shutdown
async function shutdown() {
  try {
    logApi.info('\n\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ Shutting Down ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
    
    // Cleanup WebSocket servers using the WebSocket Initializer
    logApi.info('\x1b[38;5;196m┣━━━━━━━━━━━ Cleaning up WebSocket servers...\x1b[0m');
    await WebSocketInitializer.cleanupWebSockets();

    // Cleanup all services
    logApi.info('\x1b[38;5;196m┣━━━━━━━━━━━ Cleaning up services...\x1b[0m');
    await ServiceInitializer.cleanup();
    logApi.info('\x1b[38;5;196m┃           ┗━━━━━━━━━━━ ✓ Services cleaned up\x1b[0m');
    
    // Solana Service now cleaned up as part of service cleanup
    logApi.info('\x1b[38;5;196m┣━━━━━━━━━━━ Note: Solana Service now cleaned up via service system\x1b[0m');

    // Close databases
    logApi.info('\x1b[38;5;196m┣━━━━━━━━━━━ Closing databases...\x1b[0m');
    await Promise.all([
      closeDatabase(), // SQLite
      closePgDatabase(), // PostgreSQL
      prisma.$disconnect(), // Disconnect Prisma
    ]);
    logApi.info('\x1b[38;5;196m┃           ┗━━━━━━━━━━━ ✓ Databases closed\x1b[0m');
    
    logApi.info('\x1b[38;5;196m┗━━━━━━━━━━━ ✓ Shutdown complete\x1b[0m\n');
    process.exit(0);
  } catch (error) {
    logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━ ✗ Error during shutdown:', error, '\x1b[0m');
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
initializeServer().then(() => {
    // Start listening after successful initialization
    server.listen(port, () => {
        logApi.info(`Server listening on port ${port}`);
        
        // Only show animation if enabled
        if (SHOW_STARTUP_ANIMATION) {
            displayStartupAnimation(port);
        } else {
            logApi.info(`🚀 DegenDuel API Server ready on port ${port}`);
        }
    });
}).catch(error => {
    logApi.error('Failed to initialize server:', error.message);
    if (VERBOSE_EXPRESS_LOGS) {
        logApi.error('Error details:', error);
    }
    process.exit(1);
});