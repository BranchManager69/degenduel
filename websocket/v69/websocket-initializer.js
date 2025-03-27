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
  
  // Log WebSocket module details
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
      wsVersion = 'unknown (failed to read package.json)';
    }
    
    // Get WebSocket constructor to check exports
    const { WebSocket, Server } = await import('ws');
    
    logApi.info(`${fancyColors.BG_BLUE}${fancyColors.BLACK} WS MODULE INFO ${fancyColors.RESET} Using ws library v${wsVersion}`, {
      version: wsVersion,
      path: wsPath,
      WebSocket_exported: typeof WebSocket !== 'undefined',
      Server_exported: typeof Server !== 'undefined',
      event_type: "ws_module_info",
      _highlight: true
    });
  } catch (error) {
    logApi.error(`Failed to get WebSocket module details: ${error.message}`);
  }
  
  // Log the actual server instance for debugging
  logApi.info(`${fancyColors.BG_BLUE}${fancyColors.BLACK} SERVER INFO ${fancyColors.RESET} HTTP Server`, {
    constructor: server.constructor.name,
    address: server.address() || 'not-listening',
    events: Object.keys(server._events || {}),
    maxListeners: server.getMaxListeners(),
    event_type: "server_info",
    _highlight: true
  });

  // Master v69 WebSocket server initialization process
  try {
    logApi.info(`🔌 WebSocket Layer Initialization Starting`, { event_type: "initialization_start", _icon: "🔌", _highlight: true, _color: "#E91E63" });
    logApi.info(`🔹 🔄 [WebSocket] Initialization`, { category: "WebSocket", component: "Initialization", status: "initializing", details: null, _icon: "🔄", _color: "#0078D7", _highlight: false });

    // Initialization tracking
    const initResults = [];
    const initErrors = [];
    
    // Create all WebSocket instances first with a concise log
    const wsServers = {};
    
    // DIAGNOSTIC: Add a test WebSocket server first for troubleshooting
    logApi.info(`🔹 Creating test WebSocket server for diagnostics`, { 
      event_type: "test_websocket_create",
      _highlight: true,
      _color: "#FFA500"
    });
    
    try {
      // Create test web socket server first as a diagnostic
      wsServers.test = await createTestWebSocket(server);
      
      // Log success for test WebSocket
      if (wsServers.test) {
        logApi.info(`✅ Test WebSocket server created successfully at ${wsServers.test.path}`, {
          event_type: "test_websocket_success",
          path: wsServers.test.path,
          _highlight: true,
          _color: "#00AA00"
        });
      } else {
        // This would be a critical error
        logApi.error(`❌ Failed to create test WebSocket server`, {
          event_type: "test_websocket_failure",
          _highlight: true,
          _color: "#FF0000"
        });
        initErrors.push("Failed to create test WebSocket server");
      }
    } catch (testError) {
      logApi.error(`❌ Error creating test WebSocket server: ${testError.message}`, {
        event_type: "test_websocket_error",
        error: testError.message,
        stack: testError.stack,
        _highlight: true,
        _color: "#FF0000"
      });
      initErrors.push(`Test WebSocket error: ${testError.message}`);
    }
    
    // Create each WebSocket server and ensure it's properly initialized
    logApi.info(`🔹 Creating main WebSocket servers...`, {
      event_type: "creating_websocket_servers"
    });
    
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
    
    // Create each WebSocket server with detailed error tracking
    for (const { name, creator } of serverCreators) {
      try {
        logApi.info(`🔄 Creating WebSocket server: ${name}`, {
          wsName: name,
          event_type: "creating_websocket",
          _color: "#0078D7"
        });
        
        const ws = await creator(server);
        
        if (ws) {
          wsServers[name] = ws;
          logApi.info(`✅ WebSocket server created: ${name} at ${ws.path}`, {
            wsName: name,
            path: ws.path,
            event_type: "websocket_created",
            _color: "#00AA00"
          });
          
          // Log the WebSocket server settings for diagnostic purposes
          if (ws.wss && ws.wss.options) {
            logApi.info(`📋 WebSocket server options for ${name}:`, {
              wsName: name,
              options: JSON.stringify(ws.wss.options),
              path: ws.path,
              perMessageDeflate: !!ws.wss.options.perMessageDeflate,
              event_type: "websocket_options",
              _color: "#00BFFF"
            });
          }
        } else {
          logApi.error(`❌ Failed to create WebSocket server: ${name}`, {
            wsName: name,
            event_type: "websocket_creation_failed",
            _color: "#FF0000"
          });
          initErrors.push(`Failed to create ${name} WebSocket server`);
        }
      } catch (error) {
        logApi.error(`❌ Error creating WebSocket server ${name}: ${error.message}`, {
          wsName: name,
          error: error.message,
          stack: error.stack,
          event_type: "websocket_creation_error",
          _color: "#FF0000"
        });
        initErrors.push(`Error creating ${name} WebSocket: ${error.message}`);
      }
    }
    
    // Set global WebSocket servers container
    global.wsServersV69 = wsServers;
    
    // Log summary of created WebSocket servers
    const wsCount = Object.keys(wsServers).length;
    logApi.info(`🔹 Created ${wsCount} WebSocket servers`, {
      count: wsCount,
      servers: Object.keys(wsServers),
      event_type: "websockets_created_summary",
      _color: "#00BFFF"
    });

    // Initialize each WebSocket server
    logApi.info(`🔹 Initializing WebSocket servers...`, {
      event_type: "initializing_websockets"
    });

    // Initialize each WebSocket server with a proper error check for each one
    for (const [name, ws] of Object.entries(wsServers)) {
      try {
        logApi.info(`V69 INIT Initializing WebSocket server at ${ws.path}`);
        // Ensure the initialize method exists before calling it
        if (!ws || typeof ws.initialize !== 'function') {
          throw new Error(`WebSocket server ${name} does not have an initialize method`);
        }
        
        const result = await ws.initialize();
        initResults.push(result);
        
        if (result === true) {
          logApi.info(`V69 INIT SUCCESS WebSocket server at ${ws.path} initialized successfully`);
        } else {
          initErrors.push(`Failed to initialize ${name} WebSocket server`);
          logApi.warn(`V69 INIT FAILED WebSocket server at ${ws.path} failed to initialize`);
        }
      } catch (err) {
        initResults.push(false);
        initErrors.push(`Error initializing ${name} WebSocket: ${err.message}`);
        logApi.error(`V69 INIT ERROR WebSocket server ${name} error: ${err.message}`, err);
      }
    }

    // Check if all initializations were successful
    const allSuccessful = initResults.every(result => result === true);

    // Log a single summary message with the results
    if (allSuccessful) {
      logApi.info(`🔹 v69 WebSocket Servers Ready`, { event_type: "initialization_complete", _icon: "✅", _color: "#00AA00" });
      logApi.info(`🔹 ✅ [WebSocket] V69System | {"count":${Object.keys(wsServers).length},"version":"v69"}`, { category: "WebSocket", component: "V69System", status: "success", details: { count: Object.keys(wsServers).length, version: "v69" }, _icon: "✅", _color: "#00AA00", _highlight: false });
    } else {
      logApi.warn(`🔹 ⚠️ [WebSocket] V69System | {"success":${initResults.filter(r => r === true).length},"failed":${initResults.filter(r => r !== true).length},"version":"v69"}`, { 
        category: "WebSocket", 
        component: "V69System", 
        status: "warning", 
        details: { 
          success: initResults.filter(r => r === true).length,
          failed: initResults.filter(r => r !== true).length,
          errors: initErrors, 
          version: "v69" 
        }, 
        _icon: "⚠️", 
        _color: "#FFA500", 
        _highlight: false 
      });
    }

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
    logApi.info(`🔌 WebSocket cleanup starting`, { event_type: "cleanup_start" });
    
    const servers = Object.keys(global.wsServersV69);
    logApi.info(`WebSocket cleanup: ${servers.length} servers to close`, { count: servers.length });

    // Clean up each WebSocket server in parallel
    const cleanupResults = await Promise.allSettled(
      Object.entries(global.wsServersV69).map(async ([name, ws]) => {
        try {
          if (ws && typeof ws.cleanup === 'function') {
            await ws.cleanup();
            return { name, success: true };
          }
          return { name, success: false, reason: 'No cleanup method' };
        } catch (error) {
          logApi.error(`Failed to clean up ${name} WebSocket: ${error.message}`, error);
          return { name, success: false, reason: error.message };
        }
      })
    );
    
    // Count successful and failed cleanup operations
    const succeeded = cleanupResults.filter(r => r.status === 'fulfilled' && r.value?.success).length;
    const failed = servers.length - succeeded;

    // Log a single summary message
    if (failed === 0) {
      logApi.info(`🔌 WebSocket cleanup complete: All ${succeeded} servers closed successfully`, { 
        event_type: "cleanup_complete",
        success: true,
        count: succeeded
      });
    } else {
      logApi.warn(`🔌 WebSocket cleanup: ${succeeded} servers closed, ${failed} failed`, { 
        event_type: "cleanup_partial",
        success: false,
        succeeded,
        failed
      });
    }

    return failed === 0;
  } catch (error) {
    logApi.error(`WebSocket cleanup error: ${error.message}`, error);
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
  
  // Log cleanup results
  if (cleanupCount > 0) {
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} EVENT CLEANUP ${fancyColors.RESET} Removed ${cleanupCount} null event listeners`, {
      cleanupCount,
      server: server.constructor.name,
      event_type: "event_cleanup",
      _highlight: true
    });
  }
}

export default {
  initializeWebSockets,
  cleanupWebSockets
};