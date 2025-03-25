/**
 * WebSocket Initializer (v69)
 * 
 * This module initializes all v69 WebSocket servers and makes them available globally.
 * It runs in parallel with the original WebSocket system without interfering.
 */

import http from 'http';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';

// Import WebSocket server factories
import { createMonitorWebSocket } from './monitor-ws.js';
import { createContestWebSocket } from './contest-ws.js';
import { createCircuitBreakerWebSocket } from './circuit-breaker-ws.js';
import { createUserNotificationWebSocket } from './user-notification-ws.js';
import { createTokenDataWebSocket } from './token-data-ws.js';
import { createSkyDuelWebSocket } from './skyduel-ws.js';
import { createSystemSettingsWebSocket } from './system-settings-ws.js';
import { createAnalyticsWebSocket } from './analytics-ws.js';
import { createPortfolioWebSocket } from './portfolio-ws.js';
import { createWalletWebSocket } from './wallet-ws.js';

// Initialize global v69 WebSocket container
global.wsServersV69 = global.wsServersV69 || {};

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

  try {
    logApi.info(`\n${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 SYSTEM ${fancyColors.RESET} ${fancyColors.OCEAN}┏━━━━━━━━━━━━━━━━━━━━━━━ ${fancyColors.BOLD}${fancyColors.WHITE}WebSocket Initialization${fancyColors.RESET}${fancyColors.OCEAN} ━━━━━━━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}Initializing v69 WebSocket Servers...${fancyColors.RESET}                                    ${fancyColors.OCEAN}┃${fancyColors.RESET}`);

    // Create WebSocket instances
    const monitorWs = createMonitorWebSocket(server);
    global.wsServersV69.monitor = monitorWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Monitor WebSocket                                              ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    // Create Contest WebSocket
    const contestWs = createContestWebSocket(server);
    global.wsServersV69.contest = contestWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Contest WebSocket                                              ${fancyColors.OCEAN}┃${fancyColors.RESET}`);

    // Create Circuit Breaker WebSocket
    const circuitBreakerWs = createCircuitBreakerWebSocket(server);
    global.wsServersV69.circuitBreaker = circuitBreakerWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Circuit Breaker WebSocket                                      ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    // Create User Notification WebSocket
    const userNotificationWs = createUserNotificationWebSocket(server);
    global.wsServersV69.userNotification = userNotificationWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created User Notification WebSocket                                    ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    // Create Token Data WebSocket
    const tokenDataWs = createTokenDataWebSocket(server);
    global.wsServersV69.tokenData = tokenDataWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Token Data WebSocket                                           ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    // Create SkyDuel WebSocket
    const skyDuelWs = createSkyDuelWebSocket(server);
    global.wsServersV69.skyDuel = skyDuelWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created SkyDuel WebSocket                                             ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    // Create System Settings WebSocket
    const systemSettingsWs = createSystemSettingsWebSocket(server);
    global.wsServersV69.systemSettings = systemSettingsWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created System Settings WebSocket                                     ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    // Create Analytics WebSocket
    const analyticsWs = createAnalyticsWebSocket(server);
    global.wsServersV69.analytics = analyticsWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Analytics WebSocket                                           ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    // Create Portfolio WebSocket
    const portfolioWs = createPortfolioWebSocket(server);
    global.wsServersV69.portfolio = portfolioWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Portfolio WebSocket                                           ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    // Create Wallet WebSocket
    const walletWs = createWalletWebSocket(server);
    global.wsServersV69.wallet = walletWs;
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}•${fancyColors.RESET} Created Wallet WebSocket                                              ${fancyColors.OCEAN}┃${fancyColors.RESET}`);

    // Initialize all WebSocket servers
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}Starting initialization...${fancyColors.RESET}                                          ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    const initResults = await Promise.all([
      monitorWs.initialize(),
      contestWs.initialize(),
      circuitBreakerWs.initialize(),
      userNotificationWs.initialize(),
      tokenDataWs.initialize(),
      skyDuelWs.initialize(),
      systemSettingsWs.initialize(),
      analyticsWs.initialize(),
      portfolioWs.initialize(),
      walletWs.initialize()
    ]);

    // Check if all initializations were successful
    const allSuccessful = initResults.every(result => result === true);

    if (allSuccessful) {
      logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SUCCESS ${fancyColors.RESET} ${fancyColors.GREEN}${fancyColors.BOLD}All WebSocket servers initialized successfully${fancyColors.RESET}                  ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    } else {
      logApi.warn(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} WARNING ${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.BOLD}Some WebSocket servers failed to initialize${fancyColors.RESET}                  ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    }

    // Print endpoint info
    printWebSocketEndpoints();
    
    logApi.info(`${fancyColors.OCEAN}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${fancyColors.RESET}`);

    return allSuccessful;
  } catch (error) {
    logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 SYSTEM ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} CRITICAL ERROR ${fancyColors.RESET} ${fancyColors.RED}${error.message}${fancyColors.RESET}`, error);
    logApi.error(`${fancyColors.OCEAN}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${fancyColors.RESET}`);
    return false;
  }
}

/**
 * Print WebSocket endpoints information
 */
function printWebSocketEndpoints() {
  const endpoints = [
    { 
      name: 'Monitor WebSocket', 
      path: '/api/v69/ws/monitor',
      channels: ['system.status', 'system.alerts', 'system.metrics'],
      events: ['get_metrics', 'subscribe_metric', 'unsubscribe_metric', 'get_service_status']
    },
    { 
      name: 'Contest WebSocket', 
      path: '/api/v69/ws/contest',
      channels: ['contest.updates', 'contest.entries', 'contest.results'],
      events: ['join_contest', 'leave_contest', 'get_contest_data', 'subscribe_contest']
    },
    { 
      name: 'Circuit Breaker WebSocket', 
      path: '/api/v69/ws/circuit-breaker',
      channels: ['circuit.status', 'circuit.alerts', 'circuit.history'],
      events: ['get_status', 'reset_circuit', 'subscribe_service', 'unsubscribe_service']
    },
    { 
      name: 'User Notification WebSocket', 
      path: '/api/v69/ws/notifications',
      channels: ['notifications.all', 'notifications.system', 'notifications.personal'],
      events: ['mark_read', 'get_notifications', 'clear_notifications']
    },
    { 
      name: 'Token Data WebSocket', 
      path: '/api/v69/ws/token-data',
      channels: ['public.tokens', 'public.market', 'token.[symbol]'],
      events: ['subscribe_tokens', 'unsubscribe_tokens', 'get_token', 'get_all_tokens']
    },
    { 
      name: 'Portfolio WebSocket', 
      path: '/api/v69/ws/portfolio',
      channels: ['portfolio.[walletAddress]', 'trades.[walletAddress]', 'performance.[walletAddress]'],
      events: ['subscribe_portfolio', 'unsubscribe_portfolio', 'get_portfolio_history', 'get_portfolio_performance']
    },
    { 
      name: 'Wallet WebSocket', 
      path: '/api/v69/ws/wallet',
      channels: ['wallet.[walletAddress]', 'transactions.[walletAddress]', 'assets.[walletAddress]'],
      events: ['subscribe_wallet', 'unsubscribe_wallet', 'request_balance', 'request_transactions', 'request_assets']
    },
    { 
      name: 'SkyDuel WebSocket', 
      path: '/api/v69/ws/skyduel',
      channels: ['service.[name]'],
      events: ['get_services', 'subscribe_service', 'unsubscribe_service', 'service_command']
    },
    { 
      name: 'System Settings WebSocket', 
      path: '/api/v69/ws/system-settings',
      channels: ['setting.[key]', 'category.[name]'],
      events: ['get_all_settings', 'get_setting', 'get_category_settings', 'subscribe_setting', 'update_setting']
    },
    { 
      name: 'Analytics WebSocket', 
      path: '/api/v69/ws/analytics',
      channels: ['metrics.[name]', 'dashboard'],
      events: ['track_event', 'subscribe_dashboard', 'subscribe_metric', 'get_active_users', 'get_server_stats']
    }
  ];

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