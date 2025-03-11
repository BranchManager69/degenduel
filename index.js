// index.js

/**
 * 
 * This is the main entry point for the DegenDuel API.
 * It is responsible for initializing the server (both Express and WebSocket)
 * it also initializes the services and configures the routes.
 * 
 */

// Import restart monitor (for Logtail alerting)
import './scripts/pm2-restart-monitor.js';

//---------------------------------------------------.
//  Main server initialization and configuration     |
//---------------------------------------------------|
//  This is the main entry point for DegenDuel API   |
//---------------------------------------------------'
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import express from "express";
import session from "express-session";
import fetch from "node-fetch";
import { closeDatabase, initDatabase } from "./config/database.js"; // SQLite for leaderboard
import { configureMiddleware } from "./config/middleware.js";
import { closePgDatabase, initPgDatabase } from "./config/pg-database.js";
import prisma from "./config/prisma.js";
import setupSwagger from "./config/swagger.js";
import maintenanceCheck from "./middleware/maintenanceMiddleware.js";
import ipBanMiddleware from "./middleware/ipBanMiddleware.js";
import ipTrackingMiddleware from "./middleware/ipTrackingMiddleware.js";
import { errorHandler } from "./utils/errorHandler.js";
import { logApi } from "./utils/logger-suite/logger.js";
import { fancyColors } from './utils/colors.js';
import InitLogger from './utils/logger-suite/init-logger.js';
import AdminLogger from './utils/admin-logger.js';
import { memoryMonitoring } from "./scripts/monitor-memory.js";
import SolanaServiceManager from "./utils/solana-suite/solana-service-manager.js"; // why is this not being used?
import serviceManager from "./utils/service-suite/service-manager.js";
import ServiceInitializer from "./utils/service-suite/service-initializer.js";
import { SERVICE_NAMES } from "./utils/service-suite/service-constants.js";
import { createServer } from 'http';
import referralScheduler from './scripts/referral-scheduler.js'; // why is this not being used?
// Service-related routes
import faucetManagementRoutes from "./routes/admin/faucet-management.js";
import serviceMetricsRoutes from "./routes/admin/service-metrics.js";
import tokenSyncRoutes from "./routes/admin/token-sync.js";
import walletManagementRoutes from "./routes/admin/wallet-management.js";
import WebSocketInitializer from './utils/websocket-suite/websocket-initializer.js';
// Import WebSocket test & status routes
import websocketTestRoutes from './routes/admin/websocket-test.js';
import websocketStatusRoutes from './routes/admin/websocket-status.js';
// Import System Reports routes
import systemReportsRoutes from './routes/admin/system-reports.js';
// Import System Settings routes
import systemSettingsRoutes from './routes/admin/system-settings.js';
// Import Circuit Breaker routes
import circuitBreakerRoutes from './routes/admin/circuit-breaker.js';
import serviceManagementRoutes from './routes/admin/service-management.js';
// Import IP Ban Management routes
import ipBanManagementRoutes from './routes/admin/ip-ban-management.js';
// Import IP Tracking routes
import ipTrackingRoutes from './routes/admin/ip-tracking.js';
// Import Public Ban Check route
import bannedIpRoutes from './routes/banned-ip.js';
// Import (some) Admin Routes
import contestManagementRoutes from "./routes/admin/contest-management.js";
import skyduelManagementRoutes from "./routes/admin/skyduel-management.js";
// Import Script Execution Routes
import scriptExecutionRoutes from "./routes/admin/script-execution.js";
// Import Main DegenDuel API routes
import testRoutes from "./archive/test-routes.js";
import maintenanceRoutes from "./routes/admin/maintenance.js";
import countdownRoutes from "./routes/admin/countdown.js";
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
// Device authentication routes
import deviceRoutes from "./routes/devices.js";
// Path module for static file serving
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hard-code all logging flags to reduce verbosity
const VERBOSE_SERVICE_INIT_LOGS = true; // Show detailed service initialization logs
const SHOW_STARTUP_ANIMATION = true; // Keep animations but reduce service logs
const QUIET_EXPRESS_SERVER_INITIALIZATION = false; // Show detailed Express server and Swagger docs initialization logs

