// tests/market-cap-analyzer.js
// Comprehensive token market analytics tool with detailed liquidity analysis

import { logApi } from '../utils/logger-suite/logger.js';
import { dexscreenerClient } from '../services/solana-engine/dexscreener-client.js';
import { fancyColors } from '../utils/colors.js';
import prisma from '../config/prisma.js';

// Display help information
function showHelp() {
  console.log(`
Market Cap Analyzer - Comprehensive token analytics tool

Usage:
  npm run market-cap [options] [TOKEN_ADDRESS]
  node tests/market-cap-analyzer.js [options] [TOKEN_ADDRESS]

Options:
  --json                  Output results in JSON format
  --format=json           Same as --json
  --output=json           Same as --json
  --token=ADDRESS         Specify token address (alternative to positional argument)
  --timeout=SECONDS       Maximum time to wait in seconds (default: 60)
  --retries=NUMBER        Maximum number of retries for API calls (default: 5)
  --help                  Show this help message
  
Token Acquisition Options:
  --acquisition=LEVEL     Set acquisition level (low=50%, medium=60%, high=70%) 
  --personal-ratio=RATIO  Set personal allocation as fraction of acquired tokens (0-1)
  
Scenario Options:
  --no-bull               Disable bull market scenario
  --no-base               Disable base case scenario
  --no-bear               Disable bear market scenario
  --advanced-volatility   Enable advanced daily volatility modeling
  --acquisition-grid      Show outcome grid for different acquisition levels

Liquidation Analysis Options:
  The tool now includes a comprehensive liquidation analysis for large token holders:
  - Projects token sales over a 6-month period under multiple volume scenarios
  - Calculates optimal selling strategies based on daily trading volume
  - Shows projected timelines for liquidating different percentages of holdings

Examples:
  # Analyze House token (default) with human-readable output
  npm run market-cap

  # Analyze a specific token with human-readable output
  npm run market-cap EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

  # Analyze with high acquisition and 60% personal allocation
  npm run market-cap --acquisition=high --personal-ratio=0.6

  # Show acquisition outcome grid with all scenarios
  npm run market-cap --acquisition-grid

  # Run only the base case scenario
  npm run market-cap --no-bull --no-bear

  # Analyze with more advanced volatility modeling
  npm run market-cap --advanced-volatility
  
  # Analyze a token with extended timeout and more retries (for rate limits)
  npm run market-cap --timeout=120 --retries=10
`);
  process.exit(0);
}

// Parse command line arguments
const parseArgs = () => {
  const args = {
    tokenAddress: "DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump", // House token
    outputFormat: "text", // Default to human-readable text output
    timeout: 60000, // Default timeout of 60 seconds
    maxRetries: 5, // Default max retries
    
    // Token acquisition percentages
    acquisitionLevel: "medium", // low, medium, high (50%, 60%, 70% acquisition)
    personalRatio: 0.5,  // What fraction of acquired tokens are yours (default: half)
    
    // Market scenarios
    enableBullCase: true,  // Enable bull market scenario
    enableBaseCase: true,  // Enable base case scenario
    enableBearCase: true,  // Enable bear market scenario
    
    // Advanced options
    advancedVolatility: false,  // Enable daily volatility modeling
    showAcquisitionGrid: true  // Show acquisition outcome grid
  };
  
  // Simple argument parsing
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    
    // Check for help flag
    if (arg === '--help' || arg === '-h') {
      showHelp();
    }
    
    // Handle token address without flag
    if (i === 2 && !arg.startsWith('--')) {
      args.tokenAddress = arg;
      continue;
    }
    
    // Handle --format=json or --output=json style arguments
    if (arg.startsWith('--format=') || arg.startsWith('--output=')) {
      const format = arg.split('=')[1].toLowerCase();
      if (format === 'json') {
        args.outputFormat = 'json';
      }
    } else if (arg === '--json') {
      args.outputFormat = 'json';
    } else if (arg.startsWith('--token=')) {
      args.tokenAddress = arg.split('=')[1];
    } else if (arg.startsWith('--timeout=')) {
      const timeout = parseInt(arg.split('=')[1], 10);
      if (!isNaN(timeout) && timeout > 0) {
        args.timeout = timeout * 1000; // Convert seconds to milliseconds
      }
    } else if (arg.startsWith('--retries=')) {
      const retries = parseInt(arg.split('=')[1], 10);
      if (!isNaN(retries) && retries >= 0) {
        args.maxRetries = retries;
      }
    } else if (arg.startsWith('--acquisition=')) {
      // Acquisition level (low=50%, medium=60%, high=70%)
      const level = arg.split('=')[1].toLowerCase();
      if (["low", "medium", "high"].includes(level)) {
        args.acquisitionLevel = level;
      }
    } else if (arg.startsWith('--personal-ratio=')) {
      // What percentage of acquired tokens are yours
      const ratio = parseFloat(arg.split('=')[1]);
      if (!isNaN(ratio) && ratio > 0 && ratio <= 1) {
        args.personalRatio = ratio;
      }
    } else if (arg === '--no-bull') {
      args.enableBullCase = false;
    } else if (arg === '--no-base') {
      args.enableBaseCase = false;
    } else if (arg === '--no-bear') {
      args.enableBearCase = false;
    } else if (arg === '--advanced-volatility') {
      args.advancedVolatility = true;
    } else if (arg === '--acquisition-grid') {
      args.showAcquisitionGrid = true;
    }
    
    // Legacy support for old parameters
    else if (arg.startsWith('--org-holding=')) {
      console.warn("Warning: --org-holding is deprecated. Use --acquisition=low|medium|high instead.");
      const holdingPct = parseFloat(arg.split('=')[1]);
      if (!isNaN(holdingPct)) {
        if (holdingPct <= 55) args.acquisitionLevel = "low";
        else if (holdingPct <= 65) args.acquisitionLevel = "medium";
        else args.acquisitionLevel = "high";
      }
    } else if (arg.startsWith('--personal-holding=')) {
      console.warn("Warning: --personal-holding is deprecated. Use --personal-ratio=0-1 instead.");
      const holdingPct = parseFloat(arg.split('=')[1]);
      if (!isNaN(holdingPct) && holdingPct > 0) {
        // Convert from percentage of total to ratio of acquired
        // Estimate original acquisition percentage based on level
        let estAcquisitionPct;
        if (args.acquisitionLevel === "low") estAcquisitionPct = 50;
        else if (args.acquisitionLevel === "medium") estAcquisitionPct = 60;
        else estAcquisitionPct = 70;
        
        args.personalRatio = Math.min(holdingPct / estAcquisitionPct, 1);
      }
    }
  }
  
  return args;
};

const args = parseArgs();
const TOKEN_ADDRESS = args.tokenAddress;

// Format currency for display
function formatCurrency(amount, decimals = 2) {
  if (amount === null || amount === undefined) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: decimals
  }).format(amount);
}

