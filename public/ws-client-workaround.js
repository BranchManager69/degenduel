/**
 * DegenDuel WebSocket Client Workaround
 * 
 * This script provides a workaround for the "Invalid WebSocket frame: RSV1 must be clear" error
 * that can occur when using wscat or other WebSocket clients.
 * 
 * Usage:
 * 1. Save this as a Node.js script (e.g., ws-client-workaround.js)
 * 2. Run it with: node ws-client-workaround.js <url> [token]
 *    Example: node ws-client-workaround.js wss://dev.degenduel.me/api/v69/ws/monitor
 * 
 * This script creates a WebSocket connection that disables compression on the client side.
 */

import readline from 'readline';
import WebSocket from 'ws';

// Parse command line arguments
const url = process.argv[2];
const token = process.argv[3];

if (!url) {
  console.error('Error: WebSocket URL is required');
  console.error('Usage: node ws-client-workaround.js <url> [token]');
  console.error('Example: node ws-client-workaround.js wss://dev.degenduel.me/api/v69/ws/monitor');
  process.exit(1);
}

console.log(`Connecting to: ${url}`);

// Create a WebSocket connection with compression disabled
const options = {
  perMessageDeflate: false, // Disable compression
  headers: {}
};

// Add token if provided
let fullUrl = url;
if (token) {
  if (url.includes('?')) {
    fullUrl += `&token=${token}`;
  } else {
    fullUrl += `?token=${token}`;
  }
  console.log(`Using token: ${token.substring(0, 8)}...`);
}

const ws = new WebSocket(fullUrl, options);

// Set up readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

// WebSocket event handlers
ws.on('open', () => {
  console.log('Connected! Type a message to send or Ctrl+C to exit.');
  rl.prompt();
});

ws.on('message', (data) => {
  try {
    // Try to parse as JSON for pretty formatting
    const jsonData = JSON.parse(data);
    console.log('\nReceived:', JSON.stringify(jsonData, null, 2));
  } catch (e) {
    // If not JSON, display as is
    console.log('\nReceived:', data);
  }
  rl.prompt();
});

ws.on('close', (code, reason) => {
  console.log(`\nDisconnected with code ${code}${reason ? `: ${reason}` : ''}`);
  rl.close();
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('\nWebSocket error:', error.message);
  rl.close();
  process.exit(1);
});

// Handle user input
rl.on('line', (line) => {
  if (line.trim()) {
    try {
      // If line is valid JSON, send as is
      if (line.trim().startsWith('{')) {
        const message = JSON.parse(line);
        ws.send(JSON.stringify(message));
        console.log('Sent JSON message');
      } else {
        // Otherwise, assume it's a message type and create a simple message object
        const message = {
          type: line.trim(),
          timestamp: new Date().toISOString()
        };
        ws.send(JSON.stringify(message));
        console.log('Sent:', JSON.stringify(message));
      }
    } catch (error) {
      console.error('Error sending message:', error.message);
    }
  }
  rl.prompt();
});

// Handle graceful exit
rl.on('close', () => {
  console.log('Closing connection...');
  if (ws.readyState === WebSocket.OPEN) {
    ws.close(1000, 'Client closed connection');
  }
  process.exit(0);
});

// Help message
console.log('\nSimple message examples:');
console.log('  heartbeat');
console.log('  get_metrics');
console.log('  get_status');
console.log('\nJSON message example:');
console.log('  {"type":"subscribe","channel":"system.status"}\n');