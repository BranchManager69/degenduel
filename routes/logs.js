/**
 * Client Logger Server Routes
 * 
 * This module provides endpoints for receiving logs from client browsers
 * and forwarding them to the server's logging infrastructure.
 * It also stores error-level logs in the database for analysis and management,
 * with protection against infinite loops and error floods.
 */

import express from 'express';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import rateLimit from 'express-rate-limit';
import { processClientError } from '../utils/client-error-processor.js';

const router = express.Router();

// Counter to throttle connection error logs
const connectivityErrors = {
  count: 0,
  lastReported: Date.now(),
  ips: new Set(),
  reset: function() {
    this.count = 0;
    this.ips = new Set();
    this.lastReported = Date.now();
  }
};

// Cache to detect rapid error duplicates (potential infinite loops)
const errorCache = {
  // Map for tracking recent errors by client
  // Structure: { sessionId_errorHash: { count, firstSeen, lastSeen } }
  recent: new Map(),
  
  // Clean out old entries every 5 minutes
  cleanupInterval: setInterval(() => {
    const now = Date.now();
    const cutoff = now - (5 * 60 * 1000); // 5 minutes ago
    
    // Remove entries older than cutoff
    for (const [key, data] of errorCache.recent.entries()) {
      if (data.lastSeen < cutoff) {
        errorCache.recent.delete(key);
      }
    }
  }, 5 * 60 * 1000),
  
  // Track an error occurrence and check if it's flooding
  track: function(sessionId, errorId, message) {
    const key = `${sessionId || 'anon'}_${errorId}`;
    const now = Date.now();
    
    if (!this.recent.has(key)) {
      // First occurrence
      this.recent.set(key, {
        count: 1,
        firstSeen: now,
        lastSeen: now,
        message: message.substring(0, 100)
      });
      return { isFlood: false, count: 1 };
    }
    
    // Update existing record
    const record = this.recent.get(key);
    record.count += 1;
    record.lastSeen = now;
    
    // Check if this looks like an infinite loop (high frequency of same error)
    // Calculate errors per second
    const timeSpanSeconds = (now - record.firstSeen) / 1000;
    const errorsPerSecond = timeSpanSeconds > 0 ? record.count / timeSpanSeconds : record.count;
    
    // Classify as a flood if:
    // 1. More than 20 errors per second, or
    // 2. More than 30 occurrences in less than 5 seconds
    const isFlood = (errorsPerSecond > 20) || 
                   (record.count > 30 && timeSpanSeconds < 5);
                   
    return { 
      isFlood, 
      count: record.count,
      errorsPerSecond: errorsPerSecond.toFixed(2)
    };
  }
};

// Rate limiting to prevent abuse
const logLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many log requests, please try again later',
    type: 'rate_limit'
  }
});

/**
 * @swagger
 * /api/logs/client:
 *   post:
 *     summary: Receive client-side logs
 *     tags: [Logging]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - logs
 *             properties:
 *               logs:
 *                 type: array
 *                 description: Array of log entries
 *               clientInfo:
 *                 type: object
 *                 description: Information about the client environment
 *               sessionId:
 *                 type: string
 *                 description: Unique session identifier
 *               userId:
 *                 type: string
 *                 description: Optional user identifier
 *     responses:
 *       200:
 *         description: Logs received successfully
 *       400:
 *         description: Invalid request parameters
 *       429:
 *         description: Rate limit exceeded
 */
