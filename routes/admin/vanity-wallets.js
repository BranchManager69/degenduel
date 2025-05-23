// routes/admin/vanity-wallets.js

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import VanityApiClient from '../../services/vanity-wallet/vanity-api-client.js';
import { requireSuperAdmin, requireAdmin } from '../../middleware/auth.js';
import AdminLogger from '../../utils/admin-logger.js';
import crypto from 'crypto';
import config from '../../config/config.js';
import prisma from '../../config/prisma.js';

const router = express.Router();

/**
 * GET /api/admin/vanity-wallets
 * Get all vanity wallets with optional filtering
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { 
      status, 
      isUsed, 
      pattern, 
      limit = 100, 
      offset = 0 
    } = req.query;
    
    // Parse boolean parameters
    const parsedIsUsed = isUsed === 'true' ? true : 
                       isUsed === 'false' ? false : undefined;
    
    // Get wallets with API client
    const result = await VanityApiClient.getVanityWallets({
      status,
      isUsed: parsedIsUsed,
      pattern,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_WALLET_LIST',
      {
        filter: { status, isUsed, pattern },
        pagination: { limit, offset },
        totalRecords: result.pagination.total
      },
      req
    );
    
    return res.status(200).json(result);
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Getting vanity wallets: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      query: req.query
    });
    
    return res.status(500).json({
      error: 'Failed to get vanity wallets',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/vanity-wallets
 * Create a new vanity wallet generation request
 */
