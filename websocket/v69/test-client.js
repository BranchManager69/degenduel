#!/usr/bin/env node

/**
 * WebSocket v69 Test Client
 * 
 * A comprehensive test suite for the v69 WebSocket implementation.
 * Tests authentication, channels, subscriptions, and message handling.
 * 
 * Usage:
 *   node test-client.js [websocket name]
 *   node test-client.js [websocket name] --auth <token>
 *   node test-client.js [websocket name] --channel [channel name]
 * 
 * Valid v69 websocket names: (triple-check all of these)
 *   [see wsUrls object below]
 */

import WebSocket from 'ws';
import readline from 'readline';
import chalk from 'chalk';
import { program } from 'commander';
import fetch from 'node-fetch';
import http from 'http';

// Config
import config from '../../config/config.js';
// Extra config
const BRANCH_MANAGER_ACCESS_SECRET = config.secure_middleware.branch_manager_access_secret;

// Enhanced diagnostic options
const DIAGNOSTICS = {
  VERBOSE_HEADERS: true,        // Log all headers in both directions
  TRACK_EXTENSIONS: true,       // Pay special attention to WebSocket extensions
  CONNECTION_PHASES: true,      // Log each phase of connection establishment
  RAW_PACKET_INSPECTION: false, // Enable only if needed - very verbose
  TRACK_RSV_BITS: true,         // Track RSV1/RSV2/RSV3 bits in WebSocket frames
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
// (^ Remember, this only lasts for 1 hour! Use db:bonkfa + valid passcode to generate new ones as needed.)

// MAKE SURE THIS IS VALID AND HASN'T EXPIRED!!!
const mySessionCookie = BRANCH_MANAGER_ACCESS_SECRET;

// All v69 WebSocket URLs by type (12 of 12)
const wsUrls = {
  monitor: '/api/v69/ws/monitor',
  'system-settings': '/api/v69/ws/system-settings',
  'token-data': '/api/v69/ws/token-data',
  'market-data': '/api/v69/ws/market-data',
  contest: '/api/v69/ws/contest',
  'circuit-breaker': '/api/v69/ws/circuit-breaker',
  skyduel: '/api/v69/ws/skyduel',
  analytics: '/api/v69/ws/analytics',
  'user-notifications': '/api/v69/ws/user-notifications',
  portfolio: '/api/v69/ws/portfolio',
  wallet: '/api/v69/ws/wallet',
  // Test WebSocket - special test endpoint that doesn't require auth and fully supports compression
  test: '/api/v69/ws/test'
};

// Set up command-line arguments
program
  .name('v69-websocket-test-client')
  .description('v69 WebSocket Test Client')
  .version('1.6.9');

program
  .argument('[type]', 'WebSocket type (use "all" to test all endpoints)')
  .option('-h, --host <host>', 'WebSocket host', 'degenduel.me') // (default: prod server) I prefer to use URLs because why wouldn't we want to test a real scenario?
  .option('-p, --port <port>', 'WebSocket port options (3005 for dev server, 3004 for prod server) (default: prod server)', '3004')
  .option('-a, --auth <token>', 'Authentication token', BRANCH_MANAGER_ACCESS_SECRET)
  .option('-s, --secure', 'Use secure WebSocket (wss:// for both prod and dev servers)', true)
  .option('-c, --channel <channel>', 'Channel to subscribe to')
  .option('-m, --message <json>', 'Initial message to send (JSON string)')
  .option('-v, --verbose', 'Verbose output', true)
  .option('-e, --env', 'Production or development server', 'production')
  .option('--json', 'Display messages as formatted JSON', true)
  .option('--raw', 'Display raw message data')
  .option('--test', 'Run automated test suite')
  .option('--auth-method <method>', 'Authentication method: query, header, cookie, or all', 'all')
  .option('--test-all', 'Test all WebSocket endpoints')
  .option('--connection-timeout <ms>', 'Connection timeout in milliseconds', '10000');

program.parse(process.argv);

const options = program.opts();
let wsType = program.args[0] || (options.testAll ? 'all' : null);
log(`Options: ${JSON.stringify(options)}`, 'info');
log(`WS Type: ${wsType}`, 'info');

// Check if testing all endpoints or a specific one
if (!wsType) {
  console.error(chalk.red('Error: WebSocket type is required'));
  console.error(chalk.yellow(`Available types: ${Object.keys(wsUrls).join(', ')} or 'all' to test all endpoints`));
  process.exit(1);
}

// Create an array of endpoints to test
let endpointsToTest = [];
if (wsType === 'all') {
  log(`Testing ALL WebSocket endpoints...`, 'info');
  endpointsToTest = Object.keys(wsUrls);
} else if (wsUrls[wsType]) {
  log(`Testing only the ${wsType} WebSocket endpoint`, 'info');
  endpointsToTest = [wsType];
} else {
  console.error(chalk.red(`Error: Unknown WebSocket type: ${wsType}`));
  console.error(chalk.yellow(`Available types: ${Object.keys(wsUrls).join(', ')} or 'all' to test all endpoints`));
  process.exit(1);
}

// Determine prod/dev server for auth token generation purposes
let myAuthTokenGenerationURL;
let myAuthTokenProtocol;
if (options.env === 'production') {
  myAuthTokenGenerationURL = `${options.secure ? 'https' : 'http'}://degenduel.me/api/auth/token`;
} else {
  myAuthTokenGenerationURL = `${options.secure ? 'https' : 'http'}://dev.degenduel.me/api/auth/token`;
}

// ====== Function declarations needed before they're used ======

// Store results of connection tests for all endpoints
const endpointResults = {};

// Function to test all WebSocket endpoints one by one
async function testAllEndpoints(endpoints) {
  log(`\n${chalk.bold.green('====== TESTING ALL WEBSOCKET ENDPOINTS ======')}\n`, 'info');
  
  // Keep track of results
  const results = {
    total: endpoints.length,
    success: 0,
    failed: 0,
    authenticated: 0,
    endpoints: {}
  };
  
  // Test each endpoint sequentially
  for (const endpoint of endpoints) {
    log(`\n${chalk.bold.cyan(`Testing endpoint: ${endpoint}`)}`, 'info');
    
    // Set up promise to wait for connection result
    const connectionResult = await new Promise(resolve => {
      // Keep track of this endpoint's results
      const endpointResult = {
        name: endpoint,
        connected: false,
        authenticated: false,
        error: null,
        connectionTime: null,
        messages: [],
        timeoutId: null
      };
      
      // Set timeout to prevent hanging
      const timeoutMs = parseInt(options.connectionTimeout, 10) || 5000;
      const timeoutId = setTimeout(() => {
        log(`${chalk.yellow('Connection timeout after')} ${timeoutMs}ms ${chalk.yellow('for endpoint:')} ${endpoint}`, 'warn');
        
        if (global.ws && global.ws.readyState === WebSocket.OPEN) {
          global.ws.close();
        }
        
        endpointResult.error = 'Connection timeout';
        resolve(endpointResult);
      }, timeoutMs);
      
      endpointResult.timeoutId = timeoutId;
      
      try {
        // Create connection to this endpoint
        const startTime = Date.now();
        const ws = connectWithAuth(endpoint, false); // false = don't start interactive mode
        
        // Set up event handlers for this connection
        ws.on('open', () => {
          const connectionTime = Date.now() - startTime;
          log(`${chalk.green('✓ Connected to')} ${endpoint} ${chalk.green('in')} ${connectionTime}ms`, 'success');
          
          endpointResult.connected = true;
          endpointResult.connectionTime = connectionTime;
          
          // Send a heartbeat message to check if server responds
          try {
            ws.send(JSON.stringify({
              type: 'heartbeat',
              timestamp: new Date().toISOString()
            }));
            log(`Sent heartbeat to ${endpoint}`, 'info');
          } catch (err) {
            log(`Error sending heartbeat to ${endpoint}: ${err.message}`, 'error');
          }
          
          // Wait for a moment to see if we receive any messages
          setTimeout(() => {
            clearTimeout(timeoutId);
            
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
            
            resolve(endpointResult);
          }, 2000);
        });
        
        ws.on('message', (data) => {
          const message = data.toString();
          log(`${chalk.magenta('Received message from')} ${endpoint}: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`, 'recv');
          
          try {
            const parsedMessage = JSON.parse(message);
            endpointResult.messages.push(parsedMessage);
            
            // Check for authentication confirmation
            if (parsedMessage.type === 'connection_established') {
              endpointResult.authenticated = parsedMessage.authenticated;
              
              if (parsedMessage.authenticated) {
                log(`${chalk.green('✓ Authenticated with')} ${endpoint} ${chalk.green('as')} ${parsedMessage.user?.wallet_address}`, 'success');
              } else {
                log(`${chalk.yellow('Connected to')} ${endpoint} ${chalk.yellow('but not authenticated')}`, 'warn');
              }
            }
          } catch (e) {
            log(`Error parsing message from ${endpoint}: ${e.message}`, 'error');
            endpointResult.messages.push(message);
          }
        });
        
        ws.on('error', (error) => {
          log(`${chalk.red('Error connecting to')} ${endpoint}: ${error.message}`, 'error');
          endpointResult.error = error.message;
          
          clearTimeout(timeoutId);
          resolve(endpointResult);
        });
        
        ws.on('close', (code, reason) => {
          log(`${chalk.yellow('Connection closed for')} ${endpoint}: Code ${code} - ${reason}`, 'warn');
          
          clearTimeout(timeoutId);
          if (!endpointResult.connected) {
            endpointResult.error = `Connection closed with code ${code}: ${reason}`;
            resolve(endpointResult);
          }
        });
        
      } catch (error) {
        log(`${chalk.red('Failed to connect to')} ${endpoint}: ${error.message}`, 'error');
        endpointResult.error = error.message;
        clearTimeout(timeoutId);
        resolve(endpointResult);
      }
    });
    
    // Store the result for this endpoint
    results.endpoints[endpoint] = connectionResult;
    
    // Update summary stats
    if (connectionResult.connected) {
      results.success++;
      if (connectionResult.authenticated) {
        results.authenticated++;
      }
    } else {
      results.failed++;
    }
  }
  
  // Display summary of results
  log(`\n${chalk.bold.green('====== WEBSOCKET CONNECTION TEST RESULTS ======')}\n`, 'info');
  log(`${chalk.bold('Total endpoints tested:')} ${results.total}`, 'info');
  log(`${chalk.bold('Successfully connected:')} ${results.success} ${chalk.green(`(${Math.round(results.success / results.total * 100)}%)`)}`, 'info');
  log(`${chalk.bold('Failed connections:')} ${results.failed} ${chalk.red(`(${Math.round(results.failed / results.total * 100)}%)`)}`, 'info');
  log(`${chalk.bold('Authenticated connections:')} ${results.authenticated} ${chalk.yellow(`(${Math.round(results.authenticated / results.total * 100)}%)`)}`, 'info');
  
  // Display detailed results for each endpoint
  log(`\n${chalk.bold('Detailed results:')}\n`, 'info');
  
  for (const endpoint in results.endpoints) {
    const result = results.endpoints[endpoint];
    const statusSymbol = result.connected ? '✓' : '✗';
    const statusColor = result.connected ? chalk.green : chalk.red;
    const authStatus = result.authenticated ? chalk.green('Authenticated') : chalk.yellow('Not authenticated');
    
    log(`${statusColor(`${statusSymbol} ${endpoint}:`)} ${result.connected ? chalk.green(`Connected in ${result.connectionTime}ms`) : chalk.red(`Failed: ${result.error || 'Unknown error'}`)} - ${result.connected ? authStatus : ''}`, 'info');
  }
  
  log(`\n${chalk.bold.green('===============================================')}\n`, 'info');
  
  // Store results for reference
  Object.assign(endpointResults, results.endpoints);
  
  // In interactive mode, prompt user to select an endpoint to connect to
  log(`\nTest complete. You can now select an endpoint to connect to interactively.`, 'info');
  
  // Add a new command to list tested endpoints
  commands.endpoints = () => {
    log(`\n${chalk.bold('Tested endpoints:')}\n`, 'info');
    
    for (const endpoint in endpointResults) {
      const result = endpointResults[endpoint];
      const statusSymbol = result.connected ? '✓' : '✗';
      const statusColor = result.connected ? chalk.green : chalk.red;
      const authStatus = result.authenticated ? chalk.green('Authenticated') : chalk.yellow('Not authenticated');
      
      log(`${statusColor(`${statusSymbol} ${endpoint}:`)} ${result.connected ? chalk.green(`Connected in ${result.connectionTime}ms`) : chalk.red(`Failed: ${result.error || 'Unknown error'}`)} - ${result.connected ? authStatus : ''}`, 'info');
    }
    
    log(`\nTo connect to an endpoint, type: ${chalk.cyan('connect <endpoint>')}`, 'info');
    rl.prompt();
  };
  
  // Add a command to connect to a specific endpoint
  commands.connect = (endpointName) => {
    if (!endpointName) {
      log('Endpoint name is required', 'error');
      return;
    }
    
    if (!wsUrls[endpointName]) {
      log(`Unknown endpoint: ${endpointName}. Available endpoints: ${Object.keys(wsUrls).join(', ')}`, 'error');
      return;
    }
    
    log(`Connecting to ${endpointName}...`, 'info');
    wsType = endpointName;
    connectWithAuth(endpointName, true); // true = start interactive mode
  };
  
  // Show the endpoints command help
  commands.endpoints();
}

// This function handles the actual WebSocket connection with proper authentication
function connectWithAuth(endpointType, isInteractive = true) {
  // Use the provided endpoint type or the global one
  const currentWsType = endpointType || wsType;

  const wsUrl = wsUrls[currentWsType];
  if (!wsUrl) {
    console.error(chalk.red(`Error: Unknown WebSocket type: ${currentWsType}`));
    console.error(chalk.yellow(`Available types: ${Object.keys(wsUrls).join(', ')}`));
    
    if (isInteractive) {
      return null;
    } else {
      process.exit(1);
    }
  }

  // Add protocol and host
  const protocol = options.secure ? 'wss://' : 'ws://';
  const host = options.host;
  const port = options.port;
  
  // Don't include port for production URLs (degenduel.me) as they use standard ports
  const fullUrl = host.includes('degenduel.me') 
    ? `${protocol}${host}${wsUrl}`
    : `${protocol}${host}:${port}${wsUrl}`;

  log(`Full URL: ${fullUrl}`, 'info');

  // Handle authentication method based on the user's selection
  // Create the final URL with appropriate authentication parameters
  let urlWithToken = fullUrl;
  let useAuthHeader = false;
  let useAuthCookie = false;
  
  // Set to 'false' to enable all authentication methods
  if (false) {
    log(`${currentWsType} WebSocket treated as not requiring authentication during testing`, 'info');
  } else {
    switch(options.authMethod) {
      case 'query':
        // Token as query parameter only
        if (options.auth) {
          urlWithToken = `${fullUrl}?token=${options.auth}`;
          log(`Using query parameter authentication`, 'info');
        }
        break;
      
      case 'header':
        // Token as Authorization header only
        useAuthHeader = true;
        log(`Using Authorization header authentication`, 'info');
        break;
      
      case 'cookie':
        // Token as Cookie only
        useAuthCookie = true;
        log(`Using Cookie authentication`, 'info');
        break;
      
      case 'all':
      default:
        // Use all authentication methods
        if (options.auth) {
          urlWithToken = `${fullUrl}?token=${options.auth}`;
        }
        useAuthHeader = true;
        useAuthCookie = true;
        log(`Using all authentication methods (query + header + cookie)`, 'info');
        break;
    }
  }

  log(`URL with token: ${urlWithToken}`, 'info');

  // Add channel as query parameter, if provided
  const finalUrl = options.channel 
    ? (urlWithToken.includes('?') ? `${urlWithToken}&channel=${options.channel}` : `${urlWithToken}?channel=${options.channel}`)
    : urlWithToken;

  // Create WebSocket connection
  console.log(chalk.yellow(`Connecting to ${finalUrl}...`));

  // Prepare headers based on selected authentication methods
  const headers = {};

  // Add Authorization header if selected
  if (useAuthHeader && options.auth) {
    headers['Authorization'] = `Bearer ${options.auth}`;
    log(`Added Authorization header`, 'info');
  }

  // Add Cookie header if selected
  if (useAuthCookie) {
    if (options.auth) {
      headers['Cookie'] = `session=${options.auth}`;
    } else if (mySessionCookie) {
      headers['Cookie'] = `session=${mySessionCookie}`;
    }
    log(`Added Cookie header`, 'info');
  }

  // CRITICAL: Explicitly remove Sec-WebSocket-Extensions to prevent compression
  // This is a new diagnostic approach to see if it makes any difference
  headers['Sec-WebSocket-Extensions'] = '';
  log(`${chalk.bold('IMPORTANT:')} Added empty Sec-WebSocket-Extensions header to prevent compression`, 'info');

  // Create WebSocket with appropriate headers
  // Deliberately NOT configuring compression since it's causing issues
  global.ws = new WebSocket(finalUrl, {
    headers: headers,
    // EXPLICITLY DISABLE COMPRESSION: 
    // This is critical for preventing 1006 errors
    perMessageDeflate: false,
    // Other options that might be needed
    followRedirects: true,
    // Add debug listeners for protocol negotiation
    skipUTF8Validation: false // Enable UTF-8 validation for safer connections
  });

  // Log the authentication methods being used
  log(`Authentication configuration:
    - Query parameter: ${urlWithToken.includes('?token=') ? 'Yes' : 'No'}
    - Authorization header: ${headers['Authorization'] ? 'Yes' : 'No'}
    - Cookie header: ${headers['Cookie'] ? 'Yes' : 'No'}
  `, 'info');
  
  // ENHANCEMENT: Log WebSocket compression settings
  log(`WebSocket compression settings:
    - perMessageDeflate: ${chalk.red('DISABLED')}
    - Empty Sec-WebSocket-Extensions header: ${chalk.green('YES')}
  `, 'info');

  // Event handlers
  global.ws.on('open', () => {
    connectionStatus.connected = true;
    connectionStatus.startTime = Date.now();
    log(`Connected to ${currentWsType} WebSocket`, 'success');
    
    // Send initial message if provided
    if (options.message) {
      try {
        const message = JSON.parse(options.message);
        sendMessage(message);
      } catch (e) {
        log(`Invalid JSON: ${options.message}`, 'error');
      }
    } else {
      log(`No initial message provided, sending ping/heartbeat`, 'info');
      
      // Send a heartbeat/ping message to check server response
      try {
        const pingMessage = {
          type: currentWsType === 'test' ? 'ping' : 'heartbeat',
          timestamp: new Date().toISOString()
        };
        sendMessage(pingMessage);
      } catch (e) {
        log(`Error sending ping: ${e.message}`, 'error');
      }
    }
    
    // Start command prompt
    rl.prompt();
  });

  global.ws.on('message', (data) => {
    log(`Received message: ${data}`, 'recv');
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

  global.ws.on('close', (code, reason) => {
    connectionStatus.connected = false;
    log(`Connection closed: Code ${code} - ${reason}`, 'warn');
    
    // Enhance error reporting for specific close codes
    if (code === 1006) {
      log(`${chalk.red('ABNORMAL CLOSURE (1006)')} - This typically indicates a WebSocket protocol error`, 'error');
      log(`Common causes for code 1006 include:`, 'info');
      log(`1. ${chalk.yellow('Compression mismatch')}: Server using compression, client not configured for it`, 'info');
      log(`2. ${chalk.yellow('RSV bit issues')}: First byte of a frame has RSV1/RSV2/RSV3 bits set unexpectedly`, 'info');
      log(`3. ${chalk.yellow('Network issues')}: Connection dropped without a proper close frame`, 'info');
      log(`4. ${chalk.yellow('NGINX configuration')}: WebSocket proxy settings might be incorrect`, 'info');
      log(`Try running the "diagnose" command for a more detailed analysis`, 'info');
    } else if (code === 1002) {
      log(`${chalk.red('PROTOCOL ERROR (1002)')} - WebSocket protocol violation detected`, 'error');
    } else if (code === 1007) {
      log(`${chalk.red('INVALID FRAME PAYLOAD (1007)')} - The received data is not of the expected format`, 'error');
    } else if (code === 1009) {
      log(`${chalk.red('MESSAGE TOO BIG (1009)')} - Received a frame that exceeds message size limit`, 'error');
    } else if (code === 1010) {
      log(`${chalk.red('MANDATORY EXTENSION (1010)')} - Server rejected an extension required by the client`, 'error');
    } else if (code === 1011) {
      log(`${chalk.red('INTERNAL ERROR (1011)')} - Server encountered an unexpected condition`, 'error');
    }
    
    if (isInteractive) {
      process.exit(0);
    }
  });

  global.ws.on('error', (error) => {
    connectionStatus.errorCount++;
    
    // Enhanced error logging
    if (error.message.includes('RSV1')) {
      log(`${chalk.red('COMPRESSION ERROR:')} ${error.message}`, 'error');
      log(`This likely means the server is using compression but the client isn't configured properly.`, 'error');
      log(`To fix this, ensure:`, 'info');
      log(`1. ${chalk.yellow('Server disables compression')}: perMessageDeflate: false in ws.Server options`, 'info');
      log(`2. ${chalk.yellow('Sec-WebSocket-Extensions removal')}: Delete this header during connection`, 'info');
      log(`3. ${chalk.yellow('Client configuration')}: Set perMessageDeflate: false in WebSocket client`, 'info');
      log(`Try running the "diagnose" command for a more detailed analysis`, 'info');
    } else if (error.message.includes('SSL') || error.message.includes('TLS')) {
      log(`${chalk.red('SSL/TLS ERROR:')} ${error.message}`, 'error');
      log(`This likely means there's an issue with the SSL/TLS handshake.`, 'error');
    } else {
      log(`${chalk.red('WEBSOCKET ERROR:')} ${error.message}`, 'error');
    }
    
    rl.prompt();
  });

  // NEW: Add more specialized event listeners for deep diagnostics
  global.ws.on('unexpected-response', (req, res) => {
    log(`${chalk.red('UNEXPECTED RESPONSE:')} HTTP ${res.statusCode}`, 'error');
    log(`Headers: ${JSON.stringify(res.headers)}`, 'error');
    
    // Check for specific issues
    if (res.headers['sec-websocket-extensions']) {
      log(`${chalk.red('CRITICAL ERROR:')} Server responded with extensions despite client not requesting them!`, 'error');
      log(`This confirms a WebSocket extension/compression mismatch`, 'error');
    }
    
    connectionStatus.errorCount++;
  });
  
  // Track raw socket data for debugging compression issues
  if (DIAGNOSTICS.RAW_PACKET_INSPECTION && global.ws._socket) {
    global.ws._socket.on('data', (data) => {
      try {
        // Only inspect the first few bytes of each frame
        if (data.length >= 2) {
          const firstByte = data[0];
          // Extract RSV bits (bits 4-6)
          const rsv1 = !!(firstByte & 0x40);
          const rsv2 = !!(firstByte & 0x20);
          const rsv3 = !!(firstByte & 0x10);
          
          if (rsv1 || rsv2 || rsv3) {
            log(`${chalk.red('RSV BITS SET IN FRAME:')} RSV1=${rsv1}, RSV2=${rsv2}, RSV3=${rsv3}`, 'error');
            log(`RSV1=true indicates compression is being used despite being disabled`, 'error');
          }
        }
      } catch (e) {
        // Ignore errors in diagnostic code
      }
    });
  }

  // Send a message to the server
  function sendMessage(message) {
    if (global.ws.readyState !== WebSocket.OPEN) {
      log('Not connected', 'error');
      return;
    }
    
    const messageStr = typeof message === 'string' 
      ? message 
      : JSON.stringify(message);
    
    global.ws.send(messageStr);
    log(`Sent: ${messageStr}`, 'send');
  }

  // Make sendMessage available globally
  global.sendMessage = sendMessage;
  return global.ws;
}

// Get authentication token helper function
async function getToken() {
  try {
    log(`Fetching token from: ${myAuthTokenGenerationURL}`, 'info');
    const response = await fetch(`${myAuthTokenGenerationURL}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `session=${mySessionCookie}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    log(`Token successfully obtained with expiry in ${data.expiresIn} seconds`, 'success');
    return data.token;
  } catch (error) {
    log(`Failed to get auth token: ${error.message}`, 'error');
    return null;
  }
}

// ====== End of function declarations ======

// If no token provided, try to get one automatically before connecting
if (!options.auth && mySessionCookie) {
  log(`No token provided, attempting to get one automatically using session cookie...`, 'info');
  
  // Make the function call immediately using IIFE (Immediately Invoked Function Expression)
  (async () => {
    try {
      const newToken = await getToken();
      if (newToken) {
        log(`Successfully obtained new token automatically!`, 'success');
        options.auth = newToken;
        
        // Continue with connection after getting token
        if (wsType === 'all') {
          await testAllEndpoints(endpointsToTest);
        } else {
          connectWithAuth(wsType);
        }
      } else {
        log(`Failed to get token automatically. Continuing without authentication...`, 'warn');
        if (wsType === 'all') {
          await testAllEndpoints(endpointsToTest);
        } else {
          connectWithAuth(wsType);
        }
      }
    } catch (error) {
      log(`Error getting token: ${error.message}. Continuing without authentication...`, 'error');
      if (wsType === 'all') {
        await testAllEndpoints(endpointsToTest);
      } else {
        connectWithAuth(wsType);
      }
    }
  })();
} else {
  // Already have token or don't want to authenticate, continue immediately
  if (wsType === 'all') {
    // Test all endpoints
    testAllEndpoints(endpointsToTest);
  } else {
    // Test a single endpoint
    connectWithAuth(wsType);
  }
}

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
    console.log(chalk.cyan('  raw') + '              Toggle raw message display');
    
    // Only show these commands if we've tested all endpoints or they're defined
    if (Object.keys(endpointResults).length > 0 || commands.endpoints) {
      console.log(chalk.cyan('  endpoints') + '         List all tested endpoints and their status');
      console.log(chalk.cyan('  connect <endpoint>') + ' Connect to a specific endpoint');
    }
    
    console.log(chalk.yellow('\nAuthentication Options:'));
    console.log('  Authentication methods supported:');
    console.log('    - Query parameter: ?token=YOUR_TOKEN');
    console.log('    - Authorization header: Authorization: Bearer YOUR_TOKEN');
    console.log('    - Cookie: Cookie: session=YOUR_TOKEN');
    console.log('\n  Use the --auth-method option to specify which method to test:');
    console.log('    --auth-method query   : Use query parameter only');
    console.log('    --auth-method header  : Use Authorization header only');
    console.log('    --auth-method cookie  : Use Cookie header only');
    console.log('    --auth-method all     : Use all methods (default)');
    
    console.log(chalk.yellow('\nTesting All Endpoints:'));
    console.log('  Use the "all" websocket type to test all endpoints:');
    console.log('    node websocket/v69/test-client.js all');
    console.log('  This will test connections to all WebSocket endpoints and report which ones work');
    
    rl.prompt();
  },
  
  // Other commands to be implemented later
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
    log(`Error formatting message: ${e.message}`, 'error');
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

// No need for redundant code here as it's been moved to connectWithAuth function
// We'll create a placeholder for the WebSocket connection
let ws;

// Initialize web socket commands
function sendMessage(message) {
  if (!global.sendMessage) {
    log('WebSocket connection not ready yet', 'error');
    return;
  }
  global.sendMessage(message);
}

// Implement additional user commands
commands.quit = () => {
  log('Closing connection...', 'info');
  if (global.ws && global.ws.readyState === WebSocket.OPEN) {
    global.ws.close();
  }
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
  if (global.ws && global.ws.readyState === WebSocket.OPEN) {
    global.ws.close();
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
  // Wait for the WebSocket to be connected before running tests
  const checkWSReady = setInterval(() => {
    if (global.ws && global.ws.readyState === WebSocket.OPEN) {
      clearInterval(checkWSReady);
      runTestSuite();
    }
  }, 100);
}

// Manual token generation instructions (in case auto-fetch fails)
log(`In case automatic token fetching fails, you can manually get a token with:`, 'info');
log(`curl -v --cookie "session=${mySessionCookie}" ${myAuthTokenGenerationURL}`, 'info');

// Add new diagnostic function (removing the duplicate import since we now have http at the top)
/**
 * Helper function to diagnose WebSocket connection issues
 * Specifically focusing on compression and extension negotiation
 */
async function diagnoseConnection(endpoint) {
  log(`\n${chalk.bold.magenta('====== WEBSOCKET CONNECTION DIAGNOSTICS ======')}`, 'info');
  log(`Testing connection to: ${endpoint}`, 'info');
  
  // Step 1: Check raw HTTP request/response headers for WebSocket handshake
  log(`${chalk.cyan('STEP 1:')} Examining WebSocket handshake headers`, 'info');
  
  // Parse the URL
  const urlObj = new URL(endpoint.startsWith('ws') ? endpoint : `ws://${options.host}:${options.port}${wsUrls[endpoint]}`);
  const host = urlObj.host;
  const path = urlObj.pathname + urlObj.search;
  
  log(`Making diagnostic HTTP request to ${host}${path}`, 'info');
  
  // Create raw HTTP request to inspect headers
  const diagnosticReq = http.request({
    host: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'wss:' ? 443 : 80),
    path: path,
    method: 'GET',
    headers: {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', // Example key
      'Sec-WebSocket-Version': '13',
      // We explicitly test with and without the extensions header
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits'
    }
  });
  
  // Track the response
  diagnosticReq.on('response', (res) => {
    log(`${chalk.red('ERROR:')} Server rejected WebSocket upgrade with status ${res.statusCode}`, 'error');
    log(`Response headers: ${JSON.stringify(res.headers, null, 2)}`, 'info');
  });
  
  diagnosticReq.on('upgrade', (res, socket, upgradeHead) => {
    log(`${chalk.green('SUCCESS:')} Server accepted WebSocket upgrade`, 'success');
    
    if (DIAGNOSTICS.VERBOSE_HEADERS) {
      log(`Response headers: ${JSON.stringify(res.headers, null, 2)}`, 'info');
      
      // Check specifically for the Sec-WebSocket-Extensions header
      if (res.headers['sec-websocket-extensions']) {
        log(`${chalk.yellow('IMPORTANT:')} Server responded with extensions: ${res.headers['sec-websocket-extensions']}`, 'warn');
        log(`This indicates the server is negotiating compression, which might cause "RSV1 must be clear" errors`, 'warn');
      } else {
        log(`${chalk.green('GOOD:')} Server did not include extensions header in response`, 'success');
      }
    }
    
    // Close the socket since this is just a diagnostic
    socket.end();
  });
  
  diagnosticReq.on('error', (err) => {
    log(`${chalk.red('ERROR:')} HTTP request failed: ${err.message}`, 'error');
  });
  
  // End the request
  diagnosticReq.end();
  
  // Step 2: Now do a proper WebSocket connection with better diagnostics
  log(`\n${chalk.cyan('STEP 2:')} Testing actual WebSocket connection`, 'info');
  
  // Try connecting with explicit WebSocket settings
  const testWebSocket = (useCompression, debugName) => {
    return new Promise((resolve) => {
      const wsOptions = {
        headers: {
          'User-Agent': `DegenDuel-Diagnostics/${debugName}`,
          // Add other headers as needed
        },
        perMessageDeflate: useCompression,
      };
      
      log(`${chalk.yellow('TEST:')} Connecting with perMessageDeflate=${useCompression} (${debugName})`, 'info');
      
      // Begin a temporary WebSocket connection
      const tempWs = new WebSocket(endpoint, wsOptions);
      let testStatus = 'unknown';
      
      tempWs.on('open', () => {
        testStatus = 'success';
        log(`${chalk.green('SUCCESS:')} Connected with ${debugName}`, 'success');
        
        // Send a simple message to test the connection
        try {
          tempWs.send(JSON.stringify({
            type: 'diagnostic_test',
            compression: useCompression,
            timestamp: new Date().toISOString()
          }));
          
          // Close after short delay
          setTimeout(() => {
            tempWs.close(1000, 'Diagnostic complete');
            resolve({ status: testStatus, compression: useCompression });
          }, 1000);
        } catch (e) {
          log(`${chalk.red('ERROR:')} Failed to send test message: ${e.message}`, 'error');
          testStatus = 'message_error';
          tempWs.close();
          resolve({ status: testStatus, compression: useCompression, error: e.message });
        }
      });
      
      tempWs.on('error', (err) => {
        testStatus = 'error';
        // Enhanced error reporting for compression issues
        if (err.message.includes('RSV1')) {
          log(`${chalk.red('COMPRESSION ERROR:')} ${err.message}`, 'error');
          log(`This confirms there's a mismatch between client and server compression settings.`, 'error');
          log(`The server is likely sending compressed frames when the client expects uncompressed frames.`, 'error');
        } else {
          log(`${chalk.red('ERROR:')} ${debugName} - ${err.message}`, 'error');
        }
        
        // Don't wait for timeout on error
        tempWs.close();
        resolve({ status: testStatus, compression: useCompression, error: err.message });
      });
      
      tempWs.on('close', (code, reason) => {
        if (testStatus === 'unknown') {
          testStatus = code === 1000 ? 'success' : 'closed';
          
          if (code === 1006) {
            log(`${chalk.red('ERROR:')} ${debugName} - Abnormal closure (1006): ${reason}`, 'error');
            log(`Code 1006 typically indicates a websocket protocol error - often related to compression.`, 'error');
          } else {
            log(`${chalk.yellow('CLOSED:')} ${debugName} - Code: ${code}, Reason: ${reason}`, 'warn');
          }
          
          resolve({ status: testStatus, compression: useCompression, code, reason });
        }
      });
      
      tempWs.on('message', (data) => {
        log(`${chalk.magenta('MESSAGE:')} ${debugName} - ${data}`, 'recv');
      });
      
      // Set timeout to prevent hanging
      setTimeout(() => {
        if (testStatus === 'unknown') {
          testStatus = 'timeout';
          log(`${chalk.yellow('TIMEOUT:')} ${debugName} - Connection test timed out`, 'warn');
          tempWs.close();
          resolve({ status: testStatus, compression: useCompression });
        }
      }, 5000);
    });
  };
  
  // Test both with and without compression to see which works
  const results = [];
  results.push(await testWebSocket(false, 'No Compression'));
  // Add a delay between tests
  await new Promise(resolve => setTimeout(resolve, 1000));
  results.push(await testWebSocket(true, 'With Compression'));
  
  // Analyze and show results
  log(`\n${chalk.cyan('RESULTS:')} WebSocket Connection Tests`, 'info');
  for (const result of results) {
    const statusColor = result.status === 'success' ? chalk.green : 
                        result.status === 'error' ? chalk.red : chalk.yellow;
    log(`${statusColor(`${result.status.toUpperCase()}`)} - Compression: ${result.compression ? 'ON' : 'OFF'}${result.error ? ` - Error: ${result.error}` : ''}`, 'info');
  }
  
  // Provide recommendations
  log(`\n${chalk.cyan('RECOMMENDATIONS:')}`, 'info');
  
  const noCompression = results.find(r => !r.compression);
  const withCompression = results.find(r => r.compression);
  
  if (noCompression?.status === 'success' && withCompression?.status !== 'success') {
    log(`${chalk.green('✓')} Use WebSocket WITHOUT compression (working)`, 'success');
    log(`❌ WebSocket WITH compression is not working`, 'error');
    log(`Ensure your server properly disables compression by removing the extensions header`, 'info');
  } else if (withCompression?.status === 'success' && noCompression?.status !== 'success') {
    log(`❌ WebSocket WITHOUT compression is not working`, 'error');
    log(`${chalk.green('✓')} Use WebSocket WITH compression (working)`, 'success');
    log(`Ensure both client and server consistently use compression`, 'info');
  } else if (noCompression?.status === 'success' && withCompression?.status === 'success') {
    log(`${chalk.green('✓')} Both connection modes are working!`, 'success');
    log(`For maximum compatibility, recommend using WebSocket WITHOUT compression`, 'info');
  } else {
    log(`❌ Both connection modes failed`, 'error');
    log(`Try inspecting server logs to diagnose further issues`, 'info');
    log(`Common issues might be: NGINX configuration, network issues, server errors`, 'info');
  }
  
  log(`\n${chalk.bold.magenta('====== END OF DIAGNOSTICS ======')}`, 'info');
  
  // Return results for further analysis
  return results;
}

// Add new command to diagnose WebSocket connection
commands.diagnose = async (endpointName) => {
  const targetEndpoint = endpointName || wsType;
  if (!targetEndpoint) {
    log('Endpoint name is required', 'error');
    return;
  }
  
  let endpoint;
  if (wsUrls[targetEndpoint]) {
    // Build the full WebSocket URL
    const protocol = options.secure ? 'wss://' : 'ws://';
    const host = options.host;
    const port = options.port;
    
    // Don't include port for production URLs (degenduel.me) as they use standard ports
    endpoint = host.includes('degenduel.me') 
      ? `${protocol}${host}${wsUrls[targetEndpoint]}`
      : `${protocol}${host}:${port}${wsUrls[targetEndpoint]}`;
  } else if (targetEndpoint.startsWith('ws://') || targetEndpoint.startsWith('wss://')) {
    // Already a full URL
    endpoint = targetEndpoint;
  } else {
    log(`Unknown endpoint: ${targetEndpoint}. Available endpoints: ${Object.keys(wsUrls).join(', ')}`, 'error');
    return;
  }
  
  log(`Running diagnostics on ${endpoint}...`, 'info');
  await diagnoseConnection(endpoint);
  rl.prompt();
  
  // Special new diagnostic: Compare NGINX vs. direct
  log('\n=== ADVANCED DIAGNOSTICS ===', 'info');
  log('Would you like to run a direct vs. NGINX comparison?', 'info');
  log('This will help determine if NGINX is causing WebSocket issues.', 'info');
  
  const comparePrompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  comparePrompt.question('Run comparison? (y/n): ', async (answer) => {
    if (answer.toLowerCase() === 'y') {
      await compareDirectVsNginx(endpoint);
    }
    comparePrompt.close();
  });
};

/**
 * Compare direct server connection vs. through NGINX
 * This helps identify if NGINX is adding WebSocket compression
 */
async function compareDirectVsNginx(publicUrl) {
  try {
    log(`\n${chalk.bold.cyan('DIRECT VS. NGINX COMPARISON')}`, 'info');
    log('This will connect to your server both through NGINX and directly', 'info');
    log('to identify if NGINX is responsible for compression issues.', 'info');
    
    // Parse the public URL
    const url = new URL(publicUrl);
    
    // Determine direct connection params
    let directHost = '127.0.0.1'; // default local
    let directPort = 3004; // default v69 port
    let pathWithQuery = url.pathname + url.search;
    
    // Prompt for direct server connection details
    const directPrompt = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    // Get direct server information
    directPrompt.question(`Enter direct server IP (default: ${directHost}): `, (ip) => {
      if (ip) directHost = ip;
      
      directPrompt.question(`Enter direct server port (default: ${directPort}): `, async (port) => {
        if (port) directPort = parseInt(port, 10);
        directPrompt.close();
        
        // Build URLs for comparison
        const directWsProtocol = 'ws://'; // Direct connections typically use unencrypted
        const directUrl = `${directWsProtocol}${directHost}:${directPort}${pathWithQuery}`;
        
        log(`\nComparing:`, 'info');
        log(`Through NGINX: ${publicUrl}`, 'info');
        log(`Direct to server: ${directUrl}`, 'info');
        
        // Test NGINX connection
        log(`\n${chalk.bold.magenta('TESTING NGINX CONNECTION')}`, 'info');
        const nginxResult = await testWebSocketHandshake(publicUrl);
        
        // Test direct connection
        log(`\n${chalk.bold.magenta('TESTING DIRECT CONNECTION')}`, 'info');
        const directResult = await testWebSocketHandshake(directUrl);
        
        // Compare and analyze
        log(`\n${chalk.bold.cyan('COMPARISON RESULTS')}`, 'info');
        
        if (nginxResult.error && !directResult.error) {
          log(`${chalk.bold.red('✗')} NGINX connection failed but direct connection worked!`, 'error');
          log('This confirms NGINX is likely the source of the issue.', 'error');
        } else if (!nginxResult.error && !directResult.error) {
          // Both connections worked, check for compression differences
          if (nginxResult.hasCompression && !directResult.hasCompression) {
            log(`${chalk.bold.red('✗')} NGINX is adding compression but direct server isn't!`, 'error');
            log('This confirms NGINX is causing the compression mismatch.', 'error');
            log('Check your NGINX configuration for any websocket_compression settings.', 'info');
          } else if (nginxResult.hasCompression && directResult.hasCompression) {
            log(`${chalk.bold.yellow('⚠')} Both connections negotiate compression.`, 'warn');
            log('The server itself is enabling compression.', 'warn');
          } else if (!nginxResult.hasCompression && !directResult.hasCompression) {
            log(`${chalk.bold.green('✓')} Neither connection uses compression.`, 'success');
            log('The issue might be elsewhere in the protocol.', 'info');
          } else if (!nginxResult.hasCompression && directResult.hasCompression) {
            log(`${chalk.bold.yellow('⚠')} Unusual: NGINX removes compression added by server`, 'warn');
          }
        } else if (nginxResult.error && directResult.error) {
          log(`${chalk.bold.red('✗')} Both connections failed.`, 'error');
          log('Check that your server is running and WebSockets are enabled.', 'error');
        } else if (!nginxResult.error && directResult.error) {
          log(`${chalk.bold.yellow('⚠')} NGINX works but direct connection failed.`, 'warn');
          log('This suggests firewall or network issues with the direct connection.', 'warn');
        }
        
        // Recommendations
        log(`\n${chalk.bold.cyan('RECOMMENDATIONS')}`, 'info');
        if (nginxResult.hasCompression) {
          log('1. Add the following to your NGINX location block:', 'info');
          log(chalk.gray(`   location /api/v69/ {
     # Existing proxy settings...
     
     # Disable WebSocket compression
     proxy_set_header Sec-WebSocket-Extensions "";
   }`), 'code');
        }
        
        log('2. Verify your NGINX config has these WebSocket settings:', 'info');
        log(chalk.gray(`   # WebSocket support
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   
   # Important - don't buffer WebSockets
   proxy_buffering off;`), 'code');
        
        log('3. For maximum compatibility, consider using the TCP stream module:', 'info');
        log(chalk.gray(`   # In nginx.conf
   stream {
     server {
       listen 443 ssl;
       ssl_certificate /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;
       
       # Route WebSocket traffic directly to backend
       proxy_pass backend_server:3004;
     }
   }`), 'code');
      });
    });
  } catch (err) {
    log(`Comparison error: ${err.message}`, 'error');
  }
}

/**
 * Test a WebSocket handshake at the HTTP level
 * @param {string} url - WebSocket URL to test
 * @returns {Object} - Test results with compression info
 */
async function testWebSocketHandshake(url) {
  return new Promise((resolve) => {
    try {
      // Generate WebSocket key
      const wsKey = Buffer.from(Math.random().toString(36).substring(2, 12)).toString('base64');
      
      // Parse URL
      const urlObj = new URL(url);
      const isSecure = urlObj.protocol === 'wss:';
      const httpProtocol = isSecure ? 'https:' : 'http:';
      const httpUrl = `${httpProtocol}//${urlObj.host}${urlObj.pathname}${urlObj.search}`;
      
      log(`Testing handshake for: ${url}`, 'info');
      
      // Make an HTTP request with WebSocket upgrade headers
      const requestOptions = {
        method: 'GET',
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Key': wsKey,
          'Sec-WebSocket-Version': '13'
        }
      };
      
      fetch(httpUrl, requestOptions).then(response => {
        // This will typically fail with a 426 (Upgrade Required) error,
        // but we can still check the headers
        log(`Response status: ${response.status}`, 'info');
        
        const headers = {};
        response.headers.forEach((value, name) => {
          headers[name.toLowerCase()] = value;
          log(`${name}: ${value}`, 'info');
        });
        
        const hasUpgrade = headers['upgrade'] === 'websocket';
        const hasCompression = headers['sec-websocket-extensions']?.includes('permessage-deflate');
        
        if (hasUpgrade) {
          log(`${chalk.green('✓')} WebSocket upgrade supported`, 'success');
        } else {
          log(`${chalk.red('✗')} WebSocket upgrade not supported`, 'error');
        }
        
        if (hasCompression) {
          log(`${chalk.yellow('⚠')} WebSocket compression enabled: ${headers['sec-websocket-extensions']}`, 'warn');
        } else {
          log(`${chalk.green('✓')} WebSocket compression not enabled`, 'success');
        }
        
        resolve({
          success: hasUpgrade,
          hasCompression: hasCompression,
          headers: headers
        });
      }).catch(err => {
        log(`Fetch error: ${err.message}`, 'error');
        resolve({
          success: false,
          error: err.message
        });
      });
    } catch (err) {
      log(`Test error: ${err.message}`, 'error');
      resolve({
        success: false,
        error: err.message
      });
    }
  });
}