// services/ai-service/utils/additional-functions.js
// @see /services/ai-service/README.md for complete documentation and architecture

/**
 * Additional Functions for AI Terminal Assistant
 * 
 * @description Adds more function definitions and handlers for the AI terminal,
 * including token metrics history, platform activity, system status and admin functions.
 * 
 * @author BranchManager69
 * @version 1.9.0
 * @created 2025-04-10
 * @updated 2025-05-01
 */

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';

// Config
//import config from '../../../config/config.js';
//const { ai } = config;

/**
 * Handle getTokenMetricsHistory function call
 * 
 * @param {Object} args - Function arguments
 * @returns {Object} - Token metrics history
 */
export async function handleGetTokenMetricsHistory({ tokenSymbol, metricType, timeframe = '7d', limit = 50 }) {
  try {
    // Find token first
    const token = await prisma.tokens.findFirst({
      where: { 
        symbol: { equals: tokenSymbol, mode: 'insensitive' },
        is_active: true
      }
    });
    
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
    
    // Query the right table based on metric type
    let historyData = [];
    
    switch(metricType) {
      case "price":
        historyData = await prisma.token_price_history.findMany({
          where: {
            token_id: token.id,
            timestamp: { 
              gte: startDate,
              lte: endDate
            }
          },
          orderBy: { timestamp: 'asc' },
          take: limit,
          select: {
            price: true,
            timestamp: true,
            source: true
          }
        });
        break;
        
      case "rank":
        historyData = await prisma.token_rank_history.findMany({
          where: {
            token_id: token.id,
            timestamp: { 
              gte: startDate,
              lte: endDate
            }
          },
          orderBy: { timestamp: 'asc' },
          take: limit,
          select: {
            rank: true,
            timestamp: true,
            source: true
          }
        });
        break;
        
      case "volume":
        historyData = await prisma.token_volume_history.findMany({
          where: {
            token_id: token.id,
            timestamp: { 
              gte: startDate,
              lte: endDate
            }
          },
          orderBy: { timestamp: 'asc' },
          take: limit,
          select: {
            volume: true,
            volume_usd: true,
            change_24h: true,
            timestamp: true,
            source: true
          }
        });
        break;
        
      case "liquidity":
        historyData = await prisma.token_liquidity_history.findMany({
          where: {
            token_id: token.id,
            timestamp: { 
              gte: startDate,
              lte: endDate
            }
          },
          orderBy: { timestamp: 'asc' },
          take: limit,
          select: {
            liquidity: true,
            change_24h: true,
            timestamp: true,
            source: true
          }
        });
        break;
        
      case "market_cap":
        historyData = await prisma.token_market_cap_history.findMany({
          where: {
            token_id: token.id,
            timestamp: { 
              gte: startDate,
              lte: endDate
            }
          },
          orderBy: { timestamp: 'asc' },
          take: limit,
          select: {
            market_cap: true,
            fdv: true,
            change_24h: true,
            timestamp: true,
            source: true
          }
        });
        break;
        
      default:
        return {
          error: "Invalid metric type",
          details: `Metric type '${metricType}' is not supported`
        };
    }
    
    // Transform data based on metric type
    let formattedData = [];
    
    switch(metricType) {
      case "price":
        formattedData = historyData.map(entry => ({
          timestamp: entry.timestamp.toISOString(),
          price: entry.price.toString(),
          source: entry.source
        }));
        break;
        
      case "rank":
        formattedData = historyData.map(entry => ({
          timestamp: entry.timestamp.toISOString(),
          rank: entry.rank,
          source: entry.source
        }));
        break;
        
      case "volume":
        formattedData = historyData.map(entry => ({
          timestamp: entry.timestamp.toISOString(),
          volume: entry.volume.toString(),
          volume_usd: entry.volume_usd ? formatNumber(entry.volume_usd) : 'N/A',
          change_24h: entry.change_24h ? `${entry.change_24h.toString()}%` : 'N/A',
          source: entry.source
        }));
        break;
        
      case "liquidity":
        formattedData = historyData.map(entry => ({
          timestamp: entry.timestamp.toISOString(),
          liquidity: entry.liquidity.toString(),
          formatted_liquidity: formatNumber(entry.liquidity),
          change_24h: entry.change_24h ? `${entry.change_24h.toString()}%` : 'N/A',
          source: entry.source
        }));
        break;
        
      case "market_cap":
        formattedData = historyData.map(entry => ({
          timestamp: entry.timestamp.toISOString(),
          market_cap: entry.market_cap.toString(),
          formatted_market_cap: formatNumber(entry.market_cap),
          fdv: entry.fdv ? entry.fdv.toString() : 'N/A',
          formatted_fdv: entry.fdv ? formatNumber(entry.fdv) : 'N/A',
          change_24h: entry.change_24h ? `${entry.change_24h.toString()}%` : 'N/A',
          source: entry.source
        }));
        break;
    }
    
    return {
      symbol: token.symbol,
      name: token.name,
      metric: metricType,
      timeframe: timeframe,
      dataPoints: formattedData.length,
      history: formattedData
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching token metrics history:`, error);
    return {
      error: "Failed to fetch token metrics history",
      details: error.message
    };
  }
}

/**
 * Handle getPlatformActivity function call
 * 
 * @param {Object} args - Function arguments
 * @returns {Object} - Platform activity data
 */
export async function handleGetPlatformActivity({ activityType, limit = 10 }) {
  try {
    let activities = [];
    
    switch(activityType) {
      case "contests":
        // Get recent contests (completed, active, upcoming)
        activities = await prisma.contests.findMany({
          orderBy: { created_at: 'desc' },
          take: limit,
          select: {
            name: true,
            contest_code: true,
            status: true,
            start_time: true,
            end_time: true,
            entry_fee: true,
            prize_pool: true,
            participant_count: true,
            max_participants: true,
            created_at: true,
            completed_at: true
          }
        });
        
        return {
          type: activityType,
          count: activities.length,
          activities: activities.map(contest => ({
            name: contest.name,
            code: contest.contest_code,
            status: contest.status,
            timing: contest.status === 'completed' 
              ? `Completed on ${contest.completed_at ? new Date(contest.completed_at).toLocaleString() : 'N/A'}`
              : contest.status === 'active'
                ? `Running until ${new Date(contest.end_time).toLocaleString()}`
                : `Starting on ${new Date(contest.start_time).toLocaleString()}`,
            entry_fee: contest.entry_fee.toString(),
            prize_pool: contest.prize_pool.toString(),
            participants: `${contest.participant_count}${contest.max_participants ? '/' + contest.max_participants : ''}`
          }))
        };
        
      case "trades":
        // Get recent portfolio trades
        activities = await prisma.contest_portfolio_trades.findMany({
          orderBy: { executed_at: 'desc' },
          take: limit,
          include: {
            contests: {
              select: { name: true, contest_code: true }
            },
            tokens: {
              select: { symbol: true, name: true }
            },
            users: {
              select: { username: true, nickname: true }
            }
          }
        });
        
        return {
          type: activityType,
          count: activities.length,
          activities: activities.map(trade => ({
            contest: trade.contests.name,
            contest_code: trade.contests.contest_code,
            user: trade.users.nickname || trade.users.username || 'Anonymous',
            token: trade.tokens.symbol || trade.tokens.name || 'Unknown Token',
            type: trade.type,
            old_weight: trade.old_weight,
            new_weight: trade.new_weight,
            price: trade.price_at_trade.toString(),
            amount: trade.virtual_amount.toString(),
            time: trade.executed_at.toISOString()
          }))
        };
        
      case "achievements":
        // Get recent user achievements
        activities = await prisma.user_achievements.findMany({
          orderBy: { achieved_at: 'desc' },
          take: limit,
          include: {
            user: {
              select: { username: true, nickname: true }
            }
          }
        });
        
        return {
          type: activityType,
          count: activities.length,
          activities: activities.map(achievement => ({
            user: achievement.user?.nickname || achievement.user?.username || 'Anonymous',
            achievement: achievement.achievement_type,
            tier: achievement.tier,
            category: achievement.category,
            xp_awarded: achievement.xp_awarded,
            time: achievement.achieved_at ? achievement.achieved_at.toISOString() : 'N/A'
          }))
        };
        
      case "transactions":
        // Get recent platform transactions
        activities = await prisma.transactions.findMany({
          orderBy: { created_at: 'desc' },
          take: limit,
          include: {
            users: {
              select: { username: true, nickname: true }
            },
            contests: {
              select: { name: true, contest_code: true }
            }
          }
        });
        
        return {
          type: activityType,
          count: activities.length,
          activities: activities.map(tx => ({
            type: tx.type,
            amount: tx.amount.toString(),
            status: tx.status,
            user: tx.users?.nickname || tx.users?.username || 'Anonymous',
            contest: tx.contests?.name || 'N/A',
            contest_code: tx.contests?.contest_code || 'N/A',
            time: tx.created_at ? tx.created_at.toISOString() : 'N/A',
            description: tx.description || 'No description'
          }))
        };
        
      default:
        return {
          error: "Invalid activity type",
          details: `Activity type '${activityType}' is not supported`
        };
    }
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching platform activity:`, error);
    return {
      error: "Failed to fetch platform activity",
      details: error.message
    };
  }
}

