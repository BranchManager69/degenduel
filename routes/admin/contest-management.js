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

// Credit Management for User Contest Creation

/**
 * Get all contest creation credits with optional filters
 */
router.get('/credits',
    async (req, res) => {
        try {
            const adminAddress = req.user.wallet_address;
            
            // Prepare filters
            const filters = {};
            
            if (req.query.status) {
                filters.status = req.query.status;
            }
            
            if (req.query.source) {
                filters.source = req.query.source;
            }
            
            if (req.query.user_id) {
                filters.user_id = req.query.user_id;
            }
            
            // Get credits with pagination
            const limit = parseInt(req.query.limit) || 100;
            const offset = parseInt(req.query.offset) || 0;
            
            const credits = await prisma.contest_creation_credits.findMany({
                where: filters,
                include: {
                    user: {
                        select: {
                            wallet_address: true,
                            nickname: true,
                            role: true
                        }
                    },
                    contest: {
                        select: {
                            id: true,
                            name: true,
                            contest_code: true,
                            status: true
                        }
                    }
                },
                orderBy: {
                    created_at: 'desc'
                },
                take: limit,
                skip: offset
            });
            
            // Get total count for pagination
            const totalCount = await prisma.contest_creation_credits.count({
                where: filters
            });
            
            // Log admin action
            await AdminLogger.logAction(
                adminAddress,
                AdminLogger.Actions.CONTEST_MANAGEMENT.VIEW_CREDITS,
                {
                    filters,
                    limit,
                    offset,
                    count: credits.length,
                    total: totalCount
                },
                {
                    ip_address: req.ip,
                    user_agent: req.get('user-agent')
                }
            );
            
            res.json({
                success: true,
                data: {
                    credits,
                    pagination: {
                        total: totalCount,
                        limit,
                        offset
                    }
                }
            });
        } catch (error) {
            logApi.error(`Failed to get contest creation credits:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve contest creation credits',
                message: error.message
            });
        }
    }
);

/**
 * Get credit details by ID
 */
router.get('/credits/:id',
    [
        param('id').isInt().withMessage('Credit ID must be an integer')
    ],
    validateRequest,
    async (req, res) => {
        try {
            const creditId = parseInt(req.params.id);
            const adminAddress = req.user.wallet_address;
            
            const credit = await prisma.contest_creation_credits.findUnique({
                where: { id: creditId },
                include: {
                    user: {
                        select: {
                            wallet_address: true,
                            nickname: true,
                            role: true,
                            created_at: true
                        }
                    },
                    contest: {
                        select: {
                            id: true,
                            name: true,
                            contest_code: true,
                            status: true,
                            start_time: true,
                            end_time: true
                        }
                    }
                }
            });
            
            if (!credit) {
                return res.status(404).json({
                    success: false,
                    error: 'Credit not found'
                });
            }
            
            // Log admin action
            await AdminLogger.logAction(
                adminAddress,
                AdminLogger.Actions.CONTEST_MANAGEMENT.VIEW_CREDIT,
                {
                    credit_id: creditId,
                    user_id: credit.user_id
                },
                {
                    ip_address: req.ip,
                    user_agent: req.get('user-agent')
                }
            );
            
            res.json({
                success: true,
                data: credit
            });
        } catch (error) {
            logApi.error(`Failed to get credit details:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve credit details',
                message: error.message
            });
        }
    }
);

/**
 * Grant a contest creation credit to a user
 */
router.post('/credits/grant',
    [
        body('user_id').isString().withMessage('User ID (wallet address) is required'),
        body('source').isString().isIn(['admin_grant', 'purchase', 'achievement']).withMessage('Source must be one of: admin_grant, purchase, achievement'),
        body('expires_at').optional().isISO8601().withMessage('Expires at must be a valid ISO date'),
        body('metadata').optional().isObject().withMessage('Metadata must be an object')
    ],
    validateRequest,
    async (req, res) => {
        try {
            const { user_id, source, expires_at, metadata } = req.body;
            const adminAddress = req.user.wallet_address;
            
            // Import the credit granting utility
            const { grantCredit } = await import('../../utils/contest-credit-verifier.js');
            
            // Verify the user exists
            const user = await prisma.users.findUnique({
                where: { wallet_address: user_id },
                select: { wallet_address: true, nickname: true }
            });
            
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            
            // Grant the credit
            const result = await grantCredit(user_id, source, adminAddress, {
                expires_at: expires_at ? new Date(expires_at) : null,
                metadata: metadata || {},
                receipt_number: `ADM-${Date.now().toString().slice(-6)}`
            });
            
            if (!result.success) {
                return res.status(500).json({
                    success: false,
                    error: result.error
                });
            }
            
            // Log admin action
            await AdminLogger.logAction(
                adminAddress,
                AdminLogger.Actions.CONTEST_MANAGEMENT.GRANT_CREDIT,
                {
                    credit_id: result.credit.id,
                    user_id,
                    source,
                    expires_at: expires_at || null
                },
                {
                    ip_address: req.ip,
                    user_agent: req.get('user-agent')
                }
            );
            
            res.status(201).json({
                success: true,
                message: 'Credit granted successfully',
                data: result.credit
            });
        } catch (error) {
            logApi.error(`Failed to grant contest creation credit:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to grant contest creation credit',
                message: error.message
            });
        }
    }
);

/**
 * Revoke a contest creation credit
 */
router.post('/credits/:id/revoke',
    [
        param('id').isInt().withMessage('Credit ID must be an integer'),
        body('reason').isString().withMessage('Reason is required')
    ],
    validateRequest,
    async (req, res) => {
        try {
            const creditId = parseInt(req.params.id);
            const { reason } = req.body;
            const adminAddress = req.user.wallet_address;
            
            // Get the credit to make sure it exists and is active
            const credit = await prisma.contest_creation_credits.findUnique({
                where: { id: creditId }
            });
            
            if (!credit) {
                return res.status(404).json({
                    success: false,
                    error: 'Credit not found'
                });
            }
            
            if (credit.status !== 'active') {
                return res.status(400).json({
                    success: false,
                    error: `Cannot revoke credit with status '${credit.status}'`
                });
            }
            
            // Update the credit to revoked status
            const updatedCredit = await prisma.contest_creation_credits.update({
                where: { id: creditId },
                data: {
                    status: 'revoked',
                    metadata: {
                        ...credit.metadata,
                        revocation_reason: reason,
                        revoked_at: new Date().toISOString(),
                        revoked_by: adminAddress
                    }
                }
            });
            
            // Log admin action
            await AdminLogger.logAction(
                adminAddress,
                AdminLogger.Actions.CONTEST_MANAGEMENT.REVOKE_CREDIT,
                {
                    credit_id: creditId,
                    user_id: credit.user_id,
                    reason
                },
                {
                    ip_address: req.ip,
                    user_agent: req.get('user-agent')
                }
            );
            
            res.json({
                success: true,
                message: 'Credit revoked successfully',
                data: updatedCredit
            });
        } catch (error) {
            logApi.error(`Failed to revoke contest creation credit:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to revoke contest creation credit',
                message: error.message
            });
        }
    }
);

