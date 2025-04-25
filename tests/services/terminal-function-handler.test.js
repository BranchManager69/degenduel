/**
 * Terminal Function Handler Tests
 * 
 * Tests for the terminal function handler used by the AI service.
 */

import { jest } from '@jest/globals';
import { handleFunctionCall, TERMINAL_FUNCTIONS } from '../../services/ai-service/utils/terminal-function-handler.js';

// Mock the Prisma client properly using jest.fn() for all methods
jest.mock('../../config/prisma.js', () => {
  return {
    __esModule: true,
    default: {
      tokens: {
        findUnique: jest.fn(),
        findFirst: jest.fn()
      },
      token_price_history: {
        findMany: jest.fn()
      },
      token_pools: {
        findMany: jest.fn()
      },
      contests: {
        findMany: jest.fn()
      },
      users: {
        findFirst: jest.fn()
      },
      user_stats: {
        findMany: jest.fn()
      },
      contest_participants: {
        findMany: jest.fn()
      },
      service_configuration: {
        findMany: jest.fn()
      },
      system_settings: {
        findMany: jest.fn()
      },
      websocket_connections: {
        findMany: jest.fn(),
        count: jest.fn()
      },
      banned_ips: {
        findMany: jest.fn()
      },
      $queryRaw: jest.fn()
    }
  };
});

