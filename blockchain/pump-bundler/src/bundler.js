/**
 * Transaction bundler for Pump.fun
 */

import { Connection, PublicKey, Transaction, sendAndConfirmTransaction, Keypair } from '@solana/web3.js';
import PumpFunClient from './pumpfun-client.js';
import { TX_MODE, RPC_ENDPOINTS, DEFAULT_OPTIONS } from './constants.js';

class PumpBundler {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Force use of the PUMP_BUNDLER_RPC_URL if available
    let rpcEndpoint = process.env.PUMP_BUNDLER_RPC_URL || RPC_ENDPOINTS.DEFAULT;
    
    console.log(`Bundler using Solana RPC endpoint: ${rpcEndpoint}`);
    this.connection = new Connection(
      rpcEndpoint,
      { commitment: 'confirmed' }
    );
    this.pumpFunClient = new PumpFunClient(options);
    this.transactions = [];
    this.transactionSigners = [];
  }

  /**
   * Add a buy transaction to the bundle
   * 
   * @param {object} params - Buy parameters
   * @param {Keypair} params.wallet - Buyer's wallet keypair
   * @param {PublicKey|string} params.tokenMint - Token mint address
   * @param {number} params.solAmount - SOL amount to spend (in SOL)
   * @param {number} params.slippageBps - Slippage in basis points (default: 100 = 1%)
   * @returns {number} Index of the transaction in the bundle
   */
  async addBuyTransaction(params) {
    const result = await this.pumpFunClient.buyToken({
      ...params,
      mode: TX_MODE.BUNDLE
    });
    
    if (result.success) {
      this.transactions.push(result.transaction);
      this.transactionSigners.push([params.wallet]);
      return this.transactions.length - 1;
    } else {
      throw new Error('Failed to create buy transaction');
    }
  }

  /**
   * Add a sell transaction to the bundle
   * 
   * @param {object} params - Sell parameters
   * @param {Keypair} params.wallet - Seller's wallet keypair
   * @param {PublicKey|string} params.tokenMint - Token mint address
   * @param {number} params.tokenAmount - Amount of tokens to sell
   * @param {number} params.slippageBps - Slippage in basis points (default: 100 = 1%)
   * @returns {number} Index of the transaction in the bundle
   */
  async addSellTransaction(params) {
    const result = await this.pumpFunClient.sellToken({
      ...params,
      mode: TX_MODE.BUNDLE
    });
    
    if (result.success) {
      this.transactions.push(result.transaction);
      this.transactionSigners.push([params.wallet]);
      return this.transactions.length - 1;
    } else {
      throw new Error('Failed to create sell transaction');
    }
  }

  /**
   * Clear all transactions from the bundle
   */
  clearTransactions() {
    this.transactions = [];
    this.transactionSigners = [];
  }

  /**
   * Simulate the entire bundle
   * 
   * @returns {Array} Simulation results for each transaction
   */
  async simulateBundle() {
    const results = [];
    
    for (let i = 0; i < this.transactions.length; i++) {
      const transaction = this.transactions[i];
      const simulation = await this.connection.simulateTransaction(transaction);
      
      results.push({
        index: i,
        success: simulation.value.err === null,
        result: simulation.value
      });
    }
    
    return results;
  }

  /**
   * Execute the bundle by sending all transactions
   * 
   * @returns {Array} Results of transaction execution
   */
  async executeBundle() {
    const results = [];
    
    for (let i = 0; i < this.transactions.length; i++) {
      try {
        const transaction = this.transactions[i];
        const signers = this.transactionSigners[i];
        
        // Sign and send transaction
        const signature = await sendAndConfirmTransaction(
          this.connection,
          transaction,
          signers,
          { commitment: this.options.confirmationTarget }
        );
        
        results.push({
          index: i,
          success: true,
          signature
        });
      } catch (error) {
        results.push({
          index: i,
          success: false,
          error: error.message
        });
        
        // Stop executing if configured to stop on error
        if (this.options.stopOnError) {
          break;
        }
      }
    }
    
    return results;
  }

  /**
   * Execute the bundle using a single wallet for all transactions
   * 
   * @param {Keypair} wallet - Wallet to use for all transactions
   * @returns {Array} Results of transaction execution
   */
  async executeWithWallet(wallet) {
    // Override the signers with the provided wallet
    this.transactionSigners = this.transactions.map(() => [wallet]);
    
    // Execute the bundle
    return this.executeBundle();
  }
}

export default PumpBundler;
