// routes/ai.js

/**
 * @swagger
 * tags:
 *   name: AI
 *   description: AI-related endpoints
 */

import express from 'express';
import aiService, { generateChatCompletion } from '../services/aiService.js';
import { logApi } from '../utils/logger-suite/logger.js';
import rateLimit from 'express-rate-limit';
import prisma from '../config/prisma.js';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
//import { config } from '../config/config.js';

const router = express.Router();

// Configure rate limiter for AI requests
const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID for authenticated users, IP for others
    return req.user?.id || req.ip;
  },
  handler: (req, res) => {
    logApi.warn('Rate limit exceeded for AI service by user:', req.user?.id || req.ip);
    res.status(429).json({
      error: 'Rate limit exceeded for AI service',
      type: 'rate_limit'
    });
  }
});

// ------------------------------------------------------

// AI Chat Endpoint (no auth required)
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
    
    // Get user information if available
    const userId = req.user?.id || 'anonymous';
    const walletAddress = req.user?.wallet_address || 'unknown';
    const userRole = req.user?.role || 'unauthenticated';
    const userNickname = req.user?.nickname || req.user?.username || 'a DegenDuel user';
    
    // Process chat completion with enhanced options
    const result = await generateChatCompletion(messages, {
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

// AI Chat Endpoint (authenticated required)
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
router.post('/chat/degen', requireAuth, aiLimiter, async (req, res) => {
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
    
    // Get user information if available
    const userId = req.user?.id || 'anonymous';
    const walletAddress = req.user?.wallet_address || 'unknown';
    const userRole = req.user?.role || 'unauthenticated';
    const userNickname = req.user?.nickname || req.user?.username || 'a DegenDuel user';
    
    // Process chat completion with enhanced options
    const result = await generateChatCompletion(messages, {
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

// AI Chat Endpoint (admin required)
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
router.post('/chat/admin', requireAdmin, aiLimiter, async (req, res) => {
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
    
    // Get user information if available
    const userId = req.user?.id || 'anonymous';
    const walletAddress = req.user?.wallet_address;
    const userRole = req.user?.role;
    const userNickname = req.user?.nickname || req.user?.username || 'a DegenDuel user';
    
    // Process chat completion with enhanced options
    const result = await generateChatCompletion(messages, {
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

// AI Chat Endpoint (superadmin required)
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
router.post('/chat/superadmin', requireSuperAdmin, aiLimiter, async (req, res) => {
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
    
    // Get user information if available
    const userId = req.user?.id || 'anonymous';
    const walletAddress = req.user?.wallet_address;
    const userRole = req.user?.role;
    const userNickname = req.user?.nickname || req.user?.username || 'a DegenDuel user';
    
    // Process chat completion with enhanced options
    const result = await generateChatCompletion(messages, {
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

// ------------------------------------------------------

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

// ------------------------------------------------------

// Get a user's conversation history
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

// Get a specific conversation with messages
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

// ------------------------------------------------------

export default router;