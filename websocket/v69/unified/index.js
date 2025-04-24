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
  return new UnifiedWebSocketServer(server, options);
}

// Export the class
export { UnifiedWebSocketServer };

// Export message types and topics
export const messageTypes = config.websocket.messageTypes;
export const topics = config.websocket.topics;