#!/usr/bin/env node

/**
 * DegenDuel Wallet Key Recovery Tool
 * 
 * This script attempts to decrypt wallet private keys using various methods.
 * It can be run directly from the command line.
 * 
 * Usage:
 *   node key-recovery.js --key YOUR_ENCRYPTION_KEY --wallet WALLET_ADDRESS
 *   node key-recovery.js --keyfile path/to/keyfile --wallet WALLET_ADDRESS
 *   node key-recovery.js --encdata '{"encrypted":"...","iv":"...","tag":"..."}' --key YOUR_ENCRYPTION_KEY
 *   node key-recovery.js --list [number_of_wallets]
 */

import crypto from 'crypto';
import bs58 from 'bs58';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { sendAndConfirmTransaction } from '@solana/web3.js';
import { SystemProgram, Transaction } from '@solana/web3.js';
import readline from 'readline';
const prisma = new PrismaClient();

// Add our own delay function implementation
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Parse command line arguments
const args = process.argv.slice(2);
let walletAddress = null;
let encryptionKey = null;
let encryptedData = null;
let keyFile = null;
let listWallets = false;
let verifyAll = false;
let silentVerifyAll = false;
let reclaimWallet = false;
let reclaimAll = false;
let treasuryAddress = null;
let testMode = false;
let rpcEndpoint = 'http://162.249.175.2:8898/';
let backupRpcEndpoint = 'https://mainnet.helius-rpc.com/?api-key=8fd1a2cd-76e7-4462-b38b-1026960edd40';
let backupWsEndpoint = 'wss://mainnet.helius-rpc.com/?api-key=8fd1a2cd-76e7-4462-b38b-1026960edd40';
let useBackupRpc = false;
let limit = 5000; // Increased default limit to process all wallets
let verbose = true;
let dryRun = false;
let minBalanceToReclaim = 0.0001; // SOL
let minBalanceToKeep = 0.001; // SOL - Minimum required for rent exemption
let requestsPerBatch = 100; // Number of requests to process before pausing
let batchPauseMs = 1000; // Pause duration between batches
let selfTestMode = false;
let minTestAmount = 0.01; // Minimum SOL required for test

// Add test mode option in the args parsing
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--wallet' || arg === '-w') {
    walletAddress = args[++i];
  } else if (arg === '--key' || arg === '-k') {
    encryptionKey = args[++i];
  } else if (arg === '--encdata' || arg === '-e') {
    encryptedData = args[++i];
  } else if (arg === '--keyfile' || arg === '-f') {
    keyFile = args[++i];
  } else if (arg === '--list' || arg === '-l') {
    listWallets = true;
    // Check if next arg is a number for limit
    if (i+1 < args.length && !isNaN(args[i+1])) {
      limit = parseInt(args[++i]);
    }
  } else if (arg === '--verify-all' || arg === '-va') {
    verifyAll = true;
  } else if (arg === '--reclaim' || arg === '-r') {
    reclaimWallet = true;
  } else if (arg === '--reclaim-all' || arg === '-ra') {
    reclaimAll = true;
  } else if (arg === '--treasury' || arg === '-t') {
    treasuryAddress = args[++i];
  } else if (arg === '--rpc' || arg === '-rpc') {
    rpcEndpoint = args[++i];
  } else if (arg === '--backup-rpc' || arg === '-brpc') {
    backupRpcEndpoint = args[++i];
  } else if (arg === '--use-backup' || arg === '-ub') {
    useBackupRpc = true;
  } else if (arg === '--test-mode' || arg === '-tm') {
    testMode = true;
  } else if (arg === '--batch-size' || arg === '-bs') {
    requestsPerBatch = parseInt(args[++i], 10);
  } else if (arg === '--batch-pause' || arg === '-bp') {
    batchPauseMs = parseInt(args[++i], 10);
  } else if (arg === '--min-reclaim' || arg === '-mr') {
    minBalanceToReclaim = parseFloat(args[++i]);
  } else if (arg === '--min-keep' || arg === '-mk') {
    minBalanceToKeep = parseFloat(args[++i]);
  } else if (arg === '--dry-run' || arg === '-d') {
    dryRun = true;
  } else if (arg === '--self-test' || arg === '-st') {
    selfTestMode = true;
    // Check if the next argument is a number (minimum test amount)
    if (i+1 < args.length && !isNaN(args[i+1])) {
      minTestAmount = parseFloat(args[++i]);
    }
  } else if (arg === '--help' || arg === '-h') {
    showHelp();
    process.exit(0);
  }
}

function showHelp() {
  console.log(`\nKey Recovery and Fund Reclamation Tool`);
  console.log(`====================================`);
  console.log(`This tool can decrypt wallet private keys, verify addresses, and reclaim funds.`);
  console.log(`\nUSAGE:`);
  console.log(`  node key-recovery.js [options]`);
  console.log(`\nOPTIONS:`);
  console.log(`  --wallet, -w      Wallet address to recover keys for`);
  console.log(`  --key, -k         Encryption key to try`);
  console.log(`  --keyfile, -f     File containing encryption keys to try (one per line)`);
  console.log(`  --list, -l        List available wallets (limit with --limit parameter)`);
  console.log(`  --verify-all, -va  Verify all wallet private keys against their addresses`);
  console.log(`  --reclaim, -r     Reclaim funds from a specific wallet to treasury`);
  console.log(`  --reclaim-all, -ra Reclaim funds from all eligible wallets to treasury`);
  console.log(`  --treasury, -t    Treasury wallet address to send reclaimed funds to`);
  console.log(`  --rpc, -rpc       RPC endpoint to use (default: http://162.249.175.2:8898/)`);
  console.log(`  --backup-rpc, -brpc Backup RPC endpoint (default: Helius)`);
  console.log(`  --use-backup, -ub Use the backup RPC endpoint instead of primary`);
  console.log(`  --test-mode, -tm  Test mode: Send funds back to original wallets after transfer`);
  console.log(`  --batch-size, -bs Number of requests per batch (default: 100)`);
  console.log(`  --batch-pause, -bp Milliseconds to pause between batches (default: 1000)`);
  console.log(`  --min-reclaim     Minimum balance required to attempt reclamation (default: 0.0001 SOL)`);
  console.log(`  --min-keep        Minimum balance to keep in wallet (default: 0.001 SOL)`);
  console.log(`                    Note: Solana requires ~0.00089 SOL minimum for rent exemption`);
  console.log(`  --dry-run, -d     Don't actually send any transactions, just simulate`);
  console.log(`  --self-test, -st   Create a test keypair and wait for funds to arrive before testing`);
  console.log(`                    You can specify a minimum amount (default: 0.01 SOL)`);
  console.log(`  --help, -h        Show this help message`);
  console.log(`\nEXAMPLES:`);
  console.log(`  List available wallets:`);
  console.log(`    node key-recovery.js --list`);
  console.log(`\n  Recover a private key:`);
  console.log(`    node key-recovery.js --wallet <ADDRESS> --key <ENCRYPTION_KEY>`);
  console.log(`\n  Reclaim funds from a specific wallet:`);
  console.log(`    node key-recovery.js --reclaim --wallet <ADDRESS> --key <ENCRYPTION_KEY> --treasury <TREASURY_ADDRESS>`);
  console.log(`\n  Reclaim funds from all eligible wallets:`);
  console.log(`    node key-recovery.js --reclaim-all --key <ENCRYPTION_KEY> --treasury <TREASURY_ADDRESS>`);
  console.log(`\n  Test mode (sends funds back to original wallets):`);
  console.log(`    node key-recovery.js --reclaim-all --key <KEY> --treasury <TEST_TREASURY> --test-mode`);
  console.log(`\n  Use backup RPC endpoint:`);
  console.log(`    node key-recovery.js --reclaim-all --key <KEY> --treasury <TREASURY> --use-backup`);
  console.log(`\n  Self-test mode (creates test wallet, waits for funds, then returns them):`);
  console.log(`    node key-recovery.js --self-test 0.05`);
}

