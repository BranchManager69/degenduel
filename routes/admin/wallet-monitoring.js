/**
 * Wallet Monitoring API Routes
 * 
 * This route provides API endpoints for monitoring wallet balances.
 */

import express from 'express';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../../middleware/auth.js';
import prisma from '../../config/prisma.js';
import AdminLogger from '../../utils/admin-logger.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { safeBigIntToJSON, lamportsToSol } from '../../utils/bigint-utils.js';
import redisManager from '../../utils/redis-suite/redis-manager.js';

const router = express.Router();
const logger = logApi.forService('WALLET_MONITOR');

/**
 * @api {get} /api/admin/wallet-monitoring/balances Get recent wallet balance history
 * @apiName GetWalletBalanceHistory
 * @apiGroup WalletMonitoring
 * @apiPermission admin
 * 
 * @apiParam {Number} [limit=100] Maximum number of records to return
 * @apiParam {String} [walletAddress] Filter by wallet address
 * @apiParam {String} [startDate] Filter by start date (ISO format)
 * @apiParam {String} [endDate] Filter by end date (ISO format)
 * @apiParam {Boolean} [nonZeroOnly=false] Only show non-zero balances
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Array} balances List of wallet balance records
 * @apiSuccess {Object} summary Summary statistics about the balance data
 */
router.get('/balances', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      limit = 100,
      walletAddress,
      startDate,
      endDate,
      nonZeroOnly = false
    } = req.query;

    // Convert limit to number and cap it at 1000
    const limitNum = Math.min(parseInt(limit, 10) || 100, 1000);
    
    // Build where clause for filtering
    const where = {};
    
    if (walletAddress) {
      where.wallet_address = walletAddress;
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
    
    // Filter for non-zero balances
    if (nonZeroOnly === 'true' || nonZeroOnly === true) {
      where.balance_lamports = {
        gt: 0
      };
    }

    // Query for wallet balance history
    const balanceRecords = await prisma.wallet_balance_history.findMany({
      where,
      orderBy: {
        id: 'desc'
      },
      take: limitNum,
      include: {
        users: {
          select: {
            nickname: true
          }
        }
      }
    });

    // Calculate summary statistics
    const totalWallets = await prisma.wallet_balance_history.count({
      where: {
        ...where,
        id: {
          in: balanceRecords.map(record => record.id)
        }
      },
      distinct: ['wallet_address']
    });
    
    const nonZeroBalances = balanceRecords.filter(record => record.balance_lamports > 0);
    const zeroBalances = balanceRecords.filter(record => record.balance_lamports === 0n || record.balance_lamports === 0);
    
    // Calculate total SOL (converting from lamports)
    const totalLamports = nonZeroBalances.reduce((sum, record) => {
      // Handle BigInt values
      const recordBalance = typeof record.balance_lamports === 'bigint' 
        ? record.balance_lamports 
        : BigInt(record.balance_lamports);
      
      if (typeof sum === 'bigint') {
        return sum + recordBalance;
      } else {
        return BigInt(sum) + recordBalance;
      }
    }, 0n);
    
    // Convert lamports to SOL (1 SOL = 1,000,000,000 lamports)
    const totalSol = Number(totalLamports) / 1000000000;
    
    // Calculate average balance in SOL
    const avgSol = nonZeroBalances.length > 0 ? totalSol / nonZeroBalances.length : 0;
    
    // Process the records to make them JSON serializable
    const processedRecords = balanceRecords.map(record => {
      // Use lamportsToSol utility to format balance in SOL
      const balanceSol = Number(typeof record.balance_lamports === 'bigint' 
        ? record.balance_lamports 
        : BigInt(record.balance_lamports)) / 1000000000;
      
      // Use safeBigIntToJSON to handle the entire record
      const safeRecord = safeBigIntToJSON(record);
      
      return {
        id: safeRecord.id,
        wallet_address: safeRecord.wallet_address,
        nickname: record.users?.nickname || null,
        balance_lamports: safeRecord.balance_lamports,
        balance_sol: balanceSol,
        timestamp: safeRecord.timestamp
      };
    });

    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'WALLET_BALANCE_HISTORY_VIEW',
      {
        limit: limitNum,
        filters: { walletAddress, startDate, endDate, nonZeroOnly }
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );

    return res.json({
      success: true,
      balances: processedRecords,
      summary: {
        totalRecords: balanceRecords.length,
        uniqueWallets: totalWallets,
        nonZeroBalances: nonZeroBalances.length,
        zeroBalances: zeroBalances.length,
        totalSol,
        avgSol
      }
    });
  } catch (error) {
    logger.error('Error fetching wallet balance history:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch wallet balance history'
    });
  }
});

