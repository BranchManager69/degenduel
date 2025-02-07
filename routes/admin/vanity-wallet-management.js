// routes/admin/vanity-wallet-management.js

import express from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { VanityPool } from '../../utils/solana-suite/vanity-pool.js';
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

// Get pool alerts (low balance, generation queue status, etc)
router.get('/pool/alerts', async (req, res) => {
    try {
        const alerts = await VanityPool.getPoolAlerts();
        res.json({ success: true, data: alerts });
    } catch (error) {
        logApi.error('Failed to get vanity pool alerts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get available patterns and their stats
router.get('/pool/patterns', async (req, res) => {
    try {
        const patterns = await VanityPool.getPatternStats();
        res.json({ success: true, data: patterns });
    } catch (error) {
        logApi.error('Failed to get vanity pool patterns:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get pool status and statistics
router.get('/pool/status', async (req, res) => {
    try {
        const status = await VanityPool.getPoolStatus();
        res.json({ success: true, data: status });
    } catch (error) {
        logApi.error('Failed to get vanity pool status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add new pattern to generate
router.post('/pool/patterns', async (req, res) => {
    try {
        const { pattern, count = 1, position = 'start', caseSensitive = false } = req.body;
        const result = await VanityPool.addGenerationTask(pattern, count, position, caseSensitive);
        res.json({ success: true, data: result });
    } catch (error) {
        logApi.error('Failed to add vanity pattern:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router; 