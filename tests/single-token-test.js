// tests/single-token-test.js
// Simple test to fetch data for a single token

import { dexscreenerClient } from '../services/solana-engine/dexscreener-client.js';

// Default token address (configurable via command line)
const TOKEN_ADDRESS = process.argv[2] || "DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump";

async function testSingleToken() {
  try {
    console.log(`Testing single token fetch for: ${TOKEN_ADDRESS}`);
    
    // Initialize the client
    console.log('Initializing DexScreener client...');
    if (!dexscreenerClient.initialized) {
      await dexscreenerClient.initialize();
      console.log('Client initialized successfully');
    }
    
    // Wait a moment
    console.log('Waiting 2 seconds before fetching...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Fetch token data
    console.log(`Fetching token data for ${TOKEN_ADDRESS}...`);
    const poolData = await dexscreenerClient.getTokenPools('solana', TOKEN_ADDRESS);
    
    if (!poolData || !Array.isArray(poolData) || poolData.length === 0) {
      console.log('No pools found for this token');
      return;
    }
    
    console.log(`Found ${poolData.length} pools for token`);
    
    // Show info for the first pool
    const firstPool = poolData[0];
    console.log(`\nFirst pool info:`);
    console.log(`DEX: ${firstPool.dexId}`);
    console.log(`Token: ${firstPool.baseToken?.name || 'Unknown'} (${firstPool.baseToken?.symbol || 'Unknown'})`);
    console.log(`Quote Asset: ${firstPool.quoteToken?.symbol || 'Unknown'}`);
    console.log(`Price: $${firstPool.priceUsd || 'Unknown'}`);
    console.log(`Liquidity: $${firstPool.liquidity?.usd || 'Unknown'}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    
    // Check for rate limit errors
    if (error.response && error.response.status === 429) {
      console.log('\nRate limit error detected:');
      console.log('Status:', error.response.status);
      console.log('Headers:', JSON.stringify(error.response.headers, null, 2));
      
      // Check if there's a retry-after header
      const retryAfter = error.response.headers['retry-after'];
      if (retryAfter) {
        console.log(`Retry after: ${retryAfter} seconds`);
      }
    }
    
    process.exit(1);
  }
}

// Run the test
testSingleToken();