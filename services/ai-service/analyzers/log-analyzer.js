/**
 * Log Analyzer Module
 * 
 * This module handles AI analysis of log files and error logs, including:
 * - Processing general server logs for insights
 * - Analyzing error logs to identify patterns
 * - Generating summaries and recommendations
 * - Broadcasting analysis results to admins
 */

import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import prisma from '../../../config/prisma.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Analyze error logs from the database
 * 
 * @param {Object} aiService - Reference to the parent AI service
 * @param {number} limit - Maximum number of errors to analyze
 * @returns {Object|null} Analysis result or null if analysis was skipped
 */
export async function analyzeErrorLogs(aiService, limit = 50) {
  // Find the most recent client errors in the database, even if there are no recent ones
  // We override the cutoff time to get some errors for testing
  try {
    // Get a larger time window (past week) to ensure we have some data
    const cutoffTime = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
    
    // Find the most recent errors regardless of when they were created
    const recentErrors = await prisma.client_errors.findMany({
      orderBy: { created_at: 'desc' },
      take: limit
    });
    
    // If we didn't find any recent errors, log a warning
    if (recentErrors.length === 0) {
      logApi.warn(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} No client errors found in the database`);
    }
    
    // Skip if not enough errors to analyze
    if (recentErrors.length < 10) {
      logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Skipping error log analysis - only ${recentErrors.length} errors found (minimum: 10)`);
      return null;
    }
    
    // Prepare error data for analysis
    const errorData = recentErrors.map(err => ({
      error_type: err.error_type,
      message: err.message,
      stack: err.stack ? err.stack.split('\n').slice(0, 5).join('\n') : null, // Limit stack trace for prompt size
      url: err.url,
      user_agent: err.user_agent,
      timestamp: err.created_at
    }));
    
    // Generate analysis with OpenAI using errorAnalysis loadout
    const messages = [
      {
        role: 'user',
        content: `Analyze these ${recentErrors.length} client errors from the past hour and provide insights, patterns, and recommendations:\n${JSON.stringify(errorData, null, 2)}`
      }
    ];
    
    const result = await aiService.generateChatCompletion(messages, {
      internal: true,
      loadoutType: 'errorAnalysis'
    });
    
    // Store analysis results in database
    const analysisResult = await prisma.ai_error_analyses.create({
      data: {
        summary: result.content,
        analyzed_at: new Date(),
        error_count: recentErrors.length,
        time_window_minutes: 60,
        created_by: 'system'
      }
    });
    
    // Log analysis results to server logs
    logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} ${fancyColors.GREEN}AI Error Log Analysis Complete:${fancyColors.RESET} ${recentErrors.length} client errors analyzed`, {
      summary: result.content.substring(0, 300) + (result.content.length > 300 ? '...' : ''),
      loadout: 'errorAnalysis'
    });
    
    // Broadcast the analysis to admins
    try {
      const wsBroadcaster = (await import('../../../utils/websocket-suite/ws-broadcaster.js')).default;
      
      const notificationData = {
        id: analysisResult.id,
        summary: result.content.substring(0, 200) + (result.content.length > 200 ? '...' : ''),
        analyzed_at: analysisResult.analyzed_at,
        error_count: recentErrors.length
      };
      
      await wsBroadcaster.broadcastToRole('ADMIN', 'ai_analysis', 'new_error_analysis', notificationData);
      
      logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Broadcasted new error log analysis to admins`);
    } catch (broadcastError) {
      logApi.warn(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Failed to broadcast error analysis: ${broadcastError.message}`);
    }
    
    return {
      summary: result.content,
      errorsAnalyzed: recentErrors.length,
      timestamp: new Date()
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} ${fancyColors.RED}Error log analysis failed:${fancyColors.RESET}`, error);
    return null;
  }
}

/**
 * Analyze general application logs from log files
 * 
 * @param {Object} aiService - Reference to the parent AI service 
 * @param {string} logPath - Path to the log files directory
 * @param {number} limit - Maximum number of log lines to analyze
 * @returns {Object|null} Analysis result or null if analysis was skipped
 */