router.post('/', requireSuperAdmin, async (req, res) => {
  try {
    const { 
      pattern, 
      isSuffix = false, 
      caseSensitive = true 
    } = req.body;
    
    // Validate pattern
    if (!pattern || typeof pattern !== 'string' || pattern.length < 1 || pattern.length > 10) {
      return res.status(400).json({
        error: 'Invalid pattern',
        message: 'Pattern must be a string between 1 and 10 characters'
      });
    }
    
    // Get client IP for record-keeping
    const clientIp = req.headers['x-forwarded-for'] || 
      req.connection.remoteAddress || 
      req.socket.remoteAddress || 
      (req.connection.socket ? req.connection.socket.remoteAddress : null);
    
    // Create request with API client (now using local implementation)
    const result = await VanityApiClient.createVanityAddressRequest({
      pattern,
      isSuffix,
      caseSensitive,
      requestedBy: req.user.wallet_address,
      requestIp: clientIp
    });
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_WALLET_CREATE',
      {
        pattern,
        isSuffix,
        caseSensitive,
        requestId: result.id
      },
      req
    );
    
    return res.status(202).json({
      status: 'accepted',
      message: `Vanity wallet generation for pattern '${pattern}' has been queued`,
      requestId: result.id,
      pattern,
      isSuffix,
      caseSensitive,
      createdAt: result.created_at
    });
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Creating vanity wallet: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    
    return res.status(500).json({
      error: 'Failed to create vanity wallet request',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/vanity-wallets/:id
 * Get a specific vanity wallet by ID
 */
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get wallet from database
    const wallet = await prisma.vanity_wallet_pool.findUnique({
      where: { id: parseInt(id) }
    });
    
    if (!wallet) {
      return res.status(404).json({
        error: 'Vanity wallet not found',
        message: `No vanity wallet found with ID ${id}`
      });
    }
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_WALLET_VIEW',
      {
        walletId: wallet.id,
        pattern: wallet.pattern,
        status: wallet.status
      },
      req
    );
    
    // Never return the private key in the response
    const response = {
      ...wallet,
      private_key: wallet.private_key ? '[REDACTED]' : null
    };
    
    return res.status(200).json(response);
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Getting vanity wallet: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      params: req.params
    });
    
    return res.status(500).json({
      error: 'Failed to get vanity wallet',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/vanity-wallets/:id/cancel
 * Cancel a vanity wallet generation job
 */
router.post('/:id/cancel', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Cancel the request using the API client
    const updatedWallet = await VanityApiClient.cancelVanityAddressRequest(parseInt(id));
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_WALLET_CANCEL',
      {
        walletId: updatedWallet.id,
        pattern: updatedWallet.pattern
      },
      req
    );
    
    return res.status(200).json({
      status: 'cancelled',
      message: 'Vanity wallet generation job cancelled',
      walletId: updatedWallet.id,
      pattern: updatedWallet.pattern
    });
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Cancelling vanity wallet job: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      params: req.params
    });
    
    return res.status(500).json({
      error: 'Failed to cancel vanity wallet job',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/vanity-wallets/batch
 * Create multiple vanity wallet generation requests in a batch
 */
router.post('/batch', requireSuperAdmin, async (req, res) => {
  try {
    const { patterns, isSuffix = false, caseSensitive = true } = req.body;
    
    // Validate patterns
    if (!Array.isArray(patterns) || patterns.length === 0) {
      return res.status(400).json({
        error: 'Invalid patterns',
        message: 'Patterns must be a non-empty array of strings'
      });
    }
    
    // Validate each pattern
    for (const pattern of patterns) {
      if (typeof pattern !== 'string' || pattern.length < 1 || pattern.length > 10) {
        return res.status(400).json({
          error: 'Invalid pattern',
          message: `Pattern '${pattern}' must be a string between 1 and 10 characters`
        });
      }
    }
    
    // Get client IP for record-keeping
    const clientIp = req.headers['x-forwarded-for'] || 
      req.connection.remoteAddress || 
      req.socket.remoteAddress || 
      (req.connection.socket ? req.connection.socket.remoteAddress : null);
    
    // Create requests with API client
    const results = [];
    for (const pattern of patterns) {
      try {
        const result = await VanityApiClient.createVanityAddressRequest({
          pattern,
          isSuffix,
          caseSensitive,
          requestedBy: req.user.wallet_address,
          requestIp: clientIp
        });
        
        results.push({
          status: 'accepted',
          pattern,
          requestId: result.id
        });
      } catch (error) {
        results.push({
          status: 'failed',
          pattern,
          error: error.message
        });
      }
    }
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_WALLET_BATCH_CREATE',
      {
        patterns,
        isSuffix,
        caseSensitive,
        results
      },
      req
    );
    
    return res.status(202).json({
      status: 'accepted',
      message: `Batch of ${patterns.length} vanity wallet generation requests submitted`,
      results
    });
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Creating batch vanity wallet requests: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    
    return res.status(500).json({
      error: 'Failed to create batch vanity wallet requests',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/vanity-wallets/status/generator
 * Get the status of the vanity wallet generator
 */
router.get('/status/generator', requireAdmin, async (req, res) => {
  try {
    const status = await VanityApiClient.getGeneratorStatus();
    
    // Get additional system metrics for enhanced dashboard display
    const systemMetrics = {
      activeJobs: status.generatorStatus.activeJobs.length,
      queuedJobs: status.generatorStatus.queuedJobs,
      recentlyCompleted: await getRecentlyCompletedJobs(),
      completion: await getCompletionStats(),
      performance: await getGeneratorPerformance(),
      patterns: await getPopularPatterns(),
      worker: {
        threads: config.vanityWallet?.numWorkers || 4,
        cpuLimit: config.vanityWallet?.cpuLimit || 75,
        maxAttempts: config.vanityWallet?.maxAttempts || 50000000
      }
    };
    
    // Enrich the response with system metrics
    const enrichedResponse = {
      ...status,
      systemMetrics
    };
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_GENERATOR_STATUS_CHECK',
      {
        status,
        metrics: systemMetrics
      },
      req
    );
    
    return res.status(200).json(enrichedResponse);
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Getting generator status: ${error.message}`, {
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      error: 'Failed to get generator status',
      message: error.message
    });
  }
});

/**
 * Helper function to get recently completed vanity wallet jobs
 * @returns {Promise<Array>} Array of recently completed jobs
 */
async function getRecentlyCompletedJobs() {
  try {
    // Get the 5 most recently completed jobs
    const recentJobs = await prisma.vanity_wallet_pool.findMany({
      where: {
        status: 'completed'
      },
      orderBy: {
        completed_at: 'desc'
      },
      take: 5,
      select: {
        id: true,
        pattern: true,
        is_suffix: true,
        case_sensitive: true,
        attempts: true,
        duration_ms: true,
        wallet_address: true,
        completed_at: true
      }
    });
    
    return recentJobs;
  } catch (error) {
    logApi.error(`Error fetching recently completed jobs: ${error.message}`);
    return [];
  }
}

/**
 * Helper function to get completion statistics
 * @returns {Promise<Object>} Completion statistics
 */
async function getCompletionStats() {
  try {
    // Calculate success rate and average completion time
    const [
      totalJobs,
      completedJobs,
      failedJobs,
      cancelledJobs,
      pendingJobs,
      processingJobs
    ] = await Promise.all([
      prisma.vanity_wallet_pool.count(),
      prisma.vanity_wallet_pool.count({ where: { status: 'completed' } }),
      prisma.vanity_wallet_pool.count({ where: { status: 'failed' } }),
      prisma.vanity_wallet_pool.count({ where: { status: 'cancelled' } }),
      prisma.vanity_wallet_pool.count({ where: { status: 'pending' } }),
      prisma.vanity_wallet_pool.count({ where: { status: 'processing' } })
    ]);
    
    // Get average duration for completed jobs
    const avgDurationResult = await prisma.vanity_wallet_pool.aggregate({
      where: {
        status: 'completed',
        duration_ms: { not: null }
      },
      _avg: {
        duration_ms: true,
        attempts: true
      }
    });
    
    const avgDuration = avgDurationResult._avg.duration_ms || 0;
    const avgAttempts = avgDurationResult._avg.attempts || 0;
    
    // Get distribution by pattern length
    const patternLengthData = await prisma.$queryRaw`
      SELECT 
        LENGTH(pattern) as length,
        COUNT(*) as count,
        AVG(duration_ms) as avg_duration,
        AVG(attempts) as avg_attempts
      FROM vanity_wallet_pool
      WHERE status = 'completed'
      GROUP BY LENGTH(pattern)
      ORDER BY length ASC
    `;
    
    return {
      totalJobs,
      completedJobs,
      failedJobs,
      cancelledJobs,
      pendingJobs,
      processingJobs,
      successRate: totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0,
      avgDurationMs: avgDuration,
      avgDurationSeconds: avgDuration / 1000,
      avgAttempts,
      patternLengthStats: patternLengthData.map(item => ({
        length: Number(item.length),
        count: Number(item.count),
        avgDurationSeconds: Number(item.avg_duration) / 1000,
        avgAttempts: Number(item.avg_attempts)
      }))
    };
  } catch (error) {
    logApi.error(`Error calculating completion stats: ${error.message}`);
    return {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      cancelledJobs: 0,
      pendingJobs: 0,
      processingJobs: 0,
      successRate: 0,
      avgDurationMs: 0,
      avgDurationSeconds: 0,
      avgAttempts: 0,
      patternLengthStats: []
    };
  }
}

/**
 * Helper function to get generator performance metrics
 * @returns {Promise<Object>} Performance metrics
 */
async function getGeneratorPerformance() {
  try {
    // Calculate average attempts per second
    const performanceData = await prisma.vanity_wallet_pool.findMany({
      where: {
        status: 'completed',
        duration_ms: { not: 0 },
        attempts: { not: 0 }
      },
      select: {
        pattern: true,
        case_sensitive: true,
        attempts: true,
        duration_ms: true
      },
      orderBy: {
        completed_at: 'desc'
      },
      take: 20 // Use the 20 most recent completions for performance stats
    });
    
    // Calculate attempts per second for each job
    const performanceStats = performanceData.map(job => {
      const attemptsPerSecond = job.attempts / (job.duration_ms / 1000);
      const characterSpace = job.case_sensitive ? 58 : 33; // 58 for case-sensitive (base58), 33 for case-insensitive
      
      return {
        pattern: job.pattern,
        length: job.pattern.length,
        caseSensitive: job.case_sensitive,
        attempts: job.attempts,
        durationSeconds: job.duration_ms / 1000,
        attemptsPerSecond
      };
    });
    
    // Calculate averages
    const avgAttemptsPerSecond = performanceStats.length > 0 
      ? performanceStats.reduce((sum, job) => sum + job.attemptsPerSecond, 0) / performanceStats.length
      : 0;
      
    // Group by pattern length
    const performanceByLength = {};
    performanceStats.forEach(stat => {
      if (!performanceByLength[stat.length]) {
        performanceByLength[stat.length] = [];
      }
      performanceByLength[stat.length].push(stat);
    });
    
    // Calculate averages by length
    const averagesByLength = Object.entries(performanceByLength).map(([length, stats]) => {
      const avgAttemptsPerSecond = stats.reduce((sum, job) => sum + job.attemptsPerSecond, 0) / stats.length;
      
      return {
        patternLength: parseInt(length),
        avgAttemptsPerSecond,
        count: stats.length
      };
    });
    
    return {
      avgAttemptsPerSecond,
      recentCompletions: performanceStats,
      byPatternLength: averagesByLength
    };
  } catch (error) {
    logApi.error(`Error calculating generator performance: ${error.message}`);
    return {
      avgAttemptsPerSecond: 0,
      recentCompletions: [],
      byPatternLength: []
    };
  }
}

/**
 * Helper function to get popular patterns
 * @returns {Promise<Array>} Popular patterns statistics
 */
async function getPopularPatterns() {
  try {
    // Get the most popular patterns
    const popularPatterns = await prisma.$queryRaw`
      SELECT 
        pattern,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
        AVG(CASE WHEN status = 'completed' THEN duration_ms ELSE NULL END) as avg_duration,
        AVG(CASE WHEN status = 'completed' THEN attempts ELSE NULL END) as avg_attempts
      FROM vanity_wallet_pool
      GROUP BY pattern
      ORDER BY count DESC
      LIMIT 10
    `;
    
    return popularPatterns.map(item => ({
      pattern: item.pattern,
      count: Number(item.count),
      successful: Number(item.successful),
      successRate: item.count > 0 ? (Number(item.successful) / Number(item.count)) * 100 : 0,
      avgDurationSeconds: item.avg_duration ? Number(item.avg_duration) / 1000 : null,
      avgAttempts: item.avg_attempts ? Number(item.avg_attempts) : null
    }));
  } catch (error) {
    logApi.error(`Error fetching popular patterns: ${error.message}`);
    return [];
  }
}

export default router;