/**
 * Get user contest creation stats
 */
router.get('/credits/stats/users',
    async (req, res) => {
        try {
            const adminAddress = req.user.wallet_address;
            
            // Get stats on credits by user
            const userStats = await prisma.$queryRaw`
                SELECT 
                    u.wallet_address,
                    u.nickname,
                    COUNT(ccc.id) AS total_credits,
                    SUM(CASE WHEN ccc.status = 'active' THEN 1 ELSE 0 END) AS active_credits,
                    SUM(CASE WHEN ccc.status = 'used' THEN 1 ELSE 0 END) AS used_credits,
                    SUM(CASE WHEN ccc.status = 'expired' THEN 1 ELSE 0 END) AS expired_credits,
                    SUM(CASE WHEN ccc.status = 'revoked' THEN 1 ELSE 0 END) AS revoked_credits,
                    MIN(ccc.created_at) AS first_credit_at,
                    MAX(ccc.created_at) AS latest_credit_at
                FROM users u
                JOIN contest_creation_credits ccc ON u.wallet_address = ccc.user_id
                GROUP BY u.wallet_address, u.nickname
                ORDER BY total_credits DESC
                LIMIT 100
            `;
            
            // Log admin action
            await AdminLogger.logAction(
                adminAddress,
                AdminLogger.Actions.CONTEST_MANAGEMENT.VIEW_CREDIT_STATS,
                {
                    stats_type: 'users'
                },
                {
                    ip_address: req.ip,
                    user_agent: req.get('user-agent')
                }
            );
            
            res.json({
                success: true,
                data: userStats
            });
        } catch (error) {
            logApi.error(`Failed to get user contest creation stats:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve user contest creation stats',
                message: error.message
            });
        }
    }
);

/**
 * Get contest credit usage stats
 */
router.get('/credits/stats/usage',
    async (req, res) => {
        try {
            const adminAddress = req.user.wallet_address;
            
            // Get overall stats
            const overallStats = await prisma.$queryRaw`
                SELECT
                    COUNT(*) AS total_credits,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_credits,
                    SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used_credits,
                    SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_credits,
                    SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) AS revoked_credits,
                    COUNT(DISTINCT user_id) AS users_with_credits
                FROM contest_creation_credits
            `;
            
            // Get stats by source
            const sourceStats = await prisma.$queryRaw`
                SELECT
                    source,
                    COUNT(*) AS total_credits,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_credits,
                    SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used_credits
                FROM contest_creation_credits
                GROUP BY source
            `;
            
            // Get stats by month
            const monthlyStats = await prisma.$queryRaw`
                SELECT
                    DATE_TRUNC('month', created_at) AS month,
                    COUNT(*) AS credits_granted,
                    SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS credits_used
                FROM contest_creation_credits
                GROUP BY DATE_TRUNC('month', created_at)
                ORDER BY month DESC
                LIMIT 12
            `;
            
            // Log admin action
            await AdminLogger.logAction(
                adminAddress,
                AdminLogger.Actions.CONTEST_MANAGEMENT.VIEW_CREDIT_STATS,
                {
                    stats_type: 'usage'
                },
                {
                    ip_address: req.ip,
                    user_agent: req.get('user-agent')
                }
            );
            
            res.json({
                success: true,
                data: {
                    overall: overallStats[0],
                    by_source: sourceStats,
                    by_month: monthlyStats
                }
            });
        } catch (error) {
            logApi.error(`Failed to get contest credit usage stats:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve contest credit usage stats',
                message: error.message
            });
        }
    }
);

export default router;