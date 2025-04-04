/**
 * Demonstration test script for the Pump.fun bundler
 * 
 * This script shows usage of both the PumpFunClient and PumpBundler
 * 
 * Usage:
 * node test.js simulate
 * node test.js bundle
 */

import { PumpFunClient, PumpBundler, TX_MODE } from './src/index.js';
import { Keypair } from '@solana/web3.js';
import chalk from 'chalk';

// Sample token mint - replace with a real token for actual testing
const SAMPLE_TOKEN_MINT = 'HyN1qK4LF6vwNHuPPygfcWpKcUKwNnzn38sZ8nJNZnBq';

const generateWallet = () => {
  return Keypair.generate();
};

// Simulate a simple buy operation
async function demonstrateSimulation() {
  console.log(chalk.cyan('\n--- Demonstrating Transaction Simulation ---'));
  
  // Create a client for simulating transactions
  const client = new PumpFunClient({
    priorityFee: 1000000
  });
  
  const wallet = generateWallet();
  console.log(chalk.green(`Using test wallet: ${wallet.publicKey.toString()}`));
  
  try {
    console.log(chalk.yellow('Simulating buy transaction...'));
    
    const result = await client.buyToken({
      mode: TX_MODE.SIMULATE,
      wallet,
      tokenMint: SAMPLE_TOKEN_MINT,
      solAmount: 0.01
    });
    
    console.log(chalk.green('Simulation completed.'));
    console.log(chalk.cyan('Success:'), result.success);
    
    if (result.success) {
      console.log(chalk.green('Transaction would succeed if executed.'));
    } else {
      console.log(chalk.red('Transaction would fail if executed.'));
      console.log(chalk.red('Error:'), result.result?.err || 'Unknown error');
    }
    
    // Show transaction details
    console.log(chalk.cyan('\nTransaction details:'));
    console.log(`- Program: ${result.transaction.instructions[0].programId.toString()}`);
    console.log(`- Number of instructions: ${result.transaction.instructions.length}`);
  } catch (error) {
    console.error(chalk.red(`Error during simulation: ${error.message}`));
  }
}

// Demonstrate creating a bundle of transactions
async function demonstrateBundle() {
  console.log(chalk.cyan('\n--- Demonstrating Transaction Bundling ---'));
  
  // Create a bundler
  const bundler = new PumpBundler({
    priorityFee: 1000000,
    simulate: true
  });
  
  const wallet = generateWallet();
  console.log(chalk.green(`Using test wallet: ${wallet.publicKey.toString()}`));
  
  try {
    console.log(chalk.yellow('Creating a bundle with multiple transactions...'));
    
    // Add a buy transaction to the bundle
    await bundler.addBuyTransaction({
      wallet,
      tokenMint: SAMPLE_TOKEN_MINT,
      solAmount: 0.005
    });
    console.log(chalk.green('Added first buy transaction to bundle.'));
    
    // Add another buy transaction for the same token
    await bundler.addBuyTransaction({
      wallet,
      tokenMint: SAMPLE_TOKEN_MINT,
      solAmount: 0.01
    });
    console.log(chalk.green('Added second buy transaction to bundle.'));
    
    // Simulate the bundle
    console.log(chalk.yellow('Simulating the entire bundle...'));
    const simResults = await bundler.simulateBundle();
    
    console.log(chalk.green('Bundle simulation completed.'));
    console.log(chalk.cyan('Simulation results:'));
    
    simResults.forEach((result, index) => {
      console.log(chalk.cyan(`Transaction ${index + 1}:`));
      console.log(`- Success: ${result.success}`);
      
      if (!result.success) {
        console.log(`- Error: ${result.result.err || 'Unknown error'}`);
      }
    });
    
    console.log(chalk.cyan('\nBundle details:'));
    console.log(`- Number of transactions: ${simResults.length}`);
    console.log(`- All transactions would succeed: ${simResults.every(r => r.success)}`);
    
    // Note about execution
    console.log(chalk.yellow('\nNote: This is a simulation only. No transactions were executed on-chain.'));
    console.log(chalk.yellow('To execute transactions, you would use TX_MODE.EXECUTE instead of SIMULATE.'));
  } catch (error) {
    console.error(chalk.red(`Error during bundling: ${error.message}`));
  }
}

// Main function
async function main() {
  console.log(chalk.cyan('=== Pump.fun Bundler Test Script ==='));
  
  const mode = process.argv[2] || 'simulate';
  
  if (mode === 'simulate') {
    await demonstrateSimulation();
  } else if (mode === 'bundle') {
    await demonstrateBundle();
  } else {
    console.error(chalk.red(`Unknown mode: ${mode}`));
    console.log(chalk.yellow('Usage: node test.js [simulate|bundle]'));
  }
}

main().catch(error => {
  console.error(chalk.red(`Fatal error: ${error.message}`));
});