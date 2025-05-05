// tests/enhanced-dexscreener-test.js

// Logger
import { logApi } from '../utils/logger-suite/logger.js';
logApi.info('Starting Enhanced DexScreener Test');

// Test script to validate the enhanced DexScreenerCollector
import dexScreenerCollector from '../services/token-enrichment/collectors/dexScreenerCollector.js';

// Use shorter timeout for the test
const TEST_TIMEOUT = 15000; // 15 seconds max

// Check what API endpoint we're using
const API_ENDPOINT = dexScreenerCollector.apiBaseUrl;
console.log(`Using DexScreener API endpoint: ${API_ENDPOINT}`);

// Format currency amounts for better readability
function formatCurrency(amount) {
  if (!amount && amount !== 0) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
}

// Main test function for a single token
async function testEnhancedDexScreenerCollector(tokenAddress) {
  console.log(`\n======== Testing Enhanced DexScreener Collector for Token: ${tokenAddress} ========\n`);
  
  try {
    // Get token data using the collector
    console.log(`Fetching data for token ${tokenAddress}...`);
    
    // Fetch from dexscreener with timeout to avoid hanging
    const tokenDataPromise = dexScreenerCollector.getTokenByAddress(tokenAddress);
    
    // Set a timeout to avoid hanging indefinitely
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('API request timed out')), TEST_TIMEOUT);
    });
    
    // Race the token data promise against the timeout
    const tokenData = await Promise.race([tokenDataPromise, timeoutPromise])
      .catch(error => {
        console.error(`Error fetching token data: ${error.message}`);
        return null;
      });
    
    // Handle the case where no data is returned
    if (!tokenData) {
      console.log('No dexscreener data found for this token');
      return;
    }
    
    console.log(`Successfully fetched dexscreener data for token ${tokenAddress}\n`);
    
    // Basic token info
    console.log('BASIC TOKEN INFO:');
    console.log(`- Name: ${tokenData.name || 'N/A'}`);
    console.log(`- Symbol: ${tokenData.symbol || 'N/A'}`);
    console.log(`- Address: ${tokenData.address || 'N/A'}`);
    console.log(`- Price: ${tokenData.price || 'N/A'}`);
    console.log('');
    
    // Enhanced metadata
    console.log('ENHANCED METADATA:');
    if (tokenData.metadata) {
      console.log(`- Image URL: ${tokenData.metadata.imageUrl || 'N/A'}`);
      console.log(`- Header URL: ${tokenData.metadata.headerUrl || 'N/A'}`);
      console.log(`- OpenGraph URL: ${tokenData.metadata.openGraphUrl || 'N/A'}`);
      console.log(`- Description: ${tokenData.metadata.description || 'N/A'}`);
    } else {
      console.log('No enhanced metadata available');
    }
    console.log('');
    
    // Social links
    console.log('SOCIAL LINKS:');
    if (tokenData.socials && Object.keys(tokenData.socials).length > 0) {
      for (const [platform, url] of Object.entries(tokenData.socials)) {
        console.log(`- ${platform}: ${url}`);
      }
    } else {
      console.log('No social links available');
    }
    console.log('');
    
    // Websites
    console.log('WEBSITES:');
    if (tokenData.websites && tokenData.websites.length > 0) {
      tokenData.websites.forEach((website, index) => {
        console.log(`- ${website.label}: ${website.url}`);
      });
    } else {
      console.log('No websites available');
    }
    console.log('');
    
    // Market metrics
    console.log('MARKET METRICS:');
    console.log(`- Price: $${tokenData.price || 'N/A'}`);
    console.log(`- Price Change 24h: ${tokenData.priceChange?.h24 || tokenData.priceChange24h || 'N/A'}%`);
    console.log(`- Volume 24h: ${formatCurrency(tokenData.volume?.h24 || tokenData.volume24h || 0)}`);
    console.log(`- Liquidity: ${formatCurrency(tokenData.liquidity?.usd || tokenData.liquidity || 0)}`);
    console.log(`- Market Cap: ${formatCurrency(tokenData.marketCap || 0)}`);
    console.log(`- FDV: ${formatCurrency(tokenData.fdv || 0)}`);
    console.log('');
    
    // Detailed price changes
    console.log('DETAILED PRICE CHANGES:');
    if (tokenData.priceChange) {
      console.log(`- 5m: ${tokenData.priceChange.m5 || 'N/A'}%`);
      console.log(`- 1h: ${tokenData.priceChange.h1 || 'N/A'}%`);
      console.log(`- 6h: ${tokenData.priceChange.h6 || 'N/A'}%`);
      console.log(`- 24h: ${tokenData.priceChange.h24 || 'N/A'}%`);
    } else {
      console.log('No detailed price changes available');
    }
    console.log('');
    
    // Detailed volume
    console.log('DETAILED VOLUME:');
    if (tokenData.volume) {
      console.log(`- 5m: ${formatCurrency(tokenData.volume.m5 || 0)}`);
      console.log(`- 1h: ${formatCurrency(tokenData.volume.h1 || 0)}`);
      console.log(`- 6h: ${formatCurrency(tokenData.volume.h6 || 0)}`);
      console.log(`- 24h: ${formatCurrency(tokenData.volume.h24 || 0)}`);
    } else {
      console.log('No detailed volume data available');
    }
    console.log('');
    
    // Detailed transactions
    console.log('DETAILED TRANSACTIONS:');
    if (tokenData.txns) {
      console.log(`- 5m: ${tokenData.txns.m5?.buys || 0} buys, ${tokenData.txns.m5?.sells || 0} sells`);
      console.log(`- 1h: ${tokenData.txns.h1?.buys || 0} buys, ${tokenData.txns.h1?.sells || 0} sells`);
      console.log(`- 6h: ${tokenData.txns.h6?.buys || 0} buys, ${tokenData.txns.h6?.sells || 0} sells`);
      console.log(`- 24h: ${tokenData.txns.h24?.buys || 0} buys, ${tokenData.txns.h24?.sells || 0} sells`);
    } else {
      console.log('No detailed transaction data available');
    }
    console.log('');
    
    // Available pools
    if (tokenData.pools && tokenData.pools.length > 0) {
      console.log(`AVAILABLE POOLS (${tokenData.pools.length}):`);
      tokenData.pools.forEach((pool, index) => {
        console.log(`${index + 1}. ${pool.name} - Liquidity: ${formatCurrency(pool.liquidity || 0)}`);
      });
    } else {
      console.log('No pool data available');
    }
    
    // Additional data
    console.log('\nADDITIONAL DATA:');
    console.log(`- Pair Creation Date: ${tokenData.pairCreatedAt || 'N/A'}`);
    console.log(`- Boosts: ${tokenData.boosts ? JSON.stringify(tokenData.boosts) : 'N/A'}`);
    
    // Raw data for debugging
    console.log('\nFULL TOKEN DATA (for debugging):');
    console.log(JSON.stringify(tokenData, null, 2));
    
  } catch (error) {
    console.error('Error in test:', error);
  }
}

