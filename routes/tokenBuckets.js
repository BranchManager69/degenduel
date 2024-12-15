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
    const values = tokenIds.map((id) => `(${bucketId}, ${id})`).join(',');
    const result = await pool.query(
      `INSERT INTO token_bucket_memberships (bucket_id, token_id) VALUES ${values} ON CONFLICT DO NOTHING`
    );
    res.json({ success: true, added: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add tokens to bucket.' });
  }
});

// Get all token buckets and their tokens
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT tb.id, tb.name, tb.description, json_agg(t.symbol) AS tokens
      FROM token_buckets tb
      LEFT JOIN token_bucket_memberships tbm ON tb.id = tbm.bucket_id
      LEFT JOIN tokens t ON tbm.token_id = t.id
      GROUP BY tb.id
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch token buckets.' });
  }
});

export default router;
