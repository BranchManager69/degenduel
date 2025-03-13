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
// Legacy WebSocket imports
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
// Import v69 WebSocket preferences
import { shouldUseV69, shouldUseLegacy, websocketPreferences } from '../../config/v69-preferences.js';

/**
 * Initialize all WebSocket servers
 * @param {Object} server - HTTP server instance
 * @param {Object} initResults - Object to store initialization results
 * @returns {Object} WebSocket server instances
 */
export async function initializeWebSockets(server, initResults = {}) {
    // Increase the maximum number of listeners to prevent EventEmitter warnings
    // This is necessary because we're attaching multiple WebSocket servers to the same HTTP server
    if (server && typeof server.setMaxListeners === 'function') {
        // Set a higher limit to accommodate all our WebSocket servers
        server.setMaxListeners(20);
        logApi.info('Increased HTTP server MaxListeners to 20', {
            service: 'WEBSOCKET',
            event_type: 'config_update'
        });
    }
    
    // Log initialization start with console formatting
    logApi.info('WebSocket Layer Initialization Starting', {
        service: 'WEBSOCKET',
        event_type: 'initialization_start',
        _icon: '🔌',
        _highlight: true,
        _color: '#E91E63' // Pink/magenta for WebSocket color
    });

    // Track initialization with InitLogger
    InitLogger.logInit('WebSocket', 'Initialization', 'initializing');

    try {
        // Initialize WebSocket monitor first
        const wsMonitor = createWebSocketMonitor(server);
        logApi.info(`${fancyColors.ORANGE}┃           ┣━━━━━━━━━━━ ${serviceColors.initializing}Monitor WebSocket initialized${fancyColors.RESET}`);

        // Initialize WebSocket circuit breaker second
        const wsCircuitBreaker = createCircuitBreakerWebSocket(server);
        logApi.info(`${fancyColors.ORANGE}┃           ┣━━━━━━━━━━━ ${serviceColors.initializing}Circuit Breaker WebSocket initialized${fancyColors.RESET}`);

        // Initialize v69 WebSockets first
        try {
            // Initialize v69 WebSockets
            await initializeWebSocketsV69(server);
            
            // Log successful initialization
            logApi.info('v69 WebSocket Servers Ready', {
                service: 'WEBSOCKET_V69',
                event_type: 'initialization_complete',
                _icon: '✅',
                _color: '#00AA00' // Green for success
            });
            
            // Update initialization status
            InitLogger.logInit('WebSocket', 'V69System', 'success', {
                count: global.wsServersV69 ? Object.keys(global.wsServersV69).length : 0,
                version: 'v69'
            });
        } catch (v69Error) {
            // Log error but continue with legacy initialization
            logApi.error(`v69 WebSocket initialization error: ${v69Error.message}`, {
                service: 'WEBSOCKET_V69',
                event_type: 'initialization_error',
                error: v69Error.message,
                _icon: '⚠️',
                _color: '#FFA500' // Warning color
            });
        }
        
        // Initialize legacy WebSocket servers based on preferences
        const wsServers = {
            // Always include monitor and circuit breaker in legacy for now
            // (They are foundation services)
            monitor: wsMonitor,
            circuitBreaker: wsCircuitBreaker
        };
        
        // Only initialize legacy versions as needed based on preferences
        if (shouldUseLegacy('analytics')) wsServers.analytics = createAnalyticsWebSocket(server);
        if (shouldUseLegacy('portfolio')) wsServers.portfolio = createPortfolioWebSocket(server);
        if (shouldUseLegacy('market')) wsServers.market = createMarketDataWebSocket(server);
        if (shouldUseLegacy('wallet')) wsServers.wallet = createWalletWebSocket(server);
        if (shouldUseLegacy('contest')) wsServers.contest = createContestWebSocket(server);
        if (shouldUseLegacy('tokenData')) wsServers.tokenData = createTokenDataWebSocket(server);
        if (shouldUseLegacy('userNotification')) wsServers.userNotification = createUserNotificationWebSocket(server);
        if (shouldUseLegacy('skyDuel')) wsServers.skyDuel = createSkyDuelWebSocket(server);
        if (shouldUseLegacy('systemSettings')) wsServers.systemSettings = createSystemSettingsWebSocket(server);
        
        // Log which WebSockets are using v69 vs legacy
        logApi.info('WebSocket Preferences Applied', {
            service: 'WEBSOCKET',
            event_type: 'preferences_applied',
            v69_count: Object.keys(websocketPreferences).filter(key => websocketPreferences[key] === 'v69').length,
            legacy_count: Object.keys(websocketPreferences).filter(key => websocketPreferences[key] === 'legacy').length,
            parallel_count: Object.keys(websocketPreferences).filter(key => websocketPreferences[key] === 'parallel').length,
            _icon: '🔀',
            _color: '#8A2BE2' // BlueViolet
        });

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
        logApi.info('WebSocket Services Ready', {
            service: 'WEBSOCKET',
            event_type: 'initialization_complete',
            servers_count: Object.keys(wsServers).length,
            _icon: '✅',
            _color: '#00AA00' // Green for success
        });
        
        // Update initialization status in InitLogger
        InitLogger.logInit('WebSocket', 'Services', 'success', { count: Object.keys(wsServers).length });

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

        // Register v69 WebSockets with monitor service
        try {
            if (wsMonitor && wsMonitor.monitorService && wsMonitor.monitorService.isInitialized && global.wsServersV69) {
                // Log metrics registration start
                logApi.info('Registering v69 WebSocket metrics', {
                    service: 'WEBSOCKET_V69',
                    event_type: 'metrics_registration',
                    _icon: '📊',
                    _color: '#8A2BE2' // BlueViolet
                    });
                
                // Track in InitLogger
                InitLogger.logInit('WebSocket', 'V69Metrics', 'initializing');
                
                let successCount = 0;
                let failureCount = 0;
                
                // Register each v69 WebSocket service with the monitor
                for (const [name, instance] of Object.entries(global.wsServersV69)) {
                    try {
                        const metrics = instance.getMetrics?.() || defaultMetrics;
                        const formattedName = `v69_${name}`;
                        
                        // Add dependency information
                        let dependencies = ['Base'];
                        
                        // Update metrics with dependencies
                        wsMonitor.monitorService.updateServiceMetrics(formattedName, {
                            ...metrics,
                            name: `V69 ${name}`,
                            dependencies,
                            system: 'v69'
                        });
                        
                        // Log individual service success
                        logApi.debug(`Registered metrics for v69 ${name} WebSocket`, {
                            service: 'WEBSOCKET_V69',
                            component: name,
                            event_type: 'metric_registration_success',
                            _color: '#00AA00' // Green for success
                        });
                        
                        successCount++;
                    } catch (error) {
                        // Log individual service failure
                        logApi.error(`Failed to register v69 ${name} WebSocket metrics: ${error.message}`, {
                            service: 'WEBSOCKET_V69',
                            component: name,
                            event_type: 'metric_registration_failure',
                            error: error.message,
                            _color: '#FF0000', // Red for error
                            _highlight: true
                        });
                        
                        failureCount++;
                    }
                }
                
                // Log overall metrics registration result
                if (failureCount === 0) {
                    logApi.info(`Metrics registered for ${successCount} v69 WebSocket services`, {
                        service: 'WEBSOCKET_V69',
                        event_type: 'metrics_registration_complete',
                        success_count: successCount,
                        failure_count: 0,
                        _icon: '✅',
                        _color: '#00AA00' // Green for success
                    });
                    
                    // Update initialization status
                    InitLogger.logInit('WebSocket', 'V69Metrics', 'success', { count: successCount });
                } else {
                    logApi.warn(`Metrics registration incomplete - ${successCount} succeeded, ${failureCount} failed`, {
                        service: 'WEBSOCKET_V69',
                        event_type: 'metrics_registration_partial',
                        success_count: successCount,
                        failure_count: failureCount,
                        _icon: '⚠️',
                        _color: '#FFA500', // Orange for warning
                        _highlight: true
                    });
                    
                    // Update initialization status
                    InitLogger.logInit('WebSocket', 'V69Metrics', 'warning', { 
                        success_count: successCount,
                        failure_count: failureCount 
                    });
                }
            } else {
                // Log monitor service not available warning
                logApi.warn('Monitor service not available for v69 metric registration', {
                    service: 'WEBSOCKET_V69',
                    event_type: 'metrics_registration_skipped',
                    _icon: '⚠️',
                    _color: '#FFA500', // Orange for warning
                    _highlight: true
                });
                
                // Update initialization status
                InitLogger.logInit('WebSocket', 'V69Metrics', 'warning', { reason: 'monitor_unavailable' });
            }
        } catch (metricError) {
            // Log critical error in metrics registration
            logApi.error(`Failed to register v69 WebSocket metrics: ${metricError.message}`, {
                service: 'WEBSOCKET_V69',
                event_type: 'metrics_registration_failure',
                error: metricError.message,
                stack: metricError.stack,
                _icon: '❌',
                _color: '#FF0000', // Red for error
                _highlight: true
            });
            
            // Update initialization status
            InitLogger.logInit('WebSocket', 'V69Metrics', 'error', { 
                error: metricError.message 
            });
        }
    } catch (v69Error) {
        // Log v69 initialization failure
        logApi.error(`v69 WebSocket initialization failed: ${v69Error.message}`, {
            service: 'WEBSOCKET_V69',
            event_type: 'initialization_failure',
            error: v69Error.message,
            stack: v69Error.stack,
            _icon: '❌',
            _color: '#FF0000', // Red for error
            _highlight: true
        });
        
        // Update initialization status
        InitLogger.logInit('WebSocket', 'V69System', 'error', { 
            error: v69Error.message 
        });
        
        // Don't throw - allow original WebSockets to continue working
        }
        
        // Add summarization for all WebSocket initialization
        InitLogger.logInit('WebSocket', 'AllSystems', 'success', {
            legacy: Object.keys(wsServers).length,
            v69: global.wsServersV69 ? Object.keys(global.wsServersV69).length : 0
        });

        // Return WebSocket servers
        return wsServers;
    } catch (error) {
        // Log error with Logtail formatting
        logApi.error(`WebSocket initialization failed: ${error.message}`, {
            service: 'WEBSOCKET',
            event_type: 'initialization_failure',
            error: error.message,
            stack: error.stack,
            _icon: '❌',
            _color: '#FF0000', // Red for error
            _highlight: true
        });
        
        // Update initialization status
        InitLogger.logInit('WebSocket', 'Initialization', 'error', { 
            error: error.message 
        });
        
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
 * @returns {Promise<boolean>} Whether cleanup was successful
 */
export async function cleanupWebSockets() {
    // Check if global.wsServers exists
    if (!global.wsServers) {
        logApi.warn('No WebSocket servers to clean up', {
            service: 'WEBSOCKET',
            event_type: 'cleanup_skipped',
            _color: '#FFA500', // Orange for warning
            _icon: '⚠️'
        });
        return true;
    }
    
    // Log cleanup start with console formatting
    logApi.info('WebSocket Cleanup Starting', {
        service: 'WEBSOCKET',
        event_type: 'cleanup_start',
        _icon: '🧹',
        _color: '#E91E63' // Pink/magenta for WebSocket color
    });
    
    // Track cleanup with InitLogger
    InitLogger.logInit('WebSocket', 'Cleanup', 'initializing');
    
    let allSuccessful = true;
    let successCount = 0;
    let failureCount = 0;
    let v69Success = true;
    
    // First clean up v69 WebSockets
    try {
        // Log v69 cleanup start
        logApi.info('Cleaning up v69 WebSocket Servers', {
            service: 'WEBSOCKET_V69',
            event_type: 'cleanup_start',
            _icon: '🧹',
            _color: '#00BFFF' // Deep sky blue
        });
        
        // Track in InitLogger
        InitLogger.logInit('WebSocket', 'V69Cleanup', 'initializing');
        
        // Use the v69 cleanup function if available
        if (typeof global.cleanupWebSocketsV69 === 'function') {
            await global.cleanupWebSocketsV69();
            
            // Log successful cleanup
            logApi.info('v69 WebSocket Servers Cleaned Up', {
                service: 'WEBSOCKET_V69',
                event_type: 'cleanup_complete',
                _icon: '✅',
                _color: '#00AA00' // Green for success
            });
            
            // Update initialization status
            InitLogger.logInit('WebSocket', 'V69Cleanup', 'success');
        } else {
            // Log warning if cleanup function not available
            logApi.warn('v69 WebSocket cleanup function not available', {
                service: 'WEBSOCKET_V69',
                event_type: 'cleanup_skipped',
                _icon: '⚠️',
                _color: '#FFA500', // Orange for warning
                _html_message: `
                    <span style="background-color:#FFA500;color:black;padding:2px 6px;border-radius:3px;font-weight:bold;">
                        WARNING
                    </span>
                    <span style="margin-left:6px;">
                        v69 WebSocket cleanup function not available
                    </span>
                `
            });
            
            // Update initialization status
            InitLogger.logInit('WebSocket', 'V69Cleanup', 'warning', { reason: 'function_not_available' });
        }
    } catch (v69Error) {
        // Log failure
        logApi.error(`v69 WebSocket cleanup failed: ${v69Error.message}`, {
            service: 'WEBSOCKET_V69',
            event_type: 'cleanup_failure',
            error: v69Error.message,
            stack: v69Error.stack,
            _icon: '❌',
            _color: '#FF0000', // Red for error
            _highlight: true,
            _html_message: `
                <span style="background-color:#FF0000;color:white;padding:2px 6px;border-radius:3px;font-weight:bold;">
                    ERROR
                </span>
                <span style="font-weight:bold;margin-left:6px;color:#FF0000;">
                    v69 WebSocket cleanup failed: ${v69Error.message}
                </span>
            `
        });
        
        // Update initialization status
        InitLogger.logInit('WebSocket', 'V69Cleanup', 'error', { error: v69Error.message });
        
        v69Success = false;
        allSuccessful = false;
    }

    // Then clean up legacy WebSockets
    logApi.info('Cleaning up legacy WebSocket servers', {
        service: 'WEBSOCKET',
        event_type: 'cleanup_progress',
        servers_count: Object.keys(global.wsServers).length,
        _icon: '🧹',
        _color: '#9C27B0', // Purple
        _html_message: `
            <span style="background-color:#9C27B0;color:white;padding:2px 6px;border-radius:3px;">
                CLEANUP
            </span>
            <span style="margin-left:6px;">
                Cleaning up ${Object.keys(global.wsServers).length} legacy WebSocket servers
            </span>
        `
    });
    
    // Clean up each legacy WebSocket server
    for (const [name, ws] of Object.entries(global.wsServers)) {
        try {
            // Check if ws exists and has a cleanup method
            if (ws && typeof ws.cleanup === 'function') {
                await ws.cleanup();
                
                // Log individual service success
                logApi.debug(`Cleaned up ${name} WebSocket`, {
                    service: 'WEBSOCKET',
                    component: name,
                    event_type: 'service_cleanup_success',
                    _color: '#00AA00' // Green for success
                });
                
                successCount++;
            } else {
                // Log warning if cleanup method not available
                logApi.warn(`${name} WebSocket has no cleanup method`, {
                    service: 'WEBSOCKET',
                    component: name,
                    event_type: 'service_cleanup_skipped',
                    _icon: '⚠️',
                    _color: '#FFA500' // Orange for warning
                });
                
                failureCount++;
                allSuccessful = false;
            }
        } catch (error) {
            // Log individual service failure
            logApi.error(`Failed to cleanup ${name} WebSocket: ${error.message}`, {
                service: 'WEBSOCKET',
                component: name,
                event_type: 'service_cleanup_failure',
                error: error.message,
                _icon: '❌',
                _color: '#FF0000', // Red for error
                _highlight: true
            });
            
            failureCount++;
            allSuccessful = false;
        }
    }
    
    // Log overall cleanup result
    if (successCount > 0 && failureCount === 0) {
        logApi.info(`Successfully cleaned up ${successCount} WebSocket servers`, {
            service: 'WEBSOCKET',
            event_type: 'cleanup_complete',
            success_count: successCount,
            v69_success: v69Success,
            _icon: '✅',
            _color: '#00AA00', // Green for success
            _html_message: `
                <span style="background-color:#00AA00;color:white;padding:2px 6px;border-radius:3px;font-weight:bold;">
                    SUCCESS
                </span>
                <span style="font-weight:bold;margin-left:6px;">
                    WebSocket cleanup complete: ${successCount} servers
                </span>
            `
        });
        
        // Update initialization status
        InitLogger.logInit('WebSocket', 'Cleanup', 'success', { 
            count: successCount,
            v69_success: v69Success
        });
    } else {
        logApi.warn(`WebSocket cleanup incomplete - ${successCount} succeeded, ${failureCount} failed`, {
            service: 'WEBSOCKET',
            event_type: 'cleanup_partial',
            success_count: successCount,
            failure_count: failureCount,
            v69_success: v69Success,
            _icon: '⚠️',
            _color: '#FFA500', // Orange for warning
            _highlight: true,
            _html_message: `
                <span style="background-color:#FFA500;color:black;padding:2px 6px;border-radius:3px;font-weight:bold;">
                    WARNING
                </span>
                <span style="font-weight:bold;margin-left:6px;">
                    WebSocket cleanup: ${successCount} succeeded, ${failureCount} failed
                </span>
            `
        });
        
        // Update initialization status
        InitLogger.logInit('WebSocket', 'Cleanup', 'warning', {
            success_count: successCount,
            failure_count: failureCount,
            v69_success: v69Success
        });
    }
    
    // Generate summary log
    InitLogger.summarizeInitialization(false);
    
    return allSuccessful;
}

export default {
    initializeWebSockets,
    cleanupWebSockets
};