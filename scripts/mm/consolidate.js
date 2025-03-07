#!/usr/bin/env node

/**
 * DegenDuel Treasury Fund Consolidation Script
 * 
 * This script:
 * 1. Checks all DegenDuel-managed wallets for balances
 * 2. Verifies balance data is recent (within 5 minutes)
 * 3. Prepares transfers to the treasury wallet
 * 4. Requires explicit confirmation before execution
 * 
 * Usage: node scripts/mm/consolidate.js
 */

import { config } from '../../config/config.js';
import prisma from '../../config/prisma.js';
import readline from 'readline';
import adminWalletService from '../../services/adminWalletService.js';
import contestWalletService from '../../services/contestWalletService.js';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import chalk from 'chalk';
import { logApi } from '../../utils/logger-suite/logger.js';
import bs58 from 'bs58';

// Configuration
const TREASURY_WALLET = process.env.TREASURY_WALLET_ADDRESS;
if (!TREASURY_WALLET) {
  console.error(chalk.red('L ERROR: TREASURY_WALLET_ADDRESS not defined in environment'));
  process.exit(1);
}

// Constants
const BALANCE_FRESHNESS_MS = 5 * 60 * 1000; // 5 minutes
const MIN_TRANSFER_AMOUNT = 0.001; // SOL - minimum amount to consider transferring
const RESERVE_AMOUNT = 0.0005; // SOL - amount to leave in wallet for fees

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper function to prompt for confirmation
function confirm(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

// Main function
async function main() {
  console.log(chalk.yellow.bold('\n=== DegenDuel Treasury Fund Consolidation ===\n'));
  console.log(chalk.cyan(`Treasury wallet: ${TREASURY_WALLET}`));
  
  try {
    // 1. First refresh all wallet balances
    console.log(chalk.blue('\n=� Refreshing wallet balances...\n'));
    
    // Update admin wallets
    const adminResults = await adminWalletService.updateAllWalletBalances();
    console.log(chalk.blue(` Updated ${adminResults.updated}/${adminResults.total} admin wallets`));
    
    // Update contest wallets
    const contestResults = await contestWalletService.updateAllWalletBalances();
    console.log(chalk.blue(` Updated ${contestResults.updated}/${contestResults.total} contest wallets`));

    // 2. Get all wallets with their updated balances
    const managedWallets = await prisma.managed_wallets.findMany({
      where: { status: 'active' }
    });
    
    const contestWallets = await prisma.contest_wallets.findMany({
      include: {
        contests: {
          select: {
            status: true,
            id: true,
            contest_code: true
          }
        }
      }
    });
    
    // 3. Process each wallet type
    const transferCandidates = [];
    let totalAmount = 0;
    
    // Process admin wallets
    console.log(chalk.cyan('\n=� Analyzing admin wallets...\n'));
    for (const wallet of managedWallets) {
      // Check if balance data exists and is fresh
      const metadata = wallet.metadata || {};
      const balanceData = metadata.balance || {};
      const lastUpdated = balanceData.last_updated ? new Date(balanceData.last_updated).getTime() : 0;
      const now = Date.now();
      
      if (!balanceData.sol || now - lastUpdated > BALANCE_FRESHNESS_MS) {
        console.log(chalk.yellow(`� ${wallet.label || wallet.public_key}: Balance data stale or missing, skipping`));
        continue;
      }
      
      // Check if balance is worth transferring
      const transferAmount = balanceData.sol - RESERVE_AMOUNT;
      if (transferAmount <= MIN_TRANSFER_AMOUNT) {
        console.log(chalk.gray(`� ${wallet.label || wallet.public_key}: Balance too low (${balanceData.sol} SOL), skipping`));
        continue;
      }
      
      // Add to candidates
      transferCandidates.push({
        type: 'admin',
        id: wallet.id,
        label: wallet.label || 'Admin Wallet',
        address: wallet.public_key,
        balance: balanceData.sol,
        transferAmount,
        lastUpdated: new Date(balanceData.last_updated).toISOString()
      });
      
      totalAmount += transferAmount;
      console.log(chalk.green(` ${wallet.label || wallet.public_key}: ${transferAmount.toFixed(6)} SOL available`));
    }
    
    // Process contest wallets
    console.log(chalk.cyan('\n=� Analyzing contest wallets...\n'));
    for (const wallet of contestWallets) {
      // Only process non-active and non-pending contest wallets
      if (wallet.contests?.status === 'active' || wallet.contests?.status === 'pending') {
        console.log(chalk.gray(`Skipping Contest ${wallet.contests.id} (${wallet.contests.contest_code}): Active or pending contest, skipping`));
        continue;
      }      
      
      // Check if balance data is fresh
      const lastUpdated = wallet.last_sync ? wallet.last_sync.getTime() : 0;
      const now = Date.now();
      
      if (now - lastUpdated > BALANCE_FRESHNESS_MS) {
        console.log(chalk.yellow(`� Contest ${wallet.contests?.id || 'Unknown'}: Balance data stale, skipping`));
        continue;
      }
      
      // Check if balance is worth transferring
      const transferAmount = wallet.balance - RESERVE_AMOUNT;
      if (transferAmount <= MIN_TRANSFER_AMOUNT) {
        console.log(chalk.gray(`� Contest ${wallet.contests?.id || 'Unknown'}: Balance too low (${wallet.balance} SOL), skipping`));
        continue;
      }
      
      // Add to candidates
      transferCandidates.push({
        type: 'contest',
        id: wallet.id,
        label: `Contest ${wallet.contests?.id || 'Unknown'} (${wallet.contests?.contest_code || 'N/A'})`,
        address: wallet.wallet_address,
        balance: wallet.balance,
        transferAmount,
        lastUpdated: wallet.last_sync.toISOString()
      });
      
      totalAmount += transferAmount;
      console.log(chalk.green(` Contest ${wallet.contests?.id || 'Unknown'} (${wallet.contests?.contest_code || 'N/A'}): ${transferAmount.toFixed(6)} SOL available`));
    }
    
    // 4. Summary and confirmation
    console.log(chalk.yellow.bold('\n=== Transfer Summary ===\n'));
    console.log(chalk.white(`    Wallets:  ${transferCandidates.length} of ${managedWallets.length + contestWallets.length} eligible`));
    console.log(chalk.white(`  Total SOL:  ${totalAmount.toFixed(6)} SOL`));
    console.log(chalk.white(`Destination:  ${TREASURY_WALLET}`));
    
    if (transferCandidates.length === 0) {
      console.log(chalk.red('\nL No eligible wallets found for transfer'));
      rl.close();
      return;
    }
    
    // Confirm transfer
    const confirmed = await confirm(chalk.red.bold('\n� WARNING: This will transfer all funds to the DegenDuel treasury wallet.\nAre you sure you want to proceed? (y/N) '));
    
    if (!confirmed) {
      console.log(chalk.yellow('\n=� Operation cancelled by user'));
      rl.close();
      return;
    }
    
    // Double confirm
    const doubleConfirmed = await confirm(chalk.red.bold('\n� FINAL WARNING: This operation cannot be undone.\nType y to confirm: '));
    
    if (!doubleConfirmed) {
      console.log(chalk.yellow('\n=� Operation cancelled by user'));
      rl.close();
      return;
    }
    
    // 5. Execute transfers
    console.log(chalk.yellow.bold('\n=== Executing Transfers ===\n'));
    
    const results = {
      successful: 0,
      failed: 0,
      totalTransferred: 0,
      details: []
    };
    
    // Process transfers
    for (const candidate of transferCandidates) {
      try {
        console.log(chalk.blue(`= Processing ${candidate.label}...`));
        
        let signature;
        
        if (candidate.type === 'admin') {
          // Get the wallet details including encrypted private key
          const wallet = await prisma.managed_wallets.findUnique({
            where: { id: candidate.id }
          });
          
          if (!wallet || !wallet.private_key) {
            throw new Error('Wallet private key not found');
          }
          
          // Transfer using admin wallet service
          const result = await adminWalletService.transferSOL(
            wallet.private_key,
            TREASURY_WALLET,
            candidate.transferAmount,
            'Consolidate funds to treasury'
          );
          
          signature = result.signature;
        } else {
          // Get wallet details for contest wallet
          const wallet = await prisma.contest_wallets.findUnique({
            where: { id: candidate.id }
          });
          
          if (!wallet || !wallet.private_key) {
            throw new Error('Wallet private key not found');
          }
          
          // Transfer using blockchain transfer method
          signature = await contestWalletService.performBlockchainTransfer(
            wallet,
            TREASURY_WALLET,
            candidate.transferAmount
          );
        }
        
        // Record success
        results.successful++;
        results.totalTransferred += candidate.transferAmount;
        results.details.push({
          ...candidate,
          status: 'success',
          signature
        });
        
        console.log(chalk.green(` Successfully transferred ${candidate.transferAmount.toFixed(6)} SOL to treasury`));
        console.log(chalk.cyan(`=� Transaction:  ${signature}`));
        console.log(chalk.cyan(`=
 Explorer: https://solscan.io/tx/${signature}`));
      } catch (error) {
        console.error(chalk.red(`L Failed to transfer from ${candidate.label}: ${error.message}`));
        results.failed++;
        results.details.push({
          ...candidate,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // 6. Final summary
    console.log(chalk.yellow.bold('\n=== Transfer Summary ===\n'));
    console.log(chalk.white(`Succeeded:  ${results.successful}/${transferCandidates.length}`));
    console.log(chalk.white(`   Failed:  ${results.failed}/${transferCandidates.length}`));
    console.log(chalk.white(`Total SOL:  ${results.totalTransferred.toFixed(6)} SOL`));
    
    // Log to file
    const logFile = `${__dirname}/consolidation_${Date.now()}.json`;
    const fs = await import('fs');
    fs.writeFileSync(logFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      treasury: TREASURY_WALLET,
      results
    }, null, 2));
    
    console.log(chalk.cyan(`\n=� Detailed log saved to: ${logFile}`));
    
  } catch (error) {
    console.error(chalk.red(`\nL Error: ${error.message}`));
    console.error(error.stack);
  } finally {
    rl.close();
  }
}

// Run the main function
main().catch(error => {
  console.error(chalk.red(`\nL Fatal error: ${error.message}`));
  console.error(error.stack);
  process.exit(1);
});