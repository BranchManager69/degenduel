// Debug script for Jupiter client

import { getJupiterClient, jupiterClient } from './services/solana-engine/jupiter-client.js';

async function main() {
  try {
    console.log('Starting Jupiter client debug...');
    
    // Initialize the client
    console.log('Jupiter client initialization starting...');
    await jupiterClient.initialize();
    console.log('Jupiter client initialized:', jupiterClient.initialized);
    
    // Check token list
    console.log('\nToken list debug:');
    console.log('- tokenList type:', typeof jupiterClient.tokenList);
    console.log('- tokenList is array:', Array.isArray(jupiterClient.tokenList));
    console.log('- tokenList length property:', jupiterClient.tokenList?.length);
    console.log('- tokenList sample:', jupiterClient.tokenList?.slice(0, 2));
    
    // Test SOL price fetch
    const solMint = 'So11111111111111111111111111111111111111112';
    const mintAddresses = [solMint];
    
    console.log('\nPrice fetch debug:');
    console.log('- mintAddresses:', mintAddresses);
    console.log('- mintAddresses type:', typeof mintAddresses);
    console.log('- mintAddresses is array:', Array.isArray(mintAddresses));
    console.log('- mintAddresses length:', mintAddresses.length);
    
    console.log('\nFetching SOL price...');
    const prices = await jupiterClient.getPrices(mintAddresses);
    
    console.log('\nPrice results:');
    console.log('- prices object:', prices);
    console.log('- SOL price:', prices[solMint]?.price || 'Not found');
    
    console.log('\nDebug complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error in debug script:', error);
    process.exit(1);
  }
}

main();