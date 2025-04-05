import chalk from 'chalk';
import ora from 'ora';
import { createMenu } from '../menu.js';
import configStore from './config-store.js';
import ui from '../ui.js';

// Current configuration cache
let currentConfig = null;

/**
 * Initialize settings manager
 */
function initialize() {
  if (!currentConfig) {
    currentConfig = configStore.loadConfig();
    
    // Initial refresh of wallets
    refreshWallets(false); // Don't save config yet
  }
  return currentConfig;
}

/**
 * Refresh the wallet list
 * @param {boolean} save Whether to save the config after refreshing
 */
function refreshWallets(save = true) {
  const wallets = configStore.scanWallets();
  
  currentConfig = {
    ...currentConfig,
    wallets
  };
  
  // If active wallet is no longer valid, reset it
  if (currentConfig.activeWallet && !wallets[currentConfig.activeWallet]) {
    currentConfig.activeWallet = Object.keys(wallets)[0] || null;
  }
  
  if (save) {
    configStore.saveConfig(currentConfig);
  }
  
  return currentConfig;
}

/**
 * Get the active RPC endpoint URL
 * @returns {string} The active RPC endpoint URL
 */
function getActiveRpcUrl() {
  if (!currentConfig) {
    initialize();
  }
  
  return configStore.getActiveRpcUrl(currentConfig);
}

/**
 * Get the active wallet path
 * @returns {string|null} The active wallet path or null if none is set
 */
function getActiveWalletPath() {
  if (!currentConfig) {
    initialize();
  }
  
  return configStore.getActiveWalletPath(currentConfig);
}

/**
 * Get the active wallet category
 * @returns {string|null} The active wallet category or null if none is set
 */
function getActiveWalletCategory() {
  if (!currentConfig) {
    initialize();
  }
  
  return configStore.getActiveWalletCategory(currentConfig);
}

/**
 * Get the active RPC name
 * @returns {string} The active RPC name
 */
function getActiveRpcName() {
  if (!currentConfig) {
    initialize();
  }
  
  return currentConfig.activeRpc || 'BranchRPC - HTTP';
}

/**
 * Get the active wallet name
 * @returns {string|null} The active wallet name or null if none is set
 */
function getActiveWalletName() {
  if (!currentConfig) {
    initialize();
  }
  
  return currentConfig.activeWallet;
}

/**
 * Set the active RPC endpoint
 * @param {string} name Name of the RPC endpoint to set as active
 */
function setActiveRpc(name) {
  if (!currentConfig) {
    initialize();
  }
  
  if (!currentConfig.rpcEndpoints[name]) {
    return false;
  }
  
  currentConfig.activeRpc = name;
  configStore.saveConfig(currentConfig);
  return true;
}

/**
 * Set the active wallet
 * @param {string} name Name of the wallet to set as active
 */
function setActiveWallet(name) {
  if (!currentConfig) {
    initialize();
  }
  
  if (!currentConfig.wallets[name]) {
    return false;
  }
  
  currentConfig.activeWallet = name;
  configStore.saveConfig(currentConfig);
  return true;
}

/**
 * Get a list of all RPC endpoints
 * @returns {Array<{name: string, url: string}>} List of RPC endpoints
 */
function getRpcEndpoints() {
  if (!currentConfig) {
    initialize();
  }
  
  return Object.entries(currentConfig.rpcEndpoints).map(([name, url]) => ({
    name,
    url
  }));
}

/**
 * Get a list of all wallets
 * @returns {Array<{name: string, path: string, category: string}>} List of wallets
 */
function getWallets() {
  if (!currentConfig) {
    initialize();
  }
  
  return Object.entries(currentConfig.wallets).map(([name, walletInfo]) => {
    // Handle both new and old format
    if (typeof walletInfo === 'object' && walletInfo.path) {
      return {
        name,
        path: walletInfo.path,
        category: walletInfo.category || 'other'
      };
    } else {
      // Legacy format
      return {
        name,
        path: walletInfo,
        category: configStore.categorizeWallet(walletInfo)
      };
    }
  });
}

/**
 * Get a list of private wallets only
 * @returns {Array<{name: string, path: string, category: string}>} List of private wallets
 */
function getPrivateWallets() {
  return getWallets().filter(wallet => wallet.category === 'private');
}

/**
 * Get a list of public wallets only
 * @returns {Array<{name: string, path: string, category: string}>} List of public wallets
 */
