#!/usr/bin/env node
/**
 * Pump.fun token curve visualization tool
 * 
 * This tool generates a visualization of Pump.fun bonding curves
 * for one or more token mint addresses.
 * 
 * Usage: node visualize-tokens.js <token1> <token2> ... <tokenN>
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import open from 'open';
import CurveAnalyzer from './src/curve-analyzer.js';

// Create CLI program
const program = new Command();

program
  .name('visualize-tokens')
  .description('Generate visualizations of Pump.fun bonding curves')
  .version('1.0.0')
  .argument('[tokens...]', 'One or more token mint addresses to analyze')
  .option('-f, --file <path>', 'Path to a file containing token addresses (one per line)')
  .option('-o, --output <dir>', 'Output directory for visualization files', './data/pump-analytics')
  .option('-c, --compare', 'Compare all tokens and their curve formulas', false)
  .option('-n, --no-open', 'Do not automatically open the visualization in browser')
  .option('-d, --data-points <number>', 'Number of data points to generate for each curve', '100')
  .action(async (tokens, options) => {
    console.log(chalk.cyan('Pump.fun Bonding Curve Analyzer'));
    console.log(chalk.gray('-----------------------------------'));

    let tokenList = tokens || [];
    
    // Check if file option is provided
    if (options.file) {
      try {
        const fileContent = fs.readFileSync(options.file, 'utf8');
        const tokensFromFile = fileContent.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        
        tokenList = [...tokenList, ...tokensFromFile];
      } catch (error) {
        console.error(chalk.red(`Error reading token file: ${error.message}`));
        process.exit(1);
      }
    }
    
    // Validate that we have at least one token
    if (tokenList.length === 0) {
      console.error(chalk.red('Error: No token addresses provided. Use arguments or --file option.'));
      program.help();
      process.exit(1);
    }

    // Create output directory if it doesn't exist
    try {
      fs.mkdirSync(options.output, { recursive: true });
    } catch (error) {
      console.error(chalk.red(`Error creating output directory: ${error.message}`));
      process.exit(1);
    }
    
    // Display the tokens we're analyzing
    console.log(chalk.green(`Analyzing ${tokenList.length} tokens:`));
    tokenList.forEach((token, i) => {
      console.log(chalk.gray(`${i + 1}. ${token}`));
    });
    
    // Create analyzer
    const analyzer = new CurveAnalyzer({
      dataDir: options.output
    });
    
    // Start spinner
    const spinner = ora('Analyzing token data...').start();
    
    try {
      // Generate visualization
      const htmlPath = await analyzer.generateVisualization(tokenList);
      spinner.succeed(`Generated visualization: ${htmlPath}`);
      
      // If compare option is true, analyze formulas
      if (options.compare && tokenList.length > 1) {
        spinner.text = 'Comparing token curves...';
        spinner.start();
        
        const comparison = await analyzer.compareTokens(tokenList);
        
        if (comparison.success) {
          spinner.succeed('Curve comparison complete');
          
          if (comparison.comparison.formulaConsistency) {
            console.log(chalk.green('All tokens appear to use the same curve formula:'));
            console.log(chalk.cyan(comparison.comparison.generalFormula.description));
          } else {
            console.log(chalk.yellow('Tokens appear to use different curve formulas.'));
          }
          
          // Display parameters
          console.log(chalk.gray('\nCurve Parameters:'));
          comparison.comparison.curveParameters.forEach(param => {
            console.log(chalk.gray(`- ${param.mint.substring(0, 8)}...: k=${param.k.toFixed(6)}, n=${param.n.toFixed(6)}`));
          });
        } else {
          spinner.fail('Failed to complete curve comparison');
        }
      }
      
      // Open the visualization in browser if not disabled
      if (options.open !== false) {
        await open(`file://${htmlPath}`);
        console.log(chalk.green('Opened visualization in browser'));
      }
      
      // Calculate impact data
      spinner.text = 'Calculating price impacts...';
      spinner.start();
      
      // Show impact for the first token
      const impactData = await analyzer.calculatePriceImpacts(tokenList[0]);
      
      if (impactData.success) {
        spinner.succeed('Price impact calculations complete');
        
        console.log(chalk.gray('\nPrice Impacts for Different Buy Sizes:'));
        console.log(chalk.cyan(`Token: ${impactData.tokenMint.substring(0, 8)}...`));
        console.log(chalk.cyan(`Current Price: ${impactData.currentPrice.toFixed(8)} SOL`));
        
        impactData.impacts.forEach(impact => {
          console.log(chalk.gray(`- ${impact.solAmount} SOL: ${impact.priceImpactPercent.toFixed(2)}% impact, avg price ${impact.averagePrice.toFixed(8)} SOL`));
        });
      } else {
        spinner.fail('Failed to calculate price impacts');
      }
      
      // If there's only one token, create a selling schedule
      if (tokenList.length === 1) {
        spinner.text = 'Creating optimal selling schedule...';
        spinner.start();
        
        const schedule = await analyzer.createSellingSchedule(tokenList[0], 1000000, 7, 50);
        
        if (schedule.success) {
          spinner.succeed('Selling schedule created');
          
          console.log(chalk.gray('\nOptimal Selling Schedule:'));
          console.log(chalk.cyan(`Token: ${schedule.tokenMint.substring(0, 8)}...`));
          console.log(chalk.cyan(`Total Tokens: ${schedule.totalTokens.toLocaleString()}`));
          console.log(chalk.cyan(`Estimated SOL: ${schedule.totalSolEstimate.toFixed(4)} SOL`));
          console.log(chalk.cyan(`Average Price Impact: ${schedule.averagePriceImpact.toFixed(2)}%`));
          
          console.log(chalk.gray('\nDaily Schedule:'));
          schedule.schedule.slice(0, 5).forEach((day) => {
            console.log(chalk.gray(`- Day ${day.day}: ${day.tokenAmount.toLocaleString()} tokens, ${day.estimatedSol.toFixed(4)} SOL, ${day.priceImpactPercent.toFixed(2)}% impact`));
          });
          
          if (schedule.schedule.length > 5) {
            console.log(chalk.gray(`  ... and ${schedule.schedule.length - 5} more days`));
          }
        } else {
          spinner.fail('Failed to create selling schedule');
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