// tests/debug-pools.js
// Directly debug pool data fetching for a specific token

import dotenv from 'dotenv';
dotenv.config();

import { logApi } from '../utils/logger-suite/logger.js';
import { dexscreenerClient } from '../services/solana-engine/dexscreener-client.js';

// Target token address (pumpfun token)
const TOKEN_ADDRESS = process.argv[2] || "DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump";

/**
 * Debug pool data fetching
 */
async function debugPools() {
  try {
    console.log('========== POOL DATA DEBUG ==========');
    console.log(`Debugging pools for token: ${TOKEN_ADDRESS}`);
    
    // Initialize DexScreener client
    if (!dexscreenerClient.initialized) {
      await dexscreenerClient.initialize();
      console.log('DexScreener client initialized');
    }
    
    // Direct API call
    console.log('\n1. Direct API call to DexScreener:');
    try {
      const poolsData = await dexscreenerClient.getTokenPools('solana', TOKEN_ADDRESS);
      console.log('API Response:', JSON.stringify(poolsData, null, 2));
      
      // Check if response is directly an array of pools
      if (Array.isArray(poolsData)) {
        console.log(`Found ${poolsData.length} pools via direct API call (array format)`);
        
        // Log the first pool for inspection
        console.log('\nFirst pool sample:');
        console.log(JSON.stringify(poolsData[0], null, 2));
      }
      // Or check if it has a pairs property
      else if (poolsData && poolsData.pairs && poolsData.pairs.length > 0) {
        console.log(`Found ${poolsData.pairs.length} pools via direct API call (pairs object format)`);
        
        // Log the first pool for inspection
        console.log('\nFirst pool sample:');
        console.log(JSON.stringify(poolsData.pairs[0], null, 2));
      } else {
        console.log('No pools found in API response or unexpected response format');
        
        // Inspect the response structure
        if (poolsData && typeof poolsData === 'object') {
            console.log('Response keys:', Object.keys(poolsData));
            if (Object.keys(poolsData).length > 0) {
                // Check if the keys are numeric indices
                const keys = Object.keys(poolsData);
                if (keys.every(k => !isNaN(parseInt(k)))) {
                    console.log('This appears to be an array-like object. Sample pool:');
                    console.log(JSON.stringify(poolsData[0], null, 2));
                    console.log(`Total pools found: ${keys.length}`);
                }
            }
        }
        console.log('Response type:', typeof poolsData);
      }
    } catch (error) {
      console.error('Error in direct API call:', error.message);
    }
    
    console.log('\n========== DEBUG COMPLETE ==========');
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    process.exit(0);
  }
}

// Run the debug function
debugPools();