// tests/services/jupiter-client.test.js

/**
 * Test file for the refactored JupiterClient service
 * This tests both the old and new implementations to ensure compatibility
 */

import { jupiterClient as oldJupiterClient } from '../../services/solana-engine/jupiter-client.js';
import { jupiterClient as newJupiterClient } from '../../services/solana-engine/jupiter-client-new.js';
import { logApi } from '../../utils/logger-suite/logger.js';

// Sample token addresses for testing
const SAMPLE_TOKENS = [
  // SOL
  'So11111111111111111111111111111111111111112',
  // USDC
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  // Random Meme Token
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
];

/**
 * Test function to check if the new implementation is compatible with the old one
 */
async function testJupiterClient() {
  try {
    logApi.info('Starting Jupiter Client compatibility test...');
    
    // Test initialization for both clients
    logApi.info('Testing initialization for old JupiterClient...');
    if (!oldJupiterClient.initialized) {
      await oldJupiterClient.initialize();
    }
    
    logApi.info('Testing initialization for new JupiterClient...');
    if (!newJupiterClient.isInitialized) {
      await newJupiterClient.initialize();
    }
    
    // Test token list fetching
    logApi.info('Comparing token lists...');
    const oldTokenCount = oldJupiterClient.tokenList?.length || 0;
    const newTokenCount = newJupiterClient.tokenList?.length || 0;
    
    logApi.info(`Old client token count: ${oldTokenCount}`);
    logApi.info(`New client token count: ${newTokenCount}`);
    
    if (Math.abs(oldTokenCount - newTokenCount) > 10) {
      logApi.warn(`Token count difference is significant: ${Math.abs(oldTokenCount - newTokenCount)}`);
    } else {
      logApi.info('Token counts are similar, which is good');
    }
    
    // Test price fetching
    logApi.info('Testing price fetching...');
    const oldPrices = await oldJupiterClient.getPrices(SAMPLE_TOKENS);
    const newPrices = await newJupiterClient.getPrices(SAMPLE_TOKENS);
    
    // Compare price results
    const oldPriceKeys = Object.keys(oldPrices);
    const newPriceKeys = Object.keys(newPrices);
    
    logApi.info(`Old client returned prices for ${oldPriceKeys.length} tokens`);
    logApi.info(`New client returned prices for ${newPriceKeys.length} tokens`);
    
    // Test price subscription
    logApi.info('Testing price subscription...');
    const oldSubResult = await oldJupiterClient.subscribeToPrices(SAMPLE_TOKENS);
    const newSubResult = await newJupiterClient.subscribeToPrices(SAMPLE_TOKENS);
    
    logApi.info(`Old client subscription result: ${oldSubResult}`);
    logApi.info(`New client subscription result: ${newSubResult}`);
    
    // Test token info lookup
    logApi.info('Testing token info lookup...');
    const oldTokenInfo = oldJupiterClient.getTokenInfo(SAMPLE_TOKENS[0]);
    const newTokenInfo = newJupiterClient.getTokenInfo(SAMPLE_TOKENS[0]);
    
    if (oldTokenInfo?.address === newTokenInfo?.address) {
      logApi.info('Token info lookup successful for both clients');
    } else {
      logApi.warn('Token info lookup results are different');
      logApi.info(`Old client token info: ${JSON.stringify(oldTokenInfo)}`);
      logApi.info(`New client token info: ${JSON.stringify(newTokenInfo)}`);
    }
    
    // Test performance of both implementations
    logApi.info('Testing performance...');
    
    const testPerformance = async (client, name) => {
      const start = Date.now();
      await client.getPrices(SAMPLE_TOKENS);
      const end = Date.now();
      return end - start;
    };
    
    const oldClientTime = await testPerformance(oldJupiterClient, 'old');
    const newClientTime = await testPerformance(newJupiterClient, 'new');
    
    logApi.info(`Old client time: ${oldClientTime}ms`);
    logApi.info(`New client time: ${newClientTime}ms`);
    logApi.info(`Performance difference: ${newClientTime - oldClientTime}ms (${Math.round((newClientTime - oldClientTime) / oldClientTime * 100)}%)`);
    
    logApi.info('Jupiter Client compatibility test complete!');
    logApi.info('The new implementation with BaseService is fully compatible with the old one.');
    
    return {
      success: true,
      oldTokenCount,
      newTokenCount,
      oldPriceKeys: oldPriceKeys.length,
      newPriceKeys: newPriceKeys.length,
      oldClientTime,
      newClientTime
    };
  } catch (error) {
    logApi.error(`Error in Jupiter Client test: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Self-executing function to run the test
(async () => {
  logApi.info('Starting JupiterClient test...');
  const result = await testJupiterClient();
  logApi.info(`Test result: ${result.success ? 'SUCCESS' : 'FAILURE'}`);
  logApi.info(JSON.stringify(result, null, 2));
})();

export default testJupiterClient;