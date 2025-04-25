// /routes/v2/tokenBuckets.js

import express from 'express';
import prisma from '../../config/prisma.js';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Token Buckets V2
 *   description: V2 API endpoints for managing token buckets using contract addresses
 */

/**
 * @swagger
 * /api/v2/buckets:
 *   post:
 *     summary: Create a new token bucket
 *     tags: [Token Buckets V2]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name of the bucket
 *               description:
 *                 type: string
 *                 description: Description of the bucket
 *     responses:
 *       201:
 *         description: Token bucket created successfully
 *       500:
 *         description: Failed to create token bucket
 */
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  try {
    const result = await prisma.token_buckets.create({
      data: {
        name,
        description
      }
    });
    res.status(201).json(result);
  } catch (error) {
    logApi.error('[v2] Error creating token bucket:', error);
    res.status(500).json({ error: 'Failed to create token bucket.' });
  }
});

/**
 * @swagger
 * /api/v2/buckets:
 *   get:
 *     summary: Get all token buckets and their tokens
 *     tags: [Token Buckets V2]
 *     responses:
 *       200:
 *         description: List of token buckets with tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   description:
 *                     type: string
 *                   tokens:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         contractAddress:
 *                           type: string
 *                         symbol:
 *                           type: string
 *                         name:
 *                           type: string
 */
router.get('/', async (_req, res) => {
  try {
    const result = await prisma.token_buckets.findMany({
      include: {
        tokens: true
      }
    });
    res.json(result);
  } catch (error) {
    logApi.error('[v2] Error fetching token buckets:', error);
    res.status(500).json({ error: 'Failed to fetch token buckets.' });
  }
});

/**
 * @swagger
 * /api/v2/buckets/{bucketId}/tokens:
 *   post:
 *     summary: Add tokens to a bucket
 *     tags: [Token Buckets V2]
 *     parameters:
 *       - in: path
 *         name: bucketId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of token contract addresses
 *     responses:
 *       200:
 *         description: Tokens added successfully
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/:bucketId/tokens', requireAuth, requireSuperAdmin, async (req, res) => {
  const { bucketId } = req.params;
  const { addresses } = req.body;

  if (!Array.isArray(addresses)) {
    return res.status(400).json({ error: 'addresses must be an array' });
  }

  try {
    // First get token IDs from contract addresses
    const tokenIds = await prisma.tokens.findMany({
      where: {
        contract_address: {
          in: addresses
        },
        is_active: true
      },
      select: {
        id: true
      }
    });
    const validTokenIds = tokenIds.map(row => row.id);

    if (validTokenIds.length === 0) {
      return res.status(400).json({ error: 'No valid tokens provided.' });
    }

    // Then add to bucket
    const values = validTokenIds.map((id) => ({
      bucket_id: bucketId,
      token_id: id
    }));
    const result = await prisma.token_bucket_memberships.createMany({
      data: values,
      onConflict: {
        conflict_target: ['bucket_id', 'token_id'],
        action: 'do nothing'
      }
    });
    res.json({ success: true, added: result.count });
  } catch (error) {
    logApi.error('[v2] Error adding tokens to bucket:', error);
    res.status(500).json({ error: 'Failed to add tokens to bucket.' });
  }
});

/**
 * @swagger
 * /api/v2/buckets/{bucketId}/tokens/{contractAddress}:
 *   delete:
 *     summary: Remove a token from a bucket
 *     tags: [Token Buckets V2]
 *     parameters:
 *       - in: path
 *         name: bucketId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Token removed successfully
 *       404:
 *         description: Token not found in bucket
 *       500:
 *         description: Server error
 */
router.delete('/:bucketId/tokens/:contractAddress', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { bucketId, contractAddress } = req.params;
    
    // First get token ID from contract address
    const tokenResult = await prisma.tokens.findFirst({
      where: {
        contract_address: contractAddress
      }
    });

    if (!tokenResult) {
      return res.status(404).json({ error: 'Token not found' });
    }

    const tokenId = tokenResult.id;

    // Then remove from bucket
    const result = await prisma.token_bucket_memberships.deleteMany({
      where: {
        bucket_id: bucketId,
        token_id: tokenId
      }
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Token not found in bucket' });
    }

    res.json({ success: true, removed: contractAddress });
  } catch (error) {
    logApi.error('[v2] Error removing token from bucket:', error);
    res.status(500).json({ error: 'Failed to remove token from bucket.' });
  }
});

/**
 * @swagger
 * /api/v2/buckets/{bucketId}:
 *   patch:
 *     summary: Update token bucket details
 *     tags: [Token Buckets V2]
 *     parameters:
 *       - in: path
 *         name: bucketId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token bucket updated successfully
 *       404:
 *         description: Token bucket not found
 *       500:
 *         description: Server error
 */
router.patch('/:bucketId', requireAuth, requireSuperAdmin, async (req, res) => {
  const { bucketId } = req.params;
  const { name, description } = req.body;

  try {
    const result = await prisma.token_buckets.update({
      where: {
        id: bucketId
      },
      data: {
        name: name ? { set: name } : undefined,
        description: description ? { set: description } : undefined
      }
    });

    if (!result) {
      return res.status(404).json({ error: 'Token bucket not found.' });
    }

    res.json({ success: true, updated: result });
  } catch (error) {
    logApi.error('[v2] Error updating token bucket:', error);
    res.status(500).json({ error: 'Failed to update token bucket.' });
  }
});

/**
 * @swagger
 * /api/v2/buckets/{bucketId}:
 *   delete:
 *     summary: Delete token bucket
 *     tags: [Token Buckets V2]
 *     parameters:
 *       - in: path
 *         name: bucketId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Token bucket deleted successfully
 *       404:
 *         description: Token bucket not found
 *       500:
 *         description: Server error
 */
router.delete('/:bucketId', requireAuth, requireSuperAdmin, async (req, res) => {
  const { bucketId } = req.params;

  try {
    const result = await prisma.token_buckets.delete({
      where: {
        id: bucketId
      }
    });

    if (!result) {
      return res.status(404).json({ error: 'Token bucket not found.' });
    }

    res.json({ success: true, deleted: result });
  } catch (error) {
    logApi.error('[v2] Error deleting token bucket:', error);
    res.status(500).json({ error: 'Failed to delete token bucket.' });
  }
});

export default router; 