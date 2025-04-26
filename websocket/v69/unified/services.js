// websocket/v69/unified/services.js

/**
 * Unified WebSocket Services
 * 
 * This module provides service functions for the unified WebSocket system:
 * - Terminal data fetching
 * - Service event registration
 * - Solana PubSub WebSocket proxying
 */

import prisma from '../../../config/prisma.js';
import serviceEvents from '../../../utils/service-suite/service-events.js';
import marketDataService from '../../../services/market-data/marketDataService.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors, wsColors } from '../../../utils/colors.js';
import config from '../../../config/config.js';
import WebSocket from 'ws';

// Solana PubSub subscription limits by tier
const SOLANA_SUBSCRIPTION_LIMITS = {
  PUBLIC: 5,      // Public tier (anonymous users): 5 accounts max
  USER: 10,       // User tier (authenticated users): 10 accounts max
  ADMIN: 1000,    // Admin/superadmin tier: 1000 accounts max
};

/**
 * Fetch terminal data from the database
 * @returns {Promise<Object>} Terminal data object
 */
export async function fetchTerminalData() {
  // Fetch all data in parallel
  const [tokenConfig, roadmap, stats, commands] = await Promise.all([
    prisma.token_config.findFirst(),
    prisma.roadmap_phases.findMany({
      include: { tasks: true },
      orderBy: [
        { year: 'asc' },
        { quarter_number: 'asc' }
      ]
    }),
    prisma.platform_stats.findFirst(),
    prisma.terminal_commands.findMany()
  ]);

  // Format roadmap data
  const formattedRoadmap = roadmap.map(phase => ({
    quarter: `Q${phase.quarter_number}`,
    year: phase.year.toString(),
    title: phase.title,
    details: phase.tasks.map(task => task.description)
  }));

  // Format commands into object
  const commandsObj = {};
  commands.forEach(cmd => {
    commandsObj[cmd.command] = {
      description: cmd.description,
      usage: cmd.usage || null,
      isAdmin: cmd.is_admin || false
    };
  });

  return {
    platformName: "DegenDuel",
    platformDescription: "High-stakes crypto trading competitions",
    platformStatus: await getSystemOperationalStatus(),
    features: await getPlatformFeatures(),
    systemStatus: await getSystemComponentStatus(),
    stats: {
      currentUsers: stats?.user_count || 0,
      upcomingContests: stats?.upcoming_contests || 0,
      totalPrizePool: `${stats?.total_prize_pool ? String(stats.total_prize_pool) : '0'}`,
      platformTraffic: "High",
      socialGrowth: "+5% this week",
      waitlistUsers: stats?.waitlist_count || 0
    },

    token: tokenConfig ? {
      symbol: tokenConfig.symbol,
      address: tokenConfig.address,
      totalSupply: Number(tokenConfig.total_supply),
      initialCirculating: Number(tokenConfig.initial_circulating),
      communityAllocation: `${tokenConfig.community_allocation_percent}%`,
      teamAllocation: `${tokenConfig.team_allocation_percent}%`,
      treasuryAllocation: `${tokenConfig.treasury_allocation_percent}%`,
      initialPrice: `$${Number(tokenConfig.initial_price).toFixed(2)}`,
      marketCap: `$${(Number(tokenConfig.initial_circulating) * Number(tokenConfig.initial_price)).toLocaleString()}`,
      liquidityLockPeriod: "2 years",
      networkType: "Solana",
      tokenType: "SPL",
      decimals: 9
    } : null,

    launch: tokenConfig ? {
      method: tokenConfig.launch_method,
      platforms: ["Raydium", "Orca"],
      privateSaleStatus: "Completed",
      publicSaleStatus: "Live",
      kycRequired: true,
      minPurchase: "100 USDC",
      maxPurchase: "5000 USDC"
    } : null,

    roadmap: formattedRoadmap,
    commands: commandsObj
  };
}

/**
 * Check overall system operational status
 * @returns {string} System status description
 */
async function getSystemOperationalStatus() {
  try {
    // Check service configurations for overall system health
    const serviceConfigs = await prisma.service_configuration.findMany({
      select: {
        service_name: true,
        enabled: true,
        last_status: true
      }
    });
    
    // Calculate overall system status based on critical services
    const criticalServices = serviceConfigs.filter(svc => 
      ['solanaService', 'marketDataService', 'contestWalletService'].includes(svc.service_name)
    );
    
    const failedCriticalServices = criticalServices.filter(svc => 
      svc.last_status === 'failure' || (svc.enabled && !svc.last_status)
    );
    
    if (failedCriticalServices.length > 0) {
      return "Degraded";
    }
    
    const totalServices = serviceConfigs.length;
    const failedServices = serviceConfigs.filter(svc => svc.last_status === 'failure').length;
    const percentageHealthy = 100 - (failedServices / totalServices * 100);
    
    if (percentageHealthy >= 95) return "Operational";
    if (percentageHealthy >= 80) return "Minor Issues";
    if (percentageHealthy >= 50) return "Degraded";
    return "Major Outage";
  } catch (error) {
    logApi.error(`Error checking system status: ${error.message}`, error);
    return "Operational"; // Default fallback
  }
}

