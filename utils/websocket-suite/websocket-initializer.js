// utils/websocket-suite/websocket-initializer.js

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

/**
 * Initialize all WebSocket servers
 * @param {Object} server - HTTP server instance
 * @param {Object} initResults - Object to store initialization results
 * @returns {Object} WebSocket server instances
 */
export async function initializeWebSockets(server, initResults = {}) {
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
            contest: createContestWebSocket(server),
            tokenData: createTokenDataWebSocket(server),
            notifications: createUserNotificationWebSocket(server)
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

            // Set success status
            initResults.WebSocket = { success: true };
            return wsServers;

        } catch (error) {
            logApi.warn('Failed to register initial WebSocket metrics:', error);
            throw error;
        }

    } catch (error) {
        logApi.error('\x1b[38;5;196m┃           ✗ WebSocket initialization failed:', error, '\x1b[0m');
        initResults.WebSocket = { success: false, error: error.message };
        throw error;
    }
}

/**
 * Cleanup all WebSocket connections
 */
export async function cleanupWebSockets() {
    // Check if global.wsServers exists
    if (!global.wsServers) {
        logApi.warn('No WebSocket servers to clean up');
        return;
    }

    logApi.info('\x1b[38;5;196m┣━━━━━━━━━━━ Cleaning up WebSocket servers...\x1b[0m');
    for (const [name, ws] of Object.entries(global.wsServers)) {
        try {
            await ws.cleanup();
            logApi.info(`\x1b[38;5;196m┃           ┗━━━━━━━━━━━ ✓ ${name} WebSocket cleaned up\x1b[0m`);
        } catch (error) {
            logApi.error(`\x1b[38;5;196m┃           ┗━━━━━━━━━━━ ✗ Failed to cleanup ${name} WebSocket:`, error);
        }
    }
}

export default {
    initializeWebSockets,
    cleanupWebSockets
};