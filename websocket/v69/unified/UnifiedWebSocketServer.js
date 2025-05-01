// websocket/v69/unified/UnifiedWebSocketServer.js

/**
 * UnifiedWebSocketServer.js
 * 
 * Main class for the v69 unified WebSocket server implementation.
 * This file ties together all the modular components of the WebSocket system.
 */

import { WebSocketServer } from 'ws';
import { parse as parseUrl } from 'url';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../../../config/prisma.js';
import logger from '../../../utils/logger-suite/logger.js';

// Config
import config from '../../../config/config.js';

// Import modular components
import { 
  validateToken,  // TODO: Why is this not being used?
  verifySubscriptionPermissions, // TODO: Why is this not being used?
  getClientInfo, // TODO: Why is this not being used?
  parseMessage, // TODO: Why is this not being used?
  formatMessage, // <---------------------------------------- That's all we need? Really?
  handleClientError // TODO: Why is this not being used?
} from './utils.js';

import {
  registerServiceEvents,
  fetchTerminalData // TODO: Why is this not being used? (i know; just testing you)
} from './services.js';

import {
  handleRequest,
} from './requestHandlers.js';

// ?
import {
  handleConnection,
  handleMessage,
  handleDisconnect as handleClose,
  handleError,
  authenticateClient,
  handleClientSubscribe,
  handleClientUnsubscribe,
  handleClientRequest,
  handleClientCommand,
  broadcastToSubscribers
} from './handlers.js';

// Create a logger instance for the unified WebSocket server
//   [I'll allow it but this is the only time that I can think of where we use two separate loggers in the same file - 4/30/2025]
const log = logger.forService('UNIFIED_WS');

export default class UnifiedWebSocketServer {
  constructor(server, options = {}) {
    this.server = server;
    this.options = options;
    this.clients = new Map();
    this.subscriptions = {};
    this.authenticatedClients = new Map();
    this.isShuttingDown = false;
    this.initTopicSubscriptions();
    
    // Initialize WebSocket server 
    this.wss = new WebSocketServer({ 
      noServer: true,
      maxPayload: options.maxPayload || 5 * 1024 * 1024, // 5MB default max payload (reduced from 50MB to match config.js)
    });
    
    // Log the actual max payload size used
    const maxPayloadSizeMB = (this.wss.options.maxPayload / (1024 * 1024)).toFixed(2);
    log.info(`WebSocket server configured with maxPayload size: ${maxPayloadSizeMB}MB`);
    
    this.setupServerEvents();
    this.setupServiceEvents();
    
    // Initialize broadcast statistics
    this.broadcastStats = {
      messagesByTopic: {},
      lastReportTime: Date.now(),
      totalMessages: 0
    };
    
    // Set up unified periodic reporting (every minute)
    setInterval(async () => {
      // PART 1: Report connection status
      const clientCount = this.clients.size;
      const authenticatedCount = this.authenticatedClients.size;
      
      // Count clients by topic
      const topicCounts = {};
      Object.entries(this.subscriptions).forEach(([topic, subscribers]) => {
        if (subscribers.size > 0) {
          topicCounts[topic] = subscribers.size;
        }
      });
      
      // Format the topic counts for display
      const topicCountsStr = Object.entries(topicCounts)
        .map(([topic, count]) => `${topic}: ${count}`)
        .join(', ');
      
      log.info(`WebSocket status: ${clientCount} connected clients (${authenticatedCount} authenticated) - Subscriptions: ${topicCountsStr}`);
      
      // PART 2: Report activity summary
      if (this.broadcastStats.totalMessages > 0) {
        const now = Date.now();
        const elapsedSeconds = ((now - this.broadcastStats.lastReportTime) / 1000).toFixed(1);
        const topicStats = Object.entries(this.broadcastStats.messagesByTopic)
          .map(([topic, count]) => `${topic}: ${count}`)
          .join(', ');
          
        log.info(`WebSocket activity: ${this.broadcastStats.totalMessages} messages in past ${elapsedSeconds}s (${topicStats})`);
        
        // PART 3: Store connection metrics in database for long-term analysis
        // Note: We store these in the service_logs table in the main database where other UNIFIED_WS logs are already stored
        try {
          // Store connection stats in the main degenduel database (not market_data or reflections)
          await prisma.service_logs.create({
            data: {
              service: 'UNIFIED_WS',
              level: 'info',
              message: 'WebSocket metrics',
              details: {
                active_connections: clientCount,
                authenticated_connections: authenticatedCount,
                connections_by_topic: topicCounts,
                messages_sent: this.broadcastStats.totalMessages,
                messages_by_topic: this.broadcastStats.messagesByTopic
              },
              event_type: 'websocket_metrics',
              metadata: {
                environment: config.getEnvironment() // Use config helper instead of process.env directly
              }
            }
          });
          
          // Detailed log (once per minute is acceptable) at debug level
          log.debug('Stored WebSocket metrics in database');
        } catch (err) {
          // Don't let database errors break the WebSocket server
          log.error(`Failed to store WebSocket metrics: ${err.message}`);
        }
        
        // Reset activity counters
        this.broadcastStats.messagesByTopic = {};
        this.broadcastStats.totalMessages = 0;
        this.broadcastStats.lastReportTime = now;
      }
    }, 60000); // Report every minute
  }

