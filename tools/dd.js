#!/usr/bin/env node

/**
 * DegenDuel Tool Runner (dd.js)
 * 
 * Auto-discovers tools from package.json scripts and executable files
 * Organizes them into categories for easy access
 * 
 * Usage: node tools/dd.js
 */

import readline from 'readline';
import { spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

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

// Known tool categories for smart categorization
const CATEGORIES = {
  'Service': ['service', 'status', 'monitor', 'health', 'system'],
  'Token': ['token', 'pool', 'market', 'dex', 'swap', 'trade'],
  'Testing': ['test', 'debug', 'benchmark', 'check', 'validate'],
  'Wallet': ['wallet', 'balance', 'solana', 'vanity', 'account'],
  'Admin': ['admin', 'manage', 'dashboard', 'control'],
  'Dev': ['dev', 'build', 'lint', 'format', 'generate']
};

// Utility function to clear screen
function clearScreen() {
  process.stdout.write('\x1Bc');
}

// Smart categorization function
function categorizeByName(name) {
  name = name.toLowerCase();
  
  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    for (const keyword of keywords) {
      if (name.includes(keyword)) {
        return category;
      }
    }
  }
  
  return 'Other';
}

// Get a friendly display name from a command name
function getFriendlyName(name) {
  // Remove common prefixes
  let friendly = name.replace(/^(run[-_]|test[-_]|npm[-_]run[-_])/, '');
  
  // Convert kebab/snake case to Title Case
  friendly = friendly
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
    
  return friendly;
}

// Find executable files in a directory
async function findExecutableFiles(directory) {
  try {
    const directoryPath = path.resolve(PROJECT_ROOT, directory);
    
    // Check if directory exists
    try {
      await fs.access(directoryPath);
    } catch (error) {
      return []; // Directory doesn't exist
    }
    
    const allFiles = await fs.readdir(directoryPath, { withFileTypes: true });
    
    const executableFiles = [];
    
    for (const file of allFiles) {
      const filePath = path.join(directory, file.name);
      const fullPath = path.join(directoryPath, file.name);
      
      if (file.isDirectory()) {
        // Skip node_modules and hidden directories
        if (file.name !== 'node_modules' && !file.name.startsWith('.')) {
          const nestedFiles = await findExecutableFiles(filePath);
          executableFiles.push(...nestedFiles);
        }
      } else if (file.isFile()) {
        // Check if file is executable
        try {
          const stats = await fs.stat(fullPath);
          const isExecutable = !!(stats.mode & 0o111); // Check if any execute permission bit is set
          
          if (
            isExecutable || 
            file.name.endsWith('.js') || 
            file.name.endsWith('.sh') ||
            file.name.endsWith('.cjs') ||
            file.name.endsWith('.mjs')
          ) {
            executableFiles.push({
              name: getFriendlyName(file.name.replace(/\.(js|sh|cjs|mjs)$/, '')),
              command: file.name.endsWith('.js') ? `node ${filePath}` : `./${filePath}`,
              path: filePath,
              category: categorizeByName(file.name)
            });
          }
        } catch (error) {
          console.error(`Error checking file ${fullPath}:`, error);
        }
      }
    }
    
    return executableFiles;
  } catch (error) {
    console.error(`Error finding executable files in ${directory}:`, error);
    return [];
  }
}

// Get usage history or create new one if it doesn't exist
async function getUsageHistory() {
  const historyPath = path.join(PROJECT_ROOT, '.dd-history.json');
  try {
    const historyContent = await fs.readFile(historyPath, 'utf8');
    return JSON.parse(historyContent);
  } catch (error) {
    // Create a new history file if it doesn't exist
    const newHistory = { 
      scripts: {},
      knownTools: [],
      lastUpdated: new Date().toISOString()
    };
    await fs.writeFile(historyPath, JSON.stringify(newHistory, null, 2));
    return newHistory;
  }
}

// Update usage history for a script
async function updateUsageHistory(commandName) {
  try {
    const historyPath = path.join(PROJECT_ROOT, '.dd-history.json');
    const history = await getUsageHistory();
    
    // Increment usage count
    if (!history.scripts[commandName]) {
      history.scripts[commandName] = {
        count: 0,
        lastUsed: new Date().toISOString()
      };
    }
    
    history.scripts[commandName].count++;
    history.scripts[commandName].lastUsed = new Date().toISOString();
    history.lastUpdated = new Date().toISOString();
    
    // Write updated history
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('Error updating usage history:', error);
  }
}

