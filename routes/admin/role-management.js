import express from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import prisma from '../../config/prisma.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import { fancyColors } from '../../utils/colors.js';
import { UserRole } from '../../types/userRole.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Admin - Role Management
 *   description: Endpoints for managing user roles
 */

/**
 * @swagger
 * /api/admin/role/list:
 *   get:
 *     summary: Get list of users by role
 *     tags: [Admin - Role Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [user, admin, superadmin]
 *         description: Filter users by role
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
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by wallet address, username, or nickname
 *     responses:
 *       200:
 *         description: List of users with their roles
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/list', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { 
      role, 
      page = 1, 
      limit = 20, 
      search 
    } = req.query;
    
    // Convert page and limit to numbers
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    // Calculate offset
    const offset = (pageNum - 1) * limitNum;
    
    // Create where clause based on filters
    const where = {};
    if (role && Object.values(UserRole).includes(role)) {
      where.role = role;
    }
    
    if (search) {
      where.OR = [
        { wallet_address: { contains: search } },
        { username: { contains: search } },
        { nickname: { contains: search } }
      ];
    }
    
    // Get total count
    const totalCount = await prisma.users.count({ where });
    
    // Get users with role info
    const users = await prisma.users.findMany({
      where,
      select: {
        id: true,
        wallet_address: true,
        username: true,
        nickname: true,
        role: true,
        created_at: true,
        last_login: true,
        is_banned: true
      },
      orderBy: [
        { role: 'asc' },
        { created_at: 'desc' }
      ],
      skip: offset,
      take: limitNum
    });
    
    // Return the results
    res.json({
      success: true,
      data: users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limitNum)
      }
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin Role Management]${fancyColors.RESET} Error getting users: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get users'
    });
  }
});

/**
 * @swagger
 * /api/admin/role/{walletAddress}:
 *   get:
 *     summary: Get user role details
 *     tags: [Admin - Role Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address of the user
 *     responses:
 *       200:
 *         description: User role details
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.get('/:walletAddress', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { walletAddress } = req.params;
    
    // Get user details
    const user = await prisma.users.findUnique({
      where: { wallet_address: walletAddress },
      select: {
        id: true,
        wallet_address: true,
        username: true,
        nickname: true,
        role: true,
        created_at: true,
        last_login: true,
        is_banned: true,
        ban_reason: true,
        user_stats: {
          select: {
            contests_entered: true,
            contests_won: true,
            total_prize_money: true
          }
        },
        admin_logs: {
          select: {
            action: true,
            created_at: true
          },
          where: {
            action: {
              in: ['ROLE_CHANGE', 'GRANT_ADMIN', 'REVOKE_ADMIN', 'GRANT_SUPERADMIN', 'REVOKE_SUPERADMIN']
            }
          },
          orderBy: {
            created_at: 'desc'
          },
          take: 10
        }
      }
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Return the results
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin Role Management]${fancyColors.RESET} Error getting user details: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get user details'
    });
  }
});

/**
 * @swagger
 * /api/admin/role/update:
 *   post:
 *     summary: Update a user's role
 *     tags: [Admin - Role Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet_address
 *               - role
 *             properties:
 *               wallet_address:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [user, admin, superadmin]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Role updated successfully
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (cannot downgrade your own role)
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/update', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { wallet_address, role, reason = 'Role updated by superadmin' } = req.body;
    
    // Validate required parameters
    if (!wallet_address || !role) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address and role are required'
      });
    }
    
    // Validate role
    if (!Object.values(UserRole).includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role. Must be one of: ${Object.values(UserRole).join(', ')}`
      });
    }
    
    // Prevent superadmin from downgrading their own role
    if (wallet_address === req.user.wallet_address && req.user.role === 'superadmin' && role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        error: 'You cannot downgrade your own superadmin role'
      });
    }
    
    // Check if user exists
    const user = await prisma.users.findUnique({
      where: { wallet_address }
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Update the user's role
    const updatedUser = await prisma.users.update({
      where: { wallet_address },
      data: { 
        role,
        updated_at: new Date()
      },
      select: {
        id: true,
        wallet_address: true,
        username: true,
        nickname: true,
        role: true
      }
    });
    
    // Determine the action type based on the role change
    let actionType;
    if (role === 'admin' && user.role === 'user') {
      actionType = 'GRANT_ADMIN';
    } else if (role === 'user' && user.role === 'admin') {
      actionType = 'REVOKE_ADMIN';
    } else if (role === 'superadmin') {
      actionType = 'GRANT_SUPERADMIN';
    } else if (user.role === 'superadmin' && role !== 'superadmin') {
      actionType = 'REVOKE_SUPERADMIN';
    } else {
      actionType = 'ROLE_CHANGE';
    }
    
    // Log the action
    logApi.info(`${fancyColors.GREEN}[Admin Role Management]${fancyColors.RESET} User role updated: ${wallet_address} -> ${role}`, {
      admin: req.user.wallet_address,
      user_wallet: wallet_address,
      previous_role: user.role,
      new_role: role,
      reason
    });
    
    // Record in admin logs
    await AdminLogger.logAction(
      req.user.wallet_address,
      actionType,
      {
        target_wallet: wallet_address,
        target_username: user.username || user.nickname || 'N/A',
        previous_role: user.role,
        new_role: role,
        reason
      }
    );
    
    // Return success response
    res.json({
      success: true,
      message: `User role updated to ${role} successfully`,
      data: updatedUser
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin Role Management]${fancyColors.RESET} Error updating user role: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to update user role'
    });
  }
});

/**
 * @swagger
 * /api/admin/role/revoke-all-admins:
 *   post:
 *     summary: Emergency endpoint to revoke all admin privileges (except current superadmin)
 *     tags: [Admin - Role Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - confirmation
 *               - reason
 *             properties:
 *               confirmation:
 *                 type: string
 *                 description: Must be "CONFIRM_REVOKE_ALL_ADMINS"
 *               reason:
 *                 type: string
 *                 description: Reason for emergency revocation
 *     responses:
 *       200:
 *         description: All admin privileges revoked
 *       400:
 *         description: Invalid confirmation code
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/revoke-all-admins', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { confirmation, reason } = req.body;
    
    // Require explicit confirmation
    if (confirmation !== 'CONFIRM_REVOKE_ALL_ADMINS') {
      return res.status(400).json({
        success: false,
        error: 'Invalid confirmation code. Must be "CONFIRM_REVOKE_ALL_ADMINS"'
      });
    }
    
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: 'A detailed reason (minimum 10 characters) is required for this action'
      });
    }
    
    // Get all admin and superadmin users except the current user
    const admins = await prisma.users.findMany({
      where: {
        role: {
          in: ['admin', 'superadmin']
        },
        wallet_address: {
          not: req.user.wallet_address
        }
      },
      select: {
        id: true,
        wallet_address: true,
        username: true,
        nickname: true,
        role: true
      }
    });
    
    // Downgrade all found users to regular users
    const updates = await Promise.all(
      admins.map(admin => 
        prisma.users.update({
          where: { wallet_address: admin.wallet_address },
          data: { 
            role: 'user',
            updated_at: new Date()
          }
        })
      )
    );
    
    // Log the mass action
    logApi.warn(`${fancyColors.RED}[EMERGENCY]${fancyColors.RESET} All admin privileges revoked by ${req.user.wallet_address}`, {
      admin: req.user.wallet_address,
      reason,
      affected_users: admins.length,
      affected_wallets: admins.map(a => a.wallet_address)
    });
    
    // Record individual entries in admin logs
    await Promise.all(
      admins.map(admin => 
        AdminLogger.logAction(
          req.user.wallet_address,
          admin.role === 'admin' ? 'REVOKE_ADMIN' : 'REVOKE_SUPERADMIN',
          {
            target_wallet: admin.wallet_address,
            target_username: admin.username || admin.nickname || 'N/A',
            previous_role: admin.role,
            new_role: 'user',
            reason: `EMERGENCY REVOCATION: ${reason}`
          }
        )
      )
    );
    
    // Record the mass action itself
    await AdminLogger.logAction(
      req.user.wallet_address,
      'EMERGENCY_REVOKE_ALL_ADMINS',
      {
        affected_count: admins.length,
        affected_wallets: admins.map(a => a.wallet_address),
        reason
      }
    );
    
    // Return success response
    res.json({
      success: true,
      message: `Emergency admin revocation executed successfully`,
      affected_users: admins.length,
      revoked_admins: admins.filter(a => a.role === 'admin').length,
      revoked_superadmins: admins.filter(a => a.role === 'superadmin').length
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[Admin Role Management]${fancyColors.RESET} Error in emergency revocation: ${error.message}`, {
      error: error.stack,
      user: req.user.wallet_address
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to execute emergency revocation'
    });
  }
});

export default router;