  initTopicSubscriptions() {
    // Initialize subscription storage for each topic
    Object.values(config.websocket.topics).forEach(topic => {
      this.subscriptions[topic] = new Set();
    });
    
    log.info(`Initialized subscriptions for topics: ${Object.values(config.websocket.topics).join(', ')}`);
  }

  setupServerEvents() {
    // Set up WebSocket server event handlers
    this.wss.on('connection', (ws, req, clientId, initialAuth) => {
      handleConnection(ws, req, clientId, initialAuth, this.clients, this.authenticatedClients, this.subscriptions);
    });

    this.wss.on('error', (error) => {
      // Check if this is a message size limit error
      if (error.message && error.message.includes('received frame size exceeds maximum')) {
        log.error(`WebSocket server error: Message size limit exceeded (${(this.wss.options.maxPayload / (1024 * 1024)).toFixed(2)}MB limit). Error: ${error.message}`, {
          error_type: 'message_size_exceeded',
          maxPayload: this.wss.options.maxPayload,
          maxPayloadMB: (this.wss.options.maxPayload / (1024 * 1024)).toFixed(2),
          _highlight: true
        });
      } else {
        log.error(`WebSocket server error: ${error.message}`);
      }
    });

    log.info('WebSocket server events configured');
  }

  setupServiceEvents() {
    // Set up service event listeners for broadcasting updates
    registerServiceEvents(this);
    
    log.info('Service event listeners configured');
  }

  broadcast(topic, data, excludeClientId = null) {
    broadcastToSubscribers(topic, data, this.subscriptions, this.clients, excludeClientId);
  }
  
  registerEventHandler(event, handler) {
    // Store the event handler
    if (!this.eventHandlers) {
      this.eventHandlers = new Map();
    }
    this.eventHandlers.set(event, handler);
    log.info(`Registered event handler for ${event}`);
  }
  
  broadcastToTopic(topic, data) {
    // This is used by registerServiceEvents
    if (!this.subscriptions[topic]) {
      return;
    }
    
    // Convert to array to iterate safely
    const subscribers = Array.from(this.subscriptions[topic]);
    let sentCount = 0;
    
    for (const ws of subscribers) {
      try {
        // Only send to clients in OPEN state
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(formatMessage(data));
          // Track message sent on the connection object for database
          ws.messagesSent = (ws.messagesSent || 0) + 1;
          sentCount++;
        }
      } catch (error) {
        log.error(`Error sending to client: ${error.message}`);
      }
    }
    
    // Initialize stats collection if not already done
    if (!this.broadcastStats) {
      this.broadcastStats = {
        messagesByTopic: {},
        lastReportTime: Date.now(),
        totalMessages: 0
      };
    }
    
