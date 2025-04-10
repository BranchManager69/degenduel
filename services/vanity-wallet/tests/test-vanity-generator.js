#!/usr/bin/env node

/**
 * Test script for the local vanity wallet generator
 * 
 * This script tests the functionality of the local vanity wallet generator
 * without requiring the full application to be running.
 * 
 * Usage:
 *   node test-vanity-generator.js [--pattern PATTERN] [--suffix] [--no-case-sensitive]
 */

import VanityWalletGeneratorManager from './generators/index.js';
import LocalVanityGenerator from './generators/local-generator.js';
import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';

// Parse command line arguments
const args = process.argv.slice(2);
let pattern = 'TEST';
let isSuffix = false;
let caseSensitive = true;
let numWorkers = 2;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pattern' && i + 1 < args.length) {
    pattern = args[i + 1];
    i++;
  } else if (args[i] === '--suffix') {
    isSuffix = true;
  } else if (args[i] === '--no-case-sensitive') {
    caseSensitive = false;
  } else if (args[i] === '--workers' && i + 1 < args.length) {
    numWorkers = parseInt(args[i + 1]);
    i++;
  }
}

console.log(`Testing local vanity wallet generator with:`);
console.log(`- Pattern: ${pattern}`);
console.log(`- Is Suffix: ${isSuffix}`);
console.log(`- Case Sensitive: ${caseSensitive}`);
console.log(`- Number of Workers: ${numWorkers}`);
console.log('\n');

// Create a standalone generator for testing
const testVanityGenerator = new LocalVanityGenerator({
  numWorkers: numWorkers,
  batchSize: 5000,
  maxAttempts: 1000000
});

// Define a direct test function that uses the generator directly
async function testDirectGenerator() {
  console.log('Testing direct generator...');
  
  const jobId = crypto.randomUUID();
  let jobComplete = false;
  
  // Create a promise that will resolve when the job completes
  const jobPromise = new Promise((resolve, reject) => {
    // Add a job to the generator
    testVanityGenerator.addJob({
      id: jobId,
      pattern: pattern,
      isSuffix: isSuffix,
      caseSensitive: caseSensitive,
      
      // Completion callback
      onComplete: (result) => {
        jobComplete = true;
        if (result.status === 'Completed') {
          console.log(`✅ Job completed successfully!`);
          console.log(`   Address: ${result.result.address}`);
          console.log(`   Keypair: ${result.result.keypair_bytes.slice(0, 5).join(',')}...`);
          console.log(`   Attempts: ${result.attempts}`);
          console.log(`   Duration: ${result.duration_ms}ms`);
          console.log(`   Rate: ~${Math.round(result.attempts/(result.duration_ms/1000))} addresses/sec`);
          
          // Verify the address actually matches the pattern
          const address = result.result.address;
          const comparePattern = caseSensitive ? pattern : pattern.toLowerCase();
          const compareAddress = caseSensitive ? address : address.toLowerCase();
          
          let patternMatches = false;
          if (isSuffix) {
            patternMatches = compareAddress.endsWith(comparePattern);
          } else {
            patternMatches = compareAddress.substring(1).startsWith(comparePattern);
          }
          
          if (patternMatches) {
            console.log(`   ✅ Pattern match verified`);
          } else {
            console.log(`   ❌ Pattern match failed! Address does not match pattern.`);
          }
          
          // Verify the keypair is valid by reconstructing it
          try {
            const secretKey = new Uint8Array(result.result.keypair_bytes);
            const keypair = Keypair.fromSecretKey(secretKey);
            
            if (keypair.publicKey.toString() === result.result.address) {
              console.log(`   ✅ Keypair validation successful`);
            } else {
              console.log(`   ❌ Keypair validation failed! Addresses don't match:`);
              console.log(`      - Generated: ${result.result.address}`);
              console.log(`      - Reconstructed: ${keypair.publicKey.toString()}`);
            }
          } catch (error) {
            console.log(`   ❌ Keypair validation failed: ${error.message}`);
          }
          
          resolve(result);
        } else {
          console.log(`❌ Job failed: ${result.status}`);
          console.log(`   Error: ${result.error || 'Unknown error'}`);
          reject(new Error(`Job failed: ${result.status}`));
        }
      },
      
      // Progress callback
      onProgress: (progress) => {
        if (progress.attempts % 50000 === 0) {
          const elapsedSec = progress.duration_ms / 1000;
          const rate = progress.attempts / elapsedSec;
          console.log(`   Progress: ${progress.attempts} attempts, ${elapsedSec.toFixed(1)}s elapsed, ~${Math.round(rate)} addresses/sec`);
        }
      }
    });
  });
  
  try {
    // Wait for the job to complete or time out
    const result = await Promise.race([
      jobPromise,
      new Promise((_, reject) => setTimeout(() => {
        if (!jobComplete) {
          testVanityGenerator.cancelJob(jobId);
          reject(new Error('Job timed out'));
        }
      }, 60000))
    ]);
    
    return result;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return null;
  }
}