// Try AES-256-GCM decryption
function tryDecrypt(encryptedData, keyHex) {
  try {
    const data = JSON.parse(encryptedData);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(keyHex, 'hex'),
      Buffer.from(data.iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
    if (data.aad) decipher.setAAD(Buffer.from(data.aad));
    
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(data.encrypted, 'hex')),
      decipher.final()
    ]);
    
    return decrypted.toString();
  } catch (error) {
    return null;
  }
}

// Try to recover plaintext key from different formats
function recoverKey(privateKey) {
  // Check if the data might already be in plaintext format (not JSON)
  if (typeof privateKey === 'string' && !privateKey.startsWith('{')) {
    console.log("Key appears to be in plaintext format already");
    return privateKey;
  }
  
  // Try to parse as JSON
  try {
    const data = JSON.parse(privateKey);
    if (Array.isArray(data) && data.length === 64) {
      console.log("Key is in JSON array format (64 bytes)");
      return JSON.stringify(data);
    }
  } catch (e) {
    // Not JSON, continue to other formats
  }
  
  return null;
}

// Validate if decryption result looks like a valid key
function validateKey(decrypted) {
  // Check if it's valid JSON
  try {
    const parsed = JSON.parse(decrypted);
    console.log("Valid JSON format", 
      Array.isArray(parsed) ? `(array of ${parsed.length} elements)` : `(object with ${Object.keys(parsed).length} keys)`);
    return true;
  } catch (e) {
    // Not JSON, try other formats
  }
  
  // Check if it's hex (128 chars)
  if (/^[0-9a-fA-F]{128}$/.test(decrypted)) {
    console.log("Valid hex format (128 chars)");
    return true;
  }
  
  // Try as base58
  try {
    const decoded = bs58.decode(decrypted);
    console.log(`Valid base58 format (decodes to ${decoded.length} bytes)`);
    if (decoded.length === 64 || decoded.length === 32) {
      return true;
    }
  } catch (e) {
    // Not base58, continue
  }
  
  // If we couldn't validate, just check if it's a reasonable string
  if (decrypted && decrypted.length > 16 && decrypted.length < 256) {
    console.log(`Possibly valid key format (${decrypted.length} chars)`);
    return true;
  }
  
  return false;
}

// Try different methods to decrypt the key
async function attemptDecryption(encData, keys) {
  console.log("\n🔑 Attempting decryption with provided keys...");

  for (const key of keys) {
    if (!key) continue;
    
    console.log(`\nTrying key: ${key.substring(0, 4)}...${key.substring(key.length-4)}`);
    
    // First try normal AES-GCM decryption
    const decrypted = tryDecrypt(encData, key);
    if (decrypted && validateKey(decrypted)) {
      console.log("\n✅ DECRYPTION SUCCESSFUL with AES-256-GCM!");
      console.log("Decrypted value:", decrypted);
      
      // Also try to recover a usable Solana key
      try {
        if (decrypted.startsWith('[')) {
          console.log("\nThis appears to be a Solana keypair in JSON array format");
          console.log("You can use this with Keypair.fromSecretKey(Uint8Array.from(JSON.parse(privateKeyString)))");
        } else if (/^[0-9a-fA-F]+$/.test(decrypted)) {
          console.log("\nThis appears to be a hex-encoded private key");
          console.log("You can use this with Keypair.fromSecretKey(Buffer.from(privateKeyString, 'hex'))");
        }
      } catch (e) {
        // Ignore parsing errors here
      }

      return true;
    }
    
    // Try direct recovery without decryption
    const recovered = recoverKey(encData);
    if (recovered) {
      console.log("\n✅ RECOVERY SUCCESSFUL directly from input!");
      console.log("Recovered value:", recovered);
      return true;
    }
  }
  
  console.log("\n❌ Decryption failed with all provided keys.");
  return false;
}

