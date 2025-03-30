// websocket/v69/uni-ws.js

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
const WS_DEBUG_MODE = config.debug_modes.websocket === true || config.debug_modes.websocket === 'true';
logApi.info('AUTH_DEBUG_MODE (uni-ws):', AUTH_DEBUG_MODE);
logApi.info('WS_DEBUG_MODE (uni-ws):', WS_DEBUG_MODE);

// Import services as needed
import marketDataService from '../../services/marketDataService.js';
import serviceEvents from '../../utils/service-suite/service-events.js';

// Use message types and topics from config
const MESSAGE_TYPES = config.websocket.messageTypes;
const TOPICS = {
  ...config.websocket.topics,
  // Add client logs topic
  LOGS: 'logs'
};

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
    this.startTime = Date.now();                 // Server start time for uptime tracking
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
    
    // Initialize WebSocket server with ALL compression options explicitly DISABLED
    this.wss = new WebSocketServer({
      server: httpServer,
      path: this.path,
      maxPayload: 1024 * 50,  // 50KB max payload
      perMessageDeflate: false, // EXPLICITLY DISABLE COMPRESSION to avoid client issues
      // Additional explicit compression options to ensure nothing tries to compress frames
      skipUTF8Validation: false, // Ensure proper UTF8 validation
      // Extra safety options to manage RSV1, RSV2, RSV3 bits
      handleProtocols: (protocols) => {
        // Accept first protocol if provided, or null otherwise
        return protocols?.[0] || null;
      },
      // Create custom verifyClient function to add more logging
      verifyClient: (info, callback) => {
        // Log detailed client info before verification (only if debug mode is enabled)
        if (WS_DEBUG_MODE) {
          logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} CLIENT VERIFY ${fancyColors.RESET}`, {
            clientConnInfo: {
              origin: info.origin,
              secure: info.secure,
              req: {
                url: info.req.url,
                headers: info.req.headers
              }
            },
            _icon: "🔍",
            _color: "#0088FF"
          });
        } else {
          // Log a more concise verification message in normal mode
          logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} Connection from ${info.origin}`, {
            ip: info.req.headers['x-real-ip'] || info.req.headers['x-forwarded-for'] || info.req.socket?.remoteAddress,
            environment: config.getEnvironment(info.origin),
            service: 'uni-ws',
            _icon: "🔌", 
            _color: "#E91E63"
          });
        }
        
        // Always accept connections - we'll handle auth later
        callback(true);
      }
    });
    
    // Set up connection handler
    this.wss.on('connection', this.handleConnection.bind(this));
    
    // Initialize topic handlers
    this.initializeTopicHandlers();
    
    logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Unified WebSocket server initialized at ${this.path}${fancyColors.RESET}`);
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
   * Generate a unique connection ID
   * @returns {string} - A unique connection ID
   */
  generateConnectionId() {
    // Generate a random 5-character hex string
    return Math.random().toString(16).substring(2, 7).toUpperCase();
  }

  /**
   * Parse browser and OS info from user agent
   * @param {string} userAgent - User agent string
   * @returns {string} - Formatted browser/OS info
   */
  parseClientInfo(userAgent) {
    if (!userAgent) return "Unknown Client";
    
    // Simple parsing for common browsers and OS
    let browser = "Unknown";
    let os = "Unknown";
    
    // Detect browser
    if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) {
      browser = "Chrome";
    } else if (userAgent.includes("Firefox")) {
      browser = "Firefox";
    } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
      browser = "Safari";
    } else if (userAgent.includes("Edg")) {
      browser = "Edge";
    }
    
    // Detect OS
    if (userAgent.includes("Windows")) {
      os = "Windows";
    } else if (userAgent.includes("Mac OS")) {
      os = "macOS";
    } else if (userAgent.includes("Linux")) {
      os = "Linux";
    } else if (userAgent.includes("Android")) {
      os = "Android";
    } else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
      os = "iOS";
    }
    
    return `${browser}/${os}`;
  }

  /**
   * Get location info for IP address
   * @param {string} ip - IP address
   * @returns {Promise<string>} - Location string or empty string
   */
  async getLocationInfo(ip) {
    try {
      // Skip lookup for local/private IPs
      if (!ip || ip === '127.0.0.1' || ip === 'localhost' || 
          ip.startsWith('192.168.') || ip.startsWith('10.') || 
          ip.startsWith('172.16.') || ip.includes('::1')) {
        return '';
      }
      
      // Use the getIpInfo function from logApi
      const ipInfo = await logApi.getIpInfo(ip);
      
      if (ipInfo && !ipInfo.error && !ipInfo.bogon) {
        // Format as "City, Country" if available
        if (ipInfo.city && ipInfo.country) {
          return `${ipInfo.city}, ${ipInfo.country}`;
        } else if (ipInfo.country) {
          return ipInfo.country;
        }
      }
      
      return '';
    } catch (error) {
      // Silently return empty string on error
      return '';
    }
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
    
    logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.BLUE}Registered handler for event: ${eventName}${fancyColors.RESET}`);
  }
  
  /**
   * Handle new WebSocket connection
   * @param {WebSocket} ws - WebSocket connection
   * @param {Request} req - HTTP request
   */
  async handleConnection(ws, req) {
    try {
      // Set up message handler for this connection
      ws.on('message', (message) => this.handleMessage(ws, message, req));
      
      // Set up close handler
      ws.on('close', () => this.handleDisconnect(ws));
      
      // Set up error handler
      ws.on('error', (error) => this.handleError(ws, error));
      
      // Generate connection ID and counter
      const connectionId = this.generateConnectionId();
      const connectionCounter = this.metrics.uniqueClients + 1;
      
      // Client IP and user agent
      const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
      const origin = req.headers['origin'] || 'unknown';
      const clientInfo = this.parseClientInfo(userAgent);
      
      // Get location info (asynchronous)
      const locationInfo = await this.getLocationInfo(clientIp);
      const locationDisplay = locationInfo ? ` [${locationInfo}]` : '';
      
      // Extract and store all headers for logging and debugging
      const headerEntries = Object.entries(req.headers || {});
      const importantHeaders = ['host', 'origin', 'user-agent', 'sec-websocket-key', 'sec-websocket-version', 'x-forwarded-for', 'x-real-ip', 'sec-websocket-extensions', 'sec-websocket-protocol'];
      
      // Add client metadata - include ALL headers to help with debugging
      ws.clientInfo = {
        connectionId,
        connectionNumber: connectionCounter,
        ip: clientIp,
        userAgent,
        origin,
        host: req.headers['host'],
        connectedAt: new Date(),
        isAuthenticated: false,
        userId: null,
        nickname: null,
        remoteAddress: req.socket?.remoteAddress,
        remotePort: req.socket?.remotePort,
        protocol: req.protocol,
        url: req.url,
        wsProtocol: req.headers['sec-websocket-protocol'],
        wsExtensions: req.headers['sec-websocket-extensions'],
        wsVersion: req.headers['sec-websocket-version'],
        wsKey: req.headers['sec-websocket-key'],
        clientInfo,
        locationInfo,
        headers: headerEntries.reduce((obj, [key, value]) => {
          // Mask cookie value for security
          if (key === 'cookie') {
            obj[key] = value.replace(/(session=)[^;]+/, '$1***JWT_TOKEN***');
          } else {
            obj[key] = value;
          }
          return obj;
        }, {})
      };
      
      // Log raw headers only in debug mode
      if (WS_DEBUG_MODE) {
        // Clone and mask headers for logging
        const maskedHeaders = {...req.headers};
        if (maskedHeaders.cookie) {
          maskedHeaders.cookie = maskedHeaders.cookie.replace(/(session=)[^;]+/, '$1***JWT_TOKEN***');
        }
        
        logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} RAW HEADERS ${fancyColors.RESET}`, {
          unifiedWS: true,
          rawHeaders: maskedHeaders,
          connectionId,
          socketInfo: {
            remoteAddress: req.socket?.remoteAddress,
            remotePort: req.socket?.remotePort,
            protocol: req.protocol,
            url: req.url,
            method: req.method
          },
          _icon: "📋",
          _color: "#FF8800"
        });
      }
      
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
      
      // Format origin for display (removing protocol)
      const originDisplay = origin.replace(/^https?:\/\//, '');
      
      // Log connection with improved format
      logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}CONN#${connectionId} NEW - ${clientIp} (${clientInfo}) from ${originDisplay}${locationDisplay}${fancyColors.RESET}`, {
        ip: clientIp,
        origin: origin,
        userAgent: userAgent,
        connectionId,
        connectionNumber: connectionCounter,
        timestamp: new Date().toISOString(),
        environment: config.getEnvironment(origin),
        service: 'uni-ws',
        clientInfo,
        locationInfo,
        important_headers: importantHeaders.reduce((obj, key) => {
          if (key === 'cookie' && req.headers[key]) {
            obj[key] = req.headers[key].replace(/(session=)[^;]+/, '$1***JWT_TOKEN***');
          } else {
            obj[key] = req.headers[key] || 'missing';
          }
          return obj;
        }, {}),
        _icon: "🔌",
        _color: "#00AA00", // Green for successful connection
        _highlight: false
      });
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling connection:${fancyColors.RESET}`, error);
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
      
      // Special handling for client logs - they can be processed directly
      // This allows logs to be sent without requiring subscription first
      if (message.type === 'LOGS' || (message.type === MESSAGE_TYPES.DATA && message.topic === TOPICS.LOGS)) {
        await this.handleClientLogs(ws, message);
        return;
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
      logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling message:${fancyColors.RESET}`, error);
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
          // Track JWT tokens that were already denied to prevent repeated log spam
          if (!ws.authFailedTokens) {
            ws.authFailedTokens = new Set();
          }
          
          const authToken = message.authToken;
          
          // Skip verification if this token already failed (prevents log spam)
          if (ws.authFailedTokens.has(authToken)) {
            return this.send(ws, {
              type: MESSAGE_TYPES.ERROR,
              code: 4401,
              reason: 'token_expired',
              message: 'Your session has expired. Please log in again.',
              timestamp: new Date().toISOString()
            });
          }
          
          // Manually verify token instead of using the imported function
          const decoded = jwt.verify(authToken, config.jwt.secret);
          const authData = {
            userId: decoded.wallet_address,
            role: decoded.role
          };
          
          if (!authData || !authData.userId) {
            return this.sendError(ws, 'Authentication required for restricted topics', 4010);
          }
          
          // Get user's nickname from database
          let userNickname = null;
          try {
            const user = await prisma.users.findUnique({
              where: { wallet_address: authData.userId },
              select: { nickname: true }
            });
            userNickname = user?.nickname || null;
          } catch (dbError) {
            // Silently continue if database lookup fails
            logApi.debug(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to fetch nickname for ${authData.userId}: ${dbError.message}${fancyColors.RESET}`);
          }
          
          // Update client info
          ws.clientInfo.isAuthenticated = true;
          ws.clientInfo.userId = authData.userId;
          ws.clientInfo.role = authData.role;
          ws.clientInfo.nickname = userNickname;
          this.authenticatedClients.set(ws, { ...authData, nickname: userNickname });
          
          // Associate this connection with the user ID
          if (!this.clientsByUserId.has(authData.userId)) {
            this.clientsByUserId.set(authData.userId, new Set());
          }
          this.clientsByUserId.get(authData.userId).add(ws);
          
          // Format wallet address for display (first 6 chars)
          const shortWallet = authData.userId.slice(0, 6) + '...';
          const userDisplay = userNickname 
            ? `"${userNickname}" (${shortWallet})` 
            : shortWallet;
          
          // Log authentication with improved format
          logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}CONN#${ws.clientInfo.connectionId} AUTH - User ${userDisplay} [${authData.role}]${fancyColors.RESET}`, {
            environment: config.getEnvironment(ws.clientInfo?.origin),
            service: 'uni-ws',
            connectionId: ws.clientInfo.connectionId,
            userId: authData.userId,
            nickname: userNickname,
            role: authData.role,
            ip: ws.clientInfo.ip,
            _icon: "🔐",
            _color: "#3F51B5"
          });
        } catch (error) {
          // Detect the type of error
          const expiredJwt = error.name === 'TokenExpiredError';
          
          // Store this token in the failed tokens set to prevent repeated attempts
          if (authToken) {
            ws.authFailedTokens.add(authToken);
          }
          
          // Only log the first occurrence of each expired token to reduce spam
          if (!expiredJwt || !authToken) {
            logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Authentication error:${fancyColors.RESET}`, error);
          }
          
          // Special handling for expired tokens
          if (expiredJwt) {
            // Send a special error type that clients can detect to clear their tokens and redirect to login
            return this.send(ws, {
              type: MESSAGE_TYPES.ERROR,
              code: 4401,
              reason: 'token_expired',
              message: 'Your session has expired. Please log in again.',
              timestamp: new Date().toISOString()
            });
          } else {
            return this.sendError(ws, 'Invalid authentication token', 4011);
          }
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
    
    // Format subscription topics for display
    const topicsDisplay = validTopics.join(',');
    const topicCount = validTopics.length;
    
    logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}CONN#${ws.clientInfo.connectionId} SUBS - ${topicsDisplay} (${topicCount} ${topicCount === 1 ? 'topic' : 'topics'})${fancyColors.RESET}`, {
      environment: config.getEnvironment(ws.clientInfo?.origin),
      service: 'uni-ws',
      connectionId: ws.clientInfo.connectionId,
      topics: validTopics,
      topicCount: topicCount,
      userId: ws.clientInfo?.userId || null,
      nickname: ws.clientInfo?.nickname || null,
      isAuthenticated: ws.clientInfo?.isAuthenticated || false,
      _icon: "📥",
      _color: "#4CAF50"
    });
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
    
    logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Client unsubscribed from topics: ${message.topics.join(', ')}${fancyColors.RESET}`, {
      environment: config.getEnvironment(ws.clientInfo?.origin),
      service: 'uni-ws',
      topics: message.topics,
      userId: ws.clientInfo?.userId || null,
      isAuthenticated: ws.clientInfo?.isAuthenticated || false,
      _icon: "📤",
      _color: "#FFC107"
    });
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
          
        case TOPICS.LOGS:
          await this.handleLogsRequest(ws, message);
          break;
          
        case TOPICS.SYSTEM:
          await this.handleSystemRequest(ws, message);
          break;
          
        // Add cases for other topics as needed
        
        default:
          this.sendError(ws, `Request handling not implemented for topic: ${message.topic}`, 5001);
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling request:${fancyColors.RESET}`, error);
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
   * Handle logs requests
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleLogsRequest(ws, message) {
    switch (message.action) {
      case 'getStatus':
        // Return log system status
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.LOGS,
          action: 'getStatus',
          requestId: message.requestId,
          data: {
            status: 'operational',
            version: '1.0.0',
            transport: 'websocket'
          },
          timestamp: new Date().toISOString()
        });
        break;
        
      default:
        this.sendError(ws, `Unknown action for logs: ${message.action}`, 4009);
    }
  }
  
  /**
   * Handle system topic requests
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleSystemRequest(ws, message) {
    switch (message.action) {
      case 'getStatus':
        // Return system status
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.SYSTEM,
          action: 'getStatus',
          requestId: message.requestId,
          data: {
            status: 'operational',
            version: '1.0.0',
            serverTime: new Date().toISOString(),
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            connections: this.wss.clients.size
          },
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'ping':
        // Send a pong response with server timestamp
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.SYSTEM,
          action: 'pong',
          requestId: message.requestId,
          data: {
            serverTime: new Date().toISOString(),
            clientTime: message.clientTime || null,
            roundTrip: message.clientTime ? true : false
          },
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'getMetrics':
        // Return WebSocket metrics (only if authenticated as admin)
        if (!ws.clientInfo.isAuthenticated || 
            !ws.clientInfo.role || 
            !['ADMIN', 'SUPER_ADMIN'].includes(ws.clientInfo.role)) {
          return this.sendError(ws, 'Admin role required for system metrics', 4012);
        }
        
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.SYSTEM,
          action: 'getMetrics',
          requestId: message.requestId,
          data: this.getMetrics(),
          timestamp: new Date().toISOString()
        });
        break;
        
      default:
        this.sendError(ws, `Unknown action for system topic: ${message.action}`, 4009);
    }
  }
  
  /**
   * Handle client logs directly sent from client
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed client log message
   */
  async handleClientLogs(ws, message) {
    try {
      // Extract logs from message
      const { logs } = message;
      
      if (!logs || !Array.isArray(logs) || logs.length === 0) {
        return this.sendError(ws, 'Invalid logs format: logs array is required', 4015);
      }
      
      // Process each log entry
      logs.forEach(logEntry => {
        // Extract log data
        const { level, message: logMessage, timestamp, tags, stack, ...details } = logEntry;
        
        // Map client level to server level (fallback to info)
        const serverLevel = ['error', 'warn', 'info', 'http', 'debug'].includes(level) 
          ? level 
          : 'info';
        
        // Format client information
        const clientContext = {
          clientLogger: true,
          clientIp: ws.clientInfo?.ip,
          clientInfo: ws.clientInfo,
          sessionId: details.sessionId || message.sessionId,
          service: 'CLIENT',
          userId: details.userId || message.userId || ws.clientInfo?.userId,
          walletAddress: ws.clientInfo?.userId, // In WebSocket, userId is the wallet address
          tags: tags || message.tags,
          stack,
          batchId: message.batchId,
          frontend: true,
          transport: 'websocket'
        };
        
        // Send to server logger
        if (logApi[serverLevel]) {
          logApi[serverLevel](
            `[Client] ${logMessage || 'No message provided'}`, 
            { ...clientContext, ...details }
          );
        } else {
          logApi.info(
            `[Client] ${logMessage || 'No message provided'}`, 
            { level: serverLevel, ...clientContext, ...details }
          );
        }
      });
      
      // Send acknowledgment
      this.send(ws, {
        type: MESSAGE_TYPES.ACKNOWLEDGMENT,
        topic: TOPICS.LOGS,
        message: 'Logs received',
        count: logs.length,
        timestamp: new Date().toISOString()
      });
      
      // Log summary (debug level to avoid log flooding)
      logApi.debug(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Received ${logs.length} client logs via WebSocket${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error processing client logs:${fancyColors.RESET}`, error);
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
            created_at: true,
            last_login: true,
            profile_image_url: true
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
    
    logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Command received: ${message.topic}/${message.action}${fancyColors.RESET}`);
    
    // Handle command based on topic
    try {
      switch (message.topic) {
        // Implement command handlers for different topics
        
        default:
          this.sendError(ws, `Commands not implemented for topic: ${message.topic}`, 5003);
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling command:${fancyColors.RESET}`, error);
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
                created_at: true,
                last_login: true,
                profile_image_url: true
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
      logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error sending initial data for ${topic}:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle client disconnection
   * @param {WebSocket} ws - WebSocket connection
   */
  handleDisconnect(ws) {
    try {
      // Get connection ID and info
      const connectionId = ws.clientInfo?.connectionId || 'UNKNOWN';
      
      // Get connection duration
      const connectedAt = ws.clientInfo?.connectedAt || new Date();
      const disconnectTime = new Date();
      const durationMs = disconnectTime - connectedAt;
      const durationSeconds = Math.floor(durationMs / 1000);
      
      // Format human readable duration
      const humanDuration = durationSeconds < 60 
        ? `${durationSeconds}s` 
        : `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`;
      
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
      let nickname = null;
      if (authData) {
        userId = authData.userId;
        nickname = authData.nickname;
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
      
      // Format client identification info
      const clientIdentifier = ws.clientInfo?.ip || 'unknown';
      const clientInfo = ws.clientInfo?.clientInfo || '';
      
      // Format topics summary if any
      const topicsSummary = subscribedTopics.length > 0 
        ? ` with ${subscribedTopics.length} subscriptions` 
        : '';
      
      // Format user information if authenticated
      let userInfo = '';
      if (userId) {
        const shortWallet = userId.slice(0, 6) + '...';
        userInfo = nickname 
          ? ` for user "${nickname}" (${shortWallet})` 
          : ` for wallet ${shortWallet}`;
      }
      
      // Log disconnect with improved format
      logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}CONN#${connectionId} CLOSE - ${clientIdentifier} (${humanDuration})${userInfo}${topicsSummary}${fancyColors.RESET}`, {
        connectionId,
        ip: ws.clientInfo?.ip || 'unknown',
        origin: ws.clientInfo?.origin || 'unknown',
        userAgent: ws.clientInfo?.userAgent || 'unknown',
        userId,
        nickname,
        isAuthenticated: !!authData,
        timestamp: disconnectTime.toISOString(),
        environment: config.getEnvironment(ws.clientInfo?.origin),
        service: 'uni-ws',
        connection_duration: {
          ms: durationMs,
          seconds: durationSeconds,
          human: humanDuration
        },
        subscribed_topics: subscribedTopics,
        _icon: "🔌",
        _color: "#FFA500", // Orange for disconnect
        _highlight: false
      });
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling disconnect:${fancyColors.RESET}`, error);
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
    logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}WebSocket error:${fancyColors.RESET}`, {
      error: error.message,
      code: error.code,
      stack: error.stack,
      ip: ws.clientInfo?.ip || 'unknown',
      origin: ws.clientInfo?.origin || 'unknown',
      userAgent: ws.clientInfo?.userAgent || 'unknown',
      userId: ws.clientInfo?.userId || null,
      isAuthenticated: ws.clientInfo?.isAuthenticated || false,
      timestamp: new Date().toISOString(),
      environment: config.getEnvironment(ws.clientInfo?.origin),
      service: 'uni-ws',
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
      logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error sending message:${fancyColors.RESET}`, error);
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
      logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Broadcast to topic ${topic}: ${sentCount} clients${fancyColors.RESET}`, {
        environment: config.getEnvironment(),
        service: 'uni-ws',
        topic: topic,
        clients: sentCount,
        _icon: "📢",
        _color: "#4CAF50"
      });
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
      logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Sent to user ${userId}: ${sentCount} clients${fancyColors.RESET}`, {
        environment: config.getEnvironment(),
        service: 'uni-ws',
        userId: userId,
        clients: sentCount,
        _icon: "📨",
        _color: "#2196F3"
      });
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
      logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Broadcast to all: ${sentCount} clients${fancyColors.RESET}`);
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
    // Start any periodic tasks
    this.startPeriodicalTasks();
    
    logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Unified WebSocket server fully initialized${fancyColors.RESET}`);
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
   * @returns {Promise<void>} - Resolves when cleanup is complete
   */
  cleanup() {
    return new Promise((resolve, reject) => {
      try {
        logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Cleaning up unified WebSocket server...${fancyColors.RESET}`);
        
        // Remove event listeners
        for (const [eventName, handler] of this.eventHandlers.entries()) {
          serviceEvents.removeListener(eventName, handler);
        }
        
        // First, send shutdown notification to all clients
        logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Sending shutdown notification to all clients...${fancyColors.RESET}`);
        
        const shutdownNotification = {
          type: MESSAGE_TYPES.SYSTEM,
          action: "shutdown",
          message: "Server is restarting, please reconnect in 30 seconds",
          expectedDowntime: 30000,
          timestamp: new Date().toISOString()
        };
        
        // Send notification to each client
        for (const client of this.wss.clients) {
          if (client.readyState === client.OPEN) {
            try {
              client.send(JSON.stringify(shutdownNotification));
            } catch (err) {
              logApi.warn(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to send shutdown notification to client: ${err.message}${fancyColors.RESET}`);
            }
          }
        }
        
        // Give time for notifications to be delivered (300ms)
        setTimeout(() => {
          // Close all connections properly with code 1000 (Normal Closure)
          let closedCount = 0;
          const totalClients = this.wss.clients.size;
          
          logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Gracefully closing ${totalClients} client connections...${fancyColors.RESET}`);
          
          // If no clients, skip to server closure
          if (totalClients === 0) {
            closeServerAndFinish();
            return;
          }
          
          for (const client of this.wss.clients) {
            if (client.readyState === client.OPEN) {
              try {
                // Use proper WebSocket close code (1000 = normal closure) with reason
                client.close(1000, "Server restarting");
              } catch (err) {
                logApi.warn(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to gracefully close client: ${err.message}${fancyColors.RESET}`);
                // Fallback to terminate if close fails
                try {
                  client.terminate();
                } catch (termErr) {
                  // Just log and continue
                  logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Failed to terminate client: ${termErr.message}${fancyColors.RESET}`);
                }
              }
              closedCount++;
            }
          }
          
          // Give connections time to close gracefully before closing server (200ms)
          setTimeout(closeServerAndFinish, 200);
          
        }, 300);
        
        // Function to close the server and finish cleanup
        const closeServerAndFinish = () => {
          // Close the WebSocket server
          this.wss.close(() => {
            logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}WebSocket server closed${fancyColors.RESET}`);
            
            // Clear all data structures
            this.clientsByUserId.clear();
            this.clientSubscriptions.clear();
            this.topicSubscribers.clear();
            this.authenticatedClients.clear();
            this.eventHandlers.clear();
            
            logApi.info(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Unified WebSocket cleanup complete${fancyColors.RESET}`);
            resolve();
          });
        };
        
      } catch (error) {
        logApi.error(`${fancyColors.MAGENTA}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error during cleanup:${fancyColors.RESET}`, error);
        reject(error);
      }
    });
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