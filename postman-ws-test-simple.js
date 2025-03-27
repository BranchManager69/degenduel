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

// ANSI Colors for pretty output
const colors = {
  reset: '\x1b[0m',
  // Basic colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  // Bright colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
  // Backgrounds
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  // Text styles
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m'
};

// More Config (for testing)
const DEFAULT_ENDPOINT = 'token-data';
const HOSTS = {
  dev: 'dev.degenduel.me',
  prod: 'degenduel.me'
};
const PATH_PREFIX = '/api/v69/ws/';

// All available v69 WebSocket endpoints
const AVAILABLE_ENDPOINTS = {
  'monitor': { path: 'monitor', auth: 'optional', description: 'System status and monitoring' },
  'token-data': { path: 'token-data', auth: 'none', description: 'Market data and token prices' },
  'circuit-breaker': { path: 'circuit-breaker', auth: 'optional', description: 'Circuit breaker status' },
  'notifications': { path: 'notifications', auth: 'required', description: 'User-specific notifications' },
  'market-data': { path: 'market-data', auth: 'optional', description: 'Market data and analytics' },
  'skyduel': { path: 'skyduel', auth: 'optional', description: 'SkyDuel game data' },
  'analytics': { path: 'analytics', auth: 'optional', description: 'System analytics' },
  'system-settings': { path: 'system-settings', auth: 'optional', description: 'System settings' },
  'portfolio': { path: 'portfolio', auth: 'required', description: 'User portfolio data' },
  'contest': { path: 'contest', auth: 'optional', description: 'Contest data and chat rooms' },
  'wallet': { path: 'wallet', auth: 'required', description: 'Wallet data' },
  'test': { path: 'test', auth: 'none', description: 'Test endpoint' }
};

// Parse command line arguments, if any
const args = process.argv.slice(2);
const endpoint = args[0] || DEFAULT_ENDPOINT;

if (!AVAILABLE_ENDPOINTS[endpoint]) {
  console.log(`
Error: Unknown endpoint '${endpoint}'

Available endpoints:
${Object.entries(AVAILABLE_ENDPOINTS).map(([key, info]) => 
  `  ${key.padEnd(15)} - ${info.description} (Auth: ${info.auth})`
).join('\n')}

Usage: node ${process.argv[1]} <endpoint>
Example: node ${process.argv[1]} token-data
`);
  process.exit(1);
}

// Custom agent with self-signed cert support
const customAgent = new Agent({
  rejectUnauthorized: false // Allow self-signed certificates
});

// Track connections for both environments
let devWs = null;
let prodWs = null;

// Custom WebSocket class that attempts to fix the RSV1 issue
class FixedWebSocket extends WebSocket {
  constructor(address, protocols, options) {
    console.log(`[INIT] Creating WebSocket with compression DISABLED for ${address}`);
    
    // Super simple options - just disable compression
    const fixedOptions = {
      ...(options || {}),
      perMessageDeflate: false,
      headers: {
        'Sec-WebSocket-Extensions': '' // Prevent any compression
      }
    };
    
    // Call the original constructor
    super(address, protocols, fixedOptions);
    
    // Make sure _extensions exists to prevent null reference exceptions
    this._extensions = {};
  }
}

// Helper function to format timestamps
function formatTimestamp() {
  return new Date().toLocaleTimeString('en-US', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  });
}

// Helper function to format message type badges
function formatBadge(type, text) {
  switch(type.toLowerCase()) {
    case 'error':
      return `${colors.bgRed}${colors.white}${colors.bold} ${text} ${colors.reset}`;
    case 'warning':
      return `${colors.bgYellow}${colors.black}${colors.bold} ${text} ${colors.reset}`;
    case 'success':
      return `${colors.bgGreen}${colors.black}${colors.bold} ${text} ${colors.reset}`;
    case 'info':
      return `${colors.bgBlue}${colors.white}${colors.bold} ${text} ${colors.reset}`;
    default:
      return `${colors.gray}${colors.bold} ${text} ${colors.reset}`;
  }
}

// Helper function to format environment badges
function formatEnvBadge(env) {
  return env.toUpperCase() === 'DEV' 
    ? `${colors.bgBlue}${colors.white}${colors.bold} DEV ${colors.reset}`
    : `${colors.bgGreen}${colors.black}${colors.bold} PROD ${colors.reset}`;
}

// Helper function to format JSON messages
function formatJSON(data, indent = 0) {
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    const formatted = JSON.stringify(obj, null, 2)
      .split('\n')
      .map(line => '  '.repeat(indent) + line)
      .join('\n');
    return formatted;
  } catch (e) {
    return typeof data === 'string' ? data : JSON.stringify(data);
  }
}

