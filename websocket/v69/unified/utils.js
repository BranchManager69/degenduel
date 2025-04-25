// websocket/v69/unified/utils.js

/**
 * Unified WebSocket Utilities
 * 
 * This module provides utility functions for the unified WebSocket system:
 * - Authentication helpers (validateToken, verifySubscriptionPermissions)
 * - Client info parsing (parseClientInfo, getLocationInfo)
 * - Message parsing and formatting
 */

import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import logger from '../../../utils/logger-suite/logger.js';
import { fancyColors, wsColors } from '../../../utils/colors.js';

// Config
import config from '../../../config/config.js';

// Use message types and topics from config
export const MESSAGE_TYPES = config.websocket.messageTypes;
export const TOPICS = config.websocket.topics;

// Create a logger instance for the utilities
const log = logger.forService('WS_UTILS'); // do i export this?

/**
 * Validate JWT token
 * @param {string} token - JWT token to validate
 * @returns {Object|null} Decoded token if valid, null otherwise
 */
export function validateToken(token) {
  if (!token) return null;
  
  try {
    // Verify the token using the JWT secret
    const decoded = jwt.verify(token, config.jwt.secret);
    return decoded;
  } catch (error) {
    log.debug(`Token validation failed: ${error.message}`);
    return null;
  }
}

/**
 * Verify user has permission to subscribe to a topic
 * @param {string} topic - Topic to subscribe to
 * @param {Object} user - User object from decoded JWT
 * @returns {boolean} Whether user has permission
 */
export function verifySubscriptionPermissions(topic, user) {
  // Public topics - anyone can subscribe
  const publicTopics = [
    config.websocket.topics.MARKET_DATA,
    config.websocket.topics.SYSTEM,
    config.websocket.topics.CONTEST,
  ];
  
  if (publicTopics.includes(topic)) {
    return true;
  }
  
  // User topics - require authenticated user
  const userTopics = [
    config.websocket.topics.PORTFOLIO,
    config.websocket.topics.USER,
    config.websocket.topics.WALLET,
    config.websocket.topics.WALLET_BALANCE,
    config.websocket.topics.SKYDUEL,
  ];
  
  if (userTopics.includes(topic) && user) {
    return true;
  }
  
  // Admin topics - require admin role
  const adminTopics = [
    config.websocket.topics.ADMIN,
    config.websocket.topics.TERMINAL,
    config.websocket.topics.LOGS,
  ];
  
  if (adminTopics.includes(topic) && user && user.role && 
      ['ADMIN', 'SUPERADMIN'].includes(user.role)) {
    return true;
  }
  
  return false;
}

/**
 * Get client information from request
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {Object} Client information
 */
export function getClientInfo(req) {
  return {
    ip: req.headers['x-forwarded-for'] || 
        req.socket.remoteAddress || 
        'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
    origin: req.headers.origin || 'unknown',
    referer: req.headers.referer || 'unknown',
  };
}

/**
 * Parse user agent into readable browser/device info
 * @param {string} userAgent - User agent string
 * @returns {string} Readable browser/device info
 */
export function parseClientInfo(userAgent) {
  if (!userAgent) {
    return 'Unknown Client';
  }
  
  try {
    // Check for mobile devices first
    let deviceType = 'Desktop';
    if (userAgent.includes('iPhone') || userAgent.includes('iPad') || userAgent.includes('iPod')) {
      deviceType = 'iOS';
    } else if (userAgent.includes('Android')) {
      deviceType = 'Android';
    }
    
    // Identify browser
    let browser = 'Unknown';
    if (userAgent.includes('Chrome') && !userAgent.includes('Chromium') && !userAgent.includes('Edg')) {
      browser = 'Chrome';
    } else if (userAgent.includes('Firefox') && !userAgent.includes('Seamonkey')) {
      browser = 'Firefox';
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome') && !userAgent.includes('Chromium')) {
      browser = 'Safari';
    } else if (userAgent.includes('Edg') || userAgent.includes('Edge')) {
      browser = 'Edge';
    } else if (userAgent.includes('Opera') || userAgent.includes('OPR')) {
      browser = 'Opera';
    } else if (userAgent.includes('MSIE') || userAgent.includes('Trident/')) {
      browser = 'Internet Explorer';
    }
    
    return `${deviceType} ${browser}`;
  } catch (error) {
    return 'Unknown Client';
  }
}

/**
 * Format authentication flow for visual display in logs
 * @param {Object} authFlowState - Authentication flow state
 * @param {string|null} nickname - User nickname
 * @param {string|null} userId - User ID (wallet address)
 * @param {Object|null} solanaBalance - Solana balance
 * @returns {string} Formatted authentication flow 
 */
