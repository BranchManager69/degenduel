/**
 * Simple WebSocket Server for Postman Testing
 * 
 * This is a standalone WebSocket server that runs on port 3333
 * with absolutely no authentication, compression, or other complexities.
 * It's designed specifically to help test WebSocket connections with Postman.
 * 
 * Usage:
 * 1. Run with: node postman-ws-test.js
 * 2. Connect from Postman to: ws://localhost:3333
 */

// Import the WebSocket server
const WebSocket = require('ws');
const http = require('http');

// Create HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket test server is running.\n');
});

// Create WebSocket server with NO compression
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: false, // Explicitly disable compression
  maxPayload: 1024 * 1024, // 1MB max payload
});

// Counters for statistics
let connections = 0;
let messages = 0;

// Handle WebSocket connection
wss.on('connection', (ws, req) => {
  const id = ++connections;
  const ip = req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  console.log(`[${id}] New connection from ${ip} - ${userAgent}`);
  
  // Log all headers for debugging
  console.log('=== HEADERS ===');
  Object.keys(req.headers).forEach(key => {
    console.log(`${key}: ${req.headers[key]}`);
  });
  console.log('==============');
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Welcome to the test WebSocket server!',
    id: id,
    time: new Date().toISOString()
  }));
  
  // Handle incoming messages
  ws.on('message', (message) => {
    messages++;
    console.log(`[${id}] Received: ${message}`);
    
    // Echo the message back
    try {
      ws.send(JSON.stringify({
        type: 'echo',
        original: message.toString(),
        id: id,
        messageCount: messages,
        time: new Date().toISOString()
      }));
    } catch (error) {
      console.error(`Error sending response: ${error.message}`);
    }
  });
  
  // Handle WebSocket close
  ws.on('close', (code, reason) => {
    console.log(`[${id}] Connection closed (${code})${reason ? ': ' + reason : ''}`);
  });
  
  // Handle WebSocket errors
  ws.on('error', (error) => {
    console.error(`[${id}] WebSocket error: ${error.message}`);
  });
  
  // Send periodic ping (every 15 seconds)
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      console.log(`[${id}] Sending ping`);
      ws.send(JSON.stringify({
        type: 'ping',
        time: new Date().toISOString()
      }));
    } else {
      clearInterval(pingInterval);
    }
  }, 15000);
});

// Start the server
const PORT = 3008;
server.listen(PORT, () => {
  console.log(`
====================================================
  POSTMAN WEBSOCKET TEST SERVER
====================================================
  Server started on port ${PORT}
  Connect with Postman using: ws://localhost:${PORT}
  
  This server:
  - Has NO authentication
  - Has NO compression (perMessageDeflate: false)
  - Echoes back all messages received
  - Sends a ping every 15 seconds
  - Logs all headers and messages
====================================================
`);
});

// Handle server errors
server.on('error', (error) => {
  console.error(`Server error: ${error.message}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  
  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    client.close(1000, 'Server shutting down');
  });
  
  // Close the HTTP server
  server.close(() => {
    console.log('Server closed. Goodbye!');
    process.exit(0);
  });
});