// websocket/v69/base-websocket.js

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
import net from 'net';

// Fix for "cannot assign to read-only property" error
// We need to access the WebSocket's internal methods properly
// Cache a reference to the WebSocketServer class before we use it
const WebSocketServer = WebSocket.Server;

// WebSocket frame utilities removed to avoid interference with logging systems

/**
 * WebSocket configuration note: Compression is disabled for better compatibility
 * with various clients like wscat, Postman, and curl
 */

// Base WebSocket Server
/**
 * This is the base class for all WebSocket servers in the application.
 * It provides a standardized interface for managing WebSocket connections,
 * authentication, and other common functionality.
 * 
 * @extends {WebSocket.Server}
 */
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

    // Log the constructor call
    logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 CONSTRUCTOR ${fancyColors.RESET} ${fancyColors.YELLOW}Initializing BaseWebSocketServer${fancyColors.RESET}`, {
      wsEvent: 'constructor',
      server: server,
      options: options
    });

    // Set configuration options with defaults
    this.path = options.path;
    this.requireAuth = options.requireAuth !== false; // Default to true
    this.publicEndpoints = new Set(options.publicEndpoints || []);
    this.maxPayload = options.maxPayload || 1024 * 1024; // 1MB default
    this.rateLimit = options.rateLimit || 300; // 300 messages per minute
    
    // Compression settings - EXPLICITLY DISABLED for better compatibility
    // This prevents "RSV1 must be clear" errors with many clients
    this.perMessageDeflate = false; // Disable compression
    this.useCompression = false; // Alias for clarity - also set to FALSE
    
    // Time intervals
    this.heartbeatInterval = options.heartbeatInterval || 60000; // 60 seconds (increased to reduce frequency)
    this.heartbeatTimeout = options.heartbeatTimeout || 20000; // 20 seconds (increased for more tolerance)
    
    // Authentication mode (important for browser compatibility)
    // Possible values:
    // - 'query': Use query parameters (more reliable but less secure)
    // - 'header': Use Authorization header (more secure but can cause issues with some browsers)
    // - 'auto': Try header first, then fallback to query if not found (default)
    this.authMode = options.authMode || 'auto';

    // Initialize WebSocket server with compression EXPLICITLY DISABLED
    // This prevents "RSV1 must be clear" errors with many clients
    const wsOptions = {
      server,
      path: this.path,
      maxPayload: this.maxPayload,
      // Explicitly disable compression - CRITICAL for client compatibility
      perMessageDeflate: false,
      
      // CRITICAL FIX: Prevent all extensions from being negotiated
      // This is the key to fixing the "RSV1 must be clear" issue
      handleProtocols: (protocols, request) => {
        // Add VERY verbose logging for this specific connection request
        const requestId = uuidv4().substring(0, 8);
        logApi.info(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS-PROTOCOL-${requestId} ${fancyColors.RESET} Client protocol negotiation for ${this.path}`, {
          wsEvent: 'protocol_negotiation',
          protocols: protocols,
          host: request.headers.host,
          origin: request.headers.origin,
          path: request.url,
          sec_websocket_key: request.headers['sec-websocket-key'] || 'missing',
          sec_websocket_version: request.headers['sec-websocket-version'] || 'missing',
          sec_websocket_extensions: request.headers['sec-websocket-extensions'] || 'none',
          _highlight: true
        });
        
        // Delete any extension headers to prevent compression negotiation
        if (request.headers['sec-websocket-extensions']) {
          const extensionHeader = request.headers['sec-websocket-extensions'];
          logApi.warn(`${fancyColors.BG_RED}${fancyColors.WHITE} EXTENSION BLOCKED ${fancyColors.RESET} ${fancyColors.YELLOW}Removing extension header: ${extensionHeader}${fancyColors.RESET}`, {
            requestId,
            wsEvent: 'extension_blocked',
            extension: extensionHeader,
            _highlight: true
          });
          delete request.headers['sec-websocket-extensions'];
        }
        
        // Return the first protocol if any, or null
        return protocols.length > 0 ? protocols[0] : null;
      },
      
      // Add enhanced verification with full header logging
      verifyClient: (info, callback) => {
        const requestId = uuidv4().substring(0, 8);
        
        try {
          // Log ALL request headers in a clear, highlighted format
          logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} WS-HANDSHAKE-REQ-${requestId} ${fancyColors.RESET} ${fancyColors.CYAN}Complete handshake request headers for ${this.path}:${fancyColors.RESET}`, {
            wsEvent: 'handshake_request',
            endpoint: this.path,
            headers: info.req.headers,
            url: info.req.url,
            method: info.req.method,
            _highlight: true,
            _logtail_ws_event: 'ws_handshake'
          });
          
          // Set up a hook to capture the response headers
          // We need to monkey-patch the socket.write method to capture headers
          const originalWrite = info.req.socket.write;
          info.req.socket.write = function(data, encoding, callback) {
            try {
              // Only capture the HTTP response headers
              if (data && typeof data !== 'function' && data.toString().startsWith('HTTP/1.1 101')) {
                const responseHeaders = data.toString().split('\r\n');
                
                // Log the response headers
                logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS-HANDSHAKE-RESP-${requestId} ${fancyColors.RESET} ${fancyColors.CYAN}Complete handshake response headers for ${info.req.url}:${fancyColors.RESET}`, {
                  wsEvent: 'handshake_response',
                  headers: responseHeaders,
                  raw: data.toString(),
                  _highlight: true,
                  _logtail_ws_event: 'ws_handshake_response'
                });
                
                // Check specifically for compression extension in response
                const extensionHeader = responseHeaders.find(h => h.toLowerCase().startsWith('sec-websocket-extensions:'));
                if (extensionHeader && extensionHeader.toLowerCase().includes('permessage-deflate')) {
                  logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} COMPRESSION-DETECTED-${requestId} ${fancyColors.RESET} ${fancyColors.RED}WebSocket compression detected in response despite being disabled: ${extensionHeader}${fancyColors.RESET}`, {
                    wsEvent: 'compression_detected',
                    extensionHeader: extensionHeader,
                    _highlight: true,
                    _logtail_ws_event: 'ws_compression_error'
                  });
                }
                
                // Restore the original write method to prevent memory leaks
                info.req.socket.write = originalWrite;
              }
            } catch (err) {
              // Silent catch - don't break the socket if our debugging code fails
              logApi.error(`Error capturing handshake response: ${err.message}`);
            }
            
            // Call the original method
            return originalWrite.call(this, data, encoding, callback);
          };
          
          // Proceed with standard verification
          const req = info.req;
          const pathMatches = req.url.startsWith(this.path);
          
          if (!pathMatches) {
            logApi.warn(`${fancyColors.BG_RED}${fancyColors.WHITE} WS-VERIFY-ERROR-${requestId} ${fancyColors.RESET} ${fancyColors.RED}Path mismatch: ${req.url} does not match ${this.path}${fancyColors.RESET}`);
            callback(false, 404, 'Not Found');
            return;
          }
          
          // Process as normal - rest of your existing verification code here
          callback(true);
        } catch (error) {
          logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} WS-VERIFY-ERROR-${requestId} ${fancyColors.RESET} ${fancyColors.RED}Error in verifyClient: ${error.message}${fancyColors.RESET}`, error);
          callback(false, 500, 'Internal Server Error');
        }
      }
    };
    
    // Include any direct WebSocket options provided by subclasses
    if (options._ws_direct_options) {
      Object.assign(wsOptions, options._ws_direct_options);
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 CONFIG ${fancyColors.RESET} ${fancyColors.MAGENTA}Using direct WebSocket options to override defaults${fancyColors.RESET}`);
      
      // CRITICAL: Even with direct options, ensure compression is ALWAYS disabled
      wsOptions.perMessageDeflate = false;
    }
    
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 CONFIG ${fancyColors.RESET} Creating WebSocket server with compression: ${fancyColors.BG_RED}${fancyColors.WHITE} DISABLED ${fancyColors.RESET}`);
    
    // Create WebSocket server with fixed options
    this.wss = new WebSocket.Server(wsOptions);
    
    // CRITICAL: Add monkey-patching to ensure the WebSocket server NEVER uses compression
    // This ensures that even if the server tries to use compression, it will be disabled
    if (this.wss._options) {
      this.wss._options.perMessageDeflate = false;
      
      // Replace the built-in handler for Sec-WebSocket-Extension header
      // By monkey-patching the server's internal functions
      if (this.wss.handleUpgrade) {
        const originalHandleUpgrade = this.wss.handleUpgrade;
        this.wss.handleUpgrade = (request, socket, head, callback) => {
          // Force-remove any extension headers before passing to the original handler
          if (request.headers['sec-websocket-extensions']) {
            logApi.warn(`${fancyColors.BG_RED}${fancyColors.WHITE} EXTENSION OVERRIDE ${fancyColors.RESET} Removing extension header during upgrade: ${request.headers['sec-websocket-extensions']}`);
            delete request.headers['sec-websocket-extensions'];
          }
          
          // Call the original handler
          originalHandleUpgrade.call(this.wss, request, socket, head, callback);
        };
      }
      
      // Log actual server options for debugging
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 CONFIG ${fancyColors.RESET} WebSocket._options: perMessageDeflate=${!!this.wss._options.perMessageDeflate}`);
    }

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
      latencies: [],
      messageHistory: [],
      currentMessageRate: 0,
      uptime: 0,
      averageLatency: 0,
      connectionErrors: {  // Track WebSocket close codes
        1000: 0, // Normal closure
        1001: 0, // Going away
        1006: 0, // Abnormal closure
        1011: 0, // Internal error
        4000: 0, // Custom codes start
      }
    };

    // Initialize HTTP-level error tracking
    this.httpErrors = {
      total: 0,
      byCode: {},
      recent: []  // Keep track of recent errors
    };

    // Bind event handlers
    this.wss.on('connection', (ws, req) => {
      // CRITICAL: Force WebSocket to never use compression
      // This affects each individual WebSocket connection
      if (ws.extensions && typeof ws.extensions === 'object') {
        // Force clear any extensions on the WebSocket
        for (const ext in ws.extensions) {
          if (ws.extensions.hasOwnProperty(ext)) {
            delete ws.extensions[ext];
          }
        }
      }
      
      // RSV bit tracking removed
      
      // Now handle the connection normally
      this.handleConnection(ws, req);
    });
    
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

    // Handle HTTP upgrade
    server.on('upgrade', (request, socket, head) => {
      if (request.url.startsWith(this.path)) {
        // CRITICAL FIX: Always inject required WebSocket headers
        // This ensures the handshake will succeed even if they were stripped by middleware
        request.headers = request.headers || {};
        if (!request.headers['upgrade']) request.headers['upgrade'] = 'websocket';
        if (!request.headers['connection']) request.headers['connection'] = 'Upgrade';
        if (!request.headers['sec-websocket-key']) {
          // Generate a random key if missing
          const wsKey = Buffer.from(Math.random().toString(36).substring(2, 15)).toString('base64');
          request.headers['sec-websocket-key'] = wsKey;
          logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} HEADER INJECTION ${fancyColors.RESET} Adding missing Sec-WebSocket-Key header`);
        }
        if (!request.headers['sec-websocket-version']) {
          request.headers['sec-websocket-version'] = '13';
          logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} HEADER INJECTION ${fancyColors.RESET} Adding missing Sec-WebSocket-Version header`);
        }

        // Log the upgrade request details for debugging
        logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} UPGRADE REQUEST ${fancyColors.RESET} Request for ${request.url} with fixed headers:`, {
          path: request.url,
          method: request.method,
          headers: request.headers,
          _highlight: true
        });
        
        // Track HTTP-level errors
        const logHttpError = (code, message) => {
          this.httpErrors.total++;
          this.httpErrors.byCode[code] = (this.httpErrors.byCode[code] || 0) + 1;
          
          // Create structured error data for Logtail
          const errorData = {
            timestamp: new Date(),
            code,
            message,
            path: request.url,
            headers: request.headers,
            ip: request.socket.remoteAddress,
            query: url.parse(request.url, true).query,
            wsEvent: 'http_upgrade_error',
            service: 'WEBSOCKET',
            error_type: 'HTTP_UPGRADE',
            endpoint: this.path,
            // Add Logtail-specific properties
            _highlight: true,
            _color: '#FF0000',
            _icon: '🚫'
          };

          // Keep last 50 errors with timestamps
          this.httpErrors.recent.push(errorData);
          if (this.httpErrors.recent.length > 50) {
            this.httpErrors.recent.shift();
          }

          // Log the error with structured data for Logtail
          logApi.error(`WebSocket HTTP Error ${code}: ${message}`, errorData);

          // Update general error stats
          if (!this.stats) this.initializeStats();
          this.stats.errors++;
          this.stats.httpErrors = this.stats.httpErrors || {};
          this.stats.httpErrors[code] = (this.stats.httpErrors[code] || 0) + 1;
        };

        // Common HTTP error scenarios with improved error messages
        // RELAXED UPGRADE HEADER CHECK - allow connecting even with missing/invalid upgrade header
        if (!request.headers.upgrade || request.headers.upgrade.toLowerCase() !== 'websocket') {
          // Instead of rejecting, just log a warning and continue
          logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} UPGRADE WARNING ${fancyColors.RESET} Invalid or missing upgrade header: "${request.headers.upgrade || 'missing'}" - allowing connection anyway for compatibility`);
          // We don't return here - allowing the connection to proceed
        }

        if (this.requireAuth && !this.getAuthToken(request)) {
          const query = url.parse(request.url, true).query;
          
          // RELAXED AUTH CHECK - Log a warning but don't reject if this is the token-data endpoint
          // This helps with testing the token-data WebSocket which has auth disabled in its config
          if (request.url.startsWith('/api/v69/ws/token-data')) {
            logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} AUTH WARNING ${fancyColors.RESET} Missing auth token for token-data endpoint - allowing connection anyway`);
          } else {
            logHttpError(401, `Missing authentication token. Query params: ${JSON.stringify(query)}`);
            socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nAuthentication required');
            socket.destroy();
            return;
          }
        }

        // Log the upgrade attempt for debugging
        logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} UPGRADE ATTEMPT ${fancyColors.RESET} Attempting to upgrade WebSocket connection for ${request.url}`);
        
        // CRITICAL FIX: Ensure headers are correctly preserved for upgrade
        // WebSocket requires specific headers to be present for a successful handshake
        if (!request.headers['sec-websocket-key']) {
          logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BASE-WS-HEADER-FIX ${fancyColors.RESET} Adding missing Sec-WebSocket-Key header`);
          const wsKey = Buffer.from(Math.random().toString(36).substring(2, 15)).toString('base64');
          request.headers['sec-websocket-key'] = wsKey;
        }
        
        if (!request.headers['sec-websocket-version']) {
          logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BASE-WS-HEADER-FIX ${fancyColors.RESET} Adding missing Sec-WebSocket-Version header`);
          request.headers['sec-websocket-version'] = '13';
        }
        
        // Always ensure these critical headers are set properly
        request.headers.upgrade = 'websocket';
        request.headers.connection = 'Upgrade';
        
        // Log headers before upgrade
        logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} PRE-UPGRADE HEADERS ${fancyColors.RESET} Headers before handleUpgrade:`, {
          headers: request.headers,
          path: request.url,
          _highlight: true
        });
        
        try {
          // LAST-CHANCE FIX: Make a complete clone of the request with new headers
          // This ensures we bypass any issues with the original request object
          const clonedRequest = Object.assign({}, request, {
            headers: {
              // Start with a fresh headers object with only what we need
              'host': request.headers.host || 'localhost:3004',
              'user-agent': request.headers['user-agent'] || 'DegenDuel/Forced-Header-Fix',
              'upgrade': 'websocket',
              'connection': 'Upgrade',
              'sec-websocket-key': request.headers['sec-websocket-key'] || 
                Buffer.from(Math.random().toString(36).substring(2, 15)).toString('base64'),
              'sec-websocket-version': request.headers['sec-websocket-version'] || '13'
            },
            // Ensure other request properties are preserved
            url: request.url,
            method: request.method || 'GET'
          });
          
          // Log the final fixed headers before upgrade
          logApi.warn(`${fancyColors.BG_RED}${fancyColors.WHITE} FINAL HEADERS FIX ${fancyColors.RESET} Completely recreated request with fresh headers:`, {
            url: clonedRequest.url,
            method: clonedRequest.method,
            headers: clonedRequest.headers,
            _highlight: true
          });
          
          // CRITICAL FIX: Add better error handling around handleUpgrade
          try {
            this.wss.handleUpgrade(clonedRequest, socket, head, (ws) => {
              logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} UPGRADE SUCCESS ${fancyColors.RESET} Successfully upgraded to WebSocket for ${clonedRequest.url}`);
              this.wss.emit('connection', ws, clonedRequest);
            });
          } catch (upgradeError) {
            logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} UPGRADE ERROR LAST RESORT ${fancyColors.RESET} Critical error during WebSocket upgrade: ${upgradeError.message}`, {
              error: upgradeError.message,
              stack: upgradeError.stack,
              headers: clonedRequest.headers,
              _highlight: true
            });
            
            // Try to send one last error response
            try {
              socket.write('HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/plain\r\n\r\nCritical WebSocket upgrade error: ' + upgradeError.message);
              socket.destroy();
            } catch (error) {
              // At this point we can't do anything more
            }
          }
        } catch (upgradeError) {
          // Log the error and attempt to send a friendly response
          logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} UPGRADE ERROR ${fancyColors.RESET} Error during WebSocket upgrade: ${upgradeError.message}`, {
            error: upgradeError.message,
            path: request.url,
            headers: request.headers,
            _highlight: true
          });
          
          // Try to send an error response
          try {
            socket.write('HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/plain\r\n\r\nWebSocket upgrade failed');
            socket.destroy();
          } catch (responseError) {
            logApi.error(`Failed to send error response: ${responseError.message}`);
          }
        }
      }
    });
  }

  /**
   * Set up background maintenance tasks
   * @private
   */
  async _setupBackgroundTasks() {
    this.updateStats();
  }

  updateStats() {
    if (!this.stats) {
      this.initializeStats();
    }

    // Update current connections count from actual client set
    this.stats.currentConnections = this.clients.size;

    // Update authenticated/unauthenticated counts
    let authenticatedCount = 0;
    let unauthenticatedCount = 0;
    for (const [ws, clientInfo] of this.clientInfoMap.entries()) {
      if (clientInfo.authenticated) {
        authenticatedCount++;
      } else {
        unauthenticatedCount++;
      }
    }
    this.stats.authenticatedConnections = authenticatedCount;
    this.stats.unauthenticatedConnections = unauthenticatedCount;

    // Update channel counts from actual subscriptions
    const newChannelCounts = {};
    for (const [channel, subscribers] of this.channelSubscriptions.entries()) {
      newChannelCounts[channel] = subscribers.size;
    }
    this.stats.channelCounts = newChannelCounts;

    // Calculate average latency (keep last 100 measurements)
    if (this.stats.latencies.length > 0) {
      const sum = this.stats.latencies.reduce((a, b) => a + b, 0);
      this.stats.averageLatency = Math.round(sum / this.stats.latencies.length);
      // Trim latencies array if it's too long
      if (this.stats.latencies.length > 100) {
        this.stats.latencies = this.stats.latencies.slice(-100);
      }
    }

    // Update uptime
    this.stats.uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);

    // Calculate message rate (messages per second)
    const now = Date.now();
    const timeWindow = 60000; // 1 minute window
    this.stats.messageHistory = this.stats.messageHistory.filter(msg => now - msg.timestamp < timeWindow);
    this.stats.currentMessageRate = this.stats.messageHistory.length / (timeWindow / 1000);

    // Add error summary with better structure for Logtail
    const errorSummary = {
      total: this.stats.errors,
      http: {
        total: this.httpErrors.total,
        byCode: this.httpErrors.byCode,
        recent: this.httpErrors.recent.slice(-5).map(err => ({
          code: err.code,
          message: err.message,
          timestamp: err.timestamp,
          path: err.path
        }))
      },
      websocket: {
        byCode: this.stats.connectionErrors,
        recent: Object.entries(this.stats.connectionErrors)
          .filter(([_, count]) => count > 0)
          .reduce((acc, [code, count]) => ({
            ...acc,
            [code]: {
              count,
              description: this.getWebSocketErrorDescription(code)
            }
          }), {})
      },
      rateLimitExceeded: this.stats.rateLimitExceeded
    };

    // Prepare safe stats object for logging with Logtail metadata
    const safeStats = {
      path: this.path,
      connections: {
        total: this.stats.totalConnections,
        current: this.stats.currentConnections,
        authenticated: this.stats.authenticatedConnections,
        unauthenticated: this.stats.unauthenticatedConnections
      },
      messages: {
        received: this.stats.messagesReceived,
        sent: this.stats.messagesSent,
        rate: Math.round(this.stats.currentMessageRate * 100) / 100,
        averageLatency: `${this.stats.averageLatency || 0}ms`
      },
      errors: errorSummary,
      channels: this.stats.channelCounts,
      uptime: this.formatDuration(this.stats.uptime),
      // Add Logtail metadata
      service: 'WEBSOCKET',
      wsEvent: 'stats_update',
      endpoint: this.path
    };

    // Add visual indicators for error conditions
    const hasErrors = this.stats.errors > 0 || this.httpErrors.total > 0;
    const has1006Errors = this.stats.connectionErrors[1006] > 0;
    const hasHttpErrors = this.httpErrors.total > 0;

    // Create an error status message
    let statusMessage = '';
    if (hasErrors) {
      const errorParts = [];
      if (has1006Errors) {
        errorParts.push(`${this.stats.connectionErrors[1006]} abnormal closures (1006)`);
      }
      if (hasHttpErrors) {
        errorParts.push(`${this.httpErrors.total} HTTP errors`);
      }
      statusMessage = ` | ${errorParts.join(', ')}`;
    }

    // Log statistics with proper Logtail metadata
    logApi.info(`WebSocket Stats for ${this.path}${statusMessage}`, {
      ...safeStats,
      _highlight: hasErrors,
      _color: hasErrors ? '#FF0000' : '#00AA00',
      _icon: hasErrors ? '⚠️' : '✅'
    });

    // If there are errors, log additional error details with proper Logtail formatting
    if (hasErrors) {
      logApi.error(`Recent WebSocket errors for ${this.path}`, {
        ...errorSummary,
        service: 'WEBSOCKET',
        wsEvent: 'error_summary',
        endpoint: this.path,
        _highlight: true,
        _color: '#FF0000',
        _icon: '🚨'
      });
    }
  }

  /**
   * Initialize statistics object
   * @private
   */
  initializeStats() {
    this.stats = {
      startTime: Date.now(),
      totalConnections: 0,
      currentConnections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      httpErrors: {},  // Track HTTP errors by code
      rateLimitExceeded: 0,
      authenticatedConnections: 0,
      unauthenticatedConnections: 0,
      channelCounts: {},
      latencies: [],
      messageHistory: [],
      currentMessageRate: 0,
      uptime: 0,
      averageLatency: 0,
      connectionErrors: {  // Track WebSocket close codes
        1000: 0, // Normal closure
        1001: 0, // Going away
        1006: 0, // Abnormal closure
        1011: 0, // Internal error
        4000: 0, // Custom codes start
      }
    };
  }

  /**
   * Record a message for statistics
   * @private
   */
  recordMessage(type = 'received') {
    if (!this.stats) {
      this.initializeStats();
    }

    // Update message counts
    if (type === 'received') {
      this.stats.messagesReceived++;
    } else if (type === 'sent') {
      this.stats.messagesSent++;
    }

    // Add to message history for rate calculation
    this.stats.messageHistory = this.stats.messageHistory || [];
    this.stats.messageHistory.push({
      timestamp: Date.now(),
      type
    });
  }

  // Get server metrics
  /**
   * Get server metrics
   * @returns {Object} - The server metrics
   */
  getMetrics() {
    logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 GET-METRICS ${fancyColors.RESET} ${fancyColors.YELLOW}Getting server metrics${fancyColors.RESET}`, {
      wsEvent: 'get_metrics'
    });

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

  // Format bytes to human-readable string
  /**
   * Format bytes to human-readable string
   * @param {number} bytes - The number of bytes
   * @returns {string} - Formatted string (e.g. "1.5 MB")
   */
  formatBytes(bytes) {
    logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 FORMAT-BYTES ${fancyColors.RESET} ${fancyColors.YELLOW}Formatting bytes: ${bytes}${fancyColors.RESET}`, {
      wsEvent: 'format_bytes',
      bytes: bytes
    });

    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Format duration in seconds to human-readable string
  /**
   * Format duration in seconds to human-readable string
   * @param {number} seconds - The duration in seconds
   * @returns {string} - Formatted string (e.g. "2d 5h 30m 10s")
   */
  formatDuration(seconds) {
    logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 FORMAT-DURATION ${fancyColors.RESET} ${fancyColors.YELLOW}Formatting duration: ${seconds}s${fancyColors.RESET}`, {
      wsEvent: 'format_duration',
      seconds: seconds
    });

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

  // Initialize the WebSocket server
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

  // Clean up resources before shutdown
  /**
   * Clean up resources before shutdown
   * @returns {Promise<boolean>} - Whether cleanup was successful
   */
  async cleanup() {
    try {
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.CYAN}Cleaning up WebSocket server at ${fancyColors.UNDERLINE}${this.path}${fancyColors.RESET}`);
      
      // Start a timer for resource release tracking
      const startTime = Date.now();
      
      // Track stats for summary
      const connectionCount = this.clients ? this.clients.size : 0;
      
      // Stop background tasks
      const intervals = [
        this._heartbeatInterval,
        this._rateLimitInterval,
        this._statsInterval, 
        this._metricsReportInterval
      ].filter(Boolean);
      
      for (const interval of intervals) {
        clearInterval(interval);
      }
      this._heartbeatInterval = null;
      this._rateLimitInterval = null;
      this._statsInterval = null;
      this._metricsReportInterval = null;
      
      // Stop any custom timers
      if (Array.isArray(this._customIntervals)) {
        for (const interval of this._customIntervals) {
          clearInterval(interval);
        }
        this._customIntervals = [];
      }
      
      if (Array.isArray(this._customTimeouts)) {
        for (const timeout of this._customTimeouts) {
          clearTimeout(timeout);
        }
        this._customTimeouts = [];
      }
      
      // Close all connections with a reasonable timeout
      if (this.clients && this.clients.size > 0) {
        const closePromises = [];
        
        for (const client of this.clients) {
          closePromises.push(new Promise(resolve => {
            try {
              // Add close event listener to track completion
              client.once('close', () => resolve(true));
              
              // Set a timeout to resolve anyway after 1 second
              const timeout = setTimeout(() => {
                // Remove the event listener to prevent memory leaks
                client.removeAllListeners('close');
                resolve(false);
              }, 1000);
              
              // Ensure timeout doesn't keep process alive
              timeout.unref();
              
              // Close connection
              this.closeConnection(client, 1001, 'Server shutting down');
            } catch (error) {
              // Resolve on error to continue cleanup
              resolve(false);
            }
          }));
        }
        
        // Wait for all connections to close with a timeout
        const connectionCloseTimeout = setTimeout(() => {
          logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.YELLOW}Connection close timeout reached for ${this.path}${fancyColors.RESET}`);
        }, 2000);
        connectionCloseTimeout.unref();
        
        await Promise.race([
          Promise.all(closePromises),
          new Promise(resolve => setTimeout(resolve, 2500))
        ]);
        
        clearTimeout(connectionCloseTimeout);
      }
      
      // Clear all maps
      if (this.clients) this.clients.clear();
      if (this.clientInfoMap) this.clientInfoMap.clear();
      if (this.channelSubscriptions) this.channelSubscriptions.clear();
      if (this.messageRateLimits) this.messageRateLimits.clear();
      if (this.heartbeatTimers) {
        // Clear all heartbeat timeouts
        for (const timeout of this.heartbeatTimers.values()) {
          clearTimeout(timeout);
        }
        this.heartbeatTimers.clear();
      }
      
      // Close the WebSocket server
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }
      
      // Null any additional references that might prevent garbage collection
      this._pendingMessages = null;
      this._messageQueue = null;
      
      // Call the onCleanup handler which can be overridden by subclasses
      // But don't let it log its own success message
      await Promise.race([
        this.onCleanup(),
        new Promise(resolve => setTimeout(resolve, 1000)) // 1s timeout for onCleanup
      ]);
      
      const cleanupTimeMs = Date.now() - startTime;

      // Report cleanup status via service events - without using broadcastToChannel
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
            total_errors: this.stats.errors,
            cleanup_time_ms: cleanupTimeMs
          }
        });
      } catch (error) {
        // Don't throw errors during cleanup
        logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.RED}Failed to report cleanup status: ${error.message}${fancyColors.RESET}`);
      }

      // Single, consistent cleanup success message
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SUCCESS ${fancyColors.RESET} WebSocket server at ${fancyColors.BOLD}${this.path}${fancyColors.RESET} cleaned up successfully ${fancyColors.DARK_YELLOW}(${connectionCount} connections closed, ${cleanupTimeMs}ms)${fancyColors.RESET}`);
      
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}${error.message}${fancyColors.RESET}`, error);
      return false;
    }
  }

  // ===== Overridable methods for subclasses =====

  // Called when the WebSocket server is initialized
  /**
   * Called when the WebSocket server is initialized
   * @returns {Promise<boolean>} - Whether initialization was successful
   */
  async onInitialize() {
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.CYAN}Initializing WebSocket server at ${fancyColors.UNDERLINE}${this.path}${fancyColors.RESET}`);
    return true;
  }

  // Called when a new client connects
  /**
   * Called when a new client connects
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   */
  async onConnection(ws, req) {
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.GREEN} V69 CLIENT CONNECTED ${fancyColors.RESET} ${fancyColors.GREEN}Client connected${fancyColors.RESET}`, {
      wsEvent: 'client_connected'
    });
    // Override in subclass
  }

  // Called when a client sends a message
  /**
   * Called when a client sends a message
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message object
   */
  async onMessage(ws, message) {
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLUE} V69 CLIENT MESSAGE ${fancyColors.RESET} ${fancyColors.BLUE}Message: ${message}${fancyColors.RESET}`, {
      wsEvent: 'client_message',
      message: message
    });
    // Override in subclass
  }

  // Called when a client disconnects
  /**
   * Called when a client disconnects
   * @param {WebSocket} ws - The WebSocket connection
   */
  async onClose(ws) {
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 CLIENT DISCONNECTED ${fancyColors.RESET} ${fancyColors.RED}Client disconnected${fancyColors.RESET}`, {
      wsEvent: 'client_disconnected'
    });
    // Override in subclass
  }

  // Called when a client connection has an error
  /**
   * Called when a client connection has an error
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Error} error - The error that occurred
   */
  async onError(ws, error) {
    logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 CLIENT ERROR ${fancyColors.RESET} ${fancyColors.RED}Error: ${error.message}${fancyColors.RESET}`, {
      error: error.message,
      wsEvent: 'error_occurred'
    });
    // Override in subclass
  }

  // Called when a client subscribes to a channel
  /**
   * Called when a client subscribes to a channel
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} channel - The channel name
   */
  async onSubscribe(ws, channel) {
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.GREEN} V69 CLIENT SUBSCRIBED ${fancyColors.RESET} ${fancyColors.GREEN}Channel: ${channel}${fancyColors.RESET}`, {
      wsEvent: 'client_subscribed',
      channel: channel
    });
    // Override in subclass
  }

  // Called when a client unsubscribes from a channel
  /**
   * Called when a client unsubscribes from a channel
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} channel - The channel name
   */
  async onUnsubscribe(ws, channel) {
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 CLIENT UNSUBSCRIBED ${fancyColors.RESET} ${fancyColors.RED}Channel: ${channel}${fancyColors.RESET}`, {
      wsEvent: 'client_unsubscribed',
      channel: channel
    });
    // Override in subclass
  }

  // Called when the WebSocket server is cleaning up
  /**
   * Called when the WebSocket server is cleaning up
   * This method should be overridden by subclasses to perform specific cleanup
   * but should NOT log success messages (that's handled by the base class)
   */
  async onCleanup() {
    // Override in subclass to perform specific cleanup
    // But don't log success messages here
  }
  
  // Handle server-level errors (not client-specific)
  /**
   * Handle server-level errors (not client-specific)
   * @param {Error} error - The error that occurred
   */
  async handleServerError(error) {
    // Create detailed error info for logging and tracking
    const errorInfo = {
      error: error.message,
      path: this.path,
      timestamp: new Date().toISOString(),
      stack: error.stack,
      wsEvent: 'server_error',
      // Detailed server state for debugging
      serverStats: {
        totalConnections: this.stats.totalConnections,
        currentConnections: this.stats.currentConnections,
        authenticatedConnections: this.stats.authenticatedConnections,
        errors: this.stats.errors,
        startTime: this.stats.startTime
      },
      // High visibility for critical server issues
      _highlight: true,
      _color: '#FF0000'  // Red for critical errors
    };
    
    // Log with high visibility - critical server errors need attention
    logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SERVER-ERROR ${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} 🚨 SERVER ERROR 🚨 ${fancyColors.RESET} ${error.message}`, errorInfo);

    // Update stats
    this.stats.errors++;
    this.stats.serverErrors = (this.stats.serverErrors || 0) + 1;
    
    // Attempt to capture IP information if possible (this may not be possible for all server errors)
    try {
      // If this is a handshake error, it may contain client IP information
      if (error.req && error.req.socket) {
        const clientIp = error.req.socket.remoteAddress || 
                        (error.req.headers && error.req.headers['x-forwarded-for']) || 
                        (error.req.headers && error.req.headers['x-real-ip']) || 
                        'unknown';
                        
        // Try to get city/country information for this IP address
        if (config.ipinfo && config.ipinfo.api_key) {
          const getIpInfo = logApi.getIpInfo;
          if (typeof getIpInfo === 'function') {
            try {
              const ipInfo = await getIpInfo(clientIp);
              if (ipInfo && !ipInfo.bogon && !ipInfo.error) {
                logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SERVER-ERROR-IP ${fancyColors.RESET} Client IP: ${clientIp} (${ipInfo.city || 'Unknown'}, ${ipInfo.region || 'Unknown'}, ${ipInfo.country || 'Unknown'})`, {
                  ip: clientIp,
                  ip_info: ipInfo,
                  wsEvent: 'server_error_ip_info',
                  error: error.message
                });
              }
            } catch (ipError) {
              // Don't let IP lookup errors affect server error handling
              logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 IP-ERROR ${fancyColors.RESET} Failed to get IP info for server error: ${ipError.message}`);
            }
          }
        }
      }
    } catch (ipAttemptError) {
      // Ignore errors in IP capture, don't let them affect the main error handling flow
    }

    // Try to emit an event for monitoring systems
    try {
      const serviceEvents = (await import('../../utils/service-suite/service-events.js')).default;
      serviceEvents.emit('service:error', {
        name: this.path,
        source: 'v69_websocket_server',
        status: 'error',
        error: error.message,
        metrics: this.getMetrics(),
        details: errorInfo
      });
    } catch (eventError) {
      // Don't let event emission errors cascade
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 EVENT-ERROR ${fancyColors.RESET} Failed to emit service error event: ${eventError.message}`);
    }
  }

  // Helper method to get WebSocket error descriptions
  getWebSocketErrorDescription(code) {
    const descriptions = {
      1000: 'Normal closure',
      1001: 'Going away',
      1002: 'Protocol error',
      1003: 'Unsupported data',
      1004: 'Reserved',
      1005: 'No status received',
      1006: 'Abnormal closure',
      1007: 'Invalid frame payload data',
      1008: 'Policy violation',
      1009: 'Message too big',
      1010: 'Mandatory extension',
      1011: 'Internal server error',
      1012: 'Service restart',
      1013: 'Try again later',
      1014: 'Bad gateway',
      1015: 'TLS handshake',
      4000: 'Custom application error'
    };
    return descriptions[code] || 'Unknown error code';
  }

  /**
   * Handle a new WebSocket connection with proper client info extraction
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   * @private
   */
  async handleConnection(ws, req) {
    try {
      // Generate a unique ID for this connection
      const connectionId = uuidv4();
      const startTime = Date.now();
      
      // Extract IP address with X-Forwarded-For support
      let clientIp = req.socket.remoteAddress;
      
      // Check for proxy headers (X-Forwarded-For)
      if (req.headers['x-forwarded-for']) {
        // Get the first IP in the chain (actual client)
        const forwardedIps = req.headers['x-forwarded-for'].split(',');
        clientIp = forwardedIps[0].trim();
        
        logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 X-FORWARDED-FOR ${fancyColors.RESET} Using forwarded IP: ${clientIp} (from chain: ${req.headers['x-forwarded-for']})`, {
          wsEvent: 'client_ip_forwarded',
          originalIp: req.socket.remoteAddress,
          forwardedIp: clientIp,
          fullChain: req.headers['x-forwarded-for']
        });
      }
      
      // Also check X-Real-IP as fallback
      if (!clientIp && req.headers['x-real-ip']) {
        clientIp = req.headers['x-real-ip'];
        
        logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 X-REAL-IP ${fancyColors.RESET} Using real IP: ${clientIp}`, {
          wsEvent: 'client_ip_real',
          originalIp: req.socket.remoteAddress,
          realIp: clientIp
        });
      }
      
      // Get URL parameters and path
      const urlParts = url.parse(req.url, true);
      const params = urlParts.query;
      
      // Connection info for tracking
      const connectionInfo = {
        id: connectionId,
        ip: clientIp,
        userAgent: req.headers['user-agent'] || 'unknown',
        path: urlParts.pathname,
        parameters: params,
        connectedAt: new Date(),
        authenticated: false,
        userId: null,
        walletAddress: null,
        username: null,
        role: null
      };
      
      // Set up initial client state
      this.clients.add(ws);
      this.clientInfoMap.set(ws, connectionInfo);
      this.stats.totalConnections++;
      this.stats.currentConnections = this.clients.size;
      
      // Update connection timestamp
      ws.isAlive = true;
      ws.lastMessageTime = Date.now();
      
      // Process authentication if required
      if (this.requireAuth && !this.publicEndpoints.has(urlParts.pathname)) {
        // Extract token based on the configured auth mode
        const token = this.getAuthToken(req);
        
        if (!token) {
          logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 AUTH-FAILED ${fancyColors.RESET} No auth token provided for protected endpoint: ${urlParts.pathname}`, {
            wsEvent: 'auth_missing_token',
            endpoint: urlParts.pathname,
            ip: clientIp,
            _highlight: true
          });
          
          // Send authentication error
          this.sendToClient(ws, {
            type: 'ERROR',
            code: 'AUTH_REQUIRED',
            message: 'Authentication required for this endpoint',
            timestamp: new Date().toISOString()
          });
          
          // Close the connection with auth error code
          this.closeConnection(ws, 4401, 'Authentication required');
          return;
        }
        
        try {
          // Verify the JWT
          const decoded = jwt.verify(token, config.jwt.secret);
          
          if (!decoded || !decoded.wallet_address) {
            throw new Error('Invalid token payload');
          }
          
          // Check if user exists
          const user = await prisma.users.findUnique({
            where: { wallet_address: decoded.wallet_address },
            select: {
              id: true,
              wallet_address: true,
              role: true,
              username: true,
              is_banned: true
            }
          });
          
          if (!user) {
            throw new Error('User not found');
          }
          
          if (user.is_banned) {
            throw new Error('User is banned');
          }
          
          // Update client info with authenticated user data
          connectionInfo.authenticated = true;
          connectionInfo.userId = user.id;
          connectionInfo.walletAddress = user.wallet_address;
          connectionInfo.username = user.username;
          connectionInfo.role = user.role;
          
          // Update the map
          this.clientInfoMap.set(ws, connectionInfo);
          
          // Update authenticated connections count
          this.stats.authenticatedConnections++;
          
          logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.GREEN} V69 AUTH-SUCCESS ${fancyColors.RESET} Client authenticated: ${user.username} (${user.wallet_address})`, {
            wsEvent: 'client_authenticated',
            userId: user.id,
            walletAddress: user.wallet_address,
            username: user.username,
            role: user.role,
            ip: clientIp
          });
          
        } catch (authError) {
          logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 AUTH-ERROR ${fancyColors.RESET} Authentication failed: ${authError.message}`, {
            wsEvent: 'auth_error',
            error: authError.message,
            endpoint: urlParts.pathname,
            ip: clientIp,
            _highlight: true
          });
          
          // Send auth error
          this.sendToClient(ws, {
            type: 'ERROR',
            code: 'AUTH_FAILED',
            message: 'Authentication failed: ' + authError.message,
            timestamp: new Date().toISOString()
          });
          
          // Close the connection with auth error code
          this.closeConnection(ws, 4401, 'Authentication failed');
          return;
        }
      } else {
        // For public endpoints, mark as unauthenticated
        this.stats.unauthenticatedConnections++;
      }
      
      // Set up WebSocket event handlers
      
      // Handle pings to keep the connection alive
      ws.on('pong', () => {
        ws.isAlive = true;
        
        // Clear any timeout that might be waiting to terminate this connection
        if (ws._heartbeatTimeout) {
          clearTimeout(ws._heartbeatTimeout);
          ws._heartbeatTimeout = null;
        }
      });
      
      // Handle client disconnect
      ws.on('close', (code, reason) => {
        this.handleClose(ws, code, reason);
      });
      
      // Handle client errors
      ws.on('error', (error) => {
        this.handleError(ws, error);
      });
      
      // Handle incoming messages
      ws.on('message', (data) => {
        this.handleMessage(ws, data);
      });
      
      // Record connection time for performance metrics
      const connectionTimeMs = Date.now() - startTime;
      
      // Log connection info
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.GREEN} V69 CONNECTED ${fancyColors.RESET} Client connected to ${urlParts.pathname} (${connectionTimeMs}ms)`, {
        wsEvent: 'client_connected',
        connectionId,
        ip: clientIp,
        path: urlParts.pathname,
        authenticated: connectionInfo.authenticated,
        userId: connectionInfo.userId,
        connectionTimeMs,
        userAgent: connectionInfo.userAgent
      });
      
      // Set up heartbeat timeout
      this.setupHeartbeat(ws);
      
      // Call the onConnection handler in subclasses
      await this.onConnection(ws, req);
      
      // Send initial connection confirmation
      this.sendToClient(ws, {
        type: 'CONNECTED',
        connectionId,
        timestamp: new Date().toISOString(),
        authenticated: connectionInfo.authenticated,
        message: `Connected to ${this.path}`
      });
      
    } catch (error) {
      // Log the error with stack trace
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 CONNECTION-ERROR ${fancyColors.RESET} Error handling connection: ${error.message}`, {
        wsEvent: 'connection_error',
        error: error.message,
        stack: error.stack,
        path: this.path,
        _highlight: true
      });
      
      // Close the connection with error code
      try {
        this.closeConnection(ws, 1011, 'Internal server error');
      } catch (closeError) {
        // Just log and continue if close fails
        logApi.error(`Failed to close connection after error: ${closeError.message}`);
      }
      
      // Update error statistics
      this.stats.errors++;
      this.stats.connectionErrors[1011] = (this.stats.connectionErrors[1011] || 0) + 1;
    }
  }

  /**
   * Helper method to extract authentication token based on configured mode
   * @param {http.IncomingMessage} req - The HTTP request
   * @returns {string|null} - The authentication token or null
   * @private
   */
  getAuthToken(req) {
    // Extract based on authentication mode
    switch (this.authMode) {
      case 'header':
        // Try Authorization header
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          return authHeader.substring(7);
        }
        return null;
        
      case 'query':
        // Try query parameters
        const urlParts = url.parse(req.url, true);
        return urlParts.query.token || null;
        
      case 'protocol':
        // Try WebSocket protocol header (often used for auth)
        return req.headers['sec-websocket-protocol'] || null;
        
      case 'auto':
      default:
        // Try all methods in order: header, query, protocol
        // Header auth
        const auth = req.headers.authorization;
        if (auth && auth.startsWith('Bearer ')) {
          return auth.substring(7);
        }
        
        // Query param auth
        const query = url.parse(req.url, true).query;
        if (query.token) {
          return query.token;
        }
        
        // Protocol auth
        if (req.headers['sec-websocket-protocol']) {
          return req.headers['sec-websocket-protocol'];
        }
        
        return null;
    }
  }

  /**
   * Handle WebSocket close event
   * @param {WebSocket} ws - The WebSocket connection
   * @param {number} code - The close code
   * @param {string} reason - The close reason
   * @private
   */
  async handleClose(ws, code, reason) {
    try {
      const clientInfo = this.clientInfoMap.get(ws);
      
      // Update statistics
      this.stats.currentConnections = Math.max(0, this.stats.currentConnections - 1);
      if (clientInfo && clientInfo.authenticated) {
        this.stats.authenticatedConnections = Math.max(0, this.stats.authenticatedConnections - 1);
      } else {
        this.stats.unauthenticatedConnections = Math.max(0, this.stats.unauthenticatedConnections - 1);
      }
      
      // Track close code
      if (code) {
        this.stats.connectionErrors[code] = (this.stats.connectionErrors[code] || 0) + 1;
      } else {
        // Code 1005 means no status code was provided
        this.stats.connectionErrors[1005] = (this.stats.connectionErrors[1005] || 0) + 1;
      }
      
      // Remove from clients and maps
      this.clients.delete(ws);
      this.clientInfoMap.delete(ws);
      
      // Remove from all channel subscriptions
      for (const [channel, subscribers] of this.channelSubscriptions.entries()) {
        if (subscribers.has(ws)) {
          subscribers.delete(ws);
        }
      }
      
      // Clear any heartbeat timeout
      if (ws._heartbeatTimeout) {
        clearTimeout(ws._heartbeatTimeout);
        ws._heartbeatTimeout = null;
      }
      
      // Log disconnection
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 DISCONNECTED ${fancyColors.RESET} Client disconnected: code=${code || 'unknown'}, reason=${reason || 'none'}`, {
        wsEvent: 'client_disconnected',
        code,
        reason,
        ip: clientInfo?.ip,
        userId: clientInfo?.userId,
        walletAddress: clientInfo?.walletAddress,
        connectionDuration: clientInfo ? Math.floor((Date.now() - clientInfo.connectedAt) / 1000) + 's' : 'unknown'
      });
      
      // Call the onClose handler in subclasses
      await this.onClose(ws);
      
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 CLOSE-ERROR ${fancyColors.RESET} Error handling connection close: ${error.message}`, {
        wsEvent: 'close_error',
        error: error.message,
        stack: error.stack,
        _highlight: true
      });
    }
  }

  /**
   * Handle WebSocket error event
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Error} error - The error
   * @private
   */
  async handleError(ws, error) {
    try {
      const clientInfo = this.clientInfoMap.get(ws);
      
      // Update statistics
      this.stats.errors++;
      
      // Log the error
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 WS-ERROR ${fancyColors.RESET} WebSocket error: ${error.message}`, {
        wsEvent: 'websocket_error',
        error: error.message,
        stack: error.stack,
        ip: clientInfo?.ip,
        userId: clientInfo?.userId,
        walletAddress: clientInfo?.walletAddress,
        _highlight: true
      });
      
      // Call the onError handler in subclasses
      await this.onError(ws, error);
      
    } catch (handlerError) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 ERROR-HANDLER-ERROR ${fancyColors.RESET} Error in error handler: ${handlerError.message}`, {
        wsEvent: 'error_handler_error',
        error: handlerError.message,
        stack: handlerError.stack,
        originalError: error.message,
        _highlight: true
      });
    }
  }

  /**
   * Handle incoming message from client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Buffer|string} data - The raw message data
   * @private
   */
  async handleMessage(ws, data) {
    try {
      const clientInfo = this.clientInfoMap.get(ws);
      
      // Update timestamp of last activity
      ws.lastMessageTime = Date.now();
      
      // Update statistics
      this.stats.messagesReceived++;
      this.recordMessage('received');
      
      // Check rate limit
      if (!this.checkRateLimit(ws)) {
        this.sendToClient(ws, {
          type: 'ERROR',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded',
          timestamp: new Date().toISOString()
        });
        
        // Update rate limit stats
        this.stats.rateLimitExceeded++;
        
        return;
      }
      
      // Parse JSON message
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (parseError) {
        this.sendToClient(ws, {
          type: 'ERROR',
          code: 'INVALID_JSON',
          message: 'Invalid JSON format',
          timestamp: new Date().toISOString()
        });
        
        return;
      }
      
      // Special handling for ping messages
      if (message.type === 'ping') {
        this.sendToClient(ws, {
          type: 'pong',
          timestamp: message.timestamp || new Date().toISOString(),
          serverTime: new Date().toISOString()
        });
        
        return;
      }
      
      // Log message (debug level to avoid spam)
      logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLUE} V69 MESSAGE ${fancyColors.RESET} Received message from client:`, {
        wsEvent: 'message_received',
        messageType: message.type,
        userId: clientInfo?.userId,
        ip: clientInfo?.ip
      });
      
      // Call the onMessage handler in subclasses
      await this.onMessage(ws, message);
      
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 MESSAGE-ERROR ${fancyColors.RESET} Error handling message: ${error.message}`, {
        wsEvent: 'message_handling_error',
        error: error.message,
        stack: error.stack,
        _highlight: true
      });
      
      // Send error to client
      this.sendToClient(ws, {
        type: 'ERROR',
        code: 'SERVER_ERROR',
        message: 'Error processing message',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Check if a client has exceeded their rate limit
   * @param {WebSocket} ws - The client to check
   * @returns {boolean} - Whether the client is within their rate limit
   * @private
   */
  checkRateLimit(ws) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return false;
    
    const clientId = clientInfo.userId || clientInfo.ip;
    const now = Date.now();
    
    // Initialize or get rate limit info
    let limitInfo = this.messageRateLimits.get(clientId) || {
      count: 0,
      resetTime: now + 60000  // Reset after 1 minute
    };
    
    // Check if we need to reset the counter
    if (now > limitInfo.resetTime) {
      limitInfo = {
        count: 1,
        resetTime: now + 60000
      };
    } else {
      // Increment message count
      limitInfo.count++;
    }
    
    // Update the rate limit info
    this.messageRateLimits.set(clientId, limitInfo);
    
    // Check if limit exceeded
    return limitInfo.count <= this.rateLimit;
  }

  /**
   * Set up heartbeat for a client
   * @param {WebSocket} ws - The WebSocket connection
   * @private
   */
  setupHeartbeat(ws) {
    // Clear any existing heartbeat timeout
    if (ws._heartbeatTimeout) {
      clearTimeout(ws._heartbeatTimeout);
    }
    
    // Set up new heartbeat timeout
    ws._heartbeatTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        // Send ping to client
        try {
          ws.ping();
          
          // Set up timeout for pong response
          ws._heartbeatTimeout = setTimeout(() => {
            // No pong received, terminate connection
            logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.YELLOW} V69 HEARTBEAT-TIMEOUT ${fancyColors.RESET} Client failed to respond to ping, terminating connection`, {
              wsEvent: 'heartbeat_timeout',
              ip: this.clientInfoMap.get(ws)?.ip,
              userId: this.clientInfoMap.get(ws)?.userId
            });
            
            this.closeConnection(ws, 1008, 'Heartbeat timeout');
          }, this.heartbeatTimeout);
        } catch (pingError) {
          logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 PING-ERROR ${fancyColors.RESET} Failed to send ping: ${pingError.message}`, {
            wsEvent: 'ping_error',
            error: pingError.message
          });
          
          this.closeConnection(ws, 1011, 'Failed to send ping');
        }
      }
    }, this.heartbeatInterval);
  }

  /**
   * Safely close a WebSocket connection with code and reason
   * @param {WebSocket} ws - The WebSocket connection
   * @param {number} code - The close code
   * @param {string} reason - The close reason
   */
  closeConnection(ws, code, reason) {
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(code, reason);
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 CLOSE-ERROR ${fancyColors.RESET} Error closing connection: ${error.message}`, {
        wsEvent: 'close_error',
        error: error.message,
        code,
        reason
      });
      
      // Force terminate if close fails
      try {
        ws.terminate();
      } catch (termError) {
        // Last resort - just log the error
        logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} V69 TERMINATE-ERROR ${fancyColors.RESET} Error terminating connection: ${termError.message}`);
      }
    }
  }

  /**
   * Send a message to a specific client with RSV1 handling
   * @param {WebSocket} client - The client to send to
   * @param {object} message - The message to send
   * @returns {boolean} - Whether the message was sent successfully
   */
  sendToClient(client, message) {
    try {
      if (!client || client.readyState !== WebSocket.OPEN) {
        return false;
      }

      // Convert message to JSON string
      const jsonStr = JSON.stringify(message);
      
      // Global WebSocket frame utilities have been removed 
      
      // Buffer fix utilities have been removed
      
      // Fallback to standard send method
      client.send(jsonStr);
      
      // Update statistics
      this.stats.messagesSent++;
      this.recordMessage('sent');
      
      return true;
    } catch (error) {
      this.stats.errors++;
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} SEND ERROR ${fancyColors.RESET} Failed to send message: ${error.message}`, {
        wsEvent: 'send_error',
        error: error.message,
        _highlight: true
      });
      return false;
    }
  }

  /**
   * Broadcast a message to all clients subscribed to a channel
   * @param {string} channel - The channel to broadcast to
   * @param {object} message - The message to broadcast
   * @returns {number} - Number of clients the message was sent to
   */
  broadcastToChannel(channel, message) {
    if (!this.channelSubscriptions || !this.channelSubscriptions.has(channel)) {
      return 0;
    }

    const subscribers = this.channelSubscriptions.get(channel);
    let sentCount = 0;

    for (const client of subscribers) {
      try {
        if (client.readyState === WebSocket.OPEN) {
          // Use our enhanced sendToClient method for RSV1 safety
          if (this.sendToClient(client, message)) {
            sentCount++;
          }
        }
      } catch (error) {
        logApi.error(`Error broadcasting to client in channel ${channel}: ${error.message}`, {
          wsEvent: 'broadcast_error',
          channel,
          error: error.message,
          _highlight: true
        });
        this.stats.errors++;
      }
    }

    return sentCount;
  }
  
  /**
   * Broadcast a message to all clients or a subset of clients
   * @param {object} message - The message to broadcast
   * @param {Array<WebSocket>} [excludeClients=[]] - Clients to exclude from broadcast
   * @returns {number} - Number of clients the message was sent to
   */
  broadcast(message, excludeClients = []) {
    const excludeSet = new Set(excludeClients);
    let sentCount = 0;
    
    for (const client of this.clients) {
      // Skip excluded clients
      if (excludeSet.has(client)) {
        continue;
      }
      
      try {
        if (client.readyState === WebSocket.OPEN) {
          // Use our enhanced sendToClient method for RSV1 safety
          if (this.sendToClient(client, message)) {
            sentCount++;
          }
        }
      } catch (error) {
        logApi.error(`Error broadcasting to client: ${error.message}`, {
          wsEvent: 'broadcast_error',
          error: error.message,
          _highlight: true
        });
        this.stats.errors++;
      }
    }
    
    return sentCount;
  }
}