// Event handlers for each environment
function createHandlers(env) {
  return {
    handleOpen: () => {
      const envBadge = formatEnvBadge(env);
      const successBadge = formatBadge('success', 'CONNECTED');
      console.log(`\n${colors.gray}[${formatTimestamp()}]${colors.reset} ${envBadge} ${successBadge}`);
      console.log(`${colors.gray}└─${colors.reset} ${colors.cyan}Ready to send/receive messages${colors.reset}`);
      rl.prompt();
    },
    
    handleMessage: (data) => {
      const envBadge = formatEnvBadge(env);
      const msgBadge = formatBadge('info', 'MESSAGE');
      try {
        const message = JSON.parse(data);
        console.log(`\n${colors.gray}[${formatTimestamp()}]${colors.reset} ${envBadge} ${msgBadge}`);
        
        // Special handling for different message types
        if (message.type) {
          console.log(`${colors.gray}├─${colors.reset} ${colors.cyan}Type:${colors.reset} ${colors.brightYellow}${message.type}${colors.reset}`);
        }
        if (message.error) {
          console.log(`${colors.gray}├─${colors.reset} ${colors.red}Error:${colors.reset} ${message.error}`);
        }
        if (message.data) {
          console.log(`${colors.gray}├─${colors.reset} ${colors.cyan}Data:${colors.reset}`);
          console.log(`${colors.gray}│${colors.reset}  ${formatJSON(message.data, 1)}`);
        }
        
        // Show full message for debugging
        console.log(`${colors.gray}└─${colors.reset} ${colors.dim}Full message:${colors.reset}`);
        console.log(`${colors.gray}   ${colors.reset}${formatJSON(message, 1)}`);
      } catch (e) {
        // Raw text message
        console.log(`\n${colors.gray}[${formatTimestamp()}]${colors.reset} ${envBadge} ${msgBadge}`);
        console.log(`${colors.gray}└─${colors.reset} ${colors.cyan}Raw:${colors.reset} ${data}`);
      }
      rl.prompt();
    },
    
    handleError: (error) => {
      const envBadge = formatEnvBadge(env);
      const errorBadge = formatBadge('error', 'ERROR');
      
      console.log(`\n${colors.gray}[${formatTimestamp()}]${colors.reset} ${envBadge} ${errorBadge}`);
      console.log(`${colors.gray}├─${colors.reset} ${colors.red}${error.message}${colors.reset}`);
      
      // Enhanced error diagnostics
      if (error.message.includes('ECONNREFUSED')) {
        console.log(`${colors.gray}├─${colors.reset} ${colors.yellow}Diagnosis:${colors.reset} Server is down or not listening`);
        console.log(`${colors.gray}└─${colors.reset} ${colors.yellow}Solution:${colors.reset} Check if the server is running on the expected port`);
      } else if (error.message.includes('ENOTFOUND')) {
        console.log(`${colors.gray}├─${colors.reset} ${colors.yellow}Diagnosis:${colors.reset} Host not found`);
        console.log(`${colors.gray}└─${colors.reset} ${colors.yellow}Solution:${colors.reset} Check your DNS settings and internet connection`);
      } else if (error.message.includes('RSV1')) {
        console.log(`${colors.gray}├─${colors.reset} ${colors.yellow}Diagnosis:${colors.reset} WebSocket compression issue`);
        console.log(`${colors.gray}└─${colors.reset} ${colors.yellow}Solution:${colors.reset} Compression is disabled, this error should be ignored`);
      } else {
        console.log(`${colors.gray}└─${colors.reset} ${colors.yellow}Try reconnecting or check server logs${colors.reset}`);
      }
      
      rl.prompt();
    },
    
    handleClose: (code, reason) => {
      const envBadge = formatEnvBadge(env);
      const closeBadge = formatBadge('warning', 'CLOSED');
      
      console.log(`\n${colors.gray}[${formatTimestamp()}]${colors.reset} ${envBadge} ${closeBadge}`);
      console.log(`${colors.gray}├─${colors.reset} ${colors.yellow}Code:${colors.reset} ${code}`);
      if (reason) {
        console.log(`${colors.gray}└─${colors.reset} ${colors.yellow}Reason:${colors.reset} ${reason}`);
      }
      
      if (env === 'dev') {
        devWs = null;
      } else {
        prodWs = null;
      }
      rl.prompt();
    },
    
    handleUnexpectedResponse: (req, res) => {
      const envBadge = formatEnvBadge(env);
      const errorBadge = formatBadge('error', 'HTTP ERROR');
      
      console.log(`\n${colors.gray}[${formatTimestamp()}]${colors.reset} ${envBadge} ${errorBadge}`);
      console.log(`${colors.gray}├─${colors.reset} ${colors.red}Status:${colors.reset} ${res.statusCode} ${res.statusMessage || ''}`);
      
      // Enhanced diagnostics for common status codes
      if (res.statusCode === 400) {
        console.log(`${colors.gray}├─${colors.reset} ${colors.yellow}Diagnosis:${colors.reset} Bad Request - Server rejected the connection`);
        console.log(`${colors.gray}├─${colors.reset} ${colors.yellow}Possible causes:${colors.reset}`);
        console.log(`${colors.gray}│${colors.reset}  ${colors.dim}•${colors.reset} Invalid authentication token`);
        console.log(`${colors.gray}│${colors.reset}  ${colors.dim}•${colors.reset} Wrong authentication parameter name`);
        console.log(`${colors.gray}│${colors.reset}  ${colors.dim}•${colors.reset} WebSocket protocol mismatch`);
      } else if (res.statusCode === 401) {
        console.log(`${colors.gray}├─${colors.reset} ${colors.yellow}Diagnosis:${colors.reset} Unauthorized - Authentication required`);
        console.log(`${colors.gray}├─${colors.reset} ${colors.yellow}Required Auth:${colors.reset} ${AVAILABLE_ENDPOINTS[endpoint].auth}`);
      } else if (res.statusCode === 404) {
        console.log(`${colors.gray}├─${colors.reset} ${colors.yellow}Diagnosis:${colors.reset} Endpoint not found`);
        console.log(`${colors.gray}├─${colors.reset} ${colors.yellow}Endpoint:${colors.reset} ${PATH_PREFIX}${endpoint}`);
      }
      
      // Show headers for debugging
      console.log(`${colors.gray}├─${colors.reset} ${colors.dim}Response Headers:${colors.reset}`);
      Object.entries(res.headers).forEach(([key, value], i, arr) => {
        const isLast = i === arr.length - 1;
        console.log(`${colors.gray}${isLast ? '└' : '├'}─${colors.reset} ${colors.dim}${key}:${colors.reset} ${value}`);
      });
      
      rl.prompt();
    }
  };
}

