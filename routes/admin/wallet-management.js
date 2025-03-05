// routes/admin/wallet-management.js

/*
 * This file is responsible for managing the admin's wallet.
 * It allows the admin to transfer SOL and tokens to other wallets.
 * 
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { body, param, query } from 'express-validator';
import { validateRequest } from '../../middleware/validateRequest.js';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../../middleware/auth.js';
import AdminWalletService from '../../services/adminWalletService.js';
import contestWalletService from '../../services/contestWalletService.js';
import AdminLogger from '../../utils/admin-logger.js';
import { logApi } from '../../utils/logger-suite/logger.js';

// TODO: Duplicate router!!
const router = express.Router();

// Rate limiting setup
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 50 // 50 requests per minute
});
const hourlyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 500 // 500 requests per hour
});
// Stricter rate limit for transfer endpoints
const transferLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10 // 10 transfers per minute
});
// Apply rate limiting to all routes
router.use(limiter);
router.use(hourlyLimiter);
// Apply admin authentication to all routes
router.use(requireAdmin);

// Validate Solana address
// TODO: THIS DOES NOT ACTUALLY VALIDATE A SOLANA ADDRESS!!!
const validateSolanaAddress = (value) => {
    try {
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
    } catch {
        return false;
    }
};


/* Useful routes */

