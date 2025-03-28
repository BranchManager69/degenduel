import express from 'express';
import { generateChatCompletion } from '../services/aiService.js';
import { logApi } from '../utils/logger-suite/logger.js';
import rateLimit from 'express-rate-limit';
import prisma from '../config/prisma.js';

const router = express.Router();

// Configure rate limiter for AI requests
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID for authenticated users, IP for others
    return req.user?.id || req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Rate limit exceeded for AI service',
      type: 'rate_limit'
    });
  }
});

/**
 * @swagger
 * /api/ai/chat:
 *   post:
 *     summary: Process AI chat completions
 *     tags: [AI]
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
 *                       description: The role of the message sender (system prompts are added automatically)
 *                     content:
 *                       type: string
 *                       description: The content of the message
 *               conversationId:
 *                 type: string
 *                 description: Optional ID to track conversations for analytics
 *               context:
 *                 type: string
 *                 enum: [default, trading]
 *                 description: Optional context to determine which system prompt to use
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
 *                 usage:
 *                   type: object
 *                   properties:
 *                     promptTokens:
 *                       type: number
 *                     completionTokens:
 *                       type: number
 *                     totalTokens:
 *                       type: number
 *                 conversationId:
 *                   type: string
 *       400:
 *         description: Invalid request parameters
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
router.post('/chat', aiLimiter, async (req, res) => {
  try {
    // Extract request parameters - we only need messages and conversationId
    const { messages, conversationId, context } = req.body;
    
    // Validation
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request: messages array is required',
        type: 'invalid_request'
      });
    }
    
    // Get user information if available
    const userId = req.user?.id || 'anonymous';
    const walletAddress = req.user?.wallet_address;
    
    // Process chat completion with enhanced options
    const result = await generateChatCompletion(messages, {
      conversationId,
      userId,
      walletAddress,
      context
    });
    
    // Return response
    return res.status(200).json(result);
  } catch (error) {
    // Log detailed error for debugging
    logApi.error('AI chat error:', error);
    
    // Handle errors based on type
    const status = error.status || 500;
    const message = error.message || 'Internal server error';
    
    return res.status(status).json({
      error: message,
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
 * /api/ai/conversations:
 *   get:
 *     summary: Get user's conversation history
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's AI conversations
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get('/conversations', async (req, res) => {
  try {
    // Get wallet address from authenticated user
    const walletAddress = req.user?.wallet_address;
    
    if (!walletAddress) {
      return res.status(401).json({
        error: 'User not authenticated',
        type: 'authentication'
      });
    }
    
    // Get conversations for this user
    const conversations = await prisma.ai_conversations.findMany({
      where: {
        wallet_address: walletAddress,
      },
      orderBy: {
        last_message_at: 'desc'
      },
      take: 10 // Limit to most recent 10 conversations
    });
    
    // Return conversation list
    return res.status(200).json({
      conversations: conversations.map(c => ({
        id: c.conversation_id,
        context: c.context,
        messageCount: c.message_count,
        lastActive: c.last_message_at
      }))
    });
  } catch (error) {
    logApi.error('Error retrieving conversations:', error);
    return res.status(500).json({
      error: 'Failed to retrieve conversations',
      type: 'server'
    });
  }
});

/**
 * @swagger
 * /api/ai/conversations/{conversationId}:
 *   get:
 *     summary: Get a specific conversation with messages
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Conversation details with messages
 *       401:
 *         description: User not authenticated
 *       404:
 *         description: Conversation not found
 *       500:
 *         description: Server error
 */
router.get('/conversations/:conversationId', async (req, res) => {
  try {
    // Get wallet address from authenticated user
    const walletAddress = req.user?.wallet_address;
    const { conversationId } = req.params;
    
    if (!walletAddress) {
      return res.status(401).json({
        error: 'User not authenticated',
        type: 'authentication'
      });
    }
    
    // Get conversation and verify ownership
    const conversation = await prisma.ai_conversations.findUnique({
      where: {
        conversation_id: conversationId,
      },
      include: {
        messages: {
          orderBy: {
            created_at: 'asc'
          }
        }
      }
    });
    
    // Check if conversation exists and belongs to user
    if (!conversation || conversation.wallet_address !== walletAddress) {
      return res.status(404).json({
        error: 'Conversation not found',
        type: 'not_found'
      });
    }
    
    // Return conversation with messages
    return res.status(200).json({
      id: conversation.conversation_id,
      context: conversation.context,
      messages: conversation.messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.created_at
      }))
    });
  } catch (error) {
    logApi.error('Error retrieving conversation:', error);
    return res.status(500).json({
      error: 'Failed to retrieve conversation',
      type: 'server'
    });
  }
});

export default router;