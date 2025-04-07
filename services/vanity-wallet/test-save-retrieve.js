#!/usr/bin/env node

/**
 * Test script for saving and retrieving a vanity wallet
 * 
 * This script tests:
 * 1. Creating a vanity wallet request in the database
 * 2. Processing it with the local generator
 * 3. Retrieving it from the database
 */

import VanityApiClient from './vanity-api-client.js';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../../config/prisma.js';

// Set up test parameters
const pattern = 'Xx';
const isSuffix = false;
const caseSensitive = true;
const requestedBy = 'test-script';
const requestIp = '127.0.0.1';

async function runTest() {
  console.log(`=== TESTING SAVE AND RETRIEVE OF VANITY WALLET ===\n`);
  console.log(`Creating vanity wallet with pattern: ${pattern}`);
  
  try {
    // Step 1: Create the request in the database
    const dbRecord = await VanityApiClient.createVanityAddressRequest({
      pattern,
      isSuffix,
      caseSensitive,
      requestedBy,
      requestIp
    });
    
    console.log(`Created database record #${dbRecord.id} with status: ${dbRecord.status}`);
    
    // Step 2: Wait for the job to complete (poll the database)
    console.log(`Waiting for job to complete...`);
    let wallet = null;
    const startTime = Date.now();
    const timeoutMs = 60000; // 1 minute timeout
    
    while (Date.now() - startTime < timeoutMs) {
      // Get the current record
      wallet = await prisma.vanity_wallet_pool.findUnique({
        where: { id: dbRecord.id }
      });
      
      if (!wallet) {
        console.error(`Error: Wallet record #${dbRecord.id} not found!`);
        process.exit(1);
      }
      
      console.log(`Current status: ${wallet.status} (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
      
      if (wallet.status === 'completed') {
        console.log(`✅ Job completed successfully!`);
        break;
      } else if (wallet.status === 'failed' || wallet.status === 'cancelled') {
        console.log(`❌ Job ${wallet.status}!`);
        break;
      }
      
      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (wallet.status !== 'completed') {
      console.log(`Job did not complete within timeout period. Status: ${wallet.status}`);
      process.exit(1);
    }
    
    // Step 3: Verify the completed wallet
    console.log(`\n=== GENERATED VANITY WALLET ===`);
    console.log(`ID: ${wallet.id}`);
    console.log(`Pattern: ${wallet.pattern}`);
    console.log(`Address: ${wallet.wallet_address}`);
    console.log(`Status: ${wallet.status}`);
    console.log(`Created At: ${wallet.created_at}`);
    console.log(`Completed At: ${wallet.completed_at}`);
    console.log(`Attempts: ${wallet.attempts}`);
    console.log(`Duration: ${wallet.duration_ms}ms`);
    
    // Verify that the address matches the pattern
    const comparePattern = caseSensitive ? pattern : pattern.toLowerCase();
    const compareAddress = caseSensitive ? wallet.wallet_address : wallet.wallet_address.toLowerCase();
    
    let patternMatches = false;
    if (isSuffix) {
      patternMatches = compareAddress.endsWith(comparePattern);
    } else {
      patternMatches = compareAddress.substring(1).startsWith(comparePattern);
    }
    
    if (patternMatches) {
      console.log(`\n✅ Pattern match verified: ${wallet.wallet_address} contains ${pattern}`);
    } else {
      console.log(`\n❌ Pattern match failed: ${wallet.wallet_address} does not contain ${pattern}`);
    }
    
    // Step 4: Test finding available vanity wallet
    console.log(`\n=== TESTING getAvailableVanityWallet ===`);
    const availableWallet = await VanityApiClient.getAvailableVanityWallet(pattern);
    
    if (availableWallet) {
      console.log(`✅ Found available wallet with pattern ${pattern}:`);
      console.log(`ID: ${availableWallet.id}`);
      console.log(`Address: ${availableWallet.wallet_address}`);
      console.log(`Pattern: ${availableWallet.pattern}`);
      console.log(`Is Used: ${availableWallet.is_used}`);
      
      // Step 5: Mock assign to a contest
      const contestId = 999999; // Fake contest ID
      console.log(`\n=== TESTING assignVanityWalletToContest ===`);
      console.log(`Assigning wallet #${availableWallet.id} to contest #${contestId}`);
      
      try {
        const assignedWallet = await VanityApiClient.assignVanityWalletToContest(availableWallet.id, contestId);
        
        console.log(`✅ Wallet assigned successfully!`);
        console.log(`ID: ${assignedWallet.id}`);
        console.log(`Address: ${assignedWallet.wallet_address}`);
        console.log(`Is Used: ${assignedWallet.is_used}`);
        console.log(`Used By Contest: ${assignedWallet.used_by_contest}`);
        console.log(`Used At: ${assignedWallet.used_at}`);
        
        // Step 6: Verify it's no longer available
        console.log(`\n=== VERIFYING WALLET IS NO LONGER AVAILABLE ===`);
        const shouldBeNull = await VanityApiClient.getAvailableVanityWallet(pattern);
        
        if (!shouldBeNull) {
          console.log(`✅ Wallet is correctly marked as used and no longer available`);
        } else {
          console.log(`❌ Wallet is still showing as available!`);
          console.log(shouldBeNull);
        }
      } catch (error) {
        console.error(`Error assigning wallet: ${error.message}`);
      }
    } else {
      console.log(`❌ No available wallet found with pattern ${pattern}`);
    }
    
    console.log(`\n=== TEST COMPLETE ===`);
  } catch (error) {
    console.error(`Error during test: ${error.message}`);
    console.error(error.stack);
  } finally {
    // Clean up - remove the test data by setting it to cancelled
    try {
      // Get all test wallets from this script
      const testWallets = await prisma.vanity_wallet_pool.findMany({
        where: {
          requested_by: 'test-script',
          request_ip: '127.0.0.1'
        }
      });
      
      console.log(`\n=== CLEANING UP TEST DATA ===`);
      console.log(`Found ${testWallets.length} test wallets to clean up`);
      
      for (const wallet of testWallets) {
        // If it was assigned to our fake contest, unassign it
        if (wallet.used_by_contest === 999999) {
          await prisma.vanity_wallet_pool.update({
            where: { id: wallet.id },
            data: {
              is_used: false,
              used_by_contest: null,
              used_at: null
            }
          });
          console.log(`Unassigned wallet #${wallet.id} from test contest`);
        }
      }
    } catch (cleanupError) {
      console.error(`Error during cleanup: ${cleanupError.message}`);
    }
    
    // Exit the process
    process.exit(0);
  }
}

// Start the test
runTest();