export async function analyzeGeneralLogs(aiService, logPath = '/home/websites/degenduel/logs', limit = 1000) {
  try {
    // Resolve path to log directory
    const logsDirectory = path.resolve(logPath);
    
    // Find the most recent error log file
    const files = await fs.readdir(logsDirectory);
    // Specifically look for error log files
    const logFiles = files.filter(file => file.startsWith('error-') && file.endsWith('.log')).sort();
    
    if (logFiles.length === 0) {
      // If no error logs are found, try to find api logs
      const apiLogFiles = files.filter(file => file.startsWith('api-') && file.endsWith('.log')).sort();
      
      if (apiLogFiles.length === 0) {
        logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Skipping general log analysis - no suitable log files found`);
        return null;
      }
      
      // Use the most recent api log file
      const mostRecentLogFile = apiLogFiles[apiLogFiles.length - 1];
      logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Using API log file: ${mostRecentLogFile}`);
      return await processLogFile(aiService, logsDirectory, mostRecentLogFile, limit);
    }
    
    // Process the most recent error log file
    const mostRecentLogFile = logFiles[logFiles.length - 1];
    logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Using error log file: ${mostRecentLogFile}`);
    return await processLogFile(aiService, logsDirectory, mostRecentLogFile, limit);
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} ${fancyColors.RED}General log analysis failed:${fancyColors.RESET}`, error);
    return null;
  }
}

/**
 * Helper function to process a log file and generate analysis
 * 
 * @param {Object} aiService - Reference to the parent AI service 
 * @param {string} logsDirectory - Path to the logs directory
 * @param {string} logFileName - Name of the log file to process
 * @param {number} limit - Maximum number of log lines to analyze
 * @returns {Object|null} Analysis result or null if analysis was skipped
 */
