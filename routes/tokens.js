import { PrismaClient } from '@prisma/client';
import express from 'express';
import { logApi } from '../utils/logger-suite/logger.js';

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * tags:
 *   name: Tokens
 *   description: API endpoints for token and bucket management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Token:
 *       type: object
 *       required:
 *         - id
 *         - address
 *         - symbol
 *         - name
 *         - decimals
 *         - is_active
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         address:
 *           type: string
 *           example: "0x123..."
 *         symbol:
 *           type: string
 *           example: "ETH"
 *         name:
 *           type: string
 *           example: "Ethereum"
 *         decimals:
 *           type: integer
 *           example: 18
 *         is_active:
 *           type: boolean
 *           example: true
 *         market_cap:
 *           type: string
 *           example: "200000000000"
 *         change_24h:
 *           type: string
 *           example: "2.5"
 *         volume_24h:
 *           type: string
 *           example: "1000000000"
 *     TokenPrice:
 *       type: object
 *       required:
 *         - token_id
 *         - price
 *         - updated_at
 *       properties:
 *         token_id:
 *           type: integer
 *           example: 1
 *         price:
 *           type: string
 *           example: "1850.75"
 *         updated_at:
 *           type: string
 *           format: date-time
 *           example: "2024-12-21T15:30:00Z"
 *     TokenBucket:
 *       type: object
 *       required:
 *         - id
 *         - bucket_code
 *         - name
 *         - description
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         bucket_code:
 *           type: string
 *           example: "DEFI-BLUE-CHIPS"
 *         name:
 *           type: string
 *           example: "DeFi Blue Chips"
 *         description:
 *           type: string
 *           example: "Top DeFi tokens by market cap"
 *   responses:
 *     TokenNotFound:
 *       description: Token was not found
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *                 example: "Token not found"
 */


/* Tokens Routes */

/**
 * @swagger
 * /api/tokens:
 *   get:
 *     summary: Get all tokens with optional filters
 *     tags: [Tokens]
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: bucket
 *         schema:
 *           type: integer
 *         description: Filter by bucket ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by symbol or name
 *     responses:
 *       200:
 *         description: List of tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/Token'
 *                   - type: object
 *                     properties:
 *                       token_prices:
 *                         $ref: '#/components/schemas/TokenPrice'
 *                       token_bucket_memberships:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             token_buckets:
 *                               $ref: '#/components/schemas/TokenBucket'
 */
// Get all tokens (with optional filters)
router.get('/', async (req, res) => {
  try {
    const { active, bucket, search } = req.query;

    const where = {
      AND: [
        active !== undefined ? { is_active: active === 'true' } : {},
        bucket ? {
          token_bucket_memberships: {
            some: { bucket_id: parseInt(bucket) }
          }
        } : {},
        search ? {
          OR: [
            { symbol: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } }
          ]
        } : {}
      ]
    };

    const tokens = await prisma.tokens.findMany({
      where,
      include: {
        token_prices: true,
        token_bucket_memberships: {
          include: {
            token_buckets: true
          }
        }
      },
      orderBy: {
        market_cap: 'desc'
      }
    });

    res.json(tokens);
  } catch (error) {
    logApi.error('Failed to fetch tokens:', error);
    res.status(500).json({ error: 'Failed to fetch tokens' });
  }
});

/**
 * @swagger
 * /api/tokens/{id}:
 *   get:
 *     summary: Get token by ID
 *     tags: [Tokens]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Token ID
 *     responses:
 *       200:
 *         description: Token details
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Token'
 *                 - type: object
 *                   properties:
 *                     token_prices:
 *                       $ref: '#/components/schemas/TokenPrice'
 *                     token_bucket_memberships:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           token_buckets:
 *                             $ref: '#/components/schemas/TokenBucket'
 *       404:
 *         $ref: '#/components/responses/TokenNotFound'
 */
// Get token by ID
router.get('/:id', async (req, res) => {
  try {
    const token = await prisma.tokens.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        token_prices: true,
        token_bucket_memberships: {
          include: {
            token_buckets: true
          }
        }
      }
    });

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    res.json(token);
  } catch (error) {
    logApi.error('Failed to fetch token:', error);
    res.status(500).json({ error: 'Failed to fetch token' });
  }
});

/**
 * @swagger
 * /api/tokens/prices:
 *   get:
 *     summary: Get current prices for all tokens
 *     tags: [Tokens]
 *     responses:
 *       200:
 *         description: Current token prices
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/TokenPrice'
 *                   - type: object
 *                     properties:
 *                       tokens:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           name:
 *                             type: string
 */
// Get current prices for all tokens
router.get('/prices', async (req, res) => {
  try {
    const prices = await prisma.token_prices.findMany({
      include: {
        tokens: {
          select: {
            symbol: true,
            name: true
          }
        }
      }
    });

    res.json(prices);
  } catch (error) {
    logApi.error('Failed to fetch token prices:', error);
    res.status(500).json({ error: 'Failed to fetch token prices' });
  }
});

/**
 * @swagger
 * /api/tokens/prices/{tokenId}:
 *   get:
 *     summary: Get price history for a specific token
 *     tags: [Tokens]
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Token ID
 *     responses:
 *       200:
 *         description: Token price history
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/TokenPrice'
 *                 - type: object
 *                     properties:
 *                       tokens:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           name:
 *                             type: string
 *                           market_cap:
 *                             type: string
 *                           volume_24h:
 *                             type: string
 *                           change_24h:
 *                             type: string
 *       404:
 *         $ref: '#/components/responses/TokenNotFound'
 */
// Get price history for a specific token
router.get('/prices/:tokenId', async (req, res) => {
  try {
    const price = await prisma.token_prices.findUnique({
      where: { token_id: parseInt(req.params.tokenId) },
      include: {
        tokens: {
          select: {
            symbol: true,
            name: true,
            market_cap: true,
            volume_24h: true,
            change_24h: true
          }
        }
      }
    });

    if (!price) {
      return res.status(404).json({ error: 'Token price not found' });
    }

    res.json(price);
  } catch (error) {
    logApi.error('Failed to fetch token price:', error);
    res.status(500).json({ error: 'Failed to fetch token price' });
  }
});

export default router;
