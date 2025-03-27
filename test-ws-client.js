// test-ws-client.js - Simple WebSocket client to test token-data WebSocket

import WebSocket from 'ws';
import readline from 'readline';

// Configuration
const PORT = process.env.PORT || 3004;
const HOST = process.env.HOST || 'localhost';
const WS_ENDPOINT = process.env.WS_ENDPOINT || '/api/v69/ws/token-data';
const TOKEN = process.env.TOKEN || '';
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;

// Debug settings for connection troubleshooting
const DEBUG = true; // Enable detailed logging
const CONNECTION_TIMEOUT = 10000; // 10 seconds connection timeout
const ENABLE_QUERY_AUTH = true; // Add token as query parameter instead of header

// Create WebSocket URL with protocol based on environment
const wsUrl = `ws://${HOST}:${PORT}${WS_ENDPOINT}`;

// Setup readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let ws;
let retries = 0;
let isConnected = false;
let connectAttemptInProgress = false;

// Connect to WebSocket server
function connect() {
  if (connectAttemptInProgress) return;
  connectAttemptInProgress = true;
  
  console.log(`\n[Client] Connecting to ${wsUrl}...`);
  
  // Based on server code, token-data WebSocket explicitly:
  // 1. Has authentication disabled (requireAuth: false)
  // 2. Uses the 'query' auth mode
  // 3. Has compression explicitly disabled
  
  // Format URL with auth token if needed (using query auth explicitly)
  const connectionUrl = TOKEN 
    ? `${wsUrl}?token=${encodeURIComponent(TOKEN)}` 
    : wsUrl;
  
  if (DEBUG) {
    console.log(`[Client] Connection URL: ${connectionUrl}`);
    console.log(`[Client] Authentication mode: query parameter`);
    console.log(`[Client] Compression: disabled`);
  }
  
  // Create WebSocket without the unsupported 'chat' protocol
  console.log('[Client] Creating WebSocket with these headers:');
  const wsHeaders = {
    'User-Agent': 'NodeJS-WebSocket-Client',
    'Origin': `http://${HOST}:${PORT}`,
    'Connection': 'Upgrade',
    'Upgrade': 'websocket',
    'Sec-WebSocket-Version': '13',
  };
  console.log(wsHeaders);
  
  // Create the WebSocket with detailed logging
  ws = new WebSocket(connectionUrl, {
    headers: wsHeaders,
    perMessageDeflate: false, // CRITICAL: Disable compression, matching server config
    handshakeTimeout: CONNECTION_TIMEOUT,
  });

  // Set binary type
  ws.binaryType = 'arraybuffer';
  
  // Try to capture the socket events during the handshake
  if (ws._socket) {
    // HTTP upgrade event (happens when the HTTP connection is being upgraded to WebSocket)
    ws._socket.on('upgrade', (response, socket, head) => {
      console.log(`[Client] WebSocket HTTP Upgrade received:`, {
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        headers: response.headers
      });
    });

    // Connect event (happens when the TCP socket connects)
    ws._socket.on('connect', () => {
      console.log(`[Client] TCP socket connection established`);
    });
  } else {
    console.log(`[Client] Note: Unable to access underlying socket for debugging`);
  }
  
  // Add an event handler for unexpected responses
  ws.on('unexpected-response', (req, res) => {
    console.error(`[Client] Unexpected WebSocket response:`, {
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      headers: res.headers
    });
    
    // Read the response body for more details
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      console.error(`[Client] Response body: ${body}`);
    });
  });

  // Connection opened
  ws.on('open', () => {
    isConnected = true;
    connectAttemptInProgress = false;
    retries = 0;
    console.log(`[Client] Connected successfully to ${wsUrl}`);
    console.log('[Client] Type "help" for a list of commands');
    
    // Request all token data
    sendCommand('get_all_tokens');
  });

  // Connection error with enhanced diagnostics
  ws.on('error', (error) => {
    console.error(`[Client] WebSocket error: ${error.message}`);
    
    // Try to extract any extra info from error object
    console.error(`[Client] Error details:`, error);
    
    // Add detailed diagnostics for common WebSocket errors
    if (error.message.includes('401')) {
      console.error(`[Client] 401 Unauthorized: Authentication failed. Check your token.`);
    } else if (error.message.includes('400')) {
      console.error(`[Client] 400 Bad Request: Possible causes:`);
      console.error(`  - Invalid WebSocket handshake`);
      console.error(`  - Invalid URL or path (check ${WS_ENDPOINT})`);
      console.error(`  - Server is not properly handling WebSocket upgrades`);
      console.error(`  - Invalid headers or protocols in the request`);
      console.error(`  - Proxy/networking issues`);
      
      // Print the exact connection URL and headers we're using
      console.error(`[Client] Connection details:`);
      console.error(`  URL: ${connectionUrl}`);
      console.error(`  Headers:`, wsHeaders);
    } else if (error.message.includes('404')) {
      console.error(`[Client] 404 Not Found: The endpoint ${WS_ENDPOINT} does not exist`);
    } else if (error.message.includes('ECONNREFUSED')) {
      console.error(`[Client] Connection refused: Server at ${HOST}:${PORT} is not running or not accepting connections`);
    }
    
    // Log WebSocket readyState if available
    if (ws && typeof ws.readyState !== 'undefined') {
      const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
      console.error(`[Client] WebSocket state: ${states[ws.readyState]} (${ws.readyState})`);
    }
    
    // Check if we have access to the underlying socket
    if (ws && ws._socket) {
      console.error(`[Client] Socket details:`, {
        localAddress: ws._socket.localAddress,
        localPort: ws._socket.localPort,
        remoteAddress: ws._socket.remoteAddress,
        remotePort: ws._socket.remotePort,
        remoteFamily: ws._socket.remoteFamily
      });
    }
    
    if (!isConnected) {
      connectAttemptInProgress = false;
      retryConnection();
    }
  });

  // Connection closed
  ws.on('close', (code, reason) => {
    isConnected = false;
    connectAttemptInProgress = false;
    console.log(`[Client] Connection closed: ${code} - ${reason || 'No reason provided'}`);
    
    if (code !== 1000) { // Not a normal closure
      retryConnection();
    }
  });

  // Message received
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle different message types
      switch (message.type) {
        case 'CONNECTED':
          console.log(`[Client] Connected confirmation: ${message.message}`);
          break;
          
        case 'token_update':
          if (message.data && Array.isArray(message.data)) {
            console.log(`[Client] Received token update with ${message.data.length} tokens`);
            // Print first 3 tokens as example
            if (message.data.length > 0) {
              console.log(`[Client] Sample tokens:`);
              message.data.slice(0, 3).forEach(token => {
                console.log(`  * ${token.symbol}: $${token.price} (${token.change_24h}%)`);
              });
            }
          } else {
            console.log(`[Client] Received empty token update`);
          }
          break;
          
        case 'token_data':
          console.log(`[Client] Received data for token ${message.symbol}:`);
          console.log(message.data);
          break;
          
        case 'ERROR':
          console.error(`[Client] Error from server: ${message.code} - ${message.message}`);
          break;
          
        default:
          console.log(`[Client] Received message of type "${message.type}":`);
          console.log(JSON.stringify(message, null, 2));
      }
    } catch (err) {
      console.error(`[Client] Error parsing message: ${err.message}`);
      console.log(`[Client] Raw message: ${data.toString().substring(0, 100)}...`);
    }
  });
}

