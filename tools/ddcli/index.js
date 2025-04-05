#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { loadModules, showModuleMenu } from './core/module-loader.js';

// Check if no arguments provided, show the menu directly
if (process.argv.length <= 2) {
  // If no command provided, show the interactive menu
  console.clear(); // Clear the screen before showing the menu
  const program = new Command();
  await loadModules(program);
  showModuleMenu(program);
} else {
  // Otherwise process the command normally
  const program = new Command();
  
  // Setup basic CLI information
  program
    .version('1.0.0')
    .description('DegenDuel Command Line Interface');
  
  // Load all available modules
  await loadModules(program);
  
  // Add help text to display if command is invalid
  program.on('command:*', () => {
    console.error(chalk.red('Invalid command: %s\nSee --help for a list of available commands.'), 
      program.args.join(' '));
    process.exit(1);
  });
  
  // Parse command line arguments
  program.parse(process.argv);
}