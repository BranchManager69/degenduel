// routes/admin/vanity-dashboard.js

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import VanityApiClient from '../../services/vanity-wallet/vanity-api-client.js';
import { requireSuperAdmin, requireAdmin } from '../../middleware/auth.js';
import AdminLogger from '../../utils/admin-logger.js';
import config from '../../config/config.js';
import prisma from '../../config/prisma.js';
import { cpus, loadavg, totalmem, freemem } from 'os';

const router = express.Router();

/**
 * GET /api/admin/vanity-dashboard
 * Get comprehensive statistical data about the vanity wallet generation system
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    logApi.info(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Fetching ${fancyColors.RESET} vanity wallet dashboard statistics`);
    
    // Get current generator status
    const generatorStatus = await VanityApiClient.getGeneratorStatus();
    
    // Collect comprehensive statistics about the system
    const [
      systemHealth,
      performanceMetrics,
      patternStats,
      completionTimeStats,
      timeSeriesData,
      systemResources
    ] = await Promise.all([
      getSystemHealthStats(),
      getPerformanceMetrics(),
      getPatternStatistics(),
      getCompletionTimeEstimates(),
      getTimeSeriesData(),
      getSystemResourceUtilization()
    ]);
    
    // Combine all statistics into a single response
    const dashboardData = {
      generatorStatus: generatorStatus.generatorStatus,
      systemHealth,
      performanceMetrics,
      patternStats,
      completionTimeStats,
      timeSeriesData,
      systemResources
    };
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_DASHBOARD_VIEW',
      {
        activeJobs: generatorStatus.generatorStatus.activeJobs.length,
        queuedJobs: generatorStatus.generatorStatus.queuedJobs,
        timestamp: new Date()
      },
      req
    );
    
    return res.status(200).json(dashboardData);
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Fetching vanity dashboard statistics: ${error.message}`, {
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      error: 'Failed to fetch vanity dashboard statistics',
      message: error.message
    });
  }
});

/**
 * Helper function to get system health statistics
 * @returns {Promise<Object>} System health statistics
 */
