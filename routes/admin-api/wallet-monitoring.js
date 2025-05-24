// routes/admin-api/wallet-monitoring.js

/**
 * User Balance Tracking Service
 * 
 * NOTE:    DO NOT CONFUSE THIS WITH
 *          routes/admin/wallet-monitoring.js
 * 
 * @description: This is the superadmin interface for monitoring and controlling user wallet balance tracking.
 * The API routes are used by the superadmin dashboard.
 * 
 * @author BranchManager69
 * @version 2.0.0
 * @created 2025-04-20
 * @updated 2025-05-24
*/

/**
 * admin-api/wallet-monitoring.js provides:
 * - /status - get service status
 * - /wallets - get tracked wallets
 * - /history/:walletAddress - get wallet balance history
 * - /check/:walletAddress - force balance check
 * - /settings - update tracking settings
 * - /dashboard - get dashboard data
 * - /start - start the service
 * - /stop - stop the service
 * 
 * Implementation approach:
 * - admin-api/wallet-monitoring.js uses Redis caching
 * - admin-api/wallet-monitoring.js includes trend analysis
 * - admin-api/wallet-monitoring.js uses raw SQL queries via prisma.$queryRawUnsafe
 * 
 * Meanwhile,
 * - 'admin/wallet-monitoring.js' implements admin controls for the wallet monitoring service
 */

import express from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { safeBigIntToJSON, lamportsToSol } from '../../utils/bigint-utils.js';
import prisma from '../../config/prisma.js';
import userBalanceTrackingService from '../../services/user-balance-tracking/index.js';
// Logger
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors, serviceColors } from '../../utils/colors.js';

const router = express.Router();

/**
 * @api {get} /api/admin/wallet-monitoring/status Get wallet tracking service status
 * @apiName GetWalletTrackingStatus
 * @apiGroup AdminWalletMonitoring
 * @apiPermission superadmin
 * 
 * @apiSuccess {Object} status Service status information
 */
router.get('/status', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    // Get service status from base properties and stats
    return res.json({
      status: userBalanceTrackingService.isStarted ? 'running' : 'stopped',
      isRunning: userBalanceTrackingService.isStarted,
      metrics: userBalanceTrackingService.trackingStats,
      effectiveCheckIntervalMs: userBalanceTrackingService.effectiveCheckIntervalMs,
      rateLimit: userBalanceTrackingService.config.rateLimit,
      lastOperationTime: new Date(Date.now() - userBalanceTrackingService.trackingStats.performance.lastOperationTimeMs),
      activeChecks: Array.from(userBalanceTrackingService.activeChecks),
      trackedWallets: userBalanceTrackingService.trackingStats.users.trackedUsers.size,
      baseStats: userBalanceTrackingService.stats
    });
  } catch (error) {
    logApi.error(`${serviceColors.balanceTracking.error}Error getting wallet tracking status${fancyColors.RESET}`, error);
    return res.status(500).json({ error: 'Failed to get service status' });
  }
});

/**
 * @api {get} /api/admin/wallet-monitoring/wallets Get tracked wallets
 * @apiName GetTrackedWallets
 * @apiGroup AdminWalletMonitoring
 * @apiPermission superadmin
 * 
 * @apiParam {Number} limit Maximum number of wallets to return (default: 50)
 * @apiParam {Number} offset Pagination offset (default: 0)
 * @apiParam {String} sort Sort field (options: last_check, balance, address)
 * @apiParam {String} order Sort order (asc or desc)
 * 
 * @apiSuccess {Array} wallets List of tracked wallets with balance information
 * @apiSuccess {Number} total Total number of tracked wallets
 */
