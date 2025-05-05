/**
 * AI Service Module
 * 
 * Exports the AI service singleton instance for DegenDuel platform.
 * 
 * This service provides AI functionality throughout the platform:
 * 1. Periodic Analysis: Runs every 10 minutes to analyze client errors and admin actions
 * 2. On-Demand API: Provides chat completion and streaming responses
 * 
 * @see /services/ai-service/README.md for full documentation
 */

import aiService from './ai-service.js';

export default aiService;