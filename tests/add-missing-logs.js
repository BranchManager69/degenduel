// Add logs for services that have less than 5 logs

import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';

// List of services that need more logs
const services = ['token_refresh', 'admin_wallet', 'market_data', 'contest_scheduler', 'ANALYTICS', 'PRIVY_AUTH'];

async function addMissingLogs() {
  console.log('Adding logs for services with less than 5 logs...');
  
  for (const service of services) {
    console.log(`Adding logs for ${service}...`);
    
    // Add 6 logs per service
    for (let i = 0; i < 6; i++) {
      await logApi.serviceLog.write(
        service,
        ['info', 'warn', 'error'][Math.floor(Math.random() * 3)],
        `Test log #${i+1} for ${service}`,
        { test: true, iteration: i+1 },
        { metadata: 'test run' },
        'test_event',
        Math.floor(Math.random() * 100) + 50,
        null
      );
    }
  }
  
  // Count the logs again after generation
  const counts = await prisma.$queryRaw`
    SELECT service, COUNT(*) as count 
    FROM service_logs 
    GROUP BY service 
    ORDER BY count DESC
  `;
  
  console.log('\nLog counts by service after adding missing logs:');
  counts.forEach(row => {
    console.log(`${row.service}: ${row.count} logs` + 
               (row.count >= 5 ? ' ✅' : ' ❌'));
  });
  
  console.log('\nAll services should now have at least 5 logs.');
}

addMissingLogs()
  .then(() => {
    console.log('Additional logs added successfully.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });