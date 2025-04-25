/**
 * Service Interval Adapter
 * 
 * This adapter provides a bridge between the new service_configuration table
 * and existing services without requiring changes to the BaseService class.
 * It allows individual services to opt-in to dynamic configuration.
 */

import prisma from '../../config/prisma.js';
import { logApi } from '../logger-suite/logger.js';

/**
 * Cache of service intervals to avoid excessive database lookups
 */
const intervalCache = new Map();

/**
 * Cache expiry time to refresh intervals (10 seconds)
 */
const CACHE_TTL_MS = 10000;

/**
 * Cache timestamps for last interval read
 */
const lastReadTimes = new Map();

/**
 * Get the check interval for a service from the service_configuration table
 * with caching to minimize database load
 * 
 * @param {string} serviceName - The service name
 * @param {number} defaultInterval - Default interval (ms) to use if not found
 * @param {boolean} forceRefresh - Force a refresh from the database
 * @returns {number} - The check interval in milliseconds
 */
export async function getServiceInterval(serviceName, defaultInterval, forceRefresh = false) {
  try {
    const now = Date.now();
    const lastRead = lastReadTimes.get(serviceName) || 0;
    const isCacheStale = (now - lastRead) > CACHE_TTL_MS;
    
    // Return cached value if not stale and not forced to refresh
    if (!forceRefresh && !isCacheStale && intervalCache.has(serviceName)) {
      return intervalCache.get(serviceName);
    }
    
    // Query the database for the current interval
    const config = await prisma.service_configuration.findUnique({
      where: { service_name: serviceName },
      select: { check_interval_ms: true, enabled: true }
    });
    
    // Return default if not found or disabled
    if (!config || config.enabled === false) {
      return defaultInterval;
    }
    
    // Update cache and timestamp
    intervalCache.set(serviceName, config.check_interval_ms);
    lastReadTimes.set(serviceName, now);
    
    return config.check_interval_ms;
  } catch (error) {
    // Log error but don't crash service
    logApi.error(`Error fetching service interval for ${serviceName}:`, error);
    
    // Return cached value if available
    if (intervalCache.has(serviceName)) {
      return intervalCache.get(serviceName);
    }
    
    // Fallback to default
    return defaultInterval;
  }
}

/**
 * Clear the interval cache for a service or all services
 * 
 * @param {string|null} serviceName - Service name or null to clear all
 */
export function clearIntervalCache(serviceName = null) {
  if (serviceName) {
    intervalCache.delete(serviceName);
    lastReadTimes.delete(serviceName);
  } else {
    intervalCache.clear();
    lastReadTimes.clear();
  }
}

/**
 * Initialize the adapter by running a query to validate the table exists
 */
export async function initializeAdapter() {
  try {
    // Test the connection and that the table exists
    await prisma.service_configuration.count();
    logApi.info('Service interval adapter initialized successfully');
    return true;
  } catch (error) {
    logApi.error('Failed to initialize service interval adapter:', error);
    return false;
  }
}

// Export default with named functions
export default {
  getServiceInterval,
  clearIntervalCache,
  initializeAdapter
};