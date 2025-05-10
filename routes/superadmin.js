// routes/superadmin.js

import { exec } from 'child_process';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import bs58 from 'bs58';
import chalk from 'chalk';
import logApi from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { 
    Connection, PublicKey, Keypair, 
    Transaction, SystemProgram, 
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
// Route imports
import walletMonitoringRouter from './admin-api/wallet-monitoring.js';
// Services
import walletGenerationService from '../services/walletGenerationService.js';
import adminWalletService from '../services/admin-wallet/index.js';
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
import ContestWalletService from '../services/contest-wallet/contestWalletService.js';
////import liquidityService from '../services/liquidityService.js';
////import userBalanceTrackingService from '../services/userBalanceTrackingService.js';

// Config
import { config } from '../config/config.js';
// Logs go into current working directory + /logs
const LOG_DIR = path.join(process.cwd(), 'logs');
// Constants
const TEST_RECOVERY_AMOUNT_PER_WALLET = config.contest_wallet_test_recovery_amount_per_wallet; // SOL (default = 0.00420690 SOL)
const ABSOLUTE_MINIMUM_SOL_TO_LEAVE_IN_EACH_WALLET_DURING_RECOVERY = config.contest_wallet_min_amount_to_leave_in_each_wallet_during_recovery; // SOL (default = 0.0001 SOL)
const ACCEPTABLE_LOSS_AMOUNT_PER_WALLET_DURING_RECOVERY = config.contest_wallet_acceptable_loss_amount_per_wallet_during_recovery; // SOL (default = 0.0001 SOL)
const SECONDS_BETWEEN_TRANSACTIONS_DURING_RECOVERY = config.contest_wallet_seconds_between_transactions_during_recovery; // default = 2 seconds

// Router
const router = express.Router();

// Solana connection
const connection = new Connection(config.rpc_urls.primary, 'confirmed');

// Middleware ensures superadmin role
const requireSuperAdminMiddleware = (req, res, next) => {
    if (req.user?.role !== 'superadmin') {
        return res.status(403).json({
            error: 'Superadmin access required'
        });
    }
    next();
};


// ==== WALLET MANAGEMENT ENDPOINTS ====

/**
 * @swagger
 * /api/superadmin/wallets:
 *   get:
 *     summary: Get all admin wallets
 *     tags: [SuperAdmin, Wallets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [all, liquidity, faucet, admin]
 *         description: Filter wallets by type
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: List of wallets
 */
router.get('/wallets', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { type = 'all', active } = req.query;
        
        // Build where clause based on filters
        const where = {};
        
        if (active !== undefined) {
            where.is_active = active === 'true';
        }
        
        if (type !== 'all') {
            // Handle different wallet types
            switch(type) {
                case 'liquidity':
                    where.purpose = 'liquidity';
                    break;
                case 'faucet':
                    where.purpose = { contains: 'faucet' };
                    break;
                case 'admin':
                    where.purpose = { contains: 'admin' };
                    break;
            }
        }
        
        // Get wallets from database
        const wallets = await prisma.seed_wallets.findMany({
            where,
            orderBy: [
                { is_active: 'desc' },
                { created_at: 'desc' }
            ]
        });
        
        // Get balances in parallel
        const walletsWithBalance = await Promise.all(
            wallets.map(async (wallet) => {
                try {
                    const balance = await connection.getBalance(new PublicKey(wallet.wallet_address));
                    return {
                        ...wallet,
                        balance: balance / LAMPORTS_PER_SOL,
                        balance_raw: balance
                    };
                } catch (error) {
                    return {
                        ...wallet,
                        balance: 0,
                        balance_raw: 0,
                        error: 'Failed to fetch balance'
                    };
                }
            })
        );
        
        // Get service stats
        const serviceStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.ADMIN_WALLET);
        
        return res.json({
            wallets: walletsWithBalance,
            total: walletsWithBalance.length,
            active: walletsWithBalance.filter(w => w.is_active).length,
            service_status: serviceStatus ? 'healthy' : 'unhealthy',
            last_check: new Date().toISOString()
        });
    } catch (error) {
        logApi.error('Error getting wallets:', error);
        return res.status(500).json({ error: 'Failed to get wallets' });
    }
});

/**
 * @swagger
 * /api/superadmin/wallets/generate:
 *   post:
 *     summary: Generate new wallets
 *     tags: [SuperAdmin, Wallets]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - count
 *               - purpose
 *             properties:
 *               count:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 50
 *                 description: Number of wallets to generate
 *               purpose:
 *                 type: string
 *                 enum: [liquidity, faucet, admin]
 *                 description: Purpose of the wallets
 *               prefix:
 *                 type: string
 *                 description: Optional prefix for the wallet identifier
 *     responses:
 *       201:
 *         description: Wallets generated successfully
 */
router.post('/wallets/generate', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { count = 1, purpose = 'admin', prefix = '' } = req.body;
        
        // Validate count
        if (count < 1 || count > 50) {
            return res.status(400).json({
                error: 'Invalid count. Must be between 1 and 50'
            });
        }
        
        // Create wallets
        const wallets = [];
        
        for (let i = 0; i < count; i++) {
            const identifier = `${purpose}_${prefix}${Date.now()}_${i}`;
            
            // Generate the wallet
            const wallet = await walletGenerationService.generateWallet(identifier, {
                metadata: {
                    purpose,
                    created_by: req.user.wallet_address,
                    created_at: new Date().toISOString()
                }
            });
            
            wallets.push({
                public_key: wallet.publicKey,
                identifier
            });
        }
        
        // Log the action
        logApi.info(`Generated ${count} ${purpose} wallets`, {
            admin: req.user.wallet_address,
            count,
            purpose
        });
        
        return res.status(201).json({
            message: `Generated ${count} wallets successfully`,
            wallets,
            count
        });
    } catch (error) {
        logApi.error('Error generating wallets:', error);
        return res.status(500).json({ error: 'Failed to generate wallets' });
    }
});