router.post('/client', logLimiter, (req, res) => {
  try {
    const { logs, clientInfo, sessionId, userId, batchSize } = req.body;
    
    // Validate request
    if (!logs || !Array.isArray(logs)) {
      return res.status(400).json({
        error: 'Invalid request: logs array is required',
        type: 'invalid_request'
      });
    }
    
    // Get client IP
    const clientIp = req.headers['x-forwarded-for'] || 
                    req.headers['x-real-ip'] || 
                    req.socket?.remoteAddress;
    
    // Process each log entry
    logs.forEach(logEntry => {
      // Extract log data
      const { level, message, timestamp, tags, stack, ...details } = logEntry;
      
      // Map client level to server level (fallback to info)
      const serverLevel = ['error', 'warn', 'info', 'http', 'debug'].includes(level) 
        ? level 
        : 'info';
      
      // Format client information
      const clientContext = {
        clientLogger: true,
        clientIp,
        clientInfo,
        sessionId,
        service: 'CLIENT',
        userId: userId || req.user?.id,
        walletAddress: req.user?.wallet_address,
        tags,
        stack,
        batchId: batchSize ? `batch-${sessionId}-${timestamp}` : undefined,
        frontend: true,
        transport: 'rest'
      };
      
      // Check for common connection errors that happen during server restarts
      const isServerConnectivityError = (
        message.includes("Server is currently unavailable") ||
        message.includes("Failed to fetch") ||
        message.includes("Network Error") ||
        message.includes("Connection refused") ||
        message.includes("Cannot connect") ||
        message.includes("ERR_CONNECTION_REFUSED") ||
        message.includes("Unable to connect")
      );
      
      // Check for common WebSocket initialization errors that can be downgraded
      const isWebSocketInitError = (
        message.includes("WebSocketManager: Cannot register listener - WebSocketManager not initialized") ||
        message.includes("WebSocket connection not established") ||
        message.includes("WebSocket connection failed")
      );
      
      // Check for common wallet-related errors that are expected in certain flows
      const isWalletContextError = (
        message.includes("WalletContext without providing one") ||
        message.includes("You have tried to read \"wallets\" on a WalletContext") ||
        message.includes("No wallet found") ||
        message.includes("wallet adapter not found") ||
        message.includes("No wallet adapters found")
      );
      
      // Dramatically enhance client log visibility based on level
      let clientPrefix;
      
      // Use special compact format for server connectivity errors
      if (isServerConnectivityError && serverLevel === 'error') {
        clientPrefix = `${fancyColors.DARK_GRAY}[ClientConnErr]${fancyColors.RESET}`;
      }
      // Format based on log level - use very distinct styling for other client logs
      else if (serverLevel === 'error') {
        clientPrefix = `🔴 ${fancyColors.BG_DARK_RED}${fancyColors.WHITE} CLIENT ERROR ${fancyColors.RESET} 🔴`;
      } else if (serverLevel === 'warn') {
        clientPrefix = `⚠️ ${fancyColors.BG_DARK_YELLOW}${fancyColors.BLACK} CLIENT WARNING ${fancyColors.RESET} ⚠️`;
      } else {
        clientPrefix = `${fancyColors.BG_DARK_BLUE}${fancyColors.WHITE} CLIENT LOG ${fancyColors.RESET}`;
      }
      
      // For connectivity errors, WebSocket init errors, or wallet context errors, use truncated message and minimal metadata
      if ((isServerConnectivityError || isWebSocketInitError || isWalletContextError) && serverLevel === 'error') {
        // Extract just the essential error message
        const shortMessage = message.split(":")[0] || message;
        
        // Track unique IPs with connection errors
        connectivityErrors.ips.add(clientContext.clientIp);
        connectivityErrors.count++;
        
        // Reset counters after 1 minute
        const now = Date.now();
        if (now - connectivityErrors.lastReported > 60000) {
          logApi.info(`${fancyColors.DARK_GRAY}[ClientConnSummary] ${connectivityErrors.count} connection errors from ${connectivityErrors.ips.size} IPs in the last minute${fancyColors.RESET}`);
          connectivityErrors.reset();
        }
        
        // Only log every 20th connectivity error to console to reduce noise during restarts
        // For WebSocket init errors and wallet context errors, be even more aggressive in filtering
        if ((isWebSocketInitError && connectivityErrors.count % 50 === 1) || 
            (isWalletContextError && connectivityErrors.count % 100 === 1) ||  
            (isServerConnectivityError && connectivityErrors.count % 20 === 1)) {
          // Log with minimal context to console
          logApi.info(
            `${clientPrefix} ${shortMessage}`, 
            { 
              clientIp: clientContext.clientIp,
              client_connectivity_error: true,
              count_since_last_report: connectivityErrors.count
            }
          );
        }
        
        // Store connectivity errors, but with flood protection
        // Generate a simple error ID for connectivity errors (since they're similar)
        const connErrorId = isWebSocketInitError 
          ? `websocket_init_${shortMessage.replace(/\s+/g, '_').substring(0, 20)}`
          : isWalletContextError
            ? `wallet_context_${shortMessage.replace(/\s+/g, '_').substring(0, 20)}`
            : `connectivity_${shortMessage.replace(/\s+/g, '_').substring(0, 20)}`;
        
        // Check if this client is flooding with connectivity errors
        const floodCheck = errorCache.track(sessionId, connErrorId, shortMessage);
        
        // For connectivity errors, allow very basic throttling to prevent database floods
        // Store first 10 errors in any case, but then only store periodic samples if flooding
        // For WebSocket init errors, be even more restrictive - only store first 2 errors, then very sparse samples
        // For WalletContext errors, be extremely restrictive - only store first error, then extremely sparse samples
        if ((isWalletContextError && (floodCheck.count <= 1 || floodCheck.count % 500 === 0)) ||
            (isWebSocketInitError && (floodCheck.count <= 2 || floodCheck.count % 100 === 0)) ||
            (isServerConnectivityError && (floodCheck.count <= 10 || floodCheck.count % 20 === 0))) {
          processClientError(
            {...logEntry, message: shortMessage},
            {
              clientIp,
              walletAddress: req.user?.wallet_address,
              userAgent: req.headers['user-agent'],
              sessionId,
              environment: req.headers.origin ? (req.headers.origin.includes('dev.') ? 'development' : 'production') : undefined,
              // Add flood information if detected
              ...(floodCheck.isFlood ? {
                metadata: {
                  isFloodDetected: true,
                  errorsPerSecond: floodCheck.errorsPerSecond, 
                  totalErrorsSeen: floodCheck.count
                }
              } : {})
            }
          ).catch(dbError => {
            logApi.error('Failed to store connectivity error in database', {
              error: dbError.message,
              client_error_store_failed: true
            });
          });
        }
      } 
      // Process regular errors (store all non-connectivity errors)
      else if (serverLevel === 'error') {
        // Generate an error ID for tracking (we'll use the formatErrorData function from client-error-processor.js in the future)
        // For now, create a simple hash based on the error message and stack trace
        let errorIdentifier = '';
        try {
          // Create a simple hash from error properties
          const errorText = `${message}${stack ? stack.toString().substring(0, 200) : ''}${details.name || ''}`;
          errorIdentifier = Buffer.from(errorText).toString('base64').substring(0, 20);
        } catch (e) {
          errorIdentifier = `error_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        }
        
        // Check if this might be an infinite loop or flood of errors
        const floodCheck = errorCache.track(sessionId, errorIdentifier, message);
        
        // Always log to console with flood information if detected
        logApi.error(
          `${clientPrefix} ${message}${floodCheck.isFlood ? ` [FLOOD: ${floodCheck.count} errors at ${floodCheck.errorsPerSecond}/sec]` : ''}`, 
          { 
            ...clientContext,
            ...details,
            client_log_marker: true,
            is_client_log: true,
            ...(floodCheck.isFlood ? { 
              error_flood: true,
              flood_count: floodCheck.count,
              errors_per_second: floodCheck.errorsPerSecond 
            } : {})
          }
        );
        
        // For regular errors, implement smarter flood protection:
        // 1. Always store first 20 occurrences of any error
        // 2. For rapid floods, store samples (every 50th occurrence)
        // 3. For slower repeats, store more frequently (every 10th occurrence)
        const shouldStore = 
          floodCheck.count <= 20 || // Always store first 20 occurrences
          (floodCheck.isFlood && floodCheck.count % 50 === 0) || // Store samples during floods
          (!floodCheck.isFlood && floodCheck.count % 10 === 0); // Store more frequently for slower repeats
        
        if (shouldStore) {
          // Store in database with flood metadata
          processClientError(logEntry, {
            clientIp,
            walletAddress: req.user?.wallet_address,
            userAgent: req.headers['user-agent'],
            sessionId,
            environment: req.headers.origin ? (req.headers.origin.includes('dev.') ? 'development' : 'production') : undefined,
            // Add flood information if detected
            ...(floodCheck.isFlood || floodCheck.count > 1 ? {
              metadata: {
                isFloodDetected: floodCheck.isFlood,
                errorsPerSecond: floodCheck.errorsPerSecond,
                totalErrorsSeen: floodCheck.count,
                actualOccurrences: floodCheck.count,
                samplingRate: floodCheck.isFlood ? '1:50' : (floodCheck.count > 20 ? '1:10' : '1:1')
              }
            } : {})
          }).catch(dbError => {
            logApi.error('Failed to store client error in database', {
              error: dbError.message,
              client_error_processing_failed: true
            });
          });
        }
      }
      // Send warnings and other logs to server logger without database storage
      else if (logApi[serverLevel]) {
        logApi[serverLevel](
          `${clientPrefix} ${message}`, 
          { 
            ...clientContext,
            ...details,
            client_log_marker: true,
            is_client_log: true
          }
        );
      } else {
        logApi.info(
          `${clientPrefix} ${message}`, 
          { 
            level: serverLevel,
            ...clientContext,
            ...details,
            client_log_marker: true,
            is_client_log: true
          }
        );
      }
    });
    
    // Send success response
    return res.status(200).json({
      success: true,
      processed: logs.length
    });
  } catch (error) {
    // Log error and return error response
    logApi.error('Error processing client logs', {
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      error: 'Failed to process logs',
      type: 'server_error'
    });
  }
});

export default router;