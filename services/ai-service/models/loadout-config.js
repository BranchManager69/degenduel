/**
 * AI Model Loadout Configuration Module
 * 
 * This module contains the configuration for different AI model loadouts
 * used by the AI service. Each loadout configures:
 * - Model to use
 * - Temperature
 * - Max tokens
 * - System prompt
 */

import config from '../../../config/config.js';
import { SERVICE_NAMES } from '../../../utils/service-suite/service-constants.js';

// Get AI loadout config from application config
const aiLoadout = config.ai?.openai_model_loadout || {};

/**
 * AI Service configuration with all loadouts
 */
const AI_SERVICE_CONFIG = {
  name: SERVICE_NAMES.AI_SERVICE,
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
      model: aiLoadout.default?.model || 'gpt-4o',
      maxTokens: aiLoadout.default?.max_tokens || 1000,
      temperature: aiLoadout.default?.temperature || 0.76,
      systemPrompt: aiLoadout.default?.system || "You are a helpful assistant for DegenDuel users."
    },
    
    // Special loadout for error analysis - focused on precision
    errorAnalysis: {
      model: 'gpt-4o',
      maxTokens: 2000,  // More tokens for thorough analysis
      temperature: 0.3, // Lower temperature for more deterministic analysis
      systemPrompt: "You are an error analysis assistant for DegenDuel. Analyze the provided client errors and provide a concise summary of patterns, potential causes, and recommendations. Focus on identifying recurring issues and severity. Your analysis should be actionable and help the development team fix these errors quickly."
    },
    
    // Special loadout for admin log analysis - focused on pattern detection
    adminAnalysis: {
      model: 'gpt-4o',
      maxTokens: 2000,  // More tokens for thorough analysis
      temperature: 0.3, // Lower temperature for more deterministic analysis
      systemPrompt: "You are an admin activity analysis assistant for DegenDuel. Analyze the provided admin actions and provide a concise summary of activity patterns, unusual behaviors, and key statistics. Focus on identifying high-impact actions and potential security concerns."
    },
    
    // Creative personality for Degen Terminal
    degenTerminal: {
      model: 'gpt-4o',
      maxTokens: 600,   // Shorter, punchier responses
      temperature: 0.9, // Higher temperature for more creative responses
      systemPrompt: aiLoadout.creative?.system || "You are Degen, the sassy and fun virtual assistant for DegenDuel. You have a playful personality and enjoy using crypto slang. Be engaging, witty, and occasionally irreverent while still being helpful. Users are here to have fun while trading, so match their energy!"
    },
    
    // Trading advisor loadout
    trading: {
      model: aiLoadout.trading?.model || 'gpt-4o',
      maxTokens: 1200,
      temperature: 0.5, // Balanced for creativity and accuracy
      systemPrompt: aiLoadout.trading?.system
    },
    
    // Technical support loadout
    support: {
      model: 'gpt-4o',
      maxTokens: 1500,
      temperature: 0.3, // Lower for more accurate technical answers
      systemPrompt: "You are a technical support specialist for DegenDuel. Provide clear, accurate, and concise answers to user questions about the platform. Focus on troubleshooting, explaining features, and guiding users through common issues."
    },
    
    // Additional loadouts can be added as needed
    creative: {
      model: aiLoadout.creative?.model || 'gpt-4o',
      maxTokens: aiLoadout.creative?.max_tokens || 800,
      temperature: aiLoadout.creative?.temperature || 0.9,
      systemPrompt: aiLoadout.creative?.system
    },
    
    coding: {
      model: aiLoadout.coding?.model || 'gpt-4o',
      maxTokens: aiLoadout.coding?.max_tokens || 1500,
      temperature: aiLoadout.coding?.temperature || 0.2,
      systemPrompt: aiLoadout.coding?.system
    },
    
    funny: {
      model: aiLoadout.funny?.model || 'gpt-4o',
      maxTokens: aiLoadout.funny?.max_tokens || 600,
      temperature: aiLoadout.funny?.temperature || 0.95,
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

export default AI_SERVICE_CONFIG;