import express from 'express';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

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
 *         market_cap:
 *           type: string
 *           example: "200000000000"
 *         change_24h:
 *           type: string
 *           example: "2.5"
 *         volume_24h:
 *           type: string
 *           example: "1000000000"
 *     
 *     TokenPrice:
 *       type: object
 *       properties:
 *         token_id:
 *           type: integer
 *         price:
 *           type: string
 *           example: "1850.75"
 *         updated_at:
 *           type: string
 *           format: date-time
 *     
 *     TokenBucket:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         bucket_code:
 *           type: string
 *           example: "DEFI-BLUE-CHIPS"
 *         name:
 *           type: string
 *           example: "DeFi Blue Chips"
 *         description:
 *           type: string
 *           example: "Top DeFi tokens by market cap"
 *   
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
 *                 example: Token not found
 */

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
    logger.error('Failed to fetch tokens:', error);
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
 *       404:
 *         $ref: '#/components/responses/TokenNotFound'
 */
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
    logger.error('Failed to fetch token:', error);
    res.status(500).json({ error: 'Failed to fetch token' });
  }
});

/**
 * @swagger
 * /api/tokens/buckets:
 *   get:
 *     summary: Get all token buckets
 *     tags: [Tokens]
 *     responses:
 *       200:
 *         description: List of token buckets
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/TokenBucket'
 *                   - type: object
 *                     properties:
 *                       token_bucket_memberships:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             tokens:
 *                               type: object
 *                               properties:
 *                                 id:
 *                                   type: integer
 *                                 symbol:
 *                                   type: string
 *                                 name:
 *                                   type: string
 */
router.get('/buckets', async (req, res) => {
  try {
    const buckets = await prisma.token_buckets.findMany({
      include: {
        token_bucket_memberships: {
          include: {
            tokens: {
              select: {
                id: true,
                symbol: true,
                name: true
              }
            }
          }
        }
      }
    });

    res.json(buckets);
  } catch (error) {
    logger.error('Failed to fetch token buckets:', error);
    res.status(500).json({ error: 'Failed to fetch token buckets' });
  }
});

/**
 * @swagger
 * /api/tokens/buckets/{id}:
 *   get:
 *     summary: Get token bucket by ID
 *     tags: [Tokens]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Bucket ID
 *     responses:
 *       200:
 *         description: Token bucket details
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/TokenBucket'
 *                 - type: object
 *                     properties:
 *                       token_bucket_memberships:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             tokens:
 *                               allOf:
 *                                 - $ref: '#/components/schemas/Token'
 *                                 - type: object
 *                                   properties:
 *                                     token_prices:
 *                                       $ref: '#/components/schemas/TokenPrice'
 *       404:
 *         $ref: '#/components/responses/TokenNotFound'
 */
router.get('/buckets/:id', async (req, res) => {
  try {
    const bucket = await prisma.token_buckets.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        token_bucket_memberships: {
          include: {
            tokens: {
              include: {
                token_prices: true
              }
            }
          }
        }
      }
    });

    if (!bucket) {
      return res.status(404).json({ error: 'Bucket not found' });
    }

    res.json(bucket);
  } catch (error) {
    logger.error('Failed to fetch bucket:', error);
    res.status(500).json({ error: 'Failed to fetch bucket' });
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
    logger.error('Failed to fetch token prices:', error);
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
    logger.error('Failed to fetch token price:', error);
    res.status(500).json({ error: 'Failed to fetch token price' });
  }
});

export default router;
