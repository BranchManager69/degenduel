// tests/pool-sorter-test.js
// Shows how pools are sorted by liquidity for a specific token

import { logApi } from '../utils/logger-suite/logger.js';
import { dexscreenerClient } from '../services/solana-engine/dexscreener-client.js';

// Target token address
const TOKEN_ADDRESS = process.argv[2] || "38PgzpJYu2HkiYvV8qePFakB8tuobPdGm2FFEn7Dpump";
//const TOKEN_ADDRESS = process.argv[2] || "DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump";

// Format currency for display
function formatCurrency(amount) {
  if (!amount) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', 
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(amount);
}

/**
 * Demonstrate pool sorting by liquidity
 */
async function demonstratePoolSorting() {
  try {
    console.log('\n======= POOL SORTING DEMONSTRATION =======');
    console.log(`Token: ${TOKEN_ADDRESS}`);
    
    // Get pools for token
    const poolsData = await dexscreenerClient.getTokenPools('solana', TOKEN_ADDRESS);
    
    if (!Array.isArray(poolsData) || poolsData.length === 0) {
      console.log('No pools found for this token');
      process.exit(0);
    }
    
    console.log(`\nFound ${poolsData.length} pools for token ${poolsData[0].baseToken?.symbol || TOKEN_ADDRESS}`);
    
    // Basic token info from first pool
    const firstPool = poolsData[0];
    console.log(`\nToken Info:`);
    console.log(`Name: ${firstPool.baseToken?.name || 'Unknown'}`);
    console.log(`Symbol: ${firstPool.baseToken?.symbol || 'Unknown'}`);
    console.log(`Current price: ${firstPool.priceUsd ? '$' + firstPool.priceUsd : 'Unknown'}`);
    
    // Show liquidity for each pool (unsorted)
    console.log('\nUNSORTED POOLS (original order from API):');
    console.log('===========================================');
    poolsData.forEach((pool, index) => {
      console.log(`${index + 1}. ${pool.dexId.padEnd(15)} - Liquidity: ${formatCurrency(pool.liquidity?.usd || 0).padEnd(15)} - Volume 24h: ${formatCurrency(pool.volume?.h24 || 0)}`);
    });
    
    // Sort pools by liquidity
    console.log('\nSORTING POOLS BY LIQUIDITY (highest first)...');
    const sortedPools = [...poolsData].sort((a, b) => {
      const liquidityA = parseFloat(a.liquidity?.usd || '0');
      const liquidityB = parseFloat(b.liquidity?.usd || '0');
      return liquidityB - liquidityA; // Sort highest to lowest
    });
    
    // Show sorted pools
    console.log('\nSORTED POOLS (by liquidity, highest first):');
    console.log('===========================================');
    sortedPools.forEach((pool, index) => {
      console.log(`${index + 1}. ${pool.dexId.padEnd(15)} - Liquidity: ${formatCurrency(pool.liquidity?.usd || 0).padEnd(15)} - Volume 24h: ${formatCurrency(pool.volume?.h24 || 0)}`);
    });
    
    // Top 3 pools by liquidity
    console.log('\nTOP 3 POOLS BY LIQUIDITY:');
    console.log('=========================');
    sortedPools.slice(0, 3).forEach((pool, index) => {
      console.log(`${index + 1}. ${pool.dexId.padEnd(15)} - Liquidity: ${formatCurrency(pool.liquidity?.usd || 0)}`);
    });
    
    // Detailed metrics of top pool
    if (sortedPools.length > 0) {
      const topPool = sortedPools[0];
      
      console.log('\nDETAILED METRICS FOR TOP POOL:');
      console.log('==============================');
      console.log(`DEX: ${topPool.dexId}`);
      console.log(`Pair: ${topPool.baseToken?.symbol || 'Unknown'}/${topPool.quoteToken?.symbol || 'Unknown'}`);
      console.log(`Pair Address: ${topPool.pairAddress}`);
      console.log(`Price: $${topPool.priceUsd || 'Unknown'}`);
      console.log(`Liquidity: ${formatCurrency(topPool.liquidity?.usd || 0)}`);
      console.log(`Volume 24h: ${formatCurrency(topPool.volume?.h24 || 0)}`);
      console.log(`Volume 6h: ${formatCurrency(topPool.volume?.h6 || 0)}`);
      console.log(`Volume 1h: ${formatCurrency(topPool.volume?.h1 || 0)}`);
      console.log(`Volume 5m: ${formatCurrency(topPool.volume?.m5 || 0)}`);
      console.log(`Price change 24h: ${topPool.priceChange?.h24 ? topPool.priceChange.h24 + '%' : 'N/A'}`);
      console.log(`Price change 6h: ${topPool.priceChange?.h6 ? topPool.priceChange.h6 + '%' : 'N/A'}`);
      console.log(`Price change 1h: ${topPool.priceChange?.h1 ? topPool.priceChange.h1 + '%' : 'N/A'}`);
      console.log(`Price change 5m: ${topPool.priceChange?.m5 ? topPool.priceChange.m5 + '%' : 'N/A'}`);
      console.log(`Market Cap: ${formatCurrency(topPool.marketCap || 0)}`);
      
      // Show how we extract the metrics for our DB
      console.log('\nACTUAL DATA STORED IN ENHANCED TOKEN DATA:');
      console.log('========================================');
      const safeParseFloat = (val) => {
        if (!val) return null;
        try {
          const parsed = parseFloat(val);
          if (isNaN(parsed) || !isFinite(parsed)) return null;
          return parsed.toString();
        } catch (e) {
          return null;
        }
      };
      
      const enhancedMetrics = {
        volume_24h: safeParseFloat(topPool.volume?.h24),
        volume_6h: safeParseFloat(topPool.volume?.h6),
        volume_1h: safeParseFloat(topPool.volume?.h1),
        volume_5m: safeParseFloat(topPool.volume?.m5),
        change_24h: safeParseFloat(topPool.priceChange?.h24),
        change_6h: safeParseFloat(topPool.priceChange?.h6),
        change_1h: safeParseFloat(topPool.priceChange?.h1),
        change_5m: safeParseFloat(topPool.priceChange?.m5),
        liquidity: safeParseFloat(topPool.liquidity?.usd),
        market_cap: safeParseFloat(topPool.marketCap),
        fdv: safeParseFloat(topPool.fdv),
        dex: topPool.dexId,
        pair_address: topPool.pairAddress
      };
      
      console.log(JSON.stringify(enhancedMetrics, null, 2));
    }
    
    console.log('\n============ DEMONSTRATION COMPLETE ============');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    process.exit(0);
  }
}

// Run the demonstration
demonstratePoolSorting();