/**
 * Script to clean up test service logs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkAndCleanupTestData() {
  try {
    // Check if there's test data
    const count = await prisma.service_logs.count();
    console.log(`Found ${count} entries in service_logs table`);
    
    if (count > 0) {
      // Check a sample to see if it's test data
      const sample = await prisma.service_logs.findFirst();
      console.log('Sample entry:', JSON.stringify(sample, null, 2));
      
      // Delete all test data
      console.log('Deleting all test data from service_logs table...');
      const deleted = await prisma.service_logs.deleteMany();
      console.log(`Deleted ${deleted.count} test entries`);
      console.log('All test data has been removed.');
    } else {
      console.log('No test data found in service_logs table.');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

checkAndCleanupTestData();