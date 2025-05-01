/**
 * @file DegenDuel Realtime Data Suite - Main Export
 * @description A comprehensive system for real-time data across the platform.
 */

import { RealtimeManager } from './realtime-manager.js';

// Export the singleton instance
const realtime = new RealtimeManager();

export default realtime;

// Named exports for specific components
export { RealtimeManager } from './realtime-manager.js';
export { channels, SYSTEM_CHANNELS } from './channels.js';
export * from './types.js';