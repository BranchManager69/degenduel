import chalk from 'chalk';
import ora from 'ora';
import { promisify } from 'util';
import ui from '../../core/ui.js';
import { exec } from 'child_process';
import settingsManager from '../../core/settings/settings-manager.js';
import { initializeSettingsKeyboardShortcuts, showSettingsKeyboardHelp } from '../../core/settings/keyboard-handler.js';

// Import directly from parent package (we don't reinstall it)
// Since we use the ES module format, we'll need to use dynamic import
let Connection, PublicKey, SystemProgram;

// Promisified exec
const execAsync = promisify(exec);

// Constants from the parent project
const PUMP_SWAP_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

// Cache for pool data
const poolDataCache = new Map();

/**
 * Initialize web3.js imports
 */
async function initWeb3() {
  try {
    const solanaWeb3 = await import('@solana/web3.js');
    Connection = solanaWeb3.Connection;
    PublicKey = solanaWeb3.PublicKey;
    SystemProgram = solanaWeb3.SystemProgram;
    return true;
  } catch (error) {
    console.error(chalk.red(`Error loading @solana/web3.js: ${error.message}`));
    return false;
  }
}

/**
 * Fetch pool data using Solana web3.js
 * @param {string} poolAddressStr The pool address to fetch data for
 * @returns {Promise<Object>} The pool data
 */
async function fetchPoolData(poolAddressStr) {
  try {
    const spinner = ora('Fetching pool data...').start();
    
    // Ensure web3.js is initialized
    if (!Connection) {
      const initialized = await initWeb3();
      if (!initialized) {
        spinner.fail('Failed to initialize Solana web3.js');
        return null;
      }
    }
    
    // Get the active RPC endpoint from settings
    const rpcEndpoint = settingsManager.getActiveRpcUrl();
    const activeRpcName = settingsManager.getActiveRpcName();
    spinner.text = `Fetching pool data via ${activeRpcName}...`;
    
    const connection = new Connection(rpcEndpoint);
    const poolAddress = new PublicKey(poolAddressStr);
    
    // Get account info
    const accountInfo = await connection.getAccountInfo(poolAddress);
    
    if (!accountInfo) {
      spinner.fail(`Account not found: ${poolAddressStr}`);
      return null;
    }
    
    // Basic account data
    const poolInfo = {
      address: poolAddressStr,
      programId: accountInfo.owner.toString(),
      lamports: accountInfo.lamports,
      dataSize: accountInfo.data.length,
      isPumpSwapPool: accountInfo.owner.toString() === PUMP_SWAP_PROGRAM,
      lastUpdated: new Date(),
      usedRpc: activeRpcName,
      raw: accountInfo
    };
    
    // Get token balance and other relevant data using Solana CLI for now
    // In a real implementation, this would be replaced with proper data decoding logic
    try {
      // Use solana CLI as a fallback for additional pool information
      const { stdout: tokenInfoStdout } = await execAsync(
        `solana token-account-balance ${poolAddressStr} --url ${rpcEndpoint}`
      );
      
      if (tokenInfoStdout) {
        const balanceMatch = tokenInfoStdout.match(/([0-9,.]+)/);
        if (balanceMatch) {
          poolInfo.tokenBalance = balanceMatch[1];
        }
      }
    } catch (err) {
      // This might not be a token account, which is expected for some pool-related accounts
      poolInfo.tokenBalance = 'N/A';
    }
    
    // Success!
    spinner.succeed('Pool data fetched successfully');
    
    // Update cache
    poolDataCache.set(poolAddressStr, poolInfo);
    
    return poolInfo;
  } catch (error) {
    console.error(chalk.red(`Error fetching pool data: ${error.message}`));
    return null;
  }
}

/**
 * Display pool information
 * @param {Object} poolInfo The pool information
 */
function displayPoolInfo(poolInfo) {
  if (!poolInfo) {
    ui.message('No pool data available', 'error');
    return;
  }
  
  const isPumpSwapPool = poolInfo.programId === PUMP_SWAP_PROGRAM;
  const programText = isPumpSwapPool 
    ? chalk.green('Pump.fun Swap Program') 
    : chalk.yellow(poolInfo.programId);
  
  ui.box(
    `Pool: ${chalk.blue(poolInfo.address)}\n` +
    `Program: ${programText}\n` +
    `Balance: ${chalk.yellow(poolInfo.lamports / 1e9)} SOL\n` +
    `Data Size: ${chalk.dim(poolInfo.dataSize)} bytes\n` +
    `Token Balance: ${chalk.magenta(poolInfo.tokenBalance || 'N/A')}\n` +
    `RPC: ${chalk.cyan(poolInfo.usedRpc || settingsManager.getActiveRpcName())}\n` +
    `Last Updated: ${chalk.green(poolInfo.lastUpdated.toLocaleTimeString())}`,
    {
      padding: 1,
      borderColor: isPumpSwapPool ? 'green' : 'blue',
      borderStyle: 'round',
    }
  );
}

