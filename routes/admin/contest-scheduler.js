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

// Create contest now
router.post('/create-contest',
    [
        body('scheduleName').isString().withMessage('Schedule name is required')
    ],
    validateRequest,
    contestSchedulerController.createContestNow
);

export default router;