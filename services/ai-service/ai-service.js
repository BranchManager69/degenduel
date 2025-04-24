/**
 * AI Service Core Implementation
 * 
 * This service provides AI functionality throughout the DegenDuel platform:
 * 1. Periodic Analysis: Runs every 10 minutes to analyze client errors and admin actions
 * 2. On-Demand API: Provides chat completion and streaming responses
 * 
 * The service implements circuit breaking to handle OpenAI API outages gracefully.
 */

import { BaseService } from '../../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import { ServiceError } from '../../utils/service-suite/service-error.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
// Note: Explicitly only importing fancyColors to avoid duplicate serviceColors
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../../config/prisma.js';
import config from '../../config/config.js';

// Import configuration
import AI_SERVICE_CONFIG from './models/loadout-config.js';

// Import analyzers
import { analyzeRecentClientErrors } from './analyzers/error-analyzer.js';
import { analyzeRecentAdminActions } from './analyzers/admin-analyzer.js';
import { analyzeErrorLogs, analyzeGeneralLogs, analyzeServiceLogs } from './analyzers/log-analyzer.js';

// Import prompt utilities
import { 
  enhancePromptWithUserContext, 
  sanitizeMessages, 
  ensureSystemPrompt
} from './utils/prompt-builder.js';

// Import terminal function handling
import { TERMINAL_FUNCTIONS, handleFunctionCall } from './utils/terminal-function-handler.js';

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
    
    // Track log analysis runs to respect configured intervals
    this.lastLogAnalysisRun = {
      general: null,
      error: null,
      services: {}
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
      
      // Automatically clean up old service logs (older than 30 days)
      try {
        const cleanupResult = await logApi.serviceLog.cleanup(30);
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Cleaned up ${cleanupResult.deletedCount} old service logs${fancyColors.RESET}`);
        
        // Write cleanup event to service logs
        await logApi.serviceLog.write(
          this.name,
          'info',
          `Startup maintenance: cleaned up ${cleanupResult.deletedCount} old service logs older than 30 days`,
          { deletedCount: cleanupResult.deletedCount, olderThan: cleanupResult.olderThan },
          {},
          'log_cleanup',
          0,
          null
        );
      } catch (cleanupError) {
        // Don't fail initialization if cleanup fails
        logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to clean up old service logs:${fancyColors.RESET}`, cleanupError);
      }
      
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
    // This is where periodic analysis runs
    const startTime = Date.now();
    
    try {
      let results = {
        clientErrors: null,
        adminActions: null,
        logs: {
          general: null,
          error: null,
          service: {}
        }
      };
      
      // Run client error analysis
      if (this.config.analysis.clientErrors.enabled) {
        results.clientErrors = await analyzeRecentClientErrors(this);
      }
      
      // Run admin actions analysis
      if (this.config.analysis.adminActions.enabled) {
        results.adminActions = await analyzeRecentAdminActions(this);
      }
      
      // Run log analysis if enabled
      if (this.config.analysis.logs?.enabled) {
        // 1. General log analysis
        if (this.config.analysis.logs.generalLogs?.enabled) {
          // Only run general log analysis on the scheduled interval
          const shouldRunGeneralLogs = !this.lastLogAnalysisRun?.general || 
            (Date.now() - this.lastLogAnalysisRun.general) > 
            (this.config.analysis.logs.generalLogs.runIntervalMinutes * 60 * 1000);
            
          if (shouldRunGeneralLogs) {
            results.logs.general = await analyzeGeneralLogs(
              this,
              '/home/websites/degenduel/logs', 
              this.config.analysis.logs.generalLogs.maxLines
            );
            this.lastLogAnalysisRun = this.lastLogAnalysisRun || {};
            this.lastLogAnalysisRun.general = Date.now();
          }
        }
        
        // 2. Error log analysis
        if (this.config.analysis.logs.errorLogs?.enabled) {
          // Only run error log analysis on the scheduled interval
          const shouldRunErrorLogs = !this.lastLogAnalysisRun?.error || 
            (Date.now() - this.lastLogAnalysisRun.error) > 
            (this.config.analysis.logs.errorLogs.runIntervalMinutes * 60 * 1000);
            
          if (shouldRunErrorLogs) {
            results.logs.error = await analyzeErrorLogs(
              this,
              this.config.analysis.logs.errorLogs.maxErrors
            );
            this.lastLogAnalysisRun = this.lastLogAnalysisRun || {};
            this.lastLogAnalysisRun.error = Date.now();
          }
        }
        
        // 3. Service log analysis
        if (this.config.analysis.logs.serviceLogs?.enabled && 
            this.config.analysis.logs.serviceLogs.services?.length > 0) {
          // Initialize service tracking if needed
          this.lastLogAnalysisRun = this.lastLogAnalysisRun || {};
          this.lastLogAnalysisRun.services = this.lastLogAnalysisRun.services || {};
          
          // Process each configured service
          for (const serviceKey of this.config.analysis.logs.serviceLogs.services) {
            // Only run service log analysis on the scheduled interval
            const shouldRunServiceLogs = !this.lastLogAnalysisRun.services[serviceKey] || 
              (Date.now() - this.lastLogAnalysisRun.services[serviceKey]) > 
              (this.config.analysis.logs.serviceLogs.runIntervalMinutes * 60 * 1000);
              
            if (shouldRunServiceLogs) {
              results.logs.service[serviceKey] = await analyzeServiceLogs(
                this,
                serviceKey,
                this.config.analysis.logs.serviceLogs.maxLines
              );
              this.lastLogAnalysisRun.services[serviceKey] = Date.now();
            }
          }
        }
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
          
          // Enhance prompt with user context
          systemPrompt = await enhancePromptWithUserContext(
            systemPrompt, 
            walletAddress, 
            userRole,
            this.name
          );
        } catch (error) {
          // If there's an error getting user data, just use the default prompt
          logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Failed to enhance system prompt with user data:`, error);
        }
      }
      
      // Validate and sanitize messages to prevent null content
      const sanitizedMessages = sanitizeMessages(messages);
      
      // Add system prompt to messages - ensure the security template is applied
      const messagesWithSystem = ensureSystemPrompt(sanitizedMessages, systemPrompt);
      
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
   * Generate an AI response using OpenAI Responses API with token function calling
   * 
   * @param {Array} messages - Array of message objects
   * @param {Object} options - Options for the API call
   * @returns {Object} Response with content and conversationId
   */
  async generateTokenAIResponse(messages, options = {}) {
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
      logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Using AI loadout with token functions: ${loadoutType}`, { 
        temperature: loadout.temperature,
        maxTokens: loadout.maxTokens,
        model: loadout.model
      });
      
      // Get base system prompt from loadout
      let systemPrompt = loadout.systemPrompt;
      
      // Add function usage guidance to system prompt
      systemPrompt += `\n\nYou have access to real-time data through these functions:

MARKET DATA FUNCTIONS (available to all users):
- getTokenPrice: Get current price, market cap, volume and details about any token (preferably using token address, but symbol is acceptable if address is not available)
- getTokenPriceHistory: Get historical price data for charting token trends (preferably using token address, but symbol is acceptable if address is not available)
- getTokenPools: Get liquidity pool information for tokens (preferably using token address, but symbol is acceptable if address is not available)
- getTokenMetricsHistory: Get comprehensive historical metrics (price, rank, volume, liquidity, market_cap) (preferably using token address, but symbol is acceptable if address is not available)

CONTEST FUNCTIONS (available to all users):
- getActiveContests: Get information about current and upcoming contests

USER DATA FUNCTIONS (available to all users):
- getUserProfile: Get detailed profile information about a specific user
- getTopUsers: Get leaderboard of top users by different metrics (contests_won, earnings, experience, referrals)
- getUserContestHistory: Get a user's contest participation history

PLATFORM ACTIVITY FUNCTIONS (available to all users):
- getPlatformActivity: Get recent platform-wide activity (contests, trades, achievements, transactions)

ADMIN-ONLY FUNCTIONS (only available to admins and superadmins):
- getServiceStatus: Get status of platform services
- getSystemSettings: Get current platform system settings
- getWebSocketStats: Get WebSocket connection statistics
- getIPBanStatus: Get information about banned IPs
- getDiscordWebhookEvents: Get recent Discord notification events

Call these functions when applicable to provide real-time, accurate data. If a user asks for admin-level information but doesn't have admin privileges, politely inform them that the requested information requires admin access.`;
      
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
          
          // Enhance prompt with user context
          systemPrompt = await enhancePromptWithUserContext(
            systemPrompt, 
            walletAddress, 
            userRole,
            this.name
          );
        } catch (err) {
          // If user lookup fails, just use the default prompt
          logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} User lookup failed:`, err);
        }
      }
      
      // Validate and sanitize messages to prevent null content
      const sanitizedMessages = sanitizeMessages(messages);
      
      // Add system prompt to messages - ensure the security template is applied
      const messagesWithSystem = ensureSystemPrompt(sanitizedMessages, systemPrompt);
      
      // Log request (with sensitive data removed)
      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} AI token response request received`, {
        userId: options.userId || 'anonymous',
        model: loadout.model,
        loadout: loadoutType,
        messageCount: sanitizedMessages.length,
        service: 'AI',
        conversationId
      });
      
      // Make API request to OpenAI using loadout configuration
      const response = await this.openai.responses.create({
        model: loadout.model,
        input: messagesWithSystem,
        temperature: loadout.temperature,
        max_tokens: loadout.maxTokens,
        tools: TERMINAL_FUNCTIONS.map(fn => ({
          type: "function",
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters
        })), // Use tools format for the newer responses API
        tool_choice: "required", // Force the model to call a function
        stream: false,
        user: options.userId || 'anonymous'
      });
      
      // Process function calls if present
      // Look for function calls in the response
      const toolCall = response.output.find(item => 
        item.type === 'function_call'
      );
      
      if (toolCall) {
        const functionInfo = {
          name: toolCall.name,
          arguments: toolCall.arguments
        };
        const toolCallId = toolCall.call_id;
        
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Token function call detected:`, {
          function: functionInfo.name,
          arguments: functionInfo.arguments
        });
        
        // Handle the function call with user context for permissions
        const functionOptions = {
          userId: options.userId,
          walletAddress: options.walletAddress,
          userRole: options.userRole || 'user'
        };
        
        // Call our function handler with the OpenAI function call
        const functionResponse = await handleFunctionCall({
          function: {
            name: functionInfo.name,
            arguments: functionInfo.arguments
          }
        }, functionOptions);
        
        // Add the function call to the input array exactly as it came from the model
        const inputWithFunctionCall = [
          ...messagesWithSystem,
          toolCall // Append the entire original function call output object from the model
        ];

        // Then add the function output following the exact format from the documentation
        inputWithFunctionCall.push({
          type: "function_call_output",
          call_id: toolCallId,
          output: JSON.stringify(functionResponse)
        });
        
        // Call the model again with the function results
        const secondResponse = await this.openai.responses.create({
          model: loadout.model,
          input: inputWithFunctionCall,
          tools: TERMINAL_FUNCTIONS.map(fn => ({
            type: "function",
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters
          })),
          temperature: loadout.temperature,
          max_tokens: loadout.maxTokens,
          stream: false,
          user: options.userId || 'anonymous'
        });
        
        // Store conversation and messages if user is authenticated
        if (isAuthenticated && walletAddress && conversationId) {
          try {
            await this.storeConversation(
              conversationId,
              walletAddress,
              sanitizedMessages[sanitizedMessages.length - 1],
              secondResponse.output_text,
              loadoutType
            );
          } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Failed to store conversation:`, error);
          }
        }
        
        // Update performance metrics
        this.stats.performance.lastOperationTimeMs = Date.now() - startTime;
        this.stats.operations.total++;
        this.stats.operations.successful++;
        
        return {
          content: secondResponse.output_text,
          functionCalled: functionCall.function.name,
          conversationId
        };
      }
      
      // No function call, just return the regular response
      // Store conversation and messages if user is authenticated
      if (isAuthenticated && walletAddress && conversationId) {
        try {
          await this.storeConversation(
            conversationId,
            walletAddress,
            sanitizedMessages[sanitizedMessages.length - 1],
            response.output_text,
            loadoutType
          );
        } catch (error) {
          logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Failed to store conversation:`, error);
        }
      }
      
      // Update performance metrics
      this.stats.performance.lastOperationTimeMs = Date.now() - startTime;
      this.stats.operations.total++;
      this.stats.operations.successful++;
      
      return {
        content: response.output_text,
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
        throw new ServiceError('openai_api_error', 'AI service token function error');
      }
    }
  }
  
  /**
   * Helper method to store a conversation in the database
   * 
   * @param {string} conversationId - Conversation ID
   * @param {string} walletAddress - User's wallet address
   * @param {Object} userMessage - User's message
   * @param {string} assistantResponse - AI assistant's response
   * @param {string} loadoutType - The loadout type used
   */
  async storeConversation(conversationId, walletAddress, userMessage, assistantResponse, loadoutType) {
    // Upsert the conversation record
    const conversation = await prisma.ai_conversations.upsert({
      where: { conversation_id: conversationId },
      update: {
        message_count: { increment: 2 },
        total_tokens_used: { increment: assistantResponse.length },
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
        total_tokens_used: assistantResponse.length
      }
    });
    
    // Store user message
    if (userMessage?.role === 'user') {
      await prisma.ai_conversation_messages.create({
        data: { 
          conversation_id: conversationId, 
          role: userMessage.role, 
          content: userMessage.content 
        }
      });
    }
    
    // Store AI response
    await prisma.ai_conversation_messages.create({
      data: { 
        conversation_id: conversationId, 
        role: 'assistant', 
        content: assistantResponse 
      }
    });
    
    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Stored conversation and messages`, {
      conversationId,
      walletAddress,
      loadout: loadoutType
    });
  }

  /**
   * Generate an AI response using OpenAI Responses API with streaming
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
          
          // Enhance prompt with user context
          systemPrompt = await enhancePromptWithUserContext(
            systemPrompt, 
            walletAddress, 
            userRole,
            this.name
          );
        } catch (err) {
          // If user lookup fails, just use the default prompt
          logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} User lookup failed:`, err);
        }
      }
      
      // Validate and sanitize messages to prevent null content
      const sanitizedMessages = sanitizeMessages(messages);
      
      // Add system prompt to messages - ensure the security template is applied
      const messagesWithSystem = ensureSystemPrompt(sanitizedMessages, systemPrompt);
      
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
        tools: options.functions ? options.functions.map(fn => ({
          type: "function",
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters
        })) : [], // support function calling with proper tools format
        tool_choice: options.functions?.length > 0 ? "required" : "auto", // Force function calling if functions are provided
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
          
          // Handle function calls if present in streaming format
          if (payload.choices?.[0]?.delta?.tool_calls) {
            // Tool call detected in streaming
            const toolCalls = payload.choices[0].delta.tool_calls;
            for (const toolCall of toolCalls) {
              if (toolCall.type === 'function') {
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Function call received:`, { 
                  function: toolCall.function
                });
              }
            }
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
            
            // Store the conversation
            await this.storeConversation(
              conversationId,
              walletAddress,
              userMessage,
              fullResponse,
              loadoutType
            );
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
export const generateTokenAIResponse = aiService.generateTokenAIResponse.bind(aiService);

export default aiService;