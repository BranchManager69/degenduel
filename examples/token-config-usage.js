/**
 * Token Config Usage Examples
 * 
 * This file demonstrates how to use the token-config-util.js utility
 * to access token configuration throughout the application.
 */

// Import the utility
import { getTokenConfig, getTokenAddress } from '../utils/token-config-util.js';

// Example 1: Get full token config (recommended for most use cases)
async function exampleGetFullConfig() {
  // This will use the cache if available and not expired
  const tokenConfig = await getTokenConfig();
  
  if (tokenConfig) {
    console.log('Token symbol:', tokenConfig.symbol);
    console.log('Token address:', tokenConfig.address);
    console.log('Total supply:', tokenConfig.total_supply); // Already converted to Number
    console.log('Initial circulating:', tokenConfig.initial_circulating); // Already converted to Number
    
    // Can safely use in calculations without BigInt conversion issues
    const marketCap = tokenConfig.initial_circulating * tokenConfig.initial_price;
    console.log('Market cap:', marketCap.toLocaleString());
  } else {
    console.log('No token config found');
  }
}

// Example 2: Just get the token address (most common use case)
async function exampleGetTokenAddress() {
  // This will use the cache if available
  const tokenAddress = await getTokenAddress();
  
  if (tokenAddress) {
    console.log('Token address:', tokenAddress);
    // Use the address for blockchain operations, etc.
  } else {
    console.log('No token address found');
  }
}

// Example 3: Force refresh the token config (use sparingly)
async function exampleForceRefresh() {
  // This will bypass the cache and fetch fresh data
  const tokenConfig = await getTokenConfig(true);
  
  if (tokenConfig) {
    console.log('Refreshed token address:', tokenConfig.address);
  }
}

// Usage in API routes
async function exampleApiRoute(req, res) {
  try {
    const tokenAddress = await getTokenAddress();
    
    return res.json({
      success: true,
      tokenAddress
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `Error fetching token address: ${error.message}`
    });
  }
}

// You can also import the default export
// import tokenConfigUtil from '../utils/token-config-util.js';
// const address = await tokenConfigUtil.getTokenAddress();