// Function to test the batch lookup capability
async function testBatchTokenLookup() {
  console.log('\n======== Testing DexScreener Batch Token Lookup ========\n');
  
  try {
    // First, get token addresses using search endpoint
    console.log('Fetching token addresses from search endpoint...');
    const axios = (await import('axios')).default;
    const searchResponse = await axios.get(`${API_ENDPOINT}/search?q=solana&chain=solana`);
    
    if (!searchResponse.data?.pairs || searchResponse.data.pairs.length === 0) {
      console.log('No tokens found in search results');
      return;
    }
    
    // Extract unique token addresses (up to 30)
    const tokenAddresses = [...new Set(
      searchResponse.data.pairs
        .filter(pair => pair.baseToken?.address)
        .map(pair => pair.baseToken.address)
    )].slice(0, 30);
    
    console.log(`Found ${tokenAddresses.length} unique token addresses from search:`);
    tokenAddresses.forEach((address, index) => {
      console.log(`${index + 1}. ${address}`);
    });
    
    // Using batch method to fetch data for all tokens at once
    console.log('\nFetching batch data for all tokens...');
    
    // Fetch with timeout to avoid hanging
    const batchDataPromise = dexScreenerCollector.getTokensByAddressBatch(tokenAddresses);
    
    // Set a timeout to avoid hanging indefinitely
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('API request timed out')), TEST_TIMEOUT * 2); // Double timeout for batch
    });
    
    // Race the token data promise against the timeout
    const batchResults = await Promise.race([batchDataPromise, timeoutPromise])
      .catch(error => {
        console.error(`Error fetching batch token data: ${error.message}`);
        return {};
      });
    
    // Check results
    const successCount = Object.keys(batchResults).length;
    console.log(`\nSuccessfully fetched ${successCount}/${tokenAddresses.length} tokens in batch`);
    
    if (successCount > 0) {
      console.log('\nSUMMARY OF BATCH RESULTS:');
      console.log('------------------------');
      
      Object.entries(batchResults).forEach(([address, data], index) => {
        console.log(`${index + 1}. Token: ${data.name} (${data.symbol})`);
        console.log(`   Price: $${data.price || 'N/A'}`);
        console.log(`   Liquidity: ${formatCurrency(data.liquidity?.usd || data.liquidity || 0)}`);
        console.log(`   24h Volume: ${formatCurrency(data.volume?.h24 || data.volume24h || 0)}`);
        console.log(`   Social links: ${Object.keys(data.socials || {}).length}`);
        console.log('------------------------');
      });
      
      console.log('\nPerformance metrics:');
      console.log(`- Tokens requested: ${tokenAddresses.length}`);
      console.log(`- Tokens returned: ${successCount}`);
      console.log(`- Success rate: ${Math.round((successCount / tokenAddresses.length) * 100)}%`);
    } else {
      console.log('No tokens were successfully fetched in batch');
    }
    
  } catch (error) {
    console.error('Error in batch test:', error);
  }
}

