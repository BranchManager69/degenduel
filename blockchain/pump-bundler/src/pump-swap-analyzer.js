/**
 * Pump.swap AMM analyzer
 * 
 * This module analyzes the transition from Pump.fun bonding curve to Pump.swap AMM
 * and provides tools for interacting with both platforms.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { PUMP_FUN_PROGRAM, PUMP_SWAP_PROGRAM, RPC_ENDPOINTS } from './constants.js';
import CurveAnalyzer from './curve-analyzer.js';
import chalk from 'chalk';

class PumpSwapAnalyzer {
  constructor(options = {}) {
    this.connection = new Connection(
      options.rpcUrl || RPC_ENDPOINTS.HELIUS,
      { commitment: 'confirmed' }
    );
    this.pumpFunProgram = new PublicKey(PUMP_FUN_PROGRAM);
    this.pumpSwapProgram = new PublicKey(PUMP_SWAP_PROGRAM);
    this.curveAnalyzer = new CurveAnalyzer(options);
  }

  /**
   * Analyze a token to determine if it's on Pump.fun, Pump.swap, or both
   * 
   * @param {string|PublicKey} tokenMint - Token mint address
   * @returns {Object} Analysis results
   */
  async analyzeToken(tokenMint) {
    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    
    try {
      console.log(chalk.cyan(`Analyzing token: ${mintPublicKey.toString()}`));
      
      // Check for Pump.fun transactions
      const pumpFunInfo = await this._checkPumpFunTransactions(mintPublicKey);
      
      // Check for Pump.swap transactions
      const pumpSwapInfo = await this._checkPumpSwapTransactions(mintPublicKey);
      
      // Get token metadata
      const metadata = await this._getTokenMetadata(mintPublicKey);
      
      // Determine token status
      const status = this._determineTokenStatus(pumpFunInfo, pumpSwapInfo);
      
      // If on Pump.fun, get curve data
      let curveData = null;
      if (status === 'pump_fun' || status === 'both') {
        const analysis = await this.curveAnalyzer.analyzeTokenCurve(mintPublicKey);
        if (analysis.success) {
          curveData = {
            currentPrice: analysis.tokenData.currentPrice,
            currentSupply: analysis.tokenData.currentSupply,
            reserveBalance: analysis.tokenData.reserveBalance
          };
        }
      }
      
      // If on Pump.swap, get pool data
      let poolData = null;
      if (status === 'pump_swap' || status === 'both') {
        poolData = await this._getPoolData(mintPublicKey);
      }
      
      return {
        success: true,
        tokenMint: mintPublicKey.toString(),
        status,
        name: metadata.name,
        symbol: metadata.symbol,
        onPumpFun: pumpFunInfo.found,
        onPumpSwap: pumpSwapInfo.found,
        curveData,
        poolData,
        lastTransactionTime: Math.max(
          pumpFunInfo.lastTransactionTime || 0,
          pumpSwapInfo.lastTransactionTime || 0
        )
      };
    } catch (error) {
      console.error(chalk.red(`Error analyzing token: ${error.message}`));
      return {
        success: false,
        tokenMint: mintPublicKey.toString(),
        error: error.message
      };
    }
  }

  /**
   * Analyze AMM pool liquidity and compare with bonding curve
   * 
   * @param {string|PublicKey} tokenMint - Token mint address
   * @returns {Object} Liquidity analysis
   */
  async analyzeTokenLiquidity(tokenMint) {
    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    
    try {
      // Get token status
      const analysis = await this.analyzeToken(mintPublicKey);
      
      if (!analysis.success) {
        throw new Error('Failed to analyze token');
      }
      
      if (analysis.status !== 'both') {
        return {
          success: true,
          tokenMint: mintPublicKey.toString(),
          status: analysis.status,
          message: `Token is only on ${analysis.status === 'pump_fun' ? 'Pump.fun' : 'Pump.swap'}, not both platforms`
        };
      }
      
      // Compare bonding curve and AMM prices
      const priceDifference = analysis.poolData.currentPrice - analysis.curveData.currentPrice;
      const priceDifferencePercent = (priceDifference / analysis.curveData.currentPrice) * 100;
      
      // Calculate arbitrage opportunities
      const arbitrageOpportunity = Math.abs(priceDifferencePercent) > 1;
      
      // Calculate liquidity depth on AMM
      const slippageAnalysis = await this._analyzePoolSlippage(mintPublicKey, analysis.poolData);
      
      return {
        success: true,
        tokenMint: mintPublicKey.toString(),
        status: analysis.status,
        name: analysis.name,
        symbol: analysis.symbol,
        curvePrice: analysis.curveData.currentPrice,
        poolPrice: analysis.poolData.currentPrice,
        priceDifference,
        priceDifferencePercent,
        arbitrageOpportunity,
        recommendedAction: priceDifferencePercent > 1 ? 'buy_curve_sell_amm' : 
                            priceDifferencePercent < -1 ? 'buy_amm_sell_curve' : 'no_action',
        slippageAnalysis,
        poolData: analysis.poolData,
        curveData: analysis.curveData
      };
    } catch (error) {
      console.error(chalk.red(`Error analyzing token liquidity: ${error.message}`));
      return {
        success: false,
        tokenMint: mintPublicKey.toString(),
        error: error.message
      };
    }
  }

  /**
   * Check if token has migrated to liquidity pools
   * 
   * @param {string|PublicKey} tokenMint - Token mint address
   * @returns {Object} Migration status
   */
  async checkMigrationStatus(tokenMint) {
    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    
    try {
      // Get token status
      const analysis = await this.analyzeToken(mintPublicKey);
      
      if (!analysis.success) {
        throw new Error('Failed to analyze token');
      }
      
      // Check migration criteria
      // Pump.fun tokens migrate to AMM after 79 SOL and 200M tokens
      const migrationEligible = analysis.curveData && 
                                analysis.curveData.reserveBalance >= 79 &&
                                analysis.curveData.currentSupply >= 200000000;
      
      // Check if already migrated
      const migrated = analysis.status === 'both' || analysis.status === 'pump_swap';
      
      // Check if migration is imminent
      const migrationImminent = migrationEligible && !migrated && 
                                analysis.curveData.reserveBalance >= 75; // Close to 79 SOL threshold
      
      return {
        success: true,
        tokenMint: mintPublicKey.toString(),
        name: analysis.name,
        symbol: analysis.symbol,
        status: analysis.status,
        migrationEligible,
        migrated,
        migrationImminent,
        curveData: analysis.curveData,
        poolData: analysis.poolData,
        migrationThresholds: {
          minReserve: 79, // SOL
          minSupply: 200000000 // Tokens
        },
        reserveProgress: analysis.curveData ? 
                         (analysis.curveData.reserveBalance / 79) * 100 : 0,
        supplyProgress: analysis.curveData ? 
                        (analysis.curveData.currentSupply / 200000000) * 100 : 0
      };
    } catch (error) {
      console.error(chalk.red(`Error checking migration status: ${error.message}`));
      return {
        success: false,
        tokenMint: mintPublicKey.toString(),
        error: error.message
      };
    }
  }

  // ---------------------------
  // Private implementation methods
  // ---------------------------

  /**
   * Check if token has transactions with Pump.fun program
   */
  async _checkPumpFunTransactions(tokenMint) {
    try {
      // Get recent signatures
      const signatures = await this.connection.getSignaturesForAddress(
        tokenMint,
        { limit: 10 }
      );
      
      if (signatures.length === 0) {
        return { found: false };
      }
      
      // Check if any transactions involve the Pump.fun program
      let found = false;
      let lastTransactionTime = 0;
      
      for (const sig of signatures) {
        const tx = await this.connection.getTransaction(sig.signature);
        if (tx && tx.transaction.message.accountKeys.some(key => 
            key.equals(this.pumpFunProgram))) {
          found = true;
          lastTransactionTime = Math.max(lastTransactionTime, tx.blockTime || 0);
        }
      }
      
      return { found, lastTransactionTime };
    } catch (error) {
      console.error(chalk.red(`Error checking Pump.fun transactions: ${error.message}`));
      return { found: false };
    }
  }

  /**
   * Check if token has transactions with Pump.swap program
   */
  async _checkPumpSwapTransactions(tokenMint) {
    try {
      // Get recent signatures
      const signatures = await this.connection.getSignaturesForAddress(
        tokenMint,
        { limit: 10 }
      );
      
      if (signatures.length === 0) {
        return { found: false };
      }
      
      // Check if any transactions involve the Pump.swap program
      let found = false;
      let lastTransactionTime = 0;
      
      for (const sig of signatures) {
        const tx = await this.connection.getTransaction(sig.signature);
        if (tx && tx.transaction.message.accountKeys.some(key => 
            key.equals(this.pumpSwapProgram))) {
          found = true;
          lastTransactionTime = Math.max(lastTransactionTime, tx.blockTime || 0);
        }
      }
      
      return { found, lastTransactionTime };
    } catch (error) {
      console.error(chalk.red(`Error checking Pump.swap transactions: ${error.message}`));
      return { found: false };
    }
  }

  /**
   * Get token metadata
   */
  async _getTokenMetadata(tokenMint) {
    try {
      // This would need to use Metaplex to get actual token metadata
      // For demonstration, returning placeholder data
      return {
        name: `Token ${tokenMint.toString().substring(0, 4)}`,
        symbol: `T${tokenMint.toString().substring(0, 3)}`,
        decimals: 9
      };
    } catch (error) {
      console.error(chalk.red(`Error getting token metadata: ${error.message}`));
      return { name: 'Unknown', symbol: 'UNKNOWN', decimals: 9 };
    }
  }

  /**
   * Determine token status based on presence on platforms
   */
  _determineTokenStatus(pumpFunInfo, pumpSwapInfo) {
    if (pumpFunInfo.found && pumpSwapInfo.found) {
      return 'both';
    } else if (pumpFunInfo.found) {
      return 'pump_fun';
    } else if (pumpSwapInfo.found) {
      return 'pump_swap';
    } else {
      return 'unknown';
    }
  }

  /**
   * Get pool data for a token on Pump.swap
   */
  async _getPoolData(tokenMint) {
    // This is a simplified implementation
    // In reality, we'd need to fetch the actual pool data from on-chain
    // For demonstration, returning simulated data
    return {
      currentPrice: 0.00012, // SOL per token
      tokenReserve: 100000000,
      solReserve: 12,
      fee: 0.3, // 0.3% fee
      volume24h: 5, // SOL
      tvl: 24 // SOL
    };
  }

  /**
   * Analyze slippage for different trade sizes on an AMM pool
   */
  async _analyzePoolSlippage(tokenMint, poolData) {
    // Calculate slippage for various trade sizes
    const tradeAmounts = [0.1, 0.5, 1, 5, 10]; // SOL
    const slippageResults = [];
    
    for (const amount of tradeAmounts) {
      // Using constant product formula: x * y = k
      const k = poolData.tokenReserve * poolData.solReserve;
      const newSolReserve = poolData.solReserve + amount;
      const newTokenReserve = k / newSolReserve;
      const tokensReceived = poolData.tokenReserve - newTokenReserve;
      
      // Calculate average price and slippage
      const spotPrice = poolData.currentPrice;
      const avgPrice = amount / tokensReceived;
      const slippage = ((avgPrice / spotPrice) - 1) * 100;
      
      slippageResults.push({
        tradeAmount: amount,
        tokensReceived,
        avgPrice,
        slippagePercent: slippage
      });
    }
    
    return slippageResults;
  }
}

export default PumpSwapAnalyzer;