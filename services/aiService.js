// aiService.js

/**
 * Service responsible for OpenAI API calls.
 * @author @BranchManager69
 * @version 1.6.9
 */

import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';

// Config
import config from '../config/config.js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.api_keys.openai
});

/* AI Service */

// Ensure AI service is enabled in the current environment's service profile
const aiServiceEnabled = config.services?.ai_service !== false;
if (!aiServiceEnabled) {
  logApi.warn(`AI Service is disabled in the '${config.services.active_profile}' service profile. AI features will not be available.`);
}

// Ensure API key is configured
if (aiServiceEnabled && !config.api_keys.openai) {
  logApi.warn('OPENAI_API_KEY not found in environment variables. AI service will not function correctly!');
}

// Get ai loadout config
const aiLoadout = config.ai?.openai_model_loadout || {};

// AI Service configuration
const AI_CONFIG = {

  // Default AI model
  defaultModel: aiLoadout.default?.model || 'gpt-4o',
  
  // Default max tokens
  defaultMaxTokens: aiLoadout.default?.max_tokens || 223, 
  
  // Default temperature
  defaultTemperature: aiLoadout.default?.temperature || 0.76,

  // System prompts
  systemPrompts: {
    default: aiLoadout.default?.system,
    trading: aiLoadout.trading?.system,
    creative: aiLoadout.creative?.system,
    coding: aiLoadout.coding?.system,
    funny: aiLoadout.funny?.system,
    image: aiLoadout.image?.system,
    audio: aiLoadout.audio?.system,
    video: aiLoadout.video?.system,
    multimodal: aiLoadout.multimodal?.system,
    realtime: aiLoadout.realtime?.system,
    uncensored: aiLoadout.uncensored?.system,
    premium: aiLoadout.premium?.system,
    economy: aiLoadout.economy?.system,
    standard: aiLoadout.standard?.system,
    longcontext: aiLoadout.longcontext?.system,
    reasoning: aiLoadout.reasoning?.system,
    prelaunch: aiLoadout.prelaunch?.system,
  },
  assistantPrompts: {
    trading: aiLoadout.trading?.assistant,
    creative: aiLoadout.creative?.assistant,
    coding: aiLoadout.coding?.assistant,
    funny: aiLoadout.funny?.assistant,
    image: aiLoadout.image?.assistant,
    audio: aiLoadout.audio?.assistant,
    video: aiLoadout.video?.assistant,
    multimodal: aiLoadout.multimodal?.assistant,
    realtime: aiLoadout.realtime?.assistant,
    uncensored: aiLoadout.uncensored?.assistant,
    premium: aiLoadout.premium?.assistant,
    economy: aiLoadout.economy?.assistant,
    standard: aiLoadout.standard?.assistant,
    longcontext: aiLoadout.longcontext?.assistant,
    reasoning: aiLoadout.reasoning?.assistant,
    prelaunch: aiLoadout.prelaunch?.assistant,
  }
};

// Check if API key is configured
if (aiServiceEnabled && !config.api_keys.openai) {
  logApi.warn('OPENAI API KEY not found! AI service will not function correctly.');
}

// ------------------------------------------------------
// OLD:
// Generate a chat completion using OpenAI Chat Completion API
/**
 * Generate a chat completion using OpenAI Chat API
 * 
 * @param {Array} messages - Array of message objects with role and content
 * @param {Object} options - Options for the API call
 * @returns {Object} Response with content and usage statistics
 */