/**
 * @swagger
 * /api/superadmin/wallets/{address}:
 *   get:
 *     summary: Get wallet details
 *     tags: [SuperAdmin, Wallets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address
 *     responses:
 *       200:
 *         description: Wallet details
 */
router.get('/wallets/:address', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { address } = req.params;
        
        // Get wallet from database
        const wallet = await prisma.seed_wallets.findUnique({
            where: { wallet_address: address }
        });
        
        if (!wallet) {
            return res.status(404).json({ error: 'Wallet not found' });
        }
        
        // Get balance
        const balance = await connection.getBalance(new PublicKey(address));
        
        // Get recent transactions
        const transactions = await prisma.transactions.findMany({
            where: { wallet_address: address },
            orderBy: { created_at: 'desc' },
            take: 20
        });
        
        return res.json({
            wallet: {
                ...wallet,
                balance: balance / LAMPORTS_PER_SOL,
                balance_raw: balance
            },
            transactions,
            transactions_count: transactions.length
        });
    } catch (error) {
        logApi.error('Error getting wallet details:', error);
        return res.status(500).json({ error: 'Failed to get wallet details' });
    }
});

/**
 * @swagger
 * /api/superadmin/wallets/transfer:
 *   post:
 *     summary: Transfer SOL between wallets
 *     tags: [SuperAdmin, Wallets]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - from
 *               - to
 *               - amount
 *             properties:
 *               from:
 *                 type: string
 *                 description: Source wallet address
 *               to:
 *                 type: string
 *                 description: Destination wallet address
 *               amount:
 *                 type: number
 *                 description: Amount in SOL
 *               description:
 *                 type: string
 *                 description: Optional description
 *     responses:
 *       200:
 *         description: Transfer successful
 */
