import VanityWalletService from './services/vanity-wallet/vanity-wallet-service.js';

async function testCleanup() {
  const service = new VanityWalletService();
  console.log('Service instance created');
  
  try {
    const result = await service.cleanupOrphanedProcesses();
    console.log(`Cleanup complete. Found ${result} orphaned processes.`);
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

testCleanup().then(() => console.log('Test completed'));
