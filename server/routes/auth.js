import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../config/logger.js';

const router = express.Router();

// Verify wallet signature
router.post('/verify-wallet', async (req, res) => {
  try {
    const { wallet, signature, message } = req.body;
    // TODO: Add actual signature verification
    res.json({ verified: true });
  } catch (error) {
    logger.error('Wallet verification failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Connect wallet and create/update user
router.post('/connect', async (req, res) => {
    try {
      const { wallet_address, nickname } = req.body;
      
      // Insert user if doesn't exist
      const result = await pool.query(`
        INSERT INTO users (wallet_address, nickname)
        VALUES ($1, $2)
        ON CONFLICT (wallet_address) 
        DO UPDATE SET last_login = CURRENT_TIMESTAMP
        RETURNING *
      `, [wallet_address, nickname]);
  
      res.json(result.rows[0]);
    } catch (error) {
      logger.error('Auth connect failed:', error);
      res.status(500).json({ error: error.message });
    }
});

// Disconnect wallet
router.post('/disconnect', async (req, res) => {
  try {
    const { wallet } = req.body;
    await pool.query(`
      UPDATE users 
      SET last_login = CURRENT_TIMESTAMP
      WHERE wallet_address = $1
    `, [wallet]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Wallet disconnect failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;