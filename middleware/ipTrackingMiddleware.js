// middleware/ipTrackingMiddleware.js

import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';

/**
 * IP Tracking Configuration
 */
const IP_TRACKING_CONFIG = {
  // Whether to enable IP tracking
  enabled: true,
  
  // Paths to exclude from tracking (e.g., health checks, static resources)
  excludePaths: [
    '/api/health',
    '/favicon.ico',
    '/robots.txt',
    '/.well-known',
    '/public/'
  ],
  
  // Only track these HTTP methods
  trackMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  
  // How often to update the last_seen timestamp (in milliseconds)
  // This prevents excessive database updates for frequent users
  updateFrequency: 30 * 60 * 1000, // 30 minutes
  
  // Enable detailed debug logging
  debugLogging: false,
};

/**
 * Cache to limit database writes for frequent visitors
 * Maps wallet addresses to last update timestamps
 */
const updateCache = new Map();

/**
 * Determine if a path should be excluded from tracking
 * @param {string} path - Request path
 * @returns {boolean} - Whether to exclude this path
 */
function shouldExcludePath(path) {
  return IP_TRACKING_CONFIG.excludePaths.some(prefix => path.startsWith(prefix));
}

/**
 * Check if we should update the last_seen timestamp
 * @param {string} walletAddress - User's wallet address
 * @returns {boolean} - Whether to update the timestamp
 */
function shouldUpdateTimestamp(walletAddress) {
  const lastUpdate = updateCache.get(walletAddress);
  const now = Date.now();
  
  if (!lastUpdate || (now - lastUpdate) > IP_TRACKING_CONFIG.updateFrequency) {
    updateCache.set(walletAddress, now);
    return true;
  }
  
  return false;
}

/**
 * Extract geo information from request headers
 * @param {Object} req - Express request object
 * @returns {Object} - Geo information object
 */
function extractGeoInfo(req) {
  // This is a simplified version - a real implementation could:
  // 1. Use a service like MaxMind GeoIP
  // 2. Use CloudFlare headers if your app is behind CloudFlare
  // 3. Implement your own geo IP lookup service
  
  // For now, we'll just check for CloudFlare headers which might be present
  return {
    country_code: req.headers['cf-ipcountry'] || null,
    region: null,
    city: null
  };
}

/**
 * Main IP tracking middleware
 */
export const ipTrackingMiddleware = async (req, res, next) => {
  // Skip if tracking is disabled or path is excluded
  if (!IP_TRACKING_CONFIG.enabled || shouldExcludePath(req.path)) {
    return next();
  }
  
  // Skip if method is not being tracked
  if (!IP_TRACKING_CONFIG.trackMethods.includes(req.method)) {
    return next();
  }
  
  // Continue immediately to not block the request
  next();
  
  // Only track authenticated users
  if (!req.user || !req.user.wallet_address) {
    return;
  }
  
  try {
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const walletAddress = req.user.wallet_address;
    const userAgent = req.get('user-agent');
    
    // Extract geo information from request
    const geoInfo = extractGeoInfo(req);
    
    // Check if we've seen this user-IP combination before
    const existingRecord = await prisma.user_ip_history.findUnique({
      where: {
        user_ip_unique: {
          wallet_address: walletAddress,
          ip_address: clientIp
        }
      }
    });
    
    if (existingRecord) {
      // Only update if sufficient time has passed
      if (shouldUpdateTimestamp(walletAddress)) {
        // Update existing record
        await prisma.user_ip_history.update({
          where: { id: existingRecord.id },
          data: {
            last_seen: new Date(),
            access_count: { increment: 1 },
            // Update user agent if it changed
            ...(userAgent !== existingRecord.user_agent && { user_agent: userAgent }),
            // Update geo info if it wasn't available before
            ...(geoInfo.country_code && !existingRecord.country_code && { country_code: geoInfo.country_code }),
            ...(geoInfo.region && !existingRecord.region && { region: geoInfo.region }),
            ...(geoInfo.city && !existingRecord.city && { city: geoInfo.city })
          }
        });
        
        if (IP_TRACKING_CONFIG.debugLogging) {
          logApi.debug(`${fancyColors.CYAN}[IP Tracking]${fancyColors.RESET} Updated IP record for user ${walletAddress}`, {
            ip: clientIp,
            access_count: existingRecord.access_count + 1
          });
        }
      }
    } else {
      // Create new record
      await prisma.user_ip_history.create({
        data: {
          wallet_address: walletAddress,
          ip_address: clientIp,
          user_agent: userAgent,
          first_seen: new Date(),
          last_seen: new Date(),
          country_code: geoInfo.country_code,
          region: geoInfo.region,
          city: geoInfo.city,
          metadata: {
            first_path: req.path,
            first_method: req.method,
            first_referer: req.get('referer') || null
          }
        }
      });
      
      if (IP_TRACKING_CONFIG.debugLogging) {
        logApi.debug(`${fancyColors.CYAN}[IP Tracking]${fancyColors.RESET} New IP record for user ${walletAddress}`, {
          ip: clientIp,
          path: req.path
        });
      }
    }
  } catch (error) {
    // Log error but don't affect request
    logApi.error(`${fancyColors.RED}[IP Tracking]${fancyColors.RESET} Error tracking IP:`, {
      error: error.message,
      stack: error.stack
    });
  }
};

export default ipTrackingMiddleware;