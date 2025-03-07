#!/usr/bin/env node

/**
 * ✨ DegenDuel Wallet Balance Audit Tool ✨
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
import figures from 'figures';

// Constants
const BALANCE_FRESHNESS_MS = 5 * 60 * 1000; // 5 minutes
const MIN_TRANSFER_AMOUNT = 0.001; // SOL
const RESERVE_AMOUNT = 0.0005; // SOL

// Icons for better visual clarity
const ICONS = {
  success: figures.tick,
  warning: figures.warning,
  error: figures.cross,
  info: figures.info,
  refresh: '🔄',
  wallet: '💰',
  transfer: '💸',
  active: '🟢',
  inactive: '🔴',
  pending: '🟡',
  low: '⚠️',
  stale: '⏱️',
  treasury: '🏦',
  stat: '📊',
  admin: '👑',
  contest: '🏆',
  money: '💎'
};

// Color themes
const THEME = {
  title: chalk.bgMagenta.white.bold,
  subtitle: chalk.bgBlue.white.bold,
  success: chalk.green.bold,
  warning: chalk.yellow.bold,
  error: chalk.bgRed.white.bold,
  info: chalk.cyan,
  muted: chalk.gray,
  highlight: chalk.bgYellow.black,
  money: chalk.green,
  header: chalk.magenta.bold,
  labelPrimary: chalk.bgCyan.black,
  labelSecondary: chalk.bgGreen.black,
  amount: chalk.green.bold,
  address: chalk.blue.italic,
  divider: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
};

// Helper function to format numbers with commas for better readability
function formatNumber(number) {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Main function
async function main() {
  console.log('\n' + THEME.title(`  ${ICONS.wallet} DegenDuel Wallet Balance Audit ${ICONS.wallet}  `) + '\n');
  console.log(THEME.info(`${ICONS.treasury} Treasury wallet: ${THEME.address(process.env.TREASURY_WALLET_ADDRESS || '[NOT SET]')}`));
  
  try {
    // 1. First refresh all wallet balances
    console.log('\n' + THEME.subtitle(` ${ICONS.refresh} Refreshing Wallet Balances `) + '\n');
    
    // Update admin wallets
    const adminResults = await adminWalletService.updateAllWalletBalances();
    console.log(THEME.info(`${ICONS.admin} Updated ${THEME.success(adminResults.updated)}/${THEME.info(adminResults.total)} admin wallets`));
    
    // Update contest wallets
    const contestResults = await contestWalletService.updateAllWalletBalances();
    console.log(THEME.info(`${ICONS.contest} Updated ${THEME.success(contestResults.updated)}/${THEME.info(contestResults.total)} contest wallets`));

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
        pending: 0,
        completed: 0,
        eligible: 0,
        balance: 0,
        transferable: 0
      }
    };
    
    // Process admin wallets
    console.log('\n' + THEME.subtitle(` ${ICONS.admin} Analyzing Admin Wallets `) + '\n');
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
        console.log(THEME.warning(`${ICONS.stale} ${THEME.labelSecondary(` ${wallet.label || wallet.public_key} `)} ${balance.toFixed(6)} SOL ${balanceFresh ? '' : THEME.highlight(' STALE DATA ')}`));
        continue;
      }
      
      // Check if balance is worth transferring
      const transferAmount = balanceData.sol - RESERVE_AMOUNT;
      if (transferAmount <= MIN_TRANSFER_AMOUNT) {
        console.log(THEME.muted(`${ICONS.low} ${wallet.label || wallet.public_key}: ${balance.toFixed(6)} SOL ${THEME.muted('(too low to transfer)')}`));
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
      
      console.log(THEME.success(`${ICONS.success} ${THEME.labelPrimary(` ${wallet.label || wallet.public_key} `)} ${balance.toFixed(6)} SOL ${THEME.money(`(${transferAmount.toFixed(6)} SOL available)`)}`));
    }
    
    // Process contest wallets
    console.log('\n' + THEME.subtitle(` ${ICONS.contest} Analyzing Contest Wallets `) + '\n');
    for (const wallet of contestWallets) {
      const balance = wallet.balance || 0;
      stats.contest.balance += balance;
      stats.total.balance += balance;
      
      // Track active/completed/pending stats
      if (wallet.contests?.status === 'active') {
        stats.contest.active++;
        console.log(THEME.info(`${ICONS.active} ${THEME.labelSecondary(` Contest ${wallet.contests.id} (${wallet.contests.contest_code}) `)} ${balance.toFixed(6)} SOL ${THEME.highlight(' ACTIVE ')}`));
        continue;
      } else if (wallet.contests?.status === 'pending') {
        stats.contest.pending++;
        console.log(THEME.warning(`${ICONS.pending} ${THEME.labelSecondary(` Contest ${wallet.contests.id} (${wallet.contests.contest_code}) `)} ${balance.toFixed(6)} SOL ${THEME.highlight(' PENDING ')}`));
        continue;
      } else if (wallet.contests?.status === 'completed') {
        stats.contest.completed++;
      }
      
      // Check if balance data is fresh
      const lastUpdated = wallet.last_sync ? wallet.last_sync.getTime() : 0;
      const now = Date.now();
      const balanceFresh = now - lastUpdated <= BALANCE_FRESHNESS_MS;
      
      if (!balanceFresh) {
        console.log(THEME.warning(`${ICONS.stale} Contest ${wallet.contests?.id || 'Unknown'} (${wallet.contests?.contest_code || 'N/A'}): ${balance.toFixed(6)} SOL ${THEME.highlight(' STALE DATA ')}`));
        continue;
      }
      
      // Check if balance is worth transferring
      const transferAmount = wallet.balance - RESERVE_AMOUNT;
      if (transferAmount <= MIN_TRANSFER_AMOUNT) {
        console.log(THEME.muted(`${ICONS.low} Contest ${wallet.contests?.id || 'Unknown'} (${wallet.contests?.contest_code || 'N/A'}): ${balance.toFixed(6)} SOL (too low to transfer)`));
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
      
      console.log(THEME.success(`${ICONS.success} ${THEME.labelPrimary(` Contest ${wallet.contests?.id || 'Unknown'} `)} ${balance.toFixed(6)} SOL ${THEME.money(`(${transferAmount.toFixed(6)} SOL available)`)}`));
    }
    
    // 4. Summary
    console.log('\n' + THEME.title(`  ${ICONS.stat} Wallet Audit Summary ${ICONS.stat}  `) + '\n');
    console.log(THEME.divider);
    console.log(THEME.header(`${ICONS.wallet} Total wallets:`), THEME.info(formatNumber(stats.total.wallets)));
    console.log(THEME.header(`${ICONS.money} Total balance:`), THEME.amount(Number(stats.total.balance || 0).toFixed(6)), THEME.info('SOL'));
    console.log(THEME.header(`${ICONS.transfer} Transferable balance:`), THEME.amount(Number(totalAmount || 0).toFixed(6)), THEME.info('SOL'));
    console.log(THEME.divider);
    
    console.log('\n' + THEME.subtitle(` ${ICONS.admin} Admin Wallet Summary `));
    console.log(THEME.info(`  Total: ${THEME.success(formatNumber(stats.admin.total))}`));
    console.log(THEME.info(`  Eligible for transfer: ${THEME.success(formatNumber(stats.admin.eligible))}`));
    console.log(THEME.info(`  Total balance: ${THEME.amount(Number(stats.admin.balance || 0).toFixed(6))} SOL`));
    console.log(THEME.info(`  Transferable: ${THEME.amount(Number(stats.admin.transferable || 0).toFixed(6))} SOL`));
    
    console.log('\n' + THEME.subtitle(` ${ICONS.contest} Contest Wallet Summary `));
    console.log(THEME.info(`  Total: ${THEME.success(formatNumber(stats.contest.total))}`));
    console.log(THEME.info(`  Active contests: ${THEME.success(formatNumber(stats.contest.active))}`));
    console.log(THEME.info(`  Pending contests: ${THEME.success(formatNumber(stats.contest.pending))}`));
    console.log(THEME.info(`  Completed contests: ${THEME.success(formatNumber(stats.contest.completed))}`));
    console.log(THEME.info(`  Eligible for transfer: ${THEME.success(formatNumber(stats.contest.eligible))}`));
    console.log(THEME.info(`  Total balance: ${THEME.amount(Number(stats.contest.balance || 0).toFixed(6))} SOL`));
    console.log(THEME.info(`  Transferable: ${THEME.amount(Number(stats.contest.transferable || 0).toFixed(6))} SOL`));
    
    console.log('\n' + THEME.highlight(` ${ICONS.info} To transfer funds to treasury, run: `));
    console.log(THEME.money(`  npm run mm:consolidate`));
    console.log(THEME.divider + '\n');
    
  } catch (error) {
    console.error(THEME.error(`\n${ICONS.error} Error: ${error.message}`));
    console.error(error.stack);
  }
}

// Run the main function
main().catch(error => {
  console.error(THEME.error(`\n${ICONS.error} Fatal error: ${error.message}`));
  console.error(error.stack);
  process.exit(1);
});