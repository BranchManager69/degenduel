// routes/terminal-routes.js

import express from 'express';
import { logApi } from '../utils/logger-suite/logger.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import { generateTokenAIResponse } from '../services/ai-service/ai-service.js';

const router = express.Router();

// Configure rate limiter for terminal AI requests (more generous than standard AI)
const terminalAILimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID for authenticated users, IP for others
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
router.post('/ai-chat', requireAuth, terminalAILimiter, async (req, res) => {
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
      
      if (message.content === null || message.content === undefined) {
        // Convert null or undefined content to empty string
        message.content = '';
      } else if (typeof message.content !== 'string') {
        // Convert non-string content to string
        message.content = String(message.content);
      }
    }
    
    // Get user information
    const userId = req.user?.id;
    const walletAddress = req.user?.wallet_address;
    const userRole = req.user?.role;
    const userNickname = req.user?.nickname || req.user?.username || 'user';
    
    // Process AI response with token function calling
    const result = await generateTokenAIResponse(messages, {
      conversationId,
      userId,
      walletAddress,
      context,
      userRole,
      userNickname
    });
    
    // Return response
    return res.status(200).json(result);
  } catch (error) {
    // Log detailed error for debugging
    logApi.error('Terminal AI chat error:', error);
    
    // Handle errors based on type
    const status = error.status || 500;
    const errorMessage = error.message || 'Internal server error';
    
    return res.status(status).json({
      error: errorMessage,
      type: getErrorType(status)
    });
  }
});

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

/**
 * @swagger
 * /api/terminal/token-info/{symbol}:
 *   get:
 *     summary: Get token information directly (without AI)
 *     tags: [Terminal]
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: Token symbol to look up
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
router.get('/token-info/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    if (!symbol) {
      return res.status(400).json({
        error: 'Token symbol is required',
        type: 'invalid_request'
      });
    }
    
    // Import handler directly from the terminal function handler
    const { handleFunctionCall } = await import('../services/ai-service/utils/terminal-function-handler.js');
    
    // Create a structured function call object
    const functionCall = {
      function: {
        name: 'getTokenPrice',
        arguments: { tokenSymbol: symbol }
      }
    };
    
    // Get token information
    const tokenInfo = await handleFunctionCall(functionCall);
    
    if (tokenInfo.error) {
      return res.status(404).json({
        error: 'Token not found',
        type: 'not_found',
        details: tokenInfo.error
      });
    }
    
    return res.status(200).json(tokenInfo);
  } catch (error) {
    logApi.error('Token info error:', error);
    
    return res.status(500).json({
      error: 'Failed to retrieve token information',
      type: 'server'
    });
  }
});

export default router;