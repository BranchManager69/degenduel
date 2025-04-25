/**
 * Additional Functions Tests
 * 
 * Tests for the additional function handlers used by the AI service.
 */

import { jest } from '@jest/globals';
import {
  formatNumber,
  handleGetTokenMetricsHistory,
  handleGetPlatformActivity,
  handleGetServiceStatus,
  handleGetSystemSettings,
  handleGetWebSocketStats,
  handleGetIPBanStatus,
  handleGetDiscordWebhookEvents
} from '../../services/ai-service/utils/additional-functions.js';

// Mock the Prisma client properly using jest.fn() for all methods
jest.mock('../../config/prisma.js', () => {
  return {
    __esModule: true,
    default: {
      tokens: {
        findFirst: jest.fn()
      },
      token_price_history: {
        findMany: jest.fn()
      },
      token_rank_history: {
        findMany: jest.fn()
      },
      token_volume_history: {
        findMany: jest.fn()
      },
      token_liquidity_history: {
        findMany: jest.fn()
      },
      token_market_cap_history: {
        findMany: jest.fn()
      },
      contests: {
        findMany: jest.fn()
      },
      contest_portfolio_trades: {
        findMany: jest.fn()
      },
      user_achievements: {
        findMany: jest.fn()
      },
      transactions: {
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
      }
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

describe('Additional Functions', () => {
  // Reset all mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test('formatNumber should format numbers correctly', () => {
    expect(formatNumber(1500)).toBe('1.50K');
    expect(formatNumber(1500000)).toBe('1.50M');
    expect(formatNumber(1500000000)).toBe('1.50B');
    expect(formatNumber('not a number')).toBe('Unknown');
    expect(formatNumber(null)).toBe('Unknown');
  });
  
  test('handleGetTokenMetricsHistory should handle price metrics', async () => {
    const mockToken = {
      id: 1,
      symbol: 'SOL',
      name: 'Solana'
    };
    
    const mockPriceHistory = [
      { timestamp: new Date('2023-01-01'), price: 100, source: 'dexscreener' },
      { timestamp: new Date('2023-01-02'), price: 105, source: 'dexscreener' }
    ];
    
    prisma.tokens.findFirst.mockResolvedValue(mockToken);
    prisma.token_price_history.findMany.mockResolvedValue(mockPriceHistory);
    
    const result = await handleGetTokenMetricsHistory({
      tokenSymbol: 'SOL',
      metricType: 'price',
      timeframe: '7d',
      limit: 10
    });
    
    expect(result).not.toHaveProperty('error');
    expect(result.symbol).toBe('SOL');
    expect(result.metric).toBe('price');
    expect(result.history).toHaveLength(2);
    expect(prisma.token_price_history.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          token_id: 1
        })
      })
    );
  });
  
  test('handleGetTokenMetricsHistory should handle invalid metric type', async () => {
    const mockToken = {
      id: 1,
      symbol: 'SOL',
      name: 'Solana'
    };
    
    prisma.tokens.findFirst.mockResolvedValue(mockToken);
    
    const result = await handleGetTokenMetricsHistory({
      tokenSymbol: 'SOL',
      metricType: 'invalid_metric',
      timeframe: '7d'
    });
    
    expect(result).toHaveProperty('error');
    expect(result.error).toBe('Invalid metric type');
  });
  
  test('handleGetPlatformActivity should handle contests activity', async () => {
    const mockContests = [
      {
        name: 'Daily Trading',
        contest_code: 'DAILY123',
        status: 'active',
        start_time: new Date(),
        end_time: new Date(Date.now() + 24 * 60 * 60 * 1000),
        entry_fee: 1000000000,
        prize_pool: 5000000000,
        participant_count: 20,
        max_participants: 50,
        created_at: new Date(),
        completed_at: null
      }
    ];
    
    prisma.contests.findMany.mockResolvedValue(mockContests);
    
    const result = await handleGetPlatformActivity({
      activityType: 'contests',
      limit: 5
    });
    
    expect(result).not.toHaveProperty('error');
    expect(result.type).toBe('contests');
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].name).toBe('Daily Trading');
    expect(result.activities[0].code).toBe('DAILY123');
    expect(prisma.contests.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { created_at: 'desc' },
        take: 5
      })
    );
  });
  
  test('handleGetPlatformActivity should handle invalid activity type', async () => {
    const result = await handleGetPlatformActivity({
      activityType: 'invalid_type',
      limit: 5
    });
    
    expect(result).toHaveProperty('error');
    expect(result.error).toBe('Invalid activity type');
  });
  
  test('handleGetServiceStatus should return service info (admin only)', async () => {
    const mockServices = [
      {
        service_name: 'ai_service',
        display_name: 'AI Service',
        enabled: true,
        last_run_at: new Date(),
        last_run_duration_ms: 1500,
        last_status: 'success',
        status_message: 'Service running normally',
        check_interval_ms: 600000,
        circuit_breaker: JSON.stringify({ enabled: true, threshold: 3 }),
        backoff: JSON.stringify({ enabled: true, maxAttempts: 5 }),
        thresholds: JSON.stringify({ errorThreshold: 0.1 }),
        last_updated: new Date(),
        updated_by: 'system'
      }
    ];
    
    prisma.service_configuration.findMany.mockResolvedValue(mockServices);
    
    const result = await handleGetServiceStatus({}, { userRole: 'admin' });
    
    expect(result).not.toHaveProperty('error');
    expect(result.services).toHaveLength(1);
    expect(result.services[0].name).toBe('ai_service');
    expect(result.services[0].display_name).toBe('AI Service');
    expect(result.services[0].enabled).toBe(true);
    expect(prisma.service_configuration.findMany).toHaveBeenCalled();
  });
  
  test('handleGetSystemSettings should return system settings (admin only)', async () => {
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
    
    const result = await handleGetSystemSettings({}, { userRole: 'admin' });
    
    expect(result).not.toHaveProperty('error');
    expect(result.settings).toHaveLength(1);
    expect(result.settings[0].key).toBe('maintenance_mode');
    expect(prisma.system_settings.findMany).toHaveBeenCalled();
  });
  
  test('handleGetWebSocketStats should handle timeframe "now" (admin only)', async () => {
    const mockConnections = [
      {
        connection_id: 'conn123',
        is_authenticated: true,
        wallet_address: 'wallet123',
        nickname: 'trader',
        connected_at: new Date(),
        disconnected_at: null,
        messages_sent: 10,
        messages_received: 5,
        subscribed_topics: JSON.stringify(['market', 'portfolio'])
      }
    ];
    
    prisma.websocket_connections.findMany.mockResolvedValue(mockConnections);
    
    const result = await handleGetWebSocketStats({ timeframe: 'now' }, { userRole: 'admin' });
    
    expect(result).not.toHaveProperty('error');
    expect(result.timeframe).toBe('now');
    expect(result.active_connections).toBe(1);
    expect(result.connections[0].connection_id).toBe('conn123');
    expect(result.connections[0].is_authenticated).toBe(true);
    expect(result.connections[0].user).toBe('trader');
    expect(prisma.websocket_connections.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { disconnected_at: null }
      })
    );
  });
  
  test('handleGetIPBanStatus should return banned IPs (admin only)', async () => {
    const mockBans = [
      {
        ip_address: '1.2.3.4',
        reason: 'Suspicious activity',
        is_permanent: true,
        expires_at: null,
        created_at: new Date(),
        created_by: 'system',
        num_attempts: 10,
        troll_level: 3,
        metadata: JSON.stringify({ last_attempt: '2023-01-01' })
      }
    ];
    
    prisma.banned_ips.findMany.mockResolvedValue(mockBans);
    
    const result = await handleGetIPBanStatus({}, { userRole: 'admin' });
    
    expect(result).not.toHaveProperty('error');
    expect(result.bans).toHaveLength(1);
    expect(result.bans[0].ip_address).toBe('1.2.3.4');
    expect(result.bans[0].reason).toBe('Suspicious activity');
    expect(result.bans[0].is_permanent).toBe(true);
    expect(result.bans[0].status).toBe('Permanent');
    expect(prisma.banned_ips.findMany).toHaveBeenCalled();
  });
  
  test('handleGetDiscordWebhookEvents should return webhook events (admin only)', async () => {
    // This function currently uses mock data so we don't test the Prisma call
    const result = await handleGetDiscordWebhookEvents({
      eventType: 'contest_start',
      limit: 3
    }, { userRole: 'admin' });
    
    expect(result).not.toHaveProperty('error');
    expect(result.events).toBeDefined();
    expect(Array.isArray(result.events)).toBe(true);
  });
  
  // Test error handling
  test('Function handlers should handle errors gracefully', async () => {
    // Simulate a database error
    prisma.tokens.findFirst.mockRejectedValue(new Error('Database connection failed'));
    
    const result = await handleGetTokenMetricsHistory({
      tokenSymbol: 'SOL',
      metricType: 'price'
    });
    
    expect(result).toHaveProperty('error');
    expect(result.error).toBe('Failed to fetch token metrics history');
  });
});