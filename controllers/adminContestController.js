// controllers/adminContestController.js

import { logApi } from '../utils/logger-suite/logger.js';
import contestEvaluationService from '../services/contestEvaluationService.js';
import AdminLogger from '../utils/admin-logger.js';
// DEPRECATED: walletRakeService - functionality has been integrated into contestWalletService
// import walletRakeService from '../services/walletRakeService.js';
import prisma from '../config/prisma.js';
import { fancyColors } from '../utils/colors.js';

/* 
 * I am unclear on the current state of this controller.
 * It is imported by contest-management.js for 
 */

// Get contest monitoring data
async function getContestMonitoring(req, res) {
    try {
        const monitoringData = await prisma.$queryRaw`
            SELECT * FROM contest_monitoring
            ORDER BY 
                CASE state_check 
                    WHEN 'SHOULD_END' THEN 1
                    WHEN 'SHOULD_START' THEN 2
                    WHEN 'SHOULD_AUTO_CANCEL' THEN 3
                    ELSE 4
                END,
                start_time DESC
        `;

        res.json({
            success: true,
            data: monitoringData
        });
    } catch (error) {
        logApi.error('Failed to get contest monitoring:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get contest monitoring data'
        });
    }
}

// Get contest performance metrics
async function getContestMetrics(req, res) {
    try {
        const metrics = await prisma.$queryRaw`
            SELECT * FROM contest_performance_metrics
            WHERE status != 'draft'
            ORDER BY start_time DESC
        `;

        res.json({
            success: true,
            data: metrics
        });
    } catch (error) {
        logApi.error('Failed to get contest metrics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get contest metrics'
        });
    }
}

// Get contest state history
async function getContestHistory(req, res) {
    const { contestId } = req.params;
    try {
        const history = await prisma.contest_state_history.findMany({
            where: {
                contest_id: parseInt(contestId)
            },
            orderBy: {
                changed_at: 'desc'
            }
        });

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        logApi.error('Failed to get contest history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get contest history'
        });
    }
}

// Manual contest state management
async function updateContestState(req, res) {
    const { contestId } = req.params;
    const { action, reason } = req.body;
    const adminAddress = req.user.wallet_address;

    try {
        const contest = await prisma.contests.findUnique({
            where: { id: parseInt(contestId) },
            include: {
                participants: true
            }
        });

        if (!contest) {
            return res.status(404).json({
                success: false,
                error: 'Contest not found'
            });
        }

        // Update contest notes with admin action
        let updateData = {
            notes: `${action} manually by ${req.user.username}${reason ? `: ${reason}` : ''}`
        };

        // Log admin action
        await AdminLogger.logAction(
            adminAddress,
            AdminLogger.Actions.CONTEST[action],
            {
                contest_id: contestId,
                reason,
                previous_status: contest.status,
                participant_count: contest.participants.length
            },
            {
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }
        );

        // Update contest status based on action
        switch (action.toUpperCase()) {
            case 'START':
                if (contest.status !== 'pending') {
                    return res.status(400).json({
                        success: false,
                        error: 'Contest must be in pending state to start'
                    });
                }
                updateData.status = 'active';
                updateData.start_time = new Date();
                break;

            case 'END':
                if (contest.status !== 'active') {
                    return res.status(400).json({
                        success: false,
                        error: 'Contest must be in active state to end'
                    });
                }
                updateData.status = 'completed';
                updateData.completed_at = new Date();
                break;

            case 'CANCEL':
                if (['completed', 'cancelled'].includes(contest.status)) {
                    return res.status(400).json({
                        success: false,
                        error: 'Cannot cancel a completed or already cancelled contest'
                    });
                }
                updateData.status = 'cancelled';
                break;

            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid action'
                });
        }

        // Update contest state
        const updatedContest = await prisma.contests.update({
            where: { id: parseInt(contestId) },
            data: updateData
        });
        
        // If cancelling a contest, process refunds if applicable
        if (action.toUpperCase() === 'CANCEL' && contest.participants.length > 0) {
            // Process refunds using admin context
            contestEvaluationService.processContestRefunds(
                contest,
                adminAddress,
                {
                    ip_address: req.ip,
                    user_agent: req.headers['user-agent']
                }
            ).catch(error => {
                logApi.error(`${fancyColors.BG_RED}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BG_LIGHT_RED}Failed to process refunds for cancelled contest:${fancyColors.RESET}`, {
                    contest_id: contestId,
                    error: error.message
                });
            });
        }

        // Update contest notes with admin action
        res.json({
            success: true,
            data: updatedContest,
            message: `Contest ${action.toLowerCase()}ed successfully${action.toUpperCase() === 'CANCEL' ? '. Refunds are being processed.' : ''}`
        });
    } catch (error) {
        // Log error and return 500 error
        logApi.error('Failed to update contest state:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update contest state'
        });
    }
}

// Get failed transactions for a contest
async function getFailedTransactions(req, res) {
    const { contestId } = req.params;
    try {
        const failedTxs = await prisma.transactions.findMany({
            where: {
                contest_id: parseInt(contestId),
                status: 'failed'
            },
            orderBy: {
                created_at: 'desc'
            }
        });

        res.json({
            success: true,
            data: failedTxs
        });
    } catch (error) {
        logApi.error('Failed to get failed transactions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get failed transactions'
        });
    }
}

// Retry failed transaction
async function retryFailedTransaction(req, res) {
    const { transactionId } = req.params;
    try {
        const transaction = await prisma.transactions.findUnique({
            where: { id: parseInt(transactionId) }
        });

        if (!transaction) {
            return res.status(404).json({
                success: false,
                error: 'Transaction not found'
            });
        }

        // Reset transaction status to pending for retry
        await prisma.transactions.update({
            where: { id: parseInt(transactionId) },
            data: {
                status: 'pending',
                error_details: null,
                retry_count: (transaction.retry_count || 0) + 1,
                updated_at: new Date()
            }
        });

        res.json({
            success: true,
            message: 'Transaction queued for retry'
        });
    } catch (error) {
        logApi.error('Failed to retry transaction:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retry transaction'
        });
    }
}

// REMOVED: Manual wallet rake endpoint (replaced by automatic reclaiming)
/*
async function rakeWallet(req, res) {
    // Endpoint removed - automated reclaiming is now implemented in contestWalletService
}
*/

// DEPRECATED: Rake service status endpoint (functionality integrated into contestWalletService)
/*
async function getRakeServiceStatus(req, res) {
    // Endpoint removed - rake service has been deprecated
    // Wallet reclaiming is now handled automatically by contestWalletService
}
*/

// DEPRECATED: Rake service control endpoint (functionality integrated into contestWalletService)
/*
async function controlRakeService(req, res) {
    // Endpoint removed - rake service has been deprecated
    // Wallet reclaiming is now handled automatically by contestWalletService
}
*/

export default {
    getContestMonitoring,
    getContestMetrics,
    getContestHistory,
    updateContestState,
    getFailedTransactions,
    retryFailedTransaction
    // DEPRECATED: Rake-related functions removed - functionality integrated into contestWalletService
    // rakeWallet,
    // getRakeServiceStatus,
    // controlRakeService
}; 