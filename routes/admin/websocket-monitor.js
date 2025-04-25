/**
 * WebSocket Monitoring API Routes
 * 
 * This route provides API endpoints for monitoring WebSocket connections and messages.
 */

import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import prisma from '../../config/prisma.js';
import AdminLogger from '../../utils/admin-logger.js';
import { logApi } from '../../utils/logger-suite/logger.js';

const router = express.Router();
const logger = logApi.forService('WEBSOCKET_MONITOR');

/**
 * @api {get} /api/admin/websocket-monitor/connections Get paginated WebSocket connections
 * @apiName GetWebSocketConnections
 * @apiGroup WebSocketMonitor
 * @apiPermission admin
 * 
 * @apiParam {Number} [page=1] Page number
 * @apiParam {Number} [limit=50] Number of connections per page
 * @apiParam {String} [walletAddress] Filter by wallet address
 * @apiParam {Boolean} [isAuthenticated] Filter by authentication status
 * @apiParam {String} [ipAddress] Filter by IP address
 * @apiParam {String} [startDate] Filter by start date (ISO format)
 * @apiParam {String} [endDate] Filter by end date (ISO format)
 * @apiParam {Boolean} [activeOnly=false] Only show active connections (not disconnected)
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Array} connections List of WebSocket connections
 * @apiSuccess {Object} pagination Pagination information
 */
router.get('/connections', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      walletAddress,
      isAuthenticated,
      ipAddress,
      startDate,
      endDate,
      activeOnly = false
    } = req.query;

    // Convert page and limit to numbers
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    
    // Validate page and limit
    if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pagination parameters'
      });
    }

    // Build where clause for filtering
    const where = {};
    
    if (walletAddress) {
      where.wallet_address = walletAddress;
    }
    
    if (isAuthenticated !== undefined) {
      where.is_authenticated = isAuthenticated === 'true' || isAuthenticated === true;
    }
    
    if (ipAddress) {
      where.ip_address = ipAddress;
    }
    
    // Handle date range filtering for connected_at
    if (startDate || endDate) {
      where.connected_at = {};
      
      if (startDate) {
        where.connected_at.gte = new Date(startDate);
      }
      
      if (endDate) {
        where.connected_at.lte = new Date(endDate);
      }
    }

    // Filter for active connections (disconnected_at is null)
    if (activeOnly === 'true' || activeOnly === true) {
      where.disconnected_at = null;
    }

    // Calculate skip value for pagination
    const skip = (pageNum - 1) * limitNum;

    // Query for connections with pagination
    const [connections, totalConnections] = await Promise.all([
      prisma.websocket_connections.findMany({
        where,
        orderBy: {
          connected_at: 'desc'
        },
        skip,
        take: limitNum
      }),
      prisma.websocket_connections.count({ where })
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalConnections / limitNum);

    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'WEBSOCKET_CONNECTIONS_VIEW',
      {
        page: pageNum,
        limit: limitNum,
        filters: { walletAddress, isAuthenticated, ipAddress, startDate, endDate, activeOnly }
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );

    return res.json({
      success: true,
      connections,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalConnections,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    logger.error('Error fetching WebSocket connections:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch WebSocket connections'
    });
  }
});

/**
 * @api {get} /api/admin/websocket-monitor/connections/:connectionId Get WebSocket connection details
 * @apiName GetWebSocketConnectionDetails
 * @apiGroup WebSocketMonitor
 * @apiPermission admin
 * 
 * @apiParam {String} connectionId WebSocket connection ID
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} connection WebSocket connection details
 */
router.get('/connections/:connectionId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { connectionId } = req.params;
    
    // Find the connection by connection_id
    const connection = await prisma.websocket_connections.findFirst({
      where: { connection_id: connectionId }
    });
    
    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Connection not found'
      });
    }
    
    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'WEBSOCKET_CONNECTION_DETAILS_VIEW',
      { connectionId },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );
    
    return res.json({
      success: true,
      connection
    });
  } catch (error) {
    logger.error('Error fetching WebSocket connection details:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch WebSocket connection details'
    });
  }
});

/**
 * @api {get} /api/admin/websocket-monitor/messages Get paginated WebSocket messages
 * @apiName GetWebSocketMessages
 * @apiGroup WebSocketMonitor
 * @apiPermission admin
 * 
 * @apiParam {Number} [page=1] Page number
 * @apiParam {Number} [limit=50] Number of messages per page
 * @apiParam {String} [walletAddress] Filter by wallet address
 * @apiParam {String} [type] Filter by message type
 * @apiParam {String} [startDate] Filter by start date (ISO format)
 * @apiParam {String} [endDate] Filter by end date (ISO format)
 * @apiParam {Boolean} [undeliveredOnly=false] Only show undelivered messages
 * @apiParam {Boolean} [unreadOnly=false] Only show unread messages
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Array} messages List of WebSocket messages
 * @apiSuccess {Object} pagination Pagination information
 */
