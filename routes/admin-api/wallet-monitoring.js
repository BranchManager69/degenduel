// routes/admin-api/wallet-monitoring.js

/**
 * API endpoints for monitoring and controlling user wallet balance tracking
 * Restricted to superadmin role
 */

import express from 'express';
import userBalanceTrackingService from '../../services/userBalanceTrackingService.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';

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
    // Get service status and metrics
    const serviceStatus = userBalanceTrackingService.getServiceStatus();
    const metrics = userBalanceTrackingService.trackingStats;
    
    return res.json({
      status: serviceStatus.status,
      isRunning: serviceStatus.isRunning,
      metrics,
      effectiveCheckIntervalMs: userBalanceTrackingService.effectiveCheckIntervalMs,
      rateLimit: userBalanceTrackingService.config.rateLimit,
      lastOperationTime: new Date(Date.now() - metrics.performance.lastOperationTimeMs),
      activeChecks: Array.from(userBalanceTrackingService.activeChecks),
      trackedWallets: userBalanceTrackingService.trackingStats.users.trackedUsers.size,
    });
  } catch (error) {
    logApi.error('Error getting wallet tracking status', error);
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
    
    return res.json({
      wallets: wallets.map(wallet => ({
        ...wallet,
        last_known_balance: wallet.last_known_balance?.toString(),
        latest_balance: wallet.wallet_balances[0]?.balance_lamports.toString(),
        latest_balance_timestamp: wallet.wallet_balances[0]?.timestamp
      })),
      total,
      limit,
      offset
    });
  } catch (error) {
    logApi.error('Error getting tracked wallets', error);
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
    
    return res.json({
      user: {
        ...user,
        last_known_balance: user?.last_known_balance?.toString()
      },
      history: history.map(record => ({
        ...record,
        balance_lamports: record.balance_lamports.toString()
      }))
    });
  } catch (error) {
    logApi.error(`Error getting balance history for ${req.params.walletAddress}`, error);
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
      return res.json({
        status: 'success',
        walletAddress,
        balance: result.balance.toString(),
        timestamp: result.timestamp
      });
    } else {
      return res.status(400).json({
        status: 'error',
        message: result.message,
        walletAddress
      });
    }
  } catch (error) {
    logApi.error(`Error forcing balance check for ${req.params.walletAddress}`, error);
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
    logApi.error('Error updating tracking settings', error);
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
        users: {
          select: {
            nickname: true
          }
        }
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: 10
    });
    
    // Get service metrics
    const serviceStatus = userBalanceTrackingService.getServiceStatus();
    const metrics = userBalanceTrackingService.trackingStats;
    
    return res.json({
      summary: {
        totalUsers,
        trackedUsers,
        trackingCoverage: totalUsers > 0 ? Math.round((trackedUsers / totalUsers) * 100) : 0,
        historyCount,
        checkFrequencyMinutes: Math.round(userBalanceTrackingService.effectiveCheckIntervalMs / 1000 / 60),
        serviceStatus: serviceStatus.status,
        lastOperationTime: new Date(Date.now() - metrics.performance.lastOperationTimeMs)
      },
      topWallets: topWallets.map(wallet => ({
        ...wallet,
        last_known_balance: wallet.last_known_balance?.toString()
      })),
      recentChecks: recentChecks.map(check => ({
        ...check,
        balance_lamports: check.balance_lamports.toString()
      })),
      metrics
    });
  } catch (error) {
    logApi.error('Error getting dashboard data', error);
    return res.status(500).json({ error: 'Failed to get dashboard data' });
  }
});

export default router;