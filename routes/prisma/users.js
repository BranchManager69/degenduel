import { Router } from 'express';
import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'
dotenv.config()

const router = Router();
const prisma = new PrismaClient()

const SUPERADMIN_WALLET_ADDRESS = process.env.SUPERADMIN_WALLET_ADDRESS

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
router.get('/mommy', (req, res) => {
  res.send('This is /api/daddy/mommy');
});


export default router;