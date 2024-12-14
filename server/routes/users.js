import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../config/logger.js';

const router = express.Router();

// Get user profile
router.get('/:wallet', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM users WHERE wallet_address = $1
    `, [req.params.wallet]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get user failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update user profile
router.put('/:wallet', async (req, res) => {
  try {
    const { nickname } = req.body;
    const result = await pool.query(`
      UPDATE users 
      SET 
        nickname = COALESCE($2, nickname),
        last_login = CURRENT_TIMESTAMP
      WHERE wallet_address = $1
      RETURNING *
    `, [req.params.wallet, nickname]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update user failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update user settings
router.put('/:wallet/settings', async (req, res) => {
  try {
    const { settings } = req.body;
    const result = await pool.query(`
      UPDATE users 
      SET settings = settings || $2::jsonb
      WHERE wallet_address = $1
      RETURNING *
    `, [req.params.wallet, JSON.stringify(settings)]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update settings failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;