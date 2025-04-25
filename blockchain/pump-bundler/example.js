/**
 * Example usage of the Pump.fun bundler
 */

import { PumpFunClient, PumpBundler, TX_MODE } from './src/index.js';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Replace with your private key - NEVER hardcode in production!
const privateKey = process.env.SOLANA_PRIVATE_KEY;
const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));

// Example token mint (replace with actual token mint)
const tokenMint = 'YOUR_TOKEN_MINT_ADDRESS';

// Create a client for direct transactions
const client = new PumpFunClient({
  priorityFee: 1000000, // 0.001 SOL in lamports
  confirmationTarget: 'confirmed'
});

// Example: Buy tokens directly
async function buyTokens() {
  try {
    console.log('Buying tokens...');
    
    const result = await client.buyToken({
      mode: TX_MODE.EXECUTE,
      wallet,
      tokenMint,
      solAmount: 0.01 // 0.01 SOL
    });
    
    console.log('Buy result:', result);
    if (result.success) {
      console.log('Transaction successful!');
      console.log('Signature:', result.signature);
    } else {
      console.error('Transaction failed:', result.error);
    }
  } catch (error) {
    console.error('Error buying tokens:', error);
  }
}

// Example: Create a bundle of transactions
async function createBundle() {
  try {
    console.log('Creating transaction bundle...');
    
    const bundler = new PumpBundler({
      priorityFee: 1000000,
      confirmationTarget: 'confirmed',
      simulate: true
    });
    
    // Add transactions to the bundle
    await bundler.addBuyTransaction({
      wallet,
      tokenMint,
      solAmount: 0.005 // 0.005 SOL
    });
    
    console.log('Added first transaction to bundle');
    
    // Add another transaction (this could be for a different token)
    await bundler.addBuyTransaction({
      wallet,
      tokenMint, // Same token in this example
      solAmount: 0.005 // 0.005 SOL
    });
    
    console.log('Added second transaction to bundle');
    
    // Simulate the bundle first
    console.log('Simulating bundle...');
    const simResults = await bundler.simulateBundle();
    console.log('Simulation results:', simResults);
    
    // Execute if all simulations are successful
    const allSuccessful = simResults.every(result => result.success);
    
    if (allSuccessful) {
      console.log('All simulations successful, executing bundle...');
      const execResults = await bundler.executeBundle();
      console.log('Execution results:', execResults);
      
      // Check if all transactions were executed successfully
      const allExecuted = execResults.every(result => result.success);
      if (allExecuted) {
        console.log('All transactions executed successfully!');
      } else {
        console.error('Some transactions failed during execution');
      }
    } else {
      console.error('Some transactions failed during simulation, aborting execution');
    }
  } catch (error) {
    console.error('Error creating bundle:', error);
  }
}

// Uncomment to run examples
// buyTokens();
// createBundle();

console.log('To use this example:');
console.log('1. Set your private key as SOLANA_PRIVATE_KEY environment variable');
console.log('2. Replace YOUR_TOKEN_MINT_ADDRESS with the actual token mint');
console.log('3. Uncomment either buyTokens() or createBundle() to run the example');