router.get('/wallets', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const sort = req.query.sort || 'last_balance_check';
    const order = req.query.order || 'desc';
    
    // Get wallets from database with their latest balance
    const wallets = await prisma.users.findMany({
      select: {
        id: true,
        wallet_address: true,
        nickname: true,
        last_balance_check: true,
        last_known_balance: true,
        wallet_balances: {
          orderBy: {
            timestamp: 'desc'
          },
          take: 1,
          select: {
            balance_lamports: true,
            timestamp: true
          }
        }
      },
      where: {
        last_balance_check: {
          not: null
        }
      },
      orderBy: {
        [sort]: order
      },
      take: limit,
      skip: offset
    });
    
    // Get total count
    const total = await prisma.users.count({
      where: {
        last_balance_check: {
          not: null
        }
      }
    });
    
    // Use the safeBigIntToJSON function to safely convert all BigInt values to strings
    const safeWallets = wallets.map(wallet => {
      // Process the wallet with our helper function first
      const safeWallet = safeBigIntToJSON(wallet);
      
      // Ensure specific BigInt fields are properly formatted
      return {
        ...safeWallet,
        // Still explicitly convert these fields for consistency and backward compatibility
        last_known_balance: wallet.last_known_balance !== null ? wallet.last_known_balance.toString() : null,
        latest_balance: wallet.wallet_balances[0]?.balance_lamports.toString() || null,
        latest_balance_timestamp: wallet.wallet_balances[0]?.timestamp || null
      };
    });

    return res.json({
      wallets: safeWallets,
      total,
      limit,
      offset
    });
  } catch (error) {
    logApi.error(`${serviceColors.balanceTracking.error}Error getting tracked wallets${fancyColors.RESET}`, error);
    return res.status(500).json({ error: 'Failed to get tracked wallets' });
  }
});

/**
 * @api {get} /api/admin/wallet-monitoring/history/:walletAddress Get wallet balance history
 * @apiName GetWalletBalanceHistory
 * @apiGroup AdminWalletMonitoring
 * @apiPermission superadmin
 * 
 * @apiParam {String} walletAddress Wallet address to get history for
 * @apiParam {Number} limit Maximum number of records to return (default: 100)
 * @apiParam {String} since Optional date filter (ISO string)
 * 
 * @apiSuccess {Array} history List of balance history records
 */
router.get('/history/:walletAddress', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const since = req.query.since ? new Date(req.query.since) : null;
    
    // Validate wallet address
    if (!walletAddress || walletAddress.length !== 44) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    // Get balance history
    const history = await prisma.wallet_balance_history.findMany({
      where: {
        wallet_address: walletAddress,
        ...(since && {
          timestamp: {
            gte: since
          }
        })
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: limit
    });
    
    // Get user details
    const user = await prisma.users.findUnique({
      where: {
        wallet_address: walletAddress
      },
      select: {
        id: true,
        nickname: true,
        last_balance_check: true,
        last_known_balance: true
      }
    });
    
    // Format the response to match expected frontend format
    const formattedHistory = history.map(record => ({
      timestamp: record.timestamp.toISOString(),
      balance: lamportsToSol(record.balance_lamports) // Use our utility function to convert lamports to SOL
    }));
    
    // Use the safeBigIntToJSON function to safely convert all BigInt values to strings
    const safeUser = safeBigIntToJSON(user);
    
    return res.json({
      user: safeUser,
      history: formattedHistory
    });
  } catch (error) {
    logApi.error(`${serviceColors.balanceTracking.error}Error getting balance history for ${req.params.walletAddress}${fancyColors.RESET}`, error);
    return res.status(500).json({ error: 'Failed to get balance history' });
  }
});

/**
 * @api {post} /api/admin/wallet-monitoring/check/:walletAddress Force balance check
 * @apiName ForceBalanceCheck
 * @apiGroup AdminWalletMonitoring
 * @apiPermission superadmin
 * 
 * @apiParam {String} walletAddress Wallet address to check
 * 
 * @apiSuccess {Object} result Balance check result
 */
router.post('/check/:walletAddress', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { walletAddress } = req.params;
    
    // Validate wallet address
    if (!walletAddress || walletAddress.length !== 44) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    // Force balance check
    const result = await userBalanceTrackingService.forceBalanceCheck(walletAddress);
    
    if (result.status === 'success') {
      // Use our utility function to convert lamports to SOL
      const balanceInSol = lamportsToSol(result.balance);
      
      return res.json({
        status: 'success',
        walletAddress,
        balance: balanceInSol,
        timestamp: result.timestamp.toISOString ? result.timestamp.toISOString() : new Date(result.timestamp).toISOString()
      });
    } else {
      return res.status(400).json({
        status: 'error',
        message: result.message,
        walletAddress
      });
    }
  } catch (error) {
    logApi.error(`${serviceColors.balanceTracking.error}Error forcing balance check for ${req.params.walletAddress}${fancyColors.RESET}`, error);
    return res.status(500).json({ error: 'Failed to check balance' });
  }
});

