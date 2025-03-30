// utils/solana-suite/web3-v2/solana-transaction-fixed.js

/*
 * This is an updated implementation using @solana/transaction-messages and @solana/transactions v2.1
 * in a more functional programming style, properly separating message creation from transaction
 * compilation and signing
 * 
 * IMPORTANT: This implementation now uses the centralized SolanaService for rate limiting
 * and RPC request management to avoid "Hit #1" rate limit errors across independent systems
 */

import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

// Import functions from @solana/transaction-messages for building transaction messages
import {
  createTransactionMessage,
  setTransactionMessageFeePayer,
  appendTransactionMessageInstruction,
  setTransactionMessageLifetimeUsingBlockhash
} from '@solana/transaction-messages';

// Note: The following functions will be dynamically imported when needed:
// - compileTransaction from @solana/transactions
// - signTransaction from @solana/transactions
// - getBase64EncodedWireTransaction from @solana/transactions

// Still need RPC functions from @solana/kit
import { 
  createSolanaRpc
} from '@solana/kit';

// Import the Ed25519 signing function from @solana/keys for direct signing
import { signBytes } from '@solana/keys';

// Import SolanaServiceManager for centralized RPC requests
import SolanaServiceManager from '../solana-service-manager.js';

import { logApi } from '../../logger-suite/logger.js';

/**
 * Debug function to log keypair details
 */
function logKeypairDetails(keypair, label = 'Keypair') {
  if (!keypair) {
    logApi.error(`DEBUG - ${label} is null or undefined`);
    return;
  }
  
  logApi.info(`DEBUG - ${label} details:`, {
    publicKey: keypair.publicKey ? keypair.publicKey.toString() : 'undefined',
    publicKey_type: keypair.publicKey ? typeof keypair.publicKey : 'undefined',
    secretKey_type: typeof keypair.secretKey,
    secretKey_is_array: Array.isArray(keypair.secretKey),
    secretKey_is_uint8array: keypair.secretKey instanceof Uint8Array,
    secretKey_length: keypair.secretKey ? keypair.secretKey.length : 0,
    secretKey_first_bytes: keypair.secretKey ? Array.from(keypair.secretKey.slice(0, 4)) : null
  });
}

/**
 * Custom sign function that correctly handles the keypair format expected by v2.1
 * This avoids the assertIsAddress error by directly signing the message bytes and
 * constructing the transaction in the expected format manually.
 * 
 * @param {Object} transaction - The unsigned transaction to sign
 * @param {Keypair} fromKeypair - The keypair to sign with
 */
