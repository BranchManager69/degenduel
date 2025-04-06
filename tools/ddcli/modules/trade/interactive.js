// Interactive trade module for Pump.fun tokens
import chalk from 'chalk';
import { createMenu } from '../../core/menu.js';
import { 
  getTextInput, 
  getNumberInput, 
  getSelection, 
  getConfirmation,
  getFormInput,
  showMessage
} from '../../core/input-handler.js';
import * as trade from './trade.js';
import settingsManager from '../../core/settings/settings-manager.js';
import { initializeSettingsKeyboardShortcuts, showSettingsKeyboardHelp } from '../../core/settings/keyboard-handler.js';

/**
 * Show the interactive trade menu
 */
export async function showTradeMenu() {
  const menuItems = [
    {
      label: '🔄 Buy Tokens',
      value: 'buy'
    },
    {
      label: '🔄 Sell Tokens',
      value: 'sell'
    },
    {
      label: '💰 Check Token Price',
      value: 'price'
    },
    {
      label: '💼 Check Token Balance',
      value: 'balance'
    },
    {
      label: '⚙️ Settings',
      value: 'settings'
    },
    {
      label: '↩️ Back to Main Menu',
      value: 'back'
    }
  ];
  
  createMenu({
    title: 'Pump.fun Token Trading',
    items: menuItems,
    isSubmenu: true,
    onSelect: async (value) => {
      switch (value) {
        case 'buy':
          await showBuyForm();
          showTradeMenu(); // Return to trade menu after operation
          break;
        case 'sell':
          await showSellForm();
          showTradeMenu();
          break;
        case 'price':
          await showPriceForm();
          showTradeMenu();
          break;
        case 'balance':
          await showBalanceForm();
          showTradeMenu();
          break;
        case 'settings':
          // Show settings menu
          settingsManager.showSettingsMenu(() => {
            // Return to trade menu after settings
            showTradeMenu();
          });
          break;
        case 'back':
          // Just return to main menu
          return;
      }
    },
    onExit: () => {
      // Just return to main menu
      return;
    }
  });
}

/**
 * Show the buy token form
 */
