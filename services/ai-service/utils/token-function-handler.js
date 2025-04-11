/**
 * Token Function Handler
 * 
 * This module provides functions for handling token-related function calls
 * in the AI service using the OpenAI Responses API.
 */

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';

/**
 * Token function definitions for the responses API
 */
export const TOKEN_FUNCTIONS = [
  {
    name: "getTokenPrice",
    description: "Get current price and detailed information about a token",
    parameters: {
      type: "object",
      properties: {
        tokenSymbol: {
          type: "string",
          description: "The token symbol to look up (e.g., SOL, BONK, JUP)",
        },
        tokenAddress: {
          type: "string",
          description: "The Solana address of the token (optional if symbol is provided)",
        }
      },
      required: ["tokenSymbol"]
    }
  },
  {
    name: "getTokenPriceHistory",
    description: "Get price history for a token over a specified time period",
    parameters: {
      type: "object",
      properties: {
        tokenSymbol: {
          type: "string",
          description: "The token symbol to look up"
        },
        timeframe: {
          type: "string",
          enum: ["24h", "7d", "30d", "all"],
          description: "Time period for price history"
        }
      },
      required: ["tokenSymbol", "timeframe"]
    }
  },
  {
    name: "getTokenPools",
    description: "Get liquidity pools information for a token",
    parameters: {
      type: "object",
      properties: {
        tokenSymbol: {
          type: "string",
          description: "The token symbol to look up"
        }
      },
      required: ["tokenSymbol"]
    }
  }
];

/**
 * Main function call handler - routes to the appropriate function based on name
 * 
 * @param {Object} functionCall - The function call object from the AI response
 * @returns {Object} - The function response data
 */
export async function handleFunctionCall(functionCall) {
  const functionName = functionCall.function.name;
  const args = functionCall.function.arguments;
  
  logApi.info(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Handling function call: ${functionName}`);
  
  try {
    // Route to the appropriate handler based on function name
    switch (functionName) {
      case "getTokenPrice":
        return await handleGetTokenPrice(args);
      case "getTokenPriceHistory":
        return await handleGetTokenPriceHistory(args);
      case "getTokenPools":
        return await handleGetTokenPools(args);
      default:
        return {
          error: "Unknown function",
          function: functionName
        };
    }
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Function call error:`, error);
    return {
      error: error.message || "Internal error processing function call",
      function: functionName
    };
  }
}

/**
 * Handle getTokenPrice function call
 * 
 * @param {Object} args - Function arguments
 * @returns {Object} - Token price and information
 */
async function handleGetTokenPrice({ tokenSymbol, tokenAddress }) {
  // Find the token in the database
  const token = await findToken(tokenSymbol, tokenAddress);
  
  if (!token) {
    return { 
      error: "Token not found", 
      searched: { symbol: tokenSymbol, address: tokenAddress } 
    };
  }
  
  // Build a rich token info response
  const tokenInfo = {
    // Core fields
    symbol: token.symbol,
    name: token.name,
    address: token.address,
  };
  
  // Dynamically add price data if available
  if (token.token_prices) {
    Object.keys(token.token_prices).forEach(key => {
      // Skip internal Prisma fields
      if (!key.startsWith('_') && key !== 'token_id' && key !== 'tokens') {
        // Format numbers appropriately
        if (typeof token.token_prices[key] === 'bigint' || 
            typeof token.token_prices[key] === 'number' ||
            (typeof token.token_prices[key] === 'object' && token.token_prices[key]?.constructor?.name === 'Decimal')) {
          tokenInfo[key] = formatNumber(token.token_prices[key]);
        } else if (key.includes('_at') && token.token_prices[key] instanceof Date) {
          tokenInfo[key] = token.token_prices[key].toISOString();
        } else if (token.token_prices[key] !== null && token.token_prices[key] !== undefined) {
          tokenInfo[key] = token.token_prices[key].toString();
        }
      }
    });
  }
  
  // Add social links if available
  tokenInfo.social_links = {};
  ['twitter_url', 'telegram_url', 'discord_url', 'website_url'].forEach(field => {
    if (token[field]) {
      const linkType = field.replace('_url', '');
      tokenInfo.social_links[linkType] = token[field];
    }
  });
  
  // Add tags if available
  if (token.tags) {
    try {
      tokenInfo.tags = typeof token.tags === 'string' ? JSON.parse(token.tags) : token.tags;
    } catch (e) {
      tokenInfo.tags = [];
    }
  }
  
  return tokenInfo;
}

