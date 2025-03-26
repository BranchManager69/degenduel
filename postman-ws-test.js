/**
 * DegenDuel WebSocket Client Diagnostic Tool
 * 
 * This tool tests WebSocket connections with compression disabled
 * and specifically fixes the "Invalid WebSocket frame: RSV1 must be clear" error
 * by patching the WebSocket frame handling.
 */

import WebSocket from 'ws';
import readline from 'readline';
import { createInterface } from 'readline';
import { Agent } from 'https';
import { createRequire } from 'module';

// Config
import config from './config/config.js';

// More Config (for testing)
const DEFAULT_ENDPOINT = 'monitor';
const DEFAULT_HOST = 'dev.degenduel.me'; // TODO: fix! this is conceptually dev server-only! but db:bonkfa only generates prod tokens!
const PATH_PREFIX = '/api/v69/ws/';

// Get the magic SDAT
const mySDAT = config.wss_testing.test_secret_dev_access_token || '';

// Generate a valid Secret Dev Access Token ("SDAT") using our secure "db:bonkfa" function from scripts/db-tools.sh
//     npm run db:bonkfa; enter a valid passcode in time; then use the SDAT (valid for 1 hour) which automatically gets saved as a new file to data/sensitive/session_token_archive subfolder 
//     example format:  st_20250325_144155_superadmin_Branch.txt
try {
  // Load the most recently created SDAT file from the folder using best practices
  ////const SDAT_FILES = require('./data/sensitive/session_token_archive/'); // (doesnt work)
  //const SDAT_FILES = ???;
  // Sort them by creation date
  //SDAT_FILES.sort((a, b) => new Date(b.name) - new Date(a.name));
  // Get the most recent one
  //const SDAT_FILE = SDAT_FILES[0];
  // Load the valid SDAT from that file (it's good for 1 hour)
  ////const SDAT_TOKEN = SDAT_FILE.token; // PROBLEM! This is a string, not a JSON object
  //const SDAT_TOKEN = SDAT_FILE;
  // Use the SDAT token for testing
  //mySDAT = SDAT_TOKEN; 
  // Log our valid SDAT token in celebration!
  console.log(`VALID SDAT: \t${mySDAT}`);
} catch (error) {
  // Log the error
  console.error(`SDAT ERROR: \tFailed to generate SDAT token. ${error.message}`);
  process.exit(1);
}

// Secret Dev Access Token
const SECRET_DEV_ACCESS_TOKEN = mySDAT;
// Since I've run out of options, let's try something crazy
// Maybe I'm the completely crazy one and I just am so dumb that I don't know the difference between tokensand JWTS or whatever so let's just try this hey headers too I mean maybe I don't know the difference between any of these three things
const my_X_Dev_Access_Token = SECRET_DEV_ACCESS_TOKEN;
// After all I have no clue if these are the same thing anywaya comma I can't tell a header from a freaking token from a freaking cookie

// Parse command line arguments, if any
const args = process.argv.slice(2);
const endpoint = args[0] || DEFAULT_ENDPOINT;
const token = args[1] || '';

// Custom agent with self-signed cert support
const customAgent = new Agent({
  rejectUnauthorized: false // Allow self-signed certificates
});