// Get all contest wallets
router.get('/contest-wallets',
    async (req, res) => {
        try {
            const wallets = await AdminWalletService.getAllContestWallets();
            res.json({ success: true, data: wallets });
        } catch (error) {
            logApi.error('Failed to get contest wallets:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// Get specific wallet details
router.get('/wallet/:address',
    [
        param('address').custom(validateSolanaAddress).withMessage('Invalid Solana address'),
        query('token_mints.*').optional().custom(validateSolanaAddress)
            .withMessage('Invalid token mint address')
    ],
    validateRequest,
    async (req, res) => {
        try {
            const details = await AdminWalletService.getWalletDetails(
                req.params.address,
                req.query.token_mints || []
            );
            res.json({ success: true, ...details });
        } catch (error) {
            logApi.error('Failed to get wallet details:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// Transfer SOL
router.post('/transfer/sol',
    transferLimiter,
    [
        body('from_wallet').custom(validateSolanaAddress).withMessage('Invalid source wallet address'),
        body('to_address').custom(validateSolanaAddress).withMessage('Invalid destination address'),
        body('amount').isFloat({ min: 0.000001 }).withMessage('Amount must be at least 0.000001 SOL'),
        body('description').optional().isString().trim().isLength({ max: 200 })
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await AdminWalletService.transferSOL(
                req.body.from_wallet,
                req.body.to_address,
                req.body.amount,
                req.body.description,
                req.user.id,
                req.ip
            );
            res.json({ success: true, ...result });
        } catch (error) {
            logApi.error('Failed to transfer SOL:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// Transfer SPL Token
router.post('/transfer/token',
    transferLimiter,
    [
        body('from_wallet').custom(validateSolanaAddress).withMessage('Invalid source wallet address'),
        body('to_address').custom(validateSolanaAddress).withMessage('Invalid destination address'),
        body('mint').custom(validateSolanaAddress).withMessage('Invalid token mint address'),
        body('amount').isString().matches(/^\d+$/).withMessage('Amount must be a positive integer'),
        body('description').optional().isString().trim().isLength({ max: 200 })
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await AdminWalletService.transferToken(
                req.body.from_wallet,
                req.body.to_address,
                req.body.mint,
                req.body.amount,
                req.body.description,
                req.user.id,
                req.ip
            );
            res.json({ success: true, ...result });
        } catch (error) {
            logApi.error('Failed to transfer token:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// Mass transfer SOL
router.post('/mass-transfer/sol',
    transferLimiter,
    [
        body('from_wallet').custom(validateSolanaAddress).withMessage('Invalid source wallet address'),
        body('transfers').isArray({ max: 20 }).withMessage('Maximum 20 transfers per request'),
        body('transfers.*.address').custom(validateSolanaAddress)
            .withMessage('Invalid destination address'),
        body('transfers.*.amount').isFloat({ min: 0.000001 })
            .withMessage('Amount must be at least 0.000001 SOL'),
        body('transfers.*.description').optional().isString().trim().isLength({ max: 200 })
    ],
    validateRequest,
    async (req, res) => {
        try {
            const results = await AdminWalletService.massTransferSOL(
                req.body.from_wallet,
                req.body.transfers
            );
            res.json({ success: true, results });
        } catch (error) {
            logApi.error('Failed to mass transfer SOL:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// Mass transfer tokens
router.post('/mass-transfer/token',
    transferLimiter,
    [
        body('from_wallet').custom(validateSolanaAddress).withMessage('Invalid source wallet address'),
        body('mint').custom(validateSolanaAddress).withMessage('Invalid token mint address'),
        body('transfers').isArray({ max: 20 }).withMessage('Maximum 20 transfers per request'),
        body('transfers.*.address').custom(validateSolanaAddress)
            .withMessage('Invalid destination address'),
        body('transfers.*.amount').isString().matches(/^\d+$/)
            .withMessage('Amount must be a positive integer'),
        body('transfers.*.description').optional().isString().trim().isLength({ max: 200 })
    ],
    validateRequest,
    async (req, res) => {
        try {
            const results = await AdminWalletService.massTransferTokens(
                req.body.from_wallet,
                req.body.mint,
                req.body.transfers
            );
            res.json({ success: true, results });
        } catch (error) {
            logApi.error('Failed to mass transfer tokens:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// Get transaction history
router.get('/transactions/:address',
    [
        param('address').custom(validateSolanaAddress).withMessage('Invalid wallet address'),
        query('start_date').optional().isISO8601().withMessage('Invalid start date'),
        query('end_date').optional().isISO8601().withMessage('Invalid end date'),
        query('type').optional().isString(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('offset').optional().isInt({ min: 0 }).toInt()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const { address } = req.params;
            const { start_date, end_date, type, limit = 20, offset = 0 } = req.query;

            const transactions = await AdminWalletService.getTransactionHistory(
                address,
                { start_date, end_date, type, limit, offset }
            );
            res.json({ success: true, ...transactions });
        } catch (error) {
            logApi.error('Failed to get transaction history:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// Export wallet (superadmin only)
router.get('/export-wallet/:address',
    requireSuperAdmin,
    [
        param('address').custom(validateSolanaAddress).withMessage('Invalid wallet address')
    ],
    validateRequest,
    async (req, res) => {
        try {
            const wallet = await AdminWalletService.exportWalletPrivateKey(req.params.address);
            res.json({ success: true, ...wallet });
        } catch (error) {
            logApi.error('Failed to export wallet:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// Get total SOL balance across all contest wallets
router.get('/total-sol-balance',
    async (req, res) => {
        try {
            const balance = await AdminWalletService.getTotalSOLBalance();
            res.json({ success: true, data: balance });
        } catch (error) {
            logApi.error('Failed to get total SOL balance:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// Get contest wallets overview
router.get('/contest-wallets', async (req, res) => {
    try {
        const wallets = await AdminWalletService.getContestWalletsOverview();
        res.json({ success: true, data: wallets });
    } catch (error) {
        logApi.error('Failed to get contest wallets overview:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reclaim unused funds from completed or cancelled contest wallets
router.post('/reclaim-unused-funds', 
    requireAuth, // First ensure user is authenticated
    requireAdmin, // Then ensure user is admin
    [
        body('status_filter').optional().isArray(),
        body('min_balance').optional().isFloat({ min: 0 }),
        body('min_transfer').optional().isFloat({ min: 0 }),
        body('contest_id').optional().isInt()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const { status_filter, min_balance, min_transfer, contest_id } = req.body;
            const adminAddress = req.user.wallet_address;
            
            // Log the admin action
            await AdminLogger.logAction(
                adminAddress,
                AdminLogger.Actions.WALLET.RECLAIM_FUNDS || 'WALLET_RECLAIM_FUNDS',
                {
                    status_filter,
                    min_balance,
                    min_transfer,
                    contest_id,
                    initiated_by: req.user.username
                },
                {
                    ip_address: req.ip,
                    user_agent: req.get('user-agent')
                }
            );
            
            // Perform the reclaim operation
            const results = await contestWalletService.reclaimUnusedFunds({
                statusFilter: status_filter,
                minBalance: min_balance,
                minTransfer: min_transfer,
                specificContestId: contest_id,
                adminAddress
            });
            
            res.json({
                success: true,
                message: `Reclaim operation completed: ${results.successfulTransfers}/${results.walletsThatMeetCriteria} transfers successful, total reclaimed: ${results.totalAmountReclaimed.toFixed(6)} SOL`,
                data: results
            });
        } catch (error) {
            logApi.error('Failed to reclaim unused funds:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to reclaim unused funds: ' + error.message
            });
        }
    });

export default router; 