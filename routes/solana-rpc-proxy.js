// routes/solana-rpc-proxy.js

/**
 * @swagger
 * tags:
 *   name: Solana RPC
 *   description: Secure multi-tiered proxy for Solana RPC requests
 */

import express from 'express';
import { logApi } from '../utils/logger-suite/logger.js';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import AdminLogger from '../utils/admin-logger.js';
import fetch from 'node-fetch';

// Import config for RPC endpoint
import { config } from '../config/config.js';

// Solana RPC rate limits by tier
const SOLANA_RPC_RATE_LIMITS = {
  PUBLIC: 10,     // Public tier (anonymous users): 10 requests per minute
  USER: 120,      // User tier (authenticated users): 120 requests per minute
  ADMIN: 1000,    // Admin/superadmin tier: 1000 requests per minute
};

const router = express.Router();
const adminLogger = new AdminLogger('solana-rpc-proxy');

// --- RATE LIMITERS FOR DIFFERENT TIERS ---

// 1. Public tier - Very limited (using the constant defined at the top of file)
const publicRpcLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: SOLANA_RPC_RATE_LIMITS.PUBLIC, // Requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip, // Use IP since users aren't authenticated
  handler: (req, res) => {
    logApi.warn('Public RPC rate limit exceeded for IP:', req.ip);
    res.status(429).json({
      error: 'Rate limit exceeded for public Solana RPC',
      type: 'rate_limit',
      tier: 'public'
    });
  }
});

// 2. Authenticated user tier - Standard (using the constant defined at the top of file)
const userRpcLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute  
  max: SOLANA_RPC_RATE_LIMITS.USER, // Requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.wallet_address,
  handler: (req, res) => {
    logApi.warn('User RPC rate limit exceeded for:', req.user.wallet_address);
    res.status(429).json({
      error: 'Rate limit exceeded for Solana RPC',
      type: 'rate_limit',
      tier: 'user'
    });
  }
});

// 3. Admin tier - Very generous (using the constant defined at the top of file)
const adminRpcLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: SOLANA_RPC_RATE_LIMITS.ADMIN, // Requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.wallet_address,
  handler: (req, res) => {
    logApi.warn('Admin RPC rate limit exceeded for:', req.user.wallet_address);
    res.status(429).json({
      error: 'Rate limit exceeded for admin Solana RPC',
      type: 'rate_limit',
      tier: 'admin'
    });
  }
});

/**
 * Common RPC proxy handler function to avoid duplication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} tier - Access tier ('public', 'user', 'admin')
 * @param {Array} allowedMethods - Array of allowed RPC methods (null for all)
 */
async function handleRpcRequest(req, res, tier, allowedMethods = null) {
  try {
    // Method validation for public tier
    if (allowedMethods !== null) {
      const method = req.body.method;
      if (!allowedMethods.includes(method)) {
        return res.status(403).json({ 
          error: 'Method not allowed',
          message: `The method '${method}' is not allowed for ${tier} access tier`,
          allowed_methods: allowedMethods,
          tier
        });
      }
    }

    // Get the primary RPC URL from config
    const rpcUrl = config.rpc_urls.primary;
    
    if (!rpcUrl) {
      logApi.error('No RPC URL configured for Solana RPC proxy');
      return res.status(500).json({ error: 'RPC endpoint not configured' });
    }
    
    // Log the request (basic info only, not full payload)
    const userIdentifier = req.user ? req.user.wallet_address : req.ip;
    logApi.debug(`[${tier.toUpperCase()}] Solana RPC proxy request from ${userIdentifier}`, {
      method: req.body.method,
      user: req.user ? req.user.wallet_address.substring(0, 8) + '...' : req.ip,
      tier,
      ip: req.ip
    });
    
    // Forward the request to the actual Solana RPC endpoint
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });
    
    // Check if the response is successful
    if (!response.ok) {
      // Log the failed response
      logApi.warn(`Solana RPC proxy received error response: ${response.status} ${response.statusText}`);
      
      // Return the error from the RPC endpoint
      const errorData = await response.json();
      return res.status(response.status).json(errorData);
    }
    
    // Get JSON response
    const data = await response.json();
    
    // Check for RPC error
    if (data.error) {
      logApi.warn(`Solana RPC error: ${data.error.message || JSON.stringify(data.error)}`, {
        method: req.body.method,
        code: data.error.code,
        user: userIdentifier,
        tier
      });
    }
    
    // Forward the response back to the client
    res.json(data);
  } catch (error) {
    logApi.error(`Solana RPC proxy error (${tier} tier):`, error);
    
    // Log this to admin logger for monitoring if authenticated
    if (req.user) {
      adminLogger.logAction(
        req.user.wallet_address,
        'ERROR',
        `RPC proxy error (${tier} tier): ${error.message}`
      );
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to proxy Solana RPC request'
    });
  }
}

