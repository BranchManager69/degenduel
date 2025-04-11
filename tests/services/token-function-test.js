/**
 * Token Function Testing Script
 * 
 * This script tests the token function calling capability in the AI service.
 * It validates that the token lookup functions work correctly with real data.
 */

import { handleFunctionCall } from '../../services/ai-service/utils/token-function-handler.js';
import aiService from '../../services/ai-service/ai-service.js';
import prisma from '../../config/prisma.js';

// Test tokens to look up (real tokens on Solana)
const TEST_TOKENS = [
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'BONK', name: 'Bonk' },
  { symbol: 'JUP', name: 'Jupiter' }
];

/**
 * Run the token function handler tests
 */
async function testTokenFunctions() {
  console.log('\n🔍 TESTING TOKEN FUNCTION HANDLER\n');
  
  try {
    // Initialize the AI service
    console.log('Initializing AI service...');
    await aiService.initialize();
    console.log('AI service initialized successfully.');
    
    // Test getTokenPrice function
    console.log('\n1. Testing getTokenPrice function:');
    for (const token of TEST_TOKENS) {
      console.log(`\nLooking up token: ${token.symbol}`);
      
      // Create a function call object
      const functionCall = {
        function: {
          name: 'getTokenPrice',
          arguments: { tokenSymbol: token.symbol }
        }
      };
      
      // Call the function handler
      const result = await handleFunctionCall(functionCall);
      
      if (result.error) {
        console.log(`❌ Error: ${result.error}`);
        continue;
      }
      
      console.log('✅ Success! Token data:');
      console.log(`- Symbol: ${result.symbol}`);
      console.log(`- Name: ${result.name || 'N/A'}`);
      console.log(`- Price: ${result.price || 'N/A'}`);
      console.log(`- 24h Change: ${result.change_24h || 'N/A'}`);
      console.log(`- Market Cap: ${result.market_cap || 'N/A'}`);
      
      // Print all available fields
      console.log('\nAll available fields:');
      Object.entries(result)
        .filter(([key]) => !['social_links', 'tags'].includes(key))
        .forEach(([key, value]) => {
          console.log(`- ${key}: ${value}`);
        });
      
      // Print social links if available
      if (result.social_links && Object.keys(result.social_links).length > 0) {
        console.log('\nSocial Links:');
        Object.entries(result.social_links).forEach(([platform, url]) => {
          console.log(`- ${platform}: ${url}`);
        });
      }
    }
    
    // Test getTokenPriceHistory function
    console.log('\n\n2. Testing getTokenPriceHistory function:');
    const timeframes = ['24h', '7d'];
    
    for (const token of TEST_TOKENS) {
      for (const timeframe of timeframes) {
        console.log(`\nLooking up price history for ${token.symbol} (${timeframe}):`);
        
        // Create a function call object
        const functionCall = {
          function: {
            name: 'getTokenPriceHistory',
            arguments: { 
              tokenSymbol: token.symbol,
              timeframe
            }
          }
        };
        
        // Call the function handler
        const result = await handleFunctionCall(functionCall);
        
        if (result.error) {
          console.log(`❌ Error: ${result.error}`);
          continue;
        }
        
        console.log('✅ Success! History data:');
        console.log(`- Symbol: ${result.symbol}`);
        console.log(`- Timeframe: ${result.timeframe}`);
        console.log(`- Data points: ${result.dataPoints}`);
        
        if (result.history && result.history.length > 0) {
          console.log(`- First point: ${result.history[0].timestamp} -> ${result.history[0].price}`);
          console.log(`- Last point: ${result.history[result.history.length-1].timestamp} -> ${result.history[result.history.length-1].price}`);
        } else {
          console.log('- No history data available');
        }
      }
    }
    
    // Test getTokenPools function
    console.log('\n\n3. Testing getTokenPools function:');
    
    for (const token of TEST_TOKENS) {
      console.log(`\nLooking up pools for ${token.symbol}:`);
      
      // Create a function call object
      const functionCall = {
        function: {
          name: 'getTokenPools',
          arguments: { tokenSymbol: token.symbol }
        }
      };
      
      // Call the function handler
      const result = await handleFunctionCall(functionCall);
      
      if (result.error) {
        console.log(`❌ Error: ${result.error}`);
        continue;
      }
      
      console.log('✅ Success! Pool data:');
      console.log(`- Symbol: ${result.symbol}`);
      console.log(`- Address: ${result.address}`);
      console.log(`- Pool count: ${result.poolCount}`);
      
      if (result.pools && result.pools.length > 0) {
        console.log('\nTop pools:');
        result.pools.forEach((pool, index) => {
          console.log(`${index + 1}. ${pool.dex} - ${pool.pair} (Liquidity: ${pool.liquidity})`);
        });
      } else {
        console.log('- No pool data available');
      }
    }
    
    console.log('\n🎉 TOKEN FUNCTION TESTS COMPLETED\n');
  } catch (error) {
    console.error('❌ Error during token function tests:', error);
  } finally {
    await prisma.$disconnect();
    console.log('Test complete, exiting...');
    process.exit(0);
  }
}

// Run the tests
testTokenFunctions();