/**
 * Token Refresh Management Routes
 * 
 * API routes for managing and monitoring the advanced token refresh scheduler,
 * allowing admins to control and optimize token price refreshing.
 */

import express from 'express';
import prisma from '../../config/prisma.js';
import { roleCheck } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import tokenRefreshIntegration from '../../services/token-refresh-integration.js';

const router = express.Router();

/**
 * @swagger
 * /api/admin/token-refresh/status:
 *   get:
 *     summary: Get token refresh scheduler status
 *     tags: [Admin, TokenRefresh]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Scheduler status
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/status', roleCheck(['admin', 'superadmin']), async (req, res) => {
  try {
    // Get metrics from scheduler
    const metrics = await tokenRefreshIntegration.getSchedulerMetrics();
    
    return res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logApi.error('Error getting token refresh status:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-refresh/recommendations:
 *   get:
 *     summary: Get token refresh recommendations
 *     tags: [Admin, TokenRefresh]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Refresh recommendations
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/recommendations', roleCheck(['admin', 'superadmin']), async (req, res) => {
  try {
    // Get recommendations
    const recommendations = await tokenRefreshIntegration.getRefreshRecommendations();
    
    return res.json({
      success: true,
      data: recommendations
    });
  } catch (error) {
    logApi.error('Error getting token refresh recommendations:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-refresh/tokens:
 *   get:
 *     summary: Get token refresh settings
 *     tags: [Admin, TokenRefresh]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of tokens to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of tokens to skip
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [priority, interval, last_refresh]
 *           default: priority
 *         description: Sort field
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Token refresh settings
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/tokens', roleCheck(['admin', 'superadmin']), async (req, res) => {
  try {
    // Parse query parameters
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const sort = req.query.sort || 'priority';
    const order = req.query.order || 'desc';
    
    // Map sort field to database field
    let orderBy = {};
    switch (sort) {
      case 'priority':
        orderBy.priority_score = order;
        break;
      case 'interval':
        orderBy.refresh_interval_seconds = order;
        break;
      case 'last_refresh':
        orderBy.last_refresh_success = order;
        break;
      default:
        orderBy.priority_score = order;
    }
    
    // Get tokens with refresh settings
    const tokens = await prisma.tokens.findMany({
      where: {
        is_active: true
      },
      select: {
        id: true,
        address: true,
        symbol: true,
        name: true,
        refresh_interval_seconds: true,
        priority_score: true,
        last_refresh_attempt: true,
        last_refresh_success: true,
        last_price_change: true,
        token_prices: {
          select: {
            price: true,
            updated_at: true
          }
        },
        rank_history: {
          orderBy: {
            timestamp: 'desc'
          },
          take: 1,
          select: {
            rank: true,
            timestamp: true
          }
        }
      },
      orderBy,
      skip: offset,
      take: limit
    });
    
    // Get total count
    const totalCount = await prisma.tokens.count({
      where: {
        is_active: true
      }
    });
    
    return res.json({
      success: true,
      data: {
        tokens,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + tokens.length < totalCount
        }
      }
    });
  } catch (error) {
    logApi.error('Error getting token refresh settings:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-refresh/tokens/{tokenId}:
 *   put:
 *     summary: Update token refresh settings
 *     tags: [Admin, TokenRefresh]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Token ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refresh_interval_seconds:
 *                 type: integer
 *                 description: Refresh interval in seconds
 *               priority_score:
 *                 type: integer
 *                 description: Priority score
 *               metadata:
 *                 type: object
 *                 description: Additional metadata
 *     responses:
 *       200:
 *         description: Settings updated
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Token not found
 *       500:
 *         description: Server error
 */
