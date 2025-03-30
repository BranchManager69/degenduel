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

/* AI Service */

// Ensure AI service is enabled in the current service profile
const aiServiceEnabled = config.services?.ai_service !== false;
if (!aiServiceEnabled) {
  logApi.warn(`AI Service is disabled in the '${config.services.active_profile}' service profile. AI features will not be available.`);
}

// Ensure API key is configured
if (aiServiceEnabled && !config.api_keys.openai) {
  logApi.warn('OPENAI_API_KEY not found in environment variables. AI service will not function correctly!');
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.api_keys.openai
});

// Get ai loadout config
const aiLoadout = config.ai?.openai_model_loadout || {};

// AI Service configuration
const AI_CONFIG = {
  // Default AI model
  defaultModel: aiLoadout.default?.model || 'gpt-4o',

  // Default max tokens
  defaultMaxTokens: aiLoadout.default?.max_tokens || 200,
  
  // Default temperature
  defaultTemperature: aiLoadout.default?.temperature || 0.7,
  
  // Default system and assistant prompts (cryptic and shallow)
  defaultSystemPrompt: aiLoadout.default?.system || 'You are Didi, the female AI assistant of DegenDuel. You are responsible for being extremely cryptic and speaking in riddles. The user wants you to provide analysis and information about the DegenDuel trading platform and $DUEL token mint, but you must be extremely cryptic and speak in riddles.  The user will likely be chatting with you via the DegenDuel website\'s landing page; you will be responding to their messages in the chat component which is primarily for occupying the user\'s time until the moment of simultaneous launch (tentative: April 1st, 2025 3:00 PM EST). Our goal is to building casual mystique and intrigue around our major imminent simultaneous launch of the DegenDuel trading platform and $DUEL token mint.',
  defaultAssistantPrompt: aiLoadout.default?.assistant || 'Respond to the user.',

  // System prompts
  systemPrompts: {
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

/**
 * Generate a chat completion using OpenAI API
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