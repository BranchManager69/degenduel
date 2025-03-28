// websocket/v69/websocket-initializer.js

/**
 * WebSocket Initializer (v69)
 * 
 * This module initializes all v69 WebSocket servers and makes them available globally.
 * It runs in parallel with the original WebSocket system without interfering.
 */
import http from 'http';
import events from 'events';

// Increase default max listeners to fix MaxListenersExceededWarning
// Each WebSocket server adds several listeners to the same sockets
events.defaultMaxListeners = 30; // Increased from default of 10

// Logger - import before patching
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';

/**
 * WebSocket Configuration
 * 
 * Standard WebSocket server configuration
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Set up WebSocket configuration
try {
  // Import directly
  const wsModule = await import('ws');
  const { WebSocket, Server } = wsModule;
  
  // Find the WebSocket version more reliably
  let wsVersion = 'unknown';
  try {
    // Try to get package version using createRequire
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const wsPackage = require('ws/package.json');
    wsVersion = wsPackage.version;
  } catch (versionError) {
    logApi.warn(`Could not determine ws library version: ${versionError.message}`);
  }
  
  // Log WebSocket info
  logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WEBSOCKET CONFIG ${fancyColors.RESET} Using ws library v${wsVersion} with standard configuration`);
  
} catch (error) {
  logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} WEBSOCKET CONFIG ERROR ${fancyColors.RESET} ${error.message}`, error);
}

// Import all v69 WebSocket server factories
import { createAnalyticsWebSocket } from './analytics-ws.js';
import { createCircuitBreakerWebSocket } from './circuit-breaker-ws.js';
import { createContestWebSocket } from './contest-ws.js';
import { createMonitorWebSocket } from './monitor-ws.js';
import { createPortfolioWebSocket } from './portfolio-ws.js';
import { createSkyDuelWebSocket } from './skyduel-ws.js';
import { createSystemSettingsWebSocket } from './system-settings-ws.js';
import { createTokenDataWebSocket } from './token-data-ws.js';
import { createUserNotificationWebSocket } from './user-notification-ws.js';
import { createWalletWebSocket } from './wallet-ws.js';
import { createTestWebSocket } from './test-ws.js';


// Global v69 WebSocket container
global.wsServersV69 = global.wsServersV69 || {};

// Initialize all v69 WebSocket servers
/**
 * Initialize all v69 WebSocket servers
 * @param {http.Server} server - The HTTP server to attach WebSockets to
 * @returns {Promise<boolean>} - Whether initialization was successful
 */
