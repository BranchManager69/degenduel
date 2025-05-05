// tests/services/dexscreener-collector.test.js

/**
 * Test file for the DexScreenerCollector service
 * This tests various batch sizes and search functionality
 */

import dexScreenerCollector from '../../services/token-enrichment/collectors/dexScreenerCollector.js';
import { logApi } from '../../utils/logger-suite/logger.js';

// Sample token addresses for testing
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
 * Test DexScreener API access and token retrieval
 */
async function testBasicFunctionality() {
  try {
    logApi.info('Testing DexScreener API access...');
    
    // Test search functionality first
    const searchQuery = 'solana';
    logApi.info(`Testing DexScreener API endpoint: https://api.dexscreener.com/latest/dex`);
    const searchResults = await dexScreenerCollector.searchTokens(searchQuery);
    
    if (searchResults && searchResults.length > 0) {
      logApi.info(`✅ API access verified - Found ${searchResults.length} pairs for '${searchQuery}'`);
    } else {
      logApi.warn(`⚠️ No search results found for '${searchQuery}'`);
    }
    
    // Test single token retrieval
    const singleToken = SAMPLE_TOKENS[0]; // SOL token
    logApi.info(`Testing single token retrieval for ${singleToken}...`);
    const tokenData = await dexScreenerCollector.getTokenByAddress(singleToken);
    
    if (tokenData) {
      logApi.info(`✅ Successfully retrieved data for token: ${tokenData.symbol} (${tokenData.name})`);
      logApi.info(`   Price: $${tokenData.price.toFixed(4)}, 24h Change: ${tokenData.priceChange24h.toFixed(2)}%`);
      logApi.info(`   Volume 24h: $${tokenData.volume24h.toLocaleString()}, Liquidity: $${tokenData.liquidity.usd.toLocaleString()}`);
    } else {
      logApi.warn(`⚠️ Failed to retrieve data for token: ${singleToken}`);
    }
    
    // Test small batch (5 tokens)
    logApi.info(`Testing small batch retrieval (${SAMPLE_TOKENS.length} tokens)...`);
    const startTimeSmall = Date.now();
    const smallBatchResults = await dexScreenerCollector.getTokensByAddressBatch(SAMPLE_TOKENS);
    const smallBatchTime = Date.now() - startTimeSmall;
    
    const smallBatchFound = Object.keys(smallBatchResults).length;
    logApi.info(`✅ Small batch: Retrieved ${smallBatchFound}/${SAMPLE_TOKENS.length} tokens in ${smallBatchTime}ms (${(smallBatchTime/SAMPLE_TOKENS.length).toFixed(2)}ms per token)`);
    
    return {
      success: true,
      apiAccessSuccessful: searchResults && searchResults.length > 0,
      searchResultsCount: searchResults ? searchResults.length : 0,
      singleTokenRetrieval: !!tokenData,
      smallBatchResults: {
        batchSize: SAMPLE_TOKENS.length,
        found: smallBatchFound,
        timeMs: smallBatchTime,
        timePerTokenMs: parseFloat((smallBatchTime/SAMPLE_TOKENS.length).toFixed(2))
      }
    };
  } catch (error) {
    logApi.error(`Error in DexScreener basic test: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Test batch processing with a larger set of tokens
 */
async function testLargeBatch() {
  try {
    logApi.info('\n===== TESTING LARGE BATCH PROCESSING =====\n');
    
    // First get a set of tokens to work with using search
    const searchResults = await dexScreenerCollector.searchTokens('solana');
    if (!searchResults || searchResults.length === 0) {
      throw new Error('Cannot perform batch test - search returned no results');
    }
    
    // Get 30 unique token addresses
    const getLargeBatchTokens = (tokens, count) => {
      const addresses = [];
      const seenAddresses = new Set();
      
      // Filter tokens with addresses and remove duplicates
      for (const token of tokens) {
        if (token.address && !seenAddresses.has(token.address)) {
          addresses.push(token.address);
          seenAddresses.add(token.address);
          
          if (addresses.length >= count) break;
        }
      }
      
      // Add sample tokens to ensure we have enough
      for (const address of SAMPLE_TOKENS) {
        if (!seenAddresses.has(address)) {
          addresses.push(address);
          seenAddresses.add(address);
          
          if (addresses.length >= count) break;
        }
      }
      
      return addresses;
    };
    
    // Create a batch of 30 tokens
    const LARGE_BATCH_SIZE = 30;
    const largeBatchTokens = getLargeBatchTokens(searchResults, LARGE_BATCH_SIZE);
    
    logApi.info(`Created large batch with ${largeBatchTokens.length} tokens`);
    
    // Test batch processing performance
    logApi.info(`Testing large batch retrieval (${largeBatchTokens.length} tokens)...`);
    const startTimeLarge = Date.now();
    const largeBatchResults = await dexScreenerCollector.getTokensByAddressBatch(largeBatchTokens);
    const largeBatchTime = Date.now() - startTimeLarge;
    
    const largeBatchFound = Object.keys(largeBatchResults).length;
    logApi.info(`✅ Large batch: Retrieved ${largeBatchFound}/${largeBatchTokens.length} tokens in ${largeBatchTime}ms (${(largeBatchTime/largeBatchTokens.length).toFixed(2)}ms per token)`);
    
    // Check how many tokens had social links
    const tokensWithSocials = Object.values(largeBatchResults).filter(token => 
      token.socials && (token.socials.website || token.socials.twitter || token.socials.telegram)
    ).length;
    
    logApi.info(`${tokensWithSocials}/${largeBatchFound} tokens had social links`);
    
    // Test retrieving the batch again to check caching performance
    logApi.info('Testing cached batch retrieval...');
    const startTimeCached = Date.now();
    const cachedBatchResults = await dexScreenerCollector.getTokensByAddressBatch(largeBatchTokens);
    const cachedBatchTime = Date.now() - startTimeCached;
    
    const cachedBatchFound = Object.keys(cachedBatchResults).length;
    logApi.info(`✅ Cached batch: Retrieved ${cachedBatchFound}/${largeBatchTokens.length} tokens in ${cachedBatchTime}ms (${(cachedBatchTime/largeBatchTokens.length).toFixed(2)}ms per token)`);
    
    // Cache effectiveness calculation
    const cachingSpeedup = largeBatchTime > 0 ? ((largeBatchTime - cachedBatchTime) / largeBatchTime) * 100 : 0;
    logApi.info(`Cache effectiveness: ${cachingSpeedup.toFixed(1)}% speedup`);
    
    return {
      success: true,
      largeBatchResults: {
        batchSize: largeBatchTokens.length,
        found: largeBatchFound,
        timeMs: largeBatchTime,
        timePerTokenMs: parseFloat((largeBatchTime/largeBatchTokens.length).toFixed(2)),
        tokensWithSocials
      },
      cachedBatchResults: {
        found: cachedBatchFound,
        timeMs: cachedBatchTime,
        timePerTokenMs: parseFloat((cachedBatchTime/largeBatchTokens.length).toFixed(2)),
        cachingSpeedupPercent: parseFloat(cachingSpeedup.toFixed(1))
      }
    };
  } catch (error) {
    logApi.error(`Error in DexScreener large batch test: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Self-executing function to run all tests
(async () => {
  logApi.info('Starting DexScreenerCollector tests...');
  
  // Run basic functionality test
  const basicResults = await testBasicFunctionality();
  logApi.info(`Basic test result: ${basicResults.success ? 'SUCCESS' : 'FAILURE'}`);
  
  // Run large batch test if basic test succeeded
  if (basicResults.success) {
    const batchResults = await testLargeBatch();
    logApi.info(`Large batch test result: ${batchResults.success ? 'SUCCESS' : 'FAILURE'}`);
    
    // Combine results
    const finalResults = {
      basicTest: basicResults,
      largeBatchTest: batchResults,
      overallSuccess: basicResults.success && batchResults.success
    };
    
    logApi.info(`Overall test result: ${finalResults.overallSuccess ? 'SUCCESS' : 'FAILURE'}`);
    logApi.info(JSON.stringify(finalResults, null, 2));
  } else {
    logApi.info(JSON.stringify(basicResults, null, 2));
  }
})();

export default { testBasicFunctionality, testLargeBatch };