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
    
    // Clean, PM2-friendly log with no escape sequences
    logApi.info('🔌 WebSocket Layer Initialization Starting', {
        service: 'WEBSOCKET',
        event_type: 'initialization_start'
    });

    // Track initialization with InitLogger
    InitLogger.logInit('WebSocket', 'Initialization', 'initializing');

    try {
        // Initialize WebSocket monitor first
        const wsMonitor = createWebSocketMonitor(server);
        logApi.info('📡 Monitor WebSocket initialized');

        // Initialize WebSocket circuit breaker second
        const wsCircuitBreaker = createCircuitBreakerWebSocket(server);
        logApi.info('🔌 Circuit Breaker WebSocket initialized');

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

        try {
            // Process v69 specific logic
            if (global.wsServersV69) {
                // Add summarization for all WebSocket initialization
                InitLogger.logInit('WebSocket', 'AllSystems', 'success', {
                    legacy: Object.keys(wsServers).length,
                    v69: Object.keys(global.wsServersV69).length
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
        }

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

// Cleanup WebSocket servers before shutdown
/**
 * Cleanup all WebSocket servers before shutdown
 * @returns {Promise<Object>} - Detailed cleanup results
 */
export async function cleanupWebSockets() {
  try {
    logApi.info(`🔌 WebSocket Cleanup Starting`, { event_type: "cleanup_start", _icon: "🧹", _color: "#E91E63" });
    logApi.info(`🔹 🔄 [WebSocket] Cleanup`, { category: "WebSocket", component: "Cleanup", status: "initializing", details: null, _icon: "🔄", _color: "#0078D7", _highlight: false });
    
    // Phase 1: Clean up v69 WebSocket servers
    logApi.info(`🔹 Cleaning up v69 WebSocket Servers`, { event_type: "cleanup_start", _icon: "🧹", _color: "#00BFFF" });
    logApi.info(`🔹 🔄 [WebSocket] V69Cleanup`, { category: "WebSocket", component: "V69Cleanup", status: "initializing", details: null, _icon: "🔄", _color: "#0078D7", _highlight: false });
    
    let v69CleanupSuccess = true;
    let v69Results = { count: 0, success: 0, failed: 0 };
    
    if (global.wsServersV69) {
      // Get v69 servers
      const servers = Object.keys(global.wsServersV69);
      logApi.info(`WebSocket cleanup: ${servers.length} servers to close`, { count: servers.length });
      v69Results.count = servers.length;

      // Clean up each WebSocket server with timeout protection
      const cleanupPromises = Object.entries(global.wsServersV69).map(async ([name, ws]) => {
        const WS_CLEANUP_TIMEOUT = 5000; // 5 second timeout per WebSocket server
        
        try {
          // Create a timeout promise
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Cleanup timeout for ${name}`)), WS_CLEANUP_TIMEOUT);
          });
          
          // Create the cleanup promise
          const cleanupPromise = async () => {
            if (ws && typeof ws.cleanup === 'function') {
              logApi.info(` V69 CLEANUP  Cleaning up WebSocket server at ${ws.path}`);
              await ws.cleanup();
              logApi.info(` V69 CLEANUP   SUCCESS  WebSocket server at ${ws.path} cleaned up successfully (${ws.clients?.size || 0} connections closed)`);
              return { name, success: true, connections: ws.clients?.size || 0 };
            }
            return { name, success: false, reason: 'No cleanup method' };
          };
          
          // Race between timeout and cleanup
          return await Promise.race([cleanupPromise(), timeoutPromise]);
        } catch (error) {
          logApi.error(`Failed to clean up ${name} WebSocket: ${error.message}`);
          return { name, success: false, reason: error.message };
        }
      });
      
      // Wait for all cleanup operations to complete
      const results = await Promise.allSettled(cleanupPromises);
      
      // Count successful cleanup operations
      v69Results.success = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      v69Results.failed = servers.length - v69Results.success;
      v69CleanupSuccess = v69Results.failed === 0;
      
      // Log v69 cleanup status
      if (v69CleanupSuccess) {
        logApi.info(`🔹 v69 WebSocket Servers Cleaned Up`, { event_type: "cleanup_complete", _icon: "✅", _color: "#00AA00" });
        logApi.info(`🔹 ✅ [WebSocket] V69Cleanup`, { category: "WebSocket", component: "V69Cleanup", status: "success", details: null, _icon: "✅", _color: "#00AA00", _highlight: false });
      } else {
        logApi.warn(`🔹 v69 WebSocket Cleanup Incomplete`, { event_type: "cleanup_warning", _icon: "⚠️", _color: "#FFA500" });
        logApi.warn(`🔹 ⚠️ [WebSocket] V69Cleanup`, { category: "WebSocket", component: "V69Cleanup", status: "warning", details: { success: v69Results.success, failed: v69Results.failed }, _icon: "⚠️", _color: "#FFA500", _highlight: true });
      }
    } else {
      logApi.info(`🔹 No v69 WebSocket servers to clean up`, { event_type: "cleanup_skip" });
    }
    
    // Phase 2: No more legacy WebSocket servers to clean up
    // We have fully migrated to v69 WebSockets
    
    // Final cleanup status - only v69 WebSockets now
    const allSuccess = v69CleanupSuccess;
    
    if (allSuccess) {
      // Count number of v69 WebSocket servers cleaned up
      const serverCount = v69Results.count || 0;
      
      logApi.info(`🔌 Successfully cleaned up ${serverCount} WebSocket servers`, { 
        event_type: "cleanup_complete", 
        success_count: serverCount,
        _icon: "✅", 
        _color: "#00AA00",
        _html_message: `
                <span style="background-color:#00AA00;color:white;padding:2px 6px;border-radius:3px;font-weight:bold;">
                    SUCCESS
                </span>
                <span style="font-weight:bold;margin-left:6px;">
                    WebSocket cleanup complete: ${serverCount} servers
                </span>
            `
      });
      logApi.info(`🔹 ✅ [WebSocket] Cleanup | {"count":${serverCount}}`, { 
        category: "WebSocket", 
        component: "Cleanup", 
        status: "success", 
        details: { count: serverCount }, 
        _icon: "✅", 
        _color: "#00AA00", 
        _highlight: false 
      });
    } else {
      logApi.warn(`🔌 WebSocket cleanup incomplete`, { 
        event_type: "cleanup_warning", 
        v69_success_count: v69Results.success,
        v69_failed_count: v69Results.failed,
        _icon: "⚠️", 
        _color: "#FFA500" 
      });
      logApi.warn(`🔹 ⚠️ [WebSocket] Cleanup`, { 
        category: "WebSocket", 
        component: "Cleanup", 
        status: "warning", 
        details: { 
          success_count: v69Results.success, 
          failed_count: v69Results.failed 
        }, 
        _icon: "⚠️", 
        _color: "#FFA500", 
        _highlight: true 
      });
    }

    return {
      success: allSuccess,
      v69: v69Results,
      // No legacy WebSockets anymore
      legacy: {
        count: 0,
        success: 0
      }
    };
  } catch (error) {
    logApi.error(`WebSocket cleanup error: ${error.message}`, error);
    logApi.error(`🔹 ❌ [WebSocket] Cleanup`, { category: "WebSocket", component: "Cleanup", status: "error", details: { error: error.message }, _icon: "❌", _color: "#FF0000", _highlight: true });
    return {
      success: false,
      error: error.message
    };
  }
}

export default {
    initializeWebSockets,
    cleanupWebSockets
};