// Format percentage change with colors
function formatPercentage(value) {
  if (value === undefined || value === null) return 'N/A';
  const formatted = Number(value).toFixed(2) + '%';
  
  // Add colors based on value
  if (value > 0) {
    // Gradient of green based on size
    if (value > 20) return `${fancyColors.BRIGHT_GREEN}+${formatted}${fancyColors.RESET}`;
    if (value > 5) return `${fancyColors.GREEN}+${formatted}${fancyColors.RESET}`;
    return `${fancyColors.LIGHT_GREEN}+${formatted}${fancyColors.RESET}`;
  } else if (value < 0) {
    // Gradient of red based on size
    if (value < -20) return `${fancyColors.BRIGHT_RED}${formatted}${fancyColors.RESET}`;
    if (value < -5) return `${fancyColors.RED}${formatted}${fancyColors.RESET}`;
    return `${fancyColors.LIGHT_RED}${formatted}${fancyColors.RESET}`;
  }
  
  // Zero is neutral
  return `${fancyColors.GRAY}${formatted}${fancyColors.RESET}`;
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

// Helper function to sleep/delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Retry function with exponential backoff and progress indicator
async function retryWithBackoff(fn, maxRetries = 5, initialDelay = 1000, timeout = 60000) {
  let retries = 0;
  const startTime = Date.now();
  
  while (true) {
    // Check if we've exceeded the overall timeout
    if (Date.now() - startTime > timeout) {
      throw new Error(`Operation timed out after ${timeout/1000} seconds of retrying`);
    }
    
    try {
      return await fn();
    } catch (error) {
      // Handle rate limit errors (429)
      if (error.response && error.response.status === 429 && retries < maxRetries) {
        retries++;
        // Modified exponential backoff with lower cap
        let delay = initialDelay * Math.pow(1.5, retries - 1); // Less aggressive exponential backoff (1.5 instead of 2)
        delay = Math.min(delay, 5000); // Cap at 5 seconds maximum
        const jitter = Math.random() * 500; // Reduced jitter
        const waitTime = Math.round(delay + jitter);
        
        logApi.warn(`${fancyColors.YELLOW}Rate limited (429 error). Retry ${retries}/${maxRetries} after ${Math.round(waitTime/1000)}s delay...${fancyColors.RESET}`);
        
        // For console output, log progress dots during waiting
        if (process.stdout.isTTY) {
          process.stdout.write(`\rWaiting for rate limit: [`);
          
          // Show progress during waiting period (faster indicators)
          const progressInterval = setInterval(() => {
            process.stdout.write('.');
          }, 300);
          
          await sleep(waitTime);
          
          clearInterval(progressInterval);
          process.stdout.write(`] Retrying...\n`);
        } else {
          await sleep(waitTime);
        }
        
        logApi.warn(`${fancyColors.YELLOW}Retrying request (attempt ${retries}/${maxRetries})...${fancyColors.RESET}`);
        continue;
      }
      
      // If there's a Retry-After header, respect it
      if (error.response && error.response.headers && error.response.headers['retry-after'] && retries < maxRetries) {
        retries++;
        let retryAfter = parseInt(error.response.headers['retry-after'], 10) * 1000 || 3000;
        // Cap at 5 seconds maximum regardless of what the server says
        retryAfter = Math.min(retryAfter, 5000);
        
        logApi.warn(`${fancyColors.YELLOW}Server requested retry after ${retryAfter/1000}s. Waiting...${fancyColors.RESET}`);
        await sleep(retryAfter);
        continue;
      }
      
      // If not a rate limit error or we've exhausted retries, enhance error and rethrow
      if (error.response && error.response.status === 429) {
        throw new Error(`Rate limit exceeded after ${retries} retries. Please try again later.`);
      } else {
        throw error;
      }
    }
  }
}

// Calculate market cap and related metrics from pool data
async function calculateMarketMetrics(tokenAddress, skipLogging = false) {
  if (!skipLogging) {
    logApi.info(`\n${fancyColors.BOLD}${fancyColors.CYAN}Calculating market metrics for ${tokenAddress}${fancyColors.RESET}`);
  }
  
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
      
      if (tokenInfo && !skipLogging) {
        logApi.info(`${fancyColors.GREEN}Found token in database: ${tokenInfo.name} (${tokenInfo.symbol})${fancyColors.RESET}`);
      }
    } catch (error) {
      if (!skipLogging) {
        logApi.warn(`${fancyColors.YELLOW}Warning: Could not query token from database: ${error.message}${fancyColors.RESET}`);
      }
    }
    
    // Get pool data directly from DexScreener with customized retry mechanism
    if (!skipLogging) {
      logApi.info(`Fetching pool data for token...`);
    }
    
    // Custom wrapper that handles DexScreener client's internal rate limiting
    const getPoolsWithRetry = async () => {
      try {
        return await dexscreenerClient.getTokenPools('solana', tokenAddress);
      } catch (error) {
        // If we hit an internal rate limit message but not a 429,
        // we need to handle it differently
        if (error.message?.includes('Rate limit') || 
            error.message?.includes('waiting') ||
            error.message?.includes('rate limit')) {
          
          // Extract the wait time if available in the message (in ms)
          // But force a much more reasonable wait time
          let waitTime = 3000; // Default to just 3 seconds instead of 10
          const waitTimeMatch = error.message.match(/waiting (\d+)ms/);
          if (waitTimeMatch && waitTimeMatch[1]) {
            // Cap the wait time to a reasonable value (max 5 seconds)
            waitTime = Math.min(parseInt(waitTimeMatch[1], 10), 5000);
          }
          
          if (!skipLogging) {
            logApi.warn(`${fancyColors.YELLOW}Internal rate limit detected. Waiting ${Math.round(waitTime/1000)}s (capped from ${waitTimeMatch ? Math.round(parseInt(waitTimeMatch[1], 10)/1000) + 's' : 'unknown'})...${fancyColors.RESET}`);
          }
          
          // Show progress indicator if in console
          if (process.stdout.isTTY && !skipLogging) {
            process.stdout.write(`\rWaiting for DexScreener internal rate limit: [`);
            
            // Show dots during waiting period
            const progressInterval = setInterval(() => {
              process.stdout.write('.');
            }, 500); // Faster progress indicator
            
            await sleep(waitTime);
            
            clearInterval(progressInterval);
            process.stdout.write(`] Continuing...\n`);
          } else {
            await sleep(waitTime);
          }
          
          // Throw a custom error that will trigger the retry
          throw new Error('Internal rate limit, retrying after delay');
        }
        
        // Pass through other errors to be handled by retryWithBackoff
        throw error;
      }
    };
    
    const poolsData = await retryWithBackoff(
      getPoolsWithRetry, 
      args.maxRetries,
      1000, // Initial delay
      args.timeout // Overall timeout
    );
    
    if (!Array.isArray(poolsData) || poolsData.length === 0) {
      if (!skipLogging) {
        logApi.error(`${fancyColors.RED}No pools found for this token${fancyColors.RESET}`);
      }
      return null;
    }
    
    if (!skipLogging) {
      logApi.info(`Found ${poolsData.length} pools for token ${poolsData[0].baseToken?.symbol || tokenAddress}`);
      
      // Show all pools and their liquidity
      logApi.info(`\n${fancyColors.BOLD}${fancyColors.CYAN}All Pools Sorted By Liquidity:${fancyColors.RESET}`);
    }
    
    // Sort pools by liquidity
    const sortedPools = [...poolsData].sort((a, b) => {
      const liquidityA = safeParseFloat(a.liquidity?.usd) || 0;
      const liquidityB = safeParseFloat(b.liquidity?.usd) || 0;
      return liquidityB - liquidityA;
    });
    
    // Display pools
    if (!skipLogging) {
      sortedPools.forEach((pool, index) => {
        const dex = pool.dexId.padEnd(10);
        const liquidity = formatCurrency(safeParseFloat(pool.liquidity?.usd)).padEnd(15);
        const volume = formatCurrency(safeParseFloat(pool.volume?.h24)).padEnd(15);
        const pair = `${pool.baseToken?.symbol || '?'}/${pool.quoteToken?.symbol || '?'}`.padEnd(10);
        
        logApi.info(`${index + 1}. ${dex} | ${pair} | Liquidity: ${liquidity} | Volume 24h: ${volume} | Price: ${formatCurrency(safeParseFloat(pool.priceUsd), 6)}`);
      });
    }
    
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
    
    // Extract pool reserves for SOL price calculation
    const baseReserve = safeParseFloat(topPool.liquidity?.base);
    const quoteReserve = safeParseFloat(topPool.liquidity?.quote);
    const baseSymbol = topPool.baseToken?.symbol || 'TOKEN';
    const quoteSymbol = topPool.quoteToken?.symbol || 'SOL';
    
    // Dynamically calculate SOL price from pool data
    let solPrice = null;
    
    // Calculate SOL price from pool data if possible
    if (baseReserve && quoteReserve && price) {
      // Value of base tokens = Value of quote tokens
      // baseReserve * price = quoteReserve * solPrice
      solPrice = (baseReserve * price) / quoteReserve;
      if (!skipLogging) {
        logApi.info(`${fancyColors.BOLD}${fancyColors.CYAN}Calculated ${quoteSymbol} Price: ${formatCurrency(solPrice, 2)}${fancyColors.RESET} (derived from pool reserves)`);
      }
    } else {
      if (!skipLogging) {
        logApi.error(`${fancyColors.BOLD}${fancyColors.RED}Warning: Could not calculate ${quoteSymbol} price from pool reserves${fancyColors.RESET}`);
      }
      return null; // Exit early if we can't calculate critical price data
    }
    
    // Calculate circulating supply based on market cap and price
    const circulatingSupply = price ? marketCap / price : null;
    
    // Calculate total supply based on FDV and price
    const totalSupply = price ? fdv / price : null;
    
    // Display market metrics only if not skipping logging
    if (!skipLogging) {
      logApi.info(`\n${fancyColors.BOLD}${fancyColors.INDIGO}Market Metrics Summary${fancyColors.RESET}`);
      logApi.info(`${fancyColors.BOLD}${fancyColors.PURPLE}Token:${fancyColors.RESET} ${topPool.baseToken?.name || tokenInfo?.name || 'Unknown'} (${fancyColors.BOLD}${topPool.baseToken?.symbol || tokenInfo?.symbol || 'Unknown'}${fancyColors.RESET})`);
      logApi.info(`${fancyColors.BOLD}${fancyColors.TEAL}Price:${fancyColors.RESET} ${formatCurrency(price, 6)}`);
      logApi.info(`${fancyColors.BOLD}${fancyColors.LIME}Market Cap:${fancyColors.RESET} ${formatCurrency(marketCap)}`);
      logApi.info(`${fancyColors.BOLD}${fancyColors.LIME}Fully Diluted Valuation:${fancyColors.RESET} ${formatCurrency(fdv)}`);
      logApi.info(`${fancyColors.BOLD}${fancyColors.TURQUOISE}Liquidity:${fancyColors.RESET} ${formatCurrency(liquidity)}`);
      logApi.info(`${fancyColors.BOLD}${fancyColors.ORANGE}24h Volume:${fancyColors.RESET} ${formatCurrency(volume24h)}`);
      
      // Price changes
      logApi.info(`\n${fancyColors.BOLD}${fancyColors.CYAN}Price Changes:${fancyColors.RESET}`);
      logApi.info(`${fancyColors.LIGHT_CYAN}1 Hour:${fancyColors.RESET} ${formatPercentage(change1h)}`);
      logApi.info(`${fancyColors.CYAN}6 Hours:${fancyColors.RESET} ${formatPercentage(change6h)}`);
      logApi.info(`${fancyColors.BOLD_CYAN}24 Hours:${fancyColors.RESET} ${formatPercentage(change24h)}`);
      
      // Supply info
      logApi.info(`\n${fancyColors.BOLD}Supply Information:${fancyColors.RESET}`);
      if (circulatingSupply) {
        logApi.info(`Circulating Supply: ${circulatingSupply.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${topPool.baseToken?.symbol || ''}`);
      }
      if (totalSupply) {
        logApi.info(`Total Supply: ${totalSupply.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${topPool.baseToken?.symbol || ''}`);
      }
      
      // Key ratios
      logApi.info(`\n${fancyColors.BOLD}${fancyColors.INDIGO}Key Ratios:${fancyColors.RESET}`);
      let volumeToMcap = null;
      let liquidityToMcap = null;
      
      if (marketCap && volume24h) {
        volumeToMcap = (volume24h / marketCap) * 100;
        logApi.info(`${fancyColors.BOLD}${fancyColors.TEAL}Volume/Market Cap:${fancyColors.RESET} ${volumeToMcap.toFixed(2)}%`);
      }
      if (marketCap && liquidity) {
        liquidityToMcap = (liquidity / marketCap) * 100;
        logApi.info(`${fancyColors.BOLD}${fancyColors.TURQUOISE}Liquidity/Market Cap:${fancyColors.RESET} ${liquidityToMcap.toFixed(2)}%`);
      }
      
      // Add new Strategic Liquidation Analysis section for large token holders
      logApi.info(`\n${fancyColors.BOLD}${fancyColors.PURPLE}Large Position Liquidation Strategy${fancyColors.RESET}`);
      
      if (volume24h && baseReserve && totalSupply && price) {
        // Calculate daily volume in token terms
        const dailyVolumeTokens = volume24h / price;
        const percentOfSupply = (dailyVolumeTokens / totalSupply) * 100;
        
        // Holder position size based on acquisition level
        let orgHoldingPct;
        if (args.acquisitionLevel === "low") {
          orgHoldingPct = 50;
        } else if (args.acquisitionLevel === "medium") {
          orgHoldingPct = 60;
        } else { // high
          orgHoldingPct = 70;
        }
        
        // Personal allocation is a ratio of what org acquired
        const personalRatio = args.personalRatio;
        const personalHoldingPct = orgHoldingPct * personalRatio;
        
        const orgHolding = totalSupply * (orgHoldingPct / 100);
        const personalHolding = totalSupply * (personalHoldingPct / 100);
        
        // Display Acquisition Grid if requested
        if (args.showAcquisitionGrid) {
          logApi.info(`\n${fancyColors.BOLD}${fancyColors.BG_INDIGO}${fancyColors.WHITE} ACQUISITION OUTCOME GRID ${fancyColors.RESET}`);
          logApi.info(`${fancyColors.INDIGO}Shows projected outcomes across different acquisition levels and market scenarios${fancyColors.RESET}`);
          
          // Calculate data for different acquisition levels
          const acquisitionLevels = [
            { level: "Low", pct: 50 },
            { level: "Medium", pct: 60 },
            { level: "High", pct: 70 }
          ];
          
          // Display grid table header
          logApi.info(`\n${fancyColors.BOLD}${fancyColors.INDIGO}Total Token Value by Acquisition Level:${fancyColors.RESET}`);
          
          // Horizontal header (scenarios)
          const headerLine = `${fancyColors.BOLD}Acquisition    │ ${fancyColors.GREEN}Bull Case     ${fancyColors.RESET}${fancyColors.BOLD}│ ${fancyColors.YELLOW}Base Case     ${fancyColors.RESET}${fancyColors.BOLD}│ ${fancyColors.RED}Bear Case     ${fancyColors.RESET}${fancyColors.BOLD}│${fancyColors.RESET}`;
          const dividerLine = `${fancyColors.BOLD}──────────────┼────────────────┼────────────────┼────────────────┤${fancyColors.RESET}`;
          
          logApi.info(headerLine);
          logApi.info(dividerLine);
          
          // Process acquisition levels
          acquisitionLevels.forEach(({ level, pct }) => {
            // Calculate org and personal token amounts
            const orgTokens = totalSupply * (pct / 100);
            const personalTokens = orgTokens * personalRatio;
            
            // Calculate value in different scenarios
            const bullValue = personalTokens * (price * 3); // 3x price in bull case
            const baseValue = personalTokens * price;       // Current price in base case
            const bearValue = personalTokens * (price * 0.3); // 70% drop in bear case
            
            // Format values
            const formattedBull = formatCurrency(bullValue).padEnd(14);
            const formattedBase = formatCurrency(baseValue).padEnd(14);
            const formattedBear = formatCurrency(bearValue).padEnd(14);
            
            // Color-coded level
            let coloredLevel;
            if (level === "Low") coloredLevel = `${fancyColors.LIGHT_BLUE}${level} (${pct}%)${fancyColors.RESET}`.padEnd(21);
            else if (level === "Medium") coloredLevel = `${fancyColors.BLUE}${level} (${pct}%)${fancyColors.RESET}`.padEnd(21);
            else coloredLevel = `${fancyColors.BOLD_BLUE}${level} (${pct}%)${fancyColors.RESET}`.padEnd(21);
            
            // Row for this acquisition level
            logApi.info(`${coloredLevel}│ ${fancyColors.GREEN}${formattedBull}${fancyColors.RESET}│ ${fancyColors.YELLOW}${formattedBase}${fancyColors.RESET}│ ${fancyColors.RED}${formattedBear}${fancyColors.RESET}│`);
          });
          
          logApi.info(dividerLine);
          
          // Add a section for token amounts
          logApi.info(`\n${fancyColors.BOLD}${fancyColors.INDIGO}Your Token Holdings by Acquisition Level (${personalRatio * 100}% of acquired):${fancyColors.RESET}`);
          
          logApi.info(headerLine.replace(/Bull Case\s+│ Base Case\s+│ Bear Case\s+/, "Tokens        │ % of Supply   │ USD Value     "));
          logApi.info(dividerLine);
          
          // Process acquisition levels for token amounts
          acquisitionLevels.forEach(({ level, pct }) => {
            // Calculate org and personal token amounts
            const orgTokens = totalSupply * (pct / 100);
            const personalTokens = orgTokens * personalRatio;
            const personalPct = (personalTokens / totalSupply) * 100;
            
            // Format values
            const formattedTokens = personalTokens.toLocaleString(undefined, { maximumFractionDigits: 0 }).padEnd(14);
            const formattedPct = `${personalPct.toFixed(1)}%`.padEnd(14);
            const formattedValue = formatCurrency(personalTokens * price).padEnd(14);
            
            // Color-coded level
            let coloredLevel;
            if (level === "Low") coloredLevel = `${fancyColors.LIGHT_BLUE}${level} (${pct}%)${fancyColors.RESET}`.padEnd(21);
            else if (level === "Medium") coloredLevel = `${fancyColors.BLUE}${level} (${pct}%)${fancyColors.RESET}`.padEnd(21);
            else coloredLevel = `${fancyColors.BOLD_BLUE}${level} (${pct}%)${fancyColors.RESET}`.padEnd(21);
            
            // Row for this acquisition level
            logApi.info(`${coloredLevel}│ ${formattedTokens}│ ${formattedPct}│ ${formattedValue}│`);
          });
          
          logApi.info(dividerLine);
          
          // Highlight the selected strategy
          logApi.info(`\n${fancyColors.BOLD}${fancyColors.BG_BLUE}${fancyColors.WHITE} Selected Strategy: ${args.acquisitionLevel.toUpperCase()} ACQUISITION (${orgHoldingPct}%) ${fancyColors.RESET}`);
          logApi.info(`${fancyColors.BOLD}${fancyColors.BLUE}• Organization Tokens:${fancyColors.RESET} ${orgHolding.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${orgHoldingPct}% of supply)`);
          logApi.info(`${fancyColors.BOLD}${fancyColors.BLUE}• Your Personal Tokens:${fancyColors.RESET} ${personalHolding.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${personalHoldingPct.toFixed(1)}% of supply)`);
          logApi.info(`${fancyColors.BOLD}${fancyColors.BLUE}• Current Value:${fancyColors.RESET} ${formatCurrency(personalHolding * price)}`);
        }
        
        // Selling parameters
        const conservativePctOfVolume = 1.0; // 1% of daily volume
        const moderatePctOfVolume = 2.5;     // 2.5% of daily volume
        const aggressivePctOfVolume = 5.0;   // 5% of daily volume
        
        // Display portfolio values
        logApi.info(`${fancyColors.BOLD}${fancyColors.INDIGO}Current Token Holdings:${fancyColors.RESET}`);
        logApi.info(`${fancyColors.BOLD}${fancyColors.PURPLE}• Organization Position:${fancyColors.RESET} ${orgHolding.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${orgHoldingPct}% of supply) valued at ${formatCurrency(orgHolding * price)}`);
        logApi.info(`${fancyColors.BOLD}${fancyColors.PURPLE}• Personal Position:${fancyColors.RESET} ${personalHolding.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${personalHoldingPct}% of supply) valued at ${formatCurrency(personalHolding * price)}`);
        
        // Display current market metrics
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.INDIGO}Current Market Metrics:${fancyColors.RESET}`);
        logApi.info(`${fancyColors.BOLD}${fancyColors.TEAL}• Daily Volume:${fancyColors.RESET} ${formatCurrency(volume24h)} (${dailyVolumeTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol})`);
        logApi.info(`${fancyColors.BOLD}${fancyColors.TEAL}• Volume as % of Supply:${fancyColors.RESET} ${percentOfSupply.toFixed(2)}% of total supply traded daily`);
        
        // Scenario 1: Base Case (Start at $10M, decay to $1M over 2 weeks, then stable)
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.BG_INDIGO}${fancyColors.WHITE} SCENARIO 1: BASE CASE - VOLUME DECAY ${fancyColors.RESET}`);
        logApi.info(`${fancyColors.INDIGO}• Initial volume: $10M, decaying to $1M over 14 days, then stable${fancyColors.RESET}`);
        
        // Model the volume decay
        const days = 180; // Show 6-month (180-day) projection
        const initialVolume = 10000000; // $10M
        const finalVolume = 1000000;    // $1M
        const decayDays = 14;           // 2 weeks decay
        
        // Arrays to track cumulative data
        let volumes = [];
        let conservative = [];
        let moderate = [];
        let aggressive = [];
        
        // Generate daily volumes for scenario 1
        for (let day = 1; day <= days; day++) {
          let dailyVolume;
          if (day <= decayDays) {
            // Exponential decay from initial to final volume over decayDays
            const decayRate = Math.pow(finalVolume / initialVolume, 1 / decayDays);
            dailyVolume = initialVolume * Math.pow(decayRate, day - 1);
          } else {
            // Stable volume after decay period
            dailyVolume = finalVolume;
          }
          volumes.push(dailyVolume);
        }
        
        // Calculate daily sell amounts for each strategy
        for (let day = 0; day < days; day++) {
          const volumeInTokens = volumes[day] / price;
          conservative.push(volumeInTokens * (conservativePctOfVolume / 100));
          moderate.push(volumeInTokens * (moderatePctOfVolume / 100));
          aggressive.push(volumeInTokens * (aggressivePctOfVolume / 100));
        }
        
        // Calculate cumulative tokens sold and USD values for each strategy
        const conservativeCumulative = conservative.reduce((acc, val) => acc + val, 0);
        const moderateCumulative = moderate.reduce((acc, val) => acc + val, 0);
        const aggressiveCumulative = aggressive.reduce((acc, val) => acc + val, 0);
        
        const conservativeValue = conservativeCumulative * price;
        const moderateValue = moderateCumulative * price;
        const aggressiveValue = aggressiveCumulative * price;
        
        // Calculate percentage of personal holding liquidated
        const conservativePctLiquidated = (conservativeCumulative / personalHolding) * 100;
        const moderatePctLiquidated = (moderateCumulative / personalHolding) * 100;
        const aggressivePctLiquidated = (aggressiveCumulative / personalHolding) * 100;
        
        // Calculate days to liquidate half the position
        const daysToHalfConservative = Math.ceil((personalHolding * 0.5) / (conservativeCumulative / days));
        const daysToHalfModerate = Math.ceil((personalHolding * 0.5) / (moderateCumulative / days));
        const daysToHalfAggressive = Math.ceil((personalHolding * 0.5) / (aggressiveCumulative / days));
        
        // Display the summary of scenario 1
        logApi.info(`${fancyColors.BOLD}${fancyColors.INDIGO}6-Month Liquidation Projections:${fancyColors.RESET}`);
        
        // Conservative strategy
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.TEAL}Conservative Strategy (${conservativePctOfVolume}% of daily volume):${fancyColors.RESET}`);
        logApi.info(`${fancyColors.TEAL}• Total Sold in 6 Months:${fancyColors.RESET} ${conservativeCumulative.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${formatPercentage(conservativePctLiquidated)} of position)`);
        logApi.info(`${fancyColors.TEAL}• Total Value:${fancyColors.RESET} ${formatCurrency(conservativeValue)}`);
        logApi.info(`${fancyColors.TEAL}• Days to Liquidate 50%:${fancyColors.RESET} ${daysToHalfConservative}`);
        
        // Moderate strategy
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.GREEN}Moderate Strategy (${moderatePctOfVolume}% of daily volume):${fancyColors.RESET}`);
        logApi.info(`${fancyColors.GREEN}• Total Sold in 6 Months:${fancyColors.RESET} ${moderateCumulative.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${formatPercentage(moderatePctLiquidated)} of position)`);
        logApi.info(`${fancyColors.GREEN}• Total Value:${fancyColors.RESET} ${formatCurrency(moderateValue)}`);
        logApi.info(`${fancyColors.GREEN}• Days to Liquidate 50%:${fancyColors.RESET} ${daysToHalfModerate}`);
        
        // Aggressive strategy
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.ORANGE}Aggressive Strategy (${aggressivePctOfVolume}% of daily volume):${fancyColors.RESET}`);
        logApi.info(`${fancyColors.ORANGE}• Total Sold in 6 Months:${fancyColors.RESET} ${aggressiveCumulative.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${formatPercentage(aggressivePctLiquidated)} of position)`);
        logApi.info(`${fancyColors.ORANGE}• Total Value:${fancyColors.RESET} ${formatCurrency(aggressiveValue)}`);
        logApi.info(`${fancyColors.ORANGE}• Days to Liquidate 50%:${fancyColors.RESET} ${daysToHalfAggressive}`);
        
        // Scenario 2: Take-off Case
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.BG_GREEN}${fancyColors.BLACK} SCENARIO 2: TAKE-OFF CASE - VOLUME GROWTH ${fancyColors.RESET}`);
        logApi.info(`${fancyColors.GREEN}• Initial volume: $10M, dip to $5M, then growth to $20M over 30 days${fancyColors.RESET}`);
        
        // Reset arrays for scenario 2
        volumes = [];
        conservative = [];
        moderate = [];
        aggressive = [];
        
        // Model period 1: Initial volume to dip
        const initialDays = 7;
        const lowestVolume = 5000000; // $5M dip
        
        // Model period 2: Growth to peak
        const growthDays = 30; 
        const peakVolume = 20000000; // $20M peak
        
        // Generate volumes for scenario 2
        for (let day = 1; day <= days; day++) {
          let dailyVolume;
          
          if (day <= initialDays) {
            // Initial decay from launch to lowest point
            const decayRate = Math.pow(lowestVolume / initialVolume, 1 / initialDays);
            dailyVolume = initialVolume * Math.pow(decayRate, day - 1);
          } else if (day <= initialDays + growthDays) {
            // Growth phase
            const growthDay = day - initialDays;
            const growthRate = Math.pow(peakVolume / lowestVolume, 1 / growthDays);
            dailyVolume = lowestVolume * Math.pow(growthRate, growthDay);
          } else {
            // Stable at peak volume
            dailyVolume = peakVolume;
          }
          
          volumes.push(dailyVolume);
        }
        
        // Calculate daily sell amounts for each strategy
        for (let day = 0; day < days; day++) {
          const volumeInTokens = volumes[day] / price;
          conservative.push(volumeInTokens * (conservativePctOfVolume / 100));
          moderate.push(volumeInTokens * (moderatePctOfVolume / 100));
          aggressive.push(volumeInTokens * (aggressivePctOfVolume / 100));
        }
        
        // Calculate cumulative tokens sold and USD values for each strategy
        const conservativeCumulative2 = conservative.reduce((acc, val) => acc + val, 0);
        const moderateCumulative2 = moderate.reduce((acc, val) => acc + val, 0);
        const aggressiveCumulative2 = aggressive.reduce((acc, val) => acc + val, 0);
        
        const conservativeValue2 = conservativeCumulative2 * price;
        const moderateValue2 = moderateCumulative2 * price;
        const aggressiveValue2 = aggressiveCumulative2 * price;
        
        // Calculate percentage of personal holding liquidated
        const conservativePctLiquidated2 = (conservativeCumulative2 / personalHolding) * 100;
        const moderatePctLiquidated2 = (moderateCumulative2 / personalHolding) * 100;
        const aggressivePctLiquidated2 = (aggressiveCumulative2 / personalHolding) * 100;
        
        // Calculate days to liquidate half the position
        const daysToHalfConservative2 = Math.ceil((personalHolding * 0.5) / (conservativeCumulative2 / days));
        const daysToHalfModerate2 = Math.ceil((personalHolding * 0.5) / (moderateCumulative2 / days));
        const daysToHalfAggressive2 = Math.ceil((personalHolding * 0.5) / (aggressiveCumulative2 / days));
        
        // Display the summary of scenario 2
        logApi.info(`${fancyColors.BOLD}${fancyColors.GREEN}6-Month Liquidation Projections:${fancyColors.RESET}`);
        
        // Conservative strategy
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.TEAL}Conservative Strategy (${conservativePctOfVolume}% of daily volume):${fancyColors.RESET}`);
        logApi.info(`${fancyColors.TEAL}• Total Sold in 6 Months:${fancyColors.RESET} ${conservativeCumulative2.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${formatPercentage(conservativePctLiquidated2)} of position)`);
        logApi.info(`${fancyColors.TEAL}• Total Value:${fancyColors.RESET} ${formatCurrency(conservativeValue2)}`);
        logApi.info(`${fancyColors.TEAL}• Days to Liquidate 50%:${fancyColors.RESET} ${daysToHalfConservative2}`);
        
        // Moderate strategy
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.GREEN}Moderate Strategy (${moderatePctOfVolume}% of daily volume):${fancyColors.RESET}`);
        logApi.info(`${fancyColors.GREEN}• Total Sold in 6 Months:${fancyColors.RESET} ${moderateCumulative2.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${formatPercentage(moderatePctLiquidated2)} of position)`);
        logApi.info(`${fancyColors.GREEN}• Total Value:${fancyColors.RESET} ${formatCurrency(moderateValue2)}`);
        logApi.info(`${fancyColors.GREEN}• Days to Liquidate 50%:${fancyColors.RESET} ${daysToHalfModerate2}`);
        
        // Aggressive strategy
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.ORANGE}Aggressive Strategy (${aggressivePctOfVolume}% of daily volume):${fancyColors.RESET}`);
        logApi.info(`${fancyColors.ORANGE}• Total Sold in 6 Months:${fancyColors.RESET} ${aggressiveCumulative2.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${formatPercentage(aggressivePctLiquidated2)} of position)`);
        logApi.info(`${fancyColors.ORANGE}• Total Value:${fancyColors.RESET} ${formatCurrency(aggressiveValue2)}`);
        logApi.info(`${fancyColors.ORANGE}• Days to Liquidate 50%:${fancyColors.RESET} ${daysToHalfAggressive2}`);
        
        // Add Bear Case Scenario - if enabled
        if (args.enableBearCase) {
          logApi.info(`\n${fancyColors.BOLD}${fancyColors.BG_RED}${fancyColors.WHITE} SCENARIO: BEAR CASE - LOW VOLUME & PRICE DECLINE ${fancyColors.RESET}`);
          logApi.info(`${fancyColors.RED}• Initial volume: $5M, rapidly dropping to $500K, with continuing price decline${fancyColors.RESET}`);
          
          // Reset arrays for scenario 3
          volumes = [];
          conservative = [];
          moderate = [];
          aggressive = [];
          
          // Model the rapid decay for worst case
          const lowInitialVolume = 5000000;    // $5M
          const worstFinalVolume = 500000;     // $500K
          const rapidDecayDays = 7;            // 1 week rapid decay
          
          // Price decline factors (monthly)
          const monthlyPriceDeclineFactors = [0.7, 0.5, 0.3, 0.2, 0.15, 0.1]; // Decreasing by month
          
          // Generate daily volumes and adjust for price decline
          for (let day = 1; day <= days; day++) {
            let dailyVolume;
            
            // Calculate volume decay
            if (day <= rapidDecayDays) {
              // Rapid decay in first week
              const decayRate = Math.pow(worstFinalVolume / lowInitialVolume, 1 / rapidDecayDays);
              dailyVolume = lowInitialVolume * Math.pow(decayRate, day - 1);
            } else {
              // Stable low volume after rapid decay
              dailyVolume = worstFinalVolume;
            }
            
            // Determine which month we're in (0-based)
            const month = Math.min(Math.floor(day / 30), monthlyPriceDeclineFactors.length - 1);
            
            // Apply price decline factor based on month
            const adjustedPrice = price * monthlyPriceDeclineFactors[month];
            
            // Calculate token volume and selling amounts
            const volumeInTokens = dailyVolume / adjustedPrice; // More tokens per $ as price declines
            
            volumes.push(dailyVolume);
            conservative.push(volumeInTokens * (conservativePctOfVolume / 100));
            moderate.push(volumeInTokens * (moderatePctOfVolume / 100));
            aggressive.push(volumeInTokens * (aggressivePctOfVolume / 100));
          }
          
          // Calculate cumulative tokens sold and USD values for each strategy
          // Note: We need to account for declining prices in USD value calculation
          const conservativeCumulative3 = conservative.reduce((acc, val) => acc + val, 0);
          const moderateCumulative3 = moderate.reduce((acc, val) => acc + val, 0);
          const aggressiveCumulative3 = aggressive.reduce((acc, val) => acc + val, 0);
          
          // Calculate USD values with price decline factored in
          let conservativeValue3 = 0;
          let moderateValue3 = 0;
          let aggressiveValue3 = 0;
          
          for (let day = 0; day < days; day++) {
            // Determine which month we're in (0-based)
            const month = Math.min(Math.floor(day / 30), monthlyPriceDeclineFactors.length - 1);
            
            // Apply price decline factor based on month
            const adjustedPrice = price * monthlyPriceDeclineFactors[month];
            
            // Add daily values with adjusted price
            conservativeValue3 += conservative[day] * adjustedPrice;
            moderateValue3 += moderate[day] * adjustedPrice;
            aggressiveValue3 += aggressive[day] * adjustedPrice;
          }
          
          // Calculate percentage of personal holding liquidated
          const conservativePctLiquidated3 = (conservativeCumulative3 / personalHolding) * 100;
          const moderatePctLiquidated3 = (moderateCumulative3 / personalHolding) * 100;
          const aggressivePctLiquidated3 = (aggressiveCumulative3 / personalHolding) * 100;
          
          // Calculate days to liquidate given percentages (accounting for declining price)
          // Since price decline affects token throughput, we'll use a cumulative approach
          let daysToHalfConservative3 = days; // Default to max days
          let daysToHalfModerate3 = days;
          let daysToHalfAggressive3 = days;
          
          // Calculate days to reach 50% liquidation by cumulative sum
          let conservativeCumulativeSum = 0;
          let moderateCumulativeSum = 0;
          let aggressiveCumulativeSum = 0;
          const halfPosition = personalHolding * 0.5;
          
          for (let day = 0; day < days; day++) {
            conservativeCumulativeSum += conservative[day];
            moderateCumulativeSum += moderate[day];
            aggressiveCumulativeSum += aggressive[day];
            
            if (conservativeCumulativeSum >= halfPosition && daysToHalfConservative3 === days) {
              daysToHalfConservative3 = day + 1;
            }
            if (moderateCumulativeSum >= halfPosition && daysToHalfModerate3 === days) {
              daysToHalfModerate3 = day + 1;
            }
            if (aggressiveCumulativeSum >= halfPosition && daysToHalfAggressive3 === days) {
              daysToHalfAggressive3 = day + 1;
            }
          }
          
          // If we didn't reach 50%, indicate that
          if (conservativeCumulativeSum < halfPosition) daysToHalfConservative3 = Number.POSITIVE_INFINITY;
          if (moderateCumulativeSum < halfPosition) daysToHalfModerate3 = Number.POSITIVE_INFINITY;
          if (aggressiveCumulativeSum < halfPosition) daysToHalfAggressive3 = Number.POSITIVE_INFINITY;
          
          // Display the summary of scenario 3
          logApi.info(`${fancyColors.BOLD}${fancyColors.RED}6-Month Liquidation Projections with Declining Price:${fancyColors.RESET}`);
          
          // Conservative strategy
          logApi.info(`\n${fancyColors.BOLD}${fancyColors.RED}Conservative Strategy (${conservativePctOfVolume}% of daily volume):${fancyColors.RESET}`);
          logApi.info(`${fancyColors.RED}• Total Sold in 6 Months:${fancyColors.RESET} ${conservativeCumulative3.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${formatPercentage(conservativePctLiquidated3)} of position)`);
          logApi.info(`${fancyColors.RED}• Total Value:${fancyColors.RESET} ${formatCurrency(conservativeValue3)} ${fancyColors.LIGHT_RED}(affected by price decline)${fancyColors.RESET}`);
          
          if (isFinite(daysToHalfConservative3)) {
            logApi.info(`${fancyColors.RED}• Days to Liquidate 50%:${fancyColors.RESET} ${daysToHalfConservative3}`);
          } else {
            logApi.info(`${fancyColors.RED}• Days to Liquidate 50%:${fancyColors.RESET} ${fancyColors.BOLD_RED}Unable to reach 50% within 6 months${fancyColors.RESET}`);
          }
          
          // Moderate strategy
          logApi.info(`\n${fancyColors.BOLD}${fancyColors.RED}Moderate Strategy (${moderatePctOfVolume}% of daily volume):${fancyColors.RESET}`);
          logApi.info(`${fancyColors.RED}• Total Sold in 6 Months:${fancyColors.RESET} ${moderateCumulative3.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${formatPercentage(moderatePctLiquidated3)} of position)`);
          logApi.info(`${fancyColors.RED}• Total Value:${fancyColors.RESET} ${formatCurrency(moderateValue3)} ${fancyColors.LIGHT_RED}(affected by price decline)${fancyColors.RESET}`);
          
          if (isFinite(daysToHalfModerate3)) {
            logApi.info(`${fancyColors.RED}• Days to Liquidate 50%:${fancyColors.RESET} ${daysToHalfModerate3}`);
          } else {
            logApi.info(`${fancyColors.RED}• Days to Liquidate 50%:${fancyColors.RESET} ${fancyColors.BOLD_RED}Unable to reach 50% within 6 months${fancyColors.RESET}`);
          }
          
          // Aggressive strategy
          logApi.info(`\n${fancyColors.BOLD}${fancyColors.RED}Aggressive Strategy (${aggressivePctOfVolume}% of daily volume):${fancyColors.RESET}`);
          logApi.info(`${fancyColors.RED}• Total Sold in 6 Months:${fancyColors.RESET} ${aggressiveCumulative3.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseSymbol} (${formatPercentage(aggressivePctLiquidated3)} of position)`);
          logApi.info(`${fancyColors.RED}• Total Value:${fancyColors.RESET} ${formatCurrency(aggressiveValue3)} ${fancyColors.LIGHT_RED}(affected by price decline)${fancyColors.RESET}`);
          
          if (isFinite(daysToHalfAggressive3)) {
            logApi.info(`${fancyColors.RED}• Days to Liquidate 50%:${fancyColors.RESET} ${daysToHalfAggressive3}`);
          } else {
            logApi.info(`${fancyColors.RED}• Days to Liquidate 50%:${fancyColors.RESET} ${fancyColors.BOLD_RED}Unable to reach 50% within 6 months${fancyColors.RESET}`);
          }
          
          // Emergency exit strategy for worst case
          logApi.info(`\n${fancyColors.BOLD}${fancyColors.BG_RED}${fancyColors.WHITE} EMERGENCY STRATEGY FOR WORST CASE ${fancyColors.RESET}`);
          logApi.info(`${fancyColors.BOLD_RED}If price dumps significantly in the first few days:${fancyColors.RESET}`);
          logApi.info(`${fancyColors.RED}1. ${fancyColors.BOLD}Immediate Exit:${fancyColors.RESET} Sell 5-10% of position in first 24-48 hours while volume is still high`);
          logApi.info(`${fancyColors.RED}2. ${fancyColors.BOLD}Liquidity Test:${fancyColors.RESET} Place small sell orders (0.5-1% of position) to test actual price impact`);
          logApi.info(`${fancyColors.RED}3. ${fancyColors.BOLD}Set Stop-Loss:${fancyColors.RESET} Determine minimum acceptable price and exit fully if reached`);
          logApi.info(`${fancyColors.RED}4. ${fancyColors.BOLD}Tranche Exit:${fancyColors.RESET} Sell in 10-20 equal portions rather than percent of daily volume`);
        }
        
        // Practical recommendations
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.BG_PURPLE}${fancyColors.WHITE} PRACTICAL SELLING RECOMMENDATIONS ${fancyColors.RESET}`);
        
        // For large positions
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.MAGENTA}Large Position Management Guidelines:${fancyColors.RESET}`);
        logApi.info(`${fancyColors.MAGENTA}• ${fancyColors.BOLD}Daily Maximum:${fancyColors.RESET} Never exceed 5% of daily volume regardless of market conditions`);
        logApi.info(`${fancyColors.MAGENTA}• ${fancyColors.BOLD}Volume-Aware:${fancyColors.RESET} Reduce selling on low volume days (<$2M), increase on high volume days (>$10M)`);
        logApi.info(`${fancyColors.MAGENTA}• ${fancyColors.BOLD}Price Aware:${fancyColors.RESET} Pause selling after 5% price drop, double selling during 10%+ rises`);
        logApi.info(`${fancyColors.MAGENTA}• ${fancyColors.BOLD}Front-Load Strategy:${fancyColors.RESET} Capitalize on high launch volume by selling 20-30% in first month`);
        
        // Optimal timing recommendations
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.PURPLE}Optimal Selling Execution:${fancyColors.RESET}`);
        logApi.info(`${fancyColors.PURPLE}• ${fancyColors.BOLD}Multi-Tranche:${fancyColors.RESET} Split daily sells into 3-4 smaller orders`);
        logApi.info(`${fancyColors.PURPLE}• ${fancyColors.BOLD}Peak Hours:${fancyColors.RESET} Target UTC 14:00-16:00 and 20:00-22:00 (highest global trading volume)`);
        logApi.info(`${fancyColors.PURPLE}• ${fancyColors.BOLD}Use Limit Orders:${fancyColors.RESET} Set slightly below current bid to improve fill likelihood`);
        logApi.info(`${fancyColors.PURPLE}• ${fancyColors.BOLD}Automation:${fancyColors.RESET} Use trading bots/APIs for consistent execution without emotion`);
        
        // Accelerated timeline
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.INDIGO}Accelerated Timeline for 30% Position:${fancyColors.RESET}`);
        logApi.info(`${fancyColors.INDIGO}• ${fancyColors.BOLD}Phase 1 (Month 1):${fancyColors.RESET} Liquidate 20-30% of position (during highest initial volume)`);
        logApi.info(`${fancyColors.INDIGO}• ${fancyColors.BOLD}Phase 2 (Months 2-3):${fancyColors.RESET} Liquidate additional 40-50%, adjust based on market response`);
        logApi.info(`${fancyColors.INDIGO}• ${fancyColors.BOLD}Phase 3 (Months 4-6):${fancyColors.RESET} Complete liquidation of remaining position`);
      } else {
        logApi.info(`${fancyColors.RED}Insufficient data for liquidation analysis. Missing volume, price, supply, or pool reserves.${fancyColors.RESET}`);
      }
      
      // Top pool info
      logApi.info(`\n${fancyColors.BOLD}Top Pool Information:${fancyColors.RESET}`);
      logApi.info(`DEX: ${topPool.dexId}`);
      logApi.info(`Pair: ${topPool.pairAddress}`);
      logApi.info(`Pair Created: ${topPool.pairCreatedAt ? new Date(topPool.pairCreatedAt).toLocaleString() : 'Unknown'}`);
      
      // Detailed liquidity analysis for the top pool
      logApi.info(`\n${fancyColors.BOLD}${fancyColors.CYAN}Detailed Liquidity Analysis (Top Pool):${fancyColors.RESET}`);
      
      // Note: baseReserve, quoteReserve, baseSymbol, quoteSymbol are already extracted earlier
      
      logApi.info(`Base Asset: ${baseReserve?.toLocaleString() || 'N/A'} ${baseSymbol}`);
      logApi.info(`Quote Asset: ${quoteReserve?.toLocaleString() || 'N/A'} ${quoteSymbol}`);
      logApi.info(`Current Price: ${formatCurrency(price, 6)} per ${baseSymbol}`);
    }
    
    // Calculate product constant k
    let k = null;
    if (baseReserve && quoteReserve) {
      k = baseReserve * quoteReserve;
      
      if (!skipLogging) {
        logApi.info(`Pool Constant (k): ${k.toLocaleString()}`);
        
        // Calculate price impact for different SOL amounts
        logApi.info(`\n${fancyColors.BOLD}Estimated Price Impact (Buying ${baseSymbol}):${fancyColors.RESET}`);
        
        const solAmounts = [0.1, 0.5, 1, 5, 10, 25, 50, 100];
        
        solAmounts.forEach(solAmount => {
          // New pool state after trade
          const newQuoteReserve = quoteReserve + solAmount;
          const newBaseReserve = k / newQuoteReserve;
          const tokensReceived = baseReserve - newBaseReserve;
          
          // Calculate price impact correctly using SOL/token prices
          const currentPriceInSol = quoteReserve / baseReserve;
          const newPriceInSol = newQuoteReserve / newBaseReserve;
          const priceImpact = ((newPriceInSol - currentPriceInSol) / currentPriceInSol) * 100;
          
          logApi.info(`${solAmount} ${quoteSymbol} → ${tokensReceived.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseSymbol} (${formatPercentage(priceImpact)} price impact)`);
        });
        
        // Add buying percentage of supply analysis
        if (totalSupply) {
          logApi.info(`\n${fancyColors.BOLD}${fancyColors.TEAL}Price Impact When Buying Percentage of Supply:${fancyColors.RESET}`);
          
          // Define percentages of supply to analyze for buying
          const supplyPercentages = [0.1, 0.5, 1, 2, 5, 10];
          
          // For each percentage, calculate amount and price impact for buying
          supplyPercentages.forEach(percentage => {
            const tokenAmount = totalSupply * (percentage / 100);
            
            // Calculate SOL needed to buy this many tokens
            // For constant product AMM: x*y=k
            // To get 'tokenAmount' tokens from the pool:
            // (baseReserve - tokenAmount) * (quoteReserve + solNeeded) = k
            
            if (tokenAmount >= baseReserve) {
              logApi.info(`${percentage}% of supply (${tokenAmount.toLocaleString()} ${baseSymbol}) → Exceeds available liquidity`);
              return;
            }
            
            // Solving for solNeeded:
            // solNeeded = (k / (baseReserve - tokenAmount)) - quoteReserve
            const newBaseReserve = baseReserve - tokenAmount;
            const solNeeded = (k / newBaseReserve) - quoteReserve;
            
            // Calculate price impact correctly using SOL/token prices
            const currentPriceInSol = quoteReserve / baseReserve;
            const newPriceInSol = (quoteReserve + solNeeded) / newBaseReserve;
            const priceImpact = ((newPriceInSol - currentPriceInSol) / currentPriceInSol) * 100;
            
            // Format the SOL value properly
            const solUsdValue = solNeeded * solPrice;
            
            logApi.info(`${percentage}% of supply (${tokenAmount.toLocaleString()} ${baseSymbol}) → Requires ${solNeeded.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${quoteSymbol} (${formatCurrency(solUsdValue)}) | ${formatPercentage(priceImpact)} price impact`);
          });
        }
        
        // Calculate how much tokens you get for different SOL amounts
        logApi.info(`\n${fancyColors.BOLD}Trading Scenarios:${fancyColors.RESET}`);
      }
      
      // Value in USD
      const sol1 = 1;
      const sol10 = 10;
      const sol100 = 100;
      
      // Calculate tokens received
      const tokensForSol1 = (sol1 * baseReserve) / (quoteReserve + sol1);
      const tokensForSol10 = (sol10 * baseReserve) / (quoteReserve + sol10);
      const tokensForSol100 = (sol100 * baseReserve) / (quoteReserve + sol100);
      
      if (!skipLogging) {
        logApi.info(`${sol1} ${quoteSymbol} (${formatCurrency(sol1 * solPrice)}) → ${tokensForSol1.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseSymbol} (${formatCurrency(tokensForSol1 * price)})`);
        logApi.info(`${sol10} ${quoteSymbol} (${formatCurrency(sol10 * solPrice)}) → ${tokensForSol10.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseSymbol} (${formatCurrency(tokensForSol10 * price)})`);
        logApi.info(`${sol100} ${quoteSymbol} (${formatCurrency(sol100 * solPrice)}) → ${tokensForSol100.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseSymbol} (${formatCurrency(tokensForSol100 * price)})`);
        
        // Liquidity depth analysis - BUYING (price up)
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.BRIGHT_GREEN}Liquidity Depth Analysis (BUYING - Price Up):${fancyColors.RESET}`);
      }
      
      // Calculate how much SOL needed to move price up by X%
      // For constant product x*y=k, to reach target price P':
      // y' = k / (k / (y/x) / P')
      let solFor1Percent = quoteReserve * (0.01 / 0.99);
      let solFor5Percent = quoteReserve * (0.05 / 0.95);
      let solFor10Percent = quoteReserve * (0.10 / 0.90);
      let solFor20Percent = quoteReserve * (0.20 / 0.80);
      
      if (!skipLogging) {
        logApi.info(`${fancyColors.LIGHT_GREEN}SOL needed for +1% price impact:${fancyColors.RESET} ${solFor1Percent.toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL (${formatCurrency(solFor1Percent * solPrice)})`);
        logApi.info(`${fancyColors.GREEN}SOL needed for +5% price impact:${fancyColors.RESET} ${solFor5Percent.toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL (${formatCurrency(solFor5Percent * solPrice)})`);
        logApi.info(`${fancyColors.GREEN}SOL needed for +10% price impact:${fancyColors.RESET} ${solFor10Percent.toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL (${formatCurrency(solFor10Percent * solPrice)})`);
        logApi.info(`${fancyColors.BRIGHT_GREEN}SOL needed for +20% price impact:${fancyColors.RESET} ${solFor20Percent.toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL (${formatCurrency(solFor20Percent * solPrice)})`);
        
        // Liquidity depth analysis - SELLING (price down)
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.BRIGHT_RED}Liquidity Depth Analysis (SELLING - Price Down):${fancyColors.RESET}`);
      }
      
      // Calculate how many tokens needed to move price down by X%
      // When selling tokens, we add to baseReserve and remove from quoteReserve
      // To decrease price by p%, we need to add enough tokens to make:
      // new_price = current_price * (1 - p/100)
      let tokensFor1PercentDown = baseReserve * (0.01 / 0.99);
      let tokensFor5PercentDown = baseReserve * (0.05 / 0.95);
      let tokensFor10PercentDown = baseReserve * (0.10 / 0.90);
      let tokensFor20PercentDown = baseReserve * (0.20 / 0.80);
      
      if (!skipLogging) {
        logApi.info(`${fancyColors.LIGHT_RED}${baseSymbol} needed for -1% price impact:${fancyColors.RESET} ${tokensFor1PercentDown.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseSymbol} (${formatCurrency(tokensFor1PercentDown * price)})`);
        logApi.info(`${fancyColors.RED}${baseSymbol} needed for -5% price impact:${fancyColors.RESET} ${tokensFor5PercentDown.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseSymbol} (${formatCurrency(tokensFor5PercentDown * price)})`);
        logApi.info(`${fancyColors.RED}${baseSymbol} needed for -10% price impact:${fancyColors.RESET} ${tokensFor10PercentDown.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseSymbol} (${formatCurrency(tokensFor10PercentDown * price)})`);
        logApi.info(`${fancyColors.BRIGHT_RED}${baseSymbol} needed for -20% price impact:${fancyColors.RESET} ${tokensFor20PercentDown.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseSymbol} (${formatCurrency(tokensFor20PercentDown * price)})`);
        
        // Static amount price impact analysis - SELLING specific token amounts
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.BRIGHT_RED}Price Impact When Selling Token Amounts:${fancyColors.RESET}`);
        
        // Define standard token amounts to analyze
        const tokenAmounts = [
          100000,
          1000000,
          5000000,
          10000000,
          20000000,
          50000000
        ];
        
        // For each token amount, calculate price impact
        tokenAmounts.forEach(tokenAmount => {
          // Skip if token amount exceeds available pool liquidity
          if (tokenAmount > baseReserve) {
            logApi.info(`${tokenAmount.toLocaleString()} ${baseSymbol} → Exceeds available liquidity`);
            return;
          }
          
          // New pool state after selling tokens
          const newBaseReserve = baseReserve + tokenAmount;
          const newQuoteReserve = k / newBaseReserve;
          const solReceived = quoteReserve - newQuoteReserve;
          
          // Calculate price impact correctly using SOL/token prices
          const currentPriceInSol = quoteReserve / baseReserve;
          const newPriceInSol = newQuoteReserve / newBaseReserve;
          const priceImpact = ((newPriceInSol - currentPriceInSol) / currentPriceInSol) * 100;
          
          // Format the SOL value properly
          const solUsdValue = solReceived * solPrice;
          
          // Display the results with proper formatting
          logApi.info(`${tokenAmount.toLocaleString()} ${baseSymbol} (${formatCurrency(tokenAmount * price)}) → ${solReceived.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${quoteSymbol} (${formatCurrency(solUsdValue)}) | ${formatPercentage(priceImpact)} price impact`);
        });
        
        // Add percentage of supply analysis
        if (totalSupply) {
          logApi.info(`\n${fancyColors.BOLD}${fancyColors.ORANGE}Price Impact When Selling Percentage of Supply:${fancyColors.RESET}`);
          
          // Define percentages of supply to analyze
          const supplyPercentages = [0.1, 0.5, 1, 2, 5, 10];
          
          // For each percentage, calculate amount and price impact
          supplyPercentages.forEach(percentage => {
            const tokenAmount = totalSupply * (percentage / 100);
            
            // Skip if token amount exceeds available pool liquidity
            if (tokenAmount > baseReserve) {
              logApi.info(`${percentage}% of supply (${tokenAmount.toLocaleString()} ${baseSymbol}) → Exceeds available liquidity`);
              return;
            }
            
            // New pool state after selling tokens
            const newBaseReserve = baseReserve + tokenAmount;
            const newQuoteReserve = k / newBaseReserve;
            const solReceived = quoteReserve - newQuoteReserve;
            
            // Calculate price impact - using correct SOL/token price
            const currentPriceInSol = quoteReserve / baseReserve;
            const newPriceInSol = newQuoteReserve / newBaseReserve;
            const priceImpact = ((newPriceInSol - currentPriceInSol) / currentPriceInSol) * 100;
            
            // Format the SOL value properly
            const solUsdValue = solReceived * solPrice;
            
            // Display the results with proper formatting
            logApi.info(`${percentage}% of supply (${tokenAmount.toLocaleString()} ${baseSymbol}) → ${solReceived.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${quoteSymbol} (${formatCurrency(solUsdValue)}) | ${formatPercentage(priceImpact)} price impact`);
          });
        }
      }
      
      // This section handles data collection when skip logging is true
      if (skipLogging && baseReserve && quoteReserve && k) {
        // Define token amounts for data collection
        const tokenAmountsForData = [100000, 1000000, 5000000, 10000000, 20000000, 50000000];
        
        // Process token amounts for data collection silently
        tokenAmountsForData.forEach(tokenAmount => {
          if (tokenAmount > baseReserve) {
            return; // Skip if exceeds liquidity
          }
          
          // Process silently for data collection
          const newBaseReserve = baseReserve + tokenAmount;
          const newQuoteReserve = k / newBaseReserve;
          const solReceived = quoteReserve - newQuoteReserve;
          const currentPriceInSol = quoteReserve / baseReserve;
          const newPriceInSol = newQuoteReserve / newBaseReserve;
          const priceImpact = ((newPriceInSol - currentPriceInSol) / currentPriceInSol) * 100;
        });
      }
    }
    
    // Initialize variables that might be used in conditional blocks
    let volumeToMcapRatio = null;
    let liquidityToMcapRatio = null;
    let solFor1Percent = null;
    let solFor5Percent = null;
    let solFor10Percent = null;
    let solFor20Percent = null;
    let tokensFor1PercentDown = null;
    let tokensFor5PercentDown = null;
    let tokensFor10PercentDown = null;
    let tokensFor20PercentDown = null;
    
    // Calculate key ratios for storage
    if (marketCap && volume24h) {
      volumeToMcapRatio = (volume24h / marketCap) * 100;
    }
    
    if (marketCap && liquidity) {
      liquidityToMcapRatio = (liquidity / marketCap) * 100;
    }
    
    // Ensure we have values for liquidity depth metrics even if they weren't calculated
    // in the display section (which might happen if JSON output was requested)
    if (baseReserve && quoteReserve) {
      // Buy side metrics (if not already calculated)
      if (solFor1Percent === null) solFor1Percent = quoteReserve * (0.01 / 0.99);
      if (solFor5Percent === null) solFor5Percent = quoteReserve * (0.05 / 0.95);
      if (solFor10Percent === null) solFor10Percent = quoteReserve * (0.10 / 0.90);
      if (solFor20Percent === null) solFor20Percent = quoteReserve * (0.20 / 0.80);
      
      // Sell side metrics (if not already calculated)
      if (tokensFor1PercentDown === null) tokensFor1PercentDown = baseReserve * (0.01 / 0.99);
      if (tokensFor5PercentDown === null) tokensFor5PercentDown = baseReserve * (0.05 / 0.95);
      if (tokensFor10PercentDown === null) tokensFor10PercentDown = baseReserve * (0.10 / 0.90);
      if (tokensFor20PercentDown === null) tokensFor20PercentDown = baseReserve * (0.20 / 0.80);
    }
    
    // Store price impact data for selling specific token amounts
    const priceImpactSell = [];
    if (baseReserve && quoteReserve && k) {
      const tokenAmounts = [100000, 1000000, 5000000, 10000000, 20000000, 50000000];
      
      tokenAmounts.forEach(tokenAmount => {
        if (tokenAmount > baseReserve) {
          priceImpactSell.push({
            amount: tokenAmount,
            exceedsLiquidity: true
          });
          return;
        }
        
        const newBaseReserve = baseReserve + tokenAmount;
        const newQuoteReserve = k / newBaseReserve;
        const solReceived = quoteReserve - newQuoteReserve;
        
        // Calculate price impact correctly using SOL/token prices
        const currentPriceInSol = quoteReserve / baseReserve;
        const newPriceInSol = newQuoteReserve / newBaseReserve;
        const priceImpact = ((newPriceInSol - currentPriceInSol) / currentPriceInSol) * 100;
        
        const solValue = solReceived * solPrice;
        
        priceImpactSell.push({
          amount: tokenAmount,
          solReceived,
          usdValue: tokenAmount * price,
          solValue,
          priceImpact,
          exceedsLiquidity: false
        });
      });
    }
    
    // Store price impact data for buying/selling percentage of supply
    const supplyPercentageImpact = {
      buying: [],
      selling: []
    };
    
    // Only calculate if we have total supply information
    if (totalSupply && baseReserve && quoteReserve && k) {
      const supplyPercentages = [0.1, 0.5, 1, 2, 5, 10];
      
      // For selling percentage of supply
      supplyPercentages.forEach(percentage => {
        const tokenAmount = totalSupply * (percentage / 100);
        
        if (tokenAmount > baseReserve) {
          supplyPercentageImpact.selling.push({
            percentage,
            tokenAmount,
            exceedsLiquidity: true
          });
          return;
        }
        
        const newBaseReserve = baseReserve + tokenAmount;
        const newQuoteReserve = k / newBaseReserve;
        const solReceived = quoteReserve - newQuoteReserve;
        
        // Calculate price impact correctly
        const currentPriceInSol = quoteReserve / baseReserve;
        const newPriceInSol = newQuoteReserve / newBaseReserve;
        const priceImpact = ((newPriceInSol - currentPriceInSol) / currentPriceInSol) * 100;
        
        const solValue = solReceived * solPrice;
        
        supplyPercentageImpact.selling.push({
          percentage,
          tokenAmount,
          solReceived,
          usdValue: tokenAmount * price,
          solValue,
          priceImpact,
          exceedsLiquidity: false
        });
      });
      
      // For buying percentage of supply
      supplyPercentages.forEach(percentage => {
        const tokenAmount = totalSupply * (percentage / 100);
        
        if (tokenAmount >= baseReserve) {
          supplyPercentageImpact.buying.push({
            percentage,
            tokenAmount,
            exceedsLiquidity: true
          });
          return;
        }
        
        // Calculate SOL needed
        const newBaseReserve = baseReserve - tokenAmount;
        const solNeeded = (k / newBaseReserve) - quoteReserve;
        
        // Calculate price impact
        const currentPriceInSol = quoteReserve / baseReserve;
        const newPriceInSol = (quoteReserve + solNeeded) / newBaseReserve;
        const priceImpact = ((newPriceInSol - currentPriceInSol) / currentPriceInSol) * 100;
        
        const solValue = solNeeded * solPrice;
        
        supplyPercentageImpact.buying.push({
          percentage,
          tokenAmount,
          solNeeded,
          usdValue: tokenAmount * price,
          solValue,
          priceImpact,
          exceedsLiquidity: false
        });
      });
    }
    
    return {
      // Token info
      address: tokenAddress,
      token: topPool.baseToken?.symbol || tokenInfo?.symbol || 'Unknown',
      name: topPool.baseToken?.name || tokenInfo?.name || 'Unknown',
      price,
      marketCap,
      fdv,
      volume24h,
      liquidity,
      change24h,
      change6h,
      change1h,
      circulatingSupply,
      totalSupply,
      
      // Pool info
      baseReserve,
      quoteReserve,
      baseSymbol,
      quoteSymbol,
      poolCount: poolsData.length,
      poolsData,
      topPool: {
        pairAddress: topPool.pairAddress,
        dex: topPool.dexId,
        pairCreatedAt: topPool.pairCreatedAt
      },
      
      // Derived metrics
      solPrice,
      k,
      volumeToMcapRatio,
      liquidityToMcapRatio,
      
      // Liquidity depth metrics
      solFor1Percent,
      solFor5Percent,
      solFor10Percent,
      solFor20Percent,
      tokensFor1PercentDown,
      tokensFor5PercentDown,
      tokensFor10PercentDown,
      tokensFor20PercentDown,
      priceImpactSell,
      supplyPercentageImpact,
      
      // Metadata
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error(`${fancyColors.RED}Error calculating market metrics:${fancyColors.RESET}`, error);
    return null;
  }
}

