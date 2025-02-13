import express from 'express';
import walletRoutes from './wallet-management/routes/wallet.js';
import transferRoutes from './wallet-management/routes/transfer.js';
import { WalletManager } from './wallet-management/service/WalletManager.js';
import Transfer from './wallet-management/service/Transfer.js';

const router = express.Router();

// Initialize services
const walletManager = WalletManager.getInstance();
const transfer = Transfer.getInstance();

// Mount routes
router.use('/wallet', walletRoutes);
router.use('/transfer', transferRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        services: {
            wallet_manager: 'active',
            transfer: 'active'
        }
    });
});

export default router; 