dotenv.config();

/* DegenDuel API Server */

const app = express();

// Use standard PORT environment variable
const port = process.env.PORT || 3004; // Default to production port if not specified

// Create HTTP server instance
const server = createServer(app);

//------------------------------------------------.
//  WebSocket servers and service initialization   |
//  moved to the initializeServer() function       |
//-------------------------------------------------|
//  This ensures a single initialization path      |
//  for all components in the server               |
//-------------------------------------------------'

if (!QUIET_EXPRESS_SERVER_INITIALIZATION) {
  logApi.info('\x1b[38;5;208m┣━━━━━━━━━━━ 🔒 Configuring Server Security...\x1b[0m');
}

// Basic Express configuration
app.set("trust proxy", 1);
app.use(cookieParser());

// Import Redis session store
import { createRedisSessionStore } from './utils/redis-suite/redis-session-store.js';

// Create Redis session store or fall back to memory store
const sessionStore = createRedisSessionStore() || null;
if (!sessionStore) {
  logApi.warn(`[\x1b[38;5;208mSession\x1b[0m] \x1b[38;5;226mFalling back to memory session store - not suitable for production!\x1b[0m`);
}

// Add session middleware with Redis store for Twitter authentication
app.use(session({
  store: sessionStore,
  secret: process.env.JWT_SECRET, // Using the same secret as JWT for simplicity
  resave: false,
  saveUninitialized: false,
  name: 'degenduel.sid', // Custom cookie name for clarity
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Only use secure cookies in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' // Cross-site cookies in production
  }
}));

setupSwagger(app);
configureMiddleware(app);

// Apply IP Ban middleware early in the middleware chain
// This ensures banned IPs are blocked before any other processing
app.use(ipBanMiddleware);

// Apply IP tracking middleware for authenticated users
// This runs after auth middleware sets req.user, but doesn't block requests
app.use(ipTrackingMiddleware);

app.use(memoryMonitoring.setupResponseTimeTracking());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

