#!/usr/bin/env node

/**
 * ✨ DegenDuel Treasury Fund Consolidation Script ✨
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
import figures from 'figures';

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
  money: '💎',
  alert: '🚨',
  question: '❓',
  log: '📝',
  check: '✅',
  cancel: '❌',
  clock: '⏰',
  key: '🔑'
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
  inputPrompt: chalk.bgWhite.black,
  transaction: chalk.blueBright.underline,
  divider: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  attention: chalk.bgRed.white.bold,
  processStep: chalk.bgGreen.black
};

// Helper function to format numbers with commas for better readability
function formatNumber(number) {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Configuration
const TREASURY_WALLET = process.env.TREASURY_WALLET_ADDRESS;
if (!TREASURY_WALLET) {
  console.error(THEME.error(`\n${ICONS.error} ERROR: TREASURY_WALLET_ADDRESS not defined in environment`));
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

// Helper function to prompt for input
function promptInput(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// Main function
async function main() {
  console.log('\n' + THEME.title(`  ${ICONS.wallet} DegenDuel Treasury Fund Consolidation ${ICONS.wallet}  `) + '\n');
  console.log(THEME.info(`${ICONS.treasury} Default treasury wallet: ${THEME.address(TREASURY_WALLET)}`));
  
  // a) Ask for an alternate wallet address
  const newAddress = await promptInput(THEME.inputPrompt(` ${ICONS.question} Enter alternate destination wallet address (or press Enter to use default): `));
  const destinationWallet = newAddress.trim() !== '' ? newAddress.trim() : TREASURY_WALLET;
  
  if (destinationWallet !== TREASURY_WALLET) {
    console.log(THEME.highlight(`${ICONS.alert} Using custom destination wallet: ${THEME.address(destinationWallet)}`));
  } else {
    console.log(THEME.info(`${ICONS.treasury} Using default treasury wallet: ${THEME.address(destinationWallet)}`));
  }
  
  // c) Ask if user wants to include all contest wallets
  const includeAllAnswer = await promptInput(THEME.inputPrompt(` ${ICONS.question} Include contest wallets from active and pending contests? (y/N): `));
  const includeAllContests = includeAllAnswer.toLowerCase() === 'y';
  
  if (includeAllContests) {
    console.log(THEME.highlight(`${ICONS.alert} Will process ALL contest wallets, including active and pending contests!`));
  } else {
    console.log(THEME.info(`${ICONS.info} Skipping active and pending contest wallets (default behavior)`));
  }
  
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
    
    // 3. Process each wallet type
    const transferCandidates = [];
    let totalAmount = 0;
    
    // Process admin wallets
    console.log('\n' + THEME.subtitle(` ${ICONS.admin} Analyzing Admin Wallets `) + '\n');
    for (const wallet of managedWallets) {
      // Check if balance data exists and is fresh
      const metadata = wallet.metadata || {};
      const balanceData = metadata.balance || {};
      const lastUpdated = balanceData.last_updated ? new Date(balanceData.last_updated).getTime() : 0;
      const now = Date.now();
      
      if (!balanceData.sol || now - lastUpdated > BALANCE_FRESHNESS_MS) {
        console.log(THEME.warning(`${ICONS.stale} ${THEME.labelSecondary(` ${wallet.label || wallet.public_key} `)} Balance data stale or missing, skipping`));
        continue;
      }
      
      // Check if balance is worth transferring
      const transferAmount = balanceData.sol - RESERVE_AMOUNT;
      if (transferAmount <= MIN_TRANSFER_AMOUNT) {
        console.log(THEME.muted(`${ICONS.low} ${wallet.label || wallet.public_key}: Balance too low (${balanceData.sol} SOL), skipping`));
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
      console.log(THEME.success(`${ICONS.success} ${THEME.labelPrimary(` ${wallet.label || wallet.public_key} `)} ${THEME.amount(transferAmount.toFixed(6))} SOL available`));
    }
    
    // Process contest wallets
    console.log('\n' + THEME.subtitle(` ${ICONS.contest} Analyzing Contest Wallets `) + '\n');
    for (const wallet of contestWallets) {
      // Only process wallets based on user selection
      if (!includeAllContests && (wallet.contests?.status === 'active' || wallet.contests?.status === 'pending')) {
        console.log(THEME.muted(`${wallet.contests?.status === 'active' ? ICONS.active : ICONS.pending} ${THEME.labelSecondary(` Contest ${wallet.contests.id} (${wallet.contests.contest_code}) `)} Status is ${wallet.contests.status}, skipping`));
        continue;
      }
      
      // Check if balance data is fresh
      const lastUpdated = wallet.last_sync ? wallet.last_sync.getTime() : 0;
      const now = Date.now();
      
      if (now - lastUpdated > BALANCE_FRESHNESS_MS) {
        console.log(THEME.warning(`${ICONS.stale} Contest ${wallet.contests?.id || 'Unknown'}: Balance data stale, skipping`));
        continue;
      }
      
      // Check if balance is worth transferring
      const transferAmount = wallet.balance - RESERVE_AMOUNT;
      if (transferAmount <= MIN_TRANSFER_AMOUNT) {
        console.log(THEME.muted(`${ICONS.low} Contest ${wallet.contests?.id || 'Unknown'}: Balance too low (${wallet.balance} SOL), skipping`));
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
      console.log(THEME.success(`${ICONS.success} ${THEME.labelPrimary(` Contest ${wallet.contests?.id || 'Unknown'} `)} ${THEME.amount(transferAmount.toFixed(6))} SOL available`));
    }
    
    // 4. Summary and confirmation
    console.log('\n' + THEME.title(`  ${ICONS.stat} Transfer Summary ${ICONS.stat}  `) + '\n');
    console.log(THEME.divider);
    console.log(THEME.header(`    ${ICONS.wallet} Wallets:`), THEME.info(`${formatNumber(transferCandidates.length)} of ${formatNumber(managedWallets.length + contestWallets.length)} eligible`));
    console.log(THEME.header(`  ${ICONS.money} Total SOL:`), THEME.amount(`${totalAmount.toFixed(6)}`), THEME.info('SOL'));
    console.log(THEME.header(`${ICONS.treasury} Destination:`), THEME.address(`${destinationWallet}`));
    console.log(THEME.divider);
    
    if (transferCandidates.length === 0) {
      console.log(THEME.error(`\n${ICONS.error} No eligible wallets found for transfer`));
      rl.close();
      return;
    }
    
    // Confirm transfer
    const confirmed = await confirm(THEME.attention(`\n${ICONS.alert} WARNING: This will transfer all funds to ${destinationWallet === TREASURY_WALLET ? 'the DegenDuel treasury wallet' : 'the custom wallet address'}.\nAre you sure you want to proceed? (y/N) `));
    
    if (!confirmed) {
      console.log(THEME.warning(`\n${ICONS.cancel} Operation cancelled by user`));
      rl.close();
      return;
    }
    
    // Double confirm
    const doubleConfirmed = await confirm(THEME.attention(`\n${ICONS.alert} FINAL WARNING: This operation cannot be undone.\nType y to confirm: `));
    
    if (!doubleConfirmed) {
      console.log(THEME.warning(`\n${ICONS.cancel} Operation cancelled by user`));
      rl.close();
      return;
    }
    
    // 5. Execute transfers
    console.log('\n' + THEME.title(`  ${ICONS.transfer} Executing Transfers ${ICONS.transfer}  `) + '\n');
    
    const results = {
      successful: 0,
      failed: 0,
      totalTransferred: 0,
      details: []
    };
    
    // Process transfers
    for (const candidate of transferCandidates) {
      try {
        console.log(THEME.processStep(` ${ICONS.money} Processing ${candidate.label}... `));
        
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
            destinationWallet,  // Use the chosen destination wallet
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
            destinationWallet,  // Use the chosen destination wallet
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
        
        console.log(THEME.success(`${ICONS.success} Successfully transferred ${THEME.amount(candidate.transferAmount.toFixed(6))} SOL to destination`));
        console.log(THEME.info(`${ICONS.key} Transaction: ${THEME.transaction(signature)}`));
        console.log(THEME.info(`${ICONS.info} Explorer: https://solscan.io/tx/${signature}`));
      } catch (error) {
        console.error(THEME.error(`${ICONS.error} Failed to transfer from ${candidate.label}: ${error.message}`));
        results.failed++;
        results.details.push({
          ...candidate,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // 6. Final summary
    console.log('\n' + THEME.title(`  ${ICONS.stat} Final Transfer Summary ${ICONS.stat}  `) + '\n');
    console.log(THEME.divider);
    console.log(THEME.header(`${ICONS.success} Succeeded:`), THEME.success(`${results.successful}/${transferCandidates.length}`));
    console.log(THEME.header(`${ICONS.error} Failed:`), results.failed > 0 ? THEME.error(`${results.failed}/${transferCandidates.length}`) : THEME.success(`${results.failed}/${transferCandidates.length}`));
    console.log(THEME.header(`${ICONS.money} Total SOL:`), THEME.amount(`${results.totalTransferred.toFixed(6)}`), THEME.info('SOL'));
    console.log(THEME.divider);
    
    // Log to file
    const logFile = `${__dirname}/consolidation_${Date.now()}.json`;
    const fs = await import('fs');
    fs.writeFileSync(logFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      treasury: destinationWallet,  // Log the destination wallet used
      includeAllContests,  // Log whether all contests were included
      results
    }, null, 2));
    
    console.log(THEME.info(`\n${ICONS.log} Detailed log saved to: ${logFile}`));
    
  } catch (error) {
    console.error(THEME.error(`\n${ICONS.error} Error: ${error.message}`));
    console.error(error.stack);
  } finally {
    rl.close();
  }
}

// Run the main function
main().catch(error => {
  console.error(THEME.error(`\n${ICONS.error} Fatal error: ${error.message}`));
  console.error(error.stack);
  process.exit(1);
});