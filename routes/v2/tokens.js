// /routes/v2/tokens.js

import { Router } from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import tokenWhitelistService from '../../services/tokenWhitelistService.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import AdminLogger from '../../utils/admin-logger.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: V2 Tokens
 *   description: V2 token endpoints using contract addresses
 */

/**
 * @swagger
 * /api/v2/tokens/addresses:
 *   get:
 *     summary: Get all token addresses
 *     tags: [V2 Tokens]
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Set to 'true' to get only active tokens
 *     responses:
 *       200:
 *         description: Array of token contract addresses
 */
router.get('/addresses', async (req, res) => {
  const { active } = req.query;
  
  try {
    logApi.info('Fetching token addresses', { active });
    
    const addresses = await prisma.tokens.findMany({
      where: active === 'true' ? { is_active: true } : {},
      select: {
        contract_address: true
      }
    });

    res.json(addresses.map(token => token.contract_address));
  } catch (error) {
    logApi.error('Failed to fetch token addresses', { error });
    res.status(500).json({ error: 'Failed to fetch token addresses' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/by-address/{contractAddress}:
 *   get:
 *     summary: Get token by address
 *     tags: [V2 Tokens]
 *     parameters:
 *       - in: path
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Token information
 */
router.get('/by-address/:contractAddress', async (req, res) => {
  const { contractAddress } = req.params;
  
  try {
    logApi.info('Fetching token by address', { contractAddress });
    
    const token = await prisma.tokens.findUnique({
      where: { contract_address: contractAddress },
      select: {
        contract_address: true,
        name: true,
        symbol: true,
        price: true,
        market_cap: true,
        volume_24h: true
      }
    });

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    res.json({
      contractAddress: token.contract_address,
      name: token.name,
      symbol: token.symbol,
      price: token.price?.toString(),
      marketCap: token.market_cap?.toString(),
      volume24h: token.volume_24h?.toString()
    });
  } catch (error) {
    logApi.error('Failed to fetch token', { error, contractAddress });
    res.status(500).json({ error: 'Failed to fetch token' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/search:
 *   get:
 *     summary: Search tokens by name or symbol
 *     tags: [V2 Tokens]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Array of matching tokens
 */
router.get('/search', async (req, res) => {
  const { q, limit = 10 } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    logApi.info('Searching tokens', { query: q, limit });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { symbol: { contains: q, mode: 'insensitive' } }
        ]
      },
      take: parseInt(limit),
      select: {
        contract_address: true,
        name: true,
        symbol: true,
        price: true,
        market_cap: true,
        volume_24h: true
      }
    });

    res.json(tokens.map(token => ({
      contractAddress: token.contract_address,
      name: token.name,
      symbol: token.symbol,
      price: token.price?.toString(),
      marketCap: token.market_cap?.toString(),
      volume24h: token.volume_24h?.toString()
    })));
  } catch (error) {
    logApi.error('Failed to search tokens', { error, query: q });
    res.status(500).json({ error: 'Failed to search tokens' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/market-data/{contractAddress}:
 *   get:
 *     summary: Get token market data
 *     tags: [V2 Tokens]
 *     parameters:
 *       - in: path
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detailed market data for token
 */
router.get('/market-data/:contractAddress', async (req, res) => {
  const { contractAddress } = req.params;
  
  try {
    logApi.info('Fetching token market data', { contractAddress });
    
    const token = await prisma.tokens.findUnique({
      where: { contract_address: contractAddress },
      include: {
        token_market_data: true,
        token_liquidity: true,
        token_transactions: {
          where: {
            timestamp: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
            }
          }
        }
      }
    });

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    res.json({
      price: token.price?.toString(),
      marketCap: token.market_cap?.toString(),
      volume24h: token.volume_24h?.toString(),
      change24h: token.token_market_data?.price_change_24h?.toString(),
      liquidity: token.token_liquidity ? {
        usd: token.token_liquidity.usd_value?.toString(),
        base: token.token_liquidity.base_amount?.toString(),
        quote: token.token_liquidity.quote_amount?.toString()
      } : null,
      transactions24h: {
        buys: token.token_transactions.filter(tx => tx.type === 'BUY').length,
        sells: token.token_transactions.filter(tx => tx.type === 'SELL').length
      }
    });
  } catch (error) {
    logApi.error('Failed to fetch token market data', { error, contractAddress });
    res.status(500).json({ error: 'Failed to fetch token market data' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/images:
 *   post:
 *     summary: Get token images
 *     tags: [V2 Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - addresses
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Token image URLs
 */
router.post('/images', async (req, res) => {
  const { addresses } = req.body;
  
  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({ error: 'Invalid addresses array' });
  }

  try {
    logApi.info('Fetching token images', { addressCount: addresses.length });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        contract_address: { in: addresses }
      },
      select: {
        contract_address: true,
        image_url: true,
        header_image: true,
        og_image: true
      }
    });

    const result = {};
    tokens.forEach(token => {
      result[token.contract_address] = {
        imageUrl: token.image_url,
        headerImage: token.header_image,
        openGraphImage: token.og_image
      };
    });

    res.json(result);
  } catch (error) {
    logApi.error('Failed to fetch token images', { error, addressCount: addresses.length });
    res.status(500).json({ error: 'Failed to fetch token images' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/liquidity:
 *   post:
 *     summary: Get token liquidity
 *     tags: [V2 Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - addresses
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Token liquidity information
 */
router.post('/liquidity', async (req, res) => {
  const { addresses } = req.body;
  
  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({ error: 'Invalid addresses array' });
  }

  try {
    logApi.info('Fetching token liquidity', { addressCount: addresses.length });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        contract_address: { in: addresses }
      },
      include: {
        token_liquidity: true
      }
    });

    const result = {};
    tokens.forEach(token => {
      if (token.token_liquidity) {
        result[token.contract_address] = {
          usd: token.token_liquidity.usd_value?.toString(),
          base: token.token_liquidity.base_amount?.toString(),
          quote: token.token_liquidity.quote_amount?.toString()
        };
      }
    });

    res.json(result);
  } catch (error) {
    logApi.error('Failed to fetch token liquidity', { error, addressCount: addresses.length });
    res.status(500).json({ error: 'Failed to fetch token liquidity' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/websites:
 *   post:
 *     summary: Get token websites
 *     tags: [V2 Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - addresses
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Token website information
 */
router.post('/websites', async (req, res) => {
  const { addresses } = req.body;
  
  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({ error: 'Invalid addresses array' });
  }

  try {
    logApi.info('Fetching token websites', { addressCount: addresses.length });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        contract_address: { in: addresses }
      },
      include: {
        token_websites: true
      }
    });

    const result = {};
    tokens.forEach(token => {
      result[token.contract_address] = token.token_websites.map(website => ({
        url: website.url,
        label: website.label
      }));
    });

    res.json(result);
  } catch (error) {
    logApi.error('Failed to fetch token websites', { error, addressCount: addresses.length });
    res.status(500).json({ error: 'Failed to fetch token websites' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/socials:
 *   post:
 *     summary: Get token social media
 *     tags: [V2 Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - addresses
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Token social media information
 */
router.post('/socials', async (req, res) => {
  const { addresses } = req.body;
  
  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({ error: 'Invalid addresses array' });
  }

  try {
    logApi.info('Fetching token socials', { addressCount: addresses.length });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        contract_address: { in: addresses }
      },
      include: {
        token_socials: true
      }
    });

    const result = {};
    tokens.forEach(token => {
      result[token.contract_address] = {};
      token.token_socials.forEach(social => {
        result[token.contract_address][social.platform] = {
          url: social.url,
          count: social.follower_count
        };
      });
    });

    res.json(result);
  } catch (error) {
    logApi.error('Failed to fetch token socials', { error, addressCount: addresses.length });
    res.status(500).json({ error: 'Failed to fetch token socials' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/prices/batch:
 *   post:
 *     summary: Get batch token prices
 *     tags: [V2 Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - addresses
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Token prices and 24h changes
 */
router.post('/prices/batch', async (req, res) => {
  const { addresses } = req.body;
  
  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({ error: 'Invalid addresses array' });
  }

  try {
    logApi.info('Fetching batch token prices', { addressCount: addresses.length });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        contract_address: { in: addresses }
      },
      include: {
        token_market_data: true
      }
    });

    const result = {};
    tokens.forEach(token => {
      result[token.contract_address] = {
        price: token.price?.toString(),
        change24h: token.token_market_data?.price_change_24h?.toString()
      };
    });

    res.json(result);
  } catch (error) {
    logApi.error('Failed to fetch batch token prices', { error, addressCount: addresses.length });
    res.status(500).json({ error: 'Failed to fetch batch token prices' });
  }
});

// Get latest market data for all active tokens
router.get('/marketData/latest', async (req, res) => {
    try {
        const tokens = await prisma.tokens.findMany({
            where: { is_active: true },
            include: {
                token_prices: true
            }
        });

        const marketData = tokens.map(token => ({
            address: token.contract_address,
            symbol: token.symbol,
            name: token.name,
            price: token.token_prices?.price || 0,
            market_cap: token.market_cap || 0,
            change_24h: token.change_24h || 0,
            volume_24h: token.volume_24h || 0,
            last_updated: token.token_prices?.updated_at || null
        }));

        res.json({
            success: true,
            data: marketData,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error('Failed to fetch market data:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch market data' 
        });
    }
});

// Rate limiter: 10 requests per hour per IP
const whitelistLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many whitelist requests, please try again later' }
});

/**
 * @swagger
 * /api/v2/tokens/whitelist:
 *   post:
 *     summary: Add a token to the whitelist
 *     tags: [V2 Tokens]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contractAddress
 *               - transactionSignature
 *             properties:
 *               contractAddress:
 *                 type: string
 *                 description: SPL token address
 *               transactionSignature:
 *                 type: string
 *                 description: Payment transaction signature
 *     responses:
 *       200:
 *         description: Token whitelisted successfully
 *       400:
 *         description: Invalid input or verification failed
 *       401:
 *         description: Not authenticated
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
router.post('/whitelist', requireAuth, whitelistLimiter, async (req, res) => {
    const { contractAddress, transactionSignature } = req.body;
    const logContext = {
        path: 'POST /api/v2/tokens/whitelist',
        contractAddress,
        signature: transactionSignature,
        userId: req.user?.id,
        wallet: req.user?.wallet_address
    };

    try {
        logApi.info('Token whitelist request received', logContext);

        // Step 1: Verify the token and get metadata
        const metadata = await tokenWhitelistService.verifyToken(contractAddress);

        // Step 2: Verify the payment
        await tokenWhitelistService.verifyPayment(transactionSignature, req.user.wallet_address, req.user);

        // Step 3: Add to whitelist with metadata
        const token = await tokenWhitelistService.addToWhitelist(contractAddress, metadata);

        logApi.info('Token whitelisted successfully', {
            ...logContext,
            tokenId: token.id,
            metadata
        });

        res.json({
            success: true,
            token: {
                address: token.address,
                name: token.name,
                symbol: token.symbol,
                status: 'pending'
            }
        });
    } catch (error) {
        logApi.error('Token whitelist request failed:', {
            ...logContext,
            error: error.message
        });

        const status = error.status || 500;
        const message = error.message || 'Internal server error';

        res.status(status).json({
            success: false,
            error: message
        });
    }
});

/**
 * @swagger
 * /api/v2/tokens/{contractAddress}:
 *   delete:
 *     summary: Remove a token from the whitelist (Admin only)
 *     tags: [V2 Tokens]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for token removal
 *     responses:
 *       200:
 *         description: Token removed successfully
 *       401:
 *         description: Not authenticated or not an admin
 *       404:
 *         description: Token not found
 *       500:
 *         description: Server error
 */
router.delete('/:contractAddress', requireAuth, requireAdmin, async (req, res) => {
    const { contractAddress } = req.params;
    const { reason } = req.body;

    if (!reason) {
        return res.status(400).json({
            success: false,
            error: 'Reason for removal is required'
        });
    }

    try {
        // Forward deletion request to market data API
        const response = await fetch(`https://data.degenduel.me/api/tokens/${contractAddress}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        // Log admin action regardless of market data API response
        await AdminLogger.logAction(
            req.user.id,
            'TOKEN_REMOVAL',
            {
                contract_address: contractAddress,
                reason: reason,
                market_data_response: result
            },
            {
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }
        );

        // Forward the market data API response
        res.json(result);
    } catch (error) {
        logApi.error('Failed to remove token:', {
            contractAddress,
            adminId: req.user.id,
            error: error.message
        });

        res.status(500).json({
            success: false,
            error: 'Failed to remove token'
        });
    }
});

export default router;