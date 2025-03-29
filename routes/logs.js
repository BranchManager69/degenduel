/**
 * Client Logger Server Routes
 * 
 * This module provides endpoints for receiving logs from client browsers
 * and forwarding them to the server's logging infrastructure.
 */

import express from 'express';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import rateLimit from 'express-rate-limit';

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
      
      // For connectivity errors, use truncated message and minimal metadata
      if (isServerConnectivityError && serverLevel === 'error') {
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
        
        // Only log every 10th connectivity error to reduce noise during restarts
        if (connectivityErrors.count % 10 === 1) {
          // Log with minimal context
          logApi.info(
            `${clientPrefix} ${shortMessage}`, 
            { 
              clientIp: clientContext.clientIp,
              client_connectivity_error: true,
              count_since_last_report: connectivityErrors.count
            }
          );
        }
      } 
      // Send to server logger with enhanced visibility for normal client logs
      else if (logApi[serverLevel]) {
        logApi[serverLevel](
          `${clientPrefix} ${message}`, 
          { 
            ...clientContext,
            ...details,
            client_log_marker: true, // Add a marker for filtering
            is_client_log: true // Redundant marker for clarity
          }
        );
      } else {
        logApi.info(
          `${clientPrefix} ${message}`, 
          { 
            level: serverLevel,
            ...clientContext,
            ...details,
            client_log_marker: true, // Add a marker for filtering
            is_client_log: true // Redundant marker for clarity
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