export function formatAuthFlowVisual(authFlowState, nickname, userId, solanaBalance) {
  const visualComponents = [];
  
  // Format wallet and nickname
  const walletDisplay = userId ? userId.slice(0, 6) + '...' + userId.slice(-4) : 'None';
  const nicknameDisplay = nickname || 'No Nickname';
  
  // Format balance
  const balanceDisplay = solanaBalance ? `${parseFloat(solanaBalance).toFixed(4)} SOL` : 'Unknown';
  
  // Build visual components based on auth flow state
  if (authFlowState.cookie) {
    visualComponents.push(`${fancyColors.BG_GREEN}${fancyColors.BLACK} COOKIE ${fancyColors.RESET}`);
  } else {
    visualComponents.push(`${fancyColors.BG_RED}${fancyColors.WHITE} NO COOKIE ${fancyColors.RESET}`);
  }
  
  if (authFlowState.token) {
    visualComponents.push(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TOKEN ${fancyColors.RESET}`);
  } else {
    visualComponents.push(`${fancyColors.BG_RED}${fancyColors.WHITE} NO TOKEN ${fancyColors.RESET}`);
  }
  
  if (authFlowState.wallet) {
    visualComponents.push(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WALLET ${fancyColors.RESET} ${walletDisplay}`);
  } else {
    visualComponents.push(`${fancyColors.BG_RED}${fancyColors.WHITE} NO WALLET ${fancyColors.RESET}`);
  }
  
  if (authFlowState.user) {
    visualComponents.push(`${fancyColors.BG_GREEN}${fancyColors.BLACK} USER ${fancyColors.RESET} ${nicknameDisplay}`);
  } else {
    visualComponents.push(`${fancyColors.BG_RED}${fancyColors.WHITE} NO USER ${fancyColors.RESET}`);
  }
  
  if (authFlowState.balance) {
    visualComponents.push(`${fancyColors.BG_GREEN}${fancyColors.BLACK} BALANCE ${fancyColors.RESET} ${balanceDisplay}`);
  } else {
    visualComponents.push(`${fancyColors.BG_RED}${fancyColors.WHITE} NO BALANCE ${fancyColors.RESET}`);
  }
  
  return visualComponents.join(' → ');
}

/**
 * Get location information from IP address
 * @param {string} ip - IP address
 * @returns {Promise<Object|null>} Location information or null if unavailable
 */
export async function getLocationInfo(ip) {
  if (!ip || ip === 'unknown' || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null;
  }
  
  try {
    // Use ipinfo.io API for IP geolocation
    const ipInfoApiKey = config.api_keys.ipinfo;
    if (!ipInfoApiKey) {
      return null;
    }
    
    const ipInfo = await fetch(`https://ipinfo.io/${ip}/json?token=${ipInfoApiKey}`)
      .then(res => res.json());
    
    if (ipInfo && !ipInfo.error) {
      return {
        city: ipInfo.city || null,
        region: ipInfo.region || null,
        regionCode: ipInfo.region_code || null,
        country: ipInfo.country || null,
        countryCode: ipInfo.country_code || null,
        formattedString: ipInfo.city && ipInfo.region && ipInfo.country ? 
          `${ipInfo.city}, ${ipInfo.region}, ${ipInfo.country}` : 
          (ipInfo.city && ipInfo.country ? 
            `${ipInfo.city}, ${ipInfo.country}` : 
            ipInfo.country || '')
      };
    }
    
    return null;
  } catch (error) {
    log.error(`Error getting IP info: ${error.message}`);
    return null;
  }
}

/**
 * Parse WebSocket message
 * @param {string} message - WebSocket message
 * @returns {Object|null} Parsed message or null if invalid
 */
export function parseMessage(message) {
  try {
    const parsedMessage = JSON.parse(message);
    
    // Validate required fields
    if (!parsedMessage.type) {
      return null;
    }
    
    return parsedMessage;
  } catch (error) {
    return null;
  }
}

/**
 * Format message for WebSocket
 * @param {Object} message - Message to format
 * @returns {string} Formatted message
 */
export function formatMessage(message) {
  return JSON.stringify(message);
}

/**
 * Normalize topic names to handle both hyphenated and underscore formats
 * @param {string} topicName - Topic name which may use either format
 * @returns {string} Normalized topic name in the format used by the system
 */
export function normalizeTopic(topicName) {
  if (!topicName) return null;
  
  // Convert to string if it's not already
  const topic = String(topicName);
  
  // Convert hyphens to underscores if present (e.g., 'wallet-balance' to 'wallet_balance')
  const withUnderscores = topic.replace(/-/g, '_');
  
  // Convert underscores to hyphens if present (e.g., 'wallet_balance' to 'wallet-balance')
  const withHyphens = topic.replace(/_/g, '-');
  
  // First check if the hyphenated version matches any of our defined topics
  for (const key in config.websocket.topics) {
    if (config.websocket.topics[key] === withHyphens) {
      return withHyphens; // Return the hyphenated version if it's a match
    }
  }
  
  // If hyphenated version didn't match, check if underscore version matches
  for (const key in config.websocket.topics) {
    if (config.websocket.topics[key] === withUnderscores) {
      return withUnderscores; // Return the underscore version if it's a match
    }
  }
  
  // If neither matched, just return the original topic name
  return topic;
}

/**
 * Handle client error
 * @param {WebSocket} ws - WebSocket client
 * @param {string} clientId - Client ID
 * @param {string} topic - Topic
 * @param {string} error - Error message
 * @param {number} code - Error code
 */
export function handleClientError(ws, clientId, topic, error, code = 400) {
  try {
    ws.send(formatMessage({
      type: config.websocket.messageTypes.ERROR,
      topic,
      error,
      code
    }));
    
    log.debug(`Client ${clientId} error: ${error}`);
  } catch (err) {
    log.error(`Failed to send error to client ${clientId}: ${err.message}`);
  }
}