// enhanced-ws-client.js - Improved WebSocket client with better debugging
// Works around compatibility issues for the token-data WebSocket

import WebSocket from 'ws';
import net from 'net';
import http from 'http';
import { URL } from 'url';
import readline from 'readline';
import crypto from 'crypto';

// Configuration
const PORT = process.env.PORT || 3004;
const HOST = process.env.HOST || 'localhost';
const WS_ENDPOINT = process.env.WS_ENDPOINT || '/api/v69/ws/token-data';
const TOKEN = process.env.TOKEN || '';
const CONNECTION_TIMEOUT = 10000; // 10 seconds

// Create console interface for interactive commands
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// ANSI color codes for better terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",
  hidden: "\x1b[8m",
  
  fg: {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
  },
  
  bg: {
    black: "\x1b[40m",
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
    white: "\x1b[47m",
    gray: "\x1b[100m",
  }
};

// Helper to print colored log messages
function log(type, message, data = null) {
  let prefix;
  switch (type) {
    case 'info':
      prefix = `${colors.bg.blue}${colors.fg.white} INFO ${colors.reset}`;
      break;
    case 'success':
      prefix = `${colors.bg.green}${colors.fg.black} SUCCESS ${colors.reset}`;
      break;
    case 'error':
      prefix = `${colors.bg.red}${colors.fg.white} ERROR ${colors.reset}`;
      break;
    case 'warn':
      prefix = `${colors.bg.yellow}${colors.fg.black} WARNING ${colors.reset}`;
      break;
    case 'header':
      console.log(`\n${colors.bg.magenta}${colors.fg.white}${colors.bright} ${message} ${colors.reset}\n`);
      return;
    default:
      prefix = `${colors.fg.gray}[LOG]${colors.reset}`;
  }
  
  console.log(`${prefix} ${message}`);
  
  if (data) {
    if (typeof data === 'object') {
      console.log(colors.fg.gray + JSON.stringify(data, null, 2) + colors.reset);
    } else {
      console.log(colors.fg.gray + data + colors.reset);
    }
  }
}

// Manual WebSocket client that doesn't rely on ws library's abstraction
// This helps us debug the exact handshake process and work around issues
async function connectWithRawHandshake() {
  log('header', 'RAW TCP HANDSHAKE METHOD');
  log('info', `Starting raw WebSocket handshake to ws://${HOST}:${PORT}${WS_ENDPOINT}`);
  
  return new Promise((resolve, reject) => {
    // Create a TCP socket
    const socket = net.createConnection({ host: HOST, port: PORT });
    
    // Generate a random WebSocket key (for security)
    const wsKey = crypto.randomBytes(16).toString('base64');
    
    // Add token as query parameter if provided
    const endpoint = TOKEN ? `${WS_ENDPOINT}?token=${encodeURIComponent(TOKEN)}` : WS_ENDPOINT;
    
    // Create the HTTP request for WebSocket upgrade
    const request = [
      `GET ${endpoint} HTTP/1.1`,
      `Host: ${HOST}:${PORT}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${wsKey}`,
      'Sec-WebSocket-Version: 13',
      'User-Agent: DegenDuel-Enhanced-Client',
      'Origin: http://localhost:3004',
      'X-WebSocket-Bypass: true', // Special header to signal our middleware
      // IMPORTANT: Don't include any extension headers
      '',
      ''
    ].join('\r\n');
    
    // Debug output
    log('info', 'Sending WebSocket upgrade request:');
    log('info', request);
    
    // Set a timeout
    socket.setTimeout(CONNECTION_TIMEOUT, () => {
      socket.end();
      log('error', `Connection timed out after ${CONNECTION_TIMEOUT/1000} seconds`);
      reject(new Error('Connection timed out'));
    });
    
    // Handle connection
    socket.connect(PORT, HOST, () => {
      log('success', `TCP connection established to ${HOST}:${PORT}`);
      
      // Send upgrade request
      socket.write(request);
    });
    
    // Handle errors
    socket.on('error', (err) => {
      log('error', `Connection error: ${err.message}`);
      reject(err);
    });
    
    // Handle data received
    let responseData = '';
    socket.on('data', (data) => {
      // Append to response buffer
      responseData += data.toString();
      
      // Check if we have received the complete HTTP headers
      if (responseData.includes('\r\n\r\n')) {
        log('info', 'Received response headers:');
        
        // Split headers from any frame data
        const [headersText, frameData] = responseData.split('\r\n\r\n', 2);
        const headerLines = headersText.split('\r\n');
        
        // Print header lines
        headerLines.forEach(line => log('info', `  ${line}`));
        
        // Check if it's a successful upgrade (HTTP 101)
        const statusLine = headerLines[0];
        if (statusLine.includes('101')) {
          log('success', 'WebSocket upgrade successful!');
          
          // At this point, we have a WebSocket connection
          // We could implement frame parsing/writing here, but for simplicity
          // we'll just demonstrate a successful handshake
          resolve({ success: true, socket, responseData });
        } else {
          log('error', `WebSocket upgrade failed: ${statusLine}`);
          socket.end();
          reject(new Error(`Upgrade failed: ${statusLine}`));
        }
      }
    });
    
    // Handle connection close
    socket.on('close', () => {
      log('warn', 'Connection closed');
    });
  });
}

