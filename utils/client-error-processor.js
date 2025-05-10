/**
 * Client Error Processor
 * 
 * Processes and stores client-side errors in the database for tracking,
 * analysis, and proactive resolution.
 */

import prisma from '../config/prisma.js';
import crypto from 'crypto';
import { logApi } from './logger-suite/logger.js';

/**
 * Helper function to truncate strings to prevent database column size errors
 * @param {String} str - String to truncate 
 * @param {Number} maxLength - Maximum length
 * @returns {String} - Truncated string
 */
const truncate = (str, maxLength) => {
  if (!str) return str;
  if (typeof str !== 'string') {
    try {
      str = String(str);
    } catch (e) {
      return null;
    }
  }
  return str.length > maxLength ? str.substring(0, maxLength) : str;
};

/**
 * Limit the size of the metadata JSON object
 * @param {Object} metadata - Metadata object to limit
 * @returns {Object} - Size-limited metadata object
 */
function limitMetadataSize(metadata) {
  if (!metadata) return {};
  
  // Make a copy to avoid modifying the original
  const result = { ...metadata };
  
  // Truncate large string fields
  if (result.original_error && typeof result.original_error === 'string') {
    result.original_error = truncate(result.original_error, 5000);
  }
  
  if (result.user_agent && typeof result.user_agent === 'string') {
    result.user_agent = truncate(result.user_agent, 255);
  }
  
  // Limit occurrences array to most recent 10
  if (result.occurrences && Array.isArray(result.occurrences) && result.occurrences.length > 10) {
    result.occurrences = result.occurrences.slice(-10);
  }
  
  // Serialize to check size
  let serialized = JSON.stringify(result);
  
  // If it's still too large, create a minimal version
  if (serialized.length > 8000) {
    const minimal = {
      note: "Metadata was truncated due to size constraints",
      timestamp: new Date().toISOString()
    };
    
    // Keep some key fields if they exist
    if (result.occurrences && Array.isArray(result.occurrences)) {
      minimal.recent_occurrences = result.occurrences.slice(-5);
    }
    
    return minimal;
  }
  
  return result;
}

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

  // Format data for database storage with truncation to prevent column overflow errors
  return {
    error_id: errorId,
    wallet_address: truncate(metadata.walletAddress, 44),
    message: truncate(message || 'Unknown error', 10000),
    level: truncate(logEntry.level || 'error', 20),
    stack_trace: truncate(typeof stack === 'string' ? stack : JSON.stringify(stack), 10000),
    source_url: truncate(source, 1000),
    line_number: lineno || null,
    column_number: colno || null,
    browser: truncate(browser, 100),
    browser_version: truncate(browserVersion, 50),
    os: truncate(os, 50),
    device: truncate(device, 50),
    ip_address: truncate(metadata.clientIp, 45),
    session_id: truncate(metadata.sessionId, 100),
    environment: truncate(metadata.environment || 'production', 20),
    tags: Array.isArray(tags) ? tags.slice(0, 20) : [],
    metadata: limitMetadataSize({
      ...details,
      originalTimestamp: timestamp
    })
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
      // Prepare sanitized data with proper truncation
      const mergedTags = [...new Set([...existingError.tags, ...errorData.tags])].slice(0, 20);
      
      // Prepare metadata with size limits
      const updatedMetadata = limitMetadataSize({
        ...existingError.metadata,
        occurrences: [
          ...(existingError.metadata.occurrences || []),
          {
            timestamp: new Date(),
            ip: truncate(errorData.ip_address, 45),
            sessionId: truncate(errorData.session_id, 100)
          }
        ].slice(-20) // Keep the last 20 occurrences
      });
      
      // Update existing error with new occurrence
      const updatedError = await prisma.client_errors.update({
        where: { id: existingError.id },
        data: {
          occurrences: { increment: 1 },
          last_occurred_at: new Date(),
          // If we have a wallet address and the existing record doesn't, update it (with truncation)
          wallet_address: !existingError.wallet_address && errorData.wallet_address 
            ? truncate(errorData.wallet_address, 44) 
            : undefined,
          // Keep the latest stack trace which might have more details (with truncation)
          stack_trace: truncate(errorData.stack_trace || existingError.stack_trace, 10000),
          // Merge tags without duplicates and limit size
          tags: mergedTags,
          // Add new occurrence to metadata with size limiting
          metadata: updatedMetadata
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
        // Apply string truncation to prevent "column too long" errors
        const sanitizedData = {
          ...errorData,
          user_id: userId,
          message: truncate(errorData.message, 10000),
          level: truncate(errorData.level, 20),
          stack_trace: truncate(errorData.stack_trace, 10000),
          source_url: truncate(errorData.source_url, 1000),
          browser: truncate(errorData.browser, 100),
          browser_version: truncate(errorData.browser_version, 50),
          os: truncate(errorData.os, 50),
          device: truncate(errorData.device, 50),
          ip_address: truncate(errorData.ip_address, 45),
          session_id: truncate(errorData.session_id, 100),
          environment: truncate(errorData.environment, 20),
          wallet_address: truncate(errorData.wallet_address, 44),
          resolution_note: truncate(errorData.resolution_note, 1000),
          tags: Array.isArray(errorData.tags) ? errorData.tags.slice(0, 20) : [],
          metadata: limitMetadataSize({
            ...errorData.metadata,
            occurrences: [{
              timestamp: new Date(),
              ip: errorData.ip_address,
              sessionId: errorData.session_id
            }]
          })
        };
        
        const newError = await prisma.client_errors.create({
          data: sanitizedData
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
            // Prepare sanitized data with proper truncation
            const mergedTags = [...new Set([...existingError.tags, ...errorData.tags])].slice(0, 20);
            
            // Prepare metadata with size limits
            const updatedMetadata = limitMetadataSize({
              ...existingError.metadata,
              occurrences: [
                ...(existingError.metadata.occurrences || []),
                {
                  timestamp: new Date(),
                  ip: truncate(errorData.ip_address, 45),
                  sessionId: truncate(errorData.session_id, 100)
                }
              ].slice(-20) // Keep the last 20 occurrences
            });
            
            // Update existing error with new occurrence
            const updatedError = await prisma.client_errors.update({
              where: { id: existingError.id },
              data: {
                occurrences: { increment: 1 },
                last_occurred_at: new Date(),
                // If we have a wallet address and the existing record doesn't, update it (with truncation)
                wallet_address: !existingError.wallet_address && errorData.wallet_address 
                  ? truncate(errorData.wallet_address, 44) 
                  : undefined,
                // Keep the latest stack trace which might have more details (with truncation)
                stack_trace: truncate(errorData.stack_trace || existingError.stack_trace, 10000),
                // Merge tags without duplicates and limit size
                tags: mergedTags,
                // Add new occurrence to metadata with size limiting
                metadata: updatedMetadata
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