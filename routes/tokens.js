// /routes/tokens.js

import express from "express";
import { logApi } from "../utils/logger-suite/logger.js";
import prisma from '../config/prisma.js';
//import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';

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
 *         - type: object
 *           properties:
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
// Get all tokens (with optional filters)
//   example: GET https://degenduel.me/api/tokens
//      headers: { "Cookie": "session=<jwt>" }
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
// Get token by ID
//   example: GET https://degenduel.me/api/tokens/{token_id}
//      headers: { "Cookie": "session=<jwt>" }
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
// Get current prices for all tokens
//   example: GET https://degenduel.me/api/tokens/prices
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
 *                     properties:
 *                       tokens:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           name:
 *                             type: string
 *                           market_cap:
 *                             type: string
 *                           volume_24h:
 *                             type: string
 *                           change_24h:
 *                             type: string
 *       404:
 *         $ref: '#/components/responses/TokenNotFound'
 */
// Get price history for a specific token
//   example: GET https://degenduel.me/api/tokens/prices/1
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
 *         $ref: '#/components/responses/TokenNotFound'
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

//   example: POST https://degenduel.me/api/tokens
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "symbol": "BTC", "name": "Bitcoin", "bucket_id": 1 }
router.post("/", async (req, res) => {
  // Implementation of POST request
});

//   example: PUT https://degenduel.me/api/tokens/{token_id}
//      headers: { "Cookie": "session=<jwt>" }
//      body: { "symbol": "BTC", "name": "Bitcoin", "bucket_id": 1 }
router.put("/:id", async (req, res) => {
  // Implementation of PUT request
});

export default router;