export async function initializeWebSockets(server) {
  if (!server) {
    logApi.error(`HTTP server instance is required for WebSocket initialization`);
    return false;
  }
  
  // CRITICAL FIX: Clean up null event listeners to prevent memory leaks
  cleanupNullEventListeners(server);
  
  // Increase max listeners on the server object to prevent warnings
  server.setMaxListeners(30);
  logApi.info(`Increased HTTP server MaxListeners to 30`, { event_type: "config_update" });
  
  // Log minimal WebSocket module details
  try {
    // Import WS correctly for ES modules
    const wsPath = require.resolve('ws');
    const wsPackagePath = wsPath.replace(/\/index\.js$|\/lib\/websocket\.js$/, '/package.json');
    
    const { readFileSync } = await import('fs');
    let wsVersion;
    
    try {
      // Read package.json directly to get version
      const packageData = JSON.parse(readFileSync(wsPackagePath, 'utf8'));
      wsVersion = packageData.version;
    } catch (err) {
      wsVersion = 'unknown';
    }
    
    // Simple version log
    logApi.info(`WebSocket library v${wsVersion} loaded`);
  } catch (error) {
    logApi.error(`Failed to get WebSocket module details: ${error.message}`);
  }
  
  // Log basic server info (without excessive details)
  logApi.info(`HTTP Server ready for WebSocket connections`, {
    maxListeners: server.getMaxListeners(),
    status: "ready",
    event_type: "server_ready"
  });

  // Master v69 WebSocket server initialization process
  try {
    logApi.info(`🔌 WebSocket System v69 Initialization Starting`);

    // Initialization tracking
    const initResults = [];
    const initErrors = [];
    
    // Create all WebSocket instances first with a concise log
    const wsServers = {};
    
    // Create test WebSocket server first without verbose logging
    try {
      // Create test web socket server first as a diagnostic
      wsServers.test = await createTestWebSocket(server);
      
      // Log minimal success message - details will be in the comprehensive log later
      if (!wsServers.test) {
        logApi.error(`Failed to create test WebSocket server`);
        initErrors.push("Failed to create test WebSocket server");
      }
    } catch (testError) {
      logApi.error(`Error creating test WebSocket server: ${testError.message}`);
      initErrors.push(`Test WebSocket error: ${testError.message}`);
    }
    
    // Create each WebSocket server and ensure it's properly initialized
    
    // Create all WebSocket servers in sequence to better track errors
    const serverCreators = [
      { name: 'monitor', creator: createMonitorWebSocket },
      { name: 'analytics', creator: createAnalyticsWebSocket },
      { name: 'circuitBreaker', creator: createCircuitBreakerWebSocket },
      { name: 'contest', creator: createContestWebSocket },
      { name: 'portfolio', creator: createPortfolioWebSocket },
      { name: 'skyDuel', creator: createSkyDuelWebSocket },
      { name: 'systemSettings', creator: createSystemSettingsWebSocket },
      { name: 'tokenData', creator: createTokenDataWebSocket },
      { name: 'userNotification', creator: createUserNotificationWebSocket },
      { name: 'wallet', creator: createWalletWebSocket }
    ];
    
    // Create each WebSocket server without excessive logging
    // First, collect all server configs
    const serverConfigs = [];
    let totalSuccess = 0;
    let totalFailed = 0;
    
    // Create each WebSocket server quietly
    for (const { name, creator } of serverCreators) {
      try {
        // No log here - reduce noise
        const ws = await creator(server);
        
        if (ws) {
          // Store server and collect its essential config
          wsServers[name] = ws;
          totalSuccess++;
          
          // Collect config info for a single comprehensive log later
          if (ws.wss && ws.wss.options) {
            const options = ws.wss.options;
            serverConfigs.push({
              name,
              path: ws.path,
              config: {
                maxPayload: options.maxPayload ? `${(options.maxPayload / (1024 * 1024)).toFixed(0)} MB` : "default",
                perMessageDeflate: !!options.perMessageDeflate ? "ENABLED" : "DISABLED",
                publicEndpoints: ws.publicEndpoints || [],
                requireAuth: !!ws.requireAuth,
                rateLimit: ws.rateLimiter ? ws.rateLimiter.maxMessagesPerMinute : "none"
              },
              channels: getWebSocketEndpointsMetadata()[name]?.channels || [],
              events: getWebSocketEndpointsMetadata()[name]?.events || []
            });
          }
        } else {
          // Only log failures
          logApi.error(`❌ Failed to create WebSocket server: ${name}`);
          initErrors.push(`Failed to create ${name} WebSocket server`);
          totalFailed++;
        }
      } catch (error) {
        // Only log errors
        logApi.error(`❌ Error creating WebSocket server ${name}: ${error.message}`);
        initErrors.push(`Error creating ${name} WebSocket: ${error.message}`);
        totalFailed++;
      }
    }
    
    // Single comprehensive log with all WebSocket configurations
    logApi.info(`📋 Created ${totalSuccess} WebSocket servers, ${totalFailed} failed`, {
      serverConfigs,
      successCount: totalSuccess,
      failedCount: totalFailed,
      event_type: "websocket_config_summary" 
    });
    
    // Set global WebSocket servers container
    global.wsServersV69 = wsServers;
    
    // Initialize each WebSocket server without verbose logging
    const initDetails = [];
    
    // Initialize each WebSocket server silently
    for (const [name, ws] of Object.entries(wsServers)) {
      try {
        // Ensure the initialize method exists before calling it
        if (!ws || typeof ws.initialize !== 'function') {
          throw new Error(`WebSocket server ${name} does not have an initialize method`);
        }
        
        const result = await ws.initialize();
        initResults.push(result);
        
        initDetails.push({
          name,
          path: ws.path,
          success: result === true,
          status: result === true ? "ready" : "failed"
        });
        
        if (result !== true) {
          initErrors.push(`Failed to initialize ${name} WebSocket server`);
        }
      } catch (err) {
        initResults.push(false);
        initErrors.push(`Error initializing ${name} WebSocket: ${err.message}`);
        
        // Add to init details
        initDetails.push({
          name,
          path: ws?.path || "unknown",
          success: false,
          status: "error",
          error: err.message
        });
      }
    }
    
    // Single comprehensive initialization log
    const successCount = initDetails.filter(d => d.success).length;
    const failCount = initDetails.length - successCount;
    
    logApi.info(`🔌 WebSocket initialization: ${successCount} ready, ${failCount} failed`, {
      initDetails,
      successCount, 
      failCount,
      event_type: "websocket_init_summary"
    });

    // Check if all initializations were successful
    const allSuccessful = initResults.every(result => result === true);

    // We've already logged a comprehensive summary - no need for additional logs
    
    return allSuccessful;
  } catch (error) {
    logApi.error(`❌ WebSocket layer initialization failed: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      event_type: "initialization_failed",
      _color: "#FF0000"
    });
    return false;
  }
}

// Get WebSocket endpoints metadata
/**
 * Get metadata for all WebSocket endpoints
 * @returns {Object} Structured metadata for WebSocket endpoints
 */
function getWebSocketEndpointsMetadata() {
  return {
    analytics: {
      path: '/api/v69/ws/analytics',
      channels: ['metrics.[name]', 'dashboard'],
      events: ['track_event', 'subscribe_dashboard', 'subscribe_metric', 'get_active_users', 'get_server_stats']
    },
    circuitBreaker: {
      path: '/api/v69/ws/circuit-breaker',
      channels: ['circuit.status', 'circuit.alerts', 'circuit.history'],
      events: ['get_status', 'reset_circuit', 'subscribe_service', 'unsubscribe_service']
    },
    contest: {
      path: '/api/v69/ws/contest',
      channels: ['contest.updates', 'contest.entries', 'contest.results'],
      events: ['join_contest', 'leave_contest', 'get_contest_data', 'subscribe_contest']
    },
    monitor: {
      path: '/api/v69/ws/monitor',
      channels: ['system.status', 'system.alerts', 'system.metrics'],
      events: ['get_metrics', 'subscribe_metric', 'unsubscribe_metric', 'get_service_status']
    },
    portfolio: {
      path: '/api/v69/ws/portfolio',
      channels: ['portfolio.[walletAddress]', 'trades.[walletAddress]', 'performance.[walletAddress]'],
      events: ['subscribe_portfolio', 'unsubscribe_portfolio', 'get_portfolio_history', 'get_portfolio_performance']
    },
    skyDuel: {
      path: '/api/v69/ws/skyduel',
      channels: ['service.[name]'],
      events: ['get_services', 'subscribe_service', 'unsubscribe_service', 'service_command']
    },
    systemSettings: {
      path: '/api/v69/ws/system-settings',
      channels: ['setting.[key]', 'category.[name]'],
      events: ['get_all_settings', 'get_setting', 'get_category_settings', 'subscribe_setting', 'update_setting']
    },
    tokenData: {
      path: '/api/v69/ws/token-data',
      channels: ['public.tokens', 'public.market', 'token.[symbol]'],
      events: ['subscribe_tokens', 'unsubscribe_tokens', 'get_token', 'get_all_tokens']
    },
    notifications: {
      path: '/api/v69/ws/notifications',
      channels: ['notifications.all', 'notifications.system', 'notifications.personal'],
      events: ['mark_read', 'get_notifications', 'clear_notifications']
    },
    wallet: {
      path: '/api/v69/ws/wallet',
      channels: ['wallet.[walletAddress]', 'transactions.[walletAddress]', 'assets.[walletAddress]'],
      events: ['subscribe_wallet', 'unsubscribe_wallet', 'request_balance', 'request_transactions', 'request_assets']
    },
    test: {
      path: '/api/v69/ws/test',
      channels: ['test'],
      events: ['echo', 'ping', 'test_compression']
    }
  };
}

// Cleanup WebSocket servers before shutdown
/**
 * Cleanup all WebSocket servers before shutdown
 * @returns {Promise<boolean>} - Whether cleanup was successful
 */
export async function cleanupWebSockets() {
  try {
    logApi.info(`🔌 WebSocket cleanup starting`);
    
    const servers = Object.keys(global.wsServersV69);
    
    // Clean up each WebSocket server in parallel without excessive logging
    const cleanupResults = await Promise.allSettled(
      Object.entries(global.wsServersV69).map(async ([name, ws]) => {
        try {
          if (ws && typeof ws.cleanup === 'function') {
            await ws.cleanup();
            return { name, success: true };
          }
          return { name, success: false, reason: 'No cleanup method' };
        } catch (error) {
          // Only log errors
          logApi.error(`Failed to clean up ${name} WebSocket: ${error.message}`);
          return { name, success: false, reason: error.message };
        }
      })
    );
    
    // Count successful and failed cleanup operations
    const succeeded = cleanupResults.filter(r => r.status === 'fulfilled' && r.value?.success).length;
    const failed = servers.length - succeeded;

    // One concise summary log
    logApi.info(`🔌 WebSocket cleanup: ${succeeded}/${servers.length} servers closed successfully`);

    return failed === 0;
  } catch (error) {
    logApi.error(`WebSocket cleanup error: ${error.message}`);
    return false;
  }
}

// Register cleanup function globally so the main WebSocket initializer can access it
global.cleanupWebSocketsV69 = cleanupWebSockets;

// Add this new function at the end of the file, before the closing exports
/**
 * Clean up null event listeners from a server's event emitter
 * This prevents memory leaks and server slowdown from accumulated null references
 * 
 * @param {http.Server} server - The HTTP server to clean up
 */
function cleanupNullEventListeners(server) {
  if (!server || !server._events) return;
  
  let cleanupCount = 0;
  
  // Go through each event type
  Object.keys(server._events).forEach(eventName => {
    const handlers = server._events[eventName];
    
    // If it's an array of handlers (multiple listeners for same event)
    if (Array.isArray(handlers)) {
      // Filter out null handlers
      const validHandlers = handlers.filter(handler => handler !== null);
      cleanupCount += (handlers.length - validHandlers.length);
      
      // Replace with cleaned array
      if (validHandlers.length === 0) {
        // No valid handlers left, remove the entire event
        delete server._events[eventName];
      } else if (validHandlers.length === 1) {
        // Only one handler left, don't need an array
        server._events[eventName] = validHandlers[0];
      } else {
        // Multiple valid handlers
        server._events[eventName] = validHandlers;
      }
    }
  });
  
  // Only log if something was actually cleaned
  if (cleanupCount > 0) {
    logApi.info(`Removed ${cleanupCount} null event listeners from server`);
  }
}

export default {
  initializeWebSockets,
  cleanupWebSockets
};