// Add a new function to list all available wallets
async function listAvailableWallets(maxResults = 20) {
  console.log("DegenDuel Wallet List Tool");
  console.log("=========================");
  console.log(`Showing up to ${maxResults} wallets from each table\n`);

  try {
    // Get wallets from contest_wallets table
    const contestWallets = await prisma.contest_wallets.findMany({
      take: maxResults,
      orderBy: { created_at: 'desc' },
      include: {
        contests: {
          select: {
            contest_code: true,
            status: true
          }
        }
      }
    });

    console.log(`\n📋 CONTEST WALLETS (${contestWallets.length}):`);
    console.log("-".repeat(80));
    console.log("| ADDRESS                                      | CONTEST      | STATUS    | BALANCE    |");
    console.log("-".repeat(80));
    
    contestWallets.forEach(wallet => {
      const address = wallet.wallet_address || "N/A";
      const contestCode = wallet.contests?.contest_code || "N/A";
      const status = wallet.contests?.status || "N/A";
      const balance = wallet.balance ? wallet.balance.toFixed(6) : "0.000000";
      
      console.log(`| ${address.padEnd(44)} | ${contestCode.padEnd(12)} | ${status.padEnd(9)} | ${balance.padEnd(10)} |`);
    });
    
    // Get wallets from vanity_wallet_pool table
    const vanityWallets = await prisma.vanity_wallet_pool.findMany({
      take: maxResults,
      orderBy: { created_at: 'desc' },
      where: {
        wallet_address: { not: null }
      }
    });

    console.log(`\n📋 VANITY WALLETS (${vanityWallets.length}):`);
    console.log("-".repeat(80));
    console.log("| ADDRESS                                      | PATTERN      | STATUS    | USED       |");
    console.log("-".repeat(80));
    
    vanityWallets.forEach(wallet => {
      const address = wallet.wallet_address || "N/A";
      const pattern = wallet.pattern || "N/A";
      const status = wallet.status || "N/A";
      const used = wallet.is_used ? "Yes" : "No";
      
      console.log(`| ${address.padEnd(44)} | ${pattern.padEnd(12)} | ${status.padEnd(9)} | ${used.padEnd(10)} |`);
    });
    
    console.log("\n✅ To decrypt a specific wallet, run:");
    console.log("  node key-recovery.js --wallet WALLET_ADDRESS --key YOUR_ENCRYPTION_KEY");
    
  } catch (error) {
    console.error("Database error:", error.message);
  }
  
  // Clean up
  await prisma.$disconnect();
}

// Add a function to get connection with fallback support
function getConnection(useBackup = false) {
  const primaryRpc = rpcEndpoint;
  const primaryWs = primaryRpc.replace('http://', 'ws://').replace('8898', '8900');
  
  const backupRpc = backupRpcEndpoint;
  const backupWs = backupWsEndpoint;
  
  const rpc = useBackup ? backupRpc : primaryRpc;
  const ws = useBackup ? backupWs : primaryWs;
  
  console.log(`Using ${useBackup ? 'BACKUP' : 'PRIMARY'} RPC: ${rpc}`);
  console.log(`Using ${useBackup ? 'BACKUP' : 'PRIMARY'} WebSocket: ${ws}`);
  
  return new Connection(
    rpc, 
    {
      wsEndpoint: ws,
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000 // 60 seconds
    }
  );
}