function getPublicWallets() {
  return getWallets().filter(wallet => wallet.category === 'public');
}

/**
 * Add a custom RPC endpoint
 * @param {string} name Name for the RPC endpoint
 * @param {string} url URL of the RPC endpoint
 */
function addRpcEndpoint(name, url) {
  if (!currentConfig) {
    initialize();
  }
  
  currentConfig.rpcEndpoints[name] = url;
  configStore.saveConfig(currentConfig);
}

/**
 * Remove a custom RPC endpoint
 * @param {string} name Name of the RPC endpoint to remove
 */
function removeRpcEndpoint(name) {
  if (!currentConfig) {
    initialize();
  }
  
  // Don't remove default endpoints
  const defaultEndpoints = {
    // Premium
    'BranchRPC - HTTP': true,
    'BranchRPC - WS': true,
    'BranchRPC - gRPC': true,
    'Helius - Staked HTTP': true,
    'Helius - Eclipse HTTP': true,
    'Helius - Geyser WS': true,
    'QuikNode - HTTP': true,
    'QuikNode - WS': true,
    
    // Standard
    'Helius - Standard HTTP': true,
    'Helius - Standard WS': true,
    
    // Public
    'Public - Solana Mainnet': true,
    'Public - Solana Mainnet WS': true,
    
    // Devnet
    'Devnet - Solana HTTP': true,
    'Devnet - Solana WS': true
  };
  
  if (defaultEndpoints[name]) {
    return false;
  }
  
  delete currentConfig.rpcEndpoints[name];
  
  // If the active RPC was removed, set to default
  if (currentConfig.activeRpc === name) {
    currentConfig.activeRpc = 'Helius - Standard HTTP';
  }
  
  configStore.saveConfig(currentConfig);
  return true;
}

/**
 * Add color to RPC endpoint name based on its group
 * @param {string} name The RPC endpoint name
 * @returns {string} Colored RPC name
 */
function colorRpcName(name) {
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
}

/**
 * Show RPC endpoint selection menu
 * @param {Function} onSelect Callback when RPC is selected
 */
function showRpcSelectionMenu(onSelect) {
  const endpoints = getRpcEndpoints();
  const activeRpc = getActiveRpcName();
  
  const menuItems = endpoints.map(endpoint => ({
    label: endpoint.name === activeRpc 
      ? `${colorRpcName(endpoint.name)} ${chalk.green('(active)')}`
      : colorRpcName(endpoint.name),
    value: endpoint.name
  }));
  
  menuItems.push({
    label: 'Add Custom RPC...',
    value: 'add_custom'
  });
  
  menuItems.push({
    label: 'Back to Settings',
    value: 'back'
  });
  
  createMenu({
    title: 'Select RPC Endpoint',
    items: menuItems,
    isSubmenu: true,
    onSelect: (value) => {
      if (value === 'back') {
        if (typeof onSelect === 'function') {
          onSelect(null);
        }
        return;
      }
      
      if (value === 'add_custom') {
        // In a real CLI, we'd prompt for name and URL here
        // For simplicity, we'll just show a message
        ui.message('To add a custom RPC, use the command:', 'info');
        ui.message(`ddcli settings rpc add <name> <url>`, 'info');
        
        // Go back to the menu after a brief pause
        setTimeout(() => {
          showRpcSelectionMenu(onSelect);
        }, 2000);
        return;
      }
      
      const spinner = ora(`Switching to ${value} RPC...`).start();
      setActiveRpc(value);
      spinner.succeed(`Switched to ${value} RPC`);
      
      if (typeof onSelect === 'function') {
        onSelect(value);
      }
    }
  });
}

/**
 * Color a wallet name based on its category
 * @param {string} name Wallet name
 * @param {string} category Wallet category
 * @returns {string} Colored wallet name
 */
function colorWalletName(name, category) {
  switch (category) {
    case 'private':
      return chalk.green(name); // Green for private wallets (you can trade with these)
    case 'public':
      return chalk.yellow(name); // Yellow for public wallets (treasury/watch-only)
    default:
      return chalk.blue(name); // Blue for other wallets
  }
}

/**
 * Show wallet selection menu
 * @param {Function} onSelect Callback when wallet is selected
 */
