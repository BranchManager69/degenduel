#!/usr/bin/env node

/**
 * WebSocket v69 Test Client
 * 
 * A comprehensive test suite for the v69 WebSocket implementation.
 * Tests authentication, channels, subscriptions, and message handling.
 * 
 * Usage:
 *   node test-client.js monitor
 *   node test-client.js monitor --auth <token>
 *   node test-client.js monitor --channel system.status
 */

import WebSocket from 'ws';
import readline from 'readline';
import chalk from 'chalk';
import { program } from 'commander';
import fetch from 'node-fetch';

// Set up command-line arguments
program
  .name('websocket-test-client')
  .description('Test v69 WebSocket implementations')
  .version('1.0.0');

program
  .argument('<type>', 'WebSocket type (monitor, settings, etc.)')
  .option('-h, --host <host>', 'WebSocket host', 'localhost')
  .option('-p, --port <port>', 'WebSocket port', '3004')
  .option('-a, --auth <token>', 'Authentication token')
  .option('-s, --secure', 'Use secure WebSocket (wss://)')
  .option('-c, --channel <channel>', 'Channel to subscribe to')
  .option('-m, --message <json>', 'Initial message to send (JSON string)')
  .option('-v, --verbose', 'Verbose output')
  .option('--json', 'Display messages as formatted JSON')
  .option('--raw', 'Display raw message data')
  .option('--test', 'Run automated test suite');

program.parse(process.argv);

const options = program.opts();
const wsType = program.args[0];

if (!wsType) {
  console.error(chalk.red('Error: WebSocket type is required'));
  process.exit(1);
}

// WebSocket URLs by type
const wsUrls = {
  monitor: '/api/v69/ws/monitor',
  settings: '/api/v69/ws/settings',
  token: '/api/v69/ws/token-data',
  wallet: '/api/v69/ws/wallet',
  contest: '/api/v69/ws/contest',
  'circuit-breaker': '/api/v69/ws/circuit-breaker',
  circuit: '/api/v69/ws/circuit-breaker', // Shorthand alias
  skyduel: '/api/v69/ws/skyduel',
  analytics: '/api/v69/ws/analytics',
  notification: '/api/v69/ws/notifications',
  notifications: '/api/v69/ws/notifications', // Alternate spelling
  portfolio: '/api/v69/ws/portfolio'
};

const wsUrl = wsUrls[wsType];
if (!wsUrl) {
  console.error(chalk.red(`Error: Unknown WebSocket type: ${wsType}`));
  console.error(chalk.yellow(`Available types: ${Object.keys(wsUrls).join(', ')}`));
  process.exit(1);
}

// Add protocol and host
const protocol = options.secure ? 'wss://' : 'ws://';
const host = options.host;
const port = options.port;
const fullUrl = `${protocol}${host}:${port}${wsUrl}`;

// Add token as query parameter if provided
const urlWithToken = options.auth 
  ? `${fullUrl}?token=${options.auth}` 
  : fullUrl;

// Add channel as query parameter if provided
const finalUrl = options.channel 
  ? `${urlWithToken}&channel=${options.channel}` 
  : urlWithToken;

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.cyan('> ')
});

// User commands
const commands = {
  help: () => {
    console.log(chalk.green('\nAvailable commands:'));
    console.log(chalk.cyan('  help') + '              Show this help message');
    console.log(chalk.cyan('  quit') + '              Close connection and exit');
    console.log(chalk.cyan('  subscribe <channel>') + ' Subscribe to a channel');
    console.log(chalk.cyan('  unsubscribe <channel>') + ' Unsubscribe from a channel');
    console.log(chalk.cyan('  status') + '            Get connection status');
    console.log(chalk.cyan('  clear') + '             Clear the console');
    console.log(chalk.cyan('  send <json>') + '       Send a custom message (JSON format)');
    console.log(chalk.cyan('  ping') + '              Send a ping/heartbeat message');
    console.log(chalk.cyan('  verbose') + '           Toggle verbose mode');
    console.log(chalk.cyan('  json') + '              Toggle JSON formatting');
    console.log(chalk.cyan('  raw') + '              Toggle raw message display\n');
    rl.prompt();
  },
  
  // Other commands implemented later
};

// Connection status tracker
let connectionStatus = {
  connected: false,
  authenticated: false,
  subscriptions: new Set(),
  messageCount: 0,
  errorCount: 0,
  startTime: null,
  lastMessageTime: null
};

