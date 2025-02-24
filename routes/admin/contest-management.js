import express from 'express';
import { body, param } from 'express-validator';
import { validateRequest } from '../../middleware/validateRequest.js';
import { requireAdmin } from '../../middleware/auth.js';
import adminContestController from '../../controllers/adminContestController.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiting setup
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100 // 100 requests per minute
});

const hourlyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 1000 // 1000 requests per hour
});

// Apply rate limiting to all routes
router.use(limiter);
router.use(hourlyLimiter);

// Apply admin authentication to all routes
router.use(requireAdmin);

// Get contest monitoring data
router.get('/monitoring',
    adminContestController.getContestMonitoring
);

// Get contest performance metrics
router.get('/metrics',
    adminContestController.getContestMetrics
);

// Get contest state history
router.get('/history/:contestId',
    [
        param('contestId').isInt().withMessage('Contest ID must be an integer')
    ],
    validateRequest,
    adminContestController.getContestHistory
);

// Update contest state
router.post('/state/:contestId',
    [
        param('contestId').isInt().withMessage('Contest ID must be an integer'),
        body('action').isIn(['START', 'END', 'CANCEL']).withMessage('Invalid action'),
        body('reason').optional().isString().trim().isLength({ min: 1, max: 500 })
            .withMessage('Reason must be between 1 and 500 characters')
    ],
    validateRequest,
    adminContestController.updateContestState
);

// Get failed transactions for a contest
router.get('/transactions/failed/:contestId',
    [
        param('contestId').isInt().withMessage('Contest ID must be an integer')
    ],
    validateRequest,
    adminContestController.getFailedTransactions
);

// Retry failed transaction
router.post('/transactions/retry/:transactionId',
    [
        param('transactionId').isInt().withMessage('Transaction ID must be an integer')
    ],
    validateRequest,
    adminContestController.retryFailedTransaction
);

export default router; 