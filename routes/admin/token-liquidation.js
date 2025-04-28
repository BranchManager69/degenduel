/**
 * Token Liquidation API
 * 
 * API routes for the LiquiditySim service, allowing token liquidation simulation
 * and analysis via the admin dashboard.
 */

import express from 'express';
import liquiditySimService from '../../services/liquidity-sim/index.js';
import dexscreenerClient from '../../services/solana-engine/dexscreener-client.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';

const router = express.Router();

// Initialize service if needed
let serviceInitialized = false;
const ensureServiceInitialized = async (req, res, next) => {
  if (!serviceInitialized) {
    try {
      await liquiditySimService.initialize();
      serviceInitialized = true;
    } catch (error) {
      logApi.error('[LiquiditySim API] Error initializing service:', error);
      return res.status(500).json({ error: 'Failed to initialize LiquiditySim service' });
    }
  }
  next();
};

/**
 * @swagger
 * /api/admin/token-liquidation/search:
 *   get:
 *     summary: Search for tokens by name, symbol or address
 *     tags: [Token Liquidation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: query
 *         in: query
 *         required: true
 *         schema:
 *           type: string
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
 */
router.get('/search', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { query } = req.query;
    
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
        circulating_supply: true
      },
      orderBy: { market_cap: 'desc' },
      take: 10
    });
    
    res.json({
      success: true,
      tokens
    });
  } catch (error) {
    logApi.error('[LiquiditySim API] Error searching tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search tokens',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-liquidation/presets:
 *   get:
 *     summary: Get available volume profile presets
 *     tags: [Token Liquidation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Volume profile presets
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 presets:
 *                   type: object
 */
router.get('/presets', requireAuth, requireAdmin, ensureServiceInitialized, async (req, res) => {
  try {
    const presets = liquiditySimService.getVolumePresets();
    
    // Format presets for the API
    const formattedPresets = {};
    Object.entries(presets).forEach(([key, preset]) => {
      formattedPresets[key] = {
        name: preset.name,
        description: preset.description
      };
    });
    
    res.json({
      success: true,
      presets: formattedPresets
    });
  } catch (error) {
    logApi.error('[LiquiditySim API] Error getting presets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get volume profile presets',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-liquidation/token-info/{tokenAddress}:
 *   get:
 *     summary: Get token information for liquidation simulation
 *     tags: [Token Liquidation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: tokenAddress
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Token information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 tokenInfo:
 *                   type: object
 */
router.get('/token-info/:tokenAddress', requireAuth, requireAdmin, ensureServiceInitialized, async (req, res) => {
  try {
    const { tokenAddress } = req.params;
    
    // Ensure DexScreener client is initialized
    if (!dexscreenerClient.initialized) {
      await dexscreenerClient.initialize();
    }
    
    // Get token pools from DexScreener
    const poolsData = await dexscreenerClient.getTokenPools('solana', tokenAddress);
    
    if (!Array.isArray(poolsData) || poolsData.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No pools found for this token'
      });
    }
    
    // Sort pools by liquidity
    const sortedPools = [...poolsData].sort((a, b) => {
      const liquidityA = parseFloat(a.liquidity?.usd) || 0;
      const liquidityB = parseFloat(b.liquidity?.usd) || 0;
      return liquidityB - liquidityA;
    });
    
    // Use the top pool for market data
    const topPool = sortedPools[0];
    
    // Extract key metrics
    const price = parseFloat(topPool.priceUsd);
    const marketCap = parseFloat(topPool.marketCap);
    const fdv = parseFloat(topPool.fdv);
    const volume24h = parseFloat(topPool.volume?.h24);
    const liquidity = parseFloat(topPool.liquidity?.usd);
    
    // Extract pool reserves for simulation
    const baseReserve = parseFloat(topPool.liquidity?.base);
    const quoteReserve = parseFloat(topPool.liquidity?.quote);
    const baseSymbol = topPool.baseToken?.symbol || 'TOKEN';
    const quoteSymbol = topPool.quoteToken?.symbol || 'SOL';
    
    // Calculate circulating and total supply
    const circulatingSupply = price ? marketCap / price : null;
    const totalSupply = price ? fdv / price : null;
    
    // Prepare token info for the response
    const tokenInfo = {
      address: tokenAddress,
      name: topPool.baseToken?.name || 'Unknown',
      symbol: baseSymbol,
      price,
      marketCap,
      fdv,
      volume24h,
      liquidity,
      baseReserve,
      quoteReserve,
      quoteSymbol,
      circulatingSupply,
      totalSupply,
      dex: topPool.dexId,
      pair: topPool.pairAddress
    };
    
    res.json({
      success: true,
      tokenInfo
    });
  } catch (error) {
    logApi.error('[LiquiditySim API] Error getting token info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get token information',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-liquidation/simulate:
 *   post:
 *     summary: Run a token liquidation simulation
 *     tags: [Token Liquidation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - totalSupply
 *               - currentPrice
 *               - baseReserve
 *               - quoteReserve
 *             properties:
 *               totalSupply:
 *                 type: number
 *               currentPrice:
 *                 type: number
 *               baseReserve:
 *                 type: number
 *               quoteReserve:
 *                 type: number
 *               acquisitionLevel:
 *                 type: string
 *                 enum: [low, medium, high]
 *               personalRatio:
 *                 type: number
 *               days:
 *                 type: number
 *               scenarioType:
 *                 type: string
 *               calculateExact:
 *                 type: boolean
 *               includeDailyDetails:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Simulation results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: object
 */
router.post('/simulate', requireAuth, requireAdmin, ensureServiceInitialized, async (req, res) => {
  try {
    const {
      totalSupply,
      currentPrice,
      baseReserve,
      quoteReserve,
      acquisitionLevel = 'medium',
      personalRatio = 0.5,
      days = 180,
      scenarioType = 'baseCase',
      customVolumeProfile = null,
      priceImpactConstraints,
      sellingStrategies,
      calculateExact = false,
      includeDailyDetails = false,
      useCache = true
    } = req.body;
    
    // Validate required parameters
    if (!totalSupply || !currentPrice || !baseReserve || !quoteReserve) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }
    
    // Run the simulation
    const results = liquiditySimService.runSimulation({
      totalSupply,
      currentPrice,
      baseReserve,
      quoteReserve,
      acquisitionLevel,
      personalRatio,
      days,
      scenarioType,
      customVolumeProfile,
      priceImpactConstraints,
      sellingStrategies,
      calculateExact,
      includeDailyDetails
    }, useCache);
    
    res.json({
      success: true,
      results
    });
  } catch (error) {
    logApi.error('[LiquiditySim API] Error running simulation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run simulation',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-liquidation/simulation-grid:
 *   post:
 *     summary: Run a grid of token liquidation simulations
 *     tags: [Token Liquidation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - totalSupply
 *               - currentPrice
 *               - baseReserve
 *               - quoteReserve
 *             properties:
 *               totalSupply:
 *                 type: number
 *               currentPrice:
 *                 type: number
 *               baseReserve:
 *                 type: number
 *               quoteReserve:
 *                 type: number
 *               personalRatio:
 *                 type: number
 *               acquisitionLevels:
 *                 type: array
 *               scenarios:
 *                 type: array
 *               days:
 *                 type: number
 *               calculateExact:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Grid simulation results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: object
 */
router.post('/simulation-grid', requireAuth, requireAdmin, ensureServiceInitialized, async (req, res) => {
  try {
    const {
      totalSupply,
      currentPrice,
      baseReserve,
      quoteReserve,
      personalRatio = 0.5,
      acquisitionLevels = ['low', 'medium', 'high'],
      scenarios = ['baseCase', 'bullCase', 'bearCase'],
      days = 180,
      calculateExact = false,
      useCache = true
    } = req.body;
    
    // Validate required parameters
    if (!totalSupply || !currentPrice || !baseReserve || !quoteReserve) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }
    
    // Run the grid simulation
    const results = liquiditySimService.runSimulationGrid({
      totalSupply,
      currentPrice,
      baseReserve,
      quoteReserve,
      personalRatio,
      acquisitionLevels,
      scenarios,
      days,
      calculateExact
    }, useCache);
    
    res.json({
      success: true,
      results
    });
  } catch (error) {
    logApi.error('[LiquiditySim API] Error running grid simulation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run grid simulation',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-liquidation/get-max-tokens:
 *   post:
 *     summary: Calculate the maximum tokens that can be sold with a given price impact
 *     tags: [Token Liquidation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - maxPriceImpactPct
 *               - poolBaseReserve
 *               - poolQuoteReserve
 *             properties:
 *               maxPriceImpactPct:
 *                 type: number
 *               poolBaseReserve:
 *                 type: number
 *               poolQuoteReserve:
 *                 type: number
 *               exact:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Maximum tokens calculation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 maxTokens:
 *                   type: number
 */
router.post('/get-max-tokens', requireAuth, requireAdmin, ensureServiceInitialized, async (req, res) => {
  try {
    const {
      maxPriceImpactPct,
      poolBaseReserve,
      poolQuoteReserve,
      exact = false
    } = req.body;
    
    // Validate required parameters
    if (maxPriceImpactPct === undefined || !poolBaseReserve || !poolQuoteReserve) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }
    
    // Calculate max tokens
    const maxTokens = liquiditySimService.getMaxTokensForPriceImpact(
      maxPriceImpactPct,
      poolBaseReserve,
      poolQuoteReserve,
      exact
    );
    
    res.json({
      success: true,
      maxTokens
    });
  } catch (error) {
    logApi.error('[LiquiditySim API] Error calculating max tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate maximum tokens',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-liquidation/simulate-sell:
 *   post:
 *     summary: Simulate selling a specific amount of tokens
 *     tags: [Token Liquidation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tokenAmount
 *               - poolBaseReserve
 *               - poolQuoteReserve
 *             properties:
 *               tokenAmount:
 *                 type: number
 *               poolBaseReserve:
 *                 type: number
 *               poolQuoteReserve:
 *                 type: number
 *     responses:
 *       200:
 *         description: Sell simulation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 result:
 *                   type: object
 */
router.post('/simulate-sell', requireAuth, requireAdmin, ensureServiceInitialized, async (req, res) => {
  try {
    const {
      tokenAmount,
      poolBaseReserve,
      poolQuoteReserve
    } = req.body;
    
    // Validate required parameters
    if (!tokenAmount || !poolBaseReserve || !poolQuoteReserve) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }
    
    // Simulate sell
    const result = liquiditySimService.simulateSell(
      tokenAmount,
      poolBaseReserve,
      poolQuoteReserve
    );
    
    res.json({
      success: true,
      result
    });
  } catch (error) {
    logApi.error('[LiquiditySim API] Error simulating sell:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to simulate token selling',
      message: error.message
    });
  }
});

export default router;