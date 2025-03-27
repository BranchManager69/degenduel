// tools/test-token-ws.js
import WebSocket from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get the directory name using ESM approach
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import colors safely (with fallback if not found)
let fancyColors = {
  CYAN: '\x1b[36m',
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  WHITE: '\x1b[37m',
  BLACK: '\x1b[30m',
  BOLD: '\x1b[1m',
  RESET: '\x1b[0m',
  BG_GREEN: '\x1b[42m',
  BG_RED: '\x1b[41m',
  BG_YELLOW: '\x1b[43m',
  BG_PURPLE: '\x1b[45m'
};

try {
  const colorsPath = path.join(__dirname, '..', 'utils', 'colors.js');
  if (fs.existsSync(colorsPath)) {
    const colorsModule = await import(colorsPath);
    fancyColors = colorsModule.fancyColors || fancyColors;
  }
} catch (error) {
  console.log(`Could not load colors: ${error.message}, using defaults`);
}

// Configuration
const WS_URL = 'ws://localhost:3005/api/v69/ws/token-data';
const RECONNECT_INTERVAL = 5000; // 5 seconds

let ws = null;
let reconnectTimer = null;
let connected = false;
let lastTokens = [];
let connectionAttempt = 0;

function connect() {
  connectionAttempt++;
  console.log(`${fancyColors.CYAN}Connecting to ${WS_URL} (attempt ${connectionAttempt})...${fancyColors.RESET}`);
  
  // Clear any existing reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  // Set up WebSocket with additional headers and protocols to avoid 400 errors
  const options = {
    headers: {
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': 'DegenDuel-TokenData-WebSocket-Client'
    },
    // IMPORTANT: Don't request compression
    perMessageDeflate: false
  };
  
  ws = new WebSocket(WS_URL, options);
  
  ws.on('open', () => {
    connected = true;
    console.log(`${fancyColors.BG_GREEN}${fancyColors.BLACK} CONNECTED ${fancyColors.RESET} WebSocket connection established`);
    
    // Send a ping message
    console.log(`${fancyColors.CYAN}Sending ping...${fancyColors.RESET}`);
    ws.send(JSON.stringify({
      type: 'ping',
      timestamp: new Date().toISOString()
    }));
    
    // Also request all tokens
    console.log(`${fancyColors.CYAN}Requesting token data...${fancyColors.RESET}`);
    ws.send(JSON.stringify({
      type: 'get_all_tokens'
    }));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      if (message.type === 'pong') {
        console.log(`${fancyColors.CYAN}Received pong response${fancyColors.RESET}`);
        return;
      }
      
      if (message.type === 'CONNECTED') {
        console.log(`${fancyColors.BG_GREEN}${fancyColors.BLACK} CONNECTION CONFIRMED ${fancyColors.RESET} ID: ${message.connectionId}, Authenticated: ${message.authenticated}`);
        return;
      }
      
      if (message.type === 'token_update') {
        const tokens = message.data;
        lastTokens = tokens;
        
        console.log(`${fancyColors.BG_PURPLE}${fancyColors.WHITE} TOKEN UPDATE ${fancyColors.RESET} Received ${tokens.length} tokens at ${new Date().toLocaleTimeString()}`);
        
        // Print first 3 tokens
        tokens.slice(0, 3).forEach(token => {
          const change = token.change_24h >= 0 
            ? `${fancyColors.GREEN}+${token.change_24h}%${fancyColors.RESET}`
            : `${fancyColors.RED}${token.change_24h}%${fancyColors.RESET}`;
          
          console.log(`${fancyColors.BOLD}${token.symbol}${fancyColors.RESET} (${token.name}): $${token.price} ${change}`);
        });
        
        console.log(`... and ${tokens.length - 3} more tokens`);
      } else if (message.type === 'ERROR') {
        console.error(`${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${message.code}: ${message.message}`);
      } else {
        console.log(`${fancyColors.YELLOW}Received message (${message.type}):${fancyColors.RESET}`, JSON.stringify(message).substring(0, 100) + '...');
      }
    } catch (error) {
      console.error(`${fancyColors.RED}Error parsing message:${fancyColors.RESET}`, error.message);
      console.error(`Raw data: ${data.toString().substring(0, 100)}...`);
    }
  });
  
  ws.on('error', (error) => {
    console.error(`${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} WebSocket error:`, error.message);
  });
  
  ws.on('close', (code, reason) => {
    connected = false;
    console.log(`${fancyColors.BG_RED}${fancyColors.WHITE} DISCONNECTED ${fancyColors.RESET} WebSocket closed with code ${code}: ${reason || 'No reason'}`);
    
    // Schedule reconnect
    console.log(`${fancyColors.YELLOW}Will reconnect in ${RECONNECT_INTERVAL/1000} seconds...${fancyColors.RESET}`);
    reconnectTimer = setTimeout(() => {
      console.log(`${fancyColors.YELLOW}Attempting to reconnect...${fancyColors.RESET}`);
      connect();
    }, RECONNECT_INTERVAL);
  });
  
  // Set a timeout in case the connection never establishes
  setTimeout(() => {
    if (!connected && ws.readyState !== WebSocket.OPEN) {
      console.log(`${fancyColors.YELLOW}Connection timeout, closing and retrying...${fancyColors.RESET}`);
      try {
        ws.terminate();
      } catch (e) {
        // Ignore errors on terminate
      }
    }
  }, 10000);
}

