import { logApi, logFrontend } from '../../server/config/logger.js';
import colors from 'colors';

export function logSuccess(message, details = {}) {
  console.log(`${colors.green}✓ ${message}${colors.reset}`);
  logApi.info(message, {
    ...details,
    timestamp: new Date().toISOString()
  });
  logFrontend.info(message, {
    ...details,
    timestamp: new Date().toISOString()
  });
}

export function logError(context, error) {
  const errorMessage = error?.message || 'Unexpected error occurred';
  const errorStack = error?.stack || new Error().stack;

  console.error(`${colors.red}✗ ${context}: ${errorMessage}${colors.reset}`);
  logApi.error(`${context}`, {
    error: errorMessage,
    stack: errorStack,
    timestamp: new Date().toISOString()
  });
  logFrontend.error(`${context}`, {
    error: errorMessage,
    stack: errorStack,
    timestamp: new Date().toISOString()
  });
}

export function logStep(step, total, message, metadata = {}) {
  const stepMessage = total ? `[${step}/${total}] ${message}` : `${message}`;
  console.log(`${colors.cyan}→ ${stepMessage}${colors.reset}`);
  logApi.info(stepMessage, {
    ...metadata,
    timestamp: new Date().toISOString()
  });
  logFrontend.info(stepMessage, {
    ...metadata,
    timestamp: new Date().toISOString()
  });
}

const logger = {
  info: (message) => console.log(colors.blue(message)),
  success: (message) => console.log(colors.green(message)),
  warning: (message) => console.log(colors.yellow(message)),
  error: (message) => console.log(colors.red(message))
};

export default logger;