async function showBuyForm() {
  console.clear();
  console.log(chalk.bold.blue('Buy Tokens on Pump.fun'));
  console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
  
  // Enable settings keyboard shortcuts
  initializeSettingsKeyboardShortcuts({
    onSettingsClose: () => {
      // Redisplay the form header after settings close
      console.clear();
      console.log(chalk.bold.blue('Buy Tokens on Pump.fun'));
      console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
      showSettingsKeyboardHelp();
    }
  });
  showSettingsKeyboardHelp();
  
  // Get token address
  const tokenAddress = await getTextInput({
    prompt: 'Enter token address',
    validate: (value) => {
      // Basic validation for Solana addresses
      if (!value || value.length !== 44) {
        return 'Token address must be 44 characters';
      }
      return null;
    }
  });
  
  // Get amount to spend
  const solAmountOptions = [
    { label: '0.01 SOL (min)', value: 0.01 },
    { label: '0.05 SOL (small)', value: 0.05 },
    { label: '0.1 SOL (medium)', value: 0.1 },
    { label: '0.5 SOL (large)', value: 0.5 },
    { label: '1.0 SOL (whale)', value: 1.0 },
    { label: 'Custom amount...', value: 'custom' }
  ];
  
  const solAmount = await getSelection({
    title: 'Select amount to spend',
    items: solAmountOptions,
    default: 0.1
  });
  
  // If custom amount, get the value
  let finalAmount = solAmount;
  if (solAmount === 'custom') {
    finalAmount = await getNumberInput({
      prompt: 'Enter custom SOL amount',
      min: 0.001,
      default: 0.1
    });
  }
  
  // Get slippage
  const slippageOptions = [
    { label: '0.5% (tight)', value: 50 },
    { label: '1.0% (standard)', value: 100 },
    { label: '2.0% (loose)', value: 200 },
    { label: '5.0% (very loose)', value: 500 },
    { label: 'Custom slippage...', value: 'custom' }
  ];
  
  const slippage = await getSelection({
    title: 'Select slippage tolerance',
    items: slippageOptions,
    default: 100
  });
  
  // If custom slippage, get the value
  let finalSlippage = slippage;
  if (slippage === 'custom') {
    finalSlippage = await getNumberInput({
      prompt: 'Enter custom slippage in basis points (1.0% = 100)',
      min: 10,
      max: 1000,
      default: 100
    });
  }
  
  // Ask about priority fee
  const usePriorityFee = await getConfirmation({
    prompt: 'Use priority fee for faster processing?',
    default: false
  });
  
  // If using priority fee, get the amount
  let priorityFee = null;
  if (usePriorityFee) {
    const priorityFeeOptions = [
      { label: 'Low (100,000)', value: 100000 },
      { label: 'Medium (500,000)', value: 500000 },
      { label: 'High (1,000,000)', value: 1000000 },
      { label: 'Custom...', value: 'custom' }
    ];
    
    const selectedPriorityFee = await getSelection({
      title: 'Select priority fee level',
      items: priorityFeeOptions,
      default: 500000
    });
    
    // If custom priority fee, get the value
    priorityFee = selectedPriorityFee;
    if (selectedPriorityFee === 'custom') {
      priorityFee = await getNumberInput({
        prompt: 'Enter custom priority fee in microLamports',
        min: 10000,
        default: 500000
      });
    }
  }
  
  // Get wallet selection
  const useActiveWallet = await getConfirmation({
    prompt: `Use active wallet (${settingsManager.getActiveWalletName() || 'None'})`,
    default: true
  });
  
  let walletPath = null;
  if (!useActiveWallet) {
    // Show wallet selection menu
    settingsManager.showWalletSelectionMenu(() => {
      console.log(chalk.green(`Selected wallet: ${settingsManager.getActiveWalletName()}`));
    });
  }
  
  // Show transaction summary
  console.clear();
  console.log(chalk.bold.blue('Transaction Summary'));
  console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
  console.log(`Token: ${chalk.cyan(tokenAddress)}`);
  console.log(`Amount: ${chalk.yellow(finalAmount)} SOL`);
  console.log(`Slippage: ${chalk.yellow(finalSlippage / 100)}%`);
  if (priorityFee) {
    console.log(`Priority Fee: ${chalk.yellow(priorityFee)} microLamports`);
  }
  console.log(`Wallet: ${chalk.green(settingsManager.getActiveWalletName() || 'None')}`);
  console.log('');
  
  // Confirm transaction
  const confirmTransaction = await getConfirmation({
    prompt: 'Confirm transaction',
    default: true
  });
  
  if (confirmTransaction) {
    console.log(chalk.yellow('Executing transaction...'));
    try {
      // Execute buy token with entered parameters
      await trade.buyToken(tokenAddress, {
        amount: finalAmount,
        slippage: finalSlippage,
        priorityFee: priorityFee,
        wallet: walletPath
      });
      
      // Add 2 second pause after transaction
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(chalk.red(`Transaction failed: ${error.message}`));
      console.log('Press any key to continue...');
      await new Promise(resolve => {
        process.stdin.once('data', () => resolve());
      });
    }
  } else {
    console.log(chalk.yellow('Transaction cancelled'));
    // Short pause before returning to menu
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Show the sell token form
 */
async function showSellForm() {
  console.clear();
  console.log(chalk.bold.blue('Sell Tokens on Pump.fun'));
  console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
  
  // Enable settings keyboard shortcuts
  initializeSettingsKeyboardShortcuts({
    onSettingsClose: () => {
      // Redisplay the form header after settings close
      console.clear();
      console.log(chalk.bold.blue('Sell Tokens on Pump.fun'));
      console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
      showSettingsKeyboardHelp();
    }
  });
  showSettingsKeyboardHelp();
  
  // Get token address
  const tokenAddress = await getTextInput({
    prompt: 'Enter token address',
    validate: (value) => {
      // Basic validation for Solana addresses
      if (!value || value.length !== 44) {
        return 'Token address must be 44 characters';
      }
      return null;
    }
  });
  
  // Ask about sell method
  const sellMethod = await getSelection({
    title: 'Select sell method',
    items: [
      { label: 'Percentage of balance', value: 'percentage' },
      { label: 'Exact token amount', value: 'exact' }
    ],
    default: 'percentage'
  });
  
  let sellAmount = null;
  let sellPercentage = null;
  
  if (sellMethod === 'percentage') {
    // Get percentage to sell
    const percentageOptions = [
      { label: '25% (quarter)', value: 25 },
      { label: '50% (half)', value: 50 },
      { label: '75% (three quarters)', value: 75 },
      { label: '100% (all)', value: 100 },
      { label: 'Custom percentage...', value: 'custom' }
    ];
    
    const percentage = await getSelection({
      title: 'Select percentage to sell',
      items: percentageOptions,
      default: 100
    });
    
    // If custom percentage, get the value
    sellPercentage = percentage;
    if (percentage === 'custom') {
      sellPercentage = await getNumberInput({
        prompt: 'Enter custom percentage (1-100)',
        min: 1,
        max: 100,
        default: 50
      });
    }
  } else {
    // Get exact amount to sell
    sellAmount = await getNumberInput({
      prompt: 'Enter exact amount of tokens to sell',
      min: 0.000001,
      default: 1
    });
  }
  
  // Get slippage
  const slippageOptions = [
    { label: '0.5% (tight)', value: 50 },
    { label: '1.0% (standard)', value: 100 },
    { label: '2.0% (loose)', value: 200 },
    { label: '5.0% (very loose)', value: 500 },
    { label: 'Custom slippage...', value: 'custom' }
  ];
  
  const slippage = await getSelection({
    title: 'Select slippage tolerance',
    items: slippageOptions,
    default: 100
  });
  
  // If custom slippage, get the value
  let finalSlippage = slippage;
  if (slippage === 'custom') {
    finalSlippage = await getNumberInput({
      prompt: 'Enter custom slippage in basis points (1.0% = 100)',
      min: 10,
      max: 1000,
      default: 100
    });
  }
  
  // Ask about priority fee
  const usePriorityFee = await getConfirmation({
    prompt: 'Use priority fee for faster processing?',
    default: false
  });
  
  // If using priority fee, get the amount
  let priorityFee = null;
  if (usePriorityFee) {
    const priorityFeeOptions = [
      { label: 'Low (100,000)', value: 100000 },
      { label: 'Medium (500,000)', value: 500000 },
      { label: 'High (1,000,000)', value: 1000000 },
      { label: 'Custom...', value: 'custom' }
    ];
    
    const selectedPriorityFee = await getSelection({
      title: 'Select priority fee level',
      items: priorityFeeOptions,
      default: 500000
    });
    
    // If custom priority fee, get the value
    priorityFee = selectedPriorityFee;
    if (selectedPriorityFee === 'custom') {
      priorityFee = await getNumberInput({
        prompt: 'Enter custom priority fee in microLamports',
        min: 10000,
        default: 500000
      });
    }
  }
  
  // Get wallet selection
  const useActiveWallet = await getConfirmation({
    prompt: `Use active wallet (${settingsManager.getActiveWalletName() || 'None'})`,
    default: true
  });
  
  let walletPath = null;
  if (!useActiveWallet) {
    // Show wallet selection menu
    settingsManager.showWalletSelectionMenu(() => {
      console.log(chalk.green(`Selected wallet: ${settingsManager.getActiveWalletName()}`));
    });
  }
  
  // Show transaction summary
  console.clear();
  console.log(chalk.bold.blue('Transaction Summary'));
  console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
  console.log(`Token: ${chalk.cyan(tokenAddress)}`);
  
  if (sellPercentage) {
    console.log(`Selling: ${chalk.yellow(sellPercentage)}% of balance`);
  } else {
    console.log(`Selling: ${chalk.yellow(sellAmount)} tokens`);
  }
  
  console.log(`Slippage: ${chalk.yellow(finalSlippage / 100)}%`);
  if (priorityFee) {
    console.log(`Priority Fee: ${chalk.yellow(priorityFee)} microLamports`);
  }
  console.log(`Wallet: ${chalk.green(settingsManager.getActiveWalletName() || 'None')}`);
  console.log('');
  
  // Confirm transaction
  const confirmTransaction = await getConfirmation({
    prompt: 'Confirm transaction',
    default: true
  });
  
  if (confirmTransaction) {
    console.log(chalk.yellow('Executing transaction...'));
    try {
      // Execute sell token with entered parameters
      await trade.sellToken(tokenAddress, {
        percentage: sellPercentage,
        amount: sellAmount,
        slippage: finalSlippage,
        priorityFee: priorityFee,
        wallet: walletPath
      });
      
      // Add 2 second pause after transaction
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(chalk.red(`Transaction failed: ${error.message}`));
      console.log('Press any key to continue...');
      await new Promise(resolve => {
        process.stdin.once('data', () => resolve());
      });
    }
  } else {
    console.log(chalk.yellow('Transaction cancelled'));
    // Short pause before returning to menu
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Show the price check form
 */
async function showPriceForm() {
  console.clear();
  console.log(chalk.bold.blue('Check Token Price'));
  console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
  
  // Enable settings keyboard shortcuts
  initializeSettingsKeyboardShortcuts({
    onSettingsClose: () => {
      // Redisplay the form header after settings close
      console.clear();
      console.log(chalk.bold.blue('Check Token Price'));
      console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
      showSettingsKeyboardHelp();
    }
  });
  showSettingsKeyboardHelp();
  
  // Get token address
  const tokenAddress = await getTextInput({
    prompt: 'Enter token address',
    validate: (value) => {
      // Basic validation for Solana addresses
      if (!value || value.length !== 44) {
        return 'Token address must be 44 characters';
      }
      return null;
    }
  });
  
  try {
    // Check price
    await trade.getTokenPrice(tokenAddress);
    
    // Ask if user wants to check another token
    const checkAnother = await getConfirmation({
      prompt: 'Check another token?',
      default: false
    });
    
    if (checkAnother) {
      return showPriceForm();
    }
  } catch (error) {
    console.error(chalk.red(`Error checking price: ${error.message}`));
    console.log('Press any key to continue...');
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }
}

/**
 * Show the balance check form
 */
async function showBalanceForm() {
  console.clear();
  console.log(chalk.bold.blue('Check Token Balance'));
  console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
  
  // Enable settings keyboard shortcuts
  initializeSettingsKeyboardShortcuts({
    onSettingsClose: () => {
      // Redisplay the form header after settings close
      console.clear();
      console.log(chalk.bold.blue('Check Token Balance'));
      console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
      showSettingsKeyboardHelp();
    }
  });
  showSettingsKeyboardHelp();
  
  // Get token address
  const tokenAddress = await getTextInput({
    prompt: 'Enter token address',
    validate: (value) => {
      // Basic validation for Solana addresses
      if (!value || value.length !== 44) {
        return 'Token address must be 44 characters';
      }
      return null;
    }
  });
  
  // Get wallet selection
  const useActiveWallet = await getConfirmation({
    prompt: `Use active wallet (${settingsManager.getActiveWalletName() || 'None'})`,
    default: true
  });
  
  let walletPath = null;
  if (!useActiveWallet) {
    // Show wallet selection menu
    settingsManager.showWalletSelectionMenu(() => {
      console.log(chalk.green(`Selected wallet: ${settingsManager.getActiveWalletName()}`));
    });
  }
  
  try {
    // Check balance
    await trade.getTokenBalance(tokenAddress, { wallet: walletPath });
    
    // Ask if user wants to check another token
    const checkAnother = await getConfirmation({
      prompt: 'Check another token?',
      default: false
    });
    
    if (checkAnother) {
      return showBalanceForm();
    }
  } catch (error) {
    console.error(chalk.red(`Error checking balance: ${error.message}`));
    console.log('Press any key to continue...');
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }
}