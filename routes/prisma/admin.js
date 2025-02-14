// /routes/prisma/admin.js

import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';

const router = Router();
const prisma = new PrismaClient();

/*
 * DEPRECATED: This file is being phased out in favor of more specific route files.
 * The activity logging functionality has been moved to /routes/prisma/activity.js
 * The balance adjustment functionality has been moved to /routes/prisma/balance.js
 */

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Administrative endpoints for platform management
 * 
 * components:
 *   schemas:
 *     AdminLog:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         admin_address:
 *           type: string
 *         action:
 *           type: string
 *         details:
 *           type: object
 *         created_at:
 *           type: string
 *           format: date-time
 *         ip_address:
 *           type: string
 *   
 *   securitySchemes:
 *     sessionAuth:
 *       type: http
 *       scheme: cookie
 *       bearerFormat: JWT
 *       description: Session cookie containing JWT for authentication
 */

/**
 * @swagger
 * /api/admin/activities:
 *   get:
 *     summary: Get admin activity logs (requires superadmin role) [DEPRECATED - use /api/activities instead]
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action type
 *     responses:
 *       200:
 *         description: List of admin activities
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activities:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AdminLog'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Not authenticated"
 *       403:
 *         description: Not authorized (requires superadmin role)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Not authorized"
 */