// Mock the logger
jest.mock('../../utils/logger-suite/logger.js', () => ({
  logApi: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

// Import the actual mocked prisma instance
import prisma from '../../config/prisma.js';

describe('Terminal Function Handler', () => {
  // Reset all mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test('TERMINAL_FUNCTIONS export should be defined and be an array', () => {
    expect(TERMINAL_FUNCTIONS).toBeDefined();
    expect(Array.isArray(TERMINAL_FUNCTIONS)).toBe(true);
    expect(TERMINAL_FUNCTIONS.length).toBeGreaterThan(0);
  });
  
  test('handleFunctionCall should handle unknown functions', async () => {
    const functionCall = {
      function: {
        name: 'nonExistentFunction',
        arguments: '{}'
      }
    };
    
    const result = await handleFunctionCall(functionCall);
    expect(result).toHaveProperty('error');
    expect(result.error).toBe('Unknown function');
    expect(result.function).toBe('nonExistentFunction');
  });
  
  test('handleFunctionCall should check admin privileges for admin-only functions', async () => {
    const adminFunctionCall = {
      function: {
        name: 'getSystemSettings',
        arguments: '{}'
      }
    };
    
    // Call with non-admin role
    const resultWithoutAdmin = await handleFunctionCall(adminFunctionCall, { userRole: 'user' });
    expect(resultWithoutAdmin).toHaveProperty('error');
    expect(resultWithoutAdmin.error).toBe('Permission denied');
    
    // Call with admin role
    const mockSystemSettingsResponse = { count: 0, settings: [] };
    prisma.system_settings.findMany.mockResolvedValue([]);
    
    const resultWithAdmin = await handleFunctionCall(adminFunctionCall, { userRole: 'admin' });
    expect(resultWithAdmin).not.toHaveProperty('error');
    expect(prisma.system_settings.findMany).toHaveBeenCalled();
  });
  
  test('getTokenPrice should find a token and return token information', async () => {
    // Mock token data
    const mockToken = {
      id: 1,
      symbol: 'SOL',
      name: 'Solana',
      address: 'So11111111111111111111111111111111111111112',
      token_prices: {
        price: 150.25,
        price_24h_change: 5.2,
        volume_24h: 1000000000,
        market_cap: 50000000000
      }
    };
    
    prisma.tokens.findFirst.mockResolvedValue(mockToken);
    
    const functionCall = {
      function: {
        name: 'getTokenPrice',
        arguments: JSON.stringify({ tokenSymbol: 'SOL' })
      }
    };
    
    const result = await handleFunctionCall(functionCall);
    expect(result).not.toHaveProperty('error');
    expect(result.symbol).toBe('SOL');
    expect(result.name).toBe('Solana');
    expect(prisma.tokens.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          symbol: expect.any(Object)
        })
      })
    );
  });
  
  test('getTokenPriceHistory should return historical price data', async () => {
    // Mock token data
    const mockToken = {
      id: 1,
      symbol: 'SOL',
      name: 'Solana',
      address: 'So11111111111111111111111111111111111111112'
    };
    
    const mockPriceHistory = [
      { timestamp: new Date('2023-01-01'), price: 100, source: 'dexscreener' },
      { timestamp: new Date('2023-01-02'), price: 105, source: 'dexscreener' },
      { timestamp: new Date('2023-01-03'), price: 110, source: 'dexscreener' }
    ];
    
    prisma.tokens.findFirst.mockResolvedValue(mockToken);
    prisma.token_price_history.findMany.mockResolvedValue(mockPriceHistory);
    
    const functionCall = {
      function: {
        name: 'getTokenPriceHistory',
        arguments: JSON.stringify({ 
          tokenSymbol: 'SOL',
          timeframe: '7d'
        })
      }
    };
    
    const result = await handleFunctionCall(functionCall);
    expect(result).not.toHaveProperty('error');
    expect(result.symbol).toBe('SOL');
    expect(result.timeframe).toBe('7d');
    expect(result.history).toHaveLength(3);
    expect(prisma.token_price_history.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          token_id: 1
        })
      })
    );
  });
  
  test('getTokenPools should return pool information', async () => {
    // Mock token data
    const mockToken = {
      id: 1,
      symbol: 'SOL',
      name: 'Solana',
      address: 'So11111111111111111111111111111111111111112'
    };
    
    const mockPools = [
      { 
        dex: 'Raydium', 
        address: 'pool1', 
        tokenAddress: 'So11111111111111111111111111111111111111112',
        programId: 'program1',
        dataSize: 1000,
        createdAt: new Date(),
        lastUpdated: new Date()
      }
    ];
    
    prisma.tokens.findFirst.mockResolvedValue(mockToken);
    prisma.token_pools.findMany.mockResolvedValue(mockPools);
    
    const functionCall = {
      function: {
        name: 'getTokenPools',
        arguments: JSON.stringify({ tokenSymbol: 'SOL' })
      }
    };
    
    const result = await handleFunctionCall(functionCall);
    expect(result).not.toHaveProperty('error');
    expect(result.symbol).toBe('SOL');
    expect(result.pools).toHaveLength(1);
    expect(result.pools[0].dex).toBe('Raydium');
    expect(prisma.token_pools.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenAddress: 'So11111111111111111111111111111111111111112'
        })
      })
    );
  });
  
  test('getActiveContests should return active and upcoming contests', async () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const mockContests = [
      {
        id: 1,
        contest_code: 'DAILY123',
        name: 'Daily Trading',
        description: 'Daily trading contest',
        start_time: now,
        end_time: tomorrow,
        entry_fee: 1000000000,  // 1 SOL
        prize_pool: 10000000000,  // 10 SOL
        current_prize_pool: 5000000000,
        status: 'active',
        participant_count: 25,
        min_participants: 10,
        max_participants: 100
      }
    ];
    
    prisma.contests.findMany.mockResolvedValue(mockContests);
    
    const functionCall = {
      function: {
        name: 'getActiveContests',
        arguments: JSON.stringify({ limit: 5, includeUpcoming: true })
      }
    };
    
    const result = await handleFunctionCall(functionCall);
    expect(result).not.toHaveProperty('error');
    expect(result.contests).toHaveLength(1);
    expect(result.contests[0].code).toBe('DAILY123');
    expect(result.contests[0].status).toBe('active');
    expect(prisma.contests.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ status: 'active' })
          ])
        })
      })
    );
  });
  
  test('getUserProfile should return user information', async () => {
    const mockUser = {
      id: 1,
      username: 'trader123',
      nickname: 'Pro Trader',
      wallet_address: 'wallet123',
      role: 'user',
      experience_points: 1500,
      user_level: {
        level_number: 3,
        title: 'Trading Explorer',
        class_name: 'EXPLORER'
      },
      user_stats: {
        contests_entered: 10,
        contests_won: 2,
        total_prize_money: 5000000000
      },
      user_achievements: [
        {
          achievement_type: 'FIRST_CONTEST',
          tier: 'BRONZE',
          category: 'CONTESTS',
          achieved_at: new Date(),
          xp_awarded: 100
        }
      ],
      social_profiles: [
        {
          platform: 'twitter',
          username: 'trader123',
          verified: true
        }
      ],
      wallet_balances: [
        {
          balance_lamports: 1500000000,  // 1.5 SOL
          timestamp: new Date()
        }
      ]
    };
    
    prisma.users.findFirst.mockResolvedValue(mockUser);
    
    const functionCall = {
      function: {
        name: 'getUserProfile',
        arguments: JSON.stringify({ usernameOrWallet: 'trader123' })
      }
    };
    
    const result = await handleFunctionCall(functionCall);
    expect(result).not.toHaveProperty('error');
    expect(result.username).toBe('trader123');
    expect(result.nickname).toBe('Pro Trader');
    expect(result.wallet_address).toBe('wallet123');
    expect(result.level.number).toBe(3);
    expect(prisma.users.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { username: 'trader123' }
      })
    );
  });
  
  test('getTopUsers should return users ranked by category', async () => {
    const mockUserStats = [
      {
        user_id: 1,
        contests_won: 5,
        total_prize_money: 10000000000,
        users: {
          username: 'winner123',
          nickname: 'Champion',
          role: 'user',
          user_level: {
            level_number: 5,
            title: 'Trading Master'
          }
        }
      }
    ];
    
    prisma.user_stats.findMany.mockResolvedValue(mockUserStats);
    
    const functionCall = {
      function: {
        name: 'getTopUsers',
        arguments: JSON.stringify({ 
          category: 'contests_won',
          limit: 10 
        })
      }
    };
    
    const result = await handleFunctionCall(functionCall);
    expect(result).not.toHaveProperty('error');
    expect(result.category).toBe('contests_won');
    expect(result.users).toHaveLength(1);
    expect(result.users[0].username).toBe('winner123');
    expect(result.users[0].nickname).toBe('Champion');
    expect(prisma.user_stats.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contests_won: { gt: 0 }
        })
      })
    );
  });
  
  test('getUserContestHistory should return contest history for a user', async () => {
    const mockUser = {
      id: 1,
      username: 'trader123',
      nickname: 'Pro Trader',
      wallet_address: 'wallet123'
    };
    
    const mockParticipations = [
      {
        wallet_address: 'wallet123',
        status: 'completed',
        joined_at: new Date(),
        entry_time: new Date(),
        initial_balance: 1000000000,
        final_rank: 3,
        portfolio_value: 1200000000,
        prize_amount: 100000000,
        prize_paid_at: new Date(),
        contests: {
          name: 'Daily Trading',
          contest_code: 'DAILY123',
          start_time: new Date(),
          end_time: new Date(),
          prize_pool: 10000000000,
          participant_count: 50
        }
      }
    ];
    
    prisma.users.findFirst.mockResolvedValue(mockUser);
    prisma.contest_participants.findMany.mockResolvedValue(mockParticipations);
    
    const functionCall = {
      function: {
        name: 'getUserContestHistory',
        arguments: JSON.stringify({ 
          usernameOrWallet: 'trader123',
          limit: 5
        })
      }
    };
    
    const result = await handleFunctionCall(functionCall);
    expect(result).not.toHaveProperty('error');
    expect(result.username).toBe('trader123');
    expect(result.contests).toHaveLength(1);
    expect(result.contests[0].name).toBe('Daily Trading');
    expect(result.contests[0].code).toBe('DAILY123');
    expect(prisma.users.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { username: 'trader123' }
      })
    );
    expect(prisma.contest_participants.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { wallet_address: 'wallet123' }
      })
    );
  });
  
  // Add a test for an admin-only function
  test('getSystemSettings should only work with admin privileges', async () => {
    const mockSettings = [
      {
        key: 'maintenance_mode',
        value: JSON.stringify({ enabled: false }),
        description: 'Enable/disable maintenance mode',
        updated_at: new Date(),
        updated_by: 'admin'
      }
    ];
    
    prisma.system_settings.findMany.mockResolvedValue(mockSettings);
    
    const functionCall = {
      function: {
        name: 'getSystemSettings',
        arguments: '{}'
      }
    };
    
    // Without admin role - should be denied
    const resultWithoutAdmin = await handleFunctionCall(functionCall, { userRole: 'user' });
    expect(resultWithoutAdmin).toHaveProperty('error');
    expect(resultWithoutAdmin.error).toBe('Permission denied');
    expect(prisma.system_settings.findMany).not.toHaveBeenCalled();
    
    // With admin role - should work
    const resultWithAdmin = await handleFunctionCall(functionCall, { userRole: 'admin' });
    expect(resultWithAdmin).not.toHaveProperty('error');
    expect(resultWithAdmin.count).toBe(1);
    expect(resultWithAdmin.settings[0].key).toBe('maintenance_mode');
    expect(prisma.system_settings.findMany).toHaveBeenCalled();
  });
  
  // Test error handling
  test('Functions should handle errors gracefully', async () => {
    // Simulate a database error
    prisma.tokens.findFirst.mockRejectedValue(new Error('Database connection failed'));
    
    const functionCall = {
      function: {
        name: 'getTokenPrice',
        arguments: JSON.stringify({ tokenSymbol: 'SOL' })
      }
    };
    
    const result = await handleFunctionCall(functionCall);
    expect(result).toHaveProperty('error');
    expect(result.function).toBe('getTokenPrice');
  });
});