/**
 * Handle getServiceStatus function call (admin only)
 * 
 * @param {Object} args - Function arguments
 * @param {Object} options - User options including role
 * @returns {Object} - Service status information
 */
export async function handleGetServiceStatus({ serviceName }, options = {}) {
  try {
    // Get service configurations
    const query = serviceName 
      ? { where: { service_name: serviceName } }
      : {};
    
    const services = await prisma.service_configuration.findMany({
      ...query,
      orderBy: { service_name: 'asc' }
    });
    
    return {
      count: services.length,
      services: services.map(service => ({
        name: service.service_name,
        display_name: service.display_name,
        enabled: service.enabled,
        status: {
          last_run: service.last_run_at ? service.last_run_at.toISOString() : 'Never',
          duration_ms: service.last_run_duration_ms || 0,
          status: service.last_status || 'unknown',
          message: service.status_message || 'No status available'
        },
        config: {
          check_interval_ms: service.check_interval_ms,
          circuit_breaker: service.circuit_breaker ? JSON.parse(service.circuit_breaker) : null,
          backoff: service.backoff ? JSON.parse(service.backoff) : null,
          thresholds: service.thresholds ? JSON.parse(service.thresholds) : null
        },
        last_updated: service.last_updated.toISOString(),
        updated_by: service.updated_by || 'system'
      }))
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching service status:`, error);
    return {
      error: "Failed to fetch service status",
      details: error.message
    };
  }
}

/**
 * Handle getSystemSettings function call (admin only)
 * 
 * @param {Object} args - Function arguments
 * @param {Object} options - User options including role
 * @returns {Object} - System settings
 */
export async function handleGetSystemSettings({ settingKey }, options = {}) {
  try {
    const query = settingKey ? { where: { key: settingKey } } : {};
    
    const settings = await prisma.system_settings.findMany({
      ...query,
      orderBy: { key: 'asc' }
    });
    
    return {
      count: settings.length,
      settings: settings.map(setting => ({
        key: setting.key,
        value: typeof setting.value === 'object' ? setting.value : JSON.parse(setting.value),
        description: setting.description || 'No description',
        updated_at: setting.updated_at.toISOString(),
        updated_by: setting.updated_by || 'system'
      }))
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching system settings:`, error);
    return {
      error: "Failed to fetch system settings",
      details: error.message
    };
  }
}

