// /api/dd-serv/tokens.js
import express from 'express';
//import { PrismaClient } from '@prisma/client';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: DD-Serv
 *   description: API endpoints for accessing token and market data from the DegenDuel Data Server
 */

/**
 * @swagger
 * /api/dd-serv/tokens:
 *   get:
 *     summary: Get a list of all tokens from the DD-Serv (data.degenduel.me)
 *     tags: [DD-Serv]
 *     responses:
 *       200:
 *         description: A list of tokens from the DD-Serv Data API
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 timestamp:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
// Get list of tokens
router.get('/tokens', async (req, res) => {
  try {
    // Fetch from Server B’s public endpoint
    const response = await fetch('https://data.degenduel.me/api/tokens');
    
    if (!response.ok) {
      // If data.degenduel.me responds with 4xx/5xx, handle it
      const text = await response.text();
      logger.error(`[dd-serv] tokens fetch error ${response.status}: ${text}`);
      return res.status(response.status).json({ error: text });
    }

    // Parse the JSON from data.degenduel.me
    const tokenDataJson = await response.json();
    logger.info('[dd-serv] Fetched token list:', tokenDataJson);

    // Respond to the caller with the same JSON
    res.json(tokenDataJson);

  } catch (err) {
    // Catch network errors, etc.
    logger.error('[dd-serv] Error fetching tokens:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/dd-serv/tokens/{tokenAddress}/price-history:
 *   get:
 *     summary: Get price history of a token
 *     tags: [DD-Serv]
 *     parameters:
 *       - in: path
 *         name: tokenAddress
 *         required: true
 *         description: The address of the token
 */
// Get price history of a token
router.get('/tokens/:tokenAddress/price-history', async (req, res) => {
  const { tokenAddress } = req.params;
  try {
    const response = await fetch(`https://data.degenduel.me/api/tokens/${tokenAddress}/price-history`);
    const priceHistory = await response.json();
    res.json(priceHistory);
  } catch (err) {
    logger.error('[dd-serv] Error fetching price history:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