async function getSystemHealthStats() {
  try {
    // Get job counts by status
    const [
      totalJobs,
      activeJobs,
      queuedJobs,
      completedJobs,
      failedJobs,
      cancelledJobs
    ] = await Promise.all([
      prisma.vanity_wallet_pool.count(),
      prisma.vanity_wallet_pool.count({ where: { status: 'processing' } }),
      prisma.vanity_wallet_pool.count({ where: { status: 'pending' } }),
      prisma.vanity_wallet_pool.count({ where: { status: 'completed' } }),
      prisma.vanity_wallet_pool.count({ where: { status: 'failed' } }),
      prisma.vanity_wallet_pool.count({ where: { status: 'cancelled' } })
    ]);
    
    // Get success rate
    const successRate = totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0;
    
    // Get average completion time
    const avgCompletionTime = await prisma.vanity_wallet_pool.aggregate({
      where: {
        status: 'completed',
        duration_ms: { not: null }
      },
      _avg: {
        duration_ms: true
      }
    });
    
    // Get last completion
    const lastCompletion = await prisma.vanity_wallet_pool.findFirst({
      where: {
        status: 'completed'
      },
      orderBy: {
        completed_at: 'desc'
      },
      select: {
        id: true,
        pattern: true,
        completed_at: true,
        duration_ms: true,
        attempts: true
      }
    });
    
    // Get oldest pending job
    const oldestPendingJob = await prisma.vanity_wallet_pool.findFirst({
      where: {
        status: 'pending'
      },
      orderBy: {
        created_at: 'asc'
      },
      select: {
        id: true,
        pattern: true,
        created_at: true
      }
    });
    
    // Get system configuration
    const systemConfig = {
      numWorkers: config.vanityWallet?.numWorkers || 4,
      cpuLimit: config.vanityWallet?.cpuLimit || 75,
      maxAttempts: config.vanityWallet?.maxAttempts || 50000000
    };
    
    return {
      jobCounts: {
        total: totalJobs,
        active: activeJobs,
        queued: queuedJobs,
        completed: completedJobs,
        failed: failedJobs,
        cancelled: cancelledJobs
      },
      successRate,
      avgCompletionTimeMs: avgCompletionTime._avg.duration_ms || 0,
      avgCompletionTimeFormatted: formatDuration(avgCompletionTime._avg.duration_ms || 0),
      lastCompletion,
      oldestPendingJob,
      systemConfig,
      generatorHealth: await checkGeneratorHealth()
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} Error getting system health stats: ${error.message}`);
    return {
      jobCounts: {
        total: 0,
        active: 0,
        queued: 0,
        completed: 0,
        failed: 0,
        cancelled: 0
      },
      successRate: 0,
      avgCompletionTimeMs: 0,
      avgCompletionTimeFormatted: '0s',
      lastCompletion: null,
      oldestPendingJob: null,
      systemConfig: {
        numWorkers: config.vanityWallet?.numWorkers || 4,
        cpuLimit: config.vanityWallet?.cpuLimit || 75,
        maxAttempts: config.vanityWallet?.maxAttempts || 50000000
      },
      generatorHealth: { status: 'unknown', isHealthy: false }
    };
  }
}

/**
 * Helper function to check generator health
 * @returns {Promise<Object>} Generator health status
 */
async function checkGeneratorHealth() {
  try {
    // Check if generator is available
    const isHealthy = await VanityApiClient.checkHealth();
    
    // Get most recent job completions
    const recentCompletions = await prisma.vanity_wallet_pool.findMany({
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
        completed_at: true
      }
    });
    
    // Check if there have been recent completions (within last 24 hours)
    const hasRecentCompletions = recentCompletions.length > 0 && 
      recentCompletions[0].completed_at > new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Check if there are any stalled jobs (processing for more than 2 hours)
    const stalledJobs = await prisma.vanity_wallet_pool.findMany({
      where: {
        status: 'processing',
        updated_at: {
          lt: new Date(Date.now() - 2 * 60 * 60 * 1000)
        }
      },
      select: {
        id: true,
        pattern: true,
        updated_at: true
      }
    });
    
    // Determine status
    let status = 'healthy';
    if (!isHealthy) {
      status = 'offline';
    } else if (stalledJobs.length > 0) {
      status = 'stalled';
    } else if (!hasRecentCompletions) {
      status = 'inactive';
    }
    
    return {
      status,
      isHealthy,
      hasRecentCompletions,
      stalledJobs,
      recentCompletions
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} Error checking generator health: ${error.message}`);
    return {
      status: 'error',
      isHealthy: false,
      hasRecentCompletions: false,
      stalledJobs: [],
      recentCompletions: []
    };
  }
}

/**
 * Helper function to get performance metrics
 * @returns {Promise<Object>} Performance metrics
 */
