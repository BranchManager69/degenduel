import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import marketDataService from '../../services/market-data/marketDataService.js';
import AdminLogger from '../../utils/admin-logger.js';

const router = express.Router();
const adminLogger = new AdminLogger('token-sync');

/**
 * Get token sync status from marketDataService
 */
router.get('/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get basic token stats
    const jupiterTokens = marketDataService.jupiterClient?.tokenList || [];
    const dbTokenCount = await marketDataService.getTokenCount();
    
    const status = {
      inProgress: marketDataService.syncInProgress || false,
      scheduled: marketDataService.syncScheduled || false,
      lastSyncStartTime: marketDataService.lastSyncStartTime,
      lastSyncCompleteTime: marketDataService.lastSyncCompleteTime,
      lastSyncStats: marketDataService.lastSyncStats || null,
      lastSyncError: marketDataService.lastSyncError || null,
      database: {
        tokenCount: dbTokenCount,
        jupiterTokens: jupiterTokens.length,
        coverage: jupiterTokens.length ? ((dbTokenCount / jupiterTokens.length) * 100).toFixed(2) : 0,
        remaining: Math.max(0, jupiterTokens.length - dbTokenCount)
      }
    };
    
    res.json(status);
  } catch (error) {
    logApi.error('Error fetching token sync status:', error);
    res.status(500).json({ error: 'Failed to fetch token sync status' });
  }
});

/**
 * Start a token sync operation
 */
router.post('/start', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Check if sync is already in progress
    if (marketDataService.syncInProgress) {
      return res.status(409).json({ 
        error: 'Token sync already in progress', 
        startedAt: marketDataService.lastSyncStartTime 
      });
    }
    
    // Check if sync is scheduled
    if (marketDataService.syncScheduled) {
      return res.status(409).json({ 
        error: 'Token sync already scheduled', 
        scheduledAt: marketDataService.syncScheduled 
      });
    }
    
    // Log the admin action
    adminLogger.log(req.user, 'Started token sync', {
      action: 'start_token_sync',
      user: req.user.id,
      timestamp: new Date()
    });
    
    // Start the background sync
    marketDataService.startBackgroundSync();
    
    res.json({ 
      success: true, 
      message: 'Token sync started successfully',
      scheduled: true,
      startTime: new Date()
    });
  } catch (error) {
    logApi.error('Error starting token sync:', error);
    res.status(500).json({ error: 'Failed to start token sync' });
  }
});

/**
 * Cancel a token sync operation
 */
router.post('/cancel', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Check if sync is not in progress
    if (!marketDataService.syncInProgress && !marketDataService.syncScheduled) {
      return res.status(404).json({ error: 'No token sync in progress or scheduled' });
    }
    
    // Log the admin action
    adminLogger.log(req.user, 'Cancelled token sync', {
      action: 'cancel_token_sync',
      user: req.user.id,
      timestamp: new Date()
    });
    
    // Cancel the sync
    const wasSyncing = marketDataService.syncInProgress;
    const wasScheduled = marketDataService.syncScheduled;
    
    marketDataService.syncInProgress = false;
    marketDataService.syncScheduled = false;
    
    res.json({ 
      success: true, 
      message: `Token sync ${wasSyncing ? 'in progress' : 'scheduled'} was cancelled`,
      wasSyncing,
      wasScheduled
    });
  } catch (error) {
    logApi.error('Error cancelling token sync:', error);
    res.status(500).json({ error: 'Failed to cancel token sync' });
  }
});

export default router;