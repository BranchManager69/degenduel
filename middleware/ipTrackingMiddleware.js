// middleware/ipTrackingMiddleware.js

import { prisma } from '../config/prisma.js';
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
 * IP Tracking Middleware
 * 
 * Tracks IP addresses for authenticated users in the user_ip_history table.
 * Updates access counts, timestamps, and geographic information.
 */
export const ipTrackingMiddleware = async (req, res, next) => {
  // Only track for authenticated users
  if (!req.user || !req.user.wallet_address) {
    return next();
  }

  try {
    // Extract IP address (same logic as logging middleware)
    const clientIp = req.ip || 
                    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                    req.headers['x-real-ip'] || 
                    req.connection.remoteAddress || 
                    null;

    if (!clientIp) {
      return next();
    }

    // Skip private/local IPs for production tracking
    const isPrivateIp = /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|127\.|::1|localhost)/.test(clientIp);
    
    const userAgent = req.headers['user-agent'] || null;
    const walletAddress = req.user.wallet_address;

    // Upsert IP history record
    const ipRecord = await prisma.user_ip_history.upsert({
      where: {
        user_ip_unique: {
          wallet_address: walletAddress,
          ip_address: clientIp
        }
      },
      update: {
        last_seen: new Date(),
        access_count: {
          increment: 1
        },
        user_agent: userAgent, // Update user agent in case it changed
        // Don't update geographic data on every request to avoid API calls
      },
      create: {
        wallet_address: walletAddress,
        ip_address: clientIp,
        user_agent: userAgent,
        access_count: 1,
        is_suspicious: false, // Could add logic to detect suspicious patterns
        metadata: {
          first_request_path: req.originalUrl || req.url,
          first_request_method: req.method,
          environment: req.environment
        }
      }
    });

    // If this is a new IP for this user, try to get geographic data
    if (ipRecord.access_count === 1 && !isPrivateIp) {
      // Use existing IP info service from logApi (async, don't wait)
      if (typeof logApi.getIpInfo === 'function') {
        logApi.getIpInfo(clientIp).then(async (ipInfo) => {
          if (ipInfo && !ipInfo.bogon && !ipInfo.error) {
            try {
              // Truncate geographic data to fit database column constraints
              const truncatedData = {
                country_code: ipInfo.country ? ipInfo.country.substring(0, 2) : null,
                region: ipInfo.region ? ipInfo.region.substring(0, 100) : null,
                city: ipInfo.city ? ipInfo.city.substring(0, 100) : null,
              };

              await prisma.user_ip_history.update({
                where: {
                  user_ip_unique: {
                    wallet_address: walletAddress,
                    ip_address: clientIp
                  }
                },
                data: {
                  ...truncatedData,
                  metadata: {
                    ...ipRecord.metadata,
                    geo_info: {
                      org: ipInfo.org,
                      postal: ipInfo.postal,
                      timezone: ipInfo.timezone,
                      loc: ipInfo.loc
                    },
                    updated_geo_at: new Date().toISOString()
                  }
                }
              });

              logApi.debug(`Updated geo info for user ${walletAddress} from IP ${clientIp}`, {
                city: ipInfo.city,
                region: ipInfo.region,
                country: ipInfo.country
              });
            } catch (geoError) {
              logApi.error('Failed to update geographic data:', geoError);
            }
          }
        }).catch(() => {
          // Silently fail geo lookup - don't block the request
        });
      }
    }

    // Add IP info to request for other middleware to use
    req.ipInfo = {
      address: clientIp,
      isPrivate: isPrivateIp,
      accessCount: ipRecord.access_count,
      firstSeen: ipRecord.first_seen,
      lastSeen: ipRecord.last_seen
    };

    // Log significant events
    if (ipRecord.access_count === 1) {
      logApi.info(`🆕 New IP detected for user ${req.user.nickname || 'Unknown'} (${walletAddress}): ${clientIp}`, {
        wallet_address: walletAddress,
        ip_address: clientIp,
        user_agent: userAgent,
        path: req.originalUrl || req.url
      });
    } else if (ipRecord.access_count % 100 === 0) {
      // Log every 100th access from same IP
      logApi.debug(`📊 IP ${clientIp} has been used ${ipRecord.access_count} times by ${walletAddress}`);
    }

  } catch (error) {
    // Log error but don't block the request
    logApi.error('IP tracking middleware error:', {
      error: error.message,
      stack: error.stack,
      wallet_address: req.user?.wallet_address,
      ip: req.ip
    });
  }

  next();
};

export default ipTrackingMiddleware;