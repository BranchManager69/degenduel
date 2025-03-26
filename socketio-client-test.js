// Simple Socket.IO client test script
const { io } = require('socket.io-client');

console.log('Starting Socket.IO client test...');

// Connect to Socket.IO server
const socket = io('https://degenduel.me', {
  path: '/socket.io/', // Default Socket.IO path
  transports: ['websocket', 'polling'],
  rejectUnauthorized: false // Allow self-signed certs
});

// Connection events
socket.on('connect', () => {
  console.log(`CONNECTED! Socket ID: ${socket.id}`);
  
  // Send test message
  setTimeout(() => {
    console.log('Sending test message...');
    socket.emit('message', 'Hello from Node.js test client');
  }, 1000);
});

socket.on('connect_error', (err) => {
  console.error(`Connection error: ${err.message}`);
  console.error('Details:', err);
});

socket.on('welcome', (data) => {
  console.log('Received welcome message:', data);
});

socket.on('echo', (data) => {
  console.log('Received echo response:', data);
  
  // Disconnect after receiving echo
  setTimeout(() => {
    console.log('Test complete, disconnecting...');
    socket.disconnect();
    process.exit(0);
  }, 1000);
});

// Keep running for a bit in case there are issues
setTimeout(() => {
  console.log('Timeout reached, exiting...');
  process.exit(1);
}, 10000);

console.log('Waiting for connection...');