router.post('/wallets/transfer', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { from, to, amount, description = 'Admin transfer' } = req.body;
        
        // Validate parameters
        if (!from || !to || !amount) {
            return res.status(400).json({
                error: 'Missing required parameters'
            });
        }
        
        if (amount <= 0) {
            return res.status(400).json({
                error: 'Amount must be greater than 0'
            });
        }
        
        // Get source wallet
        const sourceWallet = await prisma.seed_wallets.findUnique({
            where: { wallet_address: from }
        });
        
        if (!sourceWallet) {
            return res.status(404).json({ error: 'Source wallet not found' });
        }
        
        // Execute transfer
        const result = await adminWalletService.transferSOL(
            sourceWallet.wallet_address,
            to,
            amount,
            description,
            {
                adminId: req.user.wallet_address,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            }
        );
        
        return res.json({
            message: 'Transfer successful',
            signature: result.signature,
            from,
            to,
            amount
        });
    } catch (error) {
        logApi.error('Error transferring SOL:', error);
        return res.status(500).json({ 
            error: 'Failed to transfer SOL',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /api/superadmin/wallets/{address}/activate:
 *   post:
 *     summary: Activate or deactivate a wallet
 *     tags: [SuperAdmin, Wallets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - active
 *             properties:
 *               active:
 *                 type: boolean
 *                 description: Whether to activate or deactivate the wallet
 *     responses:
 *       200:
 *         description: Wallet status updated
 */
router.post('/wallets/:address/activate', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { address } = req.params;
        const { active } = req.body;
        
        // Validate parameters
        if (active === undefined) {
            return res.status(400).json({
                error: 'Missing required parameter: active'
            });
        }
        
        // Update wallet
        const wallet = await prisma.seed_wallets.update({
            where: { wallet_address: address },
            data: { 
                is_active: active,
                metadata: {
                    updated_by: req.user.wallet_address,
                    updated_at: new Date().toISOString(),
                    status_change: active ? 'activated' : 'deactivated'
                }
            }
        });
        
        // Log the action
        logApi.info(`${active ? 'Activated' : 'Deactivated'} wallet ${address}`, {
            admin: req.user.wallet_address,
            wallet: address,
            status: active ? 'activated' : 'deactivated'
        });
        
        return res.json({
            message: `Wallet ${active ? 'activated' : 'deactivated'} successfully`,
            wallet
        });
    } catch (error) {
        logApi.error('Error updating wallet status:', error);
        return res.status(500).json({ error: 'Failed to update wallet status' });
    }
});

// ==== DIRECT WALLET TESTING ENDPOINTS ====

/**
 * @swagger
 * /api/superadmin/wallet-test/direct-balance:
 *   get:
 *     summary: Direct test to check wallet balance
 *     tags: [SuperAdmin, Testing]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Wallet address to check (defaults to active liquidity wallet)
 *     responses:
 *       200:
 *         description: Current balance information
 */
router.get('/wallet-test/direct-balance', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { address } = req.query;
        
        // Default to active liquidity wallet if no address provided
        const walletAddress = address || 'DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM';
        
        // Get balance directly from Solana
        const balance = await connection.getBalance(new PublicKey(walletAddress));
        
        // Get wallet from database
        const wallet = await prisma.seed_wallets.findUnique({
            where: { wallet_address: walletAddress }
        });
        
        return res.json({
            wallet_address: walletAddress,
            balance_sol: balance / LAMPORTS_PER_SOL,
            balance_lamports: balance,
            is_in_database: !!wallet,
            wallet_info: wallet || null,
            checked_at: new Date().toISOString()
        });
    } catch (error) {
        logApi.error('Error checking wallet balance:', error);
        return res.status(500).json({ 
            error: 'Failed to check wallet balance',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /api/superadmin/wallet-test/transfer:
 *   post:
 *     summary: Direct test to transfer SOL
 *     tags: [SuperAdmin, Testing]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - from
 *               - to
 *               - amount
 *             properties:
 *               from:
 *                 type: string
 *                 description: Source wallet address
 *               to:
 *                 type: string
 *                 description: Destination wallet address
 *               amount:
 *                 type: number
 *                 description: Amount in SOL
 *     responses:
 *       200:
 *         description: Transfer result
 */
router.post('/wallet-test/transfer', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { from, to, amount } = req.body;
        
        if (!from || !to || !amount) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }
        
        // Get the source wallet
        const sourceWallet = await prisma.seed_wallets.findUnique({
            where: { wallet_address: from }
        });
        
        if (!sourceWallet) {
            return res.status(404).json({ error: 'Source wallet not found in database' });
        }
        
        // Execute transfer using adminWalletService
        try {
            const result = await adminWalletService.transferSOL(
                from,
                to,
                amount,
                'Direct API test transfer',
                {
                    adminId: req.user.wallet_address,
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                }
            );
            
            // Get updated balances
            const fromBalance = await connection.getBalance(new PublicKey(from));
            const toBalance = await connection.getBalance(new PublicKey(to));
            
            return res.json({
                success: true,
                signature: result.signature,
                source: {
                    address: from,
                    balance: fromBalance / LAMPORTS_PER_SOL
                },
                destination: {
                    address: to,
                    balance: toBalance / LAMPORTS_PER_SOL
                },
                amount,
                timestamp: new Date().toISOString()
            });
        } catch (transferError) {
            logApi.error('Transfer failed:', transferError);
            return res.status(500).json({
                error: 'Transfer failed',
                details: transferError.message
            });
        }
    } catch (error) {
        logApi.error('Error processing transfer request:', error);
        return res.status(500).json({ 
            error: 'Failed to process transfer request',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /api/superadmin/wallet-test/mass-check:
 *   post:
 *     summary: Perform mass balance check of all wallets
 *     tags: [SuperAdmin, Testing]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [all, active, liquidity, faucet]
 *         description: Filter which wallets to check
 *     responses:
 *       200:
 *         description: Balance check results
 */
router.post('/wallet-test/mass-check', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { filter = 'all' } = req.query;
        
        // Build where clause based on filter
        const where = {};
        
        if (filter === 'active') {
            where.is_active = true;
        } else if (filter === 'liquidity') {
            where.purpose = 'liquidity';
        } else if (filter === 'faucet') {
            where.purpose = { contains: 'faucet' };
        }
        
        // Get wallets from database
        const wallets = await prisma.seed_wallets.findMany({
            where,
            orderBy: [
                { is_active: 'desc' },
                { created_at: 'desc' }
            ]
        });
        
        // Check balances in parallel
        const results = await Promise.allSettled(
            wallets.map(async (wallet) => {
                try {
                    const balance = await connection.getBalance(new PublicKey(wallet.wallet_address));
                    return {
                        wallet_address: wallet.wallet_address,
                        purpose: wallet.purpose,
                        is_active: wallet.is_active,
                        balance_sol: balance / LAMPORTS_PER_SOL,
                        balance_lamports: balance,
                        check_success: true
                    };
                } catch (error) {
                    return {
                        wallet_address: wallet.wallet_address,
                        purpose: wallet.purpose,
                        is_active: wallet.is_active,
                        check_success: false,
                        error: error.message
                    };
                }
            })
        );
        
        // Process results
        const processedResults = results.map(result => 
            result.status === 'fulfilled' ? result.value : result.reason
        );
        
        // Calculate totals
        const successCount = processedResults.filter(r => r.check_success).length;
        const totalSOL = processedResults.reduce((sum, r) => sum + (r.balance_sol || 0), 0);
        
        return res.json({
            wallets: processedResults,
            summary: {
                total_wallets: wallets.length,
                checked_successfully: successCount,
                failed_checks: wallets.length - successCount,
                total_sol_balance: totalSOL,
                check_time: new Date().toISOString()
            }
        });
    } catch (error) {
        logApi.error('Error during mass balance check:', error);
        return res.status(500).json({ 
            error: 'Failed to perform mass balance check',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /api/superadmin/wallet-test/round-trip:
 *   post:
 *     summary: Perform a round-trip transfer test (send and return funds)
 *     tags: [SuperAdmin, Testing]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               source:
 *                 type: string
 *                 description: Source wallet address (defaults to active liquidity wallet)
 *               destination:
 *                 type: string
 *                 description: Destination wallet address
 *               amount:
 *                 type: number
 *                 description: Amount in SOL (defaults to 0.001)
 *               wait_time:
 *                 type: number
 *                 description: Time to wait between transfers in ms (defaults to 2000)
 *     responses:
 *       200:
 *         description: Round-trip transfer results
 */
router.post('/wallet-test/round-trip', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        // Get active liquidity wallet if no source provided
        const activeWallet = await prisma.seed_wallets.findFirst({
            where: { 
                purpose: 'liquidity',
                is_active: true
            }
        });
        
        if (!activeWallet && !req.body.source) {
            return res.status(400).json({ 
                error: 'No active liquidity wallet found and no source wallet provided' 
            });
        }
        

        /* Use provided values or defaults */

        // Source wallet address
        const source = req.body.source || activeWallet.wallet_address;

        // Destination wallet address
        const { destination } = req.body; // ???

        // Amount of SOL to transfer
        const amount = req.body.amount || TEST_RECOVERY_AMOUNT_PER_WALLET; // SOL (default = 0.00420690 SOL)
        const acceptableLossAmount = ACCEPTABLE_LOSS_AMOUNT_PER_WALLET_DURING_RECOVERY; // SOL (default = 0.0001 SOL)

        // Wait time between transfers
        const waitTime = req.body.wait_time || SECONDS_BETWEEN_TRANSACTIONS_DURING_RECOVERY * 1000; // ms


        /* SOL TRANSFER TESTING */

        // Step 0: Check if destination wallet address is provided
        if (!destination) {
            return res.status(400).json({ error: 'Destination wallet address is required' });
        }
        
        // Step 1: Get initial balances of source and destination wallets
        const initialSourceBalance = await connection.getBalance(new PublicKey(source));
        const initialDestBalance = await connection.getBalance(new PublicKey(destination));
        
        // Step 2: First transfer (source --> destination)
        const outboundTransfer = await adminWalletService.transferSOL(
            source,
            destination,
            amount,
            'Round-trip test - outbound',
            {
                adminId: req.user.wallet_address,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            }
        );
        
        // Step 3: Wait for transaction to confirm
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // Step 4: Get interim balances
        const interimSourceBalance = await connection.getBalance(new PublicKey(source));
        const interimDestBalance = await connection.getBalance(new PublicKey(destination));
        
        // Step 5: Calculate return amount
        //         Keep a very small amount for return transfer fee (default = keep 0.0001 SOL)
        const returnAmount = Math.max(0, (amount - acceptableLossAmount));
        
        // Step 6: Return transfer (destination --> source)
        const inboundTransfer = await adminWalletService.transferSOL(
            destination,
            source,
            returnAmount,
            'Round-trip test - inbound',
            {
                adminId: req.user.wallet_address,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            }
        );
        
        // Step 7: Wait for second transaction to confirm
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // Step 8: Get final balances of source and destination wallets
        const finalSourceBalance = await connection.getBalance(new PublicKey(source));
        const finalDestBalance = await connection.getBalance(new PublicKey(destination));
        
        // Step 9: Calculate balance changes and fees
        const sourceDiff = (finalSourceBalance - initialSourceBalance) / LAMPORTS_PER_SOL;
        const destDiff = (finalDestBalance - initialDestBalance) / LAMPORTS_PER_SOL;
        const totalFees = amount - returnAmount - destDiff;

        // Step 10: Return results
        return res.json({
            success: true,
            source: {
                address: source,
                initial_balance: initialSourceBalance / LAMPORTS_PER_SOL,
                interim_balance: interimSourceBalance / LAMPORTS_PER_SOL,
                final_balance: finalSourceBalance / LAMPORTS_PER_SOL,
                net_change: sourceDiff
            },
            destination: {
                address: destination,
                initial_balance: initialDestBalance / LAMPORTS_PER_SOL,
                interim_balance: interimDestBalance / LAMPORTS_PER_SOL,
                final_balance: finalDestBalance / LAMPORTS_PER_SOL,
                net_change: destDiff
            },
            transfers: {
                outbound: {
                    amount,
                    signature: outboundTransfer.signature
                },
                inbound: {
                    amount: returnAmount,
                    signature: inboundTransfer.signature
                }
            },
            fees: {
                estimated_total: totalFees,
                per_transaction: totalFees / 2
            },
            test_completed_at: new Date().toISOString()
        });
    } catch (error) {
        logApi.error('Error during round-trip test:', error);
        return res.status(500).json({
            error: 'Round-trip test failed',
            details: error.message,
            phase: error.phase || 'unknown'
        });
    }
});

// ==== LOG MANAGEMENT ENDPOINTS ====

// Get available log files (SUPERADMIN ONLY)
router.get('/logs/available', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const files = await fs.readdir(LOG_DIR);
        const logFiles = files.filter(file => file.endsWith('.log'));
        const logFilesWithStats = await Promise.all(
            logFiles.map(async (file) => {
                const stats = await fs.stat(path.join(LOG_DIR, file));
                return {
                    name: file,
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                };
            })
        );
        res.json(logFilesWithStats);
    } catch (error) {
        logApi.error('Error reading log directory:', error);
        res.status(500).json({ 
            error: 'Error reading log directory',
            details: error.message 
        });
    }
});

// Get specific log file content (SUPERADMIN ONLY)
router.get('/logs/:filename', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(LOG_DIR, filename);
        
        // Validate the file path is within LOG_DIR
        const resolvedPath = path.resolve(filePath);
        if (!resolvedPath.startsWith(path.resolve(LOG_DIR))) {
            return res.status(403).json({ 
                error: 'Access denied: Invalid log file path!'
            });
        }

        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({
                error: 'Log file not found'
            });
        }

        const content = await fs.readFile(filePath, 'utf8');
        res.json({ content });
    } catch (error) {
        logApi.error('Error reading log file:', error);
        res.status(500).json({ 
            error: 'Error reading log file',
            details: error.message 
        });
    }
});

// Get contest wallet private key (SUPERADMIN ONLY)
router.get('/contests/:id/wallet', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const contestId = parseInt(req.params.id);
        
        const contestWalletRecord = await prisma.contest_wallets.findUnique({
            where: { contest_id: contestId }
        });

        if (!contestWalletRecord || !contestWalletRecord.private_key) {
            return res.status(404).json({ error: 'Contest wallet not found or has no private key stored.' });
        }

        // Use ContestWalletService.decryptPrivateKey, which returns the 32-byte seed Buffer
        const decryptedSeedBuffer = ContestWalletService.decryptPrivateKey(contestWalletRecord.private_key);
        
        if (!(decryptedSeedBuffer instanceof Buffer) || decryptedSeedBuffer.length !== 32) {
            // This case should ideally be caught by decryptPrivateKey itself if format is wrong
            logApi.error('Decryption by ContestWalletService did not yield a 32-byte Buffer seed.', { contestId });
            throw new Error('Failed to obtain valid 32-byte seed after decryption.');
        }
        
        res.json({
            contest_id: contestId,
            wallet_address: contestWalletRecord.wallet_address,
            private_seed_base58: bs58.encode(decryptedSeedBuffer),
            private_seed_hex: decryptedSeedBuffer.toString('hex'),
            key_format_info: "Decrypted 32-byte private seed."
        });
    } catch (error) {
        logApi.error('Error getting contest wallet private seed:', {
            contestId: req.params.id, 
            error: error.message,
            stack: error.stack?.substring(0, 300)
        });
        const statusCode = error.code === 'DECRYPTION_ERROR_JSON_PARSE' || error.code === 'DECRYPTION_ERROR_UNRECOGNIZED' ? 400 : 500;
        res.status(statusCode).json({ 
            error: 'Failed to get contest wallet private seed',
            details: error.message 
        });
    }
});

// Novelty generate-tree endpoint (SUPERADMIN ONLY)
router.post('/generate-tree', requireAuth, requireSuperAdmin, (req, res) => {
    exec('/home/websites/degenduel/scripts/tree.sh', (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.json({ 
            message: 'Project tree generated successfully',
            output: stdout,
            timestamp: new Date().toISOString()
        });
    });
});

// Phase definitions with rollback support
const phaseDefinitions = {
    'clear': {
        dependencies: [],
        seed: async () => {
            await prisma.$transaction([
                prisma.transactions.deleteMany(),
                prisma.contest_participants.deleteMany(),
                prisma.contest_portfolios.deleteMany(),
                prisma.contest_token_performance.deleteMany(),
                prisma.contest_token_prices.deleteMany(),
                prisma.contest_wallets.deleteMany(),
                prisma.contests.deleteMany(),
                prisma.user_stats.deleteMany({
                    where: {
                        user: {
                            role: { not: 'superadmin' }
                        }
                    }
                }),
                prisma.users.deleteMany({
                    where: {
                        role: { not: 'superadmin' }
                    }
                }),
                prisma.tokens.deleteMany(),
                prisma.token_buckets.deleteMany(),
                prisma.achievement_tier_requirements.deleteMany(),
                prisma.achievement_tiers.deleteMany(),
                prisma.achievement_categories.deleteMany(),
                prisma.user_levels.deleteMany()
            ]);
            return 'Database cleared successfully (preserved superadmin account)';
        },
        rollback: async () => {
            // No rollback for clear - it's already deleted
            return 'Clear phase cannot be rolled back';
        }
    },
    'tokens': {
        dependencies: ['clear'],
        seed: async () => {
            const { seedTokens } = await import('../prisma/seeds/01_tokens.js');
            await seedTokens();
            return 'Tokens seeded successfully';
        },
        rollback: async () => {
            await prisma.$transaction([
                prisma.token_prices.deleteMany(),
                prisma.token_bucket_memberships.deleteMany(),
                prisma.tokens.deleteMany(),
                prisma.token_buckets.deleteMany()
            ]);
            return 'Tokens rolled back successfully';
        }
    },
    'achievements': {
        dependencies: ['clear'],
        seed: async () => {
            const { seedAchievements } = await import('../prisma/seeds/05_achievements.js');
            await seedAchievements();
            return 'Achievements seeded successfully';
        },
        rollback: async () => {
            await prisma.$transaction([
                prisma.achievement_tier_requirements.deleteMany(),
                prisma.achievement_tiers.deleteMany(),
                prisma.achievement_categories.deleteMany()
            ]);
            return 'Achievements rolled back successfully';
        }
    },
    'user_levels': {
        dependencies: ['clear'],
        seed: async () => {
            const { seedUserLevels } = await import('../prisma/seeds/06_user_levels.js');
            await seedUserLevels();
            return 'User levels seeded successfully';
        },
        rollback: async () => {
            await prisma.$transaction([
                prisma.level_rewards.deleteMany(),
                prisma.user_levels.deleteMany()
            ]);
            return 'User levels rolled back successfully';
        }
    },
    'users': {
        dependencies: ['clear', 'user_levels'],
        seed: async () => {
            const { seedUsers } = await import('../prisma/seeds/02_users.js');
            await seedUsers();
            return 'Users seeded successfully';
        },
        rollback: async () => {
            await prisma.$transaction([
                prisma.user_stats.deleteMany(),
                prisma.users.deleteMany()
            ]);
            return 'Users rolled back successfully';
        }
    },
    'contests': {
        dependencies: ['clear', 'tokens', 'users'],
        seed: async () => {
            const { seedContests } = await import('../prisma/seeds/03_contests.js');
            await seedContests();
            return 'Contests seeded successfully';
        },
        rollback: async () => {
            await prisma.$transaction([
                prisma.contest_wallets.deleteMany(),
                prisma.contests.deleteMany()
            ]);
            return 'Contests rolled back successfully';
        }
    },
    'participants': {
        dependencies: ['contests', 'users'],
        seed: async () => {
            const { seedContestParticipants } = await import('../prisma/seeds/07_contest_participants.js');
            await seedContestParticipants();
            return 'Contest participants seeded successfully';
        },
        rollback: async () => {
            await prisma.$transaction([
                prisma.contest_participants.deleteMany()
            ]);
            return 'Contest participants rolled back successfully';
        }
    },
    'portfolios': {
        dependencies: ['contests', 'participants', 'tokens'],
        seed: async () => {
            const { seedPortfolios } = await import('../prisma/seeds/04_portfolios.js');
            await seedPortfolios();
            return 'Portfolios seeded successfully';
        },
        rollback: async () => {
            await prisma.$transaction([
                prisma.contest_token_performance.deleteMany(),
                prisma.contest_token_prices.deleteMany(),
                prisma.contest_portfolios.deleteMany()
            ]);
            return 'Portfolios rolled back successfully';
        }
    }
};

// Get current seeding phase status
router.get('/reseed-status', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const status = await prisma.system_settings.findUnique({
            where: { key: 'reseed_status' }
        });

        return res.json({
            current_phase: status?.value?.current_phase || 'not_started',
            phases_completed: status?.value?.phases_completed || [],
            last_updated: status?.updated_at || null,
            available_phases: Object.keys(phaseDefinitions),
            phase_dependencies: Object.fromEntries(
                Object.entries(phaseDefinitions).map(([phase, def]) => [phase, def.dependencies])
            )
        });
    } catch (error) {
        logApi.error('Error getting reseed status:', error);
        return res.status(500).json({ error: 'Failed to get reseed status' });
    }
});

