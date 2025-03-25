// postman-ws-test.js

/**
 * Simple WebSocket test client
 * 
 * This script helps test WebSocket connections to the DegenDuel v69 WebSocket API.
 * You can use this script to verify WebSocket functionality.
 * 
 * Usage:
 * 1. Make sure you have a valid JWT token
 * 2. Run this script with Node.js
 * 3. Check the console output
 */

import WebSocket from 'ws';

// Config
import { config } from './config/config.js';
const CURR_NODE_ENV = config.getEnvironment() === 'development' ? 'dev' : 'prod';
// Extra config
const config = {
  baseUrl: CURR_NODE_ENV === 'dev' ? 'wss://dev.degenduel.me' : 'wss://degenduel.me',
  endpoints: {
    // websocket #1
    monitor: '/api/v69/ws/monitor',
    // websocket #2
    analytics: '/api/v69/ws/analytics',
    // websocket #3
    circuitBreaker: '/api/v69/ws/circuit-breaker',
    // websocket #4
    contests: '/api/v69/ws/contests',
    // websocket #5
    ////
    // websocket #6
    ////
    // websocket #7
    ////
    // websocket #8
    ////tokens:
    // websocket #9
    ////user-notifications:
    // websocket #10
    ////wallets:
  },
  devAccessToken: config.secure_middleware.branch_manager_header_token,
  token: config.jwt.branch_manager_token,
};

// Create WebSocket URL with authentication
function createWsUrl(endpoint) {
  return `${config.baseUrl}${endpoint}?token=${encodeURIComponent(config.token)}&devAccess=${encodeURIComponent(config.devAccessToken)}`;
}

// Simple timestamp formatted
function timestamp() {
  return new Date().toLocaleTimeString();
}

// Connect to WebSocket
function connectWebSocket(endpoint, name) {
  const url = createWsUrl(endpoint);
  console.log(`[${timestamp()}] Connecting to ${name} WebSocket: ${url.substring(0, url.indexOf('?') + 10)}...`);
  
  // Create WebSocket with explicit NoExtensions option to disable all extensions including compression
  const ws = new WebSocket(url, [], {
    perMessageDeflate: false,
    maxPayload: 1024 * 1024
  });

  // Connection opened
  ws.on('open', () => {
    console.log(`[${timestamp()}] Connected to ${name} WebSocket! 🟢`);
    
    // Send a message after connection
    const message = { type: 'heartbeat' };
    ws.send(JSON.stringify(message));
    console.log(`[${timestamp()}] Sent: ${JSON.stringify(message)}`);
  });

  // Listen for messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log(`[${timestamp()}] Received from ${name}:`, message);
      
      // If connection is established, try subscribing
      if (message.type === 'connection_established') {
        if (name === 'Circuit Breaker') {
          // Subscribe to services channel
          const subscribeMsg = { type: 'subscribe_all' };
          ws.send(JSON.stringify(subscribeMsg));
          console.log(`[${timestamp()}] Sent subscription request to ${name}`);
        }
      }
    } catch (e) {
      console.log(`[${timestamp()}] Received non-JSON message from ${name}:`, data.toString());
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`[${timestamp()}] Error on ${name} WebSocket:`, error);
  });

  // Connection closed
  ws.on('close', (code, reason) => {
    console.log(`[${timestamp()}] Disconnected from ${name} WebSocket. Code: ${code}, Reason: ${reason || 'No reason provided'} 🔴`);
  });

  return ws;
}

// Only test one endpoint at a time to avoid interference
console.log('[INFO] Testing WebSocket connections...');
console.log('[INFO] You can test each endpoint separately by modifying the code\n');

// Choose which endpoint to test - uncomment only one
// const monitorWs = connectWebSocket(config.endpoints.monitor, 'Monitor');
// Try with auth disabled
const circuitBreakerWs = connectWebSocket(config.endpoints.circuitBreaker, 'Circuit Breaker');

// Keep the script running
console.log('[INFO] Press Ctrl+C to exit');