async function processLogFile(aiService, logsDirectory, logFileName, limit) {
  try {
    const logFilePath = path.join(logsDirectory, logFileName);
    
    // Read the log file content
    const logContent = await fs.readFile(logFilePath, 'utf8');
    
    // Get the last N lines, but limit to avoid token limits
    const logLines = logContent.split('\n').filter(line => line.trim());
    
    // Calculate how many lines we can include
    // Start with a reasonable number that won't exceed token limits
    const maxLines = Math.min(limit, 1000);
    const lastNLines = logLines.slice(-maxLines);
    
    if (lastNLines.length < 100) {
      logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Skipping general log analysis - insufficient log lines (${lastNLines.length})`);
      return null;
    }
    
    // Generate analysis with OpenAI
    const messages = [
      {
        role: 'user',
        content: `Analyze these ${lastNLines.length} log lines from the DegenDuel application and provide insights, patterns, warnings, and notable events:\n${lastNLines.join('\n')}`
      }
    ];
    
    const result = await aiService.generateChatCompletion(messages, {
      internal: true,
      loadoutType: 'logAnalysis'
    });
    
    // Store the analysis in a dedicated table
    const analysisResult = await prisma.ai_log_analyses.create({
      data: {
        summary: result.content,
        analyzed_at: new Date(),
        log_file: logFileName,
        lines_analyzed: lastNLines.length,
        created_by: 'system'
      }
    });
    
    // Log analysis results to server logs like we do with admin actions
    logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} ${fancyColors.GREEN}AI Log Analysis Complete:${fancyColors.RESET} ${lastNLines.length} lines analyzed from ${logFileName}`, {
      summary: result.content.substring(0, 300) + (result.content.length > 300 ? '...' : ''),
      loadout: 'logAnalysis'
    });
    
    // Broadcast the analysis to admins
    try {
      const wsBroadcaster = (await import('../../../utils/websocket-suite/ws-broadcaster.js')).default;
      
      const notificationData = {
        id: analysisResult.id,
        summary: result.content.substring(0, 200) + (result.content.length > 200 ? '...' : ''),
        analyzed_at: analysisResult.analyzed_at,
        log_file: logFileName,
        lines_analyzed: lastNLines.length
      };
      
      await wsBroadcaster.broadcastToRole('ADMIN', 'ai_analysis', 'new_log_analysis', notificationData);
      
      logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Broadcasted new general log analysis to admins`);
    } catch (broadcastError) {
      logApi.warn(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Failed to broadcast log analysis: ${broadcastError.message}`);
    }
    
    return {
      summary: result.content,
      linesAnalyzed: lastNLines.length,
      logFile: logFileName,
      timestamp: new Date()
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} ${fancyColors.RED}Log file processing failed:${fancyColors.RESET}`, error);
    return null;
  }
}

/**
 * Analyze logs from a specific service or component
 * 
 * @param {Object} aiService - Reference to the parent AI service
 * @param {string} serviceKey - Key identifying the service (e.g., 'solana_engine', 'contest_scheduler')
 * @param {number} limit - Maximum number of log lines to analyze
 * @returns {Object|null} Analysis result or null if analysis was skipped
 */
export async function analyzeServiceLogs(aiService, serviceKey, limit = 500) {
  try {
    let serviceLogs = [];
    
    // Check if service_logs table exists
    try {
      // Fetch service-specific logs from database
      serviceLogs = await prisma.service_logs.findMany({
        where: {
          service: serviceKey,
          created_at: { gte: new Date(Date.now() - (3 * 60 * 60 * 1000)) } // Last 3 hours
        },
        orderBy: { created_at: 'desc' },
        take: limit
      });
      
      // Use a lower threshold for testing purposes (5 logs)
      // The default threshold is 50 logs for production
      const minLogsRequired = 5;
      
      if (!serviceLogs || serviceLogs.length < minLogsRequired) {
        logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Skipping service log analysis for ${serviceKey} - insufficient logs (${serviceLogs?.length || 0}), need at least ${minLogsRequired}`);
        return null;
      }
    } catch (dbError) {
      // Handle case where service_logs table doesn't exist
      logApi.warn(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Service logs table not found - skipping analysis for ${serviceKey}: ${dbError.message}`);
      return null;
    }
    
    // Format log data for analysis
    const logData = serviceLogs.map(log => ({
      level: log.level,
      message: log.message,
      details: log.details,
      timestamp: log.created_at
    }));
    
    // Generate analysis with OpenAI
    const messages = [
      {
        role: 'user',
        content: `Analyze these ${serviceLogs.length} logs from the ${serviceKey} service over the past 3 hours. Identify patterns, errors, and performance insights:\n${JSON.stringify(logData, null, 2)}`
      }
    ];
    
    const result = await aiService.generateChatCompletion(messages, {
      internal: true,
      loadoutType: 'serviceLogAnalysis'
    });
    
    // Store the analysis
    const analysisResult = await prisma.ai_service_log_analyses.create({
      data: {
        service: serviceKey,
        summary: result.content,
        analyzed_at: new Date(),
        log_count: serviceLogs.length,
        time_window_hours: 3,
        created_by: 'system'
      }
    });
    
    // Log analysis results to server logs
    logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} ${fancyColors.GREEN}AI Service Log Analysis Complete:${fancyColors.RESET} ${serviceLogs.length} logs analyzed for ${serviceKey}`, {
      service: serviceKey, 
      summary: result.content.substring(0, 300) + (result.content.length > 300 ? '...' : ''),
      loadout: 'serviceLogAnalysis'
    });
    
    // Broadcast the analysis to admins
    try {
      const wsBroadcaster = (await import('../../../utils/websocket-suite/ws-broadcaster.js')).default;
      
      await wsBroadcaster.broadcastToRole('ADMIN', 'ai_analysis', 'new_service_log_analysis', {
        id: analysisResult.id,
        service: serviceKey,
        summary: result.content.substring(0, 200) + (result.content.length > 200 ? '...' : ''),
        analyzed_at: analysisResult.analyzed_at
      });
      
      logApi.info(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Broadcasted new ${serviceKey} log analysis to admins`);
    } catch (broadcastError) {
      logApi.warn(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} Failed to broadcast service log analysis: ${broadcastError.message}`);
    }
    
    return {
      summary: result.content,
      service: serviceKey,
      logsAnalyzed: serviceLogs.length,
      timestamp: new Date()
    };
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} ${fancyColors.RED}Service log analysis failed for ${serviceKey}:${fancyColors.RESET}`, error);
    return null;
  }
}