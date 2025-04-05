// Implementation of trade commands for Pump.fun tokens
import fs from 'fs';
import settingsManager from '../../core/settings/settings-manager.js';
import { clearScreen, printHeader, printSuccess, printError, printInfo, printWarning, spinnerStart, spinnerStop } from '../../core/ui.js';
import { registerKeyHandler } from '../../core/keypress.js';
import { initializeSettingsKeyboardShortcuts, showSettingsKeyboardHelp } from '../../core/settings/keyboard-handler.js';

// Cache for web3 to avoid reloading
let solanaWeb3 = null;
let anchorLib = null;

// Cache for connection and provider
let connection = null;
let provider = null;

// PUMP.FUN Program ID
const PUMP_PROGRAM_ID = 'DxPPzJWE5cKyYGiRnQxpkJu7qCvvF3FxKwJXG2Qc1Myj';

/**
 * Initialize Solana web3 by dynamically importing
 * Helps avoid duplication if parent project also uses Solana
 */
async function initWeb3() {
  if (solanaWeb3 === null) {
    solanaWeb3 = await import('@solana/web3.js');
    
    try {
      // Try to import @coral-xyz/anchor if available
      anchorLib = await import('@coral-xyz/anchor');
    } catch (error) {
      console.log('Anchor not available, using basic transaction methods');
    }
  }

  return { solanaWeb3, anchorLib };
}

/**
 * Get a Solana connection using the active RPC
 */
async function getConnection() {
  if (connection) return connection;
  
  const { solanaWeb3 } = await initWeb3();
  const rpcUrl = settingsManager.getActiveRpcUrl();
  
  connection = new solanaWeb3.Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000
  });
  
  return connection;
}

/**
 * Load a wallet from keyfile or use active wallet from settings
 */
async function loadWallet(walletPath) {
  const { solanaWeb3 } = await initWeb3();
  
  try {
    let keyPair;
    
    if (walletPath) {
      // Load from specific path if provided
      const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')));
      keyPair = solanaWeb3.Keypair.fromSecretKey(secretKey);
    } else {
      // Get active wallet from settings
      const activeWalletPath = settingsManager.getActiveWalletPath();
      if (!activeWalletPath) {
        throw new Error('No active wallet found in settings');
      }
      
      const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(activeWalletPath, 'utf-8')));
      keyPair = solanaWeb3.Keypair.fromSecretKey(secretKey);
    }
    
    return keyPair;
  } catch (error) {
    throw new Error(`Failed to load wallet: ${error.message}`);
  }
}

/**
 * Get provider for Anchor operations
 */
async function getProvider(wallet) {
  if (!anchorLib) {
    throw new Error('Anchor library not available');
  }
  
  const connection = await getConnection();
  return new anchorLib.AnchorProvider(
    connection,
    new anchorLib.Wallet(wallet),
    { commitment: 'confirmed', skipPreflight: false }
  );
}

/**
 * Get the Pump.fun pool address for a token
 */
async function getPumpPool(tokenMint) {
  const { solanaWeb3 } = await initWeb3();
  const tokenMintKey = new solanaWeb3.PublicKey(tokenMint);
  const programId = new solanaWeb3.PublicKey(PUMP_PROGRAM_ID);
  
  // Find PDA for the pool
  const [poolAddress] = solanaWeb3.PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), tokenMintKey.toBuffer()],
    programId
  );
  
  return poolAddress;
}

/**
 * Get current price of a token on Pump.fun
 */
export async function getTokenPrice(tokenAddress) {
  clearScreen();
  printHeader('Pump.fun Token Price');
  printInfo(`Fetching price for: ${tokenAddress}`);
  
  const spinner = spinnerStart('Connecting to Solana...');
  
  try {
    const { solanaWeb3 } = await initWeb3();
    const connection = await getConnection();
    spinner.text = 'Fetching pool data...';
    
    const poolAddress = await getPumpPool(tokenAddress);
    const accountInfo = await connection.getAccountInfo(poolAddress);
    
    if (!accountInfo || !accountInfo.data) {
      spinnerStop(spinner);
      printError(`No pool found for token: ${tokenAddress}`);
      return;
    }
    
    // Simple pool data parsing (would need full IDL for proper parsing)
    // This is a simplified approach as placeholder
    const dataView = new DataView(accountInfo.data.buffer);
    
    // Skip pool header bytes to price data
    // For actual implementation, would need proper deserialization based on Pump.fun IDL
    const priceInLamports = dataView.getBigUint64(64, true); // Placeholder offset
    const solPrice = Number(priceInLamports) / 1e9;
    
    spinnerStop(spinner);
    printSuccess(`Current token price: ${solPrice.toFixed(9)} SOL`);
    
    // Show additional pool data
    printInfo('Pool Address: ' + poolAddress.toString());
    
    // Return control to keyboard handler when done
    return null;
  } catch (error) {
    spinnerStop(spinner);
    printError(`Error fetching price: ${error.message}`);
    console.error(error);
  }
}