// Discover all tools from package.json scripts and executable files
async function discoverTools() {
  try {
    // Read package.json for npm scripts
    const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    
    // Get usage history
    const usageHistory = await getUsageHistory();
    
    // Track current tools to detect new ones
    const currentTools = [];
    const knownTools = usageHistory.knownTools || [];
    const newTools = [];
    
    const npmScripts = [];
    
    // Skip comment entries (entries that start with //) and this tool to avoid loops
    for (const [name, command] of Object.entries(packageJson.scripts || {})) {
      if (!name.startsWith('//') && 
          !name.startsWith('#') && 
          name !== 'dd' &&  // Skip this tool to avoid loops
          !command.includes('tools/dd.js')) { // Skip any variants of this tool
        
        // Track this tool for new tool detection
        const toolId = `npm:${name}`;
        currentTools.push(toolId);
        
        // Check if this is a new tool
        const isNew = !knownTools.includes(toolId);
        if (isNew) {
          newTools.push({
            name: getFriendlyName(name),
            type: 'npm script',
            id: toolId
          });
        }
        
        // Extract namespace from script name (part before colon)
        let namespace = 'General';
        let shortName = name;
        
        if (name.includes(':')) {
          const parts = name.split(':');
          namespace = parts[0].charAt(0).toUpperCase() + parts[0].slice(1); // Capitalize namespace
          shortName = parts.slice(1).join(':');
        }
        
        // Get usage info if available
        const usage = usageHistory.scripts[name] || { count: 0, lastUsed: null };
        
        npmScripts.push({
          name: getFriendlyName(shortName) || getFriendlyName(name),
          command: `npm run ${name}`,
          path: `package.json -> ${name}`,
          category: namespace, // Use namespace as category
          originalName: name, // Keep the original name for usage tracking
          lastModified: usage.lastUsed ? new Date(usage.lastUsed) : new Date(),
          usageCount: usage.count,
          isScript: true,
          isNew: isNew // Flag if this is a new tool
        });
      }
    }
    
    // Scan directories for executable files
    const executablePaths = [
      'tools',
      'scripts',
      'tests'
    ];
    
    const executableFiles = [];
    for (const dir of executablePaths) {
      const files = await findExecutableFiles(dir);
      
      // Filter out this tool to avoid loops
      const filteredFiles = files.filter(file => 
        !file.path.includes('tools/dd.js') && 
        file.command !== 'node tools/dd.js'
      );
      
      // Track each executable file and check if it's new
      for (const file of filteredFiles) {
        const toolId = `file:${file.path}`;
        currentTools.push(toolId);
        
        // Check if this is a new tool
        const isNew = !knownTools.includes(toolId);
        file.isNew = isNew;
        
        if (isNew) {
          newTools.push({
            name: file.name,
            type: 'executable file',
            id: toolId
          });
        }
      }
      
      executableFiles.push(...filteredFiles);
    }
    
    // Get file stats for last modified dates
    for (const file of executableFiles) {
      try {
        const fullPath = path.join(PROJECT_ROOT, file.path);
        const stats = await fs.stat(fullPath);
        file.lastModified = stats.mtime;
        file.isScript = false;
      } catch (error) {
        file.lastModified = new Date();
        file.isScript = false;
      }
    }
    
    // Combine all tools
    const allTools = [...npmScripts, ...executableFiles];
    
    // Organize by category
    const toolsByCategory = {};
    
    // Add "New Tools" category if there are any new tools
    if (newTools.length > 0) {
      toolsByCategory['New Tools'] = allTools.filter(tool => tool.isNew);
      
      // Update the known tools list
      usageHistory.knownTools = currentTools;
      usageHistory.lastUpdated = new Date().toISOString();
      
      // Save the updated history
      const historyPath = path.join(PROJECT_ROOT, '.dd-history.json');
      await fs.writeFile(historyPath, JSON.stringify(usageHistory, null, 2));
    }
    
    // Add a "Recent" category for recently modified files
    toolsByCategory['Recent'] = allTools
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, 15); // Show top 15 most recently modified
      
    // Add a "Frequently Used" category based on usage count
    const frequentlyUsed = allTools
      .filter(tool => tool.usageCount > 0)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10); // Show top 10 most frequently used
      
    if (frequentlyUsed.length > 0) {
      toolsByCategory['Frequently Used'] = frequentlyUsed;
    }
    
    // Organize by regular categories
    for (const tool of allTools) {
      if (!toolsByCategory[tool.category]) {
        toolsByCategory[tool.category] = [];
      }
      toolsByCategory[tool.category].push(tool);
    }
    
    // Sort categories and tools
    const sortedCategories = Object.keys(toolsByCategory).sort((a, b) => {
      // Special categories order:
      // 1. New Tools (if any)
      // 2. Frequently Used (if any)
      // 3. Recent
      // 4. All other categories alphabetically
      if (a === 'New Tools') return -1;
      if (b === 'New Tools') return 1;
      if (a === 'Frequently Used') return -1;
      if (b === 'Frequently Used') return 1;
      if (a === 'Recent') return -1;
      if (b === 'Recent') return 1;
      return a.localeCompare(b);
    });
    
    for (const category of sortedCategories) {
      if (category !== 'Recent') { // Recent is already sorted by date
        toolsByCategory[category].sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    
    return toolsByCategory;
  } catch (error) {
    console.error('Error discovering tools:', error);
    return {};
  }
}