// Format results as JSON
function formatResultsAsJson(metrics) {
  if (!metrics) return { success: false, error: "Failed to calculate market metrics" };
  
  // Format pool data for JSON
  const pools = metrics.poolsData.map(pool => ({
    dex: pool.dexId,
    pair: `${pool.baseToken?.symbol || '?'}/${pool.quoteToken?.symbol || '?'}`,
    pairAddress: pool.pairAddress,
    liquidity: safeParseFloat(pool.liquidity?.usd),
    volume24h: safeParseFloat(pool.volume?.h24),
    price: safeParseFloat(pool.priceUsd),
    priceChange: {
      h1: safeParseFloat(pool.priceChange?.h1),
      h6: safeParseFloat(pool.priceChange?.h6),
      h24: safeParseFloat(pool.priceChange?.h24)
    },
    baseReserve: safeParseFloat(pool.liquidity?.base),
    quoteReserve: safeParseFloat(pool.liquidity?.quote)
  }));
  
  // Format token info for JSON
  const tokenInfo = {
    address: metrics.address,
    name: metrics.name,
    symbol: metrics.token,
    price: metrics.price,
    marketCap: metrics.marketCap,
    fullyDilutedValuation: metrics.fdv,
    volume24h: metrics.volume24h,
    liquidity: metrics.liquidity,
    circulatingSupply: metrics.circulatingSupply,
    totalSupply: metrics.totalSupply,
    priceChange: {
      h1: metrics.change1h,
      h6: metrics.change6h,
      h24: metrics.change24h
    }
  };
  
  // Format liquidity metrics for JSON
  const liquidityMetrics = {
    volumeToMarketCapRatio: metrics.volumeToMcapRatio,
    liquidityToMarketCapRatio: metrics.liquidityToMcapRatio,
    poolConstantK: metrics.k,
    solPrice: metrics.solPrice,
    liquidityDepth: {
      buy: {
        percent1: metrics.solFor1Percent,
        percent5: metrics.solFor5Percent,
        percent10: metrics.solFor10Percent,
        percent20: metrics.solFor20Percent
      },
      sell: {
        percent1: metrics.tokensFor1PercentDown,
        percent5: metrics.tokensFor5PercentDown,
        percent10: metrics.tokensFor10PercentDown,
        percent20: metrics.tokensFor20PercentDown
      }
    },
    priceImpact: {
      sellTokenAmounts: metrics.priceImpactSell,
      supplyPercentages: metrics.supplyPercentageImpact
    }
  };
  
  return {
    success: true,
    timestamp: new Date().toISOString(),
    token: tokenInfo,
    topPool: metrics.topPool,
    pools: pools,
    liquidity: liquidityMetrics,
    rawMetrics: metrics // Include raw metrics for complete data access
  };
}