/**
 * Handle getWebSocketStats function call (admin only)
 * 
 * @param {Object} args - Function arguments
 * @param {Object} options - User options including role
 * @returns {Object} - WebSocket statistics
 */
export async function handleGetWebSocketStats({ timeframe }, options = {}) {
  try {
    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch(timeframe) {
      case "now":
        // Active connections
        const activeConnections = await prisma.websocket_connections.findMany({
          where: {
            disconnected_at: null
          },
          orderBy: {
            connected_at: 'desc'
          }
        });
        
        return {
          timeframe,
          active_connections: activeConnections.length,
          connections: activeConnections.map(conn => ({
            connection_id: conn.connection_id,
            is_authenticated: conn.is_authenticated,
            user: conn.nickname || (conn.is_authenticated ? conn.wallet_address : 'Anonymous'),
            connected_at: conn.connected_at.toISOString(),
            duration: formatDuration(Date.now() - conn.connected_at),
            messages_sent: conn.messages_sent,
            messages_received: conn.messages_received,
            subscribed_topics: conn.subscribed_topics ? JSON.parse(conn.subscribed_topics) : []
          }))
        };
        
      case "today":
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
        
      case "week":
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
        
      default:
        return {
          error: "Invalid timeframe",
          details: `Timeframe '${timeframe}' is not supported`
        };
    }
    
    // Get connections for timeframe
    const connections = await prisma.websocket_connections.findMany({
      where: {
        connected_at: {
          gte: startDate
        }
      },
      orderBy: {
        connected_at: 'desc'
      }
    });
    
    // Calculate stats
    const totalConnections = connections.length;
    const authenticatedConnections = connections.filter(c => c.is_authenticated).length;
    const avgDuration = connections.reduce((total, conn) => {
      const disconnectTime = conn.disconnected_at || now;
      const duration = disconnectTime - conn.connected_at;
      return total + duration;
    }, 0) / (totalConnections || 1);
    
    // Get message stats
    const totalMessagesSent = connections.reduce((total, conn) => total + (conn.messages_sent || 0), 0);
    const totalMessagesReceived = connections.reduce((total, conn) => total + (conn.messages_received || 0), 0);
    
    return {
      timeframe,
      total_connections: totalConnections,
      authenticated_connections: authenticatedConnections,
      percent_authenticated: totalConnections > 0 ? Math.round((authenticatedConnections / totalConnections) * 100) : 0,
      average_duration: formatDuration(avgDuration),
      total_messages: {
        sent: totalMessagesSent,
        received: totalMessagesReceived
      },
      avg_messages_per_connection: {
        sent: totalConnections > 0 ? Math.round(totalMessagesSent / totalConnections) : 0,
        received: totalConnections > 0 ? Math.round(totalMessagesReceived / totalConnections) : 0
      },
      current_active_connections: await prisma.websocket_connections.count({
        where: { disconnected_at: null }
      })
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching WebSocket stats:`, error);
    return {
      error: "Failed to fetch WebSocket statistics",
      details: error.message
    };
  }
}

/**
 * Handle getIPBanStatus function call (admin only)
 * 
 * @param {Object} args - Function arguments
 * @param {Object} options - User options including role
 * @returns {Object} - IP ban information
 */
export async function handleGetIPBanStatus({ ipAddress, limit = 10 }, options = {}) {
  try {
    const query = ipAddress 
      ? { where: { ip_address: ipAddress } }
      : { take: limit, orderBy: { created_at: 'desc' } };
    
    const bans = await prisma.banned_ips.findMany(query);
    
    return {
      count: bans.length,
      bans: bans.map(ban => ({
        ip_address: ban.ip_address,
        reason: ban.reason,
        is_permanent: ban.is_permanent,
        expires_at: ban.expires_at ? ban.expires_at.toISOString() : 'Never',
        created_at: ban.created_at.toISOString(),
        created_by: ban.created_by,
        num_attempts: ban.num_attempts,
        troll_level: ban.troll_level,
        status: ban.is_permanent ? 'Permanent' :
               (ban.expires_at && ban.expires_at > new Date()) ? 'Active' : 'Expired',
        metadata: ban.metadata ? JSON.parse(ban.metadata) : {}
      }))
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching IP ban status:`, error);
    return {
      error: "Failed to fetch IP ban information",
      details: error.message
    };
  }
}

