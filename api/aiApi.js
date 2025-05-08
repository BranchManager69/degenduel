// api/aiApi.js

/**
 * AI API Interface
 * 
 * A clean API interface for using AI capabilities throughout the DegenDuel application.
 * This abstracts away the details of the underlying AI service implementation.
 */

import aiService from '../services/ai-service/index.js';
import imageGenerator from '../services/ai-service/image-generator.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';

/**
 * AI API for application use
 */
export const AIApi = {
  // ========== UTILITY METHODS ==========
  
  /**
   * Generates AI text completion (non-streaming)
   * 
   * @param {Array} messages - Array of message objects with role and content
   * @param {Object} options - Options for the API call
   * @param {String} loadoutType - Optional loadout type (default, errorAnalysis, adminAnalysis, dgenTerminal, etc.)
   * @returns {Object} Response with content and usage statistics
   */
  async generateCompletion(messages, options = {}, loadoutType = 'default') {
    return aiService.generateFullResponse(messages, {
      ...options,
      loadoutType
    });
  },
  
  /**
   * Generates AI text completion with specific loadout (alias for clarity)
   * 
   * @param {Array} messages - Array of message objects with role and content
   * @param {String} loadoutType - Loadout type (default, errorAnalysis, adminAnalysis, dgenTerminal, etc.)
   * @param {Object} options - Options for the API call
   * @returns {Object} Response with content and usage statistics
   */
  async generateCompletionWithLoadout(messages, loadoutType, options = {}) {
    return this.generateCompletion(messages, options, loadoutType);
  },
  
  /**
   * Generates streaming AI response
   * 
   * @param {Array} messages - Array of message objects
   * @param {Object} options - Options for the API call
   * @param {String} loadoutType - Optional loadout type (default, dgenTerminal, etc.)
   * @returns {Object} Response with stream and conversationId
   */
  async generateStreamingResponse(messages, options = {}, loadoutType = 'default') {
    return aiService.generateAIResponse(messages, {
      ...options,
      loadoutType
    });
  },
  
  /**
   * Generates streaming AI response with specific loadout (alias for clarity)
   * 
   * @param {Array} messages - Array of message objects
   * @param {String} loadoutType - Loadout type (default, dgenTerminal, etc.)
   * @param {Object} options - Options for the API call
   * @returns {Object} Response with stream and conversationId
   */
  async generateStreamingResponseWithLoadout(messages, loadoutType, options = {}) {
    return this.generateStreamingResponse(messages, options, loadoutType);
  },
  
  // ========== ANALYSIS METHODS ==========
  
  /**
   * Retrieves the latest client error analysis
   * 
   * @returns {Object|null} Latest error analysis or null if not found
   */
  async getLatestErrorAnalysis() {
    try {
      const analysis = await prisma.system_settings.findUnique({
        where: { key: 'latest_client_error_analysis' }
      });
      return analysis?.value || null;
    } catch (error) {
      logApi.error('Failed to retrieve latest error analysis', error);
      return null;
    }
  },
  
  /**
   * Retrieves the latest admin actions analysis
   * 
   * @returns {Object|null} Latest admin actions analysis or null if not found
   */
  async getLatestAdminActionsAnalysis() {
    try {
      const analysis = await prisma.system_settings.findUnique({
        where: { key: 'latest_admin_actions_analysis' }
      });
      return analysis?.value || null;
    } catch (error) {
      logApi.error('Failed to retrieve latest admin actions analysis', error);
      return null;
    }
  },
  
  /**
   * Runs an immediate analysis of client errors (not waiting for interval)
   * 
   * @returns {Object|null} Analysis results or null on failure
   */
  async analyzeClientErrorsNow() {
    return aiService.analyzeRecentClientErrors();
  },
  
  /**
   * Runs an immediate analysis of admin actions (not waiting for interval)
   * 
   * @returns {Object|null} Analysis results or null on failure
   */
  async analyzeAdminActionsNow() {
    return aiService.analyzeRecentAdminActions();
  },
  
  /**
   * Gets a user's conversation history
   * 
   * @param {String} walletAddress User's wallet address
   * @param {Number} limit Maximum number of conversations to return
   * @returns {Array} List of conversations
   */
  async getUserConversations(walletAddress, limit = 10) {
    try {
      return await prisma.ai_conversations.findMany({
        where: { wallet_address: walletAddress },
        orderBy: { last_message_at: 'desc' },
        take: limit,
        include: {
          messages: {
            orderBy: { created_at: 'asc' },
            take: 1 // Just get the first message to show the start of the conversation
          }
        }
      });
    } catch (error) {
      logApi.error('Failed to get user conversations', error);
      return [];
    }
  },
  
  /**
   * Gets messages from a specific conversation
   * 
   * @param {String} conversationId Conversation identifier
   * @returns {Array} List of messages in the conversation
   */
  async getConversationMessages(conversationId) {
    try {
      return await prisma.ai_conversation_messages.findMany({
        where: { conversation_id: conversationId },
        orderBy: { created_at: 'asc' }
      });
    } catch (error) {
      logApi.error('Failed to get conversation messages', error);
      return [];
    }
  },
  
  // ========== SERVICE STATUS ==========
  
  /**
   * Checks if AI service is available
   * 
   * @returns {Boolean} True if service is operational
   */
  isAvailable() {
    return aiService.isOperational && !aiService.stats.circuitBreaker.isOpen;
  },
  
  /**
   * Gets AI service health stats
   * 
   * @returns {Object} Service health information
   */
  getServiceHealth() {
    return {
      operational: aiService.isOperational,
      circuitBreaker: {
        isOpen: aiService.stats.circuitBreaker.isOpen,
        failures: aiService.stats.circuitBreaker.failures
      },
      operations: {
        total: aiService.stats.operations.total,
        successful: aiService.stats.operations.successful,
        failed: aiService.stats.operations.failed,
      },
      performance: {
        averageOperationTimeMs: aiService.stats.performance.averageOperationTimeMs,
        lastOperationTimeMs: aiService.stats.performance.lastOperationTimeMs
      },
      analysis: {
        clientErrors: aiService.analysisStats.clientErrors,
        adminActions: aiService.analysisStats.adminActions
      }
    };
  },
  
  /**
   * Gets available AI loadouts and their configurations
   * 
   * @returns {Object} Available loadouts with their configurations
   */
  getAvailableLoadouts() {
    // Create a sanitized copy that doesn't include full system prompts
    // for security/privacy reasons
    const loadouts = {};
    
    // For each loadout, provide basic info but not the full system prompt
    Object.entries(aiService.config.loadouts).forEach(([name, config]) => {
      loadouts[name] = {
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        description: this.getLoadoutDescription(name)
      };
    });
    
    return loadouts;
  },
  
  /**
   * Get a user-friendly description for a loadout
   * 
   * @param {String} loadoutType The loadout type
   * @returns {String} A description of the loadout's purpose/behavior
   */
  getLoadoutDescription(loadoutType) {
    const descriptions = {
      'default': 'Balanced, general-purpose assistant for DegenDuel users',
      'errorAnalysis': 'Precise error analyzer with lower temperature for technical accuracy',
      'adminAnalysis': 'Admin activity analyzer for detecting patterns and anomalies',
      'dgenTerminal': 'Sassy, creative personality with higher temperature for engaging responses',
      'trading': 'Balanced trading advisor for helping with investment decisions',
      'support': 'Technical support specialist with lower temperature for accurate help',
      'creative': 'High-temperature creative mode for generating fun, unique content',
      'coding': 'Low-temperature coding assistant for accurate technical answers',
      'funny': 'Very high temperature mode for maximally humorous outputs'
    };
    
    return descriptions[loadoutType] || 'Custom AI configuration';
  },
  
  // ========== IMAGE GENERATION METHODS ==========
  
  /**
   * Generate an AI image with the given prompt and options
   * 
   * @param {String} prompt - Text prompt for the image generation
   * @param {String} imageType - Type of image (profile, contest, general)
   * @param {Object} options - Additional options and metadata
   * @returns {Promise<Object>} - Object containing image URL and metadata
   */
  async generateImage(prompt, imageType = 'general', options = {}) {
    return imageGenerator.generateImage(prompt, imageType, options);
  },
  
  /**
   * Generate an AI profile image for a user
   * 
   * @param {String} walletAddress - User's wallet address
   * @param {Object} options - Generation options including style
   * @returns {Promise<String>} - URL of the generated profile image
   */
  async generateUserProfileImage(walletAddress, options = {}) {
    return imageGenerator.generateUserProfileImage(walletAddress, options);
  },
  
  /**
   * Generate an enhanced profile image that incorporates token logos or other elements
   * 
   * @param {String} walletAddress - User's wallet address
   * @param {Array} sourceImages - Path(s) to source image(s) to incorporate
   * @param {Object} options - Generation options including style
   * @returns {Promise<String>} - URL of the generated profile image
   */
  async generateEnhancedProfileImage(walletAddress, sourceImages = [], options = {}) {
    return imageGenerator.generateEnhancedProfileImage(walletAddress, sourceImages, options);
  },
  
  /**
   * Generate an image edit using source images and a prompt
   * 
   * @param {Array|String} sourceImages - Path(s) to source image(s)
   * @param {String} prompt - The prompt describing the desired edits
   * @param {String|null} maskPath - Optional path to mask image
   * @param {Object} options - Additional options for generation
   * @returns {Promise<Object>} - Object containing the image URL and metadata
   */
  async generateImageEdit(sourceImages, prompt, maskPath = null, options = {}) {
    return imageGenerator.generateImageEdit(sourceImages, prompt, maskPath, options);
  },
  
  /**
   * Get available style options for profile images
   * 
   * @returns {Array<Object>} - List of available styles with descriptions
   */
  getProfileImageStyles() {
    return imageGenerator.getProfileImageStyles();
  },
  
  /**
   * Get image configuration templates for different image types
   * 
   * @returns {Object} - Configuration templates
   */
  getImageConfigTemplates() {
    return imageGenerator.getImageConfigTemplates();
  }
};

// Export as default and named export
export default AIApi;