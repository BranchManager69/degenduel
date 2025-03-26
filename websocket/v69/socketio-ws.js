// socketio-ws.js - Simple Socket.IO Implementation

import { Server } from 'socket.io';
import { logApi } from '../../utils/logger-suite/logger.js';
import http from 'http';

// Global Socket.IO instance
let io = null;

// Initialize Socket.IO on the given HTTP server
export function initSocketIO(httpServer) {
  if (!httpServer) {
    logApi.error("Socket.IO init failed - no HTTP server provided");
    return false;
  }

  // Log server info for debugging
  logApi.info(`Initializing Socket.IO with HTTP server: ${httpServer ? 'valid' : 'invalid'}`);
  
  // First, add a middleware handler for Socket.IO that will handle both formats 
  // of Socket.IO requests (with and without trailing slash)
  httpServer.on('request', (req, res) => {
    // Check if this is a Socket.IO request
    if (req.url && req.url.startsWith('/socket.io')) {
      logApi.info(`Incoming Socket.IO request: ${req.url}`);
    }
  });
  
  // Create Socket.IO instance with basic configuration
  io = new Server(httpServer, {
    // Use default Socket.IO path
    path: '/socket.io/',
    serveClient: false,
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    connectTimeout: 45000,
    pingTimeout: 30000,
    transports: ['websocket', 'polling'],
    allowEIO3: true, // Enable Engine.IO 3 compatibility
    maxHttpBufferSize: 1e8, // 100MB
    // NGINX proxy settings
    allowUpgrades: true,
    upgradeTimeout: 10000,
    cookie: false
  });
  
  // Log that Socket.IO has been initialized
  logApi.info(`Socket.IO server created with path: /socket.io/`);

  // Handle Socket.IO connections
  io.on('connection', (socket) => {
    logApi.info(`Socket.IO connection: ${socket.id}`);
    
    // Send welcome message
    socket.emit('welcome', {
      message: 'Connected to Socket.IO server',
      id: socket.id,
      time: new Date().toISOString()
    });
    
    // Echo any messages back
    socket.on('message', (data) => {
      logApi.info(`Socket.IO message from ${socket.id}: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
      socket.emit('echo', {
        original: data,
        time: new Date().toISOString()
      });
    });
    
    // Add ping/pong for connection testing
    socket.on('ping', () => {
      logApi.info(`Received ping from ${socket.id}`);
      socket.emit('pong', { 
        time: new Date().toISOString(), 
        serverTime: Date.now() 
      });
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
      logApi.info(`Socket.IO disconnect: ${socket.id}`);
    });
  });

  // Handle connection errors
  io.engine.on('connection_error', (err) => {
    logApi.error(`Socket.IO connection error: ${err.code} - ${err.message}`, { 
      code: err.code,
      message: err.message, 
      url: err.req?.url,
      method: err.req?.method
    });
  });

  logApi.info(`Socket.IO initialized - ready for clients`);
  return true;
}

// Function to get the Socket.IO instance
export function getSocketIO() {
  return io;
}

// Export both functions
export default { 
  initSocketIO,
  getSocketIO
};