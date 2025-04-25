// /routes/tokenBuckets.js

import express from 'express';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';

const router = express.Router();

/*
 *  THIS IS AN *OLD* ENDPOINT
 *  WE SHOULD BRING IT UP TO DATE
 */

/**
 * @swagger
 * tags:
 *   name: Token Buckets
 *   description: API endpoints for managing token buckets
 */

/* Token Buckets Routes */

/**
 * @swagger
 * /api/buckets:
 *   post:
 *     summary: Create a new token bucket
 *     tags: [Token Buckets]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TokenBucket'
 *     responses:
 *       201:
 *         description: Token bucket created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenBucket'
 *       500:
 *         description: Failed to create token bucket
 */
// Create a new token bucket (ADMIN ONLY)
//      example: POST https://degenduel.me/api/buckets
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "name": "Top 10 Market Cap", "description": "Top 10 cryptocurrencies by market capitalization" }
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  try {
    logApi.info('Creating token bucket:', { name, description });
    
    // Generate a unique bucket code
    const bucketCode = `BUCKET_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`.toUpperCase();
    
    const bucket = await prisma.token_buckets.create({
      data: {
        name,
        description,
        bucket_code: bucketCode
      }
    });
    
    logApi.info('Token bucket created:', { id: bucket.id, bucketCode });
    res.status(201).json(bucket);
  } catch (error) {
    logApi.error('Failed to create token bucket:', error);
    res.status(500).json({ error: 'Failed to create token bucket.' });
  }
});

/**
 * @swagger
 * /api/buckets:
 *   get:
 *     summary: Get all token buckets and their tokens
 *     tags: [Token Buckets]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of token buckets with tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/TokenBucket'
 *       500:
 *         description: Failed to fetch token buckets
 */
// Get all token buckets with their tokens (NO AUTH REQUIRED)
//      example: GET https://degenduel.me/api/buckets
//      headers: { "Cookie": "session=<jwt>" }
router.get('/', async (_req, res) => {
  try {
    logApi.info('Fetching token buckets...');
    const buckets = await prisma.token_buckets.findMany({
      include: {
        token_bucket_memberships: {
          include: {
            tokens: {
              where: {
                is_active: true
              }
            }
          }
        }
      }
    });

    const formattedBuckets = buckets.map(bucket => ({
      bucket_id: bucket.id,
      name: bucket.name,
      description: bucket.description,
      tokens: bucket.token_bucket_memberships.map(membership => membership.tokens.symbol).filter(Boolean)
    }));

    logApi.info('Token buckets fetched:', { count: buckets.length });
    res.json(formattedBuckets);
  } catch (error) {
    logApi.error('Failed to fetch token buckets:', error);
    res.status(500).json({ error: 'Failed to fetch token buckets.' });
  }
});

/**
 * @swagger
 * /api/buckets/{id}:
 *   get:
 *     summary: Get token bucket by ID
 *     tags: [Token Buckets]
 *     security:
 *       - cookieAuth: []
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
 *               $ref: '#/components/schemas/TokenBucket'
 *       404:
 *         description: Token bucket not found
 *       500:
 *         description: Failed to fetch token bucket
 */
// Get token bucket by ID (NO AUTH REQUIRED)
//      example: GET https://degenduel.me/api/buckets/{bucket_id}
//      headers: { "Cookie": "session=<jwt>" }
router.get('/:id', async (req, res) => {
  try {
    logApi.info('Fetching bucket by ID:', { id: req.params.id });
    
    const bucket = await prisma.token_buckets.findUnique({
      where: {
        id: parseInt(req.params.id)
      },
      include: {
        token_bucket_memberships: {
          include: {
            tokens: {
              where: {
                is_active: true
              },
              include: {
                token_prices: true
              }
            }
          }
        }
      }
    });

    if (!bucket) {
      logApi.warn('Bucket not found:', { id: req.params.id });
      return res.status(404).json({ error: 'Bucket not found' });
    }

    const formattedBucket = {
      bucket_id: bucket.id,
      name: bucket.name,
      description: bucket.description,
      bucket_code: bucket.bucket_code,
      created_at: bucket.created_at,
      tokens: bucket.token_bucket_memberships.map(membership => ({
        id: membership.tokens.id,
        symbol: membership.tokens.symbol,
        name: membership.tokens.name,
        price: membership.tokens.token_prices?.price
      })).filter(Boolean)
    };

    logApi.info('Bucket fetched successfully:', { id: req.params.id });
    res.json(formattedBucket);
  } catch (error) {
    logApi.error('Failed to fetch bucket:', error);
    res.status(500).json({ error: 'Failed to fetch bucket' });
  }
});

/**
 * @swagger
 * /api/token-buckets/{bucketId}/tokens:
 *   post:
 *     summary: Add tokens to a bucket
 *     tags: [Token Buckets]
 *     parameters:
 *       - in: path
 *         name: bucketId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the bucket to add tokens
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tokenIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: List of token IDs to add
 *     responses:
 *       200:
 *         description: Tokens added successfully
 *       400:
 *         description: No valid tokens provided
 *       500:
 *         description: Failed to add tokens to bucket
 */
