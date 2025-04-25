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
 * - 'unified': Use the unified WebSocket approach (all topics in one WebSocket)
 * 
 * This configuration is used by the WebSocket initializer to determine
 * which implementation to use for each service.
 */
export const websocketPreferences = {
  // UNIFIED WEBSOCKET APPROACH
  // All WebSockets now use the unified WebSocket implementation
  
  // Core services
  analytics: 'unified',
  circuitBreaker: 'unified',
  contest: 'unified',
  monitor: 'unified',
  skyDuel: 'unified',
  systemSettings: 'unified',
  tokenData: 'unified',
  userNotification: 'unified',
  market: 'unified',
  adminSpy: 'unified',
  broadcastCommand: 'unified',
  portfolio: 'unified',
  wallet: 'unified',
  marketData: 'unified',
  
  // Special flag to indicate unified mode
  useUnifiedWebSocket: true
};

/**
 * Check if a WebSocket service should use v69 implementation
 * 
 * @param {string} serviceName - The WebSocket service name
 * @returns {boolean} - Whether to use v69 implementation
 */
export function shouldUseV69(serviceName) {
  // In unified mode, nothing uses individual v69 implementations
  if (websocketPreferences.useUnifiedWebSocket) {
    return false;
  }
  
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
  // In unified mode, nothing uses individual legacy implementations
  if (websocketPreferences.useUnifiedWebSocket) {
    return false;
  }
  
  const preference = websocketPreferences[serviceName] || 'legacy';
  return preference === 'legacy' || preference === 'parallel';
}

/**
 * Check if a WebSocket service should use unified implementation
 * 
 * @param {string} serviceName - The WebSocket service name
 * @returns {boolean} - Whether to use unified implementation
 */
export function shouldUseUnified(serviceName) {
  const preference = websocketPreferences[serviceName] || 'legacy';
  return preference === 'unified' || websocketPreferences.useUnifiedWebSocket;
}

export default {
  websocketPreferences,
  shouldUseV69,
  shouldUseLegacy,
  shouldUseUnified
};