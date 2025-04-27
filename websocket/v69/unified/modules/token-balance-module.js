// websocket/v69/unified/modules/token-balance-module.js

/**
 * Token Balance WebSocket Module
 * 
 * Handles token balance requests for the unified WebSocket system.
 * Works with the Helius Balance Tracker to provide real-time token balance updates.
 */

import { logApi } from '../../../../utils/logger-suite/logger.js';
import { fancyColors, wsColors } from '../../../../utils/colors.js';
import { heliusBalanceTracker } from '../../../../services/solana-engine/helius-balance-tracker.js';
import { getTokenAddress } from '../../../../utils/token-config-util.js';
import marketDataService from '../../../../services/market-data/marketDataService.js';
import { rateLimiter } from './rate-limiter.js';
import { MESSAGE_TYPES, TOPICS } from '../utils.js';

/**
 * Handle token balance operation
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Object} clientInfo - Client authentication info
 * @returns {Promise<void>}
 */
export async function handleOperation(ws, message, clientInfo) {
  // Get the token address
  let tokenAddress = message.tokenAddress;
  
  // If not provided, get the default token address
  if (!tokenAddress) {
    tokenAddress = await getTokenAddress();
    
    if (!tokenAddress) {
      message.server.sendError(ws, 'Token address is required', 4008);
      return;
    }
  }
  
  // Get wallet address from message or authenticated user
  const walletAddress = message.walletAddress || clientInfo.userId;
  
  // Only allow access to own wallet balance (security measure)
  if (walletAddress !== clientInfo.userId) {
    message.server.sendError(ws, 'You can only access your own wallet balance', 4003);
    return;
  }
  
  switch (message.action) {
    case 'getTokenBalance':
    case 'getBalance':
      await getTokenBalance(ws, walletAddress, tokenAddress, message);
      break;
      
    case 'refreshTokenBalance':
      await refreshTokenBalance(ws, walletAddress, tokenAddress, message);
      break;
      
    case 'subscribe':
      await subscribeToTokenBalance(ws, walletAddress, tokenAddress, message);
      break;
      
    case 'unsubscribe':
      await unsubscribeFromTokenBalance(ws, walletAddress, tokenAddress, message);
      break;
      
    default:
      message.server.sendError(ws, `Unknown action for token balance: ${message.action}`, 4009);
  }
}

/**
 * Get token balance for wallet
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} walletAddress - Wallet address
 * @param {string} tokenAddress - Token address
 * @param {Object} message - Original message with server functions
 * @returns {Promise<void>}
 */
