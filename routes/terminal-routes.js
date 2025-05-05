// routes/terminal-routes.js

/** 
 * AI Response Routes
 * 
 * @description Handles AI response generation requests related to various topics and data sources.
 * 
 * @author BranchManager69
 * @version 1.9.0
 * @created 2025-04-14
 * @updated 2025-05-02
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import { logApi } from '../utils/logger-suite/logger.js';

// Specialized Generators
import { generateAIResponse } from '../services/ai-service/ai-service.js';
import { generateTokenAIResponse } from '../services/ai-service/ai-service.js';
// Generic
import { generateDidiResponse } from '../services/ai-service/ai-service.js';
// Legacy
import { generateLegacyChatCompletion } from '../services/ai-service/ai-service.js';

// ------------------------------------------------------------------------------------------------

const router = express.Router();

// ------------------------------------------------------------------------------------------------

// Configure rate limiter for AI requests (more generous than standard AI); Give admins and superadmins unlimited requests
const aiServiceRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // rate limit window = 5 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID for authenticated users, IP for others
    if (req.user?.role.toLowerCase() === 'admin' || req.user?.role.toLowerCase() === 'superadmin') {
      return 'admin';
    }
    return req.user?.id || req.ip;
  },
  handler: (req, res) => {
    logApi.warn('Rate limit exceeded for terminal AI service by user:', req.user?.id || req.ip);
    res.status(429).json({
      error: 'Rate limit exceeded for terminal AI service',
      type: 'rate_limit'
    });
  }
});

// ------------------------------------------------------------------------------------------------

// Map status codes to error types
function getErrorType(status) {
  switch (status) {
    case 400: return 'invalid_request';
    case 401: case 403: return 'authentication';
    case 429: return 'rate_limit';
    case 500: case 502: case 503: case 504: return 'server';
    default: return 'unknown';
  }
}

// ------------------------------------------------------------------------------------------------

/**
 * @swagger
 * /api/terminal/ai-chat:
 *   post:
 *     summary: Process AI chat completions with token function calling capabilities
 *     tags: [Terminal]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messages
 *             properties:
 *               messages:
 *                 type: array
 *                 description: Array of message objects representing the conversation
 *                 items:
 *                   type: object
 *                   required:
 *                     - role
 *                     - content
 *                   properties:
 *                     role:
 *                       type: string
 *                       enum: [user, assistant]
 *                       description: Role of the message sender
 *                     content:
 *                       type: string
 *                       description: Content of the message
 *               conversationId:
 *                 type: string
 *                 description: Optional ID to track conversations
 *               context:
 *                 type: string
 *                 enum: [default, trading, terminal]
 *                 description: Terminal context to use
 *     responses:
 *       200:
 *         description: AI response generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 content:
 *                   type: string
 *                   description: The AI-generated response
 *                 functionCalled:
 *                   type: string
 *                   description: The name of any function called during processing
 *                 conversationId:
 *                   type: string
 *       400:
 *         description: Invalid request parameters
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
router.post('/ai-chat', requireAuth, aiServiceRateLimiter, async (req, res) => {
  try {
    // Extract request parameters
    const { messages, conversationId, context = 'terminal' } = req.body;
    
    // Validation
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request: messages array is required',
        type: 'invalid_request'
      });
    }
    
    // Validate message format
    for (const message of messages) {
      if (!message.role || typeof message.role !== 'string') {
        return res.status(400).json({
          error: 'Invalid request: each message must have a valid role',
          type: 'invalid_request'
        });
      }
      
      // Convert null or undefined content to empty strings
      if (message.content === null || message.content === undefined) {
        message.content = '';
      } else if (typeof message.content !== 'string') {
        // Convert non-string content to strings
        message.content = String(message.content);
      }
    }

    // Get authenticated user's information
    const user = req.user;
    const userId = user?.id || null;
    const walletAddress = user?.wallet_address || null;
    const userRole = user?.role || null;
    const userNickname = user?.nickname || user?.username || 'user';
    
    // Generate AI response with function calling, data fetching, database access, external API access, custom DegenDuel clients, user context, terminal context, etc.
    const result = await generateTokenAIResponse(messages, {
      conversationId,  // Conversation ID
      userId,          // User ID
      walletAddress,   // User's wallet address
      context,         // Context for AI response
      userRole,        // User's role (superadmin, admin, user, [unauthenticated])
      userNickname     // User's nickname
    });
    
    // Return response
    return res.status(200).json(result);
  } catch (error) {
    // Handle AI response generation errors
    logApi.error('Didi AI Error:', error);
    // Handle based on type
    const status = error.status || 500;
    const errorMessage = error.message || 'Internal server error';
    
    return res.status(status).json({
      error: errorMessage,
      type: getErrorType(status)
    });
  }
});

/**
 * @swagger
 * /api/terminal/token-info/{address or symbol}:
 *   get:
 *     summary: Get token information directly (without AI)
 *     tags: [Terminal]
 *     parameters:
 *       - in: path
 *         name: address or symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: Token address or symbol to look up
 *     responses:
 *       200:
 *         description: Token information successfully retrieved
 *       400:
 *         description: Invalid request parameters
 *       404:
 *         description: Token not found
 *       500:
 *         description: Server error
 */
router.get('/token-info/:addressOrSymbol', async (req, res) => {
  try {
    const { addressOrSymbol } = req.params;
    
    if (!addressOrSymbol) {
      return res.status(400).json({
        error: 'Token address or symbol is required',
        type: 'invalid_request'
      });
    }
    
    // Import handler directly from the terminal function handler
    const { handleFunctionCall } = await import('../services/ai-service/utils/terminal-function-handler.js');
    
    // Create a structured function call object
    const functionCall = {
      function: {
        name: 'getTokenPrice',
        arguments: { tokenAddressOrSymbol: addressOrSymbol }
      }
    };
    
    // Get token info
    const tokenInfo = await handleFunctionCall(functionCall);
    
    // Handle errors
    if (tokenInfo.error) {
      return res.status(404).json({
        error: 'Token not found',
        type: 'not_found',
        details: tokenInfo.error
      });
    }
    
    // Return token info
    return res.status(200).json(tokenInfo);
  } catch (error) {
    // Handle errors
    logApi.error('Token info error:', error);
    
    // Return 500 error response
    return res.status(500).json({
      error: 'Failed to retrieve token information',
      type: 'server'
    });
  }
});

export default router;