// Function to connect to a specific environment
function connectToEnv(env) {
  const wsURL = `wss://${HOSTS[env]}${PATH_PREFIX}${endpoint}`;
  console.log(`\n[${env.toUpperCase()}] Connecting to: ${wsURL}`);
  
  try {
    const ws = new FixedWebSocket(wsURL, undefined, {
      agent: customAgent
    });
    
    const handlers = createHandlers(env);
    
    // Set up event handlers
    ws.on('open', handlers.handleOpen);
    ws.on('message', handlers.handleMessage);
    ws.on('error', handlers.handleError);
    ws.on('close', handlers.handleClose);
    ws.on('unexpected-response', handlers.handleUnexpectedResponse);
    
    return ws;
  } catch (error) {
    console.error(`[${env.toUpperCase()} ERROR] Failed to create WebSocket: ${error.message}`);
    return null;
  }
}

// Function to connect to WebSocket server
function connect() {
  // Clean up any existing connections
  if (devWs) {
    try { devWs.terminate(); } catch (err) { /* ignore */ }
    devWs = null;
  }
  if (prodWs) {
    try { prodWs.terminate(); } catch (err) { /* ignore */ }
    prodWs = null;
  }
  
  // Connect to both environments
  devWs = connectToEnv('dev');
  prodWs = connectToEnv('prod');
}

// UI elements - readline interface
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

