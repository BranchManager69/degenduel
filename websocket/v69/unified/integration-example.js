/**
 * Integration Example for v69 Unified WebSocket System
 * 
 * This file demonstrates how to integrate the refactored WebSocket system
 * into the main application server.
 */

const http = require('http');
const express = require('express');
const { createUnifiedWebSocket } = require('./index');
const logger = require('../../utils/logger-suite/logger');

// Create a logger instance
const log = logger.forService('WS_INTEGRATION');

/**
 * Example of how to integrate the unified WebSocket system
 * into an Express application server
 */
function integrateUnifiedWebSocket() {
  // Create Express app and HTTP server
  const app = express();
  const server = http.createServer(app);
  
  // Create unified WebSocket server
  const unifiedWs = createUnifiedWebSocket(server, {
    maxPayload: 50 * 1024 * 1024, // 50MB max payload
    // Add other options here as needed
  });
  
  // Handle WebSocket upgrade requests
  server.on('upgrade', (req, socket, head) => {
    // For WebSocket routes, let the unified WebSocket server handle the upgrade
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    
    if (pathname === '/api/v69/ws') {
      // Let the unified WebSocket server handle the upgrade
      unifiedWs.handleUpgrade(req, socket, head);
    } else {
      // Not a WebSocket request for our endpoint, destroy the socket
      socket.destroy();
    }
  });
  
  // Add shutdown handler for graceful shutdown
  function shutdownHandler() {
    log.info('Shutting down...');
    
    // Gracefully close the WebSocket server
    unifiedWs.shutdown();
    
    // Close the HTTP server with a delay to allow WebSocket connections to close
    setTimeout(() => {
      server.close(() => {
        log.info('HTTP server closed');
        process.exit(0);
      });
    }, 2000);
  }
  
  // Listen for termination signals
  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);
  
  // Return server and WebSocket instance
  return { app, server, unifiedWs };
}

/**
 * Example of how to use the integration in your main server file
 */
function exampleUsage() {
  const { app, server, unifiedWs } = integrateUnifiedWebSocket();
  
  // Set up Express routes
  app.get('/', (req, res) => {
    res.send('DegenDuel API Server');
  });
  
  // Start the server
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    log.info(`Server listening on port ${PORT}`);
    log.info(`WebSocket endpoint available at ws://localhost:${PORT}/api/v69/ws`);
  });
}

// Export the integration function
module.exports = {
  integrateUnifiedWebSocket
};

// If this file is run directly, execute the example
if (require.main === module) {
  exampleUsage();
}