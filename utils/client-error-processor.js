/**
 * Client Error Processor
 * 
 * Processes and stores client-side errors in the database for tracking,
 * analysis, and proactive resolution.
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { logApi } from './logger-suite/logger.js';

const prisma = new PrismaClient();

/**
 * Generates a deterministic error ID based on error characteristics
 * to group similar errors together
 * 
 * @param {Object} errorData - Error data to process
 * @returns {String} - Unique error identifier hash
 */
const generateErrorId = (errorData) => {
  // Create a normalized error signature for grouping similar errors
  const errorSignature = [
    // If there's a clear error name, use it
    errorData.name,
    // Strip line numbers and variable data from message
    errorData.message && errorData.message.replace(/\d+/g, 'X'),
    // Include file name without full path and line numbers
    errorData.source && errorData.source.replace(/.*\/([^/]+):\d+:\d+$/, '$1'),
    // Stack frames with function names but not line numbers
    errorData.stack && Array.isArray(errorData.stack) 
      ? errorData.stack.slice(0, 2).map(frame => frame.function).join(':')
      : typeof errorData.stack === 'string'
        ? errorData.stack.split('\n').slice(0, 2).join(':').replace(/:\d+:\d+/g, '')
        : ''
  ].filter(Boolean).join('|');

  // Create a hash of the signature
  return crypto.createHash('md5').update(errorSignature).digest('hex');
};

/**
 * Parses browser and OS information from user agent
 * 
 * @param {String} userAgent - User agent string
 * @returns {Object} Browser and OS information
 */
const parseUserAgent = (userAgent) => {
  if (!userAgent) return {};

  const result = {
    browser: null,
    browserVersion: null,
    os: null,
    device: 'desktop'
  };

  // Extract browser and version
  if (userAgent.includes('Chrome/')) {
    result.browser = 'Chrome';
    const match = userAgent.match(/Chrome\/(\d+\.\d+)/);
    if (match) result.browserVersion = match[1];
  } else if (userAgent.includes('Firefox/')) {
    result.browser = 'Firefox';
    const match = userAgent.match(/Firefox\/(\d+\.\d+)/);
    if (match) result.browserVersion = match[1];
  } else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) {
    result.browser = 'Safari';
    const match = userAgent.match(/Version\/(\d+\.\d+)/);
    if (match) result.browserVersion = match[1];
  } else if (userAgent.includes('Edge/') || userAgent.includes('Edg/')) {
    result.browser = 'Edge';
    const match = userAgent.match(/Edg(?:e)?\/(\d+\.\d+)/);
    if (match) result.browserVersion = match[1];
  }

  // Extract OS
  if (userAgent.includes('Windows')) {
    result.os = 'Windows';
  } else if (userAgent.includes('Mac OS X')) {
    result.os = 'macOS';
  } else if (userAgent.includes('Linux')) {
    result.os = 'Linux';
  } else if (userAgent.includes('Android')) {
    result.os = 'Android';
    result.device = 'mobile';
  } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    result.os = 'iOS';
    result.device = userAgent.includes('iPad') ? 'tablet' : 'mobile';
  }

  return result;
};

/**
 * Format error data from client logs for database storage
 * 
 * @param {Object} logEntry - The client log entry
 * @param {Object} metadata - Additional metadata (client IP, etc)
 * @returns {Object} Formatted error data for database
 */
const formatErrorData = (logEntry, metadata) => {
  // Extract and parse details
  const { message, stack, timestamp, tags, ...details } = logEntry;
  const { source, lineno, colno } = details;
  
  // Parse the user agent
  const { browser, browserVersion, os, device } = parseUserAgent(metadata.userAgent);

  // Generate a unique ID for this type of error for grouping
  const errorData = {
    name: details.name || 'UnknownError',
    message,
    source,
    stack
  };
  
  const errorId = generateErrorId(errorData);

  // Format data for database storage
  return {
    error_id: errorId,
    wallet_address: metadata.walletAddress,
    message: message || 'Unknown error',
    level: logEntry.level || 'error',
    stack_trace: typeof stack === 'string' ? stack : JSON.stringify(stack),
    source_url: source,
    line_number: lineno || null,
    column_number: colno || null,
    browser,
    browser_version: browserVersion,
    os,
    device,
    ip_address: metadata.clientIp,
    session_id: metadata.sessionId,
    environment: metadata.environment || 'production',
    tags: Array.isArray(tags) ? tags : [],
    metadata: {
      ...details,
      originalTimestamp: timestamp
    }
  };
};

/**
 * Process client error and store in database
 * 
 * @param {Object} logEntry - Client log entry containing error details
 * @param {Object} metadata - Additional metadata about the client
 * @returns {Promise<Object>} The saved error record
 */
