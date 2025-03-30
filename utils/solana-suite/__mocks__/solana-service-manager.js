// utils/solana-suite/__mocks__/solana-service-manager.js
import { jest } from '@jest/globals';

const mockConnection = {
  getBalance: jest.fn().mockResolvedValue(5000000000), // 5 SOL
};

const mockSolanaServiceManager = {
  getConnection: jest.fn(() => mockConnection),
};

export default mockSolanaServiceManager;