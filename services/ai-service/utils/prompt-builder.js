// services/ai-service/utils/prompt-builder.js
// @see /services/ai-service/README.md for complete documentation and architecture

/**
 * Prompt Builder Utility Module
 * 
 * @description Provides utilities for building and enhancing AI prompts,
 * including adding user context and ensuring proper prompt structure.
 * 
 * @author BranchManager69
 * @version 1.9.0
 * @created 2025-04-10
 * @updated 2025-05-01
 */

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';

// Config
//import config from '../../../config/config.js';
//const { ai } = config;

/**
 * Enhance a system prompt with user information
 * 
 * @param {string} basePrompt - The base system prompt to enhance
 * @param {string} walletAddress - User's wallet address
 * @param {string} userRole - User's role in the system
 * @param {string} serviceName - Service name for logging
 * @returns {string} Enhanced prompt with user context
 */
export async function enhancePromptWithUserContext(basePrompt, walletAddress, userRole, serviceName) {
  try {
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
    
    if (!user) {
      // No user found, return original prompt
      return basePrompt;
    }
    
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
    const enhancedPrompt = `${basePrompt}

You are speaking with ${user.nickname || user.username || 'a DegenDuel user'} (role: ${userRole}), who has:
- DegenDuel Level: ${userLevel} (${userTitle})
- Achievements: ${userAchievementCount} unlocked
- Contest experience: Entered ${contestsEntered} contests, won ${contestsWon}
- Account age: ${accountAge} days

Address them by name if they provided one, and adapt your responses to their experience level while keeping information accurate and helpful.`;
    
    return enhancedPrompt;
  } catch (error) {
    // If there's an error getting user data, just use the default prompt
    logApi.warn(`${fancyColors.MAGENTA}[${serviceName}]${fancyColors.RESET} Failed to enhance system prompt with user data:`, error);
    return basePrompt;
  }
}

/**
 * Sanitize and optimize messages to prevent null content
 * and manage token usage with longer conversation histories
 * 
 * @param {Array} messages - Array of message objects to sanitize
 * @returns {Array} Sanitized message objects
 */
export function sanitizeMessages(messages) {
  // Check if we have a very long conversation history
  const isLongConversation = messages.length > 20;
  
  // Basic sanitization for all messages
  const sanitized = messages.map(msg => ({
    role: msg.role,
    content: msg.content === null || msg.content === undefined ? '' : String(msg.content)
  }));
  
  // For long conversations, we'll keep all messages but ensure they're properly
  // sanitized and formatted for token optimization
  if (isLongConversation) {
    logApi.debug(`Optimizing long conversation with ${messages.length} messages`);
    
    // Always keep the system message and the most recent messages intact
    // This ensures context continuity while potentially truncating middle messages
    
    // No additional truncation for now - the model will handle this efficiently
    // We're relying on the model's ability to use the full conversation history
    // If token limits become an issue, we can implement a more aggressive strategy here
  }
  
  return sanitized;
}

/**
 * Ensure messages include a system prompt
 * 
 * @param {Array} messages - Array of message objects
 * @param {string} systemPrompt - System prompt to add if not present
 * @returns {Array} Messages with system prompt included
 */
export function ensureSystemPrompt(messages, systemPrompt) {
  return messages.some(msg => msg.role === 'system') ? 
    messages : 
    [{ role: 'system', content: systemPrompt }, ...messages];
}