/**
 * @api {get} /api/admin/wallet-monitoring/balances/:walletAddress Get wallet balance history for a specific wallet
 * @apiName GetWalletBalanceHistoryByAddress
 * @apiGroup WalletMonitoring
 * @apiPermission admin
 * 
 * @apiParam {String} walletAddress Wallet address to get history for
 * @apiParam {Number} [limit=100] Maximum number of records to return
 * @apiParam {String} [startDate] Filter by start date (ISO format)
 * @apiParam {String} [endDate] Filter by end date (ISO format)
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Array} balances List of wallet balance records
 * @apiSuccess {Object} wallet Wallet details
 * @apiSuccess {Object} trends Balance trends information
 */
router.get('/balances/:walletAddress', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const {
      limit = 100,
      startDate,
      endDate
    } = req.query;

    // Convert limit to number and cap it at 1000
    const limitNum = Math.min(parseInt(limit, 10) || 100, 1000);
    
    // Build where clause for filtering
    const where = {
      wallet_address: walletAddress
    };
    
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

    // Query for wallet balance history
    const balanceRecords = await prisma.wallet_balance_history.findMany({
      where,
      orderBy: {
        timestamp: 'desc'
      },
      take: limitNum
    });
    
    // Get wallet details
    const wallet = await prisma.users.findUnique({
      where: {
        wallet_address: walletAddress
      },
      select: {
        nickname: true,
        username: true,
        role: true,
        is_banned: true,
        created_at: true,
        last_login: true,
        profile_image_url: true,
        experience_points: true,
        user_level: {
          select: {
            level_number: true,
            title: true
          }
        }
      }
    });

    // Calculate balance trends
    const trends = calculateBalanceTrends(balanceRecords);
    
    // Process the records to make them JSON serializable
    const processedRecords = balanceRecords.map(record => {
      // Use safeBigIntToJSON to handle the entire record
      const safeRecord = safeBigIntToJSON(record);
      
      // Use lamportsToSol utility to format balance in SOL
      const balanceSol = Number(typeof record.balance_lamports === 'bigint' 
        ? record.balance_lamports 
        : BigInt(record.balance_lamports)) / 1000000000;
      
      return {
        id: safeRecord.id,
        balance_lamports: safeRecord.balance_lamports,
        balance_sol: balanceSol,
        timestamp: safeRecord.timestamp
      };
    });

    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'WALLET_BALANCE_HISTORY_DETAIL_VIEW',
      {
        walletAddress,
        limit: limitNum,
        filters: { startDate, endDate }
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );

    return res.json({
      success: true,
      balances: processedRecords,
      wallet: wallet || { wallet_address: walletAddress },
      trends
    });
  } catch (error) {
    logger.error('Error fetching wallet balance history for specific wallet:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch wallet balance history'
    });
  }
});

/**
 * @api {get} /api/admin/wallet-monitoring/current-balances Get current balances for all wallets
 * @apiName GetCurrentWalletBalances
 * @apiGroup WalletMonitoring
 * @apiPermission admin
 * 
 * @apiParam {Number} [page=1] Page number
 * @apiParam {Number} [limit=100] Number of records per page
 * @apiParam {Boolean} [nonZeroOnly=false] Only show non-zero balances
 * @apiParam {String} [sortBy=balance] Sort by field (balance, username, nickname, updated)
 * @apiParam {String} [sortOrder=desc] Sort order (asc, desc)
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Array} balances List of current wallet balances
 * @apiSuccess {Object} pagination Pagination information
 * @apiSuccess {Object} summary Summary statistics
 */
// Define cache keys
const CACHE_KEYS = {
  // For current balances - includes parameters in key
  CURRENT_BALANCES: (nonZeroOnly, sortBy, sortOrder) => 
    `wallet:current-balances:${nonZeroOnly}:${sortBy}:${sortOrder}`,
  
  // For balance summary statistics
  BALANCES_SUMMARY: 'wallet:balances-summary',
  
  // For specific wallet details
  WALLET_DETAIL: (address) => `wallet:detail:${address}`
};

// Cache duration in seconds (5 minutes)
const CACHE_TTL = 300;

/**
 * Fetch current wallet balances from database
 * @param {boolean} nonZeroOnly - Only include non-zero balances
 * @param {string} sortBy - Field to sort by
 * @param {string} sortOrder - Sort order (asc/desc)
 * @param {number} limit - Number of records to return
 * @param {number} skip - Number of records to skip
 * @returns {Promise<Array>} Results from database query
 */