// Default to a well-known Solana token that we've verified to exist in DexScreener
const tokenAddress = process.argv[2] || 'QBHfcFDHfHj8qKPwEbv4gb2irQugJrhfW9ddxwgboop'; // "Most Viewed Cat on Tiktok" token 

// Simple verification that API access is working
const verifyEndpoint = async () => {
  try {
    const axios = (await import('axios')).default;
    const response = await axios.get(`${API_ENDPOINT}/search?q=solana&chain=solana`);
    if (response.status === 200 && response.data?.pairs?.length > 0) {
      console.log(`\n✅ API access verified - Found ${response.data.pairs.length} pairs for 'solana'`);
      return true;
    } else {
      console.log(`\n⚠️ API responded with status ${response.status} but returned no pairs`);
      return false;
    }
  } catch (error) {
    console.error(`\n❌ Failed to access API: ${error.message}`);
    return false;
  }
};

// Run verification, then single token test, then batch test
async function runAllTests() {
  console.log('Running enhanced DexScreener tests...');
  
  // First verify API connectivity
  const apiVerified = await verifyEndpoint();
  if (!apiVerified) {
    console.error('API verification failed, aborting tests');
    return;
  }
  
  // Run single token test
  await testEnhancedDexScreenerCollector(tokenAddress);
  
  // Run batch token test
  await testBatchTokenLookup();
  
  console.log('\nAll tests completed');
}

// Run all tests and ensure we exit properly
runAllTests()
  .catch(error => {
    console.error('Test suite error:', error);
  })
  .finally(() => {
    console.log('\nTest suite completed - exiting to prevent hanging connections');
    // Force exit after test is done
    setTimeout(() => process.exit(0), 500);
  });