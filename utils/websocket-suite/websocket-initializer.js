// utils/websocket-suite/websocket-initializer.js

/**
 * 
 * This file is responsible for initializing all WebSocket servers.
 * It is called by the service-initializer.js file.
 * It is also responsible for registering the WebSocket servers with the monitor service.
 * It is also responsible for updating the WebSocket servers with the latest metrics.
 * 
 */

import { logApi } from '../logger-suite/logger.js';
import InitLogger from '../logger-suite/init-logger.js';
import { createWebSocketMonitor } from '../../websocket/monitor-ws.js';
import { createCircuitBreakerWebSocket } from '../../websocket/circuit-breaker-ws.js';
import { createAnalyticsWebSocket } from '../../websocket/analytics-ws.js';
import { createPortfolioWebSocket } from '../../websocket/portfolio-ws.js';
import { createMarketDataWebSocket } from '../../websocket/market-ws.js';
import { createWalletWebSocket } from '../../websocket/wallet-ws.js';
import { createContestWebSocket } from '../../websocket/contest-ws.js';
import { createTokenDataWebSocket } from '../../websocket/token-data-ws.js';
import { createUserNotificationWebSocket } from '../../websocket/user-notification-ws.js';
import { createSkyDuelWebSocket } from '../../websocket/skyduel-ws.js';
import { createSystemSettingsWebSocket } from '../../websocket/system-settings-ws.js';
import { fancyColors, serviceColors } from '../colors.js';
// Import v69 WebSocket Initializer
import { initializeWebSockets as initializeWebSocketsV69 } from '../../websocket/v69/websocket-initializer.js';

/**
 * Initialize all WebSocket servers
 * @param {Object} server - HTTP server instance
 * @param {Object} initResults - Object to store initialization results
 * @returns {Object} WebSocket server instances
 */
