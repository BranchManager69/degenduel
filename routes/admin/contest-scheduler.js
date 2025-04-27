// routes/admin/contest-scheduler.js
import express from 'express';
import { body, param } from 'express-validator';
import { validateRequest } from '../../middleware/validateRequest.js';
import { requireAdmin } from '../../middleware/auth.js';
import contestSchedulerController from '../../controllers/contestSchedulerController.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiting setup
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 50 // 50 requests per minute
});

// Apply rate limiting to all routes
router.use(limiter);

// Apply admin authentication to all routes
router.use(requireAdmin);

// Get contest scheduler status
router.get('/status',
    contestSchedulerController.getSchedulerStatus
);

// Get configuration file
router.get('/config-file',
    contestSchedulerController.getConfigFile
);

// Update contest scheduler config
router.put('/config',
    [
        body('configuration').isObject().withMessage('Configuration must be an object')
    ],
    validateRequest,
    contestSchedulerController.updateSchedulerConfig
);

// Control contest scheduler service
router.post('/control/:action',
    [
        param('action').isIn(['start', 'stop', 'restart', 'status']).withMessage('Action must be start, stop, restart, or status')
    ],
    validateRequest,
    contestSchedulerController.controlSchedulerService
);

// Create contest now from config schedule
router.post('/create-contest',
    [
        body('scheduleName').isString().withMessage('Schedule name is required')
    ],
    validateRequest,
    contestSchedulerController.createContestNow
);

// --------------------------------
// Database Schedule Management API
// --------------------------------

// Get all database schedules
router.get('/db-schedules',
    contestSchedulerController.getDbSchedules
);

// Get schedule by ID
router.get('/db-schedules/:id',
    [
        param('id').isInt().withMessage('Schedule ID must be an integer')
    ],
    validateRequest,
    contestSchedulerController.getScheduleById
);

// Create a new schedule
router.post('/db-schedules',
    [
        body('name').isString().withMessage('Name is required'),
        body('template_id').isInt().withMessage('Template ID must be an integer'),
        body('days').optional().isArray().withMessage('Days must be an array of integers'),
        body('hour').optional().isInt().withMessage('Hour must be an integer between 0 and 23'),
        body('minute').optional().isInt().withMessage('Minute must be an integer between 0 and 59'),
        body('duration_hours').optional().isFloat().withMessage('Duration hours must be a number'),
        body('enabled').optional().isBoolean().withMessage('Enabled must be a boolean'),
        body('advance_notice_hours').optional().isInt().withMessage('Advance notice hours must be an integer'),
        body('allow_multiple_hours').optional().isBoolean().withMessage('Allow multiple hours must be a boolean'),
        body('multiple_hours').optional().isArray().withMessage('Multiple hours must be an array of integers')
    ],
    validateRequest,
    contestSchedulerController.createSchedule
);

// Update a schedule
router.put('/db-schedules/:id',
    [
        param('id').isInt().withMessage('Schedule ID must be an integer'),
        body('name').optional().isString().withMessage('Name must be a string'),
        body('template_id').optional().isInt().withMessage('Template ID must be an integer'),
        body('days').optional().isArray().withMessage('Days must be an array of integers'),
        body('hour').optional().isInt().withMessage('Hour must be an integer between 0 and 23'),
        body('minute').optional().isInt().withMessage('Minute must be an integer between 0 and 59'),
        body('duration_hours').optional().isFloat().withMessage('Duration hours must be a number'),
        body('enabled').optional().isBoolean().withMessage('Enabled must be a boolean'),
        body('advance_notice_hours').optional().isInt().withMessage('Advance notice hours must be an integer'),
        body('allow_multiple_hours').optional().isBoolean().withMessage('Allow multiple hours must be a boolean'),
        body('multiple_hours').optional().isArray().withMessage('Multiple hours must be an array of integers')
    ],
    validateRequest,
    contestSchedulerController.updateSchedule
);

// Delete a schedule
router.delete('/db-schedules/:id',
    [
        param('id').isInt().withMessage('Schedule ID must be an integer')
    ],
    validateRequest,
    contestSchedulerController.deleteSchedule
);

// Get all available templates
router.get('/templates',
    contestSchedulerController.getTemplates
);

// Create contest now from database schedule
router.post('/create-db-contest',
    [
        body('scheduleId').isInt().withMessage('Schedule ID is required')
    ],
    validateRequest,
    contestSchedulerController.createDbContestNow
);

// Migrate config schedules to database
router.post('/migrate-config',
    contestSchedulerController.migrateConfigToDatabase
);

export default router;