// Standard WebSocket client with enhanced debugging
function connectWithWsLibrary() {
  return new Promise((resolve, reject) => {
    log('header', 'WS LIBRARY METHOD');
    
    // Add token as query parameter if provided
    const wsUrl = TOKEN 
      ? `ws://${HOST}:${PORT}${WS_ENDPOINT}?token=${encodeURIComponent(TOKEN)}`
      : `ws://${HOST}:${PORT}${WS_ENDPOINT}`;
    
    log('info', `Connecting with ws library to ${wsUrl}`);
    
    // Create WebSocket with explicit options for debugging
    const ws = new WebSocket(wsUrl, {
      perMessageDeflate: false, // CRITICAL: Disable compression
      handshakeTimeout: CONNECTION_TIMEOUT,
      headers: {
        'User-Agent': 'DegenDuel-Enhanced-WS-Client',
        'Origin': `http://${HOST}:${PORT}`,
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'X-WebSocket-Bypass': 'true', // Special header to signal our middleware
        'Connection': 'Upgrade',
        'Upgrade': 'websocket'
      }
    });
    
    // Set binary type for proper handling
    ws.binaryType = 'arraybuffer';
    
    // Try to monitor the underlying socket if available
    if (ws._socket) {
      log('info', 'Monitoring underlying socket events');
      
      ws._socket.on('connect', () => {
        log('success', 'TCP socket connected');
      });
      
      ws._socket.on('lookup', (err, address, family, host) => {
        log('info', `DNS lookup: ${host} -> ${address}`);
      });
      
      ws._socket.on('timeout', () => {
        log('warn', 'Socket timeout');
      });
    }
    
    // Debug connection events
    ws.on('open', () => {
      log('success', 'WebSocket connection opened successfully!');
      
      // Send a test message
      const message = {
        type: 'get_all_tokens',
        timestamp: new Date().toISOString(),
        // Add special flags to disable compression on server side
        _disableRSV: true,
        _noCompression: true
      };
      
      ws.send(JSON.stringify(message));
      log('info', 'Sent message: get_all_tokens');
      
      // Enable interactive mode
      log('info', 'Type commands to interact with the WebSocket:');
      log('info', '  getall - Get all tokens');
      log('info', '  get <symbol> - Get specific token');
      log('info', '  quit - Exit the application');
      
      rl.on('line', (input) => {
        const args = input.trim().split(' ');
        const command = args[0].toLowerCase();
        
        switch (command) {
          case 'getall':
            ws.send(JSON.stringify({
              type: 'get_all_tokens',
              timestamp: new Date().toISOString(),
              _disableRSV: true,
              _noCompression: true
            }));
            log('info', 'Sent command: get_all_tokens');
            break;
            
          case 'get':
            if (args.length < 2) {
              log('warn', 'Usage: get <symbol>');
              return;
            }
            ws.send(JSON.stringify({
              type: 'get_token',
              symbol: args[1].toUpperCase(),
              timestamp: new Date().toISOString(),
              _disableRSV: true,
              _noCompression: true
            }));
            log('info', `Sent command: get_token ${args[1].toUpperCase()}`);
            break;
            
          case 'quit':
          case 'exit':
            log('info', 'Exiting...');
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(1000, 'User requested exit');
            }
            rl.close();
            process.exit(0);
            break;
            
          default:
            log('warn', 'Unknown command. Available commands: getall, get <symbol>, quit');
        }
      });
      
      resolve(ws);
    });
    
    ws.on('error', (err) => {
      log('error', `WebSocket error: ${err.message}`);
      
      // Enhanced diagnostics for common errors
      if (err.message.includes('401')) {
        log('error', 'Authentication failed. Check your token.');
      } else if (err.message.includes('400')) {
        log('error', 'Bad request. Possible handshake error or invalid URL.');
      } else if (err.message.includes('404')) {
        log('error', 'Endpoint not found. Check the WebSocket path.');
      } else if (err.message.includes('ECONNREFUSED')) {
        log('error', `Server not running at ${HOST}:${PORT} or port is blocked.`);
      }
      
      reject(err);
    });
    
    ws.on('close', (code, reason) => {
      log('warn', `WebSocket closed: ${code} - ${reason || 'No reason'}`);
      
      if (code === 1006) {
        log('error', 'Abnormal closure (1006) - This often indicates a connectivity issue or protocol error');
      }
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        log('success', `Received message type: ${message.type}`);
        
        // Handle different message types
        switch (message.type) {
          case 'token_update':
            if (message.data && Array.isArray(message.data)) {
              log('success', `Received ${message.data.length} tokens`);
              if (message.data.length > 0) {
                log('info', 'Sample tokens:');
                message.data.slice(0, 3).forEach(token => {
                  console.log(`  * ${token.symbol}: $${token.price} (${token.change_24h}%)`);
                });
              }
            } else {
              log('warn', 'Received empty token data');
            }
            break;
            
          case 'token_data':
            log('success', `Received data for token ${message.symbol}`);
            log('info', message.data);
            break;
            
          case 'ERROR':
            log('error', `Server error: ${message.message}`);
            break;
            
          default:
            log('info', JSON.stringify(message, null, 2));
        }
      } catch (err) {
        log('error', `Error parsing message: ${err.message}`);
        log('warn', `Raw message: ${data.toString().substring(0, 100)}...`);
      }
    });
    
    ws.on('ping', (data) => {
      log('info', 'Received ping from server');
    });
    
    ws.on('pong', (data) => {
      log('info', 'Received pong from server');
    });
    
    ws.on('unexpected-response', (req, res) => {
      log('error', `Unexpected response: ${res.statusCode}`);
      
      // Try to read response body
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        log('error', `Response body: ${body}`);
        reject(new Error(`Unexpected response: ${res.statusCode}`));
      });
    });
  });
}

