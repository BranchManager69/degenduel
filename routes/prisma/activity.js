// /routes/prisma/activity.js

import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';

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
 *     summary: Get admin activity logs (requires superadmin role)
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
router.get('/activities', requireAuth, requireSuperAdmin, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { limit = 50, offset = 0, action } = req.query;

  logApi.info('Fetching admin activities', {
    requestId,
    query: { limit, offset, action }
  });

  try {
    // Build where clause based on filters
    const where = action ? { action } : {};

    // Fetch activities with pagination
    const [activities, total] = await Promise.all([
      prisma.admin_logs.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      }),
      prisma.admin_logs.count({ where })
    ]);

    logApi.info('Successfully fetched admin activities', {
      requestId,
      activity_count: activities.length,
      total_count: total,
      duration: Date.now() - startTime
    });

    res.json({
      activities,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    logApi.error('Failed to fetch admin activities', {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error?.code,
        meta: error?.meta,
        stack: req.environment === 'development' ? error.stack : undefined
      },
      duration: Date.now() - startTime
    });

    res.status(500).json({
      error: 'Failed to fetch admin activities',
      message: req.environment === 'development' ? error.message : undefined
    });
  }
});

export default router; 
