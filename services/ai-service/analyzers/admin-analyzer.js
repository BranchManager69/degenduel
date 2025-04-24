/**
 * Admin Action Analyzer Module
 * 
 * This module handles the AI analysis of admin actions, including:
 * - Fetching recent admin actions from the database
 * - Processing action data for analysis
 * - Generating AI analysis summaries
 * - Calculating action distributions by type and admin
 * - Storing analysis results in the database
 */

import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js'; // Only import fancyColors to avoid duplicates
import prisma from '../../../config/prisma.js';

/**
 * Analyze recent admin actions and generate insights
 * 
 * @param {Object} aiService - Reference to the parent AI service
 * @returns {Object|null} Analysis result or null if analysis was skipped
 */
export async function analyzeRecentAdminActions(aiService) {
  try {
    // Get cutoff time for analysis window
    const cutoffTime = new Date(Date.now() - (aiService.config.analysis.adminActions.lookbackMinutes * 60 * 1000));
    
    // Find actions since last analysis or cutoff time
    const lastRunTime = aiService.analysisStats.adminActions.lastRunAt || cutoffTime;
    
    // Get recent admin logs
    const recentActions = await prisma.admin_logs.findMany({
      where: {
        created_at: { gte: lastRunTime }
      },
      orderBy: { created_at: 'desc' }
    });
    
    // Skip if not enough actions to analyze
    if (recentActions.length < aiService.config.analysis.adminActions.minActionsToAnalyze) {
      logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Skipping admin actions analysis - only ${recentActions.length} actions found (minimum: ${aiService.config.analysis.adminActions.minActionsToAnalyze})`);
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
        content: `Analyze these ${recentActions.length} admin actions from the past ${aiService.config.analysis.adminActions.lookbackMinutes} minutes and provide a summary:\n${JSON.stringify(actionData, null, 2)}`
      }
    ];
    
    const result = await aiService.generateChatCompletion(messages, {
      internal: true, // Flag as internal to skip conversation storage
      loadoutType: 'adminAnalysis' // Use the specialized admin analysis loadout with lower temperature
    });
    
    // Store analysis results
    aiService.analysisStats.adminActions = {
      total: aiService.analysisStats.adminActions.total + 1,
      lastRunAt: new Date(),
      lastSummary: result.content,
      actionsAnalyzed: recentActions.length
    };
    
    // Log the analysis
    logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} ${fancyColors.GREEN}AI Admin Actions Analysis Complete:${fancyColors.RESET} ${recentActions.length} actions analyzed`, {
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
    const analysisResult = await prisma.ai_admin_action_analyses.create({
      data: {
        summary: result.content,
        analyzed_at: new Date(),
        action_count: recentActions.length,
        time_window_minutes: aiService.config.analysis.adminActions.lookbackMinutes,
        action_distribution: actionDistribution,
        admin_distribution: adminDistribution,
        top_actions: topActions,
        created_by: 'system'
      }
    });
    
    // Broadcast the new analysis to all admin users
    try {
      // Import the broadcaster if available
      const wsBroadcaster = (await import('../../../utils/websocket-suite/ws-broadcaster.js')).default;
      
      // Log WebSocket status before attempting broadcast
      logApi.debug(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} WebSocket status check: ${JSON.stringify({
        hasWebSocketConfig: !!config.websocket,
        hasUnifiedWebSocket: !!config.websocket?.unifiedWebSocket,
        serviceType: 'ai_service',
        operation: 'broadcast_admin_analysis',
        timestamp: new Date().toISOString()
      })}`, { analysisId: analysisResult.id });
      
      // Prepare a notification payload with just the essential information
      const notificationData = {
        id: analysisResult.id,
        summary: result.content.substring(0, 200) + (result.content.length > 200 ? '...' : ''),
        analyzed_at: analysisResult.analyzed_at,
        action_count: recentActions.length,
        top_actions: topActions.slice(0, 3) // Just send top 3 for the notification
      };
      
      // Broadcast to ADMIN and SUPER_ADMIN roles - will throw error if broadcast fails
      const adminCount = await wsBroadcaster.broadcastToRole('ADMIN', 'ai_analysis', 'new_admin_action_analysis', notificationData);
      const superAdminCount = await wsBroadcaster.broadcastToRole('SUPER_ADMIN', 'ai_analysis', 'new_admin_action_analysis', notificationData);
      
      // Only log success if we actually sent messages
      const totalRecipients = adminCount + superAdminCount;
      if (totalRecipients > 0) {
        logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Broadcasted new admin action analysis to ${totalRecipients} admin recipients`);
      } else {
        logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Admin action analysis complete, but no admin clients connected to receive broadcast`);
      }
    } catch (broadcastError) {
      // Don't fail if broadcasting fails
      logApi.warn(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Failed to broadcast admin action analysis: ${broadcastError.message}`);
    }
    
    return {
      summary: result.content,
      actionsAnalyzed: recentActions.length,
      timestamp: new Date()
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} ${fancyColors.RED}Admin actions analysis failed:${fancyColors.RESET}`, error);
    return null;
  }
}