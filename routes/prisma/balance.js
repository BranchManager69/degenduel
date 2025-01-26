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
 * 
 * components:
 *   securitySchemes:
 *     sessionAuth:
 *       type: http
 *       scheme: cookie
 *       bearerFormat: JWT
 *       description: Session cookie containing JWT for authentication
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
 *                   description: User's balance formatted in SOL
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
    const exactSOL = balance.dividedBy(1000000000);  // 9 decimals for lamports to SOL
    const formattedBalance = exactSOL.toFixed(2);

    logApi.info('Balance fetched successfully', {
      wallet_address: wallet,
      balance: balance.toString(),
      exact_sol: exactSOL.toString()
    });

    res.json({
      balance: balance.toString(),
      exact_sol: exactSOL.toString(),
      formatted_balance: `${formattedBalance} SOL`,
      decimals: 9
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
      error: 'Failed to process balance operation',
      message: req.environment === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /api/balance/{wallet}/balance:
 *   post:
 *     summary: Adjust user's balance (requires superadmin role)
 *     tags: [Balance]
 *     security:
 *       - sessionAuth: []
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
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Not authenticated"
 *       403:
 *         description: Not authorized (requires superadmin role)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Not authorized"
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
// Increment/decrement a user's point balance by wallet address (SUPERADMIN ONLY)
//   example: POST https://degenduel.me/api/balance/{wallet}/balance
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "amount": 100 }
router.post('/:wallet/balance', requireAuth, requireSuperAdmin, async (req, res) => {
  const { wallet } = req.params;
  const { amount } = req.body;
  
  // Validate amount
  if (!amount || isNaN(amount)) {
    logApi.warn('Invalid amount in balance adjustment request', {
      wallet_address: wallet,
      invalid_amount: amount,
      path: req.path,
      method: req.method
    });
    return res.status(400).json({ error: 'Invalid amount provided' });
  }

  try {
    // Get user's current balance
    const user = await prisma.users.findUnique({
      where: { wallet_address: wallet }
    });

    if (!user) {
      logApi.warn('User not found for balance adjustment', {
        wallet_address: wallet,
        path: req.path,
        method: req.method
      });
      return res.status(404).json({ error: 'User not found' });
    }

    const previousBalance = new Prisma.Decimal(user.balance || '0');
    const adjustment = new Prisma.Decimal(amount);
    const newBalance = previousBalance.plus(adjustment);

    // Prevent negative balance
    if (newBalance.lessThan(0)) {
      logApi.warn('Insufficient balance for deduction', {
        wallet_address: wallet,
        current_balance: previousBalance.toString(),
        requested_deduction: adjustment.toString(),
        path: req.path,
        method: req.method
      });
      return res.status(400).json({ error: 'Insufficient balance for deduction' });
    }

    // Update balance and log the adjustment in a transaction
    const result = await prisma.$transaction(async (prisma) => {
      // Update user balance
      await prisma.users.update({
        where: { wallet_address: wallet },
        data: {
          balance: newBalance.toString(),
          updated_at: new Date()
        }
      });

      // Log the adjustment
      await prisma.admin_logs.create({
        data: {
          admin_address: req.user.wallet_address, // Use authenticated user from session
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

      return {
        previous_balance: previousBalance.toString(),
        new_balance: newBalance.toString(),
        adjustment: adjustment.toString()
      };
    });

    logApi.info('Successfully adjusted balance', {
      wallet_address: wallet,
      admin_address: req.user.wallet_address,
      ...result,
      path: req.path,
      method: req.method
    });

    res.json(result);

  } catch (error) {
    logApi.error('Failed to adjust balance', {
      error: {
        name: error.name,
        message: error.message,
        code: error?.code,
        meta: error?.meta,
        stack: req.environment === 'development' ? error.stack : undefined
      },
      wallet_address: wallet,
      path: req.path,
      method: req.method
    });

    res.status(500).json({
      error: 'Failed to adjust balance',
      message: req.environment === 'development' ? error.message : undefined
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