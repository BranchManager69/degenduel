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
// Import Role Management routes
import roleManagementRoutes from './routes/admin/role-management.js';
// Import Public Ban Check route
import bannedIpRoutes from './routes/banned-ip.js';
// Import (some) Admin Routes
import contestManagementRoutes from "./routes/admin/contest-management.js";
import contestSchedulerRoutes from "./routes/admin/contest-scheduler.js";
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

// Import the database cleanup utility
import databaseCleanup from './utils/database-cleanup.js';

/* DegenDuel API Server */

const app = express();

// Use standard PORT environment variable
const port = process.env.PORT || 3004; // Default to production port if not specified

// Log port configuration with minimal formatting
logApi.info(`Server starting | Environment: ${process.env.NODE_ENV}, Port: ${port}`);

// Create HTTP server instance
const server = createServer(app);

// Increase the maximum number of listeners to prevent EventEmitter memory leak warnings
// This is necessary because we're attaching multiple WebSocket servers to the same HTTP server
server.setMaxListeners(20);

//------------------------------------------------.
//  WebSocket servers and service initialization   |
//  moved to the initializeServer() function       |
//-------------------------------------------------|
//  This ensures a single initialization path      |
//  for all components in the server               |
//-------------------------------------------------'

if (!QUIET_EXPRESS_SERVER_INITIALIZATION) {
  logApi.info('🔒 Configuring Server Security...');
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
  logApi.info('✓ Basic Express Configuration Complete');
}

/* Import Routes */

// Start with DegenDuel API root route (https://degenduel.me/api)
if (!QUIET_EXPRESS_SERVER_INITIALIZATION) {
  logApi.info('🌐 Configuring Routes...');
}

app.get("/", (req, res) => {
  res.send(`Welcome to the DegenDuel API! You probably should not be here.`);
});

// Note: Socket.IO test routes have been removed as Socket.IO is no longer used

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
app.use("/api/admin/contest-scheduler", contestSchedulerRoutes);
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
app.use("/api/admin/role", roleManagementRoutes);

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
  logApi.info('✓ All Routes Mounted');
}

// Streamlined startup animation function
async function displayStartupAnimation(port, initResults = {}, success = true) {
    // Helper to format time
    const formatDuration = (seconds) => {
        if (seconds < 60) return `${seconds.toFixed(2)}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
    };

    // Get service metrics from initResults
    const initializedServices = initResults.Services?.initialized || [];
    const failedServices = initResults.Services?.failed || [];
    const totalServices = (initializedServices.length + failedServices.length) || 
                          (serviceManager ? serviceManager.getServices().size : 0);
    
    // Get duration
    const duration = formatDuration(process.uptime());
    
    // Create simple animation
    const banner = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                                                              ┃
┃                     DEGEN DUEL ARENA                         ┃
┃             ${success ? '✅ SERVER INITIALIZATION COMPLETE' : '❌ SERVER INITIALIZATION FAILED'}             ┃
┃                                                              ┃
┃  🔢 Port: ${port}                                              ┃
┃  ⏱️  Startup Time: ${duration}                                   ┃
┃  🌐 Services: ${initializedServices.length}/${totalServices} Online                               ┃
┃                                                              ┃
┃                   ⚔️  GLORY AWAITS  ⚔️                        ┃
┃                                                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
`;
    
    // Display startup information
    console.log(banner);
}

// Set up signal handlers for graceful shutdown
function setupShutdownHandlers() {
  // Flag to prevent multiple shutdown attempts
  let shuttingDown = false;
  
  // Handler function for shutdown signals
  const handleShutdownSignal = async (signal) => {
    if (shuttingDown) {
      // If already shutting down and receiving another signal, force exit
      logApi.warn(`Received ${signal} signal during shutdown, forcing exit...`);
      process.exit(1);
      return;
    }
    
    shuttingDown = true;
    logApi.info(`Received ${signal} signal, initiating graceful shutdown...`);
    
    try {
      await shutdown();
    } catch (error) {
      logApi.error(`Error during shutdown: ${error.message}`);
      process.exit(1);
    }
  };
  
  // Register graceful shutdown signals
  process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));
  process.on('SIGINT', () => handleShutdownSignal('SIGINT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logApi.error('Uncaught Exception:', error);
    handleShutdownSignal('uncaughtException');
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logApi.error('Unhandled Promise Rejection:', reason);
    handleShutdownSignal('unhandledRejection');
  });
  
  logApi.info('Shutdown handlers initialized');
}