// Function to display the main menu
async function displayMainMenu(toolsByCategory) {
  clearScreen();
  
  console.log(`${COLORS.BG_BLUE}${COLORS.BOLD} DegenDuel Tool Runner (dd) ${COLORS.RESET}\n`);
  console.log(`${COLORS.BOLD}Select a category:${COLORS.RESET}\n`);
  
  const categories = Object.keys(toolsByCategory);
  
  categories.forEach((category, index) => {
    console.log(`  ${COLORS.BOLD}${index + 1}.${COLORS.RESET} ${COLORS.CYAN}${category}${COLORS.RESET} (${toolsByCategory[category].length} tools)`);
  });
  
  console.log(`\n  ${COLORS.BOLD}s.${COLORS.RESET} ${COLORS.MAGENTA}Search tools${COLORS.RESET}`);
  console.log(`  ${COLORS.BOLD}r.${COLORS.RESET} ${COLORS.YELLOW}Refresh tools list${COLORS.RESET}`);
  console.log(`  ${COLORS.BOLD}0.${COLORS.RESET} ${COLORS.RED}Exit${COLORS.RESET}`);
  
  console.log(`\n${COLORS.DIM}Enter a number or press Ctrl+C to quit${COLORS.RESET}`);
}

// Function to display tools in a category
function displayCategoryMenu(category, tools) {
  clearScreen();
  
  console.log(`${COLORS.BG_BLUE}${COLORS.BOLD} DegenDuel Tool Runner: ${category} ${COLORS.RESET}\n`);
  console.log(`${COLORS.BOLD}Select a tool:${COLORS.RESET}\n`);
  
  tools.forEach((tool, index) => {
    // Highlight new tools
    const isNewBadge = tool.isNew ? `${COLORS.BG_GREEN}${COLORS.BOLD} NEW ${COLORS.RESET} ` : '';
    console.log(`  ${COLORS.BOLD}${index + 1}.${COLORS.RESET} ${isNewBadge}${COLORS.GREEN}${tool.name}${COLORS.RESET}`);
    console.log(`     ${COLORS.YELLOW}${tool.command}${COLORS.RESET}`);
    console.log(`     ${COLORS.DIM}Source: ${tool.path}${COLORS.RESET}\n`);
  });
  
  console.log(`  ${COLORS.BOLD}0.${COLORS.RESET} ${COLORS.BLUE}Back to categories${COLORS.RESET}`);
  
  console.log(`\n${COLORS.DIM}Enter a number or press Ctrl+C to quit${COLORS.RESET}`);
}

// Function to execute a command
async function executeCommand(command, toolName, originalName) {
  clearScreen();
  console.log(`${COLORS.BG_GREEN}${COLORS.BOLD} Running: ${toolName} ${COLORS.RESET}\n`);
  console.log(`${COLORS.YELLOW}> ${command}${COLORS.RESET}\n`);
  
  // Update usage history if it's a script with an original name
  if (originalName) {
    await updateUsageHistory(originalName);
  }
  
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
      mainLoop();
    });
  });
}