// Rollback a specific phase
router.post('/reseed-rollback/:phase', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { phase } = req.params;
        
        if (!phaseDefinitions[phase]) {
            return res.status(400).json({
                error: 'Invalid phase',
                available_phases: Object.keys(phaseDefinitions)
            });
        }

        // Check if any other phases depend on this one
        const dependentPhases = Object.entries(phaseDefinitions)
            .filter(([_, def]) => def.dependencies.includes(phase))
            .map(([p]) => p);

        if (dependentPhases.length > 0) {
            return res.status(400).json({
                error: 'Cannot rollback phase with dependencies',
                dependent_phases: dependentPhases,
                message: 'You must first rollback the dependent phases'
            });
        }

        // Update status before starting rollback
        await prisma.system_settings.upsert({
            where: { key: 'reseed_status' },
            update: {
                value: {
                    current_phase: `rolling_back_${phase}`,
                    in_progress: true
                },
                updated_at: new Date()
            },
            create: {
                key: 'reseed_status',
                value: {
                    current_phase: `rolling_back_${phase}`,
                    in_progress: true
                },
                updated_at: new Date()
            }
        });

        // Execute the rollback
        const message = await phaseDefinitions[phase].rollback();

        // Update status after completion
        const status = await prisma.system_settings.findUnique({
            where: { key: 'reseed_status' }
        });

        const completedPhases = status?.value?.phases_completed || [];
        const updatedPhases = completedPhases.filter(p => p !== phase);

        await prisma.system_settings.update({
            where: { key: 'reseed_status' },
            data: {
                value: {
                    current_phase: 'completed',
                    phases_completed: updatedPhases,
                    in_progress: false
                },
                updated_at: new Date()
            }
        });

        logApi.info(`Database phase ${phase} rolled back`, {
            admin: req.user.wallet_address,
            phase
        });

        return res.json({
            message,
            phase,
            status: 'rolled_back'
        });

    } catch (error) {
        logApi.error(`Error rolling back phase ${req.params.phase}:`, {
            error: error.message,
            admin: req.user?.wallet_address
        });
        return res.status(500).json({
            error: `Failed to rollback phase ${req.params.phase}`,
            details: error.message
        });
    }
});

