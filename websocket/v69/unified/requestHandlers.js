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
import tokenBalanceModule from './modules/token-balance-module.js';
import solanaBalanceModule from './modules/solana-balance-module.js';
// Import shared WebSocket action enum
import { DDWebSocketActions } from '@branchmanager69/degenduel-shared';

// NOTE:
// The 'Contest Service' was designed as a service but has since been converted 
// to a module that exports functions. This is because the service was not 
// properly registering as a service, so it may not be available to other services.
import { joinContest, createContest, getContestById, getAllContests, getAllContestsByUser, getContestSchedules } from '../../../utils/contest-utils.js';
import { verifyUserHasCredit } from '../../../utils/contest-credit-verifier.js';

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
        
      case TOPICS.CONTEST:
        await handleContestRequest(ws, normalizedMessage, sendMessage, sendError);
        break;

      case TOPICS.CONTEST_CHAT:
        await handleContestChatRequest(ws, normalizedMessage, sendMessage, sendError);
        break;
        
      default:
        sendError(ws, `Request handling not implemented for topic: ${normalizedTopic}`, 5001);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling request:${fancyColors.RESET}`, error);
    sendError(ws, 'General request error', 5000);
  }
}

// Export all handler functions
export {
  handleAdminRequest,
  handleMarketDataRequest,
  handleUserRequest,
  handleLogsRequest,
  handleSystemRequest,
  handleWalletTransactionRequest,
  handleWalletSettingsRequest,
  handleWalletBalanceRequest,
  handleTokenBalanceRequest,
  handleSolanaBalanceRequest,
  handleTerminalRequest,
  handleContestRequest,
  handleContestChatRequest
};

/**
 * Handle admin-related requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleAdminRequest(ws, message, sendMessage, sendError) {
  // Verify admin permissions
  if (!ws.isAuthenticated) {
    return sendError(ws, 'Authentication required', 4003);
  }
  
  if (!ws.role || (ws.role !== 'admin' && ws.role !== 'superadmin')) {
    return sendError(ws, 'Admin permissions required', 4004);
  }
  
  // Process different admin request types
  switch (message.action) {
    case 'getSystemStatus':
      // This is a placeholder. You would implement admin-specific functionality here.
      sendMessage(ws, {
        type: MESSAGE_TYPES.RESPONSE,
        topic: TOPICS.ADMIN,
        action: 'getSystemStatus',
        data: {
          status: 'operational',
          services: [
            { name: 'database', status: 'operational' },
            { name: 'blockchain', status: 'operational' },
            { name: 'api', status: 'operational' }
          ],
          timestamp: new Date().toISOString()
        },
        requestId: message.requestId
      });
      break;
      
    case 'getRpcBenchmarks':
      try {
        // Get the latest test run ID
        const latestRun = await prisma.rpc_benchmark_results.findFirst({
          orderBy: {
            timestamp: 'desc'
          },
          select: {
            test_run_id: true,
            timestamp: true
          }
        });
        
        if (!latestRun) {
          return sendMessage(ws, {
            type: MESSAGE_TYPES.RESPONSE,
            topic: TOPICS.ADMIN,
            action: 'getRpcBenchmarks',
            data: {
              success: false,
              message: 'No benchmark data found'
            },
            requestId: message.requestId
          });
        }
        
        // Get all results from the latest run
        const results = await prisma.rpc_benchmark_results.findMany({
          where: {
            test_run_id: latestRun.test_run_id
          },
          orderBy: [
            { method: 'asc' },
            { median_latency: 'asc' }
          ]
        });
        
        // Group by method
        const methodResults = {};
        for (const result of results) {
          if (!methodResults[result.method]) {
            methodResults[result.method] = [];
          }
          methodResults[result.method].push(result);
        }
        
        // Format results
        const formattedResults = {};
        const methods = Object.keys(methodResults);
        
        // Get provider rankings for each method
        for (const method of methods) {
          formattedResults[method] = {
            providers: methodResults[method].map(result => ({
              provider: result.provider,
              median_latency: result.median_latency,
              avg_latency: result.avg_latency,
              min_latency: result.min_latency,
              max_latency: result.max_latency,
              success_count: result.success_count,
              failure_count: result.failure_count
            }))
          };
          
          // Add percentage comparisons
          if (formattedResults[method].providers.length > 1) {
            const fastestLatency = formattedResults[method].providers[0].median_latency;
            
            for (let i = 1; i < formattedResults[method].providers.length; i++) {
              const provider = formattedResults[method].providers[i];
              const percentSlower = ((provider.median_latency - fastestLatency) / fastestLatency) * 100;
              provider.percent_slower = percentSlower;
            }
          }
        }
        
        // Get fastest provider overall
        let overallFastestProvider = null;
        const providerWins = {};
        
        for (const method of methods) {
          const fastestProvider = methodResults[method][0].provider;
          providerWins[fastestProvider] = (providerWins[fastestProvider] || 0) + 1;
        }
        
        let maxWins = 0;
        for (const [provider, wins] of Object.entries(providerWins)) {
          if (wins > maxWins) {
            maxWins = wins;
            overallFastestProvider = provider;
          }
        }
        
        // Construct performance advantage summary
        const performanceAdvantage = [];
        
        if (overallFastestProvider) {
          for (const method of methods) {
            const results = methodResults[method];
            const providers = results.map(r => r.provider);
            
            if (providers[0] === overallFastestProvider && providers.length > 1) {
              const bestLatency = results[0].median_latency;
              const secondLatency = results[1].median_latency;
              const improvementVsSecond = ((secondLatency - bestLatency) / bestLatency) * 100;
              
              let thirdPlaceAdvantage = null;
              if (providers.length >= 3) {
                const thirdLatency = results[2].median_latency;
                const improvementVsThird = ((thirdLatency - bestLatency) / bestLatency) * 100;
                thirdPlaceAdvantage = improvementVsThird;
              }
              
              performanceAdvantage.push({
                method,
                vs_second_place: improvementVsSecond,
                vs_third_place: thirdPlaceAdvantage,
                second_place_provider: providers[1],
                third_place_provider: providers.length >= 3 ? providers[2] : null
              });
            }
          }
        }
        
        // Return the results
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.ADMIN,
          action: 'getRpcBenchmarks',
          data: {
            success: true,
            test_run_id: latestRun.test_run_id,
            timestamp: latestRun.timestamp,
            methods: formattedResults,
            overall_fastest_provider: overallFastestProvider,
            performance_advantage: performanceAdvantage
          },
          requestId: message.requestId
        });
      } catch (error) {
        logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error getting RPC benchmark results:${fancyColors.RESET}`, error);
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.ADMIN,
          action: 'getRpcBenchmarks',
          data: {
            success: false,
            message: 'Error retrieving RPC benchmark results',
            error: error.message
          },
          requestId: message.requestId
        });
      }
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
  try {
    switch (message.action) {
      case 'getTokens':
        // Get tokens with optional filters
        const tokens = await marketDataService.getTokens(message.data?.filters, {
          limit: message.data?.limit || 100,
          offset: message.data?.offset || 0,
          orderBy: message.data?.orderBy || { updated_at: 'desc' }
        });
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.MARKET_DATA,
          action: 'getTokens',
          data: tokens,
          requestId: message.requestId
        });
        break;
        
      case 'getToken':
        // Validate token address
        if (!message.data?.address) {
          return sendError(ws, 'Token address is required', 4006);
        }
        
        // Get token details
        const token = await marketDataService.getTokenByAddress(message.data.address);
        
        if (!token) {
          return sendError(ws, 'Token not found', 4404);
        }
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.MARKET_DATA,
          action: 'getToken',
          data: token,
          requestId: message.requestId
        });
        break;
      
      default:
        sendError(ws, `Unknown action for market data: ${message.action}`, 4009);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling market data:${fancyColors.RESET}`, error);
    sendError(ws, 'Error getting market data', 5002);
  }
}

/**
 * Handle user-related requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleUserRequest(ws, message, sendMessage, sendError) {
  // Verify authentication for user-related requests
  if (!ws.isAuthenticated) {
    return sendError(ws, 'Authentication required', 4003);
  }
  
  try {
    switch (message.action) {
      case 'getProfile':
        // Get user profile
        const user = await prisma.users.findUnique({
          where: { wallet_address: ws.userId },
          select: {
            id: true,
            wallet_address: true,
            nickname: true,
            role: true,
            created_at: true,
            profile_image_url: true,
            user_achievements: {
              include: {
                achievements: true
              }
            },
            user_levels: true
          }
        });
        
        if (!user) {
          return sendError(ws, 'User not found', 4404);
        }
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.USER,
          action: 'getProfile',
          data: user,
          requestId: message.requestId
        });
        break;
      
      default:
        sendError(ws, `Unknown action for user: ${message.action}`, 4009);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling user request:${fancyColors.RESET}`, error);
    sendError(ws, 'Error processing user request', 5002);
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
  // Admin-only access to logs
  if (!ws.isAuthenticated) {
    return sendError(ws, 'Authentication required', 4003);
  }
  
  if (!ws.role || (ws.role !== 'admin' && ws.role !== 'superadmin')) {
    return sendError(ws, 'Admin permissions required', 4004);
  }
  
  try {
    switch (message.action) {
      case 'sendClientLog':
        // Validate log data
        if (!message.data?.level || !message.data?.message) {
          return sendError(ws, 'Log level and message are required', 4006);
        }
        
        // Store client log
        await prisma.client_errors.create({
          data: {
            level: message.data.level,
            message: message.data.message,
            stack_trace: message.data.stack || null,
            user_id: ws.userId || null,
            wallet_address: ws.userId || null,
            browser: message.data.browser || null,
            os: message.data.os || null,
            url: message.data.url || null,
            component: message.data.component || null,
            created_at: new Date()
          }
        });
        
        // Acknowledge receipt
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.LOGS,
          action: 'sendClientLog',
          data: { received: true },
          requestId: message.requestId
        });
        break;
      
      default:
        sendError(ws, `Unknown action for logs: ${message.action}`, 4009);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling logs:${fancyColors.RESET}`, error);
    sendError(ws, 'Error processing logs request', 5002);
  }
}

/**
 * Handle system-related requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleSystemRequest(ws, message, sendMessage, sendError) {
  try {
    switch (message.action) {
      case 'getStatus':
        // Get public system status
        const status = {
          status: 'operational',
          services: [
            { name: 'api', status: 'operational' },
            { name: 'websockets', status: 'operational' },
            { name: 'blockchain', status: 'operational' }
          ],
          maintenance: {
            active: false,
            scheduled: null
          },
          timestamp: new Date().toISOString()
        };
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.SYSTEM,
          action: 'getStatus',
          data: status,
          requestId: message.requestId
        });
        break;
        
      case 'getSettings':
        // Get public system settings
        const settings = {
          theme: 'dark',
          maintenance: false,
          notice: null,
          features: {
            contests: true,
            trading: true,
            portfolios: true
          }
        };
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.SYSTEM,
          action: 'getSettings',
          data: settings,
          requestId: message.requestId
        });
        break;
        
      case 'ping':
        // Handle ping requests with pong response
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.SYSTEM,
          action: 'pong',
          data: { timestamp: new Date().toISOString() },
          requestId: message.requestId
        });
        break;
      
      default:
        sendError(ws, `Unknown action for system: ${message.action}`, 4009);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling system request:${fancyColors.RESET}`, error);
    sendError(ws, 'Error processing system request', 5002);
  }
}

