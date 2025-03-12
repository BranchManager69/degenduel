/**
 * BaseWebSocketServer (v69)
 * 
 * Enhanced WebSocket base class with:
 * - Standardized authentication with JWT validation
 * - Public/private endpoint support
 * - Channel-based subscription management
 * - Connection lifecycle management
 * - Error handling and logging
 * - Performance metrics and monitoring
 * - Security protections (rate limiting, payload validation)
 */

import WebSocket from 'ws';
import http from 'http';
import url from 'url';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { logApi } from '../../utils/logger-suite/logger.js';
import { config } from '../../config/config.js';
import prisma from '../../config/prisma.js';
import { fancyColors } from '../../utils/colors.js';

export class BaseWebSocketServer {
  /**
   * Create a new BaseWebSocketServer
   * @param {http.Server} server - The HTTP server to attach the WebSocket server to
   * @param {Object} options - Configuration options
   * @param {string} options.path - The path for this WebSocket (e.g., '/api/v69/ws/monitor')
   * @param {boolean} options.requireAuth - Whether authentication is required (default: true)
   * @param {string[]} options.publicEndpoints - Array of public endpoints that bypass auth
   * @param {number} options.maxPayload - Maximum message size in bytes (default: 1MB)
   * @param {number} options.rateLimit - Maximum messages per minute (default: 300)
   * @param {boolean} options.perMessageDeflate - Whether to use compression (default: true)
   * @param {number} options.heartbeatInterval - Heartbeat interval in ms (default: 30000)
   * @param {number} options.heartbeatTimeout - Time to wait for heartbeat response (default: 15000)
   */
  constructor(server, options = {}) {
    if (!server) {
      throw new Error('HTTP server instance is required to initialize WebSocket server');
    }

    // Set configuration options with defaults
    this.path = options.path;
    this.requireAuth = options.requireAuth !== false; // Default to true
    this.publicEndpoints = new Set(options.publicEndpoints || []);
    this.maxPayload = options.maxPayload || 1024 * 1024; // 1MB default
    this.rateLimit = options.rateLimit || 300; // 300 messages per minute
    this.perMessageDeflate = options.perMessageDeflate !== false; // Default to true
    this.heartbeatInterval = options.heartbeatInterval || 30000; // 30 seconds
    this.heartbeatTimeout = options.heartbeatTimeout || 15000; // 15 seconds

    // Initialize WebSocket server
    this.wss = new WebSocket.Server({
      server,
      path: this.path,
      maxPayload: this.maxPayload,
      perMessageDeflate: this.perMessageDeflate
    });

    // Initialize client tracking maps
    this.clients = new Set(); // All connected clients
    this.clientInfoMap = new Map(); // Client metadata
    this.channelSubscriptions = new Map(); // Channel -> Set of subscribers
    this.messageRateLimits = new Map(); // Client -> message count
    this.heartbeatTimers = new Map(); // Client -> heartbeat timer

    // Initialize server statistics
    this.stats = {
      startTime: Date.now(),
      totalConnections: 0,
      currentConnections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      rateLimitExceeded: 0,
      authenticatedConnections: 0,
      unauthenticatedConnections: 0,
      channelCounts: {},
      latencies: []
    };

    // Bind event handlers
    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', this.handleServerError.bind(this));

    // Start background maintenance tasks
    this._setupBackgroundTasks();

    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BOLD}${fancyColors.WHITE} V69 WEBSOCKET ${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}BaseWebSocketServer initialized for path: ${fancyColors.UNDERLINE}${this.path}${fancyColors.RESET}`, {
      path: this.path,
      requireAuth: this.requireAuth,
      publicEndpoints: Array.from(this.publicEndpoints),
      maxPayload: this.formatBytes(this.maxPayload),
      rateLimit: this.rateLimit
    });
  }

  /**
   * Set up background maintenance tasks
   * @private
   */
  async _setupBackgroundTasks() {
    // Start heartbeat interval
    this._heartbeatInterval = setInterval(() => {
      this.sendHeartbeats();
    }, this.heartbeatInterval);

    // Start rate limit reset interval (every minute)
    this._rateLimitInterval = setInterval(() => {
      this.resetRateLimits();
    }, 60000);

    // Start stats update interval (every 5 minutes)
    this._statsInterval = setInterval(() => {
      this.updateStats();
    }, 300000);
    
    // Start metrics reporting interval (every minute)
    // This will report status to the central monitoring system
    try {
      const serviceEvents = (await import('../../utils/service-suite/service-events.js')).default;
      
      this._metricsReportInterval = setInterval(() => {
        const metrics = this.getMetrics();
        const status = this.stats.errors > 0 ? 'degraded' : 'operational';
        
        // Report metrics via service events
        serviceEvents.emit('service:status:update', {
          name: this.path,
          source: 'v69_websocket',
          status: status,
          metrics: metrics
        });
      }, 15000); // Report every 15 seconds
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 METRICS ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} Failed to set up metrics reporting: ${error.message}`, error);
    }
  }

  /**
   * Handle new WebSocket connection
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request that initiated the connection
   */
  async handleConnection(ws, req) {
    try {
      // Generate a unique connection ID
      const connectionId = uuidv4();
      
      // Parse the request URL
      const parsedUrl = url.parse(req.url, true);
      const { query } = parsedUrl;

      // Add to client tracking
      this.clients.add(ws);
      this.stats.totalConnections++;
      this.stats.currentConnections++;

      // Initialize client info
      const clientInfo = {
        connectionId,
        ip: req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] || 'Unknown',
        connectedAt: new Date(),
        lastActivity: new Date(),
        authenticated: false,
        user: null,
        subscriptions: new Set(),
        requestedChannel: query.channel || null,
        requestedEndpoint: query.endpoint || null
      };
      
      logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 CONNECTION ${fancyColors.RESET} ${fancyColors.CYAN}New connection on ${fancyColors.BOLD}${this.path}${fancyColors.RESET} (${connectionId.substring(0,8)})`);
      
      
      // Store client info
      this.clientInfoMap.set(ws, clientInfo);
      
      // Set up event listeners for this connection
      ws.on('message', (data) => this.handleMessage(ws, data));
      ws.on('close', () => this.handleClose(ws));
      ws.on('error', (error) => this.handleError(ws, error));
      ws.on('pong', () => this.handlePong(ws));

      // Initialize rate limiting
      this.messageRateLimits.set(ws, 0);

      // Try to authenticate the client
      await this.authenticateClient(ws, req, query);

      // Call the onConnection handler which can be overridden by subclasses
      await this.onConnection(ws, req);

      // Check if client requested a public endpoint that doesn't require auth
      const requestedEndpoint = clientInfo.requestedEndpoint;
      const isPublicEndpoint = requestedEndpoint && this.publicEndpoints.has(requestedEndpoint);

      // If auth is required and client is not authenticated and not requesting a public endpoint, close connection
      if (this.requireAuth && !clientInfo.authenticated && !isPublicEndpoint) {
        logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 AUTH ${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.BOLD}Authentication failed${fancyColors.RESET} for connection ${clientInfo.connectionId.substring(0,8)}`);
        this.sendError(ws, 'UNAUTHORIZED', 'Authentication required', 4001);
        this.closeConnection(ws, 4001, 'Authentication required');
        return;
      }

      // If client requested a channel in the query string, subscribe automatically
      if (clientInfo.requestedChannel) {
        await this.subscribeToChannel(ws, clientInfo.requestedChannel);
      }

      // Send connection established message
      this.sendToClient(ws, {
        type: 'connection_established',
        connectionId,
        authenticated: clientInfo.authenticated,
        timestamp: new Date().toISOString(),
        user: clientInfo.authenticated ? {
          wallet_address: clientInfo.user.wallet_address,
          role: clientInfo.user.role
        } : null
      });

      // Start heartbeat for this connection
      this.startHeartbeat(ws);

    } catch (error) {
      logApi.error('Error handling WebSocket connection:', error);
      this.closeConnection(ws, 1011, 'Internal server error during connection setup');
    }
  }

  /**
   * Handle message from client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string|Buffer} data - The message data
   */
  async handleMessage(ws, data) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return; // Connection already closed or invalid

    // Update last activity time
    clientInfo.lastActivity = new Date();

    try {
      // Parse the message
      const message = this.parseMessage(data);
      if (!message) {
        this.sendError(ws, 'INVALID_MESSAGE', 'Invalid message format', 1003);
        return;
      }

      // Update message count for rate limiting
      this.applyRateLimit(ws);

      // Update server statistics
      this.stats.messagesReceived++;

      // Handle built-in message types
      if (message.type === 'heartbeat') {
        this.handleHeartbeatMessage(ws);
        return;
      }

      if (message.type === 'subscribe') {
        await this.handleSubscribeMessage(ws, message);
        return;
      }

      if (message.type === 'unsubscribe') {
        await this.handleUnsubscribeMessage(ws, message);
        return;
      }

      // Call message handler that can be overridden by subclasses
      const startTime = Date.now();
      await this.onMessage(ws, message);
      const processingTime = Date.now() - startTime;

      // Track message processing latency
      this.stats.latencies.push(processingTime);
      // Keep only the last 100 latency measurements
      if (this.stats.latencies.length > 100) {
        this.stats.latencies.shift();
      }

    } catch (error) {
      logApi.error('Error handling WebSocket message:', error);
      this.stats.errors++;
      this.sendError(ws, 'MESSAGE_PROCESSING_ERROR', 'Error processing message');
    }
  }

  /**
   * Handle client disconnect
   * @param {WebSocket} ws - The WebSocket connection
   */
  async handleClose(ws) {
    try {
      const clientInfo = this.clientInfoMap.get(ws);
      if (!clientInfo) return; // Already cleaned up

      // Stop heartbeat timer
      this.stopHeartbeat(ws);

      // Calculate connection duration
      const durationSec = Math.floor((Date.now() - clientInfo.connectedAt.getTime()) / 1000);
      const durationStr = durationSec >= 3600 ? 
                         `${Math.floor(durationSec/3600)}h ${Math.floor((durationSec%3600)/60)}m` : 
                         durationSec >= 60 ? 
                         `${Math.floor(durationSec/60)}m ${durationSec%60}s` : 
                         `${durationSec}s`;

      // Get user info for display
      const walletStr = clientInfo.authenticated ? 
                      `${fancyColors.PURPLE}${clientInfo.user.wallet_address.substring(0,8)}...${fancyColors.RESET}` : 
                      `${fancyColors.LIGHT_GRAY}unauthenticated${fancyColors.RESET}`;
      
      // Log disconnection in colorful format
      logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 DISCONNECT ${fancyColors.RESET} Connection closed ${clientInfo.connectionId.substring(0,8)} ${walletStr || ''} ${fancyColors.DARK_YELLOW}(${durationStr})${fancyColors.RESET}`, {
        connectionId: clientInfo.connectionId,
        authenticated: clientInfo.authenticated,
        wallet: clientInfo.authenticated ? clientInfo.user.wallet_address : null,
        duration: durationStr
      });

      // Call the onClose handler which can be overridden by subclasses
      await this.onClose(ws);

      // Clean up client resources
      this.cleanupClient(ws);

      // Update statistics
      this.stats.currentConnections--;
      if (clientInfo.authenticated) {
        this.stats.authenticatedConnections--;
      } else {
        this.stats.unauthenticatedConnections--;
      }

    } catch (error) {
      logApi.error('Error handling WebSocket close:', error);
    }
  }

  /**
   * Handle connection error
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Error} error - The error that occurred
   */
  async handleError(ws, error) {
    try {
      const clientInfo = this.clientInfoMap.get(ws);
      const connId = clientInfo?.connectionId.substring(0,8) || 'unknown';
      
      // Standardized error data for reporting
      const errorData = {
        error: error.message,
        connectionId: clientInfo?.connectionId,
        authenticated: clientInfo?.authenticated,
        wallet: clientInfo?.authenticated ? clientInfo.user.wallet_address : null,
        path: this.path,
        timestamp: new Date().toISOString(),
        type: 'client_error',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
      
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ERROR ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} CLIENT ERROR ${fancyColors.RESET} ${connId}: ${fancyColors.RED}${error.message}${fancyColors.RESET}`, errorData);

      // Update statistics
      this.stats.errors++;

      // Emit event for monitoring systems to track
      const serviceEvents = (await import('../../utils/service-suite/service-events.js')).default;
      serviceEvents.emit('service:error', {
        name: this.path,
        source: 'v69_websocket',
        status: 'error',
        error: error.message,
        metrics: this.getMetrics(),
        details: errorData
      });

      // Call the onError handler which can be overridden by subclasses
      await this.onError(ws, error);

      // Close the connection after an error
      this.closeConnection(ws, 1011, 'Error occurred');

    } catch (additionalError) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ERROR ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} META ERROR ${fancyColors.RESET} Error while handling error: ${additionalError.message}`, additionalError);
    }
  }

  /**
   * Handle server-level errors
   * @param {Error} error - The server error
   */
  async handleServerError(error) {
    // Standardized error data for reporting
    const errorData = {
      error: error.message,
      path: this.path,
      timestamp: new Date().toISOString(),
      type: 'server_error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      component: 'websocket_server'
    };
    
    logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ERROR ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} SERVER ERROR ${fancyColors.RESET} ${fancyColors.RED}${error.message}${fancyColors.RESET}`, errorData);
    this.stats.errors++;
    
    // Emit event for monitoring systems to track
    try {
      const serviceEvents = (await import('../../utils/service-suite/service-events.js')).default;
      serviceEvents.emit('service:error', {
        name: this.path,
        source: 'v69_websocket_server',
        status: 'error',
        error: error.message,
        metrics: this.getMetrics(),
        details: errorData
      });
      
      // Update system status via monitor WebSocket if available
      if (global.wsServersV69?.monitor) {
        global.wsServersV69.monitor.broadcastToChannel('system.status', {
          type: 'SERVER_STATUS_UPDATE',
          data: {
            status: 'degraded',
            message: `WebSocket error: ${error.message}`,
            timestamp: new Date().toISOString(),
            affectedComponent: this.path
          }
        });
      }
    } catch (additionalError) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ERROR ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} META ERROR ${fancyColors.RESET} Error while emitting error event: ${additionalError.message}`, additionalError);
    }
  }

  /**
   * Handle pong response from client heartbeat
   * @param {WebSocket} ws - The WebSocket connection
   */
  handlePong(ws) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    // Update last activity time
    clientInfo.lastActivity = new Date();
    clientInfo.lastPong = new Date();
  }

  /**
   * Handle heartbeat message from client
   * @param {WebSocket} ws - The WebSocket connection
   */
  handleHeartbeatMessage(ws) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    // Send heartbeat acknowledgment
    this.sendToClient(ws, {
      type: 'heartbeat_ack',
      timestamp: new Date().toISOString()
    });

    // Update last activity time
    clientInfo.lastActivity = new Date();
  }

  /**
   * Handle subscribe message from client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message object
   */
  async handleSubscribeMessage(ws, message) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    const channel = message.channel;
    if (!channel) {
      this.sendError(ws, 'INVALID_SUBSCRIPTION', 'Channel name is required');
      return;
    }

    // Check access rights for this channel
    if (!this.canAccessChannel(clientInfo, channel)) {
      this.sendError(ws, 'SUBSCRIPTION_DENIED', 'You do not have access to this channel');
      return;
    }

    // Subscribe to the channel
    await this.subscribeToChannel(ws, channel);

    // Call the onSubscribe handler which can be overridden by subclasses
    await this.onSubscribe(ws, channel);
  }

  /**
   * Handle unsubscribe message from client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message object
   */
  async handleUnsubscribeMessage(ws, message) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    const channel = message.channel;
    if (!channel) {
      this.sendError(ws, 'INVALID_UNSUBSCRIPTION', 'Channel name is required');
      return;
    }

    // Unsubscribe from the channel
    await this.unsubscribeFromChannel(ws, channel);

    // Call the onUnsubscribe handler which can be overridden by subclasses
    await this.onUnsubscribe(ws, channel);
  }

  /**
   * Authenticate client using JWT token
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   * @param {Object} query - Query parameters
   */
  async authenticateClient(ws, req, query) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    try {
      // Extract token from query, headers, or cookie
      let token = this.extractToken(req, query);
      
      if (!token) {
        // If no token and authentication is required, mark as unauthenticated
        if (this.requireAuth) {
          clientInfo.authenticated = false;
          this.stats.unauthenticatedConnections++;
          logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 AUTH ${fancyColors.RESET} ${fancyColors.LIGHT_GRAY}Unauthenticated connection ${clientInfo.connectionId.substring(0,8)}${fancyColors.RESET}`, {
            connectionId: clientInfo.connectionId,
            ip: clientInfo.ip
          });
        }
        return;
      }

      // Verify the token
      const decoded = jwt.verify(token, config.jwt.secret || 'default_secret');
      
      // Get user from database for most up-to-date information
      const user = await prisma.users.findUnique({
        where: { wallet_address: decoded.wallet_address }
      });

      // If user not found, token is invalid
      if (!user) {
        clientInfo.authenticated = false;
        this.stats.unauthenticatedConnections++;
        logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 AUTH ${fancyColors.RESET} ${fancyColors.YELLOW}Authentication failed: User not found${fancyColors.RESET} (wallet: ${decoded.wallet_address.substring(0,8)}...)`, {
          connectionId: clientInfo.connectionId,
          wallet: decoded.wallet_address
        });
        return;
      }

      // Check if role in token matches database (prevent stale permissions)
      if (user.role !== decoded.role) {
        logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 AUTH ${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.BOLD}Role mismatch${fancyColors.RESET} for ${user.wallet_address.substring(0,8)}... (token: ${decoded.role}, actual: ${user.role})`, {
          connectionId: clientInfo.connectionId,
          wallet: user.wallet_address,
          tokenRole: decoded.role,
          actualRole: user.role
        });
      }

      // Successfully authenticated
      clientInfo.authenticated = true;
      clientInfo.user = user;
      this.stats.authenticatedConnections++;

      const roleColor = user.role === 'superadmin' ? fancyColors.RED : 
                        user.role === 'admin' ? fancyColors.RED : 
                        fancyColors.PURPLE;
      
      logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 AUTH ${fancyColors.RESET} ${fancyColors.GREEN}${fancyColors.BOLD}Authenticated${fancyColors.RESET} ${roleColor}${user.role}${fancyColors.RESET} ${user.wallet_address.substring(0,8)}...`, {
        connectionId: clientInfo.connectionId,
        wallet: user.wallet_address,
        role: user.role
      });

    } catch (error) {
      // Token verification failed
      clientInfo.authenticated = false;
      this.stats.unauthenticatedConnections++;
      
      logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 AUTH ${fancyColors.RESET} ${fancyColors.RED}Token verification failed:${fancyColors.RESET} ${error.message}`, {
        connectionId: clientInfo.connectionId,
        error: error.message
      });
    }
  }

  /**
   * Extract authentication token from request
   * @param {http.IncomingMessage} req - The HTTP request
   * @param {Object} query - Query parameters
   * @returns {string|null} - The extracted token or null
   */
  extractToken(req, query) {
    // Try to get from Authorization header (PREFERRED METHOD - MORE SECURE)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      return req.headers.authorization.substring(7); // Remove 'Bearer ' prefix
    }

    // Try to get from protocol header (WebSocket subprotocol)
    if (req.headers['sec-websocket-protocol']) {
      const protocols = req.headers['sec-websocket-protocol'].split(',').map(p => p.trim());
      // Find a protocol that looks like a JWT (contains two dots)
      const tokenProtocol = protocols.find(p => p.split('.').length === 3);
      if (tokenProtocol) {
        return tokenProtocol;
      }
    }
    
    // Try to get from cookie
    if (req.headers.cookie) {
      const cookies = req.headers.cookie.split(';').map(c => c.trim());
      const sessionCookie = cookies.find(c => c.startsWith('session='));
      if (sessionCookie) {
        return sessionCookie.substring(8); // Remove 'session=' prefix
      }
    }

    // Try to get from query parameter (LEAST SECURE METHOD - FALLBACK ONLY)
    if (query.token) {
      // Log a warning about using the less secure method
      logApi.debug(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} AUTH WARNING ${fancyColors.RESET} Using query parameter for authentication is less secure than headers`);
      return query.token;
    }

    return null;
  }

  /**
   * Check if a client can access a channel
   * @param {Object} clientInfo - The client info object
   * @param {string} channel - The channel name
   * @returns {boolean} - Whether the client can access the channel
   */
  canAccessChannel(clientInfo, channel) {
    // Public endpoints are always accessible
    if (this.publicEndpoints.has(channel)) {
      return true;
    }

    // If authentication is required, check if client is authenticated
    if (this.requireAuth && !clientInfo.authenticated) {
      return false;
    }

    // Check channel-specific permissions
    // Channels that start with 'user.' are only accessible by that user
    if (channel.startsWith('user.')) {
      const userWallet = channel.split('.')[1];
      return clientInfo.authenticated && clientInfo.user.wallet_address === userWallet;
    }

    // Channels that start with 'admin.' are only accessible by admins
    if (channel.startsWith('admin.')) {
      return clientInfo.authenticated && 
             (clientInfo.user.role === 'admin' || clientInfo.user.role === 'superadmin');
    }

    // Channels that start with 'superadmin.' are only accessible by superadmins
    if (channel.startsWith('superadmin.')) {
      return clientInfo.authenticated && clientInfo.user.role === 'superadmin';
    }

    // Default to allow if authenticated or not requiring auth
    return !this.requireAuth || clientInfo.authenticated;
  }

  /**
   * Subscribe a client to a channel
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} channel - The channel name
   */
  async subscribeToChannel(ws, channel) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    // Add to client's subscriptions
    clientInfo.subscriptions.add(channel);

    // Add to channel subscribers
    if (!this.channelSubscriptions.has(channel)) {
      this.channelSubscriptions.set(channel, new Set());
    }
    this.channelSubscriptions.get(channel).add(ws);

    // Update channel count statistics
    this.stats.channelCounts[channel] = (this.stats.channelCounts[channel] || 0) + 1;

    // Send subscription confirmation
    this.sendToClient(ws, {
      type: 'subscription_confirmed',
      channel,
      timestamp: new Date().toISOString()
    });

    logApi.debug('Client subscribed to channel', {
      connectionId: clientInfo.connectionId,
      channel,
      authenticated: clientInfo.authenticated,
      wallet: clientInfo.authenticated ? clientInfo.user.wallet_address : null
    });
  }

  /**
   * Unsubscribe a client from a channel
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} channel - The channel name
   */
  async unsubscribeFromChannel(ws, channel) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    // Remove from client's subscriptions
    clientInfo.subscriptions.delete(channel);

    // Remove from channel subscribers
    if (this.channelSubscriptions.has(channel)) {
      const subscribers = this.channelSubscriptions.get(channel);
      subscribers.delete(ws);

      // If no more subscribers, remove the channel
      if (subscribers.size === 0) {
        this.channelSubscriptions.delete(channel);
      }
    }

    // Update channel count statistics
    if (this.stats.channelCounts[channel]) {
      this.stats.channelCounts[channel]--;
      if (this.stats.channelCounts[channel] === 0) {
        delete this.stats.channelCounts[channel];
      }
    }

    // Send unsubscription confirmation
    this.sendToClient(ws, {
      type: 'unsubscription_confirmed',
      channel,
      timestamp: new Date().toISOString()
    });

    logApi.debug('Client unsubscribed from channel', {
      connectionId: clientInfo.connectionId,
      channel,
      authenticated: clientInfo.authenticated,
      wallet: clientInfo.authenticated ? clientInfo.user.wallet_address : null
    });
  }

  /**
   * Send a message to all subscribers of a channel
   * @param {string} channel - The channel name
   * @param {Object} message - The message to send
   */
  broadcastToChannel(channel, message) {
    if (!this.channelSubscriptions.has(channel)) {
      return; // No subscribers
    }

    const subscribers = this.channelSubscriptions.get(channel);
    const broadcastMessage = {
      ...message,
      channel,
      timestamp: message.timestamp || new Date().toISOString()
    };

    for (const ws of subscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendToClient(ws, broadcastMessage);
      }
    }

    logApi.debug('Broadcast message to channel', {
      channel,
      type: message.type,
      subscribers: subscribers.size
    });
  }

  /**
   * Send a message to all connected clients
   * @param {Object} message - The message to send
   */
  broadcast(message) {
    const broadcastMessage = {
      ...message,
      timestamp: message.timestamp || new Date().toISOString()
    };

    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendToClient(ws, broadcastMessage);
      }
    }

    logApi.debug('Broadcast message to all clients', {
      type: message.type,
      clients: this.clients.size
    });
  }

  /**
   * Send a message to a specific client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message to send
   */
  sendToClient(ws, message) {
    try {
      if (ws.readyState !== WebSocket.OPEN) return;

      // Ensure timestamp is present
      if (!message.timestamp) {
        message.timestamp = new Date().toISOString();
      }

      // Convert the message to a string
      const messageString = JSON.stringify(message);

      // Send the message
      ws.send(messageString);

      // Update statistics
      this.stats.messagesSent++;

    } catch (error) {
      logApi.error('Error sending message to client:', error);
      this.stats.errors++;
    }
  }

  /**
   * Send an error message to a client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} code - The error code
   * @param {string} message - The error message
   * @param {number} closeCode - Optional WebSocket close code to close the connection
   */
  sendError(ws, code, message, closeCode = null) {
    this.sendToClient(ws, {
      type: 'error',
      code,
      message,
      timestamp: new Date().toISOString()
    });

    // If a close code is provided, close the connection
    if (closeCode) {
      this.closeConnection(ws, closeCode, message);
    }
  }

  /**
   * Close a WebSocket connection
   * @param {WebSocket} ws - The WebSocket connection
   * @param {number} code - The close code
   * @param {string} reason - The reason for closing
   */
  closeConnection(ws, code, reason) {
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(code, reason);
      }
    } catch (error) {
      logApi.error('Error closing WebSocket connection:', error);
    }
  }

  /**
   * Start heartbeat for a client
   * @param {WebSocket} ws - The WebSocket connection
   */
  startHeartbeat(ws) {
    // Clear existing heartbeat timer if it exists
    this.stopHeartbeat(ws);

    // Create a new heartbeat timer
    const heartbeatTimer = setTimeout(() => {
      this.checkHeartbeat(ws);
    }, this.heartbeatInterval);

    // Store the timer
    this.heartbeatTimers.set(ws, heartbeatTimer);
  }

  /**
   * Stop heartbeat for a client
   * @param {WebSocket} ws - The WebSocket connection
   */
  stopHeartbeat(ws) {
    const timer = this.heartbeatTimers.get(ws);
    if (timer) {
      clearTimeout(timer);
      this.heartbeatTimers.delete(ws);
    }
  }

  /**
   * Check heartbeat for a client
   * @param {WebSocket} ws - The WebSocket connection
   */
  checkHeartbeat(ws) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    // Check if client is still active
    const lastActivity = clientInfo.lastActivity.getTime();
    const now = Date.now();

    // If client hasn't been active recently, ping it
    if (now - lastActivity > this.heartbeatInterval) {
      // Send ping
      try {
        ws.ping();

        // Set timeout for pong response
        const pongTimeout = setTimeout(() => {
          // If no pong received, close the connection
          logApi.debug('Client heartbeat timeout', {
            connectionId: clientInfo.connectionId,
            lastActivity: Math.floor((now - lastActivity) / 1000) + 's ago'
          });
          this.closeConnection(ws, 1008, 'Heartbeat timeout');
        }, this.heartbeatTimeout);

        // Store timeout
        clientInfo.pongTimeout = pongTimeout;

      } catch (error) {
        // If ping fails, close the connection
        logApi.error('Error sending heartbeat ping:', error);
        this.closeConnection(ws, 1011, 'Heartbeat error');
      }
    }

    // Restart the heartbeat timer
    this.startHeartbeat(ws);
  }

  /**
   * Send heartbeats to all clients
   */
  sendHeartbeats() {
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        this.checkHeartbeat(ws);
      }
    }
  }

  /**
   * Apply rate limiting to a client
   * @param {WebSocket} ws - The WebSocket connection
   * @returns {boolean} - Whether the client has exceeded the rate limit
   */
  applyRateLimit(ws) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return false;

    // Get current message count
    let count = this.messageRateLimits.get(ws) || 0;
    count++;

    // Update message count
    this.messageRateLimits.set(ws, count);

    // Check if exceeded
    if (count > this.rateLimit) {
      this.stats.rateLimitExceeded++;
      
      // Send error message
      this.sendError(ws, 'RATE_LIMIT_EXCEEDED', 'Message rate limit exceeded', 1008);
      
      // Return true to indicate rate limit exceeded
      return true;
    }

    return false;
  }

  /**
   * Reset rate limits for all clients
   */
  resetRateLimits() {
    this.messageRateLimits.clear();
  }

  /**
   * Parse a message from a client
   * @param {string|Buffer} data - The message data
   * @returns {Object|null} - The parsed message or null if invalid
   */
  parseMessage(data) {
    try {
      // If Buffer, convert to string
      const message = typeof data === 'string' ? data : data.toString('utf8');
      
      // Parse JSON
      return JSON.parse(message);
    } catch (error) {
      logApi.error('Error parsing message:', error);
      return null;
    }
  }

  /**
   * Clean up resources for a client
   * @param {WebSocket} ws - The WebSocket connection
   */
  cleanupClient(ws) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    // Clear all channel subscriptions
    for (const channel of clientInfo.subscriptions) {
      const subscribers = this.channelSubscriptions.get(channel);
      if (subscribers) {
        subscribers.delete(ws);
        
        // If no more subscribers, remove the channel
        if (subscribers.size === 0) {
          this.channelSubscriptions.delete(channel);
        }
      }
    }

    // Clear heartbeat timer
    this.stopHeartbeat(ws);

    // Clear pong timeout if exists
    if (clientInfo.pongTimeout) {
      clearTimeout(clientInfo.pongTimeout);
    }

    // Remove from rate limits
    this.messageRateLimits.delete(ws);

    // Remove from client tracking
    this.clientInfoMap.delete(ws);
    this.clients.delete(ws);
  }

  /**
   * Update server statistics
   */
  updateStats() {
    // Calculate average latency
    if (this.stats && this.stats.latencies && Array.isArray(this.stats.latencies) && this.stats.latencies.length > 0) {
      const sum = this.stats.latencies.reduce((a, b) => a + b, 0);
      this.stats.averageLatency = Math.round(sum / this.stats.latencies.length);
    }

    // Safety check for stats
    if (!this.stats) {
      logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 STATS ${fancyColors.RESET} ${fancyColors.YELLOW}Stats object is undefined for WebSocket at ${this.path}${fancyColors.RESET}`);
      this.stats = {
        startTime: Date.now(),
        totalConnections: 0,
        currentConnections: 0,
        messagesReceived: 0,
        messagesSent: 0,
        errors: 0,
        rateLimitExceeded: 0,
        authenticatedConnections: 0,
        unauthenticatedConnections: 0,
        channelCounts: {},
        latencies: []
      };
    }

    // Calculate uptime
    this.stats.uptime = Math.floor((Date.now() - (this.stats.startTime || Date.now())) / 1000); // in seconds

    // Ensure all properties exist to avoid undefined errors
    const safeStats = {
      path: this.path || 'unknown',
      connections: {
        total: this.stats.totalConnections || 0,
        current: this.stats.currentConnections || 0,
        authenticated: this.stats.authenticatedConnections || 0,
        unauthenticated: this.stats.unauthenticatedConnections || 0
      },
      messages: {
        received: this.stats.messagesReceived || 0,
        sent: this.stats.messagesSent || 0,
        averageLatency: (this.stats.averageLatency || 0) + 'ms',
        rateLimitExceeded: this.stats.rateLimitExceeded || 0
      },
      errors: this.stats.errors || 0,
      channels: this.stats.channelCounts || {},
      uptime: this.formatDuration(this.stats.uptime || 0)
    };

    // Log statistics
    logApi.info('WebSocket server statistics', safeStats);
  }

  /**
   * Get server metrics
   * @returns {Object} - The server metrics
   */
  getMetrics() {
    // Check if stats exist, initialize if not
    if (!this.stats) {
      this.stats = {
        startTime: Date.now(),
        totalConnections: 0,
        currentConnections: 0,
        messagesReceived: 0,
        messagesSent: 0,
        errors: 0,
        rateLimitExceeded: 0,
        authenticatedConnections: 0,
        unauthenticatedConnections: 0,
        channelCounts: {},
        latencies: [],
        uptime: 0
      };
    }
    
    // Calculate average latency with safety checks
    let averageLatency = 0;
    if (this.stats.latencies && Array.isArray(this.stats.latencies) && this.stats.latencies.length > 0) {
      const sum = this.stats.latencies.reduce((a, b) => a + b, 0);
      averageLatency = Math.round(sum / this.stats.latencies.length);
    }

    return {
      name: this.path,
      status: 'operational',
      metrics: {
        uptime: this.stats.uptime || 0,
        totalConnections: this.stats.totalConnections || 0,
        currentConnections: this.stats.currentConnections || 0,
        authenticatedConnections: this.stats.authenticatedConnections || 0,
        unauthenticatedConnections: this.stats.unauthenticatedConnections || 0,
        messagesReceived: this.stats.messagesReceived || 0,
        messagesSent: this.stats.messagesSent || 0,
        errors: this.stats.errors || 0,
        averageLatency,
        channelCount: this.channelSubscriptions ? this.channelSubscriptions.size : 0,
        lastUpdate: new Date().toISOString()
      },
      channels: this.stats.channelCounts || {},
      config: {
        requireAuth: this.requireAuth || false,
        maxPayload: this.maxPayload || 1048576, // 1MB default
        rateLimit: this.rateLimit || 60,
        publicEndpoints: this.publicEndpoints ? Array.from(this.publicEndpoints) : []
      }
    };
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes - The number of bytes
   * @returns {string} - Formatted string (e.g. "1.5 MB")
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Format duration in seconds to human-readable string
   * @param {number} seconds - The duration in seconds
   * @returns {string} - Formatted string (e.g. "2d 5h 30m 10s")
   */
  formatDuration(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    const parts = [];
    if (d > 0) parts.push(d + 'd');
    if (h > 0) parts.push(h + 'h');
    if (m > 0) parts.push(m + 'm');
    if (s > 0 || parts.length === 0) parts.push(s + 's');
    
    return parts.join(' ');
  }

  /**
   * Initialize the WebSocket server
   * @returns {Promise<boolean>} - Whether initialization was successful
   */
  async initialize() {
    try {
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.CYAN}Initializing WebSocket server at ${fancyColors.UNDERLINE}${this.path}${fancyColors.RESET}`);
      
      // Call the onInitialize handler which can be overridden by subclasses
      const result = await this.onInitialize();
      
      if (result !== false) {
        logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SUCCESS ${fancyColors.RESET} WebSocket server at ${fancyColors.BOLD}${this.path}${fancyColors.RESET} initialized successfully`);
        return true;
      } else {
        logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} FAILED ${fancyColors.RESET} WebSocket server at ${fancyColors.BOLD}${this.path}${fancyColors.RESET} initialization failed`);
        return false;
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}${error.message}${fancyColors.RESET}`, error);
      return false;
    }
  }

  /**
   * Clean up resources before shutdown
   * @returns {Promise<boolean>} - Whether cleanup was successful
   */
  async cleanup() {
    try {
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.CYAN}Cleaning up WebSocket server at ${fancyColors.UNDERLINE}${this.path}${fancyColors.RESET}`);
      
      // Stop background tasks
      if (this._heartbeatInterval) {
        clearInterval(this._heartbeatInterval);
        this._heartbeatInterval = null;
      }
      
      if (this._rateLimitInterval) {
        clearInterval(this._rateLimitInterval);
        this._rateLimitInterval = null;
      }
      
      if (this._statsInterval) {
        clearInterval(this._statsInterval);
        this._statsInterval = null;
      }
      
      if (this._metricsReportInterval) {
        clearInterval(this._metricsReportInterval);
        this._metricsReportInterval = null;
      }
      
      // Track stats for summary
      const connectionCount = this.clients.size;
      
      // Close all connections
      for (const ws of this.clients) {
        try {
          this.closeConnection(ws, 1001, 'Server shutting down');
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
      
      // Clear all maps
      this.clients.clear();
      this.clientInfoMap.clear();
      this.channelSubscriptions.clear();
      this.messageRateLimits.clear();
      this.heartbeatTimers.clear();
      
      // Close the WebSocket server
      if (this.wss) {
        this.wss.close();
      }
      
      // Report cleanup status via service events
      try {
        const serviceEvents = (await import('../../utils/service-suite/service-events.js')).default;
        serviceEvents.emit('service:status:update', {
          name: this.path,
          source: 'v69_websocket',
          status: 'shutdown',
          message: `WebSocket ${this.path} shutdown complete`,
          metrics: {
            connections_closed: connectionCount,
            total_connections: this.stats.totalConnections,
            total_messages: this.stats.messagesReceived + this.stats.messagesSent,
            total_errors: this.stats.errors
          }
        });
      } catch (error) {
        // Don't throw errors during cleanup
        logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.RED}Failed to report cleanup status: ${error.message}${fancyColors.RESET}`);
      }
      
      // Call the onCleanup handler which can be overridden by subclasses
      await this.onCleanup();
      
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SUCCESS ${fancyColors.RESET} WebSocket server at ${fancyColors.BOLD}${this.path}${fancyColors.RESET} cleaned up successfully ${fancyColors.DARK_YELLOW}(${connectionCount} connections closed)${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}${error.message}${fancyColors.RESET}`, error);
      return false;
    }
  }

  // ===== Overridable methods for subclasses =====

  /**
   * Called when the WebSocket server is initialized
   * @returns {Promise<boolean>} - Whether initialization was successful
   */
  async onInitialize() {
    return true;
  }

  /**
   * Called when a new client connects
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   */
  async onConnection(ws, req) {
    // Override in subclass
  }

  /**
   * Called when a client sends a message
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message object
   */
  async onMessage(ws, message) {
    // Override in subclass
  }

  /**
   * Called when a client disconnects
   * @param {WebSocket} ws - The WebSocket connection
   */
  async onClose(ws) {
    // Override in subclass
  }

  /**
   * Called when a client connection has an error
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Error} error - The error that occurred
   */
  async onError(ws, error) {
    // Override in subclass
  }

  /**
   * Called when a client subscribes to a channel
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} channel - The channel name
   */
  async onSubscribe(ws, channel) {
    // Override in subclass
  }

  /**
   * Called when a client unsubscribes from a channel
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} channel - The channel name
   */
  async onUnsubscribe(ws, channel) {
    // Override in subclass
  }

  /**
   * Called when the WebSocket server is cleaning up
   */
  async onCleanup() {
    // Override in subclass
  }
}

// Export a factory function for creating instances
export function createBaseWebSocketServer(server, options = {}) {
  return new BaseWebSocketServer(server, options);
}