// Export a factory function for creating instances
export function createBaseWebSocketServer(server, options = {}) {
  logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CREATE ${fancyColors.RESET} ${fancyColors.CYAN}Creating WebSocket server at ${fancyColors.UNDERLINE}${server.path}${fancyColors.RESET}`);
  return new BaseWebSocketServer(server, options);
}

/**
 * Diagnostic function to check raw TCP/WebSocket handshake
 * This helps identify if NGINX is adding compression
 * 
 * Can be triggered via the command line:
 * node -e "require('./websocket/v69/base-websocket.js').diagnoseWebSocketHandshake('wss://degenduel.me/api/v69/ws/test')"
 */
export async function diagnoseWebSocketHandshake(url, options = {}) {
  const net = require('net');
  const tls = require('tls');
  const { URL } = require('url');
  
  // Parse the URL
  const urlObj = new URL(url);
  const isSecure = urlObj.protocol === 'wss:';
  const host = urlObj.hostname;
  const port = urlObj.port || (isSecure ? 443 : 80);
  const path = urlObj.pathname + urlObj.search;
  
  console.log(`\n${fancyColors.BG_BLUE}${fancyColors.WHITE} TCP HANDSHAKE DIAGNOSTICS ${fancyColors.RESET}`);
  console.log(`${fancyColors.CYAN}Connecting to: ${fancyColors.BOLD}${url}${fancyColors.RESET}`);
  console.log(`${fancyColors.CYAN}Host: ${host}, Port: ${port}, Path: ${path}${fancyColors.RESET}\n`);
  
  return new Promise((resolve, reject) => {
    try {
      // Generate a random WebSocket key
      const wsKey = Buffer.from(Math.random().toString(36).substring(2, 12)).toString('base64');
      
      // Create the upgrade request
      const request = [
        `GET ${path} HTTP/1.1`,
        `Host: ${host}${port ? `:${port}` : ''}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        // Add this line to explicitly request no extensions
        options.testWithCompression ? 'Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits' : '',
        '',
        ''
      ].filter(Boolean).join('\r\n');
      
      console.log(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} SENDING REQUEST ${fancyColors.RESET}`);
      console.log(`${fancyColors.GRAY}${request.replace(/\r\n/g, '\n')}${fancyColors.RESET}`);
      
      // Connect using appropriate protocol
      const socket = isSecure ? 
        tls.connect(port, host, { rejectUnauthorized: false }) : 
        net.connect(port, host);
      
      let responseData = '';
      
      // Set timeout
      socket.setTimeout(5000, () => {
        socket.end();
        console.log(`${fancyColors.BG_RED}${fancyColors.WHITE} TIMEOUT ${fancyColors.RESET} Connection timed out after 5 seconds`);
        resolve({ success: false, error: 'Timeout' });
      });
      
      socket.on('connect', () => {
        console.log(`${fancyColors.BG_GREEN}${fancyColors.BLACK} CONNECTED ${fancyColors.RESET} TCP connection established to ${host}:${port}`);
        // Send the HTTP upgrade request
        socket.write(request);
      });
      
      socket.on('data', (data) => {
        responseData += data.toString();
        
        // Check if we've received the full headers (ending with \r\n\r\n)
        if (responseData.includes('\r\n\r\n')) {
          console.log(`${fancyColors.BG_GREEN}${fancyColors.BLACK} RESPONSE RECEIVED ${fancyColors.RESET}`);
          
          // Split headers from body
          const [headers, body] = responseData.split('\r\n\r\n', 2);
          const headerLines = headers.split('\r\n');
          
          console.log(`${fancyColors.CYAN}Headers:${fancyColors.RESET}`);
          headerLines.forEach(line => console.log(`${fancyColors.YELLOW}${line}${fancyColors.RESET}`));
          
          // Check for compression headers
          const extensionHeader = headerLines.find(h => h.toLowerCase().startsWith('sec-websocket-extensions:'));
          
          if (extensionHeader) {
            if (extensionHeader.toLowerCase().includes('permessage-deflate')) {
              console.log(`\n${fancyColors.BG_RED}${fancyColors.WHITE} COMPRESSION ENABLED ${fancyColors.RESET} ${fancyColors.RED}Server is negotiating compression: ${extensionHeader}${fancyColors.RESET}`);
              console.log(`${fancyColors.RED}This will cause the 'RSV1 must be clear' error with clients that don't support compression.${fancyColors.RESET}`);
            } else {
              console.log(`\n${fancyColors.BG_YELLOW}${fancyColors.BLACK} EXTENSIONS FOUND ${fancyColors.RESET} Server returned extensions: ${extensionHeader}`);
            }
          } else {
            console.log(`\n${fancyColors.BG_GREEN}${fancyColors.BLACK} NO COMPRESSION ${fancyColors.RESET} Server correctly disabled WebSocket extensions`);
          }
          
          // Check if upgrade was successful
          const statusLine = headerLines[0];
          const upgradeHeader = headerLines.find(h => h.toLowerCase().startsWith('upgrade:'));
          
          if (statusLine.includes('101') && upgradeHeader && upgradeHeader.toLowerCase().includes('websocket')) {
            console.log(`\n${fancyColors.BG_GREEN}${fancyColors.BLACK} HANDSHAKE SUCCESSFUL ${fancyColors.RESET} WebSocket connection established`);
            
            // Don't close immediately to see if frames arrive
            setTimeout(() => {
              socket.end();
              resolve({ 
                success: true, 
                headers: headerLines,
                compression: !!extensionHeader && extensionHeader.toLowerCase().includes('permessage-deflate')
              });
            }, 1000);
          } else {
            console.log(`\n${fancyColors.BG_RED}${fancyColors.WHITE} HANDSHAKE FAILED ${fancyColors.RESET} Server did not upgrade the connection`);
            socket.end();
            resolve({ 
              success: false, 
              headers: headerLines,
              status: statusLine
            });
          }
        }
      });
      
      socket.on('error', (err) => {
        console.log(`${fancyColors.BG_RED}${fancyColors.WHITE} CONNECTION ERROR ${fancyColors.RESET} ${err.message}`);
        reject(err);
      });
      
      socket.on('end', () => {
        console.log(`${fancyColors.BG_BLUE}${fancyColors.WHITE} CONNECTION CLOSED ${fancyColors.RESET}`);
      });
    } catch (err) {
      console.error(`${fancyColors.BG_RED}${fancyColors.WHITE} DIAGNOSTIC ERROR ${fancyColors.RESET} ${err.message}`);
      reject(err);
    }
  });
}

// Export the factory function