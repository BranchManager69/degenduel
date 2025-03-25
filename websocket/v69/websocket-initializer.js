// websocket/v69/websocket-initializer.js

/**
 * WebSocket Initializer (v69)
 * 
 * This module initializes all v69 WebSocket servers and makes them available globally.
 * It runs in parallel with the original WebSocket system without interfering.
 */
import http from 'http';

// Logger - import before patching
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';

/**
 * CRITICAL PATCH: Override WebSocket Server to disable compression completely
 * 
 * Issue: Despite disabling perMessageDeflate in options, the RSV1 bit is still being set
 * causing "Invalid WebSocket frame: RSV1 must be clear" errors with many clients (wscat, Postman)
 * 
 * Solution: We need to patch the WebSocket internals to prevent the compression extension
 * from being negotiated during handshake.
 * 
 * - Implementation Date: March 25, 2025
 * - Issue: RSV1 compression flag causing client connection failures
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Directly modify the WebSocket code to prevent extensions
try {
  logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS PATCH INIT ${fancyColors.RESET} Starting WebSocket compression patch`);
  
  // Get the WebSocket module path
  const ws = require('ws');
  const WebSocketServer = require('ws/lib/websocket-server');
  const PerMessageDeflate = require('ws/lib/permessage-deflate');
  
  // PATCH 1: Override the extension module completely to prevent ANY extension negotiation
  const extension = require('ws/lib/extension');
  const originalParse = extension.parse;
  const originalFormat = extension.format;
  
  // Completely replace the extension parsing function
  extension.parse = function(header) {
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS PATCH 1 ${fancyColors.RESET} Blocking WebSocket extensions: ${header}`);
    return {}; // Return empty object - no extensions allowed
  };
  
  // Also override the format function to prevent sending extension headers
  extension.format = function(extensions) {
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS PATCH 1b ${fancyColors.RESET} Preventing extension format: ${JSON.stringify(extensions)}`);
    return ''; // Return empty string - no extensions
  };
  
  // PATCH 2: Override the constructor of PerMessageDeflate to disable compression
  const originalPMDConstructor = PerMessageDeflate.prototype.constructor;
  
  // Create a no-op PerMessageDeflate implementation that does nothing
  PerMessageDeflate.prototype.accept = function(configurations) {
    logApi.debug(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS PATCH 2 ${fancyColors.RESET} Intercepting deflate.accept()`);
    return false; // Never accept compression
  };
  
  // PATCH 3: Override WebSocketServer handleUpgrade to disable compression and add detailed logging
  const originalWSConstructor = WebSocketServer.prototype.constructor;
  const originalHandleUpgrade = WebSocketServer.prototype.handleUpgrade;
  
  WebSocketServer.prototype.handleUpgrade = function(req, socket, head, cb) {
    // DETAILED DEBUG: Log all the headers we're dealing with
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS HEADERS ${fancyColors.RESET} Request headers for ${req.url}:`);
    Object.keys(req.headers).forEach(key => {
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS HEADER ${fancyColors.RESET} ${key}: ${req.headers[key]}`);
    });
    
    // Force perMessageDeflate to false in options before proceeding
    if (this.options) {
      this.options.perMessageDeflate = false;
      // Log the full options object
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS OPTIONS ${fancyColors.RESET} Options before calling handleUpgrade: ${JSON.stringify(Object.keys(this.options))}`);
    }
    
    // CRITICAL: Remove any extension headers from the request
    if (req.headers['sec-websocket-extensions']) {
      logApi.warn(`${fancyColors.BG_RED}${fancyColors.WHITE} WS EXTENSION DELETED ${fancyColors.RESET} Removing extension header: ${req.headers['sec-websocket-extensions']}`);
      delete req.headers['sec-websocket-extensions'];
    }
    
    // Call the wrapped function
    const result = originalHandleUpgrade.call(this, req, socket, head, function wrappedCallback(client, request) {
      // Log post-upgrade information
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS UPGRADE COMPLETE ${fancyColors.RESET} Upgraded: ${request.url}`);
      
      // Call the original callback
      return cb(client, request);
    });
    
    return result;
  };
  
  // PATCH 4: Override completeUpgrade to prevent extensions in response headers
  const originalCompleteUpgrade = WebSocketServer.prototype.completeUpgrade;
  
  WebSocketServer.prototype.completeUpgrade = function(extensions, key, protocols, req, socket, head, cb) {
    // Ensure extensions object is empty to prevent any compression headers
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS PATCH 4 ${fancyColors.RESET} Intercepting completeUpgrade: extensions=${JSON.stringify(extensions)}`);
    
    // Replace extensions with empty object
    extensions = {};
    
    // Call original function with modified parameters
    return originalCompleteUpgrade.call(this, extensions, key, protocols, req, socket, head, function(ws, req) {
      // Add modified WebSocket properties to ensure no compression
      if (ws._extensions) {
        logApi.warn(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS PATCH EXTENSIONS ${fancyColors.RESET} Removing _extensions from WebSocket object`);
        ws._extensions = null; // Ensure no extensions are active
      }
      
      // Log successful upgrade
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS CONNECTED ${fancyColors.RESET} WebSocket successfully upgraded for ${req.url}`);
      
      // Call original callback
      return cb(ws, req);
    });
  };
  
  // PATCH 5: Final defense - patch setSocket to ensure no compression
  if (ws.WebSocket && ws.WebSocket.prototype && ws.WebSocket.prototype.setSocket) {
    const originalSetSocket = ws.WebSocket.prototype.setSocket;
    
    ws.WebSocket.prototype.setSocket = function(socket, head, options) {
      // Force compression options off
      if (options) {
        options.perMessageDeflate = false;
      }
      
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS PATCH 5 ${fancyColors.RESET} Patching setSocket to disable compression`);
      
      // Call original method with modified options
      return originalSetSocket.call(this, socket, head, options);
    };
  }
  
  logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS PATCH SUCCESS ${fancyColors.RESET} Successfully patched WebSocket to completely disable compression`);
} catch (error) {
  logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} WS PATCH ERROR ${fancyColors.RESET} Failed to patch WebSocket extensions: ${error.message}`, error);
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
    logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 SYSTEM ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} HTTP server instance is required`);
    return false;
  }

  // Master v69 WebSocket server initialization process
  try {
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 SYSTEM ${fancyColors.RESET} ${fancyColors.OCEAN}┏━━━━━━━━━━━━━━━━━━━━━━━ ${fancyColors.BOLD}${fancyColors.WHITE}WebSocket Initialization${fancyColors.RESET}${fancyColors.OCEAN} ━━━━━━━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}Initializing v69 WebSocket Servers...${fancyColors.RESET}                                    ${fancyColors.OCEAN}┃${fancyColors.RESET}`);

    // Create WebSocket instances

    // (first) Create Monitor WebSocket
    const monitorWs = createMonitorWebSocket(server);
    global.wsServersV69.monitor = monitorWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Monitor WebSocket                                              ${fancyColors.OCEAN}┃${fancyColors.RESET}`);

    // Create Analytics WebSocket
    const analyticsWs = createAnalyticsWebSocket(server);
    global.wsServersV69.analytics = analyticsWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Analytics WebSocket                                           ${fancyColors.OCEAN}┃${fancyColors.RESET}`);

    // Create Circuit Breaker WebSocket
    const circuitBreakerWs = createCircuitBreakerWebSocket(server);
    global.wsServersV69.circuitBreaker = circuitBreakerWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Circuit Breaker WebSocket                                      ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
   
    // Create Contest WebSocket
    const contestWs = createContestWebSocket(server);
    global.wsServersV69.contest = contestWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Contest WebSocket                                              ${fancyColors.OCEAN}┃${fancyColors.RESET}`);

    // Create Portfolio WebSocket
    const portfolioWs = createPortfolioWebSocket(server);
    global.wsServersV69.portfolio = portfolioWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Portfolio WebSocket                                           ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    // Create SkyDuel WebSocket
    const skyDuelWs = createSkyDuelWebSocket(server);
    global.wsServersV69.skyDuel = skyDuelWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created SkyDuel WebSocket                                             ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    // Create System Settings WebSocket
    const systemSettingsWs = createSystemSettingsWebSocket(server);
    global.wsServersV69.systemSettings = systemSettingsWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created System Settings WebSocket                                     ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
     
    // Create Token Data WebSocket
    const tokenDataWs = createTokenDataWebSocket(server);
    global.wsServersV69.tokenData = tokenDataWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Token Data WebSocket                                           ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
 
    // Create User Notification WebSocket
    const userNotificationWs = createUserNotificationWebSocket(server);
    global.wsServersV69.userNotification = userNotificationWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created User Notification WebSocket                                    ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
        
    // Create Wallet WebSocket
    const walletWs = createWalletWebSocket(server);
    global.wsServersV69.wallet = walletWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Wallet WebSocket                                              ${fancyColors.OCEAN}┃${fancyColors.RESET}`);

    // Initialize all WebSocket servers
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}Starting initialization...${fancyColors.RESET}                                          ${fancyColors.OCEAN}┃${fancyColors.RESET}`);    

    const initResults = await Promise.all([
      monitorWs.initialize(), // (first)
      analyticsWs.initialize(),
      circuitBreakerWs.initialize(),
      contestWs.initialize(),
      skyDuelWs.initialize(),
      systemSettingsWs.initialize(),
      portfolioWs.initialize(),
      tokenDataWs.initialize(),
      userNotificationWs.initialize(),
      walletWs.initialize()
    ]);

    // Check if all initializations were successful
    const allSuccessful = initResults.every(result => result === true);

    if (allSuccessful) {
      logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SUCCESS ${fancyColors.RESET} ${fancyColors.GREEN}${fancyColors.BOLD}All WebSocket servers initialized successfully${fancyColors.RESET}                  ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    } else {
      logApi.warn(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} WARNING ${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.BOLD}Some WebSocket servers failed to initialize${fancyColors.RESET}                  ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    }

    // Print v69 WebSocket endpoints info
    printv69WebSocketEndpoints();
    
    logApi.info(`${fancyColors.OCEAN}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${fancyColors.RESET}`);

    return allSuccessful;
  } catch (error) {
    logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 SYSTEM ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} CRITICAL ERROR ${fancyColors.RESET} ${fancyColors.RED}${error.message}${fancyColors.RESET}`, error);
    logApi.error(`${fancyColors.OCEAN}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${fancyColors.RESET}`);
    return false;
  }
}

// Print v69 WebSocket endpoints information
/**
 * Print v69 WebSocket endpoints information
 * @returns {void}
 */
