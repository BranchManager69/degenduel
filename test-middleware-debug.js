// test-middleware-debug.js - Debug middleware handling of WebSocket upgrade requests

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { logApi } from './utils/logger-suite/logger.js';
import { fancyColors } from './utils/colors.js';

// Create a simple Express app
const app = express();

// Add a middleware to log every request
app.use((req, res, next) => {
  // Log the request with all headers
  console.log(`${fancyColors.BG_BLUE}${fancyColors.WHITE} REQUEST ${fancyColors.RESET} ${req.method} ${req.url}`);
  console.log(`Headers:`, req.headers);
  next();
});

// Simple route to check if server is running
app.get('/', (req, res) => {
  res.send('Middleware debug server running');
});

// Create HTTP server
const server = http.createServer(app);

// Create a simple WebSocket server
const wss = new WebSocketServer({ 
  server,
  path: '/test-ws',
  perMessageDeflate: false // Disable compression
});

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WEBSOCKET ${fancyColors.RESET} Client connected`);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Welcome to the middleware debug WebSocket server',
    time: new Date().toISOString()
  }));
  
  // Handle messages
  ws.on('message', (message) => {
    console.log(`${fancyColors.BG_BLUE}${fancyColors.WHITE} WEBSOCKET ${fancyColors.RESET} Received: ${message}`);
    
    // Echo message back
    ws.send(JSON.stringify({
      type: 'echo',
      message: message.toString(),
      time: new Date().toISOString()
    }));
  });
  
  // Handle close
  ws.on('close', () => {
    console.log(`${fancyColors.BG_RED}${fancyColors.WHITE} WEBSOCKET ${fancyColors.RESET} Client disconnected`);
  });
});

// Log HTTP upgrade events directly
server.on('upgrade', (request, socket, head) => {
  console.log(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} UPGRADE ${fancyColors.RESET} Upgrade request for: ${request.url}`);
  console.log(`Headers:`, request.headers);
  
  // Don't handle the upgrade here - let the WebSocket server do it
});

// Start server
const PORT = 3099;
server.listen(PORT, () => {
  console.log(`${fancyColors.BG_GREEN}${fancyColors.BLACK} SERVER ${fancyColors.RESET} Middleware debug server running on port ${PORT}`);
  console.log(`Test WebSocket at: ws://localhost:${PORT}/test-ws`);
});