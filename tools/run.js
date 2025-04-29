#!/usr/bin/env node

/**
 * DegenDuel Quick Tools Selector
 * 
 * A simple interactive menu to find and run utilities
 * Usage: npm run dd
 */

import readline from 'readline';
import { spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Define color codes
const COLORS = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  CYAN: '\x1b[36m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  RED: '\x1b[31m',
  BG_BLUE: '\x1b[44m',
  BG_GREEN: '\x1b[42m',
};

// Create a readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Define tool categories
const TOOL_CATEGORIES = [
  {
    name: 'Service Status',
    tools: [
      { 
        name: 'Simple Service Status', 
        command: './tools/show-services.sh',
        description: 'Show raw service status data'
      },
      { 
        name: 'Service Status (fancy)', 
        command: './tools/service-monitor.sh',
        description: 'Show formatted service status'
      },
      {
        name: 'Service Status JSON',
        command: './tools/service-monitor.sh --json',
        description: 'Service status in JSON format'
      },
      { 
        name: 'System Health Check', 
        command: 'node tools/system-status/system-status.js',
        description: 'Check for stale services and system health'
      }
    ]
  },
  {
    name: 'Token Tools',
    tools: [
      { 
        name: 'Token Summary', 
        command: 'npm run summary',
        description: 'Token data summary report'
      },
      { 
        name: 'Pool Debug', 
        command: 'npm run pools-debug',
        description: 'Debug token pools'
      },
      { 
        name: 'Pool Listener', 
        command: 'npm run pool-listener',
        description: 'Real-time pool monitoring'
      },
      { 
        name: 'Single Token Test', 
        command: 'npm run single-token',
        description: 'Test data for a single token'
      },
      { 
        name: 'Cached Token Test', 
        command: 'npm run cached-token',
        description: 'Test cached token data'
      }
    ]
  },
  {
    name: 'System Tools',
    tools: [
      { 
        name: 'Doctor', 
        command: 'npm run doctor',
        description: 'System diagnostic tool'
      },
      { 
        name: 'Benchmark Runner', 
        command: 'npm run benchmarks',
        description: 'Run performance benchmarks'
      },
      { 
        name: 'System Monitor', 
        command: 'npm run monitor',
        description: 'System monitoring dashboard'
      },
      { 
        name: 'Demo Service Tools', 
        command: './tools/demo-service-tools.sh',
        description: 'Demo of service status tools'
      }
    ]
  },
  {
    name: 'Testing',
    tools: [
      { 
        name: 'Liquidity Simulation', 
        command: 'npm run liq-sim',
        description: 'Simulate liquidity operations'
      },
      { 
        name: 'Token Image Test', 
        command: 'npm run token-image-test',
        description: 'Test token image generation'
      },
      { 
        name: 'Balance Tracking Test', 
        command: 'npm run balance-tracking',
        description: 'Test token balance tracking'
      }
    ]
  },
  {
    name: 'Integrations',
    tools: [
      { 
        name: 'Test Vanity Wallet', 
        command: 'npm run test-vanity',
        description: 'Test vanity wallet generation'
      },
      { 
        name: 'Test Discord Integration', 
        command: 'npm run test-discord',
        description: 'Test Discord integration'
      }
    ]
  }
];

// Utility function to clear screen
function clearScreen() {
  process.stdout.write('\x1Bc');
}

// Function to display the main menu
function displayMainMenu() {
  clearScreen();
  
  console.log(`${COLORS.BG_BLUE}${COLORS.BOLD} DegenDuel Quick Tools ${COLORS.RESET}\n`);
  console.log(`${COLORS.BOLD}Select a category:${COLORS.RESET}\n`);
  
  TOOL_CATEGORIES.forEach((category, index) => {
    console.log(`  ${COLORS.BOLD}${index + 1}.${COLORS.RESET} ${COLORS.CYAN}${category.name}${COLORS.RESET} (${category.tools.length} tools)`);
  });
  
  console.log(`\n  ${COLORS.BOLD}0.${COLORS.RESET} ${COLORS.RED}Exit${COLORS.RESET}`);
  
  console.log(`\n${COLORS.DIM}Enter a number or press Ctrl+C to quit${COLORS.RESET}`);
}

// Function to display tools in a category
function displayCategoryMenu(categoryIndex) {
  clearScreen();
  
  const category = TOOL_CATEGORIES[categoryIndex];
  
  console.log(`${COLORS.BG_BLUE}${COLORS.BOLD} DegenDuel Quick Tools: ${category.name} ${COLORS.RESET}\n`);
  console.log(`${COLORS.BOLD}Select a tool:${COLORS.RESET}\n`);
  
  category.tools.forEach((tool, index) => {
    console.log(`  ${COLORS.BOLD}${index + 1}.${COLORS.RESET} ${COLORS.GREEN}${tool.name}${COLORS.RESET}`);
    console.log(`     ${COLORS.DIM}${tool.description}${COLORS.RESET}`);
    console.log(`     ${COLORS.YELLOW}${tool.command}${COLORS.RESET}\n`);
  });
  
  console.log(`  ${COLORS.BOLD}0.${COLORS.RESET} ${COLORS.BLUE}Back to categories${COLORS.RESET}`);
  
  console.log(`\n${COLORS.DIM}Enter a number or press Ctrl+C to quit${COLORS.RESET}`);
}

// Function to execute a command
function executeCommand(command, toolName) {
  clearScreen();
  console.log(`${COLORS.BG_GREEN}${COLORS.BOLD} Running: ${toolName} ${COLORS.RESET}\n`);
  console.log(`${COLORS.YELLOW}> ${command}${COLORS.RESET}\n`);
  
  // Split the command into parts
  const parts = command.split(' ');
  const cmd = parts[0];
  const args = parts.slice(1);
  
  // Spawn the process
  const child = spawn(cmd, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: true
  });
  
  // Handle process completion
  child.on('close', (code) => {
    console.log(`\n${COLORS.DIM}Process exited with code ${code}${COLORS.RESET}`);
    console.log(`\n${COLORS.BOLD}Press Enter to return to menu${COLORS.RESET}`);
    
    // Wait for user to press Enter
    rl.once('line', () => {
      showMainMenu();
    });
  });
}