/**
 * @swagger
 * /api/solana-rpc/public:
 *   post:
 *     summary: Public tier proxy for Solana RPC requests (limited methods, strict rate limit)
 *     tags: [Solana RPC]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: RPC response
 *       403:
 *         description: Method not allowed
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Server error
 */
router.post('/public', publicRpcLimiter, async (req, res) => {
  // Only allow safe, read-only methods for public access
  const allowedMethods = [
    'getLatestBlockhash',
    'getBalance',
    'getAccountInfo',
    'getTokenAccountsByOwner',
    'getTokenAccountBalance',
    'getSignatureStatuses',
    'getBlockHeight',
    'getBlockTime',
    'getSlot',
    'getRecentBlockhash',
    'getRecentPerformanceSamples',
    'getHealthStatus',
    'getVersion'
  ];
  
  await handleRpcRequest(req, res, 'public', allowedMethods);
});

/**
 * @swagger
 * /api/solana-rpc:
 *   post:
 *     summary: Standard tier proxy for Solana RPC requests (authenticated users)
 *     tags: [Solana RPC]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: RPC response
 *       401:
 *         description: Not authenticated
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Server error
 */
router.post('/', requireAuth, userRpcLimiter, async (req, res) => {
  // All methods allowed for authenticated users
  await handleRpcRequest(req, res, 'user', null);
});

/**
 * @swagger
 * /api/solana-rpc/admin:
 *   post:
 *     summary: Admin tier proxy for Solana RPC requests (high rate limits)
 *     tags: [Solana RPC]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: RPC response
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Server error
 */
router.post('/admin', requireAuth, requireAdmin, adminRpcLimiter, async (req, res) => {
  // All methods allowed with very high rate limits for admins and superadmins
  // Note: requireAdmin middleware ensures the user has either 'admin' or 'superadmin' role
  await handleRpcRequest(req, res, 'admin', null);
});

/**
 * @swagger
 * /api/solana-rpc/info:
 *   get:
 *     summary: Get information about the RPC proxy tiers
 *     tags: [Solana RPC]
 *     responses:
 *       200:
 *         description: RPC proxy information
 */
router.get('/info', async (req, res) => {
  // User role defaults to 'public' if not authenticated
  let userRole = 'public';
  let userAddress = null;
  
  // Check if user is authenticated and determine their role
  if (req.user) {
    userAddress = req.user.wallet_address;
    userRole = req.user.role;
  }
  
  // Return information about the RPC proxy
  res.json({
    status: 'active',
    proxyConfigured: !!config.rpc_urls.primary,
    currentUser: {
      authenticated: !!req.user,
      address: userAddress,
      role: userRole
    },
    tiers: {
      public: {
        endpoint: '/api/solana-rpc/public',
        rateLimits: {
          requestsPerMinute: SOLANA_RPC_RATE_LIMITS.PUBLIC,
          windowMs: 60000
        },
        methodRestrictions: true,
        requiresAuth: false
      },
      user: {
        endpoint: '/api/solana-rpc',
        rateLimits: {
          requestsPerMinute: SOLANA_RPC_RATE_LIMITS.USER,
          windowMs: 60000
        },
        methodRestrictions: false,
        requiresAuth: true
      },
      admin: {
        endpoint: '/api/solana-rpc/admin',
        rateLimits: {
          requestsPerMinute: SOLANA_RPC_RATE_LIMITS.ADMIN,
          windowMs: 60000
        },
        methodRestrictions: false,
        requiresAuth: true,
        requiresAdminRole: true
      }
    },
    timestamp: new Date().toISOString()
  });
});

export default router;