// Custom WebSocket class that attempts to fix the RSV1 issue
class FixedWebSocket extends WebSocket {
  constructor(address, protocols, options) {
    console.log(`[INIT] Creating WebSocket with compression disabled`);
    
    // Force compression off
    const fixedOptions = {
      ...(options || {}),
      perMessageDeflate: false,
      headers: {
        ...(options?.headers || {}),
        'Sec-WebSocket-Extensions': '',
        'X-Dev-Access-Token': my_X_Dev_Access_Token
      }
    };
    
    // Call the original constructor
    super(address, protocols, fixedOptions);
    
    // Make sure _extensions exists to prevent null reference exceptions
    this._extensions = {};
    
    // Set up frame data hook
    this.on('open', () => {
      this._ignoreRSV1Errors = true;
      console.log(`[PATCH] Connection open, patching receiver and close methods`);
      
      // ULTRA AGGRESSIVE: Override the WebSocket.close method for this instance
      // This prevents ANY closure from happening due to internal errors
      const originalClose = this.close;
      this.close = function(code, reason) {
        // Check for internal RSV1-related closure
        if (code === 1006 || (reason && reason.toString().includes('RSV1'))) {
          console.log(`[PATCH] Intercepted WebSocket.close call with code=${code} reason=${reason}`);
          // Don't actually close the connection!
          return;
        }
        
        // Allow normal close for things like manual disconnection
        return originalClose.call(this, code, reason);
      };
      
      // Override the error method to ignore RSV1 errors
      if (this._receiver) {
        const originalError = this._receiver.error;
        this._receiver.error = function(reason, code) {
          // Check if this is an RSV1 error and ignore it
          if (reason.toString().includes('RSV1')) {
            console.log(`[PATCH] Intercepted RSV1 error: ${reason}`);
            return; // Don't propagate the error
          }
          
          // Otherwise call original error method
          return originalError.call(this, reason, code);
        };
        
        // ADVANCED: If the receiver has a processFrame method, override it
        if (this._receiver.processFrame) {
          const originalProcessFrame = this._receiver.processFrame;
          this._receiver.processFrame = function(frame) {
            // Modify the frame to clear RSV1 bit if it exists
            if (frame && frame.rsv1) {
              console.log(`[PATCH] Clearing RSV1 bit in frame`);
              frame.rsv1 = false;
            }
            // Process with original method
            return originalProcessFrame.call(this, frame);
          };
        }
        
        console.log(`[PATCH] Successfully patched WebSocket methods`);
      }
    });
  }
}

// UI elements - readline interface
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

// State tracking
let isConnected = false;
let activeWs = null;
let messageCount = 0;

// Function to connect to WebSocket server
function connect() {
  // Clean up any existing connection
  if (activeWs) {
    try {
      activeWs.terminate();
    } catch (err) {
      // Ignore errors on cleanup
    }
    activeWs = null;
  }
  
  // Build WebSocket URL with clean token
  const cleanToken = token ? token.replace(/\s+/g, '') : '';
  const wsURL = `wss://${DEFAULT_HOST}${PATH_PREFIX}${endpoint}${cleanToken ? `?token=${encodeURIComponent(cleanToken)}` : ''}`;
  
  console.log(`\n[CONNECT] Connecting to: ${wsURL.replace(/token=([^&]+)/, 'token=***')}`);
  if (cleanToken) {
    console.log(`[TOKEN] Using token (length: ${cleanToken.length}) first 10 chars: ${cleanToken.substring(0, 10)}...`);
  }
  
  try {
    // Create WebSocket with our patched class
    activeWs = new FixedWebSocket(wsURL, undefined, {
      agent: customAgent
    });
    
    // Set up event handlers
    activeWs.on('open', handleOpen);
    activeWs.on('message', handleMessage);
    activeWs.on('error', handleError);
    activeWs.on('close', handleClose);
    activeWs.on('unexpected-response', handleUnexpectedResponse);
    
    return activeWs;
  } catch (error) {
    console.error(`[ERROR] Failed to create WebSocket: ${error.message}`);
    return null;
  }
}

// Event handlers
function handleOpen() {
  isConnected = true;
  console.log(`\n[CONNECTED] WebSocket connection established`);
  console.log(`[STATUS] Ready to send messages`);
  rl.prompt();
}

function handleMessage(data) {
  messageCount++;
  try {
    // Try to parse as JSON
    const jsonData = JSON.parse(data);
    console.log(`\n[RECEIVED ${messageCount}] ${JSON.stringify(jsonData, null, 2)}`);
  } catch (error) {
    // Not JSON, print as text
    console.log(`\n[RECEIVED ${messageCount}] Raw message: ${data}`);
  }
  rl.prompt();
}

function handleError(error) {
  console.error(`\n[ERROR] ${error.message}`);
  
  if (error.message.includes('RSV1')) {
    console.log(`[PATCH] RSV1 error detected - ignoring and staying connected!`);
    // Critically: DO NOT propagate RSV1 errors!
    return;
  }
  
  rl.prompt();
}

function handleClose(code, reason) {
  isConnected = false;
  console.log(`\n[CLOSED] Connection closed with code ${code}${reason ? ': ' + reason : ''}`);
  rl.prompt();
}

