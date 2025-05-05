// tests/services/jupiter-client-enhanced.test.js

/**
 * Enhanced test file for the JupiterClient service
 * This tests both the old and new implementations with larger batches
 */

import { jupiterClient } from '../../services/solana-engine/jupiter-client.js';
import { logApi } from '../../utils/logger-suite/logger.js';

// Sample token addresses for basic testing
const SAMPLE_TOKENS = [
  // SOL
  'So11111111111111111111111111111111111111112',
  // USDC
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  // BONK
  '4iV48KQ4vdnYPBHfChgf6mr7eY3qpCrDRNReZGuYwtrF',
  // JUP
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  // WIF 
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'
];

/**
 * Enhanced test function for the JupiterClient
 * Tests the client with a larger batch of 30 tokens
 */
async function testJupiterClientEnhanced() {
  try {
    logApi.info('Starting Jupiter Client enhanced batch test...');
    
    // Ensure client is initialized
    if (!jupiterClient.initialized) {
      await jupiterClient.initialize();
    }
    
    // Extract 30 random tokens from the token list for batch testing
    const getRandomTokens = (tokenList, count) => {
      if (!tokenList || !Array.isArray(tokenList) || tokenList.length === 0) {
        // If we don't have a valid token list, use our sample tokens
        return SAMPLE_TOKENS.slice(0, count);
      }
      
      // Filter for tokens that have a valid address (Jupiter tokens are already addresses)
      let addresses = [];
      
      // Check if the token list is already an array of addresses
      if (typeof tokenList[0] === 'string') {
        addresses = [...tokenList];
      } else if (tokenList[0] && tokenList[0].address) {
        // It's an array of objects with address property
        addresses = tokenList
          .filter(token => token && token.address)
          .map(token => token.address);
      } else {
        // If we can't extract addresses, use our sample tokens
        return SAMPLE_TOKENS.slice(0, count);
      }
      
      // If we have enough addresses, randomly select 'count' of them
      if (addresses.length >= count) {
        const selectedTokens = [];
        const maxIndex = addresses.length - 1;
        
        for (let i = 0; i < count; i++) {
          const randomIndex = Math.floor(Math.random() * maxIndex);
          selectedTokens.push(addresses[randomIndex]);
        }
        
        return selectedTokens;
      } else {
        // If we don't have enough addresses, return what we have
        return [...addresses, ...SAMPLE_TOKENS].slice(0, count);
      }
    };
    
    // Get 30 random tokens from the token list
    const BATCH_SIZE = 30;
    const randomTokens = getRandomTokens(jupiterClient.tokenList, BATCH_SIZE);
    
    logApi.info(`Selected ${randomTokens.length} random tokens for batch testing`);
    
    // Test batch price fetching
    logApi.info(`Testing batch price fetching with ${randomTokens.length} tokens...`);
    const startTime = Date.now();
    const batchPrices = await jupiterClient.getPrices(randomTokens);
    const batchTime = Date.now() - startTime;
    
    // Analyze batch results
    const priceKeys = Object.keys(batchPrices);
    const successRate = (priceKeys.length / randomTokens.length) * 100;
    
    logApi.info(`Batch price fetch returned ${priceKeys.length}/${randomTokens.length} prices (${successRate.toFixed(1)}% success rate)`);
    logApi.info(`Batch operation took ${batchTime}ms (${(batchTime / randomTokens.length).toFixed(2)}ms per token)`);
    
    // Test subscription
    logApi.info(`Testing subscription with ${randomTokens.length} tokens...`);
    const subscriptionStart = Date.now();
    const subResult = await jupiterClient.subscribeToPrices(randomTokens);
    const subscriptionTime = Date.now() - subscriptionStart;
    
    logApi.info(`Subscription result: ${subResult}`);
    logApi.info(`Subscription operation took ${subscriptionTime}ms (${(subscriptionTime / randomTokens.length).toFixed(2)}ms per token)`);
    
    // Test batching efficiency by breaking into chunks
    logApi.info('\nTesting batching efficiency with different batch sizes...');
    
    const testBatchSize = async (tokens, batchSize) => {
      // Break tokens into chunks
      const chunks = [];
      for (let i = 0; i < tokens.length; i += batchSize) {
        chunks.push(tokens.slice(i, i + batchSize));
      }
      
      const startTime = Date.now();
      
      // Process each chunk
      let totalPrices = 0;
      for (const chunk of chunks) {
        const prices = await jupiterClient.getPrices(chunk);
        totalPrices += Object.keys(prices).length;
      }
      
      const totalTime = Date.now() - startTime;
      
      return {
        batchSize,
        chunks: chunks.length,
        totalTokens: tokens.length,
        pricesReturned: totalPrices,
        totalTime,
        timePerToken: totalTime / tokens.length,
        timePerChunk: totalTime / chunks.length
      };
    };
    
    // Test with different batch sizes
    const batch5Results = await testBatchSize(randomTokens, 5);
    const batch10Results = await testBatchSize(randomTokens, 10);
    const batch30Results = await testBatchSize(randomTokens, 30);
    
    logApi.info(`Batch size 5: ${batch5Results.chunks} chunks, ${batch5Results.totalTime}ms total, ${batch5Results.timePerToken.toFixed(2)}ms per token`);
    logApi.info(`Batch size 10: ${batch10Results.chunks} chunks, ${batch10Results.totalTime}ms total, ${batch10Results.timePerToken.toFixed(2)}ms per token`);
    logApi.info(`Batch size 30: ${batch30Results.chunks} chunks, ${batch30Results.totalTime}ms total, ${batch30Results.timePerToken.toFixed(2)}ms per token`);
    
    // Test memory efficiency by doing multiple batch operations in sequence
    logApi.info('\nTesting memory efficiency with multiple sequential operations...');
    
    // Do 3 batch operations in sequence and measure if performance degrades
    const batchResults = [];
    
    for (let i = 0; i < 3; i++) {
      const startTime = Date.now();
      const prices = await jupiterClient.getPrices(randomTokens);
      const endTime = Date.now();
      
      batchResults.push({
        iteration: i + 1,
        tokenCount: randomTokens.length,
        pricesCount: Object.keys(prices).length,
        time: endTime - startTime,
        timePerToken: (endTime - startTime) / randomTokens.length
      });
      
      logApi.info(`Batch operation ${i + 1}: ${endTime - startTime}ms total, ${((endTime - startTime) / randomTokens.length).toFixed(2)}ms per token`);
    }
    
    // Check for performance degradation
    const firstBatchTime = batchResults[0].time;
    const lastBatchTime = batchResults[batchResults.length - 1].time;
    const degradation = ((lastBatchTime - firstBatchTime) / firstBatchTime) * 100;
    
    logApi.info(`Performance trend across sequential batches: ${degradation > 0 ? '+' : ''}${degradation.toFixed(1)}% change from first to last batch`);
    
    // Return test results
    return {
      success: true,
      mainBatchTest: {
        batchSize: randomTokens.length,
        pricesReturned: priceKeys.length,
        successRate: `${successRate.toFixed(1)}%`,
        totalTime: batchTime,
        timePerToken: parseFloat((batchTime / randomTokens.length).toFixed(2))
      },
      batchSizeTests: {
        batch5: batch5Results,
        batch10: batch10Results,
        batch30: batch30Results
      },
      sequentialBatchTests: batchResults,
      performanceTrend: `${degradation > 0 ? '+' : ''}${degradation.toFixed(1)}%`
    };
  } catch (error) {
    logApi.error(`Error in Jupiter Client enhanced test: ${error.message}`);
    logApi.error(error.stack);
    return {
      success: false,
      error: error.message
    };
  }
}

// Self-executing function to run the test
(async () => {
  logApi.info('Starting JupiterClient enhanced batch tests...');
  const result = await testJupiterClientEnhanced();
  logApi.info(`Enhanced test result: ${result.success ? 'SUCCESS' : 'FAILURE'}`);
  logApi.info(JSON.stringify(result, null, 2));
})();

export default testJupiterClientEnhanced;