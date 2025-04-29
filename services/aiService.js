// services/aiService.js

/**
 * AI Service
 * 
 * This service provides AI functionality throughout the DegenDuel platform.
 * It has three main components:
 * 
 * 1. Periodic Analysis: Runs every 10 minutes to analyze client errors and admin actions
 * 2. On-Demand API: Provides chat completion and streaming responses for application use
 * 3. Image Generation: Creates AI-generated images for various use cases including user profiles
 * 
 * The service implements circuit breaking to handle OpenAI API outages gracefully.
 */

import { BaseService } from '../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
import serviceManager from '../utils/service-suite/service-manager.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/prisma.js';
import config from '../config/config.js';
import imageGenerator from './ai-service/image-generator.js';

// Get AI loadout config
const aiLoadout = config.ai?.openai_model_loadout || {};

// AI Service configuration
const AI_SERVICE_CONFIG = {
  name: SERVICE_NAMES.AI_SERVICE, // Using service name from constants
  description: 'AI Analysis and Processing Service',
  layer: 'application',
  criticalLevel: 'non-critical',
  
  // Run analysis every 10 minutes
  checkIntervalMs: 10 * 60 * 1000,
  
  circuitBreaker: {
    enabled: true,
    failureThreshold: 3,
    resetTimeoutMs: 30000
  },
  
  // Analysis settings
  analysis: {
    clientErrors: {
      enabled: true,
      lookbackMinutes: 10,
      minErrorsToAnalyze: 1  // Analyze even a single error
    },
    adminActions: {
      enabled: true,
      lookbackMinutes: 15,
      minActionsToAnalyze: 1  // Analyze even a single admin action
    }
  },
  
  // Model loadouts - specialized configurations for different operations
  loadouts: {
    // Default loadout - used when no specific loadout is specified
    default: {
      model: aiLoadout.default?.model || 'gpt-4.1-mini',
      maxTokens: aiLoadout.default?.max_tokens || 2000,
      temperature: aiLoadout.default?.temperature || 0.4,
      systemPrompt: aiLoadout.default?.system || "You are a helpful assistant for DegenDuel users."
    },
    
    // Special loadout for error analysis - focused on precision
    errorAnalysis: {
      model: 'gpt-4.1-mini',
      maxTokens: 3000,  // More tokens for thorough analysis
      temperature: 0.4, // Lower temperature for more deterministic analysis
      systemPrompt: "You are an error analysis assistant for DegenDuel. Analyze the provided client errors and provide a concise summary of patterns, potential causes, and recommendations. Focus on identifying recurring issues and severity. Your analysis should be actionable and help the development team fix these errors quickly."
    },
    
    // Special loadout for admin log analysis - focused on pattern detection
    adminAnalysis: {
      model: 'gpt-4.1-mini',
      maxTokens: 3000,  // More tokens for thorough analysis
      temperature: 0.4, // Lower temperature for more deterministic analysis
      systemPrompt: "You are an admin activity analysis assistant for DegenDuel. Analyze the provided admin actions and provide a concise summary of activity patterns, unusual behaviors, and key statistics. Focus on identifying high-impact actions and potential security concerns."
    },
    
    // Creative personality for Degen Terminal
    degenTerminal: {
      model: 'gpt-4.1-mini',
      maxTokens: 1000,   // Shorter, punchier responses
      temperature: 0.7, // Higher temperature for more creative responses
      systemPrompt: aiLoadout.creative?.system || "You are Degen, the sassy and fun virtual assistant for DegenDuel. You have a playful personality and enjoy using crypto slang. Be engaging, witty, and occasionally irreverent while still being helpful. Users are here to have fun while trading, so match their energy!"
    },
    
    // Trading advisor loadout
    trading: {
      model: aiLoadout.trading?.model || 'gpt-4.1-mini',
      maxTokens: 2000,
      temperature: 0.5, // Balanced for creativity and accuracy
      systemPrompt: aiLoadout.trading?.system
    },
    
    // Technical support loadout
    support: {
      model: 'gpt-4.1-mini',
      maxTokens: 2000,
      temperature: 0.4, // Lower for more accurate technical answers
      systemPrompt: "You are a technical support specialist for DegenDuel. Provide clear, accurate, and concise answers to user questions about the platform. Focus on troubleshooting, explaining features, and guiding users through common issues."
    },
    
    // Additional loadouts can be added as needed
    creative: {
      model: aiLoadout.creative?.model || 'gpt-4.1-mini',
      maxTokens: aiLoadout.creative?.max_tokens || 2000,
      temperature: aiLoadout.creative?.temperature || 0.7,
      systemPrompt: aiLoadout.creative?.system
    },
    
    coding: {
      model: aiLoadout.coding?.model || 'gpt-4.1-mini',
      maxTokens: aiLoadout.coding?.max_tokens || 2000,
      temperature: aiLoadout.coding?.temperature || 0.4,
      systemPrompt: aiLoadout.coding?.system
    },
    
    funny: {
      model: aiLoadout.funny?.model || 'gpt-4.1-mini',
      maxTokens: aiLoadout.funny?.max_tokens || 2000,
      temperature: aiLoadout.funny?.temperature || 0.75,
      systemPrompt: aiLoadout.funny?.system
    }
  },
  
  // Legacy support for previous configuration pattern
  // These will still work but we'll prefer the loadouts above
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

/**
 * AIService class - implements both periodic analysis and on-demand AI functionality
 * @extends BaseService
 */
class AIService extends BaseService {
  constructor() {
    super(AI_SERVICE_CONFIG);
    this.openai = null;
    
    // Track analysis stats
    this.analysisStats = {
      clientErrors: {
        total: 0,
        lastRunAt: null,
        lastSummary: null,
        errorsAnalyzed: 0
      },
      adminActions: {
        total: 0,
        lastRunAt: null,
        lastSummary: null,
        actionsAnalyzed: 0
      }
    };
  }
  
  /**
   * Initialize the service
   */
  async initialize() {
    try {
      // Check if AI service is disabled via service profile
      if (!config.services?.ai_service) {
        logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} AI Service is disabled in the '${config.services.active_profile}' service profile`);
        return false;
      }
      
      // Ensure we have an API key
      if (!config.api_keys?.openai) {
        logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} MISSING API KEY ${fancyColors.RESET} OpenAI API key is not configured. AI features will be disabled.`);
        return false;
      }
      
      await super.initialize();
      
      // Initialize OpenAI client
      this.openai = new OpenAI({
        apiKey: config.api_keys.openai
      });
      
      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}AI Service initialized with periodic analysis enabled${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET}`, error);
      throw error;
    }
  }
  
  /**
   * Main service operation - runs on the configured interval
   */
  async onPerformOperation() {
    // This is where your periodic analysis runs
    const startTime = Date.now();
    
    try {
      let results = {
        clientErrors: null,
        adminActions: null
      };
      
      // Run client error analysis
      if (this.config.analysis.clientErrors.enabled) {
        results.clientErrors = await this.analyzeRecentClientErrors();
      }
      
      // Run admin actions analysis
      if (this.config.analysis.adminActions.enabled) {
        results.adminActions = await this.analyzeRecentAdminActions();
      }
      
      // Update performance stats
      this.stats.performance.lastOperationTimeMs = Date.now() - startTime;
      this.stats.operations.total++;
      this.stats.operations.successful++;
      
      return results;
    } catch (error) {
      // Update error stats
      this.stats.operations.total++;
      this.stats.operations.failed++;
      
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Analysis operation failed:${fancyColors.RESET}`, error);
      throw new ServiceError('ai_analysis_failed', error);
    }
  }
  
  // ========== PERIODIC ANALYSIS METHODS ==========
  
  /**
   * Analyze recent client errors and generate a summary
   */
  async analyzeRecentClientErrors() {
    try {
      // Get cutoff time for analysis window
      const cutoffTime = new Date(Date.now() - (this.config.analysis.clientErrors.lookbackMinutes * 60 * 1000));
      
      // Find errors since last analysis or cutoff time
      const lastRunTime = this.analysisStats.clientErrors.lastRunAt || cutoffTime;
      
      // Get recent errors
      const recentErrors = await prisma.client_errors.findMany({
        where: {
          created_at: { gte: lastRunTime }
        },
        orderBy: { created_at: 'desc' }
      });
      
      // Skip if not enough errors to analyze
      if (recentErrors.length < this.config.analysis.clientErrors.minErrorsToAnalyze) {
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Skipping client error analysis - only ${recentErrors.length} errors found (minimum: ${this.config.analysis.clientErrors.minErrorsToAnalyze})`);
        return null;
      }
      
      // Prepare error data for analysis
      const errorData = recentErrors.map(error => ({
        id: error.id,
        message: error.message,
        browser: error.browser,
        browserVersion: error.browser_version,
        os: error.os,
        path: error.source_url,
        count: error.occurrences,
        stack: error.stack_trace ? error.stack_trace.substring(0, 500) : null,
        status: error.status,
        is_critical: error.is_critical
      }));
      
      // Generate analysis with OpenAI using the errorAnalysis loadout
      const messages = [
        {
          role: 'user',
          content: `Analyze these ${recentErrors.length} client errors from the past ${this.config.analysis.clientErrors.lookbackMinutes} minutes and provide a summary:\n${JSON.stringify(errorData, null, 2)}`
        }
      ];
      
      const result = await this.generateChatCompletion(messages, {
        internal: true, // Flag as internal to skip conversation storage
        loadoutType: 'errorAnalysis' // Use the specialized error analysis loadout with lower temperature
      });
      
      // Store analysis results
      this.analysisStats.clientErrors = {
        total: this.analysisStats.clientErrors.total + 1,
        lastRunAt: new Date(),
        lastSummary: result.content,
        errorsAnalyzed: recentErrors.length
      };
      
      // Log the analysis
      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}AI Client Error Analysis Complete:${fancyColors.RESET} ${recentErrors.length} errors analyzed`, {
        summary: result.content.substring(0, 300) + (result.content.length > 300 ? '...' : ''),
        loadout: 'errorAnalysis'
      });
      
      // Analyze error patterns for better insights
      const severityDistribution = recentErrors.reduce((acc, error) => {
        const level = error.level || 'error';
        acc[level] = (acc[level] || 0) + 1;
        return acc;
      }, {});
      
      const browserDistribution = recentErrors.reduce((acc, error) => {
        const browser = error.browser || 'unknown';
        acc[browser] = (acc[browser] || 0) + 1;
        return acc;
      }, {});
      
      const osDistribution = recentErrors.reduce((acc, error) => {
        const os = error.os || 'unknown';
        acc[os] = (acc[os] || 0) + 1;
        return acc;
      }, {});
      
      // Create top errors list
      const topErrors = recentErrors
        .sort((a, b) => b.occurrences - a.occurrences)
        .slice(0, 5)
        .map(error => ({
          id: error.id,
          message: error.message,
          occurrences: error.occurrences,
          last_occurred_at: error.last_occurred_at
        }));
      
      // Store the analysis in a dedicated table with proper structure
      await prisma.ai_error_analyses.create({
        data: {
          summary: result.content,
          analyzed_at: new Date(),
          error_count: recentErrors.length,
          time_window_minutes: this.config.analysis.clientErrors.lookbackMinutes,
          severity_distribution: severityDistribution,
          browser_distribution: browserDistribution,
          os_distribution: osDistribution,
          top_errors: topErrors,
          created_by: 'system'
        }
      });
      
      return {
        summary: result.content,
        errorsAnalyzed: recentErrors.length,
        timestamp: new Date()
      };
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Client error analysis failed:${fancyColors.RESET}`, error);
      return null;
    }
  }
  
  /**
   * Analyze recent admin actions and generate insights
   */
  async analyzeRecentAdminActions() {
    try {
      // Get cutoff time for analysis window
      const cutoffTime = new Date(Date.now() - (this.config.analysis.adminActions.lookbackMinutes * 60 * 1000));
      
      // Find actions since last analysis or cutoff time
      const lastRunTime = this.analysisStats.adminActions.lastRunAt || cutoffTime;
      
      // Get recent admin logs
      const recentActions = await prisma.admin_logs.findMany({
        where: {
          created_at: { gte: lastRunTime }
        },
        orderBy: { created_at: 'desc' }
      });
      
      // Skip if not enough actions to analyze
      if (recentActions.length < this.config.analysis.adminActions.minActionsToAnalyze) {
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Skipping admin actions analysis - only ${recentActions.length} actions found (minimum: ${this.config.analysis.adminActions.minActionsToAnalyze})`);
        return null;
      }
      
      // Prepare action data for analysis
      const actionData = recentActions.map(log => ({
        admin: log.admin_address,
        action: log.action,
        timestamp: log.created_at,
        details: log.details
      }));
      
      // Generate analysis with OpenAI using adminAnalysis loadout
      const messages = [
        {
          role: 'user',
          content: `Analyze these ${recentActions.length} admin actions from the past ${this.config.analysis.adminActions.lookbackMinutes} minutes and provide a summary:\n${JSON.stringify(actionData, null, 2)}`
        }
      ];
      
      const result = await this.generateChatCompletion(messages, {
        internal: true, // Flag as internal to skip conversation storage
        loadoutType: 'adminAnalysis' // Use the specialized admin analysis loadout with lower temperature
      });
      
      // Store analysis results
      this.analysisStats.adminActions = {
        total: this.analysisStats.adminActions.total + 1,
        lastRunAt: new Date(),
        lastSummary: result.content,
        actionsAnalyzed: recentActions.length
      };
      
      // Log the analysis
      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}AI Admin Actions Analysis Complete:${fancyColors.RESET} ${recentActions.length} actions analyzed`, {
        summary: result.content.substring(0, 300) + (result.content.length > 300 ? '...' : ''),
        loadout: 'adminAnalysis'
      });
      
      // Analyze action patterns for better insights
      const actionDistribution = recentActions.reduce((acc, action) => {
        const actionType = action.action || 'unknown';
        acc[actionType] = (acc[actionType] || 0) + 1;
        return acc;
      }, {});
      
      const adminDistribution = recentActions.reduce((acc, action) => {
        const adminAddress = action.admin_address || 'unknown';
        acc[adminAddress] = (acc[adminAddress] || 0) + 1;
        return acc;
      }, {});
      
      // Create top actions list
      const topActions = Object.entries(actionDistribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([action, count]) => ({
          action,
          count
        }));
      
      // Store the analysis in a dedicated table with proper structure
      await prisma.ai_admin_action_analyses.create({
        data: {
          summary: result.content,
          analyzed_at: new Date(),
          action_count: recentActions.length,
          time_window_minutes: this.config.analysis.adminActions.lookbackMinutes,
          action_distribution: actionDistribution,
          admin_distribution: adminDistribution,
          top_actions: topActions,
          created_by: 'system'
        }
      });
      
      return {
        summary: result.content,
        actionsAnalyzed: recentActions.length,
        timestamp: new Date()
      };
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Admin actions analysis failed:${fancyColors.RESET}`, error);
      return null;
    }
  }
  
  // ========== ON-DEMAND API METHODS ==========
  
  /**
   * Generate a chat completion using OpenAI Chat API
   * 
   * @param {Array} messages - Array of message objects with role and content
   * @param {Object} options - Options for the API call
   * @returns {Object} Response with content and usage statistics
   */
  async generateChatCompletion(messages, options = {}) {
    const startTime = Date.now();
    
    try {
      // Check if circuit breaker is open
      if (this.stats.circuitBreaker.isOpen) {
        throw new ServiceError('ai_service_circuit_open', 'AI service circuit breaker is open');
      }
      
      // Determine which loadout to use
      const loadoutType = options.loadoutType || 'default';
      const loadout = this.config.loadouts[loadoutType] || this.config.loadouts.default;
      
      // Log which loadout we're using
      logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Using AI loadout: ${loadoutType}`, { 
        temperature: loadout.temperature,
        maxTokens: loadout.maxTokens,
        model: loadout.model
      });
      
      // Get base system prompt from loadout
      let systemPrompt = loadout.systemPrompt;
      
      // Track conversation if user is authenticated
      let conversationId = options.conversationId;
      let isAuthenticated = false;
      let walletAddress = null;
      
      // Check if we have a logged-in user and it's not an internal request
      if (!options.internal && options.userId && options.userId !== 'anonymous') {
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
          }
        } catch (error) {
          // If there's an error getting user data, just use the default prompt
          logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Failed to enhance system prompt with user data:`, error);
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
      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} AI chat request received`, {
        userId: options.userId || 'anonymous',
        model: loadout.model,
        loadout: loadoutType,
        messageCount: sanitizedMessages.length,
        service: 'AI',
        conversationId,
        internal: options.internal || false
      });
      
      // Make API request to OpenAI using loadout configuration
      const response = await this.openai.chat.completions.create({
        model: loadout.model,
        messages: messagesWithSystem,
        temperature: loadout.temperature,
        max_tokens: loadout.maxTokens,
        user: options.userId || 'anonymous'
      });
      
      // Log successful response (with usage metrics for cost tracking)
      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} AI chat response generated`, {
        userId: options.userId || 'anonymous',
        model: loadout.model,
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
        service: 'AI',
        durationMs: Date.now() - startTime
      });
      
      // Store conversation and messages if user is authenticated and not an internal request
      if (!options.internal && isAuthenticated && walletAddress && conversationId) {
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
                context: loadoutType, // Store the loadout type as context
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
        } catch (error) {
          // Don't fail the whole request if conversation storage fails
          logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Failed to store conversation:`, error);
        }
      }
      
      // Update performance metrics
      this.stats.performance.lastOperationTimeMs = Date.now() - startTime;
      this.stats.operations.total++;
      this.stats.operations.successful++;
      
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
      // Update error stats
      this.stats.operations.total++;
      this.stats.operations.failed++;
      
      // Handle OpenAI-specific errors
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} OpenAI API error:`, error);
      
      // Check for billing/quota error specifically
      if (error.status === 429 && error.message && error.message.includes('exceeded your current quota')) {
        throw new ServiceError('openai_quota_exceeded', '[DEV IS BROKE!] Looks like Branch Manager needs to pay the AI bill... The rest of the DegenDuel server is functioning properly!');
      }
      
      // Determine other error types and rethrow with appropriate status
      if (error.status === 401) {
        throw new ServiceError('openai_auth_error', 'Authentication error with AI service');
      } else if (error.status === 429) {
        throw new ServiceError('openai_rate_limit', 'Rate limit exceeded for AI service');
      } else {
        throw new ServiceError('openai_api_error', 'AI service error');
      }
    }
  }
  
  /**
   * Generate an AI response using OpenAI Responses API
   * 
   * @param {Array} messages - Array of message objects
   * @param {Object} options - Options for the API call
   * @returns {Object} Response with stream and conversationId
   */
  async generateAIResponse(messages, options = {}) {
    const startTime = Date.now();
    
    try {
      // Check if circuit breaker is open
      if (this.stats.circuitBreaker.isOpen) {
        throw new ServiceError('ai_service_circuit_open', 'AI service circuit breaker is open');
      }
      
      // Determine which loadout to use
      const loadoutType = options.loadoutType || 'default';
      const loadout = this.config.loadouts[loadoutType] || this.config.loadouts.default;
      
      // Log which loadout we're using
      logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Using AI loadout for streaming: ${loadoutType}`, { 
        temperature: loadout.temperature,
        maxTokens: loadout.maxTokens,
        model: loadout.model
      });
      
      // Get base system prompt from loadout
      let systemPrompt = loadout.systemPrompt;
      
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
          logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} User lookup failed:`, err);
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
      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} AI response stream request received`, {
        userId: options.userId || 'anonymous',
        model: loadout.model,
        loadout: loadoutType,
        messageCount: sanitizedMessages.length,
        service: 'AI',
        conversationId
      });
      
      // Make API request to OpenAI using loadout configuration
      const stream = await this.openai.responses.create({
        model: loadout.model,
        input: messagesWithSystem,
        temperature: loadout.temperature,
        max_tokens: loadout.maxTokens,
        stream: true,
        functions: options.functions || [], // support function calling
      }, { responseType: 'stream' });
      
      // Track for performance metrics
      this.stats.operations.total++;
      this.stats.operations.successful++;
      
      // Process the stream response
      let fullResponse = '';
      stream.data.on('data', chunk => {
        // Split the chunk into payloads
        const payloads = chunk.toString().split('\n\n').filter(Boolean)
          .map(p => {
            try {
              return JSON.parse(p.replace(/^data: /, ''));
            } catch (e) {
              return null;
            }
          })
          .filter(Boolean);
        
        // Process each payload in the stream
        for (const payload of payloads) {
          if (payload.choices[0]?.delta?.content) {
            fullResponse += payload.choices[0].delta.content;
          }
          
          // Handle function call if present...
          if (payload.choices[0]?.message?.function_call) {
            // You can wire in your function_call logic here
            const functionCall = payload.choices[0].message.function_call;
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Function call received:`, { functionCall });
          }
        }
      });
      
      // Handle the end of the stream
      stream.data.on('end', async () => {
        // Update performance metrics
        this.stats.performance.lastOperationTimeMs = Date.now() - startTime;
        
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
                context: loadoutType, // Store the loadout type as context
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
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Stored conversation and messages for streaming response`, { 
              conversationId, 
              walletAddress,
              loadout: loadoutType
            });
          } catch (e) {
            // Log storage failure
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Storage failure during AI conversation update for streaming response:`, e);
          }
        }
      });
      
      // Return the stream response
      return {
        stream: stream.data,
        conversationId
      };
    } catch (error) {
      // Update error stats
      this.stats.operations.total++;
      this.stats.operations.failed++;
      
      // Log the error
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} OpenAI Responses API error:`, error);
      
      // Check for specific error types
      if (error.status === 429 && error.message && error.message.includes('exceeded your current quota')) {
        throw new ServiceError('openai_quota_exceeded', '[DEV IS BROKE!] Looks like Branch Manager needs to pay the AI bill... The rest of the DegenDuel server is functioning properly!');
      } else if (error.status === 401) {
        throw new ServiceError('openai_auth_error', 'Authentication error with AI service');
      } else if (error.status === 429) {
        throw new ServiceError('openai_rate_limit', 'Rate limit exceeded for AI service');
      } else {
        throw new ServiceError('openai_api_error', 'AI service streaming error');
      }
    }
  }
}

// Create and export singleton instance
const aiService = new AIService();

// Register with service manager
serviceManager.register(aiService);

// Export the generateChatCompletion method directly for routes
export const generateChatCompletion = aiService.generateChatCompletion.bind(aiService);

// Add image generation methods to the AI service
aiService.generateImage = imageGenerator.generateImage;
aiService.generateUserProfileImage = imageGenerator.generateUserProfileImage;
aiService.generateImageEdit = imageGenerator.generateImageEdit;
aiService.generateEnhancedProfileImage = imageGenerator.generateEnhancedProfileImage;
aiService.getProfileImageStyles = imageGenerator.getProfileImageStyles;
aiService.getImageConfigTemplates = imageGenerator.getConfigTemplates;

export default aiService;