/**
 * Monitor a liquidity pool
 * @param {string} poolAddress The pool address to monitor
 * @param {Object} options Options for monitoring
 * @param {number} options.interval Polling interval in milliseconds
 * @param {number} options.changeThreshold Change threshold percentage
 */
export async function monitorLiquidityPool(poolAddress, options = {}) {
  const { interval = 15000, changeThreshold = 1.0 } = options;
  let timer = null;
  let isPaused = false;
  let keyboardHandler = null;
  
  // Ensure web3.js is initialized
  await initWeb3();
  
  // Initial fetch
  const initialData = await fetchPoolData(poolAddress);
  displayPoolInfo(initialData);
  
  // Show settings keyboard shortcut help
  showSettingsKeyboardHelp();
  
  // Setup polling
  const pollPool = async () => {
    if (isPaused) {
      // If paused (e.g., when settings menu is open), just reschedule
      timer = setTimeout(pollPool, interval);
      return;
    }
    
    const spinner = ora('Updating pool data...').start();
    const activeRpcName = settingsManager.getActiveRpcName();
    spinner.text = `Updating pool data via ${activeRpcName}...`;
    
    try {
      const poolData = await fetchPoolData(poolAddress);
      spinner.succeed('Pool data updated');
      
      if (poolData) {
        displayPoolInfo(poolData);
      }
    } catch (err) {
      spinner.fail('Failed to update pool data');
      console.error(chalk.red(err.message));
    }
    
    // Schedule next update
    timer = setTimeout(pollPool, interval);
  };
  
  // Initialize settings keyboard shortcuts
  keyboardHandler = initializeSettingsKeyboardShortcuts({
    onSettingsOpen: () => {
      isPaused = true;
    },
    onSettingsClose: () => {
      isPaused = false;
      // Show current status after closing settings
      ui.message(`\nMonitoring LP with address: ${poolAddress}`);
      ui.message(`Using RPC: ${chalk.cyan(settingsManager.getActiveRpcName())}`);
      if (settingsManager.getActiveWalletName()) {
        ui.message(`Active wallet: ${chalk.green(settingsManager.getActiveWalletName())}`);
      }
    }
  });
  
  // Start polling
  timer = setTimeout(pollPool, interval);
  
  // Return a function to stop monitoring
  return {
    stop: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      
      if (keyboardHandler) {
        keyboardHandler.cleanup();
      }
    },
  };
}

/**
 * List active liquidity pools
 * @param {number} count Number of pools to display
 */
export async function listLiquidityPools(count = 10) {
  const spinner = ora('Fetching liquidity pools...').start();
  
  try {
    // Ensure web3.js is initialized
    if (!Connection) {
      const initialized = await initWeb3();
      if (!initialized) {
        spinner.fail('Failed to initialize Solana web3.js');
        return [];
      }
    }
    
    // Get the active RPC endpoint from settings
    const rpcEndpoint = settingsManager.getActiveRpcUrl();
    const activeRpcName = settingsManager.getActiveRpcName();
    spinner.text = `Fetching liquidity pools via ${activeRpcName}...`;
    
    const connection = new Connection(rpcEndpoint);
    const programId = new PublicKey(PUMP_SWAP_PROGRAM);
    
    // Get program accounts
    const accounts = await connection.getProgramAccounts(programId, {
      dataSize: 165,  // This size filter would need to be adjusted based on the actual pool account structure
    });
    
    // Limit to the requested count
    const limitedAccounts = accounts.slice(0, count);
    
    spinner.succeed(`Found ${limitedAccounts.length} potential liquidity pools`);
    
    // Display pools as table
    const tableData = [];
    
    for (const { pubkey, account } of limitedAccounts) {
      // Add basic account information
      tableData.push([
        pubkey.toString(),
        (account.lamports / 1e9).toFixed(5),  // SOL balance
        account.data.length.toString(),
        account.owner.toString() === PUMP_SWAP_PROGRAM ? 'Yes' : 'No'
      ]);
    }
    
    if (tableData.length > 0) {
      ui.table(
        ['Pool Address', 'Balance (SOL)', 'Data Size', 'Valid Pool'],
        tableData
      );
      ui.message(`Using RPC: ${chalk.cyan(activeRpcName)}`, 'info');
      
      // Show settings keyboard shortcut help
      showSettingsKeyboardHelp();
      
      // Initialize settings keyboard shortcuts
      const keyboardHandler = initializeSettingsKeyboardShortcuts({
        onSettingsClose: () => {
          ui.message(`\nUsing RPC: ${chalk.cyan(settingsManager.getActiveRpcName())}`, 'info');
          if (settingsManager.getActiveWalletName()) {
            ui.message(`Active wallet: ${chalk.green(settingsManager.getActiveWalletName())}`, 'info');
          }
        }
      });
    } else {
      ui.message('No pools found matching the criteria', 'warning');
    }
    
    return accounts;
  } catch (error) {
    spinner.fail('Failed to fetch liquidity pools');
    console.error(chalk.red(`Error: ${error.message}`));
    return [];
  }
}