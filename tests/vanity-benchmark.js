// tests/vanity-benchmark.js

/**
 * A simple benchmark script for vanity wallet generation
 * 
 * This script is used to benchmark the performance of the vanity wallet generation service.
 * It is not intended to be used as a real benchmark, but rather as a tool to help us understand the performance of the service.
 * 
 * @module tests/vanity-benchmark
 * @version 1.9.0
 * @author BranchManager69
 */

import VanityApiClient from '../services/vanity-wallet/vanity-api-client.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';

// Configuration
const PATTERN = 'dump'; // n-character pattern for benchmarking
const CASE_SENSITIVE = true; // Whether to use case-sensitive matching
const IS_SUFFIX = true; // Whether to search for a suffix instead of prefix
const NUM_THREADS = 8; // Use all 8 CPU threads for maximum performance
const CPU_LIMIT = 90; // 90% CPU usage limit for better performance
const NUM_RUNS = 1;     // Number of benchmark runs
const MAX_RUNTIME_MINUTES = 15; // (input in minutes)
const MAX_RUNTIME_MS = MAX_RUNTIME_MINUTES * 60 * 1000; // max runtime in milliseconds

/**
 * Run a single benchmark
 */
async function runBenchmark(runNumber) {
  logApi.info(`\n========== BENCHMARK RUN ${runNumber + 1} ==========`);
  logApi.info(`Pattern: ${PATTERN}`);
  logApi.info(`Started at: ${new Date().toISOString()}`);
  
  const startTime = Date.now();
  
  // err occurence:
  // 11:40:06 AM [INFO] [LocalVanityGenerator]  UPDATED DB  Successfully updated record for job #323 with completed address qTkXcpX9kGPEQRT9Tm4zT7XMLLfc2R9cVW7Hf6Jdump
  // 11:40:06 AM [INFO] [VanityApiClient]  Processing  local result for request #323 {"jobStatus":"Completed"}
  // 11:40:06 AM [INFO] [VanityApiClient]  Success  Vanity wallet generated: qTkXcpX9kGPEQRT9Tm4zT7XMLLfc2R9cVW7Hf6Jdump {"address":"qTkXcpX9kGPEQRT9Tm4zT7XMLLfc2R9cVW7Hf6Jdump","pattern":"dump"}
  // 11:40:06 AM [INFO] 
  // ✅ SUCCESS: Generated dump address in 827 seconds
  // 11:40:06 AM [INFO] Address: qTkXcpX9kGPEQRT9Tm4zT7XMLLfc2R9cVW7Hf6Jdump
  // 11:40:06 AM [INFO] Attempts: 135,000,000
  // 11:40:06 AM [ERROR] Error during benchmark: Cannot mix BigInt and other types, use explicit conversions
  // 11:40:06 AM [INFO] 
  // ❌ No successful runs to calculate statistics  try {
  
  try {
    // Create a vanity address request
    const dbRecord = await VanityApiClient.createVanityAddressRequest({
      pattern: PATTERN,
      isSuffix: IS_SUFFIX,
      caseSensitive: CASE_SENSITIVE,
      numThreads: NUM_THREADS,
      cpuLimit: CPU_LIMIT,
      requestedBy: 'benchmark',
      requestIp: '127.0.0.1'
    });
    
    logApi.info(`Request created with ID: ${dbRecord.id}`);
    
    // Poll until completion or timeout
    let completed = false;
    let attempts = 0;
    
    // Loop until the job is completed or the timeout is reached
    while (!completed && (Date.now() - startTime) < MAX_RUNTIME_MS) {
      // Check status
      const currentStatus = await prisma.vanity_wallet_pool.findUnique({
        where: { id: dbRecord.id }
      });
      if (!currentStatus) {
        throw new Error('Job record not found');
      }
      
      // If completed or failed or cancelled
      if (currentStatus.status === 'completed' || 
          currentStatus.status === 'failed' ||
          currentStatus.status === 'cancelled') {
        completed = true;
        attempts = currentStatus.attempts || 0;
        
        // Calculate duration
        const duration = Date.now() - startTime;
        const durationSec = Math.round(duration / 1000);
        
        // If completed
        if (currentStatus.status === 'completed') {
          logApi.info(`\n✅ SUCCESS: Generated ${PATTERN} address in ${durationSec} seconds`);
          logApi.info(`Address: ${currentStatus.wallet_address}`);
          logApi.info(`Attempts: ${attempts.toLocaleString()}`);
          logApi.info(`Attempts per second: ${Math.round(attempts / (duration / 1000)).toLocaleString()}`);
          
          // Calculate theoretical probabilities
          const characterSpace = CASE_SENSITIVE ? 58 : 33; // 58 for case-sensitive (base58), 33 for case-insensitive
          const theoreticalAttempts = Math.pow(characterSpace, PATTERN.length);
          // Convert potential BigInt to Number to avoid mixing types
          const attemptsNum = Number(attempts);
          const efficiency = (theoreticalAttempts / attemptsNum) * 100;
          
          logApi.info(`Theoretical probability: 1 in ${theoreticalAttempts.toLocaleString()}`);
          logApi.info(`Efficiency rating: ${efficiency.toFixed(2)}%`);
          
          return {
            success: true,
            duration,
            attempts,
            characterSpace,
            theoreticalAttempts,
            efficiency,
            recordId: dbRecord.id
          };
        } else {
          logApi.info(`\n❌ FAILED: ${currentStatus.status} after ${durationSec} seconds`);
          return {
            success: false,
            duration,
            attempts,
            recordId: dbRecord.id
          };
        }
      }
      
      // Still processing - wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Log progress every 5 seconds
      if ((Date.now() - startTime) % 5000 < 1000) {
        logApi.info(`Still generating... (${Math.round((Date.now() - startTime)/1000)} seconds elapsed)`);
      }
    }
    
    // If we get here, we timed out
    logApi.info(`\n❌ TIMEOUT: Generation took longer than ${MAX_RUNTIME_MS/1000} seconds`);
    return {
      success: false,
      duration: MAX_RUNTIME_MS,
      attempts: 0,
      recordId: dbRecord.id,
      timedOut: true
    };
    
  } catch (error) {
    logApi.error(`Error during benchmark: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Run multiple benchmarks and calculate statistics
 */
async function runBenchmarks() {
  logApi.info(`========== VANITY WALLET GENERATION BENCHMARK ==========`);
  logApi.info(`Pattern: ${PATTERN} (${PATTERN.length} characters, ${CASE_SENSITIVE ? 'case-sensitive' : 'case-insensitive'})`);
  logApi.info(`Search type: ${IS_SUFFIX ? 'Suffix' : 'Prefix'}`);
  logApi.info(`CPU threads: ${NUM_THREADS}`);
  logApi.info(`CPU limit: ${CPU_LIMIT}%`);
  logApi.info(`Number of runs: ${NUM_RUNS}`);
  logApi.info(`Max runtime per run: ${MAX_RUNTIME_MINUTES} minutes`);
  logApi.info(`Started at: ${new Date().toISOString()}`);
  
  const results = [];
  
  for (let i = 0; i < NUM_RUNS; i++) {
    const result = await runBenchmark(i);
    results.push(result);
    
    // Clean up - delete the record from the database
    if (result.recordId) {
      try {
        await prisma.vanity_wallet_pool.delete({
          where: { id: result.recordId }
        });
      } catch (error) {
        logApi.warn(`Warning: Could not delete benchmark record: ${error.message}`);
      }
    }
  }
  
  // Calculate statistics
  const successfulRuns = results.filter(r => r.success);
  
  if (successfulRuns.length > 0) {
    const totalDuration = successfulRuns.reduce((sum, r) => sum + r.duration, 0);
    const avgDuration = totalDuration / successfulRuns.length;
    
    const totalAttempts = successfulRuns.reduce((sum, r) => sum + r.attempts, 0);
    const avgAttempts = totalAttempts / successfulRuns.length;
    
    // Calculate attempts per second and per thread
    const attemptsPerSec = Math.round(avgAttempts / (avgDuration / 1000));
    const attemptsPerSecPerThread = Math.round(attemptsPerSec / NUM_THREADS);
    
    logApi.info(`\n========== BENCHMARK RESULTS ==========`);
    logApi.info(`Successful runs: ${successfulRuns.length}/${NUM_RUNS}`);
    logApi.info(`Average duration: ${Math.round(avgDuration/1000)} seconds`);
    logApi.info(`Average attempts: ${Math.round(avgAttempts).toLocaleString()}`);
    logApi.info(`Attempts per second: ${attemptsPerSec.toLocaleString()}`);
    logApi.info(`Attempts per second per thread: ${attemptsPerSecPerThread.toLocaleString()}`);
    
    // Get character space based on case sensitivity
    const characterSpace = CASE_SENSITIVE ? 58 : 33; // 58 for case-sensitive (base58), 33 for case-insensitive
    
    // Calculate theoretical probability and average efficiency
    if (successfulRuns[0]?.theoreticalAttempts) {
      const avgEfficiency = successfulRuns.reduce((sum, r) => sum + r.efficiency, 0) / successfulRuns.length;
      logApi.info(`Theoretical probability: 1 in ${successfulRuns[0].theoreticalAttempts.toLocaleString()}`);
      logApi.info(`Average efficiency: ${avgEfficiency.toFixed(2)}%`);
    }
    
    // Calculate CPU utilization performance metrics
    const cpuUtilizationFactor = CPU_LIMIT / 100;
    const hypotheticalFullCpuAttemptsPerSec = Math.round(attemptsPerSec / cpuUtilizationFactor);
    logApi.info(`Hypothetical attempts/sec at 100% CPU: ${hypotheticalFullCpuAttemptsPerSec.toLocaleString()}`);
    
    // Calculate a recommended timeout formula
    const recommendedBaseTimeout = Math.round(avgDuration * 1.5 / 1000); // 50% safety margin
    logApi.info(`\n========== RECOMMENDED TIMEOUT FORMULA ==========`);
    logApi.info(`For a ${PATTERN.length}-character ${CASE_SENSITIVE ? 'case-sensitive' : 'case-insensitive'} pattern: ${recommendedBaseTimeout} seconds`);
    logApi.info(`Configuration used: ${NUM_THREADS} threads, ${CPU_LIMIT}% CPU limit`);
    logApi.info(`Recommended formula:`);
    logApi.info(`  baseTime = ${recommendedBaseTimeout} seconds for ${PATTERN.length} chars`);
    logApi.info(`  timeout = baseTime * (${characterSpace}^(length - ${PATTERN.length})) for ${CASE_SENSITIVE ? 'case-sensitive' : 'case-insensitive'}`);
    
    // Performance recommendations
    logApi.info(`\n========== PERFORMANCE RECOMMENDATIONS ==========`);
    logApi.info(`Current setup: ${NUM_THREADS} threads at ${CPU_LIMIT}% CPU limit`);
    logApi.info(`Performance metrics: ${attemptsPerSecPerThread.toLocaleString()} attempts/sec/thread`);
    logApi.info(`Performance suggestions:`);
    logApi.info(`  - Increase thread count for better parallelism (currently ${NUM_THREADS})`);
    logApi.info(`  - Adjust CPU limit based on server load (currently ${CPU_LIMIT}%)`);
    logApi.info(`  - For 3-character patterns with current settings: ~${Math.round(Math.pow(characterSpace, 3) / attemptsPerSec)} seconds`);
    logApi.info(`  - For 4-character patterns with current settings: ~${Math.round(Math.pow(characterSpace, 4) / attemptsPerSec)} seconds`);
    logApi.info(`  - For 5-character patterns with current settings: ~${Math.round(Math.pow(characterSpace, 5) / attemptsPerSec)} seconds`);
  } else {
    logApi.info(`\n❌ No successful runs to calculate statistics`);
  }
  
  // Exit
  process.exit(0);
}

// Run the benchmarks
runBenchmarks();