// Log with timestamp
function log(message, type = 'info') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const prefix = {
    info: chalk.blue('[INFO]'),
    error: chalk.red('[ERROR]'),
    warn: chalk.yellow('[WARN]'),
    success: chalk.green('[SUCCESS]'),
    recv: chalk.magenta('[RECV]'),
    send: chalk.cyan('[SEND]'),
  }[type];
  
  console.log(`${chalk.gray(timestamp)} ${prefix} ${message}`);
}

// Format message for display
function formatMessage(data) {
  if (options.raw) {
    return data;
  }
  
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    if (options.json) {
      return JSON.stringify(obj, null, 2);
    } else {
      // Custom formatting based on message type
      if (obj.type) {
        switch (obj.type) {
          case 'system_status':
            return `System Status: ${chalk.green(obj.data?.status)} | Updated: ${obj.timestamp}`;
          case 'maintenance_status':
            return `Maintenance: ${obj.data?.mode ? chalk.red('ENABLED') : chalk.green('DISABLED')} | Message: ${obj.data?.message || 'None'}`;
          case 'system_settings':
            return `System Settings (${obj.subtype}): ${JSON.stringify(obj.data)}`;
          case 'error':
            return `${chalk.red('Error')}: [${obj.code}] ${obj.message}`;
          case 'subscription_confirmed':
            return `${chalk.green('Subscribed')} to ${obj.channel}`;
          case 'unsubscription_confirmed':
            return `${chalk.yellow('Unsubscribed')} from ${obj.channel}`;
          case 'service:update':
            return `Service Update: ${chalk.bold(obj.service)} | Status: ${formatCircuitStatus(obj.circuit_breaker?.status)} | Updated: ${obj.timestamp}`;
          case 'services:state':
            return `Services State: ${obj.services?.length || 0} services | Updated: ${obj.timestamp}`;
          case 'service:health_check_result':
            return `Health Check: ${chalk.bold(obj.service)} | Healthy: ${obj.healthy ? chalk.green('Yes') : chalk.red('No')} | Status: ${formatCircuitStatus(obj.circuit_breaker?.status)}`;
          case 'service:circuit_breaker_reset_result':
            return `Circuit Reset: ${chalk.bold(obj.service)} | Success: ${obj.success ? chalk.green('Yes') : chalk.red('No')} | Status: ${formatCircuitStatus(obj.status)}`;
          case 'layer:status':
            return `Layer Status: ${chalk.bold(obj.layer)} | Status: ${formatLayerStatus(obj.status)} | Services: ${obj.services?.length || 0}`;
          default:
            return `${chalk.cyan(obj.type)}: ${JSON.stringify(obj)}`;
        }
      } else {
        return JSON.stringify(obj);
      }
    }
  } catch (e) {
    return data;
  }
}

// Format circuit breaker status with color
function formatCircuitStatus(status) {
  if (!status) return chalk.gray('unknown');
  
  switch (status.toLowerCase()) {
    case 'closed':
      return chalk.green('CLOSED');
    case 'degraded':
      return chalk.yellow('DEGRADED');
    case 'open':
      return chalk.red('OPEN');
    case 'initializing':
      return chalk.blue('INITIALIZING');
    default:
      return chalk.gray(status);
  }
}

// Format layer status with color
function formatLayerStatus(status) {
  if (!status) return chalk.gray('unknown');
  
  switch (status.toLowerCase()) {
    case 'operational':
      return chalk.green('OPERATIONAL');
    case 'warning':
      return chalk.yellow('WARNING');
    case 'critical':
      return chalk.red('CRITICAL');
    default:
      return chalk.gray(status);
  }
}

// Create WebSocket connection
console.log(chalk.yellow(`Connecting to ${finalUrl}...`));
const ws = new WebSocket(finalUrl);

// Event handlers
ws.on('open', () => {
  connectionStatus.connected = true;
  connectionStatus.startTime = Date.now();
  log(`Connected to ${wsType} WebSocket`, 'success');
  
  // Send initial message if provided
  if (options.message) {
    try {
      const message = JSON.parse(options.message);
      sendMessage(message);
    } catch (e) {
      log(`Invalid JSON: ${options.message}`, 'error');
    }
  }
  
  // Start command prompt
  rl.prompt();
});

