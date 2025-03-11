// middleware/ipBanMiddleware.js

import prisma from "../config/prisma.js";
import { logApi } from "../utils/logger-suite/logger.js";
import AdminLogger from "../utils/admin-logger.js";
import { fancyColors } from "../utils/colors.js";

/**
 * IP Ban Middleware Configuration
 * Controls various aspects of the IP banning system
 */
const IP_BAN_CONFIG = {
  // Whether to enable the trolling features
  enableTrolling: true,
  
  // How many ms to artificially delay responses to banned IPs (base value)
  baseResponseDelay: 500,
  
  // Maximum artificial delay (ms) at the highest troll level
  maxResponseDelay: 10000,
  
  // Whether to log detailed ban information in debug mode
  debugLogging: false,
  
  // List of paths that bypass IP ban checks (emergency access routes)
  bypassPaths: [
    "/api/health", 
    "/api/banned-ip/check"
  ],
  
  // List of IPs that are always allowed (admin IPs)
  whitelist: [
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1"
  ],
  
  // String to include in the trolling page to identify banned users
  // (this makes it easier to track them in analytics)
  trollingTag: "banned-user-troll-tag-6969420",
};

/**
 * Returns a list of trolling responses based on troll level
 * @param {number} level - Troll level (1-5)
 * @returns {Array} Array of possible troll responses
 */
function getTrollingResponses(level = 1) {
  // Base trolling responses for level 1
  const responses = [
    { code: 418, message: "I'm a teapot. You've been temporarily banned from viewing this content." },
    { code: 503, message: "Service is taking a break from you specifically." },
    { code: 429, message: "Too many requests from your computer. Try again... never?" },
  ];
  
  // Add more trolling responses for higher levels
  if (level >= 2) {
    responses.push(
      { code: 402, message: "Payment Required. Please send 1,000 SOL to continue." },
      { code: 409, message: "Conflict between your behavior and our tolerance for it." }
    );
  }
  
  if (level >= 3) {
    responses.push(
      { code: 451, message: "Unavailable For Legal Reasons - your IP has been reported to authorities." },
      { code: 507, message: "Insufficient Storage - your requests are too heavy for our poor servers." }
    );
  }
  
  if (level >= 4) {
    responses.push(
      { code: 511, message: "Network Authentication Required - please validate your identity with a retina scan." },
      { code: 599, message: "Connection Timed Out - but only for you." }
    );
  }
  
  if (level >= 5) {
    responses.push(
      { code: 520, message: "Unknown Error - we're as confused as you are about why you're banned." },
      { code: 530, message: "Site frozen - please wait 4-6 business years for access." }
    );
  }
  
  return responses;
}

/**
 * Randomly selects a trolling response based on troll level
 * @param {number} level - Troll level (1-5)
 * @returns {Object} A selected troll response object
 */
function getRandomTrollingResponse(level = 1) {
  const responses = getTrollingResponses(level);
  const index = Math.floor(Math.random() * responses.length);
  return responses[index];
}

/**
 * Calculates response delay based on troll level and config
 * @param {number} level - Troll level (1-5)
 * @returns {number} Delay in milliseconds
 */
function calculateResponseDelay(level = 1) {
  // Calculate delay based on level (exponential growth)
  return Math.min(
    IP_BAN_CONFIG.baseResponseDelay * Math.pow(2, level - 1),
    IP_BAN_CONFIG.maxResponseDelay
  );
}

/**
 * Main IP Ban middleware
 * Checks if incoming IP is banned and takes appropriate action
 */
