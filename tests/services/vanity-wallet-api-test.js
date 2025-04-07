#!/usr/bin/env node

/**
 * Test script for the Vanity Wallet API
 * 
 * This script tests the Vanity Wallet API endpoints in a running DegenDuel application.
 * It requires a server to be running and admin credentials.
 * 
 * Usage:
 *   node vanity-wallet-api-test.js [--url URL] [--token ADMIN_TOKEN]
 */

import fetch from 'node-fetch';
import crypto from 'crypto';

// Parse command line arguments
const args = process.argv.slice(2);
let baseUrl = 'http://localhost:3004';
let adminToken = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && i + 1 < args.length) {
    baseUrl = args[i + 1];
    i++;
  } else if (args[i] === '--token' && i + 1 < args.length) {
    adminToken = args[i + 1];
    i++;
  }
}

// Validate required parameters
if (!adminToken) {
  console.error('Error: Admin token is required. Please provide it with --token');
  process.exit(1);
}

console.log(`Testing Vanity Wallet API with:`);
console.log(`- Base URL: ${baseUrl}`);
console.log(`- Admin Token: ${adminToken.substring(0, 10)}...`);
console.log('\n');

/**
 * Makes an API request with authentication
 */
async function makeRequest(endpoint, method = 'GET', body = null) {
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`
  };
  
  const options = {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  };
  
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    console.error(`Request error for ${method} ${endpoint}: ${error.message}`);
    return { status: -1, error: error.message };
  }
}

/**
 * Tests the generator status endpoint
 */
async function testGeneratorStatus() {
  console.log('Testing generator status endpoint...');
  
  const { status, data } = await makeRequest('/api/admin/vanity-wallets/status/generator');
  
  if (status === 200) {
    console.log(`✅ Generator status check succeeded`);
    console.log(`   Status: ${data.status}`);
    console.log(`   Generator Status: ${JSON.stringify(data.generatorStatus)}`);
    return true;
  } else {
    console.log(`❌ Generator status check failed: ${status}`);
    console.log(`   Error: ${data.error || JSON.stringify(data)}`);
    return false;
  }
}

/**
 * Tests creating a vanity wallet request
 */
async function testCreateVanityWallet() {
  const pattern = `TEST${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
  console.log(`Testing create vanity wallet endpoint with pattern: ${pattern}...`);
  
  const { status, data } = await makeRequest('/api/admin/vanity-wallets', 'POST', {
    pattern,
    isSuffix: false,
    caseSensitive: true
  });
  
  if (status === 202) {
    console.log(`✅ Create vanity wallet request succeeded`);
    console.log(`   Request ID: ${data.requestId}`);
    console.log(`   Pattern: ${data.pattern}`);
    return { success: true, requestId: data.requestId, pattern };
  } else {
    console.log(`❌ Create vanity wallet request failed: ${status}`);
    console.log(`   Error: ${data.error || JSON.stringify(data)}`);
    return { success: false };
  }
}

/**
 * Tests getting a specific vanity wallet
 */
async function testGetVanityWallet(requestId) {
  console.log(`Testing get vanity wallet endpoint for request ID: ${requestId}...`);
  
  const { status, data } = await makeRequest(`/api/admin/vanity-wallets/${requestId}`);
  
  if (status === 200) {
    console.log(`✅ Get vanity wallet succeeded`);
    console.log(`   Status: ${data.status}`);
    console.log(`   Pattern: ${data.pattern}`);
    return { success: true, walletStatus: data.status };
  } else {
    console.log(`❌ Get vanity wallet failed: ${status}`);
    console.log(`   Error: ${data.error || JSON.stringify(data)}`);
    return { success: false };
  }
}

/**
 * Polls a vanity wallet request until it completes or times out
 */
async function pollVanityWalletUntilComplete(requestId, timeoutMs = 120000) {
  console.log(`Polling vanity wallet request ${requestId} until complete...`);
  
  const startTime = Date.now();
  let lastStatus = '';
  
  while (Date.now() - startTime < timeoutMs) {
    const { success, walletStatus } = await testGetVanityWallet(requestId);
    
    if (!success) {
      return { success: false };
    }
    
    if (walletStatus !== lastStatus) {
      console.log(`   Status changed to: ${walletStatus}`);
      lastStatus = walletStatus;
    }
    
    if (walletStatus === 'completed') {
      console.log(`✅ Vanity wallet generation completed!`);
      return { success: true, status: walletStatus };
    } else if (walletStatus === 'failed' || walletStatus === 'cancelled') {
      console.log(`❌ Vanity wallet generation ${walletStatus}`);
      return { success: false, status: walletStatus };
    }
    
    // Wait a bit before polling again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`❌ Vanity wallet generation timed out after ${timeoutMs/1000} seconds`);
  return { success: false, timedOut: true };
}

/**
 * Tests cancelling a vanity wallet request
 */
async function testCancelVanityWallet(requestId) {
  console.log(`Testing cancel vanity wallet endpoint for request ID: ${requestId}...`);
  
  const { status, data } = await makeRequest(`/api/admin/vanity-wallets/${requestId}/cancel`, 'POST');
  
  if (status === 200) {
    console.log(`✅ Cancel vanity wallet succeeded`);
    console.log(`   Status: ${data.status}`);
    return true;
  } else {
    console.log(`❌ Cancel vanity wallet failed: ${status}`);
    console.log(`   Error: ${data.error || JSON.stringify(data)}`);
    return false;
  }
}

/**
 * Tests listing vanity wallets
 */
async function testListVanityWallets() {
  console.log('Testing list vanity wallets endpoint...');
  
  const { status, data } = await makeRequest('/api/admin/vanity-wallets');
  
  if (status === 200) {
    console.log(`✅ List vanity wallets succeeded`);
    console.log(`   Total wallets: ${data.pagination?.total || 'unknown'}`);
    console.log(`   First few wallets: ${data.wallets?.slice(0, 3).map(w => w.pattern).join(', ') || 'none'}`);
    return true;
  } else {
    console.log(`❌ List vanity wallets failed: ${status}`);
    console.log(`   Error: ${data.error || JSON.stringify(data)}`);
    return false;
  }
}

/**
 * Tests creating a batch of vanity wallets
 */
async function testBatchVanityWallets() {
  const patterns = [
    `BATCH${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
    `TEST${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`
  ];
  
  console.log(`Testing batch create vanity wallets endpoint with patterns: ${patterns.join(', ')}...`);
  
  const { status, data } = await makeRequest('/api/admin/vanity-wallets/batch', 'POST', {
    patterns,
    isSuffix: false,
    caseSensitive: true
  });
  
  if (status === 202) {
    console.log(`✅ Batch create vanity wallets succeeded`);
    console.log(`   Results: ${data.results.map(r => `${r.pattern}:${r.status}`).join(', ')}`);
    return true;
  } else {
    console.log(`❌ Batch create vanity wallets failed: ${status}`);
    console.log(`   Error: ${data.error || JSON.stringify(data)}`);
    return false;
  }
}

/**
 * Runs all the tests
 */
async function runTests() {
  try {
    console.log(`=== STARTING VANITY WALLET API TESTS ===\n`);
    
    // Test endpoints
    let hasFailures = false;
    
    // Test generator status
    const statusResult = await testGeneratorStatus();
    if (!statusResult) hasFailures = true;
    
    // Test listing
    const listResult = await testListVanityWallets();
    if (!listResult) hasFailures = true;
    
    // Test batch creation
    const batchResult = await testBatchVanityWallets();
    if (!batchResult) hasFailures = true;
    
    // Test create, get, poll, and cancel
    const createResult = await testCreateVanityWallet();
    
    if (createResult.success) {
      const requestId = createResult.requestId;
      
      // Poll the request for a while
      const pollResult = await pollVanityWalletUntilComplete(requestId, 60000);
      
      if (!pollResult.success && !pollResult.timedOut) {
        hasFailures = true;
      }
      
      // If it's still processing, cancel it
      if (pollResult.timedOut || pollResult.status === 'processing') {
        const cancelResult = await testCancelVanityWallet(requestId);
        if (!cancelResult) hasFailures = true;
      }
    } else {
      hasFailures = true;
    }
    
    // Summary
    console.log('\n=== API TEST SUMMARY ===');
    if (hasFailures) {
      console.log('❌ Some tests failed');
    } else {
      console.log('✅ All tests passed!');
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