// routes/admin/ip-tracking.js

import express from 'express';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import prisma from '../../config/prisma.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import { fancyColors } from '../../utils/colors.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Admin - IP Tracking
 *   description: Endpoints for viewing user IP history and managing suspicious IPs
 */

/**
 * @swagger
 * /api/admin/ip-tracking/list:
 *   get:
 *     summary: Get a list of user IP history entries
 *     tags: [Admin - IP Tracking]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *         description: Field to sort by
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *         description: Sort order (asc or desc)
 *       - in: query
 *         name: wallet
 *         schema:
 *           type: string
 *         description: Filter by wallet address
 *       - in: query
 *         name: ip
 *         schema:
 *           type: string
 *         description: Filter by IP address
 *       - in: query
 *         name: suspicious
 *         schema:
 *           type: boolean
 *         description: Filter by suspicious flag
 *     responses:
 *       200:
 *         description: List of IP history entries
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/list', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      sort = 'last_seen', 
      order = 'desc',
      wallet,
      ip,
      suspicious
    } = req.query;
    
    // Convert page and limit to numbers
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    // Calculate offset
    const offset = (pageNum - 1) * limitNum;
    
    // Create where clause based on filters
    const where = {};
    
    if (wallet) {
      where.wallet_address = wallet;
    }
    
    if (ip) {
      where.ip_address = {
        contains: ip
      };
    }
    
    if (suspicious !== undefined) {
      where.is_suspicious = suspicious === 'true';
    }
    
    // Get total count
    const totalCount = await prisma.user_ip_history.count({ where });
    
    // Get IP history entries
    const ipHistory = await prisma.user_ip_history.findMany({
      where,
      orderBy: {
        [sort]: order.toLowerCase()
      },
      include: {
        users: {
          select: {
            username: true,
            nickname: true,
            role: true
          }
        }
      },
      skip: offset,
      take: limitNum
    });
    
    // Return the results
    res.json({
      success: true,
      data: ipHistory,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limitNum)
      }
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin IP Tracking]${fancyColors.RESET} Error getting IP history: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get IP history'
    });
  }
});

/**
 * @swagger
 * /api/admin/ip-tracking/user/{walletAddress}:
 *   get:
 *     summary: Get IP history for a specific user
 *     tags: [Admin - IP Tracking]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     responses:
 *       200:
 *         description: User's IP history
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/user/:walletAddress', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { walletAddress } = req.params;
    
    // Get the user
    const user = await prisma.users.findUnique({
      where: { wallet_address: walletAddress },
      select: {
        username: true,
        nickname: true,
        role: true,
        created_at: true,
        last_login: true,
        is_banned: true
      }
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Get IP history for this user
    const ipHistory = await prisma.user_ip_history.findMany({
      where: { wallet_address: walletAddress },
      orderBy: { last_seen: 'desc' }
    });
    
    // Return the results
    res.json({
      success: true,
      user,
      ip_history: ipHistory
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin IP Tracking]${fancyColors.RESET} Error getting user IP history: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get user IP history'
    });
  }
});

/**
 * @swagger
 * /api/admin/ip-tracking/ip/{ipAddress}:
 *   get:
 *     summary: Get users associated with an IP address
 *     tags: [Admin - IP Tracking]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: ipAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: IP address to look up
 *     responses:
 *       200:
 *         description: Users associated with this IP
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/ip/:ipAddress', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ipAddress } = req.params;
    
    // Get all users who have used this IP
    const ipHistory = await prisma.user_ip_history.findMany({
      where: { ip_address: ipAddress },
      include: {
        users: {
          select: {
            wallet_address: true,
            username: true,
            nickname: true,
            role: true,
            created_at: true,
            last_login: true,
            is_banned: true
          }
        }
      },
      orderBy: { last_seen: 'desc' }
    });
    
    // Check if this IP is banned
    const ipBan = await prisma.banned_ips.findUnique({
      where: { ip_address: ipAddress }
    });
    
    // Return the results
    res.json({
      success: true,
      ip_address: ipAddress,
      is_banned: !!ipBan,
      ban_details: ipBan,
      user_count: ipHistory.length,
      users: ipHistory.map(entry => ({
        ...entry.users,
        first_seen: entry.first_seen,
        last_seen: entry.last_seen,
        access_count: entry.access_count
      }))
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin IP Tracking]${fancyColors.RESET} Error getting IP users: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get users for IP'
    });
  }
});

/**
 * @swagger
 * /api/admin/ip-tracking/mark-suspicious/{id}:
 *   put:
 *     summary: Mark an IP history entry as suspicious
 *     tags: [Admin - IP Tracking]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: IP history entry ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - is_suspicious
 *             properties:
 *               is_suspicious:
 *                 type: boolean
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: IP history entry updated
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: IP history entry not found
 *       500:
 *         description: Server error
 */