async function getPerformanceMetrics() {
  try {
    // Get completed jobs for performance analysis
    const completedJobs = await prisma.vanity_wallet_pool.findMany({
      where: {
        status: 'completed',
        duration_ms: { not: 0 },
        attempts: { not: 0 }
      },
      select: {
        id: true,
        pattern: true,
        is_suffix: true,
        case_sensitive: true,
        attempts: true,
        duration_ms: true,
        completed_at: true
      },
      orderBy: {
        completed_at: 'desc'
      },
      take: 50 // Use last 50 jobs for performance metrics
    });
    
    // Calculate attempts per second for each job
    const performanceData = completedJobs.map(job => {
      const attemptsPerSecond = job.attempts / (job.duration_ms / 1000);
      const patternLength = job.pattern.length;
      
      return {
        id: job.id,
        pattern: job.pattern,
        patternLength,
        isSuffix: job.is_suffix,
        caseSensitive: job.case_sensitive,
        attempts: job.attempts,
        durationMs: job.duration_ms,
        durationFormatted: formatDuration(job.duration_ms),
        attemptsPerSecond,
        completedAt: job.completed_at
      };
    });
    
    // Calculate overall average attempts per second
    const avgAttemptsPerSecond = performanceData.length > 0
      ? performanceData.reduce((sum, job) => sum + job.attemptsPerSecond, 0) / performanceData.length
      : 0;
    
    // Group by pattern length
    const performanceByLength = {};
    performanceData.forEach(stat => {
      if (!performanceByLength[stat.patternLength]) {
        performanceByLength[stat.patternLength] = [];
      }
      performanceByLength[stat.patternLength].push(stat);
    });
    
    // Calculate averages by pattern length
    const averagesByLength = Object.entries(performanceByLength).map(([length, stats]) => {
      const avgAttemptsPerSecond = stats.reduce((sum, job) => sum + job.attemptsPerSecond, 0) / stats.length;
      const avgDurationMs = stats.reduce((sum, job) => sum + job.durationMs, 0) / stats.length;
      
      return {
        patternLength: parseInt(length),
        avgAttemptsPerSecond,
        avgDurationMs,
        avgDurationFormatted: formatDuration(avgDurationMs),
        count: stats.length,
        successRate: stats.length / completedJobs.length * 100
      };
    });
    
    // Group by case sensitivity
    const caseSensitiveJobs = performanceData.filter(job => job.caseSensitive);
    const caseInsensitiveJobs = performanceData.filter(job => !job.caseSensitive);
    
    const avgCaseSensitive = caseSensitiveJobs.length > 0
      ? caseSensitiveJobs.reduce((sum, job) => sum + job.attemptsPerSecond, 0) / caseSensitiveJobs.length
      : 0;
      
    const avgCaseInsensitive = caseInsensitiveJobs.length > 0
      ? caseInsensitiveJobs.reduce((sum, job) => sum + job.attemptsPerSecond, 0) / caseInsensitiveJobs.length
      : 0;
    
    return {
      overall: {
        avgAttemptsPerSecond,
        totalJobsAnalyzed: performanceData.length,
        mostRecentJob: performanceData[0] || null,
        fastestJob: [...performanceData].sort((a, b) => b.attemptsPerSecond - a.attemptsPerSecond)[0] || null,
        slowestJob: [...performanceData].sort((a, b) => a.attemptsPerSecond - b.attemptsPerSecond)[0] || null
      },
      byPatternLength: averagesByLength,
      caseOptions: {
        avgCaseSensitive,
        avgCaseInsensitive,
        caseSensitiveCount: caseSensitiveJobs.length,
        caseInsensitiveCount: caseInsensitiveJobs.length
      },
      recentJobData: performanceData.slice(0, 10) // Only return the 10 most recent jobs
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} Error getting performance metrics: ${error.message}`);
    return {
      overall: {
        avgAttemptsPerSecond: 0,
        totalJobsAnalyzed: 0,
        mostRecentJob: null,
        fastestJob: null,
        slowestJob: null
      },
      byPatternLength: [],
      caseOptions: {
        avgCaseSensitive: 0,
        avgCaseInsensitive: 0,
        caseSensitiveCount: 0,
        caseInsensitiveCount: 0
      },
      recentJobData: []
    };
  }
}

/**
 * Helper function to get pattern statistics
 * @returns {Promise<Object>} Pattern statistics
 */
async function getPatternStatistics() {
  try {
    // Get most popular patterns
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
      LIMIT 20
    `;
    
    // Get pattern length distribution
    const patternLengthDistribution = await prisma.$queryRaw`
      SELECT 
        LENGTH(pattern) as length,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
        AVG(CASE WHEN status = 'completed' THEN duration_ms ELSE NULL END) as avg_duration,
        AVG(CASE WHEN status = 'completed' THEN attempts ELSE NULL END) as avg_attempts
      FROM vanity_wallet_pool
      GROUP BY LENGTH(pattern)
      ORDER BY length ASC
    `;
    
    // Get recently completed patterns
    const recentlyCompleted = await prisma.vanity_wallet_pool.findMany({
      where: {
        status: 'completed'
      },
      select: {
        id: true,
        pattern: true,
        is_suffix: true,
        case_sensitive: true,
        attempts: true,
        duration_ms: true,
        wallet_address: true,
        completed_at: true
      },
      orderBy: {
        completed_at: 'desc'
      },
      take: 10
    });
    
    // Format the pattern stats
    const formattedPopularPatterns = popularPatterns.map(item => ({
      pattern: item.pattern,
      count: Number(item.count),
      successful: Number(item.successful),
      successRate: item.count > 0 ? (Number(item.successful) / Number(item.count)) * 100 : 0,
      avgDurationMs: item.avg_duration ? Number(item.avg_duration) : null,
      avgDurationFormatted: item.avg_duration ? formatDuration(Number(item.avg_duration)) : null,
      avgAttempts: item.avg_attempts ? Number(item.avg_attempts) : null
    }));
    
    const formattedLengthDistribution = patternLengthDistribution.map(item => ({
      length: Number(item.length),
      count: Number(item.count),
      successful: Number(item.successful),
      successRate: item.count > 0 ? (Number(item.successful) / Number(item.count)) * 100 : 0,
      avgDurationMs: item.avg_duration ? Number(item.avg_duration) : null,
      avgDurationFormatted: item.avg_duration ? formatDuration(Number(item.avg_duration)) : null,
      avgAttempts: item.avg_attempts ? Number(item.avg_attempts) : null
    }));
    
    const formattedRecentlyCompleted = recentlyCompleted.map(item => ({
      id: item.id,
      pattern: item.pattern,
      isSuffix: item.is_suffix,
      caseSensitive: item.case_sensitive,
      attempts: item.attempts,
      durationMs: item.duration_ms,
      durationFormatted: formatDuration(item.duration_ms),
      attemptsPerSecond: item.duration_ms > 0 ? item.attempts / (item.duration_ms / 1000) : 0,
      walletAddress: item.wallet_address,
      completedAt: item.completed_at
    }));
    
    return {
      popularPatterns: formattedPopularPatterns,
      lengthDistribution: formattedLengthDistribution,
      recentlyCompleted: formattedRecentlyCompleted
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} Error getting pattern statistics: ${error.message}`);
    return {
      popularPatterns: [],
      lengthDistribution: [],
      recentlyCompleted: []
    };
  }
}

/**
 * Helper function to get completion time estimates
 * @returns {Promise<Object>} Completion time estimates
 */
async function getCompletionTimeEstimates() {
  try {
    // Get performance data by pattern length
    const performanceByLength = await prisma.$queryRaw`
      SELECT 
        LENGTH(pattern) as length,
        AVG(attempts) as avg_attempts,
        AVG(duration_ms) as avg_duration,
        AVG(attempts / (duration_ms / 1000.0)) as avg_attempts_per_second
      FROM vanity_wallet_pool
      WHERE status = 'completed' AND duration_ms > 0 AND attempts > 0
      GROUP BY LENGTH(pattern)
      ORDER BY length ASC
    `;
    
    // For base58 address, probability is roughly 1/(58^length)
    // For case-insensitive, probability is roughly 1/(33^length)
    const caseSensitiveCharSpace = 58; // Base58 character space
    const caseInsensitiveCharSpace = 33; // Approximate case-insensitive space
    
    // Calculate theoretical attempts needed and time estimates
    const theoreticalEstimates = [];
    for (let length = 1; length <= 10; length++) {
      const caseSensitiveProbability = 1 / Math.pow(caseSensitiveCharSpace, length);
      const caseInsensitiveProbability = 1 / Math.pow(caseInsensitiveCharSpace, length);
      
      const caseSensitiveAttempts = 1 / caseSensitiveProbability;
      const caseInsensitiveAttempts = 1 / caseInsensitiveProbability;
      
      theoreticalEstimates.push({
        patternLength: length,
        caseSensitive: {
          probability: caseSensitiveProbability,
          estimatedAttempts: caseSensitiveAttempts
        },
        caseInsensitive: {
          probability: caseInsensitiveProbability,
          estimatedAttempts: caseInsensitiveAttempts
        }
      });
    }
    
    // Get the average attempts per second across all completed jobs
    const avgAttemptsPerSecond = await prisma.vanity_wallet_pool.aggregate({
      where: {
        status: 'completed',
        duration_ms: { gt: 0 },
        attempts: { gt: 0 }
      },
      _avg: {
        _avg: {
          $expr: {
            $divide: ["$attempts", { $divide: ["$duration_ms", 1000] }]
          }
        }
      }
    });
    
    // Fallback to a reasonable default if no data
    const globalAvgAttemptsPerSecond = avgAttemptsPerSecond._avg?._avg || 100000;
    
    // Format the real-world estimates based on actual performance data
    const realWorldEstimates = performanceByLength.map(item => {
      const length = Number(item.length);
      const avgAttempts = Number(item.avg_attempts);
      const avgDuration = Number(item.avg_duration);
      const avgAttemptsPerSecond = Number(item.avg_attempts_per_second);
      
      // Find the theoretical estimate for this length
      const theoretical = theoreticalEstimates.find(t => t.patternLength === length);
      
      return {
        patternLength: length,
        actualAvgAttempts: avgAttempts,
        actualAvgDurationMs: avgDuration,
        actualAvgDurationFormatted: formatDuration(avgDuration),
        actualAttemptsPerSecond: avgAttemptsPerSecond,
        theoreticalEstimates: theoretical,
        // Estimated time for new jobs based on theoretical estimates and real performance
        estimatedCompletionTimeCaseSensitiveMs: theoretical?.caseSensitive.estimatedAttempts / avgAttemptsPerSecond * 1000 || 0,
        estimatedCompletionTimeCaseSensitiveFormatted: formatDuration(theoretical?.caseSensitive.estimatedAttempts / avgAttemptsPerSecond * 1000 || 0),
        estimatedCompletionTimeCaseInsensitiveMs: theoretical?.caseInsensitive.estimatedAttempts / avgAttemptsPerSecond * 1000 || 0,
        estimatedCompletionTimeCaseInsensitiveFormatted: formatDuration(theoretical?.caseInsensitive.estimatedAttempts / avgAttemptsPerSecond * 1000 || 0)
      };
    });
    
    // Fill in missing lengths using theoretical estimates and global average
    for (let length = 1; length <= 10; length++) {
      if (!realWorldEstimates.find(e => e.patternLength === length)) {
        const theoretical = theoreticalEstimates.find(t => t.patternLength === length);
        
        realWorldEstimates.push({
          patternLength: length,
          actualAvgAttempts: null,
          actualAvgDurationMs: null,
          actualAvgDurationFormatted: null,
          actualAttemptsPerSecond: null,
          theoreticalEstimates: theoretical,
          // Estimated time using global average attempts per second
          estimatedCompletionTimeCaseSensitiveMs: theoretical?.caseSensitive.estimatedAttempts / globalAvgAttemptsPerSecond * 1000 || 0,
          estimatedCompletionTimeCaseSensitiveFormatted: formatDuration(theoretical?.caseSensitive.estimatedAttempts / globalAvgAttemptsPerSecond * 1000 || 0),
          estimatedCompletionTimeCaseInsensitiveMs: theoretical?.caseInsensitive.estimatedAttempts / globalAvgAttemptsPerSecond * 1000 || 0,
          estimatedCompletionTimeCaseInsensitiveFormatted: formatDuration(theoretical?.caseInsensitive.estimatedAttempts / globalAvgAttemptsPerSecond * 1000 || 0)
        });
      }
    }
    
    // Sort by pattern length
    realWorldEstimates.sort((a, b) => a.patternLength - b.patternLength);
    
    return {
      theoreticalEstimates,
      realWorldEstimates,
      globalAvgAttemptsPerSecond
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} Error getting completion time estimates: ${error.message}`);
    return {
      theoreticalEstimates: [],
      realWorldEstimates: [],
      globalAvgAttemptsPerSecond: 0
    };
  }
}

