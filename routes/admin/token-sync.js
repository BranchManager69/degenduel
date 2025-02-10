import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import tokenSyncService from '../../services/tokenSyncService.js';
import { logApi } from '../../utils/logger-suite/logger.js';

const router = express.Router();

// Helper function to safely format percentage
function formatPercentage(value, total) {
  if (!total || total === 0) return '0.00%';
  return `${((value || 0) / total * 100).toFixed(2)}%`;
}

// Helper function to safely format duration
function formatDuration(ms) {
  if (!ms || typeof ms !== 'number') return '0ms';
  return `${Math.max(0, Math.floor(ms))}ms`;
}

// Helper function to safely get stats
function getSafeStats() {
  return {
    totalProcessed: tokenSyncService.syncStats?.totalProcessed || 0,
    validationFailures: tokenSyncService.syncStats?.validationFailures || {
      urls: 0,
      descriptions: 0,
      symbols: 0,
      names: 0,
      addresses: 0
    },
    metadataCompleteness: tokenSyncService.syncStats?.metadataCompleteness || {
      hasImage: 0,
      hasDescription: 0,
      hasTwitter: 0,
      hasTelegram: 0,
      hasDiscord: 0,
      hasWebsite: 0
    },
    performance: tokenSyncService.syncStats?.performance || {
      lastSyncDuration: 0,
      averageSyncDuration: 0,
      syncCount: 0
    },
    history: tokenSyncService.syncStats?.history || {
      lastSync: null,
      lastSuccessfulSync: null,
      failedSyncs: 0,
      consecutiveFailures: 0
    },
    updates: tokenSyncService.syncStats?.updates || {
      created: 0,
      updated: 0,
      failed: 0,
      unchanged: 0,
      totalSince: {
        created: 0,
        updated: 0,
        failed: 0
      }
    },
    successRate: tokenSyncService.syncStats?.successRate || 0
  };
}

// Get current sync status and statistics
router.get('/status', requireAuth, requireAdmin, (req, res) => {
  try {
    const stats = getSafeStats();
    const status = {
      current: {
        lastSync: stats.history.lastSync,
        lastSuccessfulSync: stats.history.lastSuccessfulSync,
        consecutiveFailures: stats.history.consecutiveFailures,
        isHealthy: stats.history.consecutiveFailures < 3,
        syncCount: stats.performance.syncCount
      },
      performance: {
        lastSyncDuration: formatDuration(stats.performance.lastSyncDuration),
        averageSyncDuration: formatDuration(stats.performance.averageSyncDuration),
        totalSyncs: stats.performance.syncCount
      },
      reliability: {
        successRate: formatPercentage(stats.totalProcessed - stats.updates.failed, stats.totalProcessed),
        totalFailedSyncs: stats.history.failedSyncs,
        validationFailures: stats.validationFailures
      },
      updates: {
        current: {
          created: stats.updates.created,
          updated: stats.updates.updated,
          unchanged: stats.updates.unchanged,
          failed: stats.updates.failed,
          total: stats.totalProcessed
        },
        total: stats.updates.totalSince
      },
      metadataQuality: {
        completeness: Object.fromEntries(
          Object.entries(stats.metadataCompleteness)
            .map(([key, value]) => [key, formatPercentage(value, stats.totalProcessed)])
        )
      }
    };

    res.json(status);
  } catch (error) {
    logApi.error('Error fetching sync status:', error);
    res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

// Get detailed validation failures
router.get('/validation-stats', requireAuth, requireAdmin, (req, res) => {
  try {
    const stats = getSafeStats();
    const response = {
      validationFailures: stats.validationFailures,
      totalProcessed: stats.totalProcessed,
      failureRates: Object.fromEntries(
        Object.entries(stats.validationFailures)
          .map(([key, value]) => [key, formatPercentage(value, stats.totalProcessed)])
      ),
      summary: {
        totalFailures: Object.values(stats.validationFailures).reduce((a, b) => a + (b || 0), 0),
        failureRate: formatPercentage(
          Object.values(stats.validationFailures).reduce((a, b) => a + (b || 0), 0),
          stats.totalProcessed
        )
      }
    };

    res.json(response);
  } catch (error) {
    logApi.error('Error fetching validation stats:', error);
    res.status(500).json({ error: 'Failed to fetch validation statistics' });
  }
});

// Get metadata completeness metrics
router.get('/metadata-quality', requireAuth, requireAdmin, (req, res) => {
  try {
    const stats = getSafeStats();
    const quality = {
      completeness: Object.fromEntries(
        Object.entries(stats.metadataCompleteness)
          .map(([key, value]) => [key, {
            count: value,
            percentage: formatPercentage(value, stats.totalProcessed)
          }])
      ),
      totalTokens: stats.totalProcessed,
      summary: {
        averageCompleteness: formatPercentage(
          Object.values(stats.metadataCompleteness)
            .reduce((a, b) => a + (b || 0), 0) / Object.keys(stats.metadataCompleteness).length,
          stats.totalProcessed
        )
      }
    };

    res.json(quality);
  } catch (error) {
    logApi.error('Error fetching metadata quality stats:', error);
    res.status(500).json({ error: 'Failed to fetch metadata quality statistics' });
  }
});

// Health check endpoint
router.get('/health', requireAuth, requireAdmin, (req, res) => {
  try {
    const stats = getSafeStats();
    const isHealthy = (stats.history.consecutiveFailures || 0) < 3;
    const lastSyncAge = stats.history.lastSync 
      ? Date.now() - new Date(stats.history.lastSync).getTime()
      : Infinity;
    const isSyncRecent = lastSyncAge < 10 * 60 * 1000; // 10 minutes
    const hasMinimalMetadata = stats.totalProcessed > 0 && 
      Object.values(stats.metadataCompleteness).some(v => v > 0);

    const health = {
      status: isHealthy && isSyncRecent && hasMinimalMetadata ? 'healthy' : 'unhealthy',
      checks: {
        syncHealth: {
          status: isHealthy ? 'pass' : 'fail',
          consecutiveFailures: stats.history.consecutiveFailures || 0
        },
        syncFreshness: {
          status: isSyncRecent ? 'pass' : 'fail',
          lastSync: stats.history.lastSync,
          timeSinceLastSync: `${Math.floor(lastSyncAge / 1000)}s`
        },
        dataQuality: {
          status: hasMinimalMetadata ? 'pass' : 'fail',
          tokensProcessed: stats.totalProcessed,
          hasMetadata: Object.values(stats.metadataCompleteness).some(v => v > 0)
        }
      },
      metrics: {
        successRate: formatPercentage(stats.totalProcessed - stats.updates.failed, stats.totalProcessed),
        averageSyncDuration: formatDuration(stats.performance.averageSyncDuration),
        totalSyncs: stats.performance.syncCount
      },
      issues: []
    };

    if (!isHealthy) {
      health.issues.push(`Too many consecutive failures (${stats.history.consecutiveFailures})`);
    }
    if (!isSyncRecent) {
      health.issues.push(`Sync is stale (${Math.floor(lastSyncAge / 1000)}s since last sync)`);
    }
    if (!hasMinimalMetadata) {
      health.issues.push('No metadata found in processed tokens');
    }

    res.json(health);
  } catch (error) {
    logApi.error('Error in health check:', error);
    res.status(500).json({
      status: 'error',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 