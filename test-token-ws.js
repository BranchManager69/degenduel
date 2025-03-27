// test-token-ws.js - Detailed WebSocket diagnostics (ESM version)
import WebSocket from 'ws';
import http from 'http';
import { URL } from 'url';

// Configuration
const wsEndpoint = 'ws://localhost:3004/api/v69/ws/token-data';
const verboseMode = true;

console.log(`\n🔌 WebSocket Test Client for ${wsEndpoint}`);
console.log('====================================\n');

// Function to create manual WebSocket connection with detailed diagnostics
function createManualWebSocketConnection() {
  console.log('🔍 Creating manual WebSocket connection with diagnostics...');
  
  // Parse the URL
  const wsUrl = new URL(wsEndpoint);
  const port = wsUrl.port || (wsUrl.protocol === 'wss:' ? 443 : 80);
  
  // Generate a random key for the WebSocket handshake
  const randomKey = Buffer.from(Math.random().toString(36).substring(2, 15)).toString('base64');
  
  // Create HTTP request headers
  const requestOptions = {
    hostname: wsUrl.hostname,
    port: port,
    path: wsUrl.pathname + wsUrl.search,
    method: 'GET',
    headers: {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
      'Sec-WebSocket-Key': randomKey,
      'Sec-WebSocket-Version': '13',
      'User-Agent': 'DegenDuel-Diagnostic-Client'
    }
  };
  
  console.log('📤 Sending HTTP request with headers:');
  console.log(JSON.stringify(requestOptions.headers, null, 2));
  
  // Make HTTP request
  const req = http.request(requestOptions);
  
  req.on('upgrade', (res, socket, upgradeHead) => {
    console.log('\n✅ Connection upgraded to WebSocket!');
    console.log('📥 Received headers:');
    console.log(JSON.stringify(res.headers, null, 2));
    
    // Connection established - we can now initialize a WebSocket
    console.log('\n🤝 WebSocket handshake successful');
    
    // Clean up
    socket.end();
    console.log('🔌 Connection closed');
  });
  
  req.on('response', (res) => {
    console.log(`\n❌ Received HTTP ${res.statusCode} ${res.statusMessage} (Expected 101 Switching Protocols)`);
    console.log('📥 Response headers:');
    console.log(JSON.stringify(res.headers, null, 2));
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      if (data) {
        console.log('\n📄 Response body:');
        console.log(data);
      }
      console.log('🔌 Connection closed');
    });
  });
  
  req.on('error', (error) => {
    console.error(`\n❌ ERROR: ${error.message}`);
  });
  
  req.end();
}

// Function to create standard WebSocket connection
function createStandardWebSocketConnection() {
  console.log('🔌 Creating standard WebSocket connection...');
  
  const ws = new WebSocket(wsEndpoint, {
    headers: {
      'User-Agent': 'DegenDuel-Standard-Client'
    }
  });
  
  ws.on('open', function open() {
    console.log('✅ Connection opened successfully!');
    console.log('📤 Sending ping message...');
    ws.send(JSON.stringify({type: 'ping'}));
  });
  
  ws.on('message', function incoming(data) {
    console.log('📥 Received message:', data.toString());
    ws.close();
  });
  
  ws.on('error', function error(err) {
    console.error(`❌ WebSocket error: ${err.message}`);
  });
  
  ws.on('close', function close(code, reason) {
    console.log(`🔌 Connection closed: ${code}${reason ? ' - ' + reason : ''}`);
  });
}

// Start diagnostic test
console.log('🧪 Starting WebSocket diagnostic test...\n');

// Run the manual connection test first
createManualWebSocketConnection();

// Wait a bit then do the standard test
setTimeout(() => {
  console.log('\n==================================\n');
  createStandardWebSocketConnection();
}, 2000);