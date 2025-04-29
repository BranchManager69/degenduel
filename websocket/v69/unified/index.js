// websocket/v69/unified/index.js

/**
 * Unified WebSocket System - Main Entry Point
 * 
 * This module creates and exports the unified WebSocket server instance.
 * It serves as the main entry point for the v69 WebSocket system.
 */

import UnifiedWebSocketServer from './UnifiedWebSocketServer.js';
import config from '../../../config/config.js';

/**
 * Creates a new unified WebSocket server instance
 * @param {http.Server} server - HTTP server to attach WebSocket server to
 * @param {Object} options - Configuration options
 * @returns {UnifiedWebSocketServer} The WebSocket server instance
 */
export function createUnifiedWebSocket(server, options = {}) {
  const logger = typeof console === 'object' ? console : { log: () => {} };
  
  // Add diagnostic logs
  logger.log(`🔍 Creating UnifiedWebSocketServer with config: ${JSON.stringify({
    hasConfig: !!config,
    hasWebSocketConfig: !!config.websocket,
    configuredPath: config.websocket?.config?.path || '/api/v69/ws'
  })}`);
  
  // Create the server instance with config settings
  const serverOptions = {
    ...options,
    maxPayload: config.websocket?.config?.maxPayload || 5 * 1024 * 1024 // Use config value or 5MB default
  };
  const wsServer = new UnifiedWebSocketServer(server, serverOptions);
  
  // Store in config
  if (config && config.websocket) {
    config.websocket.unifiedWebSocket = wsServer;
    logger.log(`✅ WebSocket server stored in config.websocket.unifiedWebSocket`);
  } else {
    logger.log(`❌ ERROR: Failed to store WebSocket server in config - config structure invalid`);
  }
  
  return wsServer;
}

// Export the class
export { UnifiedWebSocketServer };

// Export message types and topics
export const messageTypes = config.websocket.messageTypes;
export const topics = config.websocket.topics;