router.put('/mark-suspicious/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_suspicious, notes } = req.body;
    
    // Validate required parameters
    if (is_suspicious === undefined) {
      return res.status(400).json({
        success: false,
        error: 'is_suspicious is required'
      });
    }
    
    // Check if entry exists
    const existingEntry = await prisma.user_ip_history.findUnique({
      where: { id: parseInt(id) }
    });
    
    if (!existingEntry) {
      return res.status(404).json({
        success: false,
        error: 'IP history entry not found'
      });
    }
    
    // Update the entry
    const updatedEntry = await prisma.user_ip_history.update({
      where: { id: parseInt(id) },
      data: {
        is_suspicious,
        ...(notes !== undefined && { notes })
      }
    });
    
    // Log the action
    logApi.info(`${fancyColors.GREEN}[Admin IP Tracking]${fancyColors.RESET} IP history entry marked as ${is_suspicious ? 'suspicious' : 'not suspicious'}`, {
      id: updatedEntry.id,
      wallet_address: updatedEntry.wallet_address,
      ip_address: updatedEntry.ip_address,
      admin: req.user.wallet_address
    });
    
    // Record in admin logs
    await AdminLogger.logAction(
      req.user.wallet_address,
      'MARK_IP_SUSPICIOUS',
      {
        id: updatedEntry.id,
        wallet_address: updatedEntry.wallet_address,
        ip_address: updatedEntry.ip_address,
        is_suspicious,
        notes
      }
    );
    
    // Return success response
    res.json({
      success: true,
      message: `IP history entry marked as ${is_suspicious ? 'suspicious' : 'not suspicious'}`,
      data: updatedEntry
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin IP Tracking]${fancyColors.RESET} Error marking IP as suspicious: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to update IP history entry'
    });
  }
});

/**
 * @swagger
 * /api/admin/ip-tracking/statistics:
 *   get:
 *     summary: Get IP tracking statistics
 *     tags: [Admin - IP Tracking]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: IP tracking statistics
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/statistics', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get total counts
    const totalEntries = await prisma.user_ip_history.count();
    const totalSuspicious = await prisma.user_ip_history.count({
      where: { is_suspicious: true }
    });
    const uniqueIpCount = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT ip_address) as count 
      FROM user_ip_history
    `;
    const uniqueUserCount = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT wallet_address) as count 
      FROM user_ip_history
    `;
    
    // Get top IPs by user count
    const topIps = await prisma.$queryRaw`
      SELECT ip_address, COUNT(DISTINCT wallet_address) as user_count 
      FROM user_ip_history 
      GROUP BY ip_address 
      ORDER BY user_count DESC 
      LIMIT 10
    `;
    
    // Get top users by IP count
    const topUsers = await prisma.$queryRaw`
      SELECT wallet_address, COUNT(DISTINCT ip_address) as ip_count 
      FROM user_ip_history 
      GROUP BY wallet_address 
      ORDER BY ip_count DESC 
      LIMIT 10
    `;
    
    // Get user details for top users
    const userDetails = await Promise.all(
      topUsers.map(async (entry) => {
        const user = await prisma.users.findUnique({
          where: { wallet_address: entry.wallet_address },
          select: {
            username: true,
            nickname: true,
            role: true
          }
        });
        
        return {
          wallet_address: entry.wallet_address,
          ip_count: entry.ip_count,
          username: user?.username,
          nickname: user?.nickname,
          role: user?.role
        };
      })
    );
    
    // Return the results
    res.json({
      success: true,
      statistics: {
        total_entries: totalEntries,
        suspicious_entries: totalSuspicious,
        unique_ips: uniqueIpCount[0].count,
        unique_users: uniqueUserCount[0].count,
        top_ips: topIps,
        top_users: userDetails
      }
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin IP Tracking]${fancyColors.RESET} Error getting IP statistics: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get IP statistics'
    });
  }
});

export default router;