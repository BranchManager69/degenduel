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
import { createWebSocketMonitor } from './websocket/monitor-ws.js';
import { createCircuitBreakerWebSocket } from './websocket/circuit-breaker-ws.js';
import { createAnalyticsWebSocket } from './websocket/analytics-ws.js';
import { createPortfolioWebSocket } from './websocket/portfolio-ws.js';
import { createMarketDataWebSocket } from './websocket/market-ws.js';
import { createWalletWebSocket } from './websocket/wallet-ws.js';
import { createContestWebSocket } from './websocket/contest-ws.js';
// Import WebSocket test routes
import websocketTestRoutes from './routes/admin/websocket-test.js';
// Import Circuit Breaker routes
import circuitBreakerRoutes from './routes/admin/circuit-breaker.js';
// Import (some) Admin Routes
import contestManagementRoutes from "./routes/admin/contest-management.js";

dotenv.config();

/* DegenDuel API Server */

const app = express();

// Use standard PORT environment variable
const port = process.env.PORT || 3004; // Default to production port if not specified
////const logsPort = process.env.LOGS_PORT || 3334; // Logs streaming port (stub)

// Create HTTP server instance
const server = createServer(app);

// Initialize WebSocket servers
logApi.info('\x1b[38;5;208m┣━━━━━━━━━━━ 🔌 Initializing WebSocket Servers...\x1b[0m');