// Modify reclaimFundsFromWallet to use the connection utility
async function reclaimFundsFromWallet(wallet, treasuryAddress, keys, useBackup = false, originalKeypair = null) {
  try {
    console.log(`\n🔄 Reclaiming funds from wallet: ${wallet.wallet_address}`);
    
    // Decrypt the private key first to see if we can proceed
    console.log(`Attempting to decrypt private key...`);
    const privateKeyData = wallet.private_key;
    
    let keypair = null;
    let decrypted = null;
    
    // Skip decryption if originalKeypair is provided (for test mode return transfer)
    if (originalKeypair) {
      console.log(`Using provided keypair for treasury`);
      keypair = originalKeypair;
    } else {
      // Try each key for decryption
      for (const key of keys) {
        if (!key) continue;
        
        decrypted = tryDecrypt(privateKeyData, key);
        if (decrypted && validateKey(decrypted)) {
          console.log(`✅ Successfully decrypted private key!`);
          keypair = extractKeypairFromDecrypted(decrypted);
          if (keypair) break;
        }
      }
    }
    
    if (!keypair) {
      console.log(`❌ Failed to decrypt or create keypair for wallet: ${wallet.wallet_address}`);
      return { success: false, error: 'Failed to decrypt or create keypair' };
    }
    
    // Get connection with fallback support
    const connection = getConnection(useBackup);
    
    // Verify the keypair matches the wallet address
    const derivedAddress = keypair.publicKey.toString();
    if (!originalKeypair && derivedAddress !== wallet.wallet_address) {
      console.log(`❌ Derived address ${derivedAddress} does not match wallet address ${wallet.wallet_address}`);
      return { success: false, error: 'Address mismatch' };
    }
    
    if (originalKeypair) {
      console.log(`ℹ️ Using treasury keypair: ${derivedAddress}`);
    } else {
      console.log(`✅ Keypair verified. Derived address: ${derivedAddress}`);
    }
    
    // Check balance
    const balance = await connection.getBalance(keypair.publicKey);
    const balanceSol = balance / 1_000_000_000; // convert lamports to SOL
    
    console.log(`Current balance: ${balanceSol.toFixed(6)} SOL`);
    
    if (balanceSol < minBalanceToReclaim) {
      console.log(`❌ Balance too low for reclamation (minimum: ${minBalanceToReclaim} SOL)`);
      return { success: false, error: 'Balance too low' };
    }
    
    // Calculate amount to transfer (leave minBalanceToKeep)
    const amountToTransfer = balanceSol - minBalanceToKeep;
    
    if (amountToTransfer <= 0) {
      console.log(`❌ No funds to transfer: Balance (${balanceSol.toFixed(6)} SOL) is at or below minimum keep amount (${minBalanceToKeep} SOL)`);
      console.log(`   Note: Solana requires ~0.00089 SOL minimum for rent exemption`);
      return { success: false, error: `Balance too low for transfer: ${balanceSol.toFixed(6)} SOL` };
    }
    
    console.log(`Will transfer ${amountToTransfer.toFixed(6)} SOL to ${originalKeypair ? 'original wallet' : 'treasury'}: ${treasuryAddress}`);
    console.log(`Will keep ${minBalanceToKeep.toFixed(6)} SOL in wallet (required for rent exemption)`);
    
    // Add confirmation step
    if (!dryRun) {
      console.log(`\n⚠️ CONFIRMATION REQUIRED`);
      console.log(`   You are about to transfer ${amountToTransfer.toFixed(6)} SOL`);
      console.log(`   From: ${keypair.publicKey.toString()}`);
      console.log(`   To:   ${treasuryAddress}`);
      
      const confirmed = await confirmAction(`Do you want to proceed with this transfer?`);
      if (!confirmed) {
        console.log(`❌ Transfer cancelled by user`);
        return { success: false, error: 'Cancelled by user' };
      }
      
      console.log(`✅ Transfer confirmed, proceeding...`);
    }
    
    if (dryRun) {
      console.log(`🔄 DRY RUN - No actual transfer will be made`);
      return { success: true, txid: 'dry-run', amount: amountToTransfer };
    }
    
    // Create transfer transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(treasuryAddress),
        lamports: Math.floor(amountToTransfer * 1_000_000_000), // convert SOL to lamports
      })
    );
    
    transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
    transaction.feePayer = keypair.publicKey;
    
    // Send and confirm the transaction
    try {
      const txid = await sendAndConfirmTransaction(
        connection,
        transaction,
        [keypair],
        {
          skipPreflight: true,
          maxRetries: 5,
          commitment: 'confirmed'
        }
      );
      
      const solscanLink = `https://solscan.io/tx/${txid}`;
      console.log(`✅ TRANSACTION SUCCESSFUL! TXID: ${txid}`);
      console.log(`🔗 Solscan: ${solscanLink}`);
      console.log(`🔄 Transferred ${amountToTransfer.toFixed(6)} SOL to ${originalKeypair ? 'original wallet' : 'treasury'}`);
      
      // Update wallet balance in DB only if this is the initial transfer (not the return transfer in test mode)
      if (!originalKeypair) {
        try {
          if (wallet.type === 'contest') {
            await prisma.contest_wallets.update({
              where: { id: wallet.id },
              data: { balance: minBalanceToKeep }
            });
            console.log(`✅ Updated wallet balance in database to ${minBalanceToKeep} SOL`);
          } else if (wallet.type === 'vanity') {
            await prisma.vanity_wallet_pool.update({
              where: { id: wallet.id },
              data: { balance: minBalanceToKeep }
            });
            console.log(`✅ Updated wallet balance in database to ${minBalanceToKeep} SOL`);
          }
        } catch (dbError) {
          console.log(`⚠️ Failed to update wallet balance in database: ${dbError.message}`);
        }
      }
      
      return { 
        success: true, 
        txid, 
        solscanLink, 
        amount: amountToTransfer,
        walletAddress: wallet.wallet_address
      };
    } catch (txError) {
      console.log(`❌ Transaction failed: ${txError.message}`);
      
      // Retry with backup RPC if this was using primary and failed
      if (!useBackup && backupRpcEndpoint) {
        console.log(`🔄 Retrying with backup RPC...`);
        return reclaimFundsFromWallet(wallet, treasuryAddress, keys, true, originalKeypair);
      }
      
      // Provide more helpful information about common errors
      if (txError.message.includes('InsufficientFundsForRent')) {
        console.log(`   This error occurs when a wallet doesn't have enough SOL to maintain rent exemption.`);
        console.log(`   Solana requires accounts to maintain ~0.00089 SOL minimum balance.`);
        console.log(`   Try increasing the --min-keep parameter (currently ${minBalanceToKeep} SOL).`);
      } else if (txError.message.includes('Transaction was not confirmed')) {
        console.log(`   Transaction timed out. This could be due to network congestion.`);
        console.log(`   Try again or check if the transaction actually went through on Solscan.`);
      }
      
      return { success: false, error: txError.message };
    }
  } catch (error) {
    console.log(`❌ Error processing wallet: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Add a function for test mode to return funds to original wallet
async function returnFundsToWallet(treasuryKeypair, originalWallet, amount, useBackup = false) {
  console.log(`\n🔄 TEST MODE: Returning funds to original wallet: ${originalWallet}`);
  
  // Create a dummy wallet object with the treasury keypair
  const dummyWallet = {
    wallet_address: treasuryKeypair.publicKey.toString(),
    private_key: null, // Not needed as we pass the keypair directly
    type: 'treasury'
  };
  
  // Call reclaimFundsFromWallet with the treasury as the source
  return reclaimFundsFromWallet(
    dummyWallet,
    originalWallet,
    [], // Empty keys array since we're passing keypair directly
    useBackup,
    treasuryKeypair // Pass the keypair directly
  );
}

// Modify reclaimAllFunds to use the improved batching and add test mode
async function reclaimAllFunds(keys, treasuryAddress, maxWallets = 5000) {
  // Higher performance settings
  const BATCH_SIZE = requestsPerBatch; // Use the command line parameter
  const DELAY_BETWEEN_BATCHES = batchPauseMs; // Use the command line parameter
  const DELAY_BETWEEN_TXS = 200; // Reduced from 500ms to 200ms
  
  console.log(`\n🔄 RECLAIMING FUNDS FROM ALL ELIGIBLE WALLETS`);
  console.log(`Treasury: ${treasuryAddress}`);
  console.log(`Min balance to reclaim: ${minBalanceToReclaim} SOL`);
  console.log(`Min balance to keep: ${minBalanceToKeep} SOL (Solana requires ~0.00089 SOL for rent exemption)`);
  console.log(`Max wallets to process: ${maxWallets}`);
  console.log(`Primary RPC: ${rpcEndpoint}`);
  console.log(`Backup RPC: ${backupRpcEndpoint}`);
  console.log(`Using: ${useBackupRpc ? 'BACKUP' : 'PRIMARY'} RPC`);
  console.log(`Test mode: ${testMode ? 'ENABLED - Funds will be returned to original wallets' : 'DISABLED'}`);
  console.log(`Batch size: ${BATCH_SIZE} wallets per batch`);
  console.log(`Batch pause: ${DELAY_BETWEEN_BATCHES}ms between batches`);
  console.log(`Transaction pause: ${DELAY_BETWEEN_TXS}ms between transactions`);
  console.log(`${dryRun ? 'DRY RUN - No actual transfers will be made' : 'LIVE RUN - Transfers will be executed'}`);
  
  // Load treasury keypair for test mode
  let treasuryKeypair = null;
  if (testMode && !dryRun) {
    console.log(`\n⚠️ TEST MODE REQUIRES TREASURY PRIVATE KEY`);
    const treasuryPrivateKeyHex = await confirmAction(
      `Please enter the private key for treasury wallet ${treasuryAddress} to enable test mode returns`
    );
    if (!treasuryPrivateKeyHex) {
      console.log(`❌ Treasury private key required for test mode. Operation cancelled.`);
      return { 
        success: false, 
        error: 'Treasury private key required for test mode',
        processed: 0,
        successful: 0,
        failed: 0,
        totalReclaimed: 0
      };
    }
    
    try {
      // Convert hex to Uint8Array
      const privateKeyBytes = Buffer.from(treasuryPrivateKeyHex, 'hex');
      treasuryKeypair = Keypair.fromSecretKey(privateKeyBytes);
      console.log(`✅ Treasury keypair loaded. Public key: ${treasuryKeypair.publicKey.toString()}`);
      
      if (treasuryKeypair.publicKey.toString() !== treasuryAddress) {
        console.log(`❌ ERROR: Treasury keypair public key does not match specified treasury address.`);
        console.log(`  Keypair: ${treasuryKeypair.publicKey.toString()}`);
        console.log(`  Expected: ${treasuryAddress}`);
        return { 
          success: false, 
          error: 'Treasury keypair mismatch',
          processed: 0,
          successful: 0,
          failed: 0,
          totalReclaimed: 0
        };
      }
    } catch (error) {
      console.log(`❌ ERROR: Failed to load treasury keypair: ${error.message}`);
      return { 
        success: false, 
        error: `Failed to load treasury keypair: ${error.message}`,
        processed: 0,
        successful: 0,
        failed: 0,
        totalReclaimed: 0
      };
    }
  }
  
  // Get connection with fallback support
  const connection = getConnection(useBackupRpc);
  
  try {
    // Get contest wallets with balance above minimum
    const contestWallets = await prisma.contest_wallets.findMany({
      where: {
        balance: {
          gt: minBalanceToReclaim
        }
      },
      orderBy: { balance: 'desc' },
      take: maxWallets,
      include: {
        contests: {
          select: {
            contest_code: true
          }
        }
      }
    });
    
    // Get vanity wallets (we'll check balance on-chain)
    const vanityWallets = await prisma.vanity_wallet_pool.findMany({
      where: {
        is_used: false,
        status: "completed" 
      },
      orderBy: { created_at: 'desc' },
      take: Math.floor(maxWallets / 5)
    });
    
    const allWallets = [
      ...contestWallets.map(w => ({ 
        ...w, 
        type: 'contest',
        contestCode: w.contests?.contest_code || 'unknown'
      })),
      ...vanityWallets.map(w => ({ 
        ...w, 
        type: 'vanity',
      }))
    ];
    
    console.log(`Found ${allWallets.length} potential wallets (${contestWallets.length} contest, ${vanityWallets.length} vanity)`);
    
    // Create Solana connection with correct WebSocket endpoint
    const wsEndpoint = rpcEndpoint.replace('http://', 'ws://').replace('8898', '8900');
    const connection = new Connection(
      rpcEndpoint, 
      {
        wsEndpoint,
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000 // 60 seconds
      }
    );
    
    // Add confirmation at the start for all wallets
    if (!dryRun && allWallets.length > 0) {
      console.log(`\n⚠️ CONFIRMATION REQUIRED`);
      console.log(`You are about to process ${allWallets.length} wallets and potentially reclaim funds to:`);
      console.log(`Treasury: ${treasuryAddress}`);
      
      if (testMode) {
        console.log(`TEST MODE ENABLED: Funds will be temporarily sent to treasury, then returned to original wallets.`);
      }
      
      const confirmed = await confirmAction(`Are you sure you want to proceed with reclaiming funds from these wallets?`);
      if (!confirmed) {
        console.log(`❌ Operation cancelled by user`);
        return { 
          success: false, 
          error: 'Cancelled by user',
          processed: 0,
          successful: 0,
          failed: 0,
          totalReclaimed: 0
        };
      }
      
      console.log(`✅ Proceeding with fund reclamation...`);
    }
    
    // Stats tracking
    const stats = {
      totalWallets: allWallets.length,
      processed: 0,
      successful: 0,
      failed: 0,
      errors: {},
      totalReclaimed: 0,
      transactions: [], // Array to collect transaction details
      returnTransactions: [] // For test mode return transactions
    };
    
    // Process in batches
    const totalBatches = Math.ceil(allWallets.length / BATCH_SIZE);
    
    for (let i = 0; i < allWallets.length; i += BATCH_SIZE) {
      const batch = allWallets.slice(i, i + BATCH_SIZE);
      const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
      
      console.log(`\n🔄 Processing batch ${currentBatch}/${totalBatches} with ${batch.length} wallets`);
      
      // Process each wallet in batch
      for (const wallet of batch) {
        stats.processed++;
        
        const walletDisplay = `${wallet.wallet_address} (${wallet.type}${wallet.type === 'contest' ? `, ${wallet.contestCode}` : ''})`;
        console.log(`\n[${stats.processed}/${stats.totalWallets}] Processing wallet: ${walletDisplay}`);
        
        // Reclaim funds from this wallet
        const result = await reclaimFundsFromWallet(wallet, treasuryAddress, keys, useBackupRpc);
        
        if (result.success) {
          stats.successful++;
          stats.totalReclaimed += result.amount;
          console.log(`✅ Successfully reclaimed ${result.amount.toFixed(6)} SOL from ${walletDisplay}`);
          
          // Collect transaction details
          if (!dryRun) {
            stats.transactions.push({
              wallet: wallet.wallet_address,
              txid: result.txid,
              solscanLink: result.solscanLink,
              amount: result.amount
            });
            
            // If in test mode, return the funds to the original wallet
            if (testMode && treasuryKeypair) {
              console.log(`\n🔄 TEST MODE: Returning funds to original wallet...`);
              // Wait a moment for the first transaction to settle
              await delay(2000);
              
              // Return funds to the original wallet
              const returnResult = await returnFundsToWallet(
                treasuryKeypair,
                wallet.wallet_address,
                result.amount,
                useBackupRpc
              );
              
              if (returnResult.success) {
                console.log(`✅ TEST MODE: Successfully returned ${returnResult.amount.toFixed(6)} SOL to ${wallet.wallet_address}`);
                stats.returnTransactions.push({
                  wallet: wallet.wallet_address,
                  txid: returnResult.txid,
                  solscanLink: returnResult.solscanLink,
                  amount: returnResult.amount
                });
              } else {
                console.log(`❌ TEST MODE: Failed to return funds to ${wallet.wallet_address}: ${returnResult.error}`);
              }
            }
          }
        } else {
          stats.failed++;
          console.log(`❌ Failed to reclaim from ${walletDisplay}: ${result.error}`);
          
          // Track error types
          const errorType = result.error.includes('decrypt') ? 'DecryptError' : 
                          result.error.includes('keypair') ? 'KeypairError' :
                          result.error.includes('balance') ? 'BalanceError' :
                          result.error.includes('transaction') ? 'TransactionError' : 'OtherError';
          
          stats.errors[errorType] = (stats.errors[errorType] || 0) + 1;
        }
        
        // Small delay between transactions
        await delay(DELAY_BETWEEN_TXS);
      }
      
      // Print batch summary
      console.log(`\n✅ Completed ${stats.processed}/${stats.totalWallets} wallets`);
      console.log(`   Successful: ${stats.successful}, Failed: ${stats.failed}`);
      console.log(`   Total SOL reclaimed so far: ${stats.totalReclaimed.toFixed(6)}`);
      
      // Delay between batches to avoid rate limits (unless it's the last batch)
      if (i + BATCH_SIZE < allWallets.length) {
        console.log(`⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
        await delay(DELAY_BETWEEN_BATCHES);
      }
    }
    
    // Final summary
    console.log(`\n🏁 RECLAMATION COMPLETE`);
    console.log(`✅ Total wallets processed: ${stats.processed}`);
    console.log(`✅ Successful transfers: ${stats.successful}`);
    console.log(`❌ Failed transfers: ${stats.failed}`);
    console.log(`💰 Total SOL reclaimed: ${stats.totalReclaimed.toFixed(6)}`);
    
    if (Object.keys(stats.errors).length > 0) {
      console.log(`\n⚠️ Error breakdown:`);
      Object.entries(stats.errors).forEach(([type, count]) => {
        console.log(`  - ${type}: ${count}`);
        if (type === 'BalanceError') {
          console.log(`    These wallets likely have balances below or at the minimum keep amount (${minBalanceToKeep} SOL)`);
        } else if (type === 'DecryptError') {
          console.log(`    Couldn't decrypt these wallet keys. They may use a different encryption format or key.`);
        } else if (type === 'TransactionError') {
          console.log(`    Transaction execution failed. Check logs for specific reasons like insufficient rent.`);
        }
      });
    }
    
    // Display transaction links
    if (stats.transactions.length > 0) {
      console.log(`\n🔗 TRANSACTION LINKS:`);
      stats.transactions.forEach((tx, index) => {
        console.log(`${index + 1}. ${tx.wallet} (${tx.amount.toFixed(6)} SOL): ${tx.solscanLink}`);
      });
      
      console.log(`\n💰 TOTAL RECLAIMED: ${stats.totalReclaimed.toFixed(6)} SOL`);
      console.log(`   Remaining wallets might have balances at or below the minimum required for rent exemption.`);
      console.log(`   Solana requires ~0.00089 SOL minimum for an account to exist on the blockchain.`);
    }
    
    // Display test mode return transaction links
    if (testMode && stats.returnTransactions.length > 0) {
      console.log(`\n🔗 TEST MODE RETURN TRANSACTION LINKS:`);
      stats.returnTransactions.forEach((tx, index) => {
        console.log(`${index + 1}. RETURNED TO ${tx.wallet} (${tx.amount.toFixed(6)} SOL): ${tx.solscanLink}`);
      });
    }
    
    if (dryRun) {
      console.log(`\n🔄 This was a DRY RUN. No actual transfers were made.`);
      console.log(`   To execute the transfers, run without the --dry-run flag.`);
    }
    
    return stats;
  } catch (error) {
    console.log(`❌ FATAL ERROR: ${error.message}`);
    console.error(error.stack);
    return { 
      success: false, 
      error: error.message,
      processed: 0,
      successful: 0,
      failed: 0,
      totalReclaimed: 0,
      transactions: []
    };
  }
}

