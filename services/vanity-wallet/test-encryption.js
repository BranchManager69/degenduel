#!/usr/bin/env node

/**
 * Test script for testing private key encryption
 * 
 * This script tests:
 * 1. Creating a vanity wallet with encryption
 * 2. Retrieving and decrypting the private key
 */

import VanityApiClient from './vanity-api-client.js';
import prisma from '../../config/prisma.js';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Set up test parameters
const pattern = 'Xx';
const requestedBy = 'test-encryption';
const requestIp = '127.0.0.1';

async function testEncryption() {
  try {
    console.log(`=== TESTING PRIVATE KEY ENCRYPTION ===\n`);
    
    // Check if WALLET_ENCRYPTION_KEY is set
    if (!process.env.WALLET_ENCRYPTION_KEY) {
      console.warn('\n⚠️ WARNING: WALLET_ENCRYPTION_KEY is not set in environment.');
      console.warn('Private keys will not be properly encrypted.');
      console.warn('Set a 64-character hex string in WALLET_ENCRYPTION_KEY for proper encryption.\n');
    } else {
      console.log(`Encryption key is configured correctly.`);
    }
    
    // Create a vanity wallet request
    console.log(`\nCreating vanity wallet with pattern "${pattern}"...`);
    const walletRequest = await VanityApiClient.createVanityAddressRequest({
      pattern,
      isSuffix: false,
      caseSensitive: true,
      requestedBy,
      requestIp
    });
    
    console.log(`Created request #${walletRequest.id}, waiting for processing...`);
    
    // Poll until job completes or times out
    let wallet = null;
    const startTime = Date.now();
    const timeoutMs = 60000; // 1 minute timeout
    
    while (Date.now() - startTime < timeoutMs) {
      // Get the current record
      wallet = await prisma.vanity_wallet_pool.findUnique({
        where: { id: walletRequest.id }
      });
      
      if (!wallet) {
        console.error(`Error: Wallet record #${walletRequest.id} not found!`);
        process.exit(1);
      }
      
      if (wallet.status === 'completed') {
        console.log(`\n✅ Job completed successfully in ${Math.round((Date.now() - startTime) / 1000)}s`);
        break;
      } else if (wallet.status === 'failed' || wallet.status === 'cancelled') {
        console.log(`\n❌ Job ${wallet.status}!`);
        process.exit(1);
      }
      
      process.stdout.write('.');
      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (wallet.status !== 'completed') {
      console.log(`\nJob did not complete within timeout period. Status: ${wallet.status}`);
      process.exit(1);
    }
    
    // Get the raw encrypted value from the database
    const encryptedValue = wallet.private_key;
    
    // Get the wallet using VanityApiClient (with decryption)
    const retrievedWallet = await prisma.vanity_wallet_pool.findUnique({
      where: { id: wallet.id }
    });
    
    // Manually decrypt the private key
    const decryptedPrivateKey = await VanityApiClient.decryptPrivateKey(retrievedWallet.private_key);
    
    // Display results
    console.log(`\n=== ENCRYPTION TEST RESULTS ===`);
    console.log(`\nGenerated wallet with address: ${wallet.wallet_address}`);
    
    console.log(`\n=== ENCRYPTED PRIVATE KEY (STORED IN DB) ===`);
    console.log(encryptedValue);
    
    // Check if the private key is encrypted (contains colons)
    const isEncrypted = encryptedValue.includes(':');
    console.log(`\n🔐 Private key is ${isEncrypted ? 'encrypted' : 'NOT encrypted'}`);
    
    if (isEncrypted) {
      // Show the format
      const [ivHex, authTagHex, encryptedData] = encryptedValue.split(':');
      console.log(`\n=== ENCRYPTION COMPONENTS ===`);
      console.log(`IV (16 bytes): ${ivHex}`);
      console.log(`Auth Tag (16 bytes): ${authTagHex}`);
      console.log(`Encrypted Data: ${encryptedData.substring(0, 32)}...${encryptedData.substring(encryptedData.length - 32)}`);
    }
    
    console.log(`\n=== DECRYPTED PRIVATE KEY ===`);
    console.log(`Retrieved and decrypted: ${decryptedPrivateKey}`);
    
    // Verify the decrypted private key works
    try {
      const privateKeyArray = JSON.parse(decryptedPrivateKey);
      const secretKey = new Uint8Array(privateKeyArray);
      const keypair = Keypair.fromSecretKey(secretKey);
      
      console.log(`\n=== WALLET VERIFICATION ===`);
      console.log(`Public Key from Wallet: ${wallet.wallet_address}`);
      console.log(`Public Key from Keypair: ${keypair.publicKey.toString()}`);
      
      if (keypair.publicKey.toString() === wallet.wallet_address) {
        console.log(`✅ Encryption/Decryption test PASSED. Keys match.`);
      } else {
        console.log(`❌ Encryption/Decryption test FAILED. Keys don't match.`);
      }
      
      // Display as base58 (wallet format)
      const base58PrivateKey = bs58.encode(Buffer.from(secretKey));
      console.log(`\n=== BASE58 PRIVATE KEY (FOR WALLETS) ===`);
      console.log(base58PrivateKey);
    } catch (error) {
      console.error(`\n❌ Error verifying keypair: ${error.message}`);
    }
    
    // Clean up the test data
    try {
      await prisma.vanity_wallet_pool.delete({
        where: { id: wallet.id }
      });
      console.log(`\n🧹 Cleaned up test wallet #${wallet.id}`);
    } catch (error) {
      console.error(`\n❌ Error cleaning up test data: ${error.message}`);
    }
    
    console.log(`\n=== ENCRYPTION TEST COMPLETE ===`);
  } catch (error) {
    console.error(`Error during encryption test: ${error.message}`);
    console.error(error.stack);
  }
}

// Run the test
testEncryption();