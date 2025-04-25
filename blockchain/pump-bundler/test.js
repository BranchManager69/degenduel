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
import dotenv from 'dotenv';
import bs58 from 'bs58';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Calculate path to .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// Load environment variables from root directory
dotenv.config({ path: path.join(rootDir, '.env') });

// Debug: Check if environment variables are loaded
if (!process.env.PUMP_BUNDLER_RPC_URL) {
  console.warn(chalk.yellow('Warning: PUMP_BUNDLER_RPC_URL environment variable is not set.'));
}

if (!process.env.PUMP_BUNDLER_TEST_WALLET_KEY) {
  console.warn(chalk.yellow('Warning: PUMP_BUNDLER_TEST_WALLET_KEY environment variable is not set.'));
}

// Use token mint from environment variable or fallback to default
const PUMP_TOKEN_MINT = process.env.PUMP_BUNDLER_TEST_TOKEN_MINT || 'GSKArqUB8vp4CGNiN51eoK4TosuWE5rujhmkzUAspump';

// Get wallet from private key in environment variable or generate a random one
const getWallet = () => {
  if (process.env.PUMP_BUNDLER_TEST_WALLET_KEY) {
    try {
      const privateKey = bs58.decode(process.env.PUMP_BUNDLER_TEST_WALLET_KEY);
      return Keypair.fromSecretKey(privateKey);
    } catch (error) {
      console.error(chalk.red(`Error loading wallet from private key: ${error.message}`));
      console.error(chalk.yellow('Falling back to random wallet generation.'));
    }
  }
  return Keypair.generate();
};