async function customSignTransaction(transaction, fromKeypair) {
  logApi.info(`CUSTOM SIGN: Starting custom transaction signing`);
  
  // Check if the transaction doesn't have the expected structure
  if (!transaction || !transaction.messageBytes || !transaction.signatures) {
    logApi.error(`CUSTOM SIGN: Invalid transaction format`, {
      has_transaction: !!transaction,
      has_messageBytes: !!(transaction && transaction.messageBytes),
      has_signatures: !!(transaction && transaction.signatures)
    });
    throw new Error('Invalid transaction format');
  }
  
  // Log detailed transaction info
  logApi.info(`CUSTOM SIGN: Transaction details`, {
    messageBytes_length: transaction.messageBytes ? transaction.messageBytes.length : 0,
    signatures_keys: transaction.signatures ? Object.keys(transaction.signatures) : []
  });
  
  // Get the expected signer addresses from the transaction
  const signerAddresses = Object.keys(transaction.signatures);
  if (signerAddresses.length === 0) {
    logApi.error(`CUSTOM SIGN: No signers found in transaction signatures object`);
    throw new Error('No signers required for this transaction');
  }
  logApi.info(`CUSTOM SIGN: Found ${signerAddresses.length} required signers: ${signerAddresses.join(', ')}`);
  
  // The address of our keypair (what we're signing as)
  const signerAddress = fromKeypair.publicKey.toBase58();
  logApi.info(`CUSTOM SIGN: Our keypair address is: ${signerAddress}`);
  
  // Check if our keypair is one of the expected signers
  if (!signerAddresses.includes(signerAddress)) {
    logApi.error(`CUSTOM SIGN: Keypair address mismatch`, {
      our_address: signerAddress,
      expected_signers: signerAddresses
    });
    throw new Error(`Keypair address ${signerAddress} is not an expected signer. Expected: ${signerAddresses.join(', ')}`);
  }
  logApi.info(`CUSTOM SIGN: Our keypair is a valid signer for this transaction`);
  
  // Create a copy of the signatures object
  const signatures = { ...transaction.signatures };
  
  // Sign the message bytes directly using the secretKey
  try {
    logApi.info(`CUSTOM SIGN: Creating CryptoKey from keypair secretKey`);
    
    // Create a proper CryptoKey for the privateKey
    const privateKey = {
      type: 'private',
      algorithm: { name: 'Ed25519' },
      extractable: true,
      usages: ['sign'],
      _keyMaterial: fromKeypair.secretKey
    };
    
    // Log details about the message we're signing
    logApi.info(`CUSTOM SIGN: Signing message bytes`, {
      messageBytes_length: transaction.messageBytes.length,
      first_few_bytes: Array.from(transaction.messageBytes.slice(0, 8))
    });
    
    // Sign the message bytes directly with @solana/keys signBytes
    const signature = await signBytes(privateKey, transaction.messageBytes);
    
    // Log the resulting signature
    logApi.info(`CUSTOM SIGN: Signature generated successfully`, {
      signature_length: signature.length,
      first_bytes: Array.from(signature.slice(0, 8))
    });
    
    // Add the signature to the signatures map
    signatures[signerAddress] = signature;
    logApi.info(`CUSTOM SIGN: Added signature to transaction for address: ${signerAddress}`);
    
    // Return a properly signed transaction
    const signedTx = {
      ...transaction,
      signatures: Object.freeze(signatures)
    };
    
    logApi.info(`CUSTOM SIGN: Transaction signing completed successfully`);
    return signedTx;
  } catch (error) {
    logApi.error(`CUSTOM SIGN: Direct signing failed: ${error.message}`, { 
      error_name: error.name,
      error_message: error.message,
      error_stack: error.stack
    });
    throw error;
  }
}

/**
 * Execute an RPC call using the centralized SolanaService request manager
 * This replaces the local rate limiting system with the global one
 * 
 * @param {Function} rpcCall - Function that performs the RPC call
 * @param {string} callName - Name of the call for logging
 * @returns {Promise<any>} - Result of the RPC call
 */
async function executeCentralizedRpcRequest(rpcCall, callName = 'RPC Call') {
  // Using SolanaServiceManager's executeRpcRequest which routes through the central queue
  return SolanaServiceManager.executeConnectionMethod(callName);
}

/**
 * Helper function to ensure a keypair has a properly formatted secretKey
 * for compatibility with @solana/transactions v2.1
 */
function ensureProperKeypair(keypair) {
  // Check if keypair is already properly formatted
  if (keypair.secretKey && keypair.secretKey.length === 64 && 
      keypair.secretKey instanceof Uint8Array) {
    return keypair;
  }
  
  logApi.warn(`Fixing keypair with improper secretKey format (length=${keypair.secretKey?.length || 0})`);
  
  try {
    // Attempt to create a new keypair from the existing one
    return Keypair.fromSecretKey(keypair.secretKey);
  } catch (error) {
    // If that fails, log the error and create a dummy keypair
    logApi.error(`Failed to fix keypair: ${error.message}`);
    throw new Error(`Cannot create valid keypair: ${error.message}`);
  }
}

/**
 * Converts a Solana web3.js Keypair to the format expected by @solana/transactions v2.1
 * We need to transform the keypair into a CryptoKeyPair object with privateKey and publicKey
 */
