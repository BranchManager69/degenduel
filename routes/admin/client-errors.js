/**
 * Admin Client Error Management Routes
 * 
 * Routes for viewing and managing client-side errors that have been
 * captured and stored in the database.
 */

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import { PrismaClient } from '@prisma/client';
import { 
  getRecentErrors, 
  resolveError, 
  markErrorCritical 
} from '../../utils/client-error-processor.js';
import AdminLogger from '../../utils/admin-logger.js';

const router = express.Router();
const prisma = new PrismaClient();

/**
 * Get a list of client errors with various filters
 */
router.get('/', async (req, res) => {
  try {
    const {
      status = 'open',
      critical = false,
      limit = 50,
      sort = 'last_occurred_at',
      order = 'desc'
    } = req.query;
    
    const errors = await getRecentErrors({
      status: status === 'all' ? undefined : status,
      onlyCritical: critical === 'true',
      limit: parseInt(limit, 10),
      orderBy: sort,
      orderDirection: order
    });
    
    return res.json({
      success: true,
      errors,
      count: errors.length,
      filters: { status, critical, limit, sort, order }
    });
  } catch (err) {
    logApi.error('Failed to fetch client errors', {
      error: err.message,
      stack: err.stack,
      admin_client_error_route: true
    });
    
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch client errors'
    });
  }
});

/**
 * Get error statistics
 */
router.get('/stats', async (req, res) => {
  try {
    // Get counts by status
    const statusCounts = await prisma.$queryRaw`
      SELECT status, COUNT(*) as count 
      FROM client_errors 
      GROUP BY status
    `;
    
    // Get counts by criticality
    const criticalCounts = await prisma.$queryRaw`
      SELECT is_critical, COUNT(*) as count 
      FROM client_errors 
      GROUP BY is_critical
    `;
    
    // Get most frequent errors
    const mostFrequent = await prisma.client_errors.findMany({
      orderBy: { occurrences: 'desc' },
      take: 5,
      select: {
        id: true,
        error_id: true,
        message: true,
        occurrences: true,
        status: true,
        is_critical: true
      }
    });
    
    // Get newly occurring errors (within last 24h)
    const recentErrors = await prisma.client_errors.findMany({
      where: {
        last_occurred_at: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      },
      orderBy: { last_occurred_at: 'desc' },
      take: 5,
      select: {
        id: true,
        error_id: true,
        message: true,
        occurrences: true,
        last_occurred_at: true,
        status: true
      }
    });
    
    // Count critical errors
    const criticalCount = await prisma.client_errors.count({
      where: { is_critical: true, status: 'open' }
    });
    
    // Count total errors
    const totalCount = await prisma.client_errors.count();
    
    return res.json({
      success: true,
      stats: {
        total: totalCount,
        by_status: statusCounts,
        by_critical: criticalCounts,
        critical_open: criticalCount,
        most_frequent: mostFrequent,
        recent: recentErrors
      }
    });
  } catch (err) {
    logApi.error('Failed to fetch client error stats', {
      error: err.message,
      stack: err.stack,
      admin_client_error_route: true
    });
    
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch client error stats'
    });
  }
});

/**
 * Get a specific error by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const error = await prisma.client_errors.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            nickname: true,
            wallet_address: true,
            role: true
          }
        }
      }
    });
    
    if (!error) {
      return res.status(404).json({
        success: false,
        error: 'Client error not found'
      });
    }
    
    return res.json({
      success: true,
      error
    });
  } catch (err) {
    logApi.error(`Failed to fetch client error #${req.params.id}`, {
      error: err.message,
      stack: err.stack,
      admin_client_error_route: true
    });
    
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch client error'
    });
  }
});

/**
 * Mark an error as resolved
 */
router.post('/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const resolvedBy = req.user.wallet_address;
    const adminNickname = req.user.nickname || req.user.username || 'Unknown Admin';
    
    const error = await resolveError(parseInt(id, 10), resolvedBy, note);
    
    // Create admin log
    await AdminLogger.logAction(
      resolvedBy,
      AdminLogger.Actions.CLIENT_ERROR.RESOLVE,
      {
        error_id: error.id,
        message: error.message.substring(0, 100),
        note,
        admin_nickname: adminNickname
      },
      req
    );
    
    return res.json({
      success: true,
      message: `Error #${id} marked as resolved`,
      error
    });
  } catch (err) {
    logApi.error(`Failed to resolve client error #${req.params.id}`, {
      error: err.message,
      stack: err.stack,
      admin_client_error_route: true
    });
    
    return res.status(500).json({
      success: false,
      error: 'Failed to resolve client error'
    });
  }
});

/**
 * Mark an error as critical/non-critical
 */
router.post('/:id/critical', async (req, res) => {
  try {
    const { id } = req.params;
    const { critical = true } = req.body;
    const adminNickname = req.user.nickname || req.user.username || 'Unknown Admin';
    
    const error = await markErrorCritical(parseInt(id, 10), critical === true);
    
    // Create admin log
    await AdminLogger.logAction(
      req.user.wallet_address,
      critical ? AdminLogger.Actions.CLIENT_ERROR.MARK_CRITICAL : AdminLogger.Actions.CLIENT_ERROR.MARK_NONCRITICAL,
      {
        error_id: error.id,
        message: error.message.substring(0, 100),
        admin_nickname: adminNickname
      },
      req
    );
    
    return res.json({
      success: true,
      message: `Error #${id} marked as ${critical ? 'critical' : 'non-critical'}`,
      error
    });
  } catch (err) {
    logApi.error(`Failed to update critical status for client error #${req.params.id}`, {
      error: err.message,
      stack: err.stack,
      admin_client_error_route: true
    });
    
    return res.status(500).json({
      success: false,
      error: 'Failed to update critical status'
    });
  }
});

/**
 * Batch resolve multiple errors
 */
router.post('/batch/resolve', async (req, res) => {
  try {
    const { ids, note } = req.body;
    const resolvedBy = req.user.wallet_address;
    const adminNickname = req.user.nickname || req.user.username || 'Unknown Admin';
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No error IDs provided'
      });
    }
    
    // Convert IDs to integers
    const errorIds = ids.map(id => parseInt(id, 10));
    
    // Update all specified errors
    const result = await prisma.client_errors.updateMany({
      where: {
        id: { in: errorIds }
      },
      data: {
        status: 'resolved',
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        resolution_note: note
      }
    });
    
    // Create admin log
    await AdminLogger.logAction(
      resolvedBy,
      AdminLogger.Actions.CLIENT_ERROR.BATCH_RESOLVE,
      {
        error_count: result.count,
        error_ids: errorIds,
        note,
        admin_nickname: adminNickname
      },
      req
    );
    
    return res.json({
      success: true,
      message: `${result.count} errors resolved`,
      count: result.count
    });
  } catch (err) {
    logApi.error('Failed to batch resolve client errors', {
      error: err.message,
      stack: err.stack,
      admin_client_error_route: true
    });
    
    return res.status(500).json({
      success: false,
      error: 'Failed to batch resolve client errors'
    });
  }
});

export default router;