function showWalletSelectionMenu(onSelect) {
  // Refresh wallets first
  refreshWallets();
  
  const wallets = getWallets();
  const activeWallet = getActiveWalletName();
  
  if (wallets.length === 0) {
    ui.message('No wallets found. Import or create wallets using Solana CLI.', 'warning');
    if (typeof onSelect === 'function') {
      onSelect(null);
    }
    return;
  }
  
  // Show legend
  console.log('');
  console.log(`${chalk.green('■')} Private Wallets (Trading)`);
  console.log(`${chalk.yellow('■')} Public Wallets (Treasury/Watch-only)`);
  console.log(`${chalk.blue('■')} Other Wallets`);
  console.log('');
  
  const menuItems = wallets.map(wallet => ({
    label: wallet.name === activeWallet 
      ? `${colorWalletName(wallet.name, wallet.category)} ${chalk.green('(active)')}`
      : colorWalletName(wallet.name, wallet.category),
    value: wallet.name
  }));
  
  menuItems.push({
    label: 'Refresh Wallet List',
    value: 'refresh'
  });
  
  menuItems.push({
    label: 'Back to Settings',
    value: 'back'
  });
  
  createMenu({
    title: 'Select Wallet',
    items: menuItems,
    isSubmenu: true,
    onSelect: (value) => {
      if (value === 'back') {
        if (typeof onSelect === 'function') {
          onSelect(null);
        }
        return;
      }
      
      if (value === 'refresh') {
        const spinner = ora('Refreshing wallet list...').start();
        refreshWallets();
        spinner.succeed('Wallet list refreshed');
        
        // Show the menu again
        showWalletSelectionMenu(onSelect);
        return;
      }
      
      const selectedWallet = wallets.find(w => w.name === value);
      const category = selectedWallet ? selectedWallet.category : 'other';
      const categoryText = category === 'private' ? 'PRIVATE' : category === 'public' ? 'PUBLIC' : 'OTHER';
      
      const spinner = ora(`Switching to ${value} wallet (${categoryText})...`).start();
      setActiveWallet(value);
      spinner.succeed(`Switched to ${value} wallet (${categoryText})`);
      
      if (typeof onSelect === 'function') {
        onSelect(value);
      }
    }
  });
}

/**
 * Show the main settings menu
 * @param {Function} onClose Callback when the menu is closed
 */
function showSettingsMenu(onClose) {
  if (!currentConfig) {
    initialize();
  }
  
  const activeRpc = getActiveRpcName();
  const activeWallet = getActiveWalletName() || 'None';
  
  const menuItems = [
    {
      label: `RPC Endpoint: ${chalk.blue(activeRpc)}`,
      value: 'rpc'
    },
    {
      label: `Active Wallet: ${chalk.blue(activeWallet)}`,
      value: 'wallet'
    },
    {
      label: 'Transaction Settings',
      value: 'transaction'
    },
    {
      label: 'Close Settings',
      value: 'close'
    }
  ];
  
  createMenu({
    title: 'DDCLI Settings',
    items: menuItems,
    isSubmenu: true,
    onSelect: (value) => {
      if (value === 'close') {
        if (typeof onClose === 'function') {
          onClose();
        }
        return;
      }
      
      if (value === 'rpc') {
        showRpcSelectionMenu((selected) => {
          // When RPC selection is done, show the main settings menu again
          showSettingsMenu(onClose);
        });
      } else if (value === 'wallet') {
        showWalletSelectionMenu((selected) => {
          // When wallet selection is done, show the main settings menu again
          showSettingsMenu(onClose);
        });
      } else if (value === 'transaction') {
        // For simplicity, just show a message
        ui.message('Transaction settings can be configured with:', 'info');
        ui.message(`ddcli settings tx-settings <option> <value>`, 'info');
        
        // Go back to the menu after a brief pause
        setTimeout(() => {
          showSettingsMenu(onClose);
        }, 2000);
      }
    }
  });
}

// Export the settings manager API
export default {
  initialize,
  getActiveRpcUrl,
  getActiveWalletPath,
  getActiveWalletCategory,
  getActiveRpcName,
  getActiveWalletName,
  setActiveRpc,
  setActiveWallet,
  getRpcEndpoints,
  getWallets,
  getPrivateWallets,
  getPublicWallets,
  addRpcEndpoint,
  removeRpcEndpoint,
  refreshWallets,
  showSettingsMenu,
  showRpcSelectionMenu,
  showWalletSelectionMenu
};