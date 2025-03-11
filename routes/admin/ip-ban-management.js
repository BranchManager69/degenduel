// routes/admin/ip-ban-management.js

import express from 'express';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import prisma from '../../config/prisma.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import { fancyColors } from '../../utils/colors.js';
import { checkIpBan } from '../../middleware/ipBanMiddleware.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Admin - IP Ban Management
 *   description: Endpoints for managing IP bans
 */

/**
 * @swagger
 * /api/admin/ip-ban/list:
 *   get:
 *     summary: Get a list of banned IPs
 *     tags: [Admin - IP Ban Management]
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
 *         name: filter
 *         schema:
 *           type: string
 *         description: Field to filter by
 *     responses:
 *       200:
 *         description: List of banned IPs
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
      sort = 'created_at', 
      order = 'desc',
      filter
    } = req.query;
    
    // Convert page and limit to numbers
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    // Calculate offset
    const offset = (pageNum - 1) * limitNum;
    
    // Create where clause based on filter
    const where = {};
    if (filter) {
      // Apply filter to ip_address
      where.ip_address = {
        contains: filter
      };
    }
    
    // Get total count
    const totalCount = await prisma.banned_ips.count({ where });
    
    // Get banned IPs
    const bannedIps = await prisma.banned_ips.findMany({
      where,
      orderBy: {
        [sort]: order.toLowerCase()
      },
      skip: offset,
      take: limitNum
    });
    
    // Return the results
    res.json({
      success: true,
      data: bannedIps,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limitNum)
      }
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin IP Ban]${fancyColors.RESET} Error getting banned IPs: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get banned IPs'
    });
  }
});

/**
 * @swagger
 * /api/admin/ip-ban/{id}:
 *   get:
 *     summary: Get a specific banned IP
 *     tags: [Admin - IP Ban Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the banned IP
 *     responses:
 *       200:
 *         description: Banned IP details
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Banned IP not found
 *       500:
 *         description: Server error
 */
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get banned IP
    const bannedIp = await prisma.banned_ips.findUnique({
      where: { id: parseInt(id) }
    });
    
    if (!bannedIp) {
      return res.status(404).json({
        success: false,
        error: 'Banned IP not found'
      });
    }
    
    // Return the results
    res.json({
      success: true,
      data: bannedIp
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin IP Ban]${fancyColors.RESET} Error getting banned IP details: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get banned IP details'
    });
  }
});

/**
 * @swagger
 * /api/admin/ip-ban/add:
 *   post:
 *     summary: Ban an IP address
 *     tags: [Admin - IP Ban Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ip_address
 *               - reason
 *             properties:
 *               ip_address:
 *                 type: string
 *               reason:
 *                 type: string
 *               is_permanent:
 *                 type: boolean
 *               expires_at:
 *                 type: string
 *                 format: date-time
 *               troll_level:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *     responses:
 *       200:
 *         description: IP banned successfully
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/add', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { 
      ip_address, 
      reason, 
      is_permanent = false, 
      expires_at = null,
      troll_level = 1,
      metadata = {}
    } = req.body;
    
    // Validate required parameters
    if (!ip_address || !reason) {
      return res.status(400).json({
        success: false,
        error: 'IP address and reason are required'
      });
    }
    
    // Validate troll level (1-5)
    if (troll_level < 1 || troll_level > 5) {
      return res.status(400).json({
        success: false,
        error: 'Troll level must be between 1 and 5'
      });
    }
    
    // Check if IP is already banned
    const existingBan = await prisma.banned_ips.findUnique({
      where: { ip_address }
    });
    
    if (existingBan) {
      return res.status(400).json({
        success: false,
        error: 'IP address is already banned',
        ban_details: existingBan
      });
    }
    
    // Ban the IP
    const bannedIp = await prisma.banned_ips.create({
      data: {
        ip_address,
        reason,
        is_permanent,
        expires_at: expires_at ? new Date(expires_at) : null,
        created_by: req.user.wallet_address,
        troll_level,
        metadata
      }
    });
    
    // Log the action
    logApi.info(`${fancyColors.GREEN}[Admin IP Ban]${fancyColors.RESET} IP address banned: ${ip_address}`, {
      ban_id: bannedIp.id,
      reason,
      is_permanent,
      expires_at,
      admin: req.user.wallet_address
    });
    
    // Record in admin logs
    await AdminLogger.logAction(
      req.user.wallet_address,
      'BAN_IP_ADDRESS',
      {
        ban_id: bannedIp.id,
        ip_address,
        reason,
        is_permanent,
        expires_at,
        troll_level
      }
    );
    
    // Return success response
    res.json({
      success: true,
      message: `IP address ${ip_address} banned successfully`,
      data: bannedIp
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin IP Ban]${fancyColors.RESET} Error banning IP: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to ban IP address'
    });
  }
});

/**
 * @swagger
 * /api/admin/ip-ban/update/{id}:
 *   put:
 *     summary: Update an IP ban
 *     tags: [Admin - IP Ban Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the banned IP
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *               is_permanent:
 *                 type: boolean
 *               expires_at:
 *                 type: string
 *                 format: date-time
 *               troll_level:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *     responses:
 *       200:
 *         description: IP ban updated successfully
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Banned IP not found
 *       500:
 *         description: Server error
 */
