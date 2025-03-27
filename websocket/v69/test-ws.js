/**
 * Test WebSocket Server (v69)
 * 
 * This is a simplified WebSocket server that fully embraces compression
 * without any hacks or workarounds.
 */

import WebSocket from 'ws';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import { BaseWebSocketServer } from './base-websocket.js';
import { v4 as uuidv4 } from 'uuid';

// Config for Test WebSocket
const WSS_PATH = `/api/v69/ws/test`; 
const WSS_REQUIRE_AUTH = false; // Public WebSocket that doesn't require authentication
const WSS_PUBLIC_ENDPOINTS = ['test', 'echo', 'ping']; // Public endpoints anyone can access
const WSS_MAX_PAYLOAD = 5 * 1024 * 1024; // 5MB
const WSS_RATE_LIMIT = 300; // 300 messages per minute rate limit

// Create a WebSocket server instance that fully embraces compression
let testWsServer = null;

// TestWebSocket class that extends BaseWebSocketServer
class TestWebSocket extends BaseWebSocketServer {
  /**
   * Create a new TestWebSocket
   * @param {http.Server} server - The HTTP server to attach the WebSocket to
   */
  constructor(server) {
    // Configure the base WebSocket options - matching the monitor WebSocket for consistency
    const baseOptions = {
      path: WSS_PATH,
      requireAuth: WSS_REQUIRE_AUTH, // IMPORTANT: No authentication required
      publicEndpoints: WSS_PUBLIC_ENDPOINTS,
      maxPayload: WSS_MAX_PAYLOAD,
      rateLimit: WSS_RATE_LIMIT,
      heartbeatInterval: 30000, // 30s heartbeat
      perMessageDeflate: false, // Disable compression - especially important for Postman
      useCompression: false, // Alias for clarity
      authMode: 'query', // Use query auth mode for most reliable browser connections
      
      // Direct WebSocket server options
      _ws_direct_options: {
        perMessageDeflate: false,
        
        // Special hook to reject any extension headers
        handleProtocols: (protocols, request) => {
          // Prevent compression by removing any extension headers from the request
          if (request.headers['sec-websocket-extensions']) {
            logApi.warn(`${fancyColors.BG_RED}${fancyColors.WHITE} EXTENSION OVERRIDE ${fancyColors.RESET} Removing WebSocket extensions: ${request.headers['sec-websocket-extensions']}`);
            delete request.headers['sec-websocket-extensions'];
          }
          
          // Return the first protocol if any, or null
          return protocols.length > 0 ? protocols[0] : null;
        }
      }
    };
    
    // Call parent constructor with our options
    super(server, baseOptions);
    
    // Increase event listener limit to prevent memory leak warnings
    if (this.wss) {
      this.wss.setMaxListeners(20);
    }
    
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TEST WS ${fancyColors.RESET} TestWebSocket instance created with BaseWebSocketServer`);
  }
  
  /**
   * Handle connection event
   * This gets called after the BaseWebSocketServer's handleConnection
   * @param {WebSocket} ws - WebSocket connection
   * @param {http.IncomingMessage} req - HTTP request
   */
  async onConnection(ws, req) {
    // Get client info from the base server
    const clientInfo = this.clientInfoMap.get(ws);
    
    // Enhanced logging for connection debugging
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TEST WS ${fancyColors.RESET} Test WebSocket connection established: ${clientInfo?.connectionId || 'unknown'}`);
    
