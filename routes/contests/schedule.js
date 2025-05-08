/**
 * Contest Schedule Routes
 * 
 * @description Routes for contest scheduling
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import contestSchedulerController from '../../controllers/contestSchedulerController.js';

// Router
const router = express.Router();

// Create a dedicated logger for contest scheduling
const scheduleLogger = {
  ...logApi.forService('CONTESTS_SCHEDULE'),
  analytics: logApi.analytics
};

/**
 * @route GET /api/contests/schedules
 * @description Get all public contest schedules
 * @access Public
 */
router.get('/schedules', contestSchedulerController.getPublicSchedules);

/**
 * @route GET /api/contests/schedules/:id
 * @description Get a specific contest schedule
 * @access Public
 */
router.get('/schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Invalid schedule ID' });
    }
    
    // Get schedule with next occurrences
    const schedule = await prisma.contest_schedules.findUnique({
      where: { id: parsedId },
      include: {
        next_occurrences: {
          orderBy: { scheduled_start_time: 'asc' },
          take: 5
        }
      }
    });
    
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    
    // Check if schedule is public or if user is admin
    if (schedule.visibility !== 'public' && (!req.user || !['admin', 'superadmin'].includes(req.user.role))) {
      return res.status(403).json({
        error: 'private_schedule',
        message: 'This schedule is private'
      });
    }
    
    // Get count of contests created from this schedule
    const contestCount = await prisma.contests.count({
      where: { schedule_id: parsedId }
    });
    
    res.json({
      schedule: {
        ...schedule,
        contest_count: contestCount
      }
    });
  } catch (error) {
    scheduleLogger.error('Failed to fetch contest schedule:', error);
    res.status(500).json({ error: 'Failed to fetch contest schedule', message: error.message });
  }
});

export default router;