// Start or continue reseeding process with specific phase
router.post('/reseed-database/:phase', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { phase } = req.params;
        
        if (!phaseDefinitions[phase]) {
            return res.status(400).json({
                error: 'Invalid phase',
                available_phases: Object.keys(phaseDefinitions)
            });
        }

        // Check dependencies
        const status = await prisma.system_settings.findUnique({
            where: { key: 'reseed_status' }
        });
        const completedPhases = status?.value?.phases_completed || [];
        const missingDependencies = phaseDefinitions[phase].dependencies.filter(
            dep => !completedPhases.includes(dep)
        );

        if (missingDependencies.length > 0) {
            return res.status(400).json({
                error: 'Missing dependencies',
                missing: missingDependencies,
                message: 'Please complete these phases first'
            });
        }

        // Update status before starting
        await prisma.system_settings.upsert({
            where: { key: 'reseed_status' },
            update: {
                value: {
                    current_phase: phase,
                    phases_completed: completedPhases,
                    in_progress: true
                },
                updated_at: new Date()
            },
            create: {
                key: 'reseed_status',
                value: {
                    current_phase: phase,
                    phases_completed: completedPhases,
                    in_progress: true
                },
                updated_at: new Date()
            }
        });

        // Execute the phase
        const message = await phaseDefinitions[phase].seed();

        // Update status after completion
        await prisma.system_settings.update({
            where: { key: 'reseed_status' },
            data: {
                value: {
                    current_phase: 'completed',
                    phases_completed: [...completedPhases, phase],
                    in_progress: false
                },
                updated_at: new Date()
            }
        });

        logApi.info(`Database phase ${phase} completed`, {
            admin: req.user.wallet_address,
            phase
        });

        return res.json({
            message,
            phase,
            status: 'completed'
        });

    } catch (error) {
        logApi.error(`Error in reseed phase ${req.params.phase}:`, {
            error: error.message,
            admin: req.user?.wallet_address
        });
        return res.status(500).json({
            error: `Failed to execute phase ${req.params.phase}`,
            details: error.message
        });
    }
});

