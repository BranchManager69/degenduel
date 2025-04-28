// tests/jupiter-token-tracker.js

/**
 * Jupiter Token Tracker
 * 
 * This script tracks changes in the Jupiter token list over time,
 * allowing you to see which specific token addresses are being added or removed.
 * 
 * Run with: node tests/jupiter-token-tracker.js
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fancyColors } from '../utils/colors.js';

// Configuration
const CONFIG = {
  API_KEY: '5c188838-1d59-4108-aaa3-4bc027cfd3d7',
  CHECK_INTERVAL_SECONDS: 30,
  OUTPUT_DIR: '/tmp/jupiter_token_tracking',
  KEEP_RUNS: 10,
  TOKEN_ENDPOINT: 'https://api.jup.ag/tokens/v1/mints/tradable'
};

// Create output directory if it doesn't exist
if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
  fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
}

// Print header
console.log(`${fancyColors.BG_BLUE}${fancyColors.WHITE} Jupiter Token Tracker ${fancyColors.RESET}`);
console.log(`${fancyColors.YELLOW}Tracking changes every ${CONFIG.CHECK_INTERVAL_SECONDS} seconds${fancyColors.RESET}`);
console.log(`${fancyColors.YELLOW}API Key: ${CONFIG.API_KEY}${fancyColors.RESET}`);
console.log(`${fancyColors.YELLOW}Output directory: ${CONFIG.OUTPUT_DIR}${fancyColors.RESET}`);
console.log("");

let previousTokens = null;
let runCount = 0;

/**
 * Fetch the current Jupiter token list
 * @returns {Promise<string[]>} Array of token addresses
 */
async function fetchTokenList() {
  try {
    console.log(`${fancyColors.BLUE}[${new Date().toLocaleTimeString()}] Fetching token list...${fancyColors.RESET}`);
    
    const response = await axios.get(CONFIG.TOKEN_ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.API_KEY
      }
    });
    
    // Extract just the addresses to save space
    const addresses = response.data.map(token => token.address);
    return addresses;
  } catch (error) {
    console.error(`${fancyColors.RED}Error fetching token list:${fancyColors.RESET}`, error.message);
    return [];
  }
}

/**
 * Find added and removed tokens between two runs
 * @param {string[]} current - Current token addresses
 * @param {string[]} previous - Previous token addresses
 * @returns {Object} Object with added and removed arrays
 */
function findChanges(current, previous) {
  if (!previous) return { added: current, removed: [] };
  
  const currentSet = new Set(current);
  const previousSet = new Set(previous);
  
  // Find added tokens (in current but not in previous)
  const added = current.filter(address => !previousSet.has(address));
  
  // Find removed tokens (in previous but not in current)
  const removed = previous.filter(address => !currentSet.has(address));
  
  return { added, removed };
}

/**
 * Save token addresses to a file
 * @param {string[]} addresses - Token addresses
 * @returns {string} Path to the saved file
 */
function saveTokens(addresses) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '');
  const filePath = path.join(CONFIG.OUTPUT_DIR, `tokens_${timestamp}.json`);
  
  fs.writeFileSync(filePath, JSON.stringify(addresses, null, 2));
  return filePath;
}

/**
 * Clean up old files to save space
 */
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(CONFIG.OUTPUT_DIR)
      .filter(file => file.startsWith('tokens_'))
      .map(file => path.join(CONFIG.OUTPUT_DIR, file));
    
    // Sort by modification time (newest first)
    files.sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
    
    // Delete all but the most recent KEEP_RUNS files
    if (files.length > CONFIG.KEEP_RUNS) {
      const filesToDelete = files.slice(CONFIG.KEEP_RUNS);
      filesToDelete.forEach(file => fs.unlinkSync(file));
    }
  } catch (error) {
    console.error(`${fancyColors.RED}Error cleaning up old files:${fancyColors.RESET}`, error.message);
  }
}

/**
 * Main tracking loop
 */
async function trackTokens() {
  try {
    // Get current tokens
    const currentTokens = await fetchTokenList();
    console.log(`${fancyColors.CYAN}Total tokens: ${currentTokens.length}${fancyColors.RESET}`);
    
    // Save current tokens to file
    const filePath = saveTokens(currentTokens);
    
    // Find changes
    if (previousTokens) {
      const { added, removed } = findChanges(currentTokens, previousTokens);
      
      if (added.length > 0 || removed.length > 0) {
        console.log(`\n${fancyColors.YELLOW}CHANGES DETECTED:${fancyColors.RESET}`);
        
        // Display added tokens
        if (added.length > 0) {
          console.log(`${fancyColors.GREEN}Added ${added.length} new tokens:${fancyColors.RESET}`);
          added.forEach(address => {
            console.log(`${fancyColors.GREEN}+ ${address}${fancyColors.RESET}`);
          });
        }
        
        // Display removed tokens
        if (removed.length > 0) {
          console.log(`${fancyColors.RED}Removed ${removed.length} tokens:${fancyColors.RESET}`);
          removed.forEach(address => {
            console.log(`${fancyColors.RED}- ${address}${fancyColors.RESET}`);
          });
        }
      } else {
        console.log(`${fancyColors.YELLOW}No changes detected${fancyColors.RESET}`);
      }
    } else {
      console.log(`${fancyColors.YELLOW}First run - no comparison available${fancyColors.RESET}`);
    }
    
    // Save current as previous for next run
    previousTokens = currentTokens;
    
    // Clean up old files
    runCount++;
    if (runCount > CONFIG.KEEP_RUNS) {
      cleanupOldFiles();
    }
    
    console.log(`\n${fancyColors.BLUE}Waiting ${CONFIG.CHECK_INTERVAL_SECONDS} seconds for next check...${fancyColors.RESET}`);
    console.log(`${fancyColors.YELLOW}-----------------------------------------------------${fancyColors.RESET}`);
    
    // Schedule next run
    setTimeout(trackTokens, CONFIG.CHECK_INTERVAL_SECONDS * 1000);
  } catch (error) {
    console.error(`${fancyColors.RED}Error in tracking loop:${fancyColors.RESET}`, error);
    
    // Try to recover in the next run
    console.log(`${fancyColors.YELLOW}Attempting to recover in the next run...${fancyColors.RESET}`);
    setTimeout(trackTokens, CONFIG.CHECK_INTERVAL_SECONDS * 1000);
  }
}

// Start tracking
trackTokens();

// Handle graceful exit
process.on('SIGINT', () => {
  console.log(`\n${fancyColors.BG_BLUE}${fancyColors.WHITE} Jupiter Token Tracker Stopped ${fancyColors.RESET}`);
  process.exit(0);
});