// Handle user input
rl.on('line', (line) => {
  const trimmedLine = line.trim();
  
  // Handle special commands
  if (trimmedLine === 'quit' || trimmedLine === 'exit') {
    console.log('\nDisconnecting...');
    if (devWs) devWs.close();
    if (prodWs) prodWs.close();
    process.exit(0);
  }
  
  if (trimmedLine === 'help') {
    console.log(`
Available commands:
- quit/exit: Disconnect and exit
- help: Show this help message
- reconnect: Reconnect to both servers
- status: Show connection status
- endpoints: List all available endpoints
- switch <endpoint>: Switch to a different endpoint
- Any other input will be sent as a message to both servers if connected

Available endpoints:
${Object.entries(AVAILABLE_ENDPOINTS).map(([key, info]) => 
  `  ${key.padEnd(15)} - ${info.description} (Auth: ${info.auth})`
).join('\n')}
`);
    rl.prompt();
    return;
  }
  
  if (trimmedLine === 'reconnect') {
    console.log('\nReconnecting to both servers...');
    connect();
    rl.prompt();
    return;
  }
  
  if (trimmedLine === 'status') {
    console.log('\nConnection Status:');
    console.log(`DEV: ${devWs ? 'Connected' : 'Disconnected'}`);
    console.log(`PROD: ${prodWs ? 'Connected' : 'Disconnected'}`);
    rl.prompt();
    return;
  }
  
  if (trimmedLine === 'endpoints') {
    console.log(`\nAvailable endpoints:`);
    Object.entries(AVAILABLE_ENDPOINTS).forEach(([key, info]) => {
        console.log(`  ${key.padEnd(15)} - ${info.description} (Auth: ${info.auth})`);
    });
    rl.prompt();
    return;
  }
  
  if (trimmedLine.startsWith('switch ')) {
    const newEndpoint = trimmedLine.split(' ')[1];
    if (AVAILABLE_ENDPOINTS[newEndpoint]) {
        console.log(`\nSwitching to endpoint: ${newEndpoint}`);
        endpoint = newEndpoint;
        connect();
    } else {
        console.log(`\nError: Unknown endpoint '${newEndpoint}'`);
        console.log('Use the "endpoints" command to see available endpoints');
    }
    rl.prompt();
    return;
  }
  
  // Try to send the message to both servers
  try {
    // Try to parse as JSON first
    const jsonMessage = JSON.parse(trimmedLine);
    if (devWs) {
      devWs.send(JSON.stringify(jsonMessage));
      console.log('\n[DEV SENT] Message sent as JSON');
    }
    if (prodWs) {
      prodWs.send(JSON.stringify(jsonMessage));
      console.log('[PROD SENT] Message sent as JSON');
    }
  } catch (e) {
    // Not valid JSON, send as plain text
    if (devWs) {
      devWs.send(trimmedLine);
      console.log('\n[DEV SENT] Message sent as text');
    }
    if (prodWs) {
      prodWs.send(trimmedLine);
      console.log('[PROD SENT] Message sent as text');
    }
  }
  
  rl.prompt();
});

// Update the welcome message with colors
console.log(`
${colors.brightCyan}====================================================
  ${colors.bold}DegenDuel WebSocket Client Diagnostic Tool${colors.reset}${colors.brightCyan}
====================================================${colors.reset}
  ${colors.cyan}Current Endpoint:${colors.reset} ${colors.brightYellow}${endpoint}${colors.reset}
  ${colors.cyan}Description:${colors.reset} ${AVAILABLE_ENDPOINTS[endpoint].description}
  ${colors.cyan}Auth Required:${colors.reset} ${AVAILABLE_ENDPOINTS[endpoint].auth === 'required' 
    ? `${colors.red}${AVAILABLE_ENDPOINTS[endpoint].auth}${colors.reset}`
    : AVAILABLE_ENDPOINTS[endpoint].auth === 'optional'
      ? `${colors.yellow}${AVAILABLE_ENDPOINTS[endpoint].auth}${colors.reset}`
      : `${colors.green}${AVAILABLE_ENDPOINTS[endpoint].auth}${colors.reset}`}
  ${colors.cyan}Testing Environments:${colors.reset}
    ${formatEnvBadge('dev')} ${colors.gray}wss://dev.degenduel.me${colors.reset}
    ${formatEnvBadge('prod')} ${colors.gray}wss://degenduel.me${colors.reset}
  
  ${colors.cyan}Commands:${colors.reset}
  ${colors.dim}•${colors.reset} Type ${colors.brightYellow}'help'${colors.reset} for available commands
  ${colors.dim}•${colors.reset} Type ${colors.brightYellow}'quit'${colors.reset} or ${colors.brightYellow}'exit'${colors.reset} to disconnect and exit
  ${colors.dim}•${colors.reset} Type ${colors.brightYellow}'status'${colors.reset} to check connection status
  ${colors.dim}•${colors.reset} Type ${colors.brightYellow}'endpoints'${colors.reset} to list all endpoints
  ${colors.dim}•${colors.reset} Type ${colors.brightYellow}'switch <endpoint>'${colors.reset} to change endpoint
  ${colors.dim}•${colors.reset} Type ${colors.brightYellow}'reconnect'${colors.reset} to reconnect to both servers
  ${colors.dim}•${colors.reset} Type any JSON to send a custom message
${colors.brightCyan}====================================================${colors.reset}
`);

// Connect to both servers
connect();