// Get liquidity balance (SUPERADMIN ONLY)
router.get('/liquidity/balance', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const balance = await LiquidityManager.checkBalance();
        res.json({ 
            balance,
            config: LiquidityManager.config
        });
    } catch (error) {
        logApi.error('Error checking liquidity balance:', error);
        res.status(500).json({ 
            error: 'Failed to check liquidity balance',
            details: error.message 
        });
    }
});

// Configure liquidity settings (SUPERADMIN ONLY)
router.post('/liquidity/config', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { defaultAmount, minLiquidityBalance, maxTestUsers } = req.body;
        LiquidityManager.setConfig({
            defaultAmount: parseFloat(defaultAmount),
            minLiquidityBalance: parseFloat(minLiquidityBalance),
            maxTestUsers: parseInt(maxTestUsers)
        });
        res.json({ 
            message: 'Liquidity configuration updated',
            config: LiquidityManager.config
        });
    } catch (error) {
        logApi.error('Error updating Liquidity config:', error);
        res.status(500).json({ 
            error: 'Failed to update Liquidity configuration',
            details: error.message 
        });
    }
});

// Recover SOL from test wallets (SUPERADMIN ONLY)
router.post('/liquidity/recover', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        await LiquidityManager.recoverFromTestWallets();
        res.json({ 
            message: 'Recovery process completed successfully'
        });
    } catch (error) {
        logApi.error('Error recovering from test wallets:', error);
        res.status(500).json({ 
            error: 'Failed to recover from test wallets',
            details: error.message 
        });
    }
});

