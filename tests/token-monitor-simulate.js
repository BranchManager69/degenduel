// tests/token-monitor-simulate.js
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

// Token address to monitor (LeBarbie token)
const tokenAddress = "LEBBYGDHzJPcG1pfWvqfXdLDVxpC5oLbYbKMynrnTRd";

// Main function to run the test
async function runTest() {
  try {
    console.log(`${fancyColors.GREEN}====== TOKEN MONITOR SIMULATION TEST ======${fancyColors.RESET}`);
    
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
    
    // Simulate a token purchase
    console.log(`\n${fancyColors.CYAN}Simulating token purchase event...${fancyColors.RESET}`);
    const purchaseInfo = {
      tokenAddress,
      fromAddress: null, // Unknown source (mint or liquidity pool)
      toAddress: "9xty71irZF6KpG8xnBiCRShgd3VLEgaYrs9RXrWzK3C2",
      amount: 1000000000, // 1000 tokens with 9 decimals
      type: "buy",
      signature: "4mBj1QSYUEzSzNft8oQfauhJVHQKUFT1rmfqYxWNdKLHKcwpfGFdY9MpyBvwkLNxZjYM4N5BDtp5c7fS5zXZfpmJ",
      timestamp: Date.now()
    };
    
    // Process the simulated purchase
    tokenMonitorService.handleTokenTransfer(purchaseInfo);
    
    // Wait 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Simulate a token sale
    console.log(`\n${fancyColors.CYAN}Simulating token sale event...${fancyColors.RESET}`);
    const saleInfo = {
      tokenAddress,
      fromAddress: "EXJLegLSXA3Tw4PiwJ7EixKSSS4aNk9VxENc4LZ6goTX",
      toAddress: null, // Unknown destination (burn or liquidity pool)
      amount: 500000000, // 500 tokens with 9 decimals
      type: "sell",
      signature: "3zF7PLkb8rULCCUf7eeEKz4Uag1jDDWQ7hRyLTbYKXU6Hwx9NB5e9t5nCaGiSG6s7kMWe4hWFbKKER9UFJmhPkMN",
      timestamp: Date.now()
    };
    
    // Process the simulated sale
    tokenMonitorService.handleTokenTransfer(saleInfo);
    
    // Wait 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Simulate a token transfer between wallets
    console.log(`\n${fancyColors.CYAN}Simulating token transfer event...${fancyColors.RESET}`);
    const transferInfo = {
      tokenAddress,
      fromAddress: "9xty71irZF6KpG8xnBiCRShgd3VLEgaYrs9RXrWzK3C2",
      toAddress: "EXJLegLSXA3Tw4PiwJ7EixKSSS4aNk9VxENc4LZ6goTX",
      amount: 250000000, // 250 tokens with 9 decimals
      type: "transfer",
      signature: "2tNGCDBxRg1zJRh8Qx51KmpfRvBcT8aCvj12E6nwM9tRxwoTsS3NbXpKgHcpBXrGxjRQGhNm5aSNSKWGUKFBvQ7u",
      timestamp: Date.now()
    };
    
    // Process the simulated transfer
    tokenMonitorService.handleTokenTransfer(transferInfo);
    
    // Wait for 3 seconds to see all notifications
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log(`\n${fancyColors.GREEN}====== SIMULATION COMPLETE ======${fancyColors.RESET}`);
    console.log('To monitor real-time token transfers, use the token-monitor-test.js script.');
    
    process.exit(0);
  } catch (error) {
    console.error(`${fancyColors.RED}ERROR:${fancyColors.RESET}`, error);
    process.exit(1);
  }
}

// Run the test
runTest();