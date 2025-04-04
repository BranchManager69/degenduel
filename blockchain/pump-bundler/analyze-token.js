#!/usr/bin/env node
/**
 * Pump.fun/Pump.swap token analyzer CLI
 * 
 * This tool analyzes tokens on Pump.fun and Pump.swap platforms,
 * checking their status, pricing, and migration eligibility.
 * 
 * Usage: node analyze-token.js <token> [options]
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import PumpSwapAnalyzer from './src/pump-swap-analyzer.js';

// Create CLI program
const program = new Command();

program
  .name('analyze-token')
  .description('Analyze tokens on Pump.fun and Pump.swap platforms')
  .version('1.0.0')
  .argument('<token>', 'Token mint address to analyze')
  .option('-l, --liquidity', 'Analyze liquidity and arbitrage opportunities')
  .option('-m, --migration', 'Check migration status and eligibility')
  .option('-a, --all', 'Show all analysis (liquidity and migration)')
  .action(async (token, options) => {
    console.log(chalk.cyan('Pump.fun/Pump.swap Token Analyzer'));
    console.log(chalk.gray('-----------------------------------'));
    
    // Create analyzer
    const analyzer = new PumpSwapAnalyzer();
    
    // Start spinner
    const spinner = ora('Analyzing token...').start();
    
    try {
      // Basic token analysis
      const analysis = await analyzer.analyzeToken(token);
      
      if (!analysis.success) {
        spinner.fail(`Error analyzing token: ${analysis.error}`);
        process.exit(1);
      }
      
      spinner.succeed('Token analysis complete');
      
      // Display basic info
      console.log('\n' + chalk.cyan('Token Information:'));
      console.log(chalk.gray(`Mint: ${analysis.tokenMint}`));
      console.log(chalk.gray(`Name: ${analysis.name}`));
      console.log(chalk.gray(`Symbol: ${analysis.symbol}`));
      
      // Platform status
      console.log('\n' + chalk.cyan('Platform Status:'));
      
      let statusColor;
      let statusText;
      
      switch (analysis.status) {
        case 'pump_fun':
          statusColor = chalk.green;
          statusText = 'Pump.fun only (Bonding Curve)';
          break;
        case 'pump_swap':
          statusColor = chalk.blue;
          statusText = 'Pump.swap only (AMM)';
          break;
        case 'both':
          statusColor = chalk.magenta;
          statusText = 'Available on both Pump.fun and Pump.swap';
          break;
        default:
          statusColor = chalk.red;
          statusText = 'Not found on either platform';
      }
      
      console.log(statusColor(`Status: ${statusText}`));
      
      // Display curve data if available
      if (analysis.curveData) {
        console.log('\n' + chalk.cyan('Bonding Curve Data:'));
        console.log(chalk.gray(`Current Price: ${analysis.curveData.currentPrice.toFixed(8)} SOL`));
        console.log(chalk.gray(`Current Supply: ${analysis.curveData.currentSupply.toLocaleString()} tokens`));
        console.log(chalk.gray(`Reserve Balance: ${analysis.curveData.reserveBalance.toFixed(4)} SOL`));
      }
      
      // Display pool data if available
      if (analysis.poolData) {
        console.log('\n' + chalk.cyan('AMM Pool Data:'));
        console.log(chalk.gray(`Current Price: ${analysis.poolData.currentPrice.toFixed(8)} SOL`));
        console.log(chalk.gray(`Token Reserve: ${analysis.poolData.tokenReserve.toLocaleString()} tokens`));
        console.log(chalk.gray(`SOL Reserve: ${analysis.poolData.solReserve.toFixed(4)} SOL`));
        console.log(chalk.gray(`24h Volume: ${analysis.poolData.volume24h.toFixed(2)} SOL`));
        console.log(chalk.gray(`TVL: ${analysis.poolData.tvl.toFixed(2)} SOL`));
      }
      
      // Liquidity analysis
      if (options.liquidity || options.all) {
        spinner.text = 'Analyzing liquidity...';
        spinner.start();
        
        const liquidityAnalysis = await analyzer.analyzeTokenLiquidity(token);
        
        if (liquidityAnalysis.success) {
          spinner.succeed('Liquidity analysis complete');
          
          if (liquidityAnalysis.status === 'both') {
            console.log('\n' + chalk.cyan('Price Comparison:'));
            console.log(chalk.gray(`Curve Price: ${liquidityAnalysis.curvePrice.toFixed(8)} SOL`));
            console.log(chalk.gray(`Pool Price: ${liquidityAnalysis.poolPrice.toFixed(8)} SOL`));
            console.log(chalk.gray(`Difference: ${liquidityAnalysis.priceDifferencePercent.toFixed(2)}%`));
            
            // Arbitrage opportunity
            if (liquidityAnalysis.arbitrageOpportunity) {
              console.log('\n' + chalk.yellow('Arbitrage Opportunity Detected!'));
              
              if (liquidityAnalysis.recommendedAction === 'buy_curve_sell_amm') {
                console.log(chalk.gray('Recommended Action: Buy on Pump.fun, Sell on Pump.swap'));
              } else if (liquidityAnalysis.recommendedAction === 'buy_amm_sell_curve') {
                console.log(chalk.gray('Recommended Action: Buy on Pump.swap, Sell on Pump.fun'));
              }
            } else {
              console.log('\n' + chalk.gray('No significant arbitrage opportunity detected'));
            }
            
            // Display slippage analysis
            console.log('\n' + chalk.cyan('AMM Slippage Analysis:'));
            liquidityAnalysis.slippageAnalysis.forEach(slippage => {
              console.log(chalk.gray(`- ${slippage.tradeAmount} SOL: ${slippage.slippagePercent.toFixed(2)}% slippage, avg price ${slippage.avgPrice.toFixed(8)} SOL`));
            });
          } else {
            console.log('\n' + chalk.gray(`Liquidity analysis not applicable: Token is only on ${liquidityAnalysis.status === 'pump_fun' ? 'Pump.fun' : 'Pump.swap'}`));
          }
        } else {
          spinner.fail(`Error analyzing liquidity: ${liquidityAnalysis.error}`);
        }
      }
      
      // Migration analysis
      if (options.migration || options.all) {
        spinner.text = 'Checking migration status...';
        spinner.start();
        
        const migrationStatus = await analyzer.checkMigrationStatus(token);
        
        if (migrationStatus.success) {
          spinner.succeed('Migration status check complete');
          
          console.log('\n' + chalk.cyan('Migration Status:'));
          console.log(chalk.gray(`Migrated: ${migrationStatus.migrated ? 'Yes' : 'No'}`));
          console.log(chalk.gray(`Migration Eligible: ${migrationStatus.migrationEligible ? 'Yes' : 'No'}`));
          
          if (migrationStatus.migrationImminent) {
            console.log(chalk.yellow('\nMigration is imminent! Token is close to meeting criteria.'));
          }
          
          console.log('\n' + chalk.cyan('Migration Progress:'));
          console.log(chalk.gray(`Reserve: ${migrationStatus.curveData ? migrationStatus.curveData.reserveBalance.toFixed(2) : '0'} / 79 SOL (${migrationStatus.reserveProgress.toFixed(2)}%)`));
          console.log(chalk.gray(`Supply: ${migrationStatus.curveData ? migrationStatus.curveData.currentSupply.toLocaleString() : '0'} / 200M tokens (${migrationStatus.supplyProgress.toFixed(2)}%)`));
        } else {
          spinner.fail(`Error checking migration status: ${migrationStatus.error}`);
        }
      }
      
    } catch (error) {
      spinner.fail(`Error: ${error.message}`);
      console.error(chalk.red(error.stack));
      process.exit(1);
    }
  });

// Run the program
program.parse(process.argv);