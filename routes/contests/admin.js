/**
 * Contest Admin Routes
 * 
 * @description Admin-only operations for contests (start/end contests)
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { 
  startContest,
  endContest
} from '../../utils/contest-helpers.js';

// Router
const router = express.Router();

// Create a dedicated logger for contest admin operations
const adminLogger = {
  ...logApi.forService('CONTESTS_ADMIN'),
  analytics: logApi.analytics
};

/**
 * @route POST /api/contests/:id/start
 * @description Start a contest (admin only)
 * @access Private (requires admin)
 */
router.post('/:id/start', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminWallet = req.user.wallet_address;
    
    const result = await startContest(id, adminWallet);
    
    if (!result) {
      return res.status(404).json({ error: 'Contest not found or not in pending status' });
    }
    
    if (result.error) {
      return res.status(400).json({
        error: result.error,
        message: `Cannot start contest: ${result.error}`,
        details: result
      });
    }
    
    // Track admin action
    adminLogger.analytics.trackAdminAction('start_contest', {
      contestId: parseInt(id, 10),
      adminWallet,
      contestName: result.name
    });
    
    adminLogger.info(`Contest ${id} started by admin ${adminWallet}`, {
      contestId: id,
      adminWallet
    });
    
    res.json({
      contest: result,
      message: 'Contest started successfully'
    });
  } catch (error) {
    adminLogger.error('Failed to start contest:', error);
    res.status(500).json({ error: 'Failed to start contest', message: error.message });
  }
});

/**
 * @route POST /api/contests/:id/end
 * @description End a contest (admin only)
 * @access Private (requires admin)
 */
router.post('/:id/end', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminWallet = req.user.wallet_address;
    
    const result = await endContest(id, adminWallet);
    
    if (!result) {
      return res.status(404).json({ error: 'Contest not found or not in active status' });
    }
    
    if (result.error) {
      return res.status(400).json({
        error: result.error,
        message: `Cannot end contest: ${result.error}`,
        details: result
      });
    }
    
    // Track admin action
    adminLogger.analytics.trackAdminAction('end_contest', {
      contestId: parseInt(id, 10),
      adminWallet,
      contestName: result.name
    });
    
    adminLogger.info(`Contest ${id} ended by admin ${adminWallet}`, {
      contestId: id,
      adminWallet
    });
    
    res.json({
      contest: result,
      message: 'Contest ended successfully'
    });
  } catch (error) {
    adminLogger.error('Failed to end contest:', error);
    res.status(500).json({ error: 'Failed to end contest', message: error.message });
  }
});

export default router;