/**
 * Handle getTokenPriceHistory function call
 * 
 * @param {Object} args - Function arguments
 * @returns {Object} - Token price history data
 */
async function handleGetTokenPriceHistory({ tokenSymbol, timeframe }) {
  // Find token ID first
  const token = await findToken(tokenSymbol);
  
  if (!token) {
    return { 
      error: "Token not found", 
      searched: { symbol: tokenSymbol } 
    };
  }
  
  // Calculate date range based on timeframe
  const endDate = new Date();
  let startDate;
  
  switch(timeframe) {
    case "24h": 
      startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "7d":
      startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "all":
      startDate = new Date(0); // Beginning of time
      break;
  }
  
  // Get price history using schema relations
  const priceHistory = await prisma.token_price_history.findMany({
    where: {
      token_id: token.id,
      timestamp: { 
        gte: startDate,
        lte: endDate
      }
    },
    orderBy: { timestamp: 'asc' },
    select: {
      price: true,
      timestamp: true,
      source: true
    }
  });
  
  return {
    symbol: token.symbol,
    name: token.name,
    timeframe: timeframe,
    dataPoints: priceHistory.length,
    history: priceHistory.map(entry => ({
      timestamp: entry.timestamp.toISOString(),
      price: entry.price.toString(),
      source: entry.source
    }))
  };
}

/**
 * Handle getTokenPools function call
 * 
 * @param {Object} args - Function arguments
 * @returns {Object} - Token pools information
 */
async function handleGetTokenPools({ tokenSymbol }) {
  // Find token ID first
  const token = await findToken(tokenSymbol);
  
  if (!token) {
    return { 
      error: "Token not found", 
      searched: { symbol: tokenSymbol } 
    };
  }
  
  // Get pools data using schema relations
  const pools = await prisma.token_pools.findMany({
    where: {
      tokenAddress: token.address
    },
    take: 5, // Limit to top 5 pools
    orderBy: { 
      liquidity: 'desc' 
    },
    select: {
      dex: true,
      address: true,
      tokenAddress: true,
      programId: true,
      liquidity: true,
      createdAt: true,
      lastUpdated: true
    }
  });
  
  return {
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    poolCount: pools.length,
    pools: pools.map(pool => ({
      dex: pool.dex,
      address: pool.address,
      liquidity: formatNumber(pool.liquidity),
      program: pool.programId,
      updated: pool.lastUpdated ? pool.lastUpdated.toISOString() : null
    }))
  };
}

/**
 * Helper function to find a token by symbol or address
 * 
 * @param {string} symbol - Token symbol
 * @param {string} address - Token address
 * @returns {Object} - Token data from database
 */
async function findToken(symbol, address) {
  if (address) {
    return prisma.tokens.findUnique({
      where: { address },
      include: { 
        token_prices: true,
        token_socials: true
      }
    });
  } else {
    return prisma.tokens.findFirst({
      where: { 
        symbol: { equals: symbol, mode: 'insensitive' },
        is_active: true
      },
      include: { 
        token_prices: true,
        token_socials: true
      }
    });
  }
}

/**
 * Helper to format large numbers for readability
 * 
 * @param {number|string|BigInt} num - The number to format
 * @returns {string} - Formatted number string
 */
function formatNumber(num) {
  if (!num) return "Unknown";
  
  // Convert to number if it's not already
  const value = typeof num === 'string' ? parseFloat(num) : Number(num);
  
  if (isNaN(value)) return "Unknown";
  
  // Format based on size
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}