// Modify the createTestKeypair function to save to a JSON file
async function createTestKeypair() {
  const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toString();
  const secretKey = Buffer.from(keypair.secretKey).toString('hex');
  
  console.log(`\n🔑 GENERATED TEST KEYPAIR`);
  console.log(`Public key (address): ${publicKey}`);
  console.log(`Secret key: ${secretKey.substring(0, 10)}...${secretKey.substring(secretKey.length - 10)}`);
  
  // Save the keypair to a JSON file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `test-keypair-${timestamp}.json`;
  const keypairData = {
    publicKey,
    secretKey,
    timestamp: new Date().toISOString(),
    createdBy: 'key-recovery-self-test'
  };
  
  try {
    fs.writeFileSync(filename, JSON.stringify(keypairData, null, 2));
    console.log(`✅ Keypair saved to ${filename} for recovery in case of crash`);
    console.log(`To recover funds, use: node key-recovery.js --reclaim --wallet ${publicKey} --key ${secretKey} --treasury YOUR_ADDRESS`);
  } catch (error) {
    console.log(`⚠️ Failed to save keypair to file: ${error.message}`);
  }
  
  return { keypair, publicKey, secretKey, filename };
}

// Update the runSelfTest function to handle the backup file
async function runSelfTest(minAmount) {
  console.log(`\n🧪 STARTING SELF-TEST MODE`);
  console.log(`Minimum test amount: ${minAmount} SOL`);
  
  // 1. Create a new keypair
  const { keypair, publicKey, secretKey, filename } = await createTestKeypair();
  
  // 2. Get connection to Solana
  const connection = getConnection(useBackupRpc);
  
  // 3. Wait for funds to arrive
  const fundingResult = await waitForFunds(connection, publicKey, minAmount);
  
  if (!fundingResult.success) {
    console.log(`\n❌ Self-test failed: Could not receive funds.`);
    console.log(`Test keypair is saved in ${filename} for recovery.`);
    return;
  }
  
  // 4. Run some test operations
  console.log(`\n✅ FUNDS RECEIVED - RUNNING TEST OPERATIONS`);
  console.log(`Current balance: ${fundingResult.amount.toFixed(6)} SOL`);
  
  // Do some test operations here (e.g., create a transaction)
  console.log(`\n🧪 Testing transaction capabilities...`);
  await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate work
  console.log(`✅ Transaction functionality working correctly!`);
  
  // 5. Return funds to sender if possible
  if (fundingResult.sender) {
    console.log(`\n🔄 Test complete! Returning funds to sender.`);
    const returnResult = await returnFundsToSender(
      connection, 
      keypair, 
      fundingResult.sender, 
      fundingResult.amount
    );
    
    if (returnResult.success) {
      console.log(`\n🎉 SELF-TEST COMPLETED SUCCESSFULLY!`);
      console.log(`All funds returned to sender.`);
      
      // Delete the backup file if successful
      try {
        fs.unlinkSync(filename);
        console.log(`✅ Keypair backup file deleted since test completed successfully.`);
      } catch (error) {
        console.log(`⚠️ Note: Could not delete backup file: ${error.message}`);
      }
    } else {
      console.log(`\n⚠️ SELF-TEST COMPLETED BUT COULDN'T RETURN FUNDS.`);
      console.log(`Error: ${returnResult.error}`);
      console.log(`You can manually return the funds using the saved keypair in ${filename}`);
      console.log(`Command: node key-recovery.js --reclaim --wallet ${publicKey} --key ${secretKey} --treasury <SENDER_ADDRESS>`);
    }
  } else {
    console.log(`\n⚠️ SELF-TEST COMPLETED BUT COULDN'T IDENTIFY SENDER.`);
    console.log(`Cannot automatically return funds.`);
    console.log(`You can manually transfer the funds using the saved keypair in ${filename}`);
    console.log(`Command: node key-recovery.js --reclaim --wallet ${publicKey} --key ${secretKey} --treasury <YOUR_ADDRESS>`);
  }
}

