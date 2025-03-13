// utils/solana-suite/web3-v2/solana-transaction-fixed.js

/*
 * This is an updated implementation using @solana/transaction-messages and @solana/transactions v2.1
 * in a more functional programming style, properly separating message creation from transaction
 * compilation and signing
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

import { logApi } from '../../logger-suite/logger.js';

/**
 * Creates and sends a SOL transfer transaction using @solana/transaction-messages
 * and @solana/transactions v2.1 with the correct separation of message creation,
 * transaction compilation, and transaction signing
 * 
 * @param {Connection} connection - Solana connection object
 * @param {Keypair} fromKeypair - Sender's keypair
 * @param {string|PublicKey} toAddress - Recipient's address
 * @param {number} amount - Amount in SOL
 * @returns {Promise<{signature: string}>} Transaction signature
 */
export async function transferSOL(connection, fromKeypair, toAddress, amount) {
  try {
    // Convert string address to PublicKey if needed
    const toPubkey = typeof toAddress === 'string' 
      ? new PublicKey(toAddress) 
      : toAddress;
    
    // Create an RPC client
    const rpc = createSolanaRpc({ 
      url: connection.rpcEndpoint,
      commitment: connection.commitment
    });
    
    // Get a recent blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash();
    
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
    
    // Create the transfer instruction using base58 strings for pubkeys
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
    
    // Set the fee payer using base58 string
    txMessage = setTransactionMessageFeePayer(fromKeypair.publicKey.toBase58(), txMessage);
    
    // Set transaction lifetime using blockhash
    txMessage = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.blockhash, txMessage);
    
    // Add the transfer instruction to the message
    txMessage = appendTransactionMessageInstruction(transferInstruction, txMessage);
    
    // STEP 2: Compile the message into an unsigned transaction
    // Import the compileTransaction function from @solana/transactions
    const { compileTransaction } = await import('@solana/transactions');
    const transaction = compileTransaction(txMessage);
    
    // STEP 3: Sign the transaction with the sender's keypair
    // Import the signTransaction and getBase64EncodedWireTransaction functions from @solana/transactions
    const { signTransaction, getBase64EncodedWireTransaction } = await import('@solana/transactions');
    
    // Sign the transaction
    const signedTransaction = await signTransaction([fromKeypair.secretKey], transaction);
    
    // STEP 4: Encode the signed transaction for sending
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // STEP 5: Send the transaction with proper encoding specified
    const txSignature = await rpc.sendTransaction(encodedTransaction, { 
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: connection.commitment || 'confirmed'
    }).send();
    
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
    
    // Get a recent blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash();
    
    // Token Program ID in base58 format
    const tokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    
    // Instruction data for token transfer
    const data = new Uint8Array(9);
    data[0] = 3; // Transfer opcode for SPL Token Program
    
    // Set amount as a little-endian 64-bit value
    const view = new DataView(data.buffer, 1);
    view.setBigUint64(0, BigInt(amount), true);
    
    // Create the token transfer instruction using base58 strings for pubkeys
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
    
    // Set the fee payer using base58 string
    txMessage = setTransactionMessageFeePayer(fromKeypair.publicKey.toBase58(), txMessage);
    
    // Set transaction lifetime using blockhash
    txMessage = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.blockhash, txMessage);
    
    // Add the transfer instruction to the message
    txMessage = appendTransactionMessageInstruction(transferInstruction, txMessage);
    
    // STEP 2: Compile the message into an unsigned transaction
    // Import the compileTransaction function from @solana/transactions
    const { compileTransaction } = await import('@solana/transactions');
    const transaction = compileTransaction(txMessage);
    
    // STEP 3: Sign the transaction with the sender's keypair
    // Import the signTransaction and getBase64EncodedWireTransaction functions from @solana/transactions
    const { signTransaction, getBase64EncodedWireTransaction } = await import('@solana/transactions');
    
    // Sign the transaction
    const signedTransaction = await signTransaction([fromKeypair.secretKey], transaction);
    
    // STEP 4: Encode the signed transaction for sending
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // STEP 5: Send the transaction with proper encoding specified
    const txSignature = await rpc.sendTransaction(encodedTransaction, { 
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: connection.commitment || 'confirmed'
    }).send();
    
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
    
    // Get a recent blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash();
    
    // System Program ID (all zeros in base58)
    const systemProgramId = '11111111111111111111111111111111';
    
    // Instruction data for a transfer (opcode 2 + amount as 64-bit LE)
    const data = new Uint8Array(9);
    data[0] = 2; // Transfer opcode
    
    // Write placeholder amount as little-endian 64-bit value (1 SOL)
    const view = new DataView(data.buffer, 1);
    view.setBigUint64(0, BigInt(LAMPORTS_PER_SOL), true);
    
    // Create the transfer instruction using base58 strings for pubkeys
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
    
    // Set the fee payer using base58 string
    txMessage = setTransactionMessageFeePayer(fromPubkey.toBase58(), txMessage);
    
    // Set transaction lifetime using blockhash
    txMessage = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.blockhash, txMessage);
    
    // Add the transfer instruction to the message
    txMessage = appendTransactionMessageInstruction(transferInstruction, txMessage);
    
    // STEP 2: Compile the message into an unsigned transaction
    // Import the compileTransaction function from @solana/transactions
    const { compileTransaction } = await import('@solana/transactions');
    const transaction = compileTransaction(txMessage);
    
    // STEP 3: For simulation, we need to sign the transaction
    // Create a temporary keypair for simulation
    const tempKeypair = Keypair.generate();
    
    // Import the signTransaction and getBase64EncodedWireTransaction functions
    const { signTransaction, getBase64EncodedWireTransaction } = await import('@solana/transactions');
    
    // Sign the transaction with the temporary keypair
    // This won't be a valid signature for the real fromPubkey, but works for simulation
    const signedTransaction = await signTransaction([tempKeypair.secretKey], transaction);
    
    // STEP 4: Encode the signed transaction for simulation
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // STEP 5: Simulate the transaction to get the fee
    const simulationResult = await rpc.simulateTransaction(encodedTransaction, {
      commitment: 'confirmed',
      encoding: 'base64',
      replaceRecentBlockhash: true, // Important: this replaces our fake signature with a valid one for simulation
      sigVerify: false // Skip signature verification since we're using a fake signer
    });
    
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