export const processClientError = async (logEntry, metadata) => {
  try {
    // Only process error-level logs
    if (logEntry.level !== 'error') {
      return null;
    }

    // Format the error data for storage
    const errorData = formatErrorData(logEntry, metadata);
    
    // Check if this error already exists
    const existingError = await prisma.client_errors.findUnique({
      where: { error_id: errorData.error_id }
    });

    if (existingError) {
      // Update existing error with new occurrence
      const updatedError = await prisma.client_errors.update({
        where: { id: existingError.id },
        data: {
          occurrences: { increment: 1 },
          last_occurred_at: new Date(),
          // If we have a wallet address and the existing record doesn't, update it
          wallet_address: !existingError.wallet_address && errorData.wallet_address 
            ? errorData.wallet_address 
            : undefined,
          // Keep the latest stack trace which might have more details
          stack_trace: errorData.stack_trace || existingError.stack_trace,
          // Merge tags without duplicates
          tags: [...new Set([...existingError.tags, ...errorData.tags])],
          // Add new occurrence to metadata
          metadata: {
            ...existingError.metadata,
            occurrences: [
              ...(existingError.metadata.occurrences || []),
              {
                timestamp: new Date(),
                ip: errorData.ip_address,
                sessionId: errorData.session_id
              }
            ].slice(-20) // Keep the last 20 occurrences
          }
        }
      });
      
      logApi.debug(`Updated existing client error record (ID: ${updatedError.id}, occurrences: ${updatedError.occurrences})`, {
        error_id: errorData.error_id,
        client_error_saved: true
      });
      
      return updatedError;
    } else {
      // Create new error record
      // If we have a wallet address, try to find the user ID
      let userId = null;
      if (errorData.wallet_address) {
        const user = await prisma.users.findUnique({
          where: { wallet_address: errorData.wallet_address },
          select: { id: true }
        });
        if (user) {
          userId = user.id;
        }
      }

      try {
        const newError = await prisma.client_errors.create({
          data: {
            ...errorData,
            user_id: userId,
            metadata: {
              ...errorData.metadata,
              occurrences: [{
                timestamp: new Date(),
                ip: errorData.ip_address,
                sessionId: errorData.session_id
              }]
            }
          }
        });
        
        logApi.info(`Created new client error record (ID: ${newError.id})`, {
          error_id: errorData.error_id,
          client_error_saved: true,
          message: newError.message
        });
        
        return newError;
      } catch (createError) {
        // Handle unique constraint error by falling back to update
        if (createError.message.includes('Unique constraint failed')) {
          // Try to get the existing record and update it
          const existingError = await prisma.client_errors.findUnique({
            where: { error_id: errorData.error_id }
          });
          
          if (existingError) {
            // Update using the earlier logic
            const updatedError = await prisma.client_errors.update({
              where: { id: existingError.id },
              data: {
                occurrences: { increment: 1 },
                last_occurred_at: new Date(),
                // If we have a wallet address and the existing record doesn't, update it
                wallet_address: !existingError.wallet_address && errorData.wallet_address 
                  ? errorData.wallet_address 
                  : undefined,
                // Keep the latest stack trace which might have more details
                stack_trace: errorData.stack_trace || existingError.stack_trace,
                // Merge tags without duplicates
                tags: [...new Set([...existingError.tags, ...errorData.tags])],
                // Add new occurrence to metadata
                metadata: {
                  ...existingError.metadata,
                  occurrences: [
                    ...(existingError.metadata.occurrences || []),
                    {
                      timestamp: new Date(),
                      ip: errorData.ip_address,
                      sessionId: errorData.session_id
                    }
                  ].slice(-20) // Keep the last 20 occurrences
                }
              }
            });
            
            logApi.debug(`Race condition handled: Updated existing client error record (ID: ${updatedError.id}, occurrences: ${updatedError.occurrences})`, {
              error_id: errorData.error_id,
              client_error_saved: true,
              race_condition_handled: true
            });
            
            return updatedError;
          }
        }
        
        // If we reach here, it's some other error or we couldn't find the record to update
        throw createError;
      }
    }
  } catch (err) {
    logApi.error('Failed to process client error', {
      error: err.message,
      stack: err.stack,
      client_error_processing_failed: true
    });
    return null;
  }
};

/**
 * Get a summary of recent errors
 * 
 * @param {Object} options Query options
 * @returns {Promise<Array>} Summary of recent errors
 */
export const getRecentErrors = async (options = {}) => {
  const { 
    limit = 50,
    status = 'open',
    onlyCritical = false,
    orderBy = 'last_occurred_at',
    orderDirection = 'desc'
  } = options;
  
  try {
    const where = {};
    
    if (status) {
      where.status = status;
    }
    
    if (onlyCritical) {
      where.is_critical = true;
    }
    
    const errors = await prisma.client_errors.findMany({
      where,
      orderBy: {
        [orderBy]: orderDirection
      },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            nickname: true,
            wallet_address: true
          }
        }
      }
    });
    
    return errors;
  } catch (err) {
    logApi.error('Failed to get recent client errors', {
      error: err.message,
      stack: err.stack
    });
    return [];
  }
};

/**
 * Mark an error as resolved
 * 
 * @param {Number} errorId Error ID
 * @param {String} resolvedBy User who resolved the error
 * @param {String} note Resolution note
 * @returns {Promise<Object>} Updated error record
 */
export const resolveError = async (errorId, resolvedBy, note = '') => {
  try {
    const updatedError = await prisma.client_errors.update({
      where: { id: errorId },
      data: {
        status: 'resolved',
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        resolution_note: note
      }
    });
    
    logApi.info(`Client error #${errorId} marked as resolved by ${resolvedBy}`, {
      error_id: updatedError.error_id,
      client_error_resolved: true
    });
    
    return updatedError;
  } catch (err) {
    logApi.error(`Failed to resolve client error #${errorId}`, {
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
};

/**
 * Mark an error as critical
 * 
 * @param {Number} errorId Error ID
 * @param {Boolean} isCritical Whether the error is critical
 * @returns {Promise<Object>} Updated error record
 */
export const markErrorCritical = async (errorId, isCritical = true) => {
  try {
    const updatedError = await prisma.client_errors.update({
      where: { id: errorId },
      data: {
        is_critical: isCritical
      }
    });
    
    logApi.info(`Client error #${errorId} marked as ${isCritical ? 'critical' : 'non-critical'}`, {
      error_id: updatedError.error_id,
      client_error_updated: true
    });
    
    return updatedError;
  } catch (err) {
    logApi.error(`Failed to update critical status for client error #${errorId}`, {
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
};

export default {
  processClientError,
  getRecentErrors,
  resolveError,
  markErrorCritical
};