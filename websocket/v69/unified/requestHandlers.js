// websocket/v69/unified/requestHandlers.js

/**
 * Unified WebSocket Request Handlers
 * 
 * This module contains all topic-based request handlers for the unified WebSocket system.
 */

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors, wsColors } from '../../../utils/colors.js';
import { getTokenAddress } from '../../../utils/token-config-util.js';
import { fetchTerminalData } from './services.js';
import { MESSAGE_TYPES, TOPICS, normalizeTopic } from './utils.js';
import { heliusBalanceTracker } from '../../../services/solana-engine/helius-balance-tracker.js';
import marketDataService from '../../../services/market-data/marketDataService.js';
// TO BE IMPLEMENTED:
//import tokenBalanceModule from './modules/token-balance-module.js'; // DOES THIS EXIST?
//import solanaBalanceModule from './modules/solana-balance-module.js'; // DOES THIS EXIST?

// Config
import config from '../../../config/config.js';

/**
 * Main request handling function that routes to specific topic handlers
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
export async function handleRequest(ws, message, sendMessage, sendError) {
  // Validate request
  if (!message.topic || !message.action) {
    return sendError(ws, 'Request requires topic and action', 4006);
  }
  
  // Normalize the topic to support both hyphenated and underscore formats
  const normalizedTopic = normalizeTopic(message.topic);
  
  // Check if topic exists
  if (!Object.values(TOPICS).includes(normalizedTopic)) {
    return sendError(ws, `Unknown topic: ${message.topic}`, 4007);
  }
  
  // Replace the original topic with the normalized one for consistent processing
  const normalizedMessage = {...message, topic: normalizedTopic};
  
  // Process different request types based on topic and action
  try {
    switch (normalizedTopic) {
      case TOPICS.ADMIN:
        await handleAdminRequest(ws, normalizedMessage, sendMessage, sendError);
        break;
    
      case TOPICS.MARKET_DATA:
        await handleMarketDataRequest(ws, normalizedMessage, sendMessage, sendError);
        break;
        
      case TOPICS.USER:
        await handleUserRequest(ws, normalizedMessage, sendMessage, sendError);
        break;
        
      case TOPICS.LOGS:
        await handleLogsRequest(ws, normalizedMessage, sendMessage, sendError);
        break;
        
      case TOPICS.SYSTEM:
        await handleSystemRequest(ws, normalizedMessage, sendMessage, sendError);
        break;

      case TOPICS.WALLET:
        // Handle wallet requests based on subtype
        if (normalizedMessage.subtype === 'transaction') {
          await handleWalletTransactionRequest(ws, normalizedMessage, sendMessage, sendError);
        } else if (normalizedMessage.subtype === 'settings') {
          await handleWalletSettingsRequest(ws, normalizedMessage, sendMessage, sendError);
        } else {
          // Default to transaction handling if no subtype
          await handleWalletTransactionRequest(ws, normalizedMessage, sendMessage, sendError);
        }
        break;
        
      case TOPICS.WALLET_BALANCE:
        // Determine which handler to use based on action and parameters
        if (normalizedMessage.action === 'getTokenBalance' || 
            (normalizedMessage.tokenAddress && normalizedMessage.action === 'getBalance')) {
          await handleTokenBalanceRequest(ws, normalizedMessage, sendMessage, sendError);
        } else if (normalizedMessage.action === 'getSolanaBalance' || 
                  (normalizedMessage.action === 'getBalance' && !normalizedMessage.tokenAddress)) {
          await handleSolanaBalanceRequest(ws, normalizedMessage, sendMessage, sendError);
        } else if (normalizedMessage.action === 'getWalletBalance') {
          // Combined wallet balance endpoint that fetches both SOL and tokens
          await handleWalletBalanceRequest(ws, normalizedMessage, sendMessage, sendError);
        } else {
          await handleWalletBalanceRequest(ws, normalizedMessage, sendMessage, sendError);
        }
        break;
        
      case TOPICS.TERMINAL:
        await handleTerminalRequest(ws, normalizedMessage, sendMessage, sendError);
        break;
        
      default:
        sendError(ws, `Request handling not implemented for topic: ${normalizedTopic}`, 5001);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling request:${fancyColors.RESET}`, error);
    sendError(ws, 'Error processing request', 5002);
  }
}

/** 
 * Handle admin requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleAdminRequest(ws, message, sendMessage, sendError) {
  switch (message.action) {
    case 'getAdminStatus':

      // Check if the client is authenticated and has the correct role
      if (!ws.clientInfo.isAuthenticated || 
          !ws.clientInfo.role || 
          !['ADMIN', 'SUPERADMIN'].includes(ws.clientInfo.role.toLowerCase())) {
        return sendError(ws, 'Admin/superadmin role required for ADMIN requests', 4012);
      }
      if (ws.clientInfo.role.toLowerCase() !== 'superadmin' && ws.clientInfo.role.toLowerCase() !== 'admin') {
        return sendError(ws, 'Must have administrator access for ADMIN requests', 4012);
      }

      // Return admin status
      sendMessage(ws, {
        type: MESSAGE_TYPES.DATA,
        topic: TOPICS.ADMIN,
        action: 'getAdminStatus',
        requestId: message.requestId,
        data: {
          status: 'operational',
          version: '1.0.0',
          serverTime: new Date().toISOString(),
          uptime: Math.floor((Date.now() - global.startTime) / 1000),
          connections: global.wsConnectionCount || 0
        },
        timestamp: new Date().toISOString()
      });
      break;

    default:
      sendError(ws, `Unknown action for admin: ${message.action}`, 4009);
  }
}

/**
 * Handle market data requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleMarketDataRequest(ws, message, sendMessage, sendError) {
  switch (message.action) {
    case 'getToken':
      if (!message.symbol) {
        return sendError(ws, 'Symbol is required for getToken action', 4008);
      }
      
      const token = await marketDataService.getToken(message.symbol);
      if (token) {
        sendMessage(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.MARKET_DATA,
          action: 'getToken',
          requestId: message.requestId,
          data: token,
          timestamp: new Date().toISOString()
        });
      } else {
        sendError(ws, `Token not found: ${message.symbol}`, 4040);
      }
      break;
      
    case 'getAllTokens':
      const tokens = await marketDataService.getAllTokens();
      sendMessage(ws, {
        type: MESSAGE_TYPES.DATA,
        topic: TOPICS.MARKET_DATA,
        action: 'getAllTokens',
        requestId: message.requestId,
        data: tokens,
        timestamp: new Date().toISOString()
      });
      break;
      
    default:
      sendError(ws, `Unknown action for market data: ${message.action}`, 4009);
  }
}

/**
 * Handle logs requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleLogsRequest(ws, message, sendMessage, sendError) {
  switch (message.action) {
    case 'getStatus':
      // Return log system status
      sendMessage(ws, {
        type: MESSAGE_TYPES.DATA,
        topic: TOPICS.LOGS,
        action: 'getStatus',
        requestId: message.requestId,
        data: {
          status: 'operational',
          version: '1.0.0',
          transport: 'websocket'
        },
        timestamp: new Date().toISOString()
      });
      break;
      
    default:
      sendError(ws, `Unknown action for logs: ${message.action}`, 4009);
  }
}

/**
 * Handle system topic requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleSystemRequest(ws, message, sendMessage, sendError) {
  switch (message.action) {
    case 'getStatus':
      // Return system status
      sendMessage(ws, {
        type: MESSAGE_TYPES.DATA,
        topic: TOPICS.SYSTEM,
        action: 'getStatus',
        requestId: message.requestId,
        data: {
          status: 'operational',
          version: '1.0.0',
          serverTime: new Date().toISOString(),
          uptime: Math.floor((Date.now() - global.startTime) / 1000),
          connections: global.wsConnectionCount || 0
        },
        timestamp: new Date().toISOString()
      });
      break;
      
    case 'ping':
      // Send a pong response with server timestamp
      sendMessage(ws, {
        type: MESSAGE_TYPES.DATA,
        topic: TOPICS.SYSTEM,
        action: 'pong',
        requestId: message.requestId,
        data: {
          serverTime: new Date().toISOString(),
          clientTime: message.clientTime || null,
          roundTrip: message.clientTime ? true : false
        },
        timestamp: new Date().toISOString()
      });
      break;
      
    case 'getMetrics':
      // Return WebSocket metrics (only if authenticated as admin)
      if (!ws.clientInfo.isAuthenticated || 
          !ws.clientInfo.role || 
          !['ADMIN', 'SUPERADMIN'].includes(ws.clientInfo.role.toLowerCase())) {
        return sendError(ws, 'Admin/superadmin role required for SYSTEM metrics', 4012);
      }
      
      // Get metrics from the server instance via global object
      sendMessage(ws, {
        type: MESSAGE_TYPES.DATA,
        topic: TOPICS.SYSTEM,
        action: 'getMetrics',
        requestId: message.requestId,
        data: global.wsMetrics || { status: 'Metrics unavailable' },
        timestamp: new Date().toISOString()
      });
      break;
      
    default:
      sendError(ws, `Unknown action for system topic: ${message.action}`, 4009);
  }
}

/**
 * Handle user data requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleUserRequest(ws, message, sendMessage, sendError) {
  // User requests require authentication
  if (!ws.clientInfo.isAuthenticated) {
    return sendError(ws, 'Authentication required for user requests', 4013);
  }
  
  switch (message.action) {
    case 'getProfile':
      // Fetch user profile from database
      const userData = await prisma.users.findUnique({
        where: { wallet_address: ws.clientInfo.userId },
        select: {
          id: true,
          wallet_address: true,
          nickname: true,
          role: true,
          created_at: true,
          last_login: true,
          profile_image_url: true
        }
      });
      
      if (userData) {
        sendMessage(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.USER,
          action: 'getProfile',
          requestId: message.requestId,
          data: userData,
          timestamp: new Date().toISOString()
        });
      } else {
        sendError(ws, 'User profile not found', 4041);
      }
      break;
      
    case 'getStats':
      // Fetch user stats from database
      const userStats = await prisma.user_stats.findUnique({
        where: { user_id: ws.clientInfo.userId },
        select: {
          total_trades: true,
          win_count: true,
          loss_count: true,
          xp: true,
          level: true,
          rank: true,
          last_updated: true
        }
      });
      
      sendMessage(ws, {
        type: MESSAGE_TYPES.DATA,
        topic: TOPICS.USER,
        action: 'getStats',
        requestId: message.requestId,
        data: userStats || { message: 'No stats available' },
        timestamp: new Date().toISOString()
      });
      break;
      
    case 'getAuthStatus':
      // Fetch comprehensive auth status from API endpoint
      try {
        logApi.info(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.CYAN}Auth status requested by user ${ws.clientInfo.userId.substring(0, 8)}...${fancyColors.RESET}`);
        
        const authStatusRes = await fetch(`http://localhost:${config.port || process.env.PORT || 3000}/api/auth/status`, {
          method: 'GET',
          headers: {
            'Cookie': `session=${ws.clientInfo._rawToken || ''}`,
            'User-Agent': 'UniWS Internal Request',
            'X-Device-Id': ws.clientInfo.headers['x-device-id'] || message.deviceId || ''
          }
        });
        
        if (authStatusRes.ok) {
          const authStatus = await authStatusRes.json();
          
          // Log summary of auth methods
          const activeAuthMethods = Object.entries(authStatus.methods)
            .filter(([_, info]) => info.active)
            .map(([method]) => method);
            
          logApi.info(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.CYAN}Auth status sent:${fancyColors.RESET} User ${ws.clientInfo.userId.substring(0, 8)}... is using ${activeAuthMethods.join(', ') || 'no'} auth methods`);
          
          sendMessage(ws, {
            type: MESSAGE_TYPES.DATA,
            topic: TOPICS.USER,
            action: 'authStatus',
            requestId: message.requestId,
            data: authStatus,
            timestamp: new Date().toISOString()
          });
        } else {
          // Handle error response
          const errorText = await authStatusRes.text();
          logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Auth status API error:${fancyColors.RESET}`, {
            status: authStatusRes.status,
            statusText: authStatusRes.statusText,
            errorText,
            userId: ws.clientInfo.userId
          });
          
          sendError(ws, 'Failed to retrieve auth status', 5002);
        }
      } catch (error) {
        logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error fetching auth status:${fancyColors.RESET}`, error);
        sendError(ws, 'Internal error retrieving auth status', 5003);
      }
      break;
      
    default:
      sendError(ws, `Unknown action for user data: ${message.action}`, 4009);
  }
}

/**
 * Handle terminal requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleTerminalRequest(ws, message, sendMessage, sendError) {
  switch (message.action) {
    case 'getTerminalData':
      try {
        const terminalData = await fetchTerminalData();
        sendMessage(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.TERMINAL,
          subtype: 'terminal',
          action: 'update',
          data: terminalData,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error fetching terminal data:${fancyColors.RESET}`, error);
        sendError(ws, 'Error fetching terminal data', 5002);
      }
      break;
      
    default:
      sendError(ws, `Unknown action for terminal topic: ${message.action}`, 4009);
  }
}

/**
 * Handle wallet balance requests (combined SOL and token balances)
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleWalletBalanceRequest(ws, message, sendMessage, sendError) {
  // Ensure the client is authenticated
  if (!ws.clientInfo?.isAuthenticated) {
    return sendError(ws, 'Authentication required for wallet balance operations', 4003);
  }
  
  try {
    // Get wallet address from message or authenticated user
    const walletAddress = message.walletAddress || ws.clientInfo.userId;
    
    // Only allow access to own wallet balance (security measure)
    if (walletAddress !== ws.clientInfo.userId) {
      return sendError(ws, 'You can only access your own wallet balance', 4003);
    }
    
    // Fetch SOL balance from Helius balance tracker
    const solBalance = heliusBalanceTracker.getSolanaBalance(walletAddress);
    
    // Fetch token address
    const tokenAddress = await getTokenAddress();
    
    // Fetch token balances
    let tokens = [];
    if (tokenAddress) {
      const tokenBalance = heliusBalanceTracker.getTokenBalance(walletAddress, tokenAddress);
      
      // Only add token to the list if we have balance info
      if (tokenBalance && tokenBalance.balance !== undefined) {
        // Get token metadata
        const tokenData = await marketDataService.getToken('DEGEN'); // Assuming 'DEGEN' is our token symbol
        
        tokens.push({
          address: tokenAddress,
          symbol: tokenData?.symbol || 'DEGEN', 
          balance: Number(tokenBalance.balance),
          value_usd: tokenData?.price_usd ? Number(tokenBalance.balance) * Number(tokenData.price_usd) : null
        });
      }
    }
    
    // Get other token balances from Helius balance tracker
    const otherTokenBalances = heliusBalanceTracker.getAllTokenBalances(walletAddress);
    if (otherTokenBalances && otherTokenBalances.length > 0) {
      // Filter out our main token that's already in the list
      const otherTokens = otherTokenBalances
        .filter(token => token.address !== tokenAddress)
        .map(token => ({
          address: token.address,
          symbol: token.symbol || 'Unknown',
          balance: Number(token.balance),
          value_usd: token.value_usd ? Number(token.value_usd) : null
        }));
      
      tokens = [...tokens, ...otherTokens];
    }
    
    // Send combined wallet balance data
    sendMessage(ws, {
      type: MESSAGE_TYPES.DATA,
      topic: TOPICS.WALLET_BALANCE,
      data: {
        wallet_address: walletAddress,
        sol_balance: Number(solBalance.balance),
        tokens: tokens
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error fetching wallet balance:${fancyColors.RESET}`, error);
    sendError(ws, 'Error fetching wallet balance', 5004);
  }
}

/**
 * Handle Solana balance requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleSolanaBalanceRequest(ws, message, sendMessage, sendError) {
  // Ensure the client is authenticated
  if (!ws.clientInfo?.isAuthenticated) {
    return sendError(ws, 'Authentication required for Solana balance operations', 4003);
  }
  
  message.server = { sendMessage, sendError }; // Pass server methods to the module
  
  try {
    // TO BE IMPLEMENTED
    //await solanaBalanceModule.handleOperation(ws, message, ws.clientInfo);
    logApi.info(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.CYAN}Solana balance request received:${fancyColors.RESET}`, message);
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling Solana balance request:${fancyColors.RESET}`, error);
    sendError(ws, 'Error handling Solana balance request', 5004);
  }
}

/**
 * Handle token balance requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleTokenBalanceRequest(ws, message, sendMessage, sendError) {
  // Ensure the client is authenticated
  if (!ws.clientInfo?.isAuthenticated) {
    return sendError(ws, 'Authentication required for token balance operations', 4003);
  }
  
  message.server = { sendMessage, sendError }; // Pass server methods to the module
  
  try {
    // TO BE IMPLEMENTED
    //await tokenBalanceModule.handleOperation(ws, message, ws.clientInfo);
    logApi.info(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.CYAN}Token balance request received:${fancyColors.RESET}`, message);
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling token balance request:${fancyColors.RESET}`, error);
    sendError(ws, 'Error handling token balance request', 5004);
  }
}

/**
 * Handle wallet transaction requests and updates
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleWalletTransactionRequest(ws, message, sendMessage, sendError) {
  // Ensure the client is authenticated
  if (!ws.clientInfo?.isAuthenticated) {
    return sendError(ws, 'Authentication required for wallet transaction operations', 4003);
  }
  
  try {
    // Get wallet address from message or authenticated user
    const walletAddress = message.walletAddress || ws.clientInfo.userId;
    
    // Only allow access to own wallet transactions (security measure)
    if (walletAddress !== ws.clientInfo.userId) {
      return sendError(ws, 'You can only access your own wallet transactions', 4003);
    }
    
    switch (message.action) {
      case 'getTransactions':
        // Fetch recent transactions for the wallet from the database
        const transactions = await prisma.transactions.findMany({
          where: { 
            wallet_address: walletAddress 
          },
          orderBy: { 
            id: 'desc' 
          },
          take: 10
        });
        
        // If we have transactions, get the most recent one
        const recentTransaction = transactions.length > 0 ? transactions[0] : null;
        
        // For blockchain transactions, look for additional data
        let recentBlockchainData = null;
        if (recentTransaction) {
          recentBlockchainData = await prisma.blockchain_transactions.findFirst({
            where: {
              OR: [
                { wallet_from: walletAddress },
                { wallet_to: walletAddress }
              ]
            },
            orderBy: {
              created_at: 'desc'
            }
          });
        }
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.WALLET,
          subtype: 'transaction',
          action: 'list',
          data: {
            wallet_address: walletAddress,
            transaction: recentTransaction ? {
              id: recentTransaction.id.toString(),
              type: recentTransaction.type.toLowerCase(),
              status: recentTransaction.status || "confirmed",
              amount: Number(recentTransaction.amount),
              token: recentBlockchainData?.token_type || "DEGEN",
              timestamp: recentTransaction.created_at?.toISOString() || new Date().toISOString(),
              signature: recentBlockchainData?.signature || null,
              from: recentBlockchainData?.wallet_from || walletAddress,
              to: recentBlockchainData?.wallet_to || ""
            } : null
          },
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'getTransaction':
        // Fetch a specific transaction by ID
        if (!message.transactionId) {
          return sendError(ws, 'Transaction ID required', 4008);
        }
        
        // Parse the transaction ID
        const transactionId = parseInt(message.transactionId, 10);
        if (isNaN(transactionId)) {
          return sendError(ws, 'Invalid transaction ID format', 4008);
        }
        
        // Fetch transaction details
        const transaction = await prisma.transactions.findUnique({
          where: { 
            id: transactionId,
            wallet_address: walletAddress // Security check - only allow access to own transactions
          }
        });
        
        // For blockchain transactions, look for additional data
        let transactionBlockchainData = null;
        if (transaction) {
          transactionBlockchainData = await prisma.blockchain_transactions.findFirst({
            where: {
              OR: [
                { wallet_from: walletAddress },
                { wallet_to: walletAddress }
              ]
            },
            orderBy: {
              created_at: 'desc'
            }
          });
        }
        
        if (!transaction) {
          return sendError(ws, 'Transaction not found', 4004);
        }
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.WALLET,
          subtype: 'transaction',
          action: 'detail',
          data: {
            wallet_address: walletAddress,
            transaction: {
              id: transaction.id.toString(),
              type: transaction.type.toLowerCase(),
              status: transaction.status || "confirmed",
              amount: Number(transaction.amount),
              token: transactionBlockchainData?.token_type || "DEGEN",
              timestamp: transaction.created_at?.toISOString() || new Date().toISOString(),
              signature: transactionBlockchainData?.signature || null,
              from: transactionBlockchainData?.wallet_from || walletAddress,
              to: transactionBlockchainData?.wallet_to || "",
              balance_before: Number(transaction.balance_before),
              balance_after: Number(transaction.balance_after),
              description: transaction.description || "",
              metadata: transaction.metadata || {}
            }
          },
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'sendTransaction':
        // Handle sending a transaction
        // This would typically involve creating and signing a transaction
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.WALLET,
          subtype: 'transaction',
          action: 'pending',
          data: {
            wallet_address: walletAddress,
            transaction: {
              id: 'generated_tx_id',
              type: message.transactionType || 'send',
              status: 'pending',
              amount: Number(message.amount),
              token: message.token || 'SOL',
              timestamp: new Date().toISOString(),
              from: walletAddress,
              to: message.recipient
            }
          },
          timestamp: new Date().toISOString()
        });
        break;
        
      default:
        sendError(ws, `Unknown action for wallet transactions: ${message.action}`, 4009);
    }
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling wallet transaction:${fancyColors.RESET}`, error);
    sendError(ws, 'Error handling wallet transaction', 5004);
  }
}

/**
 * Handle wallet settings requests and updates
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleWalletSettingsRequest(ws, message, sendMessage, sendError) {
  // Ensure the client is authenticated
  if (!ws.clientInfo?.isAuthenticated) {
    return sendError(ws, 'Authentication required for wallet settings operations', 4003);
  }
  
  try {
    // Get wallet address from message or authenticated user
    const walletAddress = message.walletAddress || ws.clientInfo.userId;
    
    // Only allow access to own wallet settings (security measure)
    if (walletAddress !== ws.clientInfo.userId) {
      return sendError(ws, 'You can only access your own wallet settings', 4003);
    }
    
    switch (message.action) {
      case 'getSettings':
        // Fetch wallet settings from system_settings table
        // We'll use a key format of wallet_settings:{walletAddress}
        const settingsKey = `wallet_settings:${walletAddress}`;
        
        let userSettings = await prisma.system_settings.findUnique({
          where: { key: settingsKey }
        });
        
        // If no settings exist yet, create default settings
        if (!userSettings) {
          // Default settings
          const defaultSettings = {
            auto_approve: true,
            spending_limit: 1000
          };
          
          try {
            // Create default settings in database
            await prisma.system_settings.create({
              data: {
                key: settingsKey,
                value: defaultSettings,
                description: `Wallet settings for ${walletAddress}`,
                updated_at: new Date(),
                updated_by: walletAddress
              }
            });
            
            // Use the default settings
            userSettings = {
              value: defaultSettings
            };
          } catch (error) {
            logApi.error(`Error creating default wallet settings: ${error.message}`, error);
            // Still return default settings even if DB insert fails
            userSettings = {
              value: defaultSettings
            };
          }
        }
        
        // Extract settings from the system_settings record
        const settings = userSettings.value;
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.WALLET,
          subtype: 'settings',
          data: {
            wallet_address: walletAddress,
            settings: settings
          },
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'updateSettings':
        // Update wallet settings in database
        if (!message.settings) {
          return sendError(ws, 'Settings object required', 4008);
        }
        
        // Validate settings
        const newSettings = message.settings;
        if (typeof newSettings !== 'object') {
          return sendError(ws, 'Settings must be an object', 4008);
        }
        
        // Ensure required fields exist
        if (newSettings.auto_approve === undefined || newSettings.spending_limit === undefined) {
          return sendError(ws, 'Settings must include auto_approve and spending_limit', 4008);
        }
        
        // Validate spending_limit is a reasonable number
        const spendingLimit = Number(newSettings.spending_limit);
        if (isNaN(spendingLimit) || spendingLimit < 0 || spendingLimit > 1000000) {
          return sendError(ws, 'Invalid spending_limit value', 4008);
        }
        
        // Format for storage - ensure proper types
        const formattedSettings = {
          auto_approve: Boolean(newSettings.auto_approve),
          spending_limit: spendingLimit
        };
        
        // Settings key in the system_settings table
        const walletSettingsKey = `wallet_settings:${walletAddress}`;
        
        try {
          // Update or create settings
          await prisma.system_settings.upsert({
            where: { key: walletSettingsKey },
            update: {
              value: formattedSettings,
              updated_at: new Date(),
              updated_by: walletAddress
            },
            create: {
              key: walletSettingsKey,
              value: formattedSettings,
              description: `Wallet settings for ${walletAddress}`,
              updated_at: new Date(),
              updated_by: walletAddress
            }
          });
          
          // Send back the updated settings
          sendMessage(ws, {
            type: MESSAGE_TYPES.DATA,
            topic: TOPICS.WALLET,
            subtype: 'settings',
            data: {
              wallet_address: walletAddress,
              settings: formattedSettings
            },
            timestamp: new Date().toISOString()
          });
          
          // Log the settings change
          logApi.info(`User ${walletAddress} updated wallet settings: ${JSON.stringify(formattedSettings)}`);
        } catch (error) {
          logApi.error(`Error updating wallet settings: ${error.message}`, error);
          return sendError(ws, 'Error updating settings', 5002);
        }
        break;
        
      default:
        sendError(ws, `Unknown action for wallet settings: ${message.action}`, 4009);
    }
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling wallet settings:${fancyColors.RESET}`, error);
    sendError(ws, 'Error handling wallet settings', 5004);
  }
}