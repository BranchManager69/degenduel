// /routes/dd-serv/tokens.js
import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: DD-Serv
 *   description: API endpoints for accessing token and market data from the DegenDuel Data Server
 */

/* DD-Serv Tokens Routes */

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
// Get OFFICIAL DD-Serv list of tokens
//   example: GET https://degenduel.me/api/dd-serv/tokens
router.get('/tokens', async (req, res) => {
  try {
    // Fetch from Server B's public endpoint
    const response = await fetch('https://data.degenduel.me/api/tokens');
    
    if (!response.ok) {
      // If data.degenduel.me responds with 4xx/5xx, handle it
      const text = await response.text();
      logApi.error(`[dd-serv] tokens fetch error ${response.status}: ${text}`);
      return res.status(response.status).json({ error: text });
    }

    // Parse the JSON from data.degenduel.me
    const tokenDataJson = await response.json();
    //logApi.info('[dd-serv] Fetched token list:', tokenDataJson);

    // Respond to the caller with the same JSON
    res.json(tokenDataJson);

  } catch (err) {
    // Catch network errors, etc.
    logApi.error('[dd-serv] Error fetching tokens:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/dd-serv/tokens/list:
 *   get:
 *     summary: Get a list of tokens with configurable detail level
 *     tags: [DD-Serv]
 *     parameters:
 *       - in: query
 *         name: detail
 *         schema:
 *           type: string
 *           enum: [simple, full]
 *         description: Level of detail to return (simple = address/name/symbol only, full = all token data)
 *         default: simple
 *     responses:
 *       200:
 *         description: An array of token information
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
// Get (official DD-Serv?*) list of tokens with configurable detail level (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/dd-serv/tokens/list?detail=simple
router.get('/tokens/list', async (req, res) => {
  try {
    const { detail = 'simple' } = req.query;
    
    // Fetch from Server B's public endpoint
    const response = await fetch('https://data.degenduel.me/api/tokens');
    
    if (!response.ok) {
      const text = await response.text();
      logApi.error(`[dd-serv] tokens fetch error ${response.status}: ${text}`);
      return res.status(response.status).json({ error: text });
    }

    const tokenDataJson = await response.json();
    
    if (detail === 'simple') {
      // Return simple token list with basic info
      const simpleTokens = tokenDataJson.data.map(token => ({
        contractAddress: token.contractAddress,
        name: token.name,
        symbol: token.symbol
      }));
      return res.json(simpleTokens);
    }
    
    // Return full flattened token data
    const flattenedTokens = tokenDataJson.data.map(token => ({
      timestamp: tokenDataJson.timestamp,
      id: token.id,
      symbol: token.symbol,
      name: token.name,
      contractAddress: token.contractAddress,
      chain: token.chain,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
      marketCap: token.marketCap,
      price: token.price,
      volume24h: token.volume24h,
      change_h1: token.changesJson?.h1,
      change_h6: token.changesJson?.h6,
      change_m5: token.changesJson?.m5,
      change_h24: token.changesJson?.h24,
      imageUrl: token.imageUrl,
      liquidity_usd: token.liquidity?.usd,
      liquidity_base: token.liquidity?.base,
      liquidity_quote: token.liquidity?.quote,
      pairUrl: token.pairUrl,
      transactions_h1_buys: token.transactionsJson?.h1?.buys,
      transactions_h1_sells: token.transactionsJson?.h1?.sells,
      transactions_h6_buys: token.transactionsJson?.h6?.buys,
      transactions_h6_sells: token.transactionsJson?.h6?.sells,
      transactions_m5_buys: token.transactionsJson?.m5?.buys,
      transactions_m5_sells: token.transactionsJson?.m5?.sells,
      transactions_h24_buys: token.transactionsJson?.h24?.buys,
      transactions_h24_sells: token.transactionsJson?.h24?.sells,
      baseToken_name: token.baseToken?.name,
      baseToken_symbol: token.baseToken?.symbol,
      baseToken_address: token.baseToken?.address,
      headerImage: token.headerImage,
      openGraphImage: token.openGraphImage,
      quoteToken_name: token.quoteToken?.name,
      quoteToken_symbol: token.quoteToken?.symbol,
      quoteToken_address: token.quoteToken?.address,
      websites: token.websites,
      coingeckoId: token.coingeckoId,
      priceChanges: token.priceChanges,
      socials: token.socials
    }));
    
    res.json(flattenedTokens);

  } catch (err) {
    logApi.error('[dd-serv] Error fetching token address list:', err);
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
// Get OFFICIAL DD-Serv price history of a token (NO AUTH REQUIRED)
//   example: GET https://degenduel.me/api/dd-serv/tokens/3c5mzP5u2QJHnc3GYifvjAYy7sxXq32fu3bwiUAepump/price-history
router.get('/tokens/:tokenAddress/price-history', async (req, res) => {
  const { tokenAddress } = req.params;
  try {
    const response = await fetch(`https://data.degenduel.me/api/tokens/${tokenAddress}/price-history`);
    const priceHistory = await response.json();
    res.json(priceHistory);
  } catch (err) {
    logApi.error('[dd-serv] Error fetching price history:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/dd-serv/tokens/bulk-price-history:
 *   post:
 *     summary: Get price history for multiple tokens
 *     tags: [DD-Serv]
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
 *         description: Object containing price histories for requested tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
// Get (official DD-Serv?*) price history for multiple tokens (NO AUTH REQUIRED)
//   example: POST https://degenduel.me/api/dd-serv/tokens/bulk-price-history
//   body: { "addresses": ["3c5mzP5u2QJHnc3GYifvjAYy7sxXq32fu3bwiUAepump", "sol11111111111111111111111111111111111111112"] }
router.post('/tokens/bulk-price-history', async (req, res) => {
  const { addresses } = req.body;
  
  if (!Array.isArray(addresses)) {
    return res.status(400).json({ error: 'addresses must be an array of strings' });
  }

  try {
    // Fetch price histories in parallel
    const priceHistories = await Promise.all(
      addresses.map(async (address) => {
        try {
          const response = await fetch(`https://data.degenduel.me/api/tokens/${address}/price-history`);
          if (!response.ok) {
            const text = await response.text();
            logApi.error(`[dd-serv] price history fetch error for ${address}: ${response.status}: ${text}`);
            return { [address]: { error: `Failed to fetch: ${text}` } };
          }
          const data = await response.json();
          return { [address]: data };
        } catch (err) {
          logApi.error(`[dd-serv] Error fetching price history for ${address}:`, err);
          return { [address]: { error: err.message } };
        }
      })
    );

    // Combine all results into a single object
    const result = Object.assign({}, ...priceHistories);
    res.json(result);

  } catch (err) {
    logApi.error('[dd-serv] Error in bulk price history:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
