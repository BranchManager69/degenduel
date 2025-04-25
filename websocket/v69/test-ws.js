// websocket/v69/test-ws.js

/**
 * Enhanced WebSocket Test Endpoint (v69)
 * 
 * Simple WebSocket test endpoint with enhanced header logging
 * for diagnosing WebSocket connection issues.
 */

import { WebSocket } from 'ws';
import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';

const TEST_WEBSOCKET_OPTIONS = {
  path: '/api/v69/ws/test',
  requireAuth: false,  // No auth required for testing
  publicEndpoints: ['/api/v69/ws/test'],
  rateLimiter: {
    maxConnections: 100,
    maxMessagesPerMinute: 1000
  },
  heartbeatInterval: 5000
};

class TestWebSocketServer extends BaseWebSocketServer {
  constructor(server) {
    super(server, TEST_WEBSOCKET_OPTIONS);
    
    // Set up logging with bright colors to stand out
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TEST WS CREATED ${fancyColors.RESET} Test WebSocket server created at ${this.path}`);
  }
  
  async onInitialize() {
    // Log initialization with bright colors
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TEST WS INIT ${fancyColors.RESET} Test WebSocket server initializing...`);
    
    // Start connection counter
    this.testStats = {
      pingPongCount: 0,
      echoCount: 0,
      connections: 0,
      lastHandshake: null,
      lastHeaders: null
    };
    
    return true;
  }
  
  async onConnection(ws, req) {
    // Ultra-verbose connection logging
    this.testStats.connections++;
    this.testStats.lastHandshake = new Date().toISOString();
    
    // Log all headers in a clear, highlighted format
    const allHeaders = req.headers || {};
    const headerList = Object.entries(allHeaders).map(([key, value]) => `${key}: ${value}`);
    
    // Store for stats
    this.testStats.lastHeaders = headerList;
    
    // Log the headers in a highly visible format
    logApi.info(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} TEST WS CONNECTION ${fancyColors.RESET} ${fancyColors.BOLD}CLIENT CONNECTED WITH HEADERS:${fancyColors.RESET}`, {
      url: req.url,
      method: req.method,
      complete_headers: req.headers,
      ip: req.ip || req.socket.remoteAddress,
      connection: {
        id: this.testStats.connections,
        time: this.testStats.lastHandshake
      },
      _highlight: true,
      _html_message: `
        <div style="background-color:#f8f9fa;padding:10px;border-radius:4px;border:1px solid #dee2e6;">
          <h3 style="margin-top:0;color:#212529;">WebSocket Connection Headers</h3>
          <div style="color:#495057;font-family:monospace;white-space:pre;background:#f1f3f5;padding:10px;border-radius:4px;max-height:400px;overflow:auto;">
            ${headerList.join('\n')}
          </div>
        </div>
      `
    });
    
    // Send welcome message with header info
    this.sendToClient(ws, {
      type: 'CONNECTED',
      message: 'Connected to test WebSocket server',
      timestamp: new Date().toISOString(),
      yourHeaders: req.headers,
      connection: {
        id: this.testStats.connections,
        time: this.testStats.lastHandshake,
        serverTime: new Date().toISOString()
      }
    });
    
    // Store custom data on the connection
    ws.connectionData = {
      connectedAt: new Date(),
      ip: req.ip || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      pingCount: 0,
      messageCount: 0
    };
  }
  
  async onMessage(ws, message) {
    // Update connection stats
    ws.connectionData.messageCount++;
    
    // Log the incoming message prominently
    logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} TEST WS MESSAGE ${fancyColors.RESET} Got message: ${typeof message === 'string' ? message : JSON.stringify(message)}`, {
      message: message,
      timestamp: new Date().toISOString(),
      connectionData: ws.connectionData,
      _highlight: true
    });
    
    if (message.type === 'ping') {
      // Handle ping test
      this.testStats.pingPongCount++;
      ws.connectionData.pingCount++;
      
      this.sendToClient(ws, {
        type: 'pong',
        received: message,
        timestamp: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        stats: {
          yourPingCount: ws.connectionData.pingCount,
          totalPings: this.testStats.pingPongCount,
          connectionTime: Math.floor((Date.now() - ws.connectionData.connectedAt) / 1000) + ' seconds'
        }
      });
    } else if (message.type === 'echo') {
      // Handle echo test
      this.testStats.echoCount++;
      
      // Echo back the entire message plus a timestamp
      this.sendToClient(ws, {
        type: 'echo_response',
        original: message,
        timestamp: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        echoCount: this.testStats.echoCount
      });
    } else if (message.type === 'test_compression') {
      // Send a large message to test compression
      const largeData = {
        type: 'compression_test_response',
        timestamp: new Date().toISOString(),
        testArray: Array(1000).fill().map((_, i) => ({
          index: i,
          value: `Test value ${i}`,
          timestamp: new Date().toISOString()
        }))
      };
      
      this.sendToClient(ws, largeData);
    } else {
      // Handle any other message type with a generic response
      this.sendToClient(ws, {
        type: 'test_response',
        received: message,
        timestamp: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        message: 'Unknown command, supported types: ping, echo, test_compression'
      });
    }
  }
  
  async onClose(ws, code, reason) {
    // Get connection duration
    const duration = ws.connectionData?.connectedAt 
      ? Math.floor((Date.now() - ws.connectionData.connectedAt) / 1000)
      : 'unknown';
    
    // Log the disconnection with bright colors
    logApi.info(`${fancyColors.BG_RED}${fancyColors.WHITE} TEST WS DISCONNECT ${fancyColors.RESET} Client disconnected, code: ${code}, reason: ${reason || 'none'}`, {
      code: code,
      reason: reason,
      connectionData: ws.connectionData,
      duration: duration + ' seconds',
      timestamp: new Date().toISOString(),
      _highlight: true
    });
  }
  
  async onError(ws, error) {
    // Log the error with bright colors
    logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} TEST WS ERROR ${fancyColors.RESET} ${error.message}`, {
      error: error.message,
      stack: error.stack,
      connectionData: ws?.connectionData,
      timestamp: new Date().toISOString(),
      _highlight: true
    });
  }
  
  // Override getMetrics to include test-specific stats
  getMetrics() {
    const baseMetrics = super.getMetrics();
    
    return {
      ...baseMetrics,
      testStats: {
        pingPongCount: this.testStats.pingPongCount,
        echoCount: this.testStats.echoCount,
        totalConnections: this.testStats.connections,
        lastConnection: this.testStats.lastHandshake,
        lastHeaders: this.testStats.lastHeaders
      }
    };
  }
}

// Factory function for creating an instance of the TestWebSocketServer
export function createTestWebSocket(server) {
  logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TEST WS FACTORY ${fancyColors.RESET} Creating Test WebSocket server`);
  return new TestWebSocketServer(server);
}

export default {
  createTestWebSocket
};