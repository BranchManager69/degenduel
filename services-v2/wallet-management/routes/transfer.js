import express from 'express';
import Transfer from '../service/Transfer.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';

const router = express.Router();
const transfer = Transfer.getInstance();

// Execute multi-wallet transfer
router.post('/distribute', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { targetWallets, amounts } = req.body;
        
        if (!Array.isArray(targetWallets) || !Array.isArray(amounts) || 
            targetWallets.length !== amounts.length) {
            return res.status(400).json({ 
                error: 'Invalid input: targetWallets and amounts must be arrays of equal length' 
            });
        }

        const results = await transfer.distributeAmount(targetWallets, amounts);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Balance wallets (redistribute excess)
router.post('/balance', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { maxBalance } = req.body;
        const results = await transfer.balanceWallets(maxBalance);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Direct transfer between wallets
router.post('/direct', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { from, to, amount } = req.body;
        
        if (!from || !to || !amount) {
            return res.status(400).json({ 
                error: 'Missing required fields: from, to, amount' 
            });
        }

        const result = await transfer.executeTransfer(from, to, amount);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router; 