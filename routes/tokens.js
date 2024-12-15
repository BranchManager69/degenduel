import express from 'express';
import { pool } from '../config/pg-database.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Tokens
 *   description: API endpoints for token management
 */

// Add a new token
router.post('/', async (req, res) => {
  const { address, symbol, name, decimals } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO tokens (address, symbol, name, decimals) VALUES ($1, $2, $3, $4) RETURNING *`,
      [address, symbol, name, decimals || 18]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add token.' });
  }
});

// Get all tokens (optional: filter by is_active)
router.get('/', async (req, res) => {
  const { isActive } = req.query;
  try {
      const query = isActive
          ? `SELECT * FROM tokens WHERE is_active = $1`
          : `SELECT * FROM tokens`;
      const params = isActive ? [isActive === 'true'] : [];
      const result = await pool.query(query, params);
      res.json(result.rows);
  } catch (error) {
      res.status(500).json({ error: 'Failed to fetch tokens.' });
  }
});


// Get token by ID
router.get('/:tokenId', async (req, res) => {
  const { tokenId } = req.params;
  try {
    const result = await pool.query(`SELECT * FROM tokens WHERE id = $1`, [tokenId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Token not found.' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch token.' });
  }
});

// Update token
router.put('/:tokenId', async (req, res) => {
  const { tokenId } = req.params;
  const { symbol, name, decimals, is_active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE tokens SET 
        symbol = COALESCE($1, symbol), 
        name = COALESCE($2, name), 
        decimals = COALESCE($3, decimals), 
        is_active = COALESCE($4, is_active)
      WHERE id = $5 RETURNING *`,
      [symbol, name, decimals, is_active, tokenId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Token not found.' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update token.' });
  }
});

// Enable/Disable token
router.patch('/:tokenId/status', async (req, res) => {
  const { tokenId } = req.params;
  const { is_active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE tokens SET is_active = $1 WHERE id = $2 RETURNING *`,
      [is_active, tokenId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Token not found.' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update token status.' });
  }
});














/*






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





*/

export default router;