export async function initializeWebSockets(server, initResults = {}) {
    logApi.info(`\n${fancyColors.ORANGE}┏━━━━━━━━━━━━━━━━━━━━━━━ ${fancyColors.BOLD}${fancyColors.REVERSE}WebSocket Layer${fancyColors.RESET}${fancyColors.ORANGE} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
    logApi.info(`${fancyColors.ORANGE}┣━━━━━━━━━━━ 🔌 Initializing WebSocket Servers...${fancyColors.RESET}`);

    // Log the initialization start
    InitLogger.logInit('WebSocket', 'Initialization', 'initializing');

    try {
        // Initialize WebSocket monitor first
        const wsMonitor = createWebSocketMonitor(server);
        logApi.info(`${fancyColors.ORANGE}┃           ┣━━━━━━━━━━━ ${serviceColors.initializing}Monitor WebSocket initialized${fancyColors.RESET}`);

        // Initialize WebSocket circuit breaker second
        const wsCircuitBreaker = createCircuitBreakerWebSocket(server);
        logApi.info(`${fancyColors.ORANGE}┃           ┣━━━━━━━━━━━ ${serviceColors.initializing}Circuit Breaker WebSocket initialized${fancyColors.RESET}`);

        // Initialize all other WebSocket servers after monitor and circuit breaker
        const wsServers = {
            monitor: wsMonitor,
            circuitBreaker: wsCircuitBreaker,
            analytics: createAnalyticsWebSocket(server),
            portfolio: createPortfolioWebSocket(server),
            market: createMarketDataWebSocket(server),
            wallet: createWalletWebSocket(server),
            contest: createContestWebSocket(server),
            tokenData: createTokenDataWebSocket(server),
            userNotification: createUserNotificationWebSocket(server),
            skyDuel: createSkyDuelWebSocket(server),
            systemSettings: createSystemSettingsWebSocket(server)
        };

        // Initialize each WebSocket server except monitor and circuit breaker
        const initPromises = Object.entries(wsServers)
            .filter(([name]) => name !== 'monitor' && name !== 'circuitBreaker') // TODO: ??? ARE WE SURE ??? Skip monitor and circuit breaker as they're already initialized
            .map(async ([name, ws]) => {
                try {
                    if (ws && typeof ws.initialize === 'function') {
                        // Initialize the WebSocket server
                        await ws.initialize();

                        // Log the successful initialization of the WebSocket server
                        logApi.info(`${fancyColors.ORANGE}┃           ┣━━━━━━━━━━━ ${serviceColors.initialized}${name} WebSocket initialized${fancyColors.RESET}`);

                        // Return the WebSocket server instance
                        return [name, true];
                    } else {
                        // Log the failed initialization of the WebSocket server
                        logApi.warn(`${fancyColors.ORANGE}┃           ┣━━━━━━━━━━━ ${serviceColors.failed}${name} WebSocket has no initialize method${fancyColors.RESET}`);

                        // Return the WebSocket server instance
                        return [name, false];
                    }
                } catch (error) {
                    // Log the failed initialization of the WebSocket server
                    logApi.error(`${fancyColors.ORANGE}┃           ┣━━━━━━━━━━━ ${serviceColors.failed}Failed to initialize ${name} WebSocket:${fancyColors.RESET}`, error);

                    // Return the WebSocket server instance
                    return [name, false];
                }
            });

        // Wait for all WebSocket servers to initialize
        const results = await Promise.all(initPromises);
        
        // Check if any WebSocket servers failed to initialize
        const failedServers = results
            .filter(([, success]) => !success)
            .map(([name]) => name);
        if (failedServers.length > 0) {
            throw new Error(`Failed to initialize WebSocket servers: ${failedServers.join(', ')}`);
        }

        // Log the successful initialization of the WebSocket servers
        logApi.info(`${fancyColors.ORANGE}┃           ┗━━━━━━━━━━━ ${serviceColors.initialized}Service WebSockets Ready${fancyColors.RESET}`);

        // Store WebSocket servers in global registry
        global.wsServers = wsServers; // VERY IMPORTANT!

        // Wait for WebSocket servers to fully initialize
        await new Promise(resolve => setTimeout(resolve, 2500)); // Wait longer than monitor service's 2000ms

        // Default metrics for uninitialized services
        const defaultMetrics = {
            metrics: {
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
                        // Skip Base as it's just a reference class
                        if (name === 'Base') {
                            // Add a base reference with dependencies
                            wsMonitor.monitorService.updateServiceMetrics(name, {
                                ...defaultMetrics,
                                name: "Base WebSocket",
                                dependencies: []
                            });
                        } else {
                            const metrics = instance.getMetrics?.() || defaultMetrics;
                            
                            // Add dependency information based on service type
                            let dependencies = [];
                            if (name !== 'Monitor' && name !== 'Base') {
                                dependencies.push('Base'); // All WebSockets depend on Base
                            }
                            
                            // Add specific dependencies
                            if (name === 'Token Data' || name === 'Market') {
                                dependencies.push('Circuit Breaker');
                            }
                            if (name === 'Contest') {
                                dependencies.push('Token Data');
                            }
                            if (name === 'Portfolio') {
                                dependencies.push('Token Data');
                                dependencies.push('Wallet');
                            }
                            
                            // Update metrics with dependencies
                            wsMonitor.monitorService.updateServiceMetrics(name, {
                                ...metrics,
                                dependencies
                            });
                            
                            logApi.info(`${fancyColors.ORANGE}┃           ┣━━━━━━━━━━━ ${serviceColors.initialized}${name} WebSocket metrics registered${fancyColors.RESET}`);
                        }
                    } catch (error) {
                        logApi.error(`${fancyColors.ORANGE}┃           ┣━━━━━━━━━━━ ${serviceColors.failed}Failed to register ${name} WebSocket metrics:${fancyColors.RESET}`, error);
                    }
                }
            }
            
            logApi.info(`${fancyColors.ORANGE}┃           ┗━━━━━━━━━━━ ${serviceColors.initialized}WebSocket metrics registration complete${fancyColors.RESET}`);
        } catch (error) {
            logApi.error(`${fancyColors.ORANGE}┃           ┗━━━━━━━━━━━ ${serviceColors.failed}Failed to register WebSocket metrics:${fancyColors.RESET}`, error);
        }

        // Log initialization results
        logApi.info(`${fancyColors.ORANGE}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${fancyColors.RESET}`);
        
        // Store initialization results
        if (initResults) {
            initResults.websockets = {
                success: true,
                servers: Object.keys(wsServers)
            };
        }

        // Initialize v69 WebSockets in parallel without affecting existing ones
        try {
            logApi.info(`${fancyColors.CYAN}┣━━━━━━━━━━━ 🚀 Initializing v69 WebSocket Servers...${fancyColors.RESET}`);
            await initializeWebSocketsV69(server);
            logApi.info(`${fancyColors.CYAN}┗━━━━━━━━━━━ ✅ v69 WebSocket Servers Ready${fancyColors.RESET}`);
        } catch (v69Error) {
            logApi.error(`${fancyColors.CYAN}┗━━━━━━━━━━━ ❌ v69 WebSocket initialization failed:${fancyColors.RESET}`, v69Error);
            // Don't throw - allow original WebSockets to continue working
        }

        // Return WebSocket servers
        return wsServers;
    } catch (error) {
        logApi.error(`${fancyColors.ORANGE}┃           ┗━━━━━━━━━━━ ${serviceColors.failed}WebSocket initialization failed:${fancyColors.RESET}`, error);
        logApi.error(`${fancyColors.ORANGE}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${fancyColors.RESET}`);
        
        // Store initialization results
        if (initResults) {
            initResults.websockets = {
                success: false,
                error: error.message
            };
        }
        
        throw error;
    }
}

/**
 * Cleanup all WebSocket connections
 */
export async function cleanupWebSockets() {
    // Check if global.wsServers exists
    if (!global.wsServers) {
        logApi.warn(`${serviceColors.stopping}[WEBSOCKET CLEANUP]${fancyColors.RESET} No WebSocket servers to clean up`);
        return;
    }
    
    // Also clean up v69 WebSockets
    try {
        logApi.info(`${fancyColors.CYAN}┣━━━━━━━━━━━ 🧹 Cleaning up v69 WebSocket Servers...${fancyColors.RESET}`);
        
        // Use the v69 cleanup function if available
        if (typeof global.cleanupWebSocketsV69 === 'function') {
            await global.cleanupWebSocketsV69();
        }
        
        logApi.info(`${fancyColors.CYAN}┗━━━━━━━━━━━ ✅ v69 WebSocket Servers Cleaned Up${fancyColors.RESET}`);
    } catch (v69Error) {
        logApi.error(`${fancyColors.CYAN}┗━━━━━━━━━━━ ❌ v69 WebSocket cleanup failed:${fancyColors.RESET}`, v69Error);
        // Continue with regular cleanup
    }

    logApi.info(`${fancyColors.RED}┣━━━━━━━━━━━ Cleaning up WebSocket servers...${fancyColors.RESET}`);
    InitLogger.logInit('WebSocket', 'Cleanup', 'initializing');
    for (const [name, ws] of Object.entries(global.wsServers)) {
        try {
            // Check if ws exists and has a cleanup method
            if (ws && typeof ws.cleanup === 'function') {
                await ws.cleanup();
                logApi.info(`${fancyColors.RED}┃           ┗━━━━━━━━━━━ ${serviceColors.stopped}✓ ${name} WebSocket cleaned up${fancyColors.RESET}`);
            } else {
                logApi.warn(`${fancyColors.RED}┃           ┗━━━━━━━━━━━ ${serviceColors.warning}⚠ ${name} WebSocket has no cleanup method${fancyColors.RESET}`);
            }
        } catch (error) {
            logApi.error(`${fancyColors.RED}┃           ┗━━━━━━━━━━━ ${serviceColors.failed}✗ Failed to cleanup ${name} WebSocket:${fancyColors.RESET}`, error);
        }
    }
}

export default {
    initializeWebSockets,
    cleanupWebSockets
};