ws.on('message', (data) => {
  const message = data.toString();
  connectionStatus.lastMessageTime = Date.now();
  connectionStatus.messageCount++;
  
  // Try to parse JSON
  let parsedMessage;
  try {
    parsedMessage = JSON.parse(message);
    
    // Update connection status based on message
    if (parsedMessage.type === 'connection_established') {
      connectionStatus.authenticated = parsedMessage.authenticated;
      if (parsedMessage.authenticated) {
        log(`Authenticated as ${parsedMessage.user?.wallet_address}`, 'success');
      }
    } else if (parsedMessage.type === 'subscription_confirmed') {
      connectionStatus.subscriptions.add(parsedMessage.channel);
    } else if (parsedMessage.type === 'unsubscription_confirmed') {
      connectionStatus.subscriptions.delete(parsedMessage.channel);
    }
  } catch (e) {
    parsedMessage = message;
  }
  
  // Display message
  if (options.verbose || parsedMessage.type === 'error') {
    log(formatMessage(parsedMessage), parsedMessage.type === 'error' ? 'error' : 'recv');
  } else {
    const oneLineSummary = formatMessage(parsedMessage).split('\n')[0];
    log(oneLineSummary, 'recv');
  }
  
  rl.prompt();
});

ws.on('close', (code, reason) => {
  connectionStatus.connected = false;
  log(`Connection closed: Code ${code} - ${reason}`, 'warn');
  process.exit(0);
});

ws.on('error', (error) => {
  connectionStatus.errorCount++;
  log(`WebSocket error: ${error.message}`, 'error');
  rl.prompt();
});

// Send a message to the server
function sendMessage(message) {
  if (!connectionStatus.connected) {
    log('Not connected', 'error');
    return;
  }
  
  const messageStr = typeof message === 'string' 
    ? message 
    : JSON.stringify(message);
  
  ws.send(messageStr);
  log(`Sent: ${messageStr}`, 'send');
}

// Implement additional user commands
commands.quit = () => {
  log('Closing connection...', 'info');
  ws.close();
  rl.close();
  process.exit(0);
};

commands.subscribe = (channel) => {
  if (!channel) {
    log('Channel name is required', 'error');
    return;
  }
  
  sendMessage({
    type: 'subscribe',
    channel
  });
};

commands.unsubscribe = (channel) => {
  if (!channel) {
    log('Channel name is required', 'error');
    return;
  }
  
  sendMessage({
    type: 'unsubscribe',
    channel
  });
};

commands.status = () => {
  const uptime = connectionStatus.startTime 
    ? Math.floor((Date.now() - connectionStatus.startTime) / 1000)
    : 0;
  
  console.log(chalk.green('\nConnection Status:'));
  console.log(`  Connected: ${connectionStatus.connected ? chalk.green('Yes') : chalk.red('No')}`);
  console.log(`  Authenticated: ${connectionStatus.authenticated ? chalk.green('Yes') : chalk.red('No')}`);
  console.log(`  Subscriptions: ${Array.from(connectionStatus.subscriptions).join(', ') || 'None'}`);
  console.log(`  Messages Received: ${connectionStatus.messageCount}`);
  console.log(`  Errors: ${connectionStatus.errorCount}`);
  console.log(`  Uptime: ${uptime} seconds\n`);
};

commands.clear = () => {
  console.clear();
};

commands.send = (jsonStr) => {
  if (!jsonStr) {
    log('JSON message is required', 'error');
    return;
  }
  
  try {
    const message = JSON.parse(jsonStr);
    sendMessage(message);
  } catch (e) {
    log(`Invalid JSON: ${jsonStr}`, 'error');
  }
};

commands.ping = () => {
  sendMessage({
    type: 'heartbeat',
    timestamp: new Date().toISOString()
  });
};

commands.verbose = () => {
  options.verbose = !options.verbose;
  log(`Verbose mode ${options.verbose ? 'enabled' : 'disabled'}`, 'info');
};

commands.json = () => {
  options.json = !options.json;
  log(`JSON formatting ${options.json ? 'enabled' : 'disabled'}`, 'info');
};

commands.raw = () => {
  options.raw = !options.raw;
  log(`Raw message display ${options.raw ? 'enabled' : 'disabled'}`, 'info');
};

