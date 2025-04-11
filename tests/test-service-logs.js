// Test the service logs functionality

import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';

// Test writing logs for various services
async function testServiceLogs() {
  console.log('Testing service logs...');

  // Test different services
  const testServices = [
    'solana_engine',
    'token_refresh',
    'contest_scheduler',
    'market_data',
    'admin_wallet'
  ];

  // Test different log levels
  const levels = ['info', 'warn', 'error', 'debug'];

  // Generate test logs
  for (const service of testServices) {
    const logger = logApi.forService(service);

    // Test each log level
    await logger.info(`[TEST] Info log for ${service}`, { 
      test: true,
      eventType: 'test',
      relatedEntity: 'test-entity'
    });
    
    await logger.warn(`[TEST] Warning log for ${service}`, { 
      test: true,
      eventType: 'test_warning',
      durationMs: 150
    });
    
    await logger.error(`[TEST] Error log for ${service}`, { 
      test: true,
      error: new Error('Test error'),
      eventType: 'test_error'
    });
    
    await logger.debug(`[TEST] Debug log for ${service}`, { 
      test: true,
      persistToDb: true, // Mark for DB persistence
      eventType: 'test_debug'
    });

    console.log(`Generated logs for ${service}`);
  }

  // Test analytics logs
  await logApi.analytics.trackSession(
    { nickname: 'TestUser', wallet_address: 'testWallet123' },
    { 'user-agent': 'Test Browser', 'x-real-ip': '127.0.0.1' }
  );

  console.log('Generated analytics logs');

  // Query the database to verify logs were written
  const logCount = await prisma.service_logs.count();
  console.log(`Total service logs in database: ${logCount}`);

  // Get sample logs
  const sampleLogs = await prisma.service_logs.findMany({
    take: 5,
    orderBy: {
      created_at: 'desc'
    }
  });

  console.log('Sample logs:');
  console.log(JSON.stringify(sampleLogs, null, 2));

  // Test cleanup function
  console.log('Testing cleanup for logs older than 0.001 days (should be none)');
  const cleanupResult = await logApi.serviceLog.cleanup(0.001);
  console.log('Cleanup result:', cleanupResult);

  console.log('Service logs test completed!');
}

// Run the test
testServiceLogs()
  .then(() => {
    console.log('Test completed successfully.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });