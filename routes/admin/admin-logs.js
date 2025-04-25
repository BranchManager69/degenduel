/**
 * Admin Logs API Route
 * 
 * This route provides API endpoints for accessing admin logs.
 */

import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import prisma from '../../config/prisma.js';
import AdminLogger from '../../utils/admin-logger.js';
import { logApi } from '../../utils/logger-suite/logger.js';

const router = express.Router();
const logger = logApi.forService('ADMIN_LOGS');

/**
 * @api {get} /api/admin/admin-logs Get paginated admin logs
 * @apiName GetAdminLogs
 * @apiGroup AdminLogs
 * @apiPermission admin
 * 
 * @apiParam {Number} [page=1] Page number
 * @apiParam {Number} [limit=50] Number of logs per page
 * @apiParam {String} [adminAddress] Filter by admin address
 * @apiParam {String} [action] Filter by action type
 * @apiParam {String} [startDate] Filter by start date (ISO format)
 * @apiParam {String} [endDate] Filter by end date (ISO format)
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Array} logs List of admin logs
 * @apiSuccess {Object} pagination Pagination information
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      adminAddress,
      action,
      startDate,
      endDate
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
    
    if (adminAddress) {
      where.admin_address = adminAddress;
    }
    
    if (action) {
      where.action = action;
    }
    
    // Handle date range filtering
    if (startDate || endDate) {
      where.created_at = {};
      
      if (startDate) {
        where.created_at.gte = new Date(startDate);
      }
      
      if (endDate) {
        where.created_at.lte = new Date(endDate);
      }
    }

    // Calculate skip value for pagination
    const skip = (pageNum - 1) * limitNum;

    // Query for logs with pagination
    const [logs, totalLogs] = await Promise.all([
      prisma.admin_logs.findMany({
        where,
        orderBy: {
          created_at: 'desc'
        },
        skip,
        take: limitNum
      }),
      prisma.admin_logs.count({ where })
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalLogs / limitNum);

    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'ADMIN_LOGS_VIEW',
      {
        page: pageNum,
        limit: limitNum,
        filters: { adminAddress, action, startDate, endDate }
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );

    return res.json({
      success: true,
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalLogs,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    logger.error('Error fetching admin logs:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch admin logs'
    });
  }
});

/**
 * @api {get} /api/admin/admin-logs/actions Get unique action types
 * @apiName GetAdminLogActions
 * @apiGroup AdminLogs
 * @apiPermission admin
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Array} actions List of unique action types
 */
router.get('/actions', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Query for distinct action types
    const actions = await prisma.$queryRaw`
      SELECT DISTINCT action FROM admin_logs ORDER BY action ASC
    `;

    return res.json({
      success: true,
      actions: actions.map(a => a.action)
    });
  } catch (error) {
    logger.error('Error fetching admin log actions:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch admin log actions'
    });
  }
});

/**
 * @api {get} /api/admin/admin-logs/admins Get unique admin addresses
 * @apiName GetAdminLogAdmins
 * @apiGroup AdminLogs
 * @apiPermission admin
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Array} admins List of unique admin addresses
 */
router.get('/admins', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Query for distinct admin addresses
    const admins = await prisma.$queryRaw`
      SELECT DISTINCT admin_address FROM admin_logs ORDER BY admin_address ASC
    `;

    return res.json({
      success: true,
      admins: admins.map(a => a.admin_address)
    });
  } catch (error) {
    logger.error('Error fetching admin log admins:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch admin log admins'
    });
  }
});

/**
 * @api {get} /api/admin/admin-logs/stats Get admin logs statistics
 * @apiName GetAdminLogStats
 * @apiGroup AdminLogs
 * @apiPermission admin
 * 
 * @apiParam {String} [startDate] Filter by start date (ISO format)
 * @apiParam {String} [endDate] Filter by end date (ISO format)
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} stats Statistics about admin logs
 */
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build where clause for filtering
    const where = {};
    
    // Handle date range filtering
    if (startDate || endDate) {
      where.created_at = {};
      
      if (startDate) {
        where.created_at.gte = new Date(startDate);
      }
      
      if (endDate) {
        where.created_at.lte = new Date(endDate);
      }
    }

    // Get total logs count
    const totalLogs = await prisma.admin_logs.count({ where });
    
    // Get count by action type
    const actionCounts = await prisma.admin_logs.groupBy({
      by: ['action'],
      _count: {
        action: true
      },
      where
    });
    
    // Get count by admin address
    const adminCounts = await prisma.admin_logs.groupBy({
      by: ['admin_address'],
      _count: {
        admin_address: true
      },
      where
    });
    
    // Get recent activity trend (last 7 days by default)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const trendWhere = {
      ...where,
      created_at: {
        ...where.created_at,
        gte: where.created_at?.gte || sevenDaysAgo
      }
    };
    
    const activityTrend = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) as count
      FROM admin_logs
      WHERE created_at >= ${trendWhere.created_at.gte}
      ${trendWhere.created_at.lte ? `AND created_at <= ${trendWhere.created_at.lte}` : ''}
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date ASC
    `;

    return res.json({
      success: true,
      stats: {
        totalLogs,
        byAction: actionCounts.map(ac => ({
          action: ac.action,
          count: ac._count.action
        })),
        byAdmin: adminCounts.map(ac => ({
          admin_address: ac.admin_address,
          count: ac._count.admin_address
        })),
        activityTrend: activityTrend.map(at => ({
          date: at.date,
          count: Number(at.count)
        }))
      }
    });
  } catch (error) {
    logger.error('Error fetching admin log stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch admin log stats'
    });
  }
});

export default router;