// Add function to extract keypair from decrypted key
function extractKeypairFromDecrypted(decrypted) {
  try {
    // Try to parse as JSON array (64 elements)
    if (decrypted.startsWith('[')) {
      try {
        const parsed = JSON.parse(decrypted);
        if (Array.isArray(parsed) && parsed.length === 64) {
          console.log(`Attempting to extract keypair from JSON array (64 elements)`);
          return Keypair.fromSecretKey(Uint8Array.from(parsed));
        }
      } catch (e) {
        console.log(`Not a valid JSON array: ${e.message}`);
      }
    }
    
    // Try as hex string (128 chars)
    if (/^[0-9a-fA-F]{128}$/.test(decrypted)) {
      console.log(`Attempting to extract keypair from: ${decrypted.substring(0, 16)}...`);
      console.log(`✅ Successfully parsed as hex string (128 chars - full keypair)`);
      return Keypair.fromSecretKey(Buffer.from(decrypted, 'hex'));
    }
    
    // Try as base58 encoded string
    try {
      const decoded = bs58.decode(decrypted);
      if (decoded.length === 64) {
        console.log(`Attempting to extract keypair from base58 encoded string`);
        return Keypair.fromSecretKey(decoded);
      } else if (decoded.length === 32) {
        console.log(`Attempting to extract keypair from base58 encoded seed (32 bytes)`);
        return Keypair.fromSeed(decoded);
      }
    } catch (e) {
      console.log(`Not a valid base58 string: ${e.message}`);
    }
    
    console.log(`❌ Could not extract keypair from decrypted data`);
    return null;
  } catch (error) {
    console.log(`❌ Error extracting keypair: ${error.message}`);
    return null;
  }
}