    // Log connection details for debugging
    const connectionDetails = {
      ip: req.socket.remoteAddress,
      headers: req.headers,
      url: req.url,
      connectionId: clientInfo?.connectionId,
      authenticated: clientInfo?.authenticated || false,
      user: clientInfo?.authenticated ? `${clientInfo?.user?.wallet_address?.substring(0, 8)}... (${clientInfo?.user?.role})` : 'None',
      _highlight: true
    };
    
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TEST WS DETAILS ${fancyColors.RESET} Connection details:`, connectionDetails);
    
    // Log all current connections
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TEST WS STATS ${fancyColors.RESET} Total connections: ${this.clientInfoMap.size}`);
    
    // Send welcome message with comprehensive details
    this.sendToClient(ws, {
      type: 'welcome',
      message: 'Welcome to the Test WebSocket Server',
      time: new Date().toISOString(),
      supports_compression: false, // Updated to match our configuration
      compression_disabled: true,  // Explicitly indicate compression is disabled
      authenticated: clientInfo?.authenticated || false,
      connection_id: clientInfo?.connectionId || 'unknown',
      user: clientInfo?.authenticated ? {
        wallet: clientInfo?.user?.wallet_address?.substring(0, 8) + '...',
        role: clientInfo?.user?.role
      } : null,
      server_info: {
        version: '1.0.0',
        time: new Date().toISOString(),
        connections: this.clientInfoMap.size,
        uptime: process.uptime(),
        ws_config: {
          perMessageDeflate: false,
          extensions_blocked: true
        }
      }
    });
    
    // Subscribe to test channel
    try {
      await this.subscribeToChannel(ws, 'test');
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TEST WS ${fancyColors.RESET} Client subscribed to 'test' channel`);
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} TEST WS ERROR ${fancyColors.RESET} Failed to subscribe to channel: ${error.message}`);
    }
  }
  
  /**
   * Handle message from client 
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message from client
   * @param {Object} clientInfo - Client information
   */
  async onMessage(ws, message, clientInfo) {
    try {
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TEST WS ${fancyColors.RESET} Received message: ${typeof message === 'object' ? JSON.stringify(message) : message}`);
      
      // Handle different message types
      switch (message.type) {
        case 'echo':
          // Echo the message back
          this.sendToClient(ws, {
            type: 'echo',
            original: message,
            time: new Date().toISOString()
          });
          break;
          
        case 'ping':
          // Respond with pong
          this.sendToClient(ws, {
            type: 'pong',
            time: new Date().toISOString()
          });
          break;
          
        case 'test_compression':
          // Send a large message to test (we explicitly note compression is disabled)
          const largeData = new Array(1000).fill('This is a test message for compression (though compression is disabled).').join(' ');
          this.sendToClient(ws, {
            type: 'compression_test',
            data: largeData,
            compression_disabled: true,
            message: 'Compression is disabled on this server - this is a large uncompressed message',
            data_size: largeData.length,
            time: new Date().toISOString()
          });
          break;
          
        default:
          // Echo any other message
          this.sendToClient(ws, {
            type: 'echo',
            original: message,
            time: new Date().toISOString()
          });
          break;
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} TEST WS ERROR ${fancyColors.RESET} Failed to handle message: ${error.message}`, error);
      
      // Send error response
      this.sendError(ws, 'ERROR', error.message);
    }
  }
}

/**
 * Create a very minimal test WebSocket server for diagnostics
 * @param {http.Server} server - The HTTP server to attach the WebSocket to
 * @returns {Object} - The test WebSocket server object
 */
