export * from './logging';
export { default as logAPI } from './logging';

// Backwards compatibility layer
export const log = logAPI;
export default logAPI; 