/**
 * AI Analysis API Routes
 * 
 * Routes for accessing AI analysis of client errors and admin actions.
 */

import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import prisma from '../../config/prisma.js';
import AdminLogger from '../../utils/admin-logger.js';
import { logApi } from '../../utils/logger-suite/logger.js';

const router = express.Router();
const logger = logApi.forService('AI_ANALYSIS');

/**
 * @api {get} /api/admin/ai-analysis/errors/latest Get latest client error analysis
 * @apiName GetLatestErrorAnalysis
 * @apiGroup AIAnalysis
 * @apiPermission admin
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} analysis Latest client error analysis
 */
router.get('/errors/latest', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get the latest analysis
    const latestAnalysis = await prisma.ai_error_analyses.findFirst({
      orderBy: { analyzed_at: 'desc' }
    });

    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'AI_ERROR_ANALYSIS_VIEW',
      {
        analyzed_at: latestAnalysis?.analyzed_at || null,
        error_count: latestAnalysis?.error_count || 0
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );

    return res.json({
      success: true,
      analysis: latestAnalysis ? {
        summary: latestAnalysis.summary,
        analyzed_at: latestAnalysis.analyzed_at,
        error_count: latestAnalysis.error_count,
        time_window_minutes: latestAnalysis.time_window_minutes,
        severity_distribution: latestAnalysis.severity_distribution,
        browser_distribution: latestAnalysis.browser_distribution,
        os_distribution: latestAnalysis.os_distribution,
        top_errors: latestAnalysis.top_errors
      } : null
    });
  } catch (error) {
    logger.error('Error fetching latest error analysis:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch error analysis'
    });
  }
});

/**
 * @api {get} /api/admin/ai-analysis/errors Get paginated error analyses
 * @apiName GetErrorAnalyses
 * @apiGroup AIAnalysis
 * @apiPermission admin
 * 
 * @apiParam {Number} [page=1] Page number
 * @apiParam {Number} [limit=10] Number of analyses per page
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Array} analyses List of error analyses
 * @apiSuccess {Object} pagination Pagination information
 */
router.get('/errors', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10
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

    // Calculate skip value for pagination
    const skip = (pageNum - 1) * limitNum;

    // Query for analyses with pagination
    const [analyses, totalAnalyses] = await Promise.all([
      prisma.ai_error_analyses.findMany({
        orderBy: {
          analyzed_at: 'desc'
        },
        skip,
        take: limitNum
      }),
      prisma.ai_error_analyses.count()
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalAnalyses / limitNum);

    return res.json({
      success: true,
      analyses,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalAnalyses,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    logger.error('Error fetching error analyses:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch error analyses'
    });
  }
});

/**
 * @api {get} /api/admin/ai-analysis/admin-actions/latest Get latest admin action analysis
 * @apiName GetLatestAdminActionAnalysis
 * @apiGroup AIAnalysis
 * @apiPermission admin
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} analysis Latest admin action analysis
 */
router.get('/admin-actions/latest', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get the latest analysis
    const latestAnalysis = await prisma.ai_admin_action_analyses.findFirst({
      orderBy: { analyzed_at: 'desc' }
    });

    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'AI_ADMIN_ACTION_ANALYSIS_VIEW',
      {
        analyzed_at: latestAnalysis?.analyzed_at || null,
        action_count: latestAnalysis?.action_count || 0
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );

    return res.json({
      success: true,
      analysis: latestAnalysis ? {
        summary: latestAnalysis.summary,
        analyzed_at: latestAnalysis.analyzed_at,
        action_count: latestAnalysis.action_count,
        time_window_minutes: latestAnalysis.time_window_minutes,
        action_distribution: latestAnalysis.action_distribution,
        admin_distribution: latestAnalysis.admin_distribution,
        top_actions: latestAnalysis.top_actions
      } : null
    });
  } catch (error) {
    logger.error('Error fetching latest admin action analysis:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch admin action analysis'
    });
  }
});

/**
 * @api {get} /api/admin/ai-analysis/admin-actions Get paginated admin action analyses
 * @apiName GetAdminActionAnalyses
 * @apiGroup AIAnalysis
 * @apiPermission admin
 * 
 * @apiParam {Number} [page=1] Page number
 * @apiParam {Number} [limit=10] Number of analyses per page
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Array} analyses List of admin action analyses
 * @apiSuccess {Object} pagination Pagination information
 */
router.get('/admin-actions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10
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

    // Calculate skip value for pagination
    const skip = (pageNum - 1) * limitNum;

    // Query for analyses with pagination
    const [analyses, totalAnalyses] = await Promise.all([
      prisma.ai_admin_action_analyses.findMany({
        orderBy: {
          analyzed_at: 'desc'
        },
        skip,
        take: limitNum
      }),
      prisma.ai_admin_action_analyses.count()
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalAnalyses / limitNum);

    return res.json({
      success: true,
      analyses,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalAnalyses,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    logger.error('Error fetching admin action analyses:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch admin action analyses'
    });
  }
});

export default router;