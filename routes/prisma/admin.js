// /routes/prisma/admin.js
import { Prisma, PrismaClient } from '@prisma/client';
import { Router } from 'express';

const router = Router();
const prisma = new PrismaClient();

/*
 *
 * I am not sure if even a single one of these endpoints actually works
 * 
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
 *     adminAuth:
 *       type: apiKey
 *       in: header
 *       name: X-Admin-Token
 */

/* Admin Activity Logs */

/**
 * @swagger
 * /api/admin/activities:
 *   get:
 *     summary: Get admin activity logs
 *     tags: [Admin]
 *     security:
 *       - adminAuth: []
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
 */
// Get admin activity logs
router.get('/activities', async (req, res) => {
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
    // Maintain original error handling
    if (debugMode) {
      console.error('Detailed error information:', error);
    }
    
    logger.error('Failed to fetch admin activities:', error);
    res.status(500).json({ error: 'Failed to fetch admin activities' });
  }
});

/**
 * @swagger
 * /api/admin/system-settings:
 *   get:
 *     summary: Get all system settings
 *     tags: [Admin]
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: System settings
 */
// Get all system settings
router.get('/system-settings', async (req, res) => {
  try {
    const settings = await prisma.system_settings.findMany();
    res.json(settings);
  } catch (error) {
    logger.error('Failed to fetch system settings:', error);
    res.status(500).json({ error: 'Failed to fetch system settings' });
  }
});

/**
 * @swagger
 * /api/admin/system-settings/{key}:
 *   put:
 *     summary: Update a system setting
 *     tags: [Admin]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               value:
 *                 type: object
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Setting updated successfully
 */
// Update a system setting
router.put('/system-settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;
    const adminAddress = req.headers['x-admin-address'];

    const setting = await prisma.system_settings.upsert({
      where: { key },
      update: {
        value,
        description,
        updated_by: adminAddress,
        updated_at: new Date()
      },
      create: {
        key,
        value,
        description,
        updated_by: adminAddress
      }
    });

    // Log the admin action
    await prisma.admin_logs.create({
      data: {
        admin_address: adminAddress,
        action: 'UPDATE_SYSTEM_SETTING',
        details: {
          key,
          old_value: setting.value,
          new_value: value
        },
        ip_address: req.ip
      }
    });

    res.json(setting);
  } catch (error) {
    logger.error('Failed to update system setting:', error);
    res.status(500).json({ error: 'Failed to update system setting' });
  }
});

/**
 * @swagger
 * /api/admin/users/{wallet}/ban:
 *   post:
 *     summary: Ban a user
 *     tags: [Admin]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: User banned successfully
 */
// Ban a user
router.post('/users/:wallet/ban', async (req, res) => {
  try {
    const { wallet } = req.params;
    const { reason } = req.body;
    const adminAddress = req.headers['x-admin-address'];

    const user = await prisma.users.update({
      where: { wallet_address: wallet },
      data: {
        is_banned: true,
        ban_reason: reason
      }
    });

    await prisma.admin_logs.create({
      data: {
        admin_address: adminAddress,
        action: 'BAN_USER',
        details: {
          wallet_address: wallet,
          reason
        },
        ip_address: req.ip
      }
    });

    res.json(user);
  } catch (error) {
    logger.error('Failed to ban user:', error);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

/**
 * @swagger
 * /api/admin/users/{wallet}/balance:
 *   post:
 *     summary: Adjust user's balance (Admin only)
 *     tags: [Admin]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Amount to adjust (positive for increase, negative for decrease)
 *                 example: 1000000
 *     responses:
 *       200:
 *         description: Balance adjusted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 previous_balance:
 *                   type: string
 *                   example: "1000000"
 *                 new_balance:
 *                   type: string
 *                   example: "2000000"
 *                 adjustment:
 *                   type: string
 *                   example: "1000000"
 *       404:
 *         description: User not found
 *       403:
 *         description: Not authorized
 */
// Adjust a user's points balance (This is a duplicate in nature of a /routes/prisma/balance.js endpoint)
router.post('/users/:wallet/balance', async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { wallet } = req.params;
  const { amount } = req.body;

  logger.info('Adjusting user balance', {
    requestId,
    wallet_address: wallet,
    adjustment_amount: amount
  });

  try {
    // Verify admin authorization here
    // TODO: Implement proper admin check
    const result = await prisma.$transaction(async (prisma) => {
      // Find user
      const user = await prisma.users.findUnique({
        where: { wallet_address: wallet }
      });
      if (!user) {
        throw new Error('User not found');
      }
      const previousBalance = new Prisma.Decimal(user.balance || '0');
      const adjustment = new Prisma.Decimal(amount);
      const newBalance = previousBalance.plus(adjustment);

      // Prevent negative balance
      if (newBalance.lessThan(0)) {
        throw new Error('Insufficient balance for deduction');
      }
      // Update user balance
      const updatedUser = await prisma.users.update({
        where: { wallet_address: wallet },
        data: { 
          balance: newBalance.toString(),
          updated_at: new Date()
        }
      });

      // Log the adjustment
      await prisma.admin_logs.create({
        data: {
          admin_address: req.headers['x-admin-address'] || 'SYSTEM',
          action: 'ADJUST_BALANCE',
          details: {
            wallet_address: wallet,
            previous_balance: previousBalance.toString(),
            adjustment: adjustment.toString(),
            new_balance: newBalance.toString()
          },
          ip_address: req.ip
        }
      });

      return {
        previous_balance: previousBalance.toString(),
        new_balance: newBalance.toString(),
        adjustment: adjustment.toString()
      };
    });

    logger.info('Successfully adjusted balance', {
      requestId,
      wallet_address: wallet,
      ...result,
      duration: Date.now() - startTime
    });

    res.json(result);

  } catch (error) {
    logger.error('Failed to adjust balance', {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error?.code,
        meta: error?.meta
      },
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      duration: Date.now() - startTime
    });

    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }

    if (error.message === 'Insufficient balance for deduction') {
      return res.status(400).json({ error: 'Insufficient balance for deduction' });
    }

    res.status(500).json({
      error: 'Failed to adjust balance',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router; 