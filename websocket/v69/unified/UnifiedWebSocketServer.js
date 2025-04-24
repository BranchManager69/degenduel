/**
 * UnifiedWebSocketServer.js
 * 
 * Main class for the v69 unified WebSocket server implementation.
 * This file ties together all the modular components of the WebSocket system.
 */

import { WebSocketServer } from 'ws';
import http from 'http';
import { parse as parseUrl } from 'url';
import { v4 as uuidv4 } from 'uuid';
import config from '../../../config/config.js';
import logger from '../../../utils/logger-suite/logger.js';

// Import modular components
import { 
  validateToken, 
  verifySubscriptionPermissions,
  getClientInfo,
  parseMessage,
  formatMessage,
  handleClientError
} from './utils.js';

import {
  registerServiceEvents,
  fetchTerminalData,
  setupServiceListeners
} from './services.js';

import {
  handleMarketDataRequest,
  handlePortfolioRequest,
  handleWalletRequest,
  handleWalletBalanceRequest,
  handleAdminRequest,
  handleSystemRequest,
  handleContestRequest,
  handleUserRequest,
  handleSkyduelRequest,
  handleTerminalRequest
} from './requestHandlers.js';

import {
  handleConnection,
  handleMessage,
  handleClose,
  handleError,
  authenticateClient,
  handleClientSubscribe,
  handleClientUnsubscribe,
  handleClientRequest,
  handleClientCommand,
  broadcastToSubscribers
} from './handlers.js';

// Create a logger instance for the unified WebSocket server
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
      maxPayload: options.maxPayload || 50 * 1024 * 1024, // 50MB default max payload
    });
    
    this.setupServerEvents();
    this.setupServiceEvents();
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
      log.error(`WebSocket server error: ${error.message}`);
    });

    log.info('WebSocket server events configured');
  }

  setupServiceEvents() {
    // Set up service event listeners for broadcasting updates
    setupServiceListeners(this.broadcast.bind(this));
    
    log.info('Service event listeners configured');
  }

  broadcast(topic, data, excludeClientId = null) {
    broadcastToSubscribers(topic, data, this.subscriptions, this.clients, excludeClientId);
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
}