// Run both test approaches
async function runTests() {
  try {
    log('header', 'ENHANCED WEBSOCKET CLIENT FOR TOKEN-DATA');
    log('info', 'Testing connection to token-data WebSocket');
    log('info', `Target: ws://${HOST}:${PORT}${WS_ENDPOINT}`);
    log('info', `Authentication: ${TOKEN ? 'Enabled' : 'Disabled'}`);
    
    // Try the raw TCP handshake approach
    try {
      await connectWithRawHandshake();
      log('success', 'Raw handshake test completed');
      
      // Give it a moment to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      log('error', `Raw handshake test failed: ${err.message}`);
    }
    
    // Try the ws library approach - this is the main interactive client
    try {
      const ws = await connectWithWsLibrary();
      
      // Let the client run indefinitely - it's controlled by user input
      // The process will exit when the user types 'quit' or closes the connection
      
    } catch (err) {
      log('error', `WS library connection failed: ${err.message}`);
      
      // Wait a moment before exiting to show the error
      await new Promise(resolve => setTimeout(resolve, 3000));
      process.exit(1);
    }
  } catch (err) {
    log('error', `Tests failed: ${err.message}`);
    process.exit(1);
  }
}

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  log('warn', 'Received SIGINT. Closing...');
  rl.close();
  process.exit(0);
});

// Start tests
log('header', 'STARTING WEBSOCKET TESTS');
runTests();