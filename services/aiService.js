import { logApi } from '../utils/logger-suite/logger.js';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import prisma from '../config/prisma.js';
import { v4 as uuidv4 } from 'uuid';

// Ensure environment variables are loaded
dotenv.config();

// AI Service configuration - hardcoded constants
const AI_CONFIG = {
  // Default model configuration
  defaultModel: 'gpt-4o',
  
  // Model config for different tiers
  models: {
    standard: 'gpt-4o',
    premium: 'gpt-4o',
  },
  
  // Token limits
  maxTokens: 200,
  
  // System prompts
  systemPrompts: {
    default: "You are DegenDuel's AI assistant. You provide helpful, accurate, and concise information about cryptocurrency, trading, and the DegenDuel platform. Keep your responses friendly and informative.",
    trading: "You are DegenDuel's trading assistant. You provide analysis and information about cryptocurrencies, market trends, and trading strategies. Your advice is educational and never financial advice.",
  },
  
  // Temperature settings
  temperature: 0.7
};

// Initialize OpenAI client with API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Check if API key is configured
if (!process.env.OPENAI_API_KEY) {
  logApi.warn('OPENAI_API_KEY not found in environment variables. AI service will not function correctly.');
}

/**
 * Generate a chat completion using OpenAI API
 * 
 * @param {Array} messages - Array of message objects with role and content
 * @param {Object} options - Options for the API call
 * @returns {Object} Response with content and usage statistics
 */
export async function generateChatCompletion(messages, options = {}) {
  try {
    // Determine conversation context
    const conversationContext = options.context || 'default';
    
    // Get base system prompt
    let systemPrompt = AI_CONFIG.systemPrompts[conversationContext] || AI_CONFIG.systemPrompts.default;
    
    // Track conversation if user is authenticated
    let conversationId = options.conversationId;
    let isAuthenticated = false;
    let walletAddress = null;
    
    // Check if we have a logged-in user
    if (options.userId && options.userId !== 'anonymous') {
      try {
        // Get wallet address from userId (if it's not already a wallet address)
        walletAddress = options.walletAddress || options.userId;
        isAuthenticated = true;
        
        // Create or get existing conversation
        if (!conversationId) {
          // Generate a new UUID for this conversation
          conversationId = uuidv4();
        }
        
        // Look up user information from database
        const user = await prisma.users.findUnique({
          where: { 
            wallet_address: walletAddress.toString()
          },
          include: {
            user_stats: true,
            user_level: true,
            user_achievements: {
              take: 3,
              orderBy: { achieved_at: 'desc' }
            }
          }
        });
        
        if (user) {
          // Build personalized system prompt with user data
          const userAchievementCount = user.user_achievements?.length || 0;
          const contestsEntered = user.user_stats?.contests_entered || 0;
          const contestsWon = user.user_stats?.contests_won || 0;
          const userLevel = user.user_level?.level_number || 1;
          const userTitle = user.user_level?.title || 'Novice';
          
          // Calculate account age in days
          const accountAge = user.created_at ? 
            Math.floor((Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)) : 
            'Unknown';
          
          // Enhance the system prompt with user information
          systemPrompt = `${systemPrompt}

You are speaking with ${user.nickname || user.username || 'a DegenDuel user'}, who has:
- DegenDuel Level: ${userLevel} (${userTitle})
- Achievements: ${userAchievementCount} unlocked
- Contest experience: Entered ${contestsEntered} contests, won ${contestsWon}
- Account age: ${accountAge} days

Address them by name if they provided one, and adapt your responses to their experience level while keeping information accurate and helpful.`;
          
          logApi.info('Enhanced system prompt with user data', {
            userId: options.userId,
            userLevel
          });
        }
      } catch (error) {
        // If there's an error getting user data, just use the default prompt
        logApi.warn('Failed to enhance system prompt with user data:', error);
      }
    }
    
    // Add system prompt to messages
    const messagesWithSystem = messages.some(msg => msg.role === 'system') ? 
      messages : 
      [{ role: 'system', content: systemPrompt }, ...messages];
    
    // Log request (with sensitive data removed)
    logApi.info('AI chat request received', {
      userId: options.userId || 'anonymous',
      model: AI_CONFIG.defaultModel,
      messageCount: messages.length,
      service: 'AI',
      conversationId
    });
    
    // Make API request to OpenAI
    const response = await openai.chat.completions.create({
      model: AI_CONFIG.defaultModel,
      messages: messagesWithSystem,
      temperature: AI_CONFIG.temperature,
      max_tokens: AI_CONFIG.maxTokens,
      user: options.userId || 'anonymous'
    });
    
    // Log successful response (with usage metrics for cost tracking)
    logApi.info('AI chat response generated', {
      userId: options.userId || 'anonymous',
      model: AI_CONFIG.defaultModel,
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens,
      service: 'AI'
    });
    
    // Store conversation and messages if user is authenticated
    if (isAuthenticated && walletAddress && conversationId) {
      try {
        // Get or create conversation record
        let conversation = await prisma.ai_conversations.findUnique({
          where: { conversation_id: conversationId }
        });
        
        if (!conversation) {
          // Create new conversation
          conversation = await prisma.ai_conversations.create({
            data: {
              conversation_id: conversationId,
              wallet_address: walletAddress,
              context: conversationContext,
              first_message_at: new Date(),
              last_message_at: new Date(),
              message_count: 0,
              total_tokens_used: 0
            }
          });
        }
        
        // Store user message (the last one in the messages array)
        const userMessage = messages[messages.length - 1];
        if (userMessage.role === 'user') {
          await prisma.ai_conversation_messages.create({
            data: {
              conversation_id: conversationId,
              role: userMessage.role,
              content: userMessage.content
            }
          });
        }
        
        // Store AI response message
        await prisma.ai_conversation_messages.create({
          data: {
            conversation_id: conversationId,
            role: 'assistant',
            content: response.choices[0].message.content,
            tokens: response.usage.completion_tokens
          }
        });
        
        // Update conversation stats
        await prisma.ai_conversations.update({
          where: { conversation_id: conversationId },
          data: {
            message_count: {
              increment: 2 // User message + AI response
            },
            total_tokens_used: {
              increment: response.usage.total_tokens
            },
            last_message_at: new Date()
          }
        });
        
        logApi.info('Stored conversation and messages', {
          conversationId,
          walletAddress
        });
      } catch (error) {
        // Don't fail the whole request if conversation storage fails
        logApi.error('Failed to store conversation:', error);
      }
    }
    
    // Return formatted response
    return {
      content: response.choices[0].message.content,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      },
      conversationId: conversationId
    };
  } catch (error) {
    // Handle OpenAI-specific errors
    logApi.error('OpenAI API error:', error);
    
    // Check for billing/quota error specifically
    if (error.status === 429 && error.message && error.message.includes('exceeded your current quota')) {
      throw { status: 429, message: 'Sorry, the dev didn\'t pay the AI bill but the server is functioning properly' };
    }
    
    // Determine other error types and rethrow with appropriate status
    if (error.status === 401) {
      throw { status: 401, message: 'Authentication error with AI service' };
    } else if (error.status === 429) {
      throw { status: 429, message: 'Rate limit exceeded for AI service' };
    } else {
      throw { status: 500, message: 'AI service error' };
    }
  }
}