// Nuclear recover SOL from ALL wallets - leaves minimal balance (SUPERADMIN ONLY)
router.post('/liquidity/recover-nuclear', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        // Filter wallets to only "test user" wallets
        const createdWithinLastDays = 90; // created within the last 90 days
        const testUserNamePrefix = 'Test User'; // and whose nickname starts with prefix

        // Withdraw SOL from test users      
        const testUsers = await prisma.users.findMany({
            where: {
                created_at: {
                    gte: new Date(Date.now() - createdWithinLastDays * (24 * 60 * 60 * 1000))
                },
                nickname: {
                    startsWith: testUserNamePrefix
                }
            },
            select: {
                id: true,
                wallet_address: true
            }
        });

        // Get the master liquidity wallet from LiquidityManager configuration
        const liquidityWallet = await LiquidityManager.getLiquidityWallet();
        if (!liquidityWallet) {
            throw new Error('Failed to get test liquidity wallet');
        }

        // Recover SOL from test users
        let totalRecovered = 0;
        for (const user of testUsers) {
            try {
                // Get balance of test user
                const balance = await connection.getBalance(new PublicKey(user.wallet_address));

                // Skip this wallet if balance is 0
                if (balance <= 0) continue; // TODO: Build in the configured buffer amount

                // Convert lamports to Solana
                const balanceSOL = balance / LAMPORTS_PER_SOL;

                // Get this wallet's private key
                const walletInfo = await WalletGenerator.getWallet(`test-user-${user.id}`);
                if (!walletInfo) {
                    console.warn(`No private key found for ${user.wallet_address}, skipping...`);
                    continue;
                }

                // Get this wallet's complete keypair from its private key
                const userKeypair = Keypair.fromSecretKey(bs58.decode(walletInfo.secretKey));
                
                // Calculate minimum SOL to leave in each wallet before recovery
                const leaveInWalletAmountLamports = ABSOLUTE_MINIMUM_SOL_TO_LEAVE_IN_EACH_WALLET_DURING_RECOVERY * LAMPORTS_PER_SOL;
                const recoveryAmountLamports = balance - leaveInWalletAmountLamports;
                
                // Skip this wallet if there's nothing to recover
                if (recoveryAmountLamports <= 0) continue;

                // Convert recovery amount to SOL
                const recoveryAmountSOL = recoveryAmountLamports / LAMPORTS_PER_SOL;

                // Import the transferSOL function dynamically to avoid circular dependencies
                const { transferSOL } = await import('../utils/solana-suite/web3-v2/solana-transaction-v2.js');
                
                // Use the new v2 transaction utility
                const { signature } = await transferSOL(
                    connection,
                    userKeypair,
                    liquidityWallet.publicKey,
                    recoveryAmountSOL // in SOL
                );

                // Update total recovered amount
                totalRecovered += recoveryAmountSOL;

                // Log the recovery transaction
                console.log(`Recovered ${recoveryAmountSOL} SOL from ${user.wallet_address}`);

                // Create a transaction record in the 'transactions' table
                await prisma.transactions.create({
                    data: {
                        wallet_address: user.wallet_address,
                        type: 'WITHDRAWAL',
                        amount: recoveryAmountSOL,
                        balance_before: balanceSOL,
                        balance_after: balanceAfterSOL,
                        status: 'completed',
                        metadata: {
                            blockchain_signature: signature
                        },
                        description: 'Nuclear test wallet SOL recovery',
                        processed_at: new Date()
                    }
                });

            } catch (error) {
                console.error(`Failed to recover SOL from ${user.wallet_address}:`, error);
            }
        }

        await LiquidityManager.checkBalance();
        res.json({ 
            message: 'Nuclear recovery process completed successfully',
            totalRecovered
        });
    } catch (error) {
        logApi.error('Error performing nuclear recovery:', error);
        res.status(500).json({ 
            error: 'Failed to perform nuclear recovery',
            details: error.message 
        });
    }
});

// Valid v69 websocket service names
const VALID_WEBSOCKET_SERVICES = [
    'analytics',
    'base', // ???
    'circuit-breaker',
    'contest',
    'market',
    'monitor',
    'wallet',
    'portfolio'
];

// Start a v69 websocket service (e.g. contest, market, monitor, wallet, portfolio, ...)
router.post('/websocket/:serviceId/start', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { serviceId } = req.params;
        
        if (!VALID_WEBSOCKET_SERVICES.includes(serviceId)) {
            return res.status(400).json({
                success: false,
                message: `Invalid service ID. Must be one of: ${VALID_WEBSOCKET_SERVICES.join(', ')}`
            });
        }

        const wsFile = `${serviceId}-ws.js`;
        const wsPath = path.join(process.cwd(), 'websocket', wsFile);

        // Check if service file exists
        try {
            await fs.access(wsPath);
        } catch (err) {
            return res.status(404).json({
                success: false,
                message: `WebSocket service file not found: ${wsFile}`
            });
        }

        // Start the service with admin context
        await serviceManager.startService(wsFile, {
            adminAddress: req.user.wallet_address,
            ip: req.ip,
            userAgent: req.get('user-agent')
        });

        // Get current state after starting
        const state = await serviceManager.getServiceState(wsFile);

        res.json({
            success: true,
            message: `${serviceId} WebSocket service started successfully`,
            state: {
                running: state?.running || true,
                status: state?.status || 'active',
                lastStarted: state?.last_started || new Date().toISOString()
            }
        });
    } catch (error) {
        logApi.error(`Error starting WebSocket service: ${error.message}`);
        res.status(500).json({
            success: false,
            message: `Failed to start service: ${error.message}`
        });
    }
});

// Stop a v69 websocket service (e.g. contest, market, monitor, wallet, portfolio, ...)
router.post('/websocket/:serviceId/stop', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { serviceId } = req.params;
        
        if (!VALID_WEBSOCKET_SERVICES.includes(serviceId)) {
            return res.status(400).json({
                success: false,
                message: `Invalid service ID. Must be one of: ${VALID_WEBSOCKET_SERVICES.join(', ')}`
            });
        }

        const wsFile = `${serviceId}-ws.js`;
        
        // Stop the service with admin context
        await serviceManager.stopService(wsFile, {
            adminAddress: req.user.wallet_address,
            ip: req.ip,
            userAgent: req.get('user-agent')
        });

        // Get current state after stopping
        const state = await serviceManager.getServiceState(wsFile);

        res.json({
            success: true,
            message: `${serviceId} WebSocket service stopped successfully`,
            state: {
                running: state?.running || false,
                status: state?.status || 'stopped',
                lastStopped: state?.last_stopped || new Date().toISOString()
            }
        });
    } catch (error) {
        logApi.error(`Error stopping WebSocket service: ${error.message}`);
        res.status(500).json({
            success: false,
            message: `Failed to stop service: ${error.message}`
        });
    }
});