router.put('/tokens/:tokenId', roleCheck(['admin', 'superadmin']), async (req, res) => {
  try {
    const tokenId = parseInt(req.params.tokenId);
    
    // Check if token exists
    const token = await prisma.tokens.findUnique({
      where: { id: tokenId }
    });
    
    if (!token) {
      return res.status(404).json({
        success: false,
        error: 'Token not found'
      });
    }
    
    // Update token refresh settings
    const result = await tokenRefreshIntegration.updateTokenRefreshSettings(tokenId, {
      refresh_interval_seconds: req.body.refresh_interval_seconds,
      priority_score: req.body.priority_score,
      metadata: req.body.metadata
    });
    
    if (result.success) {
      return res.json({
        success: true,
        message: result.message
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    logApi.error('Error updating token refresh settings:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-refresh/tokens/{tokenAddress}/refresh:
 *   post:
 *     summary: Manually refresh a token
 *     tags: [Admin, TokenRefresh]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tokenAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: Token address
 *     responses:
 *       200:
 *         description: Token refreshed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Token not found
 *       500:
 *         description: Server error
 */
router.post('/tokens/:tokenAddress/refresh', roleCheck(['admin', 'superadmin']), async (req, res) => {
  try {
    const tokenAddress = req.params.tokenAddress;
    
    // Refresh token
    const result = await tokenRefreshIntegration.refreshToken(tokenAddress);
    
    if (result.success) {
      return res.json({
        success: true,
        message: result.message
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    logApi.error('Error refreshing token:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-refresh/bulk-update:
 *   post:
 *     summary: Update refresh settings for multiple tokens
 *     tags: [Admin, TokenRefresh]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tokens:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: Token ID
 *                     refresh_interval_seconds:
 *                       type: integer
 *                       description: Refresh interval in seconds
 *                     priority_score:
 *                       type: integer
 *                       description: Priority score
 *     responses:
 *       200:
 *         description: Settings updated
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/bulk-update', roleCheck(['admin', 'superadmin']), async (req, res) => {
  try {
    // Validate request
    if (!req.body.tokens || !Array.isArray(req.body.tokens)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request body'
      });
    }
    
    // Update tokens
    const updatePromises = req.body.tokens.map(token => 
      tokenRefreshIntegration.updateTokenRefreshSettings(token.id, {
        refresh_interval_seconds: token.refresh_interval_seconds,
        priority_score: token.priority_score
      })
    );
    
    // Wait for all updates to complete
    const results = await Promise.all(updatePromises);
    
    // Count successful updates
    const successCount = results.filter(r => r.success).length;
    
    return res.json({
      success: true,
      message: `Updated ${successCount}/${req.body.tokens.length} tokens`
    });
  } catch (error) {
    logApi.error('Error bulk updating token refresh settings:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-refresh/apply-tier-settings:
 *   post:
 *     summary: Apply recommended tier settings to tokens
 *     tags: [Admin, TokenRefresh]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Settings applied
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/apply-tier-settings', roleCheck(['admin', 'superadmin']), async (req, res) => {
  try {
    // Get recommendations
    const recommendations = await tokenRefreshIntegration.getRefreshRecommendations();
    
    // Get all active tokens
    const tokens = await prisma.tokens.findMany({
      where: { is_active: true },
      select: {
        id: true,
        address: true,
        rank_history: {
          orderBy: { timestamp: 'desc' },
          take: 1,
          select: { rank: true }
        }
      }
    });
    
    // Apply tier settings based on rank
    const updates = [];
    for (const token of tokens) {
      const rank = token.rank_history?.[0]?.rank;
      let tierSettings = null;
      
      // Determine tier based on rank
      if (rank !== undefined) {
        if (rank <= 50) {
          tierSettings = recommendations.recommendations.tier1;
        } else if (rank <= 200) {
          tierSettings = recommendations.recommendations.tier2;
        } else if (rank <= 500) {
          tierSettings = recommendations.recommendations.tier3;
        } else if (rank <= 1000) {
          tierSettings = recommendations.recommendations.tier4;
        } else {
          tierSettings = recommendations.recommendations.tier5;
        }
      } else {
        // No rank - use tier5
        tierSettings = recommendations.recommendations.tier5;
      }
      
      if (tierSettings) {
        // Queue update with recommended settings
        updates.push(
          tokenRefreshIntegration.updateTokenRefreshSettings(token.id, {
            refresh_interval_seconds: tierSettings.adjustedInterval,
            priority_score: rank ? Math.max(1000 - rank, 10) : 10 // Higher score for lower rank
          })
        );
      }
    }
    
    // Execute all updates
    const results = await Promise.all(updates);
    const successCount = results.filter(r => r.success).length;
    
    return res.json({
      success: true,
      message: `Applied tier settings to ${successCount}/${tokens.length} tokens`
    });
  } catch (error) {
    logApi.error('Error applying tier settings:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;