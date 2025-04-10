#!/usr/bin/env node

/**
 * Test script to show the private key for a vanity wallet
 * 
 * This script retrieves a generated vanity wallet from the database
 * and displays its private key.
 */

import prisma from '../../config/prisma.js';
import { Keypair } from '@solana/web3.js';

async function showPrivateKey() {
  try {
    // Get the most recently created vanity wallet that's completed
    const wallet = await prisma.vanity_wallet_pool.findFirst({
      where: {
        status: 'completed',
        wallet_address: { not: null },
        private_key: { not: null }
      },
      orderBy: {
        created_at: 'desc'
      }
    });
    
    if (!wallet) {
      console.error('No completed vanity wallets found in the database');
      process.exit(1);
    }
    
    console.log(`=== VANITY WALLET DETAILS ===`);
    console.log(`ID: ${wallet.id}`);
    console.log(`Pattern: ${wallet.pattern}`);
    console.log(`Public Address: ${wallet.wallet_address}`);
    console.log(`Status: ${wallet.status}`);
    console.log(`Created At: ${wallet.created_at}`);
    console.log(`Completed At: ${wallet.completed_at}`);
    
    // Parse the private key from the stored JSON string
    const privateKeyArray = JSON.parse(wallet.private_key);
    console.log(`\n=== PRIVATE KEY (ARRAY FORMAT) ===`);
    console.log(privateKeyArray);
    
    // Convert to Keypair and show the full keypair details
    try {
      const secretKey = new Uint8Array(privateKeyArray);
      const keypair = Keypair.fromSecretKey(secretKey);
      
      console.log(`\n=== KEYPAIR VALIDATION ===`);
      console.log(`Loaded Public Key: ${keypair.publicKey.toString()}`);
      console.log(`Matches Database: ${keypair.publicKey.toString() === wallet.wallet_address ? 'YES ✅' : 'NO ❌'}`);
      
      // Convert to base58 for compatibility with Solana wallets
      const bs58 = (await import('bs58')).default;
      const base58PrivateKey = bs58.encode(Buffer.from(secretKey));
      
      console.log(`\n=== PRIVATE KEY (BASE58 FORMAT) ===`);
      console.log(`${base58PrivateKey}`);
      
      // If wallet is unused, suggest using it
      if (!wallet.is_used) {
        console.log(`\n=== WALLET STATUS ===`);
        console.log(`This wallet is NOT YET USED and available for assignment.`);
      } else {
        console.log(`\n=== WALLET STATUS ===`);
        console.log(`This wallet is ALREADY USED by contest #${wallet.used_by_contest}.`);
      }
    } catch (error) {
      console.error(`Error converting keypair: ${error.message}`);
    }
  } catch (error) {
    console.error(`Error retrieving wallet: ${error.message}`);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

// Run the function
showPrivateKey();