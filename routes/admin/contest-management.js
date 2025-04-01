import express from 'express';
import { body, param } from 'express-validator';
import { validateRequest } from '../../middleware/validateRequest.js';
import { requireAdmin } from '../../middleware/auth.js';
import adminContestController from '../../controllers/adminContestController.js';
import contestImageService from '../../services/contestImageService.js';
import AdminLogger from '../../utils/admin-logger.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import prisma from '../../config/prisma.js';
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

// Regenerate AI image for a contest
router.post('/regenerate-image/:contestId',
    [
        param('contestId').isInt().withMessage('Contest ID must be an integer')
    ],
    validateRequest,
    async (req, res) => {
        try {
            const contestId = parseInt(req.params.contestId);
            const adminAddress = req.user.wallet_address;
            
            logApi.info(`🎨 ${fancyColors.CYAN}[routes/admin/contest-management]${fancyColors.RESET} Regenerating contest image`, {
                admin: adminAddress,
                contest_id: contestId
            });
            
            // Fetch the contest to ensure it exists
            const contest = await prisma.contests.findUnique({
                where: { id: contestId }
            });
            
            if (!contest) {
                logApi.warn(`⚠️ ${fancyColors.YELLOW}[routes/admin/contest-management]${fancyColors.RESET} Contest not found`, {
                    contest_id: contestId
                });
                return res.status(404).json({
                    success: false,
                    error: 'Contest not found'
                });
            }
            
            // Regenerate the image
            const imageUrl = await contestImageService.regenerateContestImage(contestId);
            
            // Log the admin action with AdminLogger (for admin audit trail)
            await AdminLogger.logAction(
                adminAddress,
                "REGENERATE_CONTEST_IMAGE",
                {
                    contest_id: contestId,
                    previous_image: contest.image_url,
                    new_image: imageUrl
                },
                {
                    ip_address: req.ip,
                    user_agent: req.headers['user-agent']
                }
            );
            
            // Also log with logApi (for operational logging)
            logApi.info(`✅ ${fancyColors.GREEN}[routes/admin/contest-management]${fancyColors.RESET} Contest image regenerated successfully`, {
                contest_id: contestId,
                image_url: imageUrl
            });
            
            res.json({
                success: true,
                data: {
                    contest_id: contestId,
                    image_url: imageUrl
                },
                message: 'Contest image regenerated successfully'
            });
        } catch (error) {
            logApi.error(`❌ ${fancyColors.RED}[routes/admin/contest-management]${fancyColors.RESET} Failed to regenerate contest image`, {
                contest_id: contestId,
                error: error.message,
                stack: error.stack
            });
            
            res.status(500).json({
                success: false,
                error: 'Failed to regenerate contest image',
                message: error.message
            });
        }
    }
);

export default router; 