async function keypairToCryptoKeyPair(keypair) {
  // Create a proper CryptoKeyPair object as expected by @solana/transactions
  return {
    // The publicKey should be a CryptoKey object
    publicKey: {
      type: 'public',
      algorithm: { name: 'Ed25519' },
      extractable: true,
      usages: ['verify'],
      // The actual bytes are what matter
      _keyMaterial: keypair.publicKey.toBytes()
    },
    // The privateKey should be a CryptoKey object
    privateKey: {
      type: 'private',
      algorithm: { name: 'Ed25519' },
      extractable: true,
      usages: ['sign'],
      // The secretKey contains both private and public parts in Solana
      _keyMaterial: keypair.secretKey
    }
  };
}

export async function transferSOL(connection, fromKeypair, toAddress, amount) {
  try {
    // Log the input keypair details to debug the format issues
    logKeypairDetails(fromKeypair, 'Input fromKeypair');
    
    // CRITICAL FIX: Ensure we have a properly formatted keypair for v2.1 compatibility
    // The issue is that signTransaction expects CryptoKeyPair objects, not Solana Keypairs
    fromKeypair = ensureProperKeypair(fromKeypair);
    
    // Log the fixed keypair details 
    logKeypairDetails(fromKeypair, 'Fixed fromKeypair');
    
    // Convert string address to PublicKey if needed
    const toPubkey = typeof toAddress === 'string' 
      ? new PublicKey(toAddress) 
      : toAddress;
    
    // Create an RPC client - using the connection directly
    // but all RPC calls will go through the centralized queue
    logApi.info(`Creating RPC client with endpoint: ${connection.rpcEndpoint}, commitment: ${connection.commitment || 'confirmed'}`);
    const rpc = createSolanaRpc({ 
      url: connection.rpcEndpoint,
      commitment: connection.commitment
    });
    
    // Get a recent blockhash via SolanaServiceManager with detailed logging
    // Pass the commitment parameter to ensure the request works correctly
    logApi.info(`Getting latest blockhash with commitment: ${connection.commitment || 'confirmed'}`);
    
    let getBlockhashResult;
    try {
      // Try to get blockhash via SolanaServiceManager
      getBlockhashResult = await SolanaServiceManager.executeConnectionMethod(
        'getLatestBlockhash', 
        connection.commitment || 'confirmed'
      );
      
      // Log the result to help diagnose issues
      logApi.info(`Raw blockhash result: ${JSON.stringify(getBlockhashResult)}`);
      
      // Handle different response formats - direct blockhash or value.blockhash structure
      if (getBlockhashResult) {
        if (getBlockhashResult.value && getBlockhashResult.value.blockhash) {
          // Standard format with value.blockhash
          logApi.info(`Blockhash result: ${getBlockhashResult.value.blockhash.substring(0, 8)}... (success via SolanaServiceManager - standard format)`);
        } else if (getBlockhashResult.blockhash) {
          // Direct format with just blockhash property
          logApi.info(`Blockhash result: ${getBlockhashResult.blockhash.substring(0, 8)}... (success via SolanaServiceManager - direct format)`);
          
          // Normalize the format to match expected structure
          getBlockhashResult = {
            value: {
              blockhash: getBlockhashResult.blockhash,
              lastValidBlockHeight: getBlockhashResult.lastValidBlockHeight
            }
          };
        } else {
          logApi.warn(`Blockhash result from SolanaServiceManager has invalid format: ${JSON.stringify(getBlockhashResult || 'null')}`);
        }
      } else {
        logApi.warn(`Blockhash result from SolanaServiceManager is null or undefined`);
      }
    } catch (serviceError) {
      // Log the error from SolanaServiceManager
      logApi.error(`Error getting blockhash via SolanaServiceManager: ${serviceError.message}`, {
        stack: serviceError.stack,
        error_name: serviceError.name,
        is_service_error: !!serviceError.isServiceError
      });
      
      // Try direct connection as fallback
      try {
        logApi.warn(`Trying to get blockhash directly from connection as fallback...`);
        getBlockhashResult = await connection.getLatestBlockhash(connection.commitment || 'confirmed');
        logApi.info(`Got blockhash directly: ${getBlockhashResult.value.blockhash.substring(0, 8)}... (via direct connection)`);
      } catch (directError) {
        logApi.error(`Direct blockhash fetch also failed: ${directError.message}`, {
          stack: directError.stack
        });
        // Let original error be thrown
        throw serviceError;
      }
    }
    
    // Final validation check
    if (!getBlockhashResult || !getBlockhashResult.value || !getBlockhashResult.value.blockhash) {
      logApi.error(`Invalid blockhash response after all attempts: ${JSON.stringify(getBlockhashResult || 'null')}`);
      throw new Error('Failed to get latest blockhash from Solana network after multiple attempts');
    }
    
    const { value: latestBlockhash } = getBlockhashResult;
    
    // System Program ID for System Transfer (all zeros in base58)
    const systemProgramId = '11111111111111111111111111111111';
    
    // Instruction data for a transfer (opcode 2 + amount as 64-bit LE)
    const data = new Uint8Array(9);
    data[0] = 2; // Transfer opcode
    
    // Convert amount to lamports
    const amountInLamports = Math.floor(amount * LAMPORTS_PER_SOL);
    
    // Write amount as little-endian 64-bit value
    const view = new DataView(data.buffer, 1);
    view.setBigUint64(0, BigInt(amountInLamports), true);
    
    // Log addresses for debugging
    logApi.info(`Creating transfer instruction with addresses:
      - From: ${fromKeypair.publicKey.toString()} (${typeof fromKeypair.publicKey.toBase58()}, ${fromKeypair.publicKey.toBase58().length} chars)
      - To: ${toPubkey.toString()} (${typeof toPubkey.toBase58()}, ${toPubkey.toBase58().length} chars)
      - Program: ${systemProgramId} (${systemProgramId.length} chars)`);
    
    // Create the transfer instruction using PublicKey objects directly but serializing them properly
    const transferInstruction = {
      programId: systemProgramId,
      accounts: [
        { pubkey: fromKeypair.publicKey.toBase58(), isSigner: true, isWritable: true },
        { pubkey: toPubkey.toBase58(), isSigner: false, isWritable: true }
      ],
      data: data
    };
    
    // STEP 1: Build the transaction message
    // Create an empty transaction message with version 0
    let txMessage = createTransactionMessage({ version: 0 });
    
    // Set the fee payer using base58 string as required by the library
    txMessage = setTransactionMessageFeePayer(fromKeypair.publicKey.toBase58(), txMessage);
    
    // Set transaction lifetime using blockhash - making sure we pass the right object structure
    // The library expects an object with blockhash property, not just a string
    const blockHashForLifetime = typeof latestBlockhash === 'string' 
        ? { blockhash: latestBlockhash } 
        : latestBlockhash;
    
    logApi.info(`Setting lifetime using blockhash structure: ${JSON.stringify(blockHashForLifetime)}`);
    txMessage = setTransactionMessageLifetimeUsingBlockhash(blockHashForLifetime, txMessage);
    
    // Add the transfer instruction to the message
    txMessage = appendTransactionMessageInstruction(transferInstruction, txMessage);
    
    // STEP 2: Compile the message into an unsigned transaction
    // Import the compileTransaction function from @solana/transactions
    const { compileTransaction } = await import('@solana/transactions');
    const transaction = compileTransaction(txMessage);
    
    // STEP 3: Sign the transaction with the sender's keypair
    // Import only getBase64EncodedWireTransaction - we'll use our custom signing method
    const { getBase64EncodedWireTransaction } = await import('@solana/transactions');
    
    // CRITICAL FIX: Use our custom signing function that properly formats the keys
    // This avoids the address validation error by handling the CryptoKeyPair format correctly
    logApi.info(`Using custom signing to avoid address validation error`);
    const signedTransaction = await customSignTransaction(transaction, fromKeypair);
    
    // STEP 4: Encode the signed transaction for sending
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // STEP 5: Send the transaction via SolanaServiceManager to use centralized queue
    // We create a custom RPC method for sendTransaction because it's not directly on Connection
    // and uses a different signature in @solana/kit
    const txSignature = await SolanaServiceManager.executeRpcRequest(
      () => rpc.sendTransaction(encodedTransaction, { 
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: connection.commitment || 'confirmed'
      }).send(),
      'sendTransaction'
    );
    
    logApi.info('SOL transfer successful using @solana/transactions v2.1', {
      from: fromKeypair.publicKey.toString(),
      to: toPubkey.toString(),
      amount,
      signature: txSignature,
    });
    
    // Return signature
    return { signature: txSignature };
  } catch (error) {
    logApi.error('SOL transfer failed using @solana/transactions v2.1', {
      error: error.message,
      from: fromKeypair.publicKey.toString(),
      to: typeof toAddress === 'string' ? toAddress : toAddress.toString(),
      amount,
    });
    throw error;
  }
}

