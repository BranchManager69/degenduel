// /utils/logger-suite/logger.js
// Compatibility layer for existing imports
import { logAPI } from './index.js';
// Export everything from the new system
export * from './index.js';
// Default export for existing imports
export default logAPI;
// Named export for existing imports
export const logApi = logAPI;  // Note: maintains the camelCase version some files might use