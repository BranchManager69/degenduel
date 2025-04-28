// /routes/tokens.js

import express from "express";
import { logApi } from "../utils/logger-suite/logger.js";
import prisma from '../config/prisma.js';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';

// WHY USING A NEW ROUTER???
// WE NEED TO CHECK FOR AUTH THROUGHOUT!!!
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Tokens
 *   description: API endpoints for token and bucket management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     TokenWithDetails:
 *       allOf:
 *         - $ref: '#/components/schemas/Token'
 *         - properties:
 *             token_prices:
 *               $ref: '#/components/schemas/TokenPrice'
 *             token_bucket_memberships:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/TokenBucketMembership'
 */

/* Tokens Routes */

/**
 * @swagger
 * /api/tokens:
 *   get:
 *     summary: Get all tokens with optional filters
 *     tags: [Tokens]
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: bucket
 *         schema:
 *           type: integer
 *         description: Filter by bucket ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by symbol or name
 *     responses:
 *       200:
 *         description: List of tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/TokenWithDetails'
 */
router.get("/", async (req, res) => {
  try {
    const { active, bucket, search } = req.query;

    const where = {
      AND: [
        active !== undefined ? { is_active: active === "true" } : {},
        bucket
          ? {
              token_bucket_memberships: {
                some: { bucket_id: parseInt(bucket) },
              },
            }
          : {},
        search
          ? {
              OR: [
                { symbol: { contains: search, mode: "insensitive" } },
                { name: { contains: search, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    };

    const tokens = await prisma.tokens.findMany({
      where,
      include: {
        token_prices: true,
        token_bucket_memberships: {
          include: {
            token_buckets: true,
          },
        },
      },
      orderBy: {
        market_cap: "desc",
      },
    });

    res.json(tokens);
  } catch (error) {
    logApi.error("Failed to fetch tokens:", error);
    res.status(500).json({ error: "Failed to fetch tokens" });
  }
});

/**
 * @swagger
 * /api/tokens/{id}:
 *   get:
 *     summary: Get token by ID
 *     tags: [Tokens]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Token ID
 *     responses:
 *       200:
 *         description: Token details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenWithDetails'
 *       404:
 *         $ref: '#/components/responses/TokenNotFound'
 */
router.get("/:id", async (req, res) => {
  try {
    // Validate id parameter
    if (!req.params.id) {
      return res.status(400).json({ error: "Token ID is required" });
    }

    const tokenId = parseInt(req.params.id);
    if (isNaN(tokenId)) {
      return res.status(400).json({ error: "Invalid token ID format" });
    }

    const token = await prisma.tokens.findUnique({
      where: { id: tokenId },
      include: {
        token_prices: true,
        token_bucket_memberships: {
          include: {
            token_buckets: true,
          },
        },
      },
    });

    if (!token) {
      return res.status(404).json({ error: "Token not found" });
    }

    res.json(token);
  } catch (error) {
    logApi.error("Failed to fetch token:", error);
    res.status(500).json({ error: "Failed to fetch token" });
  }
});

/**
 * @swagger
 * /api/tokens/prices:
 *   get:
 *     summary: Get current prices for all tokens
 *     tags: [Tokens]
 *     responses:
 *       200:
 *         description: Current token prices
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/TokenPrice'
 *                   - type: object
 *                     properties:
 *                       tokens:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           name:
 *                             type: string
 */
router.get("/prices", async (req, res) => {
  try {
    const prices = await prisma.token_prices.findMany({
      include: {
        tokens: {
          select: {
            symbol: true,
            name: true,
          },
        },
      },
    });

    res.json(prices);
  } catch (error) {
    logApi.error("Failed to fetch token prices:", error);
    res.status(500).json({ error: "Failed to fetch token prices" });
  }
});

/**
 * @swagger
 * /api/tokens/prices/{tokenId}:
 *   get:
 *     summary: Get price history for a specific token
 *     tags: [Tokens]
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Token ID
 *     responses:
 *       200:
 *         description: Token price history
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/TokenPrice'
 *                 - type: object
 *                   properties:
 *                     tokens:
 *                       type: object
 *                       properties:
 *                         symbol:
 *                           type: string
 *                         name:
 *                           type: string
 */
router.get("/prices/:tokenId", async (req, res) => {
  try {
    const price = await prisma.token_prices.findUnique({
      where: { token_id: parseInt(req.params.tokenId) },
      include: {
        tokens: {
          select: {
            symbol: true,
            name: true,
            market_cap: true,
            volume_24h: true,
            change_24h: true,
          },
        },
      },
    });

    if (!price) {
      return res.status(404).json({ error: "Token price not found" });
    }

    res.json(price);
  } catch (error) {
    logApi.error("Failed to fetch token price:", error);
    res.status(500).json({ error: "Failed to fetch token price" });
  }
});

/**
 * @swagger
 * /api/tokens:
 *   post:
 *     summary: Create a new token
 *     description: Create a new token with optional bucket assignment. Requires superadmin role.
 *     tags: [Tokens]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - symbol
 *               - name
 *             properties:
 *               symbol:
 *                 type: string
 *                 description: Token symbol (e.g., "BTC")
 *               name:
 *                 type: string
 *                 description: Token name (e.g., "Bitcoin")
 *               bucket_id:
 *                 type: integer
 *                 description: Optional bucket ID to assign the token to
 *               is_active:
 *                 type: boolean
 *                 default: true
 *                 description: Whether the token is active and available for trading
 *     responses:
 *       201:
 *         description: Token created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Token'
 *       400:
 *         description: Invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid input data
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Authentication required
 *       403:
 *         description: Not authorized
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Superadmin role required
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to create token
 */
router.post("/", async (req, res) => {
  // Implementation of POST request
});

/**
 * @swagger
 * /api/tokens/{id}:
 *   put:
 *     summary: Update a token
 *     description: Update an existing token's details. Requires superadmin role.
 *     tags: [Tokens]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Token ID to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               symbol:
 *                 type: string
 *                 description: Token symbol (e.g., "BTC")
 *               name:
 *                 type: string
 *                 description: Token name (e.g., "Bitcoin")
 *               is_active:
 *                 type: boolean
 *                 description: Whether the token is active and available for trading
 *               market_cap:
 *                 type: string
 *                 description: Token's market capitalization
 *               volume_24h:
 *                 type: string
 *                 description: 24-hour trading volume
 *               change_24h:
 *                 type: string
 *                 description: 24-hour price change percentage
 *     responses:
 *       200:
 *         description: Token updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Token'
 *       400:
 *         description: Invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid input data
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Authentication required
 *       403:
 *         description: Not authorized
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Superadmin role required
 *       404:
 *         description: Token not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Token not found
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to update token
 */
router.put("/:id", async (req, res) => {
  // Implementation of PUT request
});

router.get("/latest", async (req, res) => {
    if (!global.lastTokenData) {
        return res.status(404).json({ error: "No token data available yet" });
    }
    res.json({
        data: global.lastTokenData,
        timestamp: Date.now()
    });
});

/**
 * @swagger
 * /api/tokens/search:
 *   get:
 *     summary: Search for tokens by name, symbol, or address
 *     tags: [Tokens]
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query (minimum 2 characters)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of results to return
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 tokens:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       address:
 *                         type: string
 *                       name:
 *                         type: string
 *                       symbol:
 *                         type: string
 *                       price_usd:
 *                         type: number
 *                       market_cap:
 *                         type: number
 *                       total_supply:
 *                         type: number
 *                       circulating_supply:
 *                         type: number
 */
router.get("/search", async (req, res) => {
  try {
    const { query } = req.query;
    const limit = parseInt(req.query.limit) || 10;
    
    if (!query || query.length < 2) {
      return res.json({
        success: true,
        tokens: []
      });
    }
    
    // Search in the database for tokens matching the query
    const tokens = await prisma.tokens.findMany({
      where: {
        OR: [
          { address: { contains: query.toLowerCase() } },
          { name: { contains: query, mode: 'insensitive' } }, 
          { symbol: { contains: query, mode: 'insensitive' } }
        ],
        is_active: true
      },
      select: {
        address: true,
        name: true,
        symbol: true,
        price_usd: true,
        market_cap: true,
        total_supply: true,
        circulating_supply: true,
        logo_url: true,
        volume_24h: true,
        change_24h: true
      },
      orderBy: { market_cap: 'desc' },
      take: limit
    });
    
    res.json({
      success: true,
      tokens
    });
  } catch (error) {
    logApi.error("Failed to search tokens:", error);
    res.status(500).json({
      success: false,
      error: 'Failed to search tokens',
      message: error.message
    });
  }
});

export default router;