async function getTokenBalance(ws, walletAddress, tokenAddress, message) {
  try {
    const clientId = ws.clientInfo?.connectionId || 'unknown';
    
    // Fetch token balance from Helius balance tracker
    const tokenBalanceData = heliusBalanceTracker.getTokenBalance(walletAddress, tokenAddress);
    
    // Fetch token metadata
    const tokenMetadata = await getTokenMetadata(tokenAddress);
    
    // Calculate USD value if price available
    let valueUsd = null;
    if (tokenMetadata?.price_usd && tokenBalanceData.balance) {
      valueUsd = Number(tokenBalanceData.balance) * Number(tokenMetadata.price_usd);
    }
    
    // Add data freshness indicator
    const dataAge = Date.now() - tokenBalanceData.lastUpdated;
    const freshness = dataAge < 15000 ? 'fresh' : // Less than 15s
                      dataAge < 60000 ? 'recent' : // Less than 1m 
                      dataAge < 300000 ? 'stale' : // Less than 5m
                      'outdated'; // More than 5m
    
    // Send token balance data
    message.server.sendMessage(ws, {
      type: MESSAGE_TYPES.DATA,
      topic: TOPICS.WALLET_BALANCE,
      subtype: 'token',
      action: 'tokenBalance',
      requestId: message.requestId,
      data: {
        wallet_address: walletAddress,
        token_address: tokenAddress,
        symbol: tokenMetadata?.symbol || 'Unknown',
        balance: Number(tokenBalanceData.balance),
        decimals: tokenMetadata?.decimals || 9,
        value_usd: valueUsd,
        last_updated: tokenBalanceData.lastUpdated,
        last_updated_relative: Math.floor(dataAge / 1000), // Seconds since last update
        freshness: freshness,
        logo_uri: tokenMetadata?.logo_uri || null,
        price_usd: tokenMetadata?.price_usd || null
      },
      timestamp: new Date().toISOString()
    });
    
    // If balance is older than 30 seconds, trigger a refresh in the background
    if (dataAge > 30000) {
      refreshTokenBalanceInBackground(walletAddress, tokenAddress);
    }
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[token-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error getting token balance:${fancyColors.RESET}`, error);
    message.server.sendError(ws, 'Error fetching token balance', 5004);
  }
}

/**
 * Refresh token balance for wallet
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} walletAddress - Wallet address
 * @param {string} tokenAddress - Token address
 * @param {Object} message - Original message with server functions
 * @returns {Promise<void>}
 */
async function refreshTokenBalance(ws, walletAddress, tokenAddress, message) {
  try {
    const clientId = ws.clientInfo?.connectionId || 'unknown';
    
    // Apply rate limiting
    if (!rateLimiter.canRefreshBalance(walletAddress)) {
      message.server.sendError(ws, 'Rate limit exceeded for balance refresh. Please try again in a few seconds.', 4290);
      return;
    }
    
    // Force refresh token balance from Helius balance tracker
    const newBalance = await heliusBalanceTracker.refreshTokenBalance(walletAddress, tokenAddress);
    
    // Fetch token metadata
    const tokenMetadata = await getTokenMetadata(tokenAddress);
    
    // Calculate USD value if price available
    let valueUsd = null;
    if (tokenMetadata?.price_usd && newBalance) {
      valueUsd = Number(newBalance) * Number(tokenMetadata.price_usd);
    }
    
    // Send refreshed token balance data
    message.server.sendMessage(ws, {
      type: MESSAGE_TYPES.DATA,
      topic: TOPICS.WALLET_BALANCE,
      subtype: 'token',
      action: 'tokenBalance',
      requestId: message.requestId,
      data: {
        wallet_address: walletAddress,
        token_address: tokenAddress,
        symbol: tokenMetadata?.symbol || 'Unknown',
        balance: Number(newBalance),
        decimals: tokenMetadata?.decimals || 9,
        value_usd: valueUsd,
        last_updated: Date.now(),
        last_updated_relative: 0, // Just updated now
        freshness: 'fresh',
        logo_uri: tokenMetadata?.logo_uri || null,
        price_usd: tokenMetadata?.price_usd || null,
        refreshed: true
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[token-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error refreshing token balance:${fancyColors.RESET}`, error);
    message.server.sendError(ws, 'Error refreshing token balance', 5004);
  }
}

/**
 * Subscribe to token balance updates
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} walletAddress - Wallet address
 * @param {string} tokenAddress - Token address
 * @param {Object} message - Original message with server functions
 * @returns {Promise<void>}
 */
