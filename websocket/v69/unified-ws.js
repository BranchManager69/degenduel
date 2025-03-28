// websocket/v69/unified-ws.js

/**
 * Unified WebSocket Server
 * 
 * This is a centralized WebSocket implementation that replaces multiple separate WebSocket servers.
 * It uses a topic-based subscription model allowing clients to subscribe to specific data channels.
 * 
 * Features:
 * - Single connection for multiple data types
 * - Topic-based subscriptions
 * - Unified authentication
 * - Centralized error handling and rate limiting
 */

import { WebSocketServer } from 'ws';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import jwt from 'jsonwebtoken';
import prisma from '../../config/prisma.js';

// Config
import config from '../../config/config.js';
const AUTH_DEBUG_MODE = config.debug_modes.auth === true || config.debug_modes.auth === 'true';
logApi.info('AUTH_DEBUG_MODE (unified-ws):', AUTH_DEBUG_MODE);

// Import services as needed
import marketDataService from '../../services/marketDataService.js';
import serviceEvents from '../../utils/service-suite/service-events.js';

// Use message types and topics from config
const MESSAGE_TYPES = config.websocket.messageTypes;
const TOPICS = config.websocket.topics;

/**
 * Unified WebSocket Server
 */
class UnifiedWebSocketServer {
  constructor(httpServer, options = {}) {
    this.path = '/api/v69/ws';
    this.clientsByUserId = new Map();            // userId -> Set of WebSocket connections
    this.clientSubscriptions = new Map();        // client -> Set of topics
    this.topicSubscribers = new Map();           // topic -> Set of WebSocket connections
    this.authenticatedClients = new Map();       // client -> userData
    this.metrics = {
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      subscriptions: 0,
      uniqueClients: 0,
      lastActivity: new Date()
    };
    
    // Service event listeners
    this.eventHandlers = new Map();
    
    // Initialize WebSocket server with compression DISABLED
    this.wss = new WebSocketServer({
      server: httpServer,
      path: this.path,
      maxPayload: 1024 * 50,  // 50KB max payload
      perMessageDeflate: false // EXPLICITLY DISABLE COMPRESSION to avoid client issues
    });
    
    // Set up connection handler
    this.wss.on('connection', this.handleConnection.bind(this));
    
    // Initialize topic handlers
    this.initializeTopicHandlers();
    
    logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.GREEN}Unified WebSocket server initialized at ${this.path}${fancyColors.RESET}`);
  }
  
  /**
   * Initialize handlers for different topics
   */
  initializeTopicHandlers() {
    // Market Data handler
    this.registerEventHandler(
      'market:broadcast', 
      (data) => this.broadcastToTopic(TOPICS.MARKET_DATA, {
        type: MESSAGE_TYPES.DATA,
        topic: TOPICS.MARKET_DATA,
        data: data,
        timestamp: new Date().toISOString()
      })
    );
    
    // Add more topic handlers as needed for other event types
  }
  
  /**
   * Register an event handler for a specific event
   * @param {string} eventName - The event to listen for
   * @param {Function} handler - The handler function
   */
  registerEventHandler(eventName, handler) {
    // Store reference to handler function for cleanup
    this.eventHandlers.set(eventName, handler);
    
    // Register with service events
    serviceEvents.on(eventName, handler);
    
    logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.BLUE}Registered handler for event: ${eventName}${fancyColors.RESET}`);
  }
  
  /**
   * Handle new WebSocket connection
   * @param {WebSocket} ws - WebSocket connection
   * @param {Request} req - HTTP request
   */
  handleConnection(ws, req) {
    try {
      // Set up message handler for this connection
      ws.on('message', (message) => this.handleMessage(ws, message, req));
      
      // Set up close handler
      ws.on('close', () => this.handleDisconnect(ws));
      
      // Set up error handler
      ws.on('error', (error) => this.handleError(ws, error));
      
      // Extract and store all headers for logging and debugging
      const headerEntries = Object.entries(req.headers);
      const importantHeaders = ['host', 'origin', 'user-agent', 'sec-websocket-key', 'sec-websocket-version', 'x-forwarded-for', 'x-real-ip'];
      
      // Add client metadata
      ws.clientInfo = {
        ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        origin: req.headers['origin'],
        host: req.headers['host'],
        connectedAt: new Date(),
        isAuthenticated: false,
        userId: null,
        headers: headerEntries.reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {})
      };
      
      // Initial welcome message
      this.send(ws, {
        type: MESSAGE_TYPES.SYSTEM,
        message: 'Connected to DegenDuel Unified WebSocket',
        serverTime: new Date().toISOString(),
        topics: Object.values(TOPICS)
      });
      
      // Update metrics
      this.metrics.uniqueClients = this.wss.clients.size;
      this.metrics.lastActivity = new Date();
      
      // Log comprehensive connection information
      logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.GREEN}Client connected: ${ws.clientInfo.ip}${fancyColors.RESET}`, {
        ip: ws.clientInfo.ip,
        origin: ws.clientInfo.origin || 'unknown',
        userAgent: ws.clientInfo.userAgent || 'unknown',
        timestamp: new Date().toISOString(),
        important_headers: importantHeaders.reduce((obj, key) => {
          obj[key] = req.headers[key] || 'missing';
          return obj;
        }, {}),
        _icon: "🔌",
        _color: "#00AA00", // Green for successful connection
        _highlight: false
      });
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling connection:${fancyColors.RESET}`, error);
      ws.terminate();
    }
  }
  
  /**
   * Handle incoming message from client
   * @param {WebSocket} ws - WebSocket connection
   * @param {Buffer} rawMessage - Raw message buffer
   * @param {Request} req - Original HTTP request
   */
  async handleMessage(ws, rawMessage, req) {
    try {
      this.metrics.messagesReceived++;
      this.metrics.lastActivity = new Date();
      
      // Parse message
      let message;
      try {
        const messageText = rawMessage.toString();
        message = JSON.parse(messageText);
      } catch (error) {
        return this.sendError(ws, 'Invalid message format. JSON expected.', 4000);
      }
      
      // Validate message structure
      if (!message.type) {
        return this.sendError(ws, 'Message type is required', 4001);
      }
      
      // Process based on message type
      switch (message.type) {
        case MESSAGE_TYPES.SUBSCRIBE:
          await this.handleSubscription(ws, message, req);
          break;
          
        case MESSAGE_TYPES.UNSUBSCRIBE:
          this.handleUnsubscription(ws, message);
          break;
          
        case MESSAGE_TYPES.REQUEST:
          await this.handleRequest(ws, message);
          break;
          
        case MESSAGE_TYPES.COMMAND:
          await this.handleCommand(ws, message);
          break;
          
        default:
          this.sendError(ws, `Unknown message type: ${message.type}`, 4002);
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling message:${fancyColors.RESET}`, error);
      this.metrics.errors++;
      this.sendError(ws, 'Internal server error', 5000);
    }
  }
  
  /**
   * Handle subscription request
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   * @param {Request} req - Original HTTP request
   */
  async handleSubscription(ws, message, req) {
    // Validate topics
    if (!message.topics || !Array.isArray(message.topics) || message.topics.length === 0) {
      return this.sendError(ws, 'Subscription requires at least one topic', 4003);
    }
    
    // Check authorization for restricted topics
    const restrictedTopics = [TOPICS.ADMIN, TOPICS.PORTFOLIO, TOPICS.USER, TOPICS.WALLET];
    const hasRestrictedTopic = message.topics.some(topic => restrictedTopics.includes(topic));
    
    if (hasRestrictedTopic && !ws.clientInfo.isAuthenticated) {
      // Try to authenticate if auth token is provided
      if (message.authToken) {
        try {
          const authToken = message.authToken;
          // Manually verify token instead of using the imported function
          const decoded = jwt.verify(authToken, config.jwt.secret);
          const authData = {
            userId: decoded.wallet_address,
            role: decoded.role
          };
          
          if (!authData || !authData.userId) {
            return this.sendError(ws, 'Authentication required for restricted topics', 4010);
          }
          
          // Update client info
          ws.clientInfo.isAuthenticated = true;
          ws.clientInfo.userId = authData.userId;
          ws.clientInfo.role = authData.role;
          this.authenticatedClients.set(ws, authData);
          
          // Associate this connection with the user ID
          if (!this.clientsByUserId.has(authData.userId)) {
            this.clientsByUserId.set(authData.userId, new Set());
          }
          this.clientsByUserId.get(authData.userId).add(ws);
          
          logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.GREEN}Client authenticated: ${authData.userId}${fancyColors.RESET}`);
        } catch (error) {
          logApi.error(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.RED}Authentication error:${fancyColors.RESET}`, error);
          return this.sendError(ws, 'Invalid authentication token', 4011);
        }
      } else {
        return this.sendError(ws, 'Authentication required for restricted topics', 4010);
      }
    }
    
    // Check for admin-only topics
    if (message.topics.includes(TOPICS.ADMIN) && 
        (!ws.clientInfo.role || !['ADMIN', 'SUPER_ADMIN'].includes(ws.clientInfo.role))) {
      return this.sendError(ws, 'Admin role required for admin topics', 4012);
    }
    
    // Process valid topics
    const validTopics = message.topics.filter(topic => Object.values(TOPICS).includes(topic));
    
    if (validTopics.length === 0) {
      return this.sendError(ws, 'No valid topics provided', 4004);
    }
    
    // Update client subscriptions
    if (!this.clientSubscriptions.has(ws)) {
      this.clientSubscriptions.set(ws, new Set());
    }
    
    const clientSubs = this.clientSubscriptions.get(ws);
    
    // Add to topic subscribers
    for (const topic of validTopics) {
      // Add topic to client's subscriptions
      clientSubs.add(topic);
      
      // Add client to topic's subscribers
      if (!this.topicSubscribers.has(topic)) {
        this.topicSubscribers.set(topic, new Set());
      }
      this.topicSubscribers.get(topic).add(ws);
      
      // Send initial data for the topic if available
      await this.sendInitialData(ws, topic);
    }
    
    // Update metrics
    this.metrics.subscriptions = [...this.clientSubscriptions.values()]
      .reduce((total, subs) => total + subs.size, 0);
    
    // Send acknowledgment
    this.send(ws, {
      type: MESSAGE_TYPES.ACKNOWLEDGMENT,
      operation: 'subscribe',
      topics: validTopics,
      timestamp: new Date().toISOString()
    });
    
    logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.GREEN}Client subscribed to topics: ${validTopics.join(', ')}${fancyColors.RESET}`);
  }
  
  /**
   * Handle unsubscription request
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  handleUnsubscription(ws, message) {
    // Validate topics
    if (!message.topics || !Array.isArray(message.topics) || message.topics.length === 0) {
      return this.sendError(ws, 'Unsubscription requires at least one topic', 4005);
    }
    
    const clientSubs = this.clientSubscriptions.get(ws);
    if (!clientSubs) {
      return; // No subscriptions to process
    }
    
    // Process each topic
    for (const topic of message.topics) {
      // Remove topic from client subscriptions
      clientSubs.delete(topic);
      
      // Remove client from topic subscribers
      const topicSubs = this.topicSubscribers.get(topic);
      if (topicSubs) {
        topicSubs.delete(ws);
        if (topicSubs.size === 0) {
          this.topicSubscribers.delete(topic);
        }
      }
    }
    
    // Update metrics
    this.metrics.subscriptions = [...this.clientSubscriptions.values()]
      .reduce((total, subs) => total + subs.size, 0);
    
    // Send acknowledgment
    this.send(ws, {
      type: MESSAGE_TYPES.ACKNOWLEDGMENT,
      operation: 'unsubscribe',
      topics: message.topics,
      timestamp: new Date().toISOString()
    });
    
    logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Client unsubscribed from topics: ${message.topics.join(', ')}${fancyColors.RESET}`);
  }
  
  /**
   * Handle specific data request
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleRequest(ws, message) {
    // Validate request
    if (!message.topic || !message.action) {
      return this.sendError(ws, 'Request requires topic and action', 4006);
    }
    
    // Check if topic exists
    if (!Object.values(TOPICS).includes(message.topic)) {
      return this.sendError(ws, `Unknown topic: ${message.topic}`, 4007);
    }
    
    // Process different request types based on topic and action
    try {
      switch (message.topic) {
        case TOPICS.MARKET_DATA:
          await this.handleMarketDataRequest(ws, message);
          break;
          
        case TOPICS.USER:
          await this.handleUserRequest(ws, message);
          break;
          
        // Add cases for other topics as needed
        
        default:
          this.sendError(ws, `Request handling not implemented for topic: ${message.topic}`, 5001);
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling request:${fancyColors.RESET}`, error);
      this.sendError(ws, 'Error processing request', 5002);
    }
  }
  
  /**
   * Handle market data requests
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleMarketDataRequest(ws, message) {
    switch (message.action) {
      case 'getToken':
        if (!message.symbol) {
          return this.sendError(ws, 'Symbol is required for getToken action', 4008);
        }
        
        const token = await marketDataService.getToken(message.symbol);
        if (token) {
          this.send(ws, {
            type: MESSAGE_TYPES.DATA,
            topic: TOPICS.MARKET_DATA,
            action: 'getToken',
            requestId: message.requestId,
            data: token,
            timestamp: new Date().toISOString()
          });
        } else {
          this.sendError(ws, `Token not found: ${message.symbol}`, 4040);
        }
        break;
        
      case 'getAllTokens':
        const tokens = await marketDataService.getAllTokens();
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.MARKET_DATA,
          action: 'getAllTokens',
          requestId: message.requestId,
          data: tokens,
          timestamp: new Date().toISOString()
        });
        break;
        
      default:
        this.sendError(ws, `Unknown action for market data: ${message.action}`, 4009);
    }
  }
  
  /**
   * Handle user data requests
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleUserRequest(ws, message) {
    // User requests require authentication
    if (!ws.clientInfo.isAuthenticated) {
      return this.sendError(ws, 'Authentication required for user requests', 4013);
    }
    
    switch (message.action) {
      case 'getProfile':
        // Fetch user profile from database
        const userData = await prisma.users.findUnique({
          where: { wallet_address: ws.clientInfo.userId },
          select: {
            id: true,
            wallet_address: true,
            nickname: true,
            role: true,
            is_active: true,
            created_at: true,
            last_login: true,
            profile_image: true
          }
        });
        
        if (userData) {
          this.send(ws, {
            type: MESSAGE_TYPES.DATA,
            topic: TOPICS.USER,
            action: 'getProfile',
            requestId: message.requestId,
            data: userData,
            timestamp: new Date().toISOString()
          });
        } else {
          this.sendError(ws, 'User profile not found', 4041);
        }
        break;
        
      case 'getStats':
        // Fetch user stats from database
        const userStats = await prisma.user_stats.findUnique({
          where: { user_id: ws.clientInfo.userId },
          select: {
            total_trades: true,
            win_count: true,
            loss_count: true,
            xp: true,
            level: true,
            rank: true,
            last_updated: true
          }
        });
        
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.USER,
          action: 'getStats',
          requestId: message.requestId,
          data: userStats || { message: 'No stats available' },
          timestamp: new Date().toISOString()
        });
        break;
        
      default:
        this.sendError(ws, `Unknown action for user data: ${message.action}`, 4009);
    }
  }
  
  /**
   * Handle command requests (actions that change state)
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleCommand(ws, message) {
    // Commands require authentication
    if (!ws.clientInfo.isAuthenticated) {
      return this.sendError(ws, 'Authentication required for commands', 4013);
    }
    
    // Validate command
    if (!message.topic || !message.action) {
      return this.sendError(ws, 'Command requires topic and action', 4014);
    }
    
    logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Command received: ${message.topic}/${message.action}${fancyColors.RESET}`);
    
    // Handle command based on topic
    try {
      switch (message.topic) {
        // Implement command handlers for different topics
        
        default:
          this.sendError(ws, `Commands not implemented for topic: ${message.topic}`, 5003);
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling command:${fancyColors.RESET}`, error);
      this.sendError(ws, 'Error processing command', 5004);
    }
  }
  
  /**
   * Send initial data for a topic when client subscribes
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} topic - The topic name
   */
  async sendInitialData(ws, topic) {
    try {
      switch (topic) {
        case TOPICS.MARKET_DATA:
          const tokens = await marketDataService.getAllTokens();
          this.send(ws, {
            type: MESSAGE_TYPES.DATA,
            topic: TOPICS.MARKET_DATA,
            data: tokens,
            timestamp: new Date().toISOString(),
            initialData: true
          });
          break;
          
        // Add cases for other topics
          
        // For authenticated topics, send user-specific data
        case TOPICS.USER:
          if (ws.clientInfo.isAuthenticated) {
            // Fetch basic user information
            const userData = await prisma.users.findUnique({
              where: { wallet_address: ws.clientInfo.userId },
              select: {
                id: true,
                wallet_address: true,
                nickname: true,
                role: true,
                is_active: true,
                created_at: true,
                last_login: true,
                profile_image: true
              }
            });
            
            if (userData) {
              this.send(ws, {
                type: MESSAGE_TYPES.DATA,
                topic: TOPICS.USER,
                data: userData,
                timestamp: new Date().toISOString(),
                initialData: true
              });
            }
          }
          break;
          
        case TOPICS.PORTFOLIO:
          if (ws.clientInfo.isAuthenticated) {
            // Fetch and send portfolio data
          }
          break;
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.RED}Error sending initial data for ${topic}:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle client disconnection
   * @param {WebSocket} ws - WebSocket connection
   */
  handleDisconnect(ws) {
    try {
      // Get connection duration
      const connectedAt = ws.clientInfo?.connectedAt || new Date();
      const disconnectTime = new Date();
      const durationMs = disconnectTime - connectedAt;
      const durationSeconds = Math.floor(durationMs / 1000);
      
      // Get subscription info before cleanup
      const subscriptions = this.clientSubscriptions.get(ws) || new Set();
      const subscribedTopics = [...subscriptions];
      
      // Clean up client subscriptions
      this.clientSubscriptions.delete(ws);
      
      // Clean up topic subscribers
      for (const [topic, subscribers] of this.topicSubscribers.entries()) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          this.topicSubscribers.delete(topic);
        }
      }
      
      // Clean up authenticated client
      const authData = this.authenticatedClients.get(ws);
      let userId = null;
      if (authData) {
        userId = authData.userId;
        this.authenticatedClients.delete(ws);
        
        // Remove from user's connections
        const userConnections = this.clientsByUserId.get(authData.userId);
        if (userConnections) {
          userConnections.delete(ws);
          if (userConnections.size === 0) {
            this.clientsByUserId.delete(authData.userId);
          }
        }
      }
      
      // Update metrics
      this.metrics.uniqueClients = this.wss.clients.size;
      this.metrics.subscriptions = [...this.clientSubscriptions.values()]
        .reduce((total, subs) => total + subs.size, 0);
      
      // Log disconnect with comprehensive information
      logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Client disconnected: ${ws.clientInfo?.ip}${fancyColors.RESET}`, {
        ip: ws.clientInfo?.ip || 'unknown',
        origin: ws.clientInfo?.origin || 'unknown',
        userAgent: ws.clientInfo?.userAgent || 'unknown',
        userId: userId,
        isAuthenticated: !!authData,
        timestamp: disconnectTime.toISOString(),
        connection_duration: {
          ms: durationMs,
          seconds: durationSeconds,
          human: durationSeconds < 60 
            ? `${durationSeconds}s` 
            : `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`
        },
        subscribed_topics: subscribedTopics,
        _icon: "🔌",
        _color: "#FFA500", // Orange for disconnect
        _highlight: false
      });
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling disconnect:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle websocket error
   * @param {WebSocket} ws - WebSocket connection
   * @param {Error} error - Error object
   */
  handleError(ws, error) {
    this.metrics.errors++;
    
    // Log error with detailed context
    logApi.error(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.RED}WebSocket error:${fancyColors.RESET}`, {
      error: error.message,
      code: error.code,
      stack: error.stack,
      ip: ws.clientInfo?.ip || 'unknown',
      origin: ws.clientInfo?.origin || 'unknown',
      userAgent: ws.clientInfo?.userAgent || 'unknown',
      userId: ws.clientInfo?.userId || null,
      isAuthenticated: ws.clientInfo?.isAuthenticated || false,
      timestamp: new Date().toISOString(),
      clientHeaders: ws.clientInfo?.headers || {},
      connectionAge: ws.clientInfo?.connectedAt 
        ? `${Math.floor((Date.now() - ws.clientInfo.connectedAt) / 1000)}s` 
        : 'unknown',
      _icon: "⚠️",
      _color: "#FF0000", // Red for error
      _highlight: true
    });
    
    // Close connection on critical errors
    if (['ECONNRESET', 'EPIPE'].includes(error.code)) {
      ws.terminate();
    }
  }
  
  /**
   * Send a message to a specific client
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} data - Data to send
   */
  send(ws, data) {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(data));
        this.metrics.messagesSent++;
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.RED}Error sending message:${fancyColors.RESET}`, error);
      this.metrics.errors++;
    }
  }
  
  /**
   * Send an error message to a client
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} message - Error message
   * @param {number} code - Error code
   */
  sendError(ws, message, code = 5000) {
    this.send(ws, {
      type: MESSAGE_TYPES.ERROR,
      message,
      code,
      timestamp: new Date().toISOString()
    });
    this.metrics.errors++;
  }
  
  /**
   * Broadcast message to all subscribers of a topic
   * @param {string} topic - The topic to broadcast to
   * @param {Object} data - The data to broadcast
   */
  broadcastToTopic(topic, data) {
    const subscribers = this.topicSubscribers.get(topic);
    if (!subscribers || subscribers.size === 0) {
      return; // No subscribers
    }
    
    let sentCount = 0;
    
    // Send to each subscriber
    for (const client of subscribers) {
      if (client.readyState === client.OPEN) {
        this.send(client, data);
        sentCount++;
      }
    }
    
    if (sentCount > 0) {
      logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.GREEN}Broadcast to topic ${topic}: ${sentCount} clients${fancyColors.RESET}`);
    }
    
    // Update metrics
    this.metrics.lastActivity = new Date();
  }
  
  /**
   * Send a message to all clients of a specific user
   * @param {string} userId - The user ID
   * @param {Object} data - The data to send
   */
  sendToUser(userId, data) {
    const userClients = this.clientsByUserId.get(userId);
    if (!userClients || userClients.size === 0) {
      return; // User not connected
    }
    
    let sentCount = 0;
    
    // Send to each of the user's connections
    for (const client of userClients) {
      if (client.readyState === client.OPEN) {
        this.send(client, data);
        sentCount++;
      }
    }
    
    if (sentCount > 0) {
      logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.GREEN}Sent to user ${userId}: ${sentCount} clients${fancyColors.RESET}`);
    }
  }
  
  /**
   * Broadcast a message to all connected clients
   * @param {Object} data - The data to broadcast
   */
  broadcastToAll(data) {
    let sentCount = 0;
    
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) {
        this.send(client, data);
        sentCount++;
      }
    }
    
    if (sentCount > 0) {
      logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.GREEN}Broadcast to all: ${sentCount} clients${fancyColors.RESET}`);
    }
  }
  
  /**
   * Get WebSocket server metrics
   * @returns {Object} - Metrics information
   */
  getMetrics() {
    return {
      connections: {
        total: this.wss.clients.size,
        authenticated: this.authenticatedClients.size
      },
      subscriptions: {
        total: this.metrics.subscriptions,
        byTopic: Object.values(TOPICS).map(topic => ({
          topic,
          subscribers: this.topicSubscribers.get(topic)?.size || 0
        }))
      },
      messages: {
        sent: this.metrics.messagesSent,
        received: this.metrics.messagesReceived,
        errors: this.metrics.errors
      },
      performance: {
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        lastActivity: this.metrics.lastActivity
      },
      status: 'operational'
    };
  }
  
  /**
   * Initialize the WebSocket server
   * Mainly for compatibility with the WebSocket initialization process
   */
  async initialize() {
    this.startTime = Date.now();
    
    // Start any periodic tasks
    this.startPeriodicalTasks();
    
    logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.GREEN}Unified WebSocket server fully initialized${fancyColors.RESET}`);
    return true;
  }
  
  /**
   * Start periodic maintenance tasks
   */
  startPeriodicalTasks() {
    // Send periodic heartbeats to keep connections alive
    setInterval(() => {
      // Check for clients that haven't received a message in a while
      const now = Date.now();
      
      for (const client of this.wss.clients) {
        if (client.readyState === client.OPEN) {
          // Only send heartbeat if no other message was sent recently
          if (now - (client.lastMessageAt || 0) > 25000) {
            this.send(client, {
              type: MESSAGE_TYPES.SYSTEM,
              action: 'heartbeat',
              timestamp: new Date().toISOString()
            });
            client.lastMessageAt = now;
          }
        }
      }
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Clean up resources
   * Called during server shutdown
   */
  cleanup() {
    try {
      logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Cleaning up unified WebSocket server...${fancyColors.RESET}`);
      
      // Remove event listeners
      for (const [eventName, handler] of this.eventHandlers.entries()) {
        serviceEvents.removeListener(eventName, handler);
      }
      
      // Close all connections
      for (const client of this.wss.clients) {
        client.terminate();
      }
      
      // Close the WebSocket server
      this.wss.close(() => {
        logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.GREEN}WebSocket server closed${fancyColors.RESET}`);
      });
      
      // Clear all data structures
      this.clientsByUserId.clear();
      this.clientSubscriptions.clear();
      this.topicSubscribers.clear();
      this.authenticatedClients.clear();
      this.eventHandlers.clear();
      
      logApi.info(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.GREEN}Unified WebSocket cleanup complete${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[unified-ws]${fancyColors.RESET} ${fancyColors.RED}Error during cleanup:${fancyColors.RESET}`, error);
    }
  }
}

/**
 * Create or return the unified WebSocket server instance
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {UnifiedWebSocketServer} WebSocket server instance
 */
export function createUnifiedWebSocket(httpServer) {
  if (!config.websocket.unifiedWebSocket) {
    const ws = new UnifiedWebSocketServer(httpServer);
    // Store in config instead of using global
    config.websocket.unifiedWebSocket = ws;
  }
  return config.websocket.unifiedWebSocket;
}

export { UnifiedWebSocketServer, TOPICS, MESSAGE_TYPES };