async function fetchCurrentBalancesFromDB(nonZeroOnly, sortBy, sortOrder, limit, skip) {
  // SQL to get the most recent balance for each wallet
  const currentBalancesQuery = `
    WITH latest_balances AS (
      SELECT DISTINCT ON (wallet_address) 
        id,
        wallet_address,
        balance_lamports,
        timestamp
      FROM wallet_balance_history
      ${nonZeroOnly === 'true' || nonZeroOnly === true ? 'WHERE balance_lamports > 0' : ''}
      ORDER BY wallet_address, timestamp DESC
    )
    SELECT 
      lb.id,
      lb.wallet_address,
      lb.balance_lamports,
      lb.timestamp,
      u.nickname,
      u.username,
      u.role,
      u.experience_points
    FROM latest_balances lb
    JOIN users u ON lb.wallet_address = u.wallet_address
    ${getSortQuery(sortBy, sortOrder)}
    LIMIT ${limit} OFFSET ${skip};
  `;
  
  return prisma.$queryRawUnsafe(currentBalancesQuery);
}

/**
 * Fetch total number of balances from database
 * @param {boolean} nonZeroOnly - Only include non-zero balances
 * @returns {Promise<number>} Total count of balances
 */
async function fetchTotalBalancesFromDB(nonZeroOnly) {
  const totalBalancesQuery = `
    WITH latest_balances AS (
      SELECT DISTINCT ON (wallet_address) 
        wallet_address,
        balance_lamports
      FROM wallet_balance_history
      ${nonZeroOnly === 'true' || nonZeroOnly === true ? 'WHERE balance_lamports > 0' : ''}
      ORDER BY wallet_address, timestamp DESC
    )
    SELECT COUNT(*) as total
    FROM latest_balances;
  `;
  
  const result = await prisma.$queryRawUnsafe(totalBalancesQuery);
  return Number(result[0].total);
}

/**
 * Fetch balance summary statistics from database
 * @returns {Promise<Object>} Summary statistics
 */
async function fetchBalancesSummaryFromDB() {
  const summaryQuery = `
    WITH latest_balances AS (
      SELECT DISTINCT ON (wallet_address) 
        wallet_address,
        balance_lamports
      FROM wallet_balance_history
      ORDER BY wallet_address, timestamp DESC
    )
    SELECT 
      COUNT(*) as total_wallets,
      COUNT(CASE WHEN balance_lamports > 0 THEN 1 END) as non_zero_wallets,
      COUNT(CASE WHEN balance_lamports = 0 THEN 1 END) as zero_wallets,
      SUM(balance_lamports) as total_lamports,
      AVG(CASE WHEN balance_lamports > 0 THEN balance_lamports ELSE NULL END) as avg_non_zero_lamports
    FROM latest_balances;
  `;
  
  const result = await prisma.$queryRawUnsafe(summaryQuery);
  return result[0];
}

/**
 * Get balance summary statistics (with caching)
 * @returns {Promise<Object>} Summary statistics
 */
async function getBalancesSummary() {
  // Try to get from cache
  const cachedSummary = await redisManager.get(CACHE_KEYS.BALANCES_SUMMARY);
  if (cachedSummary) {
    return cachedSummary;
  }
  
  // Not in cache, fetch from database
  const summary = await fetchBalancesSummaryFromDB();
  
  // Store in cache
  await redisManager.set(CACHE_KEYS.BALANCES_SUMMARY, summary, CACHE_TTL);
  
  return summary;
}

/**
 * Process balance records for response
 * @param {Array} balances - Raw balance records from database
 * @returns {Array} Processed balance records
 */
function processBalanceRecords(balances) {
  return balances.map(balance => {
    // Convert BigInt to SOL
    const balanceLamports = typeof balance.balance_lamports === 'bigint' 
      ? balance.balance_lamports.toString() 
      : balance.balance_lamports.toString();
    
    const balanceSol = Number(balanceLamports) / 1000000000;
    
    return {
      id: balance.id,
      wallet_address: balance.wallet_address,
      nickname: balance.nickname,
      username: balance.username,
      role: balance.role,
      experience_points: balance.experience_points,
      balance_lamports: balanceLamports,
      balance_sol: balanceSol,
      last_updated: balance.timestamp
    };
  });
}

