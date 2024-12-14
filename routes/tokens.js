import express from 'express';
import { pool } from '../config/pg-database.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Tokens
 *   description: API endpoints for token management
 */


// GET /api/tokens - Fetch all tokens
router.get('/', async (req, res) => {
  try {
    const tokens = await pool.query('SELECT * FROM tokens WHERE is_active = true');
    res.json(tokens.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch tokens.' });
  }
});

// POST /api/tokens - Add a new token
router.post('/', async (req, res) => {
  const { address, symbol, name, decimals } = req.body;

  if (!address || !symbol || !name) {
    return res.status(400).json({ error: 'Address, symbol, and name are required.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO tokens (address, symbol, name, decimals) VALUES ($1, $2, $3, $4) RETURNING *',
      [address, symbol, name, decimals || 18]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add token.' });
  }
});

export default router;
