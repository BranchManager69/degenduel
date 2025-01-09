import { Prisma, PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { Router } from 'express';
import logger from '../../utils/logger.js';
dotenv.config()

const router = Router();
const prisma = new PrismaClient()

const SUPERADMIN_WALLET_ADDRESS = process.env.SUPERADMIN_WALLET_ADDRESS

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
router.get('/:wallet', async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { wallet } = req.params;

  logger.info('Fetching user balance', {
    requestId,
    wallet_address: wallet
  });

  try {
    const user = await prisma.users.findUnique({
      where: { wallet_address: wallet }
    });

    if (!user) {
      logger.warn('User not found', {
        requestId,
        wallet_address: wallet
      });
      return res.status(404).json({ error: 'User not found' });
    }

    const balance = new Prisma.Decimal(user.balance || '0');
    const exactUSDC = balance.dividedBy(1000000);
    const formattedBalance = exactUSDC.toFixed(2);

    logger.info('Successfully fetched user balance', {
      requestId,
      wallet_address: wallet,
      balance: balance.toString(),
      exact_usdc: exactUSDC.toString(),
      formatted_balance: formattedBalance
    });

    res.json({
      balance: balance.toString(),
      exact_usdc: exactUSDC.toString(),
      formatted_balance: `${formattedBalance} USDC`,
      decimals: 6
    });

  } catch (error) {
    console.error('Error fetching user balance:', error); // TODO: remove
    logger.error('Failed to fetch user balance', {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error?.code,
        meta: error?.meta
      },
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      duration: Date.now() - startTime
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
router.post('/:wallet/balance', async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { wallet } = req.params;
  const { amount } = req.body;

  logger.info('Adjusting user balance', {
    requestId,
    wallet_address: wallet,
    adjustment_amount: amount
  });

  try {
    // Verify admin authorization here
    // TODO: Implement proper admin check
    
    const result = await prisma.$transaction(async (prisma) => {
      // Find user
      const user = await prisma.users.findUnique({
        where: { wallet_address: wallet }
      });

      if (!user) {
        throw new Error('User not found');
      }

      const previousBalance = new Prisma.Decimal(user.balance || '0');
      const adjustment = new Prisma.Decimal(amount);
      const newBalance = previousBalance.plus(adjustment);

      // Prevent negative balance
      if (newBalance.lessThan(0)) {
        throw new Error('Insufficient balance for deduction');
      }

      // Update user balance
      const updatedUser = await prisma.users.update({
        where: { wallet_address: wallet },
        data: { 
          balance: newBalance.toString(),
          updated_at: new Date()
        }
      });

      // Log the adjustment
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

      return {
        previous_balance: previousBalance.toString(),
        new_balance: newBalance.toString(),
        adjustment: adjustment.toString()
      };
    });

    logger.info('Successfully adjusted balance', {
      requestId,
      wallet_address: wallet,
      ...result,
      duration: Date.now() - startTime
    });

    res.json(result);

  } catch (error) {
    logger.error('Failed to adjust balance', {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error?.code,
        meta: error?.meta
      },
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      duration: Date.now() - startTime
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
/*
router.get('/', async (req, res) => {
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
/*
router.get('/mommy', (req, res) => {
  res.send('This is /api/daddy/mommy');
});
*/

export default router;