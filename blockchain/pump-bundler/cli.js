#!/usr/bin/env node
/**
 * Command-line interface for Pump.fun bundler
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import gradient from 'gradient-string';
import boxen from 'boxen';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { PumpFunClient, PumpBundler, TX_MODE } from './src/index.js';

// Create gradient colors
const coolGradient = gradient(['#00c9ff', '#92fe9d']);
const hotGradient = gradient(['#f857a6', '#ff5858']);
const title = coolGradient('Pump.fun Bundler CLI');

// Display banner
console.log(boxen(title, {
  padding: 1,
  margin: 1,
  borderStyle: 'round',
  borderColor: 'cyan'
}));

// Create CLI program
const program = new Command();

program
  .name('pump-bundler')
  .description('Command-line interface for Pump.fun bundler')
  .version('1.0.0');

// Helper function to load wallet from private key
const loadWallet = (privateKey) => {
  if (!privateKey) {
    console.error(chalk.red('Error: No private key provided. Use --key or SOLANA_PRIVATE_KEY env var.'));
    process.exit(1);
  }
  
  try {
    return Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch (error) {
    console.error(chalk.red(`Error loading wallet: ${error.message}`));
    process.exit(1);
  }
};

// Buy command
program
  .command('buy')
  .description('Buy tokens from Pump.fun bonding curve')
  .requiredOption('-m, --mint <address>', 'Token mint address')
  .requiredOption('-a, --amount <sol>', 'SOL amount to spend')
  .option('-k, --key <privateKey>', 'Private key (or use SOLANA_PRIVATE_KEY env var)')
  .option('-s, --simulate', 'Simulate transaction without executing', false)
  .option('-p, --priority <fee>', 'Priority fee in microlamports', '1000000')
  .option('-j, --jito', 'Use Jito RPC endpoint', false)
  .action(async (options) => {
    const spinner = ora('Preparing transaction...').start();
    
    try {
      const privateKey = options.key || process.env.SOLANA_PRIVATE_KEY;
      const wallet = loadWallet(privateKey);
      const priorityFee = parseInt(options.priority, 10);
      
      spinner.text = 'Creating client...';
      const client = new PumpFunClient({
        priorityFee,
        useJito: options.jito
      });
      
      spinner.text = `${options.simulate ? 'Simulating' : 'Executing'} buy transaction for ${options.amount} SOL...`;
      
      const result = await client.buyToken({
        mode: options.simulate ? TX_MODE.SIMULATE : TX_MODE.EXECUTE,
        wallet,
        tokenMint: options.mint,
        solAmount: parseFloat(options.amount)
      });
      
      spinner.stop();
      
      if (result.success) {
        if (options.simulate) {
          console.log(chalk.green('✅ Simulation successful!'));
          console.log(chalk.cyan('Simulation result:'));
          console.log(JSON.stringify(result.result, null, 2));
        } else {
          console.log(chalk.green('✅ Transaction successful!'));
          console.log(chalk.cyan(`Signature: ${result.signature}`));
        }
      } else {
        console.log(chalk.red('❌ Transaction failed!'));
        console.log(chalk.red(`Error: ${result.error || 'Unknown error'}`));
      }
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

// Sell command
program
  .command('sell')
  .description('Sell tokens to Pump.fun bonding curve')
  .requiredOption('-m, --mint <address>', 'Token mint address')
  .requiredOption('-a, --amount <tokens>', 'Token amount to sell')
  .option('-k, --key <privateKey>', 'Private key (or use SOLANA_PRIVATE_KEY env var)')
  .option('-s, --simulate', 'Simulate transaction without executing', false)
  .option('-p, --priority <fee>', 'Priority fee in microlamports', '1000000')
  .option('-j, --jito', 'Use Jito RPC endpoint', false)
  .action(async (options) => {
    const spinner = ora('Preparing transaction...').start();
    
    try {
      const privateKey = options.key || process.env.SOLANA_PRIVATE_KEY;
      const wallet = loadWallet(privateKey);
      const priorityFee = parseInt(options.priority, 10);
      
      spinner.text = 'Creating client...';
      const client = new PumpFunClient({
        priorityFee,
        useJito: options.jito
      });
      
      spinner.text = `${options.simulate ? 'Simulating' : 'Executing'} sell transaction for ${options.amount} tokens...`;
      
      const result = await client.sellToken({
        mode: options.simulate ? TX_MODE.SIMULATE : TX_MODE.EXECUTE,
        wallet,
        tokenMint: options.mint,
        tokenAmount: parseFloat(options.amount)
      });
      
      spinner.stop();
      
      if (result.success) {
        if (options.simulate) {
          console.log(chalk.green('✅ Simulation successful!'));
          console.log(chalk.cyan('Simulation result:'));
          console.log(JSON.stringify(result.result, null, 2));
        } else {
          console.log(chalk.green('✅ Transaction successful!'));
          console.log(chalk.cyan(`Signature: ${result.signature}`));
        }
      } else {
        console.log(chalk.red('❌ Transaction failed!'));
        console.log(chalk.red(`Error: ${result.error || 'Unknown error'}`));
      }
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

// Bundle command placeholder - we'd need to load operations from a file for CLI use
program
  .command('bundle')
  .description('Execute a bundle of transactions')
  .requiredOption('-f, --file <path>', 'JSON file with operations')
  .option('-k, --key <privateKey>', 'Private key (or use SOLANA_PRIVATE_KEY env var)')
  .option('-s, --simulate', 'Simulate bundle without executing', false)
  .option('-p, --priority <fee>', 'Priority fee in microlamports', '1000000')
  .option('-j, --jito', 'Use Jito RPC endpoint', false)
  .action(async (options) => {
    console.log(chalk.yellow('The bundle command requires a JSON file with operations.'));
    console.log(chalk.yellow('This feature is not yet implemented in the CLI.'));
  });

// Run the program
program.parse(process.argv);