router.put('/update/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      reason, 
      is_permanent, 
      expires_at,
      troll_level,
      metadata
    } = req.body;
    
    // Validate troll level (1-5) if provided
    if (troll_level !== undefined && (troll_level < 1 || troll_level > 5)) {
      return res.status(400).json({
        success: false,
        error: 'Troll level must be between 1 and 5'
      });
    }
    
    // Check if ban exists
    const existingBan = await prisma.banned_ips.findUnique({
      where: { id: parseInt(id) }
    });
    
    if (!existingBan) {
      return res.status(404).json({
        success: false,
        error: 'Banned IP not found'
      });
    }
    
    // Prepare update data
    const updateData = {};
    if (reason !== undefined) updateData.reason = reason;
    if (is_permanent !== undefined) updateData.is_permanent = is_permanent;
    if (expires_at !== undefined) updateData.expires_at = expires_at ? new Date(expires_at) : null;
    if (troll_level !== undefined) updateData.troll_level = troll_level;
    if (metadata !== undefined) updateData.metadata = metadata;
    
    // Always update updated_at
    updateData.updated_at = new Date();
    
    // Update the ban
    const updatedBan = await prisma.banned_ips.update({
      where: { id: parseInt(id) },
      data: updateData
    });
    
    // Log the action
    logApi.info(`${fancyColors.GREEN}[Admin IP Ban]${fancyColors.RESET} IP ban updated: ${existingBan.ip_address}`, {
      ban_id: updatedBan.id,
      changes: updateData,
      admin: req.user.wallet_address
    });
    
    // Record in admin logs
    await AdminLogger.logAction(
      req.user.wallet_address,
      'UPDATE_IP_BAN',
      {
        ban_id: updatedBan.id,
        ip_address: existingBan.ip_address,
        changes: updateData
      }
    );
    
    // Return success response
    res.json({
      success: true,
      message: `IP ban for ${existingBan.ip_address} updated successfully`,
      data: updatedBan
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin IP Ban]${fancyColors.RESET} Error updating IP ban: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to update IP ban'
    });
  }
});

/**
 * @swagger
 * /api/admin/ip-ban/remove/{id}:
 *   delete:
 *     summary: Remove an IP ban
 *     tags: [Admin - IP Ban Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the banned IP
 *     responses:
 *       200:
 *         description: IP ban removed successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Banned IP not found
 *       500:
 *         description: Server error
 */
router.delete('/remove/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if ban exists
    const existingBan = await prisma.banned_ips.findUnique({
      where: { id: parseInt(id) }
    });
    
    if (!existingBan) {
      return res.status(404).json({
        success: false,
        error: 'Banned IP not found'
      });
    }
    
    // Remove the ban
    await prisma.banned_ips.delete({
      where: { id: parseInt(id) }
    });
    
    // Log the action
    logApi.info(`${fancyColors.GREEN}[Admin IP Ban]${fancyColors.RESET} IP ban removed: ${existingBan.ip_address}`, {
      ban_id: parseInt(id),
      ip_address: existingBan.ip_address,
      admin: req.user.wallet_address
    });
    
    // Record in admin logs
    await AdminLogger.logAction(
      req.user.wallet_address,
      'REMOVE_IP_BAN',
      {
        ban_id: parseInt(id),
        ip_address: existingBan.ip_address
      }
    );
    
    // Return success response
    res.json({
      success: true,
      message: `IP ban for ${existingBan.ip_address} removed successfully`
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin IP Ban]${fancyColors.RESET} Error removing IP ban: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to remove IP ban'
    });
  }
});

/**
 * @swagger
 * /api/admin/ip-ban/check:
 *   get:
 *     summary: Check if an IP is banned
 *     tags: [Admin - IP Ban Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: ip
 *         required: true
 *         schema:
 *           type: string
 *         description: IP address to check
 *     responses:
 *       200:
 *         description: IP ban status
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/check', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ip } = req.query;
    
    if (!ip) {
      return res.status(400).json({
        success: false,
        error: 'IP address is required'
      });
    }
    
    // Check if IP is banned
    const bannedIp = await checkIpBan(ip);
    
    res.json({
      success: true,
      is_banned: !!bannedIp,
      ban_details: bannedIp
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin IP Ban]${fancyColors.RESET} Error checking IP ban status: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to check IP ban status'
    });
  }
});

export default router;