if (!QUIET_EXPRESS_SERVER_INITIALIZATION) {
  logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ Basic Express Configuration Complete\x1b[0m');
}

/* Import Routes */

// Start with DegenDuel API root route (https://degenduel.me/api)
if (!QUIET_EXPRESS_SERVER_INITIALIZATION) {
  logApi.info('\x1b[38;5;208m┃           ┣━━━━━━━━━━━ 🌐 Configuring Routes...\x1b[0m');
}

app.get("/", (req, res) => {
  res.send(`Welcome to the DegenDuel API! You probably should not be here.`);
});

/* Mount Routes */
// Public Routes
app.use("/api/auth", authRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/banned-ip", bannedIpRoutes);

// Admin Routes
app.use("/api/admin", prismaAdminRoutes);
app.use("/api/admin/maintenance", maintenanceRoutes);
app.use("/api/admin/countdown", countdownRoutes);
app.use("/api/admin/token-sync", tokenSyncRoutes);
app.use("/api/admin/wallets", walletManagementRoutes);
app.use("/api/admin/contests", contestManagementRoutes);
app.use("/api/admin/faucet", faucetManagementRoutes);
app.use("/api/admin/liquidity", faucetManagementRoutes);
app.use("/api/admin/metrics", serviceMetricsRoutes);
app.use("/api/admin/service-management", serviceManagementRoutes);
app.use("/api/admin/skyduel", skyduelManagementRoutes);
app.use("/api/admin/scripts", scriptExecutionRoutes);
app.use("/api/superadmin", superadminRoutes);
app.use('/api/admin/websocket-test', websocketTestRoutes);
app.use('/api/admin/websocket', websocketStatusRoutes);
app.use('/api/admin/system-reports', systemReportsRoutes);
app.use('/api/admin/system-settings', systemSettingsRoutes);
app.use("/api/admin/circuit-breaker", circuitBreakerRoutes);
app.use("/api/admin/ip-ban", ipBanManagementRoutes);
app.use("/api/admin/ip-tracking", ipTrackingRoutes);

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
app.use("/api/devices", maintenanceCheck, deviceRoutes);
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
    
    // Check V69 WebSocket servers
    const wsV69Status = {};
    if (global.wsServersV69) {
      for (const [name, ws] of Object.entries(global.wsServersV69)) {
        wsV69Status[name] = {
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
      websocketsV69: wsV69Status,
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

// Direct market data route // TODO: (not tested)
app.get("/api/marketData/latest", maintenanceCheck, async (req, res) => {
  try {
    const response = await fetch(
      `http://localhost:${port}/api/v2/tokens/marketData/latest` // (not tested)
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

if (!QUIET_EXPRESS_SERVER_INITIALIZATION) {
  logApi.info('\x1b[38;5;208m┃           ┗━━━━━━━━━━━ ✓ All Routes Mounted\x1b[0m');
}

// Create unified startup animation function
async function displayStartupAnimation(port, initResults = {}, success = true) {
    // Helper to format time
    const formatDuration = (seconds) => {
        if (seconds < 60) return `${seconds.toFixed(2)}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
    };

    // Colors
    const colors = {
        title: '\x1b[38;5;199m',     // Pink
        border: '\x1b[38;5;51m',     // Cyan
        success: '\x1b[38;5;82m',    // Green
        error: '\x1b[38;5;196m',     // Red
        warning: '\x1b[38;5;226m',   // Yellow
        reset: '\x1b[0m',            // Reset
        accent: '\x1b[38;5;213m',    // Purple
        gray: '\x1b[38;5;247m',      // Gray
        blue: '\x1b[38;5;39m'        // Blue
    };

    // Create banner
    const banner = `
${colors.border}╔════════════════════════════════════════════════════════════════════════╗
║                                                                                  ║
║  ${colors.title}██████╗ ███████╗ ██████╗ ███████╗███╗   ██╗${colors.border}                           ║
║  ${colors.title}██╔══██╗██╔════╝██╔════╝ ██╔════╝████╗  ██║${colors.border}                           ║
║  ${colors.title}██║  ██║█████╗  ██║  ███╗█████╗  ██╔██╗ ██║${colors.border}           ${colors.warning}⚔️  ARENA${colors.border}        ║
║  ${colors.title}██║  ██║██╔══╝  ██║   ██║██╔══╝  ██║╚██╗██║${colors.border}                        ║
║  ${colors.title}██████╔╝███████╗╚██████╔╝███████╗██║ ╚████║${colors.border}                        ║
║  ${colors.title}╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝${colors.border}                        ║
║                                                                                  ║
║  ${colors.title}██████╗ ██╗   ██╗███████╗██╗${colors.border}           ${colors.warning}🏆 GLORY AWAITS${colors.border}                 ║
║  ${colors.title}██╔══██╗██║   ██║██╔════╝██║${colors.border}                                          ║
║  ${colors.title}██║  ██║██║   ██║█████╗  ██║${colors.border}                                          ║
║  ${colors.title}██║  ██║██║   ██║██╔══╝  ██║${colors.border}                                          ║
║  ${colors.title}██████╔╝╚██████╔╝███████╗███████╗${colors.border}                                     ║
║  ${colors.title}╚═════╝  ╚═════╝ ╚══════╝╚══════╝${colors.border}                                     ║
╚════════════════════════════════════════════════════════════════════════╝${colors.reset}`;

    // Get core infrastructure services status
    // TODO: Use the layers and service names we've already defined elsewhere
    const coreServices = {
        'Database': { name: 'Database Cluster', success: true },
        'API': { name: 'API Server', success: true },
        'WebSocket': { name: 'WebSocket Server', success: true },
        'Solana': { name: 'Solana Connection', success: true }
    };

    // Extract services from initResults
    let services = [];
    if (initResults && initResults.Services) {
        // Get initialized services
        const initialized = initResults.Services.initialized || [];
        // Get failed services
        const failed = initResults.Services.failed || [];
        
        // Create a service entry for each service
        if (serviceManager && serviceManager.getServices) {
            const servicesMap = serviceManager.getServices();
            services = Array.from(servicesMap.entries()).map(([name, service]) => {
                const isInitialized = initialized.includes(name);
                const hasFailed = failed.includes(name);
                const displayName = name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                
                return {
                    name: displayName,
                    status: isInitialized ? 'ONLINE' : (hasFailed ? 'ERROR' : 'WAITING'),
                    symbol: isInitialized ? '✓' : (hasFailed ? '✗' : '⋯'),
                    details: service.stats || {}
                };
            });
        }
    }

    // If no services found but we're successful, create some defaults based on service names
    // TODO: WHAT?????????
    if (services.length === 0 && success) {
        const servicesList = SERVICE_NAMES ? Object.values(SERVICE_NAMES) : [];
        services = servicesList.map(name => {
            const displayName = name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            return {
                name: displayName,
                status: 'UNKNOWN',
                symbol: '?',
                details: {}
            };
        });
    }

    // Create status display header
    let statusDisplay = `
${colors.blue}╔═══════════════════════════════ SERVICES STATUS ════════════════════════════════╗${colors.reset}`;

    // Add core services first
    Object.values(coreServices).forEach(service => {
        const statusColor = service.success ? colors.success : colors.error;
        const symbol = service.success ? '✓' : '✗';
        const status = service.success ? 'ONLINE ' : 'ERROR  ';
        const bars = service.success ? '■ ■ ■ ■ ■' : '□ □ □ □ □';
        
        const nameLength = service.name.length; 
        const maxNameLength = 50;
        const namePadding = ' '.repeat(Math.max(0, maxNameLength - nameLength));
        statusDisplay += `
${colors.blue}║${colors.reset} ${statusColor}${symbol} ${service.name}${namePadding}${colors.gray}|${colors.reset} ${statusColor}${status}${colors.gray}|${colors.reset} ${statusColor}${bars}${colors.reset} ${colors.blue}║${colors.reset}`;
    });

    // Add service divider
    statusDisplay += `
${colors.blue}╟────────────────────────────────────────────────────────────────────────────────╢${colors.reset}`;

    // Calculate number of columns based on services count
    const numColumns = 1;
    const rows = Math.ceil(services.length / numColumns);
    
    // Add application services in multiple columns
    for (let row = 0; row < rows; row++) {
        let rowDisplay = `
${colors.blue}║${colors.reset}`;
        
        for (let col = 0; col < numColumns; col++) {
            const index = row * numColumns + col;
            if (index < services.length) {
                const service = services[index];
                const statusColor = service.status === 'ONLINE' ? colors.success : 
                                   (service.status === 'ERROR' ? colors.error : colors.warning);
                
                // Truncate name to 16 chars
                const name = service.name.length > 16 ? service.name.substring(0, 14) + '...' : service.name;
                rowDisplay += ` ${statusColor}${service.symbol} ${name.padEnd(16)}${colors.reset}`;
                
                if (col < numColumns - 1) {
                    rowDisplay += ` ${colors.gray}|${colors.reset}`;
                }
            } else {
                // Empty column
                rowDisplay += ` ${''.padEnd(18)}`;
                if (col < numColumns - 1) {
                    rowDisplay += ` ${colors.gray}|${colors.reset}`;
                }
            }
        }
        
        rowDisplay += ` ${colors.blue}║${colors.reset}`;
        statusDisplay += rowDisplay;
    }

    // Close status display
    statusDisplay += `
${colors.blue}╚════════════════════════════════════════════════════════════════════════════════╝${colors.reset}`;

    // Get system metrics
    const totalServices = services.length;
    const onlineServices = services.filter(s => s.status === 'ONLINE').length;
    const failedServices = services.filter(s => s.status === 'ERROR').length;
    
    // Calculate overall system status
    const systemState = failedServices > 0 ? 'DEGRADED PERFORMANCE ⚠️' : 
                        (onlineServices === totalServices ? 'FULLY OPERATIONAL ✨' : 'PARTIAL STARTUP ⏳');
    
    // Get duration
    const duration = initResults.duration ? formatDuration(initResults.duration) : formatDuration(process.uptime());
    
    // Create system summary
    const startupMessage = `
${colors.border}╔════════════════════════ ${success ? 'INITIALIZATION COMPLETE' : 'INITIALIZATION FAILED'} ═══════════════════════╗
║ 
║  ${colors.title}🚀 DEGEN DUEL ARENA ${success ? 'INITIALIZED' : 'STARTING'} ON PORT ${port}${colors.border}
║  ${success ? colors.warning : colors.error}⚡ SYSTEM STATUS: ${systemState}${colors.border}
║  ${colors.success}💫 INITIALIZATION TIME: ${duration}${colors.border}
║  ${colors.accent}🌐 SERVICES: ${onlineServices}/${totalServices} ONLINE · ${failedServices} FAILED${colors.border}
║ 
║  ${colors.warning}⚔️  ${success ? `${colors.success}MAKE PvP GREAT AGAIN!${colors.border}` : `${colors.error}MAKE PvP GREAT AGAIN!${colors.border}`}  ⚔️${colors.border}
║ 
╚══════════════════════════════════════════════════════════════════════════════════╝${colors.reset}`;

    // Clear console for dramatic effect
    console.clear(); // TODO: THIS DOES NOT WORK AT ALL; REMOVE IT
    
    // Add dramatic pause between elements
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)); // TODO: THIS DOES NOT WORK AT ALL; REMOVE IT
    
    // Display startup sequence
    console.log('\n');
    console.log(banner);
    await sleep(100);
    console.log(statusDisplay);
    await sleep(100);
    console.log(startupMessage);
    console.log('\n');
}

// Main initialization function
//    (This has been pretty darn reliable and is a greatstarting pointbut I think we have been working on it for a long time now and the formatting may not be quite as aligned as it once was with the Roy G Biv intent of services starting and also we've added many services so in organization might be in order)
//    Namely this should makeextensive use of the verbosity flag that we've put in the initialization however it's in this file and it would need to then of course be communicated with whatever file you move this initialization to...that is if you ever move this function to another file, it you know it's up to you
//    There are also just little colored issues throughout that aren't really that bad but you know here and there some color can get away fromus becausefor example a closing formatof one of the boxes that you're drawing might not becorrectly colored and it starts anyway I don't even want you to think about that too much but you know keep it in mind
async function initializeServer() {
    // Log server start action to DegenDuel Admin Logs
    AdminLogger.logAction(process.env.BRANCH_MANAGER_WALLET_ADDRESS, 'SERVER', 'START');

    // Begin amazing initialization logs
    console.log('\n\x1b[38;5;199m╭───────────────── DegenDuel Initialization Starting ─────────────────╮\x1b[0m');
    console.log('\x1b[38;5;199m│\x1b[38;5;226m               🔍 Swagger docs available at /api-docs                \x1b[38;5;199m│\x1b[0m');
    console.log('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────────────╯\x1b[0m\n');

    // Start amazing initialization logging
    InitLogger.startInitialization();
    const initResults = {};

    // Initialize Databases
    try {
        // Colored logs - Start with Red (196)
        logApi.info('\n\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mDatabase Layer\x1b[0m\x1b[38;5;196m ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        logApi.info(`${fancyColors.RED}┣━━━━━━━━━━━ 🔄 ${fancyColors.WHITE}Initializing PostgreSQL...\x1b[0m`);
        await initPgDatabase();
        InitLogger.logInit('Database', 'PostgreSQL', 'success');
        initResults.Database = { success: true };
        logApi.info(`${fancyColors.RED}┗━━━━━━━━━━━ ☑️ ${fancyColors.BOLD_GREEN}PostgreSQL Ready\x1b[0m`);

        // Initialize SQLite
        logApi.info(`${fancyColors.RED}┣━━━━━━━━━━━ 🔄 ${fancyColors.WHITE}Initializing SQLite...\x1b[0m`);
        await initDatabase();
        InitLogger.logInit('Database', 'SQLite', 'success', { path: '/home/websites/degenduel/data/leaderboard.db' });
        logApi.info(`${fancyColors.RED}┗━━━━━━━━━━━ ☑️ ${fancyColors.BOLD_GREEN}SQLite Ready\x1b[0m`);

        // Initialize WebSocket Layer using the WebSocket Initializer
        try {
            // Initialize all WebSocket servers with a single call to the dedicated initializer
            await WebSocketInitializer.initializeWebSockets(server, initResults);
            // Initialize Services Layer (Moved outside WebSocket try-catch)
            logApi.info('\n\x1b[38;5;27m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mServices Layer\x1b[0m\x1b[38;5;27m ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
            // (Solana Service Manager is now initialized through the service system)
            logApi.info(`${fancyColors.RED}┣━━━━━━━━━━━ 🔄 ${fancyColors.BLUE}${fancyColors.UNDERLINE}${fancyColors.BOLD}NOTE${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.BLUE}: ${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.LIGHT_BLUE}The Solana Service is now initialized via service system...\x1b[0m`);

            // Initialize grouped services 
            // (Note: I'm not married to these groupings; I'm open to suggestions)
            console.log('\n[DEBUG] Initializing grouped services... \n');
            try {
                // First try to register core services
                if (VERBOSE_SERVICE_INIT_LOGS) {
                    logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.LIGHT_YELLOW}${fancyColors.ITALIC}Registering Core Services...${fancyColors.RESET} \n`);
                }
                // Register core services
                // TODO: I don't think this returns anything
                const coreServices = await ServiceInitializer.registerCoreServices().catch(error => {
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.RED}Failed to register core services:${fancyColors.RESET} \n${fancyColors.RED}${fancyColors.ITALIC}${error.message}${fancyColors.RESET}`);
                    if (VERBOSE_SERVICE_INIT_LOGS) {
                        logApi.error('Error details:', {
                            error: error.message,
                            stack: error.stack
                        });
                    }
                    throw error;
                });
                
                if (VERBOSE_SERVICE_INIT_LOGS) {
                    logApi.info(`┗━━━━━━━━━━━✅ Registered ${Array.isArray(coreServices) ? coreServices.length : 'all'} Core Services`);
                    //logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Core services:${fancyColors.RESET} \n`, {
                    //    services: coreServices
                    //});
                } else {
                    logApi.info(`✅ Registered ${Array.isArray(coreServices) ? coreServices.length : 'all'} core services`);
                }
                
                // Then try to initialize them
                if (VERBOSE_SERVICE_INIT_LOGS) {
                    logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.LIGHT_YELLOW}${fancyColors.ITALIC}Initializing services...${fancyColors.RESET} \n`);
                }
                
                // Initialize services
                const results = await ServiceInitializer.initializeServices().catch(error => {
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.RED}Failed to initialize services:${fancyColors.RESET} \n${fancyColors.RED}${fancyColors.ITALIC}${error.message}${fancyColors.RESET}`);
                    if (VERBOSE_SERVICE_INIT_LOGS) {
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

                if (VERBOSE_SERVICE_INIT_LOGS) {
                    //logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.BLUE}Service initialization details:${fancyColors.RESET}`, {
                    //    initialized: initResults.Services.initialized,
                    //    failed: initResults.Services.failed
                    //});
                } else if (failedCount > 0) {
                    // Always show failed services even in non-verbose mode
                    logApi.warn(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.RED}Failed services:${fancyColors.RESET} ${fancyColors.RED}${initResults.Services.failed}${fancyColors.RESET}`);
                }
                logApi.info(`🚀 ${fancyColors.BLACK}${fancyColors.BOLD}Services initialization:${fancyColors.RESET} ${fancyColors.GREEN}${successCount} succeeded${fancyColors.RESET}, ${fancyColors.RED}${failedCount} failed${fancyColors.RESET}`);

            } catch (error) {
                // Log service initialization failure
                logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.RED}Service initialization failed:${fancyColors.RESET} \n${fancyColors.RED}${fancyColors.ITALIC}${error.message}${fancyColors.RESET}`);
                if (VERBOSE_SERVICE_INIT_LOGS) {
                    logApi.error(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.RED}Detailed error information:${fancyColors.RESET}`, {
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
            // Log WebSocket initialization failure
            logApi.error(`${fancyColors.MAGENTA}[WEBSOCKET INIT]${fancyColors.RESET} ${fancyColors.RED}WebSocket initialization failed:${fancyColors.RESET} \n${fancyColors.RED}${fancyColors.ITALIC}${error.message}${fancyColors.RESET}`);
            if (VERBOSE_SERVICE_INIT_LOGS) {
                logApi.error(`${fancyColors.MAGENTA}[WEBSOCKET INIT]${fancyColors.RESET} ${fancyColors.RED}WebSocket error details:${fancyColors.RESET}`, error);
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
        
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.error(`${fancyColors.MAGENTA}[SERVER INIT]${fancyColors.RESET} ${fancyColors.RED}Full error details:${fancyColors.RESET}`, error);
        }
        
        logApi.error('\n');
        
        // Only show animation if enabled
        if (SHOW_STARTUP_ANIMATION) {
            await displayStartupAnimation(port, initResults, false);
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
    server.listen(port, async () => {
        // Log server start with Logtail-friendly formatting
        logApi.info(`Server listening on port ${port}`, {
            service: 'SYSTEM',
            event_type: 'server_start',
            port: port,
            uptime: process.uptime(),
            _icon: '🚀',
            _color: '#00AA00', // Green for success
            _highlight: true,
            _html_message: `
                <span style="background-color:#00AA00;color:white;padding:2px 6px;border-radius:3px;font-weight:bold;">
                    SERVER RUNNING
                </span>
                <span style="font-weight:bold;margin-left:6px;">
                    Listening on port ${port}
                </span>
            `
        });
        
        // Generate initialization summary
        InitLogger.summarizeInitialization(true);
        
        // Only show animation if enabled
        if (SHOW_STARTUP_ANIMATION) {
            try {
                // Get current services status for the animation
                const servicesList = ServiceInitializer.getServiceNames();
                const servicesStatus = {
                    total: servicesList.length,
                    initialized: servicesList.filter(name => {
                        const service = serviceManager.services.get(name);
                        return service && service.isInitialized;
                    }).length
                };
                
                // Create services list with status
                const initializedServices = servicesList.filter(name => {
                    const service = serviceManager.services.get(name);
                    return service && service.isInitialized;
                });
                
                // Pass the complete status data to the animation
                await displayStartupAnimation(port, {
                    Database: { success: true },
                    Core: { success: true },
                    WebSocket: { success: true },
                    'Solana Service Manager': { success: true },
                    Services: {
                        initialized: initializedServices,
                        failed: []
                    },
                    servicesStatus,
                    duration: process.uptime()
                }, true);
            } catch (error) {
                // Fallback to simpler animation if there's an error
                await displayStartupAnimation(port, {}, true);
            }
        } else {
            logApi.info(`DegenDuel API Server ready on port ${port}`, {
                service: 'SYSTEM',
                _color: '#00AA00' // Green for success
            });
        }
    });
}).catch(error => {
    // Log server initialization failure with Logtail formatting
    logApi.error(`Failed to initialize server: ${error.message}`, {
        service: 'SYSTEM',
        event_type: 'server_initialization_failure',
        error: error.message,
        stack: error.stack,
        _icon: '❌',
        _color: '#FF0000', // Red for error
        _highlight: true,
        _html_message: `
            <span style="background-color:#FF0000;color:white;padding:4px 8px;border-radius:3px;font-weight:bold;font-size:16px;">
                SERVER INITIALIZATION FAILED
            </span>
            <div style="margin-top:8px;font-weight:bold;color:#FF0000;">
                ${error.message}
            </div>
        `
    });
    
    // Log more detailed error information if verbose logging is enabled
    if (VERBOSE_SERVICE_INIT_LOGS) {
        logApi.error('Server initialization failure details', {
            service: 'SYSTEM',
            event_type: 'server_initialization_details',
            error: error.message,
            stack: error.stack,
            _color: '#FF0000' // Red for error
        });
    }
    
    // Generate initialization summary even on failure
    try {
        InitLogger.summarizeInitialization(true);
    } catch (summaryError) {
        // Don't let summary generation failure prevent clean exit
    }
    
    process.exit(1);
});