function handleUnexpectedResponse(req, res) {
  console.error(`\n[HTTP ERROR] Server returned HTTP ${res.statusCode} instead of WebSocket upgrade`);
  console.log(`[HEADERS] Response headers:`, res.headers);
  
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    console.log(`[BODY] Response body: ${body}`);
    rl.prompt();
  });
}

// Function to send a message to the WebSocket server
function sendMessage(message) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
    console.error(`\n[ERROR] Cannot send message: WebSocket not connected`);
    return false;
  }
  
  try {
    // Convert to string if it's an object
    const messageString = typeof message === 'string' ? message : JSON.stringify(message);
    activeWs.send(messageString);
    console.log(`\n[SENT] ${messageString}`);
    return true;
  } catch (error) {
    console.error(`\n[ERROR] Failed to send message: ${error.message}`);
    return false;
  }
}

// Print welcome message
console.log(`
====================================================
  DegenDuel WebSocket Client Diagnostic Tool
====================================================
  Endpoint: ${endpoint}
  Auth: ${token ? 'JWT Token provided' : 'No token provided'}
  
  Commands:
  - Type 'help' for available commands
  - Type 'quit' or 'exit' to disconnect and exit
  - Type any JSON to send a custom message
====================================================
`);

// Connect to WebSocket server
connect();

// Handle user input
rl.on('line', (line) => {
  const trimmedLine = line.trim();
  
  // Handle special commands
  if (trimmedLine === 'exit' || trimmedLine === 'quit') {
    console.log(`\n[EXIT] Disconnecting and exiting...`);
    if (activeWs) {
      activeWs.close(1000, 'User initiated disconnect');
    }
    setTimeout(() => process.exit(0), 500);
    return;
  }
  
  if (trimmedLine === 'help') {
    console.log(`
Available commands:
  exit/quit - Disconnect and exit
  help - Show this help message
  status - Show connection status
  reconnect - Force reconnection
  
  # Quick message types
  heartbeat - Send heartbeat message
  get_status - Request status from server
  get_metrics - Request metrics from server
  subscribe <channel> - Subscribe to a channel
  
  # Or type any JSON to send a custom message
  {"type":"custom_message","data":{"foo":"bar"}}
`);
    rl.prompt();
    return;
  }
  
  if (trimmedLine === 'status') {
    console.log(`\n[STATUS] Connection: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
    console.log(`[STATUS] Messages received: ${messageCount}`);
    rl.prompt();
    return;
  }
  
  if (trimmedLine === 'reconnect') {
    console.log(`\n[RECONNECT] Manually reconnecting...`);
    connect();
    rl.prompt();
    return;
  }
  
  if (trimmedLine === 'heartbeat') {
    sendMessage({
      type: 'heartbeat',
      timestamp: new Date().toISOString()
    });
    rl.prompt();
    return;
  }
  
  if (trimmedLine === 'get_status') {
    sendMessage({
      type: 'get_status',
      timestamp: new Date().toISOString()
    });
    rl.prompt();
    return;
  }
  
  if (trimmedLine === 'get_metrics') {
    sendMessage({
      type: 'get_metrics',
      timestamp: new Date().toISOString()
    });
    rl.prompt();
    return;
  }
  
  if (trimmedLine.startsWith('subscribe ')) {
    const channel = trimmedLine.split(' ')[1];
    if (channel) {
      sendMessage({
        type: 'subscribe',
        channel: channel,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`\n[ERROR] Missing channel name`);
    }
    rl.prompt();
    return;
  }
  
  // Try to parse as JSON and send as custom message
  if (trimmedLine) {
    try {
      if (trimmedLine.startsWith('{') && trimmedLine.endsWith('}')) {
        const jsonMessage = JSON.parse(trimmedLine);
        sendMessage(jsonMessage);
      } else {
        // Send as simple message type
        sendMessage({
          type: trimmedLine,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error(`\n[ERROR] Invalid JSON: ${error.message}`);
    }
  }
  
  rl.prompt();
});

// Handle CTRL+C to exit gracefully
rl.on('SIGINT', () => {
  console.log(`\n[EXIT] Received SIGINT, disconnecting...`);
  
  if (activeWs && activeWs.readyState === WebSocket.OPEN) {
    activeWs.close(1000, 'User initiated disconnect');
  }
  
  setTimeout(() => {
    rl.close();
    process.exit(0);
  }, 500);
});