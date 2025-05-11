// routes/admin/token-activation.js

/**
 * Token Activation Management Routes
 *
 * API routes for managing and triggering the token activation service,
 * allowing admins to control which tokens are active in the system.
 *
 * NOTE: The token activation service is designed to run automatically
 * at regular intervals (every 15 minutes by default). It will evaluate
 * tokens based on their market cap, volume, and age to set the is_active flag.
 */

import express from 'express';
import prisma from '../../config/prisma.js';
import { roleCheck } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import tokenActivationService from '../../services/token-activation/index.js';
import AdminLogger from '../../utils/admin-logger.js';

const router = express.Router();
const adminLogger = new AdminLogger('token-activation');

/**
 * @swagger
 * /api/admin/token-activation/status:
 *   get:
 *     summary: Get token activation service status
 *     tags: [Admin, TokenActivation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Activation service status
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/status', roleCheck(['admin', 'superadmin']), async (req, res) => {
  try {
    // Get service status
    const isStarted = tokenActivationService.isStarted;
    const isProcessing = tokenActivationService.isProcessing;
    const stats = tokenActivationService.stats || {};
    
    // Get token counts
    const activeTokenCount = await prisma.tokens.count({
      where: { is_active: true }
    });
    
    const tokenCount = await prisma.tokens.count();
    
    return res.json({
      success: true,
      data: {
        service: {
          isStarted,
          isProcessing,
          stats
        },
        tokens: {
          active: activeTokenCount,
          total: tokenCount,
          percentage: tokenCount > 0 ? ((activeTokenCount / tokenCount) * 100).toFixed(2) : 0
        }
      }
    });
  } catch (error) {
    logApi.error('Error getting token activation status:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-activation/run:
 *   post:
 *     summary: Manually run the token activation process
 *     tags: [Admin, TokenActivation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token activation started
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/run', roleCheck(['admin', 'superadmin']), async (req, res) => {
  try {
    // Check if service is running
    if (!tokenActivationService.isStarted) {
      return res.status(400).json({
        success: false,
        error: 'Token activation service is not running'
      });
    }
    
    // Check if already processing
    if (tokenActivationService.isProcessing) {
      return res.status(400).json({
        success: false,
        error: 'Token activation is already in progress'
      });
    }
    
    // Log the admin action
    adminLogger.log(req.user, 'Manually triggered token activation', {
      action: 'manual_token_activation',
      user: req.user.id,
      timestamp: new Date()
    });
    
    // Trigger token activation
    tokenActivationService.updateTokenStatuses()
      .then(() => {
        logApi.info('Manual token activation completed successfully');
      })
      .catch(error => {
        logApi.error('Error during manual token activation:', error);
      });
    
    // Return immediately to avoid blocking
    return res.json({
      success: true,
      message: 'Token activation process started. This will run in the background.'
    });
  } catch (error) {
    logApi.error('Error triggering token activation:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-activation/active-tokens:
 *   get:
 *     summary: Get list of active tokens
 *     tags: [Admin, TokenActivation]
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
 *           enum: [symbol, name, first_seen]
 *           default: first_seen
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
 *         description: List of active tokens
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/active-tokens', roleCheck(['admin', 'superadmin']), async (req, res) => {
  try {
    // Parse query parameters
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const sort = req.query.sort || 'first_seen_on_jupiter_at';
    const order = req.query.order || 'desc';
    
    // Map sort field to database field
    let orderBy = {};
    switch (sort) {
      case 'symbol':
        orderBy.symbol = order;
        break;
      case 'name':
        orderBy.name = order;
        break;
      case 'first_seen':
        orderBy.first_seen_on_jupiter_at = order;
        break;
      default:
        orderBy.first_seen_on_jupiter_at = order;
    }
    
    // Get active tokens
    const tokens = await prisma.tokens.findMany({
      where: {
        is_active: true
      },
      select: {
        id: true,
        address: true,
        symbol: true,
        name: true,
        first_seen_on_jupiter_at: true,
        last_is_active_evaluation_at: true,
        manually_activated: true,
        token_prices: {
          select: {
            price: true,
            market_cap: true,
            volume_24h: true,
            updated_at: true
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
    logApi.error('Error getting active tokens:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/admin/token-activation/toggle-manual/{tokenId}:
 *   post:
 *     summary: Toggle manual activation for a token
 *     tags: [Admin, TokenActivation]
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
 *               manually_activated:
 *                 type: boolean
 *                 description: Whether the token should be manually activated
 *     responses:
 *       200:
 *         description: Manual activation toggled
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Token not found
 *       500:
 *         description: Server error
 */
router.post('/toggle-manual/:tokenId', roleCheck(['admin', 'superadmin']), async (req, res) => {
  try {
    const tokenId = parseInt(req.params.tokenId);
    const { manually_activated } = req.body;
    
    if (manually_activated === undefined) {
      return res.status(400).json({
        success: false,
        error: 'manually_activated field is required'
      });
    }
    
    // Check if token exists
    const token = await prisma.tokens.findUnique({
      where: { id: tokenId },
      select: { id: true, symbol: true, address: true }
    });
    
    if (!token) {
      return res.status(404).json({
        success: false,
        error: 'Token not found'
      });
    }
    
    // Update token's manual activation status
    await prisma.tokens.update({
      where: { id: tokenId },
      data: { 
        manually_activated,
        is_active: manually_activated, // If manually activating, set is_active to true right away
        last_is_active_evaluation_at: new Date()
      }
    });
    
    // Log the admin action
    adminLogger.log(req.user, `${manually_activated ? 'Manually activated' : 'Manually deactivated'} token ${token.symbol}`, {
      action: manually_activated ? 'manual_token_activation' : 'manual_token_deactivation',
      user: req.user.id,
      token: tokenId,
      token_symbol: token.symbol,
      token_address: token.address,
      timestamp: new Date()
    });
    
    return res.json({
      success: true,
      message: `Token ${manually_activated ? 'manually activated' : 'manual activation removed'} successfully`
    });
  } catch (error) {
    logApi.error('Error toggling manual token activation:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;