/**
 * @api {put} /api/admin/wallet-monitoring/settings Update tracking settings
 * @apiName UpdateTrackingSettings
 * @apiGroup AdminWalletMonitoring
 * @apiPermission superadmin
 * 
 * @apiParam {Object} settings Settings object
 * @apiParam {Number} settings.queriesPerHour Max queries per hour
 * @apiParam {Number} settings.minCheckIntervalMs Minimum check interval in ms
 * @apiParam {Number} settings.maxCheckIntervalMs Maximum check interval in ms
 * 
 * @apiSuccess {Object} settings Updated settings
 */
router.put('/settings', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { settings } = req.body;
    
    // Validate settings
    if (!settings) {
      return res.status(400).json({ error: 'No settings provided' });
    }
    
    // Update system settings in database
    await prisma.system_settings.upsert({
      where: {
        key: userBalanceTrackingService.config.name
      },
      update: {
        value: {
          rateLimit: {
            queriesPerHour: settings.queriesPerHour || userBalanceTrackingService.config.rateLimit.queriesPerHour,
            minCheckIntervalMs: settings.minCheckIntervalMs || userBalanceTrackingService.config.rateLimit.minCheckIntervalMs,
            maxCheckIntervalMs: settings.maxCheckIntervalMs || userBalanceTrackingService.config.rateLimit.maxCheckIntervalMs
          }
        },
        updated_at: new Date(),
        updated_by: req.user.wallet_address
      },
      create: {
        key: userBalanceTrackingService.config.name,
        value: {
          rateLimit: {
            queriesPerHour: settings.queriesPerHour || userBalanceTrackingService.config.rateLimit.queriesPerHour,
            minCheckIntervalMs: settings.minCheckIntervalMs || userBalanceTrackingService.config.rateLimit.minCheckIntervalMs,
            maxCheckIntervalMs: settings.maxCheckIntervalMs || userBalanceTrackingService.config.rateLimit.maxCheckIntervalMs
          }
        },
        description: 'User balance tracking service settings',
        updated_by: req.user.wallet_address
      }
    });
    
    // Update service configuration
    userBalanceTrackingService.config.rateLimit = {
      ...userBalanceTrackingService.config.rateLimit,
      queriesPerHour: settings.queriesPerHour || userBalanceTrackingService.config.rateLimit.queriesPerHour,
      minCheckIntervalMs: settings.minCheckIntervalMs || userBalanceTrackingService.config.rateLimit.minCheckIntervalMs,
      maxCheckIntervalMs: settings.maxCheckIntervalMs || userBalanceTrackingService.config.rateLimit.maxCheckIntervalMs
    };
    
    // Recalculate check interval based on updated settings
    userBalanceTrackingService.calculateCheckInterval(userBalanceTrackingService.trackingStats.users.total);
    
    return res.json({
      settings: userBalanceTrackingService.config.rateLimit,
      effectiveCheckIntervalMs: userBalanceTrackingService.effectiveCheckIntervalMs
    });
  } catch (error) {
    logApi.error(`${serviceColors.balanceTracking.error}Error updating tracking settings${fancyColors.RESET}`, error);
    return res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * @api {get} /api/admin/wallet-monitoring/dashboard Get dashboard data
 * @apiName GetDashboardData
 * @apiGroup AdminWalletMonitoring
 * @apiPermission superadmin
 * 
 * @apiSuccess {Object} dashboard Dashboard data
 */
router.get('/dashboard', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    // Get summary data
    const totalUsers = await prisma.users.count();
    const trackedUsers = await prisma.users.count({
      where: {
        last_balance_check: {
          not: null
        }
      }
    });
    
    // Get total history entries
    const historyCount = await prisma.wallet_balance_history.count();
    
    // Get top wallets by balance
    const topWallets = await prisma.users.findMany({
      select: {
        id: true,
        wallet_address: true,
        nickname: true,
        last_balance_check: true,
        last_known_balance: true
      },
      where: {
        last_known_balance: {
          not: null
        }
      },
      orderBy: {
        last_known_balance: 'desc'
      },
      take: 10
    });
    
    // Get recent balance checks
    const recentChecks = await prisma.wallet_balance_history.findMany({
      select: {
        id: true,
        wallet_address: true,
        balance_lamports: true,
        timestamp: true,
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: 10
    });
    
    // Fetch nicknames separately
    const checksWithNicknames = await Promise.all(
      recentChecks.map(async (check) => {
        const user = await prisma.users.findUnique({
          where: { wallet_address: check.wallet_address },
          select: { nickname: true }
        });
        return {
          ...check,
          nickname: user?.nickname,
          balance: check.balance_lamports.toString(),
          status: 'success'
        };
      })
    );
    
    // Get service metrics
    const serviceStatus = userBalanceTrackingService.getServiceStatus();
    const metrics = userBalanceTrackingService.trackingStats;
    
    // Calculate SOL and USD totals
    const totalBalanceSOL = topWallets.reduce((sum, wallet) => 
      sum + (wallet.last_known_balance ? parseFloat(wallet.last_known_balance.toString()) / 1_000_000_000 : 0), 0);
    const solPrice = 70.20; // Placeholder - in production would be fetched from a price service
    const totalValueUSD = totalBalanceSOL * solPrice;
    
    // Create balance distribution
    const balanceDistribution = [
      { range: "0-1 SOL", count: 0, percentage: 0 },
      { range: "1-10 SOL", count: 0, percentage: 0 },
      { range: "10-100 SOL", count: 0, percentage: 0 },
      { range: "100+ SOL", count: 0, percentage: 0 }
    ];
    
    // Process wallet balances for distribution
    topWallets.forEach(wallet => {
      const balanceSOL = wallet.last_known_balance ? parseFloat(wallet.last_known_balance.toString()) / 1_000_000_000 : 0;
      
      if (balanceSOL < 1) {
        balanceDistribution[0].count++;
      } else if (balanceSOL < 10) {
        balanceDistribution[1].count++;
      } else if (balanceSOL < 100) {
        balanceDistribution[2].count++;
      } else {
        balanceDistribution[3].count++;
      }
    });
    
    // Calculate percentages
    const totalWallets = topWallets.length;
    balanceDistribution.forEach(range => {
      range.percentage = totalWallets > 0 ? parseFloat((range.count / totalWallets * 100).toFixed(1)) : 0;
    });
    
    // Process top wallets with safe BigInt conversion
    const safeTopWallets = topWallets.map(wallet => {
      // Use our utility function to convert lamports to SOL
      const balanceSol = lamportsToSol(wallet.last_known_balance);
      
      return {
        walletAddress: wallet.wallet_address,
        balance: balanceSol,
        lastUpdated: wallet.last_balance_check,
        nickname: wallet.nickname,
        isHighValue: parseFloat(balanceSol) > 100
      };
    });
    
    // Process recent checks
    const safeRecentChecks = safeBigIntToJSON(checksWithNicknames);
    
    // Create response with safe values
    return res.json({
      summary: {
        totalUsers,
        trackedUsers,
        trackingCoverage: totalUsers > 0 ? Math.round((trackedUsers / totalUsers) * 100) : 0,
        totalWallets: trackedUsers,
        totalBalanceSOL: parseFloat(totalBalanceSOL.toFixed(2)),
        totalValueUSD: parseFloat(totalValueUSD.toFixed(2)),
        serviceStatus: serviceStatus.status,
        checksPerHour: metrics.balanceChecks.total || 0,
        balanceCheckSuccess: metrics.balanceChecks.successful || 0,
        balanceCheckTotal: metrics.balanceChecks.total || 0
      },
      balanceDistribution,
      topWallets: safeTopWallets,
      recentChecks: safeRecentChecks,
      settings: {
        queriesPerHour: userBalanceTrackingService.config.rateLimit.queriesPerHour,
        minCheckIntervalMs: userBalanceTrackingService.config.rateLimit.minCheckIntervalMs,
        maxCheckIntervalMs: userBalanceTrackingService.config.rateLimit.maxCheckIntervalMs,
        effectiveCheckIntervalMs: userBalanceTrackingService.effectiveCheckIntervalMs
      }
    });
  } catch (error) {
    logApi.error(`${serviceColors.balanceTracking.error}Error getting dashboard data${fancyColors.RESET}`, error);
    return res.status(500).json({ error: 'Failed to get dashboard data' });
  }
});