// Retry connection with backoff
function retryConnection() {
  if (retries >= MAX_RETRIES) {
    console.error(`[Client] Maximum retry attempts (${MAX_RETRIES}) reached. Giving up.`);
    rl.close();
    process.exit(1);
    return;
  }
  
  retries++;
  const delay = RETRY_DELAY * Math.pow(1.5, retries - 1);
  
  console.log(`[Client] Retrying connection in ${Math.round(delay/1000)} seconds... (Attempt ${retries}/${MAX_RETRIES})`);
  
  setTimeout(() => {
    if (!isConnected && !connectAttemptInProgress) {
      connect();
    }
  }, delay);
}

// Send a command to the server
function sendCommand(command, params = {}) {
  if (!isConnected) {
    console.error('[Client] Not connected! Cannot send command.');
    return;
  }
  
  try {
    const message = {
      type: command,
      ...params,
      timestamp: new Date().toISOString()
    };
    
    ws.send(JSON.stringify(message));
    console.log(`[Client] Sent command: ${command}`);
  } catch (error) {
    console.error(`[Client] Error sending command: ${error.message}`);
  }
}

// Process user commands
function processCommand(input) {
  const args = input.trim().split(' ');
  const command = args[0].toLowerCase();
  
  switch (command) {
    case 'help':
      console.log('\nAvailable commands:');
      console.log('  help               - Show this help message');
      console.log('  connect            - Connect to WebSocket');
      console.log('  status             - Check connection status');
      console.log('  get <symbol>       - Get data for a specific token by symbol');
      console.log('  getall             - Get data for all tokens');
      console.log('  subscribe <symbol> - Subscribe to a specific token');
      console.log('  ping               - Send a ping message to test connection');
      console.log('  exit               - Exit the application\n');
      break;
      
    case 'connect':
      if (!isConnected && !connectAttemptInProgress) {
        connect();
      } else if (isConnected) {
        console.log('[Client] Already connected');
      } else {
        console.log('[Client] Connection attempt in progress...');
      }
      break;
      
    case 'status':
      console.log(`[Client] Connection status: ${isConnected ? 'Connected' : 'Disconnected'}`);
      if (isConnected && ws) {
        console.log(`[Client] WebSocket readyState: ${ws.readyState}`);
      }
      break;
      
    case 'get':
      if (args.length < 2) {
        console.log('[Client] Usage: get <symbol>');
        return;
      }
      sendCommand('get_token', { symbol: args[1].toUpperCase() });
      break;
      
    case 'getall':
      sendCommand('get_all_tokens');
      break;
      
    case 'subscribe':
      if (args.length < 2) {
        console.log('[Client] Usage: subscribe <symbol>');
        return;
      }
      sendCommand('subscribe_tokens', { symbols: [args[1].toUpperCase()] });
      break;
      
    case 'ping':
      sendCommand('ping');
      break;
      
    case 'exit':
      console.log('[Client] Exiting...');
      if (ws) {
        ws.close(1000, 'Client requested exit');
      }
      rl.close();
      process.exit(0);
      break;
      
    default:
      console.log('[Client] Unknown command. Type "help" for a list of commands.');
  }
}

// Start the app
console.log('[Client] Token Data WebSocket Test Client');
console.log(`[Client] Target: ${wsUrl}`);
console.log('[Client] Authentication: ' + (TOKEN ? 'Enabled' : 'Disabled'));
console.log('[Client] Type "help" for a list of commands or "connect" to start');

// Handle user input
rl.on('line', (input) => {
  processCommand(input);
});

// Handle ctrl+c
rl.on('SIGINT', () => {
  console.log('\n[Client] Received SIGINT. Closing connection and exiting...');
  if (ws) {
    ws.close(1000, 'Client requested exit');
  }
  rl.close();
  process.exit(0);
});