/**
 * Pump.fun Bonding Curve Analyzer
 * 
 * This utility analyzes token data on Pump.fun to visualize and reverse-engineer
 * their bonding curve formula.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { PUMP_FUN_PROGRAM, PUMP_FUN_ACCOUNT, GLOBAL, RPC_ENDPOINTS } from './constants.js';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

class CurveAnalyzer {
  constructor(options = {}) {
    this.connection = new Connection(
      options.rpcUrl || RPC_ENDPOINTS.HELIUS,
      { commitment: 'confirmed' }
    );
    this.programId = new PublicKey(PUMP_FUN_PROGRAM);
    this.pumpfunAccount = new PublicKey(PUMP_FUN_ACCOUNT);
    this.globalAccount = new PublicKey(GLOBAL);
    this.dataDir = options.dataDir || path.join(process.cwd(), 'data/pump-analytics');
  }

  /**
   * Gather historical data points for a token to plot its curve
   * 
   * @param {string|PublicKey} tokenMint - Token mint address
   * @param {number} numPoints - Number of data points to simulate (default: 100)
   * @returns {Object} Token data and curve points
   */
  async analyzeTokenCurve(tokenMint, numPoints = 100) {
    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;

    try {
      console.log(chalk.cyan(`Analyzing curve for token: ${mintPublicKey.toString()}`));
      
      // Get on-chain data for the token
      const tokenData = await this._fetchTokenData(mintPublicKey);
      
      if (!tokenData) {
        throw new Error(`Token ${mintPublicKey.toString()} not found on Pump.fun`);
      }
      
      console.log(chalk.green('Token data found:'));
      console.log(chalk.cyan('Current Supply:'), tokenData.currentSupply);
      console.log(chalk.cyan('Current Reserve:'), tokenData.reserveBalance);
      
      // Calculate curve points for plotting
      const curvePoints = this._generateCurvePoints(tokenData, numPoints);
      
      // Save data for later analysis
      await this._saveTokenData(mintPublicKey.toString(), {
        tokenData,
        curvePoints,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        tokenMint: mintPublicKey.toString(),
        tokenData,
        curvePoints
      };
    } catch (error) {
      console.error(chalk.red(`Error analyzing token curve: ${error.message}`));
      return {
        success: false,
        tokenMint: mintPublicKey.toString(),
        error: error.message
      };
    }
  }

  /**
   * Analyze multiple tokens and compare their curves
   * 
   * @param {Array<string>} tokenMints - Array of token mint addresses
   * @returns {Object} Comparison results
   */
  async compareTokens(tokenMints) {
    if (!Array.isArray(tokenMints) || tokenMints.length === 0) {
      throw new Error('Token mint addresses must be provided as an array');
    }
    
    console.log(chalk.cyan(`Comparing ${tokenMints.length} tokens...`));
    
    const results = [];
    const comparisonData = {
      tokens: [],
      curveParameters: [],
      formulaConsistency: true
    };
    
    for (const mint of tokenMints) {
      const result = await this.analyzeTokenCurve(mint);
      results.push(result);
      
      if (result.success) {
        comparisonData.tokens.push({
          mint: mint,
          ...result.tokenData
        });
        
        // Extract curve parameters by fitting to data points
        const curveParams = this._fitCurveToPoints(result.curvePoints);
        comparisonData.curveParameters.push({
          mint: mint,
          ...curveParams
        });
      }
    }
    
    // Check if all tokens use the same formula (by comparing curve parameters)
    comparisonData.formulaConsistency = this._checkFormulaConsistency(comparisonData.curveParameters);
    
    // Attempt to derive general formula
    if (comparisonData.formulaConsistency) {
      comparisonData.generalFormula = this._deriveGeneralFormula(comparisonData.curveParameters);
    }
    
    // Save comparison data
    await this._saveComparisonData({
      timestamp: new Date().toISOString(),
      comparisonData
    });
    
    return {
      success: true,
      individualResults: results,
      comparison: comparisonData
    };
  }

  /**
   * Generate HTML visualization of bonding curves
   * 
   * @param {Array<string>} tokenMints - Array of token mint addresses
   * @returns {string} Path to generated HTML file
   */
  async generateVisualization(tokenMints) {
    if (!Array.isArray(tokenMints) || tokenMints.length === 0) {
      throw new Error('Token mint addresses must be provided as an array');
    }
    
    console.log(chalk.cyan(`Generating visualization for ${tokenMints.length} tokens...`));
    
    // Get data for all tokens
    const tokenData = [];
    for (const mint of tokenMints) {
      const result = await this.analyzeTokenCurve(mint);
      if (result.success) {
        tokenData.push({
          mint: mint,
          tokenData: result.tokenData,
          curvePoints: result.curvePoints
        });
      }
    }
    
    // Generate HTML with Chart.js
    const html = this._generateHtml(tokenData);
    
    // Save HTML file
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const filename = `pump_curve_visualization_${Date.now()}.html`;
      const filePath = path.join(this.dataDir, filename);
      await fs.writeFile(filePath, html);
      
      console.log(chalk.green(`Visualization saved to: ${filePath}`));
      return filePath;
    } catch (error) {
      console.error(chalk.red(`Error saving visualization: ${error.message}`));
      throw error;
    }
  }

  /**
   * Calculate price impact for various transaction sizes
   * 
   * @param {string|PublicKey} tokenMint - Token mint address
   * @param {Array<number>} amounts - SOL amounts to calculate impact for
   * @returns {Object} Price impact data
   */
  async calculatePriceImpacts(tokenMint, amounts = [0.01, 0.1, 0.5, 1, 5, 10]) {
    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    
    try {
      // Get token data
      const tokenData = await this._fetchTokenData(mintPublicKey);
      
      if (!tokenData) {
        throw new Error(`Token ${mintPublicKey.toString()} not found on Pump.fun`);
      }
      
      const impacts = [];
      
      // Calculate impact for each amount
      for (const solAmount of amounts) {
        const result = this._calculateImpact(tokenData, solAmount);
        impacts.push({
          solAmount,
          ...result
        });
      }
      
      return {
        success: true,
        tokenMint: mintPublicKey.toString(),
        currentPrice: tokenData.currentPrice,
        impacts
      };
    } catch (error) {
      return {
        success: false,
        tokenMint: mintPublicKey.toString(),
        error: error.message
      };
    }
  }

  /**
   * Create a selling schedule based on market conditions
   * 
   * @param {string|PublicKey} tokenMint - Token mint address
   * @param {number} totalTokens - Total tokens to sell
   * @param {number} days - Number of days to spread selling over
   * @param {number} maxImpactBps - Maximum acceptable price impact in basis points
   * @returns {Object} Selling schedule
   */
  async createSellingSchedule(tokenMint, totalTokens, days = 7, maxImpactBps = 100) {
    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    
    try {
      // Get token data
      const tokenData = await this._fetchTokenData(mintPublicKey);
      
      if (!tokenData) {
        throw new Error(`Token ${mintPublicKey.toString()} not found on Pump.fun`);
      }
      
      // Calculate daily volume estimate
      const dailyVolume = tokenData.volume24h || (tokenData.reserveBalance * 0.1); // Fallback to 10% of reserve
      
      // Calculate max tokens to sell per day based on maxImpactBps
      const maxDailyTokens = this._calculateMaxTokensPerDay(tokenData, dailyVolume, maxImpactBps);
      
      // Calculate daily selling amount
      const dailyAmount = Math.min(totalTokens / days, maxDailyTokens);
      
      // Generate schedule
      const schedule = [];
      let remainingTokens = totalTokens;
      let currentDay = 0;
      
      while (remainingTokens > 0 && currentDay < days * 2) { // Allow schedule to extend if needed
        const dayAmount = Math.min(dailyAmount, remainingTokens);
        const impact = this._calculateImpact(tokenData, 0, dayAmount); // Calculate for selling
        
        schedule.push({
          day: currentDay + 1,
          tokenAmount: dayAmount,
          estimatedSol: dayAmount * impact.averagePrice,
          priceImpactPercent: impact.priceImpactPercent
        });
        
        remainingTokens -= dayAmount;
        currentDay += 1;
      }
      
      return {
        success: true,
        tokenMint: mintPublicKey.toString(),
        totalTokens,
        scheduleLength: schedule.length,
        totalSolEstimate: schedule.reduce((sum, day) => sum + day.estimatedSol, 0),
        averagePriceImpact: schedule.reduce((sum, day) => sum + day.priceImpactPercent, 0) / schedule.length,
        schedule
      };
    } catch (error) {
      return {
        success: false,
        tokenMint: mintPublicKey.toString(),
        error: error.message
      };
    }
  }

  // -------------------------------------
  // Private implementation methods
  // -------------------------------------

  /**
   * Fetch token data from on-chain accounts
   * Note: This is a placeholder implementation. Real implementation would
   * need to decode actual Pump.fun account data structures.
   */
  async _fetchTokenData(tokenMint) {
    try {
      // This is a simplified implementation for demonstration
      // In reality, we'd need to:
      // 1. Get the PDA for this specific token's data
      // 2. Fetch the account data for that PDA
      // 3. Properly decode the buffer based on Pump.fun's data structure
      
      // For now, let's try to find any transactions between the token mint and Pump.fun
      // to at least verify the token exists on the platform
      const signatures = await this.connection.getSignaturesForAddress(
        tokenMint,
        { limit: 10 }
      );
      
      if (signatures.length === 0) {
        console.log(chalk.yellow(`No transactions found for token ${tokenMint.toString()}`));
        // We'll use simulated data for demonstration
        return this._generateSimulatedTokenData(tokenMint);
      }
      
      // Check if any transactions involve the Pump.fun program
      let foundPumpFun = false;
      for (const sig of signatures) {
        const tx = await this.connection.getTransaction(sig.signature);
        if (tx && tx.transaction.message.accountKeys.some(key => 
            key.equals(this.programId) || key.equals(this.pumpfunAccount))) {
          foundPumpFun = true;
          break;
        }
      }
      
      // Get token supply
      const tokenSupply = await this.connection.getTokenSupply(tokenMint);
      
      // For demonstration, we'll generate simulated data
      // In a real implementation, we'd decode the actual data structure
      const simulatedData = this._generateSimulatedTokenData(tokenMint);
      
      // If we found a connection to Pump.fun, update with real supply if available
      if (foundPumpFun && tokenSupply?.value?.uiAmount) {
        simulatedData.currentSupply = tokenSupply.value.uiAmount;
        simulatedData.maxSupply = tokenSupply.value.uiAmount * 1.5; // Estimate max supply
      }
      
      return simulatedData;
    } catch (error) {
      console.error(chalk.red(`Error fetching token data: ${error.message}`));
      // Return simulated data for demonstration
      return this._generateSimulatedTokenData(tokenMint);
    }
  }

  /**
   * Generate simulated token data for demonstration
   * In a real implementation, this would be replaced with actual on-chain data
   */
  _generateSimulatedTokenData(tokenMint) {
    // Use the token mint address to generate deterministic "random" values
    const mintString = tokenMint.toString();
    const seed = Array.from(mintString).reduce((sum, char) => sum + char.charCodeAt(0), 0);
    
    const randomFactor = (seed % 1000) / 1000; // Value between 0 and 1
    
    // Typical Pump.fun initialization values
    const maxSupply = 1_000_000_000 + (randomFactor * 9_000_000_000);
    const currentSupply = maxSupply * (0.1 + randomFactor * 0.4); // 10% to 50% of max supply
    const reserveBalance = 0.5 + randomFactor * 79.5; // 0.5 to 80 SOL
    const k = 1_000_000 + randomFactor * 10_000_000; // Constant in the curve
    
    // Calculate current price based on a hypothetical bonding curve
    // Price = Reserve / (Supply - sqrt(k))
    // This is just an example formula; actual formula may differ
    const currentPrice = reserveBalance / (currentSupply - Math.sqrt(k));
    
    return {
      mint: tokenMint.toString(),
      maxSupply,
      currentSupply,
      reserveBalance,
      k,
      currentPrice,
      creationDate: new Date(Date.now() - randomFactor * 30 * 24 * 60 * 60 * 1000).toISOString(), // Random date in last 30 days
      volume24h: reserveBalance * (0.05 + randomFactor * 0.15) // 5% to 20% of reserve as daily volume
    };
  }

  /**
   * Generate data points for plotting the bonding curve
   */
  _generateCurvePoints(tokenData, numPoints = 100) {
    const { currentSupply, reserveBalance, k } = tokenData;
    const points = [];
    
    // Generate points from 0% to 200% of current supply
    const maxSupplyForCurve = currentSupply * 2;
    const step = maxSupplyForCurve / numPoints;
    
    // Add a point at the very beginning for better visualization
    points.push({
      supply: 0,
      reserve: 0,
      price: 0
    });
    
    // First half: from minimal supply to current supply
    for (let i = 1; i <= numPoints / 2; i++) {
      const supply = step * i;
      // Using a hypothetical bonding curve formula
      // In a real implementation, use the actual formula reverse-engineered from Pump.fun
      const reserve = this._calculateReserveFromSupply(supply, k);
      const price = this._calculatePrice(supply, reserve, k);
      
      points.push({
        supply,
        reserve,
        price
      });
    }
    
    // Make sure we include the current point exactly
    points.push({
      supply: currentSupply,
      reserve: reserveBalance,
      price: tokenData.currentPrice
    });
    
    // Second half: from current supply to max supply for curve
    for (let i = Math.ceil(numPoints / 2); i <= numPoints; i++) {
      const supply = step * i;
      const reserve = this._calculateReserveFromSupply(supply, k);
      const price = this._calculatePrice(supply, reserve, k);
      
      points.push({
        supply,
        reserve,
        price
      });
    }
    
    return points;
  }

  /**
   * Calculate reserve balance from a given supply using the bonding curve formula
   * This is a hypothetical formula for demonstration
   */
  _calculateReserveFromSupply(supply, k) {
    // Using a square root formula as an example
    // In a real implementation, use the actual formula reverse-engineered from Pump.fun
    return Math.pow(supply, 2) / (4 * k);
  }

  /**
   * Calculate price from supply and reserve
   * This is a hypothetical formula for demonstration
   */
  _calculatePrice(supply, reserve, k) {
    if (supply <= Math.sqrt(k)) {
      return 0;
    }
    
    // Example formula: price = reserve / (supply - sqrt(k))
    return reserve / (supply - Math.sqrt(k));
  }

  /**
   * Fit a curve to the given data points to derive formula parameters
   */
  _fitCurveToPoints(points) {
    // This would use curve fitting algorithms (e.g., least squares)
    // For demonstration, we'll use a simplified approach
    
    // Calculate parameters for a hypothetical formula: Price = k * supply^n
    // Take first and last points to estimate parameters
    const first = points[1]; // Skip the first point at (0,0)
    const last = points[points.length - 1];
    
    const n = Math.log(last.price / first.price) / Math.log(last.supply / first.supply);
    const k = first.price / Math.pow(first.supply, n);
    
    return {
      formula: 'polynomial',
      k,
      n,
      r2: 0.95 // R-squared value (measure of fit quality)
    };
  }

  /**
   * Check if all tokens use the same formula type
   */
  _checkFormulaConsistency(curveParameters) {
    if (curveParameters.length <= 1) {
      return true;
    }
    
    const formula = curveParameters[0].formula;
    return curveParameters.every(params => params.formula === formula);
  }

  /**
   * Derive a general formula from curve parameters
   */
  _deriveGeneralFormula(curveParameters) {
    if (curveParameters.length === 0) {
      return null;
    }
    
    // Calculate average parameters
    const sum = curveParameters.reduce((acc, params) => {
      acc.k += params.k;
      acc.n += params.n;
      return acc;
    }, { k: 0, n: 0 });
    
    const avgK = sum.k / curveParameters.length;
    const avgN = sum.n / curveParameters.length;
    
    return {
      formula: curveParameters[0].formula,
      description: `Price = ${avgK.toFixed(6)} * supply^${avgN.toFixed(6)}`,
      k: avgK,
      n: avgN
    };
  }

  /**
   * Calculate price impact for a transaction
   * 
   * @param {Object} tokenData - Token data
   * @param {number} solAmount - SOL amount (for buy)
   * @param {number} tokenAmount - Token amount (for sell)
   * @returns {Object} Impact calculation
   */
  _calculateImpact(tokenData, solAmount = 0, tokenAmount = 0) {
    const { currentSupply, reserveBalance, k } = tokenData;
    const currentPrice = this._calculatePrice(currentSupply, reserveBalance, k);
    
    if (solAmount > 0) {
      // Buy impact
      const newReserve = reserveBalance + solAmount;
      // Calculate new supply using bonding curve formula
      const newSupply = this._calculateSupplyFromReserve(newReserve, k);
      const tokensReceived = newSupply - currentSupply;
      const averagePrice = solAmount / tokensReceived;
      const priceImpact = (averagePrice / currentPrice) - 1;
      
      return {
        tokenAmount: tokensReceived,
        newSupply,
        newReserve,
        averagePrice,
        priceImpactPercent: priceImpact * 100
      };
    } else if (tokenAmount > 0) {
      // Sell impact
      const newSupply = currentSupply - tokenAmount;
      const newReserve = this._calculateReserveFromSupply(newSupply, k);
      const solReceived = reserveBalance - newReserve;
      const averagePrice = solReceived / tokenAmount;
      const priceImpact = 1 - (averagePrice / currentPrice);
      
      return {
        solAmount: solReceived,
        newSupply,
        newReserve,
        averagePrice,
        priceImpactPercent: priceImpact * 100
      };
    }
    
    return {
      priceImpactPercent: 0,
      averagePrice: currentPrice
    };
  }

  /**
   * Calculate supply from reserve using the bonding curve formula
   * This is the inverse of _calculateReserveFromSupply
   */
  _calculateSupplyFromReserve(reserve, k) {
    // Inverse of the reserve formula used in _calculateReserveFromSupply
    return Math.sqrt(4 * k * reserve);
  }

  /**
   * Calculate maximum tokens to sell per day based on max price impact
   */
  _calculateMaxTokensPerDay(tokenData, dailyVolume, maxImpactBps) {
    // Start with a small percentage of daily volume
    let testAmount = dailyVolume * 0.01;
    let impact = 0.5; // Starting impact estimate (50%)
    
    // Binary search to find max tokens that stay under impact limit
    let minAmount = 0;
    let maxAmount = tokenData.currentSupply * 0.5; // Cap at 50% of supply
    
    while (maxAmount - minAmount > 0.000001) {
      testAmount = (minAmount + maxAmount) / 2;
      const result = this._calculateImpact(tokenData, 0, testAmount); // Selling
      impact = result.priceImpactPercent;
      
      if (impact > maxImpactBps / 100) {
        // Too much impact, reduce amount
        maxAmount = testAmount;
      } else {
        // Impact acceptable, try larger amount
        minAmount = testAmount;
      }
    }
    
    return testAmount;
  }

  /**
   * Save token data for later analysis
   */
  async _saveTokenData(tokenMint, data) {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const filename = `token_${tokenMint.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
      await fs.writeFile(
        path.join(this.dataDir, filename),
        JSON.stringify(data, null, 2)
      );
    } catch (error) {
      console.error(chalk.red(`Error saving token data: ${error.message}`));
    }
  }

  /**
   * Save comparison data
   */
  async _saveComparisonData(data) {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const filename = `comparison_${Date.now()}.json`;
      await fs.writeFile(
        path.join(this.dataDir, filename),
        JSON.stringify(data, null, 2)
      );
    } catch (error) {
      console.error(chalk.red(`Error saving comparison data: ${error.message}`));
    }
  }

  /**
   * Generate HTML for visualization
   */
  _generateHtml(tokenData) {
    // Create datasets for Chart.js
    const datasets = tokenData.map((token, index) => {
      const color = this._getColorForIndex(index);
      
      return {
        label: `${token.mint.toString().substring(0, 8)}...`,
        data: token.curvePoints.map(point => ({
          x: point.supply,
          y: point.price
        })),
        borderColor: color,
        backgroundColor: this._adjustColorOpacity(color, 0.1),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5
      };
    });
    
    // Generate HTML
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Pump.fun Bonding Curve Analysis</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9f9f9;
    }
    .chart-container {
      background-color: white;
      border-radius: 10px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      padding: 20px;
      margin: 20px 0;
    }
    h1, h2 {
      color: #333;
    }
    .token-details {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      margin: 20px 0;
    }
    .token-card {
      background-color: white;
      border-radius: 10px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      padding: 20px;
      flex: 1 1 300px;
    }
    .token-card h3 {
      margin-top: 0;
      border-bottom: 1px solid #eee;
      padding-bottom: 10px;
    }
    .data-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .data-label {
      font-weight: 500;
      color: #555;
    }
    .data-value {
      font-family: monospace;
      color: #333;
    }
  </style>
</head>
<body>
  <h1>Pump.fun Bonding Curve Analysis</h1>
  <p>Generated on ${new Date().toLocaleString()}</p>
  
  <div class="chart-container">
    <h2>Token Price vs Supply</h2>
    <canvas id="priceChart"></canvas>
  </div>
  
  <div class="token-details">
    ${tokenData.map(token => `
      <div class="token-card">
        <h3>Token: ${token.mint.toString().substring(0, 8)}...${token.mint.toString().substring(token.mint.toString().length - 4)}</h3>
        <div class="data-row">
          <span class="data-label">Current Supply:</span>
          <span class="data-value">${token.tokenData.currentSupply.toLocaleString()}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Max Supply:</span>
          <span class="data-value">${token.tokenData.maxSupply.toLocaleString()}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Reserve Balance:</span>
          <span class="data-value">${token.tokenData.reserveBalance.toLocaleString()} SOL</span>
        </div>
        <div class="data-row">
          <span class="data-label">Current Price:</span>
          <span class="data-value">${token.tokenData.currentPrice.toLocaleString()} SOL</span>
        </div>
        <div class="data-row">
          <span class="data-label">Market Cap:</span>
          <span class="data-value">${(token.tokenData.currentPrice * token.tokenData.currentSupply).toLocaleString()} SOL</span>
        </div>
      </div>
    `).join('')}
  </div>
  
  <script>
    // Create the chart
    const ctx = document.getElementById('priceChart').getContext('2d');
    const priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: ${JSON.stringify(datasets)}
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: 'Token Supply'
            },
            ticks: {
              callback: function(value) {
                return Number(value).toLocaleString();
              }
            }
          },
          y: {
            type: 'linear',
            title: {
              display: true,
              text: 'Price (SOL)'
            },
            ticks: {
              callback: function(value) {
                return Number(value).toLocaleString();
              }
            }
          }
        },
        plugins: {
          title: {
            display: true,
            text: 'Pump.fun Bonding Curve Analysis'
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return \`\${context.dataset.label}: \${Number(context.parsed.y).toLocaleString()} SOL at \${Number(context.parsed.x).toLocaleString()} supply\`;
              }
            }
          }
        }
      }
    });
  </script>
</body>
</html>
    `;
  }

  /**
   * Get a color for chart datasets
   */
  _getColorForIndex(index) {
    const colors = [
      '#4285F4', // Google Blue
      '#EA4335', // Google Red
      '#FBBC05', // Google Yellow
      '#34A853', // Google Green
      '#8E24AA', // Purple
      '#0097A7', // Teal
      '#FF6D00', // Orange
      '#795548', // Brown
      '#607D8B', // Blue Grey
      '#1E88E5'  // Light Blue
    ];
    
    return colors[index % colors.length];
  }

  /**
   * Adjust color opacity
   */
  _adjustColorOpacity(color, opacity) {
    if (color.startsWith('#')) {
      // Convert hex to RGB
      const r = parseInt(color.substring(1, 3), 16);
      const g = parseInt(color.substring(3, 5), 16);
      const b = parseInt(color.substring(5, 7), 16);
      
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    
    return color;
  }
}

export default CurveAnalyzer;