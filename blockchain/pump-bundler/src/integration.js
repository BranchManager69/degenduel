/**
 * Integration of the Pump.fun bundler with DegenDuel systems
 */

import { PumpFunClient, PumpBundler, TX_MODE } from './index.js';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import logger from '../../utils/logger-suite/logger.js';

// Create a dedicated logger for pump operations
const pumpLogger = logger.forService('pump-bundler');

/**
 * DegenDuel Pump.fun integration
 */
class DegenDuelPumpIntegration {
  constructor(options = {}) {
    this.options = options;
    this.client = new PumpFunClient(options);
    this.bundler = new PumpBundler(options);
  }

  /**
   * Buy a token with appropriate logging and error handling for DegenDuel
   * 
   * @param {Object} params - Buy parameters
   * @returns {Object} Transaction result with additional metadata
   */
  async buy(params) {
    const startTime = Date.now();
    const { wallet, tokenMint, solAmount, simulate = true } = params;
    
    try {
      pumpLogger.info(`Buying token ${tokenMint} for ${solAmount} SOL`, {
        token_mint: tokenMint,
        sol_amount: solAmount,
        wallet_address: wallet.publicKey.toString(),
        operation: 'buy'
      });

      const mode = simulate ? TX_MODE.SIMULATE : TX_MODE.EXECUTE;
      const result = await this.client.buyToken({
        mode,
        wallet,
        tokenMint,
        solAmount
      });

      const executionTime = Date.now() - startTime;
      
      if (result.success) {
        pumpLogger.info(`Successfully ${mode === TX_MODE.SIMULATE ? 'simulated' : 'executed'} buy for ${tokenMint}`, {
          token_mint: tokenMint,
          operation: 'buy',
          execution_time_ms: executionTime,
          simulation: mode === TX_MODE.SIMULATE,
          signature: result.signature
        });
      } else {
        pumpLogger.error(`Failed to ${mode === TX_MODE.SIMULATE ? 'simulate' : 'execute'} buy for ${tokenMint}`, {
          token_mint: tokenMint,
          operation: 'buy',
          execution_time_ms: executionTime,
          error: result.error || 'Unknown error'
        });
      }

      return {
        ...result,
        executionTime,
        params: {
          tokenMint,
          solAmount,
          walletAddress: wallet.publicKey.toString()
        }
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      pumpLogger.error(`Error buying token ${tokenMint}`, {
        token_mint: tokenMint,
        operation: 'buy',
        execution_time_ms: executionTime,
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message,
        executionTime,
        params: {
          tokenMint,
          solAmount,
          walletAddress: wallet?.publicKey?.toString() || 'unknown'
        }
      };
    }
  }

  /**
   * Sell a token with appropriate logging and error handling for DegenDuel
   * 
   * @param {Object} params - Sell parameters
   * @returns {Object} Transaction result with additional metadata
   */
  async sell(params) {
    const startTime = Date.now();
    const { wallet, tokenMint, tokenAmount, simulate = true } = params;
    
    try {
      pumpLogger.info(`Selling ${tokenAmount} of token ${tokenMint}`, {
        token_mint: tokenMint,
        token_amount: tokenAmount,
        wallet_address: wallet.publicKey.toString(),
        operation: 'sell'
      });

      const mode = simulate ? TX_MODE.SIMULATE : TX_MODE.EXECUTE;
      const result = await this.client.sellToken({
        mode,
        wallet,
        tokenMint,
        tokenAmount
      });

      const executionTime = Date.now() - startTime;
      
      if (result.success) {
        pumpLogger.info(`Successfully ${mode === TX_MODE.SIMULATE ? 'simulated' : 'executed'} sell for ${tokenMint}`, {
          token_mint: tokenMint,
          operation: 'sell',
          execution_time_ms: executionTime,
          simulation: mode === TX_MODE.SIMULATE,
          signature: result.signature
        });
      } else {
        pumpLogger.error(`Failed to ${mode === TX_MODE.SIMULATE ? 'simulate' : 'execute'} sell for ${tokenMint}`, {
          token_mint: tokenMint,
          operation: 'sell',
          execution_time_ms: executionTime,
          error: result.error || 'Unknown error'
        });
      }

      return {
        ...result,
        executionTime,
        params: {
          tokenMint,
          tokenAmount,
          walletAddress: wallet.publicKey.toString()
        }
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      pumpLogger.error(`Error selling token ${tokenMint}`, {
        token_mint: tokenMint,
        operation: 'sell',
        execution_time_ms: executionTime,
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message,
        executionTime,
        params: {
          tokenMint,
          tokenAmount,
          walletAddress: wallet?.publicKey?.toString() || 'unknown'
        }
      };
    }
  }

  /**
   * Create a bundle of transactions with proper error handling and logging
   * 
   * @param {Object} params - Bundle parameters
   * @param {Array} params.operations - List of operations to include in the bundle
   * @param {Keypair} params.wallet - Wallet to use for all transactions (optional)
   * @param {boolean} params.simulate - Whether to simulate the bundle first (defaults to true)
   * @returns {Object} Bundle execution results
   */
  async createBundle(params) {
    const startTime = Date.now();
    const { operations, wallet, simulate = true } = params;
    
    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      throw new Error('No operations provided for bundle');
    }

    try {
      pumpLogger.info(`Creating bundle with ${operations.length} operations`, {
        operation_count: operations.length,
        operation: 'bundle'
      });

      // Clear any existing transactions
      this.bundler.clearTransactions();

      // Add operations to the bundle
      for (const op of operations) {
        const { type, wallet: opWallet, tokenMint, solAmount, tokenAmount } = op;
        
        if (type === 'buy') {
          await this.bundler.addBuyTransaction({
            wallet: opWallet || wallet,
            tokenMint,
            solAmount
          });
        } else if (type === 'sell') {
          await this.bundler.addSellTransaction({
            wallet: opWallet || wallet,
            tokenMint,
            tokenAmount
          });
        } else {
          throw new Error(`Unknown operation type: ${type}`);
        }
      }

      // Simulate first if requested
      let simResults = null;
      if (simulate) {
        pumpLogger.info('Simulating bundle before execution');
        simResults = await this.bundler.simulateBundle();
        
        const allSuccessful = simResults.every(result => result.success);
        if (!allSuccessful) {
          pumpLogger.error('Bundle simulation failed', {
            operation: 'bundle',
            simulation_results: simResults
          });
          
          return {
            success: false,
            error: 'Bundle simulation failed',
            simulationResults: simResults,
            executionResults: null,
            executionTime: Date.now() - startTime
          };
        }
      }

      // Execute the bundle
      const singleWallet = wallet && operations.every(op => !op.wallet);
      let execResults;
      
      if (singleWallet) {
        // Use the provided wallet for all transactions
        execResults = await this.bundler.executeWithWallet(wallet);
      } else {
        // Use transaction-specific wallets
        execResults = await this.bundler.executeBundle();
      }

      const executionTime = Date.now() - startTime;
      const allExecuted = execResults.every(result => result.success);

      if (allExecuted) {
        pumpLogger.info('Successfully executed bundle', {
          operation: 'bundle',
          execution_time_ms: executionTime,
          operation_count: operations.length,
          signatures: execResults.map(r => r.signature).filter(Boolean)
        });
      } else {
        pumpLogger.error('Some transactions in bundle failed', {
          operation: 'bundle',
          execution_time_ms: executionTime,
          operation_count: operations.length,
          successful_count: execResults.filter(r => r.success).length,
          failed_count: execResults.filter(r => !r.success).length
        });
      }

      return {
        success: allExecuted,
        simulationResults: simResults,
        executionResults: execResults,
        executionTime
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      pumpLogger.error('Error creating or executing bundle', {
        operation: 'bundle',
        execution_time_ms: executionTime,
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message,
        executionTime
      };
    }
  }
}

export default DegenDuelPumpIntegration;