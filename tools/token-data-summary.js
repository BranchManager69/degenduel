// Token Data Summary Script
// Run with: npm run summary
// Enhanced version with custom date ranges and filtering options
//
// Usage: 
//   npm run summary                                   # Standard view with defaults
//   npm run summary -- --days 7                       # Show only last 7 days of data
//   npm run summary -- --sort volume                  # Sort tokens by volume
//   npm run summary -- --limit 20                     # Show top 20 tokens
//   npm run summary -- --new-only                     # Focus on newly added tokens
//   npm run summary -- --metric price                 # Analyze price trends
//   npm run summary -- --export-csv                   # Export data to CSV
//   npm run summary -- --days 7 --new-only --limit 20 # Combine multiple options

import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import boxen from 'boxen';
import gradient from 'gradient-string';
const prisma = new PrismaClient();

// Clear the console at startup
console.clear();

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  days: 30,             // Default to 30 days
  sort: 'market_cap',   // Default sort by market cap 
  limit: 10,            // Default limit for token lists
  newOnly: false,       // Whether to show only new tokens
  exportCsv: false,     // Whether to export data to CSV
  metric: 'all',        // Which metric to analyze (price, volume, liquidity, market_cap, all)
  token: null,          // Specific token symbol to focus on
  address: null,        // Specific token address to focus on
};

// Parse options
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const option = arg.slice(2);
    if (option === 'new-only') {
      options.newOnly = true;
    } else if (option === 'export-csv') {
      options.exportCsv = true;
    } else if (['days', 'sort', 'limit', 'metric', 'token', 'address'].includes(option) && i + 1 < args.length) {
      options[option] = option === 'limit' || option === 'days' 
        ? parseInt(args[i+1], 10) 
        : args[i+1];
      i++;
    }
  }
}

// Validate options
if (isNaN(options.days) || options.days <= 0) options.days = 30;
if (isNaN(options.limit) || options.limit <= 0) options.limit = 10;
if (!['price', 'volume', 'liquidity', 'market_cap', 'all'].includes(options.metric)) options.metric = 'all';

/**
 * Exports token data to CSV file
 */
async function exportTokenData() {
  const fs = require('fs');
  const path = require('path');
  
  // Create directory if it doesn't exist
  const exportDir = path.join(process.cwd(), 'data/exports');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  
  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
  const filename = path.join(exportDir, `token-data-${timestamp}.csv`);
  
  // Get token data
  const tokens = await prisma.tokens.findMany({
    take: 1000, // Export up to 1000 tokens
    include: {
      token_prices: true
    },
    orderBy: [
      { token_prices: { market_cap: 'desc' } }
    ]
  });
  
  // Create CSV header
  const header = 'symbol,name,address,price,volume_24h,liquidity,market_cap,change_24h\n';
  
  // Create CSV rows
  const rows = tokens.map(token => {
    const price = token.token_prices?.price || '';
    const volume = token.token_prices?.volume_24h || '';
    const liquidity = token.token_prices?.liquidity || '';
    const marketCap = token.token_prices?.market_cap || '';
    const change = token.token_prices?.change_24h || '';
    
    return `"${token.symbol || ''}","${token.name || ''}","${token.address}",${price},${volume},${liquidity},${marketCap},${change}`;
  }).join('\n');
  
  // Write to file
  fs.writeFileSync(filename, header + rows);
  
  console.log(chalk.green(`\nExported token data to ${filename}`));
  return filename;
}

/**
 * Analyze token metric trends over time
 */
async function analyzeMetricTrend(metric = 'price', days = 7, limit = 10) {
  const validMetrics = {
    price: 'token_price_history',
    volume: 'token_volume_history',
    liquidity: 'token_liquidity_history',
    market_cap: 'token_market_cap_history'
  };
  
  const tableName = validMetrics[metric];
  if (!tableName) {
    console.log(chalk.red(`Invalid metric: ${metric}`));
    return;
  }
  
  // Different columns based on metric
  let valueColumn;
  switch(metric) {
    case 'price': valueColumn = 'price'; break;
    case 'volume': valueColumn = 'volume_usd'; break;
    case 'liquidity': valueColumn = 'liquidity_usd'; break;
    case 'market_cap': valueColumn = 'market_cap_usd'; break;
  }
  
  // Get trend data for specified metric
  const trendData = await prisma.$queryRaw`
    WITH daily_data AS (
      SELECT 
        token_id,
        DATE_TRUNC('day', timestamp) as day,
        AVG(${prisma.$raw(valueColumn)}) as value
      FROM ${prisma.$raw(tableName)}
      WHERE timestamp > NOW() - INTERVAL '${days} days'
      GROUP BY token_id, DATE_TRUNC('day', timestamp)
    ),
    first_last AS (
      SELECT 
        token_id,
        MIN(day) as first_day,
        MAX(day) as last_day
      FROM daily_data
      GROUP BY token_id
    ),
    first_values AS (
      SELECT 
        d.token_id,
        d.value as first_value
      FROM daily_data d
      JOIN first_last fl ON d.token_id = fl.token_id AND d.day = fl.first_day
    ),
    last_values AS (
      SELECT 
        d.token_id,
        d.value as last_value
      FROM daily_data d
      JOIN first_last fl ON d.token_id = fl.token_id AND d.day = fl.last_day
    ),
    changes AS (
      SELECT 
        fv.token_id,
        fv.first_value,
        lv.last_value,
        CASE 
          WHEN fv.first_value = 0 THEN NULL
          ELSE ((lv.last_value - fv.first_value) / fv.first_value * 100) 
        END as percent_change
      FROM first_values fv
      JOIN last_values lv ON fv.token_id = lv.token_id
      WHERE fv.first_value IS NOT NULL AND lv.last_value IS NOT NULL
    )
    SELECT 
      t.id,
      t.symbol,
      t.name,
      t.address,
      c.first_value,
      c.last_value,
      c.percent_change
    FROM changes c
    JOIN tokens t ON c.token_id = t.id
    ORDER BY ABS(c.percent_change) DESC
    LIMIT ${limit}
  `;
  
  return trendData;
}

/**
 * Get detailed history for a single token
 */