// Main function
async function main() {
  try {
    if (args.outputFormat === 'text') {
      logApi.info(`${fancyColors.BOLD}${fancyColors.GREEN}======= TOKEN MARKET METRICS =======${fancyColors.RESET}`);
    }
    
    // Calculate market metrics (skip logging if JSON output)
    const skipLogging = args.outputFormat === 'json';
    const metrics = await calculateMarketMetrics(TOKEN_ADDRESS, skipLogging);
    
    if (metrics) {
      if (args.outputFormat === 'json') {
        // Format and output as JSON
        const jsonOutput = formatResultsAsJson(metrics);
        console.log(JSON.stringify(jsonOutput, null, 2));
      } else {
        // Normal text output
        logApi.info(`\n${fancyColors.BOLD}${fancyColors.GREEN}Analysis Complete: ${metrics.token} at ${formatCurrency(metrics.price, 6)}${fancyColors.RESET}`);
      }
    } else {
      if (args.outputFormat === 'json') {
        console.log(JSON.stringify({ success: false, error: "Failed to calculate market metrics" }));
      } else {
        logApi.error(`${fancyColors.RED}Failed to calculate market metrics${fancyColors.RESET}`);
      }
    }
    
    process.exit(0);
  } catch (error) {
    // Handle rate limit errors specifically
    if (error.message.includes('Rate limit') || error.message.includes('timed out')) {
      if (args.outputFormat === 'json') {
        console.log(JSON.stringify({ 
          success: false, 
          error: "Rate limit exceeded",
          message: error.message,
          suggestion: "Please wait a few minutes before trying again."
        }));
      } else {
        logApi.error(`\n${fancyColors.RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${fancyColors.RESET}`);
        logApi.error(`${fancyColors.RED}Error: API Rate Limit Exceeded${fancyColors.RESET}`);
        logApi.error(`${fancyColors.YELLOW}${error.message}${fancyColors.RESET}`);
        logApi.error(`${fancyColors.GREEN}Suggestion: Please wait a few minutes before trying again.${fancyColors.RESET}`);
        logApi.error(`${fancyColors.RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${fancyColors.RESET}\n`);
      }
    } else {
      // Handle other errors
      if (args.outputFormat === 'json') {
        console.log(JSON.stringify({ success: false, error: error.message }));
      } else {
        logApi.error(`${fancyColors.RED}Fatal Error:${fancyColors.RESET}`, error);
      }
    }
    process.exit(1);
  }
}

// Run the script
main();