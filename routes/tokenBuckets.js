import express from 'express';
import { pool } from '../config/pg-database.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Token Buckets
 *   description: API endpoints for token management
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

// Get all token buckets and their active tokens
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

export default router;