// Get admin activity logs (SUPERADMIN ONLY)
//      example: GET https://degenduel.me/api/admin/activities?limit=50&offset=0&action=login
//      headers: { "Authorization": "Bearer <JWT>" }
router.get('/activities', requireAuth, requireSuperAdmin, async (req, res) => {
  console.log('>>>query received>>> | /api/admin/activities');
  
  const debugMode = true; // Simple debug flag to toggle on/off

  try {
    const { limit = 50, offset = 0, action } = req.query;
    
    // Debug logging if enabled
    if (debugMode) {
      console.log('Query parameters:', { limit, offset, action });
    }
  
    // Mock implementation that mimics Prisma's structure
    const mockData = [
      { id: 1, action: 'login', created_at: new Date() },
      { id: 2, action: 'update', created_at: new Date() },
      // Add more mock entries as needed
    ];
  
    const where = action ? { action } : {};
  
    // Simulate Prisma's findMany and count methods
    const activities = mockData
      .filter(item => !action || item.action === action)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  
    const total = mockData.filter(item => !action || item.action === action).length;
  
    // Debug logging if enabled
    if (debugMode) {
      console.log('Filtered activities:', activities);
      console.log('Total count:', total);
    }
  
    console.log('<<<response<<< | /api/admin/activities');
    res.json({
      activities,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    console.error('Error fetching admin activities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/admin/users/{wallet}/ban:
 *   post:
 *     summary: Ban a user (requires admin role)
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address of the user to ban
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for banning the user
 *     responses:
 *       200:
 *         description: User successfully banned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User banned successfully"
 *                 wallet_address:
 *                   type: string
 *                   example: "0x123..."
 *       400:
 *         description: Invalid request (missing reason or invalid wallet)
 *       403:
 *         description: Not authorized or cannot ban admin/superadmin
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
// Ban a user by wallet address (ADMIN ONLY)
//   example: POST https://degenduel.me/api/admin/users/{wallet}/ban
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "reason": "Violated terms of service" }
router.post('/users/:wallet/ban', requireAuth, requireAdmin, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { wallet } = req.params;
  const { reason } = req.body;

  logApi.info('Attempting to ban user', {
    requestId,
    admin_address: req.user.wallet_address,
    target_wallet: wallet
  });

  if (!reason) {
    logApi.warn('Ban reason not provided', {
      requestId,
      admin_address: req.user.wallet_address,
      target_wallet: wallet
    });
    return res.status(400).json({ error: 'Ban reason is required' });
  }

  try {
    // Get user's current status
    const user = await prisma.users.findUnique({
      where: { wallet_address: wallet },
      select: {
        wallet_address: true,
        role: true,
        is_banned: true
      }
    });

    if (!user) {
      logApi.warn('User not found for ban action', {
        requestId,
        target_wallet: wallet
      });
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent banning admins and superadmins
    if (user.role === 'admin' || user.role === 'superadmin') {
      logApi.warn('Attempted to ban admin/superadmin user', {
        requestId,
        admin_address: req.user.wallet_address,
        target_wallet: wallet,
        target_role: user.role
      });
      return res.status(403).json({ error: 'Cannot ban admin or superadmin users' });
    }

    // Update user and log action in a transaction
    await prisma.$transaction(async (prisma) => {
      // Update user's ban status
      await prisma.users.update({
        where: { wallet_address: wallet },
        data: {
          is_banned: true,
          ban_reason: reason,
          updated_at: new Date()
        }
      });

      // Log the ban action
      await prisma.admin_logs.create({
        data: {
          admin_address: req.user.wallet_address,
          action: 'BAN_USER',
          details: {
            wallet_address: wallet,
            reason: reason,
            timestamp: new Date().toISOString()
          },
          ip_address: req.ip,
          user_agent: req.get('user-agent')
        }
      });
    });

    logApi.info('Successfully banned user', {
      requestId,
      admin_address: req.user.wallet_address,
      target_wallet: wallet,
      duration: Date.now() - startTime
    });

    res.json({
      message: 'User banned successfully',
      wallet_address: wallet
    });

  } catch (error) {
    logApi.error('Failed to ban user', {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error?.code,
        meta: error?.meta,
        stack: req.environment === 'development' ? error.stack : undefined
      },
      admin_address: req.user.wallet_address,
      target_wallet: wallet,
      duration: Date.now() - startTime
    });

    res.status(500).json({
      error: 'Failed to ban user',
      message: req.environment === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /api/admin/users/{wallet}/unban:
 *   post:
 *     summary: Unban a user (requires admin role)
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address of the user to unban
 *     responses:
 *       200:
 *         description: User successfully unbanned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User unbanned successfully"
 *                 wallet_address:
 *                   type: string
 *                   example: "0x123..."
 *       400:
 *         description: Invalid request (invalid wallet)
 *       403:
 *         description: Not authorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
// Unban a user by wallet address (ADMIN ONLY)
//   example: POST https://degenduel.me/api/admin/users/{wallet}/unban
//      headers: { "Cookie": "session=<jwt>" }
router.post('/users/:wallet/unban', requireAuth, requireAdmin, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { wallet } = req.params;

  logApi.info('Attempting to unban user', {
    requestId,
    admin_address: req.user.wallet_address,
    target_wallet: wallet
  });

  try {
    // Get user's current status
    const user = await prisma.users.findUnique({
      where: { wallet_address: wallet },
      select: {
        wallet_address: true,
        is_banned: true
      }
    });

    if (!user) {
      logApi.warn('User not found for unban action', {
        requestId,
        target_wallet: wallet
      });
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.is_banned) {
      logApi.warn('Attempted to unban user that is not banned', {
        requestId,
        admin_address: req.user.wallet_address,
        target_wallet: wallet
      });
      return res.status(400).json({ error: 'User is not banned' });
    }

    // Update user and log action in a transaction
    await prisma.$transaction(async (prisma) => {
      // Update user's ban status
      await prisma.users.update({
        where: { wallet_address: wallet },
        data: {
          is_banned: false,
          ban_reason: null,
          updated_at: new Date()
        }
      });

      // Log the unban action
      await prisma.admin_logs.create({
        data: {
          admin_address: req.user.wallet_address,
          action: 'UNBAN_USER',
          details: {
            wallet_address: wallet,
            timestamp: new Date().toISOString()
          },
          ip_address: req.ip,
          user_agent: req.get('user-agent')
        }
      });
    });

    logApi.info('Successfully unbanned user', {
      requestId,
      admin_address: req.user.wallet_address,
      target_wallet: wallet,
      duration: Date.now() - startTime
    });

    res.json({
      message: 'User unbanned successfully',
      wallet_address: wallet
    });

  } catch (error) {
    logApi.error('Failed to unban user', {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error?.code,
        meta: error?.meta,
        stack: req.environment === 'development' ? error.stack : undefined
      },
      admin_address: req.user.wallet_address,
      target_wallet: wallet,
      duration: Date.now() - startTime
    });

    res.status(500).json({
      error: 'Failed to unban user',
      message: req.environment === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /api/admin/users/{wallet}/role:
 *   post:
 *     summary: Change user role (requires superadmin)
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address of the user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [user, admin]
 *                 description: New role for the user (cannot set superadmin)
 *     responses:
 *       200:
 *         description: Role updated successfully
 *       400:
 *         description: Invalid role or cannot modify superadmin
 *       403:
 *         description: Not authorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/users/:wallet/role', requireAuth, requireSuperAdmin, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { wallet } = req.params;
  const { role } = req.body;

  logApi.info('Attempting to change user role', {
    requestId,
    admin_address: req.user.wallet_address,
    target_wallet: wallet,
    new_role: role
  });

  // Validate role
  if (!role || !['user', 'admin'].includes(role)) {
    logApi.warn('Invalid role specified', {
      requestId,
      admin_address: req.user.wallet_address,
      target_wallet: wallet,
      invalid_role: role
    });
    return res.status(400).json({ error: 'Invalid role. Must be "user" or "admin"' });
  }

  try {
    // Get user's current status
    const user = await prisma.users.findUnique({
      where: { wallet_address: wallet },
      select: {
        wallet_address: true,
        role: true,
        nickname: true
      }
    });

    if (!user) {
      logApi.warn('User not found for role change', {
        requestId,
        target_wallet: wallet
      });
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent modifying superadmin accounts
    if (user.role === 'superadmin') {
      logApi.warn('Attempted to modify superadmin role', {
        requestId,
        admin_address: req.user.wallet_address,
        target_wallet: wallet
      });
      return res.status(400).json({ error: 'Cannot modify superadmin accounts' });
    }

    // No change needed if role is the same
    if (user.role === role) {
      return res.json({
        message: 'User already has this role',
        wallet_address: wallet,
        role: role
      });
    }

    // Update user and log action in a transaction
    await prisma.$transaction(async (prisma) => {
      // Update user's role
      await prisma.users.update({
        where: { wallet_address: wallet },
        data: {
          role,
          updated_at: new Date()
        }
      });

      // Log the role change
      await prisma.admin_logs.create({
        data: {
          admin_address: req.user.wallet_address,
          action: role === 'admin' ? 'PROMOTE_TO_ADMIN' : 'DEMOTE_TO_USER',
          details: {
            wallet_address: wallet,
            previous_role: user.role,
            new_role: role,
            timestamp: new Date().toISOString()
          },
          ip_address: req.ip,
          user_agent: req.get('user-agent')
        }
      });
    });

    logApi.info('Successfully changed user role', {
      requestId,
      admin_address: req.user.wallet_address,
      target_wallet: wallet,
      old_role: user.role,
      new_role: role,
      duration: Date.now() - startTime
    });

    res.json({
      message: `User role updated to ${role}`,
      wallet_address: wallet,
      previous_role: user.role,
      new_role: role
    });

  } catch (error) {
    logApi.error('Failed to change user role', {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error?.code,
        meta: error?.meta,
        stack: req.environment === 'development' ? error.stack : undefined
      },
      admin_address: req.user.wallet_address,
      target_wallet: wallet,
      duration: Date.now() - startTime
    });

    res.status(500).json({
      error: 'Failed to change user role',
      message: req.environment === 'development' ? error.message : undefined
    });
  }
});

export default router;