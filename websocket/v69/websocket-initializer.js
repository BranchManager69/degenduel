// websocket/v69/websocket-initializer.js

/**
 * WebSocket Initializer (v69) - Unified Implementation
 * 
 * This module initializes the unified WebSocket server that handles all topics through
 * a single connection point. It replaces the previous fragmented approach.
 * 
 * @author BranchManager69
 * @version 0.6.9
 */

import http from 'http';
import events from 'events';

// Increase default max listeners to fix MaxListenersExceededWarning
// Each WebSocket server adds several listeners to the same sockets
events.defaultMaxListeners = 30; // Increased from default of 10

// Logger
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import { fancyColors } from '../../utils/colors.js';

// Import config to store WebSocket instance
import config from '../../config/config.js';

// Import the unified WebSocket server
import { createUnifiedWebSocket } from './uni-ws.js';


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
  
  try {
    logApi.info(`🔌 Initializing Unified WebSocket Server`, {
      _icon: "🌟",
      _color: "#FF00FF" // Magenta
    });

    // Initialize just the unified WebSocket server
    const wsServers = {};
    
    // Create and initialize the unified WebSocket
    const unifiedWs = await createUnifiedWebSocket(server);
    
    if (!unifiedWs) {
      throw new Error("Failed to create unified WebSocket server");
    }
    
    // Initialize the WebSocket
    if (typeof unifiedWs.initialize === 'function') {
      await unifiedWs.initialize();
    }
    
    // Store in config object rather than global registry
    // The WebSocket is already stored in config by createUnifiedWebSocket
    
    // Log success
    logApi.info(`✅ Unified WebSocket server initialized successfully at ${unifiedWs.path}`, {
      _icon: "✅",
      _color: "#00AA00", // Green for success
      path: unifiedWs.path
    });
    
    return true;
  } catch (error) {
    logApi.error(`❌ Unified WebSocket initialization failed: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      _icon: "❌",
      _color: "#FF0000" // Red for error
    });
    return false;
  }
}

/**
 * Get metadata for the unified WebSocket endpoint
 * This function exists for backward compatibility with monitoring systems
 * @returns {Object} - A simplified metadata object for the unified WebSocket
 */
function getUnifiedWebSocketMetadata() {
  return {
    unified: {
      path: '/api/v69/ws',
      topics: [
        'market-data',
        'portfolio',
        'system',
        'contest',
        'user',
        'admin',
        'wallet',
        'skyduel'
      ],
      messageTypes: [
        'SUBSCRIBE',
        'UNSUBSCRIBE',
        'REQUEST',
        'COMMAND',
        'DATA',
        'ERROR',
        'SYSTEM',
        'ACKNOWLEDGMENT'
      ]
    }
  };
}

// Cleanup WebSocket servers before shutdown
/**
 * Cleanup the unified WebSocket server before shutdown
 * @returns {Promise<boolean>} - Whether cleanup was successful
 */
export async function cleanupWebSockets() {
  try {
    logApi.info(`🔌 Unified WebSocket cleanup starting`);
    
    // In the unified approach, we only have one WebSocket server to clean up
    const unifiedWs = config.websocket.unifiedWebSocket;
    if (!unifiedWs) {
      logApi.info(`No unified WebSocket server to clean up`);
      return true;
    }
    
    try {
      if (typeof unifiedWs.cleanup === 'function') {
        await unifiedWs.cleanup();
        
        // Clear reference in config after cleanup
        config.websocket.unifiedWebSocket = null;
        
        logApi.info(`✅ Successfully cleaned up unified WebSocket at ${unifiedWs.path}`, {
          _icon: "✅",
          _color: "#00AA00" // Green for success
        });
        return true;
      } else {
        logApi.warn(`⚠️ Unified WebSocket doesn't have a cleanup method`, {
          _icon: "⚠️",
          _color: "#FFA500" // Orange for warning
        });
        return false;
      }
    } catch (error) {
      logApi.error(`❌ Failed to clean up unified WebSocket: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        _icon: "❌",
        _color: "#FF0000" // Red for error
      });
      return false;
    }
  } catch (error) {
    logApi.error(`WebSocket cleanup error: ${error.message}`, error);
    return false;
  }
}

// Register cleanup function globally so the main WebSocket initializer can access it
global.cleanupWebSocketsV69 = cleanupWebSockets;

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
    logApi.info(`Cleaned up ${cleanupCount} null event listeners from server`);
  }
}

export default {
  initializeWebSockets,
  cleanupWebSockets
};