// Test script to show how DexScreener pools are sorted by liquidity
import { dexscreenerClient } from '../services/solana-engine/dexscreener-client.js';

// Format currency amounts for better readability
function formatCurrency(amount) {
  if (!amount) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
}

// Main test function
async function testDexScreenerPoolSorting(tokenAddress) {
  console.log(`\n======== Testing DexScreener Pool Sorting for Token: ${tokenAddress} ========\n`);
  
  try {
    // Initialize the DexScreener client (normally this would happen at service startup)
    console.log('Initializing DexScreener client...');
    const ready = await dexscreenerClient.initialize();
    if (!ready) {
      console.error('Failed to initialize DexScreener client');
      return;
    }
    console.log('DexScreener client initialized successfully\n');
    
    // Fetch pools for the token
    console.log(`Fetching pools for token ${tokenAddress}...`);
    const poolData = await dexscreenerClient.getTokenPools('solana', tokenAddress);
    
    if (!poolData || !poolData.pairs || poolData.pairs.length === 0) {
      console.log('No pools found for this token');
      return;
    }
    
    console.log(`Found ${poolData.pairs.length} pools for token ${tokenAddress}\n`);
    
    // Log token information
    if (poolData.pairs.length > 0) {
      const samplePool = poolData.pairs[0];
      console.log(`Token Info:`);
      console.log(`- Name: ${poolData.schemaVersion === '1.0.0' ? samplePool.baseToken?.name : 'N/A'}`);
      console.log(`- Symbol: ${poolData.schemaVersion === '1.0.0' ? samplePool.baseToken?.symbol : 'N/A'}`);
      console.log(`- Current Price: ${samplePool.priceUsd || 'N/A'}`);
      console.log('');
    }
    
    // Show unsorted pools
    console.log('UNSORTED POOLS (original order from API):');
    poolData.pairs.forEach((pool, index) => {
      console.log(`${index + 1}. ${pool.dexId} - Liquidity: ${formatCurrency(pool.liquidity?.usd || 0)} - Volume 24h: ${formatCurrency(pool.volume?.h24 || 0)}`);
    });
    
    console.log('\nSORTING POOLS BY LIQUIDITY (highest first)...\n');
    
    // Sort pools by liquidity
    const sortedPools = [...poolData.pairs].sort((a, b) => {
      const liquidityA = parseFloat(a.liquidity?.usd || '0');
      const liquidityB = parseFloat(b.liquidity?.usd || '0');
      return liquidityB - liquidityA;
    });
    
    // Show sorted pools
    console.log('SORTED POOLS (by liquidity, highest first):');
    sortedPools.forEach((pool, index) => {
      console.log(`${index + 1}. ${pool.dexId} - Liquidity: ${formatCurrency(pool.liquidity?.usd || 0)} - Volume 24h: ${formatCurrency(pool.volume?.h24 || 0)}`);
    });
    
    // Examine top pool in more detail
    if (sortedPools.length > 0) {
      const topPool = sortedPools[0];
      console.log('\nTOP POOL DETAILS:');
      console.log(`- DEX: ${topPool.dexId}`);
      console.log(`- Pair: ${topPool.pairAddress}`);
      console.log(`- Price USD: ${topPool.priceUsd || 'N/A'}`);
      console.log(`- Liquidity USD: ${formatCurrency(topPool.liquidity?.usd || 0)}`);
      console.log(`- Volume 24h: ${formatCurrency(topPool.volume?.h24 || 0)}`);
      console.log(`- Volume 6h: ${formatCurrency(topPool.volume?.h6 || 0)}`);
      console.log(`- Volume 1h: ${formatCurrency(topPool.volume?.h1 || 0)}`);
      console.log(`- Price Change 24h: ${topPool.priceChange?.h24 ? `${topPool.priceChange.h24}%` : 'N/A'}`);
      console.log(`- Price Change 6h: ${topPool.priceChange?.h6 ? `${topPool.priceChange.h6}%` : 'N/A'}`);
      console.log(`- Price Change 1h: ${topPool.priceChange?.h1 ? `${topPool.priceChange.h1}%` : 'N/A'}`);
      console.log(`- Market Cap: ${formatCurrency(topPool.marketCap || 0)}`);
      console.log(`- FDV: ${formatCurrency(topPool.fdv || 0)}`);
      
      // Show what metrics we'd actually use in our enhanced data
      console.log('\nMetrics that would be stored in enhanced token data:');
      const enhancedMetrics = {
        volume_24h: topPool.volume?.h24,
        volume_6h: topPool.volume?.h6,
        volume_1h: topPool.volume?.h1,
        volume_5m: topPool.volume?.m5,
        change_24h: topPool.priceChange?.h24,
        change_6h: topPool.priceChange?.h6,
        change_1h: topPool.priceChange?.h1,
        change_5m: topPool.priceChange?.m5,
        liquidity: topPool.liquidity?.usd,
        market_cap: topPool.marketCap,
        fdv: topPool.fdv,
        dex: topPool.dexId,
        pair_address: topPool.pairAddress
      };
      
      console.log(JSON.stringify(enhancedMetrics, null, 2));
    }
  } catch (error) {
    console.error('Error in test:', error.message);
  }
}

// Run the test
const tokenAddress = process.argv[2] || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // Default to USDC if no token provided
testDexScreenerPoolSorting(tokenAddress);