// Token diagnostics menu system
import { spawn } from 'child_process';
import readline from 'readline';
import chalk from 'chalk';
import boxen from 'boxen';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Tool definitions
const tools = [
  {
    key: '1', 
    name: 'Full Token Diagnostics',
    description: 'Run comprehensive token diagnostics',
    command: 'node diagnostics/token-diagnostics.js'
  },
  {
    key: '2', 
    name: 'Simple Token Diagnostics',
    description: 'Quick analysis of token database social fields',
    command: 'node diagnostics/simple-token-diagnostics.js'
  },
  {
    key: '3', 
    name: 'Find Social Domain Types',
    description: 'Analyze domains in token descriptions',
    command: 'node diagnostics/find-social-domains.js'
  },
  {
    key: '4', 
    name: 'Test Social Link Extraction',
    description: 'Test social link extraction without making changes',
    command: 'node diagnostics/token-social-extractor.js'
  },
  {
    key: '5', 
    name: 'Migrate Social Links',
    description: 'Extract & save social links from descriptions',
    command: 'node diagnostics/token-social-extractor.js --migrate'
  },
  {
    key: 'q', 
    name: 'Quit',
    description: 'Exit the token tools menu',
    command: null
  }
];

// Show main menu
function showMenu() {
  console.clear();
  console.log(boxen(chalk.cyan.bold('🪙 DEGENDUEL TOKEN TOOLS 🪙'), { 
    padding: 1, 
    borderColor: 'cyan',
    borderStyle: 'round'
  }));
  
  console.log('Select a token diagnostic tool to run:\n');
  
  tools.forEach(tool => {
    console.log(`${chalk.green(tool.key)}) ${chalk.bold(tool.name)}`);
    console.log(`   ${chalk.dim(tool.description)}`);
    console.log('');
  });
  
  rl.question('Enter your choice: ', (answer) => {
    const selectedTool = tools.find(t => t.key === answer);
    
    if (!selectedTool) {
      console.log(chalk.red('\nInvalid option, please try again.'));
      setTimeout(showMenu, 1500);
      return;
    }
    
    if (selectedTool.key === 'q') {
      console.log(chalk.yellow('\nExiting token tools menu.'));
      rl.close();
      return;
    }
    
    // Run the selected tool
    console.log(chalk.yellow(`\nRunning: ${selectedTool.name}...\n`));
    
    const child = spawn(selectedTool.command, { 
      shell: true,
      stdio: 'inherit'
    });
    
    child.on('exit', (code) => {
      console.log(chalk.cyan(`\nTool completed with exit code ${code}.`));
      rl.question('\nPress Enter to return to the menu...', () => {
        showMenu();
      });
    });
  });
}

// Start the menu
showMenu();