// Restart a v69 websocket service (e.g. contest, market, monitor, wallet, portfolio, ...)
router.post('/websocket/:serviceId/restart', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { serviceId } = req.params;
        
        if (!VALID_WEBSOCKET_SERVICES.includes(serviceId)) {
            return res.status(400).json({
                success: false,
                message: `Invalid service ID. Must be one of: ${VALID_WEBSOCKET_SERVICES.join(', ')}`
            });
        }

        const wsFile = `${serviceId}-ws.js`;
        
        // Restart the service with admin context
        await serviceManager.restartService(wsFile, {
            adminAddress: req.user.wallet_address,
            ip: req.ip,
            userAgent: req.get('user-agent')
        });

        // Get current state after restarting
        const state = await serviceManager.getServiceState(wsFile);

        res.json({
            success: true,
            message: `${serviceId} WebSocket service restarted successfully`,
            state: {
                running: state?.running || true,
                status: state?.status || 'active',
                lastStarted: state?.last_started || new Date().toISOString(),
                lastStopped: state?.last_stopped
            }
        });
    } catch (error) {
        logApi.error(`Error restarting WebSocket service: ${error.message}`);
        res.status(500).json({
            success: false,
            message: `Failed to restart service: ${error.message}`
        });
    }
});

// [OLD(?)] Get all service states
router.get('/services/states', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const serviceStates = await prisma.system_settings.findMany({
            where: {
                key: {
                    in: [
                        'contest_evaluation_service',
                        'token_sync_service',
                        'admin_wallet_service',
                        'contest_wallet_service',
                        'wallet_rake_service',
                        'balance_sync_service',
                        'notification_service'
                    ]
                }
            }
        });

        // Format response with default values if service not found
        const formattedStates = {
            contest_evaluation_service: { enabled: false },
            token_sync_service: { enabled: true },
            admin_wallet_service: { enabled: true },
            contest_wallet_service: { enabled: true },
            wallet_rake_service: { enabled: true },
            balance_sync_service: { enabled: true },
            notification_service: { enabled: true }
        };

        serviceStates.forEach(service => {
            try {
                const value = typeof service.value === 'string' 
                    ? JSON.parse(service.value)
                    : service.value;
                formattedStates[service.key] = value;
            } catch (e) {
                logApi.error(`Failed to parse service state for ${service.key}:`, e);
            }
        });

        res.json({ success: true, services: formattedStates });
    } catch (error) {
        logApi.error('Failed to get service states:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// [OLD(?)] Service state management
router.post('/services/:serviceName/toggle', requireAuth, requireSuperAdmin, async (req, res) => {
    const { serviceName } = req.params;
    const adminName = req.user.nickname || req.user.username || 'Admin';

    try {
        logApi.info(`🎮 Service toggle requested`, {
            service: serviceName,
            admin: adminName,
            wallet: req.user.wallet_address,
            timestamp: new Date().toISOString()
        });

        // 1. Get service from ServiceManager
        const service = serviceManager.services.get(serviceName);
        if (!service) {
            logApi.warn(`Service not found: ${serviceName}`, {
                admin: adminName,
                service: serviceName
            });
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        // 2. Get current state
        const currentState = await serviceManager.getServiceState(serviceName);
        const newEnabled = !currentState?.running;

        // 3. Update system_settings first
        const systemState = {
            enabled: newEnabled,
            updated_by: req.user.wallet_address,
            last_enabled: newEnabled ? new Date().toISOString() : currentState?.last_enabled,
            last_disabled: !newEnabled ? new Date().toISOString() : currentState?.last_disabled,
            status: newEnabled ? 'active' : 'stopped'
        };

        await prisma.system_settings.upsert({
            where: { key: serviceName },
            create: {
                key: serviceName,
                value: systemState,
                description: `${serviceName} state and configuration`
            },
            update: {
                value: systemState
            }
        });

        // 4. Toggle service state
        try {
            if (newEnabled) {
                await service.start();
                logApi.info(`🟩 🟩 🟩 ${chalk.green('Service started')}`, {
                    service: serviceName,
                    admin: adminName,
                    timestamp: new Date().toISOString()
                });
            } else {
                await service.stop();
                logApi.info(`🟥 🟥 🟥 ${chalk.red('Service stopped')}`, {
                    service: serviceName,
                    admin: adminName,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            // Log service operation failure but continue to get final state
            logApi.error(`Failed to ${newEnabled ? 'start' : 'stop'} service: ${chalk.red(error.message)}`, {
                service: serviceName,
                admin: adminName,
                error: error.message
            });
        }

        // 5. Get final state after operation
        const finalState = await serviceManager.getServiceState(serviceName);
        
        // 6. Broadcast state via WebSocket
        if (global.wss?.broadcastServiceState) {
            await global.wss.broadcastServiceState(serviceName, {
                ...finalState,
                ...systemState
            });
            logApi.info(`📡 Service state broadcast`, {
                service: serviceName,
                state: finalState.status
            });
        }

        // 7. Return complete state
        res.json({
            success: true,
            service: serviceName,
            state: {
                ...finalState,
                ...systemState
            }
        });

    } catch (error) {
        logApi.error(`Service toggle failed`, {
            service: serviceName,
            admin: adminName,
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            error: 'Failed to toggle service',
            details: config.g === 'development' ? error.message : undefined
        });
    }
});

// ------------------------------------------------------------

// Add the wallet-monitoring routes to the superadmin router
router.use('/wallet-monitoring', walletMonitoringRouter);
export default router;