/**
 * @api {post} /api/admin/wallet-monitoring/start Start the wallet monitoring service
 * @apiName StartWalletMonitoring
 * @apiGroup AdminWalletMonitoring
 * @apiPermission superadmin
 * 
 * @apiSuccess {Object} result Operation result
 */
router.post('/start', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    // Get current service status
    const currentStatus = userBalanceTrackingService.getServiceStatus();

    // If service is already running, return success
    if (currentStatus.isRunning) {
      return res.json({
        success: true,
        message: 'Monitoring service is already running',
        serviceStatus: 'running'
      });
    }

    // Start the service
    await userBalanceTrackingService.start();

    // Update service status in database
    await prisma.system_settings.upsert({
      where: {
        key: `${userBalanceTrackingService.config.name}_status`
      },
      update: {
        value: {
          status: 'running',
          last_started: new Date().toISOString(),
          started_by: req.user.wallet_address
        },
        updated_at: new Date(),
        updated_by: req.user.wallet_address
      },
      create: {
        key: `${userBalanceTrackingService.config.name}_status`,
        value: {
          status: 'running',
          last_started: new Date().toISOString(),
          started_by: req.user.wallet_address
        },
        description: 'User balance tracking service status',
        updated_by: req.user.wallet_address
      }
    });

    // Get updated status
    const updatedStatus = userBalanceTrackingService.getServiceStatus();

    return res.json({
      success: true,
      message: 'Monitoring service started',
      serviceStatus: updatedStatus.status
    });
  } catch (error) {
    logApi.error(`${serviceColors.balanceTracking.error}Error starting wallet monitoring service${fancyColors.RESET}`, error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to start monitoring service',
      message: error.message
    });
  }
});

