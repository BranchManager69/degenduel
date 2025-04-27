// tests/direct-token-monitor.js

/**
 * This is a test script to monitor a token's price and activity.
 * It uses the Jupiter API and the Helius API for token activities.
 * It also uses the PoolDataManager to get the pool data for the token.
 */

// Comprehensive token monitoring with PoolDataManager, Jupiter for prices and Helius for token activities
import dotenv from 'dotenv';
dotenv.config();

import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import solanaEngine from '../services/solana-engine/index.js';
import jupiterClient from '../services/solana-engine/jupiter-client.js';
import heliusClient from '../services/solana-engine/helius-client.js';
// Import the extended Helius pool tracker with PoolDataManager integration
import heliusPoolTracker from '../services/pool-data-manager/helius-integration.js';
import poolDataManager from '../services/pool-data-manager/index.js';

// Parse command line arguments
const args = process.argv.slice(2);
const TOKEN_ADDRESS = args[0] || "DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump";
const WALLET_ADDRESS = args[1] || "5RbsCTp7Z3ZBs6LRg8cvtZkF1FtAt4GndEtdsWQCzVy8";
const PRICE_CHANGE_THRESHOLD = 0.01; // 0.01% minimum change to log
const POLLING_INTERVAL = 500; // 500ms polling frequency (ultra-fast)

/**
 * Hyper-aggressive token monitor with three monitoring systems:
 * 1. Ultra-fast Jupiter polling (every 500ms)
 * 2. Jupiter callback system (using onPriceUpdate)
 * 3. Helius pool activity tracking for detecting swaps
 */