    // Update statistics if messages were sent
    if (sentCount > 0) {
      this.broadcastStats.totalMessages += sentCount;
      this.broadcastStats.messagesByTopic[topic] = (this.broadcastStats.messagesByTopic[topic] || 0) + sentCount;
      
      // Keep the detailed log at debug level for those who want to see it
      log.debug(`Broadcast to ${sentCount} clients on topic ${topic}`);
    }
  }
  
  send(ws, data) {
    // Send data to a specific client
    try {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(formatMessage(data));
        // Track message sent on the connection object for database tracking
        ws.messagesSent = (ws.messagesSent || 0) + 1;
      }
    } catch (error) {
      log.error(`Error sending to client: ${error.message}`);
    }
  }
  
  sendError(ws, message, code = 400) {
    // Send an error to a specific client
    try {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(formatMessage({
          type: config.websocket.messageTypes.ERROR,
          error: message,
          code
        }));
        // Track message sent on the connection object for database tracking
        ws.messagesSent = (ws.messagesSent || 0) + 1;
      }
    } catch (error) {
      log.error(`Error sending error to client: ${error.message}`);
    }
  }

  handleUpgrade(req, socket, head) {
    const { pathname } = parseUrl(req.url);
    
    // Check if the path matches our WebSocket endpoint
    if (pathname === '/api/v69/ws') {
      // Generate a unique client ID
      const clientId = uuidv4();
      
      // Perform WebSocket upgrade
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        // Extract initial auth token if present in query params
        const { query } = parseUrl(req.url, true);
        const initialAuth = query.token || null;
        
        // Emit connection event with the upgraded socket
        this.wss.emit('connection', ws, req, clientId, initialAuth);
      });
    } else {
      // Not a WebSocket upgrade request for our endpoint
      socket.destroy();
    }
  }

  handleRequest(clientId, topic, action, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Route request to appropriate handler based on topic

    // OLD WAY:
    /*
    switch (topic) {
      case config.websocket.topics.MARKET_DATA:
        return handleMarketDataRequest(client, action, data);
      
      case config.websocket.topics.PORTFOLIO:
        return handlePortfolioRequest(client, action, data);
      
      case config.websocket.topics.WALLET:
        return handleWalletRequest(client, action, data);
      
      case config.websocket.topics.WALLET_BALANCE:
        return handleWalletBalanceRequest(client, action, data);
      
      case config.websocket.topics.ADMIN:
        return handleAdminRequest(client, action, data);
      
      case config.websocket.topics.SYSTEM:
        return handleSystemRequest(client, action, data);
      
      case config.websocket.topics.CONTEST:
        return handleContestRequest(client, action, data);
      
      case config.websocket.topics.USER:
        return handleUserRequest(client, action, data);
      
      case config.websocket.topics.SKYDUEL:
        return handleSkyduelRequest(client, action, data);
      
      case config.websocket.topics.TERMINAL:
        return handleTerminalRequest(client, action, data);
      
      default:
        client.send(formatMessage({
          type: config.websocket.messageTypes.ERROR,
          topic,
          error: `Unknown topic: ${topic}`,
          code: 404
        }));
    }
    */
    // NEW WAY:
    try {
      handleRequest(client, action, data);
    } catch (error) {
      log.error(`Error handling request: ${error.message}`);
      // Handle the error gracefully
      if (error.code === 404) {
        client.send(formatMessage({
          type: config.websocket.messageTypes.ERROR,
          topic,
          error: `Unknown topic: ${topic}`,
          code: 404
        }));
      } else {
        // TODO: Add more specific error handling
        client.send(formatMessage({
          type: config.websocket.messageTypes.ERROR,
          topic,
          error: `Unknown error: ${error.message}`,
          code: 500
        }));
      }
    }
  }

  shutdown() {
    log.info('Shutting down Unified WebSocket Server...');
    this.isShuttingDown = true;
    
    // Notify all clients of shutdown
    this.clients.forEach((client, clientId) => {
      try {
        client.send(formatMessage({
          type: config.websocket.messageTypes.SYSTEM,
          topic: config.websocket.topics.SYSTEM,
          action: 'shutdown',
          data: { message: 'Server is shutting down for maintenance', code: 1001 }
        }));
        
        // Close the connection after a brief delay
        setTimeout(() => {
          try {
            client.close(1001, 'Server shutting down');
          } catch (err) {
            log.error(`Error closing client connection: ${err.message}`);
          }
        }, 500);
      } catch (err) {
        log.error(`Error sending shutdown message to client ${clientId}: ${err.message}`);
      }
    });
    
    // Close the WebSocket server
    setTimeout(() => {
      this.wss.close(() => {
        log.info('Unified WebSocket Server successfully shut down');
      });
    }, 1500);
  }
  
  cleanup() {
    log.info('Cleaning up Unified WebSocket Server resources...');
    
    // Clear all subscriptions
    Object.keys(this.subscriptions).forEach(topic => {
      this.subscriptions[topic].clear();
    });
    
    // Clear all clients
    this.clients.clear();
    this.authenticatedClients.clear();
    
    // Remove any event listeners
    if (this.eventHandlers) {
      this.eventHandlers.clear();
    }
    
    log.info('Unified WebSocket Server cleanup completed');
  }
}