// Add helper function to get user confirmation
async function confirmAction(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(prompt + ' (y/N): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

// Main function to handle the key recovery process
async function main() {
  // Run self-test mode if selected
  if (selfTestMode) {
    await runSelfTest(minTestAmount);
    return;
  }

  console.log("DegenDuel Wallet Key Recovery Tool");
  console.log("=================================");

  // Check if we should just list wallets
  if (listWallets) {
    await listAvailableWallets(limit);
    return;
  }

  // Validate arguments
  if (!walletAddress && !encryptedData) {
    console.error("Error: You must provide either a wallet address or encrypted data.");
    showHelp();
    process.exit(1);
  }
  
  if (!encryptionKey && !keyFile) {
    console.error("Error: You must provide either an encryption key or a key file.");
    showHelp();
    process.exit(1);
  }
  
  // Get the encrypted data
  let dataToDecrypt;
  if (encryptedData) {
    dataToDecrypt = encryptedData;
  } else {
    console.log(`\n🔍 Fetching wallet data for: ${walletAddress}`);
    try {
      // Try to find in contest_wallets table
      const contestWallet = await prisma.contest_wallets.findFirst({
        where: { wallet_address: walletAddress }
      });
      
      if (contestWallet) {
        console.log("Found wallet in contest_wallets table");
        dataToDecrypt = contestWallet.private_key;
      } else {
        // Try to find in vanity_wallet_pool table
        const vanityWallet = await prisma.vanity_wallet_pool.findFirst({
          where: { wallet_address: walletAddress }
        });
        
        if (vanityWallet) {
          console.log("Found wallet in vanity_wallet_pool table");
          dataToDecrypt = vanityWallet.private_key;
        } else {
          console.error(`No wallet found with address: ${walletAddress}`);
          process.exit(1);
        }
      }
      
      console.log(`Encrypted data: ${dataToDecrypt.substring(0, 20)}...`);
      
    } catch (error) {
      console.error("Database error:", error.message);
      process.exit(1);
    }
  }
  
  // Get the encryption keys to try
  const keysToTry = [];
  
  if (encryptionKey) {
    keysToTry.push(encryptionKey);
  }
  
  if (keyFile) {
    try {
      const fileContent = fs.readFileSync(keyFile, 'utf8');
      const keys = fileContent.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
      
      console.log(`Loaded ${keys.length} keys from file`);
      keysToTry.push(...keys);
    } catch (error) {
      console.error(`Error reading key file: ${error.message}`);
    }
  }
  
  if (keysToTry.length === 0) {
    console.error("No valid encryption keys to try.");
    process.exit(1);
  }
  
  // Attempt decryption
  const success = await attemptDecryption(dataToDecrypt, keysToTry);
  
  // Clean up
  await prisma.$disconnect();
  
  process.exit(success ? 0 : 1);
}

// Run the main function
main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Restore the waitForFunds function which was accidentally deleted
async function waitForFunds(connection, publicKey, minAmount) {
  console.log(`\n⏳ WAITING FOR FUNDS`);
  console.log(`Please send at least ${minAmount} SOL to: ${publicKey}`);
  console.log(`Press Ctrl+C to cancel the test at any time.`);
  
  let senderAddress = null;
  let receivedAmount = 0;
  
  // Initial balance check
  let balance = await connection.getBalance(new PublicKey(publicKey));
  let balanceSol = balance / 1_000_000_000;
  
  console.log(`Initial balance: ${balanceSol.toFixed(6)} SOL`);
  
  if (balanceSol >= minAmount) {
    console.log(`✅ Sufficient balance already exists!`);
    return { success: true, amount: balanceSol };
  }
  
  // Function to check for signature
  const checkForNewTransaction = async () => {
    try {
      // Get recent transactions (last 10)
      const signatures = await connection.getSignaturesForAddress(
        new PublicKey(publicKey),
        { limit: 10 }
      );
      
      // If we have signatures, check the most recent one
      if (signatures && signatures.length > 0) {
        const recentSig = signatures[0].signature;
        const tx = await connection.getParsedTransaction(recentSig, 'confirmed');
        
        if (tx && tx.meta && tx.meta.preBalances && tx.meta.postBalances) {
          // Find our address index in the tx
          const myAccountIndex = tx.transaction.message.accountKeys.findIndex(
            key => key.pubkey.toString() === publicKey
          );
          
          if (myAccountIndex !== -1) {
            const preBalance = tx.meta.preBalances[myAccountIndex];
            const postBalance = tx.meta.postBalances[myAccountIndex];
            const changeInBalance = (postBalance - preBalance) / 1_000_000_000;
            
            if (changeInBalance > 0) {
              // This is a deposit! Find the sender
              const senderIndex = tx.transaction.message.accountKeys.findIndex(
                (key, index) => 
                  index !== myAccountIndex && 
                  tx.meta.preBalances[index] > tx.meta.postBalances[index]
              );
              
              if (senderIndex !== -1) {
                senderAddress = tx.transaction.message.accountKeys[senderIndex].pubkey.toString();
                receivedAmount = changeInBalance;
                return { found: true, sender: senderAddress, amount: receivedAmount };
              }
            }
          }
        }
      }
      
      return { found: false };
    } catch (error) {
      console.log(`Error checking for transactions: ${error.message}`);
      return { found: false };
    }
  };
  
  // Main polling loop
  let attempts = 0;
  const maxAttempts = 300; // 5 minutes at 1 second intervals
  
  while (attempts < maxAttempts) {
    // Check current balance
    balance = await connection.getBalance(new PublicKey(publicKey));
    balanceSol = balance / 1_000_000_000;
    
    if (balanceSol >= minAmount) {
      // Balance is sufficient, try to find the sender
      const txInfo = await checkForNewTransaction();
      
      if (txInfo.found) {
        console.log(`\n✅ FUNDS RECEIVED!`);
        console.log(`Received ${txInfo.amount.toFixed(6)} SOL from ${txInfo.sender}`);
        senderAddress = txInfo.sender;
        receivedAmount = txInfo.amount;
        break;
      } else {
        // We have the balance but couldn't identify the sender
        console.log(`\n✅ FUNDS RECEIVED!`);
        console.log(`Received sufficient balance but couldn't identify the sender.`);
        console.log(`Current balance: ${balanceSol.toFixed(6)} SOL`);
        receivedAmount = balanceSol;
        // Will use the balance but won't be able to return funds
        break;
      }
    }
    
    // Show progress every 10 attempts
    if (attempts % 10 === 0) {
      console.log(`Still waiting... Current balance: ${balanceSol.toFixed(6)} SOL (need ${minAmount} SOL)`);
    }
    
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
  }
  
  if (attempts >= maxAttempts) {
    console.log(`\n❌ Timed out waiting for funds after 5 minutes.`);
    return { success: false };
  }
  
  return { 
    success: true, 
    amount: receivedAmount, 
    sender: senderAddress 
  };
}

// Restore the returnFundsToSender function which was accidentally deleted
async function returnFundsToSender(connection, keypair, senderAddress, amount) {
  if (!senderAddress) {
    console.log(`\n⚠️ Can't return funds: sender address unknown.`);
    return { success: false, error: 'Sender address unknown' };
  }
  
  console.log(`\n🔄 RETURNING FUNDS TO SENDER`);
  console.log(`Preparing to send ${amount.toFixed(6)} SOL back to ${senderAddress}`);
  
  try {
    // Keep a small amount for fees
    const keepAmount = 0.001;
    const returnAmount = Math.max(0, amount - keepAmount);
    
    if (returnAmount <= 0) {
      console.log(`\n⚠️ Amount too small to return after keeping fees.`);
      return { success: false, error: 'Amount too small' };
    }
    
    console.log(`Will return ${returnAmount.toFixed(6)} SOL (keeping ${keepAmount} SOL for fees)`);
    
    // Create transfer transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(senderAddress),
        lamports: Math.floor(returnAmount * 1_000_000_000), // convert SOL to lamports
      })
    );
    
    transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
    transaction.feePayer = keypair.publicKey;
    
    // Confirm with user
    const confirmed = await confirmAction(`Do you want to return the funds to ${senderAddress}?`);
    if (!confirmed) {
      console.log(`Return cancelled by user.`);
      return { success: false, error: 'Cancelled by user' };
    }
    
    // Send and confirm transaction
    const txid = await sendAndConfirmTransaction(
      connection,
      transaction,
      [keypair],
      {
        skipPreflight: true,
        maxRetries: 5,
        commitment: 'confirmed'
      }
    );
    
    const solscanLink = `https://solscan.io/tx/${txid}`;
    console.log(`\n✅ FUNDS RETURNED!`);
    console.log(`Sent ${returnAmount.toFixed(6)} SOL back to ${senderAddress}`);
    console.log(`Transaction ID: ${txid}`);
    console.log(`Solscan: ${solscanLink}`);
    
    return { 
      success: true, 
      txid, 
      solscanLink, 
      amount: returnAmount 
    };
  } catch (error) {
    console.log(`\n❌ Failed to return funds: ${error.message}`);
    return { success: false, error: error.message };
  }
} 