#!/usr/bin/env node

/**
 * DegenDuel Wallet Balance Audit Tool
 * 
 * This script audits all DegenDuel-managed wallets to show balances 
 * without performing any transfers. Safe to run at any time.
 * 
 * Usage: node scripts/mm/audit.js
 */

import { config } from '../../config/config.js';
import prisma from '../../config/prisma.js';
import adminWalletService from '../../services/adminWalletService.js';
import contestWalletService from '../../services/contestWalletService.js';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import chalk from 'chalk';

// Constants
const BALANCE_FRESHNESS_MS = 5 * 60 * 1000; // 5 minutes
const MIN_TRANSFER_AMOUNT = 0.001; // SOL
const RESERVE_AMOUNT = 0.0005; // SOL

// Main function
async function main() {
  console.log(chalk.yellow.bold('\n=== DegenDuel Wallet Balance Audit ===\n'));
  console.log(chalk.cyan('Treasury wallet:', process.env.TREASURY_WALLET_ADDRESS || '[NOT SET]'));
  
  try {
    // 1. First refresh all wallet balances
    console.log(chalk.blue('\n=J Refreshing wallet balances...\n'));
    
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
    
    // 3. Process and display wallet information
    const transferCandidates = [];
    let totalAmount = 0;
    
    // Stats
    const stats = {
      total: {
        wallets: managedWallets.length + contestWallets.length,
        balance: 0
      },
      admin: {
        total: managedWallets.length,
        eligible: 0,
        balance: 0,
        transferable: 0
      },
      contest: {
        total: contestWallets.length,
        active: 0,
        completed: 0,
        eligible: 0,
        balance: 0,
        transferable: 0
      }
    };
    
    // Process admin wallets
    console.log(chalk.cyan('\n=] Analyzing admin wallets...\n'));
    for (const wallet of managedWallets) {
      // Check if balance data exists and is fresh
      const metadata = wallet.metadata || {};
      const balanceData = metadata.balance || {};
      const lastUpdated = balanceData.last_updated ? new Date(balanceData.last_updated).getTime() : 0;
      const now = Date.now();
      
      const balanceFresh = now - lastUpdated <= BALANCE_FRESHNESS_MS;
      const balance = balanceData.sol || 0;
      stats.admin.balance += balance;
      stats.total.balance += balance;
      
      if (!balanceData.sol || !balanceFresh) {
        console.log(chalk.yellow(`  ${wallet.label || wallet.public_key}: ${balance.toFixed(6)} SOL (${balanceFresh ? 'fresh' : 'STALE DATA'})`));
        continue;
      }
      
      // Check if balance is worth transferring
      const transferAmount = balanceData.sol - RESERVE_AMOUNT;
      if (transferAmount <= MIN_TRANSFER_AMOUNT) {
        console.log(chalk.gray(`m ${wallet.label || wallet.public_key}: ${balance.toFixed(6)} SOL (too low to transfer)`));
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
      stats.admin.eligible++;
      stats.admin.transferable += transferAmount;
      
      console.log(chalk.green(` ${wallet.label || wallet.public_key}: ${balance.toFixed(6)} SOL (${transferAmount.toFixed(6)} SOL available)`));
    }
    
    // Process contest wallets
    console.log(chalk.cyan('\n=] Analyzing contest wallets...\n'));
    for (const wallet of contestWallets) {
      const balance = wallet.balance || 0;
      stats.contest.balance += balance;
      stats.total.balance += balance;
      
      // Track active/completed stats
      if (wallet.contests?.status === 'active') {
        stats.contest.active++;
        console.log(chalk.blue(`<F Contest ${wallet.contests.id} (${wallet.contests.contest_code}): ${balance.toFixed(6)} SOL (active)`));
        continue;
      } else if (wallet.contests?.status === 'completed') {
        stats.contest.completed++;
      }
      
      // Check if balance data is fresh
      const lastUpdated = wallet.last_sync ? wallet.last_sync.getTime() : 0;
      const now = Date.now();
      const balanceFresh = now - lastUpdated <= BALANCE_FRESHNESS_MS;
      
      if (!balanceFresh) {
        console.log(chalk.yellow(`  Contest ${wallet.contests?.id || 'Unknown'} (${wallet.contests?.contest_code || 'N/A'}): ${balance.toFixed(6)} SOL (STALE DATA)`));
        continue;
      }
      
      // Check if balance is worth transferring
      const transferAmount = wallet.balance - RESERVE_AMOUNT;
      if (transferAmount <= MIN_TRANSFER_AMOUNT) {
        console.log(chalk.gray(`m Contest ${wallet.contests?.id || 'Unknown'} (${wallet.contests?.contest_code || 'N/A'}): ${balance.toFixed(6)} SOL (too low to transfer)`));
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
      stats.contest.eligible++;
      stats.contest.transferable += transferAmount;
      
      console.log(chalk.green(` Contest ${wallet.contests?.id || 'Unknown'} (${wallet.contests?.contest_code || 'N/A'}): ${balance.toFixed(6)} SOL (${transferAmount.toFixed(6)} SOL available)`));
    }
    
    // 4. Summary
    console.log(chalk.yellow.bold('\n=== Wallet Audit Summary ===\n'));
    console.log(chalk.white('Total wallets:', stats.total.wallets));
    console.log(chalk.white('Total balance:', Number(stats.total.balance || 0).toFixed(6), 'SOL'));
    console.log(chalk.white('Transferable balance:', Number(totalAmount || 0).toFixed(6), 'SOL'));
    
    console.log(chalk.cyan('\nAdmin wallets:'));
    console.log(chalk.white('  Total:', stats.admin.total));
    console.log(chalk.white('  Eligible for transfer:', stats.admin.eligible));
    console.log(chalk.white('  Total balance:', Number(stats.admin.balance || 0).toFixed(6), 'SOL'));
    console.log(chalk.white('  Transferable:', Number(stats.admin.transferable || 0).toFixed(6), 'SOL'));
    
    console.log(chalk.cyan('\nContest wallets:'));
    console.log(chalk.white('  Total:', stats.contest.total));
    console.log(chalk.white('  Active contests:', stats.contest.active));
    console.log(chalk.white('  Completed contests:', stats.contest.completed));
    console.log(chalk.white('  Eligible for transfer:', stats.contest.eligible));
    console.log(chalk.white('  Total balance:', Number(stats.contest.balance || 0).toFixed(6), 'SOL'));
    console.log(chalk.white('  Transferable:', Number(stats.contest.transferable || 0).toFixed(6), 'SOL'));
    
    console.log(chalk.cyan('\nTo transfer funds to treasury, run:'));
    console.log(chalk.white('  npm run mm:consolidate'));
    
  } catch (error) {
    console.error(chalk.red(`\nL Error: ${error.message}`));
    console.error(error.stack);
  }
}

// Run the main function
main().catch(error => {
  console.error(chalk.red(`\nL Fatal error: ${error.message}`));
  console.error(error.stack);
  process.exit(1);
});