async function getTokenDetailedHistory(tokenId, days = 30) {
  // Get price history
  const priceHistory = await prisma.token_price_history.findMany({
    where: {
      token_id: tokenId,
      timestamp: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
    },
    orderBy: { timestamp: 'asc' }
  });
  
  // Get volume history
  const volumeHistory = await prisma.token_volume_history.findMany({
    where: {
      token_id: tokenId,
      timestamp: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
    },
    orderBy: { timestamp: 'asc' }
  });
  
  // Get liquidity history
  const liquidityHistory = await prisma.token_liquidity_history.findMany({
    where: {
      token_id: tokenId,
      timestamp: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
    },
    orderBy: { timestamp: 'asc' }
  });
  
  // Get market cap history
  const marketCapHistory = await prisma.token_market_cap_history.findMany({
    where: {
      token_id: tokenId,
      timestamp: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
    },
    orderBy: { timestamp: 'asc' }
  });
  
  // Get token info
  const token = await prisma.tokens.findUnique({
    where: { id: tokenId },
    include: { token_prices: true }
  });
  
  return {
    token,
    priceHistory,
    volumeHistory,
    liquidityHistory,
    marketCapHistory
  };
}

/**
 * Show detailed analytics for a specific token
 */
async function showTokenDetails(symbolOrAddress) {
  // Determine if input is likely an address (Solana addresses are base58 encoded and typically longer)
  const isAddress = symbolOrAddress.length > 30;
  
  let token;
  let matchCount = 0;
  
  if (isAddress) {
    // Find the token by address
    token = await prisma.tokens.findFirst({
      where: { 
        address: symbolOrAddress
      },
      include: {
        token_prices: true
      }
    });
    
    if (!token) {
      console.log(chalk.red(`Token with address "${symbolOrAddress}" not found.`));
      return false;
    }
  } else {
    // Find tokens by symbol (could be multiple)
    const tokens = await prisma.tokens.findMany({
      where: { 
        symbol: { 
          equals: symbolOrAddress,
          mode: 'insensitive' // Case-insensitive search
        }
      },
      include: {
        token_prices: true
      },
      orderBy: [
        { token_prices: { market_cap: 'desc' } },
        { token_prices: { volume_24h: 'desc' } }
      ]
    });
    
    matchCount = tokens.length;
    
    if (matchCount === 0) {
      console.log(chalk.red(`Token with symbol "${symbolOrAddress}" not found.`));
      return false;
    } else if (matchCount > 1) {
      // If multiple tokens with same symbol, show a selection menu
      console.log(boxen(
        chalk.bold.yellow(`\n⚠️ MULTIPLE TOKENS WITH SYMBOL "${symbolOrAddress.toUpperCase()}"\n`) +
        chalk.white(`Found ${matchCount} tokens with this symbol. Here are the details:\n`),
        { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'yellow' }
      ));
      
      console.log(chalk.white('Index'.padEnd(8) + 'Symbol'.padEnd(10) + 'Address'.padEnd(50) + 'Market Cap'.padEnd(15) + 'Volume'));
      console.log(chalk.gray('-'.repeat(100)));
      
      tokens.forEach((t, index) => {
        console.log(
          chalk.green(`[${index + 1}]`.padEnd(8)) +
          chalk.yellow(t.symbol.padEnd(10)) +
          chalk.blue(t.address.padEnd(50)) +
          chalk.magenta((t.token_prices?.market_cap || 'N/A').toString().padEnd(15)) +
          chalk.cyan(t.token_prices?.volume_24h || 'N/A')
        );
      });
      
      console.log('\n' + chalk.bold('To view a specific token, use the --address option with the token address:'));
      console.log(chalk.cyan(`npm run summary -- --address ${tokens[0].address}`));
      console.log('\n' + chalk.gray('Defaulting to token with highest market cap...') + '\n');
      
      // Default to the first one (with highest market cap due to ordering)
      token = tokens[0];
    } else {
      // Just one match
      token = tokens[0];
    }
  }
  
  // Create an awesome gradient title
  const title = gradient.pastel.multiline([
    '╔════════════════════════════════════════════════════════════════════════════╗',
    `║                     TOKEN DETAILS: ${token.symbol.toUpperCase().padEnd(32, ' ')} ║`,
    '╚════════════════════════════════════════════════════════════════════════════╝'
  ].join('\n'));
  
  console.log(title);
  
  // Basic token info
  console.log(boxen(
    chalk.bold.cyan('\n📌 TOKEN INFORMATION\n') +
    chalk.white(`Symbol: `) + chalk.yellow(token.symbol) + '\n' +
    chalk.white(`Name: `) + chalk.yellow(token.name || 'N/A') + '\n' +
    chalk.white(`Address: `) + chalk.yellow(token.address) + '\n' +
    (token.mint_authority ? chalk.white(`Mint Authority: `) + chalk.yellow(token.mint_authority) + '\n' : '') +
    (token.decimals ? chalk.white(`Decimals: `) + chalk.yellow(token.decimals) + '\n' : '') +
    (token.created_at ? chalk.white(`Added to DB: `) + chalk.yellow(token.created_at.toLocaleString()) : ''),
    { 
      padding: 1, 
      margin: 1, 
      borderStyle: 'round',
      borderColor: 'cyan',
    }
  ));
  
  // Current price data
  if (token.token_prices) {
    console.log(boxen(
      chalk.bold.green('\n💰 CURRENT MARKET DATA\n') +
      chalk.white(`Price: `) + chalk.yellow(token.token_prices.price || 'N/A') + '\n' +
      chalk.white(`Volume 24h: `) + chalk.yellow(token.token_prices.volume_24h || 'N/A') + '\n' +
      chalk.white(`Liquidity: `) + chalk.yellow(token.token_prices.liquidity || 'N/A') + '\n' +
      chalk.white(`Market Cap: `) + chalk.yellow(token.token_prices.market_cap || 'N/A') + '\n' +
      chalk.white(`Price Change 24h: `) + 
        (token.token_prices.change_24h > 0 ? 
          chalk.green(`+${token.token_prices.change_24h}%`) : 
          chalk.red(`${token.token_prices.change_24h}%`)) + '\n' +
      chalk.white(`Last Updated: `) + chalk.yellow(token.token_prices.updated_at?.toLocaleString() || 'N/A'),
      { 
        padding: 1, 
        margin: 1, 
        borderStyle: 'round',
        borderColor: 'green',
      }
    ));
  }
  
  // Get historical data statistics
  const priceHistoryCount = await prisma.token_price_history.count({
    where: { token_id: token.id }
  });
  
  const volumeHistoryCount = await prisma.token_volume_history.count({
    where: { token_id: token.id }
  });
  
  const liquidityHistoryCount = await prisma.token_liquidity_history.count({
    where: { token_id: token.id }
  });
  
  const marketCapHistoryCount = await prisma.token_market_cap_history.count({
    where: { token_id: token.id }
  });
  
  const rankHistoryCount = await prisma.token_rank_history.count({
    where: { token_id: token.id }
  });
  
  console.log(boxen(
    chalk.bold.magenta('\n📊 HISTORICAL DATA SUMMARY\n') +
    chalk.white(`Price History Entries: `) + chalk.yellow(priceHistoryCount) + '\n' +
    chalk.white(`Volume History Entries: `) + chalk.yellow(volumeHistoryCount) + '\n' +
    chalk.white(`Liquidity History Entries: `) + chalk.yellow(liquidityHistoryCount) + '\n' +
    chalk.white(`Market Cap History Entries: `) + chalk.yellow(marketCapHistoryCount) + '\n' +
    chalk.white(`Rank History Entries: `) + chalk.yellow(rankHistoryCount),
    { 
      padding: 1, 
      margin: 1, 
      borderStyle: 'round',
      borderColor: 'magenta',
    }
  ));
  
  // Get first tracked date
  const firstTracking = await prisma.token_price_history.findFirst({
    where: { token_id: token.id },
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true }
  });
  
  if (firstTracking) {
    const firstDate = firstTracking.timestamp;
    const now = new Date();
    const trackingDays = Math.ceil((now - firstDate) / (1000 * 60 * 60 * 24));
    
    console.log(boxen(
      chalk.bold.blue('\n⏰ TRACKING INFORMATION\n') +
      chalk.white(`First Tracked: `) + chalk.yellow(firstDate.toLocaleString()) + '\n' +
      chalk.white(`Tracking Period: `) + chalk.yellow(`${trackingDays} days`),
      { 
        padding: 1, 
        margin: 1, 
        borderStyle: 'round',
        borderColor: 'blue',
      }
    ));
  }
  
  // Get price trend for selected days
  const priceHistory = await prisma.token_price_history.findMany({
    where: {
      token_id: token.id,
      timestamp: { gte: new Date(Date.now() - options.days * 24 * 60 * 60 * 1000) }
    },
    orderBy: { timestamp: 'asc' }
  });
  
  if (priceHistory.length >= 2) {
    const firstPrice = priceHistory[0].price;
    const lastPrice = priceHistory[priceHistory.length - 1].price;
    const priceChange = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
    
    // Format price trend message with color based on direction
    const trendMessage = parseFloat(priceChange) >= 0 ? 
      chalk.green(`+${priceChange}% (${firstPrice} → ${lastPrice})`) : 
      chalk.red(`${priceChange}% (${firstPrice} → ${lastPrice})`);
    
    console.log(boxen(
      chalk.bold.yellow(`\n📈 ${options.days}-DAY PRICE TREND\n`) +
      chalk.white(`Price Change: `) + trendMessage + '\n' +
      chalk.white(`Data Points: `) + chalk.yellow(priceHistory.length),
      { 
        padding: 1, 
        margin: 1, 
        borderStyle: 'round',
        borderColor: 'yellow',
      }
    ));
  }
  
  // Show daily price data for the last week (or fewer days if specified)
  const dailyPriceData = await prisma.$queryRaw`
    SELECT 
      DATE_TRUNC('day', timestamp) as day,
      AVG(price) as avg_price,
      MIN(price) as min_price,
      MAX(price) as max_price,
      COUNT(*) as entry_count
    FROM token_price_history
    WHERE 
      token_id = ${token.id}
      AND timestamp > NOW() - INTERVAL '${Math.min(options.days, 7)} days'
    GROUP BY DATE_TRUNC('day', timestamp)
    ORDER BY day DESC
  `;
  
  if (dailyPriceData.length > 0) {
    let priceDataContent = chalk.white('Date'.padEnd(12) + 'Avg Price'.padEnd(15) + 'Min Price'.padEnd(15) + 'Max Price'.padEnd(15) + 'Entries') + '\n';
    priceDataContent += chalk.gray('-'.repeat(65)) + '\n';
    
    dailyPriceData.forEach(day => {
      const dateStr = day.day.toISOString().substring(0, 10);
      priceDataContent += 
        chalk.yellow(dateStr.padEnd(12)) + 
        chalk.green(Number(day.avg_price).toFixed(6).padEnd(15)) +
        chalk.blue(Number(day.min_price).toFixed(6).padEnd(15)) +
        chalk.red(Number(day.max_price).toFixed(6).padEnd(15)) +
        chalk.white(Number(day.entry_count).toString()) + '\n';
    });
    
    console.log(boxen(
      chalk.bold.cyan(`\n📅 DAILY PRICE DATA (Last ${Math.min(options.days, 7)} Days)\n`) + priceDataContent,
      { 
        padding: 1, 
        margin: 1, 
        borderStyle: 'round',
        borderColor: 'cyan',
      }
    ));
  }
  
  return true;
}