// Main menu logic
async function showMainMenu() {
  displayMainMenu();
  
  rl.question(`${COLORS.BOLD}Select category:${COLORS.RESET} `, (answer) => {
    const choice = parseInt(answer, 10);
    
    if (choice === 0) {
      rl.close();
      return;
    }
    
    if (isNaN(choice) || choice < 1 || choice > TOOL_CATEGORIES.length) {
      console.log(`${COLORS.RED}Invalid choice. Press Enter to try again.${COLORS.RESET}`);
      rl.once('line', () => {
        showMainMenu();
      });
      return;
    }
    
    showCategoryMenu(choice - 1);
  });
}

// Category menu logic
function showCategoryMenu(categoryIndex) {
  displayCategoryMenu(categoryIndex);
  
  rl.question(`${COLORS.BOLD}Select tool:${COLORS.RESET} `, (answer) => {
    const choice = parseInt(answer, 10);
    
    if (choice === 0) {
      showMainMenu();
      return;
    }
    
    const category = TOOL_CATEGORIES[categoryIndex];
    
    if (isNaN(choice) || choice < 1 || choice > category.tools.length) {
      console.log(`${COLORS.RED}Invalid choice. Press Enter to try again.${COLORS.RESET}`);
      rl.once('line', () => {
        showCategoryMenu(categoryIndex);
      });
      return;
    }
    
    const selectedTool = category.tools[choice - 1];
    executeCommand(selectedTool.command, selectedTool.name);
  });
}

// Start the application
showMainMenu();

// Handle Ctrl+C
rl.on('SIGINT', () => {
  console.log('\nExiting DegenDuel Quick Tools');
  rl.close();
  process.exit(0);
});