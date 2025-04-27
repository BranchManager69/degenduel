// websocket/v69/unified/modules/solana-balance-module.js

/**
 * Solana Balance WebSocket Module
 * 
 * Handles Solana SOL balance requests for the unified WebSocket system.
 * Works with the Helius Balance Tracker to provide real-time SOL balance updates.
 */

import { logApi } from '../../../../utils/logger-suite/logger.js';
import { fancyColors, wsColors } from '../../../../utils/colors.js';
import { heliusBalanceTracker } from '../../../../services/solana-engine/helius-balance-tracker.js';
import marketDataService from '../../../../services/market-data/marketDataService.js';
import { rateLimiter } from './rate-limiter.js';
import { MESSAGE_TYPES, TOPICS } from '../utils.js';

/**
 * Handle Solana balance operation
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Object} clientInfo - Client authentication info
 * @returns {Promise<void>}
 */
export async function handleOperation(ws, message, clientInfo) {
  // Get wallet address from message or authenticated user
  const walletAddress = message.walletAddress || clientInfo.userId;
  
  // Only allow access to own wallet balance (security measure)
  if (walletAddress !== clientInfo.userId) {
    message.server.sendError(ws, 'You can only access your own wallet balance', 4003);
    return;
  }
  
  switch (message.action) {
    case 'getSolanaBalance':
    case 'getBalance':
      await getSolanaBalance(ws, walletAddress, message);
      break;
      
    case 'refreshSolanaBalance':
      await refreshSolanaBalance(ws, walletAddress, message);
      break;
      
    case 'subscribe':
      await subscribeToSolanaBalance(ws, walletAddress, message);
      break;
      
    case 'unsubscribe':
      await unsubscribeFromSolanaBalance(ws, walletAddress, message);
      break;
      
    default:
      message.server.sendError(ws, `Unknown action for Solana balance: ${message.action}`, 4009);
  }
}

/**
 * Get Solana balance for wallet
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} walletAddress - Wallet address
 * @param {Object} message - Original message with server functions
 * @returns {Promise<void>}
 */
async function getSolanaBalance(ws, walletAddress, message) {
  try {
    const clientId = ws.clientInfo?.connectionId || 'unknown';
    
    // Fetch SOL balance from Helius balance tracker
    const solanaBalanceData = heliusBalanceTracker.getSolanaBalance(walletAddress);
    
    // Get SOL price - first try cache, then calculate if needed
    let solUsdPrice = rateLimiter.getCachedSolPrice();
    if (!solUsdPrice) {
      solUsdPrice = await getSolanaPrice();
      if (solUsdPrice) {
        rateLimiter.cacheSolPrice(solUsdPrice);
      } else {
        solUsdPrice = 150; // Fallback if calculation fails
      }
    }
    
    // Calculate USD value
    let valueUsd = null;
    if (solanaBalanceData.balance) {
      valueUsd = Number(solanaBalanceData.balance) * solUsdPrice;
    }
    
    // Add data freshness indicator
    const dataAge = Date.now() - solanaBalanceData.lastUpdated;
    const freshness = dataAge < 15000 ? 'fresh' : // Less than 15s
                      dataAge < 60000 ? 'recent' : // Less than 1m 
                      dataAge < 300000 ? 'stale' : // Less than 5m
                      'outdated'; // More than 5m
    
    // Send SOL balance data
    message.server.sendMessage(ws, {
      type: MESSAGE_TYPES.DATA,
      topic: TOPICS.WALLET_BALANCE,
      subtype: 'solana',
      action: 'solanaBalance',
      requestId: message.requestId,
      data: {
        wallet_address: walletAddress,
        balance: Number(solanaBalanceData.balance),
        value_usd: valueUsd,
        last_updated: solanaBalanceData.lastUpdated,
        last_updated_relative: Math.floor(dataAge / 1000), // Seconds since last update
        freshness: freshness,
        symbol: 'SOL',
        sol_price_usd: solUsdPrice
      },
      timestamp: new Date().toISOString()
    });
    
    // If balance is older than 30 seconds, trigger a refresh in the background
    // but only if we haven't refreshed recently
    if (dataAge > 30000) {
      refreshSolanaBalanceInBackground(walletAddress);
    }
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[solana-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error getting SOL balance:${fancyColors.RESET}`, error);
    message.server.sendError(ws, 'Error fetching SOL balance', 5004);
  }
}

/**
 * Refresh Solana balance for wallet
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} walletAddress - Wallet address
 * @param {Object} message - Original message with server functions
 * @returns {Promise<void>}
 */
async function refreshSolanaBalance(ws, walletAddress, message) {
  try {
    const clientId = ws.clientInfo?.connectionId || 'unknown';
    
    // Apply rate limiting
    if (!rateLimiter.canRefreshBalance(walletAddress)) {
      message.server.sendError(ws, 'Rate limit exceeded for balance refresh. Please try again in a few seconds.', 4290);
      return;
    }
    
    // Force refresh SOL balance from Helius balance tracker
    const newBalance = await heliusBalanceTracker.refreshSolanaBalance(walletAddress);
    
    // Get SOL price - first try cache, then calculate if needed
    let solUsdPrice = rateLimiter.getCachedSolPrice();
    if (!solUsdPrice) {
      solUsdPrice = await getSolanaPrice();
      if (solUsdPrice) {
        rateLimiter.cacheSolPrice(solUsdPrice);
      } else {
        solUsdPrice = 150; // Fallback if calculation fails
      }
    }
    
    // Calculate USD value
    let valueUsd = null;
    if (newBalance) {
      valueUsd = Number(newBalance) * solUsdPrice;
    }
    
    // Send refreshed SOL balance data
    message.server.sendMessage(ws, {
      type: MESSAGE_TYPES.DATA,
      topic: TOPICS.WALLET_BALANCE,
      subtype: 'solana',
      action: 'solanaBalance',
      requestId: message.requestId,
      data: {
        wallet_address: walletAddress,
        balance: Number(newBalance),
        value_usd: valueUsd,
        last_updated: Date.now(),
        last_updated_relative: 0, // Just updated now
        freshness: 'fresh',
        symbol: 'SOL',
        sol_price_usd: solUsdPrice,
        refreshed: true
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[solana-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error refreshing SOL balance:${fancyColors.RESET}`, error);
    message.server.sendError(ws, 'Error refreshing SOL balance', 5004);
  }
}

