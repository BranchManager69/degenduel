/**
 * Client Error Analyzer Module
 * 
 * This module handles the AI analysis of client errors, including:
 * - Fetching recent errors from the database
 * - Processing error data for analysis
 * - Generating AI analysis summaries
 * - Calculating error distributions by severity, browser, and OS
 * - Storing analysis results in the database
 * - Broadcasting notifications to admin users
 * 
 * @see /services/ai-service/README.md for complete documentation and architecture
 */

import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors, serviceSpecificColors } from '../../../utils/colors.js'; // Import service colors
import prisma from '../../../config/prisma.js';

/**
 * Analyze recent client errors and generate a summary
 * 
 * @param {Object} aiService - Reference to the parent AI service
 * @returns {Object|null} Analysis result or null if analysis was skipped
 */
export async function analyzeRecentClientErrors(aiService) {
  try {
    // Get unanalyzed errors - instead of using a time window, check which errors haven't been analyzed yet
    // Find errors that don't exist in the ai_analyzed_errors table
    const recentErrors = await prisma.client_errors.findMany({
      where: {
        // Look for errors that don't have an entry in the ai_analyzed_errors table
        NOT: {
          error_id: {
            in: (await prisma.ai_analyzed_errors.findMany({
              select: { error_id: true }
            })).map(e => e.error_id)
          }
        }
      },
      orderBy: { created_at: 'desc' }
    });
    
    // Skip if not enough errors to analyze
    if (recentErrors.length < aiService.config.analysis.clientErrors.minErrorsToAnalyze) {
      logApi.info(`${serviceSpecificColors.aiService.tag}[AISvc]${fancyColors.RESET} Skipping client error analysis - only ${recentErrors.length} errors found (minimum: ${aiService.config.analysis.clientErrors.minErrorsToAnalyze})`);
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
        content: `Analyze these ${recentErrors.length} client errors from the past ${aiService.config.analysis.clientErrors.lookbackMinutes} minutes and provide a summary:\n${JSON.stringify(errorData, null, 2)}`
      }
    ];
    
    const result = await aiService.generateChatCompletion(messages, {
      internal: true, // Flag as internal to skip conversation storage
      loadoutType: 'errorAnalysis' // Use the specialized error analysis loadout with lower temperature
    });
    
    // Store analysis results
    aiService.analysisStats.clientErrors = {
      total: aiService.analysisStats.clientErrors.total + 1,
      lastRunAt: new Date(),
      lastSummary: result.content,
      errorsAnalyzed: recentErrors.length
    };
    
    // Log the analysis
    logApi.info(`${serviceSpecificColors.aiService.tag}[AISvc]${fancyColors.RESET} ${serviceSpecificColors.aiService.success}AI Client Error Analysis Complete:${fancyColors.RESET} ${recentErrors.length} errors analyzed`, {
      summary: result.content.substring(0, 300) + (result.content.length > 300 ? '...' : ''),
      loadout: 'errorAnalysis'
    });
    
    // Calculate error pattern distributions
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
    const analysisResult = await prisma.ai_error_analyses.create({
      data: {
        summary: result.content,
        analyzed_at: new Date(),
        error_count: recentErrors.length,
        time_window_minutes: aiService.config.analysis.clientErrors.lookbackMinutes,
        severity_distribution: severityDistribution,
        browser_distribution: browserDistribution,
        os_distribution: osDistribution,
        top_errors: topErrors,
        created_by: 'system',
        // Create records in the junction table for each analyzed error
        analyzed_errors: {
          create: recentErrors.map(error => ({
            error_id: error.error_id,
            analyzed_at: new Date()
          }))
        }
      }
    });
    
    // Broadcast the new analysis to all admin users
    try {
      // Import the broadcaster if available
      const wsBroadcaster = (await import('../../../utils/websocket-suite/ws-broadcaster.js')).default;
      
      // Log WebSocket status before attempting broadcast
      logApi.debug(`${serviceSpecificColors.aiService.tag}[AISvc]${fancyColors.RESET} WebSocket status check: ${JSON.stringify({
        hasWebSocketConfig: !!config.websocket,
        hasUnifiedWebSocket: !!config.websocket?.unifiedWebSocket,
        serviceType: 'ai_service',
        operation: 'broadcast_error_analysis',
        timestamp: new Date().toISOString()
      })}`, { analysisId: analysisResult.id });
      
      // Prepare a notification payload with just the essential information
      const notificationData = {
        id: analysisResult.id,
        summary: result.content.substring(0, 200) + (result.content.length > 200 ? '...' : ''),
        analyzed_at: analysisResult.analyzed_at,
        error_count: recentErrors.length,
        critical_errors: Object.entries(severityDistribution).reduce((count, [level, value]) => {
          return level === 'critical' ? count + value : count;
        }, 0)
      };
      
      // Broadcast to ADMIN and SUPER_ADMIN roles - will throw error if broadcast fails
      const adminCount = await wsBroadcaster.broadcastToRole('ADMIN', 'ai_analysis', 'new_error_analysis', notificationData);
      const superAdminCount = await wsBroadcaster.broadcastToRole('SUPER_ADMIN', 'ai_analysis', 'new_error_analysis', notificationData);
      
      // Only log success if we actually sent messages
      const totalRecipients = adminCount + superAdminCount;
      if (totalRecipients > 0) {
        logApi.info(`${serviceSpecificColors.aiService.tag}[AISvc]${fancyColors.RESET} Broadcasted new error analysis to ${totalRecipients} admin recipients`);
      } else {
        logApi.info(`${serviceSpecificColors.aiService.tag}[AISvc]${fancyColors.RESET} Error analysis complete, but no admin clients connected to receive broadcast`);
      }
    } catch (broadcastError) {
      // Don't fail if broadcasting fails
      logApi.warn(`${serviceSpecificColors.aiService.tag}[AISvc]${fancyColors.RESET} Failed to broadcast error analysis: ${broadcastError.message}`);
    }
    
    return {
      summary: result.content,
      errorsAnalyzed: recentErrors.length,
      timestamp: new Date()
    };
  } catch (error) {
    logApi.error(`${serviceSpecificColors.aiService.tag}[AISvc]${fancyColors.RESET} ${fancyColors.RED}Client error analysis failed:${fancyColors.RESET}`, error);
    return null;
  }
}