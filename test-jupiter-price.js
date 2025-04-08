// Simple test script for Jupiter price API

import { jupiterClient } from './services/solana-engine/jupiter-client.js';

async function main() {
  try {
    console.log('Testing Jupiter price API with updated client\n');
    
    // Initialize Jupiter client
    console.log('1. Initializing Jupiter client...');
    await jupiterClient.initialize();
    console.log('✓ Jupiter client initialized\n');
    
    // Test fetching SOL price
    console.log('2. Fetching SOL price...');
    const solMint = 'So11111111111111111111111111111111111111112';
    const prices = await jupiterClient.getPrices([solMint]);
    
    // Display results
    console.log('✓ Price fetch successful');
    console.log('\nRESULTS:');
    console.log('- SOL price:', prices[solMint]?.price || 'Not found');
    console.log('\nTest completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
}

// Run the test
main();