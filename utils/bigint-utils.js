// bigint-utils.js
// Utilities for handling BigInt values in the application

/**
 * Safely converts BigInt values to strings in objects for JSON serialization
 * 
 * This solves the common issue where BigInt values from the database
 * cannot be directly serialized to JSON (which causes "TypeError: Do not 
 * know how to serialize a BigInt" errors)
 * 
 * @param {Object} obj Object that might contain BigInt values
 * @returns {Object} Object with BigInt values converted to strings
 */
export function safeBigIntToJSON(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  // Handle Date objects
  if (obj instanceof Date) {
    return obj;
  }
  
  // Handle BigInt values directly
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => safeBigIntToJSON(item));
  }
  
  // Handle regular objects
  if (typeof obj === 'object') {
    return Object.entries(obj).reduce((result, [key, value]) => {
      result[key] = safeBigIntToJSON(value);
      return result;
    }, {});
  }
  
  // Return primitive values as-is
  return obj;
}

/**
 * Custom JSON replacer function for use with JSON.stringify
 * 
 * Example usage:
 * JSON.stringify(objectWithBigInts, bigIntReplacer)
 * 
 * @param {string} key The key of the value being processed
 * @param {any} value The value to be serialized
 * @returns {any} The serialized value
 */
export function bigIntReplacer(key, value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Extended JSON.stringify that handles BigInt values
 * 
 * @param {any} value The value to serialize
 * @param {Function|Array} replacer Optional replacer function
 * @param {number|string} space Optional indentation
 * @returns {string} JSON string with BigInt values converted to strings
 */
export function safeStringify(value, replacer = null, space = null) {
  const combinedReplacer = (key, val) => {
    // First apply the bigIntReplacer
    val = bigIntReplacer(key, val);
    
    // Then apply the custom replacer if provided
    if (replacer && typeof replacer === 'function') {
      val = replacer(key, val);
    }
    
    return val;
  };
  
  return JSON.stringify(value, combinedReplacer, space);
}

/**
 * Converts a BigInt representing lamports to a SOL string with given decimal places
 * 
 * @param {BigInt|number|string} lamports Lamports value (can be BigInt, number or string)
 * @param {number} decimals Number of decimal places to display
 * @returns {string} Formatted SOL string with specified decimal places
 */
export function lamportsToSol(lamports, decimals = 2) {
  if (lamports === null || lamports === undefined) {
    return '0.00';
  }
  
  // Convert to string if it's a BigInt
  const lamportsStr = typeof lamports === 'bigint' ? lamports.toString() : String(lamports);
  
  // Calculate SOL value
  const solValue = parseFloat(lamportsStr) / 1_000_000_000;
  
  // Format with specified decimal places
  return solValue.toFixed(decimals);
}

// Export the utility functions
export default {
  safeBigIntToJSON,
  bigIntReplacer,
  safeStringify,
  lamportsToSol
};