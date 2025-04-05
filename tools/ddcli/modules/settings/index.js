import { Command } from 'commander';
import chalk from 'chalk';
import ui from '../../core/ui.js';
import settingsManager from '../../core/settings/settings-manager.js';

// Module description - used by the interactive menu
export const description = 'Configure DDCLI settings including RPC endpoints and wallets';

/**
 * Register all commands for the settings module
 * @param {import('commander').Command} program Commander program instance
 */
export function registerCommands(program) {
  const settingsCommand = new Command('settings')
    .description('Configure DDCLI settings');
  
  // Add menu subcommand
  settingsCommand
    .command('menu')
    .description('Open interactive settings menu')
    .action(() => {
      ui.header('DDCLI Settings');
      settingsManager.showSettingsMenu();
    });
  
  // RPC commands
  const rpcCommand = new Command('rpc')
    .description('Manage RPC endpoints');
  
  rpcCommand
    .command('list')
    .description('List available RPC endpoints')
    .action(() => {
      ui.header('RPC Endpoints');
      
      const endpoints = settingsManager.getRpcEndpoints();
      const activeRpcName = settingsManager.getActiveRpcName();
      
      // Color function - copied from settings-manager to keep consistency
      const colorRpcName = (name) => {
        // Premium endpoints
        if (name.startsWith('BranchRPC') || 
            name.includes('Staked') || 
            name.includes('Eclipse') || 
            name.includes('Geyser') ||
            name.includes('QuikNode')) {
          return chalk.green(name); // Green for premium high-performance endpoints
        }
        
        // Standard endpoints
        if (name.includes('Standard')) {
          return chalk.blue(name); // Blue for standard endpoints
        }
        
        // Public endpoints
        if (name.includes('Public')) {
          return chalk.yellow(name); // Yellow for public/free endpoints
        }
        
        // Devnet endpoints
        if (name.includes('Devnet')) {
          return chalk.magenta(name); // Magenta for dev/test endpoints
        }
        
        // Custom endpoints
        return chalk.cyan(name); // Cyan for custom endpoints
      };
      
      // Show legend
      console.log('');
      console.log(`${chalk.green('■')} Premium High-Performance Endpoints`);
      console.log(`${chalk.blue('■')} Standard Endpoints`);
      console.log(`${chalk.yellow('■')} Public Endpoints (Rate Limited)`);
      console.log(`${chalk.magenta('■')} Development/Test Endpoints`);
      console.log(`${chalk.cyan('■')} Custom Endpoints`);
      console.log('');
      
      // Create table data
      const tableData = endpoints.map(endpoint => [
        colorRpcName(endpoint.name),
        endpoint.name === activeRpcName ? chalk.green('✓') : '',
        endpoint.url
      ]);
      
      ui.table(['Name', 'Active', 'URL'], tableData);
    });
  
  rpcCommand
    .command('set')
    .description('Set active RPC endpoint')
    .argument('<name>', 'Name of the RPC endpoint')
    .action((name) => {
      if (settingsManager.setActiveRpc(name)) {
        ui.message(`Active RPC set to: ${chalk.green(name)}`, 'success');
      } else {
        ui.message(`RPC endpoint "${name}" not found.`, 'error');
        ui.message('Use "ddcli settings rpc list" to see available endpoints', 'info');
      }
    });
  
  rpcCommand
    .command('add')
    .description('Add a custom RPC endpoint')
    .argument('<name>', 'Name for the RPC endpoint')
    .argument('<url>', 'URL of the RPC endpoint')
    .action((name, url) => {
      settingsManager.addRpcEndpoint(name, url);
      ui.message(`Added RPC endpoint: ${chalk.green(name)}`, 'success');
    });
  
  rpcCommand
    .command('remove')
    .description('Remove a custom RPC endpoint')
    .argument('<name>', 'Name of the RPC endpoint to remove')
    .action((name) => {
      if (settingsManager.removeRpcEndpoint(name)) {
        ui.message(`Removed RPC endpoint: ${chalk.green(name)}`, 'success');
      } else {
        ui.message(`Cannot remove built-in RPC endpoint "${name}".`, 'error');
      }
    });
  
  rpcCommand
    .command('select')
    .description('Select RPC endpoint with an interactive menu')
    .action(() => {
      ui.header('Select RPC Endpoint');
      settingsManager.showRpcSelectionMenu();
    });
  
  settingsCommand.addCommand(rpcCommand);
  
  // Wallet commands
  const walletCommand = new Command('wallet')
    .description('Manage wallets');
  
  walletCommand
    .command('list')
    .description('List all available wallets')
    .action(() => {
      ui.header('All Available Wallets');
      
      const wallets = settingsManager.getWallets();
      const activeWalletName = settingsManager.getActiveWalletName();
      
      if (wallets.length === 0) {
        ui.message('No wallets found.', 'warning');
        ui.message('Import or create wallets using Solana CLI.', 'info');
        return;
      }
      
      // Function to color wallet category
      const colorCategory = (category) => {
        switch (category) {
          case 'private': return chalk.green(category.toUpperCase());
          case 'public': return chalk.yellow(category.toUpperCase());
          default: return chalk.blue(category.toUpperCase());
        }
      };
      
      // Create table data
      const tableData = wallets.map(wallet => [
        wallet.name === activeWalletName ? chalk.bold(wallet.name) : wallet.name,
        wallet.name === activeWalletName ? chalk.green('✓') : '',
        colorCategory(wallet.category),
        wallet.path
      ]);
      
      ui.table(['Name', 'Active', 'Type', 'Path'], tableData);
    });
    
  walletCommand
    .command('list-private')
    .description('List private trading wallets')
    .action(() => {
      ui.header('Private Trading Wallets');
      
      const wallets = settingsManager.getPrivateWallets();
      const activeWalletName = settingsManager.getActiveWalletName();
      
      if (wallets.length === 0) {
        ui.message('No private wallets found.', 'warning');
        ui.message('Private wallets are stored in the /addresses/keypairs/private directory.', 'info');
        return;
      }
      
      // Create table data
      const tableData = wallets.map(wallet => [
        wallet.name === activeWalletName ? chalk.bold(wallet.name) : wallet.name,
        wallet.name === activeWalletName ? chalk.green('✓') : '',
        wallet.path
      ]);
      
      ui.table(['Name', 'Active', 'Path'], tableData);
    });
    
  walletCommand
    .command('list-public')
    .description('List public treasury wallets (read-only)')
    .action(() => {
      ui.header('Public Treasury Wallets');
      
      const wallets = settingsManager.getPublicWallets();
      const activeWalletName = settingsManager.getActiveWalletName();
      
      if (wallets.length === 0) {
        ui.message('No public wallets found.', 'warning');
        ui.message('Public wallets are stored in the /addresses/keypairs/public directory.', 'info');
        return;
      }
      
      // Create table data
      const tableData = wallets.map(wallet => [
        wallet.name === activeWalletName ? chalk.bold(wallet.name) : wallet.name,
        wallet.name === activeWalletName ? chalk.green('✓') : '',
        wallet.path
      ]);
      
      ui.table(['Name', 'Active', 'Path'], tableData);
    });
  
  walletCommand
    .command('set')
    .description('Set active wallet')
    .argument('<name>', 'Name of the wallet')
    .action((name) => {
      if (settingsManager.setActiveWallet(name)) {
        ui.message(`Active wallet set to: ${chalk.green(name)}`, 'success');
      } else {
        ui.message(`Wallet "${name}" not found.`, 'error');
        ui.message('Use "ddcli settings wallet list" to see available wallets', 'info');
      }
    });
  
  walletCommand
    .command('refresh')
    .description('Refresh wallet list')
    .action(() => {
      ui.message('Refreshing wallet list...', 'info');
      settingsManager.refreshWallets();
      ui.message('Wallet list refreshed.', 'success');
    });
  
  walletCommand
    .command('select')
    .description('Select wallet with an interactive menu')
    .action(() => {
      ui.header('Select Wallet');
      settingsManager.showWalletSelectionMenu();
    });
  
  settingsCommand.addCommand(walletCommand);
  
  // Status command
  settingsCommand
    .command('status')
    .description('Show current settings status')
    .action(() => {
      ui.header('DDCLI Settings Status');
      
      const activeRpcName = settingsManager.getActiveRpcName();
      const activeRpcUrl = settingsManager.getActiveRpcUrl();
      const activeWalletName = settingsManager.getActiveWalletName() || 'None';
      const activeWalletPath = settingsManager.getActiveWalletPath() || 'None';
      const activeWalletCategory = settingsManager.getActiveWalletCategory() || 'None';
      
      // Color the RPC name based on its group
      let rpcColor = chalk.blue;
      if (activeRpcName.startsWith('BranchRPC') || 
          activeRpcName.includes('Staked') || 
          activeRpcName.includes('Eclipse') || 
          activeRpcName.includes('Geyser') ||
          activeRpcName.includes('QuikNode')) {
        rpcColor = chalk.green;
      } else if (activeRpcName.includes('Standard')) {
        rpcColor = chalk.blue;
      } else if (activeRpcName.includes('Public')) {
        rpcColor = chalk.yellow;
      } else if (activeRpcName.includes('Devnet')) {
        rpcColor = chalk.magenta;
      } else {
        rpcColor = chalk.cyan;
      }
      
      // Color the wallet name based on its category
      let walletColor = chalk.blue;
      let walletTypeText = '';
      if (activeWalletCategory === 'private') {
        walletColor = chalk.green;
        walletTypeText = chalk.green(' (PRIVATE - Trading)');
      } else if (activeWalletCategory === 'public') {
        walletColor = chalk.yellow;
        walletTypeText = chalk.yellow(' (PUBLIC - Treasury)');
      } else if (activeWalletName !== 'None') {
        walletTypeText = chalk.blue(' (OTHER)');
      }
      
      ui.box(
        `Active RPC: ${rpcColor(activeRpcName)}\n` +
        `URL: ${chalk.dim(activeRpcUrl)}\n\n` +
        `Active Wallet: ${walletColor(activeWalletName)}${walletTypeText}\n` +
        `Path: ${chalk.dim(activeWalletPath)}`,
        {
          padding: 1,
          borderColor: 'blue',
          borderStyle: 'round',
        }
      );
    });
  
  // Register the settings command to the main program
  program.addCommand(settingsCommand);
  
  // Initialize settings
  settingsManager.initialize();
}