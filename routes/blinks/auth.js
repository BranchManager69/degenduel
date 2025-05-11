// routes/blinks/auth.js

/**
 * Blinks Authentication Routes
 * 
 * Handles Dialect Blinks authentication callbacks and token validation
 * 
 * @version 1.0.0
 * @created 2025-05-11
 */

import express from 'express';
import crypto from 'crypto';
import { logApi } from '../../utils/logger-suite/logger.js';
import { config } from '../../config/config.js';
import { prisma } from '../../config/prisma.js';
import dialectService from '../../services/dialect/index.js';

// Create router
const router = express.Router();

// Session store for OAuth state validation
const oauthSessions = new Map();

/**
 * Generate a random state for OAuth flow
 * @returns {string} Random state string
 */
function generateOAuthState() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Store OAuth state with expiration
 * @param {string} state - OAuth state to store
 * @param {Object} data - Data to associate with this state
 */
function storeOAuthState(state, data) {
  oauthSessions.set(state, {
    data,
    expires: Date.now() + (30 * 60 * 1000) // 30 minutes expiration
  });
  
  // Clean up expired sessions occasionally
  if (Math.random() < 0.1) { // 10% chance to clean up on each store operation
    cleanupExpiredSessions();
  }
}

/**
 * Validate OAuth state and return associated data
 * @param {string} state - OAuth state to validate
 * @returns {Object|null} Associated data or null if invalid/expired
 */
function validateOAuthState(state) {
  const session = oauthSessions.get(state);
  
  if (!session) {
    return null;
  }
  
  // Check if expired
  if (session.expires < Date.now()) {
    oauthSessions.delete(state);
    return null;
  }
  
  // Remove the session after validating
  oauthSessions.delete(state);
  
  return session.data;
}

/**
 * Clean up expired OAuth sessions
 */
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [state, session] of oauthSessions.entries()) {
    if (session.expires < now) {
      oauthSessions.delete(state);
    }
  }
}

/**
 * POST /api/blinks/auth/init
 * 
 * Initialize OAuth flow for Blinks authentication
 */
router.post('/init', async (req, res) => {
  try {
    // Check if Dialect service is initialized
    if (!config.services.dialect_service || !dialectService.initialized) {
      return res.status(503).json({ error: 'Dialect service is not initialized' });
    }
    
    // Get user data from request
    const { wallet_address, blink_id } = req.body;
    
    if (!wallet_address) {
      return res.status(400).json({ error: 'Missing wallet address' });
    }
    
    // Generate state for OAuth flow
    const state = generateOAuthState();
    
    // Store state with wallet address and blink_id (if provided)
    storeOAuthState(state, { wallet_address, blink_id });
    
    // Generate OAuth URL
    // This is a placeholder - Dialect SDK may provide a proper way to generate this
    const oauthUrl = `https://app.dialect.to/auth?state=${state}&redirect_uri=${encodeURIComponent(config.dialect.provider.oauthRedirectUrl)}`;
    
    // Return OAuth URL to client
    res.json({
      oauth_url: oauthUrl,
      state: state
    });
  } catch (error) {
    logApi.error('Error initializing Blinks auth', { error });
    res.status(500).json({ error: 'Failed to initialize authentication' });
  }
});

/**
 * GET /api/blinks/auth/callback
 * 
 * Handle OAuth callback from Dialect
 */
router.get('/callback', async (req, res) => {
  try {
    // Get state and code from query parameters
    const { state, code } = req.query;
    
    if (!state || !code) {
      return res.status(400).json({ error: 'Missing state or code parameter' });
    }
    
    // Validate state and get associated data
    const sessionData = validateOAuthState(state);
    
    if (!sessionData) {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }
    
    const { wallet_address, blink_id } = sessionData;
    
    // Exchange code for access token
    // This is a placeholder - Dialect SDK may provide a proper way to do this
    const tokenResponse = await dialectService.exchangeDialectCode(code);
    
    // Record successful authentication
    await prisma.dialect_auth_tokens.create({
      data: {
        wallet_address,
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        expires_at: new Date(Date.now() + (tokenResponse.expires_in * 1000)),
        created_at: new Date()
      }
    });
    
    // Redirect back to app with success message
    if (blink_id) {
      // If specific blink was requested, redirect to that blink
      res.redirect(`/blinks/${blink_id}?auth_status=success`);
    } else {
      // Otherwise redirect to general blinks page
      res.redirect('/blinks?auth_status=success');
    }
  } catch (error) {
    logApi.error('Error handling Blinks auth callback', { error });
    res.status(500).json({ error: 'Failed to process authentication callback' });
  }
});

/**
 * GET /api/blinks/auth/status
 * 
 * Check auth status for a wallet
 */
router.get('/status', async (req, res) => {
  try {
    const { wallet_address } = req.query;
    
    if (!wallet_address) {
      return res.status(400).json({ error: 'Missing wallet_address parameter' });
    }
    
    // Check if wallet has a valid token
    const token = await prisma.dialect_auth_tokens.findFirst({
      where: {
        wallet_address,
        expires_at: {
          gt: new Date()
        }
      },
      orderBy: {
        created_at: 'desc'
      }
    });
    
    res.json({
      authenticated: !!token,
      expires_at: token?.expires_at
    });
  } catch (error) {
    logApi.error('Error checking Blinks auth status', { error });
    res.status(500).json({ error: 'Failed to check authentication status' });
  }
});

export default router;