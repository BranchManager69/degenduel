// config/__mocks__/prisma.js
import { jest } from '@jest/globals';

const mockPrisma = {
  contest_wallet: {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (data) => data.data),
    update: jest.fn().mockImplementation(async (data) => ({ ...data.data, id: 1 })),
    upsert: jest.fn().mockImplementation(async (data) => ({ ...data.create, id: 1 })),
  },
  contest: {
    findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'Test Contest' }),
  },
  transaction: {
    create: jest.fn().mockResolvedValue({ id: 1 }),
  },
};

// Add transaction support
mockPrisma.$transaction = jest.fn(async (callback) => {
  return await callback(mockPrisma);
});

export default mockPrisma;