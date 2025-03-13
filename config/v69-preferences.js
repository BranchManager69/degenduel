// config/v69-preferences.js

/**
 * This file defines which WebSocket implementations should use v69 versions
 * instead of legacy versions when both are available.
 * 
 * By updating this file, you can gradually migrate from legacy to v69 WebSockets.
 */

/**
 * WebSocket preference map
 * 
 * For each WebSocket service, set to:
 * - 'v69': Use v69 implementation
 * - 'legacy': Use legacy implementation
 * - 'parallel': Run both implementations simultaneously
 * 
 * This configuration is used by the WebSocket initializer to determine
 * which implementation to use for each service.
 */
export const websocketPreferences = {
  // WebSockets confirmed to work with v69 implementation
  analytics: 'v69',
  circuitBreaker: 'v69',
  contest: 'v69',
  monitor: 'v69',
  skyDuel: 'v69',
  systemSettings: 'v69',
  tokenData: 'v69',
  userNotification: 'v69',
  
  // Consolidated WebSockets
  market: 'v69', // Now handled by market-data-ws.js
  
  // WebSockets not yet migrated to v69 (default to legacy)
  adminSpy: 'legacy',
  broadcastCommand: 'legacy',
  portfolio: 'legacy',
  wallet: 'legacy',
  
  // Special implementations
  marketData: 'v69', // New consolidated implementation for market + tokenData
};

/**
 * Check if a WebSocket service should use v69 implementation
 * 
 * @param {string} serviceName - The WebSocket service name
 * @returns {boolean} - Whether to use v69 implementation
 */
export function shouldUseV69(serviceName) {
  const preference = websocketPreferences[serviceName] || 'legacy';
  return preference === 'v69' || preference === 'parallel';
}

/**
 * Check if a WebSocket service should use legacy implementation
 * 
 * @param {string} serviceName - The WebSocket service name
 * @returns {boolean} - Whether to use legacy implementation
 */
export function shouldUseLegacy(serviceName) {
  const preference = websocketPreferences[serviceName] || 'legacy';
  return preference === 'legacy' || preference === 'parallel';
}

export default {
  websocketPreferences,
  shouldUseV69,
  shouldUseLegacy,
};