/**
 * Handle wallet transaction requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleWalletTransactionRequest(ws, message, sendMessage, sendError) {
  // Verify authentication for wallet-related requests
  if (!ws.isAuthenticated) {
    return sendError(ws, 'Authentication required', 4003);
  }
  
  try {
    const walletAddress = ws.userId; // User wallet address from authentication
    
    switch (message.action) {
      case 'getTransactions':
        // Get wallet transactions
        const transactions = await prisma.transactions.findMany({
          where: { wallet_address: walletAddress },
          orderBy: { created_at: 'desc' },
          take: message.data?.limit || 20,
          skip: message.data?.offset || 0
        });
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.WALLET,
          subtype: 'transaction',
          action: 'getTransactions',
          data: transactions,
          requestId: message.requestId
        });
        break;
        
      case 'getTransaction':
        // Validate transaction ID
        if (!message.data?.id) {
          return sendError(ws, 'Transaction ID is required', 4006);
        }
        
        // Get transaction by ID
        const transaction = await prisma.transactions.findUnique({
          where: { id: message.data.id }
        });
        
        if (!transaction) {
          return sendError(ws, 'Transaction not found', 4404);
        }
        
        // Verify ownership
        if (transaction.wallet_address !== walletAddress) {
          return sendError(ws, 'Unauthorized', 4003);
        }
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.WALLET,
          subtype: 'transaction',
          action: 'getTransaction',
          data: transaction,
          requestId: message.requestId
        });
        break;
      
      default:
        sendError(ws, `Unknown action for wallet transactions: ${message.action}`, 4009);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling wallet transaction:${fancyColors.RESET}`, error);
    sendError(ws, 'Error processing wallet transaction request', 5002);
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
  try {
    // Get wallet address from message or from authenticated user
    const walletAddress = message.data?.wallet_address || (ws.isAuthenticated ? ws.userId : null);
    
    if (!walletAddress) {
      return sendError(ws, 'Wallet address is required', 4006);
    }
    
    // Get balance using solanaBalanceModule
    const balance = await solanaBalanceModule.getSolanaBalance(walletAddress);
    
    sendMessage(ws, {
      type: MESSAGE_TYPES.RESPONSE,
      topic: TOPICS.WALLET_BALANCE,
      action: 'getSolanaBalance',
      data: {
        wallet_address: walletAddress,
        balance: balance.balance,
        lamports: balance.lamports,
        timestamp: balance.timestamp
      },
      requestId: message.requestId
    });
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling Solana balance:${fancyColors.RESET}`, error);
    sendError(ws, 'Error getting Solana balance', 5002);
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
  try {
    // Get wallet address from message or from authenticated user
    const walletAddress = message.data?.wallet_address || (ws.isAuthenticated ? ws.userId : null);
    
    if (!walletAddress) {
      return sendError(ws, 'Wallet address is required', 4006);
    }
    
    // Get token address from message
    const tokenAddress = message.data?.tokenAddress || message.tokenAddress;
    
    if (!tokenAddress) {
      return sendError(ws, 'Token address is required', 4006);
    }
    
    // Get token balance using tokenBalanceModule
    const balance = await tokenBalanceModule.getTokenBalance(walletAddress, tokenAddress);
    
    sendMessage(ws, {
      type: MESSAGE_TYPES.RESPONSE,
      topic: TOPICS.WALLET_BALANCE,
      action: 'getTokenBalance',
      data: {
        wallet_address: walletAddress,
        token_address: tokenAddress,
        balance: balance.balance,
        raw_balance: balance.rawBalance,
        usd_value: balance.usdValue,
        decimals: balance.decimals,
        timestamp: balance.timestamp
      },
      requestId: message.requestId
    });
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling token balance:${fancyColors.RESET}`, error);
    sendError(ws, 'Error getting token balance', 5002);
  }
}

/**
 * Handle full wallet balance requests (both SOL and tokens)
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleWalletBalanceRequest(ws, message, sendMessage, sendError) {
  try {
    // Get wallet address from message or from authenticated user
    const walletAddress = message.data?.wallet_address || (ws.isAuthenticated ? ws.userId : null);
    
    if (!walletAddress) {
      return sendError(ws, 'Wallet address is required', 4006);
    }
    
    // Get balance using heliusBalanceTracker
    const balances = await heliusBalanceTracker.getWalletBalances(walletAddress);
    
    sendMessage(ws, {
      type: MESSAGE_TYPES.RESPONSE,
      topic: TOPICS.WALLET_BALANCE,
      action: 'getWalletBalance',
      data: {
        wallet_address: walletAddress,
        solana_balance: balances.solanaBalance,
        tokens: balances.tokens,
        total_usd_value: balances.totalUsdValue,
        timestamp: new Date().toISOString()
      },
      requestId: message.requestId
    });
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling wallet balance:${fancyColors.RESET}`, error);
    sendError(ws, 'Error getting wallet balance', 5002);
  }
}

/**
 * Handle terminal data requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleTerminalRequest(ws, message, sendMessage, sendError) {
  try {
    switch (message.action) {
      case DDWebSocketActions.GET_DATA:
        // Get terminal data using the shared enum constant
        const terminalData = await fetchTerminalData();
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.TERMINAL,
          action: DDWebSocketActions.GET_DATA,
          data: terminalData,
          requestId: message.requestId
        });
        break;
      
      default:
        sendError(ws, `Unknown action for terminal: ${message.action}`, 4009);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error handling terminal data:${fancyColors.RESET}`, error);
    sendError(ws, 'Error getting terminal data', 5002);
  }
}

/**
 * Handle wallet settings requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleWalletSettingsRequest(ws, message, sendMessage, sendError) {
  // Verify authentication for wallet-related requests
  if (!ws.isAuthenticated) {
    return sendError(ws, 'Authentication required', 4003);
  }
  
  try {
    const walletAddress = ws.userId; // User wallet address from authentication
    
    // Settings key in the system_settings table
    const walletSettingsKey = `wallet_settings:${walletAddress}`;
    
    switch (message.action) {
      case 'getSettings':
        // Get wallet settings from system_settings table
        const settings = await prisma.system_settings.findUnique({
          where: { key: walletSettingsKey }
        });
        
        const walletSettings = settings?.value || {
          theme: 'default',
          notifications: {
            trade: true,
            balance: true,
            system: true
          },
          preferences: {
            defaultView: 'portfolio',
            currency: 'USD',
            timeFormat: '24h'
          }
        };
        
        sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.WALLET,
          subtype: 'settings',
          action: 'getSettings',
          data: {
            wallet_address: walletAddress,
            settings: walletSettings
          },
          requestId: message.requestId
        });
        break;
        
      case 'updateSettings':
        // Validate settings object
        if (!message.data?.settings) {
          return sendError(ws, 'Settings object is required', 4006);
        }
        
        // Format and validate settings
        const formattedSettings = {
          theme: message.data.settings.theme || 'default',
          notifications: {
            trade: message.data.settings.notifications?.trade !== false,
            balance: message.data.settings.notifications?.balance !== false,
            system: message.data.settings.notifications?.system !== false
          },
          preferences: {
            defaultView: message.data.settings.preferences?.defaultView || 'portfolio',
            currency: message.data.settings.preferences?.currency || 'USD',
            timeFormat: message.data.settings.preferences?.timeFormat || '24h'
          }
        };
        
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

/**
 * Handle contest-related requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleContestRequest(ws, message, sendMessage, sendError) {
  // Admin-only actions
  const adminOnlyActions = ['createContest', 'updateContest', 'cancelContest', 'startContest', 'endContest'];
  
  // Check authentication for admin-only actions
  if (adminOnlyActions.includes(message.action)) {
    // Verify admin permissions
    if (!ws.isAuthenticated) {
      return sendError(ws, 'Authentication required', 4003);
    }
    
    // Verify admin role
    if (!ws.role || (ws.role !== 'admin' && ws.role !== 'superadmin')) {
      return sendError(ws, 'Admin permissions required', 4004);
    }
  }
  
  // Handle different contest actions
  try {
    switch (message.action) {
      case 'getContests':
        // Get contests with optional filters using the exported module function
        const contestsParams = {
          filters: message.data?.filters || {},
          limit: message.data?.limit || 20,
          offset: message.data?.offset || 0
        };
        
        const contests = await getAllContests(contestsParams);
        
        return sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.CONTEST,
          action: 'getContests',
          data: contests,
          requestId: message.requestId
        });
        
      case 'getContest':
        // Validate contestId
        if (!message.data?.contestId) {
          return sendError(ws, 'Contest ID is required', 4006);
        }
        
        // Get contest by ID using the exported module function
        const contest = await getContestById(parseInt(message.data.contestId));
        
        if (!contest) {
          return sendError(ws, 'Contest not found', 4404);
        }
        
        return sendMessage(ws, {
          type: MESSAGE_TYPES.RESPONSE,
          topic: TOPICS.CONTEST,
          action: 'getContest',
          data: contest,
          requestId: message.requestId
        });
        
      case 'createContest':
        // Validate required fields
        const requiredFields = ['name', 'contest_code', 'entry_fee', 'start_time', 'end_time'];
        const missingFields = requiredFields.filter(field => !message.data[field]);
        
        if (missingFields.length > 0) {
          return sendError(ws, `Missing required fields: ${missingFields.join(', ')}`, 4006);
        }
        
        // Check if this is an admin or a user request
        const isAdminRequest = ws.role === 'admin' || ws.role === 'superadmin';
        const isUserRequest = !isAdminRequest && message.data.userCreated === true;
        
        try {
          // Prepare the contest data with common fields
          const contestData = {
            name: message.data.name,
            contest_code: message.data.contest_code,
            description: message.data.description || '',
            entry_fee: message.data.entry_fee,
            start_time: new Date(message.data.start_time),
            end_time: new Date(message.data.end_time),
            allowed_buckets: message.data.allowed_buckets || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            visibility: message.data.visibility || 'public',
            created_by: ws.userId,
            // Unified approach to handle vanity wallet failures with fallback
            allow_wallet_fallback: true // Flag to enable fallback for ALL contests
          };

          // Add admin or user specific fields
          if (isUserRequest) {
            // Verify the user has an available credit
            const creditResult = await verifyUserHasCredit(ws.userId);
            
            if (!creditResult.hasCredit) {
              logApi.warn(`User ${ws.userId} attempted to create a contest without available credits via WebSocket`, {
                error: creditResult.error
              });
              
              return sendError(ws, creditResult.error || 'No available contest creation credits', 4402);
            }
            
            // Add user-specific fields
            contestData.min_participants = message.data.min_participants || 2;
            contestData.max_participants = message.data.max_participants || 50;
            contestData.credit_id = creditResult.credit?.id;
            contestData.is_admin = false;
          } else {
            // Add admin-specific fields  
            contestData.min_participants = message.data.min_participants || 2;
            contestData.max_participants = message.data.max_participants || 10;
            contestData.prize_pool = message.data.prize_pool || 0;
            contestData.is_admin = true;
          }
          
          // Unified code path for both admin and user contests using the module function
          const result = await createContest(contestData);
          
          if (!result.success) {
            logApi.error(`Failed to create contest via WebSocket: ${result.error}`, {
              isAdminRequest,
              userId: ws.userId,
              error: result.error
            });
            return sendError(ws, result.error || 'Failed to create contest', 5000);
          }
          
          // Unified response
          return sendMessage(ws, {
            type: MESSAGE_TYPES.RESPONSE,
            topic: TOPICS.CONTEST,
            action: 'createContest',
            data: result.contest,
            requestId: message.requestId
          });
        } catch (error) {
          logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Failed to create contest:${fancyColors.RESET}`, {
            error: error.message,
            stack: error.stack,
            requestData: message.data,
            isUserRequest,
            userId: ws.userId
          });
          return sendError(ws, `Failed to create contest: ${error.message}`, 5000);
        }
        
      case 'joinContest':
        // Verify authentication
        if (!ws.isAuthenticated) {
          return sendError(ws, 'Authentication required to join contest', 4003);
        }
        
        // Validate contestId
        if (!message.data?.contestId) {
          return sendError(ws, 'Contest ID is required', 4006);
        }
        
        try {
          // Use the imported module function to join a contest
          const result = await joinContest(
            parseInt(message.data.contestId),
            ws.userId,
            message.data.tokenSelections || []
          );
          
          if (!result.success) {
            return sendError(ws, result.error || 'Failed to join contest', 4500);
          }
          
          return sendMessage(ws, {
            type: MESSAGE_TYPES.RESPONSE,
            topic: TOPICS.CONTEST,
            action: 'joinContest',
            data: result.participation,
            requestId: message.requestId
          });
        } catch (error) {
          logApi.error(`Error joining contest: ${error.message}`, error);
          return sendError(ws, `Failed to join contest: ${error.message}`, 5000);
        }
        
      case 'getContestSchedules':
        try {
          // Get contest schedules using the imported module function
          const schedules = await getContestSchedules();
          
          return sendMessage(ws, {
            type: MESSAGE_TYPES.RESPONSE,
            topic: TOPICS.CONTEST,
            action: 'getContestSchedules',
            data: schedules,
            requestId: message.requestId
          });
        } catch (error) {
          logApi.error(`Error getting contest schedules: ${error.message}`, error);
          return sendError(ws, 'Failed to get contest schedules', 5000);
        }
        
      case 'getUserContests':
        // Verify authentication
        if (!ws.isAuthenticated) {
          return sendError(ws, 'Authentication required to get user contests', 4003);
        }
        
        try {
          // Use the imported module function to get user contests
          const userContests = await getAllContestsByUser(ws.userId);
          
          return sendMessage(ws, {
            type: MESSAGE_TYPES.RESPONSE,
            topic: TOPICS.CONTEST, 
            action: 'getUserContests',
            data: userContests,
            requestId: message.requestId
          });
        } catch (error) {
          logApi.error(`Error getting user contests: ${error.message}`, error);
          return sendError(ws, 'Failed to get user contests', 5000);
        }
      
      default:
        return sendError(ws, `Unknown contest action: ${message.action}`, 4009);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Contest request error:${fancyColors.RESET}`, {
      error: error.message,
      stack: error.stack,
      topic: message.topic,
      action: message.action,
      data: message.data
    });
    return sendError(ws, `Contest request error: ${error.message}`, 5000);
  }
}

/**
 * Handle contest chat related requests
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message (expects topic: 'contest-chat', action: 'GET_MESSAGES', data: { contest_id: number })
 * @param {Function} sendMessage - Function to send messages
 * @param {Function} sendError - Function to send errors
 */