// Simulate a simple buy operation
async function demonstrateSimulation() {
  console.log(chalk.cyan('\n--- Demonstrating Transaction Simulation ---'));
  
  // Create a client for simulating transactions
  const client = new PumpFunClient({
    priorityFee: 1000000
  });
  
  const wallet = getWallet();
  console.log(chalk.green(`Using ${process.env.PUMP_BUNDLER_TEST_WALLET_KEY ? 'configured' : 'random'} test wallet: ${wallet.publicKey.toString()}`));
  
  try {
    console.log(chalk.yellow('Simulating buy transaction...'));
    
    const result = await client.buyToken({
      mode: TX_MODE.SIMULATE,
      wallet,
      tokenMint: PUMP_TOKEN_MINT,
      solAmount: 0.001 // Reduced amount
    });
    
    console.log(chalk.green('Simulation completed.'));
    console.log(chalk.cyan('Success:'), result.success);
    
    if (result.success) {
      console.log(chalk.green('Transaction would succeed if executed.'));
    } else {
      console.log(chalk.red('Transaction would fail if executed.'));
      console.log(chalk.red('Error:'), JSON.stringify(result.result?.err || 'Unknown error'));
      
      // Provide more context about common errors
      if (result.result?.err === 'AccountNotFound') {
        console.log(chalk.yellow('This error typically means the token mint does not exist or is not accessible.'));
        console.log(chalk.yellow(`Verify that the token (${PUMP_TOKEN_MINT}) exists on this network.`));
      }
      
      // Pump.fun specific error codes
      if (result.result?.err?.InstructionError) {
        const customError = result.result.err.InstructionError[1]?.Custom;
        console.log(chalk.yellow(`Pump.fun program error code: ${customError}`));
        
        // Interpret common error codes
        if (customError === 101) {
          console.log(chalk.yellow(`
This appears to be a Pump.fun program error. Possible reasons:
1. The token might not be tradable on Pump.fun or has specific restrictions
2. The transaction parameters may need adjustment
3. The RPC endpoint might not have the token's data`));
        }
      }
    }
    
    // Show more transaction details for debugging
    console.log(chalk.cyan('\nDetailed transaction info:'));
    try {
      console.log(`- Wallet: ${wallet.publicKey.toString()}`);
      console.log(`- Token mint: ${PUMP_TOKEN_MINT}`);
      console.log(`- Instructions count: ${result.transaction.instructions.length}`);
      result.transaction.instructions.forEach((ix, i) => {
        console.log(`\nInstruction ${i+1}:`);
        console.log(`  Program: ${ix.programId.toString()}`);
        console.log(`  Data length: ${ix.data?.length || 0} bytes`);
        console.log(`  Accounts: ${ix.keys.length}`);
        ix.keys.forEach((key, idx) => {
          console.log(`    ${idx+1}: ${key.pubkey.toString()} (signer: ${key.isSigner}, writable: ${key.isWritable})`);
        });
      });
    } catch (err) {
      console.log(`Error displaying transaction details: ${err.message}`);
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
  
  const wallet = getWallet();
  console.log(chalk.green(`Using ${process.env.PUMP_BUNDLER_TEST_WALLET_KEY ? 'configured' : 'random'} test wallet: ${wallet.publicKey.toString()}`));
  
  try {
    console.log(chalk.yellow('Creating a bundle with multiple transactions...'));
    
    // Add a buy transaction to the bundle
    await bundler.addBuyTransaction({
      wallet,
      tokenMint: PUMP_TOKEN_MINT,
      solAmount: 0.0005 // Reduced amount
    });
    console.log(chalk.green('Added first buy transaction to bundle.'));
    
    // Add another buy transaction for the same token
    await bundler.addBuyTransaction({
      wallet,
      tokenMint: PUMP_TOKEN_MINT,
      solAmount: 0.001 // Reduced amount
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
        
        // Provide more context about common errors
        if (result.result.err === 'AccountNotFound') {
          console.log(chalk.yellow('  This error typically means the token mint does not exist or is not accessible.'));
          console.log(chalk.yellow(`  Verify that the token (${PUMP_TOKEN_MINT}) exists on this network.`));
        }
      }
      
      // Add debug info about transaction structure
      if (result.transaction) {
        console.log(`- Transaction has ${result.transaction.instructions.length} instructions`);
        result.transaction.instructions.forEach((instruction, i) => {
          console.log(`  Instruction ${i+1}: Program ${instruction.programId.toString()}`);
        });
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
  
  // Display configuration info
  console.log(chalk.green('\nConfiguration:'));
  console.log(`- Token Address: ${PUMP_TOKEN_MINT}`);
  console.log(`- Wallet: ${process.env.PUMP_BUNDLER_TEST_WALLET_KEY ? 'Using configured wallet' : 'Using random wallet'}`);
  console.log(`- Primary RPC URL: ${process.env.PUMP_BUNDLER_RPC_URL || process.env.SOLANA_RPC_ENDPOINT || 'Default Solana RPC'}`);
  
  const mode = process.argv[2] || 'simulate';
  console.log(chalk.cyan(`\nRunning in ${mode.toUpperCase()} mode\n`));
  
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
  
  // Add more context for specific errors
  if (error.message.includes('Failed to create buy transaction')) {
    console.error(chalk.yellow(`
This error often occurs when:
1. The token mint address (${PUMP_TOKEN_MINT}) doesn't exist on this network
2. There's an issue connecting to the RPC endpoint
3. The wallet doesn't have enough SOL to simulate the transaction

Try running with a different token or check your RPC connection.`));
  }
  
  // Wallet loading errors
  if (error.message.includes('Error decoding private key')) {
    console.error(chalk.red(`
===== WALLET ERROR =====
Could not decode the private key provided in PUMP_BUNDLER_TEST_WALLET_KEY.
Make sure it's a valid Solana private key in base58 format.
`));
  }
  
  // Configuration information
  console.error(chalk.cyan(`
===== CONFIGURATION DEBUG INFO =====
Token Mint: ${PUMP_TOKEN_MINT} (${process.env.PUMP_BUNDLER_TEST_TOKEN_MINT ? 'from env' : 'default'})
Wallet Key: ${process.env.PUMP_BUNDLER_TEST_WALLET_KEY ? 'Provided in env (masked)' : 'Not provided - using random wallet'}
RPC Custom: ${process.env.PUMP_BUNDLER_RPC_URL || 'Not set'}
RPC Default: ${process.env.SOLANA_RPC_ENDPOINT || 'Not set'}
`));
});