async function subscribeToTokenBalance(ws, walletAddress, tokenAddress, message) {
  try {
    const clientId = ws.clientInfo?.connectionId || 'unknown';
    
    // Apply rate limiting for subscriptions
    if (!rateLimiter.canCreateSubscription(clientId)) {
      message.server.sendError(ws, 'Subscription limit exceeded. Please try again later.', 4291);
      return;
    }
    
    // Create balance update handler for this WebSocket
    const balanceHandler = async (balanceData) => {
      try {
        // Fetch token metadata for updates since we need price info
        const tokenMetadata = await getTokenMetadata(balanceData.tokenAddress);
        
        // Calculate USD value if price available
        let valueUsd = null;
        if (tokenMetadata?.price_usd && balanceData.balance) {
          valueUsd = Number(balanceData.balance) * Number(tokenMetadata.price_usd);
        }
        
        // Calculate age of data
        const dataAge = Date.now() - balanceData.lastUpdated;
        const freshness = dataAge < 15000 ? 'fresh' : // Less than 15s
                          dataAge < 60000 ? 'recent' : // Less than 1m 
                          dataAge < 300000 ? 'stale' : // Less than 5m
                          'outdated'; // More than 5m
        
        // Send token balance update
        message.server.sendMessage(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.WALLET_BALANCE,
          subtype: 'token',
          action: 'tokenBalanceUpdate',
          data: {
            wallet_address: balanceData.walletAddress,
            token_address: balanceData.tokenAddress,
            symbol: tokenMetadata?.symbol || 'Unknown',
            balance: Number(balanceData.balance),
            old_balance: Number(balanceData.oldBalance),
            decimals: tokenMetadata?.decimals || 9,
            value_usd: valueUsd,
            last_updated: balanceData.lastUpdated,
            last_updated_relative: Math.floor(dataAge / 1000), // Seconds since last update
            freshness: freshness,
            logo_uri: tokenMetadata?.logo_uri || null,
            price_usd: tokenMetadata?.price_usd || null,
            source: balanceData.source
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logApi.error(`${wsColors.tag}[token-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error in balance update handler:${fancyColors.RESET}`, error);
      }
    };
    
    // Store handler reference on WebSocket for cleanup on disconnect
    if (!ws.tokenBalanceHandlers) {
      ws.tokenBalanceHandlers = new Map();
    }
    ws.tokenBalanceHandlers.set(`${walletAddress}_${tokenAddress}`, balanceHandler);
    
    // Subscribe to token balance updates
    await heliusBalanceTracker.subscribeTokenBalance(walletAddress, tokenAddress, balanceHandler);
    
    // Send acknowledgment
    message.server.sendMessage(ws, {
      type: MESSAGE_TYPES.ACKNOWLEDGMENT,
      topic: TOPICS.WALLET_BALANCE,
      subtype: 'token',
      action: 'subscribe',
      requestId: message.requestId,
      data: {
        wallet_address: walletAddress,
        token_address: tokenAddress,
        subscribed: true
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[token-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error subscribing to token balance:${fancyColors.RESET}`, error);
    message.server.sendError(ws, 'Error subscribing to token balance', 5005);
  }
}

/**
 * Unsubscribe from token balance updates
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} walletAddress - Wallet address
 * @param {string} tokenAddress - Token address
 * @param {Object} message - Original message with server functions
 * @returns {Promise<void>}
 */
async function unsubscribeFromTokenBalance(ws, walletAddress, tokenAddress, message) {
  try {
    const clientId = ws.clientInfo?.connectionId || 'unknown';
    
    // Get handler from WebSocket
    if (ws.tokenBalanceHandlers && ws.tokenBalanceHandlers.has(`${walletAddress}_${tokenAddress}`)) {
      const handler = ws.tokenBalanceHandlers.get(`${walletAddress}_${tokenAddress}`);
      
      // Unsubscribe from token balance updates
      await heliusBalanceTracker.unsubscribeTokenBalance(walletAddress, tokenAddress, handler);
      
      // Remove handler reference
      ws.tokenBalanceHandlers.delete(`${walletAddress}_${tokenAddress}`);
      
      // Update subscription count in rate limiter
      rateLimiter.removeSubscription(clientId);
    }
    
    // Send acknowledgment
    message.server.sendMessage(ws, {
      type: MESSAGE_TYPES.ACKNOWLEDGMENT,
      topic: TOPICS.WALLET_BALANCE,
      subtype: 'token',
      action: 'unsubscribe',
      requestId: message.requestId,
      data: {
        wallet_address: walletAddress,
        token_address: tokenAddress,
        subscribed: false
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[token-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error unsubscribing from token balance:${fancyColors.RESET}`, error);
    message.server.sendError(ws, 'Error unsubscribing from token balance', 5006);
  }
}

/**
 * Refresh token balance in background
 * @param {string} walletAddress - Wallet address
 * @param {string} tokenAddress - Token address
 * @returns {Promise<void>}
 */
async function refreshTokenBalanceInBackground(walletAddress, tokenAddress) {
  try {
    // Apply rate limiting even for background updates
    if (!rateLimiter.canRefreshBalance(walletAddress)) {
      // Just silently return if rate limited (it's a background task)
      return;
    }
    
    await heliusBalanceTracker.refreshTokenBalance(walletAddress, tokenAddress);
    logApi.debug(`${wsColors.tag}[token-balance-module]${fancyColors.RESET} ${fancyColors.GREEN}Refreshed token balance in background:${fancyColors.RESET} ${walletAddress}, ${tokenAddress}`);
  } catch (error) {
    logApi.error(`${wsColors.tag}[token-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error refreshing token balance in background:${fancyColors.RESET}`, error);
  }
}

/**
 * Get token metadata
 * @param {string} tokenAddress - Token address
 * @returns {Promise<Object|null>} Token metadata
 */
async function getTokenMetadata(tokenAddress) {
  try {
    // Try to get from market data service
    const token = await marketDataService.getTokenByAddress(tokenAddress);
    
    if (token) {
      return {
        symbol: token.symbol,
        decimals: token.decimals || 9,
        price_usd: token.price_usd,
        logo_uri: token.logo_uri || token.logo_url || null
      };
    }
    
    return null;
  } catch (error) {
    logApi.error(`${wsColors.tag}[token-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error getting token metadata:${fancyColors.RESET}`, error);
    return null;
  }
}

// Export the module
export default { handleOperation };