// Main initialization function
//    (This has been pretty darn reliable and is a greatstarting pointbut I think we have been working on it for a long time now and the formatting may not be quite as aligned as it once was with the Roy G Biv intent of services starting and also we've added many services so in organization might be in order)
//    Namely this should makeextensive use of the verbosity flag that we've put in the initialization however it's in this file and it would need to then of course be communicated with whatever file you move this initialization to...that is if you ever move this function to another file, it you know it's up to you
//    There are also just little colored issues throughout that aren't really that bad but you know here and there some color can get away fromus becausefor example a closing formatof one of the boxes that you're drawing might not becorrectly colored and it starts anyway I don't even want you to think about that too much but you know keep it in mind
async function initializeServer() {
    try {
        // Log server start action to DegenDuel Admin Logs
        AdminLogger.logAction(process.env.BRANCH_MANAGER_WALLET_ADDRESS, 'SERVER', 'START');

        // Simple initialization start message
        console.log('🚀 DegenDuel Initialization Starting');
        console.log('🔍 Swagger docs available at /api-docs');

        // Start amazing initialization logging
        InitLogger.startInitialization();
        const initResults = {};

        // Initialize Databases
        try {
            // Simplified database initialization logs
            logApi.info('\n📊 Database Layer Initialization');
            
            // Initialize PostgreSQL with less verbose logging
            await initPgDatabase();
            InitLogger.logInit('Database', 'PostgreSQL', 'success');
            initResults.Database = { success: true };
            
            // Initialize SQLite with less verbose logging
            await initDatabase();
            InitLogger.logInit('Database', 'SQLite', 'success', { path: '/home/websites/degenduel/data/leaderboard.db' });
            
            // Single summary log after all databases are initialized
            logApi.info('✅ All databases initialized successfully');

            // Initialize WebSocket Layer using the WebSocket Initializer
            try {
                // Consolidated WebSocket initialization log
                logApi.info('\n🔌 WebSocket Layer Initialization');
                
                // Initialize all WebSocket servers with a single call to the dedicated initializer
                await WebSocketInitializer.initializeWebSockets(server, initResults);
                logApi.info('✅ All WebSocket servers initialized successfully');
                
                // Initialize Services Layer with simplified logging
                logApi.info('\n🛠️ Services Layer Initialization');
                
                try {
                    // Register core services with minimal logging
                    await ServiceInitializer.registerCoreServices().catch(error => {
                        logApi.error(`Failed to register core services: ${error.message}`);
                        throw error;
                    });
                    
                    // Initialize all services
                    const results = await ServiceInitializer.initializeServices().catch(error => {
                        logApi.error(`Failed to initialize services: ${error.message}`);
                        throw error;
                    });

                    // Store results for summary
                    initResults.Services = {
                        initialized: Array.isArray(results?.initialized) ? results.initialized : [],
                        failed: Array.isArray(results?.failed) ? results.failed : []
                    };
                    
                    const successCount = initResults.Services.initialized.length;
                    const failedCount = initResults.Services.failed.length;

                    // Always log failed services regardless of verbosity setting
                    if (initResults.Services.failed.length > 0) {
                        logApi.warn(`Failed services: ${initResults.Services.failed.join(', ')}`);
                    }
                    
                    // Single summary log for service initialization
                    logApi.info(`✅ Services initialized: ${successCount} succeeded, ${failedCount} failed`);

                } catch (error) {
                    // Simplified error logging for service initialization
                    logApi.error(`Service initialization failed: ${error.message}`);
                    
                    // Only show stack trace in verbose mode
                    if (VERBOSE_SERVICE_INIT_LOGS) {
                        logApi.error('Error details:', {
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
                // Simplified WebSocket error logging
                logApi.error(`WebSocket initialization failed: ${error.message}`);
                
                // Only show detailed error in verbose mode
                if (VERBOSE_SERVICE_INIT_LOGS) {
                    logApi.error('WebSocket error details:', error);
                }
                
                initResults.WebSocket = { success: false, error: error.message };
                throw error;
            }

        } catch (error) {
            // Display server startup error with simplified formatting
            logApi.error(`❌ SERVER INITIALIZATION FAILED: ${error.message}`);
            
            // Only show detailed error in verbose mode
            if (VERBOSE_SERVICE_INIT_LOGS) {
                logApi.error('Full error details:', error);
            }
            
            // Only show animation if enabled
            if (SHOW_STARTUP_ANIMATION) {
                await displayStartupAnimation(port, initResults, false);
            }
            
            process.exit(1);
        }

        // Set up shutdown handlers
        setupShutdownHandlers();
        
        // Start the server with simplified logging
        server.listen(port, async () => {
            // Log server start with Logtail-friendly formatting
            logApi.info(`🚀 Server listening on port ${port}`, {
                service: 'SYSTEM',
                event_type: 'server_start',
                port: port,
                uptime: process.uptime()
            });
            
            // Generate initialization summary
            InitLogger.summarizeInitialization(true);
            
            // Only show animation if enabled
            if (SHOW_STARTUP_ANIMATION) {
                try {
                    // Get current services status for the animation
                    const servicesList = ServiceInitializer.getServiceNames();
                    const initializedServices = servicesList.filter(name => {
                        const service = serviceManager.services.get(name);
                        return service && service.isInitialized;
                    });
                    
                    // Pass the simplified status data to the animation
                    await displayStartupAnimation(port, {
                        Database: { success: true },
                        WebSocket: { success: true },
                        Services: {
                            initialized: initializedServices,
                            failed: []
                        },
                        duration: process.uptime()
                    }, true);
                } catch (error) {
                    // Fallback to simpler animation if there's an error
                    await displayStartupAnimation(port, {}, true);
                }
            } else {
                logApi.info(`DegenDuel API Server ready on port ${port}`);
            }
        });
        
        return true;
    } catch (error) {
        // Log server initialization failure with simplified formatting
        logApi.error(`❌ Failed to initialize server: ${error.message}`, {
            service: 'SYSTEM',
            event_type: 'server_initialization_failure',
            error: error.message
        });
        
        // Log detailed error only in verbose mode
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.error('Error details:', {
                stack: error.stack
            });
        }
        
        // Generate initialization summary even on failure
        try {
            InitLogger.summarizeInitialization(true);
        } catch (summaryError) {
            // Don't let summary generation failure prevent clean exit
        }
        
        process.exit(1);
    }
}

// Handle graceful shutdown with simplified logging
async function shutdown() {
  try {
    logApi.info('⏳ Server shutdown initiated');
    
    // Start shutdown timer to enforce timeout
    const SHUTDOWN_TIMEOUT_MS = 30000; // 30 seconds max for shutdown
    const shutdownTimer = setTimeout(() => {
      logApi.error('TIMEOUT: Forced shutdown after 30 seconds');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    
    // Make sure timer doesn't keep process alive
    shutdownTimer.unref();
    
    // Track all shutdown operations
    const shutdownOperations = [];
    
    // 1. First stop the HTTP server to prevent new connections
    shutdownOperations.push(new Promise((resolve) => {
      if (!server) {
        resolve({ component: 'HTTP Server', status: 'skipped', reason: 'not initialized' });
        return;
      }
      
      server.close((err) => {
        if (err) {
          logApi.warn(`HTTP server close warning: ${err.message}`);
          resolve({ component: 'HTTP Server', status: 'warning', error: err.message });
        } else {
          resolve({ component: 'HTTP Server', status: 'success' });
        }
      });
    }));
    
    // 2. Cleanup WebSocket servers
    logApi.info('Cleaning up WebSocket servers...');
    const wsCleanupPromise = WebSocketInitializer.cleanupWebSockets()
      .then(result => ({ component: 'WebSockets', status: 'success', result }))
      .catch(error => ({ component: 'WebSockets', status: 'error', error: error.message }));
    shutdownOperations.push(wsCleanupPromise);

    // 3. Cleanup services 
    logApi.info('Cleaning up services...');
    const serviceCleanupPromise = ServiceInitializer.cleanup()
      .then(result => ({ component: 'Services', status: 'success', result }))
      .catch(error => ({ component: 'Services', status: 'error', error: error.message }));
    shutdownOperations.push(serviceCleanupPromise);
    
    // 4. Close databases using the new utility
    logApi.info('Closing databases...');
    const databaseCleanupPromise = databaseCleanup.cleanupAllDatabases()
      .then(result => ({ component: 'Databases', status: result.success ? 'success' : 'warning', result }))
      .catch(error => ({ component: 'Databases', status: 'error', error: error.message }));
    shutdownOperations.push(databaseCleanupPromise);
    
    // Wait for all shutdown operations with detailed results
    const results = await Promise.allSettled(shutdownOperations);
    
    // Count successes and failures
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.status === 'success').length;
    const warnings = results.filter(r => r.status === 'fulfilled' && r.value.status === 'warning').length;
    const failures = results.filter(r => 
      r.status === 'rejected' || 
      (r.status === 'fulfilled' && r.value.status === 'error')
    ).length;
    
    // Cancel the shutdown timer
    clearTimeout(shutdownTimer);
    
    // Print summary
    if (failures > 0) {
      logApi.warn(`Shutdown completed with warnings/errors: ${successful} succeeded, ${warnings} warnings, ${failures} failures`);
      
      // Log the specific failures for debugging
      results.forEach(r => {
        if (r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'error')) {
          const component = r.status === 'rejected' ? 'Unknown' : r.value.component;
          const error = r.status === 'rejected' ? r.reason : r.value.error;
          logApi.error(`Failed component: ${component}, Error: ${error}`);
        }
      });
      
      process.exit(1);
    } else {
      logApi.info('✅ Shutdown completed successfully');
      process.exit(0);
    }
  } catch (error) {
    logApi.error(`❌ Unexpected error during shutdown: ${error.message}`);
    process.exit(1);
  }
}

// Start the server
initializeServer().then(() => {
    // Server is already listening from inside initializeServer()
    logApi.info('Server initialization completed successfully');
}).catch(error => {
    // Log server initialization failure with simplified formatting
    logApi.error(`❌ Failed to initialize server: ${error.message}`);
    process.exit(1);
});