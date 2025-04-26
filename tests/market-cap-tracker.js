// tests/market-cap-tracker.js
// Advanced market cap and liquidity tracker using direct pool data 

import { logApi } from '../utils/logger-suite/logger.js';
import { dexscreenerClient } from '../services/solana-engine/dexscreener-client.js';
import { fancyColors } from '../utils/colors.js';
import prisma from '../config/prisma.js';

// Default token address (configurable via command line)
const TOKEN_ADDRESS = process.argv[2] || "DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump";

// Format currency for display
function formatCurrency(amount, decimals = 2) {
  if (!amount) return 'N/A';
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

// Safe parsing for floating point values
function safeParseFloat(val) {
  if (!val) return null;
  try {
    const parsed = parseFloat(val);
    if (isNaN(parsed) || !isFinite(parsed)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

// Calculate market cap for a token
async function calculateMarketCap(tokenAddress) {
  console.log(`\n${fancyColors.BOLD}${fancyColors.CYAN}Calculating market statistics for ${tokenAddress}${fancyColors.RESET}`);
  
  try {
    // Ensure DexScreener client is initialized
    if (!dexscreenerClient.initialized) {
      await dexscreenerClient.initialize();
    }
    
    // Get token info from database if available
    let tokenInfo = null;
    try {
      tokenInfo = await prisma.tokens.findUnique({
        where: { address: tokenAddress }
      });
      
      if (tokenInfo) {
        console.log(`${fancyColors.GREEN}Found token in database: ${tokenInfo.name} (${tokenInfo.symbol})${fancyColors.RESET}`);
      }
    } catch (error) {
      console.log(`${fancyColors.YELLOW}Warning: Could not query token from database: ${error.message}${fancyColors.RESET}`);
    }
    
    // Get pool data directly from DexScreener
    console.log(`Fetching pool data for token...`);
    const poolsData = await dexscreenerClient.getTokenPools('solana', tokenAddress);
    
    if (!Array.isArray(poolsData) || poolsData.length === 0) {
      console.log(`${fancyColors.RED}No pools found for this token${fancyColors.RESET}`);
      return null;
    }
    
    // Sort pools by liquidity
    const sortedPools = [...poolsData].sort((a, b) => {
      const liquidityA = safeParseFloat(a.liquidity?.usd) || 0;
      const liquidityB = safeParseFloat(b.liquidity?.usd) || 0;
      return liquidityB - liquidityA;
    });
    
    // Use the top pool for market data
    const topPool = sortedPools[0];
    
    // Calculate key metrics
    const price = safeParseFloat(topPool.priceUsd);
    const marketCap = safeParseFloat(topPool.marketCap);
    const fdv = safeParseFloat(topPool.fdv);
    const volume24h = safeParseFloat(topPool.volume?.h24);
    const liquidity = safeParseFloat(topPool.liquidity?.usd);
    const change24h = safeParseFloat(topPool.priceChange?.h24);
    const change6h = safeParseFloat(topPool.priceChange?.h6);
    const change1h = safeParseFloat(topPool.priceChange?.h1);
    
    // Calculate circulating supply
    const circulatingSupply = price ? marketCap / price : null;
    
    // Calculate total supply
    const totalSupply = price ? fdv / price : null;
    
    // Calculate volume to market cap ratio
    const volumeToMcap = (marketCap && volume24h) ? volume24h / marketCap : null;
    
    // Calculate liquidity to market cap ratio
    const liquidityToMcap = (marketCap && liquidity) ? liquidity / marketCap : null;
    
    // Create comprehensive market data object
    const marketData = {
      token: {
        address: tokenAddress,
        name: topPool.baseToken?.name || tokenInfo?.name || 'Unknown',
        symbol: topPool.baseToken?.symbol || tokenInfo?.symbol || 'Unknown',
        decimals: tokenInfo?.decimals || null,
        iconUrl: topPool.info?.imageUrl || null,
      },
      price: {
        current: price,
        change1h,
        change6h,
        change24h
      },
      supply: {
        circulating: circulatingSupply,
        total: totalSupply
      },
      marketCap: {
        current: marketCap,
        fdv
      },
      volume: {
        h24: volume24h,
        h6: safeParseFloat(topPool.volume?.h6),
        h1: safeParseFloat(topPool.volume?.h1),
        volumeToMcap
      },
      liquidity: {
        total: liquidity,
        liquidityToMcap
      },
      topPool: {
        dex: topPool.dexId,
        pairAddress: topPool.pairAddress,
        quoteToken: topPool.quoteToken?.symbol || 'Unknown',
        pairCreatedAt: topPool.pairCreatedAt ? new Date(topPool.pairCreatedAt) : null
      },
      poolCount: sortedPools.length,
      timestamp: new Date()
    };
    
    // Display market data
    console.log(`\n${fancyColors.BOLD}${fancyColors.CYAN}Token Market Data${fancyColors.RESET}`);
    console.log(`${fancyColors.BOLD}Token:${fancyColors.RESET} ${marketData.token.name} (${marketData.token.symbol})`);
    console.log(`${fancyColors.BOLD}Price:${fancyColors.RESET} ${formatCurrency(marketData.price.current, 6)}`);
    console.log(`${fancyColors.BOLD}Price Change:${fancyColors.RESET} 1h: ${formatPercentage(marketData.price.change1h)} | 6h: ${formatPercentage(marketData.price.change6h)} | 24h: ${formatPercentage(marketData.price.change24h)}`);
    console.log(`${fancyColors.BOLD}Market Cap:${fancyColors.RESET} ${formatCurrency(marketData.marketCap.current)}`);
    console.log(`${fancyColors.BOLD}FDV:${fancyColors.RESET} ${formatCurrency(marketData.marketCap.fdv)}`);
    console.log(`${fancyColors.BOLD}24h Volume:${fancyColors.RESET} ${formatCurrency(marketData.volume.h24)}`);
    console.log(`${fancyColors.BOLD}Volume/MCap:${fancyColors.RESET} ${marketData.volume.volumeToMcap ? (marketData.volume.volumeToMcap * 100).toFixed(2) + '%' : 'N/A'}`);
    console.log(`${fancyColors.BOLD}Liquidity:${fancyColors.RESET} ${formatCurrency(marketData.liquidity.total)}`);
    console.log(`${fancyColors.BOLD}Liquidity/MCap:${fancyColors.RESET} ${marketData.liquidity.liquidityToMcap ? (marketData.liquidity.liquidityToMcap * 100).toFixed(2) + '%' : 'N/A'}`);
    console.log(`${fancyColors.BOLD}Pools:${fancyColors.RESET} ${marketData.poolCount} (Top: ${marketData.topPool.dex} | ${marketData.topPool.quoteToken} pair)`);
    
    // Log supply info
    if (marketData.supply.circulating) {
      console.log(`${fancyColors.BOLD}Circulating Supply:${fancyColors.RESET} ${marketData.supply.circulating.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${marketData.token.symbol}`);
    }
    if (marketData.supply.total) {
      console.log(`${fancyColors.BOLD}Total Supply:${fancyColors.RESET} ${marketData.supply.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${marketData.token.symbol}`);
    }
    
    return marketData;
  } catch (error) {
    console.error(`${fancyColors.RED}Error calculating market cap:${fancyColors.RESET}`, error);
    return null;
  }
}

// Track market cap changes over time
async function trackMarketCapChanges(tokenAddress, intervalSeconds = 60, totalIntervals = 5) {
  console.log(`\n${fancyColors.BOLD}${fancyColors.CYAN}Starting Market Cap Tracking${fancyColors.RESET}`);
  console.log(`Tracking market cap for ${tokenAddress} every ${intervalSeconds} seconds for ${totalIntervals} intervals`);
  
  const historyData = [];
  
  // Get initial data
  const initialData = await calculateMarketCap(tokenAddress);
  if (initialData) {
    historyData.push(initialData);
  } else {
    console.log(`${fancyColors.RED}Failed to get initial market data. Aborting tracking.${fancyColors.RESET}`);
    return;
  }
  
  // Schedule data collection intervals
  let intervalCount = 1;
  const trackingInterval = setInterval(async () => {
    console.log(`\n${fancyColors.CYAN}Collecting interval ${intervalCount} of ${totalIntervals}${fancyColors.RESET}`);
    
    const newData = await calculateMarketCap(tokenAddress);
    if (newData) {
      historyData.push(newData);
      
      // Calculate changes since first interval
      if (historyData.length > 1) {
        const first = historyData[0];
        const latest = historyData[historyData.length - 1];
        
        // Calculate changes
        const priceChange = first.price.current ? 
          ((latest.price.current - first.price.current) / first.price.current) * 100 : null;
        
        const mcapChange = first.marketCap.current ? 
          ((latest.marketCap.current - first.marketCap.current) / first.marketCap.current) * 100 : null;
        
        const volumeChange = first.volume.h24 ? 
          ((latest.volume.h24 - first.volume.h24) / first.volume.h24) * 100 : null;
        
        const liquidityChange = first.liquidity.total ? 
          ((latest.liquidity.total - first.liquidity.total) / first.liquidity.total) * 100 : null;
        
        // Display changes
        console.log(`\n${fancyColors.BOLD}${fancyColors.CYAN}Changes during tracking period:${fancyColors.RESET}`);
        console.log(`${fancyColors.BOLD}Price:${fancyColors.RESET} ${formatCurrency(first.price.current, 6)} → ${formatCurrency(latest.price.current, 6)} (${formatPercentage(priceChange)})`);
        console.log(`${fancyColors.BOLD}Market Cap:${fancyColors.RESET} ${formatCurrency(first.marketCap.current)} → ${formatCurrency(latest.marketCap.current)} (${formatPercentage(mcapChange)})`);
        console.log(`${fancyColors.BOLD}24h Volume:${fancyColors.RESET} ${formatCurrency(first.volume.h24)} → ${formatCurrency(latest.volume.h24)} (${formatPercentage(volumeChange)})`);
        console.log(`${fancyColors.BOLD}Liquidity:${fancyColors.RESET} ${formatCurrency(first.liquidity.total)} → ${formatCurrency(latest.liquidity.total)} (${formatPercentage(liquidityChange)})`);
        
        // Calculate annualized metrics
        const secondsElapsed = (latest.timestamp - first.timestamp) / 1000;
        if (secondsElapsed > 0) {
          const annualizedPriceMultiplier = (1 + (priceChange / 100)) ** (31536000 / secondsElapsed);
          const annualizedMcapMultiplier = (1 + (mcapChange / 100)) ** (31536000 / secondsElapsed);
          
          console.log(`\n${fancyColors.BOLD}${fancyColors.CYAN}Annualized projections (if trend continues):${fancyColors.RESET}`);
          console.log(`${fancyColors.BOLD}Price Growth:${fancyColors.RESET} ${((annualizedPriceMultiplier - 1) * 100).toFixed(2)}% annually`);
          console.log(`${fancyColors.BOLD}Market Cap Growth:${fancyColors.RESET} ${((annualizedMcapMultiplier - 1) * 100).toFixed(2)}% annually`);
          console.log(`${fancyColors.BOLD}Projected Future Market Cap:${fancyColors.RESET} ${formatCurrency(latest.marketCap.current * annualizedMcapMultiplier)} (in 1 year)`);
        }
      }
    }
    
    // Stop after totalIntervals
    intervalCount++;
    if (intervalCount > totalIntervals) {
      clearInterval(trackingInterval);
      console.log(`\n${fancyColors.BOLD}${fancyColors.GREEN}Market Cap Tracking Complete${fancyColors.RESET}`);
      process.exit(0);
    }
  }, intervalSeconds * 1000);
}

// Main function
async function main() {
  try {
    console.log(`${fancyColors.BOLD}${fancyColors.GREEN}======= MARKET CAP & LIQUIDITY TRACKER =======${fancyColors.RESET}`);
    
    // Initial analysis of market cap/liquidity
    await calculateMarketCap(TOKEN_ADDRESS);
    
    // Track changes over time
    await trackMarketCapChanges(TOKEN_ADDRESS, 30, 5); // Check every 30 seconds for 5 intervals (2.5 minutes)
  } catch (error) {
    console.error(`${fancyColors.RED}ERROR:${fancyColors.RESET}`, error);
    process.exit(1);
  }
}

// Run the app
main();