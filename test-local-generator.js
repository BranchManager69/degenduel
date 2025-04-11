import LocalVanityGenerator from './services/vanity-wallet/generators/local-generator.js';

function testLocalGenerator() {
  const generator = new LocalVanityGenerator();
  console.log('Local generator instance created');
  
  try {
    generator.cleanupOrphanedProcesses();
    console.log('Cleanup method called successfully');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

testLocalGenerator();