/**
 * Helper function to get time series data for visualization
 * @returns {Promise<Object>} Time series data
 */
async function getTimeSeriesData() {
  try {
    // Get completed jobs with timestamps for time series analysis
    const completedJobs = await prisma.vanity_wallet_pool.findMany({
      where: {
        status: 'completed',
        duration_ms: { not: 0 },
        attempts: { not: 0 }
      },
      select: {
        id: true,
        pattern: true,
        attempts: true,
        duration_ms: true,
        completed_at: true
      },
      orderBy: {
        completed_at: 'asc'
      }
    });
    
    // Create time series data points
    const timeSeriesRaw = completedJobs.map(job => {
      const timestamp = job.completed_at.getTime();
      const attemptsPerSecond = job.attempts / (job.duration_ms / 1000);
      const patternLength = job.pattern.length;
      
      return {
        timestamp,
        date: job.completed_at,
        jobId: job.id,
        pattern: job.pattern,
        patternLength,
        attemptsPerSecond,
        durationMs: job.duration_ms
      };
    });
    
    // Group by date (day)
    const dailyTimeSeries = {};
    timeSeriesRaw.forEach(dataPoint => {
      const dateStr = dataPoint.date.toISOString().split('T')[0];
      
      if (!dailyTimeSeries[dateStr]) {
        dailyTimeSeries[dateStr] = {
          date: dateStr,
          totalJobs: 0,
          totalAttempts: 0,
          totalDurationMs: 0,
          avgAttemptsPerSecond: 0,
          jobs: []
        };
      }
      
      dailyTimeSeries[dateStr].totalJobs++;
      dailyTimeSeries[dateStr].totalAttempts += dataPoint.attempts;
      dailyTimeSeries[dateStr].totalDurationMs += dataPoint.durationMs;
      dailyTimeSeries[dateStr].jobs.push(dataPoint);
    });
    
    // Calculate daily averages
    Object.values(dailyTimeSeries).forEach(day => {
      day.avgAttemptsPerSecond = day.totalAttempts / (day.totalDurationMs / 1000);
    });
    
    // Convert to array and sort by date
    const dailyTimeSeriesArray = Object.values(dailyTimeSeries)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Calculate moving average (7-day window)
    const movingAverage = [];
    const windowSize = 7;
    
    for (let i = 0; i < dailyTimeSeriesArray.length; i++) {
      const windowStart = Math.max(0, i - windowSize + 1);
      const window = dailyTimeSeriesArray.slice(windowStart, i + 1);
      
      const total = window.reduce((sum, day) => sum + day.avgAttemptsPerSecond, 0);
      const avg = total / window.length;
      
      movingAverage.push({
        date: dailyTimeSeriesArray[i].date,
        avgAttemptsPerSecond: avg
      });
    }
    
    // Group by pattern length for analysis
    const byPatternLength = {};
    timeSeriesRaw.forEach(dataPoint => {
      if (!byPatternLength[dataPoint.patternLength]) {
        byPatternLength[dataPoint.patternLength] = [];
      }
      
      byPatternLength[dataPoint.patternLength].push(dataPoint);
    });
    
    // Calculate performance trends by pattern length
    const patternLengthTrends = {};
    Object.entries(byPatternLength).forEach(([length, dataPoints]) => {
      // Sort by date
      dataPoints.sort((a, b) => a.timestamp - b.timestamp);
      
      // Group into batches of 5 jobs for trend analysis
      const batchSize = 5;
      const batches = [];
      
      for (let i = 0; i < dataPoints.length; i += batchSize) {
        const batch = dataPoints.slice(i, i + batchSize);
        if (batch.length < 2) continue; // Skip batches that are too small
        
        const avgAttemptsPerSecond = batch.reduce((sum, dp) => sum + dp.attemptsPerSecond, 0) / batch.length;
        const startDate = new Date(batch[0].timestamp);
        const endDate = new Date(batch[batch.length - 1].timestamp);
        
        batches.push({
          startDate,
          endDate,
          avgAttemptsPerSecond,
          dataPoints: batch
        });
      }
      
      patternLengthTrends[length] = batches;
    });
    
    return {
      rawTimeSeries: timeSeriesRaw.slice(Math.max(0, timeSeriesRaw.length - 50)), // Last 50 points only to reduce payload size
      dailyTimeSeries: dailyTimeSeriesArray,
      movingAverage,
      patternLengthTrends
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} Error getting time series data: ${error.message}`);
    return {
      rawTimeSeries: [],
      dailyTimeSeries: [],
      movingAverage: [],
      patternLengthTrends: {}
    };
  }
}

/**
 * Helper function to get system resource utilization
 * @returns {Promise<Object>} System resource information
 */
async function getSystemResourceUtilization() {
  try {
    // Get CPU information
    const cpuInfo = {
      cores: cpus().length,
      model: cpus()[0].model,
      speed: cpus()[0].speed,
      loadAvg: loadavg()
    };
    
    // Get memory information
    const memoryInfo = {
      totalMemory: totalmem(),
      freeMemory: freemem(),
      usedMemory: totalmem() - freemem(),
      usedPercentage: Math.round(((totalmem() - freemem()) / totalmem()) * 100)
    };
    
    // Get disk space information (if available)
    let diskInfo = { available: 'Unknown' };
    try {
      // This is a very simple approach, for production you might want a more robust solution
      const dfOutput = await new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        exec('df -h /home', (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout);
        });
      });
      
      // Parse df output
      const lines = dfOutput.split('\n');
      if (lines.length > 1) {
        const parts = lines[1].trim().split(/\s+/);
        diskInfo = {
          filesystem: parts[0],
          total: parts[1],
          used: parts[2],
          available: parts[3],
          usedPercentage: parts[4],
          mountPoint: parts[5]
        };
      }
    } catch (diskError) {
      logApi.warn(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} Unable to get disk info: ${diskError.message}`);
    }
    
    // Get active processes info
    let processInfo = { nodeProcesses: 'Unknown' };
    try {
      const { exec } = require('child_process');
      const psOutput = await new Promise((resolve, reject) => {
        exec('ps aux | grep node | grep -v grep | wc -l', (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout.trim());
        });
      });
      
      const solanaKeygenOutput = await new Promise((resolve, reject) => {
        exec('ps aux | grep solana-keygen | grep -v grep | wc -l', (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout.trim());
        });
      });
      
      processInfo = {
        nodeProcesses: parseInt(psOutput) || 0,
        solanaKeygenProcesses: parseInt(solanaKeygenOutput) || 0
      };
    } catch (processError) {
      logApi.warn(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} Unable to get process info: ${processError.message}`);
    }
    
    // Get system uptime
    let uptimeInfo = { uptime: 'Unknown' };
    try {
      const { exec } = require('child_process');
      const uptimeOutput = await new Promise((resolve, reject) => {
        exec('uptime', (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout.trim());
        });
      });
      
      uptimeInfo = {
        uptime: uptimeOutput
      };
    } catch (uptimeError) {
      logApi.warn(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} Unable to get uptime info: ${uptimeError.message}`);
    }
    
    return {
      cpu: cpuInfo,
      memory: memoryInfo,
      disk: diskInfo,
      processes: processInfo,
      uptime: uptimeInfo,
      timestamp: new Date()
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityDashboard]${fancyColors.RESET} Error getting system resource utilization: ${error.message}`);
    return {
      cpu: { cores: 0, model: 'Unknown', speed: 0, loadAvg: [0, 0, 0] },
      memory: { totalMemory: 0, freeMemory: 0, usedMemory: 0, usedPercentage: 0 },
      disk: { available: 'Unknown' },
      processes: { nodeProcesses: 'Unknown' },
      uptime: { uptime: 'Unknown' },
      timestamp: new Date()
    };
  }
}

/**
 * Helper function to format duration in milliseconds to a human-readable string
 * @param {number} ms Duration in milliseconds
 * @returns {string} Formatted duration string
 */
function formatDuration(ms) {
  if (ms === null || ms === undefined) {
    return 'N/A';
  }
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else if (seconds > 0) {
    return `${seconds}s`;
  } else {
    return `${ms}ms`;
  }
}

export default router;