router.get('/current-balances', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 100,
      nonZeroOnly = false,
      sortBy = 'balance',
      sortOrder = 'desc'
    } = req.query;

    // Convert page and limit to numbers
    const pageNum = parseInt(page, 10);
    const limitNum = Math.min(parseInt(limit, 10) || 100, 1000);
    
    // Validate page and limit
    if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pagination parameters'
      });
    }
    
    // Calculate skip value for pagination
    const skip = (pageNum - 1) * limitNum;
    
    // Create cache key for this specific query
    const cacheKey = CACHE_KEYS.CURRENT_BALANCES(nonZeroOnly, sortBy, sortOrder);
    
    // Try to get response from cache
    let currentBalances;
    let totalBalances;
    let summary;
    
    // Try to get cached data
    const cachedData = await redisManager.get(cacheKey);
    
    if (cachedData) {
      logger.debug('Using cached wallet balances data');
      
      // We have cached data, use it
      currentBalances = cachedData.balances.slice(skip, skip + limitNum);
      totalBalances = cachedData.totalBalances;
      summary = cachedData.summary;
    } else {
      logger.debug('Fetching wallet balances from database');
      
      // Not in cache, need to fetch from database
      // Execute all queries in parallel
      const [dbCurrentBalances, dbTotalBalances, dbSummary] = await Promise.all([
        fetchCurrentBalancesFromDB(nonZeroOnly, sortBy, sortOrder, limitNum, skip),
        fetchTotalBalancesFromDB(nonZeroOnly),
        getBalancesSummary() // This already has its own caching
      ]);
      
      // Store results
      currentBalances = dbCurrentBalances;
      totalBalances = dbTotalBalances;
      summary = dbSummary;
      
      // Process all balances for caching
      const processedBalances = processBalanceRecords(currentBalances);
      
      // Store in cache
      await redisManager.set(cacheKey, {
        balances: processedBalances,
        totalBalances,
        summary
      }, CACHE_TTL);
      
      // Set currentBalances to processed version
      currentBalances = processedBalances;
    }
    
    // Calculate pagination metadata
    const totalPages = Math.ceil(totalBalances / limitNum);
    
    // Calculate summary values in SOL (if not already calculated)
    const totalSol = Number(summary.total_lamports || 0) / 1000000000;
    const avgSol = Number(summary.avg_non_zero_lamports || 0) / 1000000000;

    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'CURRENT_WALLET_BALANCES_VIEW',
      {
        page: pageNum,
        limit: limitNum,
        nonZeroOnly,
        sortBy,
        sortOrder,
        fromCache: !!cachedData
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );

    return res.json({
      success: true,
      balances: currentBalances,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalBalances,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      },
      summary: {
        totalWallets: Number(summary.total_wallets),
        nonZeroWallets: Number(summary.non_zero_wallets),
        zeroWallets: Number(summary.zero_wallets),
        totalSol,
        avgSol
      }
    });
  } catch (error) {
    logger.error('Error fetching current wallet balances:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch current wallet balances'
    });
  }
});

/**
 * Helper function to generate the ORDER BY clause for the SQL query
 * @param {string} sortBy - Field to sort by (balance, username, nickname, updated)
 * @param {string} sortOrder - Sort order (asc, desc)
 * @returns {string} SQL ORDER BY clause
 */
function getSortQuery(sortBy, sortOrder) {
  // Validate sort order
  const order = (sortOrder === 'asc' || sortOrder === 'ASC') ? 'ASC' : 'DESC';
  
  // Determine sort field
  let sortField;
  switch (sortBy) {
    case 'username':
      sortField = 'u.username';
      break;
    case 'nickname':
      sortField = 'u.nickname';
      break;
    case 'updated':
      sortField = 'lb.timestamp';
      break;
    case 'balance':
    default:
      sortField = 'lb.balance_lamports';
      break;
  }
  
  return `ORDER BY ${sortField} ${order}, lb.wallet_address ASC`;
}

/**
 * Calculate balance trends from balance records
 * @param {Array} balanceRecords - Array of wallet balance records
 * @returns {Object} Trend information
 */