export async function generateChatCompletion(messages, options = {}) {
  try {
    // Check if AI service is disabled
    if (!aiServiceEnabled) {
      throw new Error('AI service is disabled in the current service profile');
    }
    
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
        const userRole = options.userRole || 'unauthenticated';
        
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
          logApi.info('[aiService] User found in database', {
            userId: options.userId,
            walletAddress: walletAddress,
            user: user
          });
          
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

You are speaking with ${user.nickname || user.username || 'a DegenDuel user'} (role: ${userRole}), who has:
- DegenDuel Level: ${userLevel} (${userTitle})
- Achievements: ${userAchievementCount} unlocked
- Contest experience: Entered ${contestsEntered} contests, won ${contestsWon}
- Account age: ${accountAge} days

Address them by name if they provided one, and adapt your responses to their experience level while keeping information accurate and helpful.`;
          
          logApi.info('Enhanced system prompt with user data', {
            userId: options.userId,
            userLevel
          });
        } else {
          logApi.warn('[aiService] User not found in database', {
            userId: options.userId,
            walletAddress: walletAddress
          });
        }
      } catch (error) {
        // If there's an error getting user data, just use the default prompt
        logApi.warn('Failed to enhance system prompt with user data:', error);
      }
    }
    
    // Validate and sanitize messages to prevent null content
    const sanitizedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content === null || msg.content === undefined ? '' : String(msg.content)
    }));
    
    // Add system prompt to messages
    const messagesWithSystem = sanitizedMessages.some(msg => msg.role === 'system') ? 
      sanitizedMessages : 
      [{ role: 'system', content: systemPrompt }, ...sanitizedMessages];
    
    // Log request (with sensitive data removed)
    logApi.info('AI chat request received', {
      userId: options.userId || 'anonymous',
      model: AI_CONFIG.defaultModel,
      messageCount: sanitizedMessages.length,
      service: 'AI',
      conversationId
    });
    
    // Make API request to OpenAI
    const response = await openai.chat.completions.create({
      model: AI_CONFIG.defaultModel,
      messages: messagesWithSystem,
      temperature: AI_CONFIG.defaultTemperature,
      max_tokens: AI_CONFIG.defaultMaxTokens,
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
        
        // Store user message (the last one in the sanitized messages array)
        const userMessage = sanitizedMessages[sanitizedMessages.length - 1];
        if (userMessage?.role === 'user' && userMessage?.content) {
          await prisma.ai_conversation_messages.create({
            data: {
              conversation_id: conversationId,
              role: userMessage.role,
              content: userMessage.content || '' // Ensure content isn't null
            }
          });
        }
        
        // Store AI response message - ensure content isn't null
        const responseContent = response.choices[0]?.message?.content || '';
        await prisma.ai_conversation_messages.create({
          data: {
            conversation_id: conversationId,
            role: 'assistant',
            content: responseContent,
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
    
    // Return formatted response, ensuring content is never null
    return {
      content: response.choices[0]?.message?.content || '',
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
      throw { status: 429, message: '[DEV IS BROKE!] Looks like Branch Manager needs to pay the AI bill... The rest of the DegenDuel server is functioning properly!' };
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
// ------------------------------------------------------
// NEW:
// Generate an AI response using OpenAI Responses API
/**
 * @swagger
 * /api/ai/responses:
 *   post:
 *     summary: Generate AI response using OpenAI Responses API
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
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                       enum: [user, assistant, system]
 *                     content:
 *                       type: string
 *                     conversationId:
 *                       type: string
 *                     context:
 *                       type: string
 *                     userRole:
 *                       type: string
 *                     userNickname:
 *                       type: string
 *                     functions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           description:
 *                             type: string
 *                           parameters:
 *                             type: object
 *                             properties:
 *                               type: string
 *                               description:
 *                                 type: string
 *                               required:
 *                                 type: boolean
 *                               enum:
 *                                 type: array
 * 200:
 *   description: AI response generated successfully
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           stream:
 *             type: string
 *           conversationId:
 *             type: string
 * 500:
 *   description: AI service error
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           error:
 *             type: string
 * 401:
 *   description: Authentication error
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           error:
 *             type: string
 * 429:
 *   description: Rate limit exceeded
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           error:
 *             type: string
 * 400:
 *   description: Bad request
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:  
 *           error:
 *             type: string
 * 403:
 *   description: Forbidden
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           error:
 *             type: string
 * 404:
 *   description: Not found
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           error:
 *             type: string
 */
export async function generateAIResponse(messages, options = {}) {
  try {
    // Check if AI service is disabled
    if (!aiServiceEnabled) throw new Error('AI service is disabled in the current service profile');

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
        const userRole = options.userRole || 'unauthenticated';

        // Create or get existing conversation
        if (!conversationId) {
          // Generate a new UUID for this conversation
          conversationId = uuidv4();
        }

        // Look up user information from database
        const user = await prisma.users.findUnique({
          where: { wallet_address: walletAddress.toString() },
          include: {
            user_stats: true,
            user_level: true,
            user_achievements: { take: 3, orderBy: { achieved_at: 'desc' } },
          },
        });

        // If user is found, build personalized system prompt with user data
        if (user) {
          const userAchievementCount = user.user_achievements?.length || 0;
          const contestsEntered = user.user_stats?.contests_entered || 0;
          const contestsWon = user.user_stats?.contests_won || 0;
          const userLevel = user.user_level?.level_number || 1;
          const userTitle = user.user_level?.title || 'Novice';
          
          // Calculate account age in days
          const accountAge = user.created_at ?
            Math.floor((Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)) : 'Unknown';

          // Enhance the system prompt with user information
          systemPrompt = `${systemPrompt}\n\nYou are speaking with ${user.nickname || user.username || 'a DegenDuel user'} (role: ${userRole}), who has:\n- DegenDuel Level: ${userLevel} (${userTitle})\n- Achievements: ${userAchievementCount} unlocked\n- Contest experience: Entered ${contestsEntered} contests, won ${contestsWon}\n- Account age: ${accountAge} days`;
        }
      } catch (err) {
        // If user lookup fails, just use the default prompt
        logApi.warn('User lookup failed', err);
      }
    }

    // Validate and sanitize messages to prevent null content
    const sanitizedMessages = messages.map(m => ({
      role: m.role,
      content: m.content ?? ''
    }));

    // Add system prompt to messages
    const messagesWithSystem = sanitizedMessages.some(m => m.role === 'system')
      ? sanitizedMessages
      : [{ role: 'system', content: systemPrompt }, ...sanitizedMessages];

    // Log request (with sensitive data removed)
    logApi.info('AI response request received', {
      userId: options.userId || 'anonymous',
      model: AI_CONFIG.defaultModel,
      messageCount: sanitizedMessages.length,
      service: 'AI',
      conversationId
    });

    // Make API request to OpenAI
    const stream = await openai.responses.create({
      model: AI_CONFIG.defaultModel,
      input: messagesWithSystem,
      stream: true,
      functions: options.functions || [], // support function calling
    }, { responseType: 'stream' });

    // Process the stream response
    let fullResponse = '';
    stream.data.on('data', chunk => {
      // Split the chunk into payloads
      const payloads = chunk.toString().split('\n\n').filter(Boolean)
        .map(p => JSON.parse(p.replace(/^data: /, '')));

      // Process each payload in the stream
      for (const payload of payloads) {
        if (payload.choices[0]?.delta?.content) {
          fullResponse += payload.choices[0].delta.content;
        }

        // Handle function call if present...
        if (payload.choices[0]?.message?.function_call) {
          // You can wire in your function_call logic here
          const functionCall = payload.choices[0].message.function_call;
          logApi.info('Function call received', { functionCall });
        }
      }
    });

    // Handle the end of the stream
    stream.data.on('end', async () => {
      if (isAuthenticated && walletAddress && conversationId) {
        try {
          // Get the last user message
          const userMessage = sanitizedMessages[sanitizedMessages.length - 1];

          // Upsert the conversation record
          const conversation = await prisma.ai_conversations.upsert({
            where: { conversation_id: conversationId },
            update: {
              message_count: { increment: 2 },
              total_tokens_used: { increment: fullResponse.length },
              last_message_at: new Date()
            },
            // Create a new conversation record if it doesn't exist
            create: {
              conversation_id: conversationId,
              wallet_address: walletAddress,
              context: conversationContext,
              first_message_at: new Date(),
              last_message_at: new Date(),
              message_count: 2,
              total_tokens_used: fullResponse.length
            }
          });

          // Store user message
          if (userMessage.role === 'user') {
            await prisma.ai_conversation_messages.create({
              data: { conversation_id: conversationId, role: userMessage.role, content: userMessage.content }
            });
          }

          // Store AI response
          await prisma.ai_conversation_messages.create({
            data: { conversation_id: conversationId, role: 'assistant', content: fullResponse }
          });

          // Log successful storage
          logApi.info('Stored conversation and messages', { conversationId, walletAddress });
        } catch (e) {
          // Log storage failure
          logApi.error('Storage failure during AI conversation update', e);
        }
      }
    });

    // Return the stream response
    return {
      stream: stream.data,
      conversationId
    };
  } catch (error) {
    // Log the error
    logApi.error('OpenAI Responses API error:', error);
    
    // Throw an error with a 500 status code
    throw { status: 500, message: 'AI service error using Responses API' };
  }
}
// ------------------------------------------------------