/**
 * Get list of active platform features
 * @returns {Array<string>} List of platform features
 */
async function getPlatformFeatures() {
  try {
    // Try to get features from system_settings
    const featuresSetting = await prisma.system_settings.findUnique({
      where: { key: 'platform_features' }
    });
    
    if (featuresSetting && Array.isArray(featuresSetting.value)) {
      return featuresSetting.value;
    }
    
    // Default features if not found in database
    return ["Real-time trading", "Leaderboards", "Prize pools"];
  } catch (error) {
    logApi.error(`Error fetching platform features: ${error.message}`, error);
    return ["Real-time trading", "Leaderboards", "Prize pools"];
  }
}

/**
 * Get status of system components
 * @returns {Object} Status of each system component
 */
async function getSystemComponentStatus() {
  try {
    // Get service statuses
    const services = await prisma.service_configuration.findMany({
      select: {
        display_name: true,
        last_status: true,
        enabled: true
      }
    });
    
    // Format status for each service
    const componentStatus = {};
    
    // Add main API status
    componentStatus['API'] = "✅ Online";
    
    // Add Database status - check with a simple query
    try {
      await prisma.$queryRaw`SELECT 1`;
      componentStatus['Database'] = "✅ Online";
    } catch (dbError) {
      componentStatus['Database'] = "❌ Offline";
    }
    
    // Add WebSocket status - it's running if this code is executing
    componentStatus['WebSocket'] = "✅ Online";
    
    // Add status for each service
    services.forEach(service => {
      // Skip internal services that users don't need to see
      if (['loggerService', 'maintenanceService'].includes(service.display_name)) {
        return;
      }
      
      // Format the display name
      const displayName = service.display_name.replace('Service', '');
      
      if (!service.enabled) {
        componentStatus[displayName] = "⚠️ Disabled";
      } else if (service.last_status === 'success') {
        componentStatus[displayName] = "✅ Online";
      } else if (service.last_status === 'degraded') {
        componentStatus[displayName] = "⚠️ Degraded";
      } else if (service.last_status === 'failure') {
        componentStatus[displayName] = "❌ Error";
      } else {
        componentStatus[displayName] = "⚠️ Unknown";
      }
    });
    
    return componentStatus;
  } catch (error) {
    logApi.error(`Error getting component status: ${error.message}`, error);
    // Return basic status if error
    return {
      API: "✅ Online",
      Database: "✅ Online",
      WebSocket: "✅ Online"
    };
  }
}

/**
 * Register service event handlers with the unified WebSocket server
 * @param {Object} server - The unified WebSocket server instance
 */
export function registerServiceEvents(server) {
  // Store reference in global config for other services to use
  config.websocket.unifiedWebSocket = server;
  
  // Market Data event handlers
  server.registerEventHandler(
    'market:broadcast', 
    (data) => server.broadcastToTopic(config.websocket.topics.MARKET_DATA, {
      type: 'DATA',
      topic: config.websocket.topics.MARKET_DATA,
      data: data,
      timestamp: new Date().toISOString()
    })
  );
  
  // Terminal Data event handlers
  server.registerEventHandler(
    'terminal:broadcast', 
    (data) => server.broadcastToTopic(config.websocket.topics.TERMINAL, {
      type: 'DATA',
      topic: config.websocket.topics.TERMINAL,
      subtype: 'terminal',
      action: 'update',
      data: data,
      timestamp: new Date().toISOString()
    })
  );
  
  // System event handlers
  server.registerEventHandler(
    'system:status',
    (data) => server.broadcastToTopic(config.websocket.topics.SYSTEM, {
      type: 'DATA',
      topic: config.websocket.topics.SYSTEM,
      action: 'status_update',
      data: data,
      timestamp: new Date().toISOString()
    })
  );
  
  // Wallet balance event handlers
  server.registerEventHandler(
    'wallet:balance_update',
    (data) => {
      if (data.walletAddress) {
        server.broadcastToTopic(`${config.websocket.topics.WALLET_BALANCE}:${data.walletAddress}`, {
          type: 'DATA',
          topic: config.websocket.topics.WALLET_BALANCE,
          data: data,
          timestamp: new Date().toISOString()
        });
      }
    }
  );
  
  // Set up Solana PubSub handler
  setupSolanaPubSubHandler(server);
  
  // Log successful registration
  logApi.info(`${wsColors.tag}[services]${fancyColors.RESET} ${fancyColors.GREEN}Service event handlers registered successfully${fancyColors.RESET}`);
}

