// /routes/prisma/balance.js - Centralized logging for DegenDuel backend services.
import { Prisma, PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { Router } from 'express';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js'; // New DD Logging System
dotenv.config()

const router = Router();
const prisma = new PrismaClient();

// Superadmin wallet address
const SUPERADMIN_WALLET_ADDRESS = process.env.SUPERADMIN_WALLET_ADDRESS; // TODO: Move to config/constants.js
// Admin wallet addresses
const ADMIN_WALLET_ADDRESSES = process.env.ADMIN_WALLET_ADDRESSES; // TODO: Move to config/constants.js


/**
 * @swagger
 * tags:
 *   name: Balance
 *   description: User point balance endpoints
 */

/* Points Balance Routes */

/**
 * @swagger
 * /api/balance/{wallet}:
 *   get:
 *     summary: Get user's balance
 *     tags: [Balance]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     responses:
 *       200:
 *         description: User's balance information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 balance:
 *                   type: string
 *                   description: User's balance in base units
 *                 formatted_balance:
 *                   type: string
 *                   description: User's balance formatted in USDC
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "User not found"
 */
// Get a user's point balance by wallet address (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/balance/{wallet}
//      headers: { "Cookie": "session=<jwt>" }
router.get('/:wallet', async (req, res) => {
  const { wallet } = req.params;

  logApi.info('Fetching user balance', { 
    wallet_address: wallet,
    path: req.path,
    method: req.method 
  });

  try {
    const user = await prisma.users.findUnique({
      where: { wallet_address: wallet }
    });

    if (!user) {
      logApi.warn('User not found', { 
        wallet_address: wallet,
        path: req.path,
        method: req.method 
      });
      return res.status(404).json({ error: 'User not found' });
    }

    const balance = new Prisma.Decimal(user.balance || '0');
    const exactUSDC = balance.dividedBy(1000000);
    const formattedBalance = exactUSDC.toFixed(2);

    logApi.info('Balance fetched successfully', {
      wallet_address: wallet,
      balance: balance.toString(),
      exact_usdc: exactUSDC.toString()
    });

    res.json({
      balance: balance.toString(),
      exact_usdc: exactUSDC.toString(),
      formatted_balance: `${formattedBalance} USDC`,
      decimals: 6
    });

  } catch (error) {
    logApi.error('Failed to fetch balance', {
      error: {
        name: error.name,
        message: error.message,
        code: error?.code
      },
      wallet_address: wallet,
      path: req.path,
      method: req.method
    });

    res.status(500).json({
      error: 'Failed to fetch user balance',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /api/balance/{wallet}/balance:
 *   post:
 *     summary: Adjust user's balance (Admin only)
 *     tags: [Balance]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Amount to adjust (positive for increase, negative for decrease)
 *                 example: 1000000
 *     responses:
 *       200:
 *         description: Balance adjusted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 previous_balance:
 *                   type: string
 *                   example: "1000000"
 *                 new_balance:
 *                   type: string
 *                   example: "2000000"
 *                 adjustment:
 *                   type: string
 *                   example: "1000000"
 *       404:
 *         description: User not found
 *       403:
 *         description: Not authorized
 */
// Increment/decrement a user's point balance by wallet address (SUPERADMIN ONLY)
//   example: POST https://degenduel.me/api/balance/{wallet}/balance
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "amount": 100 }
router.post('/:wallet/balance', requireAuth, requireSuperAdmin, async (req, res) => {
  const { wallet } = req.params;
  const { amount } = req.body;
  const adminAddress = req.headers['x-admin-address'];

  // Add validation logging
  if (!adminAddress) {
    logApi.warn('Unauthorized balance adjustment attempt by non-admin', {
      wallet_address: wallet,
      ip_address: req.ip
    });
    return res.status(403).json({ error: 'Admin authorization required' });
  }

  if (!amount || isNaN(amount)) {
      logApi.warn('Invalid amount in balance adjustment request', {
      wallet_address: wallet,
      admin_address: adminAddress,
      invalid_amount: amount,
      path: req.path,
      method: req.method
    });
    return res.status(400).json({ error: 'Valid amount required' });
  }

  logApi.info('Adjusting user balance', {
    wallet_address: wallet,
    adjustment_amount: amount,
    request: {
      path: req.path,
      method: req.method,
      ip: req.ip,
      headers: req.headers
    }
  });

  try {
    const result = await prisma.$transaction(async (prisma) => {
      const user = await prisma.users.findUnique({
        where: { wallet_address: wallet }
      });

      if (!user) {
        logApi.warn('Balance adjustment failed - User not found', {
          wallet_address: wallet,
          path: req.path,
          method: req.method
        });
        throw new Error('User not found');
      }

      const previousBalance = new Prisma.Decimal(user.balance || '0');
      const adjustment = new Prisma.Decimal(amount);
      const newBalance = previousBalance.plus(adjustment);

      if (newBalance.lessThan(0)) {
        logApi.warn('Balance adjustment failed - Insufficient funds', {
          wallet_address: wallet,
          previous_balance: previousBalance.toString(),
          attempted_adjustment: adjustment.toString(),
          path: req.path,
          method: req.method
        });
        throw new Error('Insufficient balance for deduction');
      }

      // Update the user's balance
      const updatedUser = await prisma.users.update({
        where: { wallet_address: wallet },
        data: { 
          balance: newBalance.toString(),
          updated_at: new Date()
        }
      });
      logApi.info('Balance adjusted successfully', {
        wallet_address: wallet,
        previous_balance: previousBalance.toString(),
        adjustment: adjustment.toString(),
        new_balance: newBalance.toString()
      });

      // Log the transaction
      await prisma.admin_logs.create({
        data: {
          admin_address: req.headers['x-admin-address'] || 'SYSTEM',
          action: 'ADJUST_BALANCE',
          details: {
            wallet_address: wallet,
            previous_balance: previousBalance.toString(),
            adjustment: adjustment.toString(),
            new_balance: newBalance.toString()
          },
          ip_address: req.ip
        }
      });

      logApi.info('Balance adjusted successfully', {
        wallet_address: wallet,
        previous_balance: previousBalance.toString(),
        adjustment: adjustment.toString(),
        new_balance: newBalance.toString(),
        admin_address: req.headers['x-admin-address']
      });

      return {
        previous_balance: previousBalance.toString(),
        new_balance: newBalance.toString(),
        adjustment: adjustment.toString()
      };
    });

    res.json(result);

  } catch (error) {
    logApi.error('Balance adjustment failed', {
      error: {
        name: error.name,
        message: error.message,
        code: error?.code
      },
      wallet_address: wallet,
      attempted_adjustment: amount,
      path: req.path,
      method: req.method
    });

    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }

    if (error.message === 'Insufficient balance for deduction') {
      return res.status(400).json({ error: 'Insufficient balance for deduction' });
    }

    res.status(500).json({
      error: 'Failed to adjust balance',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// -----------------------------------------------------------

/**
 * @swagger
 * /api/daddy:
 *   get:
 *     summary: Query superadmin users by wallet address
 *     description: Retrieves a list of superadmins from the database using a predefined wallet address.
 *     tags:
 *       - Superadmin
 *     responses:
 *       200:
 *         description: A list of superadmins with the specified wallet address.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     description: User ID
 *                     example: 1
 *                   wallet_address:
 *                     type: string
 *                     description: Wallet address of the user
 *                     example: "0x123456789abcdef"
 *                   username:
 *                     type: string
 *                     description: Username of the user
 *                     example: "admin"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message
 *                   example: "An error occurred while querying the database."
 */
// Query superadmin users by wallet address (SUPERADMIN ONLY)
//   example: GET https://degenduel.me/api/daddy
//      headers: { "Cookie": "session=<jwt>" }  
router.get('/', requireAuth, requireSuperAdmin, async (req, res) => {
  console.log('>>>query received>>> | by wallet address:', SUPERADMIN_WALLET_ADDRESS);
  
  try {
    // Query Prisma for users with the specified wallet address
    const superadmins = await prisma.users.findMany({
      where: {
        wallet_address: SUPERADMIN_WALLET_ADDRESS,
      },
    });
    console.log('<<<query response<<< | daddy detected:    ', superadmins);
    // Send the response
    res.json(superadmins);
  } catch (error) {
    console.error('Error querying Prisma:', error);
    res.status(500).json({ error: 'An error occurred while querying the database.' });
  }
});

/**
 * @swagger
 * /api/daddy/mommy:
 *   get:
 *     summary: Sample endpoint to demonstrate Swagger documentation
 *     description: Returns a simple text response for the /mommy endpoint.
 *     tags:
 *       - Sample
 *     responses:
 *       200:
 *         description: Successful response with a text message.
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: "This is /api/daddy/mommy"
 */
// Sample endpoint to demonstrate Swagger documentation (ADMIN ONLY)
//   example: GET https://degenduel.me/api/daddy/mommy
//      headers: { "Cookie": "session=<jwt>" }
router.get('/mommy', requireAuth, requireAdmin, (req, res) => {
  res.send('This is /api/daddy/mommy');
});

export default router;