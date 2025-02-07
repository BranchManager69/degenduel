// routes/admin/faucet-management.js

import express from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { FaucetManager } from '../../utils/solana-suite/faucet-manager.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiting setup
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 50 // 50 requests per minute
});

// Apply rate limiting and admin auth to all routes
router.use(limiter);
router.use(requireAdmin);

// Get faucet dashboard data
router.get('/dashboard', async (req, res) => {
    try {
        const dashboard = await FaucetManager.getDashboardData();
        res.json({ success: true, data: dashboard });
    } catch (error) {
        logApi.error('Failed to get faucet dashboard data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get faucet wallet status
router.get('/wallet-status', async (req, res) => {
    try {
        const status = await FaucetManager.getWalletStatus();
        res.json({ success: true, data: status });
    } catch (error) {
        logApi.error('Failed to get faucet wallet status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get recent faucet transactions
router.get('/transactions', async (req, res) => {
    try {
        const { limit = 20, offset = 0 } = req.query;
        const transactions = await FaucetManager.getRecentTransactions(limit, offset);
        res.json({ success: true, data: transactions });
    } catch (error) {
        logApi.error('Failed to get faucet transactions:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router; 