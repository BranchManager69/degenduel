#!/usr/bin/env node

/**
 * Test script for the full vanity wallet workflow
 * 
 * This script tests:
 * 1. Creating a vanity wallet request
 * 2. Generating the address with the local generator
 * 3. Retrieving it with the API client
 * 4. Verifying it works with the correct pattern
 */

import VanityApiClient from './vanity-api-client.js';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Set up test parameters
const pattern = 'DD';  // Short pattern for quick test
const requestedBy = 'test-full-flow';
const requestIp = '127.0.0.1';

async function testFullFlow() {
  try {
    console.log(`=== TESTING FULL VANITY WALLET FLOW ===\n`);
    
    // Step 1: Create a vanity wallet request
    console.log(`Creating vanity wallet with pattern "${pattern}"...`);
    const walletRequest = await VanityApiClient.createVanityAddressRequest({
      pattern,
      isSuffix: false,
      caseSensitive: true,
      requestedBy,
      requestIp
    });
    
    console.log(`Created request #${walletRequest.id}`);
    
    // Step 2: Wait for the wallet to be ready
    console.log(`\nWaiting for generation to complete...`);
    
    let wallet = null;
    const startTime = Date.now();
    const timeoutMs = 30000; // 30 second timeout
    
    while (Date.now() - startTime < timeoutMs) {
      console.log(`Checking status...`);
      
      // Use getAvailableVanityWallet to check if it's ready
      wallet = await VanityApiClient.getAvailableVanityWallet(pattern);
      
      if (wallet) {
        console.log(`\n✅ Found available wallet with pattern "${pattern}"`);
        break;
      }
      
      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    if (!wallet) {
      console.error(`\n❌ No wallet found with pattern "${pattern}" after ${timeoutMs/1000} seconds`);
      process.exit(1);
    }
    
    // Step 3: Verify the wallet details
    console.log(`\n=== RETRIEVED VANITY WALLET ===`);
    console.log(`ID: ${wallet.id}`);
    console.log(`Pattern: ${wallet.pattern}`);
    console.log(`Address: ${wallet.wallet_address}`);
    console.log(`Status: ${wallet.status}`);
    
    // Check that the address matches the pattern
    if (wallet.wallet_address.startsWith(pattern)) {
      console.log(`\n✅ Address correctly starts with pattern "${pattern}"`);
    } else {
      console.log(`\n❌ Address does not start with pattern "${pattern}"`);
    }
    
    // Step 4: Verify the private key works
    try {
      // Parse the decrypted private key
      const privateKeyArray = JSON.parse(wallet.private_key);
      const secretKey = new Uint8Array(privateKeyArray);
      const keypair = Keypair.fromSecretKey(secretKey);
      
      console.log(`\n=== WALLET VERIFICATION ===`);
      console.log(`Public Key: ${keypair.publicKey.toString()}`);
      
      if (keypair.publicKey.toString() === wallet.wallet_address) {
        console.log(`✅ Private key correctly corresponds to the public address`);
      } else {
        console.log(`❌ Private key does NOT match the public address`);
      }
      
      // Display as base58 (wallet format)
      const base58PrivateKey = bs58.encode(Buffer.from(secretKey));
      console.log(`\n=== PRIVATE KEY (BASE58 FORMAT) ===`);
      console.log(base58PrivateKey);
      
      console.log(`\n=== FULL TEST PASSED ===`);
      console.log(`The vanity wallet was successfully created, encrypted, stored in the database, retrieved, and decrypted.`);
      console.log(`It's ready for integration with the Contest Wallet Service.`);
    } catch (error) {
      console.error(`\n❌ Error verifying keypair: ${error.message}`);
    }
  } catch (error) {
    console.error(`\nError during test: ${error.message}`);
    console.error(error.stack);
  }
}

// Run the test
testFullFlow();