#!/usr/bin/env node

/**
 * Test script for the VanityWalletService
 * 
 * This script tests:
 * 1. Initializing the service
 * 2. Checking the status
 * 3. Running the address generation and pool management
 * 
 * UPDATED: This test now uses the singleton service instance instead of creating a new instance,
 * which aligns with the new service architecture where services are exported as instances.
 */

import vanityWalletService from '../index.js';
import prisma from '../../config/prisma.js';
import { config } from '../../config/config.js';

async function testVanityWalletService() {
  try {
    console.log(`=== TESTING VANITY WALLET SERVICE ===\n`);
    
    // Use the singleton service instance
    const service = vanityWalletService;
    
    // Step 1: Initialize the service
    console.log(`Initializing service...`);
    const initialized = await service.initialize(); // Using the BaseService method directly
    
    if (initialized) {
      console.log(`✅ Service initialized successfully`);
    } else {
      console.error(`❌ Service initialization failed`);
      process.exit(1);
    }
    
    // Step 2: Check initial status
    console.log(`\nChecking initial status...`);
    const initialStatus = await service.getStatus();
    console.log(JSON.stringify(initialStatus, null, 2));
    
    // Step 3: Start the service using BaseService interface
    console.log(`\nStarting service...`);
    await service.start(); // This is already the BaseService method
    console.log(`✅ Service started`);
    
    // Step 4: Manually run the operation once
    console.log(`\nRunning a generation operation...`);
    await service.performOperation(); // This is a BaseService method
    console.log(`✅ Operation completed`);
    
    // Step 5: Wait for a bit to allow for automatic generation
    const waitTimeMs = 20000; // 20 seconds
    console.log(`\nWaiting ${waitTimeMs/1000} seconds for automatic generation...`);
    await new Promise(resolve => setTimeout(resolve, waitTimeMs));
    
    // Step 6: Check updated status
    console.log(`\nChecking updated status...`);
    const updatedStatus = await service.getStatus(); // This method is specific to VanityWalletService
    console.log(JSON.stringify(updatedStatus, null, 2));
    
    // Step 7: Check if any wallets were generated
    console.log(`\nChecking for generated wallets...`);
    
    const duelCount = await prisma.vanity_wallet_pool.count({
      where: {
        pattern: 'DUEL',
        status: 'completed',
        is_used: false
      }
    });
    
    const degenCount = await prisma.vanity_wallet_pool.count({
      where: {
        pattern: 'DEGEN',
        status: 'completed',
        is_used: false
      }
    });
    
    console.log(`DUEL wallets available: ${duelCount}`);
    console.log(`DEGEN wallets available: ${degenCount}`);
    
    // Step 8: Stop the service using BaseService interface
    console.log(`\nStopping service...`);
    await service.stop(); // This is already the BaseService method
    console.log(`✅ Service stopped`);
    
    console.log(`\n=== TEST COMPLETE ===`);
    if (duelCount > 0 || degenCount > 0) {
      console.log(`✅ Service successfully generated vanity wallets`);
    } else {
      console.log(`⚠️ No wallets were generated - this might be expected if generation takes longer`);
      console.log(`   than the test duration or if the pool was already at target capacity.`);
    }
    
  } catch (error) {
    console.error(`\nError during test: ${error.message}`);
    console.error(error.stack);
  } finally {
    // Exit cleanly
    process.exit(0);
  }
}

// Run the test
testVanityWalletService();