function calculateBalanceTrends(balanceRecords) {
  if (!balanceRecords || balanceRecords.length === 0) {
    return {
      current: 0,
      change24h: 0,
      change7d: 0,
      change30d: 0,
      percentChange24h: 0,
      percentChange7d: 0,
      percentChange30d: 0
    };
  }
  
  // Sort by timestamp (oldest first)
  const sortedRecords = [...balanceRecords].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Get current balance
  const lastRecord = sortedRecords[sortedRecords.length - 1];
  const currentLamports = typeof lastRecord.balance_lamports === 'bigint' 
    ? lastRecord.balance_lamports 
    : BigInt(lastRecord.balance_lamports);
  const current = Number(currentLamports) / 1000000000;
  
  // Get timestamps for comparison periods
  const now = new Date(lastRecord.timestamp);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  
  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);
  
  // Find closest records to comparison timestamps
  const record24h = findClosestRecord(sortedRecords, yesterday);
  const record7d = findClosestRecord(sortedRecords, weekAgo);
  const record30d = findClosestRecord(sortedRecords, monthAgo);
  
  // Calculate balance changes
  const balance24h = record24h ? Number(record24h.balance_lamports) / 1000000000 : current;
  const balance7d = record7d ? Number(record7d.balance_lamports) / 1000000000 : current;
  const balance30d = record30d ? Number(record30d.balance_lamports) / 1000000000 : current;
  
  const change24h = current - balance24h;
  const change7d = current - balance7d;
  const change30d = current - balance30d;
  
  // Calculate percentage changes
  const percentChange24h = balance24h !== 0 ? (change24h / balance24h) * 100 : 0;
  const percentChange7d = balance7d !== 0 ? (change7d / balance7d) * 100 : 0;
  const percentChange30d = balance30d !== 0 ? (change30d / balance30d) * 100 : 0;
  
  return {
    current,
    change24h,
    change7d,
    change30d,
    percentChange24h,
    percentChange7d,
    percentChange30d
  };
}

/**
 * Find the record closest to a given timestamp
 * @param {Array} records - Array of records
 * @param {Date} targetTime - Target timestamp
 * @returns {Object|null} Closest record or null if no records
 */
function findClosestRecord(records, targetTime) {
  if (!records || records.length === 0) return null;
  
  return records.reduce((closest, record) => {
    const recordTime = new Date(record.timestamp);
    const currentDiff = Math.abs(recordTime - targetTime);
    const closestDiff = closest ? Math.abs(new Date(closest.timestamp) - targetTime) : Infinity;
    
    return currentDiff < closestDiff ? record : closest;
  }, null);
}

/**
 * Invalidates all wallet balance caches
 * @returns {Promise<void>}
 */
async function invalidateBalanceCache() {
  try {
    // Delete all wallet balance related cache keys
    // Get all balance cache keys
    const balanceCachePattern = 'wallet:current-balances:*';
    const balanceCacheKeys = await redisManager.client.keys(balanceCachePattern);
    
    // Get summary cache key
    const summaryCacheKey = CACHE_KEYS.BALANCES_SUMMARY;
    
    // Delete all cache keys
    const keysToDelete = [...balanceCacheKeys, summaryCacheKey];
    
    if (keysToDelete.length > 0) {
      await redisManager.client.del(...keysToDelete);
      logger.info(`Invalidated ${keysToDelete.length} wallet balance cache keys`);
    } else {
      logger.info('No wallet balance cache keys to invalidate');
    }
  } catch (error) {
    logger.error('Error invalidating wallet balance cache:', error);
    throw error;
  }
}

/**
 * @api {post} /api/admin/wallet-monitoring/refresh-cache Refresh wallet balance cache
 * @apiName RefreshWalletBalanceCache
 * @apiGroup WalletMonitoring
 * @apiPermission superadmin
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {String} message Success message
 */
router.post('/refresh-cache', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    // Invalidate the cache
    await invalidateBalanceCache();
    
    // Pre-warm the cache with a simple query
    // This will create a new cache entry for the most common query
    await Promise.all([
      // Fetch balances with default parameters to pre-warm cache
      fetchCurrentBalancesFromDB(false, 'balance', 'desc', 100, 0),
      fetchTotalBalancesFromDB(false),
      fetchBalancesSummaryFromDB()
    ]);
    
    // Store the results in cache
    const processedBalances = processBalanceRecords(await fetchCurrentBalancesFromDB(false, 'balance', 'desc', 100, 0));
    const totalBalances = await fetchTotalBalancesFromDB(false);
    const summary = await fetchBalancesSummaryFromDB();
    
    await redisManager.set(
      CACHE_KEYS.CURRENT_BALANCES(false, 'balance', 'desc'), 
      {
        balances: processedBalances,
        totalBalances,
        summary
      }, 
      CACHE_TTL
    );
    
    await redisManager.set(CACHE_KEYS.BALANCES_SUMMARY, summary, CACHE_TTL);
    
    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'WALLET_BALANCE_CACHE_REFRESH',
      { timestamp: new Date().toISOString() },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );
    
    return res.json({
      success: true,
      message: 'Wallet balance cache refreshed successfully'
    });
  } catch (error) {
    logger.error('Error refreshing wallet balance cache:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh wallet balance cache'
    });
  }
});

export default router;