// Add search function
async function searchTools(toolsByCategory) {
  clearScreen();
  console.log(`${COLORS.BG_BLUE}${COLORS.BOLD} Search Tools ${COLORS.RESET}\n`);
  
  rl.question(`${COLORS.BOLD}Enter search term:${COLORS.RESET} `, async (searchTerm) => {
    if (!searchTerm.trim()) {
      mainLoop();
      return;
    }
    
    clearScreen();
    console.log(`${COLORS.BG_BLUE}${COLORS.BOLD} Search Results: "${searchTerm}" ${COLORS.RESET}\n`);
    
    // Flatten all tools
    const allTools = [];
    for (const category of Object.keys(toolsByCategory)) {
      for (const tool of toolsByCategory[category]) {
        allTools.push({...tool, originalCategory: category});
      }
    }
    
    // Search in name, command, and path
    const searchResults = allTools.filter(tool => 
      tool.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      tool.command.toLowerCase().includes(searchTerm.toLowerCase()) || 
      tool.path.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    if (searchResults.length === 0) {
      console.log(`${COLORS.YELLOW}No tools found matching "${searchTerm}"${COLORS.RESET}`);
      console.log(`\n${COLORS.BOLD}Press Enter to return to menu${COLORS.RESET}`);
      rl.once('line', () => {
        mainLoop();
      });
      return;
    }
    
    console.log(`${COLORS.BOLD}Found ${searchResults.length} tools:${COLORS.RESET}\n`);
    
    searchResults.forEach((tool, index) => {
      console.log(`  ${COLORS.BOLD}${index + 1}.${COLORS.RESET} ${COLORS.GREEN}${tool.name}${COLORS.RESET} ${COLORS.DIM}(${tool.originalCategory})${COLORS.RESET}`);
      console.log(`     ${COLORS.YELLOW}${tool.command}${COLORS.RESET}`);
      console.log(`     ${COLORS.DIM}Source: ${tool.path}${COLORS.RESET}\n`);
    });
    
    console.log(`  ${COLORS.BOLD}0.${COLORS.RESET} ${COLORS.BLUE}Back to categories${COLORS.RESET}`);
    
    rl.question(`${COLORS.BOLD}Select tool:${COLORS.RESET} `, (answer) => {
      const choice = parseInt(answer, 10);
      
      if (choice === 0) {
        mainLoop();
        return;
      }
      
      if (isNaN(choice) || choice < 1 || choice > searchResults.length) {
        console.log(`${COLORS.RED}Invalid choice. Press Enter to try again.${COLORS.RESET}`);
        rl.once('line', () => {
          searchTools(toolsByCategory);
        });
        return;
      }
      
      const selectedTool = searchResults[choice - 1];
      executeCommand(selectedTool.command, selectedTool.name, selectedTool.originalName);
    });
  });
}

// Main menu logic
async function showMainMenu() {
  const toolsByCategory = await discoverTools();
  displayMainMenu(toolsByCategory);
  
  rl.question(`${COLORS.BOLD}Select category:${COLORS.RESET} `, (answer) => {
    if (answer.toLowerCase() === 'r') {
      // Refresh the tool list
      mainLoop();
      return;
    }
    
    if (answer.toLowerCase() === 's') {
      // Search tools
      searchTools(toolsByCategory);
      return;
    }
    
    const choice = parseInt(answer, 10);
    
    if (choice === 0) {
      rl.close();
      return;
    }
    
    const categories = Object.keys(toolsByCategory);
    
    if (isNaN(choice) || choice < 1 || choice > categories.length) {
      console.log(`${COLORS.RED}Invalid choice. Press Enter to try again.${COLORS.RESET}`);
      rl.once('line', () => {
        showMainMenu();
      });
      return;
    }
    
    const selectedCategory = categories[choice - 1];
    showCategoryMenu(selectedCategory, toolsByCategory[selectedCategory]);
  });
}

// Category menu logic
function showCategoryMenu(category, tools) {
  displayCategoryMenu(category, tools);
  
  rl.question(`${COLORS.BOLD}Select tool:${COLORS.RESET} `, (answer) => {
    const choice = parseInt(answer, 10);
    
    if (choice === 0) {
      mainLoop();
      return;
    }
    
    if (isNaN(choice) || choice < 1 || choice > tools.length) {
      console.log(`${COLORS.RED}Invalid choice. Press Enter to try again.${COLORS.RESET}`);
      rl.once('line', () => {
        showCategoryMenu(category, tools);
      });
      return;
    }
    
    const selectedTool = tools[choice - 1];
    executeCommand(selectedTool.command, selectedTool.name, selectedTool.originalName);
  });
}

// Main application loop
async function mainLoop() {
  await showMainMenu();
}

// Start the application
mainLoop();

// Handle Ctrl+C
rl.on('SIGINT', () => {
  console.log('\nExiting DegenDuel Tool Runner');
  rl.close();
  process.exit(0);
});