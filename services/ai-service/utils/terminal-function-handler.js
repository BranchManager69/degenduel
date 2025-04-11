/**
 * Token Function Handler
 * 
 * This module provides functions for handling token-related function calls
 * in the AI service using the OpenAI Responses API.
 */

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';

// Import additional functions
import {
  handleGetTokenMetricsHistory,
  handleGetPlatformActivity,
  handleGetServiceStatus,
  handleGetSystemSettings,
  handleGetWebSocketStats,
  handleGetIPBanStatus,
  handleGetDiscordWebhookEvents
} from './additional-functions.js';

/**
 * Function definitions for the terminal responses API
 */
export const TERMINAL_FUNCTIONS = [
  // Token data functions - available to all users
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
  },
  {
    name: "getTokenMetricsHistory",
    description: "Get comprehensive historical metrics for a token over time",
    parameters: {
      type: "object",
      properties: {
        tokenSymbol: { 
          type: "string",
          description: "The token symbol to look up"
        },
        metricType: { 
          type: "string", 
          enum: ["price", "rank", "volume", "liquidity", "market_cap"],
          description: "The type of metric to retrieve"
        },
        timeframe: { 
          type: "string", 
          enum: ["24h", "7d", "30d", "all"],
          description: "Time period for metrics history"
        },
        limit: {
          type: "integer",
          description: "Maximum number of data points to return",
          default: 50
        }
      },
      required: ["tokenSymbol", "metricType"]
    }
  },
  
  // Contest functions - available to all users
  {
    name: "getActiveContests",
    description: "Get information about currently active contests",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Maximum number of contests to return (default: 5)",
          default: 5
        },
        includeUpcoming: {
          type: "boolean",
          description: "Whether to include upcoming contests (default: true)",
          default: true
        }
      }
    }
  },
  
  // User profile functions - available to all users
  {
    name: "getUserProfile",
    description: "Get detailed profile information about a user",
    parameters: {
      type: "object",
      properties: {
        usernameOrWallet: {
          type: "string",
          description: "Username or wallet address of the user"
        }
      },
      required: ["usernameOrWallet"]
    }
  },
  {
    name: "getTopUsers",
    description: "Get leaderboard of top users by different metrics",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["contests_won", "earnings", "experience", "referrals"],
          description: "Category to rank users by"
        },
        limit: {
          type: "integer",
          description: "Number of users to return",
          default: 10
        }
      },
      required: ["category"]
    }
  },
  {
    name: "getUserContestHistory",
    description: "Get a user's contest participation history",
    parameters: {
      type: "object",
      properties: {
        usernameOrWallet: {
          type: "string",
          description: "Username or wallet address"
        },
        limit: {
          type: "integer",
          description: "Maximum number of contests to return",
          default: 5
        }
      },
      required: ["usernameOrWallet"]
    }
  },
  
  // Platform activity functions - available to all users
  {
    name: "getPlatformActivity",
    description: "Get recent platform-wide activity (transactions, contests, achievements)",
    parameters: {
      type: "object",
      properties: {
        activityType: { 
          type: "string", 
          enum: ["contests", "trades", "achievements", "transactions"],
          description: "Type of activity to retrieve"
        },
        limit: { 
          type: "integer", 
          description: "Maximum number of activities to return",
          default: 10 
        }
      },
      required: ["activityType"]
    }
  },
  
  // Service and system functions - admin/superadmin only
  {
    name: "getServiceStatus",
    description: "[ADMIN] Get status of platform services",
    parameters: {
      type: "object",
      properties: {
        serviceName: { 
          type: "string", 
          description: "Specific service to check (optional)"
        }
      }
    }
  },
  {
    name: "getSystemSettings",
    description: "[ADMIN] Get current platform system settings",
    parameters: {
      type: "object",
      properties: {
        settingKey: { 
          type: "string", 
          description: "Specific setting to retrieve (optional)"
        }
      }
    }
  },
  {
    name: "getWebSocketStats",
    description: "[ADMIN] Get WebSocket connection statistics",
    parameters: {
      type: "object",
      properties: {
        timeframe: { 
          type: "string", 
          enum: ["now", "today", "week"],
          description: "Time period for connection statistics" 
        }
      },
      required: ["timeframe"]
    }
  },
  {
    name: "getIPBanStatus",
    description: "[ADMIN] Get information about banned IPs",
    parameters: {
      type: "object",
      properties: {
        ipAddress: { 
          type: "string", 
          description: "Specific IP to check (optional)"
        },
        limit: { 
          type: "integer", 
          description: "Maximum number of banned IPs to return",
          default: 10 
        }
      }
    }
  },
  {
    name: "getDiscordWebhookEvents",
    description: "[ADMIN] Get recent Discord notification events",
    parameters: {
      type: "object",
      properties: {
        eventType: { 
          type: "string",
          enum: ["contest_start", "contest_end", "new_user", "achievement"],
          description: "Type of Discord event to retrieve"
        },
        limit: { 
          type: "integer", 
          description: "Maximum number of events to return",
          default: 5 
        }
      }
    }
  }
];