async function summarizeTokenData() {
  // If token or address option is specified, show detailed view for that token
  if (options.token || options.address) {
    const identifier = options.address || options.token;
    const result = await showTokenDetails(identifier);
    if (result) return; // Exit if token details were displayed successfully
  }

  // Create an awesome gradient title
  const title = gradient.pastel.multiline([
    '╔════════════════════════════════════════════════════════════════════════════╗',
    '║                        DEGENDUEL TOKEN DATABASE SUMMARY                    ║',
    '╚════════════════════════════════════════════════════════════════════════════╝'
  ].join('\n'));
  
  console.log(title);
  
  // Show filtering options if any were applied
  if (options.days !== 30 || options.newOnly || options.metric !== 'all' || options.sort !== 'market_cap' || options.token || options.address) {
    console.log(boxen(
      chalk.bold.white('\n🔍 APPLIED FILTERS\n') +
      (options.days !== 30 ? chalk.cyan(`Time Range: Last ${options.days} days\n`) : '') +
      (options.newOnly ? chalk.cyan(`Showing: New tokens only\n`) : '') +
      (options.metric !== 'all' ? chalk.cyan(`Focusing on: ${options.metric} metric\n`) : '') +
      (options.sort !== 'market_cap' ? chalk.cyan(`Sorted by: ${options.sort}\n`) : '') +
      (options.token ? chalk.cyan(`Token Symbol: ${options.token}\n`) : '') +
      (options.address ? chalk.cyan(`Token Address: ${options.address}\n`) : ''),
      { 
        padding: 1, 
        margin: 1, 
        borderStyle: 'round',
        borderColor: 'blue',
      }
    ));
  }
  
  // Get basic counts
  const tokenCount = await prisma.tokens.count();
  const tokenPriceCount = await prisma.token_prices.count();
  const tokenPriceHistoryCount = await prisma.token_price_history.count();
  
  // History table counts (new tables we just added)
  const volumeHistoryCount = await prisma.token_volume_history.count();
  const liquidityHistoryCount = await prisma.token_liquidity_history.count();
  const marketCapHistoryCount = await prisma.token_market_cap_history.count();
  const rankHistoryCount = await prisma.token_rank_history.count();
  
  console.log(boxen(
    chalk.bold.cyan('\n📊 TABLE COUNTS\n') +
    chalk.white(`Tokens: `) + chalk.yellow(`${tokenCount.toLocaleString()}`) + '\n' +
    chalk.white(`Token Prices: `) + chalk.yellow(`${tokenPriceCount.toLocaleString()}`) + '\n' +
    chalk.white(`Token Price History: `) + chalk.yellow(`${tokenPriceHistoryCount.toLocaleString()}`) + '\n' +
    chalk.white(`Token Volume History: `) + chalk.yellow(`${volumeHistoryCount.toLocaleString()}`) + '\n' +
    chalk.white(`Token Liquidity History: `) + chalk.yellow(`${liquidityHistoryCount.toLocaleString()}`) + '\n' +
    chalk.white(`Token Market Cap History: `) + chalk.yellow(`${marketCapHistoryCount.toLocaleString()}`) + '\n' +
    chalk.white(`Token Rank History: `) + chalk.yellow(`${rankHistoryCount.toLocaleString()}`),
    { 
      padding: 1, 
      margin: 1, 
      borderStyle: 'round',
      borderColor: 'cyan',
    }
  ));
  
  // Get tokens with prices
  const tokensWithPrices = await prisma.token_prices.count({
    where: { price: { not: null } }
  });
  
  // Get tokens with complete data
  const tokensWithCompleteData = await prisma.token_prices.count({
    where: {
      price: { not: null },
      volume_24h: { not: null },
      liquidity: { not: null },
      market_cap: { not: null }
    }
  });
  
  const priceCoverage = Math.round(tokensWithPrices/tokenCount*100);
  const completeCoverage = Math.round(tokensWithCompleteData/tokenCount*100);
  
  console.log(boxen(
    chalk.bold.magenta('\n📈 DATA COVERAGE\n') +
    chalk.white(`Tokens with prices: `) + chalk.yellow(`${tokensWithPrices.toLocaleString()}`) + 
      chalk.gray(` (${priceCoverage}% of total)`) + '\n' +
    chalk.white(`Tokens with complete data: `) + chalk.yellow(`${tokensWithCompleteData.toLocaleString()}`) + 
      chalk.gray(` (${completeCoverage}% of total)`),
    { 
      padding: 1, 
      margin: 1, 
      borderStyle: 'round',
      borderColor: 'magenta',
    }
  ));
  
  // Get most recent price update
  const latestPriceUpdate = await prisma.token_prices.findFirst({
    orderBy: { updated_at: 'desc' },
    select: { updated_at: true }
  });
  
  // Get most recent price history entry
  const latestPriceHistoryEntry = await prisma.token_price_history.findFirst({
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true }
  });
  
  console.log(boxen(
    chalk.bold.green('\n⏱️ LAST UPDATES\n') +
    chalk.white(`Last price update: `) + 
      chalk.yellow(`${latestPriceUpdate?.updated_at?.toLocaleString() || 'None'}`) + '\n' +
    chalk.white(`Last price history entry: `) + 
      chalk.yellow(`${latestPriceHistoryEntry?.timestamp?.toLocaleString() || 'None'}`),
    { 
      padding: 1, 
      margin: 1, 
      borderStyle: 'round',
      borderColor: 'green',
    }
  ));
  
  // Get price history sources breakdown
  const priceHistorySources = await prisma.$queryRaw`
    SELECT source, COUNT(*) as count 
    FROM token_price_history 
    GROUP BY source 
    ORDER BY count DESC`;
  
  let sourcesContent = '';
  if (priceHistorySources.length > 0) {
    sourcesContent = priceHistorySources.map(source => 
      `${chalk.white(source.source || 'None')}: ${chalk.yellow(Number(source.count).toLocaleString())}`
    ).join('\n');
  } else {
    sourcesContent = chalk.gray('No price history sources found');
  }
  
  console.log(boxen(
    chalk.bold.blue('\n🔍 PRICE HISTORY SOURCES\n') + sourcesContent,
    { 
      padding: 1, 
      margin: 1, 
      borderStyle: 'round',
      borderColor: 'blue',
    }
  ));
  
  // Get top 10 tokens based on sort option
  let orderByField;
  switch(options.sort) {
    case 'price':
      orderByField = [{ token_prices: { price: 'desc' } }];
      break;
    case 'volume':
      orderByField = [{ token_prices: { volume_24h: 'desc' } }];
      break;
    case 'market_cap':
    default:
      orderByField = [
        { token_prices: { market_cap: 'desc' } }, 
        { token_prices: { volume_24h: 'desc' } }, 
        { token_prices: { price: 'desc' } }
      ];
  }

  // Get tokens based on query parameters with NO filtering
  const topTokens = await prisma.tokens.findMany({
    take: options.limit,
    include: {
      token_prices: true
    },
    orderBy: orderByField
  });
  
  let tokensContent = '';
  if (topTokens.length > 0) {
    tokensContent = chalk.white('Symbol'.padEnd(10) + 'Price'.padEnd(15) + 'Volume 24h'.padEnd(15) + 'Market Cap'.padEnd(15) + 'Liquidity') + '\n';
    tokensContent += chalk.gray('-'.repeat(65)) + '\n';
    
    topTokens.forEach(token => {
      const price = token.token_prices?.price || 'N/A';
      const volume = token.token_prices?.volume_24h || 'N/A';
      const marketCap = token.token_prices?.market_cap || 'N/A';
      const liquidity = token.token_prices?.liquidity || 'N/A';
      tokensContent += 
        chalk.yellow((token.symbol || '').padEnd(10)) + 
        chalk.green(String(price).padEnd(15)) +
        chalk.cyan(String(volume).padEnd(15)) +
        chalk.magenta(String(marketCap).padEnd(15)) +
        chalk.blue(String(liquidity)) + '\n';
    });
  } else {
    tokensContent = chalk.gray('No tokens found');
  }
  
  // Determine which data fields are available in results
  const hasPrice = topTokens.some(t => t.token_prices?.price !== null && t.token_prices?.price !== undefined);
  const hasVolume = topTokens.some(t => t.token_prices?.volume_24h !== null && t.token_prices?.volume_24h !== undefined);
  const hasMarketCap = topTokens.some(t => t.token_prices?.market_cap !== null && t.token_prices?.market_cap !== undefined);
  const hasLiquidity = topTokens.some(t => t.token_prices?.liquidity !== null && t.token_prices?.liquidity !== undefined);
  
  // Create a note about available data
  const dataNote = chalk.gray(
    `Note: Available data: ${[
      hasPrice ? 'Price ✓' : 'Price ✗',
      hasVolume ? 'Volume ✓' : 'Volume ✗',
      hasMarketCap ? 'Market Cap ✓' : 'Market Cap ✗',
      hasLiquidity ? 'Liquidity ✓' : 'Liquidity ✗'
    ].join(', ')}`
  );
  
  console.log(boxen(
    chalk.bold.yellow(`\n🏆 TOP ${options.limit} TOKENS\n`) + tokensContent + '\n' + dataNote,
    { 
      padding: 1, 
      margin: 1, 
      borderStyle: 'round',
      borderColor: 'yellow',
    }
  ));
  
  // Display the focused metric trend if requested
  if (options.metric !== 'all') {
    const trendData = await analyzeMetricTrend(options.metric, options.days, options.limit);
    
    if (trendData && trendData.length > 0) {
      let trendContent = '';
      const metricDisplayName = options.metric.replace('_', ' ').toUpperCase();
      
      trendContent = chalk.white('Symbol'.padEnd(10) + 'Start Value'.padEnd(15) + 'End Value'.padEnd(15) + 'Change %') + '\n';
      trendContent += chalk.gray('-'.repeat(50)) + '\n';
      
      trendData.forEach(token => {
        const startValue = parseFloat(token.first_value);
        const endValue = parseFloat(token.last_value);
        const changePercent = parseFloat(token.percent_change);
        
        // Color code based on change direction
        const changeColor = changePercent > 0 ? chalk.green : chalk.red;
        
        trendContent += 
          chalk.yellow(token.symbol?.padEnd(10) || 'N/A'.padEnd(10)) + 
          chalk.blue(startValue.toFixed(4).padEnd(15)) +
          chalk.blue(endValue.toFixed(4).padEnd(15)) +
          changeColor(`${changePercent.toFixed(2)}%`) + '\n';
      });
      
      console.log(boxen(
        chalk.bold.magenta(`\n📊 ${metricDisplayName} TREND ANALYSIS (${options.days} DAYS)\n`) + trendContent,
        { 
          padding: 1, 
          margin: 1, 
          borderStyle: 'round',
          borderColor: 'magenta',
        }
      ));
    }
  }
  
  // Show tokens with highest historical price changes (top movers)
  const biggestMovers = await prisma.token_prices.findMany({
    where: {
      change_24h: { not: null }
    },
    include: {
      tokens: {
        select: {
          symbol: true,
          address: true
        }
      }
    },
    orderBy: { change_24h: 'desc' },
    take: options.limit
  });
  
  let moversContent = '';
  if (biggestMovers.length > 0) {
    moversContent = chalk.white('Symbol'.padEnd(10) + 'Change 24h'.padEnd(12) + 'Price'.padEnd(15) + 'Volume 24h') + '\n';
    moversContent += chalk.gray('-'.repeat(60)) + '\n';
    
    biggestMovers.forEach(mover => {
      moversContent += 
        chalk.yellow(mover.tokens.symbol?.padEnd(10) || 'N/A'.padEnd(10)) + 
        chalk.green(`${mover.change_24h}%`.padEnd(12)) +
        chalk.blue(String(mover.price).padEnd(15)) +
        chalk.magenta(String(mover.volume_24h || 'N/A')) + '\n';
    });
  } else {
    moversContent = chalk.gray('No price change data found');
  }
  
  console.log(boxen(
    chalk.bold.redBright(`\n🚀 BIGGEST PRICE MOVERS (${options.limit})\n`) + moversContent,
    { 
      padding: 1, 
      margin: 1, 
      borderStyle: 'round',
      borderColor: 'redBright',
    }
  ));
  
  // Check data consistency - tokens with prices but missing from token_prices table
  const tokensWithoutPrices = await prisma.tokens.count({
    where: {
      token_prices: { is: null }
    }
  });
  
  console.log(boxen(
    chalk.bold.redBright('\n🔍 DATA INTEGRITY\n') +
    chalk.white(`Tokens missing price data: `) + chalk.yellow(`${tokensWithoutPrices.toLocaleString()}`),
    { 
      padding: 1, 
      margin: 1, 
      borderStyle: 'round',
      borderColor: 'white',
    }
  ));
  
  // Price history statistics - counts per day for specified range
  const priceHistoryByDay = await prisma.$queryRaw`
    SELECT 
      DATE_TRUNC('day', timestamp) as day,
      COUNT(*) as entries
    FROM token_price_history
    WHERE timestamp > NOW() - INTERVAL '${options.days} days'
    GROUP BY day
    ORDER BY day DESC`;
  
  let historyContent = '';
  if (priceHistoryByDay.length > 0) {
    historyContent = priceHistoryByDay.map(day => 
      `${chalk.white(day.day.toDateString())}: ${chalk.yellow(Number(day.entries).toLocaleString())} entries`
    ).join('\n');
  } else {
    historyContent = chalk.gray(`No price history entries in the last ${options.days} days`);
  }
  
  console.log(boxen(
    chalk.bold.cyan(`\n📅 PRICE HISTORY ENTRIES BY DAY (Last ${options.days} Days)\n`) + historyContent,
    { 
      padding: 1, 
      margin: 1, 
      borderStyle: 'round',
      borderColor: 'cyan',
    }
  ));
  
  // Token timeline visualization
  await generateTokenTimeline();
  
  // If requested, show detailed analysis for a specific token (just use the first token as an example)
  if (options.metric !== 'all' && topTokens.length > 0) {
    const tokenId = topTokens[0].id;
    const tokenSymbol = topTokens[0].symbol;
    
    console.log(boxen(
      chalk.bold.green(`\n🔎 DETAILED ANALYSIS FOR ${tokenSymbol}\n`) +
      chalk.gray('Run with --token [symbol] for specific token analysis'),
      { 
        padding: 1, 
        margin: 1, 
        borderStyle: 'round',
        borderColor: 'green',
      }
    ));
    
    // Get detailed history
    const tokenHistory = await getTokenDetailedHistory(tokenId, options.days);
    
    // Show price history summary
    if (tokenHistory.priceHistory.length > 0) {
      const firstPrice = tokenHistory.priceHistory[0].price;
      const lastPrice = tokenHistory.priceHistory[tokenHistory.priceHistory.length - 1].price;
      const priceChange = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
      const priceChangeColor = parseFloat(priceChange) >= 0 ? chalk.green : chalk.red;
      
      const volumeHistory = tokenHistory.volumeHistory.length > 0;
      const liquidityHistory = tokenHistory.liquidityHistory.length > 0;
      const marketCapHistory = tokenHistory.marketCapHistory.length > 0;
      
      console.log(
        chalk.white(`Price Change (${options.days} days): `) + 
        priceChangeColor(`${priceChange}%`) + 
        ` (${chalk.yellow(firstPrice)} → ${chalk.yellow(lastPrice)})`
      );
      
      if (volumeHistory || liquidityHistory || marketCapHistory) {
        console.log(chalk.white('\nAvailable Metrics:'));
        if (volumeHistory) console.log(chalk.green('✓ Volume History'));
        if (liquidityHistory) console.log(chalk.green('✓ Liquidity History'));
        if (marketCapHistory) console.log(chalk.green('✓ Market Cap History'));
      }
      
      console.log(chalk.gray(`\nDetailed data points: ${tokenHistory.priceHistory.length} entries`));
    } else {
      console.log(chalk.gray(`No detailed history found for ${tokenSymbol} in the last ${options.days} days`));
    }
  }
  
  // Export data to CSV if requested
  if (options.exportCsv) {
    await exportTokenData();
  }
  
  // Final footer
  const footer = gradient.rainbow('──────────────── END OF TOKEN DATABASE SUMMARY ────────────────');
  console.log(footer);
}

