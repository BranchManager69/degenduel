// /routes/tokenBuckets.js
import express from 'express';
import { pool } from '../config/pg-database.js';
import { logApi } from '../utils/logger-suite';

const router = express.Router();

/*
 *
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
 * /api/token-buckets:
 *   post:
 *     summary: Create a new token bucket
 *     tags: [Token Buckets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Bucket name
 *               description:
 *                 type: string
 *                 description: Bucket description
 *     responses:
 *       201:
 *         description: Token bucket created successfully
 *       500:
 *         description: Failed to create token bucket
 */
// Create a new token bucket
router.post('/', async (req, res) => {
  const { name, description } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO token_buckets (name, description) VALUES ($1, $2) RETURNING *`,
      [name, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create token bucket.' });
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
// Get all token buckets
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
      logApi.error('Failed to fetch token buckets:', error);
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
// Get token bucket by ID
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
// Add tokens to a bucket
router.post('/:bucketId/tokens', async (req, res) => {
    const { bucketId } = req.params;
    const { tokenIds } = req.body;

    try {
        const validTokens = await pool.query(
            `SELECT id FROM tokens WHERE id = ANY($1)`,
            [tokenIds]
        );
        const validTokenIds = validTokens.rows.map(row => row.id);

        if (validTokenIds.length === 0) {
            return res.status(400).json({ error: 'No valid tokens provided.' });
        }

        const values = validTokenIds.map((id) => `(${bucketId}, ${id})`).join(',');
        const result = await pool.query(
            `INSERT INTO token_bucket_memberships (bucket_id, token_id) VALUES ${values} ON CONFLICT DO NOTHING`
        );
        res.json({ success: true, added: result.rowCount });
    } catch (error) {
        console.error('Error adding tokens to bucket:', error); // Debugging log
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
// Remove a token from a bucket
router.delete('/:bucketId/tokens/:tokenId', async (req, res) => {
    try {
        const { bucketId, tokenId } = req.params;
        const result = await pool.query(
            `DELETE FROM token_bucket_memberships WHERE bucket_id = $1 AND token_id = $2`,
            [bucketId, tokenId]
        );
        if (result.rowCount === 0) {
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
 * /api/token-buckets:
 *   get:
 *     summary: Get all token buckets and their tokens
 *     tags: [Token Buckets]
 *     responses:
 *       200:
 *         description: List of token buckets with tokens
 *       500:
 *         description: Failed to fetch token buckets
 */
// Get all token buckets (with tokens)
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(`
        SELECT 
            tb.id AS bucket_id, 
            tb.name, 
            tb.description, 
            COALESCE(array_agg(t.symbol), '{}') AS tokens
        FROM token_buckets tb
        LEFT JOIN token_bucket_memberships tbm ON tb.id = tbm.bucket_id
        LEFT JOIN tokens t ON tbm.token_id = t.id AND t.is_active = true
        GROUP BY tb.id;
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch token buckets.' });
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
// Update token bucket details
router.patch('/:bucketId', async (req, res) => {
    const { bucketId } = req.params;
    const { name, description } = req.body;

    try {
        const result = await pool.query(
            `UPDATE token_buckets SET 
                name = COALESCE($1, name), 
                description = COALESCE($2, description) 
            WHERE id = $3 RETURNING *;`,
            [name, description, bucketId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Token bucket not found.' });
        }

        res.json({ success: true, updated: result.rows[0] });
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
// Delete token bucket
router.delete('/:bucketId', async (req, res) => {
    const { bucketId } = req.params;

    try {
        const result = await pool.query(
            `DELETE FROM token_buckets WHERE id = $1 RETURNING *;`,
            [bucketId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Token bucket not found.' });
        }

        res.json({ success: true, deleted: result.rows[0] });
    } catch (error) {
        console.error('Error deleting token bucket:', error);
        res.status(500).json({ error: 'Failed to delete token bucket.' });
    }
});

export default router;