async function main() {
  try {
    logApi.info(`${fancyColors.GREEN}====== HYPER-AGGRESSIVE TOKEN MONITOR ======${fancyColors.RESET}`);
    logApi.info(`${fancyColors.CYAN}Monitoring token: ${TOKEN_ADDRESS}${fancyColors.RESET}`);
    logApi.info(`${fancyColors.CYAN}Reference wallet: ${WALLET_ADDRESS}${fancyColors.RESET}`);
    logApi.info(`${fancyColors.CYAN}Polling at: ${POLLING_INTERVAL}ms intervals${fancyColors.RESET}`);
    
    // 1. Initialize all services
    await solanaEngine.initialize();
    
    if (!jupiterClient.initialized) {
      await jupiterClient.initialize();
      // Enable Jupiter's internal polling system
      jupiterClient.setAutomaticPolling(true);
    }
    
    if (!heliusClient.initialized) {
      await heliusClient.initialize();
    }
    
    if (!heliusPoolTracker.initialized) {
      await heliusPoolTracker.initialize();
    }
    
    // Ensure pool data is available for token using our new PoolDataManager
    logApi.info(`${fancyColors.BLUE}Fetching pools via PoolDataManager...${fancyColors.RESET}`);
    const poolsData = await poolDataManager.getPoolsForToken(TOKEN_ADDRESS, {
      forceRefresh: true,
      waitForFetch: true
    });
    logApi.info(`${fancyColors.GREEN}✓ Found ${poolsData.length} pools for token via PoolDataManager${fancyColors.RESET}`);
    
    // 2. Get initial token info
    let tokenMetadata = null;
    let tokenSymbol = 'UNKNOWN';
    let tokenName = 'Unknown Token';
    let priceHistory = [];
    
    try {
      const tokenData = await solanaEngine.getTokenData([TOKEN_ADDRESS], { includeDexscreenerData: true });
      if (tokenData && tokenData.length > 0) {
        tokenMetadata = tokenData[0];
        tokenSymbol = tokenMetadata.metadata?.symbol || 'UNKNOWN';
        tokenName = tokenMetadata.metadata?.name || 'Unknown Token';
        
        console.log(`${fancyColors.GREEN}Found token:${fancyColors.RESET} ${tokenName} (${tokenSymbol})`);
        console.log(`${fancyColors.GREEN}Initial price:${fancyColors.RESET} $${tokenMetadata.price?.price || 'N/A'}`);
        
        if (tokenMetadata.price) {
          priceHistory.push({
            price: tokenMetadata.price.price,
            timestamp: Date.now(),
            marketCap: tokenMetadata.price.marketCap,
            volume24h: tokenMetadata.price.volume24h
          });
        }
      }
    } catch (error) {
      console.error(`${fancyColors.RED}Error getting token information:${fancyColors.RESET}`, error.message);
    }
    
    // 3. Set up monitors

    // A. Jupiter price update callback
    console.log(`${fancyColors.BLUE}Setting up Jupiter price callback system...${fancyColors.RESET}`);
    const unsubscribeJupiter = jupiterClient.onPriceUpdate((priceData) => {
      console.log(`${fancyColors.BLUE}⚡ Jupiter callback price update${fancyColors.RESET}`);
      handlePriceUpdate(priceData, TOKEN_ADDRESS, tokenSymbol, tokenName, priceHistory, 'jupiter-callback');
    });
    
    // Subscribe to this specific token
    await jupiterClient.subscribeToPrices([TOKEN_ADDRESS]);
    console.log(`${fancyColors.GREEN}✓ Subscribed to Jupiter price updates for ${tokenSymbol}${fancyColors.RESET}`);
    
    // B. Helius pool tracker for tokens
    logApi.info(`${fancyColors.BLUE}Setting up Helius pool price monitoring with PoolDataManager...${fancyColors.RESET}`);
    
    // First ensure we have fetched pools via PoolDataManager
    try {
      // Use the integration to fetch pools with the manager
      await heliusPoolTracker.fetchPoolsWithManager(TOKEN_ADDRESS, {
        forceRefresh: true,
        waitForFetch: true
      });
      
      logApi.info(`${fancyColors.GREEN}✓ Successfully fetched and injected pools into Helius tracker${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.RED}Error fetching pools with manager: ${error.message}${fancyColors.RESET}`);
    }
    
    // Set up price handler for pool tracker
    const poolPriceHandler = (priceData) => {
      logApi.info(`${fancyColors.MAGENTA}⚡ Helius pool price update${fancyColors.RESET}`);
      if (priceData.price) {
        const jupiterFormat = {
          [TOKEN_ADDRESS]: {
            price: priceData.price,
            marketCap: priceData.marketCap || 0,
            volume24h: priceData.volume24h || 0,
            confidence: priceData.confidence || 0.5,
            source: 'helius-pool-tracker',
            poolAddress: priceData.poolAddress
          }
        };
        handlePriceUpdate(jupiterFormat, TOKEN_ADDRESS, tokenSymbol, tokenName, priceHistory, 'helius-pool');
      }
    };
    
    // Start monitoring pools for token price
    // With our integration, this will now automatically use the PoolDataManager if needed
    await heliusPoolTracker.monitorTokenPrice(TOKEN_ADDRESS, poolPriceHandler);
    logApi.info(`${fancyColors.GREEN}✓ Monitoring liquidity pools for ${tokenSymbol}${fancyColors.RESET}`);
    
    // C. Helius token transfer tracking
    logApi.info(`${fancyColors.BLUE}Setting up Helius token transfer WebSocket...${fancyColors.RESET}`);
    
    // Set up token transfer handler
    heliusClient.onTokenTransfer((transferInfo) => {
      if (transferInfo.tokenAddress === TOKEN_ADDRESS) {
        logApi.info(`\n${fancyColors.BG_PURPLE}${fancyColors.WHITE} TOKEN ACTIVITY DETECTED ${fancyColors.RESET} ${new Date().toLocaleTimeString()}`);
        logApi.info(`${fancyColors.CYAN}Token:${fancyColors.RESET} ${tokenSymbol} (${tokenName})`);
        logApi.info(`${fancyColors.CYAN}Type:${fancyColors.RESET} ${transferInfo.type}`);
        
        if (transferInfo.fromAddress) {
          logApi.info(`${fancyColors.CYAN}From:${fancyColors.RESET} ${transferInfo.fromAddress.slice(0, 10)}...${transferInfo.fromAddress.slice(-10)}`);
        }
        
        if (transferInfo.toAddress) {
          logApi.info(`${fancyColors.CYAN}To:${fancyColors.RESET} ${transferInfo.toAddress.slice(0, 10)}...${transferInfo.toAddress.slice(-10)}`);
        }
        
        if (transferInfo.amount) {
          logApi.info(`${fancyColors.CYAN}Amount:${fancyColors.RESET} ${transferInfo.amount}`);
        }
        
        if (transferInfo.signature) {
          logApi.info(`${fancyColors.CYAN}Transaction:${fancyColors.RESET} ${transferInfo.signature}`);
        }
        
        // When token activity is detected, immediately force-check for new prices
        forceRefreshPrice();
      }
    });
    
    // Subscribe to token transfers via Helius
    await heliusClient.subscribeToTokenTransfers(TOKEN_ADDRESS);
    logApi.info(`${fancyColors.GREEN}✓ Subscribed to token transfer WebSocket for ${tokenSymbol}${fancyColors.RESET}`);
    
    logApi.info(`\n${fancyColors.GREEN}====== PRICE MONITOR ACTIVE ======${fancyColors.RESET}`);
    logApi.info(`Monitoring price updates for ${tokenSymbol} (${TOKEN_ADDRESS})`);
    logApi.info(`Price changes greater than ${PRICE_CHANGE_THRESHOLD}% will be logged.`);
    logApi.info(`\nMonitoring systems active:`);
    logApi.info(`${fancyColors.CYAN}1. Ultra-fast Jupiter polling (${POLLING_INTERVAL}ms)${fancyColors.RESET}`);
    logApi.info(`${fancyColors.CYAN}2. Jupiter callback system${fancyColors.RESET}`);
    logApi.info(`${fancyColors.CYAN}3. Helius pool tracker with PoolDataManager integration${fancyColors.RESET}`);
    logApi.info(`${fancyColors.CYAN}4. Helius token transfer WebSocket${fancyColors.RESET}`);
    logApi.info(`\nPress Ctrl+C to exit`);
    
    // Force refresh price function for use when activity is detected
    async function forceRefreshPrice() {
      try {
        logApi.info(`${fancyColors.YELLOW}🔄 Force refreshing price due to token activity...${fancyColors.RESET}`);
        const prices = await jupiterClient.getPrices([TOKEN_ADDRESS]);
        
        if (prices && prices[TOKEN_ADDRESS]) {
          logApi.info(`${fancyColors.YELLOW}📊 Force refresh price update received${fancyColors.RESET}`);
          handlePriceUpdate(prices, TOKEN_ADDRESS, tokenSymbol, tokenName, priceHistory, 'force-refresh');
        }
      } catch (error) {
        // Ignore errors in force refresh
      }
    }
    
    // D. Ultra-fast price polling (every 500ms)
    logApi.info(`${fancyColors.MAGENTA}🚀 Starting ultra-fast polling (${POLLING_INTERVAL}ms intervals)${fancyColors.RESET}`);
    
    const pollingInterval = setInterval(async () => {
      try {
        const prices = await jupiterClient.getPrices([TOKEN_ADDRESS]);
        
        if (prices && prices[TOKEN_ADDRESS]) {
          handlePriceUpdate(prices, TOKEN_ADDRESS, tokenSymbol, tokenName, priceHistory, 'polling');
        }
      } catch (error) {
        // Ignore errors in high-frequency polling
      }
    }, POLLING_INTERVAL);
    
    // Keep the process running
    process.stdin.resume();
    
    // Handle cleanup on exit
    process.on('SIGINT', async () => {
      logApi.info(`\n${fancyColors.YELLOW}Cleaning up...${fancyColors.RESET}`);
      clearInterval(pollingInterval);
      unsubscribeJupiter(); // Unregister price update handler
      await jupiterClient.unsubscribeFromPrices([TOKEN_ADDRESS]);
      await heliusClient.unsubscribeFromTokenTransfers(TOKEN_ADDRESS);
      logApi.info(`${fancyColors.GREEN}Monitoring stopped.${fancyColors.RESET}`);
      process.exit(0);
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}Fatal error:${fancyColors.RESET}`, error);
    process.exit(1);
  }
}

/**
 * Handle price updates from any source
 * @param {Object} priceData - Price data in Jupiter format
 * @param {string} tokenAddress - The token address
 * @param {string} tokenSymbol - The token symbol
 * @param {string} tokenName - The token name
 * @param {Array} priceHistory - Array of price history points
 * @param {string} [source='unknown'] - Source of the price update
 */
function handlePriceUpdate(priceData, tokenAddress, tokenSymbol, tokenName, priceHistory, source = 'unknown') {
  if (!priceData || !priceData[tokenAddress]) return;
  
  // Extract current price from potentially different formats
  const currentPrice = typeof priceData[tokenAddress] === 'object' 
    ? priceData[tokenAddress].price 
    : priceData[tokenAddress];
    
  if (!currentPrice) return;
  
  // Get extra data if available
  const marketCap = priceData[tokenAddress].marketCap;
  const volume24h = priceData[tokenAddress].volume24h;
  const change24h = priceData[tokenAddress].priceChange24h;
  const confidence = priceData[tokenAddress].confidence;
  const poolAddress = priceData[tokenAddress].poolAddress;
  
  // Get previous price if we have history
  let previousPrice = null;
  if (priceHistory.length > 0) {
    previousPrice = priceHistory[priceHistory.length - 1].price;
  }
  
  // Skip if no actual change - except when it's our first price or from a force refresh
  if (previousPrice === currentPrice && priceHistory.length > 1 && source !== 'force-refresh') {
    return;
  }
  
  // Calculate price change
  let priceChangePercent = 0;
  if (previousPrice && previousPrice > 0) {
    priceChangePercent = ((currentPrice - previousPrice) / previousPrice) * 100;
  }
  
  // Add to history
  priceHistory.push({
    price: currentPrice,
    timestamp: Date.now(),
    marketCap,
    volume24h,
    change24h,
    priceChangePercent,
    source
  });
  
  // Keep history to a reasonable size
  if (priceHistory.length > 100) {
    priceHistory.shift();
  }
  
  // Only log if:
  // 1. It's the first few prices (establish baseline)
  // 2. The change is significant enough
  // 3. It's a force refresh
  // 4. It's from a real-time source like a WebSocket or pool tracker
  const isSignificantChange = Math.abs(priceChangePercent) >= PRICE_CHANGE_THRESHOLD;
  const isFirstFewPrices = priceHistory.length <= 3;
  const isRealTimeSource = source === 'helius-pool' || source === 'jupiter-callback';
  const isForceRefresh = source === 'force-refresh';
  
  if (isSignificantChange || isFirstFewPrices || isForceRefresh || (isRealTimeSource && previousPrice !== currentPrice)) {
    const direction = priceChangePercent >= 0 ? '🟢 UP' : '🔴 DOWN';
    const changeAmount = Math.abs(priceChangePercent).toFixed(4);
    
    // Format the message with different colors based on source
    let sourceColor = fancyColors.WHITE;
    let sourceDisplay = '';
    
    switch(source) {
      case 'polling':
        sourceColor = fancyColors.YELLOW;
        sourceDisplay = '📊 POLLING';
        break;
      case 'jupiter-callback':
        sourceColor = fancyColors.BLUE;
        sourceDisplay = '⚡ JUPITER CALLBACK';
        break;
      case 'helius-pool':
        sourceColor = fancyColors.MAGENTA;
        sourceDisplay = '🌊 HELIUS POOL';
        break;
      case 'force-refresh':
        sourceColor = fancyColors.GREEN;
        sourceDisplay = '🔄 FORCE REFRESH';
        break;
      default:
        sourceColor = fancyColors.WHITE;
        sourceDisplay = '🔍 UNKNOWN';
    }
    
    // Format the message
    logApi.info(`\n${fancyColors.BG_BLUE}${fancyColors.WHITE} PRICE UPDATE ${sourceColor}${sourceDisplay}${fancyColors.RESET} ${new Date().toLocaleTimeString()}`);
    logApi.info(`${fancyColors.CYAN}Token:${fancyColors.RESET} ${tokenSymbol} ${direction} ${changeAmount}%`);
    
    if (previousPrice) {
      logApi.info(`${fancyColors.CYAN}Price:${fancyColors.RESET} $${previousPrice} → $${currentPrice}`);
    } else {
      logApi.info(`${fancyColors.CYAN}Price:${fancyColors.RESET} $${currentPrice}`);
    }
    
    if (marketCap) {
      logApi.info(`${fancyColors.CYAN}Market Cap:${fancyColors.RESET} $${marketCap.toLocaleString()}`);
    }
    
    if (volume24h) {
      logApi.info(`${fancyColors.CYAN}24h Volume:${fancyColors.RESET} $${volume24h.toLocaleString()}`);
    }
    
    if (change24h) {
      const direction24h = change24h >= 0 ? '📈' : '📉';
      logApi.info(`${fancyColors.CYAN}24h Change:${fancyColors.RESET} ${direction24h} ${change24h.toFixed(2)}%`);
    }
    
    if (confidence) {
      // Convert confidence to a 5-star rating for visual display
      const stars = '★'.repeat(Math.round(confidence * 5)) + '☆'.repeat(5 - Math.round(confidence * 5));
      logApi.info(`${fancyColors.CYAN}Confidence:${fancyColors.RESET} ${stars} (${(confidence * 100).toFixed(0)}%)`);
    }
    
    if (poolAddress) {
      logApi.info(`${fancyColors.CYAN}Source Pool:${fancyColors.RESET} ${poolAddress}`);
    }
  }
}

// Run the main function
main().catch(error => {
  logApi.error('Fatal error:', error);
  process.exit(1);
});