// Handle process exit events
process.on('SIGINT', () => {
  if (ws) {
    console.log(`${fancyColors.YELLOW}Closing WebSocket connection...${fancyColors.RESET}`);
    ws.close();
  }
  process.exit(0);
});

// Display detailed diagnostic info about the connection
function showDiagnostics() {
  console.log(`\n${fancyColors.BOLD}${fancyColors.CYAN}====== WebSocket Diagnostics ======${fancyColors.RESET}`);
  console.log(`${fancyColors.CYAN}URL: ${WS_URL}${fancyColors.RESET}`);
  console.log(`${fancyColors.CYAN}Connection State: ${connected ? 'Connected' : 'Disconnected'}${fancyColors.RESET}`);
  
  if (ws) {
    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    console.log(`${fancyColors.CYAN}ReadyState: ${states[ws.readyState]} (${ws.readyState})${fancyColors.RESET}`);
  }
  
  console.log(`${fancyColors.CYAN}Last Token Count: ${lastTokens.length}${fancyColors.RESET}`);
  console.log(`${fancyColors.CYAN}Connection Attempts: ${connectionAttempt}${fancyColors.RESET}`);
  console.log(`${fancyColors.BOLD}${fancyColors.CYAN}==================================${fancyColors.RESET}\n`);
}

// Start the client
console.clear();
console.log(`${fancyColors.BOLD}${fancyColors.CYAN}DegenDuel Token WebSocket Client${fancyColors.RESET}`);
console.log(`${fancyColors.CYAN}Press Ctrl+C to exit${fancyColors.RESET}`);
console.log(`${fancyColors.CYAN}Press 'd' + Enter for diagnostics${fancyColors.RESET}`);

// Simple command processor
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  const input = data.toString().trim();
  if (input === 'd') {
    showDiagnostics();
  } else if (input === 'r') {
    console.log(`${fancyColors.YELLOW}Manual reconnect requested...${fancyColors.RESET}`);
    if (ws) {
      ws.close();
    }
    connect();
  } else if (input === 'p') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log(`${fancyColors.CYAN}Sending ping...${fancyColors.RESET}`);
      ws.send(JSON.stringify({
        type: 'ping',
        timestamp: new Date().toISOString()
      }));
    } else {
      console.log(`${fancyColors.YELLOW}Not connected, cannot send ping${fancyColors.RESET}`);
    }
  }
});

// Start the connection
connect();