/**
 * Creates and sends a token transfer transaction using @solana/transaction-messages
 * and @solana/transactions v2.1 with the correct separation of message creation,
 * transaction compilation, and transaction signing
 * 
 * @param {Connection} connection - Solana connection object
 * @param {Keypair} fromKeypair - Sender's keypair
 * @param {string|PublicKey} fromTokenAccount - Sender's token account
 * @param {string|PublicKey} toTokenAccount - Recipient's token account
 * @param {number} amount - Token amount (in smallest units)
 * @param {string|PublicKey} mint - Token mint address
 * @returns {Promise<{signature: string}>} Transaction signature
 */
export async function transferToken(
  connection, 
  fromKeypair, 
  fromTokenAccount, 
  toTokenAccount, 
  amount,
  mint
) {
  try {
    // Create an RPC client
    const rpc = createSolanaRpc({ 
      url: connection.rpcEndpoint,
      commitment: connection.commitment
    });
    
    // Convert keys to PublicKey objects if they're strings
    const fromTokenPubkey = typeof fromTokenAccount === 'string' 
      ? new PublicKey(fromTokenAccount) 
      : fromTokenAccount;
    
    const toTokenPubkey = typeof toTokenAccount === 'string' 
      ? new PublicKey(toTokenAccount) 
      : toTokenAccount;
    
    const mintPubkey = typeof mint === 'string'
      ? new PublicKey(mint)
      : mint;
    
    // Get a recent blockhash via SolanaServiceManager with detailed logging
    // Pass the commitment parameter to ensure the request works correctly
    logApi.info(`Getting latest blockhash with commitment: ${connection.commitment || 'confirmed'}`);
    
    let getBlockhashResult;
    try {
      // Try to get blockhash via SolanaServiceManager
      getBlockhashResult = await SolanaServiceManager.executeConnectionMethod(
        'getLatestBlockhash', 
        connection.commitment || 'confirmed'
      );
      
      // Log the result to help diagnose issues
      logApi.info(`Raw blockhash result: ${JSON.stringify(getBlockhashResult)}`);
      
      // Handle different response formats - direct blockhash or value.blockhash structure
      if (getBlockhashResult) {
        if (getBlockhashResult.value && getBlockhashResult.value.blockhash) {
          // Standard format with value.blockhash
          logApi.info(`Blockhash result: ${getBlockhashResult.value.blockhash.substring(0, 8)}... (success via SolanaServiceManager - standard format)`);
        } else if (getBlockhashResult.blockhash) {
          // Direct format with just blockhash property
          logApi.info(`Blockhash result: ${getBlockhashResult.blockhash.substring(0, 8)}... (success via SolanaServiceManager - direct format)`);
          
          // Normalize the format to match expected structure
          getBlockhashResult = {
            value: {
              blockhash: getBlockhashResult.blockhash,
              lastValidBlockHeight: getBlockhashResult.lastValidBlockHeight
            }
          };
        } else {
          logApi.warn(`Blockhash result from SolanaServiceManager has invalid format: ${JSON.stringify(getBlockhashResult || 'null')}`);
        }
      } else {
        logApi.warn(`Blockhash result from SolanaServiceManager is null or undefined`);
      }
    } catch (serviceError) {
      // Log the error from SolanaServiceManager
      logApi.error(`Error getting blockhash via SolanaServiceManager: ${serviceError.message}`, {
        stack: serviceError.stack,
        error_name: serviceError.name,
        is_service_error: !!serviceError.isServiceError
      });
      
      // Try direct connection as fallback
      try {
        logApi.warn(`Trying to get blockhash directly from connection as fallback...`);
        getBlockhashResult = await connection.getLatestBlockhash(connection.commitment || 'confirmed');
        logApi.info(`Got blockhash directly: ${getBlockhashResult.value.blockhash.substring(0, 8)}... (via direct connection)`);
      } catch (directError) {
        logApi.error(`Direct blockhash fetch also failed: ${directError.message}`, {
          stack: directError.stack
        });
        // Let original error be thrown
        throw serviceError;
      }
    }
    
    // Final validation check
    if (!getBlockhashResult || !getBlockhashResult.value || !getBlockhashResult.value.blockhash) {
      logApi.error(`Invalid blockhash response after all attempts: ${JSON.stringify(getBlockhashResult || 'null')}`);
      throw new Error('Failed to get latest blockhash from Solana network after multiple attempts');
    }
    
    const { value: latestBlockhash } = getBlockhashResult;
    
    // Token Program ID in base58 format
    const tokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    
    // Instruction data for token transfer
    const data = new Uint8Array(9);
    data[0] = 3; // Transfer opcode for SPL Token Program
    
    // Set amount as a little-endian 64-bit value
    const view = new DataView(data.buffer, 1);
    view.setBigUint64(0, BigInt(amount), true);
    
    // Create the token transfer instruction using base58 strings as required by the library
    const transferInstruction = {
      programId: tokenProgramId,
      accounts: [
        { pubkey: fromTokenPubkey.toBase58(), isSigner: false, isWritable: true },
        { pubkey: toTokenPubkey.toBase58(), isSigner: false, isWritable: true },
        { pubkey: fromKeypair.publicKey.toBase58(), isSigner: true, isWritable: false }
      ],
      data: data
    };
    
    // STEP 1: Build the transaction message
    // Create an empty transaction message with version 0
    let txMessage = createTransactionMessage({ version: 0 });
    
    // Set the fee payer using base58 string as required by the library
    txMessage = setTransactionMessageFeePayer(fromKeypair.publicKey.toBase58(), txMessage);
    
    // Set transaction lifetime using blockhash - making sure we pass the right object structure
    // The library expects an object with blockhash property, not just a string
    const blockHashForLifetime = typeof latestBlockhash === 'string' 
        ? { blockhash: latestBlockhash } 
        : latestBlockhash;
    
    logApi.info(`Setting lifetime using blockhash structure: ${JSON.stringify(blockHashForLifetime)}`);
    txMessage = setTransactionMessageLifetimeUsingBlockhash(blockHashForLifetime, txMessage);
    
    // Add the transfer instruction to the message
    txMessage = appendTransactionMessageInstruction(transferInstruction, txMessage);
    
    // STEP 2: Compile the message into an unsigned transaction
    // Import the compileTransaction function from @solana/transactions
    const { compileTransaction } = await import('@solana/transactions');
    const transaction = compileTransaction(txMessage);
    
    // STEP 3: Sign the transaction with the sender's keypair
    // Import only getBase64EncodedWireTransaction - we'll use our custom signing method
    const { getBase64EncodedWireTransaction } = await import('@solana/transactions');
    
    // CRITICAL FIX: Use our custom signing function that properly formats the keys
    // This avoids the address validation error by handling the CryptoKeyPair format correctly
    logApi.info(`Using custom signing to avoid address validation error (token transfer)`);
    const signedTransaction = await customSignTransaction(transaction, fromKeypair);
    
    // STEP 4: Encode the signed transaction for sending
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // STEP 5: Send the transaction via SolanaServiceManager to use centralized queue
    const txSignature = await SolanaServiceManager.executeRpcRequest(
      () => rpc.sendTransaction(encodedTransaction, { 
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: connection.commitment || 'confirmed'
      }).send(),
      'sendTransaction'
    );
    
    logApi.info('Token transfer successful using @solana/transactions v2.1', {
      from: fromKeypair.publicKey.toString(),
      fromToken: fromTokenPubkey.toString(),
      toToken: toTokenPubkey.toString(),
      mint: mintPubkey.toString(),
      amount,
      signature: txSignature,
    });
    
    // Return signature
    return { signature: txSignature };
  } catch (error) {
    logApi.error('Token transfer failed using @solana/transactions v2.1', {
      error: error.message,
      from: fromKeypair.publicKey.toString(),
      fromToken: typeof fromTokenAccount === 'string' ? fromTokenAccount : fromTokenAccount.toString(),
      toToken: typeof toTokenAccount === 'string' ? toTokenAccount : toTokenAccount.toString(),
      amount,
    });
    throw error;
  }
}