// Add tokens to a bucket (SUPERADMIN ONLY)
//      example: POST https://degenduel.me/api/buckets
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "name": "Top 10 Market Cap", "description": "Top 10 cryptocurrencies by market capitalization" }
router.post('/:bucketId/tokens', requireAuth, requireSuperAdmin, async (req, res) => {
  const { bucketId } = req.params;
  const { tokenIds } = req.body;

  try {
    const validTokens = await prisma.tokens.findMany({
      where: {
        id: {
          in: tokenIds
        }
      },
      select: {
        id: true
      }
    });

    const validTokenIds = validTokens.map(token => token.id);

    if (validTokenIds.length === 0) {
      return res.status(400).json({ error: 'No valid tokens provided.' });
    }

    const result = await prisma.$transaction(
      validTokenIds.map(tokenId => 
        prisma.token_bucket_memberships.upsert({
          where: {
            bucket_id_token_id: {
              bucket_id: parseInt(bucketId),
              token_id: tokenId
            }
          },
          create: {
            bucket_id: parseInt(bucketId),
            token_id: tokenId
          },
          update: {}
        })
      )
    );

    res.json({ success: true, added: result.length });
  } catch (error) {
    logApi.error('Error adding tokens to bucket:', error);
    res.status(500).json({ error: 'Failed to add tokens to bucket.' });
  }
});

/**
 * @swagger
 * /api/token-buckets/{bucketId}/tokens/{tokenId}:
 *   delete:
 *     summary: Remove a token from a bucket
 *     tags: [Token Buckets]
 *     parameters:
 *       - in: path
 *         name: bucketId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the bucket
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the token to remove
 *     responses:
 *       200:
 *         description: Token removed successfully
 *       404:
 *         description: Token not found in bucket
 *       500:
 *         description: Failed to remove token from bucket
 */
// Remove a token from a bucket (SUPERADMIN ONLY)
//      headers: { "Authorization": "Bearer <JWT>" }
//      example: DELETE https://degenduel.me/api/buckets/1/tokens/1
router.delete('/:bucketId/tokens/:tokenId', async (req, res) => {
    try {
        const { bucketId, tokenId } = req.params;
        const result = await prisma.token_bucket_memberships.delete({
            where: {
                bucket_id_token_id: {
                    bucket_id: parseInt(bucketId),
                    token_id: parseInt(tokenId)
                }
            }
        });
        if (result.count === 0) {
            return res.status(404).json({ error: 'Token not found in bucket' });
        }
        res.json({ success: true, removed: tokenId });
    } catch (err) {
        console.error('Error removing token from bucket:', err); // Log for debugging
        res.status(500).json({ error: 'Failed to remove token from bucket' });
    }
});

/**
 * @swagger
 * /api/token-buckets/{bucketId}:
 *   patch:
 *     summary: Update token bucket details
 *     tags: [Token Buckets]
 *     parameters:
 *       - in: path
 *         name: bucketId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the token bucket to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: New name for the bucket
 *               description:
 *                 type: string
 *                 description: New description for the bucket
 *     responses:
 *       200:
 *         description: Token bucket updated successfully
 *       404:
 *         description: Token bucket not found
 *       500:
 *         description: Server error
 */
// Update token bucket details (SUPERADMIN ONLY)  
//      example: PUT https://degenduel.me/api/buckets/{bucket_id}
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "name": "Top 10 Market Cap", "description": "Top 10 cryptocurrencies by market capitalization" }
router.patch('/:bucketId', requireAuth, requireSuperAdmin, async (req, res) => {
  const { bucketId } = req.params;
  const { name, description } = req.body;

  try {
      const result = await prisma.token_buckets.update({
          where: {
              id: parseInt(bucketId)
          },
          data: {
              name: name,
              description: description
          }
      });

      if (result.count === 0) {
          return res.status(404).json({ error: 'Token bucket not found.' });
      }

      res.json({ success: true, updated: result });
  } catch (error) {
      console.error('Error updating token bucket:', error);
      res.status(500).json({ error: 'Failed to update token bucket.' });
  }
});

/**
 * @swagger
 * /api/token-buckets/{bucketId}:
 *   delete:
 *     summary: Delete token bucket
 *     tags: [Token Buckets]
 *     parameters:
 *       - in: path
 *         name: bucketId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the token bucket to delete
 *     responses:
 *       200:
 *         description: Token bucket deleted successfully
 *       404:
 *         description: Token bucket not found
 *       500:
 *         description: Server error
 */
// Delete token bucket (SUPERADMIN ONLY)
//      headers: { "Authorization": "Bearer <JWT>" }
//      example: DELETE https://degenduel.me/api/buckets/1
router.delete('/:bucketId', requireAuth, requireSuperAdmin, async (req, res) => {
    const { bucketId } = req.params;

    try {
        const result = await prisma.token_buckets.delete({
            where: {
                id: parseInt(bucketId)
            }
        });

        if (result.count === 0) {
            return res.status(404).json({ error: 'Token bucket not found.' });
        }

        res.json({ success: true, deleted: result });
    } catch (error) {
        console.error('Error deleting token bucket:', error);
        res.status(500).json({ error: 'Failed to delete token bucket.' });
    }
});

export default router;