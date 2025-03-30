// utils/__mocks__/admin-logger.js
import { jest } from '@jest/globals';

const mockAdminLogger = {
  logAction: jest.fn(),
  Actions: {
    WALLET: {
      CREATE: 'create',
      TRANSFER: 'transfer',
    },
  },
};

export default mockAdminLogger;