/**
 * @api {post} /api/admin/wallet-monitoring/stop Stop the wallet monitoring service
 * @apiName StopWalletMonitoring
 * @apiGroup AdminWalletMonitoring
 * @apiPermission superadmin
 * 
 * @apiSuccess {Object} result Operation result
 */
router.post('/stop', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    // Get current service status
    const currentStatus = userBalanceTrackingService.getServiceStatus();

    // If service is already stopped, return success
    if (!currentStatus.isRunning) {
      return res.json({
        success: true,
        message: 'Monitoring service is already stopped',
        serviceStatus: 'stopped'
      });
    }

    // Stop the service
    await userBalanceTrackingService.stop();

    // Update service status in database
    await prisma.system_settings.upsert({
      where: {
        key: `${userBalanceTrackingService.config.name}_status`
      },
      update: {
        value: {
          status: 'stopped',
          last_stopped: new Date().toISOString(),
          stopped_by: req.user.wallet_address
        },
        updated_at: new Date(),
        updated_by: req.user.wallet_address
      },
      create: {
        key: `${userBalanceTrackingService.config.name}_status`,
        value: {
          status: 'stopped',
          last_stopped: new Date().toISOString(),
          stopped_by: req.user.wallet_address
        },
        description: 'User balance tracking service status',
        updated_by: req.user.wallet_address
      }
    });

    // Get updated status
    const updatedStatus = userBalanceTrackingService.getServiceStatus();

    // Return the updated status
    return res.json({
      success: true,
      message: 'Monitoring service stopped',
      serviceStatus: updatedStatus.status
    });
  } catch (error) {
    logApi.error(`${serviceColors.balanceTracking.error}Error stopping wallet monitoring service${fancyColors.RESET}`, error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to stop monitoring service',
      message: error.message
    });
  }
});

export default router;