/**
 * Estimates the transaction fee for a SOL transfer using @solana/transaction-messages
 * and @solana/transactions v2.1 with the correct separation of message creation,
 * transaction compilation, and transaction signing
 * 
 * @param {Connection} connection - Solana connection object
 * @param {PublicKey} fromPubkey - Sender's public key
 * @param {PublicKey} toPubkey - Recipient's public key
 * @returns {Promise<number>} Estimated fee in SOL
 */
export async function estimateSOLTransferFee(connection, fromPubkey, toPubkey) {
  try {
    // Create an RPC client
    const rpc = createSolanaRpc({ 
      url: connection.rpcEndpoint,
      commitment: connection.commitment
    });
    
    // Get a recent blockhash via SolanaServiceManager with detailed logging
    // Pass the commitment parameter to ensure the request works correctly
    logApi.info(`Getting latest blockhash with commitment: ${connection.commitment || 'confirmed'}`);
    
    let getBlockhashResult;
    try {
      // Try to get blockhash via SolanaServiceManager
      getBlockhashResult = await SolanaServiceManager.executeConnectionMethod(
        'getLatestBlockhash', 
        connection.commitment || 'confirmed'
      );
      
      // Log the result to help diagnose issues
      logApi.info(`Raw blockhash result: ${JSON.stringify(getBlockhashResult)}`);
      
      // Handle different response formats - direct blockhash or value.blockhash structure
      if (getBlockhashResult) {
        if (getBlockhashResult.value && getBlockhashResult.value.blockhash) {
          // Standard format with value.blockhash
          logApi.info(`Blockhash result: ${getBlockhashResult.value.blockhash.substring(0, 8)}... (success via SolanaServiceManager - standard format)`);
        } else if (getBlockhashResult.blockhash) {
          // Direct format with just blockhash property
          logApi.info(`Blockhash result: ${getBlockhashResult.blockhash.substring(0, 8)}... (success via SolanaServiceManager - direct format)`);
          
          // Normalize the format to match expected structure
          getBlockhashResult = {
            value: {
              blockhash: getBlockhashResult.blockhash,
              lastValidBlockHeight: getBlockhashResult.lastValidBlockHeight
            }
          };
        } else {
          logApi.warn(`Blockhash result from SolanaServiceManager has invalid format: ${JSON.stringify(getBlockhashResult || 'null')}`);
        }
      } else {
        logApi.warn(`Blockhash result from SolanaServiceManager is null or undefined`);
      }
    } catch (serviceError) {
      // Log the error from SolanaServiceManager
      logApi.error(`Error getting blockhash via SolanaServiceManager: ${serviceError.message}`, {
        stack: serviceError.stack,
        error_name: serviceError.name,
        is_service_error: !!serviceError.isServiceError
      });
      
      // Try direct connection as fallback
      try {
        logApi.warn(`Trying to get blockhash directly from connection as fallback...`);
        getBlockhashResult = await connection.getLatestBlockhash(connection.commitment || 'confirmed');
        logApi.info(`Got blockhash directly: ${getBlockhashResult.value.blockhash.substring(0, 8)}... (via direct connection)`);
      } catch (directError) {
        logApi.error(`Direct blockhash fetch also failed: ${directError.message}`, {
          stack: directError.stack
        });
        // Let original error be thrown
        throw serviceError;
      }
    }
    
    // Final validation check
    if (!getBlockhashResult || !getBlockhashResult.value || !getBlockhashResult.value.blockhash) {
      logApi.error(`Invalid blockhash response after all attempts: ${JSON.stringify(getBlockhashResult || 'null')}`);
      throw new Error('Failed to get latest blockhash from Solana network after multiple attempts');
    }
    
    const { value: latestBlockhash } = getBlockhashResult;
    
    // System Program ID (all zeros in base58)
    const systemProgramId = '11111111111111111111111111111111';
    
    // Instruction data for a transfer (opcode 2 + amount as 64-bit LE)
    const data = new Uint8Array(9);
    data[0] = 2; // Transfer opcode
    
    // Write placeholder amount as little-endian 64-bit value (1 SOL)
    const view = new DataView(data.buffer, 1);
    view.setBigUint64(0, BigInt(LAMPORTS_PER_SOL), true);
    
    // Create the transfer instruction using base58 strings as required by the library
    const transferInstruction = {
      programId: systemProgramId,
      accounts: [
        { pubkey: fromPubkey.toBase58(), isSigner: true, isWritable: true },
        { pubkey: toPubkey.toBase58(), isSigner: false, isWritable: true }
      ],
      data: data
    };
    
    // STEP 1: Build the transaction message
    // Create an empty transaction message with version 0
    let txMessage = createTransactionMessage({ version: 0 });
    
    // Set the fee payer using base58 string as required by the library
    txMessage = setTransactionMessageFeePayer(fromPubkey.toBase58(), txMessage);
    
    // Set transaction lifetime using blockhash - making sure we pass the right object structure
    // The library expects an object with blockhash property, not just a string
    const blockHashForLifetime = typeof latestBlockhash === 'string' 
        ? { blockhash: latestBlockhash } 
        : latestBlockhash;
    
    logApi.info(`Setting lifetime using blockhash structure: ${JSON.stringify(blockHashForLifetime)}`);
    txMessage = setTransactionMessageLifetimeUsingBlockhash(blockHashForLifetime, txMessage);
    
    // Add the transfer instruction to the message
    txMessage = appendTransactionMessageInstruction(transferInstruction, txMessage);
    
    // STEP 2: Compile the message into an unsigned transaction
    // Import the compileTransaction function from @solana/transactions
    const { compileTransaction } = await import('@solana/transactions');
    const transaction = compileTransaction(txMessage);
    
    // STEP 3: For simulation, we need to sign the transaction
    // Create a temporary keypair for simulation
    const tempKeypair = Keypair.generate();
    
    // Import only getBase64EncodedWireTransaction - we'll use our custom signing method
    const { getBase64EncodedWireTransaction } = await import('@solana/transactions');
    
    // Use our custom signing function for consistency with the rest of the code
    // For simulation, this doesn't need to be a valid signature
    logApi.info(`Using custom signing for fee estimation`);
    const signedTransaction = await customSignTransaction(transaction, tempKeypair);
    
    // STEP 4: Encode the signed transaction for simulation
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // STEP 5: Simulate the transaction to get the fee via SolanaServiceManager
    const simulationResult = await SolanaServiceManager.executeRpcRequest(
      () => rpc.simulateTransaction(encodedTransaction, {
        commitment: 'confirmed',
        encoding: 'base64',
        replaceRecentBlockhash: true, // Important: this replaces our fake signature with a valid one for simulation
        sigVerify: false // Skip signature verification since we're using a fake signer
      }),
      'simulateTransaction'
    );
    
    // Extract fee information from simulation result
    const fee = simulationResult.value?.fee || 5000; // Default to 5000 lamports if no fee info
    
    return fee / LAMPORTS_PER_SOL;
  } catch (error) {
    logApi.error('Failed to estimate transaction fee using @solana/transactions v2.1', {
      error: error.message,
    });
    // Return a default fee estimate if calculation fails
    return 0.000005; // 5000 lamports as a fallback
  }
}

export default {
  transferSOL,
  transferToken,
  estimateSOLTransferFee,
};