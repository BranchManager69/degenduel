// simple-ws-test.js - Bare minimum WebSocket client
// This is a simplified version that focuses just on the handshake

import WebSocket from 'ws';
import http from 'http';
import https from 'https';

// Configuration - try all options
// Usage: node simple-ws-test.js [ssl|local] [port]
const USE_SSL = process.argv[2] === 'ssl';
const CUSTOM_PORT = process.argv[3] ? parseInt(process.argv[3]) : null;

// Use default port or custom port if specified
const HOST = USE_SSL ? 'degenduel.me' : 'localhost';
const PORT = CUSTOM_PORT || (USE_SSL ? 443 : 3004); // Default ports
const PROTOCOL = USE_SSL ? 'wss' : 'ws';
const WS_ENDPOINT = '/api/v69/ws/token-data';

// Three different URL formats to try
const wsUrl = `${PROTOCOL}://${HOST}${PORT !== 80 && PORT !== 443 ? ':' + PORT : ''}${WS_ENDPOINT}`;

// Store WebSocket instance
let ws;

// Test HTTP connectivity first to see if the server is reachable
function testHttpConnection() {
  return new Promise((resolve) => {
    console.log(`Testing HTTP${USE_SSL ? 'S' : ''} connectivity first...`);
    
    const httpModule = USE_SSL ? https : http;
    const options = {
      hostname: HOST,
      port: PORT,
      path: '/',
      method: 'GET',
      timeout: 5000,
      rejectUnauthorized: false // Allow self-signed certs
    };
    
    const req = httpModule.request(options, (res) => {
      console.log(`✅ HTTP connection successful! Status: ${res.statusCode}`);
      resolve(true);
    });
    
    req.on('error', (e) => {
      console.log(`❌ HTTP connection failed: ${e.message}`);
      resolve(false);
    });
    
    req.on('timeout', () => {
      console.log('❌ HTTP connection timed out');
      req.destroy();
      resolve(false);
    });
    
    req.end();
  });
}

// Connect to WebSocket with explicit headers
async function connectWebSocket() {
  console.log(`Creating WebSocket with explicit headers...`);
  
  // Very explicit headers for debugging
  const explicitHeaders = {
    'Upgrade': 'websocket',
    'Connection': 'Upgrade',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', // Static key for debugging
    'X-WebSocket-Bypass': 'true',
    'Origin': `http${USE_SSL ? 's' : ''}://${HOST}`,
    'User-Agent': 'DegenDuel-Diagnostic-Client'
  };
  
  // Log the headers we're sending
  console.log('Sending headers:', explicitHeaders);
  
  // Create WebSocket with verbose options
  ws = new WebSocket(wsUrl, {
    perMessageDeflate: false, // CRITICAL: Disable compression
    handshakeTimeout: 5000,
    headers: explicitHeaders,
    // Handle SSL verification (important for wss:// connections)
    rejectUnauthorized: false // Allow self-signed certificates
  });
  
  // Set binary type for proper handling
  ws.binaryType = 'arraybuffer';
  
  // Monitor raw socket if possible (for low-level debugging)
  if (ws._socket) {
    ws._socket.on('connect', () => {
      console.log('✓ TCP socket connected');
    });
    
    ws._socket.on('data', (data) => {
      console.log(`Raw TCP data received (${data.length} bytes)`);
      console.log('First 100 bytes:', data.slice(0, 100).toString('hex'));
    });
  }
  
  // Connection opened
  ws.on('open', () => {
    console.log('✅ CONNECTION SUCCESSFUL!');
    console.log('Sending test message: get_all_tokens');
    
    // Send a simple test message
    ws.send(JSON.stringify({
      type: 'get_all_tokens',
      timestamp: new Date().toISOString(),
      _disableRSV: true,
      _noCompression: true
    }));
    
    // Close after 3 seconds (just to see if we get any response)
    setTimeout(() => {
      console.log('Closing connection after 3s test...');
      ws.close(1000, 'Test completed');
      setTimeout(() => process.exit(0), 500);
    }, 3000);
  });
  
  // Connection error
  ws.on('error', (error) => {
    console.error(`❌ ERROR: ${error.message}`);
    
    // Detailed diagnostics for common errors
    if (error.message.includes('401')) {
      console.error('Authentication failed. Check your token.');
    } else if (error.message.includes('400')) {
      console.error('Bad request. Possible handshake error or invalid URL.');
    } else if (error.message.includes('404')) {
      console.error('Endpoint not found. Check the WebSocket path.');
    } else if (error.message.includes('ECONNREFUSED')) {
      console.error(`Server not running at ${HOST}:${PORT} or port is blocked.`);
    }
  });
  
  // Connection closed
  ws.on('close', (code, reason) => {
    console.log(`❌ Connection closed: ${code} - ${reason || 'No reason'}`);
    
    if (code === 1006) {
      console.error('Abnormal closure (1006) - This indicates a connectivity issue or protocol error');
    }
    
    process.exit(code === 1000 ? 0 : 1);
  });
  
  // Message received
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`✅ Received message type: ${message.type}`);
      
      // Show a sample of token data if present
      if (message.type === 'token_update' && message.data && Array.isArray(message.data)) {
        console.log(`Received ${message.data.length} tokens`);
        if (message.data.length > 0) {
          console.log('Sample token:');
          console.log(message.data[0]);
        }
      }
    } catch (err) {
      console.error(`Error parsing message: ${err.message}`);
      console.log(`Raw message: ${data.toString().substring(0, 100)}...`);
    }
  });
  
  // Handle unexpected responses (like HTTP errors)
  ws.on('unexpected-response', (req, res) => {
    console.error(`❌ UNEXPECTED RESPONSE: ${res.statusCode}`);
    
    // Read response body
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      console.error(`Response body: ${body}`);
      process.exit(1);
    });
  });
  
  // Return a promise that resolves when the connection is established
  return new Promise((resolve, reject) => {
    let timeoutId = setTimeout(() => {
      reject(new Error('WebSocket connection timeout'));
    }, 5000);
    
    ws.on('open', () => {
      clearTimeout(timeoutId);
      resolve(ws);
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
    
    ws.on('unexpected-response', (req, res) => {
      clearTimeout(timeoutId);
      reject(new Error(`Unexpected response: ${res.statusCode}`));
    });
  });
}

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.log('Received SIGINT. Closing...');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(1000, 'User requested exit');
  }
  process.exit(0);
});

// Main function
async function main() {
  console.log('=== WebSocket Test Configuration ===');
  console.log(`Host: ${HOST}`);
  console.log(`Port: ${PORT}`);
  console.log(`Protocol: ${PROTOCOL}`);
  console.log(`Endpoint: ${WS_ENDPOINT}`);
  console.log(`URL: ${wsUrl}`);
  console.log('======================================');
  
  // Test basic HTTP connectivity
  await testHttpConnection();
  
  // Now try WebSocket
  console.log(`\nAttempting WebSocket connection to ${wsUrl}`);
  try {
    await connectWebSocket();
  } catch (err) {
    console.error(`WebSocket connection failed: ${err.message}`);
    process.exit(1);
  }
}

// Run the main function
main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});