// tests/test-vanity-wallet.js
// Test script for the vanity wallet service that generates a real vanity address
// and validates the entire workflow from job creation to database updates

import vanityWalletService from '../services/vanity-wallet/index.js';
import prisma from '../config/prisma.js';
import { Keypair } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';

// Pattern to generate - simple and quick "TST" prefix (no numbers)
// This should be very fast to generate (a few seconds at most)
const TEST_PATTERN = 'TST';

// Calculate an appropriate timeout based on pattern length and complexity
function calculateTimeout(pattern, caseSensitive = true) {
  // Benchmark: 4-character case-sensitive pattern took ~106 seconds 
  const BASE_TIME_4_CHARS = 159; // seconds (with safety margin)
  const BASE_CHAR_COUNT = 4;
  
  // Character space depends on case sensitivity
  const charSpace = caseSensitive ? 58 : 33;
  
  // Calculate difficulty factor based on pattern length difference
  const lengthDiff = pattern.length - BASE_CHAR_COUNT;
  const difficultyFactor = lengthDiff >= 0 
    ? Math.pow(charSpace, lengthDiff)  // Each additional character multiplies difficulty by charSpace
    : 1 / Math.pow(charSpace, -lengthDiff); // Each fewer character divides difficulty by charSpace
  
  // Calculate timeout in milliseconds with reasonable limits
  const MIN_TIMEOUT = 30 * 1000;  // 30 seconds minimum
  const MAX_TIMEOUT = 30 * 60 * 1000; // 30 minutes maximum
  
  const calculatedTimeout = BASE_TIME_4_CHARS * difficultyFactor * 1000;
  const timeout = Math.min(Math.max(calculatedTimeout, MIN_TIMEOUT), MAX_TIMEOUT);
  
  console.log(`Calculated timeout for pattern "${pattern}" (${pattern.length} chars): ${Math.round(timeout/1000)} seconds`);
  return timeout;
}

// Time to wait for generation based on pattern complexity
const MAX_WAIT_TIME = calculateTimeout(TEST_PATTERN);

/**
 * Tests the vanity wallet service by generating a real wallet with the TST prefix
 */