/**
 * Check token balance for a wallet
 */
export async function getTokenBalance(tokenAddress, options) {
  clearScreen();
  printHeader('Token Balance Check');
  
  const spinner = spinnerStart('Loading wallet...');
  
  try {
    const { solanaWeb3 } = await initWeb3();
    const wallet = await loadWallet(options.wallet);
    spinner.text = 'Fetching token accounts...';
    
    const connection = await getConnection();
    const tokenMint = new solanaWeb3.PublicKey(tokenAddress);
    
    // Find token account(s) for this wallet
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      wallet.publicKey,
      { mint: tokenMint }
    );
    
    spinnerStop(spinner);
    
    if (tokenAccounts.value.length === 0) {
      printWarning(`No balance found for token: ${tokenAddress}`);
      printInfo(`Wallet: ${wallet.publicKey.toString()}`);
      return;
    }
    
    // Get total balance across all token accounts
    let totalBalance = 0;
    for (const account of tokenAccounts.value) {
      const accountInfo = account.account.data.parsed.info;
      const balance = accountInfo.tokenAmount.uiAmount;
      totalBalance += balance;
      
      printSuccess(`Token balance: ${balance.toLocaleString()} tokens`);
      printInfo(`Token Account: ${account.pubkey.toString()}`);
    }
    
    if (tokenAccounts.value.length > 1) {
      printInfo(`Total Balance Across All Accounts: ${totalBalance.toLocaleString()} tokens`);
    }
    
    printInfo(`Wallet: ${wallet.publicKey.toString()}`);
    printInfo(`Token Mint: ${tokenAddress}`);
    
    // Return control to keyboard handler when done
    return null;
  } catch (error) {
    spinnerStop(spinner);
    printError(`Error checking balance: ${error.message}`);
    console.error(error);
  }
}

/**
 * Buy tokens on Pump.fun
 */
export async function buyToken(tokenAddress, options) {
  clearScreen();
  printHeader('Buy Tokens on Pump.fun');
  printInfo(`Token: ${tokenAddress}`);
  printInfo(`Amount: ${options.amount} SOL`);
  printInfo(`Slippage: ${options.slippage} basis points (${options.slippage / 100}%)`);
  
  const spinner = spinnerStart('Loading wallet...');
  
  try {
    const { solanaWeb3 } = await initWeb3();
    const wallet = await loadWallet(options.wallet);
    
    spinner.text = 'Connecting to Solana...';
    const connection = await getConnection();
    
    spinner.text = 'Preparing transaction...';
    const tokenMint = new solanaWeb3.PublicKey(tokenAddress);
    const poolAddress = await getPumpPool(tokenAddress);
    
    // Calculate lamports from SOL amount
    const lamports = options.amount * solanaWeb3.LAMPORTS_PER_SOL;
    
    // Create a transaction to buy tokens
    // This is a placeholder implementation - for real implementation would need
    // proper transaction construction using Pump.fun program instructions
    const transaction = new solanaWeb3.Transaction();
    
    // Add a memo to identify our transaction
    transaction.add(
      new solanaWeb3.TransactionInstruction({
        keys: [],
        programId: new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        data: Buffer.from('DegenDuel CLI - Buy Token', 'utf-8'),
      })
    );
    
    // Add buy instruction (placeholder, would need actual instruction from Pump.fun)
    transaction.add(
      new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: poolAddress, isSigner: false, isWritable: true },
          { pubkey: tokenMint, isSigner: false, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
          // Would need additional keys for token program, associated token account, etc.
        ],
        programId: new solanaWeb3.PublicKey(PUMP_PROGRAM_ID),
        data: Buffer.from([/* Placeholder for Pump.fun instruction data */]),
      })
    );
    
    // Set recent blockhash and fee payer
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = wallet.publicKey;
    
    // Add priority fee if specified
    if (options.priorityFee) {
      transaction.instructions.unshift(
        solanaWeb3.ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: options.priorityFee,
        })
      );
    }
    
    // Sign transaction
    transaction.sign(wallet);
    
    // Send transaction
    spinner.text = 'Sending transaction...';
    const signature = await connection.sendRawTransaction(transaction.serialize());
    
    spinner.text = 'Confirming transaction...';
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      spinnerStop(spinner);
      printError(`Transaction failed: ${confirmation.value.err}`);
      return;
    }
    
    spinnerStop(spinner);
    printSuccess('Transaction successful!');
    printInfo(`Amount: ${options.amount} SOL`);
    printInfo(`Transaction: https://solscan.io/tx/${signature}`);
    
    // Return control to keyboard handler when done
    return null;
  } catch (error) {
    spinnerStop(spinner);
    printError(`Error buying tokens: ${error.message}`);
    console.error(error);
  }
}

