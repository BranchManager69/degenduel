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

    // Initialize all WebSocket servers
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}Starting initialization...${fancyColors.RESET}                                          ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
    
    const initResults = await Promise.all([
      monitorWs.initialize(),
      contestWs.initialize(),
      circuitBreakerWs.initialize(),
      userNotificationWs.initialize()
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
    { name: 'Monitor WebSocket', path: '/api/v69/ws/monitor' },
    { name: 'Contest WebSocket', path: '/api/v69/ws/contest' },
    { name: 'Circuit Breaker WebSocket', path: '/api/v69/ws/circuit-breaker' },
    { name: 'User Notification WebSocket', path: '/api/v69/ws/notifications' }
    // Add more WebSocket endpoints as they are implemented
  ];

  logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET} ${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE} ENDPOINTS ${fancyColors.RESET} Available WebSocket endpoints:                                ${fancyColors.OCEAN}┃${fancyColors.RESET}`);
  
  for (const endpoint of endpoints) {
    logApi.info(`${fancyColors.OCEAN}┃${fancyColors.RESET}   ${fancyColors.CYAN}• ${endpoint.name}:${fancyColors.RESET} ${fancyColors.BOLD}${endpoint.path}${fancyColors.RESET}${' '.repeat(Math.max(0, 66 - endpoint.path.length))}${fancyColors.OCEAN}┃${fancyColors.RESET}`);
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