try {
    // Initialize WebSocket monitor first
    const wsMonitor = createWebSocketMonitor(server);
    if (!wsMonitor) {
        throw new Error('Failed to initialize WebSocket monitor');
    }
    logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ Monitor WebSocket Ready\x1b[0m');

    // Initialize service-specific WebSocket servers
    const wsServers = {
        monitor: wsMonitor,
        circuitBreaker: createCircuitBreakerWebSocket(server),
        analytics: createAnalyticsWebSocket(server),
        market: createMarketDataWebSocket(server),
        portfolio: createPortfolioWebSocket(server),
        wallet: createWalletWebSocket(server),
        contest: createContestWebSocket(server)
    };

    // Add debug logging for contest server
    const contestServer = wsServers.contest;
    if (!contestServer) {
        logApi.error('Contest WebSocket server failed to initialize');
    } else {
        logApi.info('Contest WebSocket server initialized successfully');
    }

    // Verify WebSocket servers initialized correctly
    const failedServers = Object.entries(wsServers)
        .filter(([name, instance]) => !instance)
        .map(([name]) => name);

    if (failedServers.length > 0) {
        throw new Error(`Failed to initialize WebSocket servers: ${failedServers.join(', ')}`);
    }

    logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ Service WebSockets Ready\x1b[0m');

    // Store WebSocket servers in global registry
    global.wsServers = wsServers;

    // Wait for WebSocket servers to fully initialize
    await new Promise(resolve => setTimeout(resolve, 2500)); // Wait longer than monitor service's 2000ms

    // Default metrics for uninitialized services
    const defaultMetrics = {
        metrics: {
            totalConnections: 0,
            activeSubscriptions: 0,
            messageCount: 0,
            errorCount: 0,
            lastUpdate: new Date().toISOString(),
            cacheHitRate: 0,
            averageLatency: 0
        },
        performance: {
            messageRate: 0,
            errorRate: 0,
            latencyTrend: []
        },
        status: 'initializing'
    };

    // Register services with monitor
    try {
        // Wait for monitor service to be ready
        while (!wsMonitor.monitorService.isInitialized) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Register each service's metrics
        for (const [name, instance] of Object.entries(wsServers)) {
            if (name !== 'monitor' && instance) {
                try {
                    const metrics = instance.getMetrics?.() || defaultMetrics;
                    wsMonitor.monitorService.updateServiceMetrics(name, metrics);
                } catch (error) {
                    logApi.warn(`Failed to get metrics for ${name}:`, error);
                    wsMonitor.monitorService.updateServiceMetrics(name, defaultMetrics);
                }
            }
        }

        logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ WebSocket Metrics Registered\x1b[0m');

        // Set up periodic metrics updates only after initial registration is complete
        setInterval(() => {
            try {
                // Update each service's metrics
                for (const [name, instance] of Object.entries(wsServers)) {
                    if (name !== 'monitor' && instance) {
                        try {
                            const metrics = instance.getMetrics?.() || defaultMetrics;
                            wsMonitor.monitorService.updateServiceMetrics(name, metrics);
                        } catch (error) {
                            logApi.warn(`Failed to get metrics for ${name}:`, error);
                            wsMonitor.monitorService.updateServiceMetrics(name, defaultMetrics);
                        }
                    }
                }
            } catch (error) {
                logApi.warn('Failed to update WebSocket metrics:', error);
            }
        }, 5000);

        InitLogger.logInit('Core', 'WebSocket Servers', 'success');
        logApi.info('\x1b[38;5;208m┗━━━━━━━━━━━ ✓ WebSocket System Ready\x1b[0m\n');

    } catch (error) {
        logApi.warn('Failed to register initial WebSocket metrics:', error);
    }

} catch (error) {
    logApi.error('\x1b[38;5;196m┃           ✗ WebSocket initialization failed:', error, '\x1b[0m');
    throw error; // Re-throw to be caught by main error handler
}

// Trust proxy headers since we're behind a reverse proxy
app.set("trust proxy", 1);
logApi.info('\x1b[38;5;208m┣━━━━━━━━━━━ 🔒 Configuring Server Security...\x1b[0m');

// Cookies setup
app.use(cookieParser());

// Swagger setup
setupSwagger(app);
logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ API Documentation Ready\x1b[0m');

// Middleware setup
configureMiddleware(app);
logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ Middleware Configured\x1b[0m');

// Add response time tracking middleware
app.use(memoryMonitoring.setupResponseTimeTracking());

/* Routes Setup */

// Default API route (https://degenduel.me/api)
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
app.use("/api/admin/wallets", walletManagementRoutes);
app.use("/api/admin/contests", contestManagementRoutes);
app.use("/api/admin/faucet", faucetManagementRoutes);
app.use("/api/admin/metrics", serviceMetricsRoutes);
app.use("/api/superadmin", superadminRoutes);
app.use('/api/admin/websocket', websocketTestRoutes);
app.use("/api/admin/circuit-breaker", circuitBreakerRoutes);

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

// Main
async function initializeServer() {
    // Add colors to initialization logs
    console.log('\n\x1b[38;5;199m╭───────────────── DegenDuel Initialization Starting ─────────────────╮\x1b[0m');
    console.log('\x1b[38;5;199m│\x1b[38;5;226m               🔍 Swagger docs available at /api-docs                \x1b[38;5;199m│\x1b[0m');
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

        // Initialize WebSocket Layer
        logApi.info('\x1b[38;5;208m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mWebSocket Layer\x1b[0m\x1b[38;5;208m ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        logApi.info('\x1b[38;5;208m┣━━━━━━━━━━━ 🔌 Initializing WebSocket Servers...\x1b[0m');

        try {
            // Initialize WebSocket monitor first
            const wsMonitor = createWebSocketMonitor(server);
            if (!wsMonitor) {
                throw new Error('Failed to initialize WebSocket monitor');
            }
            logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ Monitor WebSocket Ready\x1b[0m');

            // Initialize service-specific WebSocket servers
            const wsServers = {
                monitor: wsMonitor,
                circuitBreaker: createCircuitBreakerWebSocket(server),
                analytics: createAnalyticsWebSocket(server),
                market: createMarketDataWebSocket(server),
                portfolio: createPortfolioWebSocket(server),
                wallet: createWalletWebSocket(server),
                contest: createContestWebSocket(server)
            };

            // Add debug logging for contest server
            const contestServer = wsServers.contest;
            if (!contestServer) {
                logApi.error('Contest WebSocket server failed to initialize');
            } else {
                logApi.info('Contest WebSocket server initialized successfully');
            }

            // Verify WebSocket servers initialized correctly
            const failedServers = Object.entries(wsServers)
                .filter(([name, instance]) => !instance)
                .map(([name]) => name);

            if (failedServers.length > 0) {
                throw new Error(`Failed to initialize WebSocket servers: ${failedServers.join(', ')}`);
            }

            logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ Service WebSockets Ready\x1b[0m');

            // Store WebSocket servers in global registry
            global.wsServers = wsServers;

            // Wait for WebSocket servers to fully initialize
            await new Promise(resolve => setTimeout(resolve, 2500)); // Wait longer than monitor service's 2000ms

            // Default metrics for uninitialized services
            const defaultMetrics = {
                metrics: {
                    totalConnections: 0,
                    activeSubscriptions: 0,
                    messageCount: 0,
                    errorCount: 0,
                    lastUpdate: new Date().toISOString(),
                    cacheHitRate: 0,
                    averageLatency: 0
                },
                performance: {
                    messageRate: 0,
                    errorRate: 0,
                    latencyTrend: []
                },
                status: 'initializing'
            };

            // Register services with monitor
            try {
                // Wait for monitor service to be ready
                while (!wsMonitor.monitorService.isInitialized) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                // Register each service's metrics
                for (const [name, instance] of Object.entries(wsServers)) {
                    if (name !== 'monitor' && instance) {
                        try {
                            const metrics = instance.getMetrics?.() || defaultMetrics;
                            wsMonitor.monitorService.updateServiceMetrics(name, metrics);
                        } catch (error) {
                            logApi.warn(`Failed to get metrics for ${name}:`, error);
                            wsMonitor.monitorService.updateServiceMetrics(name, defaultMetrics);
                        }
                    }
                }

                logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ WebSocket Metrics Registered\x1b[0m');

                // Set up periodic metrics updates only after initial registration is complete
                setInterval(() => {
                    try {
                        // Update each service's metrics
                        for (const [name, instance] of Object.entries(wsServers)) {
                            if (name !== 'monitor' && instance) {
                                try {
                                    const metrics = instance.getMetrics?.() || defaultMetrics;
                                    wsMonitor.monitorService.updateServiceMetrics(name, metrics);
                                } catch (error) {
                                    logApi.warn(`Failed to get metrics for ${name}:`, error);
                                    wsMonitor.monitorService.updateServiceMetrics(name, defaultMetrics);
                                }
                            }
                        }
                    } catch (error) {
                        logApi.warn('Failed to update WebSocket metrics:', error);
                    }
                }, 5000);

                InitLogger.logInit('Core', 'WebSocket Servers', 'success');
                initResults.WebSocket = { success: true };
                logApi.info('\x1b[38;5;208m┗━━━━━━━━━━━ ✓ WebSocket System Ready\x1b[0m\n');

            } catch (error) {
                logApi.warn('Failed to register initial WebSocket metrics:', error);
            }

            // Initialize Services Layer
            logApi.info('\x1b[38;5;27m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mServices Layer\x1b[0m\x1b[38;5;27m ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
            
            // Initialize services
            try {
                const results = await ServiceInitializer.initializeServices();
                initResults.Services = {
                    initialized: Array.isArray(results?.initialized) ? results.initialized : [],
                    failed: Array.isArray(results?.failed) ? results.failed : []
                };
            } catch (error) {
                logApi.error('Service initialization failed:', error);
                initResults.Services = {
                    initialized: [],
                    failed: ['Service initialization failed: ' + error.message]
                };
            }

            // Rest of the initialization code...

        } catch (error) {
            logApi.error('\x1b[38;5;196m┃           ✗ WebSocket initialization failed:', error, '\x1b[0m');
            initResults.WebSocket = { success: false, error: error.message };
            throw error;
        }

    } catch (error) {
        // Display the sad startup failure animation
        logApi.error('\n');
        logApi.error('\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ ERROR ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        logApi.error('\x1b[38;5;196m┃           ❌ Server Initialization Failed              ┃\x1b[0m');
        logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━ Error: ' + error.message + '\x1b[0m');
        logApi.error('\n');
        await displayStartupFailureAnimation(port, initResults);
        process.exit(1);
    }
}

// Handle graceful shutdown
async function shutdown() {
  try {
    logApi.info('\n\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ Shutting Down ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
    
    // Cleanup WebSocket servers
    logApi.info('\x1b[38;5;196m┣━━━━━━━━━━━ Cleaning up WebSocket servers...\x1b[0m');
    for (const [name, ws] of Object.entries(global.wsServers)) {
      try {
        await ws.cleanup();
        logApi.info(`\x1b[38;5;196m┃           ┗━━━━━━━━━━━ ✓ ${name} WebSocket cleaned up\x1b[0m`);
      } catch (error) {
        logApi.error(`\x1b[38;5;196m┃           ┗━━━━━━━━━━━ ✗ Failed to cleanup ${name} WebSocket:`, error);
      }
    }

    // Cleanup all services
    logApi.info('\x1b[38;5;196m┣━━━━━━━━━━━ Cleaning up services...\x1b[0m');
    await ServiceInitializer.cleanup();
    logApi.info('\x1b[38;5;196m┃           ┗━━━━━━━━━━━ ✓ Services cleaned up\x1b[0m');

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
initializeServer();

// Log startup info
logApi.info("Starting DegenDuel API...", {
  port: port,
  debug_mode: process.env.DEBUG_MODE,
});