/**
 * Subscribe to Solana balance updates
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} walletAddress - Wallet address
 * @param {Object} message - Original message with server functions
 * @returns {Promise<void>}
 */
async function subscribeToSolanaBalance(ws, walletAddress, message) {
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
        // Get SOL price - first try cache, then calculate if needed
        let solUsdPrice = rateLimiter.getCachedSolPrice();
        if (!solUsdPrice) {
          solUsdPrice = await getSolanaPrice();
          if (solUsdPrice) {
            rateLimiter.cacheSolPrice(solUsdPrice);
          } else {
            solUsdPrice = 150; // Fallback if calculation fails
          }
        }
        
        // Calculate USD value
        let valueUsd = null;
        if (balanceData.balance) {
          valueUsd = Number(balanceData.balance) * solUsdPrice;
        }
        
        // Calculate age of data
        const dataAge = Date.now() - balanceData.lastUpdated;
        const freshness = dataAge < 15000 ? 'fresh' : // Less than 15s
                          dataAge < 60000 ? 'recent' : // Less than 1m 
                          dataAge < 300000 ? 'stale' : // Less than 5m
                          'outdated'; // More than 5m
        
        // Send SOL balance update
        message.server.sendMessage(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.WALLET_BALANCE,
          subtype: 'solana',
          action: 'solanaBalanceUpdate',
          data: {
            wallet_address: balanceData.walletAddress,
            balance: Number(balanceData.balance),
            old_balance: Number(balanceData.oldBalance),
            value_usd: valueUsd,
            last_updated: balanceData.lastUpdated,
            last_updated_relative: Math.floor(dataAge / 1000), // Seconds since last update
            freshness: freshness,
            source: balanceData.source,
            symbol: 'SOL',
            sol_price_usd: solUsdPrice
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logApi.error(`${wsColors.tag}[solana-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error in balance update handler:${fancyColors.RESET}`, error);
      }
    };
    
    // Store handler reference on WebSocket for cleanup on disconnect
    if (!ws.solanaBalanceHandlers) {
      ws.solanaBalanceHandlers = new Map();
    }
    ws.solanaBalanceHandlers.set(walletAddress, balanceHandler);
    
    // Subscribe to SOL balance updates
    await heliusBalanceTracker.subscribeSolanaBalance(walletAddress, balanceHandler);
    
    // Send acknowledgment
    message.server.sendMessage(ws, {
      type: MESSAGE_TYPES.ACKNOWLEDGMENT,
      topic: TOPICS.WALLET_BALANCE,
      subtype: 'solana',
      action: 'subscribe',
      requestId: message.requestId,
      data: {
        wallet_address: walletAddress,
        subscribed: true
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[solana-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error subscribing to SOL balance:${fancyColors.RESET}`, error);
    message.server.sendError(ws, 'Error subscribing to SOL balance', 5005);
  }
}

/**
 * Unsubscribe from Solana balance updates
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} walletAddress - Wallet address
 * @param {Object} message - Original message with server functions
 * @returns {Promise<void>}
 */
async function unsubscribeFromSolanaBalance(ws, walletAddress, message) {
  try {
    const clientId = ws.clientInfo?.connectionId || 'unknown';
    
    // Get handler from WebSocket
    if (ws.solanaBalanceHandlers && ws.solanaBalanceHandlers.has(walletAddress)) {
      const handler = ws.solanaBalanceHandlers.get(walletAddress);
      
      // Unsubscribe from SOL balance updates
      await heliusBalanceTracker.unsubscribeSolanaBalance(walletAddress, handler);
      
      // Remove handler reference
      ws.solanaBalanceHandlers.delete(walletAddress);
      
      // Update subscription count in rate limiter
      rateLimiter.removeSubscription(clientId);
    }
    
    // Send acknowledgment
    message.server.sendMessage(ws, {
      type: MESSAGE_TYPES.ACKNOWLEDGMENT,
      topic: TOPICS.WALLET_BALANCE,
      subtype: 'solana',
      action: 'unsubscribe',
      requestId: message.requestId,
      data: {
        wallet_address: walletAddress,
        subscribed: false
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[solana-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error unsubscribing from SOL balance:${fancyColors.RESET}`, error);
    message.server.sendError(ws, 'Error unsubscribing from SOL balance', 5006);
  }
}

/**
 * Refresh Solana balance in background
 * @param {string} walletAddress - Wallet address
 * @returns {Promise<void>}
 */
async function refreshSolanaBalanceInBackground(walletAddress) {
  try {
    // Apply rate limiting even for background updates
    if (!rateLimiter.canRefreshBalance(walletAddress)) {
      // Just silently return if rate limited (it's a background task)
      return;
    }
    
    await heliusBalanceTracker.refreshSolanaBalance(walletAddress);
    logApi.debug(`${wsColors.tag}[solana-balance-module]${fancyColors.RESET} ${fancyColors.GREEN}Refreshed SOL balance in background:${fancyColors.RESET} ${walletAddress}`);
  } catch (error) {
    logApi.error(`${wsColors.tag}[solana-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error refreshing SOL balance in background:${fancyColors.RESET}`, error);
  }
}

/**
 * Get Solana price in USD from pool data
 * @returns {Promise<number|null>} SOL price in USD or null if not found
 */
async function getSolanaPrice() {
  try {
    // First check for SOL/USDC or SOL/USDT pools in market data service
    const topSOLPools = await marketDataService.getTopPoolsBySymbol('SOL');
    
    if (topSOLPools && topSOLPools.length > 0) {
      // Find SOL/USD or SOL/USDC pools
      const solUsdPool = topSOLPools.find(p => 
        (p.baseSymbol.toLowerCase() === 'sol' && ['usdc', 'usdt'].includes(p.quoteSymbol.toLowerCase())) ||
        (p.quoteSymbol.toLowerCase() === 'sol' && ['usdc', 'usdt'].includes(p.baseSymbol.toLowerCase()))
      );
      
      if (solUsdPool) {
        // Calculate price based on pool format
        if (solUsdPool.baseSymbol.toLowerCase() === 'sol') {
          return solUsdPool.priceUsd;
        } else {
          // If SOL is the quote, then price is 1/priceUsd
          return 1 / solUsdPool.priceUsd;
        }
      }
    }
    
    // If no direct SOL/USD pool, try to derive from token pool data
    const allTopPools = await marketDataService.getTopPools(10);
    
    if (allTopPools && allTopPools.length > 0) {
      // Find pools with SOL as the quote currency
      const solQuotePools = allTopPools.filter(p => 
        p.quoteSymbol.toLowerCase() === 'sol' && p.baseReserve && p.quoteReserve
      );
      
      if (solQuotePools.length > 0) {
        // Sort by liquidity to use the most liquid pool
        solQuotePools.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
        
        const pool = solQuotePools[0];
        if (pool.quoteReserve && pool.priceUsd && pool.baseReserve) {
          const tokenValueUsd = pool.baseReserve * pool.priceUsd;
          const totalLiquidityUsd = pool.liquidityUsd || 2 * tokenValueUsd; // Estimate if not provided
          const solValueUsd = totalLiquidityUsd - tokenValueUsd;
          
          // Calculate SOL price from reserves
          const solPrice = solValueUsd / pool.quoteReserve;
          
          // Sanity check - if too far from expected range, use fallback
          if (solPrice > 50 && solPrice < 500) {
            logApi.debug(`${wsColors.tag}[solana-balance-module]${fancyColors.RESET} ${fancyColors.GREEN}Calculated SOL Price:${fancyColors.RESET} $${solPrice.toFixed(2)} from ${pool.baseSymbol}/${pool.quoteSymbol} pool`);
            return solPrice;
          }
        }
      }
    }
    
    // If unable to calculate, use the default fallback
    return 150;
  } catch (error) {
    logApi.error(`${wsColors.tag}[solana-balance-module]${fancyColors.RESET} ${fancyColors.RED}Error calculating SOL price:${fancyColors.RESET}`, error);
    return 150; // Fallback to default
  }
}

// Export the module
export default { handleOperation };