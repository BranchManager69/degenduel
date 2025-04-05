import { Command } from 'commander';
import chalk from 'chalk';
import ui from '../../core/ui.js';
import { setupKeypress } from '../../core/keypress.js';
import { monitorLiquidityPool, listLiquidityPools } from './lp-monitor.js';

// Module description - used by the interactive menu
export const description = 'Monitor Pump.fun liquidity pools on Solana';

/**
 * Register all commands for the liquidity pool monitor module
 * @param {import('commander').Command} program Commander program instance
 */
export function registerCommands(program) {
  const lpCommand = new Command('lp')
    .description('Liquidity pool monitoring tools');
  
  // Add monitor subcommand
  lpCommand
    .command('monitor')
    .description('Monitor a Pump.fun liquidity pool')
    .argument('<address>', 'Liquidity pool address to monitor')
    .option('-i, --interval <seconds>', 'Polling interval in seconds', '15')
    .option('-c, --change-threshold <percent>', 'Minimum change threshold to highlight (in percent)', '1.0')
    .action((address, options) => {
      const interval = parseInt(options.interval, 10) * 1000;
      const changeThreshold = parseFloat(options.changeThreshold);
      
      ui.header(`Liquidity Pool Monitor: ${chalk.green(address)}`);
      ui.message(`Monitoring LP with address: ${address}`);  
      ui.message(`Polling every ${options.interval} seconds`);
      ui.message(`Change threshold: ${changeThreshold}%`);
      ui.message(`Press ${chalk.bold('Ctrl+C')} to exit`, 'info');
      console.log('');
      
      // Start monitoring with real data
      monitorLiquidityPool(address, { interval, changeThreshold });
      
      // Setup keypress handler for interactive control
      setupKeypress({
        onKeyPress: (str, key) => {
          // Additional key handlers can be added here
        }
      });
    });
    
  // Add list subcommand
  lpCommand
    .command('list')
    .description('List active Pump.fun liquidity pools')
    .option('-c, --count <number>', 'Number of pools to display', '10')
    .action((options) => {
      const count = parseInt(options.count, 10);
      
      ui.header(`Active Pump.fun Liquidity Pools`);
      ui.message(`Fetching top ${count} liquidity pools by volume...`);
      
      // Fetch and display real liquidity pools
      listLiquidityPools(count);
    });
  
  // Register the lp command to the main program
  program.addCommand(lpCommand);
}