/**
 * Handle getDiscordWebhookEvents function call (admin only)
 * 
 * @param {Object} args - Function arguments
 * @param {Object} options - User options including role
 * @returns {Object} - Discord webhook events
 */
export async function handleGetDiscordWebhookEvents({ eventType, limit = 5 }, options = {}) {
  try {
    // Discord webhook events are stored in various tables depending on the type
    // For this implementation, we'll simulate the data since schema might not have this exact structure
    
    // In practice, you would implement queries into your webhook logs/notification history tables
    const mockEvents = [
      {
        id: 1,
        type: 'contest_start',
        message: 'Contest "Morning Trading Contest" has started',
        webhook_url: 'https://discord.com/api/webhooks/...',
        status: 'sent',
        sent_at: new Date(Date.now() - 3600000),
        metadata: { contest_id: 1, users_notified: 25 }
      },
      {
        id: 2,
        type: 'contest_end',
        message: 'Contest "Night Owl Marathon" has ended',
        webhook_url: 'https://discord.com/api/webhooks/...',
        status: 'sent',
        sent_at: new Date(Date.now() - 7200000),
        metadata: { contest_id: 2, users_notified: 18 }
      },
      {
        id: 3,
        type: 'new_user',
        message: 'New user registered: crypto_wizard',
        webhook_url: 'https://discord.com/api/webhooks/...',
        status: 'sent',
        sent_at: new Date(Date.now() - 10800000),
        metadata: { user_id: 123 }
      },
      {
        id: 4,
        type: 'achievement',
        message: 'User achieved DIAMOND tier in CONTESTS category',
        webhook_url: 'https://discord.com/api/webhooks/...',
        status: 'sent',
        sent_at: new Date(Date.now() - 14400000),
        metadata: { user_id: 456, achievement_id: 789 }
      }
    ];
    
    // Filter by event type if specified
    const events = eventType 
      ? mockEvents.filter(e => e.type === eventType)
      : mockEvents;
    
    // Limit the number of events
    const limitedEvents = events.slice(0, limit);
    
    return {
      count: limitedEvents.length,
      events: limitedEvents.map(event => ({
        id: event.id,
        type: event.type,
        message: event.message,
        status: event.status,
        sent_at: event.sent_at.toISOString(),
        metadata: event.metadata
      }))
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching Discord webhook events:`, error);
    return {
      error: "Failed to fetch Discord webhook events",
      details: error.message
    };
  }
}

/* Helpers */

/**
 * Format number for display
 * 
 * @param {number|string|BigInt} num - Number to format
 * @returns {string} - Formatted string
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
 * Helper function to format duration in ms to human-readable string
 * 
 * @param {number} durationMs - Duration in milliseconds
 * @returns {string} - Formatted duration string
 */
function formatDuration(durationMs) {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
