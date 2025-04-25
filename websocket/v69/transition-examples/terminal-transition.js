/**
 * Terminal WebSocket Transition Example
 * 
 * This example demonstrates how to migrate from the old terminal-data-ws.js
 * to the new unified WebSocket system.
 */

import express from 'express';
import http from 'http';
import { UnifiedWebSocketServer } from '../unified/index.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import serviceEvents from '../../../utils/service-suite/service-events.js';
import { fetchTerminalData } from '../unified/services.js';
import config from '../../../config/config.js';

class TerminalWsTransitionExample {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Create the unified WebSocket server
    this.unifiedWs = new UnifiedWebSocketServer(this.server, {
      maxPayload: 5 * 1024 * 1024, // 5MB
    });
    
    // Set up HTTP routes
    this.setupRoutes();
    
    // Handle WebSocket upgrades
    this.setupWebSocketHandler();
    
    // Initialize periodic data broadcasts
    this.initializeDataBroadcasts();
  }
  
  /**
   * Set up HTTP routes
   */
  setupRoutes() {
    this.app.get('/', (req, res) => {
      res.send('Terminal WebSocket Transition Example');
    });
    
    this.app.get('/api/terminal/data', async (req, res) => {
      try {
        const terminalData = await fetchTerminalData();
        res.json(terminalData);
      } catch (error) {
        logApi.error(`${fancyColors.RED}Error fetching terminal data:${fancyColors.RESET}`, error);
        res.status(500).json({ error: 'Error fetching terminal data' });
      }
    });
  }
  
  /**
   * Set up WebSocket handling
   */
  setupWebSocketHandler() {
    this.server.on('upgrade', (req, socket, head) => {
      const { pathname } = new URL(req.url, `http://${req.headers.host}`);
      
      // Let our unified WebSocket server handle the upgrade for v69 endpoint
      if (pathname === '/api/v69/ws') {
        this.unifiedWs.handleUpgrade(req, socket, head);
      } else {
        // Close the connection for any other paths
        socket.destroy();
      }
    });
  }
  
  /**
   * Set up periodic data broadcasts
   */
  initializeDataBroadcasts() {
    // Broadcast terminal data updates every 60 seconds
    setInterval(async () => {
      try {
        const terminalData = await fetchTerminalData();
        
        // Broadcast using service events - this will be picked up by the unified WebSocket
        serviceEvents.emit('terminal:broadcast', terminalData);
        
        logApi.info(`${fancyColors.GREEN}Terminal data broadcast successful${fancyColors.RESET}`);
      } catch (error) {
        logApi.error(`${fancyColors.RED}Error broadcasting terminal data:${fancyColors.RESET}`, error);
      }
    }, 60000);
  }
  
  /**
   * Start the server
   */
  start(port = 3000) {
    this.server.listen(port, () => {
      logApi.info(`${fancyColors.GREEN}Terminal WebSocket transition example running on port ${port}${fancyColors.RESET}`);
      logApi.info(`${fancyColors.GREEN}WebSocket endpoint: ws://localhost:${port}/api/v69/ws${fancyColors.RESET}`);
    });
  }
  
  /**
   * Graceful shutdown
   */
  shutdown() {
    logApi.info(`${fancyColors.YELLOW}Shutting down server...${fancyColors.RESET}`);
    
    // Shutdown WebSocket server gracefully
    this.unifiedWs.shutdown();
    
    // Close HTTP server
    this.server.close(() => {
      logApi.info(`${fancyColors.YELLOW}HTTP server closed${fancyColors.RESET}`);
    });
  }
}

// Client-side transition example (for reference)
const clientExample = `
// ----------------------------------------------------------------------------------
// OLD WAY: Terminal Data WebSocket (dedicated connection)
// ----------------------------------------------------------------------------------
const oldTerminalWs = new WebSocket('wss://api.example.com/api/v69/ws/terminal-data');

oldTerminalWs.onopen = () => {
  console.log('Connected to terminal data WebSocket');
};

oldTerminalWs.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received terminal data:', data);
};

// ----------------------------------------------------------------------------------
// NEW WAY: Unified WebSocket with Topic Subscriptions
// ----------------------------------------------------------------------------------
const newUnifiedWs = new WebSocket('wss://api.example.com/api/v69/ws');

newUnifiedWs.onopen = () => {
  console.log('Connected to unified WebSocket');
  
  // Subscribe to terminal data topic
  newUnifiedWs.send(JSON.stringify({
    type: '${config.websocket.messageTypes.SUBSCRIBE}',
    topic: '${config.websocket.topics.TERMINAL}'
  }));
  
  // Request initial terminal data
  newUnifiedWs.send(JSON.stringify({
    type: '${config.websocket.messageTypes.REQUEST}',
    topic: '${config.websocket.topics.TERMINAL}',
    action: 'getTerminalData'
  }));
};

newUnifiedWs.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  // Handle terminal data messages
  if (message.topic === '${config.websocket.topics.TERMINAL}') {
    console.log('Received terminal data:', message.data);
  }
};
`;

// Export the example class
export default new TerminalWsTransitionExample();

// If this file is run directly
if (import.meta.url === import.meta.main) {
  const port = process.env.PORT || 3000;
  const app = new TerminalWsTransitionExample();
  app.start(port);
  
  // Handle graceful shutdown
  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, () => {
      app.shutdown();
      process.exit(0);
    });
  });
}