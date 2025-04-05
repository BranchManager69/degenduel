#!/usr/bin/env node

/**
 * DegenDuel Benchmark Suite Menu
 * A simplified TUI interface for running benchmarks and performance tests
 */

import readline from 'readline';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import chalk from 'chalk'; // You may need to install: npm install chalk

// ASCII art header
const header = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║      ██████╗ ███████╗ ██████╗ ███████╗███╗   ██╗            ║
║      ██╔══██╗██╔════╝██╔════╝ ██╔════╝████╗  ██║            ║
║      ██║  ██║█████╗  ██║  ███╗█████╗  ██╔██╗ ██║            ║
║      ██║  ██║██╔══╝  ██║   ██║██╔══╝  ██║╚██╗██║            ║
║      ██████╔╝███████╗╚██████╔╝███████╗██║ ╚████║            ║
║      ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝            ║
║                                                              ║
║      ██████╗ ██╗   ██╗███████╗██╗                           ║
║      ██╔══██╗██║   ██║██╔════╝██║                           ║
║      ██║  ██║██║   ██║█████╗  ██║                           ║
║      ██║  ██║██║   ██║██╔══╝  ██║                           ║
║      ██████╔╝╚██████╔╝███████╗███████╗                      ║
║      ╚═════╝  ╚═════╝ ╚══════╝╚══════╝                      ║
║                                                              ║
║              BENCHMARK & PERFORMANCE SUITE                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

// Performance benchmark options
const benchmarkOptions = [
  {
    id: 1,
    name: 'Quick RPC Benchmark',
    description: 'Fast RPC performance test with simple output (includes Branch)',
    command: 'python3 tests/solana_rpc_benchmark_enhanced.py --simple --enable-branch'
  },
  {
    id: 2,
    name: 'Full RPC Benchmark',
    description: 'Complete RPC test with detailed JSON export (includes Branch)',
    command: 'python3 tests/solana_rpc_benchmark_enhanced.py --export=rpc_results.json --enable-branch'
  },
  {
    id: 3,
    name: 'RPC Benchmark (Legacy)',
    description: 'Legacy name preserved for compatibility',
    command: 'python3 tests/solana_rpc_benchmark_enhanced.py --simple --enable-branch'
  },
  {
    id: 4,
    name: 'WebSocket Benchmark',
    description: 'Test WebSocket RPC performance (including Branch)',
    command: 'python3 tests/solana_ws_benchmark.py --simple-export --enable-branch'
  },
  {
    id: 5,
    name: 'Combined RPC & WebSocket',
    description: 'Complete benchmark suite with JSON export (includes Branch)',
    command: 'sh -c "python3 tests/solana_rpc_benchmark_enhanced.py --simple --export=rpc_results.json --enable-branch && python3 tests/solana_ws_benchmark.py --simple-export --enable-branch"'
  },
  {
    id: 6,
    name: 'Complete Performance Test Suite',
    description: 'Runs all performance tests (may take several minutes)',
    command: 'tests/run-all-perf-tests.sh'
  },
  {
    id: 7,
    name: 'Quick Performance Test',
    description: 'Runs essential tests only (faster)',
    command: 'tests/run-all-perf-tests.sh --quick'
  },
  {
    id: 8,
    name: 'Quiet Performance Test',
    description: 'Runs all tests with minimal output (logs to files)',
    command: 'tests/run-all-perf-tests.sh --quiet'
  }
];

