/**
 * Script to create test service logs for development
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function createTestServiceLogs() {
  try {
    console.log('Creating test service logs...');
    
    // Create sample service logs for testing
    const services = ['solana_engine', 'contest_scheduler', 'token_monitoring'];
    const levels = ['info', 'warn', 'error'];
    const messages = [
      'Service started successfully',
      'Performance degradation detected',
      'API rate limit approaching threshold',
      'Database connection pool exhausted',
      'Failed to process transaction',
      'Cache miss rate exceeds 20%',
      'Healthcheck completed successfully',
      'Request processing time exceeds threshold',
      'Scheduled task completed',
      'Connection to external service timed out'
    ];
    
    // Create 20 log entries for each service
    for (const service of services) {
      console.log(`Creating logs for ${service}...`);
      
      for (let i = 0; i < 20; i++) {
        const level = levels[Math.floor(Math.random() * levels.length)];
        const message = messages[Math.floor(Math.random() * messages.length)];
        
        await prisma.service_logs.create({
          data: {
            service,
            level,
            message,
            details: { 
              iteration: i,
              timestamp: new Date().toISOString()
            },
            event_type: level === 'error' ? 'failure' : 'routine',
            duration_ms: Math.floor(Math.random() * 500),
            environment: 'production'
          }
        });
      }
    }
    
    const count = await prisma.service_logs.count();
    console.log(`Total service logs: ${count}`);
    
    console.log('Created test service logs successfully!');
  } catch (error) {
    console.error('Error creating test logs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestServiceLogs();