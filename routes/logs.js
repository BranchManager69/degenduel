/**
 * Client Logger Server Routes
 * 
 * This module provides endpoints for receiving logs from client browsers
 * and forwarding them to the server's logging infrastructure.
 */

import express from 'express';
import { logApi } from '../utils/logger-suite/logger.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

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
      
      // Send to server logger
      if (logApi[serverLevel]) {
        logApi[serverLevel](
          `[Client] ${message}`, 
          { ...clientContext, ...details }
        );
      } else {
        logApi.info(
          `[Client] ${message}`, 
          { level: serverLevel, ...clientContext, ...details }
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