/**
 * DegenDuel Direct Socket.IO Test Server
 * 
 * This is a standalone Socket.IO server that runs on port 3006
 * completely independent of any other WebSocket servers.
 */

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { logApi } from './utils/logger-suite/logger.js';

// Create HTTP server
const app = express();
const server = http.createServer(app);

// Create Socket.IO server - directly attached to HTTP server
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Serve a simple HTML page to test the connection
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Socket.IO Test</title>
      <script src="https://cdn.socket.io/4.6.0/socket.io.min.js"></script>
    </head>
    <body>
      <h1>Socket.IO Test</h1>
      <div id="status">Connecting...</div>
      <div id="messages"></div>
      <script>
        const socket = io();
        const status = document.getElementById('status');
        const messages = document.getElementById('messages');
        
        socket.on('connect', () => {
          status.textContent = 'Connected: ' + socket.id;
          addMessage('Connected');
        });
        
        socket.on('message', (data) => {
          addMessage('Received: ' + JSON.stringify(data));
        });
        
        function addMessage(text) {
          const div = document.createElement('div');
          div.textContent = text;
          messages.appendChild(div);
        }
      </script>
    </body>
    </html>
  `);
});

// Handle socket connections
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);
  logApi.info(`Socket.IO direct connection: ${socket.id}`);
  
  // Send welcome message
  socket.emit('message', {
    type: 'welcome',
    message: 'Welcome to the Socket.IO test server',
    id: socket.id,
    time: new Date().toISOString()
  });
  
  // Handle incoming messages
  socket.on('message', (data) => {
    console.log(`Received message from ${socket.id}:`, data);
    logApi.info(`Socket.IO message from ${socket.id}: ${JSON.stringify(data)}`);
    
    // Echo the message back
    socket.emit('message', {
      type: 'echo',
      original: data,
      time: new Date().toISOString()
    });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    logApi.info(`Socket.IO client disconnected: ${socket.id}`);
  });
});

// Start the server
const PORT = 3006;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.IO test server running on port ${PORT}`);
  
  // Log IP addresses for remote connection
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const ips = [];
  
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip internal and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  
  logApi.info(`Direct Socket.IO test server running on port ${PORT}`, {
    _highlight: true,
    _color: '#00FF00'
  });
  
  console.log('\nFor Postman testing from your local machine to this remote server:');
  console.log('1. Create a new WebSocket request in Postman');
  console.log('2. Connect to the remote server using one of these addresses:');
  
  if (ips.length > 0) {
    ips.forEach(ip => {
      console.log(`   ws://${ip}:${PORT}/socket.io/?EIO=4&transport=websocket`);
    });
  } else {
    console.log(`   ws://YOUR_SERVER_IP:${PORT}/socket.io/?EIO=4&transport=websocket`);
    console.log('   (Replace YOUR_SERVER_IP with the actual server IP address or domain)');
  }
  
  // Add known domain names
  console.log(`   ws://degenduel.me:${PORT}/socket.io/?EIO=4&transport=websocket`);
  console.log(`   ws://dev.degenduel.me:${PORT}/socket.io/?EIO=4&transport=websocket`);
  
  console.log('\n3. After connected, send this message to test:');
  console.log('   42["message","Hello from Postman"]');
  
  console.log('\nNOTE: Make sure port 3006 is open in your firewall for external connections.');
});

// End of file