router.get('/messages', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      walletAddress,
      type,
      startDate,
      endDate,
      undeliveredOnly = false,
      unreadOnly = false
    } = req.query;

    // Convert page and limit to numbers
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    
    // Validate page and limit
    if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pagination parameters'
      });
    }

    // Build where clause for filtering
    const where = {};
    
    if (walletAddress) {
      where.wallet_address = walletAddress;
    }
    
    if (type) {
      where.type = type;
    }
    
    // Handle date range filtering
    if (startDate || endDate) {
      where.timestamp = {};
      
      if (startDate) {
        where.timestamp.gte = new Date(startDate);
      }
      
      if (endDate) {
        where.timestamp.lte = new Date(endDate);
      }
    }
    
    // Filter for delivery status
    if (undeliveredOnly === 'true' || undeliveredOnly === true) {
      where.delivered = false;
    }
    
    // Filter for read status
    if (unreadOnly === 'true' || unreadOnly === true) {
      where.read = false;
    }

    // Calculate skip value for pagination
    const skip = (pageNum - 1) * limitNum;

    // Query for messages with pagination
    const [messages, totalMessages] = await Promise.all([
      prisma.websocket_messages.findMany({
        where,
        orderBy: {
          timestamp: 'desc'
        },
        skip,
        take: limitNum
      }),
      prisma.websocket_messages.count({ where })
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalMessages / limitNum);

    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'WEBSOCKET_MESSAGES_VIEW',
      {
        page: pageNum,
        limit: limitNum,
        filters: { walletAddress, type, startDate, endDate, undeliveredOnly, unreadOnly }
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );

    return res.json({
      success: true,
      messages,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalMessages,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    logger.error('Error fetching WebSocket messages:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch WebSocket messages'
    });
  }
});

/**
 * @api {get} /api/admin/websocket-monitor/stats Get WebSocket statistics
 * @apiName GetWebSocketStats
 * @apiGroup WebSocketMonitor
 * @apiPermission admin
 * 
 * @apiParam {String} [startDate] Filter by start date (ISO format)
 * @apiParam {String} [endDate] Filter by end date (ISO format)
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} stats Statistics about WebSocket usage
 */
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build date range filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.connected_at = {};
      
      if (startDate) {
        dateFilter.connected_at.gte = new Date(startDate);
      }
      
      if (endDate) {
        dateFilter.connected_at.lte = new Date(endDate);
      }
    }
    
    // Get active connections count (not disconnected)
    const activeConnections = await prisma.websocket_connections.count({
      where: {
        disconnected_at: null
      }
    });
    
    // Get total connections count
    const totalConnections = await prisma.websocket_connections.count({
      where: dateFilter
    });
    
    // Get authenticated connections count
    const authenticatedConnections = await prisma.websocket_connections.count({
      where: {
        ...dateFilter,
        is_authenticated: true
      }
    });
    
    // Get average connection duration
    const avgDurationResult = await prisma.$queryRaw`
      SELECT AVG(duration_seconds)::float as avg_duration
      FROM websocket_connections
      WHERE duration_seconds IS NOT NULL
      ${startDate ? `AND connected_at >= ${new Date(startDate)}` : ''}
      ${endDate ? `AND connected_at <= ${new Date(endDate)}` : ''}
    `;
    
    const avgDuration = avgDurationResult[0]?.avg_duration || 0;
    
    // Get connection count by hour (for the last 24 hours by default)
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 1);
    
    const hourlyConnectionsResult = await prisma.$queryRaw`
      SELECT
        DATE_TRUNC('hour', connected_at) as hour,
        COUNT(*) as connection_count
      FROM websocket_connections
      WHERE connected_at >= ${startDate ? new Date(startDate) : defaultStartDate}
      ${endDate ? `AND connected_at <= ${new Date(endDate)}` : ''}
      GROUP BY hour
      ORDER BY hour ASC
    `;
    
    // Get message count by type
    const messageCountByType = await prisma.websocket_messages.groupBy({
      by: ['type'],
      _count: {
        id: true
      },
      where: startDate || endDate ? {
        timestamp: {
          ...(startDate ? { gte: new Date(startDate) } : {}),
          ...(endDate ? { lte: new Date(endDate) } : {})
        }
      } : {}
    });
    
    // Get delivery rate
    const deliveryStats = await prisma.$queryRaw`
      SELECT
        COUNT(*) as total_messages,
        SUM(CASE WHEN delivered = true THEN 1 ELSE 0 END) as delivered_messages,
        SUM(CASE WHEN read = true THEN 1 ELSE 0 END) as read_messages
      FROM websocket_messages
      WHERE 1=1
      ${startDate ? `AND timestamp >= ${new Date(startDate)}` : ''}
      ${endDate ? `AND timestamp <= ${new Date(endDate)}` : ''}
    `;
    
    const totalMessages = Number(deliveryStats[0]?.total_messages) || 0;
    const deliveredMessages = Number(deliveryStats[0]?.delivered_messages) || 0;
    const readMessages = Number(deliveryStats[0]?.read_messages) || 0;
    
    const deliveryRate = totalMessages > 0 ? (deliveredMessages / totalMessages) * 100 : 100;
    const readRate = totalMessages > 0 ? (readMessages / totalMessages) * 100 : 100;
    
    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'WEBSOCKET_STATS_VIEW',
      {
        filters: { startDate, endDate }
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );
    
    return res.json({
      success: true,
      stats: {
        currentStatus: {
          activeConnections,
          totalConnections,
          authenticatedConnections,
          authenticationRate: totalConnections > 0 ? (authenticatedConnections / totalConnections) * 100 : 0
        },
        connectionMetrics: {
          avgDurationSeconds: avgDuration,
          avgDurationFormatted: formatDuration(avgDuration)
        },
        messageMetrics: {
          totalMessages,
          deliveredMessages,
          readMessages,
          deliveryRate,
          readRate,
          byType: messageCountByType.map(item => ({
            type: item.type,
            count: item._count.id
          }))
        },
        timeSeriesData: {
          hourlyConnections: hourlyConnectionsResult.map(item => ({
            hour: item.hour,
            count: Number(item.connection_count)
          }))
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching WebSocket stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch WebSocket stats'
    });
  }
});

/**
 * Helper function to format duration in seconds to a human-readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration string
 */
function formatDuration(seconds) {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

export default router;