/**
 * Prompt Builder Utility Module
 * 
 * This module provides utilities for building and enhancing AI prompts,
 * including adding user context and ensuring proper prompt structure.
 */

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';

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
 * Sanitize messages to prevent null content
 * 
 * @param {Array} messages - Array of message objects to sanitize
 * @returns {Array} Sanitized message objects
 */
export function sanitizeMessages(messages) {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content === null || msg.content === undefined ? '' : String(msg.content)
  }));
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