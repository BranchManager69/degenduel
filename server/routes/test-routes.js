import express from 'express';
import { pool } from '../config/pg-database.js';

const router = express.Router();

// Create test user
router.post('/test-user', async (req, res) => {
  try {
    const result = await pool.query(`
      INSERT INTO users (wallet_address, nickname, rank_score)
      VALUES ($1, $2, $3)
      RETURNING *
    `, ['0xTestWallet456', 'TestUser2', 1000]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update test-user
router.put('/test-user/:wallet', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE users 
      SET rank_score = rank_score + 10
      WHERE wallet_address = $1
      RETURNING *
    `, [req.params.wallet]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update test-user settings
router.put('/test-user/:wallet/settings', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE users 
      SET settings = settings || '{"theme": "dark", "notifications": true}'::jsonb
      WHERE wallet_address = $1
      RETURNING *
    `, [req.params.wallet]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update multiple fields
router.put('/test-user/:wallet/profile', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE users 
      SET 
        nickname = 'UpdatedNick',
        rank_score = rank_score + 5,
        settings = settings || '{"showBalance": true}'::jsonb,
        last_login = CURRENT_TIMESTAMP
      WHERE wallet_address = $1
      RETURNING *
    `, [req.params.wallet]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
