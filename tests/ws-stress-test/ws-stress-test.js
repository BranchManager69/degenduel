/**
 * WebSocket Stress Testing Tool
 * 
 * This script creates multiple WebSocket connections in parallel,
 * performs various operations, and disconnects in patterns designed
 * to stress test the WebSocket server and potentially reproduce
 * the clientInfo missing issue.
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Import config for JWT secret
const config = require('../config/config');

// Connection settings
const WS_URL = process.env.NODE_ENV === 'production' 
  ? 'wss://degenduel.me/api/v69/ws'
  : 'ws://localhost:3005/api/v69/ws';

// Topics to subscribe to
const PUBLIC_TOPICS = ['MARKET_DATA', 'SYSTEM', 'TOKEN_DATA'];
const RESTRICTED_TOPICS = ['PORTFOLIO', 'USER', 'WALLET'];
const ADMIN_TOPICS = ['ADMIN'];

// Test parameters (can be adjusted via command line args)
const DEFAULT_CONFIG = {
  connections: 50,        // Number of concurrent connections to maintain
  duration: 60,           // Test duration in seconds
  connectRate: 5,         // New connections per second
  disconnectRate: 5,      // Disconnections per second
  subscribeRate: 10,      // Subscription operations per second
  authRate: 3,            // Authentication operations per second
  chaosMode: false,       // Random unpredictable behavior
  logLevel: 'info',       // 'debug', 'info', 'warn', 'error'
  logToFile: true,        // Whether to log to a file
  authPercent: 30,        // Percent of connections that will authenticate
  forceRefresh: false,    // Whether to force page "refreshes" (reconnection of same clientId)
  refreshRate: 2          // "Page refreshes" per second when forceRefresh is true
};

// Parse command line arguments
const args = process.argv.slice(2);
const config = { ...DEFAULT_CONFIG };

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const paramName = arg.slice(2);
    const paramValue = args[i + 1];
    
    if (paramName in config) {
      // Convert numeric values
      if (typeof DEFAULT_CONFIG[paramName] === 'number') {
        config[paramName] = Number(paramValue);
      } 
      // Convert boolean values
      else if (typeof DEFAULT_CONFIG[paramName] === 'boolean') {
        config[paramName] = paramValue.toLowerCase() === 'true';
      }
      // Otherwise keep as string
      else {
        config[paramName] = paramValue;
      }
      i++; // Skip the value in next iteration
    }
  }
}

// Setup logging
const logLevels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLogLevel = logLevels[config.logLevel] || 0;

// Create log directory if it doesn't exist
const logDir = path.join(__dirname, '../logs/stress-tests');
if (config.logToFile && !fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Create a log file with timestamp
const logFile = config.logToFile 
  ? path.join(logDir, `ws-stress-${new Date().toISOString().replace(/[:.]/g, '-')}.log`) 
  : null;

if (logFile) {
  fs.writeFileSync(logFile, `WebSocket Stress Test Started: ${new Date().toISOString()}\n`);
  fs.appendFileSync(logFile, `Configuration: ${JSON.stringify(config, null, 2)}\n\n`);
}

function log(level, message, data = null) {
  if (logLevels[level] >= currentLogLevel) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (data) {
      console.log(logMessage, data);
      if (logFile) {
        fs.appendFileSync(logFile, `${logMessage} ${JSON.stringify(data)}\n`);
      }
    } else {
      console.log(logMessage);
      if (logFile) {
        fs.appendFileSync(logFile, `${logMessage}\n`);
      }
    }
  }
}

// Client connection tracker
const clients = new Map();
let totalConnections = 0;
let successfulConnections = 0;
let failedConnections = 0;
let messagesReceived = 0;
let messagesSent = 0;
let subscriptions = 0;
let authentications = 0;
let errors = 0;
let clientIdCounter = 0;

// Generate a test JWT token for auth testing
function generateTestToken(walletAddress = '11111111111111111111111111111111', role = 'USER') {
  const payload = {
    wallet_address: walletAddress,
    role: role,
    session_id: `stress-test-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
  };
  
  return jwt.sign(payload, config.jwt.secret);
}

// Create a new connection
function createConnection() {
  const clientId = `client-${++clientIdCounter}`;
  
  try {
    log('debug', `Creating connection ${clientId}`);
    
    const ws = new WebSocket(WS_URL, ['v69-protocol', 'april-is-here']);
    
    const client = {
      id: clientId,
      ws: ws,
      isConnected: false,
      isAuthenticated: false,
      subscribedTopics: new Set(),
      connectedAt: null,
      disconnectedAt: null,
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0
    };
    
    clients.set(clientId, client);
    
    // Setup event handlers
    ws.on('open', () => {
      client.isConnected = true;
      client.connectedAt = new Date();
      successfulConnections++;
      
      log('info', `Connected: ${clientId}`);
      
      // Maybe authenticate immediately (based on authPercent)
      if (Math.random() * 100 < config.authPercent) {
        setTimeout(() => {
          if (client.isConnected && !client.isAuthenticated) {
            authenticate(clientId);
          }
        }, Math.random() * 1000); // Authenticate within 1 second
      }
      
      // Subscribe to some public topics
      const topicsToSubscribe = PUBLIC_TOPICS.filter(() => Math.random() > 0.5);
      if (topicsToSubscribe.length > 0) {
        subscribe(clientId, topicsToSubscribe);
      }
    });
    
    ws.on('message', (data) => {
      messagesReceived++;
      client.messagesReceived++;
      
      try {
        const message = JSON.parse(data);
        
        if (message.type === 'ERROR') {
          errors++;
          client.errors++;
          log('warn', `Error for ${clientId}:`, message);
          
          // Handle connection_state_invalid errors
          if (message.code === 4050 && message.reason === 'connection_state_invalid') {
            log('warn', `Connection state invalid for ${clientId}, reconnecting...`);
            disconnectClient(clientId);
            
            // Reconnect with same client ID to simulate a page refresh
            setTimeout(() => {
              if (!clients.has(clientId)) {
                createConnection(clientId);
              }
            }, 1000);
          }
        } else {
          log('debug', `Message received for ${clientId}:`, message);
        }
      } catch (err) {
        log('error', `Error parsing message for ${clientId}: ${err.message}`);
      }
    });
    
    ws.on('error', (error) => {
      errors++;
      client.errors++;
      log('error', `WebSocket error for ${clientId}: ${error.message}`);
    });
    
    ws.on('close', (code, reason) => {
      client.isConnected = false;
      client.disconnectedAt = new Date();
      log('info', `Disconnected: ${clientId}, code: ${code}, reason: ${reason}`);
      
      // Remove from clients map
      clients.delete(clientId);
    });
    
    return clientId;
  } catch (error) {
    failedConnections++;
    log('error', `Failed to create connection ${clientId}: ${error.message}`);
    return null;
  }
}

// Send a message through the WebSocket
function sendMessage(clientId, message) {
  const client = clients.get(clientId);
  if (!client || !client.isConnected) return false;
  
  try {
    const messageStr = JSON.stringify(message);
    client.ws.send(messageStr);
    messagesSent++;
    client.messagesSent++;
    log('debug', `Message sent for ${clientId}:`, message);
    return true;
  } catch (error) {
    errors++;
    client.errors++;
    log('error', `Error sending message for ${clientId}: ${error.message}`);
    return false;
  }
}

// Subscribe to topics
function subscribe(clientId, topics) {
  const client = clients.get(clientId);
  if (!client || !client.isConnected) return false;
  
  // Check if any topic requires authentication
  const needsAuth = topics.some(topic => 
    RESTRICTED_TOPICS.includes(topic) || ADMIN_TOPICS.includes(topic)
  );
  
  // If needs auth and not authenticated, either authenticate first or use only public topics
  if (needsAuth && !client.isAuthenticated) {
    if (Math.random() > 0.5) {
      // Try to auth first then subscribe
      authenticate(clientId, () => {
        subscribe(clientId, topics);
      });
      return true;
    } else {
      // Just use public topics for now
      topics = topics.filter(t => !RESTRICTED_TOPICS.includes(t) && !ADMIN_TOPICS.includes(t));
      if (topics.length === 0) return false;
    }
  }
  
  const success = sendMessage(clientId, {
    type: 'SUBSCRIBE',
    topics: topics
  });
  
  if (success) {
    subscriptions += topics.length;
    topics.forEach(topic => client.subscribedTopics.add(topic));
  }
  
  return success;
}

// Authenticate client
function authenticate(clientId, callback) {
  const client = clients.get(clientId);
  if (!client || !client.isConnected) return false;
  
  const token = generateTestToken();
  
  // Option 1: Subscribe with auth token
  const success = sendMessage(clientId, {
    type: 'SUBSCRIBE',
    topics: ['USER'], // Just pick one restricted topic
    authToken: token
  });
  
  if (success) {
    authentications++;
    client.isAuthenticated = true;
    client.subscribedTopics.add('USER');
    subscriptions++;
    
    if (callback) callback();
  }
  
  return success;
}

// Disconnect a client
function disconnectClient(clientId) {
  const client = clients.get(clientId);
  if (!client || !client.isConnected) return false;
  
  try {
    client.ws.close();
    log('debug', `Initiated close for ${clientId}`);
    return true;
  } catch (error) {
    log('error', `Error closing connection for ${clientId}: ${error.message}`);
    return false;
  }
}

// Random operations to simulate user behavior
function randomOperation() {
  // Pick a random client
  if (clients.size === 0) return;
  
  const clientIds = Array.from(clients.keys());
  const clientId = clientIds[Math.floor(Math.random() * clientIds.length)];
  const client = clients.get(clientId);
  
  if (!client || !client.isConnected) return;
  
  const operation = Math.random();
  
  // 40% chance: Subscribe to some topics
  if (operation < 0.4) {
    const allTopics = [...PUBLIC_TOPICS];
    
    // Add restricted topics if authenticated
    if (client.isAuthenticated) {
      allTopics.push(...RESTRICTED_TOPICS);
    }
    
    // Pick 1-3 random topics
    const count = 1 + Math.floor(Math.random() * 3);
    const topics = [];
    
    for (let i = 0; i < count; i++) {
      if (allTopics.length === 0) break;
      
      const index = Math.floor(Math.random() * allTopics.length);
      topics.push(allTopics[index]);
      allTopics.splice(index, 1);
    }
    
    if (topics.length > 0) {
      subscribe(clientId, topics);
    }
  }
  // 20% chance: Authenticate if not already authenticated
  else if (operation < 0.6 && !client.isAuthenticated) {
    authenticate(clientId);
  }
  // 15% chance: Disconnect
  else if (operation < 0.75) {
    disconnectClient(clientId);
  }
  // 5% chance in chaos mode: Send malformed message
  else if (operation < 0.8 && config.chaosMode) {
    sendMessage(clientId, {
      type: Math.random() > 0.5 ? 'INVALID_TYPE' : 'SUBSCRIBE',
      // Sometimes send invalid data structure
      [Math.random().toString(36).substring(7)]: Math.random().toString(36).substring(7)
    });
  }
  // 10%: Request data from a subscribed topic
  else if (operation < 0.9 && client.subscribedTopics.size > 0) {
    const topics = Array.from(client.subscribedTopics);
    const topic = topics[Math.floor(Math.random() * topics.length)];
    
    let action = 'getStatus'; // Default action that works for most topics
    
    // Topic-specific actions
    if (topic === 'MARKET_DATA') {
      action = Math.random() > 0.5 ? 'getToken' : 'getAllTokens';
    } else if (topic === 'USER') {
      action = 'getProfile';
    } else if (topic === 'WALLET') {
      action = 'getBalance';
    }
    
    sendMessage(clientId, {
      type: 'REQUEST',
      topic: topic,
      action: action,
      requestId: `req-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`
    });
  }
  // 10%: Do nothing (simulates idle user)
}

// Simulate page refreshes (reconnection with same client identity)
function simulatePageRefresh() {
  if (clients.size === 0) return;
  
  const clientIds = Array.from(clients.keys());
  const clientId = clientIds[Math.floor(Math.random() * clientIds.length)];
  
  log('info', `Simulating page refresh for ${clientId}`);
  
  // Save key client properties to simulate same user returning
  const client = clients.get(clientId);
  const wasAuthenticated = client.isAuthenticated;
  const topics = Array.from(client.subscribedTopics);
  
  // Disconnect the client
  disconnectClient(clientId);
  
  // Recreate the connection after a short delay (simulating page load)
  setTimeout(() => {
    const newClientId = createConnection();
    if (!newClientId) return;
    
    const newClient = clients.get(newClientId);
    
    // Re-authenticate if the client was authenticated before
    if (wasAuthenticated) {
      setTimeout(() => {
        if (newClient.isConnected && !newClient.isAuthenticated) {
          authenticate(newClientId, () => {
            // Re-subscribe to previous topics
            if (topics.length > 0) {
              subscribe(newClientId, topics);
            }
          });
        }
      }, 500);
    } 
    // Otherwise just resubscribe to public topics
    else if (topics.length > 0) {
      setTimeout(() => {
        if (newClient.isConnected) {
          subscribe(newClientId, topics.filter(t => PUBLIC_TOPICS.includes(t)));
        }
      }, 500);
    }
  }, 1000);
}

// Print test statistics
function printStats() {
  const runningTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const activeConnections = clients.size;
  
  const stats = {
    runningTime: `${runningTime}s / ${config.duration}s`,
    activeConnections,
    totalConnections,
    successfulConnections,
    failedConnections,
    messagesReceived,
    messagesSent,
    subscriptions,
    authentications,
    errors
  };
  
  log('info', 'STATS', stats);
  
  // Return some useful metrics
  return {
    connectionSuccessRate: (successfulConnections / totalConnections) * 100,
    errorRate: (errors / (messagesReceived + messagesSent)) * 100,
    activeConnectionsRatio: (activeConnections / config.connections) * 100
  };
}

// Main control loops
function scheduleConnectionCreation() {
  if (clients.size < config.connections) {
    // Create a batch of connections
    const connectionsToCreate = Math.min(
      config.connectRate,
      config.connections - clients.size
    );
    
    for (let i = 0; i < connectionsToCreate; i++) {
      totalConnections++;
      createConnection();
    }
  }
  
  // Schedule next batch
  setTimeout(scheduleConnectionCreation, 1000);
}

function scheduleDisconnections() {
  if (clients.size > 0) {
    // Disconnect a batch of clients
    const connectionsToDisconnect = Math.min(
      config.disconnectRate,
      clients.size
    );
    
    const clientIds = Array.from(clients.keys());
    
    for (let i = 0; i < connectionsToDisconnect; i++) {
      if (clientIds.length === 0) break;
      
      const index = Math.floor(Math.random() * clientIds.length);
      const clientId = clientIds[index];
      
      disconnectClient(clientId);
      clientIds.splice(index, 1);
    }
  }
  
  // Schedule next batch
  setTimeout(scheduleDisconnections, 1000);
}

function scheduleOperations() {
  // Calculate operations to perform
  const operationsPerSecond = config.subscribeRate + config.authRate;
  
  // Perform a batch of random operations
  for (let i = 0; i < operationsPerSecond; i++) {
    randomOperation();
  }
  
  // Schedule next batch
  setTimeout(scheduleOperations, 1000);
}

function scheduleRefreshes() {
  if (!config.forceRefresh || clients.size === 0) return;
  
  const refreshesPerSecond = Math.min(config.refreshRate, clients.size);
  
  for (let i = 0; i < refreshesPerSecond; i++) {
    simulatePageRefresh();
  }
  
  // Schedule next batch
  setTimeout(scheduleRefreshes, 1000);
}

// Start the test
log('info', `Starting WebSocket stress test with ${config.connections} connections for ${config.duration} seconds`);
log('info', `Connecting to: ${WS_URL}`);

const startTime = Date.now();

// Schedule periodic statistics
const statsInterval = setInterval(printStats, 5000);

// Start the control loops
scheduleConnectionCreation();
scheduleDisconnections();
scheduleOperations();

if (config.forceRefresh) {
  scheduleRefreshes();
}

// End the test after the specified duration
setTimeout(() => {
  // Print final stats
  const finalMetrics = printStats();
  log('info', 'FINAL METRICS', finalMetrics);
  
  // Stop the control loops
  clearInterval(statsInterval);
  
  // Disconnect all clients
  log('info', 'Test complete, disconnecting all clients');
  for (const clientId of clients.keys()) {
    disconnectClient(clientId);
  }
  
  // Allow some time for clean disconnection
  setTimeout(() => {
    log('info', `Test completed after ${config.duration} seconds`);
    process.exit(0);
  }, 3000);
}, config.duration * 1000);