/**
 * Sell tokens on Pump.fun
 */
export async function sellToken(tokenAddress, options) {
  clearScreen();
  printHeader('Sell Tokens on Pump.fun');
  printInfo(`Token: ${tokenAddress}`);
  
  if (options.amount) {
    printInfo(`Amount: ${options.amount} tokens`);
  } else {
    printInfo(`Percentage: ${options.percentage}%`);
  }
  
  printInfo(`Slippage: ${options.slippage} basis points (${options.slippage / 100}%)`);
  
  const spinner = spinnerStart('Loading wallet...');
  
  try {
    const { solanaWeb3 } = await initWeb3();
    const wallet = await loadWallet(options.wallet);
    
    spinner.text = 'Connecting to Solana...';
    const connection = await getConnection();
    
    spinner.text = 'Preparing transaction...';
    const tokenMint = new solanaWeb3.PublicKey(tokenAddress);
    const poolAddress = await getPumpPool(tokenAddress);
    
    // Find token account(s) for this wallet
    spinner.text = 'Fetching token accounts...';
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      wallet.publicKey,
      { mint: tokenMint }
    );
    
    if (tokenAccounts.value.length === 0) {
      spinnerStop(spinner);
      printError(`No tokens found for: ${tokenAddress}`);
      return;
    }
    
    // Get primary token account
    const tokenAccount = tokenAccounts.value[0].pubkey;
    const tokenBalance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    
    // Calculate sell amount
    let sellAmount;
    if (options.amount) {
      sellAmount = options.amount;
    } else {
      sellAmount = tokenBalance * (options.percentage / 100);
    }
    
    if (sellAmount <= 0 || sellAmount > tokenBalance) {
      spinnerStop(spinner);
      printError(`Invalid sell amount: ${sellAmount}. Available: ${tokenBalance}`);
      return;
    }
    
    spinner.text = 'Creating transaction...';
    
    // Create a transaction to sell tokens
    // This is a placeholder implementation - for real implementation would need
    // proper transaction construction using Pump.fun program instructions
    const transaction = new solanaWeb3.Transaction();
    
    // Add a memo to identify our transaction
    transaction.add(
      new solanaWeb3.TransactionInstruction({
        keys: [],
        programId: new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        data: Buffer.from('DegenDuel CLI - Sell Token', 'utf-8'),
      })
    );
    
    // Add sell instruction (placeholder, would need actual instruction from Pump.fun)
    transaction.add(
      new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: tokenAccount, isSigner: false, isWritable: true },
          { pubkey: poolAddress, isSigner: false, isWritable: true },
          { pubkey: tokenMint, isSigner: false, isWritable: true },
          // Would need additional keys for token program, associated token account, etc.
        ],
        programId: new solanaWeb3.PublicKey(PUMP_PROGRAM_ID),
        data: Buffer.from([/* Placeholder for Pump.fun instruction data */]),
      })
    );
    
    // Set recent blockhash and fee payer
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = wallet.publicKey;
    
    // Add priority fee if specified
    if (options.priorityFee) {
      transaction.instructions.unshift(
        solanaWeb3.ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: options.priorityFee,
        })
      );
    }
    
    // Sign transaction
    transaction.sign(wallet);
    
    // Send transaction
    spinner.text = 'Sending transaction...';
    const signature = await connection.sendRawTransaction(transaction.serialize());
    
    spinner.text = 'Confirming transaction...';
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      spinnerStop(spinner);
      printError(`Transaction failed: ${confirmation.value.err}`);
      return;
    }
    
    spinnerStop(spinner);
    printSuccess('Transaction successful!');
    printInfo(`Sold: ${sellAmount} tokens (${options.percentage}% of balance)`);
    printInfo(`Transaction: https://solscan.io/tx/${signature}`);
    
    // Return control to keyboard handler when done
    return null;
  } catch (error) {
    spinnerStop(spinner);
    printError(`Error selling tokens: ${error.message}`);
    console.error(error);
  }
}