async function handleContestChatRequest(ws, message, sendMessage, sendError) {
  if (message.action !== DDWebSocketActions.GET_MESSAGES && message.action !== 'GET_MESSAGES' && message.action !== 'getMessages') {
    return sendError(ws, `Unknown action for contest-chat: ${message.action}`, 4009);
  }

  const contestId = message.data?.contest_id;
  if (!contestId || typeof contestId !== 'number') {
    return sendError(ws, 'Numeric contest_id is required in message.data', 4006);
  }

  try {
    // 1. Fetch contest participants
    const participantsData = await prisma.contest_participants.findMany({
      where: { contest_id: contestId },
      include: {
        users: {
          select: {
            id: true,
            wallet_address: true, // Keep wallet_address as it is the true user_id in many contexts
            nickname: true,
            role: true,
          },
        },
      },
    });

    const participants = participantsData.map(p => ({
      user_id: p.users.wallet_address, // Using wallet_address as the user_id as per typical frontend expectation
      username: p.users.nickname || p.users.wallet_address.substring(0, 6) + '...', // Fallback for username
      role: p.users.role,
      // Add any other relevant participant info needed for display directly from p.users or p itself
    }));    

    // 2. Fetch chat messages for the contest
    const messagesData = await prisma.contest_chat_messages.findMany({
      where: { contest_id: contestId },
      orderBy: { created_at: 'asc' }, // Oldest messages first
      take: 100, // Limit to the latest 100 messages, adjust as needed
      include: {
        sender: {
          select: {
            id: true, 
            wallet_address: true,
            nickname: true,
            role: true,
          },
        },
      },
    });

    const messages = messagesData.map(msg => ({
      id: msg.id.toString(), // Message ID
      contest_id: msg.contest_id,
      sender: {
        user_id: msg.sender.wallet_address, // Using wallet_address as the user_id
        username: msg.sender.nickname || msg.sender.wallet_address.substring(0, 6) + '...', // Fallback for username
        role: msg.sender.role,
      },
      text: msg.message_text,
      timestamp: msg.created_at.toISOString(),
    }));

    // 3. Send the response
    sendMessage(ws, {
      type: MESSAGE_TYPES.RESPONSE,
      topic: TOPICS.CONTEST_CHAT,
      action: message.action, // Echo back the action
      requestId: message.requestId, // Echo back requestId if present
      data: {
        contest_id: contestId,
        messages: messages,
        participants: participants,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logApi.error(`${wsColors.tag}[request-handlers]${fancyColors.RESET} ${fancyColors.RED}Error in handleContestChatRequest for contest ${contestId}:${fancyColors.RESET}`, error);
    sendError(ws, `Error fetching contest chat data: ${error.message}`, 5000);
  }
}