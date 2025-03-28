// utils/websocket-suite/websocket-initializer.js

/**
 * WebSocket Initializer
 * 
 * This file initializes the unified WebSocket system.
 * All WebSocket functionality is consolidated into a single unified system.
 */

import { logApi } from '../logger-suite/logger.js';
import InitLogger from '../logger-suite/init-logger.js';
import { fancyColors } from '../colors.js';

// Import unified WebSocket initializer
import { initializeWebSockets as initializeUnifiedWebSocket } from '../../websocket/v69/websocket-initializer.js';
// Import config for WebSocket access
import config from '../../config/config.js';

/**
 * Initialize the unified WebSocket server
 * @param {Object} server - HTTP server instance
 * @param {Object} initResults - Object to store initialization results
 * @returns {Object} Empty object (all WebSocket access is through config)
 */
export async function initializeWebSockets(server, initResults = {}) {
    if (server && typeof server.setMaxListeners === 'function') {
        server.setMaxListeners(30);
    }
    
    // Clean, PM2-friendly log
    logApi.info('🔌 Initializing Unified WebSocket Server', {
        service: 'WEBSOCKET',
        event_type: 'initialization_start',
        _icon: "🔄",
        _color: "#0078D7"
    });

    try {
        // Check that the websocket section is in config
        if (!config.websocket) {
            logApi.warn('⚠️ WebSocket configuration section missing in config! Using defaults.', {
                _icon: "⚠️",
                _color: "#FFA500" // Orange for warning
            });
            
            // Ensure needed config structure in case it's missing
            config.websocket = {
                unifiedWebSocket: null,
                config: {
                    path: '/api/v69/ws',
                    maxPayload: 1024 * 50,
                    perMessageDeflate: false
                }
            };
        }

        // Initialize the unified WebSocket system
        await initializeUnifiedWebSocket(server);
        
        // Log successful initialization
        logApi.info('✅ Unified WebSocket Server Ready', {
            service: 'WEBSOCKET',
            event_type: 'initialization_complete',
            _icon: '✅',
            _color: '#00AA00' // Green for success
        });
        
        // Update initialization tracking - only track the unified system
        InitLogger.logInit('WebSocket', 'UnifiedWebSocket', 'success', {
            path: config.websocket.config.path
        });

        // Store initialization results
        if (initResults) {
            initResults.websockets = {
                success: true,
                servers: ['unified'],
                message: 'Unified WebSocket initialized successfully'
            };
        }

        // Return empty object - all access is through config.websocket
        return {};
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
        InitLogger.logInit('WebSocket', 'UnifiedWebSocket', 'error', { 
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
 * Cleanup the unified WebSocket server before shutdown
 * @returns {Promise<Object>} - Cleanup results
 */
export async function cleanupWebSockets() {
  try {
    logApi.info(`🔌 Cleaning up Unified WebSocket Server`, { 
      event_type: "cleanup_start", 
      _icon: "🧹", 
      _color: "#E91E63" 
    });
    
    // Check if unified WebSocket exists in config
    if (!config.websocket?.unifiedWebSocket) {
      logApi.info(`No WebSocket server to clean up`, { 
        event_type: "cleanup_skip", 
        _icon: "ℹ️", 
        _color: "#0078D7" 
      });
      return { success: true, message: "No WebSocket server to clean up" };
    }
    
    // Get reference to the unified WebSocket
    const unifiedWs = config.websocket.unifiedWebSocket;
    
    try {
      // Call cleanup method if it exists
      if (typeof unifiedWs.cleanup === 'function') {
        await unifiedWs.cleanup();
        
        // Clear the reference in config
        config.websocket.unifiedWebSocket = null;
        
        logApi.info(`✅ Successfully cleaned up unified WebSocket server`, {
          event_type: "cleanup_complete",
          _icon: "✅",
          _color: "#00AA00" // Green for success
        });
        
        return {
          success: true,
          message: "Unified WebSocket server cleaned up successfully"
        };
      } else {
        logApi.warn(`⚠️ Unified WebSocket server has no cleanup method`, {
          event_type: "cleanup_warning",
          _icon: "⚠️",
          _color: "#FFA500" // Orange for warning
        });
        
        return {
          success: false,
          message: "Unified WebSocket server has no cleanup method"
        };
      }
    } catch (error) {
      logApi.error(`❌ Failed to clean up unified WebSocket server: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        _icon: "❌",
        _color: "#FF0000" // Red for error
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  } catch (error) {
    logApi.error(`WebSocket cleanup error: ${error.message}`, error);
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