/**
 * Generates a timeline visualization showing when tokens were first tracked
 * and their data coverage over time
 */
async function generateTokenTimeline() {
  let timelineQuery = '';
  
  // Apply filtering based on options
  if (options.newOnly) {
    // For new-only option, focus primarily on recently added tokens
    timelineQuery = `
      SELECT t.id, t.symbol, t.address, COUNT(*) as entry_count, 
             MIN(tph.timestamp) as first_tracked,
             MAX(tph.timestamp) as last_tracked
      FROM token_price_history tph
      JOIN tokens t ON tph.token_id = t.id
      WHERE tph.timestamp > NOW() - INTERVAL '${options.days} days'
      GROUP BY t.id, t.symbol, t.address
      ORDER BY MIN(tph.timestamp) DESC
      LIMIT ${options.limit}
    `;
  } else {
    // Get both most-tracked and newest tokens for standard view
    
    // Get the tokens with most data entries
    const topTrackedTokens = await prisma.$queryRaw`
      SELECT t.id, t.symbol, t.address, COUNT(*) as entry_count, 
             MIN(tph.timestamp) as first_tracked,
             MAX(tph.timestamp) as last_tracked
      FROM token_price_history tph
      JOIN tokens t ON tph.token_id = t.id
      GROUP BY t.id, t.symbol, t.address
      ORDER BY COUNT(*) DESC
      LIMIT ${options.limit}
    `;
    
    // Also get the most recently added tokens
    const newestTrackedTokens = await prisma.$queryRaw`
      SELECT t.id, t.symbol, t.address, COUNT(*) as entry_count, 
             MIN(tph.timestamp) as first_tracked,
             MAX(tph.timestamp) as last_tracked
      FROM token_price_history tph
      JOIN tokens t ON tph.token_id = t.id
      GROUP BY t.id, t.symbol, t.address
      ORDER BY MIN(tph.timestamp) DESC
      LIMIT ${Math.min(5, options.limit / 2)}
    `;

    // Execute the timelineQuery if in new-only mode
    let allTrackedTokens = [];
    
    if (options.newOnly) {
      allTrackedTokens = await prisma.$queryRaw(timelineQuery);
    } else {
      // Combine lists, removing duplicates
      allTrackedTokens = [...topTrackedTokens];
      for (const newToken of newestTrackedTokens) {
        if (!allTrackedTokens.some(t => t.id === newToken.id)) {
          allTrackedTokens.push(newToken);
        }
      }
    }
    
    console.log(boxen(
      chalk.bold.blue(`\n📈 TOKEN TRACKING TIMELINE (${options.newOnly ? 'NEW TOKENS ONLY' : 'TOP & NEW TOKENS'})\n`),
      { 
        padding: 1, 
        margin: 1, 
        borderStyle: 'round',
        borderColor: 'blue',
      }
    ));
    
    if (allTrackedTokens.length === 0) {
      console.log(chalk.gray('No token history data found'));
      return;
    }
    
    // Find the global time range for all tokens
    const globalFirstDate = new Date(Math.min(...allTrackedTokens.map(t => t.first_tracked)));
    const globalLastDate = new Date(Math.max(...allTrackedTokens.map(t => t.last_tracked)));
    const totalDays = Math.ceil((globalLastDate - globalFirstDate) / (1000 * 60 * 60 * 24));
    
    // Display the time range
    console.log(chalk.cyan(`Tracking period: ${globalFirstDate.toLocaleString()} to ${globalLastDate.toLocaleString()} (${totalDays} days)\n`));
    
    // Track by day of month for visual simplicity if the range is small
    if (totalDays <= 31) {
      // For each token, create a horizontal bar representing the tracking period
      
      // Sort tokens by first_tracked date to show in chronological order
      const chronologicalTokens = [...allTrackedTokens].sort((a, b) => 
        new Date(a.first_tracked) - new Date(b.first_tracked)
      );
      
      // Tokens from newestTrackedTokens should be highlighted
      const newestTokenIds = new Set(newestTrackedTokens.map(t => t.id));
      
      console.log(chalk.bold('Token tracking by date/time (includes hours for recent tokens):'));
      console.log(chalk.gray('─'.repeat(90)));
      
      // For each token, create a horizontal bar representing the tracking period
      for (const token of chronologicalTokens) {
        // Calculate position on the timeline
        const startDay = Math.floor((token.first_tracked - globalFirstDate) / (1000 * 60 * 60 * 24));
        const trackingDays = Math.ceil((token.last_tracked - token.first_tracked) / (1000 * 60 * 60 * 24));
        
        // Generate the timeline visualization
        let timeline = '';
        for (let i = 0; i < totalDays; i++) {
          if (i < startDay) {
            timeline += chalk.gray('·'); // Period before tracking
          } else if (i < startDay + trackingDays) {
            // Newer tokens are highlighted with a different color
            if (newestTokenIds.has(token.id)) {
              timeline += chalk.blue('█'); // Different color for newer tokens
            } else {
              timeline += chalk.green('█'); // Period with tracking
            }
          } else {
            timeline += chalk.gray('·'); // Period after tracking
          }
        }
        
        // Display the token symbol, address and timeline
        const symbol = token.symbol || token.address.substring(0, 8);
        const firstTrackedDate = new Date(token.first_tracked);
        
        // For tokens added within the last 24 hours, show hours and minutes
        const now = new Date();
        const isVeryRecent = (now - firstTrackedDate) < 24 * 60 * 60 * 1000;
        
        let dateStr;
        if (isVeryRecent) {
          // Format with hours and minutes for very recent tokens
          const hours = firstTrackedDate.getHours().toString().padStart(2, '0');
          const mins = firstTrackedDate.getMinutes().toString().padStart(2, '0');
          dateStr = `${firstTrackedDate.getMonth()+1}/${firstTrackedDate.getDate()} ${hours}:${mins}`;
        } else {
          // Just date for older tokens
          dateStr = `${firstTrackedDate.getMonth()+1}/${firstTrackedDate.getDate()}`;
        }
        
        // Show if it's a newly tracked token
        const isNew = newestTokenIds.has(token.id);
        const tagColor = isNew ? chalk.bgCyan.black(' NEW ') : '';
        const ageHours = Math.round((now - firstTrackedDate) / (60 * 60 * 1000) * 10) / 10;
        const ageTag = isNew ? chalk.cyan(`[${ageHours}h]`) : '';
        
        console.log(
          chalk.yellow(symbol.padEnd(10)) + 
          chalk.white(`${dateStr.padEnd(isVeryRecent ? 12 : 5)}`) +
          chalk.gray(`(${token.entry_count.toString().padEnd(5)} entries) `) + 
          timeline +
          (isNew ? ` ${tagColor} ${ageTag}` : '')
        );
      }
      
      // Add a date scale at the bottom
      let dateScale = '';
      const numMarkers = Math.min(totalDays, 10);
      const markerSpacing = Math.max(1, Math.floor(totalDays / numMarkers));
      
      for (let i = 0; i < totalDays; i += markerSpacing) {
        const date = new Date(globalFirstDate);
        date.setDate(globalFirstDate.getDate() + i);
        const dateMarker = `${date.getMonth()+1}/${date.getDate()}`;
        const padding = Math.max(0, markerSpacing - dateMarker.length);
        dateScale += chalk.cyan(dateMarker) + ' '.repeat(padding);
      }
      
      console.log('\n' + ' '.repeat(25) + dateScale);
      console.log('\n' + chalk.gray('Legend: ') + 
        chalk.gray('·') + ' No data   ' + 
        chalk.green('█') + ' Historical data   ' + 
        chalk.blue('█') + ' Recently added token');
    } else {
      // For longer periods, display a month-by-month heatmap
      
      // Group entries by token and month
      const tokenMonthlyData = await prisma.$queryRaw`
        SELECT 
          t.id, 
          t.symbol,
          TO_CHAR(tph.timestamp, 'YYYY-MM') as month,
          COUNT(*) as entry_count,
          MIN(tph.timestamp) as first_entry
        FROM token_price_history tph
        JOIN tokens t ON tph.token_id = t.id
        WHERE t.id IN (${allTrackedTokens.map(t => t.id).join(',')})
        GROUP BY t.id, t.symbol, TO_CHAR(tph.timestamp, 'YYYY-MM')
        ORDER BY t.id, TO_CHAR(tph.timestamp, 'YYYY-MM')
      `;
      
      // Get list of all months in the range
      const months = [];
      const startDate = new Date(globalFirstDate);
      const endDate = new Date(globalLastDate);
      for (let d = new Date(startDate); d <= endDate; d.setMonth(d.getMonth() + 1)) {
        months.push(d.toISOString().substring(0, 7)); // YYYY-MM format
      }
      
      // Print header with months
      console.log(
        chalk.white('Token'.padEnd(10)) + 
        chalk.white('Entries'.padEnd(10)) + 
        months.map(m => chalk.cyan(m.substring(5))).join(' ') // Only show MM part
      );
      console.log(chalk.gray('-'.repeat(10 + 10 + months.length * 3)));
      
      // For each token, display its monthly data
      let currentTokenId = -1;
      let currentSymbol = '';
      let currentEntryCount = 0;
      let monthData = {};
      
      // Initialize array to store rows
      const rows = [];
      
      // Get the set of newest token IDs
      const newestTokenIds = new Set(newestTrackedTokens.map(t => t.id));
      
      console.log(chalk.bold('Token history by month:'));
      console.log(chalk.gray('─'.repeat(80)));
  
      // Process token monthly data
      for (const record of tokenMonthlyData) {
        // If we've moved to a new token, output the previous one
        if (currentTokenId !== -1 && currentTokenId !== record.id) {
          // Generate the row for the current token
          const isNew = newestTokenIds.has(currentTokenId);
          const firstEntry = new Date(currentFirstEntry);
          const now = new Date();
          const isVeryRecent = (now - firstEntry) < 24 * 60 * 60 * 1000;
          
          let firstEntryStr;
          if (isVeryRecent) {
            // Format with hours and minutes for very recent tokens
            const hours = firstEntry.getHours().toString().padStart(2, '0');
            const mins = firstEntry.getMinutes().toString().padStart(2, '0');
            firstEntryStr = `${firstEntry.getMonth()+1}/${firstEntry.getDate()} ${hours}:${mins}`;
          } else {
            // Just date for older tokens
            firstEntryStr = `${firstEntry.getMonth()+1}/${firstEntry.getDate()}`;
          }
          
          let row = chalk.yellow((currentSymbol || 'Unknown').padEnd(10)) + 
                    chalk.white(firstEntryStr.padEnd(isVeryRecent ? 12 : 12)) +
                    chalk.white(currentEntryCount.toString().padEnd(8));
          
          // Add month-by-month cells
          for (const month of months) {
            const count = monthData[month] || 0;
            if (count === 0) {
              row += chalk.gray('·  ');
            } else if (count < 100) {
              // Color differently for new tokens
              if (isNew) {
                row += chalk.blue('▪  ');
              } else {
                row += chalk.green('▪  ');
              }
            } else if (count < 500) {
              if (isNew) {
                row += chalk.blue('▫  ');
              } else {
                row += chalk.green('▫  ');
              }
            } else {
              if (isNew) {
                row += chalk.blue('█  ');
              } else {
                row += chalk.green('█  ');
              }
            }
          }
          
          // Add NEW tag and age indicator if applicable
          if (isNew) {
            const ageHours = Math.round((now - firstEntry) / (60 * 60 * 1000) * 10) / 10;
            row += ` ${chalk.bgCyan.black(' NEW ')} ${chalk.cyan(`[${ageHours}h]`)}`;
          }
          
          rows.push(row);
          
          // Reset for next token
          monthData = {};
        }
        
        // Store the current token's data
        currentTokenId = record.id;
        currentSymbol = record.symbol || allTrackedTokens.find(t => t.id === record.id)?.address.substring(0, 8) || 'Unknown';
        currentEntryCount = allTrackedTokens.find(t => t.id === record.id)?.entry_count || 0;
        currentFirstEntry = record.first_entry || allTrackedTokens.find(t => t.id === record.id)?.first_tracked;
        monthData[record.month] = record.entry_count;
      }
      
      // Output the last token
      if (currentTokenId !== -1) {
        const isNew = newestTokenIds.has(currentTokenId);
        const firstEntry = new Date(currentFirstEntry);
        const now = new Date();
        const isVeryRecent = (now - firstEntry) < 24 * 60 * 60 * 1000;
        
        let firstEntryStr;
        if (isVeryRecent) {
          // Format with hours and minutes for very recent tokens
          const hours = firstEntry.getHours().toString().padStart(2, '0');
          const mins = firstEntry.getMinutes().toString().padStart(2, '0');
          firstEntryStr = `${firstEntry.getMonth()+1}/${firstEntry.getDate()} ${hours}:${mins}`;
        } else {
          // Just date for older tokens
          firstEntryStr = `${firstEntry.getMonth()+1}/${firstEntry.getDate()}`;
        }
        
        let row = chalk.yellow((currentSymbol || 'Unknown').padEnd(10)) + 
                  chalk.white(firstEntryStr.padEnd(isVeryRecent ? 12 : 12)) +
                  chalk.white(currentEntryCount.toString().padEnd(8));
        
        for (const month of months) {
          const count = monthData[month] || 0;
          if (count === 0) {
            row += chalk.gray('·  ');
          } else if (count < 100) {
            // Color differently for new tokens
            if (isNew) {
              row += chalk.blue('▪  ');
            } else {
              row += chalk.green('▪  ');
            }
          } else if (count < 500) {
            if (isNew) {
              row += chalk.blue('▫  ');
            } else {
              row += chalk.green('▫  ');
            }
          } else {
            if (isNew) {
              row += chalk.blue('█  ');
            } else {
              row += chalk.green('█  ');
            }
          }
        }
        
        // Add NEW tag and age indicator if applicable
        if (isNew) {
          const ageHours = Math.round((now - firstEntry) / (60 * 60 * 1000) * 10) / 10;
          row += ` ${chalk.bgCyan.black(' NEW ')} ${chalk.cyan(`[${ageHours}h]`)}`;
        }
        
        rows.push(row);
      }
      
      // Print the header before we display the rows
      console.log(
        chalk.white('Token'.padEnd(10)) + 
        chalk.white('Date/Time'.padEnd(12)) + 
        chalk.white('Entries'.padEnd(8)) + 
        months.map(m => chalk.cyan(m.substring(5))).join(' ') // Only show MM part
      );
      console.log(chalk.gray('-'.repeat(10 + 12 + 8 + months.length * 3)));
      
      // Display the rows
      for (const row of rows) {
        console.log(row);
      }
      
      // Add a legend
      console.log('\n' + chalk.gray('Legend: ') + 
        chalk.gray('·') + ' No data   ' + 
        chalk.green('▪') + ' <100 entries   ' + 
        chalk.green('▫') + ' <500 entries   ' + 
        chalk.green('█') + ' 500+ entries   ' +
        chalk.blue('█') + ' Recently added token');
    }
  }
}

// Execute the summary function
summarizeTokenData()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Error running summary:', e);
    await prisma.$disconnect();
    process.exit(1);
  });