function printv69WebSocketEndpoints() {
  const endpoints = [
    // Analytics WebSocket
    { 
      name:
        'Analytics WebSocket', 
      path:
        '/api/v69/ws/analytics',
      channels: [
        'metrics.[name]', 
        'dashboard'
      ],
      events: [
        'track_event', 
        'subscribe_dashboard', 
        'subscribe_metric', 
        'get_active_users', 
        'get_server_stats'
      ]
    },

    // Circuit Breaker WebSocket
    { 
      name: 
        'Circuit Breaker WebSocket', 
      path: 
        '/api/v69/ws/circuit-breaker',
      channels: [
        'circuit.status', 
        'circuit.alerts', 
        'circuit.history'
      ],
      events: [
        'get_status', 
        'reset_circuit', 
        'subscribe_service', 
        'unsubscribe_service'
      ]
    },

    // Contest WebSocket
    { 
      name: 
        'Contest WebSocket', 
      path: 
        '/api/v69/ws/contest',
      channels: [
        'contest.updates',
        'contest.entries', 
        'contest.results'
      ],
      events: [
        'join_contest', 
        'leave_contest', 
        'get_contest_data', 
        'subscribe_contest'
      ]
    },
    
    // Monitor WebSocket
    { 
      name: 
        'Monitor WebSocket', 
      path: 
        '/api/v69/ws/monitor',
      channels: [
        'system.status', 
        'system.alerts', 
        'system.metrics'
      ],
      events: [
        'get_metrics', 
        'subscribe_metric', 
        'unsubscribe_metric', 
        'get_service_status'
      ]
    },

    // Portfolio WebSocket
    { 
      name: 
        'Portfolio WebSocket', 
      path:
        '/api/v69/ws/portfolio',
      channels: [
        'portfolio.[walletAddress]', 
        'trades.[walletAddress]', 
        'performance.[walletAddress]'
      ],
      events: [
        'subscribe_portfolio', 
        'unsubscribe_portfolio', 
        'get_portfolio_history', 
        'get_portfolio_performance'
      ]
    },

    // SkyDuel WebSocket
    { 
      name:
        'SkyDuel WebSocket', 
      path:
        '/api/v69/ws/skyduel',
      channels: [
        'service.[name]'
      ],
      events: [
        'get_services', 
        'subscribe_service', 
        'unsubscribe_service', 
        'service_command'
      ]
    },

    // System Settings WebSocket
    { 
      name: 
        'System Settings WebSocket', 
      path: 
        '/api/v69/ws/system-settings',
      channels: [
        'setting.[key]', 
        'category.[name]'
      ],
      events: [
        'get_all_settings', 
        'get_setting', 
        'get_category_settings', 
        'subscribe_setting', 
        'update_setting'
      ]
    },

    // Token Data WebSocket
    { 
      name:
        'Token Data WebSocket', 
      path: 
        '/api/v69/ws/token-data',
      channels: [
        'public.tokens', 
        'public.market', 
        'token.[symbol]'
      ],
      events: [
        'subscribe_tokens', 
        'unsubscribe_tokens', 
        'get_token', 
        'get_all_tokens'
      ]
    },

    // User Notification WebSocket
    { 
      name: 
        'User Notification WebSocket', 
      path: 
        '/api/v69/ws/notifications',
      channels: [
        'notifications.all', 
        'notifications.system', 
        'notifications.personal'
      ],
      events: [
        'mark_read', 
        'get_notifications', 
        'clear_notifications'
      ]
    },
    
    // Wallet WebSocket
    { 
      name: 
        'Wallet WebSocket', 
      path: 
        '/api/v69/ws/wallet',
      channels: [
        'wallet.[walletAddress]', 
        'transactions.[walletAddress]', 
        'assets.[walletAddress]'
      ],
      events: [
        'subscribe_wallet', 
        'unsubscribe_wallet', 
        'request_balance', 
        'request_transactions', 
        'request_assets'
      ]
    },
  ];

  // Print header
  logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE} ENDPOINTS ${fancyColors.RESET} Available WebSocket endpoints:                                ${fancyColors.OCEAN}┃${fancyColors.RESET}`);

  // Print all endpoints
  for (const endpoint of endpoints) {
    // Print endpoint path
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET}   ${fancyColors.CYAN}• ${endpoint.name}:${fancyColors.RESET} ${fancyColors.BOLD}${endpoint.path}${fancyColors.RESET}${' '.repeat(Math.max(0, 66 - endpoint.path.length))}${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    // Print available channels/rooms
    if (endpoint.channels && endpoint.channels.length > 0) {
      const channelsStr = endpoint.channels.map(c => `${fancyColors.MAGENTA}${c}${fancyColors.RESET}`).join(', ');
      logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET}     ${fancyColors.YELLOW}↳ Channels:${fancyColors.RESET} ${channelsStr}${' '.repeat(Math.max(0, 70 - channelsStr.length))}${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    }
    
    // Print supported events/messages
    if (endpoint.events && endpoint.events.length > 0) {
      const eventsStr = endpoint.events.map(e => `${fancyColors.GREEN}${e}${fancyColors.RESET}`).join(', ');
      logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET}     ${fancyColors.YELLOW}↳ Events:${fancyColors.RESET} ${eventsStr}${' '.repeat(Math.max(0, 72 - eventsStr.length))}${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    }
  }
}

// Cleanup WebSocket servers before shutdown
/**
 * Cleanup all WebSocket servers before shutdown
 * @returns {Promise<boolean>} - Whether cleanup was successful
 */
export async function cleanupWebSockets() {
  try {
    logApi.info(`\n${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 SYSTEM ${fancyColors.RESET} ${fancyColors.OCEAN}┏━━━━━━━━━━━━━━━━━━━━━━━ ${fancyColors.BOLD}${fancyColors.WHITE}WebSocket Shutdown${fancyColors.RESET}${fancyColors.OCEAN} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}Cleaning up v69 WebSocket servers...${fancyColors.RESET}                                    ${fancyColors.OCEAN}┃${fancyColors.RESET}`);

    const cleanupPromises = [];
    const servers = Object.keys(global.wsServersV69);
    
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}Found ${servers.length} active WebSocket servers to clean up${fancyColors.RESET}                      ${fancyColors.OCEAN}┃${fancyColors.RESET}`);

    // Clean up each WebSocket server
    for (const [name, ws] of Object.entries(global.wsServersV69)) {
      logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Shutting down ${name} WebSocket...                                       ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
      
      if (ws && typeof ws.cleanup === 'function') {
        cleanupPromises.push(
          ws.cleanup().catch(error => {
            logApi.error(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Failed to clean up ${name} WebSocket: ${error.message}${fancyColors.RESET}`, error);
            return false;
          })
        );
      }
    }

    // Wait for all cleanup operations to complete
    const results = await Promise.all(cleanupPromises);
    const allSuccessful = results.every(result => result === true);

    if (allSuccessful) {
      logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SUCCESS ${fancyColors.RESET} ${fancyColors.GREEN}${fancyColors.BOLD}All WebSocket servers cleaned up successfully${fancyColors.RESET}                  ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    } else {
      logApi.warn(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} WARNING ${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.BOLD}Some WebSocket servers failed to clean up${fancyColors.RESET}                    ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    }
    
    logApi.info(`${fancyColors.OCEAN}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${fancyColors.RESET}`);

    return allSuccessful;
  } catch (error) {
    logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 SYSTEM ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} CRITICAL ERROR ${fancyColors.RESET} ${fancyColors.RED}Failed to clean up WebSocket servers: ${error.message}${fancyColors.RESET}`, error);
    logApi.error(`${fancyColors.OCEAN}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${fancyColors.RESET}`);
    return false;
  }
}

// Register cleanup function globally so the main WebSocket initializer can access it
global.cleanupWebSocketsV69 = cleanupWebSockets;

export default {
  initializeWebSockets,
  cleanupWebSockets
};