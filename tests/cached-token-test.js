// tests/cached-token-test.js
// Attempt to get data from redis cache

import { logApi } from '../utils/logger-suite/logger.js';
import redisManager from '../utils/redis-suite/redis-manager.js';
import { fancyColors } from '../utils/colors.js';

// Default token address (configurable via command line)
const TOKEN_ADDRESS = process.argv[2] || "DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump";

// Format currency for display
function formatCurrency(amount, decimals = 2) {
  if (amount === null || amount === undefined) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: decimals
  }).format(amount);
}

// Format percentage change
function formatPercentage(value) {
  if (value === undefined || value === null) return 'N/A';
  const formatted = Number(value).toFixed(2) + '%';
  return value >= 0 ? `+${formatted}` : formatted;
}

async function testCachedTokenData() {
  try {
    console.log(`\nAttempting to get cached data for token: ${TOKEN_ADDRESS}`);
    
    // Check Redis for cached pool data
    const redisKey = `dexscreener:token:pairs:${TOKEN_ADDRESS}`;
    console.log(`Looking for Redis key: ${redisKey}`);
    
    const cachedData = await redisManager.get(redisKey);
    
    if (!cachedData) {
      console.log(`${fancyColors.RED}No cached data found for this token${fancyColors.RESET}`);
      return;
    }
    
    console.log(`${fancyColors.GREEN}Found cached data!${fancyColors.RESET}`);
    
    // Parse the cached data
    const poolsData = JSON.parse(cachedData);
    
    if (!Array.isArray(poolsData) || poolsData.length === 0) {
      console.log('No pools in cached data');
      return;
    }
    
    console.log(`Found ${poolsData.length} pools in cache for token ${poolsData[0].baseToken?.symbol || TOKEN_ADDRESS}`);
    
    // Sort pools by liquidity
    const sortedPools = [...poolsData].sort((a, b) => {
      const liquidityA = parseFloat(a.liquidity?.usd || '0');
      const liquidityB = parseFloat(b.liquidity?.usd || '0');
      return liquidityB - liquidityA;
    });
    
    // Show top 3 pools by liquidity
    console.log(`\n${fancyColors.BOLD}${fancyColors.CYAN}Top 3 Pools by Liquidity:${fancyColors.RESET}`);
    sortedPools.slice(0, 3).forEach((pool, index) => {
      const dex = pool.dexId.padEnd(10);
      const liquidity = formatCurrency(parseFloat(pool.liquidity?.usd)).padEnd(15);
      const volume = formatCurrency(parseFloat(pool.volume?.h24)).padEnd(15);
      const pair = `${pool.baseToken?.symbol || '?'}/${pool.quoteToken?.symbol || '?'}`.padEnd(10);
      
      console.log(`${index + 1}. ${dex} | ${pair} | Liquidity: ${liquidity} | Volume 24h: ${volume} | Price: ${formatCurrency(parseFloat(pool.priceUsd || 0), 6)}`);
    });
    
    // Display top pool details
    const topPool = sortedPools[0];
    
    console.log(`\n${fancyColors.BOLD}${fancyColors.CYAN}Top Pool Details:${fancyColors.RESET}`);
    console.log(`${fancyColors.BOLD}Token:${fancyColors.RESET} ${topPool.baseToken?.name || 'Unknown'} (${topPool.baseToken?.symbol || 'Unknown'})`);
    console.log(`${fancyColors.BOLD}Price:${fancyColors.RESET} ${formatCurrency(parseFloat(topPool.priceUsd), 6)}`);
    console.log(`${fancyColors.BOLD}24h Volume:${fancyColors.RESET} ${formatCurrency(parseFloat(topPool.volume?.h24))}`);
    console.log(`${fancyColors.BOLD}Liquidity:${fancyColors.RESET} ${formatCurrency(parseFloat(topPool.liquidity?.usd))}`);
    console.log(`${fancyColors.BOLD}Price Changes:${fancyColors.RESET}`);
    console.log(`1 Hour: ${formatPercentage(parseFloat(topPool.priceChange?.h1))}`);
    console.log(`6 Hours: ${formatPercentage(parseFloat(topPool.priceChange?.h6))}`);
    console.log(`24 Hours: ${formatPercentage(parseFloat(topPool.priceChange?.h24))}`);
    
    // Pool composition
    const baseReserve = parseFloat(topPool.liquidity?.base);
    const quoteReserve = parseFloat(topPool.liquidity?.quote);
    const baseSymbol = topPool.baseToken?.symbol || 'HOUSE';
    const quoteSymbol = topPool.quoteToken?.symbol || 'SOL';
    
    console.log(`\n${fancyColors.BOLD}Pool Composition:${fancyColors.RESET}`);
    console.log(`${baseReserve?.toLocaleString() || 'N/A'} ${baseSymbol}`);
    console.log(`${quoteReserve?.toLocaleString() || 'N/A'} ${quoteSymbol}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the test
testCachedTokenData();