export const ipBanMiddleware = async (req, res, next) => {
  try {
    // Get the client's IP address, handling potential proxy situations
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    
    // Skip check for whitelisted IPs and bypass paths
    if (IP_BAN_CONFIG.whitelist.includes(clientIp) || 
        IP_BAN_CONFIG.bypassPaths.some(path => req.path.startsWith(path))) {
      if (IP_BAN_CONFIG.debugLogging) {
        logApi.debug(`IP Ban check bypassed for ${clientIp} (whitelisted or bypass path)`);
      }
      return next();
    }

    // Check if the IP is banned
    const bannedIp = await prisma.banned_ips.findUnique({
      where: { ip_address: clientIp }
    });

    // If IP is not banned, proceed with request
    if (!bannedIp) {
      return next();
    }

    // Check if the ban has expired (if not permanent)
    if (!bannedIp.is_permanent && bannedIp.expires_at && new Date() > new Date(bannedIp.expires_at)) {
      // Ban has expired, log this information
      logApi.info(`Expired IP ban detected for ${clientIp}, allowing request`, {
        ban_id: bannedIp.id,
        reason: bannedIp.reason,
        expired_at: bannedIp.expires_at
      });
      
      // Allow the request to proceed
      return next();
    }

    // Increment the number of attempts for this banned IP
    await prisma.banned_ips.update({
      where: { id: bannedIp.id },
      data: { num_attempts: { increment: 1 } }
    });

    // Log the banned IP attempt
    logApi.warn(`${fancyColors.BG_LIGHT_RED}BANNED IP BLOCKED:${fancyColors.RESET} ${clientIp}`, {
      ban_id: bannedIp.id,
      reason: bannedIp.reason,
      path: req.path,
      method: req.method,
      user_agent: req.get('user-agent'),
      attempt_number: bannedIp.num_attempts + 1, // +1 because we just incremented it
      referrer: req.get('referrer')
    });

    // Log to admin logs for tracking
    await AdminLogger.logAction(
      'SYSTEM',
      'BANNED_IP_ATTEMPT',
      {
        ip_address: clientIp,
        ban_id: bannedIp.id,
        path: req.path,
        attempts: bannedIp.num_attempts + 1,
        user_agent: req.get('user-agent')
      }
    );

    // If trolling is enabled, apply trolling behavior
    if (IP_BAN_CONFIG.enableTrolling) {
      const trollLevel = bannedIp.troll_level || 1;
      
      // Calculate artificial delay based on troll level
      const delay = calculateResponseDelay(trollLevel);
      
      // Get a random trolling response
      const trollResponse = getRandomTrollingResponse(trollLevel);
      
      // Wait for the calculated delay
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // For API requests, return a trolling JSON response
      if (req.path.startsWith('/api/')) {
        return res.status(trollResponse.code).json({
          error: trollResponse.message,
          status: 'error',
          _tag: IP_BAN_CONFIG.trollingTag, // For analytics tracking
          retry_after: Math.floor(Math.random() * 10000) + 3600 // Random retry-after between 1 hour and ~4 hours
        });
      }
      
      // For normal page requests, redirect to the banned-ip page with trolling parameters
      return res.redirect(`/banned-ip?reason=${encodeURIComponent(trollResponse.message)}&code=${trollResponse.code}&tag=${IP_BAN_CONFIG.trollingTag}`);
    }
    
    // If trolling is disabled, use standard ban response
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({
        error: 'Access denied. Your IP address has been banned.',
        status: 'error'
      });
    }
    
    // Redirect to banned page for normal requests
    return res.redirect('/banned-ip');
    
  } catch (error) {
    // Log the error but don't block the request
    logApi.error(`Error in IP ban middleware: ${error.message}`, {
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      }
    });
    
    // Allow the request to proceed to avoid blocking legitimate users due to errors
    next();
  }
};

/**
 * Helper function to check if an IP is banned
 * @param {string} ipAddress - IP address to check
 * @returns {Object|null} Ban information or null if not banned
 */
export const checkIpBan = async (ipAddress) => {
  try {
    const bannedIp = await prisma.banned_ips.findUnique({
      where: { ip_address: ipAddress }
    });
    
    if (!bannedIp) {
      return null;
    }
    
    // Check if ban has expired
    if (!bannedIp.is_permanent && bannedIp.expires_at && new Date() > new Date(bannedIp.expires_at)) {
      return null;
    }
    
    return bannedIp;
  } catch (error) {
    logApi.error(`Error checking IP ban status: ${error.message}`);
    return null;
  }
};

export default ipBanMiddleware;