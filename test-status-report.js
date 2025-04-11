import VanityWalletService from './services/vanity-wallet/vanity-wallet-service.js';

async function testStatusReport() {
  const service = new VanityWalletService();
  console.log('Service instance created');
  
  try {
    await service.init();
    console.log('Service initialized');
    
    // Log the job status report
    await service.logJobStatus();
    console.log('Status report complete');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testStatusReport();
