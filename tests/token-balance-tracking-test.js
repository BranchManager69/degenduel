// tests/token-balance-tracking-test.js

/**
 * Token Balance Tracking Test
 * 
 * This script demonstrates how to track both SOL and token balances for users
 * using the HeliusBalanceTracker service.
 */

import { logApi } from '../utils/logger-suite/logger.js';
import { heliusBalanceTracker } from '../services/solana-engine/helius-balance-tracker.js';
import { fancyColors } from '../utils/colors.js';
import prisma from '../config/prisma.js';

// testing...
// import discordNotificationService from '../services/discordNotificationService.js';
// how can we send a notification to the discord channel when a user balance changes significantly?

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();
// Import config to get the REAL contract address
import config from '../config/config.js';

// Set up test parameters
// Use the real contract address from config
const DEFAULT_TOKEN_ADDRESS = config.contract_address_real;
// Timeout to automatically end the script after some time
const TEST_TIMEOUT_MS = (60 * 1000) * 5; // 5 minutes

/**
 * Handle SOL balance updates for a user
 * @param {Object} balanceData - Balance update data
 */
function handleSolBalanceUpdate(balanceData) {
  const { walletAddress, balance, oldBalance, lastUpdated, source } = balanceData;
  
  // Format the wallet address for better display
  const shortWallet = `${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`;
  
  // Calculate change if previous balance is available
  let changeText = '';
  if (oldBalance !== undefined) {
    const change = balance - oldBalance;
    const changeSymbol = change > 0 ? '⬆️' : (change < 0 ? '⬇️' : '⟹');
    const changeColor = change > 0 ? fancyColors.GREEN : (change < 0 ? fancyColors.RED : fancyColors.BLUE);
    
    changeText = `${fancyColors.BOLD}${changeColor}${changeSymbol} ${Math.abs(change).toFixed(6)} SOL${fancyColors.RESET}`;
  }
  
  // Log the balance update
  logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SOL BALANCE ${fancyColors.RESET} ${fancyColors.YELLOW}${shortWallet}${fancyColors.RESET}: ${changeText ? changeText + ' → ' : ''}${fancyColors.BOLD}${fancyColors.YELLOW}${balance.toFixed(6)} SOL${fancyColors.RESET} (source: ${source})`);
}

/**
 * Handle token balance updates for a user
 * @param {Object} balanceData - Balance update data
 */
function handleTokenBalanceUpdate(balanceData) {
  const { walletAddress, tokenAddress, balance, oldBalance, lastUpdated, source } = balanceData;
  
  // Format the wallet address for better display
  const shortWallet = `${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`;
  const shortToken = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
  
  // Calculate change if previous balance is available
  let changeText = '';
  if (oldBalance !== undefined) {
    const change = balance - oldBalance;
    const changeSymbol = change > 0 ? '⬆️' : (change < 0 ? '⬇️' : '⟹');
    const changeColor = change > 0 ? fancyColors.GREEN : (change < 0 ? fancyColors.RED : fancyColors.BLUE);
    
    changeText = `${fancyColors.BOLD}${changeColor}${changeSymbol} ${Math.abs(change).toFixed(6)} TOKEN${fancyColors.RESET}`;
  }
  
  // Log the balance update
  logApi.info(`${fancyColors.BG_MAGENTA}${fancyColors.WHITE} TOKEN BALANCE ${fancyColors.RESET} ${fancyColors.YELLOW}${shortWallet}${fancyColors.RESET}: ${changeText ? changeText + ' → ' : ''}${fancyColors.BOLD}${fancyColors.YELLOW}${balance.toFixed(6)} ${shortToken}${fancyColors.RESET} (source: ${source})`);
}

/**
 * Main function to test balance tracking
 */
async function runBalanceTrackingTest() {
  try {
    // Print intro banner
    console.log(`
${fancyColors.BG_CYAN}${fancyColors.WHITE}======================================================${fancyColors.RESET}
${fancyColors.BG_CYAN}${fancyColors.WHITE}              BALANCE TRACKING TEST                   ${fancyColors.RESET}
${fancyColors.BG_CYAN}${fancyColors.WHITE}======================================================${fancyColors.RESET}
    `);
    
    // Initialize the Helius balance tracker
    logApi.info(`${fancyColors.BOLD}${fancyColors.CYAN}Initializing Helius balance tracker...${fancyColors.RESET}`);
    await heliusBalanceTracker.initialize();
    
    // Get users from database
    logApi.info(`${fancyColors.BOLD}${fancyColors.CYAN}Fetching users from database...${fancyColors.RESET}`);
    const users = await prisma.users.findMany({
      where: { is_banned: false },
      select: {
        wallet_address: true,
        nickname: true
      },
      take: 5 // Limit to 5 users for this test
    });
    
    if (users.length === 0) {
      logApi.warn(`${fancyColors.YELLOW}No users found in database. Using fallback wallet address.${fancyColors.RESET}`);
      users.push({
        wallet_address: process.env.BRANCH_MANAGER_WALLET_ADDRESS || 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp',
        nickname: 'TestUser'
      });
    }
    
    logApi.info(`${fancyColors.BOLD}${fancyColors.CYAN}Found ${users.length} user(s) to track${fancyColors.RESET}`);
    
    // Track token to use
    const tokenAddress = DEFAULT_TOKEN_ADDRESS;
    logApi.info(`${fancyColors.BOLD}${fancyColors.CYAN}Using DUEL token: ${tokenAddress}${fancyColors.RESET}`);
    
    // Subscribe to wallet balances
    for (const user of users) {
      const { wallet_address, nickname } = user;
      logApi.info(`${fancyColors.BOLD}${fancyColors.CYAN}Setting up tracking for user: ${nickname || 'Unknown'} (${wallet_address})${fancyColors.RESET}`);
      
      // Subscribe to SOL balance
      await heliusBalanceTracker.subscribeSolanaBalance(wallet_address, handleSolBalanceUpdate);
      
      // Subscribe to token balance
      await heliusBalanceTracker.subscribeTokenBalance(wallet_address, tokenAddress, handleTokenBalanceUpdate);
      
      // Get initial balances
      const solBalance = await heliusBalanceTracker.refreshSolanaBalance(wallet_address);
      const tokenBalance = await heliusBalanceTracker.refreshTokenBalance(wallet_address, tokenAddress);
      
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} SUBSCRIBED ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.CYAN}${nickname || 'Unknown'}${fancyColors.RESET} (${wallet_address}): SOL=${solBalance}, TOKEN=${tokenBalance}`);
    }
    
    // Print info message
    console.log(`
${fancyColors.BG_YELLOW}${fancyColors.BLACK}======================================================${fancyColors.RESET}
${fancyColors.BG_YELLOW}${fancyColors.BLACK}  BALANCE TRACKING ACTIVE - WAITING FOR TRANSACTIONS  ${fancyColors.RESET}
${fancyColors.BG_YELLOW}${fancyColors.BLACK}======================================================${fancyColors.RESET}
${fancyColors.YELLOW}This script will now monitor these wallets for balance changes.
To test it, send SOL or tokens to or from one of the tracked wallets.
Script will automatically exit after ${TEST_TIMEOUT_MS / 1000 / 60} minutes.${fancyColors.RESET}
    `);
    
    // Set up a timeout to end the test after some time
    setTimeout(() => {
      logApi.info(`${fancyColors.BG_RED}${fancyColors.WHITE} TIME LIMIT ${fancyColors.RESET} Test time limit reached. Exiting...`);
      cleanupAndExit();
    }, TEST_TIMEOUT_MS);
    
    // Keep the script running until manually stopped or timeout
    process.on('SIGINT', () => {
      logApi.info(`${fancyColors.BG_RED}${fancyColors.WHITE} INTERRUPTED ${fancyColors.RESET} Test interrupted. Cleaning up...`);
      cleanupAndExit();
    });
  } catch (error) {
    logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} Test failed: ${error.message}`, {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

/**
 * Clean up resources and exit
 */
async function cleanupAndExit() {
  try {
    logApi.info(`${fancyColors.CYAN}Cleaning up resources...${fancyColors.RESET}`);
    
    // Clean up Helius balance tracker
    await heliusBalanceTracker.cleanup();
    
    // Clean up Prisma
    await prisma.$disconnect();
    
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} FINISHED ${fancyColors.RESET} Test completed successfully`);
    process.exit(0);
  } catch (error) {
    logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} Error during cleanup: ${error.message}`);
    process.exit(1);
  }
}

// Run the test
runBalanceTrackingTest();