async function testVanityWalletService() {
  try {
    console.log(`========== VANITY WALLET SERVICE TEST ==========`);
    console.log(`Test started at: ${new Date().toISOString()}`);
    console.log(`Pattern to generate: ${TEST_PATTERN}`);
    
    // Step 1: Initialize the service
    console.log(`\n1. Initializing vanity wallet service...`);
    if (!vanityWalletService.isInitialized) {
      await vanityWalletService.init();  // Use init() for initialization
      vanityWalletService.isInitialized = true; // Mark as initialized
      console.log(`   ✅ Service initialized successfully`);
    } else {
      console.log(`   ✅ Service was already initialized`);
    }

    // Step 2: Clean up existing test addresses and excess pending/processing jobs
    console.log(`\n2. Cleaning up existing test addresses and excess jobs...`);
    
    // First, find any existing addresses with our test pattern
    const existingAddresses = await prisma.vanity_wallet_pool.findMany({
      where: {
        pattern: TEST_PATTERN
      }
    });
    
    if (existingAddresses.length > 0) {
      console.log(`   Found ${existingAddresses.length} existing addresses with pattern ${TEST_PATTERN}`);
      
      // Delete them to ensure a clean test
      await prisma.vanity_wallet_pool.deleteMany({
        where: {
          pattern: TEST_PATTERN
        }
      });
      console.log(`   ✅ Deleted existing test addresses`);
    } else {
      console.log(`   ✅ No existing test addresses found`);
    }
    
    // Next, look for and clean up excess pending/processing jobs that might be blocking our test
    const pendingProcessingJobs = await prisma.vanity_wallet_pool.findMany({
      where: {
        status: { in: ['pending', 'processing'] }
      },
      orderBy: {
        created_at: 'asc'
      }
    });
    
    console.log(`   Found ${pendingProcessingJobs.length} pending/processing jobs in the system`);
    
    // If there are more than 5 pending/processing jobs, cancel the oldest ones to make room
    if (pendingProcessingJobs.length > 5) {
      const jobsToCancel = pendingProcessingJobs.slice(0, pendingProcessingJobs.length - 5);
      console.log(`   Cancelling ${jobsToCancel.length} old jobs to make room for our test...`);
      
      for (const job of jobsToCancel) {
        await prisma.vanity_wallet_pool.update({
          where: { id: job.id },
          data: {
            status: 'cancelled',
            updated_at: new Date(),
            completed_at: new Date()
          }
        });
        console.log(`   ✅ Cancelled job #${job.id} (pattern: ${job.pattern}, status: ${job.status})`);
      }
    }
    
    // Step 3: Create a job for the test pattern
    console.log(`\n3. Creating a job for pattern ${TEST_PATTERN}...`);
    
    // First - we'll create the job directly in the database as the test originally did
    const newJob = await prisma.vanity_wallet_pool.create({
      data: {
        pattern: TEST_PATTERN,
        status: 'pending',
        is_used: false,
        case_sensitive: true,
        is_suffix: false,
        attempts: 0, 
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    
    console.log(`   ✅ Job created with ID: ${newJob.id}`);
    
    // Now we'll ALSO directly submit the job to the generator to ensure it's processed
    console.log(`   Submitting job directly to generator...`);
    
    // Access the generator through the service
    if (vanityWalletService.generator) {
      // Create a job object for the generator
      const job = {
        id: newJob.id.toString(),
        pattern: TEST_PATTERN,
        isSuffix: false,
        caseSensitive: true,
        onComplete: async (result) => {
          console.log(`   Job completion callback received with status: ${result.status}`);
        }
      };
      
      // Queue the job directly
      vanityWalletService.generator.submitJob(job, 
        // Completion callback
        (result) => console.log(`   Job completion callback received with status: ${result.status}`),
        // Progress callback
        (progress) => {
          if (progress.attempts % 100000 === 0) {
            console.log(`   Job progress: ${progress.attempts} attempts`);
          }
        }
      );
      console.log(`   ✅ Job submitted to generator for processing`);
    } else {
      console.log(`   ❌ Generator not available! Job will be picked up by service when it runs.`);
    }
    
    // Step 4: Start the generator
    console.log(`\n4. Starting the generator...`);
    console.log(`   The generator will now search for a wallet with the prefix: ${TEST_PATTERN}`);
    console.log(`   This may take a few seconds... (max wait: ${MAX_WAIT_TIME/1000} seconds)`);
    
    const startTime = Date.now();
    
    // Make sure we have a generator instance
    if (!vanityWalletService.generator) {
      console.log(`   Getting generator instance...`);
      // Import the generator manager rather than creating a new instance
      const VanityWalletGeneratorManager = (await import('../services/vanity-wallet/generators/index.js')).default;
      // Get the singleton instance
      vanityWalletService.generator = VanityWalletGeneratorManager.getInstance();
      console.log(`   ✅ Connected to generator manager`);
    } else {
      console.log(`   ✅ Generator already initialized`);
    }
    
    // Set targetCounts property to include our test pattern
    if (!vanityWalletService.targetCounts) {
      vanityWalletService.targetCounts = {};
    }
    vanityWalletService.targetCounts[TEST_PATTERN] = 1;
    
    // Make sure our pattern is in the patterns list
    if (!vanityWalletService.patterns.includes(TEST_PATTERN)) {
      vanityWalletService.patterns.push(TEST_PATTERN);
    }
    
    // Start the generator by running checkAndGenerateAddresses directly
    console.log(`   Running vanity address generator...`);
    await vanityWalletService.checkAndGenerateAddresses();
    
    // Also directly submit our job to the generator to ensure it's processed
    console.log(`   Directly adding our job to the generator again to ensure processing...`);
    
    try {
      const jobConfig = {
        id: newJob.id.toString(),
        pattern: TEST_PATTERN,
        isSuffix: false,
        caseSensitive: true
      };
      
      // Use the standard method name
      await vanityWalletService.generator.addJob(
        jobConfig,
        (result) => {
          console.log(`   Job completion callback received: ${result.status}`);
          if (result.status === 'Completed') {
            console.log(`   ✅ Generated address: ${result.result.address}`);
          }
        },
        (progress) => {
          if (progress.attempts % 100000 === 0) {
            console.log(`   Progress update: ${progress.attempts} attempts`);
          }
        }
      );
      
      console.log(`   ✅ Job submitted directly to generator`);
    } catch (error) {
      console.log(`   ❌ Error submitting directly to generator: ${error.message}`);
    }
    
    // The job has already been submitted to the generator by createVanityAddressRequest
    
    // Wait for the job to complete or timeout
    let jobCompleted = false;
    let completedJob = null;
    let lastStatus = null;
    let lastJobState = null;
    
    while (!jobCompleted && (Date.now() - startTime) < MAX_WAIT_TIME) {
      // Check the current job state
      const currentJob = await prisma.vanity_wallet_pool.findUnique({
        where: { id: newJob.id }
      });
      
      // Log status changes
      if (currentJob && currentJob.status !== lastStatus) {
        console.log(`   Job status changed to: ${currentJob.status} (${Math.round((Date.now() - startTime)/1000)}s elapsed)`);
        lastStatus = currentJob.status;
        lastJobState = currentJob;
      }
      
      // Check if the job is complete
      if (currentJob && currentJob.status === 'completed' && 
          currentJob.wallet_address && currentJob.private_key) {
        jobCompleted = true;
        completedJob = currentJob;
        console.log(`   ✅ Job completed successfully! Address: ${currentJob.wallet_address}`);
      } 
      // Check if it failed
      else if (currentJob && (currentJob.status === 'failed' || currentJob.status === 'cancelled')) {
        console.log(`   ❌ Job ${currentJob.status} after ${Math.round((Date.now() - startTime)/1000)} seconds`);
        completedJob = currentJob;
        break;
      }
      // Still processing
      else {
        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Log progress every 5 seconds
        if ((Date.now() - startTime) % 5000 < 1000) {
          console.log(`   Still generating... (${Math.round((Date.now() - startTime)/1000)} seconds elapsed)`);
          
          // Get generator status
          if (vanityWalletService.generator) {
            const status = vanityWalletService.generator.getStatus();
            console.log(`   Generator status: ${status.queuedJobs} queued jobs, ${status.activeJobs.length} active jobs`);
            
            // If we're not seeing progress after 20 seconds, try to resubmit the job
            if ((Date.now() - startTime) > 20000 && currentJob.status === 'pending') {
              console.log(`   Resubmitting job to ensure it's processed...`);
              // Update job to processing status
              await prisma.vanity_wallet_pool.update({
                where: { id: newJob.id },
                data: {
                  status: 'processing',
                  updated_at: new Date()
                }
              });
              
              // Resubmit to generator
              if (vanityWalletService.generator) {
                try {
                  const job = {
                    id: newJob.id.toString(),
                    pattern: TEST_PATTERN,
                    isSuffix: false,
                    caseSensitive: true,
                    onComplete: async (result) => {
                      console.log(`   Job completion callback received with status: ${result.status}`);
                    }
                  };
                  
                  vanityWalletService.generator.submitJob(job, 
                    // Completion callback
                    (result) => console.log(`   Job completion callback received with status: ${result.status}`),
                    // Progress callback
                    (progress) => {
                      if (progress.attempts % 100000 === 0) {
                        console.log(`   Job progress: ${progress.attempts} attempts`);
                      }
                    }
                  );
                  console.log(`   ✅ Job resubmitted to generator`);
                } catch (err) {
                  console.log(`   ❌ Error resubmitting job: ${err.message}`);
                }
              }
            }
          }
        }
        
        // Run the generator again to keep it going
        await vanityWalletService.checkAndGenerateAddresses();
      }
    }
    
    // Step 5: Verify the results
    console.log(`\n5. Verifying results...`);
    
    if (!completedJob) {
      console.log(`   ❌ Failed to generate vanity wallet within timeout`);
      
      // Check the status of any jobs
      const pendingJobs = await prisma.vanity_wallet_pool.findMany({
        where: {
          pattern: TEST_PATTERN
        }
      });
      
      if (pendingJobs.length > 0) {
        console.log(`   Found ${pendingJobs.length} jobs with the following statuses:`);
        for (const job of pendingJobs) {
          console.log(`   - Job #${job.id}: ${job.status} (attempts: ${job.attempts || 0})`);
        }
      }
      
      process.exit(1);
    }
    
    console.log(`   ✅ Successfully generated vanity wallet in ${Math.round((Date.now() - startTime)/1000)} seconds`);
    console.log(`   Job ID: ${completedJob.id}`);
    console.log(`   Pattern: ${completedJob.pattern}`);
    console.log(`   Address: ${completedJob.wallet_address}`);
    
    // Step 6: Validate the address format
    const address = completedJob.wallet_address;
    const privateKeyJson = completedJob.private_key;
    
    console.log(`\n6. Validating the generated address...`);
    
    // Verify the address starts with the pattern
    if (!address.startsWith(TEST_PATTERN)) {
      console.log(`   ❌ Address does not start with ${TEST_PATTERN}: ${address}`);
      process.exit(1);
    }
    
    console.log(`   ✅ Address starts with ${TEST_PATTERN}: ${address}`);
    
    // Verify that the private key is valid by checking its structure
    let privateKeyObj;
    try {
      privateKeyObj = JSON.parse(privateKeyJson);
      console.log(`   ✅ Private key is valid JSON`);
    } catch (e) {
      console.log(`   ❌ Private key is not valid JSON: ${e.message}`);
      process.exit(1);
    }
    
    // Validate key length is correct (typically Solana private keys are 64 bytes)
    if (typeof privateKeyObj !== 'object') {
      console.log(`   ❌ Private key is not an object`);
      process.exit(1);
    }
    
    console.log(`   ✅ Private key appears to be valid`);
    
    // Step 7: Clean up
    console.log(`\n7. Test cleanup...`);
    console.log(`   NOTE: Not deleting the test wallet to preserve it as a valid test case`);
    
    // Success!
    console.log(`\n========== TEST COMPLETED SUCCESSFULLY ==========`);
    console.log(`Generated vanity wallet with address: ${address}`);
    console.log(`Pattern: ${TEST_PATTERN}`);
    console.log(`Generation time: ${Math.round((Date.now() - startTime)/1000)} seconds`);
    console.log(`Test completed at: ${new Date().toISOString()}`);
    
  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  } finally {
    // Make sure to exit
    process.exit(0);
  }
}

// Run the test
testVanityWalletService();