// Stress test options
const stressTestOptions = [
  {
    id: 8,
    name: 'Simple WebSocket Stress Test',
    description: 'Quick WebSocket connection test',
    command: 'node tests/ws-stress-test/ws-stress-test.js --simple'
  },
  {
    id: 9,
    name: 'WebSocket Baseline Test',
    description: 'Normal load test (20 connections)',
    command: 'node tests/ws-stress-test/ws-stress-test.js --connections 20 --duration 30 --connectRate 2 --logLevel info'
  },
  {
    id: 10,
    name: 'WebSocket Connection Flood',
    description: 'Heavy load test (100 connections)',
    command: 'node tests/ws-stress-test/ws-stress-test.js --connections 100 --duration 60 --connectRate 10 --disconnectRate 8 --logLevel info'
  },
  {
    id: 11,
    name: 'Authentication Stress Test',
    description: 'Tests authenticated connections',
    command: 'node tests/ws-stress-test/ws-stress-test.js --connections 50 --duration 60 --authPercent 80 --authRate 8 --logLevel info'
  },
  {
    id: 12,
    name: 'Chaos Mode Test',
    description: 'Random connection behavior test',
    command: 'node tests/ws-stress-test/ws-stress-test.js --connections 30 --duration 90 --chaosMode true --logLevel debug'
  },
  {
    id: 13,
    name: 'All Stress Tests',
    description: 'Run complete stress test suite',
    command: 'tests/ws-stress-test/run-ws-tests.sh'
  }
];

// Other utility options
const utilityOptions = [
  {
    id: 14,
    name: 'Benchmark & Import Results',
    description: 'Run benchmark and import results to database',
    command: 'sh -c "python3 tests/solana_rpc_benchmark_enhanced.py --export results.json && node scripts/import_benchmark_results.js -f benchmark_results_*.json"'
  },
  {
    id: 15,
    name: 'Import Existing Results',
    description: 'Import previously generated benchmark results',
    command: 'node scripts/import_benchmark_results.js -f benchmark_results_*.json'
  }
];

// Display the menu
function displayMenu() {
  console.log(chalk.blue(header));
  
  console.log(chalk.yellow('\n======= PERFORMANCE BENCHMARKS ======='));
  benchmarkOptions.forEach(option => {
    console.log(`${chalk.green(option.id)}. ${chalk.white.bold(option.name)}`);
    console.log(`   ${chalk.gray(option.description)}`);
  });
  
  console.log(chalk.yellow('\n======= STRESS TESTS ======='));
  stressTestOptions.forEach(option => {
    console.log(`${chalk.green(option.id)}. ${chalk.white.bold(option.name)}`);
    console.log(`   ${chalk.gray(option.description)}`);
  });
  
  console.log(chalk.yellow('\n======= UTILITIES ======='));
  utilityOptions.forEach(option => {
    console.log(`${chalk.green(option.id)}. ${chalk.white.bold(option.name)}`);
    console.log(`   ${chalk.gray(option.description)}`);
  });
  
  console.log(chalk.green('\n0. Exit'));
}

// Run a command
function runCommand(command) {
  console.log(chalk.yellow('\nRunning command:'), chalk.white.bold(command));
  console.log(chalk.yellow('='.repeat(50)));
  
  // Split the command for spawn
  const parts = command.split(' ');
  const cmd = parts[0];
  const args = parts.slice(1);
  
  const process = spawn(cmd, args, { 
    stdio: 'inherit',
    shell: true
  });
  
  process.on('close', (code) => {
    console.log(chalk.yellow('\n='.repeat(50)));
    if (code === 0) {
      console.log(chalk.green('Command completed successfully!'));
    } else {
      console.log(chalk.red(`Command exited with code ${code}`));
    }
    
    // Return to menu after completion
    setTimeout(() => {
      console.log(chalk.blue('\nReturning to menu...'));
      displayMenu();
      promptUser();
    }, 1000);
  });
}

// Prompt for user input
function promptUser() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question(chalk.blue.bold('\nEnter your choice (0-15): '), (answer) => {
    rl.close();
    
    const choice = parseInt(answer);
    
    if (choice === 0) {
      console.log(chalk.green('Exiting DegenDuel Benchmark Suite. Goodbye!'));
      process.exit(0);
    }
    
    // Find the selected option
    const allOptions = [...benchmarkOptions, ...stressTestOptions, ...utilityOptions];
    const selected = allOptions.find(opt => opt.id === choice);
    
    if (selected) {
      runCommand(selected.command);
    } else {
      console.log(chalk.red('Invalid option! Please try again.'));
      displayMenu();
      promptUser();
    }
  });
}

// Start the program
console.clear();
displayMenu();
promptUser();