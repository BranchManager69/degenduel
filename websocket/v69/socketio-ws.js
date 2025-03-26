// socketio-ws.js - Simple Socket.IO Implementation

import { Server } from 'socket.io';
import { logApi } from '../../utils/logger-suite/logger.js';

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
  
  // Create Socket.IO instance at /socket.io/ path (the default that clients expect)
  // But with a namespace of /api/v69/ws/socketio
  io = new Server(httpServer, {
    // Default Socket.IO path
    path: '/socket.io/',
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
    // Handle proxies correctly
    cookie: false
  });
  
  // Create a namespace for our specific endpoint
  const namespace = io.of('/api/v69/ws/socketio');
  
  // Log that Socket.IO has been initialized with namespace
  logApi.info(`Socket.IO server created with namespace: /api/v69/ws/socketio`);
  
  // Log that Socket.IO has been initialized
  logApi.info(`Socket.IO server created with path: /api/v69/ws/socketio`);

  // Handle main Socket.IO connections - for clients that connect to the default path
  io.on('connection', (socket) => {
    logApi.info(`Main Socket.IO connection: ${socket.id}`);
    
    // Send welcome message
    socket.emit('welcome', {
      message: 'Connected to main Socket.IO server',
      id: socket.id,
      time: new Date().toISOString(),
      note: 'You are connected to the main namespace, try connecting to /api/v69/ws/socketio namespace'
    });
    
    // Echo any messages back
    socket.on('message', (data) => {
      logApi.info(`Main Socket.IO message from ${socket.id}: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
      socket.emit('echo', {
        original: data,
        time: new Date().toISOString()
      });
    });
    
    socket.on('disconnect', () => {
      logApi.info(`Main Socket.IO disconnect: ${socket.id}`);
    });
  });
  
  // Handle connections to the specific namespace
  const namespace = io.of('/api/v69/ws/socketio');
  
  namespace.on('connection', (socket) => {
    logApi.info(`Namespace Socket.IO connection: ${socket.id}`);
    
    // Send welcome message
    socket.emit('welcome', {
      message: 'Connected to Socket.IO server (namespace: /api/v69/ws/socketio)',
      id: socket.id,
      namespace: '/api/v69/ws/socketio',
      time: new Date().toISOString()
    });
    
    // Echo any messages back
    socket.on('message', (data) => {
      logApi.info(`Namespace Socket.IO message from ${socket.id}: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
      socket.emit('echo', {
        original: data,
        time: new Date().toISOString()
      });
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
      logApi.info(`Namespace Socket.IO disconnect: ${socket.id}`);
    });
  });

  logApi.info("Socket.IO initialized at /api/v69/ws/socketio");
  return true;
}

// Direct access to the Socket.IO instance
export default { initSocketIO };