// utils/logger-suite/__mocks__/logger.js
import { jest } from '@jest/globals';

export const logApi = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

export default { logApi };