export async function createTestWebSocket(server) {
  try {
    // We already imported WebSocket at the top of the file
    // No need to import it again, it's already available
    
    // Create a super simple WebSocket server for diagnostics
    // This uses the raw WebSocket library directly without our base class
    // to eliminate potential bugs in our implementation
    const wssPath = '/api/v69/ws/test';
    
    // Log that we're creating the test WebSocket
    logApi.info(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS ${fancyColors.RESET} Creating bare-bones test WebSocket server at ${wssPath}`, {
      path: wssPath,
      event_type: 'test_ws_create'
    });
    
    // Create with EXPLICITLY DISABLED compression
    const wss = new WebSocket.Server({
      server,
      path: wssPath,
      perMessageDeflate: false, // CRITICAL: Disable compression
      
      // Detailed logging for connection attempts
      verifyClient: (info, callback) => {
        const requestId = uuidv4().substring(0, 8);
        logApi.info(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-VERIFY-${requestId} ${fancyColors.RESET} Connection verification`, {
          wsEvent: 'test_verify_client',
          url: info.req.url,
          method: info.req.method,
          headers: {
            host: info.req.headers.host,
            origin: info.req.headers.origin,
            upgrade: info.req.headers.upgrade,
            connection: info.req.headers.connection,
            sec_websocket_key: info.req.headers['sec-websocket-key'] || 'missing',
            sec_websocket_version: info.req.headers['sec-websocket-version'] || 'missing',
            sec_websocket_extensions: info.req.headers['sec-websocket-extensions'] || 'none'
          },
          _highlight: true
        });
        
        // Special handling for extensions - explicitly remove them
        if (info.req.headers['sec-websocket-extensions']) {
          const extensions = info.req.headers['sec-websocket-extensions'];
          logApi.warn(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-EXTENSIONS-${requestId} ${fancyColors.RESET} Extensions found: ${extensions}`, {
            extensions,
            _highlight: true
          });
          
          // Delete extensions to prevent compression negotiation
          delete info.req.headers['sec-websocket-extensions'];
        }
        
        // Always accept connection at this stage
        callback(true);
      },
      
      // CRITICAL: Prevent extensions
      handleProtocols: (protocols, request) => {
        const requestId = uuidv4().substring(0, 8);
        logApi.info(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-PROTOCOLS-${requestId} ${fancyColors.RESET} Protocol negotiation`, {
          protocols,
          _highlight: true
        });
        
        // Delete any extension headers to prevent compression negotiation
        if (request.headers['sec-websocket-extensions']) {
          const extensions = request.headers['sec-websocket-extensions'];
          logApi.warn(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-EXTENSIONS-${requestId} ${fancyColors.RESET} Removing extensions: ${extensions}`, {
            extensions,
            _highlight: true
          });
          delete request.headers['sec-websocket-extensions'];
        }
        
        // Return first protocol or null
        return protocols.length > 0 ? protocols[0] : null;
      }
    });
    
    // Special check to verify server configuration
    if (wss && wss.options) {
      logApi.info(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-CONFIG ${fancyColors.RESET} WebSocket server options:`, {
        options: wss.options,
        perMessageDeflate: !!wss.options.perMessageDeflate,
        _highlight: true
      });
    }
    
    // Handle connections with detailed logging
    wss.on('connection', (ws, req) => {
      const connectionId = uuidv4().substring(0, 8);
      
      // Get the real client IP using X-Forwarded-For when behind a proxy
      const clientIP = req.headers['x-forwarded-for'] 
        ? req.headers['x-forwarded-for'].split(',')[0].trim() 
        : req.socket.remoteAddress;
      
      // Log new connection with full details
      logApi.info(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-CONNECTION-${connectionId} ${fancyColors.RESET} Client connected`, {
        wsEvent: 'test_connection',
        url: req.url,
        method: req.method,
        ip: clientIP,
        direct_ip: req.socket.remoteAddress,
        headers: {
          host: req.headers.host,
          origin: req.headers.origin,
          upgrade: req.headers.upgrade,
          connection: req.headers.connection,
          user_agent: req.headers['user-agent'] || 'Unknown',
          forwarded_for: req.headers['x-forwarded-for'] || 'N/A'
        },
        socket: {
          readyState: ws.readyState,
          protocol: ws.protocol,
          bufferedAmount: ws.bufferedAmount
        },
        _highlight: true
      });
      
      // Immediately send a test message to the client
      try {
        ws.send(JSON.stringify({
          type: 'test_welcome',
          message: 'Test WebSocket connection successful',
          connectionId: connectionId,
          timestamp: new Date().toISOString()
        }));
        
        logApi.info(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-MESSAGE-${connectionId} ${fancyColors.RESET} Sent welcome message`);
      } catch (error) {
        logApi.error(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-ERROR-${connectionId} ${fancyColors.RESET} Error sending welcome message: ${error.message}`, error);
      }
      
      // Set up message handler
      ws.on('message', (data) => {
        try {
          // Parse message data
          let message;
          try {
            message = JSON.parse(data);
          } catch (e) {
            message = { type: 'raw', data: data.toString() };
          }
          
          // Log received message
          logApi.info(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-RECEIVED-${connectionId} ${fancyColors.RESET} Received message:`, {
            message,
            _highlight: true
          });
          
          // Echo the message back
          ws.send(JSON.stringify({
            type: 'echo',
            originalMessage: message,
            timestamp: new Date().toISOString()
          }));
        } catch (error) {
          logApi.error(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-ERROR-${connectionId} ${fancyColors.RESET} Message handling error: ${error.message}`, error);
        }
      });
      
      // Handle close events
      ws.on('close', (code, reason) => {
        logApi.info(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-CLOSE-${connectionId} ${fancyColors.RESET} Connection closed: ${code} ${reason}`, {
          wsEvent: 'test_close',
          code,
          reason: reason.toString(),
          _highlight: true
        });
      });
      
      // Handle errors
      ws.on('error', (error) => {
        logApi.error(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-ERROR-${connectionId} ${fancyColors.RESET} Socket error: ${error.message}`, {
          wsEvent: 'test_error',
          error: error.message,
          stack: error.stack,
          _highlight: true
        });
      });
      
      // Handle pong messages
      ws.on('pong', () => {
        logApi.info(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-PONG-${connectionId} ${fancyColors.RESET} Received pong`);
      });
      
      // Set up heartbeat using ping/pong
      const heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
          logApi.debug(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-PING-${connectionId} ${fancyColors.RESET} Sent ping`);
        } else {
          clearInterval(heartbeatInterval);
        }
      }, 30000);
    });
    
    // Handle server errors
    wss.on('error', (error) => {
      logApi.error(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-SERVER-ERROR ${fancyColors.RESET} Server error: ${error.message}`, {
        wsEvent: 'test_server_error',
        error: error.message,
        stack: error.stack,
        _highlight: true
      });
    });
    
    // Create a test WebSocket server object that's compatible with our interface
    const testWsServer = {
      path: wssPath,
      wss: wss,
      clients: wss.clients,
      
      // Add standard initialize method
      initialize: async function() {
        logApi.info(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-INIT ${fancyColors.RESET} Test WebSocket server initialized`);
        return true;
      }
    };
    
    // Add cleanup method
    testWsServer.cleanup = async function() {
      if (testWsServer && testWsServer.wss) {
        try {
          // Close all connections
          testWsServer.wss.clients.forEach(client => {
            client.close(1000, "Server shutting down");
          });
          
          // Close the server
          testWsServer.wss.close();
          
          // Clear our references safely
          testWsServer.wss = null;
          testWsServer.clients = null;
          
          logApi.info(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS ${fancyColors.RESET} Test WebSocket Server shut down`);
          return true;
        } catch (error) {
          logApi.error(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-ERROR ${fancyColors.RESET} Failed to clean up: ${error.message}`, error);
          return false;
        }
      }
      return true;
    };
    
    return testWsServer;
  } catch (error) {
    logApi.error(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TEST-WS-CREATE-ERROR ${fancyColors.RESET} Failed to create test WebSocket: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      _highlight: true
    });
    throw error;
  }
}

/**
 * Cleanup function for WebSocket server - calls instance cleanup method
 * @returns {Promise<boolean>} - Whether cleanup was successful
 */
export async function cleanup() {
  if (testWsServer && typeof testWsServer.cleanup === 'function') {
    return await testWsServer.cleanup();
  }
  return true;
}

/**
 * Get metrics for the Test WebSocket server
 * This is needed for proper integration with the monitoring system
 * @returns {Object} - Metrics
 */
export function getMetrics() {
  if (testWsServer && typeof testWsServer.getMetrics === 'function') {
    return testWsServer.getMetrics();
  }
  
  // Default metrics if server instance not available
  return {
    name: "Test WebSocket Server",
    version: "1.0.0",
    status: "offline",
    metrics: {
      connections: 0,
      messageCount: 0,
      errorCount: 0,
      lastUpdate: new Date().toISOString(),
      compressionEnabled: false,
      extensionsBlocked: true,
      server: "BaseWebSocketServer"
    },
    performance: {
      uptime: 0
    }
  };
}

/**
 * Initialize method that's called during server initialization
 * @returns {Promise<boolean>} Whether initialization was successful
 */
export async function initialize() {
  if (testWsServer && typeof testWsServer.initialize === 'function') {
    return await testWsServer.initialize();
  }
  
  logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} TEST WS WARNING ${fancyColors.RESET} WebSocket server not created yet, but initialize was called directly`);
  return false;
}

// For API consistency with other WebSocket servers
export default {
  initialize,
  cleanup,
  getMetrics
};