import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import logger from '../../utils/logger.js';

const router = Router();
const prisma = new PrismaClient();

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

export default router; 