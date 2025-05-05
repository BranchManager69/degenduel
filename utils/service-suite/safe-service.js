/**
 * Safe Service Utilities
 * @module utils/service-suite/safe-service
 * 
 * Utility functions to handle common service operations safely,
 * preventing null reference errors and circular references.
 * 
 * @version 1.0.0
 */

import serviceEvents from './service-events.js';

/**
 * Safely get a value from an object with default if missing
 * @param {Object} obj - The object to access
 * @param {string} key - The property key to access
 * @param {*} def - Default value if property is missing or null
 * @returns {*} The value or default
 */
export const safe = (obj, key, def = 0) => obj?.[key] ?? def;

/**
 * Safely increment a counter in an object
 * @param {Object} obj - The object containing the counter
 * @param {string} key - The property to increment
 * @returns {number|undefined} The new value or undefined
 */
export const inc = (obj, key) => obj && (obj[key] = (obj[key] || 0) + 1);

/**
 * Safely set a value in an object
 * @param {Object} obj - The object to modify
 * @param {string} key - The property to set
 * @param {*} val - The value to set
 * @returns {*|undefined} The set value or undefined
 */
export const set = (obj, key, val) => obj && (obj[key] = val);

/**
 * Log an error safely without circular references
 * @param {Object} logger - The logger instance
 * @param {string} service - Service name for logging
 * @param {string} msg - Error message
 * @param {Error} err - Error object
 */
export const logError = (logger, service, msg, err) => {
  logger.error(`[${service}] ${msg}: ${err?.message || 'Unknown error'}`);
  if (logger.debug) {
    logger.debug(`[${service}] Error details: ${err?.code || ''} ${err?.name || ''}`);
  }
};

/**
 * Check if a service's circuit breaker is open
 * @param {Object} service - The service to check
 * @returns {boolean} True if circuit breaker is open
 */
export const isCircuitOpen = (service) => {
  if (!service?.circuitBreaker) return false;
  
  const isOpen = service.circuitBreaker.isOpen();
  if (isOpen) {
    serviceEvents.emit('service:circuit-breaker', {
      name: service.name,
      status: 'open',
      timestamp: new Date().toISOString()
    });
  }
  return isOpen;
};

/**
 * Create a safe copy of stats object without circular references
 * @param {Object} stats - The stats object to copy
 * @returns {Object} A safe copy
 */
export const safeStats = (stats) => {
  if (!stats) return {};
  
  try {
    // Convert to JSON and back to strip any non-serializable properties
    return JSON.parse(JSON.stringify(stats));
  } catch (e) {
    // Fallback to manual copy if JSON conversion fails
    const result = {};
    for (const key in stats) {
      if (typeof stats[key] !== 'function' && key !== 'parent' && key !== 'children') {
        if (typeof stats[key] === 'object' && stats[key] !== null) {
          result[key] = safeStats(stats[key]);
        } else {
          result[key] = stats[key];
        }
      }
    }
    return result;
  }
};