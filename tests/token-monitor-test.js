// tests/token-monitor-test.js
import dotenv from 'dotenv';
dotenv.config();

import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import serviceEvents from '../utils/service-suite/service-events.js';
import { SERVICE_EVENTS } from '../utils/service-suite/service-events.js';
import prisma from '../config/prisma.js';

// Import the service we want to test
import tokenMonitorService from '../services/tokenMonitorService.js';
import discordNotificationService from '../services/discordNotificationService.js';
import solanaEngine from '../services/solana-engine/index.js';
import heliusClient from '../services/solana-engine/helius-client.js';

// Token address to monitor (LeBarbie token)
const tokenAddress = "LEBBYGDHzJPcG1pfWvqfXdLDVxpC5oLbYbKMynrnTRd";

// Main function to run the test
async function runTest() {
  try {
    console.log(`${fancyColors.GREEN}====== TOKEN MONITOR TEST ======${fancyColors.RESET}`);
    
    // Get token info from database
    console.log(`Looking up token information for ${tokenAddress} from the database...`);
    const tokenInfo = await prisma.tokens.findUnique({
      where: { address: tokenAddress }
    });
    
    if (!tokenInfo) {
      console.log(`${fancyColors.RED}Token ${tokenAddress} not found in database${fancyColors.RESET}`);
      console.log("Adding token to database for testing...");
      
      // Insert token into database if not found
      await prisma.tokens.create({
        data: {
          address: tokenAddress,
          name: "LeBarbie",
          symbol: "LEBBY",
          decimals: 9,
          coingecko_id: null,
          is_lp_token: false,
          is_solana_token: true
        }
      });
      
      console.log(`${fancyColors.GREEN}Added LeBarbie token to database${fancyColors.RESET}`);
    } else {
      console.log(`${fancyColors.GREEN}Found token in database: ${tokenInfo.name} (${tokenInfo.symbol})${fancyColors.RESET}`);
    }
    
    // Initialize services
    console.log("Initializing services...");
    
    // Listen for token events
    serviceEvents.on(SERVICE_EVENTS.TOKEN_PURCHASE, (data) => {
      console.log(`${fancyColors.BLUE}TOKEN PURCHASE EVENT:${fancyColors.RESET}`, data);
    });
    
    serviceEvents.on(SERVICE_EVENTS.TOKEN_SALE, (data) => {
      console.log(`${fancyColors.MAGENTA}TOKEN SALE EVENT:${fancyColors.RESET}`, data);
    });
    
    // Initialize Solana Engine first (required for Helius)
    await solanaEngine.initialize();
    
    // Initialize Discord notification service
    await discordNotificationService.initialize();
    
    // Initialize token monitor service
    await tokenMonitorService.initialize();
    
    // Add token to monitor
    await tokenMonitorService.addTokenToMonitor(tokenAddress, {
      token_name: tokenInfo?.name || "LeBarbie",
      token_symbol: tokenInfo?.symbol || "LEBBY",
      decimals: tokenInfo?.decimals || 9,
      monitor_buys: true,
      monitor_sells: true,
      min_transaction_value: 0 // No minimum value for testing
    });
    
    // Get monitored tokens
    const monitoredTokens = tokenMonitorService.getMonitoredTokens();
    console.log(`${fancyColors.GREEN}Monitoring ${monitoredTokens.length} tokens:${fancyColors.RESET}`, monitoredTokens);
    
    // Wait for WebSocket connections
    console.log("Waiting for WebSocket connections to establish...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Get Helius connection status
    const connectionStats = heliusClient.getConnectionStats();
    console.log(`${fancyColors.CYAN}Helius WebSocket connection status:${fancyColors.RESET}`, connectionStats);
    
    console.log(`\n${fancyColors.GREEN}====== TOKEN MONITOR ACTIVE ======${fancyColors.RESET}`);
    console.log(`Monitoring token: ${tokenInfo?.name || "LeBarbie"} (${tokenInfo?.symbol || "LEBBY"})`);
    console.log(`Listening for buy/sell events...`);
    console.log(`\nPress Ctrl+C to exit`);
    
    // Keep the process running
    // The service will automatically emit events when token transfers are detected
    await new Promise(resolve => setTimeout(resolve, 600000)); // 10 minutes
    
  } catch (error) {
    console.error(`${fancyColors.RED}ERROR:${fancyColors.RESET}`, error);
  }
}

// Run the test
runTest().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});