/**
 * Main function call handler - routes to the appropriate function based on name
 * 
 * @param {Object} functionCall - The function call object from the AI response
 * @returns {Object} - The function response data
 */
export async function handleFunctionCall(functionCall, options = {}) {
  const functionName = functionCall.function.name;
  const argsRaw = functionCall.function.arguments;
  
  // Parse arguments if they're a string
  let args;
  try {
    args = typeof argsRaw === 'string' ? JSON.parse(argsRaw) : argsRaw;
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error parsing function arguments:`, error);
    args = {}; // Default to empty object if parsing fails
  }
  
  // Check if user has admin privileges for admin-only functions
  const isAdminFunction = functionName.startsWith('get') && (
    functionName === 'getServiceStatus' ||
    functionName === 'getSystemSettings' ||
    functionName === 'getWebSocketStats' ||
    functionName === 'getIPBanStatus' ||
    functionName === 'getDiscordWebhookEvents'
  );
  
  const userRole = options.userRole || 'user';
  const isAdmin = userRole === 'admin' || userRole === 'superadmin';
  
  if (isAdminFunction && !isAdmin) {
    return {
      error: "Permission denied",
      details: "This function requires admin privileges",
      function: functionName
    };
  }
  
  logApi.info(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Handling function call: ${functionName} (user role: ${userRole})`);
  
  try {
    // Route to the appropriate handler based on function name
    switch (functionName) {
      // Token data functions
      case "getTokenPrice":
        return await handleGetTokenPrice(args);
      case "getTokenPriceHistory":
        return await handleGetTokenPriceHistory(args);
      case "getTokenPools":
        return await handleGetTokenPools(args);
      case "getTokenMetricsHistory":
        return await handleGetTokenMetricsHistory(args);
        
      // Contest functions  
      case "getActiveContests":
        return await handleGetActiveContests(args);
        
      // User profile functions
      case "getUserProfile":
        return await handleGetUserProfile(args);
      case "getTopUsers":
        return await handleGetTopUsers(args);
      case "getUserContestHistory":
        return await handleGetUserContestHistory(args);
        
      // Platform activity functions
      case "getPlatformActivity":
        return await handleGetPlatformActivity(args);
        
      // Admin-only functions
      case "getServiceStatus":
        return await handleGetServiceStatus(args, options);
      case "getSystemSettings":
        return await handleGetSystemSettings(args, options);
      case "getWebSocketStats":
        return await handleGetWebSocketStats(args, options);
      case "getIPBanStatus":
        return await handleGetIPBanStatus(args, options);
      case "getDiscordWebhookEvents":
        return await handleGetDiscordWebhookEvents(args, options);
        
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
  
  // Add monitored status if available
  if (token.monitored_tokens) {
    tokenInfo.is_monitored = true;
    tokenInfo.monitor_buys = token.monitored_tokens.monitor_buys;
    tokenInfo.monitor_sells = token.monitored_tokens.monitor_sells;
    tokenInfo.min_transaction_value = token.monitored_tokens.min_transaction_value?.toString();
  } else {
    tokenInfo.is_monitored = false;
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
    select: {
      dex: true,
      address: true,
      tokenAddress: true,
      programId: true,
      dataSize: true,
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
      size: pool.dataSize,
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
        token_socials: true,
        monitored_tokens: true
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
        token_socials: true,
        monitored_tokens: true
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
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return `${value.toFixed(2)}`;
}

/**
 * Handle getActiveContests function call
 * 
 * @param {Object} args - Function arguments
 * @returns {Object} - Active contests information
 */
async function handleGetActiveContests({ limit = 5, includeUpcoming = true }) {
  try {
    // Get current date
    const now = new Date();
    
    // Build query for active contests
    const whereClause = {
      OR: [
        { status: 'active' }, // Currently active contests
      ]
    };
    
    // Include upcoming contests if requested
    if (includeUpcoming) {
      whereClause.OR.push({
        status: 'pending',
        start_time: {
          gte: now
        }
      });
    }
    
    // Query for contests
    const contests = await prisma.contests.findMany({
      where: whereClause,
      orderBy: [
        { status: 'asc' }, // Active first, then pending
        { start_time: 'asc' } // Soonest starting first
      ],
      take: limit,
      select: {
        id: true,
        contest_code: true,
        name: true,
        description: true,
        image_url: true,
        start_time: true,
        end_time: true,
        entry_fee: true,
        prize_pool: true,
        current_prize_pool: true,
        status: true,
        participant_count: true,
        min_participants: true,
        max_participants: true
      }
    });
    
    // Format the results
    return {
      count: contests.length,
      contests: contests.map(contest => ({
        name: contest.name,
        code: contest.contest_code,
        description: contest.description || 'No description available',
        status: contest.status,
        start: contest.start_time.toISOString(),
        end: contest.end_time.toISOString(),
        entryFee: contest.entry_fee.toString(),
        prizePool: formatNumber(contest.prize_pool),
        participants: {
          current: contest.participant_count,
          min: contest.min_participants,
          max: contest.max_participants || 'Unlimited'
        },
        // Format time to start/end in human readable format
        timeInfo: getContestTimeInfo(contest)
      }))
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching active contests:`, error);
    return {
      error: "Failed to fetch contest information",
      details: error.message
    };
  }
}

/**
 * Get human-readable time information for a contest
 */
function getContestTimeInfo(contest) {
  const now = new Date();
  const startTime = new Date(contest.start_time);
  const endTime = new Date(contest.end_time);
  
  if (contest.status === 'active') {
    // Contest is active, calculate time remaining
    const timeRemainingMs = endTime - now;
    const hoursRemaining = Math.floor(timeRemainingMs / (1000 * 60 * 60));
    const minutesRemaining = Math.floor((timeRemainingMs % (1000 * 60 * 60)) / (1000 * 60));
    
    return `Active - Ends in ${hoursRemaining}h ${minutesRemaining}m`;
  } else if (contest.status === 'pending') {
    // Contest is upcoming, calculate time until start
    const timeUntilStartMs = startTime - now;
    const hoursUntilStart = Math.floor(timeUntilStartMs / (1000 * 60 * 60));
    const minutesUntilStart = Math.floor((timeUntilStartMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hoursUntilStart < 24) {
      return `Starting in ${hoursUntilStart}h ${minutesUntilStart}m`;
    } else {
      const daysUntilStart = Math.floor(hoursUntilStart / 24);
      return `Starting in ${daysUntilStart} days`;
    }
  }
  
  return contest.status;
}

/**
 * Handle getUserProfile function call
 * 
 * @param {Object} args - Function arguments
 * @returns {Object} - User profile information
 */
async function handleGetUserProfile({ usernameOrWallet }) {
  try {
    // Determine if input is a wallet address or username
    const isWalletAddress = usernameOrWallet.length >= 32 && usernameOrWallet.length <= 44;
    
    // Build the query
    const whereClause = isWalletAddress 
      ? { wallet_address: usernameOrWallet } 
      : { username: usernameOrWallet };
    
    // Query for user
    const user = await prisma.users.findFirst({
      where: whereClause,
      include: {
        user_stats: true,
        user_level: true,
        user_achievements: {
          take: 10,
          orderBy: { achieved_at: 'desc' }
        },
        social_profiles: true,
        wallet_balances: {
          take: 1,
          orderBy: { timestamp: 'desc' }
        }
      }
    });
    
    if (!user) {
      return {
        error: "User not found",
        searched: { usernameOrWallet }
      };
    }
    
    // Build response with rich user data
    const userProfile = {
      username: user.username || 'Anonymous',
      nickname: user.nickname || user.username || 'Anonymous',
      wallet_address: user.wallet_address,
      role: user.role,
      level: user.user_level ? {
        number: user.user_level.level_number,
        title: user.user_level.title,
        className: user.user_level.class_name
      } : { number: 0, title: 'Beginner', className: 'NOVICE' },
      experience: {
        current: user.experience_points || 0,
        nextLevel: user.user_level ? user.user_level.min_exp + 100 : 100 // Simplified next level calc
      },
      profile: {
        image_url: user.profile_image_url || null,
        created_at: user.created_at ? user.created_at.toISOString() : null,
        last_login: user.last_login ? user.last_login.toISOString() : null
      },
      stats: user.user_stats ? {
        contests_entered: user.user_stats.contests_entered || 0,
        contests_won: user.user_stats.contests_won || 0,
        total_prize_money: user.user_stats.total_prize_money ? user.user_stats.total_prize_money.toString() : '0',
        best_score: user.user_stats.best_score ? user.user_stats.best_score.toString() : '0',
        avg_score: user.user_stats.avg_score ? user.user_stats.avg_score.toString() : '0'
      } : { contests_entered: 0, contests_won: 0, total_prize_money: '0' },
      achievements: user.user_achievements.map(achievement => ({
        type: achievement.achievement_type,
        tier: achievement.tier,
        category: achievement.category,
        achieved_at: achievement.achieved_at ? achievement.achieved_at.toISOString() : null,
        xp_awarded: achievement.xp_awarded
      })),
      social: user.social_profiles.map(profile => ({
        platform: profile.platform,
        username: profile.username,
        verified: profile.verified
      })),
      wallet: {
        balance: user.wallet_balances && user.wallet_balances.length > 0 ? 
          (Number(user.wallet_balances[0].balance_lamports) / 1000000000).toFixed(4) + ' SOL' : 'Unknown',
        last_updated: user.wallet_balances && user.wallet_balances.length > 0 ? 
          user.wallet_balances[0].timestamp.toISOString() : null
      },
      referral: {
        code: user.referral_code || null,
        referred_by: user.referred_by_code || null
      }
    };
    
    return userProfile;
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching user profile:`, error);
    return {
      error: "Failed to fetch user profile",
      details: error.message
    };
  }
}

/**
 * Handle getTopUsers function call
 * 
 * @param {Object} args - Function arguments
 * @returns {Object} - Top users by category
 */
async function handleGetTopUsers({ category, limit = 10 }) {
  try {
    let users = [];
    const now = new Date();
    
    // Query based on category
    switch (category) {
      case "contests_won":
        users = await prisma.user_stats.findMany({
          where: {
            contests_won: { gt: 0 }
          },
          orderBy: {
            contests_won: 'desc'
          },
          take: limit,
          include: {
            users: {
              select: {
                username: true,
                nickname: true,
                role: true,
                profile_image_url: true,
                user_level_id: true,
                user_level: true
              }
            }
          }
        });
        break;
        
      case "earnings":
        users = await prisma.user_stats.findMany({
          where: {
            total_prize_money: { gt: 0 }
          },
          orderBy: {
            total_prize_money: 'desc'
          },
          take: limit,
          include: {
            users: {
              select: {
                username: true,
                nickname: true,
                role: true,
                profile_image_url: true,
                user_level_id: true,
                user_level: true
              }
            }
          }
        });
        break;
        
      case "experience":
        users = await prisma.users.findMany({
          where: {
            experience_points: { gt: 0 }
          },
          orderBy: {
            experience_points: 'desc'
          },
          take: limit,
          select: {
            id: true,
            username: true,
            nickname: true,
            role: true,
            profile_image_url: true,
            experience_points: true,
            user_level_id: true,
            user_level: true,
            user_stats: true
          }
        });
        break;
        
      case "referrals":
        // Get users with most referrals (simplified to just get from referrals table)
        const referralCounts = await prisma.$queryRaw`
          SELECT 
            "referrer_id" as wallet_address, 
            COUNT(*) as referral_count
          FROM 
            referrals
          WHERE 
            status = 'qualified' OR status = 'rewarded'
          GROUP BY 
            "referrer_id"
          ORDER BY 
            COUNT(*) DESC
          LIMIT ${limit}
        `;
        
        // Fetch user data for these wallets
        if (referralCounts && referralCounts.length > 0) {
          const walletAddresses = referralCounts.map(r => r.wallet_address);
          const userData = await prisma.users.findMany({
            where: {
              wallet_address: { in: walletAddresses }
            },
            include: {
              user_stats: true,
              user_level: true
            }
          });
          
          // Merge referral counts with user data
          users = referralCounts.map(r => {
            const userInfo = userData.find(u => u.wallet_address === r.wallet_address);
            return {
              wallet_address: r.wallet_address,
              referral_count: Number(r.referral_count),
              users: userInfo
            };
          });
        }
        break;
        
      default:
        return {
          error: "Invalid category",
          details: `Category '${category}' is not supported`
        };
    }
    
    // Format the results based on the category
    if (category === "referrals") {
      return {
        category,
        count: users.length,
        users: users.map(u => ({
          username: u.users?.username || 'Anonymous',
          nickname: u.users?.nickname || u.users?.username || 'Anonymous',
          profile_image: u.users?.profile_image_url || null,
          role: u.users?.role || 'user',
          level: u.users?.user_level?.level_number || 0,
          level_title: u.users?.user_level?.title || 'Beginner',
          referrals: u.referral_count
        }))
      };
    } else if (category === "experience") {
      return {
        category,
        count: users.length,
        users: users.map(u => ({
          username: u.username || 'Anonymous',
          nickname: u.nickname || u.username || 'Anonymous',
          profile_image: u.profile_image_url || null,
          role: u.role || 'user',
          level: u.user_level?.level_number || 0,
          level_title: u.user_level?.title || 'Beginner',
          experience: u.experience_points || 0,
          contests_won: u.user_stats?.contests_won || 0
        }))
      };
    } else {
      return {
        category,
        count: users.length,
        users: users.map(u => ({
          username: u.users?.username || 'Anonymous',
          nickname: u.users?.nickname || u.users?.username || 'Anonymous',
          profile_image: u.users?.profile_image_url || null,
          role: u.users?.role || 'user',
          level: u.users?.user_level?.level_number || 0,
          level_title: u.users?.user_level?.title || 'Beginner',
          contests_won: category === 'contests_won' ? u.contests_won : u.users?.contests_won || 0,
          earnings: category === 'earnings' ? formatNumber(u.total_prize_money || 0) : undefined
        }))
      };
    }
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching top users:`, error);
    return {
      error: "Failed to fetch top users",
      details: error.message
    };
  }
}

/**
 * Handle getUserContestHistory function call
 * 
 * @param {Object} args - Function arguments
 * @returns {Object} - User's contest history
 */
async function handleGetUserContestHistory({ usernameOrWallet, limit = 5 }) {
  try {
    // First find the user
    const whereClause = usernameOrWallet.length >= 32 
      ? { wallet_address: usernameOrWallet } 
      : { username: usernameOrWallet };
    
    const user = await prisma.users.findFirst({
      where: whereClause,
      select: {
        wallet_address: true,
        username: true,
        nickname: true
      }
    });
    
    if (!user) {
      return {
        error: "User not found",
        searched: { usernameOrWallet }
      };
    }
    
    // Get their contest participation
    const participations = await prisma.contest_participants.findMany({
      where: {
        wallet_address: user.wallet_address
      },
      orderBy: {
        joined_at: 'desc'
      },
      take: limit,
      include: {
        contests: true
      }
    });
    
    return {
      username: user.username || 'Anonymous',
      nickname: user.nickname || user.username || 'Anonymous',
      wallet_address: user.wallet_address,
      contest_count: participations.length,
      contests: participations.map(p => ({
        name: p.contests.name,
        code: p.contests.contest_code,
        status: p.status,
        joined_at: p.joined_at.toISOString(),
        entry_time: p.entry_time.toISOString(),
        initial_balance: p.initial_balance?.toString() || '0',
        final_rank: p.final_rank || 'N/A',
        portfolio_value: p.portfolio_value?.toString() || '0',
        prize_amount: p.prize_amount?.toString() || '0',
        prize_paid: p.prize_paid_at ? true : false,
        contest_info: {
          start: p.contests.start_time.toISOString(),
          end: p.contests.end_time.toISOString(),
          prize_pool: p.contests.prize_pool.toString(),
          total_participants: p.contests.participant_count
        }
      }))
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching user contest history:`, error);
    return {
      error: "Failed to fetch user contest history",
      details: error.message
    };
  }
}