/**
 * Set up Solana PubSub subscription handling for account monitoring
 * @param {Object} wsServer - The WebSocket server instance
 */
function setupSolanaPubSubHandler(wsServer) {
  // Storage for active subscriptions
  const solanaPubSub = {
    // Store active Solana subscriptions by clientId
    clientSubscriptions: new Map(),
    // Track clients subscribed to each account
    accountSubscribers: new Map(),
    // Track actual WebSocket connections to Solana
    solanaConnections: new Map(),
    // Track subscription IDs by account
    subscriptionIds: new Map()
  };
  
  // Register the Solana PubSub topic handler
  wsServer.registerEventHandler('solana:subscribe', async (data, clientId) => {
    try {
      const client = wsServer.clients.get(clientId);
      
      if (!client) {
        logApi.warn(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Client ${clientId} not found for Solana subscription`);
        return;
      }
      
      // Get client authentication information
      const clientInfo = wsServer.authenticatedClients.get(client) || { role: 'public' };
      
      // Get user role and normalize it to lowercase for consistent comparison
      // In our system, roles from JWT tokens and database are lowercase: 'user', 'admin', 'superadmin'
      const userRole = (clientInfo.role || 'public').toLowerCase();
      
      // Determine tier based on normalized role
      // Admin tier includes both 'admin' and 'superadmin' roles
      const tier = userRole === 'admin' || userRole === 'superadmin' ? 'admin' : 
               userRole === 'user' ? 'user' : 'public';
      
      // Apply tier-based rate limits for subscriptions
      let maxSubscriptions;
      if (userRole === 'admin' || userRole === 'superadmin') {
        maxSubscriptions = SOLANA_SUBSCRIPTION_LIMITS.ADMIN;
      } else if (userRole === 'user') {
        maxSubscriptions = SOLANA_SUBSCRIPTION_LIMITS.USER;
      } else {
        maxSubscriptions = SOLANA_SUBSCRIPTION_LIMITS.PUBLIC;
      }
      
      // Extract subscription details 
      const { accounts = [], commitment = 'confirmed' } = data;
      
      // Get existing client subscriptions
      const clientKey = `${clientId}:solana`;
      const clientSubs = solanaPubSub.clientSubscriptions.get(clientKey) || { accounts: new Set() };
      
      // Check if adding these would exceed the limit
      if (clientSubs.accounts.size + accounts.length > maxSubscriptions) {
        wsServer.send(client, {
          type: 'ERROR',
          topic: 'solana',
          error: `Subscription limit exceeded. Max ${maxSubscriptions} accounts per client for ${tier} tier.`,
          code: 429
        });
        return;
      }
      
      // Process account subscriptions
      const acceptedAccounts = [];
      
      for (const account of accounts) {
        // Skip if invalid format
        if (typeof account !== 'string' || account.length < 32) {
          logApi.warn(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Invalid account format: ${account}`);
          continue;
        }
        
        // Add to client's subscriptions
        clientSubs.accounts.add(account);
        acceptedAccounts.push(account);
        
        // Track this client as subscribed to this account
        if (!solanaPubSub.accountSubscribers.has(account)) {
          solanaPubSub.accountSubscribers.set(account, new Set());
        }
        solanaPubSub.accountSubscribers.get(account).add(client);
        
        // Check if we need to create the actual RPC subscription
        if (!solanaPubSub.solanaConnections.has(account)) {
          try {
            // Get the RPC URL from config
            const rpcUrl = config.rpc_urls.mainnet_wss;
            
            if (!rpcUrl) {
              throw new Error('No Solana WebSocket RPC URL configured');
            }
            
            // Create WebSocket connection to Solana for this account
            createSolanaSubscription(rpcUrl, account, wsServer, solanaPubSub, commitment);
          } catch (subError) {
            logApi.error(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Failed to create Solana subscription for ${account}: ${subError.message}`);
          }
        }
      }
      
      // Store the updated client subscriptions
      solanaPubSub.clientSubscriptions.set(clientKey, clientSubs);
      
      // Send acknowledgment
      wsServer.send(client, {
        type: 'ACKNOWLEDGMENT',
        topic: 'solana',
        action: 'subscribe',
        data: {
          accepted: {
            accounts: acceptedAccounts,
            commitment
          }
        }
      });
      
      logApi.info(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Client ${clientId} (${tier}) subscribed to ${acceptedAccounts.length} Solana accounts`);
    } catch (error) {
      logApi.error(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Solana subscription error: ${error.message}`);
    }
  });
  
  // Handle unsubscribe requests
  wsServer.registerEventHandler('solana:unsubscribe', async (data, clientId) => {
    try {
      const { accounts = [] } = data;
      const client = wsServer.clients.get(clientId);
      
      if (!client) {
        logApi.warn(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Client ${clientId} not found for Solana unsubscription`);
        return;
      }
      
      // Get existing client subscriptions
      const clientKey = `${clientId}:solana`;
      const clientSubs = solanaPubSub.clientSubscriptions.get(clientKey);
      
      if (!clientSubs) {
        // No subscriptions to remove
        wsServer.send(client, {
          type: 'ACKNOWLEDGMENT',
          topic: 'solana',
          action: 'unsubscribe',
          data: { unsubscribed: { accounts: [] } }
        });
        return;
      }
      
      // Process account unsubscriptions
      const unsubscribedAccounts = [];
      
      for (const account of accounts) {
        // Remove from client's subscriptions
        if (clientSubs.accounts.has(account)) {
          clientSubs.accounts.delete(account);
          unsubscribedAccounts.push(account);
          
          // Remove client from account subscribers
          if (solanaPubSub.accountSubscribers.has(account)) {
            const subscribers = solanaPubSub.accountSubscribers.get(account);
            subscribers.delete(client);
            
            // If no more subscribers for this account, clean up the Solana connection
            if (subscribers.size === 0) {
              cleanupSolanaSubscription(account, solanaPubSub);
              solanaPubSub.accountSubscribers.delete(account);
            }
          }
        }
      }
      
      // If client has no more subscriptions, remove from tracking
      if (clientSubs.accounts.size === 0) {
        solanaPubSub.clientSubscriptions.delete(clientKey);
      } else {
        solanaPubSub.clientSubscriptions.set(clientKey, clientSubs);
      }
      
      // Send acknowledgment
      wsServer.send(client, {
        type: 'ACKNOWLEDGMENT',
        topic: 'solana',
        action: 'unsubscribe',
        data: {
          unsubscribed: {
            accounts: unsubscribedAccounts
          }
        }
      });
      
      logApi.info(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Client ${clientId} unsubscribed from ${unsubscribedAccounts.length} Solana accounts`);
    } catch (error) {
      logApi.error(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Solana unsubscription error: ${error.message}`);
    }
  });
  
  // Handle client disconnect - clean up subscriptions
  wsServer.registerEventHandler('close', (client, reason, clientId) => {
    try {
      // Clean up all Solana subscriptions for this client
      const clientKey = `${clientId}:solana`;
      const clientSubs = solanaPubSub.clientSubscriptions.get(clientKey);
      
      if (!clientSubs) {
        return; // No subscriptions to clean up
      }
      
      // Clean up all account subscriptions
      for (const account of clientSubs.accounts) {
        if (solanaPubSub.accountSubscribers.has(account)) {
          solanaPubSub.accountSubscribers.get(account).delete(client);
          
          // If no more subscribers for this account, clean up
          if (solanaPubSub.accountSubscribers.get(account).size === 0) {
            cleanupSolanaSubscription(account, solanaPubSub);
            solanaPubSub.accountSubscribers.delete(account);
          }
        }
      }
      
      // Remove client from tracking
      solanaPubSub.clientSubscriptions.delete(clientKey);
      
      logApi.info(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Cleaned up Solana subscriptions for disconnected client ${clientId}`);
    } catch (error) {
      logApi.error(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Error cleaning up Solana subscriptions: ${error.message}`);
    }
  });
  
  // Log that handler is set up
  logApi.info(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} ${fancyColors.GREEN}Solana PubSub handler initialized${fancyColors.RESET}`);
}

/**
 * Create a WebSocket subscription to Solana for an account
 * @param {string} rpcUrl - Solana WebSocket RPC URL
 * @param {string} account - Account address to subscribe to
 * @param {Object} wsServer - The WebSocket server for broadcasting updates
 * @param {Object} solanaPubSub - Storage for subscription data
 * @param {string} commitment - Solana commitment level
 */
function createSolanaSubscription(rpcUrl, account, wsServer, solanaPubSub, commitment = 'confirmed') {
  try {
    // Create WebSocket connection to Solana
    const ws = new WebSocket(rpcUrl);
    
    // Store the WebSocket
    solanaPubSub.solanaConnections.set(account, ws);
    
    // Set up event handlers
    ws.on('open', () => {
      logApi.info(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Solana WebSocket connected for account ${account}`);
      
      // Subscribe to account updates with the specified commitment
      const subscribeMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'accountSubscribe',
        params: [
          account,
          {
            encoding: 'jsonParsed',
            commitment: commitment
          }
        ]
      };
      
      ws.send(JSON.stringify(subscribeMessage));
    });
    
    // Handle messages from Solana
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        // Initial subscription confirmation
        if (message.id === 1 && message.result) {
          logApi.debug(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Solana subscription confirmed for ${account}, id: ${message.result}`);
          // Store subscription ID for unsubscribing later
          solanaPubSub.subscriptionIds.set(account, message.result);
          return;
        }
        
        // Account update notification
        if (message.method === 'accountNotification' && message.params && message.params.result) {
          const accountData = message.params.result.value;
          const subscribers = solanaPubSub.accountSubscribers.get(account);
          
          if (!subscribers || subscribers.size === 0) {
            return; // No subscribers
          }
          
          // Broadcast to all subscribers
          for (const client of subscribers) {
            if (client.readyState === WebSocket.OPEN) {
              wsServer.send(client, {
                type: 'DATA',
                topic: 'solana',
                subtype: 'account-update',
                data: {
                  account: account,
                  value: accountData,
                  timestamp: new Date().toISOString()
                }
              });
            }
          }
          
          logApi.debug(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Broadcast account update for ${account} to ${subscribers.size} clients`);
        }
      } catch (parseError) {
        logApi.error(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Error parsing Solana message: ${parseError.message}`);
      }
    });
    
    // Handle WebSocket errors
    ws.on('error', (error) => {
      logApi.error(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Solana WebSocket error for ${account}: ${error.message}`);
      
      // Notify subscribers of the error
      const subscribers = solanaPubSub.accountSubscribers.get(account);
      if (subscribers && subscribers.size > 0) {
        for (const client of subscribers) {
          if (client.readyState === WebSocket.OPEN) {
            wsServer.send(client, {
              type: 'ERROR',
              topic: 'solana',
              subtype: 'subscription-error',
              error: `Solana subscription error: ${error.message}`,
              data: { account }
            });
          }
        }
      }
      
      // Clean up
      cleanupSolanaSubscription(account, solanaPubSub);
      
      // Try to reconnect after a delay if there are still subscribers
      setTimeout(() => {
        if (solanaPubSub.accountSubscribers.has(account) && solanaPubSub.accountSubscribers.get(account).size > 0) {
          logApi.info(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Attempting to reconnect Solana subscription for ${account}`);
          createSolanaSubscription(rpcUrl, account, wsServer, solanaPubSub, commitment);
        }
      }, 5000);
    });
    
    // Handle WebSocket close
    ws.on('close', () => {
      logApi.warn(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Solana WebSocket closed for ${account}`);
      
      // Clean up
      cleanupSolanaSubscription(account, solanaPubSub);
      
      // Try to reconnect after a delay if there are still subscribers
      setTimeout(() => {
        if (solanaPubSub.accountSubscribers.has(account) && solanaPubSub.accountSubscribers.get(account).size > 0) {
          logApi.info(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Attempting to reconnect Solana subscription for ${account}`);
          createSolanaSubscription(rpcUrl, account, wsServer, solanaPubSub, commitment);
        }
      }, 5000);
    });
  } catch (error) {
    logApi.error(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Failed to create Solana subscription: ${error.message}`);
  }
}

/**
 * Clean up a Solana subscription
 * @param {string} account - The account address
 * @param {Object} solanaPubSub - Storage for subscription data
 */
function cleanupSolanaSubscription(account, solanaPubSub) {
  try {
    const ws = solanaPubSub.solanaConnections.get(account);
    
    if (ws) {
      // Try to unsubscribe gracefully if we have a subscription ID
      const subscriptionId = solanaPubSub.subscriptionIds.get(account);
      if (subscriptionId && ws.readyState === WebSocket.OPEN) {
        const unsubscribeMessage = {
          jsonrpc: '2.0',
          id: 2,
          method: 'accountUnsubscribe',
          params: [subscriptionId]
        };
        
        ws.send(JSON.stringify(unsubscribeMessage));
      }
      
      // Close the WebSocket
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      
      // Remove from tracking
      solanaPubSub.solanaConnections.delete(account);
      solanaPubSub.subscriptionIds.delete(account);
      
      logApi.info(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Cleaned up Solana subscription for ${account}`);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[solana-pubsub]${fancyColors.RESET} Error cleaning up Solana subscription: ${error.message}`);
  }
}