// Handle user input
rl.on('line', (line) => {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    rl.prompt();
    return;
  }
  
  const [cmd, ...args] = trimmedLine.split(' ');
  
  if (commands[cmd]) {
    commands[cmd](args.join(' '));
  } else if (cmd === '?') {
    commands.help();
  } else {
    log(`Unknown command: ${cmd}. Type 'help' for a list of commands.`, 'error');
  }
  
  rl.prompt();
}).on('close', () => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  process.exit(0);
});

// Automatic test suite
async function runTestSuite() {
  log('Starting automated test suite...', 'info');
  
  // Test 1: Wait for connection
  await new Promise(resolve => {
    if (connectionStatus.connected) {
      resolve();
    } else {
      ws.once('open', resolve);
    }
  });
  
  log('Test 1: Connection established ✓', 'success');
  
  // Small delay between tests
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Test 2: Subscribe to system status channel
  sendMessage({
    type: 'subscribe',
    channel: 'system.status'
  });
  
  // Wait for subscription confirmation or timeout after 2 seconds
  await Promise.race([
    new Promise(resolve => {
      const checkSubscription = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'subscription_confirmed' && message.channel === 'system.status') {
            ws.removeListener('message', checkSubscription);
            resolve();
          }
        } catch (e) {
          // Ignore parse errors
        }
      };
      
      ws.on('message', checkSubscription);
    }),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  
  if (connectionStatus.subscriptions.has('system.status')) {
    log('Test 2: Channel subscription successful ✓', 'success');
  } else {
    log('Test 2: Channel subscription failed ✗', 'error');
  }
  
  // Test 3: Request system status
  sendMessage({
    type: 'get_system_status'
  });
  
  // Wait for status message or timeout after 2 seconds
  let receivedStatus = false;
  await Promise.race([
    new Promise(resolve => {
      const checkStatus = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'system_status') {
            receivedStatus = true;
            ws.removeListener('message', checkStatus);
            resolve();
          }
        } catch (e) {
          // Ignore parse errors
        }
      };
      
      ws.on('message', checkStatus);
    }),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  
  if (receivedStatus) {
    log('Test 3: System status request successful ✓', 'success');
  } else {
    log('Test 3: System status request failed ✗', 'error');
  }
  
  // Test 4: Heartbeat message
  sendMessage({
    type: 'heartbeat',
    timestamp: new Date().toISOString()
  });
  
  // Wait for heartbeat ack or timeout after 2 seconds
  let receivedHeartbeat = false;
  await Promise.race([
    new Promise(resolve => {
      const checkHeartbeat = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'heartbeat_ack') {
            receivedHeartbeat = true;
            ws.removeListener('message', checkHeartbeat);
            resolve();
          }
        } catch (e) {
          // Ignore parse errors
        }
      };
      
      ws.on('message', checkHeartbeat);
    }),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  
  if (receivedHeartbeat) {
    log('Test 4: Heartbeat message successful ✓', 'success');
  } else {
    log('Test 4: Heartbeat message failed ✗', 'error');
  }
  
  // Test 5: Unsubscribe from channel
  sendMessage({
    type: 'unsubscribe',
    channel: 'system.status'
  });
  
  // Wait for unsubscription confirmation or timeout after 2 seconds
  await Promise.race([
    new Promise(resolve => {
      const checkUnsubscription = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'unsubscription_confirmed' && message.channel === 'system.status') {
            ws.removeListener('message', checkUnsubscription);
            resolve();
          }
        } catch (e) {
          // Ignore parse errors
        }
      };
      
      ws.on('message', checkUnsubscription);
    }),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  
  if (!connectionStatus.subscriptions.has('system.status')) {
    log('Test 5: Channel unsubscription successful ✓', 'success');
  } else {
    log('Test 5: Channel unsubscription failed ✗', 'error');
  }
  
  log('Test suite completed ✓', 'success');
  log('Type "help" for available commands or "quit" to exit', 'info');
}

// Run test suite if --test flag is provided
if (process.argv.includes('--test')) {
  ws.on('open', () => {
    runTestSuite();
  });
}

// Get authentication token helper function
async function getToken() {
  try {
    const response = await fetch(`http://${host}:${port}/api/auth/token`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.token;
  } catch (error) {
    log(`Failed to get auth token: ${error.message}`, 'error');
    return null;
  }
}

// Log helper function to get token
log('To get an authentication token, login to DegenDuel and then run:', 'info');
log('curl -v --cookie "session=YOUR_SESSION_COOKIE" http://localhost:3004/api/auth/token', 'info');