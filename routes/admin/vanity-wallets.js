// routes/admin/vanity-wallets.js

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import VanityApiClient from '../../services/vanity-wallet/vanity-api-client.js';
import { requireSuperAdmin, requireAdmin } from '../../middleware/auth.js';
import AdminLogger from '../../utils/admin-logger.js';
import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import config from '../../config/config.js';
import prisma from '../../config/prisma.js';

const router = express.Router();

/**
 * GET /api/admin/vanity-wallets
 * Get all vanity wallets with optional filtering
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { 
      status, 
      isUsed, 
      pattern, 
      limit = 100, 
      offset = 0 
    } = req.query;
    
    // Parse boolean parameters
    const parsedIsUsed = isUsed === 'true' ? true : 
                       isUsed === 'false' ? false : undefined;
    
    // Get wallets with API client
    const result = await VanityApiClient.getVanityWallets({
      status,
      isUsed: parsedIsUsed,
      pattern,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_WALLET_LIST',
      {
        filter: { status, isUsed, pattern },
        pagination: { limit, offset },
        totalRecords: result.pagination.total
      },
      req
    );
    
    return res.status(200).json(result);
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Getting vanity wallets: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      query: req.query
    });
    
    return res.status(500).json({
      error: 'Failed to get vanity wallets',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/vanity-wallets
 * Create a new vanity wallet generation request
 */
router.post('/', requireSuperAdmin, async (req, res) => {
  try {
    const { 
      pattern, 
      isSuffix = false, 
      caseSensitive = true 
    } = req.body;
    
    // Validate pattern
    if (!pattern || typeof pattern !== 'string' || pattern.length < 1 || pattern.length > 10) {
      return res.status(400).json({
        error: 'Invalid pattern',
        message: 'Pattern must be a string between 1 and 10 characters'
      });
    }
    
    // Get client IP for record-keeping
    const clientIp = req.headers['x-forwarded-for'] || 
      req.connection.remoteAddress || 
      req.socket.remoteAddress || 
      (req.connection.socket ? req.connection.socket.remoteAddress : null);
    
    // Create request with API client (now using local implementation)
    const result = await VanityApiClient.createVanityAddressRequest({
      pattern,
      isSuffix,
      caseSensitive,
      requestedBy: req.user.wallet_address,
      requestIp: clientIp
    });
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_WALLET_CREATE',
      {
        pattern,
        isSuffix,
        caseSensitive,
        requestId: result.id
      },
      req
    );
    
    return res.status(202).json({
      status: 'accepted',
      message: `Vanity wallet generation for pattern '${pattern}' has been queued`,
      requestId: result.id,
      pattern,
      isSuffix,
      caseSensitive,
      createdAt: result.created_at
    });
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Creating vanity wallet: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    
    return res.status(500).json({
      error: 'Failed to create vanity wallet request',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/vanity-wallets/:id
 * Get a specific vanity wallet by ID
 */
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get wallet from database
    const wallet = await prisma.vanity_wallet_pool.findUnique({
      where: { id: parseInt(id) }
    });
    
    if (!wallet) {
      return res.status(404).json({
        error: 'Vanity wallet not found',
        message: `No vanity wallet found with ID ${id}`
      });
    }
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_WALLET_VIEW',
      {
        walletId: wallet.id,
        pattern: wallet.pattern,
        status: wallet.status
      },
      req
    );
    
    // Never return the private key in the response
    const response = {
      ...wallet,
      private_key: wallet.private_key ? '[REDACTED]' : null
    };
    
    return res.status(200).json(response);
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Getting vanity wallet: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      params: req.params
    });
    
    return res.status(500).json({
      error: 'Failed to get vanity wallet',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/vanity-wallets/:id/cancel
 * Cancel a vanity wallet generation job
 */
router.post('/:id/cancel', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Cancel the request using the API client
    const updatedWallet = await VanityApiClient.cancelVanityAddressRequest(parseInt(id));
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_WALLET_CANCEL',
      {
        walletId: updatedWallet.id,
        pattern: updatedWallet.pattern
      },
      req
    );
    
    return res.status(200).json({
      status: 'cancelled',
      message: 'Vanity wallet generation job cancelled',
      walletId: updatedWallet.id,
      pattern: updatedWallet.pattern
    });
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Cancelling vanity wallet job: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      params: req.params
    });
    
    return res.status(500).json({
      error: 'Failed to cancel vanity wallet job',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/vanity-wallets/batch
 * Create multiple vanity wallet generation requests in a batch
 */
router.post('/batch', requireSuperAdmin, async (req, res) => {
  try {
    const { patterns, isSuffix = false, caseSensitive = true } = req.body;
    
    // Validate patterns
    if (!Array.isArray(patterns) || patterns.length === 0) {
      return res.status(400).json({
        error: 'Invalid patterns',
        message: 'Patterns must be a non-empty array of strings'
      });
    }
    
    // Validate each pattern
    for (const pattern of patterns) {
      if (typeof pattern !== 'string' || pattern.length < 1 || pattern.length > 10) {
        return res.status(400).json({
          error: 'Invalid pattern',
          message: `Pattern '${pattern}' must be a string between 1 and 10 characters`
        });
      }
    }
    
    // Get client IP for record-keeping
    const clientIp = req.headers['x-forwarded-for'] || 
      req.connection.remoteAddress || 
      req.socket.remoteAddress || 
      (req.connection.socket ? req.connection.socket.remoteAddress : null);
    
    // Create requests with API client
    const results = [];
    for (const pattern of patterns) {
      try {
        const result = await VanityApiClient.createVanityAddressRequest({
          pattern,
          isSuffix,
          caseSensitive,
          requestedBy: req.user.wallet_address,
          requestIp: clientIp
        });
        
        results.push({
          status: 'accepted',
          pattern,
          requestId: result.id
        });
      } catch (error) {
        results.push({
          status: 'failed',
          pattern,
          error: error.message
        });
      }
    }
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_WALLET_BATCH_CREATE',
      {
        patterns,
        isSuffix,
        caseSensitive,
        results
      },
      req
    );
    
    return res.status(202).json({
      status: 'accepted',
      message: `Batch of ${patterns.length} vanity wallet generation requests submitted`,
      results
    });
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Creating batch vanity wallet requests: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    
    return res.status(500).json({
      error: 'Failed to create batch vanity wallet requests',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/vanity-wallets/status/generator
 * Get the status of the vanity wallet generator
 */
router.get('/status/generator', requireAdmin, async (req, res) => {
  try {
    const status = await VanityApiClient.getGeneratorStatus();
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'VANITY_GENERATOR_STATUS_CHECK',
      {
        status
      },
      req
    );
    
    return res.status(200).json(status);
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityWallets]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Getting generator status: ${error.message}`, {
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      error: 'Failed to get generator status',
      message: error.message
    });
  }
});

export default router;