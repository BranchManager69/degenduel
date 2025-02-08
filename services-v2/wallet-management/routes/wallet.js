import express from 'express';
import WalletManager from '../service/WalletManager.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';

const router = express.Router();
const walletManager = WalletManager.getInstance();

// Generate single wallet
router.post('/', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { label } = req.body;
        const wallet = await walletManager.generateWallet(label);
        res.json(wallet);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate batch wallets
router.post('/batch', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { count, labelPrefix } = req.body;
        if (!count || count < 1 || count > 20) {
            return res.status(400).json({ error: 'Invalid count. Must be between 1 and 20.' });
        }
        const wallets = await walletManager.generateBatchWallets(count, labelPrefix);
        res.json(wallets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all wallets
router.get('/', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const wallets = await walletManager.getAllWallets();
        res.json(wallets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single wallet
router.get('/:publicKey', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const wallet = await walletManager.getWallet(req.params.publicKey);
        res.json(wallet);
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

// Update wallet label
router.patch('/:publicKey/label', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { label } = req.body;
        const wallet = await walletManager.updateWalletLabel(req.params.publicKey, label);
        res.json(wallet);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update wallet status
router.patch('/:publicKey/status', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const wallet = await walletManager.updateWalletStatus(req.params.publicKey, status);
        res.json(wallet);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export wallet
router.get('/:publicKey/export', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const includePrivateKey = req.query.includePrivateKey === 'true';
        const exportData = await walletManager.exportWallet(req.params.publicKey, includePrivateKey);
        res.json(exportData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export all wallets
router.get('/export/all', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const includePrivateKeys = req.query.includePrivateKeys === 'true';
        const exportData = await walletManager.exportAllWallets(includePrivateKeys);
        res.json(exportData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router; 