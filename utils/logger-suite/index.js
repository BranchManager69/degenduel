// /utils/logger-suite/index.js (Centralized logging for DegenDuel backend services)
export * from './logger.js';
export * from './logging.js';

// Backwards compatibility layer
export const log = logAPI;
export default logAPI; 