// Define a test function that uses the manager
async function testVanityManager() {
  console.log('\nTesting generator manager...');
  
  // Get the generator manager instance
  const generatorManager = VanityWalletGeneratorManager.getInstance({
    numWorkers: numWorkers,
    batchSize: 5000,
    maxAttempts: 1000000
  });
  
  const jobId = crypto.randomUUID();
  let jobComplete = false;
  
  // Create a promise that will resolve when the job completes
  const jobPromise = new Promise((resolve, reject) => {
    // Submit a job to the manager
    generatorManager.submitJob(
      {
        id: jobId,
        pattern: pattern,
        isSuffix: isSuffix,
        caseSensitive: caseSensitive
      },
      // Completion callback
      (result) => {
        jobComplete = true;
        if (result.status === 'Completed') {
          console.log(`✅ Manager job completed successfully!`);
          console.log(`   Address: ${result.result.address}`);
          console.log(`   Keypair: ${result.result.keypair_bytes.slice(0, 5).join(',')}...`);
          console.log(`   Attempts: ${result.attempts}`);
          console.log(`   Duration: ${result.duration_ms}ms`);
          console.log(`   Rate: ~${Math.round(result.attempts/(result.duration_ms/1000))} addresses/sec`);
          
          // Verify the pattern match
          const address = result.result.address;
          const comparePattern = caseSensitive ? pattern : pattern.toLowerCase();
          const compareAddress = caseSensitive ? address : address.toLowerCase();
          
          let patternMatches = false;
          if (isSuffix) {
            patternMatches = compareAddress.endsWith(comparePattern);
          } else {
            patternMatches = compareAddress.substring(1).startsWith(comparePattern);
          }
          
          if (patternMatches) {
            console.log(`   ✅ Pattern match verified`);
          } else {
            console.log(`   ❌ Pattern match failed! Address does not match pattern.`);
          }
          
          resolve(result);
        } else {
          console.log(`❌ Manager job failed: ${result.status}`);
          console.log(`   Error: ${result.error || 'Unknown error'}`);
          reject(new Error(`Job failed: ${result.status}`));
        }
      },
      // Progress callback
      (progress) => {
        if (progress.attempts % 50000 === 0) {
          const elapsedSec = progress.duration_ms / 1000;
          const rate = progress.attempts / elapsedSec;
          console.log(`   Progress: ${progress.attempts} attempts, ${elapsedSec.toFixed(1)}s elapsed, ~${Math.round(rate)} addresses/sec`);
        }
      }
    ).catch(error => {
      console.error(`Error submitting job: ${error.message}`);
      reject(error);
    });
  });
  
  try {
    // Wait for the job to complete or time out
    const result = await Promise.race([
      jobPromise,
      new Promise((_, reject) => setTimeout(() => {
        if (!jobComplete) {
          generatorManager.cancelJob(jobId);
          reject(new Error('Manager job timed out'));
        }
      }, 60000))
    ]);
    
    return result;
  } catch (error) {
    console.error(`Error in manager test: ${error.message}`);
    return null;
  }
}

// Run the tests
async function runTests() {
  try {
    console.log(`=== STARTING VANITY WALLET GENERATOR TESTS ===\n`);
    
    // Test direct generator
    const directResult = await testDirectGenerator();
    
    // Test manager
    if (directResult) {
      const managerResult = await testVanityManager();
      
      if (managerResult) {
        console.log('\n=== TEST SUMMARY ===');
        console.log('✅ Direct generator test passed');
        console.log('✅ Generator manager test passed');
        console.log('\n✅ All tests passed!');
      } else {
        console.log('\n=== TEST SUMMARY ===');
        console.log('✅ Direct generator test passed');
        console.log('❌ Generator manager test failed');
      }
    } else {
      console.log('\n=== TEST SUMMARY ===');
      console.log('❌ Direct generator test failed, skipping manager test');
    }
  } catch (error) {
    console.error(`Fatal error in tests: ${error.message}`);
  } finally {
    console.log('\nTests completed');
    process.exit(0);
  }
}

// Start the tests
runTests();